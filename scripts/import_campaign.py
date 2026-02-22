"""
═══════════════════════════════════════════════════════════════
  Alter5 BI — Importador de datos de campaña
═══════════════════════════════════════════════════════════════

  USO:
    python scripts/import_campaign.py <archivo.csv>

  EJEMPLO:
    python scripts/import_campaign.py campaign_export.csv

  QUÉ HACE:
    1. Lee el CSV exportado desde el Campaign Dashboard (tab Empresas)
    2. Extrae métricas de engagement por empresa (aperturas, clics, respuestas)
    3. Fusiona con los datos existentes en companies_full.json
    4. Si una empresa ya existe (match por dominio), añade campos de campaña
    5. Si es nueva, la crea con fuente "campaign"

  FORMATO CSV ESPERADO:
    Empresa,Dominio,Contactos,Abiertos,Clics,Respondidos,Errores,MejorEstado

  REQUISITOS:
    pip install pandas
═══════════════════════════════════════════════════════════════
"""

import pandas as pd
import json
import sys
import os
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

# Import paths from the existing mailbox importer
from import_mailbox import get_data_paths, load_existing_data, export_to_compact, FULL_FILE, COMPACT_FILE


def read_campaign_csv(filepath):
    """Parse campaign CSV into structured data keyed by domain."""
    df = pd.read_csv(filepath)

    # Normalize column names (strip whitespace, lowercase)
    df.columns = df.columns.str.strip()

    companies = {}
    for _, row in df.iterrows():
        domain = str(row.get("Dominio", "")).strip().lower()
        if not domain or domain == "nan":
            continue

        empresa = str(row.get("Empresa", "")).strip()
        contactos = int(row.get("Contactos", 0)) if pd.notna(row.get("Contactos")) else 0
        abiertos = int(row.get("Abiertos", 0)) if pd.notna(row.get("Abiertos")) else 0
        clics = int(row.get("Clics", 0)) if pd.notna(row.get("Clics")) else 0
        respondidos = int(row.get("Respondidos", 0)) if pd.notna(row.get("Respondidos")) else 0
        errores = int(row.get("Errores", 0)) if pd.notna(row.get("Errores")) else 0
        mejor_estado = str(row.get("MejorEstado", "")).strip()

        # Calculate engagement score (0-100)
        engagement = calculate_engagement(contactos, abiertos, clics, respondidos)

        companies[domain] = {
            "name": empresa,
            "domain": domain,
            "campaignContacts": contactos,
            "campaignOpens": abiertos,
            "campaignClicks": clics,
            "campaignReplies": respondidos,
            "campaignErrors": errores,
            "campaignBestStatus": mejor_estado,
            "campaignEngagement": engagement,
        }

    return companies


def calculate_engagement(contacts, opens, clicks, replies):
    """Calculate campaign engagement score (0-100).

    Weights:
      - Replied: 40 points (highest value — direct interest)
      - Clicked: 30 points (strong engagement)
      - Opened: 20 points (baseline engagement)
      - Contact coverage: 10 points (having contacts in campaign)
    """
    if contacts == 0:
        return 0

    reply_rate = min(1.0, replies / contacts)
    click_rate = min(1.0, clicks / contacts)
    open_rate = min(1.0, opens / contacts)

    score = (
        reply_rate * 40 +
        click_rate * 30 +
        open_rate * 20 +
        10  # base points for being in campaign
    )

    return min(100, round(score))


def merge_campaign_data(all_companies, campaign_companies):
    """Merge campaign engagement data into existing companies."""
    new_count = 0
    updated_count = 0

    for domain, campaign in campaign_companies.items():
        if domain in all_companies:
            # Existing company — add campaign fields
            existing = all_companies[domain]
            existing["inCampaign"] = True
            existing["campaignContacts"] = campaign["campaignContacts"]
            existing["campaignOpens"] = campaign["campaignOpens"]
            existing["campaignClicks"] = campaign["campaignClicks"]
            existing["campaignReplies"] = campaign["campaignReplies"]
            existing["campaignErrors"] = campaign["campaignErrors"]
            existing["campaignBestStatus"] = campaign["campaignBestStatus"]
            existing["campaignEngagement"] = campaign["campaignEngagement"]
            updated_count += 1
        else:
            # New company from campaign — create minimal record
            all_companies[domain] = {
                "name": campaign["name"],
                "domain": domain,
                "sectors": "Renovables",  # default for campaign targets
                "nContacts": campaign["campaignContacts"],
                "interactions": 0,
                "relType": "Potencial Prestatario",
                "firstDate": datetime.now().strftime("%Y-%m-%d"),
                "lastDate": datetime.now().strftime("%Y-%m-%d"),
                "context": f"Contacto vía campaña Bridge Debt Energy Program. Estado: {campaign['campaignBestStatus']}",
                "contacts": [],
                "timeline": [],
                "sources": {},
                "inCampaign": True,
                "campaignContacts": campaign["campaignContacts"],
                "campaignOpens": campaign["campaignOpens"],
                "campaignClicks": campaign["campaignClicks"],
                "campaignReplies": campaign["campaignReplies"],
                "campaignErrors": campaign["campaignErrors"],
                "campaignBestStatus": campaign["campaignBestStatus"],
                "campaignEngagement": campaign["campaignEngagement"],
            }
            new_count += 1

    return new_count, updated_count


def export_to_compact_with_campaign(all_companies):
    """Extended compact export that includes campaign fields.

    Record format (extended):
      [empresa, dominio, sector, nContactos, totalInteracciones,
       tipoRelacion, primeraInteraccion, ultimaInteraccion, employeeSources,
       inCampaign, campaignEngagement, campaignBestStatus,
       campaignContacts, campaignOpens, campaignClicks, campaignReplies, campaignErrors]
    """
    sorted_cos = sorted(
        all_companies.values(),
        key=lambda c: c.get("interactions", 0),
        reverse=True,
    )

    records = []
    details = {}

    for i, c in enumerate(sorted_cos):
        record = [
            c["name"],
            c["domain"],
            c.get("sectors", ""),
            c.get("nContacts", 0),
            c.get("interactions", 0),
            c.get("relType", ""),
            c.get("firstDate", ""),
            c.get("lastDate", ""),
            ",".join(sorted(c.get("sources", {}).keys())),
            # Campaign fields (indices 9-15)
            1 if c.get("inCampaign") else 0,
            c.get("campaignEngagement", 0),
            c.get("campaignBestStatus", ""),
            c.get("campaignContacts", 0),
            c.get("campaignOpens", 0),
            c.get("campaignClicks", 0),
            c.get("campaignReplies", 0),
            c.get("campaignErrors", 0),
        ]
        records.append(record)

        contacts = c.get("contacts", [])
        timeline = c.get("timeline", [])
        context = c.get("context", "")

        if contacts or timeline or context:
            source_breakdown = []
            for emp_id, s in sorted(c.get("sources", {}).items()):
                source_breakdown.append([emp_id, s["interactions"]])

            details[str(i)] = [
                [[ct["name"], ct.get("role", ""), ct.get("email", "")] for ct in contacts[:5]],
                [[t["quarter"], t["emails"]] for t in timeline[:8]],
                context[:500],
                source_breakdown,
                c.get("subjects", [])[:20],
                c.get("enrichment", None),
            ]

    return {"r": records, "d": details}


def main():
    if len(sys.argv) < 2:
        print("=" * 60)
        print("  Alter5 BI — Importador de campaña")
        print("=" * 60)
        print()
        print("  Uso:  python scripts/import_campaign.py <archivo.csv>")
        print()
        print("  Ejemplo:")
        print("    python scripts/import_campaign.py campaign_export.csv")
        print()
        sys.exit(1)

    filepath = sys.argv[1]

    if not os.path.exists(filepath):
        print(f"  ✗ No se encuentra el archivo: {filepath}")
        sys.exit(1)

    print(f"  Importando datos de campaña...")
    print(f"  Archivo: {filepath}")
    print()

    # 1. Parse CSV
    campaign_companies = read_campaign_csv(filepath)
    print(f"  → {len(campaign_companies)} empresas en el CSV de campaña")

    # 2. Load existing data
    existing = load_existing_data()
    all_companies = existing.get("companies", {})
    print(f"  → {len(all_companies)} empresas existentes en la base de datos")

    # 3. Merge campaign data
    new_count, updated_count = merge_campaign_data(all_companies, campaign_companies)
    print(f"  → {updated_count} empresas actualizadas con datos de campaña")
    print(f"  → {new_count} empresas nuevas añadidas (solo en campaña)")

    # Count totals
    in_campaign = sum(1 for c in all_companies.values() if c.get("inCampaign"))
    with_replies = sum(1 for c in all_companies.values() if c.get("campaignReplies", 0) > 0)
    print(f"  → {in_campaign} empresas en campaña total ({with_replies} con respuestas)")

    # 4. Save full data
    full_data = {"companies": all_companies, "employees": existing.get("employees", [])}

    os.makedirs(os.path.dirname(FULL_FILE), exist_ok=True)

    with open(FULL_FILE, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)

    # 5. Save compact data (extended format with campaign fields)
    compact = export_to_compact_with_campaign(all_companies)
    with open(COMPACT_FILE, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

    print()
    print(f"  ✓ Base de datos actualizada: {len(all_companies)} empresas totales")
    print(f"  ✓ {in_campaign} empresas con datos de campaña Bridge Debt")
    print()
    print("  Reinicia el servidor de desarrollo (npm run dev) para ver los cambios.")
    print()


if __name__ == "__main__":
    main()
