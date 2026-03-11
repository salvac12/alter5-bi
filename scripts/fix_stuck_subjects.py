"""
===============================================================
  Alter5 BI — Fix stuck dated_subjects
===============================================================

  Identifies companies whose dated_subjects are stuck with old
  emails (from the original Excel import that kept the oldest 30
  instead of the newest 30). Queries Gmail API directly for each
  stuck domain to fetch their most recent emails.

  Requires:
    GOOGLE_SERVICE_ACCOUNT_JSON  — service account JSON
    GEMINI_API_KEY               — (optional, not used here)

  Usage:
    python scripts/fix_stuck_subjects.py              # fix all stuck
    python scripts/fix_stuck_subjects.py --dry-run    # preview only
    python scripts/fix_stuck_subjects.py --domain X   # fix one domain
===============================================================
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import export_to_compact, get_data_paths
from scan_mailboxes import get_gmail_service, parse_from_header, fetch_messages_batch
from process_sheet_emails import PERSONAL_DOMAINS


def find_stuck_companies(all_companies, cutoff_year="2023"):
    """Find companies with 30 dated_subjects all older than cutoff_year."""
    stuck = {}
    for domain, c in all_companies.items():
        ds = c.get("dated_subjects", [])
        if len(ds) < 30:
            continue
        newest = max(x[0] for x in ds)
        if newest < cutoff_year:
            stuck[domain] = c
    return stuck


def fetch_domain_messages(service, mailbox_email, domain, max_results=50):
    """Fetch messages from a specific domain in a mailbox."""
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


def fix_domain(domain, company, mailboxes_config, dry_run=False):
    """Query Gmail for a domain across all mailboxes and update dated_subjects."""
    all_entries = []
    seen_subjects = set()

    for mailbox in mailboxes_config:
        email = mailbox["email"]
        emp_id = mailbox["id"]

        try:
            service = get_gmail_service(email)
        except Exception as e:
            print(f"    [SKIP] {email}: {e}")
            continue

        # Fetch messages from this domain (newest first, Gmail default order)
        msg_ids = fetch_domain_messages(service, email, domain, max_results=50)
        if not msg_ids:
            continue

        # Fetch metadata
        messages = fetch_messages_batch(service, email, msg_ids)
        entries = parse_messages(messages)

        # Dedup by subject across mailboxes
        for entry in entries:
            if entry[1] not in seen_subjects:
                all_entries.append(entry)
                seen_subjects.add(entry[1])

        print(f"    {email}: {len(msg_ids)} msgs, {len(entries)} unique threads")

    if not all_entries:
        print(f"    [!] No se encontraron emails para {domain}")
        return False

    # Sort by date and keep the 30 most recent
    all_entries = sorted(all_entries, key=lambda x: x[0])[-30:]

    old_newest = max(x[0] for x in company.get("dated_subjects", [[""]]))
    new_newest = all_entries[-1][0] if all_entries else "?"
    new_oldest = all_entries[0][0] if all_entries else "?"

    print(f"    Antes: newest={old_newest} | Ahora: {new_oldest} → {new_newest} ({len(all_entries)} entries)")

    if not dry_run:
        company["dated_subjects"] = all_entries

    return True


def main():
    parser = argparse.ArgumentParser(description="Fix stuck dated_subjects")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--domain", type=str, help="Fix a specific domain only")
    args = parser.parse_args()

    print("=" * 60)
    print("  Alter5 BI — Fix stuck dated_subjects")
    print("=" * 60)
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

    # Find stuck companies
    if args.domain:
        if args.domain not in all_companies:
            print(f"  [ERROR] Domain {args.domain} not found")
            return
        stuck = {args.domain: all_companies[args.domain]}
    else:
        stuck = find_stuck_companies(all_companies)

    print(f"  Empresas con dated_subjects atascados: {len(stuck)}")
    if not stuck:
        print("  Nada que arreglar!")
        return

    # Sort by interactions (most active first)
    sorted_stuck = sorted(stuck.items(), key=lambda x: x[1].get("interactions", 0), reverse=True)

    fixed = 0
    for i, (domain, company) in enumerate(sorted_stuck):
        interactions = company.get("interactions", 0)
        ds = company.get("dated_subjects", [])
        newest = max(x[0] for x in ds) if ds else "?"
        print(f"\n  [{i+1}/{len(stuck)}] {domain} ({interactions} interactions, newest: {newest})")

        if fix_domain(domain, company, mailboxes_config, dry_run=args.dry_run):
            fixed += 1

    print(f"\n  Resultado: {fixed}/{len(stuck)} empresas {'actualizarían' if args.dry_run else 'actualizadas'}")

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
