#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Sync Investor Workstream Feedback from Airtable
===============================================================

  Reads investor workstream data from Airtable "Investor Workstreams"
  table and enriches companies_full.json with feedback, rejection
  reasons, and workstream statuses.

  Matching: Airtable records use "Company (from Investor)" linked
  field (array of company names). We build a name->domain map and
  use fuzzy matching for unmatched records.

  Fields enriched:
    - enrichment.at_workstreams        <- array of workstream objects
    - enrichment._workstreams_synced_at <- ISO timestamp

  Each workstream object:
    {"deal": Name, "status": Workstream Status, "notes": ..., "rejection": ...}

  Usage:
    export AIRTABLE_PAT="pat..."   # or VITE_AIRTABLE_PAT

    python scripts/sync_investor_feedback.py --dry-run     # preview only
    python scripts/sync_investor_feedback.py                # sync
    python scripts/sync_investor_feedback.py --force        # overwrite existing
===============================================================
"""

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from import_mailbox import get_data_paths, export_to_compact

# ---------------------------------------------------------------------------
# Airtable config
# ---------------------------------------------------------------------------
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT") or os.environ.get("VITE_AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")
TABLE_NAME = "Investor Workstreams"
TABLE_ID = "tblbdMCGgItSYA4tD"
AIRTABLE_API = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{TABLE_ID}"

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    try:
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE
    except Exception:
        pass


def airtable_headers():
    return {
        "Authorization": f"Bearer {AIRTABLE_PAT}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Airtable fetch
# ---------------------------------------------------------------------------
def fetch_all_workstream_records():
    """Fetch all records from Investor Workstreams with pagination."""
    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT environment variable not set")
        sys.exit(1)

    records = []
    offset = ""
    page = 0

    # Only request fields we need
    fields = [
        "Name",
        "Workstream Status",
        "Workstream Notes",
        "Rejection Feedback",
        "Company (from Investor)",
    ]
    field_params = "&".join(f"fields[]={urllib.parse.quote(f)}" for f in fields)

    while True:
        url = f"{AIRTABLE_API}?pageSize=100&{field_params}"
        if offset:
            url += f"&offset={offset}"
        page += 1
        print(f"  Fetching page {page}...", end=" ", flush=True)

        req = urllib.request.Request(url, headers=airtable_headers())
        try:
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"\n  [error] Airtable fetch failed: {e}")
            sys.exit(1)

        batch = data.get("records", [])
        records.extend(batch)
        print(f"{len(batch)} records")

        offset = data.get("offset", "")
        if not offset:
            break

    print(f"  Total: {len(records)} records fetched")
    return records


# ---------------------------------------------------------------------------
# Name matching
# ---------------------------------------------------------------------------
def normalize_name(name):
    """Normalize company name for matching."""
    if not name:
        return ""
    n = name.lower().strip()
    # Remove common suffixes
    for suffix in [
        " s.a.", " sa", " s.l.", " sl", " s.l.u.", " slu",
        " ltd", " ltd.", " limited", " inc", " inc.",
        " gmbh", " ag", " b.v.", " bv", " n.v.", " nv",
        " plc", " corp", " corp.", " corporation",
        " llc", " l.l.c.", " lp", " l.p.",
        " sge", " sgr", " sicav", " sgiic",
        " capital", " partners", " group", " management",
        " asset management", " investments", " investment",
        " gestión", " gestion",
    ]:
        if n.endswith(suffix):
            n = n[: -len(suffix)].strip()
    # Remove punctuation
    n = re.sub(r'[.,;:\'\"()\[\]{}!?&/\\-]', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n


def build_name_to_domain_map(companies):
    """Build mapping from normalized company name -> domain."""
    name_map = {}  # normalized_name -> domain
    for domain, company in companies.items():
        name = company.get("name", "")
        if not name:
            continue
        norm = normalize_name(name)
        if norm:
            name_map[norm] = domain
        # Also add the raw lowercase as fallback
        raw = name.lower().strip()
        if raw and raw not in name_map:
            name_map[raw] = domain
    return name_map


def _similarity(a, b):
    """Compute similarity ratio between two strings."""
    if not a or not b:
        return 0.0
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if len(tokens_a) == 1 and len(tokens_b) == 1:
        return 1.0 if a == b else 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    jaccard = len(intersection) / len(union)
    if a in b or b in a:
        containment = min(len(a), len(b)) / max(len(a), len(b))
        return max(jaccard, containment)
    return jaccard


def fuzzy_match(name, name_map, threshold=0.85):
    """Simple fuzzy matching using token overlap."""
    norm = normalize_name(name)
    if not norm or len(norm) < 4:
        # Too short to fuzzy match reliably
        return None, 0.0

    best_domain = None
    best_score = 0.0

    for candidate_name, domain in name_map.items():
        score = _similarity(norm, candidate_name)
        if score > best_score:
            best_score = score
            best_domain = domain

    if best_score >= threshold:
        return best_domain, best_score
    return None, best_score


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Sync Investor Workstream feedback to companies_full.json")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    parser.add_argument("--force", action="store_true", help="Overwrite existing at_workstreams data")
    args = parser.parse_args()

    print("=" * 60)
    print("  Alter5 BI -- Sync Investor Workstream Feedback")
    print("=" * 60)

    # -- Load companies_full.json --
    paths = get_data_paths(PROJECT_DIR)
    print(f"\n[1/4] Loading companies from {os.path.basename(paths['full'])}...")
    with open(paths["full"], "r", encoding="utf-8") as f:
        data = json.load(f)
    companies = data if isinstance(data, dict) and "companies" not in data else data.get("companies", data)
    print(f"  {len(companies)} companies loaded")

    # -- Build name map --
    print("\n[2/4] Building name -> domain map...")
    name_map = build_name_to_domain_map(companies)
    print(f"  {len(name_map)} name entries in map")

    # -- Fetch from Airtable --
    print(f"\n[3/4] Fetching Airtable '{TABLE_NAME}'...")
    records = fetch_all_workstream_records()

    # -- Process records and match to companies --
    print("\n[4/4] Matching workstreams to companies...")
    stats = {
        "total_records": len(records),
        "exact_matched": 0,
        "fuzzy_matched": 0,
        "unmatched": 0,
        "skipped_no_company": 0,
        "enriched_count": 0,
    }

    # Group workstreams by domain
    domain_workstreams = {}  # domain -> list of workstream dicts
    unmatched_names = []

    for rec in records:
        fields = rec.get("fields", {})
        deal_name = fields.get("Name", "").strip()
        status = fields.get("Workstream Status", "")
        notes = fields.get("Workstream Notes", "")
        rejection = fields.get("Rejection Feedback", "")

        # "Company (from Investor)" is a linked record field -> array of strings
        company_names = fields.get("Company (from Investor)", [])
        if not isinstance(company_names, list):
            company_names = [company_names] if company_names else []

        if not company_names:
            stats["skipped_no_company"] += 1
            continue

        company_name = company_names[0]  # Use first element

        # Try exact match
        norm = normalize_name(company_name)
        domain = name_map.get(norm) or name_map.get(company_name.lower().strip())

        match_type = None
        if domain:
            match_type = "exact"
            stats["exact_matched"] += 1
        else:
            # Try fuzzy match
            domain, score = fuzzy_match(company_name, name_map)
            if domain:
                match_type = "fuzzy"
                stats["fuzzy_matched"] += 1
                print(f"    [fuzzy] '{company_name}' -> {domain} (score={score:.2f})")
            else:
                stats["unmatched"] += 1
                unmatched_names.append(company_name)
                continue

        # Build workstream object (only include non-empty fields)
        ws = {"deal": deal_name}
        if status:
            ws["status"] = status
        if notes:
            ws["notes"] = notes
        if rejection:
            ws["rejection"] = rejection

        if domain not in domain_workstreams:
            domain_workstreams[domain] = []
        domain_workstreams[domain].append(ws)

    # -- Enrich companies --
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for domain, workstreams in domain_workstreams.items():
        company = companies.get(domain)
        if not company:
            continue

        enrichment = company.setdefault("enrichment", {})

        # Skip if already has workstreams and not --force
        if enrichment.get("at_workstreams") and not args.force:
            print(f"    [skip] {domain} already has at_workstreams (use --force to overwrite)")
            continue

        enrichment["at_workstreams"] = workstreams
        enrichment["_workstreams_synced_at"] = now_iso
        stats["enriched_count"] += 1

        has_rejection = any(ws.get("rejection") for ws in workstreams)
        marker = " [has rejection feedback]" if has_rejection else ""
        print(f"    [enrich] {domain}: {len(workstreams)} workstream(s){marker}")

    # -- Print stats --
    print("\n" + "=" * 60)
    print("  Results")
    print("=" * 60)
    print(f"  Total records:        {stats['total_records']}")
    print(f"  Exact matched:        {stats['exact_matched']}")
    print(f"  Fuzzy matched:        {stats['fuzzy_matched']}")
    print(f"  Unmatched:            {stats['unmatched']}")
    print(f"  Skipped (no company): {stats['skipped_no_company']}")
    print(f"  Companies enriched:   {stats['enriched_count']}")

    if unmatched_names:
        print(f"\n  Unmatched company names:")
        for name in sorted(set(unmatched_names)):
            print(f"    - {name}")

    # -- Save --
    if args.dry_run:
        print("\n  [dry-run] No files written.")
    else:
        print(f"\n  Writing {os.path.basename(paths['full'])}...")
        with open(paths["full"], "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"  Writing {os.path.basename(paths['compact'])}...")
        compact = export_to_compact(companies)
        with open(paths["compact"], "w", encoding="utf-8") as f:
            json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

        print("\n  Done.")


if __name__ == "__main__":
    main()
