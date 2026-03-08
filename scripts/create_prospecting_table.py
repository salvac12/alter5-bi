#!/usr/bin/env python3
"""
Create the "ProspectingResults" table in Airtable via the Meta API.

Run ONCE to set up the table schema. After creation the table ID is
printed — copy it into airtableProspecting.js (TABLE_NAME constant).

Requires:
  - AIRTABLE_PAT  (Personal Access Token with schema.bases:write)
  - AIRTABLE_BASE_ID (default: appVu3TvSZ1E4tj0J)

Usage:
  AIRTABLE_PAT=patXXX python scripts/create_prospecting_table.py
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

# -- Enums --
JOB_STATUS_CHOICES = [
    {"name": "pending", "color": "grayLight2"},
    {"name": "running", "color": "blueLight2"},
    {"name": "completed", "color": "greenLight2"},
    {"name": "failed", "color": "redLight2"},
]

ROLE_CHOICES = [
    {"name": "Originación", "color": "yellowLight2"},
    {"name": "Inversión", "color": "blueLight2"},
    {"name": "Ecosistema", "color": "grayLight2"},
    {"name": "No relevante", "color": "grayDark1"},
]

SEGMENT_CHOICES = [
    {"name": "Project Finance", "color": "cyanLight2"},
    {"name": "Corporate Finance", "color": "orangeLight2"},
]

CONFIDENCE_CHOICES = [
    {"name": "high", "color": "greenLight2"},
    {"name": "medium", "color": "yellowLight2"},
    {"name": "low", "color": "redLight2"},
]

REVIEW_STATUS_CHOICES = [
    {"name": "pending", "color": "grayLight2"},
    {"name": "approved", "color": "greenLight2"},
    {"name": "skipped", "color": "yellowLight2"},
    {"name": "rejected", "color": "redLight2"},
]

FINDYMAIL_STATUS_CHOICES = [
    {"name": "found", "color": "greenLight2"},
    {"name": "not_found", "color": "redLight2"},
    {"name": "pending", "color": "grayLight2"},
]

# -- Table definition --
TABLE_SCHEMA = {
    "name": "ProspectingResults",
    "fields": [
        # Job metadata
        {
            "name": "JobId",
            "type": "singleLineText",
            "description": "Unique job ID (e.g. job_20260308_abc123)",
        },
        {
            "name": "JobName",
            "type": "singleLineText",
            "description": "Descriptive job name (e.g. Debt Solar España Q1 2026)",
        },
        {
            "name": "SearchCriteria",
            "type": "multilineText",
            "description": "JSON with search criteria used",
        },
        {
            "name": "JobStatus",
            "type": "singleSelect",
            "description": "Job execution status",
            "options": {"choices": JOB_STATUS_CHOICES},
        },
        {
            "name": "CreatedAt",
            "type": "singleLineText",
            "description": "ISO datetime when job was created",
        },
        {
            "name": "CreatedBy",
            "type": "singleLineText",
            "description": "User who created the job",
        },
        # Company data
        {
            "name": "CompanyName",
            "type": "singleLineText",
            "description": "Company display name",
        },
        {
            "name": "CompanyUrl",
            "type": "url",
            "description": "Company website URL",
        },
        {
            "name": "Country",
            "type": "singleLineText",
            "description": "ISO country code (ES, IT, DE, PL...)",
        },
        {
            "name": "TaxId",
            "type": "singleLineText",
            "description": "Tax ID or PENDING",
        },
        {
            "name": "Description",
            "type": "multilineText",
            "description": "Brief company description",
        },
        {
            "name": "FinancingSignals",
            "type": "multilineText",
            "description": "Evidence of financing need (debt/equity signals)",
        },
        {
            "name": "AssetType",
            "type": "singleLineText",
            "description": "Asset type (Solar PV, Cold storage, Data center...)",
        },
        {
            "name": "EstimatedSize",
            "type": "singleLineText",
            "description": "Estimated company/portfolio size",
        },
        # Classification
        {
            "name": "Role",
            "type": "singleSelect",
            "description": "Alter5 company role",
            "options": {"choices": ROLE_CHOICES},
        },
        {
            "name": "Segment",
            "type": "singleSelect",
            "description": "Alter5 segment (only if Originación)",
            "options": {"choices": SEGMENT_CHOICES},
        },
        {
            "name": "CompanyType",
            "type": "singleLineText",
            "description": "Alter5 company type",
        },
        {
            "name": "MarketRoles",
            "type": "multilineText",
            "description": "JSON array of market roles",
        },
        {
            "name": "Technologies",
            "type": "multilineText",
            "description": "JSON array of technologies",
        },
        {
            "name": "Geography",
            "type": "multilineText",
            "description": "JSON array of ISO country codes",
        },
        {
            "name": "ClassificationNotes",
            "type": "multilineText",
            "description": "Notes from AI classification",
        },
        # Quality
        {
            "name": "Confidence",
            "type": "singleSelect",
            "description": "Classification confidence",
            "options": {"choices": CONFIDENCE_CHOICES},
        },
        {
            "name": "SourcesFound",
            "type": "multilineText",
            "description": "JSON array of sources where company was found",
        },
        # Review
        {
            "name": "ReviewStatus",
            "type": "singleSelect",
            "description": "Human review status",
            "options": {"choices": REVIEW_STATUS_CHOICES},
        },
        {
            "name": "ReviewedBy",
            "type": "singleLineText",
            "description": "User who reviewed",
        },
        {
            "name": "ReviewedAt",
            "type": "singleLineText",
            "description": "ISO datetime of review",
        },
        {
            "name": "Notes",
            "type": "multilineText",
            "description": "Manual notes about this company",
        },
        # Contact
        {
            "name": "ContactName",
            "type": "singleLineText",
            "description": "Key financial contact name",
        },
        {
            "name": "ContactRole",
            "type": "singleLineText",
            "description": "Contact role (CFO, CEO, Director Financiero...)",
        },
        {
            "name": "ContactLinkedIn",
            "type": "url",
            "description": "Contact LinkedIn profile URL",
        },
        {
            "name": "ContactEmail",
            "type": "singleLineText",
            "description": "Contact email address",
        },
        {
            "name": "FindymailStatus",
            "type": "singleSelect",
            "description": "Email finding status",
            "options": {"choices": FINDYMAIL_STATUS_CHOICES},
        },
        {
            "name": "ApolloData",
            "type": "multilineText",
            "description": "JSON with full Apollo data",
        },
        # Pipeline refs
        {
            "name": "CampaignRef",
            "type": "singleLineText",
            "description": "Link to CampaignTargets when company advances",
        },
        {
            "name": "ProspectId",
            "type": "singleLineText",
            "description": "Link to BETA-Prospects if converted",
        },
    ],
}


def create_table():
    """Create the ProspectingResults table via Airtable Meta API."""
    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT environment variable not set")
        print("Usage: AIRTABLE_PAT=patXXX python scripts/create_prospecting_table.py")
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
            print("\nHint: The table 'ProspectingResults' might already exist.")
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

    print(f"\nNext step: set TABLE_NAME = '{table_name}' in src/utils/airtableProspecting.js")
    return data


if __name__ == "__main__":
    create_table()
