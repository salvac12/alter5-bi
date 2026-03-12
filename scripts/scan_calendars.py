#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI — Calendar Scanner → Prospects Stage Automation
===============================================================

  Reads Google Calendar events for each employee (via Service
  Account with domain delegation) and automatically advances
  BETA-Prospects to "Reunion" stage when a meeting with an
  external attendee matches a prospect's contact domain.

  If the domain doesn't match any existing prospect, a new
  prospect is created in stage "Reunion".

  Uses Gemini AI to generate structured intelligence summaries
  for each prospect (relationship analysis, operation details,
  next steps).

  Variables de entorno requeridas:
    GOOGLE_SERVICE_ACCOUNT_JSON  — JSON de la service account
    AIRTABLE_PAT                 — Personal Access Token
    GEMINI_API_KEY               — Gemini API key (for AI analysis)

  Uso:
    python scripts/scan_calendars.py                    # scan desde last_scan + sync opps + check docs
    python scripts/scan_calendars.py --dry-run          # log sin PATCH
    python scripts/scan_calendars.py --days 7           # override: ultimos 7 dias
    python scripts/scan_calendars.py --check-docs       # solo verificar docs (sin calendar scan)
    python scripts/scan_calendars.py --generate-summaries  # generar AI summaries para prospects sin resumen
    python scripts/scan_calendars.py --sync-opportunities  # importar opportunities como prospects
===============================================================
"""

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CONFIG_DIR = os.path.join(PROJECT_DIR, "config")
MAILBOXES_FILE = os.path.join(CONFIG_DIR, "mailboxes.json")
SCAN_STATE_FILE = os.path.join(CONFIG_DIR, "scan_state.json")
COMPANIES_FULL_FILE = os.path.join(PROJECT_DIR, "src", "data", "companies_full.json")

# ---------------------------------------------------------------------------
# Airtable config
# ---------------------------------------------------------------------------
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT") or os.environ.get("VITE_AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = "appVu3TvSZ1E4tj0J"
PROSPECTS_TABLE = "BETA-Prospects"
PROSPECTS_API = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{urllib.parse.quote(PROSPECTS_TABLE)}"

# Airtable table IDs for documentation verification
STAKEHOLDERS_TABLE_ID = "tbl47AWmhYAXerbWz"
FINANCIALS_TABLE_ID = "tblYiuZOi2VGRXqgA"
OPPORTUNITIES_TABLE_ID = "tblMA730dbXi0Qgqf"
NDA_TABLE_ID = "tbl2igY01yIRU5fEJ"

# SSL context
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
INTERNAL_DOMAINS = {
    "alter-5.com",
    "alter5.com",
}

PERSONAL_DOMAINS = {
    "gmail.com", "hotmail.com", "yahoo.com", "outlook.com",
    "live.com", "icloud.com", "yahoo.es", "hotmail.es",
    "googlemail.com", "protonmail.com", "me.com", "msn.com",
}

# Calendar tool domains to ignore (Google Meet, Zoom, etc.)
TOOL_DOMAINS = {
    "calendar.google.com", "meet.google.com", "zoom.us",
    "teams.microsoft.com", "resource.calendar.google.com",
}

# ── Dominios excluidos (no son clientes potenciales) ──────────────
# Añadir aqui dominios que aparecen en reuniones pero no son prospects
EXCLUDED_DOMAINS = {
    "unir.net",            # Universidad UNIR (practicas)
    "cecamagan.com",       # CECA MAGÁN Abogados (asesor legal de Alter5)
}

# Stages that can be advanced to "Reunion"
ADVANCEABLE_STAGES = {"Lead", "Interesado"}

# Max external domains per event — events with more are likely conferences/webinars
# Real client meetings have 1-2 external orgs, rarely 3
MAX_EXTERNAL_DOMAINS = 3

# Only create new prospects for companies in these CRM groups (enrichment.grp)
# "Capital Seeker" = originacion (developers, IPPs, utilities que buscan deuda/equity)
# Domains not in CRM are also allowed (unknown company with a real meeting)
PROSPECT_ELIGIBLE_GROUPS = {"Capital Seeker"}

# Gemini config for smart CRM filter (analyzes email context)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"

# Map mailbox email -> Airtable "Deal Manager" singleSelect name
MAILBOX_TO_MANAGER = {
    "salvador.carrillo@alter-5.com": "Salvador Carrillo",
    "leticia.menendez@alter-5.com": "Leticia Menendez",
    "javier.ruiz@alter-5.com": "Javier Ruiz",
    "miguel.solana@alter-5.com": "Miguel Solana",
    "carlos.almodovar@alter-5.com": "Carlos Almodovar",
    "gonzalo.degracia@alter-5.com": "Gonzalo de Gracia",
    "rafael.nevado@alter-5.com": "Rafael Nevado",
}

# Opportunity stage -> Prospect stage mapping
OPPORTUNITY_STAGE_MAP = {
    "New": "Lead",
    "Origination - Preparation & NDA": "Documentacion Pendiente",
    "Origination - Financial Analysis": "Documentacion Pendiente",
    "Origination - Termsheet": "Listo para Term-Sheet",
}

# Opportunity business type -> Prospect Product mapping
BUSINESS_TYPE_TO_PRODUCT = {
    "Project Finance": "Project Finance",
    "Corporate Debt": "Corporate Debt",
    "Development Debt": "Development Debt",
    "PF Guaranteed": "PF Guaranteed",
    "Investment": "Investment",
    "Co-Development": "Co-Development",
    "M&A": "M&A",
}


# ---------------------------------------------------------------------------
# Google Calendar helpers
# ---------------------------------------------------------------------------
def get_calendar_service(email):
    """Build Calendar API service using Service Account with domain delegation."""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not sa_json:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON env var not set")

    sa_info = json.loads(sa_json)
    credentials = service_account.Credentials.from_service_account_info(
        sa_info,
        scopes=["https://www.googleapis.com/auth/calendar.readonly"],
    )
    delegated = credentials.with_subject(email)
    return build("calendar", "v3", credentials=delegated, cache_discovery=False)


def fetch_events(service, email, time_min, time_max):
    """Fetch calendar events in the given time range. Returns list of event dicts."""
    events = []
    page_token = None

    while True:
        kwargs = {
            "calendarId": "primary",
            "timeMin": time_min,
            "timeMax": time_max,
            "singleEvents": True,
            "orderBy": "startTime",
            "maxResults": 250,
        }
        if page_token:
            kwargs["pageToken"] = page_token

        result = service.events().list(**kwargs).execute()
        events.extend(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break

    return events


def extract_external_domains(event):
    """Extract external (non-internal, non-personal) domains from event attendees."""
    domains = set()
    for att in event.get("attendees", []):
        email = att.get("email", "")
        if "@" not in email:
            continue
        domain = email.split("@")[1].lower()
        if domain in INTERNAL_DOMAINS or domain in PERSONAL_DOMAINS or domain in TOOL_DOMAINS or domain in EXCLUDED_DOMAINS:
            continue
        domains.add(domain)
    return domains


def extract_external_attendees(event):
    """Extract external attendees grouped by domain.

    Returns: dict[domain] -> list of {name, email, domain}
    """
    by_domain = {}
    for att in event.get("attendees", []):
        email = (att.get("email") or "").strip().lower()
        if "@" not in email:
            continue
        domain = email.split("@")[1]
        if domain in INTERNAL_DOMAINS or domain in PERSONAL_DOMAINS or domain in TOOL_DOMAINS or domain in EXCLUDED_DOMAINS:
            continue
        display = (att.get("displayName") or "").strip()
        # If displayName is just the email, try to build name from email local part
        if not display or display.lower() == email:
            local = email.split("@")[0]
            # Convert "juan.garcia" or "jgarcia" → "Juan Garcia" / "Jgarcia"
            display = " ".join(p.capitalize() for p in local.replace(".", " ").replace("_", " ").split())
        by_domain.setdefault(domain, []).append({
            "name": display,
            "email": email,
            "domain": domain,
        })
    return by_domain


def event_has_ended(event, now):
    """Check if an event has already ended."""
    end = event.get("end", {})
    end_str = end.get("dateTime") or end.get("date")
    if not end_str:
        return False
    # All-day events: date format "2026-03-11"
    if "T" not in end_str:
        end_dt = datetime.strptime(end_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    else:
        end_dt = datetime.fromisoformat(end_str)
    return end_dt <= now


# ---------------------------------------------------------------------------
# Airtable helpers
# ---------------------------------------------------------------------------
def airtable_headers():
    return {
        "Authorization": f"Bearer {AIRTABLE_PAT}",
        "Content-Type": "application/json",
    }


def airtable_request(url, method="GET", data=None):
    """Make an Airtable API request."""
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method=method, headers=airtable_headers())
    try:
        with urllib.request.urlopen(req, context=SSL_CTX) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if e.fp else ""
        print(f"  ERROR: Airtable {method} {e.code}: {err_body}")
        return None


def fetch_all_prospects():
    """Fetch all active prospects from BETA-Prospects."""
    all_records = []
    offset = None
    formula = urllib.parse.quote('{Record Status}="Active"')

    while True:
        url = f"{PROSPECTS_API}?filterByFormula={formula}"
        if offset:
            url += f"&offset={offset}"
        data = airtable_request(url)
        if not data:
            break
        all_records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break

    return all_records


def build_domain_index(prospects):
    """Build a dict: domain -> list of prospect records.

    Extracts domains from:
    - "Contact Email" field (single email)
    - "Contacts" field (JSON array of {name, email, role})
    """
    index = {}
    for rec in prospects:
        f = rec.get("fields", {})
        domains = set()

        # Contact Email
        contact_email = f.get("Contact Email", "")
        if contact_email and "@" in contact_email:
            domains.add(contact_email.split("@")[1].lower())

        # Contacts JSON
        contacts_raw = f.get("Contacts", "")
        if contacts_raw:
            try:
                contacts = json.loads(contacts_raw)
                for c in contacts:
                    email = c.get("email", "")
                    if email and "@" in email:
                        domains.add(email.split("@")[1].lower())
            except (json.JSONDecodeError, TypeError):
                pass

        for d in domains:
            index.setdefault(d, []).append(rec)

    return index


def build_name_index(prospects):
    """Build a dict: normalized_name -> prospect record for dedup checks."""
    index = {}
    for rec in prospects:
        f = rec.get("fields", {})
        name = (f.get("Prospect Name") or "").strip().lower().replace(" ", "")
        if name:
            index[name] = rec
    return index


def patch_prospect_stage(record_id, dry_run=False):
    """PATCH a prospect's Stage to 'Reunion'."""
    if dry_run:
        return True
    url = f"{PROSPECTS_API}/{record_id}"
    result = airtable_request(url, method="PATCH", data={"fields": {"Stage": "Reunion"}})
    return result is not None


def patch_prospect_fields(record_id, fields, dry_run=False):
    """PATCH arbitrary fields on a prospect record."""
    if dry_run:
        return True
    url = f"{PROSPECTS_API}/{record_id}"
    result = airtable_request(url, method="PATCH", data={"fields": fields})
    return result is not None


def merge_contacts_to_prospect(prospect, new_attendees, dry_run=False):
    """Merge new attendees into an existing prospect's Contacts field.

    new_attendees: list of {name, email, domain}
    Returns number of contacts added.
    """
    pf = prospect.get("fields", {})

    # Parse existing contacts
    existing = []
    try:
        existing = json.loads(pf.get("Contacts") or "[]")
    except (json.JSONDecodeError, TypeError):
        pass
    if not isinstance(existing, list):
        existing = []

    # Also include Contact Email if not in existing
    legacy_email = (pf.get("Contact Email") or "").strip().lower()
    existing_emails = {(c.get("email") or "").strip().lower() for c in existing}
    if legacy_email and legacy_email not in existing_emails:
        existing.append({"name": "", "email": legacy_email, "role": ""})
        existing_emails.add(legacy_email)

    # Add new attendees that don't already exist
    added = 0
    for att in new_attendees:
        email_lower = att["email"].lower()
        if email_lower not in existing_emails:
            existing.append({
                "name": att["name"],
                "email": att["email"],
                "role": "",  # role unknown from calendar
            })
            existing_emails.add(email_lower)
            added += 1

    if added == 0:
        return 0

    if dry_run:
        return added

    # PATCH the prospect
    url = f"{PROSPECTS_API}/{prospect['id']}"
    fields = {"Contacts": json.dumps(existing, ensure_ascii=False)}
    # Update Contact Email to first contact if not set
    if not legacy_email and existing:
        fields["Contact Email"] = existing[0].get("email", "")
    airtable_request(url, method="PATCH", data={"fields": fields})

    # Update in-memory
    pf["Contacts"] = json.dumps(existing, ensure_ascii=False)
    return added


def create_prospect_from_meeting(domain, employee_email, event_summary,
                                  company_name=None, attendees=None,
                                  ai_result=None, dry_run=False):
    """Create a new prospect in stage 'Reunion' from a calendar meeting.

    attendees: list of {name, email, domain} for this domain's attendees.
    ai_result: dict from analyze_prospect_intelligence() with summary and next steps.
    """
    manager = MAILBOX_TO_MANAGER.get(employee_email, "")
    name = company_name or domain.split(".")[0].capitalize()
    if event_summary:
        context = f"Reunion detectada automaticamente desde calendario: {event_summary}"
    else:
        context = "Reunion detectada automaticamente desde calendario"

    # Build contacts from attendees
    contacts = []
    if attendees:
        for att in attendees:
            contacts.append({
                "name": att.get("name", ""),
                "email": att.get("email", ""),
                "role": "",
            })

    fields = {
        "Prospect Name": name,
        "Stage": "Reunion",
        "Origin": "Evento",
        "Context": context,
        "Record Status": "Active",
    }
    if manager:
        fields["Deal Manager"] = manager
    if contacts:
        fields["Contacts"] = json.dumps(contacts, ensure_ascii=False)
        fields["Contact Email"] = contacts[0]["email"]

    # Add AI-generated intelligence
    if ai_result:
        summary = ai_result.get("summary", "")
        if summary:
            fields["AI Summary"] = summary
        steps = ai_result.get("suggested_next_steps", [])
        if steps:
            fields["Next Steps"] = "\n".join(f"• {s}" for s in steps)

    if dry_run:
        return True

    result = airtable_request(PROSPECTS_API, method="POST", data={"fields": fields})
    return result is not None


# ---------------------------------------------------------------------------
# Documentation verification — check Airtable for uploaded docs
# ---------------------------------------------------------------------------

def fetch_all_records(table_id):
    """Fetch all records from an Airtable table (with pagination)."""
    records = []
    offset = None
    base_url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{table_id}"
    while True:
        url = base_url + (f"?offset={offset}" if offset else "")
        data = airtable_request(url)
        if not data:
            break
        records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
    return records


def load_airtable_docs_index():
    """Load Stakeholders, Financials, Opportunities, NDAs and build lookup indexes.

    Returns a dict with:
      companies_by_name: {lowercase_name: record}
      companies_by_id: {record_id: record}
      financials_by_company: {company_record_id: [records]}
      opportunities_by_company: {company_record_id: [records]}
      ndas_by_id: {record_id: record}
    """
    print("Loading Airtable documentation tables...")

    # Stakeholders_Companies
    companies = fetch_all_records(STAKEHOLDERS_TABLE_ID)
    companies_by_name = {}
    companies_by_id = {}
    for r in companies:
        f = r.get("fields", {})
        name = (f.get("Company Name") or "").strip().lower()
        if name:
            companies_by_name[name] = r
        companies_by_id[r["id"]] = r
    print(f"  Stakeholders: {len(companies)} companies")

    # Financials
    financials = fetch_all_records(FINANCIALS_TABLE_ID)
    financials_by_company = {}
    for r in financials:
        f = r.get("fields", {})
        company_links = f.get("Company", [])
        for cid in (company_links if isinstance(company_links, list) else []):
            financials_by_company.setdefault(cid, []).append(r)
    print(f"  Financials: {len(financials)} records")

    # Opportunities
    opportunities = fetch_all_records(OPPORTUNITIES_TABLE_ID)
    opportunities_by_company = {}
    for r in opportunities:
        f = r.get("fields", {})
        if f.get("Record Status") != "Active":
            continue
        seekers = f.get("Company Seeking Capital", [])
        for cid in (seekers if isinstance(seekers, list) else []):
            opportunities_by_company.setdefault(cid, []).append(r)
    print(f"  Opportunities: {len(opportunities)} records")

    return {
        "companies_by_name": companies_by_name,
        "companies_by_id": companies_by_id,
        "financials_by_company": financials_by_company,
        "opportunities_by_company": opportunities_by_company,
    }


def check_documentation_level(prospect, docs_index):
    """Check Airtable documentation for a prospect.

    Returns: ("full", details) | ("partial", details) | ("none", details)
    """
    pf = prospect.get("fields", {})
    prospect_name = (pf.get("Prospect Name") or "").strip().lower()

    # Find matching company in Stakeholders
    company = docs_index["companies_by_name"].get(prospect_name)

    # Also try matching by contact email domain
    if not company:
        contact_email = pf.get("Contact Email", "")
        if contact_email and "@" in contact_email:
            domain = contact_email.split("@")[1].lower().split(".")[0]
            for name, rec in docs_index["companies_by_name"].items():
                if domain in name or name in domain:
                    company = rec
                    break

    # Also try partial name match
    if not company and len(prospect_name) >= 4:
        for name, rec in docs_index["companies_by_name"].items():
            if prospect_name in name or name in prospect_name:
                company = rec
                break

    if not company:
        return "none", {"reason": "Company not found in Stakeholders"}

    cf = company.get("fields", {})
    company_id = company["id"]
    company_name = cf.get("Company Name", "?")
    checks = {}

    # Check 1: NDA
    nda_links = cf.get("Link: NDA", [])
    nda_statuses = cf.get("NDA Status (from Link: NDA)", [])
    has_nda = bool(nda_links) and any(
        s in ("Active", "Signed") for s in (nda_statuses if isinstance(nda_statuses, list) else [])
    )
    checks["nda"] = has_nda

    # Check 2: Company basic info (Legal Name + Tax ID)
    has_legal = bool(cf.get("Company Legal Name"))
    has_tax = bool(cf.get("Tax ID"))
    checks["company_info"] = has_legal and has_tax

    # Check 3: Financials
    fin_records = docs_index["financials_by_company"].get(company_id, [])
    has_financials = len(fin_records) > 0
    checks["financials"] = has_financials

    # Check 4: Opportunity with attachments or documentation folder
    opp_records = docs_index["opportunities_by_company"].get(company_id, [])
    has_opportunity = False
    has_opp_docs = False
    for opp in opp_records:
        of = opp.get("fields", {})
        has_opportunity = True
        attachments = of.get("Attachments", [])
        doc_folder = of.get("Documentation Folder LInk", "")
        if attachments or doc_folder:
            has_opp_docs = True
            break
    checks["opportunity"] = has_opportunity
    checks["opp_docs"] = has_opp_docs

    # Determine level
    all_complete = has_nda and checks["company_info"] and has_financials and has_opp_docs
    has_something = has_nda or checks["company_info"] or has_financials or has_opportunity

    detail = {
        "company": company_name,
        "nda": has_nda,
        "company_info": checks["company_info"],
        "financials": has_financials,
        "opportunity": has_opportunity,
        "opp_docs": has_opp_docs,
    }

    if all_complete:
        return "full", detail
    elif has_something:
        return "partial", detail
    else:
        return "none", detail


def compute_stage_from_docs(doc_level, current_stage):
    """Determine what stage a prospect should be based on documentation level.

    Rules:
      - "full" docs → "Listo para Term-Sheet"
      - "partial" docs → "Documentacion Pendiente" (min)
      - "none" docs → max "Reunion"
    Never downgrades past certain thresholds (e.g. won't go from Reunion to Lead).
    """
    STAGE_ORDER = {
        "Lead": 0,
        "Interesado": 1,
        "Reunion": 2,
        "Documentacion Pendiente": 3,
        "Listo para Term-Sheet": 4,
    }
    current_idx = STAGE_ORDER.get(current_stage, 0)

    if doc_level == "full":
        return "Listo para Term-Sheet"
    elif doc_level == "partial":
        # Downgrade from Term-Sheet if docs aren't full
        if current_idx > STAGE_ORDER["Documentacion Pendiente"]:
            return "Documentacion Pendiente"
        # Advance from Reunion to Doc Pendiente (had meeting + has some docs)
        if current_idx == STAGE_ORDER["Reunion"]:
            return "Documentacion Pendiente"
        # Don't advance Lead/Interesado just because docs exist (no meeting yet)
        return current_stage
    else:
        # No docs — cap at Reunion
        if current_idx > STAGE_ORDER["Reunion"]:
            return "Reunion"  # downgrade: was past Reunion without any docs
        return current_stage


def review_all_prospect_stages(prospects, docs_index, dry_run=False):
    """Review all prospects and adjust stages based on actual documentation."""
    print(f"\n{'='*50}")
    print("Reviewing prospect stages vs documentation...")
    adjusted = 0

    for prospect in prospects:
        pf = prospect.get("fields", {})
        name = pf.get("Prospect Name", "?")
        current_stage = pf.get("Stage", "Lead")

        doc_level, detail = check_documentation_level(prospect, docs_index)
        correct_stage = compute_stage_from_docs(doc_level, current_stage)

        if correct_stage != current_stage:
            prefix = "[DRY-RUN] " if dry_run else ""
            checks_str = " ".join(
                f"{'✓' if v else '✗'}{k}" for k, v in detail.items() if k != "company"
            )
            print(f"  {prefix}⇄ {name}: {current_stage} → {correct_stage} (docs={doc_level}, {checks_str})")

            if not dry_run:
                url = f"{PROSPECTS_API}/{prospect['id']}"
                airtable_request(url, method="PATCH", data={"fields": {"Stage": correct_stage}})
            adjusted += 1

    print(f"  Stages adjusted: {adjusted}")
    if dry_run:
        print("  (DRY RUN — no changes made)")
    return adjusted


# ---------------------------------------------------------------------------
# Gemini AI — prospect intelligence analysis
# ---------------------------------------------------------------------------
_gemini_cache = {}  # domain -> dict result (avoid re-asking for same domain across employees)


def analyze_prospect_intelligence(domain, crm_entry, event_summary):
    """Analyze a company's relationship with Alter5 using Gemini AI.

    Sends CRM context, enrichment data, email history, and meeting info to Gemini
    to generate a structured intelligence summary.

    Returns a dict with keys:
      - is_prospect (bool): whether this is a real prospect
      - summary (str): structured analysis in Spanish
      - suggested_next_steps (list[str]): concrete action items

    Returns None if Gemini is unavailable or on error.
    Results are cached by domain within a single run.
    """
    if domain in _gemini_cache:
        return _gemini_cache[domain]

    if not GEMINI_API_KEY:
        return None

    company_name = crm_entry.get("name", domain)
    context = crm_entry.get("context", "")
    enrichment = crm_entry.get("enrichment", {})
    grp = enrichment.get("grp", "")
    tp = enrichment.get("tp", "")
    role = enrichment.get("role", "")
    segment = enrichment.get("segment", "")
    technologies = enrichment.get("technologies", "")

    # Collect recent dated_subjects (30 entries with date + subject + extract)
    dated_subjects = crm_entry.get("dated_subjects", [])
    subjects = []
    for ds in dated_subjects[-30:]:
        if isinstance(ds, list) and len(ds) >= 3:
            subjects.append(f"[{ds[0]}] {ds[1]} — {ds[2]}")
        elif isinstance(ds, list) and len(ds) >= 2:
            subjects.append(f"[{ds[0]}] {ds[1]}")
        elif isinstance(ds, str):
            subjects.append(ds)
    if not subjects:
        subjects = crm_entry.get("subjects", [])[-30:]

    subjects_text = "\n".join(subjects) if subjects else "(sin emails)"

    # Per-employee breakdown
    employees = crm_entry.get("employees", {})
    employee_lines = []
    for emp_name, emp_data in employees.items():
        count = emp_data if isinstance(emp_data, int) else emp_data.get("count", 0)
        employee_lines.append(f"  - {emp_name}: {count} emails")
    employee_text = "\n".join(employee_lines) if employee_lines else "(sin desglose)"

    # Event attendees info
    attendees_text = ""
    if isinstance(event_summary, dict):
        # If event_summary is actually a full event object with attendees
        attendees_text = f"\nAsistentes: {event_summary.get('attendees', '')}"
        event_summary = event_summary.get("summary", "(sin titulo)")

    prompt = f"""Alter5 es una empresa de financiacion de energias renovables (deuda y equity para proyectos solares, eolicos, BESS, etc.)

Analiza la relacion con "{company_name}" ({domain}):

IMPORTANTE sobre intermediarios:
- Si la empresa es un ASESOR o INTERMEDIARIO (advisory, consulting, legal) que presenta deals de TERCEROS, identifica quien es el beneficiario final del proyecto y que busca.
- Ejemplo: JQ Advisors es intermediario, el cliente real es Grupo Visalia que busca financiacion merchant.
- Ejemplo: Q-Impact es un fondo, pero presenta una participada (Green Home Finance) que necesita un tramo junior.

Genera un resumen estructurado en espanol:
1. EMPRESA: Que hace y su relacion con Alter5
2. OPERACION: Que buscan exactamente (tipo de financiacion, proyecto, importe si se menciona)
3. BENEFICIARIO FINAL: Si es intermediario, quien es el destinatario real del proyecto
4. ESTADO: Donde esta la relacion ahora (primeros contactos, en analisis, docs enviadas, etc.)
5. PROXIMOS PASOS: 2-3 acciones concretas que deberia tomar el equipo

Si la empresa NO es un prospect real (no busca financiacion, solo presta servicios sin deal concreto, es un banco ofreciendo capital, networking puro), indica claramente "POSIBLE FALSO POSITIVO" al inicio y explica por que.

Datos CRM:
  Grupo: {grp}, Tipo: {tp}, Rol: {role}, Segmento: {segment}, Tecnologias: {technologies}
  Contexto: {context}

Desglose por empleado:
{employee_text}

Emails recientes (ultimos 30):
{subjects_text}

Reunion reciente: {event_summary}{attendees_text}

Responde SOLO con JSON:
{{"is_prospect": true/false, "summary": "resumen estructurado completo", "suggested_next_steps": ["paso 1", "paso 2", "paso 3"]}}"""

    try:
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1},
        }).encode("utf-8")

        req = urllib.request.Request(
            api_url, data=payload, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        text = ""
        for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
            if "text" in part:
                text += part["text"]
        text = text.strip()

        # Clean markdown fences
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text.rsplit("```", 1)[0]
            text = text.strip()

        result = json.loads(text)
        is_prospect = result.get("is_prospect", False)
        summary = result.get("summary", "")
        steps = result.get("suggested_next_steps", [])

        _gemini_cache[domain] = result
        preview = summary[:80] + "..." if len(summary) > 80 else summary
        print(f"    Gemini: {'PROSPECT' if is_prospect else 'NO'} — {preview}")
        return result

    except Exception as e:
        print(f"    Gemini error: {e}")
        _gemini_cache[domain] = {"is_prospect": False, "summary": "", "suggested_next_steps": []}
        return None


# ---------------------------------------------------------------------------
# Sync Opportunities → Prospects
# ---------------------------------------------------------------------------
def fetch_all_opportunities():
    """Fetch active Transaction opportunities from the Opportunities table."""
    all_records = []
    offset = None
    formula = urllib.parse.quote(
        'AND({Type of opportunity} = "Transaction", {Record Status} = "Active", {Global Status} != "Stand-by")'
    )
    base_url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{OPPORTUNITIES_TABLE_ID}"

    while True:
        url = f"{base_url}?filterByFormula={formula}"
        if offset:
            url += f"&offset={offset}"
        data = airtable_request(url)
        if not data:
            break
        all_records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break

    return all_records


def sync_opportunities_to_prospects(prospects, dry_run=False):
    """Import early-stage Opportunities as Prospects.

    Fetches all active Transactions, filters to early stages, and creates
    prospect records for any that don't already exist.
    """
    print(f"\n{'='*50}")
    print("Syncing Opportunities → Prospects...")

    # Fetch opportunities
    opportunities = fetch_all_opportunities()
    print(f"  {len(opportunities)} active transactions found")

    # Build name index from existing prospects for dedup
    name_index = build_name_index(prospects)

    created = 0
    skipped = 0

    for opp in opportunities:
        f = opp.get("fields", {})
        opp_name = (f.get("Opportunity Name") or f.get("Name") or "").strip()
        stage = f.get("Global Status", "")

        # Only sync early-stage opportunities
        if stage not in OPPORTUNITY_STAGE_MAP:
            continue

        prospect_stage = OPPORTUNITY_STAGE_MAP[stage]

        # Check if already exists as prospect (by normalized name)
        normalized = opp_name.lower().replace(" ", "")
        if normalized in name_index:
            skipped += 1
            continue

        # Map fields
        amount = f.get("Targeted Ticket Size") or f.get("Amount") or 0
        if isinstance(amount, str):
            amount = float(amount.replace(",", "").replace(".", "")) if amount else 0
        currency = f.get("Currency", "EUR")
        if isinstance(currency, list):
            currency = "EUR"

        # Business type -> Product
        business_type = f.get("Type (from Business Program)", "")
        if isinstance(business_type, list):
            business_type = business_type[0] if business_type else ""
        product = BUSINESS_TYPE_TO_PRODUCT.get(business_type, "")

        # Deal Manager
        deal_manager = f.get("Deal Manager") or f.get("Responsible") or f.get("Assigned To") or ""

        # Context from opportunity notes
        notes = f.get("Notes") or f.get("Description") or ""
        context = f"Importado desde Pipeline (Opportunity). Stage original: {stage}"
        if notes:
            context += f"\n{notes[:500]}"

        fields = {
            "Prospect Name": opp_name,
            "Stage": prospect_stage,
            "Origin": "Pipeline",
            "Record Status": "Active",
            "Context": context,
        }
        if amount:
            fields["Amount"] = amount
        if currency and currency != "EUR":
            fields["Currency"] = currency
        if product:
            fields["Product"] = product
        if deal_manager:
            fields["Deal Manager"] = str(deal_manager)

        prefix = "[DRY-RUN] " if dry_run else ""
        print(f"  {prefix}+ {opp_name} ({stage} → {prospect_stage})")

        if not dry_run:
            result = airtable_request(PROSPECTS_API, method="POST", data={"fields": fields})
            if result:
                created += 1
                # Add to name index to prevent duplicates within this run
                name_index[normalized] = result
        else:
            created += 1

    print(f"  Opportunities synced: {created} created, {skipped} already exist")
    if dry_run:
        print("  (DRY RUN — no changes made)")
    return created


# ---------------------------------------------------------------------------
# Generate AI summaries for existing prospects
# ---------------------------------------------------------------------------
def generate_summaries_for_prospects(prospects, crm_companies, dry_run=False):
    """Iterate all prospects without AI Summary, generate intelligence, PATCH to Airtable."""
    print(f"\n{'='*50}")
    print("Generating AI summaries for prospects without one...")

    if not GEMINI_API_KEY:
        print("  ERROR: GEMINI_API_KEY not set, cannot generate summaries")
        return 0

    updated = 0
    skipped = 0

    for prospect in prospects:
        pf = prospect.get("fields", {})
        name = pf.get("Prospect Name", "?")
        existing_summary = pf.get("AI Summary", "")

        if existing_summary:
            skipped += 1
            continue

        # Try to find CRM entry by contact email domain or prospect name
        domain = None
        contact_email = pf.get("Contact Email", "")
        if contact_email and "@" in contact_email:
            domain = contact_email.split("@")[1].lower()

        # Also try from Contacts JSON
        if not domain:
            contacts_raw = pf.get("Contacts", "")
            if contacts_raw:
                try:
                    contacts = json.loads(contacts_raw)
                    for c in contacts:
                        email = c.get("email", "")
                        if email and "@" in email:
                            d = email.split("@")[1].lower()
                            if d not in INTERNAL_DOMAINS and d not in PERSONAL_DOMAINS:
                                domain = d
                                break
                except (json.JSONDecodeError, TypeError):
                    pass

        crm_entry = crm_companies.get(domain, {}) if domain else {}

        # If no CRM entry, build a minimal one from prospect fields
        if not crm_entry:
            crm_entry = {
                "name": name,
                "context": pf.get("Context", ""),
                "enrichment": {},
                "dated_subjects": [],
                "employees": {},
            }

        event_summary = pf.get("Context", "")[:200]

        print(f"  Analyzing: {name} ({domain or 'no domain'})...")
        ai_result = analyze_prospect_intelligence(domain or name, crm_entry, event_summary)

        if ai_result:
            patch_fields = {}
            summary = ai_result.get("summary", "")
            if summary:
                patch_fields["AI Summary"] = summary
            steps = ai_result.get("suggested_next_steps", [])
            if steps:
                patch_fields["Next Steps"] = "\n".join(f"• {s}" for s in steps)

            if patch_fields:
                prefix = "[DRY-RUN] " if dry_run else ""
                print(f"  {prefix}  Updated AI Summary for {name}")
                patch_prospect_fields(prospect["id"], patch_fields, dry_run=dry_run)
                updated += 1

        # Rate limit: 1 second between Gemini calls
        time.sleep(1)

    print(f"  Summaries generated: {updated}, already had summary: {skipped}")
    if dry_run:
        print("  (DRY RUN — no changes made)")
    return updated


# ---------------------------------------------------------------------------
# Scan state
# ---------------------------------------------------------------------------
def load_scan_state():
    if os.path.exists(SCAN_STATE_FILE):
        with open(SCAN_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_scan_state(state):
    with open(SCAN_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Scan Google Calendars → advance Prospects")
    parser.add_argument("--dry-run", action="store_true", help="Log matches without patching Airtable")
    parser.add_argument("--days", type=int, default=None, help="Override: scan last N days instead of since last_scan")
    parser.add_argument("--check-docs", action="store_true", help="Review all prospect stages vs actual Airtable documentation")
    parser.add_argument("--generate-summaries", action="store_true", help="Generate AI summaries for prospects without one")
    parser.add_argument("--sync-opportunities", action="store_true", help="Import early-stage Opportunities as Prospects")
    args = parser.parse_args()

    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT env var not set")
        sys.exit(1)

    # Load CRM companies for classification filtering
    crm_companies = {}
    if os.path.exists(COMPANIES_FULL_FILE):
        with open(COMPANIES_FULL_FILE, "r", encoding="utf-8") as f:
            crm_companies = json.load(f).get("companies", {})
        print(f"CRM loaded: {len(crm_companies)} companies")
    else:
        print("WARNING: companies_full.json not found — CRM filter disabled")

    # Fetch all prospects and build domain index
    print("Fetching prospects from Airtable...")
    prospects = fetch_all_prospects()
    print(f"  {len(prospects)} active prospects loaded")
    domain_index = build_domain_index(prospects)
    print(f"  {len(domain_index)} unique contact domains indexed")

    # --- Standalone modes ---
    if args.generate_summaries:
        generate_summaries_for_prospects(prospects, crm_companies, dry_run=args.dry_run)
        return

    if args.sync_opportunities:
        sync_opportunities_to_prospects(prospects, dry_run=args.dry_run)
        return

    if args.check_docs:
        docs_index = load_airtable_docs_index()
        review_all_prospect_stages(prospects, docs_index, dry_run=args.dry_run)
        return

    # --- Normal calendar scan flow ---
    # Load mailboxes
    with open(MAILBOXES_FILE, "r", encoding="utf-8") as f:
        mailboxes = json.load(f)["mailboxes"]
    active_mailboxes = [m for m in mailboxes if m.get("activo", True)]

    # Load scan state
    state = load_scan_state()

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    total_events = 0
    total_advanced = 0
    total_created = 0
    total_skipped = 0
    total_filtered_crm = 0
    total_contacts_added = 0

    for mb in active_mailboxes:
        email = mb["email"]
        nombre = mb["nombre"]
        print(f"\n--- {nombre} ({email}) ---")

        # Determine time range
        if args.days:
            time_min = (now - timedelta(days=args.days)).isoformat()
        else:
            # Use calendar_last_scan from state, or default to 7 days
            mb_state = state.get(email)
            if isinstance(mb_state, dict):
                last_scan = mb_state.get("calendar_last_scan")
            elif isinstance(mb_state, str):
                # Old format: just a timestamp string (for email scan)
                last_scan = None
            else:
                last_scan = None

            if last_scan:
                time_min = last_scan
            else:
                time_min = (now - timedelta(days=7)).isoformat()

        print(f"  Scanning events from {time_min[:19]} to {now_iso[:19]}")

        try:
            service = get_calendar_service(email)
            events = fetch_events(service, email, time_min, now_iso)
        except Exception as e:
            print(f"  ERROR fetching calendar: {e}")
            continue

        print(f"  {len(events)} events found")

        for event in events:
            # Skip cancelled events
            if event.get("status") == "cancelled":
                continue

            # Only count events that have already ended
            if not event_has_ended(event, now):
                continue

            total_events += 1
            ext_domains = extract_external_domains(event)
            if not ext_domains:
                continue

            # Also extract full attendee info (name + email) grouped by domain
            attendees_by_domain = extract_external_attendees(event)

            summary = event.get("summary", "(sin titulo)")

            # Filter: skip events with too many external domains (conferences/webinars)
            if len(ext_domains) > MAX_EXTERNAL_DOMAINS:
                print(f"  ⊘ Skipped '{summary}' — {len(ext_domains)} external domains (likely conference)")
                total_skipped += 1
                continue

            # Collect ALL external attendees from this event (for merging into prospects)
            all_event_attendees = []
            for atts in attendees_by_domain.values():
                all_event_attendees.extend(atts)

            # Check which domains match existing prospects
            has_known_prospect = any(domain_index.get(d) for d in ext_domains)

            for domain in ext_domains:
                matching = domain_index.get(domain, [])
                domain_attendees = attendees_by_domain.get(domain, [])

                if matching:
                    # Domain matches an existing prospect — advance if eligible
                    for prospect in matching:
                        pf = prospect.get("fields", {})
                        stage = pf.get("Stage", "")
                        pname = pf.get("Prospect Name", "?")

                        if stage in ADVANCEABLE_STAGES:
                            prefix = "[DRY-RUN] " if args.dry_run else ""
                            print(f"  {prefix}↑ {pname} ({stage} → Reunion) — {summary}")
                            ok = patch_prospect_stage(prospect["id"], dry_run=args.dry_run)
                            if ok:
                                total_advanced += 1
                                pf["Stage"] = "Reunion"

                            # Generate AI summary for newly advanced prospects if missing
                            if not pf.get("AI Summary"):
                                crm_entry = crm_companies.get(domain, {})
                                if crm_entry:
                                    ai_result = analyze_prospect_intelligence(
                                        domain, crm_entry, summary,
                                    )
                                    if ai_result and prospect.get("id") != "new":
                                        patch_fields = {}
                                        ai_summary = ai_result.get("summary", "")
                                        if ai_summary:
                                            patch_fields["AI Summary"] = ai_summary
                                        steps = ai_result.get("suggested_next_steps", [])
                                        if steps:
                                            patch_fields["Next Steps"] = "\n".join(f"• {s}" for s in steps)
                                        if patch_fields:
                                            patch_prospect_fields(
                                                prospect["id"], patch_fields,
                                                dry_run=args.dry_run,
                                            )
                                            prefix2 = "[DRY-RUN] " if args.dry_run else ""
                                            print(f"  {prefix2}  + AI Summary added to {pname}")
                        else:
                            print(f"  · {pname} already at {stage}, skipping")

                        # Merge ALL event attendees into prospect contacts
                        # (includes advisors, co-attendees from other orgs)
                        if all_event_attendees and prospect.get("id") != "new":
                            added = merge_contacts_to_prospect(
                                prospect, all_event_attendees, dry_run=args.dry_run,
                            )
                            if added:
                                prefix = "[DRY-RUN] " if args.dry_run else ""
                                names = ", ".join(a["name"] for a in all_event_attendees[:4])
                                print(f"  {prefix}  +{added} contacts → {pname} ({names})")
                                total_contacts_added += added
                else:
                    # Unknown domain — only create prospect if this looks like
                    # a real 1:1 or small meeting (not a multi-org event where
                    # one attendee happens to be a known prospect)
                    if len(ext_domains) > 2 and has_known_prospect:
                        # 3 external orgs but one is known → skip the unknowns
                        continue

                    # Check CRM classification: only create prospects for
                    # originacion companies (Capital Seekers) or unknown domains
                    crm_entry = crm_companies.get(domain)
                    ai_result = None
                    if crm_entry:
                        grp = crm_entry.get("enrichment", {}).get("grp", "")
                        if grp and grp not in PROSPECT_ELIGIBLE_GROUPS:
                            crm_name = crm_entry.get("name", domain)
                            ai_result = analyze_prospect_intelligence(
                                domain, crm_entry, summary,
                            )
                            if not ai_result or not ai_result.get("is_prospect"):
                                print(f"  ⊘ Skipped '{crm_name}' ({domain}) — CRM: {grp}, Gemini: no capital intent")
                                total_filtered_crm += 1
                                continue
                            print(f"  ✓ '{crm_name}' ({domain}) — CRM: {grp}, but Gemini detected capital intent")
                        else:
                            # Capital Seeker — still generate AI intelligence
                            ai_result = analyze_prospect_intelligence(
                                domain, crm_entry, summary,
                            )
                    else:
                        # Unknown domain — generate intelligence with minimal data
                        minimal_entry = {
                            "name": domain.split(".")[0].capitalize(),
                            "context": "",
                            "enrichment": {},
                            "dated_subjects": [],
                            "employees": {},
                        }
                        ai_result = analyze_prospect_intelligence(
                            domain, minimal_entry, summary,
                        )

                    prefix = "[DRY-RUN] " if args.dry_run else ""
                    crm_name = crm_entry.get("name", domain.split(".")[0].capitalize()) if crm_entry else None
                    print(f"  {prefix}+ New prospect from domain '{domain}' — {summary}")
                    ok = create_prospect_from_meeting(
                        domain, email, summary,
                        company_name=crm_name,
                        attendees=domain_attendees,
                        ai_result=ai_result,
                        dry_run=args.dry_run,
                    )
                    if ok:
                        total_created += 1
                        if domain_attendees:
                            names = ", ".join(a["name"] for a in domain_attendees[:3])
                            print(f"  {prefix}  contacts: {names}")
                            total_contacts_added += len(domain_attendees)
                        # Add to index so we don't create duplicates within this run
                        fake_rec = {
                            "id": "new",
                            "fields": {"Prospect Name": domain, "Stage": "Reunion"},
                        }
                        domain_index.setdefault(domain, []).append(fake_rec)

        # Update calendar_last_scan for this employee
        if isinstance(state.get(email), dict):
            state[email]["calendar_last_scan"] = now_iso
        elif isinstance(state.get(email), str):
            # Migrate from old format: preserve email timestamp, add calendar
            state[email] = {
                "last_scan_timestamp": state[email],
                "calendar_last_scan": now_iso,
            }
        else:
            state[email] = {"calendar_last_scan": now_iso}

    # Save scan state
    save_scan_state(state)

    print(f"\n{'='*50}")
    print(f"Calendar scan complete:")
    print(f"  Events processed: {total_events}")
    print(f"  Events skipped (conferences): {total_skipped}")
    print(f"  Domains skipped (not originacion): {total_filtered_crm}")
    print(f"  Prospects advanced to Reunion: {total_advanced}")
    print(f"  New prospects created: {total_created}")
    print(f"  Contacts added/merged: {total_contacts_added}")
    if args.dry_run:
        print("  (DRY RUN — no changes made to Airtable)")

    # --- Sync opportunities before doc check ---
    # Re-fetch prospects to include newly created ones
    if total_advanced > 0 or total_created > 0:
        print("\nRe-fetching prospects after calendar updates...")
        prospects = fetch_all_prospects()

    sync_opportunities_to_prospects(prospects, dry_run=args.dry_run)

    # Re-fetch again after opportunity sync
    prospects = fetch_all_prospects()

    # --- Documentation verification pass ---
    # Always run after calendar scan
    docs_index = load_airtable_docs_index()
    review_all_prospect_stages(prospects, docs_index, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
