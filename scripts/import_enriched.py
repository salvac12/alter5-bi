"""
Import enriched Guillermo v2 data from Excel and merge with existing companies.

Usage:
    python scripts/import_enriched.py ~/Downloads/analisis_contactos_guillermo_v2.xlsx
"""

import pandas as pd
import json
import sys
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

from import_mailbox import load_existing_data, FULL_FILE, COMPACT_FILE


def parse_productos(raw):
    """Parse 'Prestamo Construccion (alta) | Refinanciacion (baja)' into list of {p, c}."""
    if not raw or pd.isna(raw):
        return []
    products = []
    for part in str(raw).split("|"):
        part = part.strip()
        m = re.match(r"(.+?)\s*\((\w+)\)\s*$", part)
        if m:
            products.append({"p": m.group(1).strip(), "c": m.group(2).strip()})
        elif part:
            products.append({"p": part, "c": "media"})
    return products


def parse_senales(raw):
    """Parse 'Term sheet enviado | NDA firmado' into list of strings."""
    if not raw or pd.isna(raw):
        return []
    return [s.strip() for s in str(raw).split("|") if s.strip()]


MARKET_ROLE_MAP = {
    "IPP": "Borrower",
    "Desarrollador": "Borrower",
}

def parse_market_roles(raw):
    """Parse 'Borrower | Debt Investor' into list of strings."""
    if not raw or pd.isna(raw):
        return []
    roles = []
    for r in str(raw).split("|"):
        r = r.strip()
        if not r:
            continue
        r = MARKET_ROLE_MAP.get(r, r)
        if r not in roles:
            roles.append(r)
    return roles


def read_enriched_excel(filepath):
    """Read 'Resumen por Empresa' tab and return dict keyed by domain."""
    df = pd.read_excel(filepath, sheet_name="Resumen por Empresa")
    companies = {}

    for _, row in df.iterrows():
        domain = str(row.get("Dominio", "")).strip().lower()
        if not domain or domain == "nan":
            continue

        subtipo = str(row.get("Subtipo Empresa", "")).strip() if pd.notna(row.get("Subtipo Empresa")) else ""
        fase = str(row.get("Fase Comercial", "")).strip() if pd.notna(row.get("Fase Comercial")) else ""
        productos = parse_productos(row.get("Productos Potenciales"))
        senales = parse_senales(row.get("Senales Clave"))
        contexto = str(row.get("Contexto General", "")).strip() if pd.notna(row.get("Contexto General")) else ""
        historico = str(row.get("Historico Trimestral", "")).strip() if pd.notna(row.get("Historico Trimestral")) else ""
        market_roles = parse_market_roles(row.get("Market Roles"))

        # Also read basic fields for new companies
        companies[domain] = {
            "name": str(row.get("Empresa", "")).strip(),
            "domain": domain,
            "sector": str(row.get("Sector", "")).strip() if pd.notna(row.get("Sector")) else "",
            "nContacts": int(row.get("N Contactos", 0)) if pd.notna(row.get("N Contactos")) else 0,
            "interactions": int(row.get("Total Interacciones", 0)) if pd.notna(row.get("Total Interacciones")) else 0,
            "relType": str(row.get("Tipo Relacion", "")).strip() if pd.notna(row.get("Tipo Relacion")) else "",
            "firstDate": str(row.get("Primera Interaccion", "")).strip() if pd.notna(row.get("Primera Interaccion")) else "",
            "lastDate": str(row.get("Ultima Interaccion", "")).strip() if pd.notna(row.get("Ultima Interaccion")) else "",
            # Enrichment fields
            "subtipo": subtipo,
            "fase": fase,
            "productos": productos,
            "senales": senales,
            "contexto": contexto,
            "historico": historico,
            "market_roles": market_roles,
        }

    return companies


SUBTIPO_TO_TYPE = {
    "Desarrollador": "Developer", "IPP": "IPP", "Utility": "Utility",
    "Fondo Renovable": "Renewable Fund", "Inversor Institucional": "Institutional Investor",
    "Banco/Entidad Financiera": "Bank", "Family Office": "Family Office",
    "EPC/Proveedor": "EPC / Contractor", "Asesor": "Financial Advisor",
    "Administracion Publica": "Public Institution", "Plataforma Crowdfunding": "Platform / Tech",
    "Otro": "Other",
}

FASE_TO_DEAL_STAGE = {
    "Primer contacto": "Prospect", "Exploracion": "Opportunity",
    "Negociacion": "TS Preparation", "Cliente activo": "Signing",
    "Dormido": "Prospect", "Descartado": None,
}


def infer_group(enriched):
    """Infer company group from market roles and other signals."""
    mr = enriched.get("market_roles", [])
    if any(r in mr for r in ["Borrower", "Seller (M&A)"]):
        return "Capital Seeker"
    if any(r in mr for r in ["Debt Investor", "Equity Investor", "Buyer Investor (M&A)"]):
        return "Investor"
    if mr == ["Partner & Services"]:
        return "Services"

    rel = enriched.get("relType", "").lower()
    if "prestatario" in rel:
        return "Capital Seeker"
    if "inversor" in rel or "banco" in rel:
        return "Investor"
    if "asesor" in rel or "proveedor" in rel or "consultor" in rel:
        return "Services"

    sector = enriched.get("sector", "").lower()
    if any(s in sector for s in ["renovable", "energía", "energia"]):
        return "Capital Seeker"
    if any(s in sector for s in ["banca", "inversor", "inversión"]):
        return "Investor"
    if any(s in sector for s in ["legal", "consultoría", "tecnología"]):
        return "Services"

    return "Other"


def build_enrichment(enriched):
    """Build compact enrichment object from enriched data using new taxonomy."""
    e = {}

    # Group
    group = infer_group(enriched)
    e["grp"] = group

    # Type (from subtipo mapping)
    subtipo = enriched.get("subtipo", "")
    comp_type = SUBTIPO_TO_TYPE.get(subtipo, "Other")
    e["tp"] = comp_type

    # Deal stage (only for Capital Seekers)
    if group == "Capital Seeker":
        fase = enriched.get("fase", "")
        ds = FASE_TO_DEAL_STAGE.get(fase)
        if ds:
            e["ds"] = ds

    # Products and signals (preserved)
    if enriched.get("productos"):
        e["pp"] = enriched["productos"]
    if enriched.get("senales"):
        e["sc"] = enriched["senales"]

    # Market roles
    if enriched.get("market_roles"):
        e["mr"] = enriched["market_roles"]

    return e if e else None


def merge_enriched(all_companies, enriched_companies):
    """Merge enriched data into existing companies."""
    updated = 0
    new = 0

    for domain, enriched in enriched_companies.items():
        enrich_obj = build_enrichment(enriched)

        if domain in all_companies:
            existing = all_companies[domain]
            if enrich_obj:
                existing["enrichment"] = enrich_obj
            # Update context from Guillermo's enriched data if richer
            if enriched["contexto"] and len(enriched["contexto"]) > len(existing.get("context", "")):
                existing["context"] = enriched["contexto"]
            updated += 1
        else:
            # New company only from Guillermo's enriched analysis
            all_companies[domain] = {
                "name": enriched["name"],
                "domain": domain,
                "sectors": enriched.get("sector", ""),
                "nContacts": enriched.get("nContacts", 0),
                "interactions": enriched.get("interactions", 0),
                "relType": enriched.get("relType", ""),
                "firstDate": enriched.get("firstDate", ""),
                "lastDate": enriched.get("lastDate", ""),
                "context": enriched.get("contexto", ""),
                "contacts": [],
                "timeline": [],
                "sources": {},
                "subjects": [],
            }
            if enrich_obj:
                all_companies[domain]["enrichment"] = enrich_obj
            new += 1

    return updated, new


def export_to_compact_enriched(all_companies):
    """Export compact JSON with enrichment at detail index 5."""
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
            c["domain"],
            c.get("sectors", ""),
            c.get("nContacts", 0),
            c.get("interactions", 0),
            c.get("relType", ""),
            c.get("firstDate", ""),
            c.get("lastDate", ""),
            ",".join(sorted(c.get("sources", {}).keys())),
        ])

        contacts = c.get("contacts", [])
        timeline = c.get("timeline", [])
        context = c.get("context", "")
        subjects = c.get("subjects", [])
        enrichment = c.get("enrichment", None)

        if contacts or timeline or context:
            source_breakdown = []
            for emp_id, s in sorted(c.get("sources", {}).items()):
                source_breakdown.append([emp_id, s["interactions"]])

            details[str(i)] = [
                [[ct["name"], ct.get("role", ""), ct.get("email", "")] for ct in contacts[:5]],
                [[t["quarter"], t["emails"]] + ([t["summary"]] if t.get("summary") else []) for t in timeline[:8]],
                context[:500],  # Extended from 150 to 500
                source_breakdown,
                subjects[:20],
                enrichment,  # index 5 - null if no enrichment
            ]

    return {"r": records, "d": details}


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/import_enriched.py <archivo.xlsx>")
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        print(f"  Error: file not found: {filepath}")
        sys.exit(1)

    print(f"  Importing enriched data from: {filepath}")

    # 1. Read enriched Excel
    enriched = read_enriched_excel(filepath)
    print(f"  -> {len(enriched)} companies in Excel")

    # 2. Load existing
    existing = load_existing_data()
    all_companies = existing.get("companies", {})
    print(f"  -> {len(all_companies)} existing companies")

    # 3. Merge
    updated, new = merge_enriched(all_companies, enriched)
    print(f"  -> {updated} updated, {new} new")

    enriched_count = sum(1 for c in all_companies.values() if c.get("enrichment"))
    print(f"  -> {enriched_count} companies with enrichment data")

    # 4. Save full
    full_data = {"companies": all_companies, "employees": existing.get("employees", [])}
    os.makedirs(os.path.dirname(FULL_FILE), exist_ok=True)
    with open(FULL_FILE, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)
    print(f"  -> Saved {FULL_FILE}")

    # 5. Save compact
    compact = export_to_compact_enriched(all_companies)
    with open(COMPACT_FILE, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  -> Saved {COMPACT_FILE}")

    print(f"\n  Done! {len(all_companies)} total companies. Run npm run dev to see changes.")


if __name__ == "__main__":
    main()
