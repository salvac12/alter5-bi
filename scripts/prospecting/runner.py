#!/usr/bin/env python3
"""
Prospecting Runner — main orchestrator called by GitHub Actions.

Flow:
  1. Read criteria from PROSPECTING_CRITERIA env var (JSON string)
  2. Call sources_seeker.run(criteria) → sources
  3. Call company_seeker.run(criteria, sources) → companies
  4. For each company: contact_finder.find_contact() → contact
  5. Deduplicate against CampaignTargets in Airtable (by domain)
  6. Upload results to ProspectingResults table in Airtable
  7. Update JobStatus to "completed" or "failed"

Requires env vars:
  PROSPECTING_CRITERIA  — JSON string with search criteria + job metadata
  AIRTABLE_PAT          — Airtable Personal Access Token
  GEMINI_API_KEY        — for sources_seeker
  ANTHROPIC_API_KEY     — for company_seeker
  APOLLO_API_KEY        — for contact_finder (optional)
  FINDYMAIL_API_KEY     — for contact_finder (optional)
"""

import json
import os
import sys
import ssl
import urllib.request
import re
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from urllib.parse import urlparse

# Add parent directory to path so we can import siblings
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from prospecting import sources_seeker, company_seeker, contact_finder

# -- Config --
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")
PROSPECTING_TABLE = "ProspectingResults"
CAMPAIGN_TARGETS_TABLE = "CampaignTargets"

# SSL context
import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())


def _safe_formula_str(value):
    """Sanitize a string for use in Airtable formula — escape single quotes."""
    return re.sub(r"['\"]", "", str(value))


def airtable_headers():
    return {
        "Authorization": f"Bearer {AIRTABLE_PAT}",
        "Content-Type": "application/json",
    }


def airtable_request(method, table, payload=None, params=""):
    """Make an Airtable API request."""
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{urllib.parse.quote(table)}{params}"
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(
        url, data=data, method=method, headers=airtable_headers()
    )
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        return None, f"HTTP {e.code}: {body[:300]}"
    except Exception as e:
        return None, str(e)


def extract_domain(url):
    """Extract domain from URL."""
    if not url:
        return ""
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
        domain = parsed.netloc.lower()
        return domain.replace("www.", "")
    except Exception:
        return url.lower().replace("www.", "").split("/")[0]


def fetch_existing_campaign_domains():
    """Fetch all domains from CampaignTargets to deduplicate."""
    domains = set()
    offset = ""
    try:
        while True:
            params = f"?pageSize=100&fields[]=domain"
            if offset:
                params += f"&offset={offset}"
            data, err = airtable_request("GET", CAMPAIGN_TARGETS_TABLE, params=params)
            if err or not data:
                break
            for r in data.get("records", []):
                d = r.get("fields", {}).get("domain", "")
                if d:
                    domains.add(d.lower())
            offset = data.get("offset", "")
            if not offset:
                break
    except Exception as e:
        print(f"[runner] Warning: could not fetch CampaignTargets: {e}")
    return domains


def fetch_existing_prospecting_domains(job_id):
    """Fetch domains already in ProspectingResults for this job."""
    domains = set()
    offset = ""
    try:
        filter_formula = f"FIND('{_safe_formula_str(job_id)}', {{JobId}})"
        while True:
            params = f"?pageSize=100&fields[]=CompanyUrl&filterByFormula={urllib.parse.quote(filter_formula)}"
            if offset:
                params += f"&offset={offset}"
            data, err = airtable_request("GET", PROSPECTING_TABLE, params=params)
            if err or not data:
                break
            for r in data.get("records", []):
                url = r.get("fields", {}).get("CompanyUrl", "")
                d = extract_domain(url)
                if d:
                    domains.add(d)
            offset = data.get("offset", "")
            if not offset:
                break
    except Exception as e:
        print(f"[runner] Warning: could not fetch existing prospecting domains: {e}")
    return domains


def update_job_status(job_id, status, notes=None):
    """Update the JobStatus field for all records with this job_id."""
    import urllib.parse
    filter_formula = f"FIND('{_safe_formula_str(job_id)}', {{JobId}})"
    params = f"?pageSize=100&filterByFormula={urllib.parse.quote(filter_formula)}&fields[]=JobId"
    data, err = airtable_request("GET", PROSPECTING_TABLE, params=params)
    if err or not data:
        print(f"[runner] Could not find job records to update status: {err}")
        return

    record_ids = [r["id"] for r in data.get("records", [])]
    if not record_ids:
        print(f"[runner] No records found for job {job_id}")
        return

    fields = {"JobStatus": status}
    if notes:
        fields["Notes"] = notes

    # Update in batches of 10
    for i in range(0, len(record_ids), 10):
        batch = record_ids[i:i + 10]
        payload = {
            "records": [{"id": rid, "fields": fields} for rid in batch]
        }
        _, err = airtable_request("PATCH", PROSPECTING_TABLE, payload=payload)
        if err:
            print(f"[runner] Error updating job status: {err}")


def build_airtable_record(company, criteria, job_id, job_name, contact_result, existing_campaign_domains):
    """Build Airtable record fields from company + contact data."""
    domain = extract_domain(company.get("company_url", ""))
    classification = company.get("alter5_classification", {})

    # Check deduplication
    dedup_note = ""
    if domain and domain in existing_campaign_domains:
        dedup_note = "Ya existe en CampaignTargets"

    # Role mapping (remove accents for singleSelect compatibility)
    role_raw = classification.get("role", "")
    role_map = {
        "Originación": "Originación",
        "Inversión": "Inversión",
        "Ecosistema": "Ecosistema",
        "No relevante": "No relevante",
    }
    role = role_map.get(role_raw, role_raw) if role_raw else None

    segment_raw = classification.get("segment", "")
    segment = segment_raw if segment_raw in ("Project Finance", "Corporate Finance") else None

    confidence_raw = company.get("confidence", "low")
    confidence = confidence_raw if confidence_raw in ("high", "medium", "low") else "low"

    fields = {
        "JobId": job_id,
        "JobName": job_name,
        "SearchCriteria": json.dumps(criteria, ensure_ascii=False),
        "JobStatus": "completed",
        "CreatedAt": datetime.now(timezone.utc).isoformat(),
        "CreatedBy": criteria.get("created_by", "agent"),
        "CompanyName": company.get("company_name", ""),
        "CompanyUrl": company.get("company_url", ""),
        "Country": company.get("country", ""),
        "TaxId": company.get("tax_id", "PENDING"),
        "Description": company.get("brief_description", ""),
        "FinancingSignals": company.get("financing_signals") or "",
        "AssetType": company.get("asset_type", ""),
        "EstimatedSize": company.get("estimated_size") or "",
        "CompanyType": classification.get("company_type", ""),
        "MarketRoles": json.dumps(classification.get("market_roles", []), ensure_ascii=False),
        "Technologies": json.dumps(classification.get("technologies", []), ensure_ascii=False),
        "Geography": json.dumps(classification.get("geography", []), ensure_ascii=False),
        "ClassificationNotes": classification.get("classification_notes", ""),
        "Confidence": confidence,
        "SourcesFound": json.dumps(company.get("sources_found", []), ensure_ascii=False),
        "ReviewStatus": "pending",
        "Notes": dedup_note + ("\n" if dedup_note else "") + (company.get("notes") or ""),
    }

    # Add optional singleSelect fields only if valid
    if role:
        fields["Role"] = role
    if segment:
        fields["Segment"] = segment

    # Contact data
    if contact_result:
        if contact_result.get("contact_name"):
            fields["ContactName"] = contact_result["contact_name"]
        if contact_result.get("contact_role"):
            fields["ContactRole"] = contact_result["contact_role"]
        if contact_result.get("contact_linkedin"):
            fields["ContactLinkedIn"] = contact_result["contact_linkedin"]
        if contact_result.get("contact_email"):
            fields["ContactEmail"] = contact_result["contact_email"]

        fm_status = contact_result.get("findymail_status", "pending")
        if fm_status in ("found", "not_found", "pending"):
            fields["FindymailStatus"] = fm_status

        if contact_result.get("apollo_data"):
            fields["ApolloData"] = json.dumps(contact_result["apollo_data"], ensure_ascii=False)

    return fields


def upload_companies_to_airtable(companies, criteria, job_id, job_name, existing_campaign_domains):
    """Upload company records to Airtable ProspectingResults in batches of 10."""
    total = len(companies)
    uploaded = 0
    errors = 0

    print(f"[runner] Uploading {total} companies to Airtable...")

    for i in range(0, total, 10):
        batch = companies[i:i + 10]
        records = []

        for company in batch:
            # Find contact for each company
            try:
                domain = extract_domain(company.get("company_url", ""))
                contact_hints = company.get("contact_hints", {})
                target_roles = contact_hints.get("target_roles", ["CFO", "Director Financiero"])

                contact_result = contact_finder.find_contact(
                    company_name=company.get("company_name", ""),
                    domain=domain,
                    target_roles=target_roles,
                    linkedin_company_url=contact_hints.get("linkedin_company_url"),
                )
            except Exception as e:
                print(f"[runner] Contact finder error for {company.get('company_name')}: {e}")
                contact_result = {"findymail_status": "not_found"}

            fields = build_airtable_record(
                company, criteria, job_id, job_name,
                contact_result, existing_campaign_domains
            )
            records.append({"fields": fields})

        payload = {"records": records}
        _, err = airtable_request("POST", PROSPECTING_TABLE, payload=payload)
        if err:
            print(f"[runner] Error uploading batch {i//10 + 1}: {err}")
            errors += len(batch)
        else:
            uploaded += len(batch)
            print(f"[runner] Uploaded {uploaded}/{total} companies")

    return uploaded, errors


def set_job_running(job_id):
    """
    Update the existing job placeholder (created by frontend) to status 'running'.
    Returns True if a record was updated, False if none found (e.g. manual workflow_dispatch).
    """
    filter_formula = f"AND({{JobId}}='{_safe_formula_str(job_id)}', {{CompanyName}}='__JOB_PLACEHOLDER__')"
    params = f"?pageSize=1&filterByFormula={urllib.parse.quote(filter_formula)}&fields[]=JobId"
    data, err = airtable_request("GET", PROSPECTING_TABLE, params=params)
    if err or not data or not data.get("records"):
        return False
    record_ids = [r["id"] for r in data["records"]]
    payload = {"records": [{"id": record_ids[0], "fields": {"JobStatus": "running"}}]}
    _, err = airtable_request("PATCH", PROSPECTING_TABLE, payload=payload)
    if err:
        print(f"[runner] Warning: could not set job running: {err}")
        return False
    print(f"[runner] Set existing job record to 'running'")
    return True


def create_job_placeholder(job_id, job_name, criteria):
    """Create a placeholder record to mark the job as running (used when no frontend record exists)."""
    fields = {
        "JobId": job_id,
        "JobName": job_name,
        "SearchCriteria": json.dumps(criteria, ensure_ascii=False),
        "JobStatus": "running",
        "CreatedAt": datetime.now(timezone.utc).isoformat(),
        "CreatedBy": criteria.get("created_by", "agent"),
        "CompanyName": "__JOB_PLACEHOLDER__",
        "ReviewStatus": "pending",
    }
    payload = {"records": [{"fields": fields}]}
    data, err = airtable_request("POST", PROSPECTING_TABLE, payload=payload)
    if err:
        print(f"[runner] Warning: could not create job placeholder: {err}")
        return None
    records = data.get("records", [])
    return records[0]["id"] if records else None


def delete_placeholder(record_id):
    """Delete the job placeholder record."""
    if not record_id:
        return
    _, err = airtable_request("DELETE", PROSPECTING_TABLE, params=f"/{record_id}")
    if err:
        print(f"[runner] Warning: could not delete placeholder: {err}")


def main():
    # Read criteria from env var
    criteria_raw = os.environ.get("PROSPECTING_CRITERIA", "")
    if not criteria_raw:
        print("ERROR: PROSPECTING_CRITERIA environment variable not set")
        sys.exit(1)

    try:
        criteria = json.loads(criteria_raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in PROSPECTING_CRITERIA: {e}")
        sys.exit(1)

    if not AIRTABLE_PAT:
        print("ERROR: AIRTABLE_PAT environment variable not set")
        sys.exit(1)

    # Generate job ID if not provided
    job_id = criteria.get("job_id") or f"job_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    job_name = criteria.get("job_name") or criteria.get("description", "Prospecting Job")

    print(f"[runner] Starting job {job_id}: {job_name}")
    print(f"[runner] Criteria: {json.dumps(criteria, indent=2, ensure_ascii=False)}")

    # Mark job as running: update existing frontend placeholder if any, else create one
    if set_job_running(job_id):
        placeholder_id = None  # we updated the existing record; nothing to delete later
    else:
        placeholder_id = create_job_placeholder(job_id, job_name, criteria)

    try:
        # STEP 1: Find sources
        print("\n[runner] === STEP 1: Sources Seeker ===")
        try:
            sources = sources_seeker.run(criteria)
        except Exception as e:
            print(f"[runner] Sources Seeker failed: {e}")
            print("[runner] Attempting direct search without sources...")
            sources = {"sources": []}

        print(f"[runner] Sources found: {len(sources.get('sources', []))}")

        # STEP 2: Extract companies
        print("\n[runner] === STEP 2: Company Seeker ===")
        try:
            companies_result = company_seeker.run(criteria, sources)
        except Exception as e:
            print(f"[runner] Company Seeker failed: {e}")
            delete_placeholder(placeholder_id)
            update_job_status(job_id, "failed", str(e))
            sys.exit(1)

        companies = companies_result.get("companies", [])
        print(f"[runner] Companies extracted: {len(companies)}")

        if not companies:
            print("[runner] No companies found, marking job as completed with 0 results")
            delete_placeholder(placeholder_id)
            # Create a summary record
            fields = {
                "JobId": job_id,
                "JobName": job_name,
                "SearchCriteria": json.dumps(criteria, ensure_ascii=False),
                "JobStatus": "completed",
                "CreatedAt": datetime.now(timezone.utc).isoformat(),
                "CreatedBy": criteria.get("created_by", "agent"),
                "CompanyName": "__NO_RESULTS__",
                "Notes": "Job completed with 0 companies found",
                "ReviewStatus": "pending",
            }
            airtable_request("POST", PROSPECTING_TABLE, payload={"records": [{"fields": fields}]})
            return

        # STEP 3: Deduplicate against CampaignTargets
        print("\n[runner] === STEP 3: Deduplication ===")
        existing_campaign_domains = fetch_existing_campaign_domains()
        existing_prospecting_domains = fetch_existing_prospecting_domains(job_id)
        print(f"[runner] Existing CampaignTargets domains: {len(existing_campaign_domains)}")

        # Filter out duplicates within this run
        seen_domains = set(existing_prospecting_domains)
        unique_companies = []
        for company in companies:
            domain = extract_domain(company.get("company_url", ""))
            if domain and domain in seen_domains:
                print(f"[runner] Skipping duplicate: {domain}")
                continue
            seen_domains.add(domain)
            unique_companies.append(company)

        print(f"[runner] Unique companies after dedup: {len(unique_companies)}")

        # STEP 4: Upload to Airtable
        print("\n[runner] === STEP 4: Upload to Airtable ===")
        delete_placeholder(placeholder_id)

        uploaded, errors = upload_companies_to_airtable(
            unique_companies, criteria, job_id, job_name, existing_campaign_domains
        )

        print(f"\n[runner] Job {job_id} completed!")
        print(f"[runner] Uploaded: {uploaded}, Errors: {errors}")

        if errors > 0 and uploaded == 0:
            sys.exit(1)

    except Exception as e:
        print(f"\n[runner] FATAL ERROR: {e}")
        delete_placeholder(placeholder_id)
        update_job_status(job_id, "failed", str(e))
        raise


if __name__ == "__main__":
    main()
