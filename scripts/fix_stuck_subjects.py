"""
===============================================================
  Alter5 BI — Fix stuck / missing dated_subjects
===============================================================

  Identifies companies whose dated_subjects are stuck with old
  emails or completely empty, and queries Gmail API directly per
  domain (from:@domain) to fetch their most recent emails.

  Three modes:
    --stuck          Only fix companies with 30 old dated_subjects (default)
    --empty          Only fix companies with 0 dated_subjects
    --all            Fix both stuck and empty

  Filters:
    --min N          Only fix companies with >= N interactions (default: 10)
    --domain X       Fix a specific domain only
    --dry-run        Preview without writing

  Requires:
    GOOGLE_SERVICE_ACCOUNT_JSON  — service account JSON

  Usage:
    python scripts/fix_stuck_subjects.py --all --min 10
    python scripts/fix_stuck_subjects.py --empty --min 50
    python scripts/fix_stuck_subjects.py --domain bestinver.es
    python scripts/fix_stuck_subjects.py --all --dry-run
===============================================================
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import export_to_compact, get_data_paths
from scan_mailboxes import get_gmail_service, parse_from_header, fetch_messages_batch


def find_targets(all_companies, mode="stuck", min_interactions=10, cutoff_year="2023"):
    """Find companies that need dated_subjects fixed.

    Args:
        mode: 'stuck' (30 old entries), 'empty' (0 entries), 'all' (both)
        min_interactions: minimum interactions to bother fixing
        cutoff_year: year threshold for 'stuck' detection
    """
    targets = {}
    for domain, c in all_companies.items():
        interactions = c.get("interactions", 0)
        if interactions < min_interactions:
            continue

        ds = c.get("dated_subjects", [])

        if mode in ("stuck", "all"):
            if len(ds) >= 30:
                newest = max(x[0] for x in ds)
                if newest < cutoff_year:
                    targets[domain] = c
                    continue

        if mode in ("empty", "all"):
            if not ds:
                # Must have contacts to query Gmail
                contacts = c.get("contacts", [])
                if contacts:
                    targets[domain] = c

    return targets


def fetch_domain_messages(service, mailbox_email, domain, max_results=50):
    """Fetch message IDs from a specific domain in a mailbox."""
    query = f"from:@{domain}"
    ids = []
    page_token = None

    while True:
        kwargs = {
            "userId": mailbox_email,
            "q": query,
            "maxResults": min(100, max_results - len(ids)),
        }
        if page_token:
            kwargs["pageToken"] = page_token

        result = service.users().messages().list(**kwargs).execute()
        messages = result.get("messages", [])
        ids.extend(m["id"] for m in messages)

        page_token = result.get("nextPageToken")
        if not page_token or len(ids) >= max_results:
            break

    return ids[:max_results]


def parse_messages(messages):
    """Parse Gmail messages into dated_subjects entries."""
    entries = []
    seen_threads = set()

    for msg in messages:
        thread_id = msg.get("threadId", "")
        if thread_id in seen_threads:
            continue
        seen_threads.add(thread_id)

        headers = {}
        for h in msg.get("payload", {}).get("headers", []):
            headers[h["name"].lower()] = h["value"]

        # Parse date
        date_str = ""
        try:
            dt = parsedate_to_datetime(headers.get("date", ""))
            date_str = dt.strftime("%Y-%m-%d")
        except Exception:
            try:
                internal_date = int(msg.get("internalDate", 0))
                if internal_date:
                    date_str = datetime.fromtimestamp(
                        internal_date / 1000, tz=timezone.utc
                    ).strftime("%Y-%m-%d")
            except Exception:
                pass

        subject = (headers.get("subject", "") or "")[:200]
        snippet = (msg.get("snippet", "") or "")[:300]

        if subject and date_str:
            entries.append([date_str, subject, snippet[:200] if snippet else ""])

    return entries


def fix_domain(domain, company, gmail_services, dry_run=False):
    """Query Gmail for a domain across all mailboxes and update dated_subjects."""
    all_entries = []
    seen_subjects = set()

    for mailbox_email, service in gmail_services.items():
        # Fetch messages from this domain (newest first, Gmail default order)
        try:
            msg_ids = fetch_domain_messages(service, mailbox_email, domain, max_results=50)
        except Exception as e:
            print(f"    {mailbox_email}: [ERROR] {e}")
            continue

        if not msg_ids:
            continue

        # Fetch metadata
        messages = fetch_messages_batch(service, mailbox_email, msg_ids)
        entries = parse_messages(messages)

        # Dedup by subject across mailboxes
        new_count = 0
        for entry in entries:
            if entry[1] not in seen_subjects:
                all_entries.append(entry)
                seen_subjects.add(entry[1])
                new_count += 1

        print(f"    {mailbox_email}: {len(msg_ids)} msgs, {new_count} new unique")

    if not all_entries:
        return False

    # Sort by date and keep the 30 most recent
    all_entries = sorted(all_entries, key=lambda x: x[0])[-30:]

    old_ds = company.get("dated_subjects", [])
    old_newest = max(x[0] for x in old_ds) if old_ds else "(vacío)"
    new_newest = all_entries[-1][0]
    new_oldest = all_entries[0][0]

    print(f"    Antes: {len(old_ds)} entries, newest={old_newest}")
    print(f"    Ahora: {len(all_entries)} entries, {new_oldest} → {new_newest}")

    if not dry_run:
        company["dated_subjects"] = all_entries

    return True


def main():
    parser = argparse.ArgumentParser(description="Fix stuck/missing dated_subjects")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--domain", type=str, help="Fix a specific domain only")
    parser.add_argument("--stuck", action="store_true", help="Fix only stuck (30 old entries)")
    parser.add_argument("--empty", action="store_true", help="Fix only empty dated_subjects")
    parser.add_argument("--all", action="store_true", help="Fix both stuck and empty")
    parser.add_argument("--min", type=int, default=10, dest="min_interactions",
                        help="Min interactions to bother fixing (default: 10)")
    args = parser.parse_args()

    # Default mode
    if not args.stuck and not args.empty and not args.all and not args.domain:
        args.stuck = True
    mode = "all" if args.all else ("empty" if args.empty else "stuck")

    print("=" * 60)
    print("  Alter5 BI — Fix stuck/missing dated_subjects")
    print("=" * 60)
    print(f"  Modo: {mode}, min interactions: {args.min_interactions}")
    print()

    paths = get_data_paths(PROJECT_DIR)

    # Load companies
    with open(paths["full"], "r", encoding="utf-8") as f:
        existing_data = json.load(f)
    all_companies = existing_data.get("companies", {})
    employees = existing_data.get("employees", [])

    # Load mailboxes
    config_path = os.path.join(PROJECT_DIR, "config", "mailboxes.json")
    with open(config_path, "r", encoding="utf-8") as f:
        mailboxes_config = [
            m for m in json.load(f).get("mailboxes", []) if m.get("activo", True)
        ]

    # Find target companies
    if args.domain:
        if args.domain not in all_companies:
            print(f"  [ERROR] Domain {args.domain} not found")
            return
        targets = {args.domain: all_companies[args.domain]}
    else:
        targets = find_targets(all_companies, mode=mode, min_interactions=args.min_interactions)

    print(f"  Empresas a procesar: {len(targets)}")
    if not targets:
        print("  Nada que arreglar!")
        return

    # Pre-connect to all Gmail services (reuse across domains)
    print("  Conectando a Gmail API...")
    gmail_services = {}
    for mailbox in mailboxes_config:
        try:
            service = get_gmail_service(mailbox["email"])
            gmail_services[mailbox["email"]] = service
            print(f"    OK: {mailbox['email']}")
        except Exception as e:
            print(f"    [SKIP] {mailbox['email']}: {e}")
    print()

    if not gmail_services:
        print("  [ERROR] No se pudo conectar a ningun buzon")
        return

    # Sort by interactions (most active first)
    sorted_targets = sorted(targets.items(), key=lambda x: x[1].get("interactions", 0), reverse=True)

    fixed = 0
    not_found = 0
    t0 = time.time()

    for i, (domain, company) in enumerate(sorted_targets):
        interactions = company.get("interactions", 0)
        ds = company.get("dated_subjects", [])
        newest = max(x[0] for x in ds) if ds else "(vacío)"
        print(f"  [{i+1}/{len(targets)}] {domain} ({interactions} interactions, ds: {newest})")

        if fix_domain(domain, company, gmail_services, dry_run=args.dry_run):
            fixed += 1
        else:
            not_found += 1

    elapsed = time.time() - t0
    label = "actualizarían" if args.dry_run else "actualizadas"
    print(f"\n  Resultado: {fixed} {label}, {not_found} sin emails en Gmail ({elapsed:.0f}s)")

    if not args.dry_run and fixed > 0:
        print("  Escribiendo archivos...")
        full_data = {"companies": all_companies, "employees": employees}
        with open(paths["full"], "w", encoding="utf-8") as f:
            json.dump(full_data, f, ensure_ascii=False, indent=2)

        compact = export_to_compact(all_companies)
        with open(paths["compact"], "w", encoding="utf-8") as f:
            json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

        print(f"  OK: archivos actualizados")


if __name__ == "__main__":
    main()
