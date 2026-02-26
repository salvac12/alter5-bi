#!/usr/bin/env python3
"""
Create the "Prospects" table in Airtable via the Meta API.

Run ONCE to set up the table schema.  After creation the table ID is
printed — copy it into airtableProspects.js (PROSPECTS_TABLE_NAME constant).

Requires:
  - AIRTABLE_PAT  (Personal Access Token with schema.bases:write + data.records:read)
  - AIRTABLE_BASE_ID (default: appVu3TvSZ1E4tj0J)

Usage:
  python scripts/create_prospects_table.py
"""

import json
import os
import ssl
import sys
import urllib.request
import urllib.error

# SSL context (same pattern as sync_airtable_opportunities.py)
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# ── Config ──────────────────────────────────────────────────────────
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")

# ── Table definition ────────────────────────────────────────────────

STAGE_CHOICES = [
    {"name": "Lead", "color": "blueLight2"},
    {"name": "Interesado", "color": "cyanLight2"},
    {"name": "Reunion", "color": "yellowLight2"},
    {"name": "Documentacion Pendiente", "color": "orangeLight2"},
    {"name": "Listo para Term-Sheet", "color": "greenLight2"},
]

ORIGIN_CHOICES = [
    {"name": "Referral", "color": "blueLight2"},
    {"name": "Evento", "color": "purpleLight2"},
    {"name": "Campana", "color": "pinkLight2"},
    {"name": "Cold Outreach", "color": "grayLight2"},
    {"name": "Web/Inbound", "color": "cyanLight2"},
    {"name": "Otro", "color": "grayLight2"},
]

CURRENCY_CHOICES = [
    {"name": "EUR", "color": "blueLight2"},
    {"name": "USD", "color": "greenLight2"},
    {"name": "GBP", "color": "purpleLight2"},
]

PRODUCT_CHOICES = [
    {"name": "Debt", "color": "blueLight2"},
    {"name": "Equity", "color": "greenLight2"},
]

TEAM_CHOICES = [
    {"name": "Carlos Almodovar", "color": "blueLight2"},
    {"name": "Gonzalo de Gracia", "color": "cyanLight2"},
    {"name": "Miguel Solana", "color": "yellowLight2"},
    {"name": "Salvador Carrillo", "color": "orangeLight2"},
    {"name": "Rafael Nevado", "color": "greenLight2"},
    {"name": "Javier Ruiz", "color": "purpleLight2"},
    {"name": "Leticia Menendez", "color": "pinkLight2"},
    {"name": "Otro", "color": "grayLight2"},
]

TABLE_SCHEMA = {
    "name": "BETA-Prospects",
    "fields": [
        {
            "name": "Prospect Name",
            "type": "singleLineText",
            "description": "Company or deal name",
        },
        {
            "name": "Stage",
            "type": "singleSelect",
            "description": "Funnel stage",
            "options": {"choices": STAGE_CHOICES},
        },
        {
            "name": "Amount",
            "type": "number",
            "description": "Estimated deal amount",
            "options": {"precision": 0},
        },
        {
            "name": "Currency",
            "type": "singleSelect",
            "description": "Currency of the amount",
            "options": {"choices": CURRENCY_CHOICES},
        },
        {
            "name": "Product",
            "type": "singleSelect",
            "description": "Alter5 product line",
            "options": {"choices": PRODUCT_CHOICES},
        },
        {
            "name": "Origin",
            "type": "singleSelect",
            "description": "Source of the prospect",
            "options": {"choices": ORIGIN_CHOICES},
        },
        {
            "name": "Context",
            "type": "multilineText",
            "description": "Meeting notes, transcription, context",
        },
        {
            "name": "Next Steps",
            "type": "multilineText",
            "description": "Pending tasks / next actions",
        },
        {
            "name": "Deal Manager",
            "type": "singleSelect",
            "description": "Deal manager responsible for this prospect",
            "options": {"choices": TEAM_CHOICES[:7]},
        },
        {
            "name": "Tasks",
            "type": "multilineText",
            "description": "JSON-stringified array of task objects",
        },
        {
            "name": "Assigned To",
            "type": "singleSelect",
            "description": "Team member responsible",
            "options": {"choices": TEAM_CHOICES},
        },
        {
            "name": "Assigned Email",
            "type": "email",
            "description": "Email of external assignee (when Assigned To = Otro)",
        },
        {
            "name": "Converted",
            "type": "checkbox",
            "description": "Whether this prospect was converted to an Opportunity",
            "options": {"icon": "check", "color": "greenBright"},
        },
        {
            "name": "Opportunity ID",
            "type": "singleLineText",
            "description": "Airtable record ID of the created Opportunity (recXXX)",
        },
        {
            "name": "Record Status",
            "type": "singleSelect",
            "description": "Active or Archived",
            "options": {
                "choices": [
                    {"name": "Active", "color": "greenLight2"},
                    {"name": "Archived", "color": "grayLight2"},
                ]
            },
        },
    ],
}


def create_table():
    """Create the Prospects table via Airtable Meta API."""
    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT environment variable not set")
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
            print("\nHint: Your PAT probably needs the 'schema.bases:write' scope.")
            print("Go to https://airtable.com/create/tokens and add it.")
        elif e.code == 422:
            print("\nHint: The table 'Prospects' might already exist in this base.")
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

    print(f"\nNext step: use table name '{table_name}' in airtableProspects.js")
    return data


if __name__ == "__main__":
    create_table()
