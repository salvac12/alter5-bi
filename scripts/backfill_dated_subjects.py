"""
Backfill dated_subjects and quarterly summaries from v2_final Excel files.

Reads "Datos Brutos" (email-level) and "Linea Temporal" (quarterly summaries)
from each Excel, merges into companies_full.json, and re-exports companies.json.

Usage:
    python scripts/backfill_dated_subjects.py
"""

import json
import os
import sys

import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from import_mailbox import get_data_paths, export_to_compact

EXCEL_FILES = [
    "/Users/salvadorcarrillo/Downloads/analisis_salva_v2_final.xlsx",
    "/Users/salvadorcarrillo/Downloads/analisis_guillermo_v2_final.xlsx",
    "/Users/salvadorcarrillo/Downloads/analisis_leticia_v2_final.xlsx",
]


def extract_dated_subjects(excel_path):
    """Extract dated_subjects from 'Datos Brutos' sheet.

    Returns dict of domain -> [[date, subject], ...]
    """
    print(f"  Reading Datos Brutos from {os.path.basename(excel_path)}...")
    df = pd.read_excel(excel_path, sheet_name="Datos Brutos")

    by_domain = {}
    for _, row in df.iterrows():
        domain = str(row.get("Dominio", "")).strip().lower()
        fecha = str(row.get("Fecha", ""))[:10]
        asunto = str(row.get("Asunto", "")).strip()

        if not domain or domain == "nan" or not fecha or fecha == "nan" or not asunto or asunto == "nan":
            continue

        by_domain.setdefault(domain, []).append([fecha, asunto])

    # Sort by date and deduplicate by subject
    for domain in by_domain:
        entries = sorted(by_domain[domain], key=lambda x: x[0])
        seen = set()
        deduped = []
        for date, subj in entries:
            if subj not in seen:
                deduped.append([date, subj])
                seen.add(subj)
        by_domain[domain] = deduped[:30]

    print(f"    -> {len(by_domain)} domains, {sum(len(v) for v in by_domain.values())} dated subjects")
    return by_domain


def extract_quarterly_summaries(excel_path):
    """Extract quarterly summaries from 'Linea Temporal' sheet.

    Returns dict of domain -> {quarter: summary}
    """
    print(f"  Reading Linea Temporal from {os.path.basename(excel_path)}...")
    df = pd.read_excel(excel_path, sheet_name="Linea Temporal")

    by_domain = {}
    for _, row in df.iterrows():
        domain = str(row.get("Dominio", "")).strip().lower()
        quarter = str(row.get("Trimestre", "")).strip()
        summary = str(row.get("Resumen de Actividad", "")).strip()

        if not domain or domain == "nan" or not quarter or quarter == "nan":
            continue
        if not summary or summary == "nan":
            continue

        by_domain.setdefault(domain, {})[quarter] = summary[:100]

    print(f"    -> {len(by_domain)} domains with quarterly summaries")
    return by_domain


def main():
    print("=" * 60)
    print("  Backfill: dated_subjects + quarterly summaries")
    print("=" * 60)
    print()

    paths = get_data_paths(PROJECT_DIR)

    # 1. Load existing companies_full.json
    full_path = paths["full"]
    if not os.path.exists(full_path):
        print(f"  Error: {full_path} not found")
        sys.exit(1)

    with open(full_path, "r", encoding="utf-8") as f:
        full_data = json.load(f)

    all_companies = full_data.get("companies", {})
    print(f"  Existing: {len(all_companies)} companies")
    print()

    # 2. Extract from all Excel files
    all_dated = {}
    all_summaries = {}

    for excel_path in EXCEL_FILES:
        if not os.path.exists(excel_path):
            print(f"  WARNING: {excel_path} not found, skipping")
            continue

        dated = extract_dated_subjects(excel_path)
        summaries = extract_quarterly_summaries(excel_path)

        # Merge dated_subjects (combine across mailboxes, deduplicate)
        for domain, entries in dated.items():
            existing = all_dated.get(domain, [])
            seen = {e[1] for e in existing}
            for entry in entries:
                if entry[1] not in seen:
                    existing.append(entry)
                    seen.add(entry[1])
            all_dated[domain] = sorted(existing, key=lambda x: x[0])[:30]

        # Merge quarterly summaries (later file overwrites, which is fine)
        for domain, quarters in summaries.items():
            all_summaries.setdefault(domain, {}).update(quarters)

        print()

    print(f"  Total: {len(all_dated)} domains with dated subjects")
    print(f"  Total: {len(all_summaries)} domains with quarterly summaries")
    print()

    # 3. Merge into companies_full.json
    ds_updated = 0
    qs_updated = 0

    for domain, company in all_companies.items():
        # Merge dated_subjects
        if domain in all_dated:
            old = company.get("dated_subjects", [])
            seen = {e[1] for e in old}
            for entry in all_dated[domain]:
                if entry[1] not in seen:
                    old.append(entry)
                    seen.add(entry[1])
            company["dated_subjects"] = sorted(old, key=lambda x: x[0])[:30]
            ds_updated += 1

        # Merge quarterly summaries into timeline
        if domain in all_summaries:
            for t in company.get("timeline", []):
                q = t["quarter"]
                if q in all_summaries[domain] and not t.get("summary"):
                    t["summary"] = all_summaries[domain][q]
            qs_updated += 1

    print(f"  Updated dated_subjects: {ds_updated} companies")
    print(f"  Updated quarterly summaries: {qs_updated} companies")

    # 4. Save
    print()
    print("  Writing files...")

    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)
    print(f"  -> {full_path}")

    compact = export_to_compact(all_companies)
    with open(paths["compact"], "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  -> {paths['compact']}")

    print()
    print("  Done! Run npm run preview to see the changes.")
    print()


if __name__ == "__main__":
    main()
