#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Enrich from Airtable Stakeholders_Business_Units
===============================================================

  Reads investor data from Airtable Stakeholders_Business_Units table
  and enriches companies_full.json with fields that are currently empty.

  Matching: Airtable records use company NAME, companies_full.json uses DOMAIN.
  We build a name→domain map and use fuzzy matching for unmatched records.

  Fields enriched (only if empty in current data):
    - website_url         ← Company URL (linked field, array)
    - company_logo        ← Company Logo (from Company) (attachment URL)
    - investor_geo_focus  ← INTERIM Focus Countries (computed .value)
    - investor_sectors    ← INTERIM Sector (computed .value, NEW field)
    - investor_labels     ← INTERIM Labels (computed .value, NEW field)
    - sbu_type_market_role← Type of market role (computed .value)
    - mr (market roles)   ← Market_Role_Names (report discrepancies)

  Usage:
    export AIRTABLE_PAT="pat..."   # or VITE_AIRTABLE_PAT

    python scripts/enrich_from_airtable_sbu.py --dry-run     # preview only
    python scripts/enrich_from_airtable_sbu.py                # enrich
    python scripts/enrich_from_airtable_sbu.py --force        # overwrite existing
    python scripts/enrich_from_airtable_sbu.py --report       # generate CSV report
===============================================================
"""

import argparse
import csv
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
TABLE_NAME = "Stakeholders_Business_Units"
AIRTABLE_API = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{urllib.parse.quote(TABLE_NAME)}"

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
def fetch_all_sbu_records():
    """Fetch all records from Stakeholders_Business_Units with pagination."""
    records = []
    offset = ""
    page = 0

    # Only request fields we need
    fields = [
        "Business Unit Name",
        "Company URL",
        "Company Logo (from Company)",
        "Market_Role_Names",
        "INTERIM (TRANSFORMED) Focus Countries",
        "INTERIM (Transformed) Sector",
        "INTERIM (Transformed) Labels",
        "Type of market role",
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
    """Build mapping from normalized company name → domain."""
    name_map = {}  # normalized_name → domain
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


def fuzzy_match(name, name_map, threshold=0.85):
    """Simple fuzzy matching using token overlap."""
    norm = normalize_name(name)
    if not norm or len(norm) < 4:
        # Too short to fuzzy match reliably (e.g. "General")
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


def _similarity(a, b):
    """Compute similarity ratio between two strings."""
    if not a or not b:
        return 0.0
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if not tokens_a or not tokens_b:
        return 0.0

    # Single-token names: require exact match only (avoid "General" → "Generali")
    if len(tokens_a) == 1 and len(tokens_b) == 1:
        return 1.0 if a == b else 0.0

    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    jaccard = len(intersection) / len(union)

    # Also check containment
    if a in b or b in a:
        containment = min(len(a), len(b)) / max(len(a), len(b))
        return max(jaccard, containment)

    return jaccard


# ---------------------------------------------------------------------------
# Enrichment logic
# ---------------------------------------------------------------------------
def _get_computed_value(field):
    """Extract .value from INTERIM computed fields ({state, value, isStale})."""
    if isinstance(field, dict) and field.get("state") == "generated":
        v = field.get("value", "")
        if v and isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def extract_sbu_fields(fields):
    """Extract useful fields from an Airtable SBU record."""
    result = {}

    # Company URL (lookup → array of strings, may contain comma-separated URLs)
    url = fields.get("Company URL")
    if isinstance(url, list):
        # Flatten: each element may contain comma-separated URLs
        all_urls = []
        for u in url:
            if isinstance(u, str):
                all_urls.extend(part.strip() for part in u.split(",") if part.strip())
        for u in all_urls:
            if "://" in u or (u.count(".") >= 1 and " " not in u and len(u) > 4):
                result["company_url"] = u
                break
    elif isinstance(url, str) and url.strip():
        first = url.split(",")[0].strip()
        if "." in first or "://" in first:
            result["company_url"] = first

    # Company Logo (attachment field from lookup → first URL)
    logo = fields.get("Company Logo (from Company)")
    if logo and isinstance(logo, list) and len(logo) > 0:
        first = logo[0]
        if isinstance(first, dict) and first.get("url"):
            result["company_logo"] = first["url"]

    # Market Role Names (lookup → array of strings)
    mr = fields.get("Market_Role_Names")
    if mr and isinstance(mr, list):
        result["market_roles"] = [r for r in mr if isinstance(r, str) and r.strip()]

    # Focus Countries (INTERIM computed → comma-separated string)
    fc_val = _get_computed_value(fields.get("INTERIM (TRANSFORMED) Focus Countries", {}))
    if fc_val:
        countries = [c.strip() for c in fc_val.split(",") if c.strip()]
        if countries:
            result["focus_countries"] = countries

    # Sector (INTERIM computed → string)
    sector_val = _get_computed_value(fields.get("INTERIM (Transformed) Sector", {}))
    if sector_val:
        result["sector"] = sector_val

    # Labels (INTERIM computed → comma-separated string, e.g. "Infrastructure Fund, Renewables")
    labels_val = _get_computed_value(fields.get("INTERIM (Transformed) Labels", {}))
    if labels_val:
        labels = [l.strip() for l in labels_val.split(",") if l.strip()]
        if labels:
            result["labels"] = labels

    # Type of market role (INTERIM computed → string like "Investor", "Capital Seeker")
    type_mr_val = _get_computed_value(fields.get("Type of market role", {}))
    if type_mr_val:
        result["type_market_role"] = type_mr_val

    return result


def enrich_company(enrichment, sbu_data, force=False):
    """Merge SBU data into company enrichment. Returns dict of changes made."""
    changes = {}

    # website_url ← company_url
    if sbu_data.get("company_url"):
        current = enrichment.get("website_url", "")
        if force or not current:
            enrichment["website_url"] = sbu_data["company_url"]
            if current != sbu_data["company_url"]:
                changes["website_url"] = sbu_data["company_url"]

    # company_logo (new field)
    if sbu_data.get("company_logo"):
        current = enrichment.get("company_logo", "")
        if force or not current:
            enrichment["company_logo"] = sbu_data["company_logo"]
            if current != sbu_data["company_logo"]:
                changes["company_logo"] = sbu_data["company_logo"]

    # investor_geo_focus ← focus_countries
    if sbu_data.get("focus_countries"):
        current = enrichment.get("investor_geo_focus")
        new_geos = sbu_data["focus_countries"]
        if force or not current:
            enrichment["investor_geo_focus"] = new_geos
            changes["investor_geo_focus"] = new_geos
        elif isinstance(current, list):
            current_lower = {g.lower() for g in current}
            added = [g for g in new_geos if g.lower() not in current_lower]
            if added:
                enrichment["investor_geo_focus"] = current + added
                changes["investor_geo_focus_added"] = added

    # investor_sectors ← sector (new field)
    if sbu_data.get("sector"):
        current = enrichment.get("investor_sectors", "")
        if force or not current:
            enrichment["investor_sectors"] = sbu_data["sector"]
            if current != sbu_data["sector"]:
                changes["investor_sectors"] = sbu_data["sector"]

    # investor_labels ← labels (new field, e.g. ["Infrastructure Fund", "Renewables"])
    if sbu_data.get("labels"):
        current = enrichment.get("investor_labels")
        if force or not current:
            enrichment["investor_labels"] = sbu_data["labels"]
            changes["investor_labels"] = sbu_data["labels"]

    # sbu_type_market_role ← type_market_role (new field, e.g. "Investor")
    if sbu_data.get("type_market_role"):
        current = enrichment.get("sbu_type_market_role", "")
        if force or not current:
            enrichment["sbu_type_market_role"] = sbu_data["type_market_role"]
            if current != sbu_data["type_market_role"]:
                changes["sbu_type_market_role"] = sbu_data["type_market_role"]

    # Market roles: report discrepancy, merge if missing
    if sbu_data.get("market_roles"):
        current_mr = enrichment.get("mr", [])
        new_mr = sbu_data["market_roles"]
        if not current_mr:
            enrichment["mr"] = new_mr
            changes["mr"] = new_mr
        else:
            # Check for discrepancy
            current_set = {r.lower() for r in current_mr}
            new_set = {r.lower() for r in new_mr}
            if current_set != new_set:
                changes["mr_discrepancy"] = {
                    "current": current_mr,
                    "airtable": new_mr,
                }

    if changes:
        enrichment["_sbu_enriched_at"] = datetime.now(timezone.utc).isoformat()
        enrichment["_sbu_source"] = "airtable_sbu"

    return changes


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------
def load_companies():
    """Load companies_full.json."""
    paths = get_data_paths(PROJECT_DIR)
    full_path = paths["full"]
    if not os.path.exists(full_path):
        print(f"  [error] {full_path} not found")
        sys.exit(1)
    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data, paths


def save_companies(data, paths):
    """Write companies_full.json and companies.json."""
    with open(paths["full"], "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    compact = export_to_compact(data["companies"])
    with open(paths["compact"], "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

    print(f"  Written {paths['full']}")
    print(f"  Written {paths['compact']}")


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------
def write_report(report_rows, output_path):
    """Write CSV report of matching and enrichment results."""
    fieldnames = [
        "airtable_name", "matched_domain", "match_type", "match_score",
        "fields_enriched", "discrepancies", "company_name_in_json",
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(report_rows)
    print(f"  Report written to {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Enrich companies from Airtable SBU")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, don't write")
    parser.add_argument("--force", action="store_true", help="Overwrite existing fields")
    parser.add_argument("--report", action="store_true", help="Generate CSV report")
    args = parser.parse_args()

    if not AIRTABLE_PAT:
        print("[error] Set AIRTABLE_PAT or VITE_AIRTABLE_PAT env var")
        sys.exit(1)

    print("=" * 60)
    print("  Enrich from Airtable Stakeholders_Business_Units")
    print("=" * 60)
    if args.dry_run:
        print("  MODE: dry-run (no writes)")
    if args.force:
        print("  MODE: force (overwrite existing)")
    print()

    # 1. Load companies
    print("[1/4] Loading companies_full.json...")
    data, paths = load_companies()
    companies = data.get("companies", {})
    print(f"  {len(companies)} companies loaded")

    # 2. Fetch Airtable records
    print(f"\n[2/4] Fetching {TABLE_NAME} from Airtable...")
    records = fetch_all_sbu_records()

    # 3. Build name→domain map and match
    print("\n[3/4] Matching Airtable records to companies...")
    name_map = build_name_to_domain_map(companies)
    print(f"  Name map: {len(name_map)} entries")

    matched = 0
    fuzzy_matched = 0
    unmatched = 0
    enriched_count = 0
    total_field_changes = 0
    discrepancies = []
    report_rows = []

    for rec in records:
        fields = rec.get("fields", {})
        airtable_name = fields.get("Business Unit Name", "").strip()
        if not airtable_name:
            continue

        # Try exact match first
        norm = normalize_name(airtable_name)
        domain = name_map.get(norm) or name_map.get(airtable_name.lower().strip())
        match_type = "exact"
        match_score = 1.0

        # Fuzzy match if no exact match
        if not domain:
            domain, match_score = fuzzy_match(airtable_name, name_map)
            match_type = "fuzzy" if domain else "none"

        if domain:
            if match_type == "exact":
                matched += 1
            else:
                fuzzy_matched += 1

            company = companies[domain]
            enrichment = company.setdefault("enrichment", {})
            sbu_data = extract_sbu_fields(fields)
            changes = enrich_company(enrichment, sbu_data, force=args.force)

            if changes:
                enriched_count += 1
                n_changes = sum(1 for k in changes if not k.endswith("_discrepancy"))
                total_field_changes += n_changes

            if "mr_discrepancy" in changes:
                discrepancies.append({
                    "domain": domain,
                    "name": airtable_name,
                    "current_mr": changes["mr_discrepancy"]["current"],
                    "airtable_mr": changes["mr_discrepancy"]["airtable"],
                })

            if args.report:
                report_rows.append({
                    "airtable_name": airtable_name,
                    "matched_domain": domain,
                    "match_type": match_type,
                    "match_score": f"{match_score:.2f}",
                    "fields_enriched": ", ".join(k for k in changes if not k.endswith("_discrepancy")),
                    "discrepancies": "mr mismatch" if "mr_discrepancy" in changes else "",
                    "company_name_in_json": company.get("name", ""),
                })
        else:
            unmatched += 1
            if args.report:
                report_rows.append({
                    "airtable_name": airtable_name,
                    "matched_domain": "",
                    "match_type": "none",
                    "match_score": f"{match_score:.2f}",
                    "fields_enriched": "",
                    "discrepancies": "",
                    "company_name_in_json": "",
                })

    # Print summary
    print(f"\n  --- Matching Results ---")
    print(f"  Exact matches:  {matched}")
    print(f"  Fuzzy matches:  {fuzzy_matched}")
    print(f"  Unmatched:      {unmatched}")
    print(f"  Companies enriched: {enriched_count}")
    print(f"  Total field changes: {total_field_changes}")

    if discrepancies:
        print(f"\n  --- Market Role Discrepancies ({len(discrepancies)}) ---")
        for d in discrepancies[:20]:
            print(f"  {d['domain']}: current={d['current_mr']} vs airtable={d['airtable_mr']}")
        if len(discrepancies) > 20:
            print(f"  ... and {len(discrepancies) - 20} more")

    # Print some unmatched for review
    if unmatched > 0:
        unmatched_names = [r["airtable_name"] for r in report_rows if r.get("match_type") == "none"][:15]
        if unmatched_names:
            print(f"\n  --- Sample Unmatched ({min(15, unmatched)}/{unmatched}) ---")
            for name in unmatched_names:
                print(f"  - {name}")

    # 4. Save
    print(f"\n[4/4] Saving...")
    if args.dry_run:
        print("  Skipped (dry-run mode)")
    elif enriched_count > 0:
        save_companies(data, paths)
    else:
        print("  No changes to save")

    if args.report:
        report_path = os.path.join(PROJECT_DIR, "sbu_enrichment_report.csv")
        write_report(report_rows, report_path)

    print("\nDone!")


if __name__ == "__main__":
    main()
