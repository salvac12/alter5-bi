#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Enrich CRM companies from Spain scraper data
===============================================================

Loads scraper_projects.json (5,652 projects) and spv_parent_mapping.json
(2,531 SPV→parent), aggregates by parent company, and cross-references
with companies_full.json using fuzzy name matching.

Injects a 'scraper' field into each matched company's enrichment.

Usage:
  python scripts/enrich_from_scraper.py
  python scripts/enrich_from_scraper.py --dry-run
"""

import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "data")

SCRAPER_FILE = os.path.join(DATA_DIR, "scraper_projects.json")
MAPPING_FILE = os.path.join(DATA_DIR, "spv_parent_mapping.json")
COMPANIES_FULL = os.path.join(DATA_DIR, "companies_full.json")
COMPANIES_COMPACT = os.path.join(DATA_DIR, "companies.json")


def normalize(s):
    """Normalize string for fuzzy matching: lowercase, strip accents, remove legal suffixes."""
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[\u0300-\u036f]", "", s)  # strip accents
    s = s.lower().strip()
    # Remove common legal suffixes
    s = re.sub(r"\b(s\.?l\.?u?\.?|s\.?a\.?|s\.?l\.?l\.?|sociedad limitada|sociedad anonima)\b", "", s)
    # Remove punctuation
    s = re.sub(r"[,.\-()\"']", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_float(v):
    """Parse a numeric value, returning 0 if invalid."""
    if v is None:
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def load_data():
    """Load scraper projects, SPV mapping, and CRM companies."""
    with open(SCRAPER_FILE, "r", encoding="utf-8") as f:
        projects = json.load(f)
    print(f"  Loaded {len(projects)} scraper projects")

    with open(MAPPING_FILE, "r", encoding="utf-8") as f:
        spv_mapping = json.load(f)
    print(f"  Loaded {len(spv_mapping)} SPV→parent mappings")

    with open(COMPANIES_FULL, "r", encoding="utf-8") as f:
        full_data = json.load(f)
    companies = full_data.get("companies", full_data)
    print(f"  Loaded {len(companies)} CRM companies")

    return projects, spv_mapping, full_data, companies


def resolve_parent(project, spv_mapping):
    """Resolve a project's parent company name. Returns (parent_name, source)."""
    company = project.get("companyName", "")
    spv = project.get("nombreSPV", "")
    empresa_matriz = project.get("empresaMatriz", "")

    # Check SPV mapping first
    if company and company in spv_mapping:
        return spv_mapping[company]["parent"], "spv"
    if spv and spv in spv_mapping:
        return spv_mapping[spv]["parent"], "spv"

    # empresaMatriz field from scraper (sometimes has parent name directly)
    # But it's usually just an ID number, skip if numeric
    if empresa_matriz and not empresa_matriz.isdigit():
        return empresa_matriz, "empresaMatriz"

    # Use company name directly (skip generic/unknown)
    if company and company.lower() not in ("unknown", "self", "desconocido", ""):
        return company, "direct"

    return None, None


def aggregate_by_parent(projects, spv_mapping):
    """Aggregate projects by resolved parent company."""
    parent_data = defaultdict(lambda: {
        "projects": [],
        "mw_total": 0,
        "mwp_total": 0,
        "capex_eur": 0,
        "technologies": set(),
        "statuses": set(),
        "spv_names": set(),
        "company_names": set(),
    })

    SKIP_PARENTS = {"unknown", "self", "desconocido", ""}
    unresolved = 0
    for p in projects:
        parent, source = resolve_parent(p, spv_mapping)
        if not parent or parent.lower() in SKIP_PARENTS:
            unresolved += 1
            continue

        d = parent_data[parent]
        mw = parse_float(p.get("mw"))
        mwp = parse_float(p.get("mwp"))
        capex = parse_float(p.get("capex"))
        tech = p.get("technology", "")
        status = p.get("status", "")

        d["projects"].append({
            "name": p.get("ProjectName", ""),
            "mw": mw,
            "mwp": mwp,
            "tech": tech,
            "status": status,
            "spv": p.get("companyName", ""),
            "province": p.get("province", ""),
        })
        d["mw_total"] += mw
        d["mwp_total"] += mwp
        d["capex_eur"] += capex
        if tech:
            d["technologies"].add(tech)
        if status:
            d["statuses"].add(status)
        company_name = p.get("companyName", "")
        if company_name and company_name != parent:
            d["spv_names"].add(company_name)
        d["company_names"].add(company_name)

    print(f"  Aggregated into {len(parent_data)} parent companies ({unresolved} unresolved)")
    return parent_data


def match_crm(parent_data, companies):
    """Match aggregated scraper parents to CRM companies by fuzzy name."""
    # Build normalized lookup for CRM
    crm_by_norm = {}
    crm_by_domain = {}
    for domain, company in companies.items():
        name = company.get("name", "")
        if name:
            n = normalize(name)
            if n and n not in crm_by_norm:
                crm_by_norm[n] = domain
        crm_by_domain[domain] = name

    # Also build a set of normalized CRM names for partial matching
    crm_norm_list = list(crm_by_norm.items())

    matched = 0
    match_details = {}

    for parent_name, data in parent_data.items():
        pn = normalize(parent_name)
        if not pn:
            continue

        domain = None
        match_source = None

        # 1. Exact normalized match
        if pn in crm_by_norm:
            domain = crm_by_norm[pn]
            match_source = "exact"
        else:
            # 2. Partial match: CRM name contains parent or vice versa
            # Require minimum token length to avoid false positives like "cisco" in "francisco"
            best_match = None
            best_len = 0
            for crm_norm, crm_domain in crm_norm_list:
                if len(crm_norm) < 5 or len(pn) < 5:
                    continue
                # Only match if one fully contains the other as a word boundary
                # Use the shorter one as the needle
                shorter = pn if len(pn) <= len(crm_norm) else crm_norm
                longer = crm_norm if len(pn) <= len(crm_norm) else pn
                # Check word-boundary containment (space or start/end)
                idx_found = longer.find(shorter)
                if idx_found == -1:
                    continue
                # Verify it's at a word boundary
                at_start = idx_found == 0 or longer[idx_found - 1] == " "
                at_end = (idx_found + len(shorter) == len(longer)) or longer[idx_found + len(shorter)] == " "
                if not (at_start and at_end):
                    continue
                match_len = len(shorter)
                if match_len > best_len:
                    best_len = match_len
                    best_match = crm_domain
            if best_match and best_len >= 5:
                domain = best_match
                match_source = "partial"

        if not domain:
            # 3. Try matching SPV/company names from projects
            for spv_name in data["company_names"]:
                sn = normalize(spv_name)
                if sn in crm_by_norm:
                    domain = crm_by_norm[sn]
                    match_source = "spv"
                    break

        if domain:
            matched += 1
            match_details[domain] = {
                "parent_name": parent_name,
                "match_source": match_source,
                "data": data,
            }

    print(f"  Matched {matched} parents to CRM companies (out of {len(parent_data)})")
    return match_details


def inject_enrichment(companies, match_details, dry_run=False):
    """Inject scraper data into company enrichment."""
    injected = 0
    for domain, match in match_details.items():
        if domain not in companies:
            continue

        data = match["data"]
        company = companies[domain]

        if isinstance(company, dict):
            enrichment = company.get("enrichment", {})
            if enrichment is None:
                enrichment = {}

            # Build scraper enrichment
            projects_list = []
            for p in sorted(data["projects"], key=lambda x: x["mw"], reverse=True):
                projects_list.append({
                    "name": p["name"],
                    "mw": round(p["mw"], 1),
                    "tech": p["tech"],
                    "status": p["status"],
                    "spv": p["spv"],
                })

            scraper = {
                "n_projects": len(data["projects"]),
                "mw_total": round(data["mw_total"], 1),
                "mwp_total": round(data["mwp_total"], 1),
                "capex_eur": round(data["capex_eur"]),
                "technologies": sorted(data["technologies"]),
                "statuses": sorted(data["statuses"]),
                "n_spvs": len(data["spv_names"]),
                "spv_names": sorted(data["spv_names"])[:50],  # cap at 50
                "projects": projects_list[:200],  # cap at 200
                "matched_parent": match["parent_name"],
                "match_source": match["match_source"],
            }

            enrichment["scraper"] = scraper
            company["enrichment"] = enrichment
            companies[domain] = company
            injected += 1

    print(f"  Injected scraper data into {injected} companies")
    return injected


def regenerate_compact(companies):
    """Regenerate companies.json (compact format) from companies_full.json."""
    # companies.json has format: { "r": [...records], "d": {...details} }
    # We need to read the existing compact file to understand the index mapping

    with open(COMPANIES_COMPACT, "r", encoding="utf-8") as f:
        compact = json.load(f)

    # Map domain -> index in compact format
    domain_to_idx = {}
    for i, r in enumerate(compact["r"]):
        domain = r[1]  # domain is at index 1
        domain_to_idx[domain] = i

    # Update enrichment (index 5 in detail array) for matched companies
    updated = 0
    for domain, company in companies.items():
        if domain not in domain_to_idx:
            continue
        idx = str(domain_to_idx[domain])
        if idx not in compact["d"]:
            continue

        enrichment = company.get("enrichment")
        if enrichment and enrichment.get("scraper"):
            detail = compact["d"][idx]
            # detail[5] is enrichment
            while len(detail) < 6:
                detail.append(None)
            if detail[5] is None:
                detail[5] = {}
            detail[5]["scraper"] = enrichment["scraper"]
            compact["d"][idx] = detail
            updated += 1

    print(f"  Updated {updated} entries in compact format")
    return compact


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("DRY RUN - no files will be written\n")

    print("Step 1: Loading data...")
    projects, spv_mapping, full_data, companies = load_data()

    print("\nStep 2: Aggregating by parent company...")
    parent_data = aggregate_by_parent(projects, spv_mapping)

    # Print top parents by MW
    top = sorted(parent_data.items(), key=lambda x: x[1]["mw_total"], reverse=True)[:15]
    print("\n  Top 15 parents by MW:")
    for name, d in top:
        techs = ", ".join(d["technologies"]) if d["technologies"] else "n/a"
        print(f"    {name}: {len(d['projects'])} projects, {d['mw_total']:.0f} MW, {len(d['spv_names'])} SPVs [{techs}]")

    print("\nStep 3: Matching to CRM companies...")
    match_details = match_crm(parent_data, companies)

    # Print some example matches
    examples = sorted(match_details.items(), key=lambda x: x[1]["data"]["mw_total"], reverse=True)[:10]
    print("\n  Top 10 matched companies by MW:")
    for domain, m in examples:
        name = companies[domain].get("name", domain)
        print(f"    {name} ({domain}): {m['data']['mw_total']:.0f} MW, {len(m['data']['projects'])} projects [{m['match_source']}]")

    print("\nStep 4: Injecting enrichment...")
    injected = inject_enrichment(companies, match_details, dry_run)

    if dry_run:
        print("\nDry run complete. No files written.")
        return

    print("\nStep 5: Writing companies_full.json...")
    # companies dict is already mutated in-place inside full_data
    with open(COMPANIES_FULL, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False)
    print(f"  Written {COMPANIES_FULL}")

    print("\nStep 6: Regenerating companies.json (compact)...")
    compact = regenerate_compact(companies)
    with open(COMPANIES_COMPACT, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False)
    print(f"  Written {COMPANIES_COMPACT}")

    print(f"\nDone! Enriched {injected} companies with scraper data.")


if __name__ == "__main__":
    main()
