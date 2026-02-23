"""
═══════════════════════════════════════════════════════════════
  Alter5 BI — Importador de buzones de correo
═══════════════════════════════════════════════════════════════

  USO:
    python scripts/import_mailbox.py <archivo.xlsx> <nombre_empleado>

  EJEMPLOS:
    python scripts/import_mailbox.py data_sources/guillermo_souto.xlsx "Guillermo Souto"
    python scripts/import_mailbox.py data_sources/miguel_solana.xlsx "Miguel Solana"

  QUÉ HACE:
    1. Lee el Excel (misma estructura que el original)
    2. Extrae empresas, contactos y timeline
    3. Fusiona con los datos existentes en src/data/companies.json
    4. Si una empresa ya existe, combina las interacciones de ambos buzones

  REQUISITOS:
    pip install pandas openpyxl
═══════════════════════════════════════════════════════════════
"""

import json
import sys
import os
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)


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

    # Build company records
    companies = {}
    for _, row in df_companies.iterrows():
        name = str(row.get("Empresa", "")).strip()
        if not name or name == "nan":
            continue
        
        domain = str(row.get("Dominio", "")) if pd.notna(row.get("Dominio")) else ""
        
        companies[domain or name.lower().replace(" ", "-")] = {
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
    existing["dated_subjects"] = sorted(old_ds, key=lambda x: x[0])[:30]

    old_snippets = existing.get("snippets", [])
    new_snippets = new_data.get("snippets", [])
    existing["snippets"] = list({s: None for s in old_snippets + new_snippets}.keys())[:15]
    
    # Recalculate aggregates across all employee sources
    all_interactions = sum(s["interactions"] for s in existing["sources"].values())
    all_first = min(s["firstDate"] for s in existing["sources"].values() if s["firstDate"])
    all_last = max(s["lastDate"] for s in existing["sources"].values() if s["lastDate"])
    
    # Merge unique contacts (preserve email if available, prefer non-empty over empty)
    seen_names = {}  # name -> index in all_contacts
    all_contacts = []
    for s in existing["sources"].values():
        for c in s.get("contacts", []):
            if c["name"] not in seen_names:
                seen_names[c["name"]] = len(all_contacts)
                all_contacts.append({"name": c["name"], "email": c.get("email", ""), "role": c.get("role", "")})
            else:
                # Update email if current entry is empty and this one has a value
                idx = seen_names[c["name"]]
                if not all_contacts[idx].get("email") and c.get("email"):
                    all_contacts[idx]["email"] = c["email"]
    
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
        for q, e in sorted(quarter_totals.items())
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
                [[ct["name"], ct.get("role", ""), ct.get("email", "")] for ct in contacts[:5]],
                [[t["quarter"], t["emails"]] + ([t["summary"]] if t.get("summary") else []) for t in timeline[:8]],
                context[:500],
                source_breakdown,
                subjects[:20],
                c.get("enrichment", None),
                dated_subjects[:30] if dated_subjects else None,
            ]
    
    return {"r": records, "d": details}


def main():
    if len(sys.argv) < 3:
        print("═" * 60)
        print("  Alter5 BI — Importador de buzones")
        print("═" * 60)
        print()
        print("  Uso:  python scripts/import_mailbox.py <archivo.xlsx> <nombre>")
        print()
        print("  Ejemplo:")
        print('    python scripts/import_mailbox.py data_sources/guillermo.xlsx "Guillermo Souto"')
        print()
        sys.exit(1)
    
    filepath = sys.argv[1]
    employee_name = sys.argv[2]
    employee_id = employee_name.lower().replace(" ", "_")
    
    if not os.path.exists(filepath):
        print(f"  ✗ No se encuentra el archivo: {filepath}")
        sys.exit(1)
    
    print(f"  Importando buzón de {employee_name}...")
    print(f"  Archivo: {filepath}")
    print()
    
    # 1. Parse Excel
    new_companies = read_excel(filepath)
    print(f"  → {len(new_companies)} empresas encontradas en el Excel")
    
    # 2. Load existing data
    existing = load_existing_data()
    all_companies = existing.get("companies", {})
    print(f"  → {len(all_companies)} empresas existentes en la base de datos")
    
    # 3. Merge
    new_count = 0
    updated_count = 0
    for key, company in new_companies.items():
        if key in all_companies:
            all_companies[key] = merge_company(all_companies[key], company, employee_id)
            updated_count += 1
        else:
            all_companies[key] = merge_company(None, company, employee_id)
            new_count += 1
    
    print(f"  → {new_count} empresas nuevas añadidas")
    print(f"  → {updated_count} empresas actualizadas con datos cruzados")
    
    # 4. Update employees registry
    employees = load_employees()
    emp_ids = [e["id"] for e in employees]
    if employee_id not in emp_ids:
        employees.append({
            "id": employee_id,
            "name": employee_name,
            "importedAt": datetime.now().isoformat(),
            "companiesCount": len(new_companies),
        })
    else:
        for e in employees:
            if e["id"] == employee_id:
                e["importedAt"] = datetime.now().isoformat()
                e["companiesCount"] = len(new_companies)
    
    # 5. Save full data (for future merges)
    full_data = {"companies": all_companies, "employees": employees}
    
    os.makedirs(os.path.dirname(FULL_FILE), exist_ok=True)
    
    with open(FULL_FILE, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)
    
    # 6. Save compact data (for React app)
    compact = export_to_compact(all_companies)
    with open(COMPACT_FILE, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))
    
    # 7. Save employees list
    with open(EMPLOYEES_FILE, "w", encoding="utf-8") as f:
        json.dump(employees, f, ensure_ascii=False, indent=2)
    
    print()
    print(f"  ✓ Base de datos actualizada: {len(all_companies)} empresas totales")
    print(f"  ✓ Empleados registrados: {', '.join(e['name'] for e in employees)}")
    print()
    print("  Reinicia el servidor de desarrollo (npm run dev) para ver los cambios.")
    print()


if __name__ == "__main__":
    main()
