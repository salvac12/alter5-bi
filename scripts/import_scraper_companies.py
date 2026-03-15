#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Import unmatched scraper companies into CRM
===============================================================

Finds all parent companies from the scraper that are NOT in the CRM
and creates new CRM entries for them, enriched with scraper data
and inferred classifications.

Usage:
  python scripts/import_scraper_companies.py
  python scripts/import_scraper_companies.py --dry-run
"""

import json
import os
import re
import sys
import tempfile
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "data")

SCRAPER_FILE = os.path.join(DATA_DIR, "scraper_projects.json")
MAPPING_FILE = os.path.join(DATA_DIR, "spv_parent_mapping.json")
COMPANIES_FULL = os.path.join(DATA_DIR, "companies_full.json")
COMPANIES_COMPACT = os.path.join(DATA_DIR, "companies.json")

SKIP_PARENTS = {"unknown", "self", "desconocido", ""}


def _atomic_json_write(path, data, **kwargs):
    """Write JSON to a file atomically using temp file + os.replace."""
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, **kwargs)
        os.replace(tmp_path, path)
    except BaseException:
        os.unlink(tmp_path)
        raise


def normalize(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[\u0300-\u036f]", "", s)
    s = s.lower().strip()
    s = re.sub(r"\b(s\.?l\.?u?\.?|s\.?a\.?|s\.?l\.?l\.?|sociedad limitada|sociedad anonima)\b", "", s)
    s = re.sub(r"[,.\-()\"']", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def slugify(name):
    """Generate a pseudo-domain from a company name."""
    s = normalize(name)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    # Remove trailing empty segments
    s = re.sub(r"-+", "-", s)
    if len(s) > 40:
        s = s[:40].rstrip("-")
    return f"{s}.scraper.es"


def parse_float(v):
    if v is None:
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def resolve_parent(project, spv_mapping):
    company = project.get("companyName", "")
    spv = project.get("nombreSPV", "")
    if company and company in spv_mapping:
        return spv_mapping[company]["parent"]
    if spv and spv in spv_mapping:
        return spv_mapping[spv]["parent"]
    if company and company.lower() not in SKIP_PARENTS:
        return company
    return None


def infer_classification(parent_name, techs, mw_total, n_projects, statuses):
    """Infer role, segment, type, market roles from scraper data."""
    role = "Originación"
    segment = "Project Finance"

    # Infer company type
    if n_projects >= 10 or mw_total >= 500:
        tp2 = "Developer"
    elif any(s in ("AAC", "DIA") for s in statuses):
        tp2 = "Developer"
    else:
        tp2 = "Developer"

    # Infer market roles
    mr = []
    if mw_total >= 100:
        mr.append("Sponsor")
    if n_projects >= 5:
        mr.append("Developer")
    if not mr:
        mr.append("Developer")

    # Infer technologies
    tech_list = sorted(techs)

    # Infer geography
    geo = ["España"]

    # Infer business lines
    business_lines = []
    if "fotovoltaica" in techs:
        business_lines.append("Utility-scale developer")
    if "eólica" in techs:
        business_lines.append("Utility-scale developer")

    # Infer project scale
    if mw_total >= 1000:
        project_scale = "Gran escala (>1 GW)"
    elif mw_total >= 100:
        project_scale = "Escala media (100 MW - 1 GW)"
    elif mw_total >= 10:
        project_scale = "Escala pequena (10-100 MW)"
    else:
        project_scale = "Micro (<10 MW)"

    # Commercial phase
    has_advanced = any(s in ("AAC", "DIA") for s in statuses)
    has_early = any(s in ("AAP", "DUP") for s in statuses)
    if has_advanced and has_early:
        fc = "Pipeline activo"
    elif has_advanced:
        fc = "Proyectos maduros"
    elif has_early:
        fc = "En desarrollo"
    else:
        fc = "Pipeline activo"

    return {
        "role": role,
        "segment": segment,
        "tp2": tp2,
        "mr": mr,
        "tech": tech_list,
        "geo": geo,
        "fc": fc,
        "business_lines": business_lines,
        "project_scale": project_scale,
    }


def build_context(parent_name, techs, mw_total, n_projects, n_spvs, statuses, top_projects):
    """Generate a context description from scraper data."""
    tech_str = " y ".join(sorted(techs)) if techs else "renovable"

    parts = [
        f"{parent_name} es un desarrollador de energía {tech_str} en España",
        f"con {n_projects} proyectos registrados ({mw_total:,.0f} MW totales).",
    ]
    if n_spvs > 0:
        parts.append(f"Opera a través de {n_spvs} SPVs.")

    status_str = []
    if statuses:
        status_map = {
            "AAP": "Autorización Administrativa Previa",
            "DUP": "Declaración de Utilidad Pública",
            "AAC": "Autorización Administrativa de Construcción",
            "DIA": "Declaración de Impacto Ambiental",
        }
        for s in sorted(statuses):
            full = status_map.get(s, s)
            parts.append(f"Tiene proyectos en fase {s} ({full}).")

    if top_projects:
        top = sorted(top_projects, key=lambda p: p["mw"], reverse=True)[:3]
        names = [f"{p['name']} ({p['mw']:.0f} MW)" for p in top if p["mw"] > 0]
        if names:
            parts.append(f"Proyectos destacados: {', '.join(names)}.")

    return " ".join(parts)


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("DRY RUN - no files will be written\n")

    print("Loading data...")
    with open(SCRAPER_FILE, "r", encoding="utf-8") as f:
        projects = json.load(f)
    with open(MAPPING_FILE, "r", encoding="utf-8") as f:
        spv_mapping = json.load(f)
    with open(COMPANIES_FULL, "r", encoding="utf-8") as f:
        full_data = json.load(f)
    with open(COMPANIES_COMPACT, "r", encoding="utf-8") as f:
        compact = json.load(f)

    companies = full_data["companies"]
    print(f"  {len(projects)} projects, {len(spv_mapping)} mappings, {len(companies)} CRM companies")

    # Aggregate by parent
    print("\nAggregating by parent...")
    parent_data = defaultdict(lambda: {
        "projects": [],
        "mw_total": 0,
        "mwp_total": 0,
        "capex_eur": 0,
        "technologies": set(),
        "statuses": set(),
        "spv_names": set(),
        "provinces": set(),
    })

    for p in projects:
        parent = resolve_parent(p, spv_mapping)
        if not parent or parent.lower() in SKIP_PARENTS:
            continue
        d = parent_data[parent]
        mw = parse_float(p.get("mw"))
        mwp = parse_float(p.get("mwp"))
        capex = parse_float(p.get("capex"))
        tech = p.get("technology", "")
        status = p.get("status", "")
        company_name = p.get("companyName", "")

        d["projects"].append({
            "name": p.get("ProjectName", ""),
            "mw": mw,
            "mwp": mwp,
            "tech": tech,
            "status": status,
            "spv": company_name,
            "province": p.get("province", ""),
        })
        d["mw_total"] += mw
        d["mwp_total"] += mwp
        d["capex_eur"] += capex
        if tech:
            d["technologies"].add(tech)
        if status:
            d["statuses"].add(status)
        if company_name and company_name != parent:
            d["spv_names"].add(company_name)
        prov = p.get("province", "")
        if prov:
            d["provinces"].add(prov)

    print(f"  {len(parent_data)} parent companies")

    # Build CRM normalized name index
    crm_norms = set()
    crm_domains = set()
    for domain, c in companies.items():
        crm_domains.add(domain)
        n = normalize(c.get("name", ""))
        if n:
            crm_norms.add(n)

    # Find unmatched parents
    def is_matched(parent_name):
        pn = normalize(parent_name)
        if pn in crm_norms:
            return True
        for cn in crm_norms:
            if len(cn) >= 5 and len(pn) >= 5:
                shorter = pn if len(pn) <= len(cn) else cn
                longer = cn if len(pn) <= len(cn) else pn
                idx = longer.find(shorter)
                if idx != -1:
                    at_s = idx == 0 or longer[idx - 1] == " "
                    at_e = (idx + len(shorter) == len(longer)) or longer[idx + len(shorter)] == " "
                    if at_s and at_e and len(shorter) >= 5:
                        return True
        # Check SPV names
        data = parent_data[parent_name]
        for p in data["projects"]:
            sn = normalize(p.get("spv", ""))
            if sn and sn in crm_norms:
                return True
        return False

    unmatched = {}
    for parent_name, data in parent_data.items():
        if not is_matched(parent_name):
            unmatched[parent_name] = data

    print(f"\n  Unmatched (to add): {len(unmatched)}")

    # Create new CRM entries
    now = datetime.now(timezone.utc).isoformat()
    new_count = 0
    skipped_domains = 0

    for parent_name, data in sorted(unmatched.items(), key=lambda x: x[1]["mw_total"], reverse=True):
        domain = slugify(parent_name)

        # Ensure unique domain
        if domain in crm_domains:
            # Add a suffix
            base = domain.replace(".scraper.es", "")
            for suffix in range(2, 10):
                candidate = f"{base}-{suffix}.scraper.es"
                if candidate not in crm_domains:
                    domain = candidate
                    break
            else:
                skipped_domains += 1
                continue

        techs = data["technologies"]
        statuses = data["statuses"]
        mw_total = data["mw_total"]
        n_projects = len(data["projects"])
        n_spvs = len(data["spv_names"])

        # Infer classification
        classification = infer_classification(
            parent_name, techs, mw_total, n_projects, statuses
        )

        # Build scraper enrichment block
        projects_list = []
        for p in sorted(data["projects"], key=lambda x: x["mw"], reverse=True):
            projects_list.append({
                "name": p["name"],
                "mw": round(p["mw"], 1),
                "tech": p["tech"],
                "status": p["status"],
                "spv": p["spv"],
            })

        scraper_block = {
            "n_projects": n_projects,
            "mw_total": round(mw_total, 1),
            "mwp_total": round(data["mwp_total"], 1),
            "capex_eur": round(data["capex_eur"]),
            "technologies": sorted(techs),
            "statuses": sorted(statuses),
            "n_spvs": n_spvs,
            "spv_names": sorted(data["spv_names"])[:50],
            "projects": projects_list[:200],
            "matched_parent": parent_name,
            "match_source": "new_import",
        }

        # Build enrichment
        enrichment = {
            "_tv": 2,
            "_source": "scraper_import",
            "_classified_at": now,
            "grp": classification["role"],
            "role": classification["role"],
            "tp2": classification["tp2"],
            "tp": classification["tp2"],
            "mr": classification["mr"],
            "fc": classification["fc"],
            "sc": [],
            "tech": classification["tech"],
            "geo": classification["geo"],
            "business_lines": classification["business_lines"],
            "project_scale": classification["project_scale"],
            "known_pipeline_mw": round(mw_total),
            "scraper": scraper_block,
        }

        # Build context
        context = build_context(
            parent_name, techs, mw_total, n_projects, n_spvs, statuses,
            data["projects"]
        )

        # Determine sector string
        tech_labels = []
        for t in sorted(techs):
            if "fotovoltaica" in t:
                tech_labels.append("Solar")
            elif "eólica" in t or "eolica" in t:
                tech_labels.append("Eólica")
        sector = "Renovables / " + " / ".join(sorted(set(tech_labels))) if tech_labels else "Renovables"

        # Create company entry for companies_full.json
        company_entry = {
            "name": parent_name,
            "domain": domain,
            "sectors": sector,
            "nContacts": 0,
            "interactions": 0,
            "relType": "Originación",
            "firstDate": "",
            "lastDate": "",
            "context": context,
            "contacts": [],
            "timeline": [],
            "sources": [],
            "enrichment": enrichment,
            "dated_subjects": [],
            "subjects": [],
            "snippets": [],
        }

        companies[domain] = company_entry
        crm_domains.add(domain)

        # Add to compact format
        record = [
            parent_name,  # name
            domain,       # domain
            sector,       # sectors
            0,            # nContacts
            0,            # interactions
            "Originación",  # relType
            "",           # firstDate
            "",           # lastDate
            "",           # employeeSources
        ]
        idx = len(compact["r"])
        compact["r"].append(record)
        compact["d"][str(idx)] = [
            [],            # contacts
            [],            # timeline
            context,       # context
            [],            # sources
            [],            # subjects
            enrichment,    # enrichment
            [],            # datedSubjects
        ]

        new_count += 1

    print(f"\n  Created {new_count} new CRM entries")
    if skipped_domains > 0:
        print(f"  Skipped {skipped_domains} due to domain conflicts")

    # Stats
    mw_added = sum(d["mw_total"] for d in unmatched.values())
    proj_added = sum(len(d["projects"]) for d in unmatched.values())
    print(f"  Total MW added: {mw_added:,.0f}")
    print(f"  Total projects added: {proj_added}")
    print(f"  New CRM total: {len(companies)} companies")

    if dry_run:
        print("\nDry run complete. No files written.")
        # Show top 20
        top = sorted(unmatched.items(), key=lambda x: x[1]["mw_total"], reverse=True)[:20]
        print("\nTop 20 new companies:")
        for name, d in top:
            techs = ", ".join(sorted(d["technologies"])) or "n/a"
            print(f"  {name}: {len(d['projects'])} proy, {d['mw_total']:,.0f} MW [{techs}]")
        return

    print("\nWriting companies_full.json...")
    _atomic_json_write(COMPANIES_FULL, full_data, indent=2)

    print("Writing companies.json...")
    _atomic_json_write(COMPANIES_COMPACT, compact, separators=(",", ":"))

    print(f"\nDone! Added {new_count} new companies to the CRM.")


if __name__ == "__main__":
    main()
