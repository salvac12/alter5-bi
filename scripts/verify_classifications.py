#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Verification Agent: Web + Email cross-check
===============================================================

  Verifies company classifications by combining:
  1. Google Search grounding (Gemini looks up what the company actually does)
  2. Email context re-analysis (distinguishes "what they ARE" vs "what they discuss with Alter5")

  Results are stored in Airtable "Verified-Companies" table.

  Usage:
    export GEMINI_API_KEY="AIza..."
    export AIRTABLE_PAT="patXXX..."

    python scripts/verify_classifications.py                     # top 50 by interactions
    python scripts/verify_classifications.py --top 200           # top 200
    python scripts/verify_classifications.py --domain elonacapital.com  # single company
    python scripts/verify_classifications.py --unverified        # only unverified companies
    python scripts/verify_classifications.py --mismatched        # only flagged mismatches
    python scripts/verify_classifications.py --dry-run           # preview without writing to Airtable
    python scripts/verify_classifications.py --force             # re-verify even if already verified

  Estimated cost: ~1 Gemini call per company (with grounding) ~ $0.01-0.03 each
  Estimated time: ~5s per company (rate-limited)
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

# v2 taxonomy (mirrors process_sheet_emails.py)
COMPANY_ROLES = ["Originacion", "Inversion", "Ecosistema", "No relevante"]
ORIGINACION_SEGMENTS = ["Project Finance", "Corporate Finance"]
INVERSION_SEGMENTS = ["Deuda", "Equity"]
COMPANY_TYPES_V2 = {
    "Originacion > Project Finance": ["Developer", "IPP", "Developer + IPP"],
    "Originacion > Corporate Finance": [],
    "Inversion > Deuda": ["Fondo de deuda", "Banco", "Bonista / Institucional"],
    "Inversion > Equity": ["Fondo de infraestructura", "Private equity", "Fondo renovable", "IPP comprador", "Utility compradora"],
    "Ecosistema": ["Asesor legal", "Asesor tecnico", "Consultor de precios", "Asset manager", "Ingenieria", "Asesor financiero", "Asociacion / Institucion"],
}
TECHNOLOGIES = ["Solar", "Eolica", "BESS", "Biogas", "Hidrogeno", "Otra"]
GEOGRAPHIES = ["Espana", "Portugal", "Italia", "Francia", "Alemania", "UK", "Otro"]
MARKET_ROLES_LIST = [
    "Borrower", "Seller (M&A)", "Buyer Investor (M&A)",
    "Debt Investor", "Equity Investor", "Partner & Services",
]


# ---------------------------------------------------------------------------
# Airtable helpers
# ---------------------------------------------------------------------------
def airtable_headers():
    return {
        "Authorization": f"Bearer {AIRTABLE_PAT}",
        "Content-Type": "application/json",
    }


def fetch_verified_domains():
    """Fetch all domains already in Verified-Companies table."""
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
                        "status": rec["fields"].get("Status", ""),
                        "mismatch": rec["fields"].get("Mismatch", False),
                    }
            offset = data.get("offset", "")
            if not offset:
                break
    except Exception as e:
        print(f"  [warn] Failed to fetch verified domains: {e}")

    return domains


def upsert_verification(domain, fields, existing_records):
    """Create or update a verification record in Airtable."""
    if not AIRTABLE_PAT:
        return None

    # Sanitize: remove empty singleSelect values
    clean = {}
    single_selects = {"Role", "Segment", "Type", "Status", "Confidence"}
    multi_selects = {"Activities", "Technologies", "Geography", "Market Roles"}
    for k, v in fields.items():
        if k in single_selects and (not v or v == ""):
            continue  # skip empty singleSelect
        if k in multi_selects and not v:
            continue  # skip empty arrays
        clean[k] = v

    payload = json.dumps({"fields": clean}).encode("utf-8")

    if domain in existing_records:
        # PATCH existing record
        record_id = existing_records[domain]["record_id"]
        url = f"{AIRTABLE_API}/{record_id}"
        method = "PATCH"
    else:
        # POST new record
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
# Gemini verification with Google Search grounding
# ---------------------------------------------------------------------------
def verify_company_with_gemini(domain, name, current_enrichment, subjects, bodies):
    """Verify a single company using Gemini with Google Search grounding + email context."""

    # Build current classification summary
    curr_role = current_enrichment.get("role", "Sin clasificar")
    curr_seg = current_enrichment.get("seg", "")
    curr_type = current_enrichment.get("tp2", "")
    curr_mr = current_enrichment.get("mr", [])
    curr_tech = current_enrichment.get("tech", [])
    curr_geo = current_enrichment.get("geo", [])

    current_summary = f"Role={curr_role}"
    if curr_seg:
        current_summary += f", Segment={curr_seg}"
    if curr_type:
        current_summary += f", Type={curr_type}"
    if curr_mr:
        current_summary += f", MarketRoles={curr_mr}"
    if curr_tech:
        current_summary += f", Tech={curr_tech}"
    if curr_geo:
        current_summary += f", Geo={curr_geo}"

    # Build email context
    subj_text = " | ".join(subjects[:15]) if subjects else "(sin emails)"
    body_text = ""
    if bodies:
        body_text = " // ".join(bodies[:3])[:2000]

    name_display = name or domain

    prompt = f"""Eres un analista de verificacion de Alter5, consultora de financiacion de energias renovables.

TAREA: Verificar la clasificacion de la empresa "{name_display}" (dominio: {domain}).

## CLASIFICACION ACTUAL (hecha por IA basada solo en emails):
{current_summary}

## CONTEXTO DE EMAILS con Alter5:
Asuntos recientes: [{subj_text}]
{f"Extractos de emails: [{body_text}]" if body_text else ""}

## INSTRUCCIONES:
1. BUSCA en internet que hace realmente esta empresa: su web, LinkedIn, noticias, etc.
2. DISTINGUE entre "lo que la empresa ES" (su negocio real) y "de que habla con Alter5" (la relacion comercial).
   - Ejemplo: Un fondo de equity que habla de deuda con Alter5 sigue siendo un fondo de equity.
   - Ejemplo: Una empresa que busca financiacion para sus proyectos es "Originacion", no "Inversion".
3. COMPARA tu hallazgo con la clasificacion actual y senala si hay discrepancia.

## TAXONOMIA (elige de estas opciones EXACTAS):
- Role: {json.dumps(COMPANY_ROLES)}
- Segment (solo Originacion): {json.dumps(ORIGINACION_SEGMENTS)}
- Segment (solo Inversion): {json.dumps(INVERSION_SEGMENTS)}
- Types Originacion>PF: {json.dumps(COMPANY_TYPES_V2["Originacion > Project Finance"])}
- Types Inversion>Deuda: {json.dumps(COMPANY_TYPES_V2["Inversion > Deuda"])}
- Types Inversion>Equity: {json.dumps(COMPANY_TYPES_V2["Inversion > Equity"])}
- Types Ecosistema: {json.dumps(COMPANY_TYPES_V2["Ecosistema"])}
- Technologies: {json.dumps(TECHNOLOGIES)}
- Geography: {json.dumps(GEOGRAPHIES)}
- Market Roles: {json.dumps(MARKET_ROLES_LIST)}

## FORMATO DE RESPUESTA (JSON valido, sin markdown):
{{
  "company_description": "Descripcion breve de lo que hace la empresa segun fuentes web (2-3 frases)",
  "web_sources": "URLs o fuentes consultadas",
  "verified_role": "...",
  "verified_segment": "...",
  "verified_type": "...",
  "verified_technologies": [...],
  "verified_geography": [...],
  "verified_market_roles": [...],
  "mismatch": true/false,
  "mismatch_explanation": "Explicacion de por que la clasificacion actual es incorrecta (o vacio si es correcta)",
  "confidence": "alta|media|baja"
}}"""

    try:
        # Use Gemini REST API with google_search grounding tool
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

        with urllib.request.urlopen(req, context=SSL_CTX, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        text = ""
        for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
            if "text" in part:
                text += part["text"]
        text = text.strip()

        if not text:
            print(f"  [warn] Empty response for {domain}")
            return None

        # Clean markdown fences
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text.rsplit("```", 1)[0]
            text = text.strip()

        result = json.loads(text)
        return result

    except json.JSONDecodeError as e:
        print(f"  [warn] JSON parse error for {domain}: {e}")
        # Try to extract JSON from response
        try:
            import re
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                return json.loads(json_match.group())
        except Exception:
            pass
        return None

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"  [warn] Gemini API error {e.code} for {domain}: {body[:200]}")
        return None

    except Exception as e:
        print(f"  [warn] Gemini verification failed for {domain}: {e}")
        return None


def build_airtable_fields(domain, name, current_enrichment, verification):
    """Build Airtable fields dict from verification result."""
    curr_role = current_enrichment.get("role", "")
    curr_type = current_enrichment.get("tp2", "")
    curr_seg = current_enrichment.get("seg", "")

    prev_class = curr_role
    if curr_seg:
        prev_class += f" > {curr_seg}"
    if curr_type:
        prev_class += f" > {curr_type}"

    v_role = verification.get("verified_role", "")
    v_seg = verification.get("verified_segment", "")
    v_type = verification.get("verified_type", "")
    v_tech = verification.get("verified_technologies", [])
    v_geo = verification.get("verified_geography", [])
    v_mr = verification.get("verified_market_roles", [])

    # Gemini sometimes returns singleSelect fields as arrays - take first element
    if isinstance(v_role, list):
        v_role = v_role[0] if v_role else ""
    if isinstance(v_seg, list):
        v_seg = v_seg[0] if v_seg else ""
    if isinstance(v_type, list):
        v_type = v_type[0] if v_type else ""

    # Ensure web_sources is a string (Gemini sometimes returns an array)
    web_sources_raw = verification.get("web_sources", "")
    if isinstance(web_sources_raw, list):
        web_sources_raw = "\n".join(str(s) for s in web_sources_raw)
    web_desc_raw = verification.get("company_description", "")
    if isinstance(web_desc_raw, list):
        web_desc_raw = " ".join(str(s) for s in web_desc_raw)

    fields = {
        "Domain": domain,
        "Company Name": name or domain,
        "Previous Classification": prev_class,
        "Web Description": str(web_desc_raw)[:10000],
        "Web Sources": str(web_sources_raw)[:10000],
        "Status": "Pending Review",
        "Verified By": "agent",
        "Verified At": datetime.now().isoformat(),
        "Mismatch": verification.get("mismatch", False),
    }

    confidence = verification.get("confidence", "")
    if confidence in ("alta", "media", "baja"):
        fields["Confidence"] = confidence

    if verification.get("mismatch_explanation"):
        fields["Notes"] = verification["mismatch_explanation"]

    # Only set classification fields if valid
    if v_role and v_role in COMPANY_ROLES:
        fields["Role"] = v_role
    valid_segments = ORIGINACION_SEGMENTS + INVERSION_SEGMENTS
    if v_seg and v_seg in valid_segments:
        fields["Segment"] = v_seg
    all_types = set()
    for types_list in COMPANY_TYPES_V2.values():
        all_types.update(types_list)
    if v_type and v_type in all_types:
        fields["Type"] = v_type
    if v_tech and isinstance(v_tech, list):
        fields["Technologies"] = [t for t in v_tech if t in TECHNOLOGIES]
    if v_geo and isinstance(v_geo, list):
        fields["Geography"] = [g for g in v_geo if g in GEOGRAPHIES]
    if v_mr and isinstance(v_mr, list):
        fields["Market Roles"] = [r for r in v_mr if r in MARKET_ROLES_LIST]

    return fields


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
    return data


def main():
    args = sys.argv[1:]
    top_n = 50
    target_domain = None
    unverified_only = False
    mismatched_only = False
    dry_run = False
    force = False

    i = 0
    while i < len(args):
        if args[i] == "--top" and i + 1 < len(args):
            top_n = int(args[i + 1])
            i += 2
        elif args[i] == "--domain" and i + 1 < len(args):
            target_domain = args[i + 1]
            i += 2
        elif args[i] == "--unverified":
            unverified_only = True
            i += 1
        elif args[i] == "--mismatched":
            mismatched_only = True
            i += 1
        elif args[i] == "--dry-run":
            dry_run = True
            i += 1
        elif args[i] == "--force":
            force = True
            i += 1
        else:
            print(f"Unknown argument: {args[i]}")
            sys.exit(1)

    # Check required env vars
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY environment variable not set")
        sys.exit(1)

    if not AIRTABLE_PAT and not dry_run:
        print("ERROR: AIRTABLE_PAT environment variable not set (use --dry-run for preview)")
        sys.exit(1)

    print(f"Gemini model: {GEMINI_MODEL} (REST API + Google Search grounding)")

    # Load companies
    print("Loading companies...")
    data = load_companies()
    companies = data.get("companies", {})
    print(f"  {len(companies)} companies loaded")

    # Fetch existing verifications from Airtable
    print("Fetching existing verifications from Airtable...")
    existing_records = fetch_verified_domains() if not dry_run else {}
    print(f"  {len(existing_records)} already verified")

    # Build candidate list
    candidates = []
    for domain, comp in companies.items():
        enrichment = comp.get("enrichment", {})
        interactions = comp.get("interactions", 0)
        name = comp.get("name", "")

        # Filter by target domain
        if target_domain:
            if domain != target_domain:
                continue
        else:
            # --unverified: only companies NOT yet in Verified-Companies table
            if unverified_only and domain in existing_records:
                continue

            # --mismatched: only companies already verified WITH mismatch=True
            if mismatched_only:
                if domain not in existing_records:
                    continue
                if not existing_records[domain].get("mismatch", False):
                    continue

            # Skip if already verified (unless --force or --mismatched)
            if domain in existing_records and not force and not mismatched_only:
                status = existing_records[domain].get("status", "")
                if status in ("Verified", "Edited"):
                    continue

            # Skip "No relevante" with very few interactions (noise)
            if enrichment.get("role") == "No relevante" and interactions < 5:
                continue

        candidates.append({
            "domain": domain,
            "name": name,
            "enrichment": enrichment,
            "interactions": interactions,
            "subjects": comp.get("subjects", []),
            "dated_subjects": comp.get("dated_subjects", []),
        })

    # Sort by interactions (most active first)
    candidates.sort(key=lambda x: x["interactions"], reverse=True)

    # Apply --top N limit (unless targeting a single domain)
    if not target_domain:
        candidates = candidates[:top_n]

    if not candidates:
        print("No companies to verify (all already verified or no matches)")
        return

    print(f"\nWill verify {len(candidates)} companies" + (" (DRY RUN)" if dry_run else ""))
    print(f"  Rate limit delay: {GEMINI_RPM_DELAY}s between calls")
    est_time = len(candidates) * GEMINI_RPM_DELAY
    print(f"  Estimated time: {est_time / 60:.1f} minutes")
    print()

    # Process companies
    verified_count = 0
    mismatch_count = 0
    error_count = 0

    for idx, cand in enumerate(candidates, 1):
        domain = cand["domain"]
        name = cand["name"]
        enrichment = cand["enrichment"]

        # Build bodies from dated_subjects (which contain [date, subject, extract])
        bodies = []
        for ds in cand.get("dated_subjects", []):
            if len(ds) > 2 and ds[2]:
                bodies.append(ds[2])

        print(f"[{idx}/{len(candidates)}] {name or domain} ({cand['interactions']} interactions)...")

        result = verify_company_with_gemini(
            domain, name, enrichment,
            subjects=cand["subjects"],
            bodies=bodies,
        )

        if not result:
            error_count += 1
            print(f"  FAILED - skipping")
            if idx < len(candidates):
                time.sleep(GEMINI_RPM_DELAY)
            continue

        is_mismatch = result.get("mismatch", False)
        confidence = result.get("confidence", "?")
        desc = (result.get("company_description", "") or "")[:100]

        status_icon = "!!" if is_mismatch else "OK"
        print(f"  [{status_icon}] {result.get('verified_role', '?')} > {result.get('verified_type', '?')} "
              f"(conf={confidence}) {desc}")

        if is_mismatch:
            mismatch_count += 1
            expl = result.get("mismatch_explanation", "")
            if expl:
                print(f"  MISMATCH: {expl[:150]}")

        # Write to Airtable
        if not dry_run:
            fields = build_airtable_fields(domain, name, enrichment, result)
            record_id = upsert_verification(domain, fields, existing_records)
            if record_id:
                verified_count += 1
                # Update existing_records for future upserts
                existing_records[domain] = {"record_id": record_id, "status": "Pending Review"}
            else:
                error_count += 1
        else:
            verified_count += 1

        # Rate limit
        if idx < len(candidates):
            time.sleep(GEMINI_RPM_DELAY)

    # Summary
    print(f"\n{'='*50}")
    print(f"Verification complete!")
    print(f"  Processed: {len(candidates)}")
    print(f"  Verified:  {verified_count}")
    print(f"  Mismatches: {mismatch_count}")
    print(f"  Errors:    {error_count}")
    if dry_run:
        print(f"  (DRY RUN - nothing written to Airtable)")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
