#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Deep Enrichment: Originación companies
===============================================================

  Enriches Originación companies by:
  1. Fetching their actual website (requests + BeautifulSoup)
  2. Sending website text + email context to Gemini with Google Search grounding
  3. Classifying business lines, project scale, pipeline MW, etc.

  Results are merged into enrichment in companies_full.json.

  Usage:
    export GEMINI_API_KEY="AIza..."

    python scripts/enrich_originacion.py --top 100          # top 100 by interactions
    python scripts/enrich_originacion.py --domain X          # single domain
    python scripts/enrich_originacion.py --top 200 --unenriched  # only without web enrichment
    python scripts/enrich_originacion.py --top 10 --dry-run  # preview without writing

  Estimated cost: ~1 Gemini call per company ~ $0.01-0.03 each
  Estimated time: ~8s per company (website fetch + Gemini)
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
from datetime import datetime

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("[error] Missing dependencies. Run: pip install requests beautifulsoup4")
    sys.exit(1)

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
# Taxonomy
# ---------------------------------------------------------------------------
ORIGINACION_BUSINESS_LINES = [
    "Utility-scale developer",
    "Autoconsumo industrial",
    "Autoconsumo residencial",
    "EPC / Construcción",
    "IPP",
    "O&M / Asset Management",
    "Almacenamiento / BESS",
    "Hidrógeno verde",
    "Biogás / Biometano",
    "Agrovoltaica",
    "Cargadores EV / Movilidad",
    "Trading / PPA",
]

PROJECT_SCALES = ["Utility-scale", "Distribuido", "Mixto"]


# ---------------------------------------------------------------------------
# Website fetching
# ---------------------------------------------------------------------------
def fetch_website_text(domain, timeout=10, max_chars=5000):
    """Fetch and extract visible text from a company's website."""
    urls_to_try = [
        f"https://www.{domain}",
        f"https://{domain}",
    ]

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    }

    for url in urls_to_try:
        try:
            resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            if resp.status_code == 200 and "text/html" in resp.headers.get("Content-Type", ""):
                soup = BeautifulSoup(resp.text, "html.parser")

                # Remove script, style, nav, footer elements
                for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "iframe"]):
                    tag.decompose()

                text = soup.get_text(separator=" ", strip=True)
                # Collapse whitespace
                text = re.sub(r"\s+", " ", text).strip()

                if len(text) > max_chars:
                    text = text[:max_chars]

                return {
                    "text": text,
                    "url": resp.url,  # final URL after redirects
                    "status": "ok",
                }
        except requests.exceptions.SSLError:
            # Try without SSL verification
            try:
                resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True, verify=False)
                if resp.status_code == 200 and "text/html" in resp.headers.get("Content-Type", ""):
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "iframe"]):
                        tag.decompose()
                    text = re.sub(r"\s+", " ", soup.get_text(separator=" ", strip=True)).strip()
                    return {"text": text[:max_chars], "url": resp.url, "status": "ok"}
            except Exception:
                continue
        except Exception:
            continue

    return {"text": "", "url": "", "status": "unreachable"}


# ---------------------------------------------------------------------------
# Gemini enrichment with Google Search grounding
# ---------------------------------------------------------------------------
def enrich_with_gemini(domain, name, current_enrichment, subjects, bodies, website_data):
    """Enrich a single Originación company using Gemini + website text + grounding."""

    curr_role = current_enrichment.get("role", "Originacion")
    curr_seg = current_enrichment.get("seg", "")
    curr_type = current_enrichment.get("tp2", "")
    curr_tech = current_enrichment.get("tech", [])

    current_summary = f"Role={curr_role}"
    if curr_seg:
        current_summary += f", Segment={curr_seg}"
    if curr_type:
        current_summary += f", Type={curr_type}"
    if curr_tech:
        current_summary += f", Tech={curr_tech}"

    # Email context
    subj_text = " | ".join(subjects[:15]) if subjects else "(sin emails)"
    body_text = ""
    if bodies:
        body_text = " // ".join(bodies[:3])[:2000]

    name_display = name or domain

    # Website text
    web_text = website_data.get("text", "")
    web_url = website_data.get("url", "")
    web_section = ""
    if web_text:
        web_section = f"""
## TEXTO EXTRAIDO DE SU WEB ({web_url}):
{web_text}
"""
    else:
        web_section = f"\n## WEB: No se pudo acceder a {domain}\n"

    prompt = f"""Eres un analista de Alter5, consultora de financiación de energías renovables en España y Europa.

TAREA: Enriquecer el perfil de la empresa de ORIGINACIÓN "{name_display}" (dominio: {domain}).

## CLASIFICACION ACTUAL:
{current_summary}

## CONTEXTO DE EMAILS con Alter5:
Asuntos recientes: [{subj_text}]
{f"Extractos de emails: [{body_text}]" if body_text else ""}
{web_section}
## INSTRUCCIONES:
1. Analiza la web de la empresa y los emails para entender QUÉ HACE exactamente.
2. Clasifica sus LÍNEAS DE NEGOCIO (puede tener varias).
3. Determina la ESCALA de sus proyectos.
4. Si la web menciona MW de pipeline o proyectos, extrae el dato.
5. Escribe una descripción concisa de 2-3 frases.
6. USA Google Search para complementar si la web no tiene suficiente info.

## LÍNEAS DE NEGOCIO (elige una o varias):
{json.dumps(ORIGINACION_BUSINESS_LINES)}

## ESCALA DE PROYECTOS:
{json.dumps(PROJECT_SCALES)}
- "Utility-scale": proyectos >1MW, plantas solares/eólicas grandes
- "Distribuido": autoconsumo, cubiertas, pequeña escala (<1MW)
- "Mixto": ambos

## FORMATO DE RESPUESTA (JSON válido, sin markdown):
{{
  "business_lines": ["..."],
  "project_scale": "Utility-scale|Distribuido|Mixto",
  "known_pipeline_mw": null,
  "website_description": "Descripción de 2-3 frases sobre qué hace la empresa",
  "confidence": "alta|media|baja"
}}

NOTAS:
- business_lines: array con 1-4 valores del listado. Si no encaja ninguno, usa el más cercano.
- known_pipeline_mw: número entero si la web menciona MW totales de pipeline/proyectos. null si no hay dato.
- confidence: "alta" si la web tiene info clara, "media" si solo grounding, "baja" si escasa info."""

    try:
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            print("  [error] GEMINI_API_KEY not set")
            return None

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
        try:
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
        print(f"  [warn] Gemini enrichment failed for {domain}: {e}")
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


def get_email_context(company):
    """Extract subjects and bodies from company details."""
    subjects = []
    bodies = []
    for detail in company.get("details", []):
        if isinstance(detail, dict):
            subj = detail.get("subject", "")
            body = detail.get("body_text", "")
        elif isinstance(detail, list) and len(detail) >= 4:
            subj = detail[3] if len(detail) > 3 else ""
            body = detail[7] if len(detail) > 7 else ""
        else:
            continue
        if subj:
            subjects.append(subj)
        if body:
            bodies.append(body)
    return subjects, bodies


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    args = sys.argv[1:]
    top_n = None
    single_domain = None
    unenriched_only = False
    dry_run = False

    i = 0
    while i < len(args):
        if args[i] == "--top" and i + 1 < len(args):
            top_n = int(args[i + 1])
            i += 2
        elif args[i] == "--domain" and i + 1 < len(args):
            single_domain = args[i + 1].lower().strip()
            i += 2
        elif args[i] == "--unenriched":
            unenriched_only = True
            i += 1
        elif args[i] == "--dry-run":
            dry_run = True
            i += 1
        else:
            print(f"Unknown arg: {args[i]}")
            sys.exit(1)

    if not top_n and not single_domain:
        top_n = 50  # default

    print("=" * 60)
    print("  Alter5 BI — Deep Enrichment: Originación")
    print("=" * 60)

    data, paths = load_companies()
    all_companies = data.get("companies", {})

    # Filter to Originación companies
    originacion = {}
    for domain, company in all_companies.items():
        enrichment = company.get("enrichment") or {}
        role = enrichment.get("role", "")
        if role in ("Originacion", "Originación"):
            originacion[domain] = company

    print(f"  Total Originación companies: {len(originacion)}")

    # Build target list
    if single_domain:
        if single_domain in originacion:
            targets = {single_domain: originacion[single_domain]}
        elif single_domain in all_companies:
            # Allow enriching even if not classified as Originación
            print(f"  [info] {single_domain} is not Originación but proceeding anyway")
            targets = {single_domain: all_companies[single_domain]}
        else:
            print(f"  [error] Domain {single_domain} not found")
            sys.exit(1)
    else:
        # Sort by interactions descending
        sorted_domains = sorted(
            originacion.keys(),
            key=lambda d: originacion[d].get("interactions", 0),
            reverse=True,
        )

        if unenriched_only:
            sorted_domains = [
                d for d in sorted_domains
                if not (originacion[d].get("enrichment") or {}).get("_web_enriched_at")
            ]
            print(f"  Unenriched only: {len(sorted_domains)} companies")

        if top_n:
            sorted_domains = sorted_domains[:top_n]

        targets = {d: originacion[d] for d in sorted_domains}

    print(f"  Targets: {len(targets)} companies")
    if dry_run:
        print("  Mode: DRY RUN (no writes)")
    print()

    # Process each company
    enriched_count = 0
    failed_count = 0

    for idx, (domain, company) in enumerate(targets.items(), 1):
        name = company.get("name", domain)
        interactions = company.get("interactions", 0)
        enrichment = company.get("enrichment") or {}

        print(f"  [{idx}/{len(targets)}] {name} ({domain}) — {interactions} interactions")

        # 1. Fetch website
        print(f"    Fetching website...", end=" ", flush=True)
        website_data = fetch_website_text(domain)
        if website_data["status"] == "ok":
            web_len = len(website_data["text"])
            print(f"OK ({web_len} chars, {website_data['url']})")
        else:
            print(f"UNREACHABLE")

        # 2. Get email context
        subjects, bodies = get_email_context(company)

        # 3. Call Gemini
        print(f"    Calling Gemini...", end=" ", flush=True)
        result = enrich_with_gemini(domain, name, enrichment, subjects, bodies, website_data)

        if not result:
            print(f"FAILED")
            failed_count += 1
            time.sleep(GEMINI_RPM_DELAY)
            continue

        # Validate business_lines
        blines = result.get("business_lines", [])
        if isinstance(blines, str):
            blines = [blines]
        valid_blines = [b for b in blines if b in ORIGINACION_BUSINESS_LINES]
        if not valid_blines and blines:
            # Keep original if none match exactly (Gemini may use slight variations)
            valid_blines = blines[:4]

        scale = result.get("project_scale", "")
        if scale not in PROJECT_SCALES:
            scale = ""

        pipeline_mw = result.get("known_pipeline_mw")
        if pipeline_mw is not None:
            try:
                pipeline_mw = int(pipeline_mw)
            except (ValueError, TypeError):
                pipeline_mw = None

        description = result.get("website_description", "")
        confidence = result.get("confidence", "baja")

        print(f"OK — {valid_blines}, scale={scale}, mw={pipeline_mw}")

        # 4. Merge into enrichment (preserve existing fields)
        if not dry_run:
            if "enrichment" not in all_companies[domain] or all_companies[domain]["enrichment"] is None:
                all_companies[domain]["enrichment"] = {}

            enr = all_companies[domain]["enrichment"]
            enr["business_lines"] = valid_blines
            if scale:
                enr["project_scale"] = scale
            if pipeline_mw is not None:
                enr["known_pipeline_mw"] = pipeline_mw
            if website_data["url"]:
                enr["website_url"] = website_data["url"]
            if description:
                enr["website_description"] = description
            enr["_web_enriched_at"] = datetime.utcnow().isoformat()
            enr["_web_source"] = "website+grounding" if website_data["status"] == "ok" else "grounding_only"

        enriched_count += 1
        time.sleep(GEMINI_RPM_DELAY)

    # Summary
    print()
    print("=" * 60)
    print(f"  Enriched: {enriched_count}/{len(targets)}")
    print(f"  Failed: {failed_count}/{len(targets)}")

    if not dry_run and enriched_count > 0:
        save_companies(data, paths)
    elif dry_run:
        print("  (dry run — no files written)")

    print("=" * 60)


if __name__ == "__main__":
    main()
