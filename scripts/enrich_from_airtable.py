#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Enriquecer datos locales con Airtable (read-only)
===============================================================

  Cruza empresas locales con Airtable Stakeholders_Companies +
  Business_Units y enriquece los datos locales con informacion
  factual del CRM (Target Company, Trust Level, Tax ID, etc.).

  READ-ONLY en Airtable: solo hace GET requests.

  Principio: Airtable aporta datos factuales del CRM.
  Local aporta inteligencia de emails. La clasificacion local
  (role, segment, type) NO se toca.

  Usage:
    export AIRTABLE_PAT="patXXX..."  (o VITE_AIRTABLE_PAT)

    python scripts/enrich_from_airtable.py                     # ejecutar enrichment
    python scripts/enrich_from_airtable.py --dry-run            # preview sin escribir
    python scripts/enrich_from_airtable.py --json report.json   # exportar JSON de cambios
    python scripts/enrich_from_airtable.py --skip-new           # no crear empresas nuevas
===============================================================
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths & imports from sibling scripts
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from import_mailbox import get_data_paths, export_to_compact
from analyze_originacion_gaps import (
    load_pat,
    normalize_name,
    extract_domain_from_url,
    fetch_airtable_paginated,
    load_local_companies,
    fetch_stakeholder_companies,
    fetch_business_units,
    parse_airtable_companies,
    match_companies,
    resolve_bus_to_companies,
    _strip_accents,
    AT_ROLE_TO_LOCAL,
)

# ---------------------------------------------------------------------------
# Enrich matched companies (Category A + B)
# ---------------------------------------------------------------------------
def enrich_matched(matched, bus_by_company_id, local_by_domain):
    """
    For each matched company, write at_* fields (Category A)
    and complement empty local fields (Category B).

    Returns (counters_dict, changes_list).
    """
    counters = {
        # Category A
        "at_target": 0,
        "at_trust_level": 0,
        "at_tax_id": 0,
        "at_legal_name": 0,
        "at_hq_country": 0,
        "at_notes": 0,
        "at_focus_region": 0,
        "at_record_id": 0,
        # Category B
        "emp_count_filled": 0,
        "ticket_size_filled": 0,
        "geo_merged": 0,
        "mr_merged": 0,
    }
    changes = []

    for atc, local_domain, match_type in matched:
        co = local_by_domain.get(local_domain)
        if not co:
            continue

        enr = co.setdefault("enrichment", {})
        bus = bus_by_company_id.get(atc["record_id"], [])
        change = {"domain": local_domain, "name": atc["name"], "fields": []}

        # -- Category A: Factual data (always write) --

        # AT Record ID
        enr["at_record_id"] = atc["record_id"]
        counters["at_record_id"] += 1

        # Target Company
        target = atc.get("target", "")
        if target:
            enr["at_target"] = True
            counters["at_target"] += 1
            change["fields"].append("at_target")
        else:
            enr["at_target"] = False

        # Trust Level: aggregate from BUs (take highest)
        trust_levels = []
        for bu in bus:
            tl = bu.get("Trust Level")
            if tl is not None:
                try:
                    trust_levels.append(float(tl))
                except (ValueError, TypeError):
                    pass
        if trust_levels:
            # AT stores 0.0-1.0, we store 0-100
            enr["at_trust_level"] = round(max(trust_levels) * 100)
            counters["at_trust_level"] += 1
            change["fields"].append("at_trust_level")

        # Tax ID
        tax_id = atc.get("tax_id", "")
        if tax_id:
            enr["at_tax_id"] = tax_id
            counters["at_tax_id"] += 1
            change["fields"].append("at_tax_id")

        # Legal Name
        legal_name = atc.get("legal_name", "")
        if legal_name:
            enr["at_legal_name"] = legal_name
            counters["at_legal_name"] += 1
            change["fields"].append("at_legal_name")

        # HQ Country (may be lookup text or linked record IDs)
        hq_country = atc.get("hq_country", [])
        if isinstance(hq_country, list) and hq_country:
            # If values look like record IDs (start with "rec"), skip
            first = str(hq_country[0])
            if not first.startswith("rec"):
                enr["at_hq_country"] = first
                counters["at_hq_country"] += 1
                change["fields"].append("at_hq_country")
        elif isinstance(hq_country, str) and hq_country:
            enr["at_hq_country"] = hq_country
            counters["at_hq_country"] += 1
            change["fields"].append("at_hq_country")

        # Strategic Notes (from BUs)
        notes_parts = []
        for bu in bus:
            n = bu.get("Strategic Notes", "")
            if n and isinstance(n, str):
                bu_name = bu.get("Business Unit Name", "")
                prefix = f"[{bu_name}] " if bu_name else ""
                notes_parts.append(prefix + n.strip())
        if notes_parts:
            enr["at_notes"] = "\n\n".join(notes_parts)
            counters["at_notes"] += 1
            change["fields"].append("at_notes")

        # Focus Region (from BUs, union)
        focus_regions = set()
        for bu in bus:
            fr = bu.get("Focus Region", [])
            if isinstance(fr, list):
                focus_regions.update(fr)
            elif isinstance(fr, str) and fr:
                focus_regions.add(fr)
        if focus_regions:
            enr["at_focus_region"] = sorted(focus_regions)
            counters["at_focus_region"] += 1
            change["fields"].append("at_focus_region")

        # -- Category B: Complement without overwriting --

        # Num Employees -> emp_count (only if empty)
        if not enr.get("emp_count") and atc.get("num_employees"):
            try:
                emp = int(atc["num_employees"])
                if emp > 0:
                    enr["emp_count"] = emp
                    counters["emp_count_filled"] += 1
                    change["fields"].append("emp_count")
            except (ValueError, TypeError):
                pass

        # Ticket Size from BUs -> ticket_size (only if empty)
        if not enr.get("ticket_size"):
            ticket_min_all = []
            ticket_max_all = []
            for bu in bus:
                tmin = bu.get("Ticket Size Minimum")
                tmax = bu.get("Ticket Size Maximum")
                if tmin is not None:
                    try:
                        ticket_min_all.append(float(tmin))
                    except (ValueError, TypeError):
                        pass
                if tmax is not None:
                    try:
                        ticket_max_all.append(float(tmax))
                    except (ValueError, TypeError):
                        pass
            if ticket_min_all or ticket_max_all:
                lo = min(ticket_min_all) if ticket_min_all else None
                hi = max(ticket_max_all) if ticket_max_all else None
                if lo is not None and hi is not None:
                    enr["ticket_size"] = f"{lo:.0f}-{hi:.0f} M\u20ac"
                elif hi is not None:
                    enr["ticket_size"] = f"hasta {hi:.0f} M\u20ac"
                elif lo is not None:
                    enr["ticket_size"] = f"desde {lo:.0f} M\u20ac"
                counters["ticket_size_filled"] += 1
                change["fields"].append("ticket_size")

        # Focus Countries from BUs -> geo (union, no overwrite)
        focus_countries = set()
        for bu in bus:
            fc = bu.get("Focus_Countries_Name", [])
            if isinstance(fc, list):
                focus_countries.update(c for c in fc if isinstance(c, str))
            elif isinstance(fc, str) and fc:
                focus_countries.add(fc)
        if focus_countries:
            existing_geo = set(enr.get("geo", []) or [])
            new_geo = focus_countries - existing_geo
            if new_geo:
                merged = sorted(existing_geo | focus_countries)
                enr["geo"] = merged
                counters["geo_merged"] += 1
                change["fields"].append(f"geo(+{len(new_geo)})")

        # Market_Role_Names from BUs -> mr (union, no overwrite)
        market_roles = set()
        for bu in bus:
            mrs = bu.get("Market_Role_Names", [])
            if isinstance(mrs, list):
                market_roles.update(r for r in mrs if isinstance(r, str))
            elif isinstance(mrs, str) and mrs:
                market_roles.add(mrs)
        if market_roles:
            existing_mr = set(enr.get("mr", []) or [])
            new_mr = market_roles - existing_mr
            if new_mr:
                merged = sorted(existing_mr | market_roles)
                enr["mr"] = merged
                counters["mr_merged"] += 1
                change["fields"].append(f"mr(+{len(new_mr)})")

        # Timestamp
        enr["_at_enriched_at"] = datetime.now(timezone.utc).isoformat()

        if change["fields"]:
            changes.append(change)

    return counters, changes


# ---------------------------------------------------------------------------
# Create new companies from AT (Category D)
# ---------------------------------------------------------------------------
def create_new_companies(at_unmatched, bus_by_company_id):
    """
    For AT companies without local match that have a Home URL,
    create a new local company entry with basic data.

    Returns (new_companies_dict, no_url_count).
    """
    new_companies = {}
    no_url = 0

    for atc in at_unmatched:
        domain = atc.get("domain", "")
        if not domain:
            no_url += 1
            continue

        # Skip if domain already created in this batch
        if domain in new_companies:
            continue

        bus = bus_by_company_id.get(atc["record_id"], [])

        # Map AT role to local role
        local_role = "No relevante"
        for r in atc.get("market_roles", []):
            mapped = AT_ROLE_TO_LOCAL.get(r)
            if mapped:
                local_role = mapped
                break

        # Build enrichment
        enr = {
            "_tv": 2,
            "_source": "airtable",
            "_at_enriched_at": datetime.now(timezone.utc).isoformat(),
            "role": local_role,
            "at_record_id": atc["record_id"],
        }

        # Target
        if atc.get("target", ""):
            enr["at_target"] = True

        # Trust Level
        trust_levels = []
        for bu in bus:
            tl = bu.get("Trust Level")
            if tl is not None:
                try:
                    trust_levels.append(float(tl))
                except (ValueError, TypeError):
                    pass
        if trust_levels:
            enr["at_trust_level"] = round(max(trust_levels) * 100)

        # Tax ID, Legal Name
        if atc.get("tax_id"):
            enr["at_tax_id"] = atc["tax_id"]
        if atc.get("legal_name"):
            enr["at_legal_name"] = atc["legal_name"]

        # HQ Country
        hq = atc.get("hq_country", [])
        if isinstance(hq, list) and hq and not str(hq[0]).startswith("rec"):
            enr["at_hq_country"] = str(hq[0])
        elif isinstance(hq, str) and hq:
            enr["at_hq_country"] = hq

        # BU-level data
        notes_parts = []
        focus_regions = set()
        focus_countries = set()
        market_roles = set()
        ticket_min_all = []
        ticket_max_all = []

        for bu in bus:
            n = bu.get("Strategic Notes", "")
            if n:
                bu_name = bu.get("Business Unit Name", "")
                prefix = f"[{bu_name}] " if bu_name else ""
                notes_parts.append(prefix + n.strip())

            fr = bu.get("Focus Region", [])
            if isinstance(fr, list):
                focus_regions.update(fr)
            elif isinstance(fr, str) and fr:
                focus_regions.add(fr)

            fc = bu.get("Focus_Countries_Name", [])
            if isinstance(fc, list):
                focus_countries.update(c for c in fc if isinstance(c, str))

            mrs = bu.get("Market_Role_Names", [])
            if isinstance(mrs, list):
                market_roles.update(r for r in mrs if isinstance(r, str))

            tmin = bu.get("Ticket Size Minimum")
            tmax = bu.get("Ticket Size Maximum")
            if tmin is not None:
                try:
                    ticket_min_all.append(float(tmin))
                except (ValueError, TypeError):
                    pass
            if tmax is not None:
                try:
                    ticket_max_all.append(float(tmax))
                except (ValueError, TypeError):
                    pass

        if notes_parts:
            enr["at_notes"] = "\n\n".join(notes_parts)
        if focus_regions:
            enr["at_focus_region"] = sorted(focus_regions)
        if focus_countries:
            enr["geo"] = sorted(focus_countries)
        if market_roles:
            enr["mr"] = sorted(market_roles)
        if ticket_min_all or ticket_max_all:
            lo = min(ticket_min_all) if ticket_min_all else None
            hi = max(ticket_max_all) if ticket_max_all else None
            if lo is not None and hi is not None:
                enr["ticket_size"] = f"{lo:.0f}-{hi:.0f} M\u20ac"
            elif hi is not None:
                enr["ticket_size"] = f"hasta {hi:.0f} M\u20ac"
            elif lo is not None:
                enr["ticket_size"] = f"desde {lo:.0f} M\u20ac"

        # Num employees
        if atc.get("num_employees"):
            try:
                emp = int(atc["num_employees"])
                if emp > 0:
                    enr["emp_count"] = emp
            except (ValueError, TypeError):
                pass

        # Build company entry
        new_companies[domain] = {
            "name": atc.get("name", domain),
            "domain": domain,
            "sectors": "",
            "nContacts": 0,
            "interactions": 0,
            "relType": "",
            "firstDate": "",
            "lastDate": "",
            "context": "",
            "contacts": [],
            "timeline": [],
            "sources": {},
            "enrichment": enr,
            "dated_subjects": [],
            "subjects": [],
            "snippets": [],
        }

    return new_companies, no_url


# ---------------------------------------------------------------------------
# Report mismatches (Category C — no correction)
# ---------------------------------------------------------------------------
def report_mismatches(matched, local_by_domain):
    """Report classification mismatches between AT and local (informational only)."""
    mismatches = []
    for atc, local_domain, match_type in matched:
        co = local_by_domain.get(local_domain, {})
        enr = co.get("enrichment", {})
        local_role = enr.get("role", "")
        if not local_role:
            continue

        at_roles = atc.get("market_roles", [])
        at_local_roles = set()
        for ar in at_roles:
            mapped = AT_ROLE_TO_LOCAL.get(ar)
            if mapped:
                at_local_roles.add(mapped)
        if not at_local_roles:
            continue

        local_norm = _strip_accents(local_role)
        at_norm = {_strip_accents(r) for r in at_local_roles}
        if local_norm not in at_norm:
            mismatches.append({
                "domain": local_domain,
                "name": atc["name"],
                "at_roles": at_roles,
                "local_role": local_role,
            })
    return mismatches


# ---------------------------------------------------------------------------
# Save results
# ---------------------------------------------------------------------------
def save_results(all_companies, employees, dry_run):
    """Write companies_full.json + companies.json (compact)."""
    paths = get_data_paths(PROJECT_DIR)

    if dry_run:
        print("\n  [DRY RUN] No se escriben archivos.")
        return

    # companies_full.json
    full_data = {"companies": all_companies, "employees": employees}
    with open(paths["full"], "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)
    print(f"  Escrito: {paths['full']}")

    # companies.json (compact)
    compact = export_to_compact(all_companies)
    with open(paths["compact"], "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  Escrito: {paths['compact']}")


# ---------------------------------------------------------------------------
# Print report
# ---------------------------------------------------------------------------
def print_summary(counters, changes, new_count, no_url, mismatches, matched_total):
    print()
    print("=" * 70)
    print("  ENRICHMENT DESDE AIRTABLE — RESUMEN")
    print("=" * 70)

    print(f"\n  Empresas matched: {matched_total}")
    print(f"  Empresas con cambios: {len(changes)}")

    print("\n  Categoria A (datos factuales nuevos):")
    for key in ["at_target", "at_trust_level", "at_tax_id", "at_legal_name",
                 "at_hq_country", "at_notes", "at_focus_region", "at_record_id"]:
        val = counters.get(key, 0)
        if val > 0:
            print(f"    {key:<25} {val:>5}")

    print("\n  Categoria B (complementar sin sobreescribir):")
    for key in ["emp_count_filled", "ticket_size_filled", "geo_merged", "mr_merged"]:
        val = counters.get(key, 0)
        if val > 0:
            print(f"    {key:<25} {val:>5}")

    print(f"\n  Categoria D (empresas nuevas): {new_count}")
    if no_url > 0:
        print(f"    Sin URL (no creadas):   {no_url}")

    if mismatches:
        print(f"\n  Mismatches de clasificacion (sin corregir): {len(mismatches)}")
        shown = mismatches[:20]
        print(f"    {'Domain':<30} {'AT':<25} {'Local':<15}")
        print(f"    {'─'*30} {'─'*25} {'─'*15}")
        for m in shown:
            d = m["domain"][:29]
            at = ", ".join(m["at_roles"])[:24]
            loc = m["local_role"][:14]
            print(f"    {d:<30} {at:<25} {loc:<15}")
        if len(mismatches) > 20:
            print(f"    ... y {len(mismatches) - 20} mas")

    print()
    print("=" * 70)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Enriquecer datos locales con Airtable (read-only en AT)"
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview sin escribir archivos")
    parser.add_argument("--json", metavar="FILE",
                        help="Exportar JSON detallado de cambios")
    parser.add_argument("--skip-new", action="store_true",
                        help="No crear empresas nuevas, solo enricher existentes")
    args = parser.parse_args()

    pat = load_pat()
    if not pat:
        print("ERROR: AIRTABLE_PAT no configurado (env, VITE_AIRTABLE_PAT, o .env)")
        sys.exit(1)

    # Load local data
    print("Cargando datos...")
    local_by_domain, local_by_name, _originacion_domains = load_local_companies()

    # Load full JSON to get employees list
    paths = get_data_paths(PROJECT_DIR)
    with open(paths["full"], "r", encoding="utf-8") as f:
        full_raw = json.load(f)
    employees = full_raw.get("employees", [])

    # Use local_by_domain as our working companies dict
    all_companies = local_by_domain

    # Fetch Airtable data (read-only)
    at_raw = fetch_stakeholder_companies(pat)
    bu_raw = fetch_business_units(pat)

    # Parse & match
    at_parsed = parse_airtable_companies(at_raw)
    bus_by_company_id = resolve_bus_to_companies(bu_raw, at_raw)

    print("\nMatching empresas...")
    matched, at_unmatched = match_companies(at_parsed, local_by_domain, local_by_name)
    print(f"  Matched: {len(matched)}, AT sin match: {len(at_unmatched)}")

    # Enrich matched (Category A + B)
    print("\nEnriqueciendo empresas matched...")
    counters, changes = enrich_matched(matched, bus_by_company_id, all_companies)

    # Create new companies (Category D)
    new_count = 0
    no_url = 0
    if not args.skip_new:
        print("Creando empresas nuevas desde AT...")
        # Filter to Capital Seeker only (most relevant for pipeline)
        cs_unmatched = [a for a in at_unmatched if "Capital Seeker" in a.get("market_roles", [])]
        new_companies, no_url = create_new_companies(cs_unmatched, bus_by_company_id)
        new_count = len(new_companies)
        all_companies.update(new_companies)
        print(f"  Creadas: {new_count}, Sin URL: {no_url}")
    else:
        print("  --skip-new: no se crean empresas nuevas")

    # Report mismatches (Category C)
    mismatches = report_mismatches(matched, all_companies)

    # Print summary
    print_summary(counters, changes, new_count, no_url, mismatches, len(matched))

    # Save
    print("Guardando archivos...")
    save_results(all_companies, employees, args.dry_run)

    # JSON export
    if args.json:
        report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "matched": len(matched),
            "enriched": len(changes),
            "new_companies": new_count,
            "no_url_skipped": no_url,
            "mismatches": len(mismatches),
            "counters": counters,
            "changes": changes[:200],  # cap for readability
            "mismatch_details": mismatches,
        }
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"  JSON exportado: {args.json}")

    if not args.dry_run:
        total = len(all_companies)
        print(f"\n  Total empresas: {total}")


if __name__ == "__main__":
    main()
