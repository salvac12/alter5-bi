#!/usr/bin/env python3
"""
Sync Airtable Opportunities → src/data/opportunities.json

Reads the "Opportunities" table from Airtable via REST API and generates
a compact JSON file that the frontend uses to highlight companies with
active deals and filter by pipeline stage.

Requires:
  - AIRTABLE_PAT  (Personal Access Token with data.records:read)
  - AIRTABLE_BASE_ID (default: appVu3TvSZ1E4tj0J)

Usage:
  python scripts/sync_airtable_opportunities.py
"""

import json
import os
import ssl
import sys
import urllib.request
import urllib.error

# SSL context for environments with missing certs (e.g. macOS Python)
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    # Fallback: if system certs are missing, allow unverified (local dev only)
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# ── Config ──────────────────────────────────────────────────────────
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")
TABLE_NAME = "Opportunities"
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "src", "data", "opportunities.json")

# Kanban stage ordering (matches Airtable "Global Status" values)
STAGE_ORDER = [
    "New",
    "Origination - Preparation & NDA",
    "Origination - Financial Analysis",
    "Origination - Termsheet",
    "Distribution - Preparation",
    "Distribution - Ongoing",
    "In Execution",
    "Closed Successfully",
    "Lost",
]


def fetch_all_records():
    """Fetch all records from Airtable using pagination."""
    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT environment variable not set")
        sys.exit(1)

    records = []
    offset = None
    base_url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{urllib.request.quote(TABLE_NAME)}"
    # Only fetch active Transactions (exclude Internal Initiatives + Inactive/Archived)
    formula = urllib.request.quote('AND({Type of opportunity} = "Transaction", {Record Status} = "Active")')

    while True:
        url = f"{base_url}?filterByFormula={formula}"
        if offset:
            url += f"&offset={offset}"

        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {AIRTABLE_PAT}",
            "Content-Type": "application/json",
        })

        try:
            with urllib.request.urlopen(req, context=SSL_CTX) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8") if e.fp else ""
            print(f"ERROR: Airtable API returned {e.code}: {body}")
            sys.exit(1)

        records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break

    return records


def normalize_name(name):
    """Normalize company name for fuzzy matching."""
    import unicodedata
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    return name.lower().strip()


def extract_opportunity(record):
    """Extract relevant fields from an Airtable record."""
    fields = record.get("fields", {})

    # Primary field: "Opportunity Name"
    name = fields.get("Opportunity Name", fields.get("Name", fields.get("Nombre", "")))
    if not name:
        return None

    # Stage: "Global Status" is the Kanban column
    stage = fields.get("Global Status", fields.get("Stage", fields.get("Status", ""))) or ""

    # Sub-status within the stage
    workflow_phase = fields.get("Workflow Phase (Debt)", "")

    # Amount: "Targeted Ticket Size"
    amount = fields.get("Targeted Ticket Size", fields.get("Amount", 0)) or 0
    if isinstance(amount, str):
        amount = float(amount.replace(",", "").replace(".", "")) if amount else 0

    # Currency (linked record, just note it)
    currency = fields.get("Currency", "")
    if isinstance(currency, list):
        currency = "EUR"  # Default, linked records come as IDs
    currency = str(currency) if currency else "EUR"

    # Record status (active, archived, etc.)
    record_status = fields.get("Record Status", "")

    # Type of opportunity: "Transaction" vs "Internal Initiative"
    opp_type = fields.get("Type of opportunity", "")

    # Business type from linked "Type (from Business Program)"
    business_type = fields.get("Type (from Business Program)", "")
    if isinstance(business_type, list):
        business_type = business_type[0] if business_type else ""

    # Skip archived/deleted/inactive records
    if record_status and record_status.lower() in ("archived", "deleted", "inactive"):
        return None

    # Skip Internal Initiatives — only keep Transactions
    if opp_type and opp_type != "Transaction":
        return None

    # Skip junk / test records
    import re
    clean_name = name.strip()
    if not clean_name or len(clean_name) < 3:
        return None
    if re.match(r'^(test|prueba|unnamed|sin nombre|xxx|aaa|bbb|dummy|ejemplo|sample|sabri)\b', clean_name, re.IGNORECASE):
        return None
    # Known junk exact names
    if clean_name.lower() in ("all", "defense", "lm8", "bwb", "dvp"):
        return None
    # No stage = orphan record
    if not stage:
        return None

    return {
        "id": record["id"],
        "name": name.strip(),
        "name_normalized": normalize_name(name),
        "stage": stage,
        "phase": workflow_phase,
        "amount": amount,
        "currency": currency,
        "businessType": str(business_type) if business_type else "",
    }


def build_output(records):
    """Build the output JSON structure."""
    opportunities = []
    for r in records:
        opp = extract_opportunity(r)
        if opp:
            opportunities.append(opp)

    # Sort by stage order, then by name
    stage_idx = {s: i for i, s in enumerate(STAGE_ORDER)}
    opportunities.sort(key=lambda o: (stage_idx.get(o["stage"], 99), o["name"]))

    # Collect unique stages
    stages = []
    seen = set()
    for o in opportunities:
        if o["stage"] and o["stage"] not in seen:
            stages.append(o["stage"])
            seen.add(o["stage"])

    # Build compact output
    from datetime import datetime, timezone
    output = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stages": stages,
        "opportunities": [
            {
                "name": o["name"],
                "nn": o["name_normalized"],
                "stage": o["stage"],
                "phase": o.get("phase", ""),
                "amount": o["amount"],
                "currency": o["currency"],
                "businessType": o.get("businessType", ""),
            }
            for o in opportunities
        ],
    }

    return output


def main():
    print(f"Fetching opportunities from Airtable base {AIRTABLE_BASE_ID}...")
    records = fetch_all_records()
    print(f"  Found {len(records)} records")

    output = build_output(records)
    print(f"  {len(output['opportunities'])} valid opportunities")
    print(f"  Stages: {output['stages']}")

    # Write output
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"  Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
