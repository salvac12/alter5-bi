"""
===============================================================
  Alter5 BI — Gmail Scanner directo (reemplaza GAS + Sheet)
===============================================================

  Se ejecuta en GitHub Actions (o localmente para testing).
  Conecta directamente a Gmail API via Service Account con
  delegacion de dominio, escanea emails recientes, clasifica
  dominios nuevos con Gemini, y actualiza los JSON del dashboard.

  Variables de entorno requeridas:
    GOOGLE_SERVICE_ACCOUNT_JSON  — JSON de la service account
    GEMINI_API_KEY               — API key de Google AI Studio

  Uso:
    python scripts/scan_mailboxes.py              # ultimas 24h (default)
    python scripts/scan_mailboxes.py --days 7     # ultimos 7 dias
    python scripts/scan_mailboxes.py --days 30    # backfill 30 dias
===============================================================
"""

import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CONFIG_DIR = os.path.join(PROJECT_DIR, "config")
MAILBOXES_FILE = os.path.join(CONFIG_DIR, "mailboxes.json")
SCAN_STATE_FILE = os.path.join(CONFIG_DIR, "scan_state.json")

# Import shared functions
sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import merge_company, export_to_compact, get_data_paths
from process_sheet_emails import classify_domains_with_gemini, PERSONAL_DOMAINS

# ---------------------------------------------------------------------------
# Gmail API helpers
# ---------------------------------------------------------------------------
def get_gmail_service(email):
    """Build Gmail API service using Service Account with domain delegation."""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not sa_json:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON env var not set")

    sa_info = json.loads(sa_json)
    credentials = service_account.Credentials.from_service_account_info(
        sa_info,
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
    )
    delegated = credentials.with_subject(email)
    return build("gmail", "v1", credentials=delegated, cache_discovery=False)


def fetch_message_ids(service, email, after_date, max_results=500):
    """Fetch message IDs matching query, with pagination. Cap at max_results."""
    query = f"after:{after_date} -from:me"
    ids = []
    page_token = None

    while True:
        kwargs = {
            "userId": email,
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


def fetch_messages_batch(service, email, msg_ids):
    """Fetch messages using batch API (100 per request). Returns parsed list."""
    from googleapiclient.http import BatchHttpRequest

    all_messages = []
    BATCH_SIZE = 100

    for batch_start in range(0, len(msg_ids), BATCH_SIZE):
        batch_ids = msg_ids[batch_start:batch_start + BATCH_SIZE]
        batch_results = []

        def callback(request_id, response, exception):
            if exception:
                return
            if response:
                batch_results.append(response)

        batch = service.new_batch_http_request(callback=callback)
        for mid in batch_ids:
            batch.add(
                service.users().messages().get(
                    userId=email,
                    id=mid,
                    format="metadata",
                    metadataHeaders=["From", "Subject", "Date"],
                )
            )
        batch.execute()
        all_messages.extend(batch_results)

    return all_messages


def parse_from_header(from_str):
    """Parse From header into {email, name, domain}. Port of GAS parseFromField_."""
    match = re.search(r"<([^>]+)>", from_str)
    if match:
        email = match.group(1).strip().lower()
        name = re.sub(r"<[^>]+>", "", from_str).strip().strip("\"'")
    else:
        email = from_str.strip().lower()
        name = ""

    domain = email.split("@")[1] if "@" in email else ""
    return {"email": email, "name": name, "domain": domain.lower()}


# ---------------------------------------------------------------------------
# Core scanning
# ---------------------------------------------------------------------------
def scan_mailbox(mailbox, state, blocklist, days_override=None):
    """Scan a single mailbox via Gmail API. Returns grouped data by domain.

    Args:
        mailbox: dict from mailboxes.json
        state: dict of scan_state.json
        blocklist: set of domains to skip
        days_override: if set, override scan window to N days ago

    Returns:
        dict of domain -> {employees, contacts, subjects, dated_subjects, snippets}
    """
    email = mailbox["email"]
    emp_id = mailbox["id"]

    # Determine scan window
    if days_override is not None:
        after_dt = datetime.now(timezone.utc) - timedelta(days=days_override)
    elif email in state and state[email]:
        # Resume from last scan timestamp
        try:
            last_ts = datetime.fromisoformat(state[email].replace("Z", "+00:00"))
            # Add 1-hour overlap to avoid gaps
            after_dt = last_ts - timedelta(hours=1)
        except (ValueError, TypeError):
            after_dt = datetime.now(timezone.utc) - timedelta(days=1)
    else:
        # New mailbox without state — scan last 7 days
        after_dt = datetime.now(timezone.utc) - timedelta(days=7)

    after_date = after_dt.strftime("%Y/%m/%d")
    print(f"    Email: {email}")
    print(f"    Ventana: after:{after_date}")

    # Connect to Gmail API
    try:
        service = get_gmail_service(email)
    except Exception as e:
        print(f"    [ERROR] No se pudo conectar a Gmail: {e}")
        return {}

    # Fetch message IDs
    msg_ids = fetch_message_ids(service, email, after_date)
    print(f"    Mensajes encontrados: {len(msg_ids)}")

    if not msg_ids:
        return {}

    # Fetch message metadata in batches
    messages = fetch_messages_batch(service, email, msg_ids)
    print(f"    Mensajes descargados: {len(messages)}")

    # Parse and group by domain
    seen_threads = set()
    companies = defaultdict(lambda: {
        "employees": defaultdict(lambda: {
            "interactions": 0,
            "firstDate": "9999-12-31",
            "lastDate": "0000-01-01",
        }),
        "contacts": {},
        "subjects": [],
        "dated_subjects": [],
        "snippets": [],
    })

    for msg in messages:
        thread_id = msg.get("threadId", "")
        if thread_id in seen_threads:
            continue
        seen_threads.add(thread_id)

        # Extract headers
        headers = {}
        for h in msg.get("payload", {}).get("headers", []):
            headers[h["name"].lower()] = h["value"]

        parsed = parse_from_header(headers.get("from", ""))
        domain = parsed["domain"]

        if not domain or domain in PERSONAL_DOMAINS or domain in blocklist:
            continue

        # Parse date
        date_str = ""
        try:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(headers.get("date", ""))
            date_str = dt.strftime("%Y-%m-%d")
        except Exception:
            try:
                internal_date = int(msg.get("internalDate", 0))
                if internal_date:
                    date_str = datetime.fromtimestamp(internal_date / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            except Exception:
                pass

        subject = (headers.get("subject", "") or "")[:200]
        snippet = (msg.get("snippet", "") or "")[:300]

        co = companies[domain]

        # Update employee stats
        emp = co["employees"][emp_id]
        emp["interactions"] += 1
        if date_str and date_str < emp["firstDate"]:
            emp["firstDate"] = date_str
        if date_str and date_str > emp["lastDate"]:
            emp["lastDate"] = date_str

        # Track contacts
        if parsed["email"] and parsed["email"] not in co["contacts"]:
            co["contacts"][parsed["email"]] = {
                "name": parsed["name"] or parsed["email"].split("@")[0],
                "email": parsed["email"],
                "domain": domain,
            }

        # Track subjects
        if subject and len(co["subjects"]) < 20:
            co["subjects"].append(subject)

        # Track dated subjects
        if subject and date_str and len(co["dated_subjects"]) < 30:
            co["dated_subjects"].append([date_str, subject, snippet[:200] if snippet else ""])

        # Track snippets
        if snippet and len(co["snippets"]) < 10:
            co["snippets"].append(snippet[:200])

    return dict(companies)


def merge_all_mailboxes(results_list):
    """Combine scan results from multiple mailboxes. Dedup subjects/snippets."""
    merged = defaultdict(lambda: {
        "employees": defaultdict(lambda: {
            "interactions": 0,
            "firstDate": "9999-12-31",
            "lastDate": "0000-01-01",
        }),
        "contacts": {},
        "subjects": [],
        "dated_subjects": [],
        "snippets": [],
    })

    for result in results_list:
        for domain, data in result.items():
            co = merged[domain]

            # Merge employee stats
            for emp_id, emp_stats in data["employees"].items():
                existing = co["employees"][emp_id]
                existing["interactions"] += emp_stats["interactions"]
                if emp_stats["firstDate"] < existing["firstDate"]:
                    existing["firstDate"] = emp_stats["firstDate"]
                if emp_stats["lastDate"] > existing["lastDate"]:
                    existing["lastDate"] = emp_stats["lastDate"]

            # Merge contacts (dedup by email)
            for email, contact in data["contacts"].items():
                if email not in co["contacts"]:
                    co["contacts"][email] = contact

            # Merge subjects (dedup)
            existing_subj = set(co["subjects"])
            for s in data["subjects"]:
                if s not in existing_subj and len(co["subjects"]) < 20:
                    co["subjects"].append(s)
                    existing_subj.add(s)

            # Merge dated_subjects (dedup by subject text)
            existing_ds = {ds[1] for ds in co["dated_subjects"]}
            for ds in data["dated_subjects"]:
                if ds[1] not in existing_ds and len(co["dated_subjects"]) < 30:
                    co["dated_subjects"].append(ds)
                    existing_ds.add(ds[1])

            # Merge snippets (dedup)
            existing_snip = set(co["snippets"])
            for s in data["snippets"]:
                if s not in existing_snip and len(co["snippets"]) < 10:
                    co["snippets"].append(s)
                    existing_snip.add(s)

    return dict(merged)


def apply_to_companies(grouped, all_companies):
    """Apply grouped email data to companies using merge_company(). Returns list of new domain keys."""
    new_domain_keys = []

    for domain, data in grouped.items():
        for emp_id, emp_stats in data["employees"].items():
            contacts_list = []
            for email, contact in data["contacts"].items():
                contacts_list.append({
                    "name": contact["name"],
                    "email": email,
                    "role": "No identificado",
                })

            new_company_data = {
                "name": domain.split(".")[0].title(),
                "domain": domain,
                "sectors": "",
                "nContacts": len(contacts_list),
                "interactions": emp_stats["interactions"],
                "relType": "",
                "firstDate": emp_stats["firstDate"] if emp_stats["firstDate"] != "9999-12-31" else "",
                "lastDate": emp_stats["lastDate"] if emp_stats["lastDate"] != "0000-01-01" else "",
                "context": f"Emails sobre: {', '.join(data['subjects'][:3])}"[:150],
                "contacts": contacts_list[:5],
                "timeline": [],
                "subjects": data["subjects"][:20],
                "dated_subjects": sorted(data.get("dated_subjects", []), key=lambda x: x[0])[:30],
                "snippets": data["snippets"][:10],
            }

            # Preserve existing name
            if domain in all_companies:
                new_company_data["name"] = all_companies[domain].get("name", new_company_data["name"])

            is_new = domain not in all_companies
            all_companies[domain] = merge_company(
                all_companies.get(domain),
                new_company_data,
                emp_id,
            )

            if is_new:
                new_domain_keys.append(domain)
                break  # Only count once per domain

    return new_domain_keys


def classify_and_enrich(all_companies, new_keys, grouped):
    """Classify new domains with Gemini and assign enrichment."""
    if not new_keys:
        print("  -> No hay dominios nuevos que clasificar")
        return

    domains_with_context = []
    for domain in new_keys:
        data = grouped.get(domain, {})
        subjects = data.get("subjects", []) if data else all_companies.get(domain, {}).get("subjects", [])
        snippets = data.get("snippets", []) if data else all_companies.get(domain, {}).get("snippets", [])
        domains_with_context.append((domain, subjects, snippets))

    print(f"  -> Clasificando {len(domains_with_context)} dominios nuevos con Gemini...")
    classifications = classify_domains_with_gemini(domains_with_context)

    enriched = 0
    for domain, result in classifications.items():
        enrichment = result.get("enrichment")
        if enrichment and domain in all_companies:
            all_companies[domain]["enrichment"] = enrichment
            enriched += 1

    print(f"  -> {enriched} empresas enriquecidas con IA")


# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------
def load_scan_state():
    """Load scan state (last scan timestamp per mailbox)."""
    if os.path.exists(SCAN_STATE_FILE):
        with open(SCAN_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_scan_state(state):
    """Save scan state."""
    os.makedirs(os.path.dirname(SCAN_STATE_FILE), exist_ok=True)
    with open(SCAN_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def load_mailboxes():
    """Load active mailboxes from config."""
    if not os.path.exists(MAILBOXES_FILE):
        raise RuntimeError(f"No se encuentra {MAILBOXES_FILE}")
    with open(MAILBOXES_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [m for m in data.get("mailboxes", []) if m.get("activo", True)]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Alter5 BI — Gmail Scanner directo")
    parser.add_argument("--days", type=int, default=None,
                        help="Override: escanear los ultimos N dias (default: usa scan_state)")
    args = parser.parse_args()

    print("=" * 60)
    print("  Alter5 BI — Gmail Scanner directo")
    print("=" * 60)
    print()

    paths = get_data_paths(PROJECT_DIR)

    # [1/9] Load config
    print("  [1/9] Cargando configuracion...")
    mailboxes = load_mailboxes()
    print(f"  -> {len(mailboxes)} buzones activos: {', '.join(m['id'] for m in mailboxes)}")

    # [2/9] Load existing companies
    print("  [2/9] Cargando datos existentes...")
    full_path = paths["full"]
    if os.path.exists(full_path):
        with open(full_path, "r", encoding="utf-8") as f:
            existing_data = json.load(f)
    else:
        existing_data = {"companies": {}, "employees": []}

    all_companies = existing_data.get("companies", {})
    employees = existing_data.get("employees", [])
    print(f"  -> {len(all_companies)} empresas existentes")

    # [3/9] Load blocklist
    print("  [3/9] Cargando blocklist...")
    blocklist_path = os.path.join(PROJECT_DIR, "src", "data", "blocklist.json")
    blocked_domains = set()
    if os.path.exists(blocklist_path):
        with open(blocklist_path, "r", encoding="utf-8") as f:
            blocked_domains = set(json.load(f).get("domains", []))
    print(f"  -> {len(blocked_domains)} dominios en blocklist")

    # [4/9] Scan each mailbox
    print("  [4/9] Escaneando buzones...")
    state = load_scan_state()
    scan_results = []

    for i, mailbox in enumerate(mailboxes):
        print(f"\n  --- Buzon {i+1}/{len(mailboxes)}: {mailbox['nombre']} ---")
        result = scan_mailbox(mailbox, state, blocked_domains, days_override=args.days)
        scan_results.append(result)
        print(f"    Dominios encontrados: {len(result)}")

        # Update state timestamp for this mailbox
        state[mailbox["email"]] = datetime.now(timezone.utc).isoformat()

    # [5/9] Merge all mailbox results
    print(f"\n  [5/9] Combinando resultados de {len(mailboxes)} buzones...")
    grouped = merge_all_mailboxes(scan_results)
    print(f"  -> {len(grouped)} dominios unicos totales")

    if not grouped:
        print("\n  No hay emails nuevos. Guardando estado y saliendo.")
        save_scan_state(state)
        return False

    # Filter out blocked domains
    grouped = {d: v for d, v in grouped.items() if d not in blocked_domains}
    print(f"  -> {len(grouped)} dominios tras filtrar blocklist")

    # [6/9] Apply to companies
    print("  [6/9] Fusionando con datos existentes...")
    initial_count = len(all_companies)
    new_domain_keys = apply_to_companies(grouped, all_companies)
    updated_count = len(grouped) - len(new_domain_keys)
    print(f"  -> {len(new_domain_keys)} empresas nuevas, {updated_count} actualizadas")

    # [7/9] Classify and enrich new domains
    print("  [7/9] Enriquecimiento IA...")
    classify_and_enrich(all_companies, new_domain_keys, grouped)

    # [8/9] Update employees
    print("  [8/9] Actualizando registro de empleados...")
    emp_ids = {e["id"] for e in employees}
    for mailbox in mailboxes:
        if mailbox["id"] not in emp_ids:
            employees.append({
                "id": mailbox["id"],
                "name": mailbox["nombre"],
                "importedAt": datetime.now().isoformat(),
                "companiesCount": 0,
            })
            emp_ids.add(mailbox["id"])

    # Recount companies per employee
    emp_company_count = defaultdict(int)
    for co in all_companies.values():
        for emp_id in co.get("sources", {}):
            emp_company_count[emp_id] += 1
    for e in employees:
        if e["id"] in emp_company_count:
            e["companiesCount"] = emp_company_count[e["id"]]

    # [9/9] Write output files
    print("  [9/9] Escribiendo archivos...")

    # companies_full.json
    full_data = {"companies": all_companies, "employees": employees}
    with open(paths["full"], "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)

    # companies.json (compact)
    compact = export_to_compact(all_companies)
    with open(paths["compact"], "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

    # employees.json
    with open(paths["employees"], "w", encoding="utf-8") as f:
        json.dump(employees, f, ensure_ascii=False, indent=2)

    # scan_state.json
    save_scan_state(state)

    print()
    print(f"  OK: {len(all_companies)} empresas totales ({len(new_domain_keys)} nuevas)")
    print(f"  OK: Empleados: {', '.join(e['name'] for e in employees)}")
    print(f"  OK: Estado guardado en {SCAN_STATE_FILE}")
    print()

    return True


if __name__ == "__main__":
    had_changes = main()
    sys.exit(0)
