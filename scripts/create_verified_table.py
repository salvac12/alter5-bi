#!/usr/bin/env python3
"""
Create the "Verified-Companies" table in Airtable via the Meta API.

Run ONCE to set up the table schema. After creation the table ID is
printed -- copy it into airtableVerified.js (TABLE_NAME constant).

Requires:
  - AIRTABLE_PAT  (Personal Access Token with schema.bases:write)
  - AIRTABLE_BASE_ID (default: appVu3TvSZ1E4tj0J)

Usage:
  AIRTABLE_PAT=patXXX python scripts/create_verified_table.py
"""

import json
import os
import ssl
import sys
import urllib.request
import urllib.error

# SSL context (same pattern as other scripts)
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# -- Config --
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")

# -- Taxonomy enums (mirrors constants.js & process_sheet_emails.py) --
ROLE_CHOICES = [
    {"name": "Originacion", "color": "yellowLight2"},
    {"name": "Inversion", "color": "blueLight2"},
    {"name": "Ecosistema", "color": "grayLight2"},
    {"name": "No relevante", "color": "grayDark1"},
]

SEGMENT_CHOICES = [
    {"name": "Project Finance", "color": "cyanLight2"},
    {"name": "Corporate Finance", "color": "orangeLight2"},
    {"name": "Deuda", "color": "blueLight2"},
    {"name": "Equity", "color": "greenLight2"},
]

TYPE_CHOICES = [
    # Originacion > PF
    {"name": "Developer", "color": "yellowLight2"},
    {"name": "IPP", "color": "yellowDark1"},
    {"name": "Developer + IPP", "color": "orangeLight2"},
    # Inversion > Deuda
    {"name": "Fondo de deuda", "color": "blueLight2"},
    {"name": "Banco", "color": "blueDark1"},
    {"name": "Bonista / Institucional", "color": "cyanLight2"},
    # Inversion > Equity
    {"name": "Fondo de infraestructura", "color": "greenLight2"},
    {"name": "Private equity", "color": "greenDark1"},
    {"name": "Fondo renovable", "color": "tealLight2"},
    {"name": "IPP comprador", "color": "tealDark1"},
    {"name": "Utility compradora", "color": "purpleLight2"},
    # Ecosistema
    {"name": "Asesor legal", "color": "grayLight2"},
    {"name": "Asesor tecnico", "color": "grayDark1"},
    {"name": "Consultor de precios", "color": "grayLight1"},
    {"name": "Asset manager", "color": "pinkLight2"},
    {"name": "Ingenieria", "color": "orangeLight2"},
    {"name": "Asesor financiero", "color": "purpleLight2"},
    {"name": "Asociacion / Institucion", "color": "redLight2"},
]

ACTIVITY_CHOICES = [
    {"name": "Autoconsumo industrial/comercial", "color": "yellowLight2"},
    {"name": "Movilidad / Cargadores EV", "color": "cyanLight2"},
    {"name": "EPC / Construccion renovable", "color": "orangeLight2"},
    {"name": "Almacenamiento / BESS distribuido", "color": "blueLight2"},
    {"name": "Data centers", "color": "purpleLight2"},
    {"name": "Electrointensivo", "color": "redLight2"},
    {"name": "Biogas / Biometano", "color": "greenLight2"},
    {"name": "Hidrogeno verde", "color": "tealLight2"},
    {"name": "Eficiencia energetica", "color": "greenDark1"},
    {"name": "Calor renovable / Biomasa", "color": "orangeDark1"},
    {"name": "Redes / Infraestructura electrica", "color": "grayLight2"},
    {"name": "Agritech / Agrovoltaica", "color": "yellowDark1"},
]

TECH_CHOICES = [
    {"name": "Solar", "color": "yellowLight2"},
    {"name": "Eolica", "color": "cyanLight2"},
    {"name": "BESS", "color": "blueLight2"},
    {"name": "Biogas", "color": "greenLight2"},
    {"name": "Hidrogeno", "color": "tealLight2"},
    {"name": "Otra", "color": "grayLight2"},
]

GEO_CHOICES = [
    {"name": "Espana", "color": "redLight2"},
    {"name": "Portugal", "color": "greenLight2"},
    {"name": "Italia", "color": "tealLight2"},
    {"name": "Francia", "color": "blueLight2"},
    {"name": "Alemania", "color": "yellowLight2"},
    {"name": "UK", "color": "purpleLight2"},
    {"name": "Otro", "color": "grayLight2"},
]

MARKET_ROLE_CHOICES = [
    {"name": "Borrower", "color": "yellowLight2"},
    {"name": "Seller (M&A)", "color": "redLight2"},
    {"name": "Buyer Investor (M&A)", "color": "purpleLight2"},
    {"name": "Debt Investor", "color": "blueLight2"},
    {"name": "Equity Investor", "color": "greenLight2"},
    {"name": "Partner & Services", "color": "grayLight2"},
]

STATUS_CHOICES = [
    {"name": "Pending Review", "color": "yellowLight2"},
    {"name": "Verified", "color": "greenLight2"},
    {"name": "Edited", "color": "purpleLight2"},
    {"name": "Rejected", "color": "redLight2"},
]


# -- Table definition --
TABLE_SCHEMA = {
    "name": "Verified-Companies",
    "fields": [
        {
            "name": "Domain",
            "type": "singleLineText",
            "description": "Company domain (primary key, e.g. elonacapital.com)",
        },
        {
            "name": "Company Name",
            "type": "singleLineText",
            "description": "Company display name",
        },
        {
            "name": "Previous Classification",
            "type": "singleLineText",
            "description": "Previous Gemini classification (audit trail, e.g. 'Inversion > Fondo de deuda')",
        },
        {
            "name": "Role",
            "type": "singleSelect",
            "description": "Verified company role",
            "options": {"choices": ROLE_CHOICES},
        },
        {
            "name": "Segment",
            "type": "singleSelect",
            "description": "Verified segment (Originacion: PF/CF, Inversion: Deuda/Equity)",
            "options": {"choices": SEGMENT_CHOICES},
        },
        {
            "name": "Type",
            "type": "singleSelect",
            "description": "Verified company type",
            "options": {"choices": TYPE_CHOICES},
        },
        {
            "name": "Activities",
            "type": "multipleSelects",
            "description": "Verified activities (only Corporate Finance)",
            "options": {"choices": ACTIVITY_CHOICES},
        },
        {
            "name": "Technologies",
            "type": "multipleSelects",
            "description": "Verified technologies",
            "options": {"choices": TECH_CHOICES},
        },
        {
            "name": "Geography",
            "type": "multipleSelects",
            "description": "Verified geographies",
            "options": {"choices": GEO_CHOICES},
        },
        {
            "name": "Market Roles",
            "type": "multipleSelects",
            "description": "Verified market roles",
            "options": {"choices": MARKET_ROLE_CHOICES},
        },
        {
            "name": "Web Description",
            "type": "multilineText",
            "description": "What the verification agent found about this company on the web",
        },
        {
            "name": "Web Sources",
            "type": "multilineText",
            "description": "URLs and sources consulted during verification",
        },
        {
            "name": "Status",
            "type": "singleSelect",
            "description": "Verification status",
            "options": {"choices": STATUS_CHOICES},
        },
        {
            "name": "Verified By",
            "type": "singleLineText",
            "description": "Who verified: 'agent' or user name",
        },
        {
            "name": "Verified At",
            "type": "singleLineText",
            "description": "ISO timestamp of verification",
        },
        {
            "name": "Notes",
            "type": "multilineText",
            "description": "Manual notes about the verification",
        },
        {
            "name": "Mismatch",
            "type": "checkbox",
            "description": "True if web info contradicts current Gemini classification",
            "options": {"icon": "xCheckbox", "color": "redBright"},
        },
    ],
}


def create_table():
    """Create the Verified-Companies table via Airtable Meta API."""
    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT environment variable not set")
        print("Usage: AIRTABLE_PAT=patXXX python scripts/create_verified_table.py")
        sys.exit(1)

    url = f"https://api.airtable.com/v0/meta/bases/{AIRTABLE_BASE_ID}/tables"
    payload = json.dumps(TABLE_SCHEMA).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {AIRTABLE_PAT}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, context=SSL_CTX) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"ERROR: Airtable Meta API returned {e.code}:")
        try:
            print(json.dumps(json.loads(body), indent=2))
        except Exception:
            print(body)

        if e.code == 403:
            print("\nHint: Your PAT needs the 'schema.bases:write' scope.")
        elif e.code == 422:
            print("\nHint: The table 'Verified-Companies' might already exist.")
        sys.exit(1)

    table_id = data.get("id", "???")
    table_name = data.get("name", "???")
    fields = data.get("fields", [])

    print(f"Table created successfully!")
    print(f"  Name: {table_name}")
    print(f"  ID:   {table_id}")
    print(f"  Fields: {len(fields)}")
    for f in fields:
        print(f"    - {f['name']} ({f['type']})")

    print(f"\nNext step: set TABLE_NAME = '{table_name}' in src/utils/airtableVerified.js")
    return data


if __name__ == "__main__":
    create_table()
