#!/usr/bin/env python3
"""
Create the "Cerebro-Knowledge" table in Airtable via the Meta API.

Run ONCE to set up the table schema. After creation the table ID is
printed — copy it into airtableCerebro.js (TABLE_NAME constant).

Requires:
  - AIRTABLE_PAT  (Personal Access Token with schema.bases:write)
  - AIRTABLE_BASE_ID (default: appVu3TvSZ1E4tj0J)

Usage:
  python scripts/create_cerebro_table.py
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

# ── Config ──────────────────────────────────────────────────────────
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")

# ── Table definition ────────────────────────────────────────────────

TABLE_SCHEMA = {
    "name": "Cerebro-Knowledge",
    "fields": [
        {
            "name": "Question",
            "type": "singleLineText",
            "description": "Natural language question asked by the user",
        },
        {
            "name": "Answer",
            "type": "multilineText",
            "description": "Gemini AI response",
        },
        {
            "name": "Keywords",
            "type": "singleLineText",
            "description": "Comma-separated keywords extracted from the question",
        },
        {
            "name": "MatchedDomains",
            "type": "multilineText",
            "description": "JSON array of company domains that matched",
        },
        {
            "name": "MatchCount",
            "type": "number",
            "description": "Number of companies that matched the query",
            "options": {"precision": 0},
        },
        {
            "name": "Useful",
            "type": "checkbox",
            "description": "User feedback: checked = useful, unchecked = not rated or not useful",
            "options": {"icon": "check", "color": "greenBright"},
        },
        {
            "name": "NotUseful",
            "type": "checkbox",
            "description": "User marked this answer as not useful",
            "options": {"icon": "xCheckbox", "color": "redBright"},
        },
        {
            "name": "CreatedAt",
            "type": "singleLineText",
            "description": "ISO timestamp when the query was made",
        },
    ],
}


def create_table():
    """Create the Cerebro-Knowledge table via Airtable Meta API."""
    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT environment variable not set")
        print("Usage: AIRTABLE_PAT=patXXX python scripts/create_cerebro_table.py")
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
            print("\nHint: The table 'Cerebro-Knowledge' might already exist.")
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

    print(f"\nNext step: set TABLE_NAME = '{table_name}' in src/utils/airtableCerebro.js")
    return data


if __name__ == "__main__":
    create_table()
