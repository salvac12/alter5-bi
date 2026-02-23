"""
===============================================================
  Alter5 BI — Migración de Taxonomía
===============================================================

  Migra las 3,294 empresas del sistema viejo (6 dimensiones con
  solapamiento) al nuevo sistema simplificado de 4 dimensiones:
    1. Company Group (Capital Seeker / Investor / Services / Other)
    2. Company Type (17 subtipos acotados al grupo)
    3. Deal Stage (solo Capital Seekers, 7 fases)
    4. Market Roles (sin cambios)

  Lee companies_full.json, aplica mapeo, escribe campos nuevos
  en enrichment (grp, tp), regenera companies.json.

  Uso:
    python scripts/migrate_taxonomy.py [--dry-run]
===============================================================
"""

import json
import os
import sys
import argparse
from collections import Counter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import export_to_compact, get_data_paths

# ── New taxonomy values ──

GROUPS = ["Capital Seeker", "Investor", "Services", "Other"]

TYPES_BY_GROUP = {
    "Capital Seeker": ["Developer", "IPP", "Utility", "Asset Owner", "Corporate"],
    "Investor": ["Renewable Fund", "Institutional Investor", "Bank", "Family Office", "Infrastructure Fund"],
    "Services": ["Legal Advisor", "Financial Advisor", "Technical Advisor", "EPC / Contractor", "Consultant", "Platform / Tech"],
    "Other": ["Public Institution", "Association", "Other"],
}

DEAL_STAGES = [
    "Prospect", "Opportunity", "Documentation",
    "TS Preparation", "TS Sent / Discussion", "Signing", "Distribution",
]

# ── Mapping rules ──

# Subtipo (enrichment.st) → Company Type
SUBTIPO_TO_TYPE = {
    "Desarrollador": "Developer",
    "IPP": "IPP",
    "Utility": "Utility",
    "EPC/Proveedor": "EPC / Contractor",
    "Fondo Renovable": "Renewable Fund",
    "Inversor Institucional": "Institutional Investor",
    "Banco/Entidad Financiera": "Bank",
    "Family Office": "Family Office",
    "Administracion Publica": "Public Institution",
    "Plataforma Crowdfunding": "Platform / Tech",
    "Asesor": None,  # needs further classification
    "Otro": None,     # needs further classification
}

# Fase comercial → Deal Stage (only for Capital Seekers)
FASE_TO_STAGE = {
    "Primer contacto": "Prospect",
    "Exploracion": "Opportunity",
    "Negociacion": "TS Preparation",
    "Cliente activo": "Signing",
    "Dormido": "Prospect",
    "Descartado": None,  # removed from pipeline
}

# Sectors that indicate an advisor subtype
ADVISOR_SECTOR_MAP = {
    "Legal": "Legal Advisor",
    "Asesor Financiero": "Financial Advisor",
    "Consultoría": "Consultant",
    "Tecnología": "Platform / Tech",
    "Fintech": "Platform / Tech",
    "Construcción": "EPC / Contractor",
}


def normalize(s):
    """Remove accents for comparison."""
    import unicodedata
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")


def classify_group(co):
    """Determine company group from market roles, relType, and sectors."""
    mr = []
    enrichment = co.get("enrichment") or {}
    if isinstance(enrichment, dict):
        mr = enrichment.get("mr", [])

    rel_type = (co.get("relType") or "").lower()
    sectors = (co.get("sectors") or "").lower()

    # Priority 1: Market roles
    capital_seeker_roles = {"Borrower", "Seller (M&A)"}
    investor_roles = {"Debt Investor", "Equity Investor", "Buyer Investor (M&A)"}
    services_roles = {"Partner & Services"}

    mr_set = set(mr)

    if mr_set & capital_seeker_roles:
        return "Capital Seeker"
    if mr_set & investor_roles:
        return "Investor"
    if mr_set == services_roles and not (mr_set & capital_seeker_roles) and not (mr_set & investor_roles):
        return "Services"

    # Priority 2: relType
    rel_norm = normalize(rel_type)
    if "potencial prestatario" in rel_norm:
        return "Capital Seeker"
    if any(x in rel_norm for x in ["inversor/fondo", "banco"]):
        return "Investor"
    if any(x in rel_norm for x in ["asesor", "proveedor", "consultoria"]):
        return "Services"

    # Priority 3: Sectors
    sec_norm = normalize(sectors)
    if any(x in sec_norm for x in ["renovables", "energia"]):
        return "Capital Seeker"
    if any(x in sec_norm for x in ["banca", "inversor/fondo", "inversion"]):
        return "Investor"
    if any(x in sec_norm for x in ["legal", "consultoria", "tecnologia", "fintech", "construccion"]):
        return "Services"

    return "Other"


def classify_type(co, group):
    """Determine company type from enrichment.st and sectors."""
    enrichment = co.get("enrichment") or {}
    subtipo = ""
    if isinstance(enrichment, dict):
        subtipo = (enrichment.get("st") or "").strip()

    # Handle comma-separated subtipos (take first valid one)
    if "," in subtipo:
        subtipo = subtipo.split(",")[0].strip()

    # Direct mapping from subtipo
    if subtipo and subtipo in SUBTIPO_TO_TYPE:
        mapped = SUBTIPO_TO_TYPE[subtipo]
        if mapped:
            # Verify it belongs to the correct group
            valid_types = TYPES_BY_GROUP.get(group, [])
            if mapped in valid_types:
                return mapped
            # If not valid for this group, try to find the right one
            for g, types in TYPES_BY_GROUP.items():
                if mapped in types:
                    return mapped  # Return anyway, group assignment takes priority

    # For "Asesor" subtipo, determine advisor type from sectors
    if subtipo == "Asesor" and group == "Services":
        sectors = (co.get("sectors") or "")
        for sector_key, advisor_type in ADVISOR_SECTOR_MAP.items():
            if sector_key.lower() in sectors.lower():
                return advisor_type
        return "Financial Advisor"  # default advisor type

    # Infer from sectors if no subtipo
    sectors = (co.get("sectors") or "").lower()
    rel_type = (co.get("relType") or "").lower()

    if group == "Capital Seeker":
        if "utility" in sectors or "utility" in rel_type:
            return "Utility"
        return "Developer"  # default for Capital Seekers

    if group == "Investor":
        if "banca" in sectors or "banco" in rel_type:
            return "Bank"
        if "family office" in rel_type.lower():
            return "Family Office"
        return "Institutional Investor"  # default for Investors

    if group == "Services":
        for sector_key, svc_type in ADVISOR_SECTOR_MAP.items():
            if sector_key.lower() in sectors:
                return svc_type
        if "asesor financiero" in rel_type:
            return "Financial Advisor"
        if "asesor legal" in rel_type:
            return "Legal Advisor"
        if "asesor tecnico" in normalize(rel_type):
            return "Technical Advisor"
        if "proveedor" in rel_type:
            return "EPC / Contractor"
        return "Consultant"  # default for Services

    if group == "Other":
        if "asociacion" in normalize(sectors) or "institucional" in sectors:
            return "Association"
        if "administracion" in normalize(sectors.lower()):
            return "Public Institution"
        return "Other"

    return "Other"


def classify_deal_stage(co, group):
    """Determine deal stage from enrichment.fc (only for Capital Seekers)."""
    if group != "Capital Seeker":
        return None

    enrichment = co.get("enrichment") or {}
    fase = ""
    if isinstance(enrichment, dict):
        fase = (enrichment.get("fc") or "").strip()

    if not fase:
        return "Prospect"  # default for Capital Seekers

    # Handle comma-separated fases (take best one)
    if "," in fase:
        parts = [p.strip() for p in fase.split(",")]
        # Priority: Negociacion > Cliente activo > Exploracion > Primer contacto
        priority = ["Negociacion", "Cliente activo", "Exploracion", "Primer contacto", "Dormido", "Descartado"]
        for p in priority:
            for part in parts:
                if normalize(p) == normalize(part):
                    fase = part
                    break
            else:
                continue
            break
        else:
            fase = parts[0]

    # Normalize for matching
    fase_norm = normalize(fase).lower()

    for old_fase, new_stage in FASE_TO_STAGE.items():
        if normalize(old_fase).lower() == fase_norm:
            return new_stage

    # Fuzzy matching
    if "negociacion" in fase_norm:
        return "TS Preparation"
    if "exploracion" in fase_norm:
        return "Opportunity"
    if "primer" in fase_norm:
        return "Prospect"
    if "activo" in fase_norm:
        return "Signing"
    if "dormido" in fase_norm:
        return "Prospect"
    if "descartado" in fase_norm:
        return None
    if any(x in fase_norm for x in ["networking", "partnership", "otro", "interno"]):
        return "Prospect"

    return "Prospect"


def migrate_company(co):
    """Migrate a single company to the new taxonomy."""
    group = classify_group(co)
    company_type = classify_type(co, group)
    deal_stage = classify_deal_stage(co, group)

    return group, company_type, deal_stage


def main():
    parser = argparse.ArgumentParser(description="Migrar taxonomía de empresas")
    parser.add_argument("--dry-run", action="store_true", help="No escribir archivos")
    args = parser.parse_args()

    paths = get_data_paths(PROJECT_DIR)
    full_path = paths["full"]

    print("=" * 60)
    print("  Alter5 BI — Migración de Taxonomía")
    print("=" * 60)
    print()

    # Load data
    if not os.path.exists(full_path):
        print(f"  Error: {full_path} not found")
        sys.exit(1)

    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_companies = data.get("companies", {})
    employees = data.get("employees", [])
    print(f"  -> {len(all_companies)} empresas cargadas")

    # Migrate each company
    group_counts = Counter()
    type_counts = Counter()
    stage_counts = Counter()
    no_enrichment = 0

    for domain, co in all_companies.items():
        group, company_type, deal_stage = migrate_company(co)

        group_counts[group] += 1
        type_counts[company_type] += 1
        if deal_stage:
            stage_counts[deal_stage] += 1

        # Write new fields to enrichment
        enrichment = co.get("enrichment")
        if not enrichment or not isinstance(enrichment, dict):
            enrichment = {}
            no_enrichment += 1

        enrichment["grp"] = group
        enrichment["tp"] = company_type
        if deal_stage:
            enrichment["ds"] = deal_stage
        elif "ds" in enrichment:
            del enrichment["ds"]

        co["enrichment"] = enrichment

    # Print summary
    print()
    print("  === Company Groups ===")
    for g in GROUPS:
        pct = group_counts[g] / len(all_companies) * 100
        print(f"    {g:20s}: {group_counts[g]:5d} ({pct:.1f}%)")

    print()
    print("  === Company Types (top 10) ===")
    for t, count in type_counts.most_common(10):
        print(f"    {t:25s}: {count:5d}")

    print()
    print("  === Deal Stages (Capital Seekers only) ===")
    for s in DEAL_STAGES:
        print(f"    {s:25s}: {stage_counts.get(s, 0):5d}")

    cs_total = group_counts["Capital Seeker"]
    with_stage = sum(stage_counts.values())
    print(f"    {'(sin stage/descartado)':25s}: {cs_total - with_stage:5d}")

    print()
    print(f"  Empresas sin enrichment previo: {no_enrichment}")
    print(f"  Total con grupo asignado: {sum(group_counts.values())}")

    if args.dry_run:
        print()
        print("  [dry-run] No se escribieron archivos.")
        return

    # Save
    print()
    print("  Guardando archivos...")

    full_data = {"companies": all_companies, "employees": employees}
    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)
    print(f"  -> {full_path}")

    compact = export_to_compact(all_companies)
    with open(paths["compact"], "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  -> {paths['compact']}")

    print()
    print(f"  OK: {len(all_companies)} empresas migradas exitosamente")
    print()


if __name__ == "__main__":
    main()
