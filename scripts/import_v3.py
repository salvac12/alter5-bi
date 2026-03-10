#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
  Alter5 BI — Import v3 (Merge inteligente Excel → JSON)
═══════════════════════════════════════════════════════════════

  USO:
    python scripts/import_v3.py <clasificacion_v3.xlsx>
    python scripts/import_v3.py <clasificacion_v3.xlsx> --dry-run

  QUÉ HACE:
    1. Lee el Excel v3 (4,873 empresas, hoja "Todas las Empresas")
    2. Carga companies_full.json actual (3,947 empresas con historial email)
    3. MERGE inteligente:
       - Empresas existentes: actualiza enrichment + relType, PRESERVA contacts/timeline/subjects/sources
       - Empresas nuevas: crea registro con enrichment, arrays vacíos para historial
    4. Regenera companies.json (compact) y employees.json
    5. Backup automático antes de escribir

  REQUISITOS:
    pip install pandas openpyxl
═══════════════════════════════════════════════════════════════
"""

import json
import os
import re
import shutil
import sys
from datetime import datetime

import pandas as pd

# ── Paths ──
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FULL_FILE = os.path.join(PROJECT_DIR, "src", "data", "companies_full.json")
COMPACT_FILE = os.path.join(PROJECT_DIR, "src", "data", "companies.json")
EMPLOYEES_FILE = os.path.join(PROJECT_DIR, "src", "data", "employees.json")
BACKUP_DIR = os.path.join(PROJECT_DIR, "backups")

# ── Employee ID mapping ──
# IMPORTANT: IDs must match existing data (with tildes)
BUZON_TO_ID = {
    "Salvador Carrillo": "salvador_carrillo",
    "Guillermo Souto": "guillermo_souto",
    "Miguel Solana": "miguel_solana",
    "Javier": "javier_ruiz",
    "Javier Ruiz": "javier_ruiz",
    "Leticia Menéndez": "leticia_menéndez",  # con tilde — matches existing data
    "Rafael Nevado": "rafael_nevado",
    "Carlos Almodovar": "carlos_almodóvar",  # con tilde — matches existing data
    "Gonzalo de Gracia": "gonzalo_de_gracia",
}

BUZON_TO_NAME = {
    "salvador_carrillo": "Salvador Carrillo",
    "guillermo_souto": "Guillermo Souto",
    "miguel_solana": "Miguel Solana",
    "javier_ruiz": "Javier Ruiz",
    "leticia_menéndez": "Leticia Menéndez",
    "rafael_nevado": "Rafael Nevado",
    "carlos_almodóvar": "Carlos Almodóvar",
    "gonzalo_de_gracia": "Gonzalo de Gracia",
}

# ── Group → relType mapping ──
GROUP_TO_RELTYPE = {
    "Investor": "Inversión",
    "Capital Seeker": "Originación",
    "Services": "Services",
    "Other": "Otro",
}


def safe_str(val):
    """Convert value to string safely, returning '' for NaN/None."""
    if pd.isna(val) or val is None:
        return ""
    return str(val).strip()


def parse_pipe_list(val):
    """Parse pipe-separated values into a list."""
    s = safe_str(val)
    if not s:
        return []
    return [x.strip() for x in s.split("|") if x.strip()]


def parse_buzones(val):
    """Parse buzon names into employee IDs (preserving tildes)."""
    names = parse_pipe_list(val)
    ids = []
    for name in names:
        eid = BUZON_TO_ID.get(name.strip())
        if not eid:
            # Fallback: normalize to lowercase with underscores
            eid = name.strip().lower().replace(" ", "_")
        if eid not in ids:
            ids.append(eid)
    return ids


def build_enrichment_v3(row):
    """Build enrichment object from Excel v3 row, using v2-compatible field names."""
    e = {
        "_tv": 2,
        "_source": "excel_v3",
        "_classified_at": datetime.now().isoformat(),
    }

    # Group → role mapping
    group = safe_str(row.get("Group"))
    if group:
        e["grp"] = group
        e["role"] = GROUP_TO_RELTYPE.get(group, "No relevante")

    # Subtipo → tp2 + tp (legacy)
    subtipo = safe_str(row.get("Subtipo"))
    if subtipo and subtipo != "desconocido":
        e["tp2"] = subtipo
        e["tp"] = subtipo  # legacy compat

    # Market Roles
    market_roles = parse_pipe_list(row.get("Market Roles"))
    if market_roles:
        e["mr"] = market_roles

    # Fase Comercial
    fase = safe_str(row.get("Fase Comercial"))
    if fase:
        e["fc"] = fase

    # Señales Clave
    senales = parse_pipe_list(row.get("Señales Clave"))
    if senales:
        e["sc"] = senales[:10]

    # Technologies (for Capital Seekers)
    tecnologias = parse_pipe_list(row.get("Tecnologías"))
    if tecnologias:
        e["tech"] = tecnologias

    # Geography (for Capital Seekers, from Tecnologías column context)
    geo = parse_pipe_list(row.get("Geografías Interés"))
    if geo:
        e["geo"] = geo

    # === Investor-specific fields ===
    ticket = safe_str(row.get("Ticket Size"))
    if ticket and ticket != "desconocido":
        e["ts"] = ticket

    tech_int = parse_pipe_list(row.get("Tecnologías Interés"))
    if tech_int:
        e["tech_int"] = tech_int

    tipo_activo = parse_pipe_list(row.get("Tipo Activo"))
    if tipo_activo:
        e["ta"] = tipo_activo

    criterios = parse_pipe_list(row.get("Criterios Inversión"))
    if criterios:
        e["ci"] = criterios[:8]

    # === Capital Seeker-specific fields ===
    productos = safe_str(row.get("Productos Potenciales"))
    if productos:
        pp = []
        for item in productos.split("|"):
            item = item.strip()
            m = re.match(r"(.+?)\s*\((\w+)\)", item)
            if m:
                pp.append({"p": m.group(1).strip(), "c": m.group(2).strip()})
            elif item:
                pp.append({"p": item, "c": "media"})
        if pp:
            e["pp"] = pp[:5]

    pipeline = safe_str(row.get("Pipeline Info"))
    if pipeline:
        e["pi"] = pipeline[:300]

    # Segment inference (for Originación)
    if group == "Capital Seeker":
        if subtipo in ("Developer", "IPP", "Developer + IPP", "Utility", "Asset Owner"):
            e["seg"] = "Project Finance"
        elif subtipo in ("Corporate",):
            e["seg"] = "Corporate Finance"

    return e


def read_v3_excel(filepath):
    """Read the v3 Excel file and return a dict of companies keyed by domain."""
    df = pd.read_excel(filepath, sheet_name="Todas las Empresas")
    print(f"  -> {len(df)} empresas en el Excel")

    companies = {}

    for _, row in df.iterrows():
        empresa = safe_str(row.get("Empresa"))
        dominio = safe_str(row.get("Dominio"))

        if not empresa or empresa == "nan":
            continue

        key = dominio if dominio else empresa.lower().replace(" ", "-")

        first_date = safe_str(row.get("Primera Interacción"))[:10]
        last_date = safe_str(row.get("Última Interacción"))[:10]

        buzones = parse_buzones(row.get("Buzones"))
        n_emails = int(row["N Emails"]) if pd.notna(row.get("N Emails")) else 0

        enrichment = build_enrichment_v3(row)
        enrichment["_email_count"] = n_emails

        group = safe_str(row.get("Group"))
        rel_type = GROUP_TO_RELTYPE.get(group, "Otro")
        sector = safe_str(row.get("Sector"))
        context = safe_str(row.get("Contexto General"))

        companies[key] = {
            "name": empresa,
            "domain": dominio,
            "sector": sector,
            "n_emails": n_emails,
            "rel_type": rel_type,
            "first_date": first_date,
            "last_date": last_date,
            "context": context,
            "buzones": buzones,
            "enrichment": enrichment,
        }

    return companies


def merge_companies(existing_full, excel_companies):
    """
    Merge Excel v3 data into existing companies_full.json.

    For existing companies: update enrichment + relType, PRESERVE everything else.
    For new companies: create minimal record with enrichment.
    """
    existing = existing_full.get("companies", {})
    stats = {"updated": 0, "new": 0, "skipped": 0, "existing_only": 0}

    merged = {}

    # 1. Process all existing companies
    for domain, company in existing.items():
        merged[domain] = company

    # 2. Merge Excel data
    for key, excel in excel_companies.items():
        if key in merged:
            # === EXISTING COMPANY: merge enrichment, preserve email history ===
            company = merged[key]

            # Update enrichment (full replace with v3 data)
            company["enrichment"] = excel["enrichment"]

            # Update relType
            company["relType"] = excel["rel_type"]

            # Update sector if Excel has one and current doesn't
            if excel["sector"] and not company.get("sectors"):
                company["sectors"] = excel["sector"]

            # Context: keep the longer one
            current_ctx = company.get("context", "")
            excel_ctx = excel["context"]
            if len(excel_ctx) > len(current_ctx):
                company["context"] = excel_ctx

            # Update dates if Excel has broader range
            if excel["first_date"] and (not company.get("firstDate") or excel["first_date"] < company.get("firstDate", "")):
                company["firstDate"] = excel["first_date"]
            if excel["last_date"] and (not company.get("lastDate") or excel["last_date"] > company.get("lastDate", "")):
                company["lastDate"] = excel["last_date"]

            # Update interactions count if Excel has more
            if excel["n_emails"] > company.get("interactions", 0):
                company["interactions"] = excel["n_emails"]

            # Update name if needed (Excel may have cleaner name)
            company["name"] = excel["name"]

            stats["updated"] += 1

        else:
            # === NEW COMPANY: create minimal record ===
            n_emails = excel["n_emails"]
            buzones = excel["buzones"]

            # Build sources with distributed email counts
            n_per_buzon = max(1, n_emails // len(buzones)) if buzones else n_emails
            sources = {}
            for i, eid in enumerate(buzones):
                if i == len(buzones) - 1:
                    count = n_emails - n_per_buzon * (len(buzones) - 1)
                else:
                    count = n_per_buzon
                sources[eid] = {
                    "interactions": max(1, count),
                    "firstDate": excel["first_date"],
                    "lastDate": excel["last_date"],
                    "contacts": [],
                    "timeline": [],
                    "context": excel["context"][:150],
                }

            merged[key] = {
                "name": excel["name"],
                "domain": excel["domain"],
                "sectors": excel["sector"],
                "nContacts": 0,
                "interactions": n_emails,
                "relType": excel["rel_type"],
                "firstDate": excel["first_date"],
                "lastDate": excel["last_date"],
                "context": excel["context"],
                "contacts": [],
                "timeline": [],
                "subjects": [],
                "snippets": [],
                "dated_subjects": [],
                "sources": sources,
                "enrichment": excel["enrichment"],
            }
            stats["new"] += 1

    # Count existing companies not in Excel
    excel_keys = set(excel_companies.keys())
    for domain in existing:
        if domain not in excel_keys:
            stats["existing_only"] += 1

    return merged, stats


def export_to_compact(all_companies):
    """Convert full company dict to compact format for React."""
    sorted_cos = sorted(
        all_companies.values(),
        key=lambda c: c.get("interactions", 0),
        reverse=True,
    )

    records = []
    details = {}

    for i, c in enumerate(sorted_cos):
        records.append([
            c["name"],
            c.get("domain", ""),
            c.get("sectors", ""),
            c.get("nContacts", 0),
            c.get("interactions", 0),
            c.get("relType", ""),
            c.get("firstDate", ""),
            c.get("lastDate", ""),
            ",".join(sorted(c.get("sources", {}).keys())),
        ])

        source_breakdown = [
            [emp_id, s["interactions"]]
            for emp_id, s in sorted(c.get("sources", {}).items())
        ]

        dated_subjects = c.get("dated_subjects", [])

        details[str(i)] = [
            # [0] contacts
            [[ct["name"], ct.get("role", ""), ct.get("email", "")] for ct in c.get("contacts", [])[:5]],
            # [1] timeline
            [[t["quarter"], t["emails"]] + ([t["summary"]] if t.get("summary") else []) for t in c.get("timeline", [])[:8]],
            # [2] context
            c.get("context", "")[:500],
            # [3] source breakdown
            source_breakdown,
            # [4] subjects
            c.get("subjects", [])[:20],
            # [5] enrichment
            c.get("enrichment"),
            # [6] dated_subjects
            dated_subjects[:30] if dated_subjects else None,
        ]

    return {"r": records, "d": details}


def build_employees(all_companies):
    """Build employees.json from merged company data."""
    emp_stats = {}
    for c in all_companies.values():
        for eid in c.get("sources", {}):
            if eid not in emp_stats:
                emp_stats[eid] = 0
            emp_stats[eid] += 1

    employees = []
    for eid in sorted(emp_stats.keys()):
        name = BUZON_TO_NAME.get(eid, eid.replace("_", " ").title())
        employees.append({
            "id": eid,
            "name": name,
            "importedAt": datetime.now().isoformat(),
            "companiesCount": emp_stats[eid],
        })

    return employees


def create_backup():
    """Create timestamped backup of current data files."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    backed_up = []
    for f in [FULL_FILE, COMPACT_FILE, EMPLOYEES_FILE]:
        if os.path.exists(f):
            name = os.path.basename(f)
            dest = os.path.join(BACKUP_DIR, f"{ts}_{name}")
            shutil.copy2(f, dest)
            size_mb = os.path.getsize(dest) / (1024 * 1024)
            backed_up.append(f"  {name} -> {dest} ({size_mb:.1f} MB)")

    return backed_up


def main():
    if len(sys.argv) < 2:
        print("  Uso:  python scripts/import_v3.py <clasificacion_v3.xlsx> [--dry-run]")
        sys.exit(1)

    filepath = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    if not os.path.exists(filepath):
        print(f"  ERROR: No se encuentra: {filepath}")
        sys.exit(1)

    print(f"\n  ══════════════════════════════════════════════════")
    print(f"  Alter5 BI — Import v3 {'(DRY RUN)' if dry_run else ''}")
    print(f"  ══════════════════════════════════════════════════")
    print(f"\n  Excel: {filepath}")

    # 1. Read Excel v3
    print(f"\n  [1/5] Leyendo Excel v3...")
    excel_companies = read_v3_excel(filepath)

    # 2. Load existing data
    print(f"\n  [2/5] Cargando companies_full.json actual...")
    if os.path.exists(FULL_FILE):
        with open(FULL_FILE, "r", encoding="utf-8") as f:
            existing_full = json.load(f)
        print(f"  -> {len(existing_full.get('companies', {}))} empresas existentes")
    else:
        print(f"  -> No existe companies_full.json, creando desde cero")
        existing_full = {"companies": {}, "employees": []}

    # 3. Merge
    print(f"\n  [3/5] Merge inteligente...")
    merged, stats = merge_companies(existing_full, excel_companies)

    # Stats
    print(f"\n  Resultados del merge:")
    print(f"    Actualizadas (enrichment):  {stats['updated']}")
    print(f"    Nuevas (del Excel):         {stats['new']}")
    print(f"    Solo en actual (sin Excel): {stats['existing_only']}")
    print(f"    Total final:                {len(merged)}")

    # Group distribution
    groups = {}
    for c in merged.values():
        e = c.get("enrichment") or {}
        role = e.get("role") or c.get("relType", "Otro")
        groups[role] = groups.get(role, 0) + 1
    print(f"\n  Distribución por role:")
    for g, count in sorted(groups.items(), key=lambda x: -x[1]):
        print(f"    {g}: {count}")

    # Enrichment source distribution
    sources_dist = {"excel_v3": 0, "other": 0}
    for c in merged.values():
        e = c.get("enrichment") or {}
        if e.get("_source") == "excel_v3":
            sources_dist["excel_v3"] += 1
        else:
            sources_dist["other"] += 1
    print(f"\n  Enrichment source:")
    print(f"    Excel v3:  {sources_dist['excel_v3']}")
    print(f"    Original:  {sources_dist['other']}")

    if dry_run:
        print(f"\n  [DRY RUN] No se escriben ficheros.")
        print(f"  Ejecuta sin --dry-run para aplicar los cambios.")
        return

    # 4. Backup
    print(f"\n  [4/5] Creando backup...")
    backed_up = create_backup()
    for line in backed_up:
        print(line)

    # 5. Save
    print(f"\n  [5/5] Guardando ficheros...")

    # companies_full.json
    full_data = {"companies": merged, "employees": build_employees(merged)}
    with open(FULL_FILE, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)
    size_mb = os.path.getsize(FULL_FILE) / (1024 * 1024)
    print(f"    companies_full.json: {len(merged)} empresas ({size_mb:.1f} MB)")

    # companies.json (compact)
    compact = export_to_compact(merged)
    with open(COMPACT_FILE, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))
    size_mb = os.path.getsize(COMPACT_FILE) / (1024 * 1024)
    print(f"    companies.json: {len(compact['r'])} records ({size_mb:.1f} MB)")

    # employees.json
    employees = build_employees(merged)
    with open(EMPLOYEES_FILE, "w", encoding="utf-8") as f:
        json.dump(employees, f, ensure_ascii=False, indent=2)
    print(f"    employees.json: {len(employees)} buzones")

    print(f"\n  ══════════════════════════════════════════════════")
    print(f"  Import completado: {len(merged)} empresas")
    print(f"  Backup en: {BACKUP_DIR}/")
    print(f"  Haz commit + push para desplegar en Vercel.")
    print(f"  ══════════════════════════════════════════════════\n")


if __name__ == "__main__":
    main()
