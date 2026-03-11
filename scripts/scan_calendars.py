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

  Variables de entorno requeridas:
    GOOGLE_SERVICE_ACCOUNT_JSON  — JSON de la service account
    AIRTABLE_PAT                 — Personal Access Token

  Uso:
    python scripts/scan_calendars.py              # scan desde last_scan
    python scripts/scan_calendars.py --dry-run    # log sin PATCH
    python scripts/scan_calendars.py --days 7     # override: ultimos 7 dias
===============================================================
"""

import argparse
import json
import os
import ssl
import sys
import urllib.error
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

# ---------------------------------------------------------------------------
# Airtable config
# ---------------------------------------------------------------------------
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT") or os.environ.get("VITE_AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = "appVu3TvSZ1E4tj0J"
PROSPECTS_TABLE = "BETA-Prospects"
PROSPECTS_API = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{urllib.parse.quote(PROSPECTS_TABLE)}"

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
import urllib.parse

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

# Stages that can be advanced to "Reunion"
ADVANCEABLE_STAGES = {"Lead", "Interesado"}

# Max external domains per event — events with more are likely conferences/webinars
# Real client meetings have 1-2 external orgs, rarely 3
MAX_EXTERNAL_DOMAINS = 3

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
        if domain in INTERNAL_DOMAINS or domain in PERSONAL_DOMAINS or domain in TOOL_DOMAINS:
            continue
        domains.add(domain)
    return domains


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


def patch_prospect_stage(record_id, dry_run=False):
    """PATCH a prospect's Stage to 'Reunion'."""
    if dry_run:
        return True
    url = f"{PROSPECTS_API}/{record_id}"
    result = airtable_request(url, method="PATCH", data={"fields": {"Stage": "Reunion"}})
    return result is not None


def create_prospect_from_meeting(domain, employee_email, event_summary, dry_run=False):
    """Create a new prospect in stage 'Reunion' from a calendar meeting."""
    manager = MAILBOX_TO_MANAGER.get(employee_email, "")
    name = domain.split(".")[0].capitalize()
    if event_summary:
        # Use event summary as context
        context = f"Reunion detectada automaticamente desde calendario: {event_summary}"
    else:
        context = "Reunion detectada automaticamente desde calendario"

    fields = {
        "Prospect Name": name,
        "Stage": "Reunion",
        "Origin": "Evento",
        "Context": context,
        "Record Status": "Active",
    }
    if manager:
        fields["Deal Manager"] = manager

    if dry_run:
        return True

    result = airtable_request(PROSPECTS_API, method="POST", data={"fields": fields})
    return result is not None


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
    args = parser.parse_args()

    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT env var not set")
        sys.exit(1)

    # Load mailboxes
    with open(MAILBOXES_FILE, "r", encoding="utf-8") as f:
        mailboxes = json.load(f)["mailboxes"]
    active_mailboxes = [m for m in mailboxes if m.get("activo", True)]

    # Load scan state
    state = load_scan_state()

    # Fetch all prospects and build domain index
    print("Fetching prospects from Airtable...")
    prospects = fetch_all_prospects()
    print(f"  {len(prospects)} active prospects loaded")
    domain_index = build_domain_index(prospects)
    print(f"  {len(domain_index)} unique contact domains indexed")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    total_events = 0
    total_advanced = 0
    total_created = 0
    total_skipped = 0

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

            summary = event.get("summary", "(sin titulo)")

            # Filter: skip events with too many external domains (conferences/webinars)
            if len(ext_domains) > MAX_EXTERNAL_DOMAINS:
                print(f"  ⊘ Skipped '{summary}' — {len(ext_domains)} external domains (likely conference)")
                total_skipped += 1
                continue

            # Check which domains match existing prospects
            has_known_prospect = any(domain_index.get(d) for d in ext_domains)

            for domain in ext_domains:
                matching = domain_index.get(domain, [])

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
                                # Update in-memory so we don't advance twice
                                pf["Stage"] = "Reunion"
                        else:
                            print(f"  · {pname} already at {stage}, skipping")
                else:
                    # Unknown domain — only create prospect if this looks like
                    # a real 1:1 or small meeting (not a multi-org event where
                    # one attendee happens to be a known prospect)
                    if len(ext_domains) > 2 and has_known_prospect:
                        # 3 external orgs but one is known → skip the unknowns
                        continue

                    prefix = "[DRY-RUN] " if args.dry_run else ""
                    print(f"  {prefix}+ New prospect from domain '{domain}' — {summary}")
                    ok = create_prospect_from_meeting(domain, email, summary, dry_run=args.dry_run)
                    if ok:
                        total_created += 1
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
    print(f"  Prospects advanced to Reunion: {total_advanced}")
    print(f"  New prospects created: {total_created}")
    if args.dry_run:
        print("  (DRY RUN — no changes made to Airtable)")


if __name__ == "__main__":
    main()
