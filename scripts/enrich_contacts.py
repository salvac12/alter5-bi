#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Contact Role Enrichment via Google Search
===============================================================

  Enriches contacts whose role is "No identificado" or empty by
  searching for their name + company on Google (via Gemini grounding)
  to find LinkedIn profiles and infer their role.

  Usage:
    export GEMINI_API_KEY="AIza..."

    python scripts/enrich_contacts.py --top 100          # top 100 by campaign priority
    python scripts/enrich_contacts.py --domain X          # single company
    python scripts/enrich_contacts.py --unidentified      # only companies with "No identificado" contacts
    python scripts/enrich_contacts.py --dry-run            # preview without writing

  Estimated cost: ~1 Gemini call per company ~ $0.01-0.03 each
  Estimated time: ~6s per company (Gemini + grounding)
===============================================================
"""

import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from import_mailbox import get_data_paths, export_to_compact

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_RPM_DELAY = float(os.environ.get("GEMINI_RPM_DELAY", "5"))

# SSL context for Gemini API
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# ---------------------------------------------------------------------------
# Large utilities (capped in scoring)
# ---------------------------------------------------------------------------
LARGE_UTILITIES = {
    'iberdrola', 'endesa', 'naturgy', 'enel', 'cepsa', 'repsol',
    'acciona', 'edp', 'statkraft', 'totalenergies', 'engie', 'bp',
}


# ---------------------------------------------------------------------------
# Simplified campaign priority score (Python port)
# ---------------------------------------------------------------------------
def campaign_priority_score(domain, company):
    """Simplified Python port of campaignPriorityScore from data.ts."""
    enrichment = company.get("enrichment") or {}
    details = company.get("details", [])

    # Parse contacts
    raw_contacts = company.get("contacts", [])
    contacts = []
    for ct in raw_contacts:
        if isinstance(ct, dict):
            contacts.append(ct)
        elif isinstance(ct, list) and len(ct) >= 3:
            contacts.append({"name": ct[0], "role": ct[1], "email": ct[2] or ""})

    # -- Mid-market fit (max 30) --
    emp = enrichment.get("emp_count")
    name_lower = (company.get("name") or "").lower()
    domain_lower = domain.lower()
    is_large = any(u in name_lower or u in domain_lower for u in LARGE_UTILITIES)

    if is_large:
        mid_market = 3
    elif emp and emp > 0:
        if 20 <= emp <= 500:
            mid_market = 30
        elif 500 < emp <= 1000:
            mid_market = 18
        elif 10 <= emp < 20:
            mid_market = 15
        elif 1000 < emp <= 5000:
            mid_market = 8
        elif emp > 5000:
            mid_market = 3
        else:
            mid_market = 12
    else:
        mid_market = 12

    # -- Utility-scale fit (max 30) --
    utility_scale = 0
    scale = enrichment.get("project_scale", "")
    if scale == "Utility-scale":
        utility_scale += 15
    elif scale == "Mixto":
        utility_scale += 10
    elif scale == "Distribuido":
        utility_scale += 3

    scraper = enrichment.get("scraper") or {}
    total_mw = (scraper.get("mw_total") or 0) + (enrichment.get("known_pipeline_mw") or 0)
    if total_mw >= 500:
        utility_scale += 10
    elif total_mw >= 100:
        utility_scale += 7
    elif total_mw >= 10:
        utility_scale += 4
    elif total_mw > 0:
        utility_scale += 2

    blines = enrichment.get("business_lines") or []
    if any(bl in ("Utility-scale developer", "IPP") for bl in blines):
        utility_scale += 8
    elif blines:
        utility_scale += 3
    utility_scale = min(30, utility_scale)

    # -- Contact readiness (max 25) --
    contact_score = 0
    best_rank = 99
    decision_makers = 0
    for ct in contacts:
        r = (ct.get("role") or "").lower().strip()
        rank = 99
        if re.search(r'\bceo\b|\bdg\b|director\s*general|managing\s*director', r):
            rank = 1
        elif re.search(r'\bcfo\b|\bdf\b|director\s*financier|chief\s*financial|head\s*of\s*finance', r):
            rank = 2
        elif 'financiaci' in r and 'estructurada' in r:
            rank = 3
        elif re.search(r'\bm&a\b|\bm\s*&\s*a\b', r):
            rank = 4
        elif r and r != 'no identificado' and r != 'nan':
            rank = 5
        if rank < best_rank:
            best_rank = rank
        if rank <= 2:
            decision_makers += 1

    if best_rank == 1:
        contact_score += 15
    elif best_rank == 2:
        contact_score += 12
    elif best_rank == 3:
        contact_score += 10
    elif best_rank == 4:
        contact_score += 8
    elif best_rank == 5:
        contact_score += 5
    if decision_makers >= 2:
        contact_score += 7
    elif len(contacts) >= 2:
        contact_score += 3
    contact_score = min(25, contact_score)

    # -- Data quality (max 15) -- simplified
    quality = 0
    tv = enrichment.get("_tv", 0)
    role = enrichment.get("role", "")
    if tv >= 2 and role and role != "No relevante":
        quality += 25
    elif tv >= 2:
        quality += 15
    identified = [c for c in contacts if (c.get("role") or "") not in ("", "No identificado", "nan")]
    if len(identified) >= 2:
        quality += 20
    elif len(identified) == 1:
        quality += 10
    data_quality = round(quality * 0.15)

    score = min(100, mid_market + utility_scale + contact_score + data_quality)
    return score


# ---------------------------------------------------------------------------
# Gemini contact enrichment
# ---------------------------------------------------------------------------
def enrich_contacts_with_gemini(domain, company_name, contacts):
    """Batch-enrich contacts for one company using Gemini + Google Search grounding."""

    contact_list = ""
    for i, ct in enumerate(contacts, 1):
        name = ct.get("name", "")
        email = ct.get("email", "")
        current_role = ct.get("role", "No identificado")
        contact_list += f"  {i}. {name} <{email}> — cargo actual: \"{current_role}\"\n"

    prompt = f"""Eres un analista de Alter5, consultora de financiación de energías renovables.

TAREA: Identificar el cargo/rol profesional de los siguientes contactos de la empresa "{company_name}" (dominio: {domain}).

CONTACTOS A INVESTIGAR:
{contact_list}
INSTRUCCIONES:
1. Para cada contacto, busca en Google: "{{nombre}} {{empresa}} LinkedIn" o "{{nombre}} {{empresa}} cargo"
2. Intenta encontrar su perfil de LinkedIn o menciones profesionales
3. Determina su cargo real actual
4. Si encuentras su perfil de LinkedIn, incluye la URL completa (https://www.linkedin.com/in/...)
5. Si no encuentras información fiable, mantén "No identificado"

FORMATO DE RESPUESTA (JSON array, sin markdown):
[
  {{
    "email": "email@ejemplo.com",
    "role": "Cargo identificado o No identificado",
    "linkedin_url": "https://www.linkedin.com/in/username",
    "source": "linkedin|web|inferido",
    "confidence": "alta|media|baja"
  }}
]

NOTAS:
- "linkedin_url": URL completa del perfil LinkedIn. Si no encuentras perfil, devuelve cadena vacía ""
- "source": "linkedin" si viene de perfil LinkedIn, "web" si de otra fuente, "inferido" si es deducción
- "confidence": "alta" si dato verificado en LinkedIn/web, "media" si parcial, "baja" si inferido
- Usa cargos en español cuando sea posible (ej: "Director General", "Director Financiero")
- Abreviaturas aceptadas: CEO, CFO, COO, CTO, M&A
- NO inventes cargos. Si no hay información, mantén "No identificado"
- Responde SOLO con el JSON array, sin explicaciones"""

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("  [error] GEMINI_API_KEY not set")
        return None

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}"

    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0.1},
    }).encode("utf-8")

    MAX_RETRIES = 3
    text = ""

    for attempt in range(MAX_RETRIES):
        try:
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
            if isinstance(result, list):
                return result
            return None

        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < MAX_RETRIES - 1:
                wait = (attempt + 1) * 10
                print(f"  [retry] Gemini {e.code} for {domain}, waiting {wait}s (attempt {attempt + 1}/{MAX_RETRIES})")
                time.sleep(wait)
                continue
            body = e.read().decode("utf-8") if e.fp else ""
            print(f"  [warn] Gemini API error {e.code} for {domain}: {body[:200]}")
            return None

        except json.JSONDecodeError as e:
            print(f"  [warn] JSON parse error for {domain}: {e}")
            try:
                json_match = re.search(r'\[[\s\S]*\]', text)
                if json_match:
                    return json.loads(json_match.group())
            except Exception:
                pass
            return None

        except Exception as e:
            print(f"  [warn] Gemini enrichment failed for {domain}: {e}")
            return None

    return None


# ---------------------------------------------------------------------------
# Data helpers
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
    return data, paths


def save_companies(data, paths):
    """Write companies_full.json and companies.json."""
    with open(paths["full"], "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    compact = export_to_compact(data["companies"])
    with open(paths["compact"], "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

    print(f"  OK: Written {paths['full']}")
    print(f"  OK: Written {paths['compact']}")


def get_contacts_needing_enrichment(company, force=False):
    """Return contacts that need role enrichment (No identificado or empty).
    If force=True, also include already-enriched contacts missing _linkedin_url."""
    raw_contacts = company.get("contacts", [])
    contacts = []
    for ct in raw_contacts:
        if isinstance(ct, dict):
            name = ct.get("name", "")
            email = ct.get("email", "")
            role = ct.get("role", "")
            role_source = ct.get("_role_source")
            linkedin_url = ct.get("_linkedin_url", "")
        elif isinstance(ct, list) and len(ct) >= 3:
            name = ct[0] or ""
            role = ct[1] or ""
            email = ct[2] or ""
            role_source = None
            linkedin_url = ""
        else:
            continue
        if not email:
            continue
        # Only enrich if role is empty or "No identificado"
        needs_enrichment = (
            not role or
            role.lower() in ("no identificado", "nan", "")
        )
        # Force mode: re-enrich contacts that have role but no linkedin_url
        if force and role_source and not linkedin_url:
            contacts.append({"name": name, "email": email, "role": role})
            continue
        # Don't overwrite if already enriched via this script
        if role_source and not needs_enrichment:
            continue
        if needs_enrichment:
            contacts.append({"name": name, "email": email, "role": role})
    return contacts[:10]  # max 10 per company


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    args = sys.argv[1:]
    top_n = None
    single_domain = None
    unidentified_only = False
    dry_run = False
    force = False

    i = 0
    while i < len(args):
        if args[i] == "--top" and i + 1 < len(args):
            top_n = int(args[i + 1])
            i += 2
        elif args[i] == "--domain" and i + 1 < len(args):
            single_domain = args[i + 1].lower().strip()
            i += 2
        elif args[i] == "--unidentified":
            unidentified_only = True
            i += 1
        elif args[i] == "--dry-run":
            dry_run = True
            i += 1
        elif args[i] == "--force":
            force = True
            i += 1
        else:
            print(f"Unknown arg: {args[i]}")
            sys.exit(1)

    if not top_n and not single_domain:
        top_n = 50  # default

    print("=" * 60)
    print("  Alter5 BI — Contact Role Enrichment")
    print("=" * 60)

    data, paths = load_companies()
    all_companies = data.get("companies", {})

    # Filter to Originacion companies with contacts needing enrichment
    candidates = {}
    for domain, company in all_companies.items():
        enrichment = company.get("enrichment") or {}
        role = enrichment.get("role", "")
        if role not in ("Originacion", "Originación"):
            continue
        needs = get_contacts_needing_enrichment(company, force=force)
        if not needs:
            continue
        candidates[domain] = (company, needs)

    print(f"  Originacion companies with contacts to enrich: {len(candidates)}")

    # Build target list
    if single_domain:
        if single_domain in candidates:
            targets = {single_domain: candidates[single_domain]}
        elif single_domain in all_companies:
            company = all_companies[single_domain]
            needs = get_contacts_needing_enrichment(company, force=force)
            if needs:
                targets = {single_domain: (company, needs)}
            else:
                print(f"  [info] {single_domain} has no contacts needing enrichment")
                sys.exit(0)
        else:
            print(f"  [error] Domain {single_domain} not found")
            sys.exit(1)
    else:
        # Sort by campaign priority score descending
        scored = [(d, campaign_priority_score(d, c), c, needs)
                  for d, (c, needs) in candidates.items()]
        scored.sort(key=lambda x: x[1], reverse=True)

        if unidentified_only:
            # Already filtered to companies with unidentified contacts
            pass

        if top_n:
            scored = scored[:top_n]

        targets = {d: (c, needs) for d, _, c, needs in scored}

    print(f"  Targets: {len(targets)} companies")
    total_contacts = sum(len(needs) for _, needs in targets.values())
    print(f"  Total contacts to enrich: {total_contacts}")
    if dry_run:
        print("  Mode: DRY RUN (no writes)")
    print()

    # Process each company
    enriched_count = 0
    contacts_enriched = 0
    failed_count = 0

    for idx, (domain, (company, needs)) in enumerate(targets.items(), 1):
        name = company.get("name", domain)
        score = campaign_priority_score(domain, company)

        print(f"  [{idx}/{len(targets)}] {name} ({domain}) — priority={score}, {len(needs)} contacts")

        if dry_run:
            for ct in needs:
                print(f"    → {ct['name']} <{ct['email']}> — {ct['role'] or 'sin cargo'}")
            continue

        # Call Gemini
        print(f"    Calling Gemini...", end=" ", flush=True)
        results = enrich_contacts_with_gemini(domain, name, needs)

        if not results:
            print("FAILED")
            failed_count += 1
            time.sleep(GEMINI_RPM_DELAY)
            continue

        # Build lookup by email
        result_by_email = {}
        for r in results:
            email = (r.get("email") or "").lower().strip()
            if email:
                result_by_email[email] = r

        # Update contacts in company data
        contact_list = all_companies[domain].get("contacts", [])
        updated = 0
        now = datetime.now(timezone.utc).isoformat()

        for j, ct in enumerate(contact_list):
            email = ""
            if isinstance(ct, dict):
                email = (ct.get("email") or "").lower().strip()
            elif isinstance(ct, list) and len(ct) >= 3:
                email = (ct[2] or "").lower().strip()

            if email not in result_by_email:
                continue

            enriched = result_by_email[email]
            new_role = enriched.get("role", "")
            source = enriched.get("source", "")
            confidence = enriched.get("confidence", "baja")

            # Skip if Gemini returned "No identificado" or empty
            if not new_role or new_role.lower() in ("no identificado", "nan"):
                continue

            linkedin_url = enriched.get("linkedin_url", "")

            # Update the contact
            if isinstance(ct, dict):
                ct["role"] = new_role
                ct["_role_source"] = f"linkedin_search:{source}"
                ct["_role_verified_at"] = now
                ct["_role_confidence"] = confidence
                if linkedin_url:
                    ct["_linkedin_url"] = linkedin_url
            elif isinstance(ct, list) and len(ct) >= 3:
                ct[1] = new_role  # role is at index 1

            updated += 1
            li_tag = f" | LinkedIn: {linkedin_url}" if linkedin_url else ""
            print(f"    ✓ {enriched.get('email')}: {new_role} ({source}, {confidence}){li_tag}")

        if updated > 0:
            enriched_count += 1
            contacts_enriched += updated
        else:
            print(f"    (no new roles found)")

        time.sleep(GEMINI_RPM_DELAY)

    # Summary
    print()
    print("=" * 60)
    print(f"  Companies processed: {len(targets)}")
    print(f"  Companies with updates: {enriched_count}")
    print(f"  Contacts enriched: {contacts_enriched}")
    print(f"  Failed: {failed_count}")

    if not dry_run and contacts_enriched > 0:
        save_companies(data, paths)
    elif dry_run:
        print("  (dry run — no files written)")

    print("=" * 60)


if __name__ == "__main__":
    main()
