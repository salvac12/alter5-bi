"""
═══════════════════════════════════════════════════════════════
  Alter5 BI — Importador de buzones de correo
═══════════════════════════════════════════════════════════════

  USO:
    python scripts/import_mailbox.py <archivo.xlsx> <nombre_empleado> [--email EMAIL]

  EJEMPLOS:
    python scripts/import_mailbox.py data_sources/guillermo_souto.xlsx "Guillermo Souto"
    python scripts/import_mailbox.py data_sources/miguel.xlsx "Miguel Solana" --email miguel.solana@alter-5.com

  QUÉ HACE:
    1. Lee el Excel (misma estructura que el original)
    2. Extrae empresas, contactos y timeline
    3. Lee columnas extra del Excel como seed de enrichment
    4. Fusiona con los datos existentes en src/data/companies.json
    5. Enriquece empresas NUEVAS con Gemini (taxonomía v2)
    6. Registra el buzón en la Google Sheet (tab employees + config)
    7. Actualiza el manifest .imported.json

  REQUISITOS:
    pip install pandas openpyxl google-generativeai gspread google-auth
═══════════════════════════════════════════════════════════════
"""

import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
IMPORTED_MANIFEST = os.path.join(PROJECT_DIR, "data_sources", ".imported.json")


def get_data_paths(project_dir=None):
    """Return paths to the three data files. Accepts override for CI environments."""
    base = project_dir or PROJECT_DIR
    return {
        "compact": os.path.join(base, "src", "data", "companies.json"),
        "full": os.path.join(base, "src", "data", "companies_full.json"),
        "employees": os.path.join(base, "src", "data", "employees.json"),
    }


# Default paths (used by main() and legacy callers)
_paths = get_data_paths()
COMPACT_FILE = _paths["compact"]
FULL_FILE = _paths["full"]
EMPLOYEES_FILE = _paths["employees"]


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


def _safe_str(val, pd):
    """Return stripped string or '' if NaN."""
    if pd.isna(val):
        return ""
    return str(val).strip()


def read_excel(filepath):
    """Parse an employee mailbox Excel into structured data."""
    import pandas as pd
    xls = pd.ExcelFile(filepath)

    # Read sheets
    df_companies = pd.read_excel(xls, sheet_name="Resumen por Empresa")
    df_contacts = pd.read_excel(xls, sheet_name="Clasificacion IA")
    df_timeline = pd.read_excel(xls, sheet_name="Linea Temporal")

    # Index contacts and timeline by company name
    contacts_by_co = {}
    for _, row in df_contacts.iterrows():
        empresa = str(row.get("Empresa", "")).strip()
        if not empresa or empresa == "nan":
            continue
        email_val = row.get("Email", "")
        contacts_by_co.setdefault(empresa, []).append({
            "name": str(row.get("Contacto", "")),
            "email": str(email_val) if pd.notna(email_val) and str(email_val) != "nan" else "",
            "role": str(row.get("Cargo Estimado", "")),
        })

    timeline_by_co = {}
    for _, row in df_timeline.iterrows():
        empresa = str(row.get("Empresa", "")).strip()
        if not empresa or empresa == "nan":
            continue
        timeline_by_co.setdefault(empresa, []).append({
            "quarter": str(row.get("Trimestre", "")),
            "emails": int(row["Nº Emails"]) if pd.notna(row.get("Nº Emails")) else 0,
        })

    # Read "Datos Brutos" sheet if present (for subjects/snippets)
    raw_data_by_co = {}
    if "Datos Brutos" in xls.sheet_names:
        df_raw = pd.read_excel(xls, sheet_name="Datos Brutos")
        for _, row in df_raw.iterrows():
            empresa = _safe_str(row.get("Empresa", ""), pd)
            if not empresa:
                continue
            entry = raw_data_by_co.setdefault(empresa, {"subjects": [], "snippets": [], "dated_subjects": []})
            subject = _safe_str(row.get("Subject", row.get("Asunto", "")), pd)
            snippet = _safe_str(row.get("Snippet", row.get("Extracto", "")), pd)
            date_str = _safe_str(row.get("Date", row.get("Fecha", "")), pd)[:10]
            if subject and subject not in entry["subjects"]:
                entry["subjects"].append(subject)
            if snippet and snippet not in entry["snippets"]:
                entry["snippets"].append(snippet)
            if subject and date_str:
                entry["dated_subjects"].append([date_str, subject, snippet[:150] if snippet else ""])

    # Build company records
    companies = {}
    for _, row in df_companies.iterrows():
        name = str(row.get("Empresa", "")).strip()
        if not name or name == "nan":
            continue

        domain = str(row.get("Dominio", "")) if pd.notna(row.get("Dominio")) else ""

        company = {
            "name": name,
            "domain": domain,
            "sectors": str(row.get("Sector", "")) if pd.notna(row.get("Sector")) else "",
            "nContacts": int(row["Nº Contactos"]) if pd.notna(row.get("Nº Contactos")) else 0,
            "interactions": int(row["Total Interacciones"]) if pd.notna(row.get("Total Interacciones")) else 0,
            "relType": str(row.get("Tipo Relación", "")) if pd.notna(row.get("Tipo Relación")) else "",
            "firstDate": str(row.get("Primera Interacción", ""))[:10],
            "lastDate": str(row.get("Última Interacción", ""))[:10],
            "context": (str(row.get("Contexto General", ""))[:150] if pd.notna(row.get("Contexto General")) else ""),
            "contacts": [{"name": c["name"], "email": c.get("email", ""), "role": c["role"]} for c in contacts_by_co.get(name, [])[:5]],
            "timeline": [{"quarter": t["quarter"], "emails": t["emails"]} for t in timeline_by_co.get(name, [])[:8]],
        }

        # Add raw data (subjects, snippets, dated_subjects)
        raw = raw_data_by_co.get(name, {})
        if raw.get("subjects"):
            company["subjects"] = raw["subjects"][:20]
        if raw.get("snippets"):
            company["snippets"] = raw["snippets"][:15]
        if raw.get("dated_subjects"):
            company["dated_subjects"] = sorted(raw["dated_subjects"], key=lambda x: x[0])[-30:]

        # Read extra columns as enrichment seed
        seed = {}
        for col, key in [
            ("Ticket Size", "ticket_size"),
            ("Geografías Interés", "geo"),
            ("Tecnologías Interés", "tech"),
            ("Tipo Activo", "tipo_activo"),
            ("Criterios Inversión", "criterios"),
            ("Pipeline Info", "pipeline_info"),
        ]:
            val = _safe_str(row.get(col, ""), pd)
            if val:
                seed[key] = val
        if seed:
            company["_enrichment_seed"] = seed

        companies[domain or name.lower().replace(" ", "-")] = company

    return companies


def load_existing_data():
    """Load existing companies_full.json or return empty structure."""
    if os.path.exists(FULL_FILE):
        with open(FULL_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"companies": {}, "employees": []}


def load_employees():
    """Load employees registry."""
    if os.path.exists(EMPLOYEES_FILE):
        with open(EMPLOYEES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def merge_company(existing, new_data, employee_id):
    """Merge a new employee's data into an existing company record."""
    if not existing:
        # New company — initialize with employee source
        new_data["sources"] = {employee_id: {
            "interactions": new_data["interactions"],
            "firstDate": new_data["firstDate"],
            "lastDate": new_data["lastDate"],
            "contacts": new_data["contacts"],
            "timeline": new_data["timeline"],
            "context": new_data["context"],
        }}
        # Preserve subjects/snippets at top level
        if "subjects" not in new_data:
            new_data["subjects"] = []
        if "snippets" not in new_data:
            new_data["snippets"] = []
        return new_data

    # Existing company — merge data
    if "sources" not in existing:
        existing["sources"] = {}

    existing["sources"][employee_id] = {
        "interactions": new_data["interactions"],
        "firstDate": new_data["firstDate"],
        "lastDate": new_data["lastDate"],
        "contacts": new_data["contacts"],
        "timeline": new_data["timeline"],
        "context": new_data["context"],
    }

    # Merge subjects and snippets (deduplicate, keep latest)
    old_subjects = existing.get("subjects", [])
    new_subjects = new_data.get("subjects", [])
    seen = set(old_subjects)
    for s in new_subjects:
        if s not in seen:
            old_subjects.append(s)
            seen.add(s)
    existing["subjects"] = old_subjects[:30]

    # Merge dated_subjects [date, subject, extract] (deduplicate by subject, sort by date)
    old_ds = existing.get("dated_subjects", [])
    new_ds = new_data.get("dated_subjects", [])
    seen_ds = {s[1] for s in old_ds}
    for ds in new_ds:
        if ds[1] not in seen_ds:
            old_ds.append(ds)
            seen_ds.add(ds[1])
    existing["dated_subjects"] = sorted(old_ds, key=lambda x: x[0])[-30:]

    old_snippets = existing.get("snippets", [])
    new_snippets = new_data.get("snippets", [])
    existing["snippets"] = list({s: None for s in old_snippets + new_snippets}.keys())[:15]

    # Recalculate aggregates across all employee sources
    all_interactions = sum(s["interactions"] for s in existing["sources"].values())
    valid_firsts = [s["firstDate"] for s in existing["sources"].values() if s.get("firstDate")]
    valid_lasts = [s["lastDate"] for s in existing["sources"].values() if s.get("lastDate")]
    all_first = min(valid_firsts) if valid_firsts else ""
    all_last = max(valid_lasts) if valid_lasts else ""

    # Merge unique contacts by email (preserve nombre/apellido if available)
    # Iterate sources by lastDate descending so most recently active contacts appear first
    seen_emails = {}  # email -> index in all_contacts
    all_contacts = []
    for s in sorted(existing["sources"].values(), key=lambda x: x.get("lastDate", ""), reverse=True):
        for c in s.get("contacts", []):
            email = c.get("email", "")
            key = email or c["name"]  # fallback to name if no email
            if key not in seen_emails:
                seen_emails[key] = len(all_contacts)
                entry = {"name": c["name"], "email": email, "role": c.get("role", "")}
                # Preserve nombre/apellido fields
                if c.get("nombre"):
                    entry["nombre"] = c["nombre"]
                if c.get("apellido"):
                    entry["apellido"] = c["apellido"]
                if c.get("_system"):
                    entry["_system"] = c["_system"]
                if c.get("_name_source"):
                    entry["_name_source"] = c["_name_source"]
                if c.get("_name_confidence"):
                    entry["_name_confidence"] = c["_name_confidence"]
                all_contacts.append(entry)
            else:
                idx = seen_emails[key]
                # Update fields if current entry is missing them
                if not all_contacts[idx].get("role") and c.get("role"):
                    all_contacts[idx]["role"] = c["role"]
                if not all_contacts[idx].get("nombre") and c.get("nombre"):
                    all_contacts[idx]["nombre"] = c["nombre"]
                if not all_contacts[idx].get("apellido") and c.get("apellido"):
                    all_contacts[idx]["apellido"] = c["apellido"]

    # Merge timelines (sum emails for same quarter, preserve summaries)
    existing_summaries = {t["quarter"]: t["summary"] for t in existing.get("timeline", []) if t.get("summary")}
    quarter_totals = {}
    for s in existing["sources"].values():
        for t in s.get("timeline", []):
            quarter_totals[t["quarter"]] = quarter_totals.get(t["quarter"], 0) + t["emails"]

    existing["interactions"] = all_interactions
    existing["firstDate"] = all_first
    existing["lastDate"] = all_last
    existing["nContacts"] = len(all_contacts)
    existing["contacts"] = all_contacts[:5]
    existing["timeline"] = [
        {"quarter": q, "emails": e, **({"summary": existing_summaries[q]} if q in existing_summaries else {})}
        for q, e in sorted(quarter_totals.items(), reverse=True)
    ][:8]

    # Keep sectors and relType from whichever has more info
    if len(new_data.get("sectors", "")) > len(existing.get("sectors", "")):
        existing["sectors"] = new_data["sectors"]
    if len(new_data.get("relType", "")) > len(existing.get("relType", "")):
        existing["relType"] = new_data["relType"]

    return existing


def export_to_compact(all_companies):
    """Convert merged companies dict to compact JSON format for the React app."""
    # Sort by total interactions descending
    sorted_cos = sorted(all_companies.values(), key=lambda c: c.get("interactions", 0), reverse=True)

    records = []
    details = {}

    for i, c in enumerate(sorted_cos):
        records.append([
            c["name"],
            c["domain"],
            c.get("sectors", ""),
            c.get("nContacts", 0),
            c.get("interactions", 0),
            c.get("relType", ""),
            c.get("firstDate", ""),
            c.get("lastDate", ""),
            # Employee sources as comma-separated list
            ",".join(sorted(c.get("sources", {}).keys())),
        ])

        contacts = c.get("contacts", [])
        timeline = c.get("timeline", [])
        context = c.get("context", "")
        subjects = c.get("subjects", [])

        if contacts or timeline or context:
            # Include per-employee breakdown
            source_breakdown = []
            for emp_id, s in sorted(c.get("sources", {}).items()):
                source_breakdown.append([emp_id, s["interactions"]])

            dated_subjects = c.get("dated_subjects", [])

            details[str(i)] = [
                [[ct["name"], ct.get("role", ""), ct.get("email", ""), ct.get("nombre", ""), ct.get("apellido", "")] for ct in contacts[:5]],
                [[t["quarter"], t["emails"]] + ([t["summary"]] if t.get("summary") else []) for t in timeline[:8]],
                context[:500],
                source_breakdown,
                subjects[:20],
                c.get("enrichment", None),
                dated_subjects[:30] if dated_subjects else None,
            ]

    return {"r": records, "d": details}


# ---------------------------------------------------------------------------
# Gemini enrichment for new domains
# ---------------------------------------------------------------------------
def enrich_new_domains(all_companies, new_domain_keys):
    """Classify new domains using Gemini via process_sheet_emails.classify_domains_with_gemini."""
    if not new_domain_keys:
        return

    try:
        from process_sheet_emails import classify_domains_with_gemini
    except ImportError:
        print("  [warn] Cannot import classify_domains_with_gemini — skipping enrichment")
        return

    # Build context tuples: (domain, subjects, snippets, name)
    domains_with_context = []
    for domain in new_domain_keys:
        co = all_companies.get(domain, {})
        subjects = co.get("subjects", [])
        snippets = co.get("snippets", [])
        name = co.get("name", "")
        # Use context as snippet fallback
        if not snippets and co.get("context"):
            snippets = [co["context"]]
        domains_with_context.append((domain, subjects, snippets, name))

    print(f"  → Enriqueciendo {len(domains_with_context)} dominios nuevos con Gemini...")
    classifications = classify_domains_with_gemini(domains_with_context)

    enriched = 0
    for domain, result in classifications.items():
        enrichment = result.get("enrichment")
        if enrichment and domain in all_companies:
            co = all_companies[domain]
            # Merge enrichment seed from Excel into Gemini enrichment
            seed = co.pop("_enrichment_seed", {})
            if seed:
                if seed.get("geo") and not enrichment.get("geo"):
                    # Parse comma-separated geos
                    enrichment["geo"] = [g.strip() for g in seed["geo"].split(",") if g.strip()]
                if seed.get("tech") and not enrichment.get("tech"):
                    enrichment["tech"] = [t.strip() for t in seed["tech"].split(",") if t.strip()]
                # Store extra seed fields that Gemini doesn't cover
                for key in ("ticket_size", "tipo_activo", "criterios", "pipeline_info"):
                    if seed.get(key):
                        enrichment[key] = seed[key]
            co["enrichment"] = enrichment
            enriched += 1

    print(f"  → {enriched} empresas enriquecidas con IA")

    # Clean up _enrichment_seed from companies that already existed
    for domain in all_companies:
        all_companies[domain].pop("_enrichment_seed", None)


# ---------------------------------------------------------------------------
# Google Sheet registration
# ---------------------------------------------------------------------------
def register_in_sheet(employee_id, employee_email, first_date):
    """Register new employee in the Google Sheet employees + config tabs."""
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sa_json or not sheet_id:
        print("  [info] GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEET_ID not set — skipping Sheet registration")
        return False

    try:
        import gspread
        from google.oauth2.service_account import Credentials

        sa_info = json.loads(sa_json)
        creds = Credentials.from_service_account_info(
            sa_info, scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
        gc = gspread.authorize(creds)
        ss = gc.open_by_key(sheet_id)
    except Exception as e:
        print(f"  [warn] Could not connect to Google Sheets: {e}")
        return False

    # Ensure 'employees' tab exists
    try:
        emp_sheet = ss.worksheet("employees")
    except gspread.WorksheetNotFound:
        emp_sheet = ss.add_worksheet(title="employees", rows=20, cols=4)
        emp_sheet.update("A1:D1", [["employee_id", "email", "configKey", "active"]])
        print("  → Created 'employees' tab in Sheet")

    # Check if employee already exists
    existing_ids = emp_sheet.col_values(1)
    config_key = "lastScanDate_" + employee_id.split("_")[0]

    if employee_id not in existing_ids:
        emp_sheet.append_row([employee_id, employee_email, config_key, "TRUE"])
        print(f"  → Registered {employee_id} in Sheet tab 'employees'")
    else:
        print(f"  → {employee_id} already in Sheet tab 'employees'")

    # Add config entry with start date
    try:
        config_sheet = ss.worksheet("config")
        existing_keys = config_sheet.col_values(1)
        if config_key not in existing_keys:
            # Use the earliest date from the Excel or default
            start_date = first_date or "2024/01/01"
            config_sheet.append_row([config_key, start_date])
            print(f"  → Added config key {config_key} = {start_date}")
    except Exception as e:
        print(f"  [warn] Could not update config tab: {e}")

    return True


# ---------------------------------------------------------------------------
# Manifest (.imported.json)
# ---------------------------------------------------------------------------
def load_manifest():
    """Load the import manifest."""
    if os.path.exists(IMPORTED_MANIFEST):
        with open(IMPORTED_MANIFEST, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_manifest(manifest):
    """Save the import manifest."""
    os.makedirs(os.path.dirname(IMPORTED_MANIFEST), exist_ok=True)
    with open(IMPORTED_MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


def update_manifest(filename, employee_id, employee_name, companies_count):
    """Add/update an entry in the import manifest."""
    manifest = load_manifest()
    manifest[filename] = {
        "employee_id": employee_id,
        "employee_name": employee_name,
        "importedAt": datetime.now().isoformat(),
        "companies": companies_count,
    }
    save_manifest(manifest)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Alter5 BI — Importador de buzones de correo",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python scripts/import_mailbox.py data_sources/guillermo.xlsx "Guillermo Souto"
  python scripts/import_mailbox.py data_sources/miguel.xlsx "Miguel Solana" --email miguel.solana@alter-5.com
        """,
    )
    parser.add_argument("filepath", help="Ruta al archivo Excel")
    parser.add_argument("employee_name", help="Nombre del empleado")
    parser.add_argument("--email", help="Email corporativo (para registrar en el pipeline de Gmail)")
    parser.add_argument("--no-enrich", action="store_true", help="Saltar enrichment con Gemini")
    parser.add_argument("--no-sheet", action="store_true", help="No registrar en Google Sheet")

    args = parser.parse_args()
    filepath = args.filepath
    employee_name = args.employee_name
    employee_id = employee_name.lower().replace(" ", "_")

    if not os.path.exists(filepath):
        print(f"  ✗ No se encuentra el archivo: {filepath}")
        sys.exit(1)

    print(f"  Importando buzón de {employee_name}...")
    print(f"  Archivo: {filepath}")
    if args.email:
        print(f"  Email: {args.email}")
    print()

    # 1. Parse Excel
    new_companies = read_excel(filepath)
    print(f"  → {len(new_companies)} empresas encontradas en el Excel")

    # 2. Load existing data
    existing = load_existing_data()
    all_companies = existing.get("companies", {})
    print(f"  → {len(all_companies)} empresas existentes en la base de datos")

    # 3. Merge — track which domains are new
    new_count = 0
    updated_count = 0
    new_domain_keys = []
    for key, company in new_companies.items():
        if key in all_companies:
            all_companies[key] = merge_company(all_companies[key], company, employee_id)
            updated_count += 1
        else:
            all_companies[key] = merge_company(None, company, employee_id)
            new_domain_keys.append(key)
            new_count += 1

    print(f"  → {new_count} empresas nuevas añadidas")
    print(f"  → {updated_count} empresas actualizadas con datos cruzados")

    # 4. Enrich new domains with Gemini
    if not args.no_enrich and new_domain_keys:
        enrich_new_domains(all_companies, new_domain_keys)
    else:
        # Clean up enrichment seeds
        for domain in all_companies:
            all_companies[domain].pop("_enrichment_seed", None)

    # 5. Update employees registry
    employees = load_employees()
    emp_ids = [e["id"] for e in employees]
    emp_entry = {
        "id": employee_id,
        "name": employee_name,
        "importedAt": datetime.now().isoformat(),
        "companiesCount": len(new_companies),
    }
    if args.email:
        emp_entry["email"] = args.email
    if employee_id not in emp_ids:
        employees.append(emp_entry)
    else:
        for i, e in enumerate(employees):
            if e["id"] == employee_id:
                employees[i] = {**e, **emp_entry}

    # 6. Save full data (for future merges)
    full_data = {"companies": all_companies, "employees": employees}

    os.makedirs(os.path.dirname(FULL_FILE), exist_ok=True)

    _atomic_json_write(FULL_FILE, full_data, indent=2)

    # 7. Save compact data (for React app)
    compact = export_to_compact(all_companies)
    _atomic_json_write(COMPACT_FILE, compact, separators=(",", ":"))

    # 8. Save employees list
    _atomic_json_write(EMPLOYEES_FILE, employees, indent=2)

    # 9. Register in Google Sheet (if email provided and env vars set)
    if args.email and not args.no_sheet:
        # Find earliest date from the imported companies
        first_dates = [c.get("firstDate", "") for c in new_companies.values() if c.get("firstDate")]
        first_date = min(first_dates) if first_dates else "2024/01/01"
        register_in_sheet(employee_id, args.email, first_date)

    # 10. Update import manifest
    filename = os.path.basename(filepath)
    update_manifest(filename, employee_id, employee_name, len(new_companies))
    print(f"  → Manifest actualizado: {filename}")

    print()
    print(f"  ✓ Base de datos actualizada: {len(all_companies)} empresas totales")
    print(f"  ✓ Empleados registrados: {', '.join(e['name'] for e in employees)}")
    print()
    print("  Reinicia el servidor de desarrollo (npm run dev) para ver los cambios.")
    print()


if __name__ == "__main__":
    main()
