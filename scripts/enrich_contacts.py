#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Contact Role Enrichment via Apollo / Perplexity / Gemini
===============================================================

  Enriches contacts whose role is "No identificado" or empty by
  searching for their name + company on the web to find LinkedIn
  profiles and infer their role.

  Backends:
    - Apollo.io (preferred) — real LinkedIn URLs + verified titles (1 credit/contact)
    - Perplexity Sonar — web search, good for roles but LinkedIn URLs less reliable
    - Gemini + Google Search grounding (fallback)

  Usage:
    export APOLLO_API_KEY="rogOo..."       # preferred
    export PERPLEXITY_API_KEY="pplx-..."   # alternative
    export GEMINI_API_KEY="AIza..."         # fallback

    python scripts/enrich_contacts.py --top 100
    python scripts/enrich_contacts.py --domain X
    python scripts/enrich_contacts.py --unidentified
    python scripts/enrich_contacts.py --force            # re-enrich to get missing LinkedIn URLs
    python scripts/enrich_contacts.py --dry-run
    python scripts/enrich_contacts.py --backend apollo   # force Apollo backend
    python scripts/enrich_contacts.py --discover-dm      # discover CFO/Dir Financiero via Apollo Search (free)

  Estimated cost (Apollo): 1 credit/contact, free tier 10,000/month
  Estimated cost (Perplexity Sonar): ~$5-8 per 1000 companies
  Estimated time (Apollo): ~1.5s per contact
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
PERPLEXITY_MODEL = os.environ.get("PERPLEXITY_MODEL", "sonar")
RPM_DELAY = float(os.environ.get("ENRICH_RPM_DELAY", "1.5"))  # Perplexity allows 50 RPM at tier 0
GEMINI_RPM_DELAY = float(os.environ.get("GEMINI_RPM_DELAY", "5"))
APOLLO_RPM_DELAY = float(os.environ.get("APOLLO_RPM_DELAY", "1.3"))  # Apollo ~50 RPM free tier
APOLLO_API_URL = "https://api.apollo.io/api/v1"

# SSL context for API calls — try system certs first, fall back to certifi
SSL_CTX = ssl.create_default_context()
try:
    import certifi
    # Only use certifi if system certs fail (some envs have proxy/firewall certs
    # that certifi's bundle doesn't include)
    _test_ctx = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    pass

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
# Apollo.io contact enrichment (preferred — real LinkedIn data)
# ---------------------------------------------------------------------------
def _apollo_headers():
    api_key = os.environ.get("APOLLO_API_KEY", "")
    return {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": api_key,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }


def _normalize_linkedin_url(url):
    """Normalize LinkedIn URL to https://www.linkedin.com/in/..."""
    if not url:
        return ""
    url = url.strip()
    # Fix http -> https
    if url.startswith("http://"):
        url = "https://" + url[7:]
    # Validate format
    if "/in/" not in url:
        return ""
    return url


def _split_name(contact):
    """Split contact name into first_name + last_name for Apollo."""
    nombre = contact.get("nombre", "")
    apellido = contact.get("apellido", "")
    if nombre:
        return nombre, apellido or ""
    name = contact.get("name", "")
    parts = name.strip().split()
    if len(parts) >= 2:
        return parts[0], " ".join(parts[1:])
    return name, ""


def enrich_contacts_with_apollo(domain, company_name, contacts):
    """Enrich contacts using Apollo People Match — returns real LinkedIn URLs + titles.
    One API call per contact (1 credit each)."""

    api_key = os.environ.get("APOLLO_API_KEY", "")
    if not api_key:
        return None

    results = []
    for ct in contacts:
        first_name, last_name = _split_name(ct)
        email = ct.get("email", "")

        if not first_name:
            results.append({
                "email": email, "role": "No identificado",
                "linkedin_url": "", "photo_url": "",
                "source": "apollo", "confidence": "baja",
            })
            continue

        # Try match by name+domain first, fall back to email
        payload = json.dumps({
            "first_name": first_name,
            "last_name": last_name,
            "domain": domain,
            "reveal_personal_emails": False,
        }).encode("utf-8")

        try:
            req = urllib.request.Request(
                f"{APOLLO_API_URL}/people/match",
                data=payload, method="POST",
                headers=_apollo_headers(),
            )
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            person = data.get("person")
            if not person:
                results.append({
                    "email": email, "role": "No identificado",
                    "linkedin_url": "", "photo_url": "",
                    "source": "apollo", "confidence": "baja",
                })
                time.sleep(APOLLO_RPM_DELAY)
                continue

            title = person.get("title") or ""
            linkedin = _normalize_linkedin_url(person.get("linkedin_url") or "")
            photo = person.get("photo_url") or ""
            seniority = person.get("seniority") or ""

            # Confidence based on data quality
            confidence = "alta" if linkedin and title else "media" if title else "baja"

            results.append({
                "email": email,
                "role": title or "No identificado",
                "linkedin_url": linkedin,
                "photo_url": photo,
                "seniority": seniority,
                "source": "apollo",
                "confidence": confidence,
            })

        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"\n    [rate-limit] Apollo 429, waiting 60s...")
                time.sleep(60)
                # Retry once
                try:
                    req = urllib.request.Request(
                        f"{APOLLO_API_URL}/people/match",
                        data=payload, method="POST",
                        headers=_apollo_headers(),
                    )
                    with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                    person = data.get("person")
                    if person:
                        results.append({
                            "email": email,
                            "role": person.get("title") or "No identificado",
                            "linkedin_url": _normalize_linkedin_url(person.get("linkedin_url") or ""),
                            "photo_url": person.get("photo_url") or "",
                            "seniority": person.get("seniority") or "",
                            "source": "apollo",
                            "confidence": "alta" if person.get("linkedin_url") else "media",
                        })
                    else:
                        results.append({"email": email, "role": "No identificado", "linkedin_url": "", "photo_url": "", "source": "apollo", "confidence": "baja", "_rate_limited": True})
                except urllib.error.HTTPError as retry_e:
                    if retry_e.code == 429:
                        # Still rate-limited — signal caller to stop
                        print(f"\n    [rate-limit] Still 429 after retry. Hourly limit likely reached.")
                        return None  # Return None to trigger early stop
                    results.append({"email": email, "role": "No identificado", "linkedin_url": "", "photo_url": "", "source": "apollo", "confidence": "baja"})
                except Exception:
                    results.append({"email": email, "role": "No identificado", "linkedin_url": "", "photo_url": "", "source": "apollo", "confidence": "baja"})
            elif e.code == 422:
                # Unprocessable — bad input, skip
                results.append({"email": email, "role": "No identificado", "linkedin_url": "", "photo_url": "", "source": "apollo", "confidence": "baja"})
            else:
                body = e.read().decode("utf-8") if e.fp else ""
                print(f"\n    [warn] Apollo {e.code} for {first_name} {last_name}: {body[:150]}")
                results.append({"email": email, "role": "No identificado", "linkedin_url": "", "photo_url": "", "source": "apollo", "confidence": "baja"})

        except Exception as e:
            print(f"\n    [warn] Apollo failed for {first_name} {last_name}: {e}")
            results.append({"email": email, "role": "No identificado", "linkedin_url": "", "photo_url": "", "source": "apollo", "confidence": "baja"})

        time.sleep(APOLLO_RPM_DELAY)

    return results if results else None


def discover_decision_makers_apollo(domain, company_name):
    """Use Apollo People Search (FREE, no credits) to find CFO/Dir Financiero at a company.
    Returns list of new contacts found."""

    api_key = os.environ.get("APOLLO_API_KEY", "")
    if not api_key:
        return []

    # Search for finance decision makers
    seniorities = ["c_suite", "head", "director", "vp"]
    titles = ["CFO", "Chief Financial Officer", "Director Financiero",
              "Head of Finance", "Finance Director", "Project Finance",
              "Financiación Estructurada", "Structured Finance",
              "Director General", "CEO", "Managing Director"]

    url = f"{APOLLO_API_URL}/mixed_people/api_search"
    payload = json.dumps({
        "q_organization_domains_list": [domain],
        "person_seniorities": seniorities,
        "person_titles": titles,
        "per_page": 10,
        "page": 1,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=payload, method="POST", headers=_apollo_headers())
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        people = data.get("people", [])
        if not people:
            return []

        # People Search returns obfuscated last names — we need to enrich to get full data
        # But we get: first_name, title, and Apollo ID
        discovered = []
        for p in people[:5]:  # max 5 decision makers
            apollo_id = p.get("id", "")
            first_name = p.get("first_name", "")
            title = p.get("title", "")
            if not apollo_id or not first_name:
                continue
            discovered.append({
                "apollo_id": apollo_id,
                "first_name": first_name,
                "title": title,
            })

        if not discovered:
            return []

        # Enrich each discovered person (1 credit each) to get full name, email, LinkedIn
        enriched = []
        for d in discovered:
            try:
                match_payload = json.dumps({"id": d["apollo_id"]}).encode("utf-8")
                req = urllib.request.Request(
                    f"{APOLLO_API_URL}/people/match",
                    data=match_payload, method="POST",
                    headers=_apollo_headers(),
                )
                with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
                    match_data = json.loads(resp.read().decode("utf-8"))

                person = match_data.get("person")
                if not person:
                    continue

                email = person.get("email") or ""
                if not email:
                    continue  # No email = not useful for CRM

                enriched.append({
                    "name": person.get("name") or f"{person.get('first_name', '')} {person.get('last_name', '')}".strip(),
                    "nombre": person.get("first_name") or "",
                    "apellido": person.get("last_name") or "",
                    "email": email,
                    "role": person.get("title") or "",
                    "_role_source": "apollo:discovery",
                    "_linkedin_url": _normalize_linkedin_url(person.get("linkedin_url") or ""),
                    "_photo_url": person.get("photo_url") or "",
                    "_role_confidence": "alta",
                    "_role_verified_at": datetime.now(timezone.utc).isoformat(),
                })
                time.sleep(APOLLO_RPM_DELAY)

            except Exception as e:
                print(f"    [warn] Apollo enrich failed for {d['first_name']}: {e}")
                time.sleep(APOLLO_RPM_DELAY)

        return enriched

    except Exception as e:
        print(f"    [warn] Apollo search failed for {domain}: {e}")
        return []


# ---------------------------------------------------------------------------
# Perplexity contact enrichment
# ---------------------------------------------------------------------------
def enrich_contacts_with_perplexity(domain, company_name, contacts):
    """Batch-enrich contacts using Perplexity Sonar (web search built-in)."""

    contact_list = ""
    for i, ct in enumerate(contacts, 1):
        name = ct.get("name", "")
        email = ct.get("email", "")
        current_role = ct.get("role", "No identificado")
        contact_list += f"  {i}. {name} <{email}> — cargo actual: \"{current_role}\"\n"

    prompt = f"""Eres un analista de Alter5, consultora de financiación de energías renovables en España.

TAREA: Identificar el cargo/rol profesional y el perfil de LinkedIn de los siguientes contactos de la empresa "{company_name}" (dominio: {domain}).

CONTACTOS A INVESTIGAR:
{contact_list}
INSTRUCCIONES:
1. Para cada contacto, busca en LinkedIn: "{{nombre}} {{empresa}}" o "{{nombre}} {domain}"
2. Encuentra su perfil de LinkedIn y determina su cargo real actual
3. La URL de LinkedIn DEBE ser del formato https://www.linkedin.com/in/username o https://linkedin.com/in/username
4. Si no encuentras perfil de LinkedIn, intenta buscar en la web corporativa de {domain}
5. Si no encuentras información fiable, mantén "No identificado"

FORMATO DE RESPUESTA (JSON array, sin markdown ni explicaciones):
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
- "linkedin_url": URL COMPLETA del perfil LinkedIn (https://www.linkedin.com/in/...). Si no encuentras perfil, devuelve ""
- "source": "linkedin" si el cargo viene de LinkedIn, "web" si de otra fuente, "inferido" si deducción
- "confidence": "alta" si verificado en LinkedIn, "media" si de web corporativa, "baja" si inferido
- Usa cargos en español cuando sea natural (ej: "Director General"), mantén en inglés si es el título oficial (ej: "CEO", "Head of Project Finance")
- NO inventes cargos ni URLs. Si no hay información, mantén "No identificado" y linkedin_url vacío
- Responde SOLO con el JSON array"""

    api_key = os.environ.get("PERPLEXITY_API_KEY", "")
    if not api_key:
        return None

    api_url = "https://api.perplexity.ai/chat/completions"

    payload = json.dumps({
        "model": PERPLEXITY_MODEL,
        "messages": [
            {"role": "system", "content": "Eres un asistente de investigación. Responde SOLO con JSON válido, sin markdown ni explicaciones."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
    }).encode("utf-8")

    MAX_RETRIES = 3

    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(
                api_url,
                data=payload,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )

            with urllib.request.urlopen(req, context=SSL_CTX, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

            if not text:
                print(f"  [warn] Empty Perplexity response for {domain}")
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
                wait = (attempt + 1) * 15
                print(f"  [retry] Perplexity {e.code} for {domain}, waiting {wait}s (attempt {attempt + 1}/{MAX_RETRIES})")
                time.sleep(wait)
                continue
            body = e.read().decode("utf-8") if e.fp else ""
            print(f"  [warn] Perplexity API error {e.code} for {domain}: {body[:200]}")
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
            print(f"  [warn] Perplexity enrichment failed for {domain}: {e}")
            return None

    return None


# ---------------------------------------------------------------------------
# Gemini contact enrichment (fallback)
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
            nombre = ct.get("nombre", "")
            apellido = ct.get("apellido", "")
            role_source = ct.get("_role_source")
            linkedin_url = ct.get("_linkedin_url", "")
        elif isinstance(ct, list) and len(ct) >= 3:
            name = ct[0] or ""
            role = ct[1] or ""
            email = ct[2] or ""
            nombre = ct[3] if len(ct) > 3 else ""
            apellido = ct[4] if len(ct) > 4 else ""
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
        entry = {"name": name, "email": email, "role": role, "nombre": nombre or "", "apellido": apellido or ""}
        # Force mode: re-enrich contacts that have role but no linkedin_url
        if force and role_source and not linkedin_url:
            contacts.append(entry)
            continue
        # Don't overwrite if already enriched via this script
        if role_source and not needs_enrichment:
            continue
        if needs_enrichment:
            contacts.append(entry)
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
    backend = None  # auto-detect
    discover_dm = False

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
        elif args[i] == "--backend" and i + 1 < len(args):
            backend = args[i + 1].lower().strip()
            i += 2
        elif args[i] == "--all-types":
            # Enrich all company types, not just Originacion
            os.environ["ENRICH_ALL_TYPES"] = "1"
            i += 1
        elif args[i] == "--discover-dm":
            discover_dm = True
            i += 1
        else:
            print(f"Unknown arg: {args[i]}")
            sys.exit(1)

    # Auto-detect backend
    if not backend:
        if os.environ.get("APOLLO_API_KEY"):
            backend = "apollo"
        elif os.environ.get("PERPLEXITY_API_KEY"):
            backend = "perplexity"
        elif os.environ.get("GEMINI_API_KEY"):
            backend = "gemini"
        else:
            print("  [error] No API key found. Set APOLLO_API_KEY, PERPLEXITY_API_KEY or GEMINI_API_KEY")
            sys.exit(1)

    if not top_n and not single_domain:
        top_n = 50  # default

    # Select enrichment function
    if backend == "apollo":
        enrich_fn = enrich_contacts_with_apollo
        delay = 0  # Apollo function handles its own delays per contact
        backend_label = "Apollo.io (People Match)"
    elif backend == "perplexity":
        enrich_fn = enrich_contacts_with_perplexity
        delay = RPM_DELAY
        backend_label = f"Perplexity ({PERPLEXITY_MODEL})"
    else:
        enrich_fn = enrich_contacts_with_gemini
        delay = GEMINI_RPM_DELAY
        backend_label = f"Gemini ({GEMINI_MODEL})"

    print("=" * 60)
    print("  Alter5 BI — Contact Role Enrichment")
    print(f"  Backend: {backend_label}")
    print("=" * 60)

    data, paths = load_companies()
    all_companies = data.get("companies", {})

    # Filter companies with contacts needing enrichment
    enrich_all_types = os.environ.get("ENRICH_ALL_TYPES") == "1"
    candidates = {}
    for domain, company in all_companies.items():
        if not enrich_all_types:
            enrichment = company.get("enrichment") or {}
            role = enrichment.get("role", "")
            if role not in ("Originacion", "Originación"):
                continue
        needs = get_contacts_needing_enrichment(company, force=force)
        if not needs:
            continue
        candidates[domain] = (company, needs)

    type_label = "all" if enrich_all_types else "Originacion"
    print(f"  {type_label} companies with contacts to enrich: {len(candidates)}")

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
    consecutive_rate_limits = 0
    SAVE_EVERY = 10  # incremental save every N companies
    MAX_CONSECUTIVE_RATE_LIMITS = 5  # stop after N consecutive 429s

    for idx, (domain, (company, needs)) in enumerate(targets.items(), 1):
        name = company.get("name", domain)
        score = campaign_priority_score(domain, company)

        print(f"  [{idx}/{len(targets)}] {name} ({domain}) — priority={score}, {len(needs)} contacts")

        if dry_run:
            for ct in needs:
                print(f"    → {ct['name']} <{ct['email']}> — {ct['role'] or 'sin cargo'}")
            continue

        # Call enrichment API
        print(f"    Calling {backend}...", end=" ", flush=True)
        results = enrich_fn(domain, name, needs)

        if not results:
            print("FAILED")
            failed_count += 1
            # Track consecutive rate-limit failures (Apollo returns empty on 429 retry fail)
            consecutive_rate_limits += 1
            if consecutive_rate_limits >= MAX_CONSECUTIVE_RATE_LIMITS:
                print(f"\n  [stop] {MAX_CONSECUTIVE_RATE_LIMITS} consecutive failures — rate limit likely hit. Stopping.")
                break
            time.sleep(delay)
            continue

        consecutive_rate_limits = 0  # reset on success

        # Build lookup by email, validate LinkedIn URLs
        result_by_email = {}
        for r in results:
            email = (r.get("email") or "").lower().strip()
            if email:
                # Validate LinkedIn URL: must be real format, reject obvious hallucinations
                li_url = (r.get("linkedin_url") or "").strip()
                if li_url:
                    is_valid = (
                        li_url.startswith("https://www.linkedin.com/in/") or
                        li_url.startswith("https://linkedin.com/in/")
                    )
                    # Reject URLs with suspicious numeric-only slugs (likely hallucinated)
                    slug = li_url.rstrip("/").split("/")[-1]
                    has_only_hex = bool(re.match(r'^[0-9a-f]{8,}$', slug))
                    if not is_valid or has_only_hex:
                        r["linkedin_url"] = ""  # discard bad URL
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

            # Skip if API returned "No identificado" or empty
            if not new_role or new_role.lower() in ("no identificado", "nan"):
                continue

            linkedin_url = enriched.get("linkedin_url", "")
            photo_url = enriched.get("photo_url", "")

            # Update the contact
            if isinstance(ct, dict):
                ct["role"] = new_role
                ct["_role_source"] = f"{source}_search:{source}" if source != "apollo" else "apollo"
                ct["_role_verified_at"] = now
                ct["_role_confidence"] = confidence
                if linkedin_url:
                    ct["_linkedin_url"] = linkedin_url
                if photo_url:
                    ct["_photo_url"] = photo_url
            elif isinstance(ct, list) and len(ct) >= 3:
                ct[1] = new_role  # role is at index 1

            updated += 1
            li_tag = f" | LinkedIn: {linkedin_url}" if linkedin_url else ""
            print(f"    ✓ {enriched.get('email')}: {new_role} ({source}, {confidence}){li_tag}")

        if updated > 0:
            enriched_count += 1
            contacts_enriched += updated
            # Incremental save every SAVE_EVERY enriched companies
            if enriched_count % SAVE_EVERY == 0:
                print(f"  [checkpoint] Saving after {enriched_count} companies enriched...")
                save_companies(data, paths)
        else:
            print(f"    (no new roles found)")

        time.sleep(delay)

    # --- Discover decision makers mode ---
    dm_discovered = 0
    if discover_dm and backend == "apollo" and not dry_run:
        print()
        print("-" * 60)
        print("  Phase 2: Discovering decision makers (Apollo Search)")
        print("-" * 60)

        # Find Originacion companies WITHOUT decision makers
        dm_targets = []
        for domain, company in all_companies.items():
            enrichment = company.get("enrichment") or {}
            role = enrichment.get("role", "")
            if role not in ("Originacion", "Originación"):
                continue
            raw_contacts = company.get("contacts", [])
            has_dm = False
            existing_emails = set()
            for ct in raw_contacts:
                if isinstance(ct, dict):
                    r = (ct.get("role") or "").lower()
                    existing_emails.add((ct.get("email") or "").lower().strip())
                elif isinstance(ct, list) and len(ct) >= 3:
                    r = (ct[1] or "").lower()
                    existing_emails.add((ct[2] or "").lower().strip())
                else:
                    continue
                if re.search(r'ceo|cfo|director.*(general|financ)|chief.*(executive|financial)|head.*(finance|project finance)', r, re.I):
                    has_dm = True
                    break
            if not has_dm:
                dm_targets.append((domain, company, existing_emails))

        if single_domain:
            dm_targets = [(d, c, e) for d, c, e in dm_targets if d == single_domain]

        if top_n:
            # Sort by priority and take top N
            dm_scored = [(d, campaign_priority_score(d, c), c, e) for d, c, e in dm_targets]
            dm_scored.sort(key=lambda x: x[1], reverse=True)
            dm_targets = [(d, c, e) for d, _, c, e in dm_scored[:top_n]]

        print(f"  Companies without decision maker: {len(dm_targets)}")

        for idx, (domain, company, existing_emails) in enumerate(dm_targets, 1):
            name = company.get("name", domain)
            print(f"  [{idx}/{len(dm_targets)}] {name} ({domain})...", end=" ", flush=True)

            new_contacts = discover_decision_makers_apollo(domain, name)

            # Filter out contacts we already have
            added = 0
            for nc in new_contacts:
                nc_email = nc.get("email", "").lower().strip()
                if nc_email in existing_emails:
                    continue
                # Add to company contacts
                all_companies[domain].setdefault("contacts", []).append(nc)
                existing_emails.add(nc_email)
                added += 1
                dm_discovered += 1
                li = nc.get("_linkedin_url", "")
                li_tag = f" | {li}" if li else ""
                print(f"\n    + {nc['name']}: {nc['role']} <{nc['email']}>{li_tag}")

            if added == 0:
                print("(no new DM found)")

            time.sleep(APOLLO_RPM_DELAY)

        print(f"\n  New decision makers discovered: {dm_discovered}")

    elif discover_dm and backend != "apollo":
        print("\n  [warn] --discover-dm requires --backend apollo (or APOLLO_API_KEY)")

    # Summary
    print()
    print("=" * 60)
    print(f"  Companies processed: {len(targets)}")
    print(f"  Companies with updates: {enriched_count}")
    print(f"  Contacts enriched: {contacts_enriched}")
    if dm_discovered:
        print(f"  New decision makers discovered: {dm_discovered}")
    print(f"  Failed: {failed_count}")

    total_changes = contacts_enriched + dm_discovered
    if not dry_run and total_changes > 0:
        save_companies(data, paths)
    elif dry_run:
        print("  (dry run — no files written)")

    print("=" * 60)


if __name__ == "__main__":
    main()
