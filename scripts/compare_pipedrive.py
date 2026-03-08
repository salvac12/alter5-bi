#!/usr/bin/env python3
"""
Compare Pipedrive CRM (Organizations + Persons + Deals) against
src/data/companies_full.json to find discrepancies.

Usage:
  PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py
  PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py --output report.json
  PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py --csv
  PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py --verbose

Requires:
  - PIPEDRIVE_API_TOKEN  environment variable
"""

import argparse
import csv
import json
import os
import re
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# SSL context (same pattern as other scripts)
# ---------------------------------------------------------------------------
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
COMPANIES_FULL_PATH = os.path.join(PROJECT_DIR, "src", "data", "companies_full.json")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PIPEDRIVE_API_TOKEN = os.environ.get("PIPEDRIVE_API_TOKEN", "")
PIPEDRIVE_BASE_URL = "https://api.pipedrive.com/v1"
PAGE_LIMIT = 500
RATE_LIMIT_SLEEP = 0.25   # seconds between paginated requests
FUZZY_THRESHOLD = 0.85    # minimum token-overlap similarity to count as a match

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_name(name: str) -> str:
    """Lowercase, strip legal suffixes, remove punctuation and accents."""
    if not name:
        return ""
    # Unicode normalization → remove accents
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    name = name.lower()
    # Remove common legal suffixes (longer patterns first to avoid partial matches)
    for suffix in [
        r"\bs\.?a\.?u\.?\b", r"\bs\.?l\.?u\.?\b",
        r"\bs\.?a\.?\b", r"\bs\.?l\.?\b",
        r"\bslp\b", r"\bsau\b", r"\bsal\b",
        r"\binc\.?\b", r"\bltd\.?\b", r"\bgmbh\b", r"\bb\.?v\.?\b",
        r"\bllc\.?\b", r"\bcorp\.?\b", r"\bplc\.?\b", r"\bse\b",
        r"\bag\b", r"\bco\.?\b", r"\bcompany\b", r"\bgroup\b",
        r"\bholding\b", r"\bholdings\b", r"\bsociedades\b",
        r"\bsociedad\b", r"\blimitada\b", r"\banonima\b",
    ]:
        name = re.sub(suffix, "", name)
    # Remove punctuation except spaces
    name = re.sub(r"[^\w\s]", " ", name)
    # Collapse whitespace
    name = " ".join(name.split())
    return name


def token_similarity(a: str, b: str) -> float:
    """Simple normalized token-overlap similarity (Jaccard on word sets)."""
    if not a or not b:
        return 0.0
    tokens_a = set(normalize_name(a).split())
    tokens_b = set(normalize_name(b).split())
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


def extract_domain_from_url(url: str) -> str:
    """Extract bare domain from a URL string (e.g. 'www.iberdrola.com' → 'iberdrola.com')."""
    if not url:
        return ""
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc or parsed.path
        host = host.lower().lstrip("www.").split("/")[0].split("?")[0]
        return host
    except Exception:
        return ""


def extract_domain_from_email(email: str) -> str:
    """Extract domain part from an email address."""
    if not email or "@" not in email:
        return ""
    return email.strip().lower().split("@")[-1]


# ---------------------------------------------------------------------------
# Pipedrive API
# ---------------------------------------------------------------------------

def pipedrive_get(endpoint: str, params: dict | None = None) -> list[dict]:
    """
    Fetch all pages from a Pipedrive paginated endpoint.
    Returns the combined list of items across all pages.
    """
    if not PIPEDRIVE_API_TOKEN:
        print("ERROR: PIPEDRIVE_API_TOKEN environment variable not set.")
        print("Usage: PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py")
        sys.exit(1)

    items: list[dict] = []
    start = 0
    total_hint: int | None = None

    base_params = dict(params or {})
    base_params["api_token"] = PIPEDRIVE_API_TOKEN
    base_params["limit"] = PAGE_LIMIT

    resource_label = endpoint.strip("/").split("/")[-1].capitalize()

    while True:
        base_params["start"] = start
        query_string = urllib.parse.urlencode(base_params)
        url = f"{PIPEDRIVE_BASE_URL}{endpoint}?{query_string}"

        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json"},
        )

        try:
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8") if exc.fp else ""
            print(f"\nERROR: Pipedrive API {endpoint} returned HTTP {exc.code}")
            print(body[:500])
            sys.exit(1)
        except urllib.error.URLError as exc:
            print(f"\nERROR: Network error fetching {endpoint}: {exc.reason}")
            sys.exit(1)

        if not raw.get("success"):
            print(f"ERROR: Pipedrive API returned success=false for {endpoint}")
            print(json.dumps(raw, indent=2)[:500])
            sys.exit(1)

        page_data = raw.get("data") or []
        items.extend(page_data)

        pagination = raw.get("additional_data", {}).get("pagination", {})
        more = pagination.get("more_items_in_collection", False)
        next_start = pagination.get("next_start")

        if total_hint is None:
            total_hint = pagination.get("total_count") or pagination.get("items_count")

        count_so_far = len(items)
        if total_hint:
            print(f"  Fetching {resource_label}... {count_so_far}/{total_hint}", end="\r", flush=True)
        else:
            print(f"  Fetching {resource_label}... {count_so_far}", end="\r", flush=True)

        if not more or not next_start:
            break

        start = next_start
        time.sleep(RATE_LIMIT_SLEEP)

    print(f"  Fetching {resource_label}... {len(items)} done.            ")
    return items


# ---------------------------------------------------------------------------
# Load local data
# ---------------------------------------------------------------------------

def load_local_companies() -> dict[str, dict]:
    """Load companies_full.json and return dict keyed by domain."""
    if not os.path.exists(COMPANIES_FULL_PATH):
        print(f"ERROR: {COMPANIES_FULL_PATH} not found.")
        sys.exit(1)
    with open(COMPANIES_FULL_PATH, encoding="utf-8") as f:
        data = json.load(f)
    # companies_full.json can be a dict of {domain: company_obj}
    if isinstance(data, dict):
        return data
    # If it's somehow a list, key by domain
    return {c["domain"]: c for c in data if c.get("domain")}


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def build_pipedrive_org_domain(org: dict) -> str:
    """Try to extract a domain from a Pipedrive organization record."""
    # Check common field names for website
    for field in ["website", "cc_email", "email"]:
        val = org.get(field)
        if isinstance(val, str) and val:
            if "@" in val:
                d = extract_domain_from_email(val)
            else:
                d = extract_domain_from_url(val)
            if d:
                return d
    # Check custom fields (arbitrary UUIDs) — look for any string containing a dot
    for key, val in org.items():
        if isinstance(val, str) and "." in val and len(val) < 200:
            if val.startswith("http") or re.match(r"[\w\-]+\.\w{2,6}$", val):
                d = extract_domain_from_url(val)
                if d:
                    return d
    return ""


def match_orgs_to_local(
    pipedrive_orgs: list[dict],
    local_companies: dict[str, dict],
    pipedrive_persons_by_org: dict[int, list[dict]],
    verbose: bool = False,
) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Match Pipedrive orgs against local companies.

    Returns:
      - only_in_pipedrive: list of {org, persons, deals}
      - only_in_local: list of local company dicts
      - matched: list of {org, local_company, match_type, ...}
    """
    # Build local lookup maps
    local_by_domain = local_companies  # already keyed by domain
    local_by_norm_name: dict[str, str] = {
        normalize_name(v.get("name", k)): k
        for k, v in local_companies.items()
    }

    matched_local_domains: set[str] = set()
    matched: list[dict] = []
    only_in_pipedrive: list[dict] = []

    for org in pipedrive_orgs:
        org_id = org.get("id")
        org_name = org.get("name", "")
        persons = pipedrive_persons_by_org.get(org_id, [])

        match_domain: str | None = None
        match_type: str | None = None
        local_company: dict | None = None

        # Strategy 1: Exact domain match from org fields
        org_domain = build_pipedrive_org_domain(org)
        if org_domain and org_domain in local_by_domain:
            match_domain = org_domain
            match_type = "domain_exact"
            local_company = local_by_domain[match_domain]

        # Strategy 2: Fuzzy name match
        if not match_domain:
            norm_org = normalize_name(org_name)
            if norm_org in local_by_norm_name:
                match_domain = local_by_norm_name[norm_org]
                match_type = "name_exact"
                local_company = local_by_domain[match_domain]
            else:
                best_score = 0.0
                best_dom = None
                for norm_local, dom in local_by_norm_name.items():
                    score = token_similarity(norm_org, norm_local)
                    if score > best_score:
                        best_score = score
                        best_dom = dom
                if best_score >= FUZZY_THRESHOLD and best_dom:
                    match_domain = best_dom
                    match_type = f"name_fuzzy({best_score:.0%})"
                    local_company = local_by_domain[match_domain]
                    if verbose:
                        local_name = local_company.get("name", best_dom)
                        print(
                            f"  [fuzzy] '{org_name}' → '{local_name}' "
                            f"({best_score:.0%})"
                        )

        # Strategy 3: Email domain match from linked persons
        if not match_domain:
            for person in persons:
                for email_obj in (person.get("email") or []):
                    em = email_obj.get("value", "") if isinstance(email_obj, dict) else str(email_obj)
                    dom = extract_domain_from_email(em)
                    if dom and dom in local_by_domain:
                        match_domain = dom
                        match_type = "email_domain"
                        local_company = local_by_domain[match_domain]
                        break
                if match_domain:
                    break

        if match_domain and local_company:
            matched.append({
                "org": org,
                "local_company": local_company,
                "local_domain": match_domain,
                "match_type": match_type,
                "persons": persons,
            })
            matched_local_domains.add(match_domain)
        else:
            only_in_pipedrive.append({
                "org": org,
                "persons": persons,
            })

    # Companies in local but not matched to any Pipedrive org
    only_in_local = [
        company
        for domain, company in local_companies.items()
        if domain not in matched_local_domains
    ]

    return only_in_pipedrive, only_in_local, matched


def match_contacts(
    pipedrive_persons: list[dict],
    local_companies: dict[str, dict],
    matched_local_domains: set[str],
) -> tuple[list[dict], list[dict]]:
    """
    Compare Pipedrive persons vs local contacts.

    Returns:
      - only_in_pipedrive_contacts: Pipedrive persons not found in local
      - only_in_local_contacts: local contacts not found in Pipedrive
    """
    # Build index of all local contacts by email (lowercase)
    local_email_index: dict[str, tuple[str, dict]] = {}  # email → (domain, contact_dict)
    for domain, company in local_companies.items():
        for contact in (company.get("contacts") or []):
            em = (contact.get("email") or "").strip().lower()
            if em:
                local_email_index[em] = (domain, contact)

    # All Pipedrive person emails
    pipedrive_emails: set[str] = set()
    only_in_pipedrive_contacts: list[dict] = []

    for person in pipedrive_persons:
        person_emails = []
        for email_obj in (person.get("email") or []):
            em = email_obj.get("value", "").strip().lower() if isinstance(email_obj, dict) else str(email_obj).lower()
            if em:
                person_emails.append(em)
                pipedrive_emails.add(em)

        found_in_local = any(em in local_email_index for em in person_emails)
        if not found_in_local:
            only_in_pipedrive_contacts.append({
                "person": person,
                "emails": person_emails,
            })

    # Local contacts whose email is not in Pipedrive
    only_in_local_contacts: list[dict] = []
    for domain, company in local_companies.items():
        for contact in (company.get("contacts") or []):
            em = (contact.get("email") or "").strip().lower()
            if em and em not in pipedrive_emails:
                only_in_local_contacts.append({
                    "company": company,
                    "domain": domain,
                    "contact": contact,
                })

    return only_in_pipedrive_contacts, only_in_local_contacts


# ---------------------------------------------------------------------------
# Report printing
# ---------------------------------------------------------------------------
SEP = "═" * 63


def print_report(
    local_companies: dict[str, dict],
    pipedrive_orgs: list[dict],
    pipedrive_persons: list[dict],
    pipedrive_deals: list[dict],
    only_in_pipedrive: list[dict],
    only_in_local: list[dict],
    matched: list[dict],
    only_pipedrive_contacts: list[dict],
    only_local_contacts: list[dict],
    pipedrive_deals_by_org: dict[int, list[dict]],
) -> None:

    print(SEP)
    print("  Alter5 BI — Pipedrive vs companies_full.json Comparison")
    print(SEP)
    print()
    print("📊 RESUMEN")
    print(f"  Pipedrive Organizations: {len(pipedrive_orgs)}")
    print(f"  Pipedrive Persons:       {len(pipedrive_persons)}")
    print(f"  Pipedrive Deals:         {len(pipedrive_deals)}")
    print(f"  Local companies:         {len(local_companies)}")
    print()

    # ── Section 1: Only in Pipedrive ──────────────────────────────────
    print(SEP)
    print(f"🔴 EN PIPEDRIVE PERO NO EN LOCAL ({len(only_in_pipedrive)} empresas)")
    print(SEP)
    for i, entry in enumerate(only_in_pipedrive, 1):
        org = entry["org"]
        org_id = org.get("id")
        persons = entry.get("persons", [])
        deals = pipedrive_deals_by_org.get(org_id, [])
        open_deals = sum(1 for d in deals if d.get("status") == "open")
        closed_deals = sum(1 for d in deals if d.get("status") in ("won", "lost"))
        print(f"  {i}. {org.get('name', '?')} (pipedrive_id: {org_id})")
        print(f"     Deals: {open_deals} open, {closed_deals} closed | Contacts: {len(persons)}")
    if not only_in_pipedrive:
        print("  (none)")
    print()

    # ── Section 2: Only in local ──────────────────────────────────────
    print(SEP)
    print(f"🟡 EN LOCAL PERO NO EN PIPEDRIVE ({len(only_in_local)} empresas)")
    print(SEP)
    # Sort by interactions descending for relevance
    only_in_local_sorted = sorted(
        only_in_local,
        key=lambda c: c.get("interactions", 0),
        reverse=True,
    )
    for i, company in enumerate(only_in_local_sorted, 1):
        domain = company.get("domain", "?")
        interactions = company.get("interactions", 0)
        contacts = company.get("contacts") or []
        enrichment = company.get("enrichment") or {}
        company_type = enrichment.get("type") or enrichment.get("group") or ""
        print(f"  {i}. {company.get('name', domain)} (domain: {domain})")
        detail = f"     Interactions: {interactions} | Contacts: {len(contacts)}"
        if company_type:
            detail += f" | Type: {company_type}"
        print(detail)
    if not only_in_local:
        print("  (none)")
    print()

    # ── Section 3: Matched ────────────────────────────────────────────
    print(SEP)
    print(f"🟢 EN AMBOS — MATCH ({len(matched)} empresas)")
    print(SEP)
    for i, entry in enumerate(matched, 1):
        org = entry["org"]
        org_id = org.get("id")
        local_domain = entry["local_domain"]
        match_type = entry["match_type"]
        deals = pipedrive_deals_by_org.get(org_id, [])
        open_deals = sum(1 for d in deals if d.get("status") == "open")
        print(f"  {i}. {org.get('name', '?')}")
        print(f"     Pipedrive ID: {org_id} | Local domain: {local_domain}")
        print(f"     Match type: {match_type} | Deals: {open_deals} open")
    if not matched:
        print("  (none)")
    print()

    # ── Section 4: Contacts only in Pipedrive ─────────────────────────
    print(SEP)
    print(f"👤 CONTACTOS: EN PIPEDRIVE PERO NO EN LOCAL ({len(only_pipedrive_contacts)} contactos)")
    print(SEP)
    for i, entry in enumerate(only_pipedrive_contacts, 1):
        person = entry["person"]
        emails = entry["emails"]
        org_id = person.get("org_id") or (person.get("org", {}) or {}).get("value")
        org_name = (person.get("org", {}) or {}).get("name") or f"org_id:{org_id}"
        email_str = emails[0] if emails else "no email"
        print(f"  {i}. {person.get('name', '?')} <{email_str}>")
        print(f"     Org: {org_name} (pipedrive_org_id: {org_id})")
    if not only_pipedrive_contacts:
        print("  (none)")
    print()

    # ── Section 5: Contacts only in local ─────────────────────────────
    print(SEP)
    print(f"👤 CONTACTOS: EN LOCAL PERO NO EN PIPEDRIVE ({len(only_local_contacts)} contactos)")
    print(SEP)
    for i, entry in enumerate(only_local_contacts, 1):
        contact = entry["contact"]
        company = entry["company"]
        domain = entry["domain"]
        print(f"  {i}. {contact.get('name', '?')} <{contact.get('email', 'no email')}>")
        print(f"     Company: {company.get('name', domain)} (domain: {domain})")
    if not only_local_contacts:
        print("  (none)")
    print()


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------

def build_json_report(
    local_companies: dict[str, dict],
    pipedrive_orgs: list[dict],
    pipedrive_persons: list[dict],
    pipedrive_deals: list[dict],
    only_in_pipedrive: list[dict],
    only_in_local: list[dict],
    matched: list[dict],
    only_pipedrive_contacts: list[dict],
    only_local_contacts: list[dict],
) -> dict:

    def _slim_org(org):
        return {
            "id": org.get("id"),
            "name": org.get("name"),
            "open_deals_count": org.get("open_deals_count"),
            "closed_deals_count": org.get("closed_deals_count"),
        }

    def _slim_person(p):
        emails = []
        for e in (p.get("email") or []):
            v = e.get("value", "") if isinstance(e, dict) else str(e)
            if v:
                emails.append(v)
        org_id = p.get("org_id") or (p.get("org", {}) or {}).get("value")
        org_name = (p.get("org", {}) or {}).get("name")
        return {"id": p.get("id"), "name": p.get("name"), "emails": emails, "org_id": org_id, "org_name": org_name}

    def _slim_company(c):
        return {
            "name": c.get("name"),
            "domain": c.get("domain"),
            "interactions": c.get("interactions"),
            "contacts_count": len(c.get("contacts") or []),
            "type": (c.get("enrichment") or {}).get("type"),
        }

    return {
        "summary": {
            "pipedrive_orgs": len(pipedrive_orgs),
            "pipedrive_persons": len(pipedrive_persons),
            "pipedrive_deals": len(pipedrive_deals),
            "local_companies": len(local_companies),
        },
        "only_in_pipedrive": [
            {
                "org": _slim_org(e["org"]),
                "persons_count": len(e.get("persons", [])),
            }
            for e in only_in_pipedrive
        ],
        "only_in_local": [_slim_company(c) for c in only_in_local],
        "matched": [
            {
                "org": _slim_org(e["org"]),
                "local_domain": e["local_domain"],
                "match_type": e["match_type"],
            }
            for e in matched
        ],
        "only_pipedrive_contacts": [_slim_person(e["person"]) for e in only_pipedrive_contacts],
        "only_local_contacts": [
            {
                "name": e["contact"].get("name"),
                "email": e["contact"].get("email"),
                "company": e["company"].get("name"),
                "domain": e["domain"],
            }
            for e in only_local_contacts
        ],
    }


# ---------------------------------------------------------------------------
# CSV output
# ---------------------------------------------------------------------------

def write_csv_reports(
    only_in_pipedrive: list[dict],
    only_in_local: list[dict],
    matched: list[dict],
    only_pipedrive_contacts: list[dict],
    only_local_contacts: list[dict],
    pipedrive_deals_by_org: dict[int, list[dict]],
) -> None:

    cwd = os.getcwd()

    # pipedrive_only_orgs.csv
    path1 = os.path.join(cwd, "pipedrive_only_orgs.csv")
    with open(path1, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["pipedrive_id", "name", "open_deals", "closed_deals", "contacts"])
        writer.writeheader()
        for e in only_in_pipedrive:
            org = e["org"]
            org_id = org.get("id")
            deals = pipedrive_deals_by_org.get(org_id, [])
            writer.writerow({
                "pipedrive_id": org_id,
                "name": org.get("name", ""),
                "open_deals": sum(1 for d in deals if d.get("status") == "open"),
                "closed_deals": sum(1 for d in deals if d.get("status") in ("won", "lost")),
                "contacts": len(e.get("persons", [])),
            })
    print(f"  CSV: {path1}")

    # local_only_companies.csv
    path2 = os.path.join(cwd, "local_only_companies.csv")
    with open(path2, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "domain", "interactions", "contacts", "type"])
        writer.writeheader()
        for company in sorted(only_in_local, key=lambda c: c.get("interactions", 0), reverse=True):
            writer.writerow({
                "name": company.get("name", ""),
                "domain": company.get("domain", ""),
                "interactions": company.get("interactions", 0),
                "contacts": len(company.get("contacts") or []),
                "type": (company.get("enrichment") or {}).get("type", ""),
            })
    print(f"  CSV: {path2}")

    # matched_companies.csv
    path3 = os.path.join(cwd, "matched_companies.csv")
    with open(path3, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["pipedrive_id", "pipedrive_name", "local_domain", "match_type", "open_deals"])
        writer.writeheader()
        for e in matched:
            org = e["org"]
            deals = pipedrive_deals_by_org.get(org.get("id"), [])
            writer.writerow({
                "pipedrive_id": org.get("id"),
                "pipedrive_name": org.get("name", ""),
                "local_domain": e["local_domain"],
                "match_type": e["match_type"],
                "open_deals": sum(1 for d in deals if d.get("status") == "open"),
            })
    print(f"  CSV: {path3}")

    # pipedrive_only_contacts.csv
    path4 = os.path.join(cwd, "pipedrive_only_contacts.csv")
    with open(path4, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["pipedrive_id", "name", "email", "org_name", "org_id"])
        writer.writeheader()
        for e in only_pipedrive_contacts:
            p = e["person"]
            org_id = p.get("org_id") or (p.get("org", {}) or {}).get("value")
            org_name = (p.get("org", {}) or {}).get("name") or ""
            emails = e["emails"]
            writer.writerow({
                "pipedrive_id": p.get("id"),
                "name": p.get("name", ""),
                "email": emails[0] if emails else "",
                "org_name": org_name,
                "org_id": org_id,
            })
    print(f"  CSV: {path4}")

    # local_only_contacts.csv
    path5 = os.path.join(cwd, "local_only_contacts.csv")
    with open(path5, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "email", "role", "company", "domain"])
        writer.writeheader()
        for e in only_local_contacts:
            writer.writerow({
                "name": e["contact"].get("name", ""),
                "email": e["contact"].get("email", ""),
                "role": e["contact"].get("role", ""),
                "company": e["company"].get("name", ""),
                "domain": e["domain"],
            })
    print(f"  CSV: {path5}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare Pipedrive CRM vs companies_full.json"
    )
    parser.add_argument("--output", metavar="FILE", help="Save full JSON report to FILE")
    parser.add_argument("--csv", action="store_true", help="Export CSV summaries")
    parser.add_argument("--verbose", action="store_true", help="Print detailed matching info")
    args = parser.parse_args()

    if not PIPEDRIVE_API_TOKEN:
        print("ERROR: PIPEDRIVE_API_TOKEN environment variable not set.")
        print("Usage: PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py")
        sys.exit(1)

    # ── Step 1: Load local data ─────────────────────────────────────────
    print(f"Loading {COMPANIES_FULL_PATH} ...")
    local_companies = load_local_companies()
    print(f"  Loaded {len(local_companies)} companies from companies_full.json")

    # ── Step 2: Fetch Pipedrive Organizations ───────────────────────────
    print("Fetching Pipedrive Organizations...")
    pipedrive_orgs = pipedrive_get("/organizations")

    # ── Step 3: Fetch Pipedrive Persons ────────────────────────────────
    print("Fetching Pipedrive Persons...")
    pipedrive_persons = pipedrive_get("/persons")

    # ── Step 4: Fetch Pipedrive Deals ───────────────────────────────────
    print("Fetching Pipedrive Deals...")
    pipedrive_deals = pipedrive_get("/deals", params={"status": "all_not_deleted"})

    # ── Build index maps ────────────────────────────────────────────────
    # Persons indexed by org_id
    pipedrive_persons_by_org: dict[int, list[dict]] = {}
    for person in pipedrive_persons:
        org_id = person.get("org_id")
        if org_id is None:
            org_id_val = (person.get("org") or {}).get("value")
            org_id = org_id_val
        if org_id is not None:
            pipedrive_persons_by_org.setdefault(org_id, []).append(person)

    # Deals indexed by org_id
    # In Pipedrive, deal.org_id is an integer (or None if no org linked)
    pipedrive_deals_by_org: dict[int, list[dict]] = {}
    for deal in pipedrive_deals:
        org_id = deal.get("org_id")
        if isinstance(org_id, int):
            pipedrive_deals_by_org.setdefault(org_id, []).append(deal)

    print()

    # ── Step 5: Matching ────────────────────────────────────────────────
    print("Running matching logic...")
    only_in_pipedrive, only_in_local, matched = match_orgs_to_local(
        pipedrive_orgs, local_companies, pipedrive_persons_by_org, verbose=args.verbose
    )

    matched_local_domains = {e["local_domain"] for e in matched}
    only_pipedrive_contacts, only_local_contacts = match_contacts(
        pipedrive_persons, local_companies, matched_local_domains
    )
    print(f"  Matched: {len(matched)} | Only Pipedrive: {len(only_in_pipedrive)} | Only Local: {len(only_in_local)}")
    print()

    # ── Step 6: Print report ────────────────────────────────────────────
    print_report(
        local_companies=local_companies,
        pipedrive_orgs=pipedrive_orgs,
        pipedrive_persons=pipedrive_persons,
        pipedrive_deals=pipedrive_deals,
        only_in_pipedrive=only_in_pipedrive,
        only_in_local=only_in_local,
        matched=matched,
        only_pipedrive_contacts=only_pipedrive_contacts,
        only_local_contacts=only_local_contacts,
        pipedrive_deals_by_org=pipedrive_deals_by_org,
    )

    # ── Step 7: Optional JSON output ────────────────────────────────────
    if args.output:
        report = build_json_report(
            local_companies=local_companies,
            pipedrive_orgs=pipedrive_orgs,
            pipedrive_persons=pipedrive_persons,
            pipedrive_deals=pipedrive_deals,
            only_in_pipedrive=only_in_pipedrive,
            only_in_local=only_in_local,
            matched=matched,
            only_pipedrive_contacts=only_pipedrive_contacts,
            only_local_contacts=only_local_contacts,
        )
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"JSON report saved to: {args.output}")

    # ── Optional CSV output ─────────────────────────────────────────────
    if args.csv:
        print("Writing CSV files...")
        write_csv_reports(
            only_in_pipedrive=only_in_pipedrive,
            only_in_local=only_in_local,
            matched=matched,
            only_pipedrive_contacts=only_pipedrive_contacts,
            only_local_contacts=only_local_contacts,
            pipedrive_deals_by_org=pipedrive_deals_by_org,
        )
        print("CSV export complete.")


if __name__ == "__main__":
    main()
