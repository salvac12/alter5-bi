#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Backfill Employee Count & Revenue
===============================================================

  Lightweight script that enriches companies with employee_count
  and estimated_revenue_eur via Gemini + Google Search grounding.

  Much faster than verify_classifications.py because it batches
  10 companies per Gemini call and only asks for 2 data points.

  Results are written to:
  - companies_full.json (enrichment: emp_count, emp_source, revenue_eur, rev_source)
  - Airtable Verified-Companies (Employee Count / Revenue fields only)

  Usage:
    export GEMINI_API_KEY="AIza..."
    export AIRTABLE_PAT="patXXX..."

    python scripts/backfill_employee_count.py                  # top 100 by interactions
    python scripts/backfill_employee_count.py --top 500        # top 500
    python scripts/backfill_employee_count.py --all            # all companies
    python scripts/backfill_employee_count.py --domain X       # single company
    python scripts/backfill_employee_count.py --stats          # show stats only
    python scripts/backfill_employee_count.py --dry-run        # preview without writing

  Estimated cost: ~$0.001-0.005 per company (batched)
  Estimated time: ~5s per batch of 10 companies
===============================================================
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from import_mailbox import get_data_paths

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_RPM_DELAY = float(os.environ.get("GEMINI_RPM_DELAY", "5"))
BATCH_SIZE = 10

# SSL context
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# Airtable config
AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT", "")
AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")
VERIFIED_TABLE_NAME = "Verified-Companies"
AIRTABLE_API = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{urllib.request.quote(VERIFIED_TABLE_NAME)}"


# ---------------------------------------------------------------------------
# Airtable helpers
# ---------------------------------------------------------------------------
def airtable_headers():
    return {
        "Authorization": f"Bearer {AIRTABLE_PAT}",
        "Content-Type": "application/json",
    }


def fetch_verified_domains():
    """Fetch all domains already in Verified-Companies table (with emp count info)."""
    if not AIRTABLE_PAT:
        return {}

    domains = {}
    offset = ""
    try:
        while True:
            url = AIRTABLE_API + "?pageSize=100"
            if offset:
                url += f"&offset={offset}"
            req = urllib.request.Request(url, headers=airtable_headers())
            with urllib.request.urlopen(req, context=SSL_CTX) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for rec in data.get("records", []):
                domain = rec.get("fields", {}).get("Domain", "")
                if domain:
                    domains[domain] = {
                        "record_id": rec["id"],
                        "employee_count": rec["fields"].get("Employee Count"),
                        "revenue": rec["fields"].get("Estimated Revenue EUR"),
                    }
            offset = data.get("offset", "")
            if not offset:
                break
    except Exception as e:
        print(f"  [warn] Failed to fetch verified domains: {e}")

    return domains


def upsert_employee_data(domain, company_name, emp_count, emp_source, revenue, rev_source, existing_records):
    """Create or update only employee/revenue fields in Airtable Verified-Companies."""
    if not AIRTABLE_PAT:
        return None

    fields = {"Domain": domain, "Company Name": company_name or domain}

    if emp_count is not None and isinstance(emp_count, (int, float)) and emp_count > 0:
        fields["Employee Count"] = int(emp_count)
    if emp_source:
        fields["Employee Count Source"] = str(emp_source)[:200]
    if revenue is not None and isinstance(revenue, (int, float)) and revenue > 0:
        fields["Estimated Revenue EUR"] = int(revenue)
    if rev_source:
        fields["Revenue Source"] = str(rev_source)[:200]

    # Only write if we have at least one data point
    if "Employee Count" not in fields and "Estimated Revenue EUR" not in fields:
        return None

    payload = json.dumps({"fields": fields}).encode("utf-8")

    if domain in existing_records:
        record_id = existing_records[domain]["record_id"]
        url = f"{AIRTABLE_API}/{record_id}"
        method = "PATCH"
    else:
        url = AIRTABLE_API
        method = "POST"

    req = urllib.request.Request(url, data=payload, method=method, headers=airtable_headers())
    try:
        with urllib.request.urlopen(req, context=SSL_CTX) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("id")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"  [error] Airtable {method} failed for {domain}: {e.code}")
        try:
            print(f"    {json.loads(body)}")
        except Exception:
            print(f"    {body[:300]}")
        return None


# ---------------------------------------------------------------------------
# Gemini batch lookup
# ---------------------------------------------------------------------------
def lookup_batch(companies_batch):
    """Query Gemini for employee count + revenue of up to 10 companies at once."""
    companies_list = "\n".join(
        f"- {c['name'] or c['domain']} (domain: {c['domain']})"
        for c in companies_batch
    )

    prompt = f"""Busca informacion publica sobre las siguientes empresas del sector de energias renovables / financiacion de infraestructuras en Europa.

Para CADA empresa, responde con:
- employee_count: numero aproximado de empleados (entero). Si no hay dato, null.
- employee_count_source: fuente del dato (ej: "LinkedIn", "web corporativa", "CNMV", "estimacion")
- estimated_revenue_eur: facturacion anual aproximada en euros (entero, sin decimales). Si no hay dato fiable, null.
- revenue_source: fuente del dato (ej: "Registro mercantil", "CNMV", "Crunchbase", "estimacion")

Empresas:
{companies_list}

Responde SOLO con JSON valido, un objeto donde cada clave es el dominio de la empresa:
{{
  "dominio1.com": {{
    "employee_count": 150,
    "employee_count_source": "LinkedIn",
    "estimated_revenue_eur": 25000000,
    "revenue_source": "Registro mercantil"
  }},
  "dominio2.com": {{
    "employee_count": null,
    "employee_count_source": null,
    "estimated_revenue_eur": null,
    "revenue_source": null
  }}
}}

IMPORTANTE: Solo JSON puro, sin markdown ni explicaciones."""

    try:
        api_key = os.environ.get("GEMINI_API_KEY", "")
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}"

        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0.2},
        }).encode("utf-8")

        req = urllib.request.Request(
            api_url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )

        with urllib.request.urlopen(req, context=SSL_CTX, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        text = ""
        for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
            if "text" in part:
                text += part["text"]
        text = text.strip()

        if not text:
            print(f"  [warn] Empty Gemini response")
            return {}

        # Clean markdown fences
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text.rsplit("```", 1)[0]
            text = text.strip()

        result = json.loads(text)
        return result if isinstance(result, dict) else {}

    except json.JSONDecodeError as e:
        print(f"  [warn] JSON parse error: {e}")
        try:
            import re
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                parsed = json.loads(json_match.group())
                return parsed if isinstance(parsed, dict) else {}
        except Exception:
            pass
        return {}

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"  [warn] Gemini API error {e.code}: {body[:200]}")
        return {}

    except Exception as e:
        print(f"  [warn] Gemini lookup failed: {e}")
        return {}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def load_companies():
    """Load companies_full.json."""
    paths = get_data_paths(PROJECT_DIR)
    full_path = paths["full"]
    if not os.path.exists(full_path):
        print(f"  [error] {full_path} not found")
        sys.exit(1)
    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data, full_path


def main():
    args = sys.argv[1:]
    top_n = 100
    target_domain = None
    process_all = False
    stats_only = False
    dry_run = False

    i = 0
    while i < len(args):
        if args[i] == "--top" and i + 1 < len(args):
            top_n = int(args[i + 1])
            i += 2
        elif args[i] == "--all":
            process_all = True
            i += 1
        elif args[i] == "--domain" and i + 1 < len(args):
            target_domain = args[i + 1]
            i += 2
        elif args[i] == "--stats":
            stats_only = True
            i += 1
        elif args[i] == "--dry-run":
            dry_run = True
            i += 1
        else:
            print(f"Unknown argument: {args[i]}")
            sys.exit(1)

    # Load companies
    print("Loading companies...")
    data, full_path = load_companies()
    companies = data.get("companies", {})
    print(f"  {len(companies)} companies loaded")

    # Stats
    has_emp = sum(1 for c in companies.values() if c.get("enrichment", {}).get("emp_count"))
    has_rev = sum(1 for c in companies.values() if c.get("enrichment", {}).get("revenue_eur"))
    print(f"  With employee count: {has_emp}")
    print(f"  With revenue: {has_rev}")
    print(f"  Missing both: {len(companies) - max(has_emp, has_rev)}")

    if stats_only:
        return

    # Check required env vars
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY environment variable not set")
        sys.exit(1)

    if not AIRTABLE_PAT and not dry_run:
        print("WARNING: AIRTABLE_PAT not set — will only update companies_full.json")

    # Fetch existing Airtable records
    existing_records = {}
    if AIRTABLE_PAT and not dry_run:
        print("Fetching existing Airtable records...")
        existing_records = fetch_verified_domains()
        print(f"  {len(existing_records)} records in Verified-Companies")

    # Build candidate list (companies missing emp_count)
    candidates = []
    for domain, comp in companies.items():
        enrichment = comp.get("enrichment", {})
        interactions = comp.get("interactions", 0)
        name = comp.get("name", "")

        if target_domain:
            if domain != target_domain:
                continue
        else:
            # Skip if already has emp_count in enrichment
            if enrichment.get("emp_count"):
                continue
            # Also skip if Airtable already has it and we're not targeting
            if domain in existing_records and existing_records[domain].get("employee_count"):
                continue
            # Skip noise
            if enrichment.get("role") == "No relevante" and interactions < 3:
                continue

        candidates.append({
            "domain": domain,
            "name": name,
            "interactions": interactions,
        })

    # Sort by interactions
    candidates.sort(key=lambda x: x["interactions"], reverse=True)

    # Apply limit
    if not target_domain and not process_all:
        candidates = candidates[:top_n]

    if not candidates:
        print("No companies to process (all already have employee count)")
        return

    n_batches = (len(candidates) + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"\nWill process {len(candidates)} companies in {n_batches} batches" +
          (" (DRY RUN)" if dry_run else ""))
    est_time = n_batches * GEMINI_RPM_DELAY
    print(f"  Estimated time: {est_time / 60:.1f} minutes")
    print()

    # Process in batches
    enriched_count = 0
    airtable_count = 0
    error_count = 0
    updated_domains = {}  # domain -> {emp_count, emp_source, revenue_eur, rev_source}

    for batch_idx in range(n_batches):
        batch_start = batch_idx * BATCH_SIZE
        batch = candidates[batch_start:batch_start + BATCH_SIZE]

        domains_str = ", ".join(c["domain"] for c in batch)
        print(f"[Batch {batch_idx + 1}/{n_batches}] {domains_str}")

        results = lookup_batch(batch)

        if not results:
            error_count += len(batch)
            print(f"  FAILED — empty response")
            if batch_idx < n_batches - 1:
                time.sleep(GEMINI_RPM_DELAY)
            continue

        for c in batch:
            domain = c["domain"]
            r = results.get(domain, {})

            emp = r.get("employee_count")
            emp_src = r.get("employee_count_source") or ""
            rev = r.get("estimated_revenue_eur")
            rev_src = r.get("revenue_source") or ""

            # Validate
            if emp is not None:
                try:
                    emp = int(emp)
                    if emp <= 0:
                        emp = None
                except (ValueError, TypeError):
                    emp = None

            if rev is not None:
                try:
                    rev = int(rev)
                    if rev <= 0:
                        rev = None
                except (ValueError, TypeError):
                    rev = None

            if emp or rev:
                extras = ""
                if emp:
                    extras += f" emp={emp}"
                if rev:
                    extras += f" rev={rev/1e6:.1f}M€" if rev >= 1e6 else f" rev={rev}€"
                print(f"  {domain}:{extras} (src: {emp_src or rev_src})")

                updated_domains[domain] = {
                    "emp_count": emp,
                    "emp_source": emp_src,
                    "revenue_eur": rev,
                    "rev_source": rev_src,
                }
                enriched_count += 1

                # Upsert to Airtable
                if not dry_run and AIRTABLE_PAT:
                    record_id = upsert_employee_data(
                        domain, c["name"], emp, emp_src, rev, rev_src, existing_records
                    )
                    if record_id:
                        airtable_count += 1
                        existing_records[domain] = {
                            "record_id": record_id,
                            "employee_count": emp,
                            "revenue": rev,
                        }
            else:
                print(f"  {domain}: no data found")

        # Rate limit
        if batch_idx < n_batches - 1:
            time.sleep(GEMINI_RPM_DELAY)

    # Write to companies_full.json
    if updated_domains and not dry_run:
        print(f"\nWriting {len(updated_domains)} updates to companies_full.json...")
        for domain, vals in updated_domains.items():
            if domain in companies:
                enrichment = companies[domain].setdefault("enrichment", {})
                if vals["emp_count"]:
                    enrichment["emp_count"] = vals["emp_count"]
                    enrichment["emp_source"] = vals["emp_source"]
                if vals["revenue_eur"]:
                    enrichment["revenue_eur"] = vals["revenue_eur"]
                    enrichment["rev_source"] = vals["rev_source"]

        with open(full_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print("  Done.")

    # Summary
    print(f"\n{'='*50}")
    print(f"Employee Count Backfill complete!")
    print(f"  Processed: {len(candidates)}")
    print(f"  Enriched:  {enriched_count}")
    if AIRTABLE_PAT and not dry_run:
        print(f"  Airtable:  {airtable_count}")
    print(f"  No data:   {len(candidates) - enriched_count - error_count}")
    print(f"  Errors:    {error_count}")
    if dry_run:
        print(f"  (DRY RUN — nothing written)")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
