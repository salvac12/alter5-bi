"""
===============================================================
  Alter5 BI — Pipeline: Google Sheet → companies.json
===============================================================

  Se ejecuta en GitHub Actions (o localmente para testing).
  Lee emails "pending" de la Google Sheet, clasifica empresas
  nuevas con Gemini, y actualiza los JSON del dashboard.

  Variables de entorno requeridas:
    GOOGLE_SERVICE_ACCOUNT_JSON  — JSON de la service account
    GEMINI_API_KEY               — API key de Google AI Studio
    GOOGLE_SHEET_ID              — ID de la Google Sheet

  Uso local (testing):
    export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat sa.json)"
    export GEMINI_API_KEY="AIza..."
    export GOOGLE_SHEET_ID="1abc..."
    python scripts/process_sheet_emails.py
===============================================================
"""

import json
import os
import ssl
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

# Import shared functions from import_mailbox
sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import merge_company, export_to_compact, get_data_paths

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# v2 taxonomy
COMPANY_ROLES = ["Originación", "Inversión", "Ecosistema", "No relevante"]
ORIGINACION_SEGMENTS = ["Project Finance", "Corporate Finance"]
COMPANY_TYPES_V2 = {
    "Originación > Project Finance": ["Developer", "IPP", "Developer + IPP"],
    "Originación > Corporate Finance": [],
    "Inversión > Deuda": ["Fondo de deuda", "Banco", "Bonista / Institucional"],
    "Inversión > Equity": ["Fondo de infraestructura", "Private equity", "Fondo renovable", "IPP comprador", "Utility compradora"],
    "Ecosistema": ["Asesor legal", "Asesor técnico", "Consultor de precios", "Asset manager", "Ingeniería", "Asesor financiero", "Asociación / Institución"],
}
CORPORATE_ACTIVITIES = [
    "Autoconsumo industrial/comercial", "Movilidad / Cargadores EV",
    "EPC / Construcción renovable", "Almacenamiento / BESS distribuido",
    "Data centers", "Electrointensivo", "Biogás / Biometano",
    "Hidrógeno verde", "Eficiencia energética", "Calor renovable / Biomasa",
    "Redes / Infraestructura eléctrica", "Agritech / Agrovoltaica",
]
TECHNOLOGIES = ["Solar", "Eólica", "BESS", "Biogás", "Hidrógeno", "Otra"]
GEOGRAPHIES = ["España", "Portugal", "Italia", "Francia", "Alemania", "UK", "Otro"]
COMMERCIAL_PHASES = ["Sin contactar", "Primer contacto", "Exploración", "Negociación", "Cliente activo", "Dormido"]
ASSET_PHASES = ["Desarrollo", "RTB", "Construcción", "Operativo"]

# Legacy (kept for backward compat in enrichment output)
COMPANY_GROUPS = ["Capital Seeker", "Investor", "Services", "Other"]
COMPANY_TYPES = {
    "Capital Seeker": ["Developer", "IPP", "Utility", "Asset Owner", "Corporate"],
    "Investor": ["Renewable Fund", "Institutional Investor", "Bank", "Family Office", "Infrastructure Fund"],
    "Services": ["Legal Advisor", "Financial Advisor", "Technical Advisor", "EPC / Contractor", "Consultant", "Platform / Tech"],
    "Other": ["Public Institution", "Association", "Other"],
}
ALL_COMPANY_TYPES = [t for types in COMPANY_TYPES.values() for t in types]

DEAL_STAGES = [
    "Prospect", "Opportunity", "Documentation",
    "TS Preparation", "TS Sent / Discussion", "Signing", "Distribution",
]

MARKET_ROLES_LIST = [
    "Borrower", "Seller (M&A)", "Buyer Investor (M&A)",
    "Debt Investor", "Equity Investor", "Partner & Services",
]

# Mapping v2 role -> legacy group
ROLE_TO_LEGACY_GROUP = {
    "Originación": "Capital Seeker",
    "Inversión": "Investor",
    "Ecosistema": "Services",
    "No relevante": "Other",
}

PERSONAL_DOMAINS = {
    "gmail.com", "hotmail.com", "yahoo.com", "outlook.com",
    "live.com", "icloud.com", "yahoo.es", "hotmail.es",
    "googlemail.com", "protonmail.com", "me.com", "msn.com",
}

GEMINI_BATCH_SIZE = 6
GEMINI_RPM_DELAY = float(os.environ.get("GEMINI_RPM_DELAY", "4.5"))  # seconds between calls
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# Known companies override file
KNOWN_COMPANIES_FILE = os.path.join(PROJECT_DIR, "config", "known_companies.json")


def load_known_companies():
    """Load manual classifications from config/known_companies.json."""
    if not os.path.exists(KNOWN_COMPANIES_FILE):
        return {}
    try:
        with open(KNOWN_COMPANIES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("companies", {})
    except Exception as e:
        print(f"  [warn] Error loading known_companies.json: {e}")
        return {}


def build_known_result(override):
    """Build a classify result dict from a known_companies override entry."""
    role = override.get("role", "No relevante")
    tp2 = override.get("tp2", "")
    mr = override.get("mr", [])
    geo = override.get("geo", [])
    tech = override.get("tech", [])
    seg = override.get("seg", "")
    act = override.get("act", [])

    legacy_group = ROLE_TO_LEGACY_GROUP.get(role, "Other")
    legacy_type = tp2 or "Other"

    enrichment = {
        "_tv": 2,
        "role": role,
        "seg": seg,
        "tp2": tp2,
        "act": act,
        "tech": tech,
        "geo": geo,
        "mr": mr,
        "grp": legacy_group,
        "tp": legacy_type,
    }
    return {"group": legacy_group, "type": legacy_type, "enrichment": enrichment}


def load_verified_companies():
    """Load verified classifications from Airtable Verified-Companies table.

    Only loads records with Status = 'Verified' or 'Edited'.
    Returns dict of domain -> override fields (same format as known_companies).
    """
    airtable_pat = os.environ.get("AIRTABLE_PAT", "")
    if not airtable_pat:
        return {}

    base_id = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")
    table_name = "Verified-Companies"
    api_url = f"https://api.airtable.com/v0/{base_id}/{urllib.request.quote(table_name)}"

    # Map Airtable singleSelect values (no accents) -> enrichment values (with accents)
    ROLE_MAP = {
        "Originacion": "Originación",
        "Inversion": "Inversión",
        "Ecosistema": "Ecosistema",
        "No relevante": "No relevante",
    }
    # Enrichment `seg` is only used for Originación (PF/CF).
    # For Inversión, "Deuda"/"Equity" is inferred from type, not stored in seg.
    SEG_MAP_ORIGINACION = {
        "Project Finance": "Project Finance",
        "Corporate Finance": "Corporate Finance",
    }
    TYPE_ACCENT_MAP = {
        "Asesor tecnico": "Asesor técnico",
        "Asociacion / Institucion": "Asociación / Institución",
        "Ingenieria": "Ingeniería",
    }
    TECH_ACCENT_MAP = {
        "Eolica": "Eólica",
        "Biogas": "Biogás",
        "Hidrogeno": "Hidrógeno",
    }
    GEO_ACCENT_MAP = {
        "Espana": "España",
    }
    # Activities with accents
    ACTIVITY_ACCENT_MAP = {
        "Biogas / Biometano": "Biogás / Biometano",
        "Hidrogeno verde": "Hidrógeno verde",
        "Construccion renovable": "Construcción renovable",
        "EPC / Construccion renovable": "EPC / Construcción renovable",
        "Redes / Infraestructura electrica": "Redes / Infraestructura eléctrica",
    }

    verified = {}
    offset = ""

    try:
        import urllib.request as ur

        while True:
            # Filter for Verified or Edited status
            formula = urllib.request.quote("OR({Status}='Verified',{Status}='Edited')")
            url = f"{api_url}?pageSize=100&filterByFormula={formula}"
            if offset:
                url += f"&offset={offset}"

            req = ur.Request(url, headers={
                "Authorization": f"Bearer {airtable_pat}",
                "Content-Type": "application/json",
            })

            # Reuse project-level SSL context
            try:
                import certifi as _certifi
                _ssl_ctx = ssl.create_default_context(cafile=_certifi.where())
            except ImportError:
                _ssl_ctx = ssl.create_default_context()
                if not os.environ.get("CI"):
                    _ssl_ctx.check_hostname = False
                    _ssl_ctx.verify_mode = ssl.CERT_NONE

            with ur.urlopen(req, context=_ssl_ctx) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            for rec in data.get("records", []):
                f = rec.get("fields", {})
                domain = f.get("Domain", "")
                if not domain:
                    continue

                # Map Airtable field values back to enrichment format
                role_raw = f.get("Role", "")
                role = ROLE_MAP.get(role_raw, role_raw)

                seg_raw = f.get("Segment", "")
                type_raw = f.get("Type", "")
                tp2 = TYPE_ACCENT_MAP.get(type_raw, type_raw)

                # Segment handling: enrichment `seg` only stores Originación segments
                # For Inversión, Deuda/Equity is inferred from type, not stored
                if role == "Originación":
                    seg = SEG_MAP_ORIGINACION.get(seg_raw, seg_raw) if seg_raw else ""
                else:
                    seg = ""  # Inversión/Ecosistema don't use seg in enrichment

                tech_raw = f.get("Technologies", [])
                tech = [TECH_ACCENT_MAP.get(t, t) for t in tech_raw]

                geo_raw = f.get("Geography", [])
                geo = [GEO_ACCENT_MAP.get(g, g) for g in geo_raw]

                mr = f.get("Market Roles", [])
                act_raw = f.get("Activities", [])
                act = [ACTIVITY_ACCENT_MAP.get(a, a) for a in act_raw]

                verified[domain] = {
                    "role": role,
                    "seg": seg,
                    "tp2": tp2,
                    "act": act,
                    "tech": tech,
                    "geo": geo,
                    "mr": mr,
                }

            offset = data.get("offset", "")
            if not offset:
                break

    except Exception as e:
        print(f"  [warn] Error loading verified companies from Airtable: {e}")

    return verified


# ---------------------------------------------------------------------------
# Google Sheet helpers
# ---------------------------------------------------------------------------
def get_gspread_client():
    """Authenticate with Google Sheets using service account."""
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not sa_json:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON env var not set")

    sa_info = json.loads(sa_json)
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
    ]
    creds = Credentials.from_service_account_info(sa_info, scopes=scopes)
    return gspread.authorize(creds)


def read_pending_emails(sheet, reprocess=False):
    """Read rows with status 'pending' (or 'done' if reprocess=True) from raw_emails tab."""
    ws = sheet.worksheet("raw_emails")
    records = ws.get_all_records()

    valid_statuses = {"pending", "done"} if reprocess else {"pending"}
    pending = []
    for i, row in enumerate(records):
        status = str(row.get("processed", "")).strip().lower()
        if status in valid_statuses:
            # row index in sheet is i+2 (1-indexed header + 1-indexed data)
            row["_sheet_row"] = i + 2
            pending.append(row)

    return ws, pending


def mark_rows_done(ws, row_indices):
    """Mark processed rows as 'done' in the sheet using batch update."""
    _batch_update_status(ws, row_indices, "done")


def mark_rows_ignored(ws, row_indices):
    """Mark irrelevant rows as 'ignored' in the sheet using batch update."""
    _batch_update_status(ws, row_indices, "ignored")


def _batch_update_status(ws, row_indices, status):
    """Batch update column A for given rows — single API call."""
    if not row_indices:
        return
    cells = [gspread.Cell(row=r, col=1, value=status) for r in row_indices]
    ws.update_cells(cells)


def log_classifications_batch(sheet, classifications, source):
    """Log AI classifications to ai_classifications tab in a single batch."""
    if not classifications:
        return
    try:
        ws = sheet.worksheet("ai_classifications")
        rows = []
        for domain, cls in classifications.items():
            rows.append([
                datetime.utcnow().isoformat(),
                domain,
                cls.get("group", "Other"),
                cls.get("type", "Other"),
                source,
            ])
        ws.append_rows(rows)
    except Exception as e:
        print(f"  [warn] Could not log classifications: {e}")


# ---------------------------------------------------------------------------
# Gemini classification
# ---------------------------------------------------------------------------
def filter_relevant_emails(pending_emails):
    """Filter emails using Gemini to keep only business-relevant ones.

    Returns:
        (relevant, ignored) — two lists of email rows
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  [warn] GEMINI_API_KEY not set — skipping relevance filter")
        return pending_emails, []

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(GEMINI_MODEL)
    except Exception as e:
        print(f"  [warn] Gemini init failed: {e} — skipping relevance filter")
        return pending_emails, []

    relevant = []
    ignored = []
    batch_size = 20

    for batch_start in range(0, len(pending_emails), batch_size):
        batch = pending_emails[batch_start:batch_start + batch_size]

        lines = []
        for i, row in enumerate(batch):
            from_email = str(row.get("from_email", ""))
            subject = str(row.get("subject", ""))
            snippet = str(row.get("body_snippet", ""))[:200]
            body = str(row.get("body_text", ""))[:500]
            # Use body_text if available, otherwise fall back to snippet
            content = body if body and body != "nan" else snippet
            lines.append(f"{i}: from={from_email} | subject={subject} | content={content}")

        prompt = f"""Eres un filtro de emails para Alter5, consultora de financiación de energías renovables en Europa.

Alter5 INTERMEDIA entre empresas que buscan capital (developers renovables, IPPs, corporates en transición energética) e inversores (fondos de deuda, bancos, fondos de equity). Sus productos son: Préstamo Construcción, Refinanciación, Colocación Inversores, Advisory / M&A.

Analiza estos emails y decide cuáles son RELEVANTES para el negocio:
RELEVANTES: comunicación con clientes/prospects, inversores, asesores legales/financieros, propuestas de financiación, reuniones de negocio, oportunidades en renovables, deals de M&A, term sheets, due diligence, NDA, contactos profesionales del sector energético/financiero.
NO RELEVANTES: newsletters, notificaciones automáticas de herramientas/apps, marketing masivo, facturas/recibos genéricos, spam, suscripciones, alertas de sistemas, emails personales, eventos/conferencias masivas, plataformas SaaS.

Emails:
{chr(10).join(lines)}

Responde SOLO con un JSON válido con este formato exacto:
{{"relevant": [0, 2, 5], "ignored": [1, 3, 4]}}

Los números son los índices de cada email. Todos los emails deben aparecer en una de las dos listas."""

        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1]
                if text.endswith("```"):
                    text = text.rsplit("```", 1)[0]
                text = text.strip()

            parsed = json.loads(text)
            relevant_indices = set(parsed.get("relevant", []))
            ignored_indices = set(parsed.get("ignored", []))

            for i, row in enumerate(batch):
                if i in ignored_indices:
                    ignored.append(row)
                else:
                    relevant.append(row)
        except Exception as e:
            print(f"  [warn] Relevance filter batch failed: {e} — keeping all")
            relevant.extend(batch)

        if batch_start + batch_size < len(pending_emails):
            time.sleep(GEMINI_RPM_DELAY)

    return relevant, ignored


def classify_domains_with_gemini(domains_with_context, verified=None):
    """Classify domains using v2 taxonomy (role → segment → type → activities).

    Args:
        domains_with_context: list of tuples, either:
            - (domain, [subjects], [snippets])                      — 3-tuple (legacy)
            - (domain, [subjects], [snippets], name)                — 4-tuple (with company name)
            - (domain, [subjects], [snippets], name, [bodies])      — 5-tuple (with full bodies)
        verified: optional pre-loaded dict from load_verified_companies() to avoid duplicate API calls.

    Returns:
        dict of domain -> {"group": str, "type": str, "enrichment": {...} | None}
    """
    default = {"group": "Other", "type": "Other", "enrichment": None}

    # Normalize tuples: extract domain, subjects, snippets, name, and bodies
    def _unpack(item):
        domain = item[0]
        subjects = item[1] if len(item) > 1 else []
        snippets = item[2] if len(item) > 2 else []
        name = item[3] if len(item) > 3 else ""
        bodies = item[4] if len(item) > 4 else []
        return domain, subjects, snippets, name, bodies

    # Pre-resolve verified companies from Airtable (highest priority)
    if verified is None:
        verified = load_verified_companies()
    results = {}
    remaining_after_verified = []

    for item in domains_with_context:
        domain = item[0]
        if domain in verified:
            results[domain] = build_known_result(verified[domain])
        else:
            remaining_after_verified.append(item)

    if verified and len(results) > 0:
        print(f"  -> {len(results)} dominios resueltos via Verified-Companies (Airtable)")

    # Pre-resolve known companies (skip Gemini for these)
    known = load_known_companies()
    remaining = []

    for item in remaining_after_verified:
        domain = item[0]
        if domain in known:
            results[domain] = build_known_result(known[domain])
        else:
            remaining.append(item)

    known_count = len(remaining_after_verified) - len(remaining)
    if known_count > 0:
        print(f"  -> {known_count} dominios resueltos via known_companies.json")

    if not remaining:
        return results

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  [warn] GEMINI_API_KEY not set — using defaults")
        for item in remaining:
            results[item[0]] = dict(default)
        return results

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(GEMINI_MODEL)
    except Exception as e:
        print(f"  [warn] Gemini init failed: {e} — using defaults")
        for item in remaining:
            results[item[0]] = dict(default)
        return results

    # Process in batches
    total_batches = (len(remaining) + GEMINI_BATCH_SIZE - 1) // GEMINI_BATCH_SIZE
    for batch_start in range(0, len(remaining), GEMINI_BATCH_SIZE):
        batch = remaining[batch_start:batch_start + GEMINI_BATCH_SIZE]
        batch_num = batch_start // GEMINI_BATCH_SIZE + 1
        if batch_num % 10 == 1 or batch_num == total_batches:
            print(f"  [classify] batch {batch_num}/{total_batches} ({batch_start + len(batch)}/{len(remaining)} empresas)")

        lines = []
        for item in batch:
            domain, subjects, snippets, name, bodies = _unpack(item)
            subj_text = " | ".join(subjects[:15])  # expanded from 5 to 15
            name_part = f" ({name})" if name else ""

            # Build rich context: prefer full bodies, fallback to snippets
            if bodies:
                body_text = " // ".join(bodies[:5])[:2000]  # up to 5 bodies, 2000 chars total
                lines.append(f"- {domain}{name_part}: subjects=[{subj_text}] email_content=[{body_text}]")
            else:
                snip_text = " // ".join(snippets[:8])[:1000]  # expanded from 3/300 to 8/1000
                lines.append(f"- {domain}{name_part}: subjects=[{subj_text}] snippets=[{snip_text}]")

        prompt = f"""Eres un analista de Alter5, consultora de financiación de energías renovables en Europa.

Alter5 INTERMEDIA: conecta empresas que buscan capital con inversores que lo aportan.
Productos: Préstamo Construcción, Refinanciación, Colocación Inversores, Advisory / M&A.

## ÁRBOL DE DECISIÓN — sigue estos pasos en orden:

### Paso 1: ROLE (obligatorio)
Elige UNO:
- "Originación" — empresas que buscan financiación (developers, IPPs, utilities, corporates en transición energética)
- "Inversión" — aportan capital (bancos, fondos de deuda, fondos de equity, family offices, institucionales)
- "Ecosistema" — asesores, consultores, legales, técnicos, asset managers, asociaciones
- "No relevante" — newsletters, herramientas SaaS, CRM, marketing, reclutiamiento, dominios genéricos sin relación con energía/finanzas

### Paso 2: SEGMENT (solo si role="Originación", si no dejar "")
- "Project Finance" — proyectos utility-scale: developers de solar/eólico/BESS, IPPs, utilities con pipeline de proyectos
- "Corporate Finance" — empresas de transición energética que necesitan deuda corporativa (autoconsumo, EV, EPC, biogás, hidrógeno, etc.)

### Paso 3: TYPE (según contexto)
Si Originación > Project Finance: uno de [{", ".join(COMPANY_TYPES_V2["Originación > Project Finance"])}]
Si Originación > Corporate Finance: dejar ""
Si Inversión: uno de [{", ".join(COMPANY_TYPES_V2["Inversión > Deuda"] + COMPANY_TYPES_V2["Inversión > Equity"])}]
Si Ecosistema: uno de [{", ".join(COMPANY_TYPES_V2["Ecosistema"])}]
Si No relevante: dejar ""

### Paso 4: ACTIVITIES (solo si role="Originación" y segment="Corporate Finance", si no dejar [])
Array de actividades aplicables: {json.dumps(CORPORATE_ACTIVITIES, ensure_ascii=False)}

### Paso 5: ATRIBUTOS adicionales
- technologies: subconjunto de {json.dumps(TECHNOLOGIES, ensure_ascii=False)}
- geography: subconjunto de {json.dumps(GEOGRAPHIES, ensure_ascii=False)}
- market_roles: subconjunto de [{", ".join(MARKET_ROLES_LIST)}]
- productos_potenciales: [{{"p": "nombre", "c": "alta|media|baja"}}] SOLO con evidencia en emails. Productos: Prestamo Construccion, Refinanciacion, Colocacion Inversores, Advisory / M&A.
- senales_clave: hechos concretos de emails (ej: "Pipeline 200MW", "NDA firmado"). Array vacío si no hay.
- fase_comercial: una de {json.dumps(COMMERCIAL_PHASES, ensure_ascii=False)}

## REGLAS ESPECIALES (aplica SIEMPRE antes de clasificar):
- Bufetes / law firms (dominios de despachos de abogados): SIEMPRE role="Ecosistema", type="Asesor legal", aunque los emails hablen de financiación, proyectos o deals. Señales: "abogad@", "letrad@", "counsel", "partner" en firmas legales.
- Big 4 (PwC, EY, Deloitte, KPMG): role="Ecosistema", type="Asesor financiero" o "Asesor técnico" según contexto.
- Asociaciones del sector (UNEF, AEE, APPA, etc.): role="Ecosistema", type="Asociación / Institución".

## EJEMPLOS de clasificaciones correctas:
- ontier.net (ONTIER): {{"role":"Ecosistema","segment":"","type":"Asesor legal","activities":[],"technologies":[],"geography":["España"],"market_roles":["Partner & Services"],"productos_potenciales":[],"senales_clave":[],"fase_comercial":""}}
- cuatrecasas.com (Cuatrecasas): {{"role":"Ecosistema","segment":"","type":"Asesor legal","activities":[],"technologies":[],"geography":["España","Portugal"],"market_roles":["Partner & Services"],"productos_potenciales":[],"senales_clave":[],"fase_comercial":""}}
- opdenergy.com (Opdenergy): {{"role":"Originación","segment":"Project Finance","type":"Developer + IPP","activities":[],"technologies":["Solar","Eólica","BESS"],"geography":["España"],"market_roles":["Borrower"],"productos_potenciales":[],"senales_clave":[],"fase_comercial":"Exploración"}}

## EMPRESAS A CLASIFICAR:
{chr(10).join(lines)}

## FORMATO DE RESPUESTA
Responde SOLO con JSON válido, sin markdown ni explicaciones:
{{"dominio.com": {{"role": "...", "segment": "...", "type": "...", "activities": [...], "technologies": [...], "geography": [...], "market_roles": [...], "productos_potenciales": [...], "senales_clave": [...], "fase_comercial": "..."}}}}"""

        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            # Clean markdown code fences if present
            if text.startswith("```"):
                text = text.split("\n", 1)[1]
                if text.endswith("```"):
                    text = text.rsplit("```", 1)[0]
                text = text.strip()

            parsed = json.loads(text)
            for item in batch:
                domain = item[0]
                if domain in parsed:
                    entry = parsed[domain]
                    role = entry.get("role", "No relevante")
                    segment = entry.get("segment", "")
                    comp_type = entry.get("type", "")
                    activities = entry.get("activities", [])
                    technologies = entry.get("technologies", [])
                    geography = entry.get("geography", [])
                    market_roles = entry.get("market_roles", [])

                    # Validate role
                    if role not in COMPANY_ROLES:
                        role = "No relevante"

                    # Validate segment
                    if role != "Originación":
                        segment = ""
                    elif segment and segment not in ORIGINACION_SEGMENTS:
                        segment = ""

                    # Validate type
                    if role == "Originación" and segment == "Project Finance":
                        valid_types = COMPANY_TYPES_V2["Originación > Project Finance"]
                    elif role == "Inversión":
                        valid_types = COMPANY_TYPES_V2["Inversión > Deuda"] + COMPANY_TYPES_V2["Inversión > Equity"]
                    elif role == "Ecosistema":
                        valid_types = COMPANY_TYPES_V2["Ecosistema"]
                    else:
                        valid_types = []
                    if comp_type and comp_type not in valid_types:
                        comp_type = ""

                    # Validate activities (only Corporate Finance)
                    if role == "Originación" and segment == "Corporate Finance":
                        activities = [a for a in activities if a in CORPORATE_ACTIVITIES]
                    else:
                        activities = []

                    # Validate multi-selects
                    technologies = [t for t in technologies if t in TECHNOLOGIES]
                    geography = [g for g in geography if g in GEOGRAPHIES]
                    valid_mr = [r for r in market_roles if r in MARKET_ROLES_LIST]

                    # Map to legacy fields
                    legacy_group = ROLE_TO_LEGACY_GROUP.get(role, "Other")
                    legacy_type = comp_type or "Other"

                    # Build enrichment with _tv:2
                    enrichment = {
                        "_tv": 2,
                        "role": role,
                        "seg": segment,
                        "tp2": comp_type,
                        "act": activities,
                        "tech": technologies,
                        "geo": geography,
                        "mr": valid_mr,
                        # Legacy fields for backward compat
                        "grp": legacy_group,
                        "tp": legacy_type,
                    }

                    # Optional enrichment fields
                    productos = entry.get("productos_potenciales", [])
                    if productos and isinstance(productos, list):
                        enrichment["pp"] = productos

                    senales = entry.get("senales_clave", [])
                    if senales and isinstance(senales, list):
                        enrichment["sc"] = senales

                    fase = entry.get("fase_comercial", "")
                    if fase and fase in COMMERCIAL_PHASES:
                        enrichment["fc"] = fase

                    results[domain] = {
                        "group": legacy_group,
                        "type": legacy_type,
                        "enrichment": enrichment,
                    }
                else:
                    results[domain] = dict(default)
        except Exception as e:
            print(f"  [warn] Gemini batch failed: {e}")
            for item in batch:
                results[item[0]] = dict(default)

        if batch_start + GEMINI_BATCH_SIZE < len(remaining):
            time.sleep(GEMINI_RPM_DELAY)

    return results


def classify_roles_with_gemini(contacts_to_classify):
    """Classify contact roles using Gemini with email context.

    Args:
        contacts_to_classify: list of tuples:
            - (name, email, domain)                              — 3-tuple (legacy)
            - (name, email, domain, [subjects], [bodies])        — 5-tuple (with context)

    Returns:
        dict of email -> role string
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key or not contacts_to_classify:
        return {}

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(GEMINI_MODEL)
    except Exception:
        return {}

    results = {}

    for batch_start in range(0, len(contacts_to_classify), GEMINI_BATCH_SIZE):
        batch = contacts_to_classify[batch_start:batch_start + GEMINI_BATCH_SIZE]

        lines = []
        for item in batch:
            name = item[0]
            email = item[1]
            domain = item[2]
            subjects = item[3] if len(item) > 3 else []
            bodies = item[4] if len(item) > 4 else []

            # Build context from email subjects and bodies
            context_parts = []
            if subjects:
                context_parts.append(f"emails sobre: {' | '.join(subjects[:5])}")
            if bodies:
                # Look for signature lines that reveal the role/title
                body_sample = bodies[0][:500] if bodies else ""
                context_parts.append(f"contenido: {body_sample}")

            context = f" — {'; '.join(context_parts)}" if context_parts else ""
            lines.append(f"- {name} <{email}> ({domain}){context}")

        prompt = f"""Eres un analista de Alter5, consultora de financiación de energías renovables.

Para cada contacto, estima su cargo/rol profesional. Usa las pistas disponibles:
1. Firma del email (si aparece en el contenido): cargo exacto
2. Asuntos de email: tipo de conversación indica seniority y departamento
3. Nombre del dominio: tipo de empresa
4. Nombre: patrones culturales de nombres ejecutivos

Cargos típicos en este sector: CEO, CFO, Director Financiero, Director de Desarrollo, Responsable de Financiación Estructurada, Head of M&A, Portfolio Manager, Investment Director, Fund Manager, Socio/Partner, Asociado, Abogado, Director General, Director Comercial, Head of Business Development, Tesorero.

Contactos:
{chr(10).join(lines)}

Responde SOLO con un JSON válido: {{"email": "cargo estimado"}}
Si no hay suficientes pistas para una estimación razonable, usa "No identificado"."""

        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1]
                if text.endswith("```"):
                    text = text.rsplit("```", 1)[0]
                text = text.strip()
            parsed = json.loads(text)
            results.update(parsed)
        except Exception as e:
            print(f"  [warn] Gemini role classification failed: {e}")

        if batch_start + GEMINI_BATCH_SIZE < len(contacts_to_classify):
            time.sleep(GEMINI_RPM_DELAY)

    return results


# ---------------------------------------------------------------------------
# Quarterly summary generation
# ---------------------------------------------------------------------------
def generate_quarterly_summaries(all_companies):
    """Generate short quarterly summaries for companies that have timeline+subjects but lack summaries.

    Calls Gemini to produce a JSON like {"Q1 2022": "short summary", ...} for each company.
    Modifies all_companies in place.
    Returns the number of companies updated.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  [warn] GEMINI_API_KEY not set — skipping quarterly summaries")
        return 0

    # Find companies needing summaries
    candidates = []
    for domain, co in all_companies.items():
        timeline = co.get("timeline", [])
        subjects = co.get("subjects", [])
        if not timeline or not subjects:
            continue
        # Check if any quarter lacks a summary
        missing = [t for t in timeline if not t.get("summary")]
        if missing:
            candidates.append((domain, co))

    if not candidates:
        print("  → No companies need quarterly summaries")
        return 0

    print(f"  → {len(candidates)} companies need quarterly summaries")

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(GEMINI_MODEL)
    except Exception as e:
        print(f"  [warn] Gemini init failed: {e} — skipping summaries")
        return 0

    updated = 0
    batch_size = 5  # fewer per batch since each company has more context

    for batch_start in range(0, len(candidates), batch_size):
        batch = candidates[batch_start:batch_start + batch_size]

        lines = []
        for i, (domain, co) in enumerate(batch):
            context = co.get("context", "")[:200]
            subjects = " | ".join(co.get("subjects", [])[:10])
            quarters = ", ".join(t["quarter"] for t in co.get("timeline", []) if not t.get("summary"))
            lines.append(f"{i}. {domain}: context=[{context}] subjects=[{subjects}] quarters_needed=[{quarters}]")

        prompt = f"""Eres un analista de Alter-5, consultora de financiación de proyectos de energía renovable.

Para cada empresa, genera un resumen corto (max 20 palabras) de la actividad en cada trimestre solicitado.
Basa el resumen en el contexto y los asuntos de email proporcionados.
Si no tienes info específica para un trimestre, genera un resumen genérico basado en el contexto general.

Empresas:
{chr(10).join(lines)}

Responde SOLO con un JSON válido, sin markdown. Formato:
{{"0": {{"Q1 2022": "resumen corto", "Q2 2022": "otro resumen"}}, "1": {{...}}}}
Los keys son los índices de cada empresa."""

        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1]
                if text.endswith("```"):
                    text = text.rsplit("```", 1)[0]
                text = text.strip()

            parsed = json.loads(text)
            for i, (domain, co) in enumerate(batch):
                summaries = parsed.get(str(i), {})
                if summaries:
                    for t in co.get("timeline", []):
                        if not t.get("summary") and t["quarter"] in summaries:
                            t["summary"] = summaries[t["quarter"]][:100]
                    updated += 1
        except Exception as e:
            print(f"  [warn] Gemini summary batch failed: {e}")

        if batch_start + batch_size < len(candidates):
            time.sleep(GEMINI_RPM_DELAY)

    return updated


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------
def group_emails_by_company(pending_emails):
    """Group pending emails by (employee_id, domain).

    Returns:
        dict of domain -> {
            "employees": {emp_id: {"interactions": int, "firstDate": str, "lastDate": str}},
            "contacts": {email: {"name": str, "email": str, "domain": str}},
            "subjects": [str],
        }
    """
    companies = defaultdict(lambda: {
        "employees": defaultdict(lambda: {
            "interactions": 0,
            "firstDate": "9999-12-31",
            "lastDate": "0000-01-01",
        }),
        "contacts": {},
        "subjects": [],
        "dated_subjects": [],
        "snippets": [],
        "bodies": [],          # NEW: full email body texts for richer classification
        "contact_subjects": defaultdict(list),  # NEW: subjects per contact email for role inference
    })

    for row in pending_emails:
        domain = str(row.get("from_domain", "")).strip().lower()
        if not domain or domain in PERSONAL_DOMAINS:
            continue

        emp_id = str(row.get("employee_id", "")).strip()
        thread_date = str(row.get("thread_date", ""))[:10]
        from_email = str(row.get("from_email", "")).strip()
        from_name = str(row.get("from_name", "")).strip()
        subject = str(row.get("subject", "")).strip()
        snippet = str(row.get("body_snippet", "")).strip()

        co = companies[domain]

        # Update employee stats
        emp = co["employees"][emp_id]
        emp["interactions"] += 1
        if thread_date and thread_date < emp["firstDate"]:
            emp["firstDate"] = thread_date
        if thread_date and thread_date > emp["lastDate"]:
            emp["lastDate"] = thread_date

        # Track contacts
        if from_email and from_email not in co["contacts"]:
            co["contacts"][from_email] = {
                "name": from_name or from_email.split("@")[0],
                "email": from_email,
                "domain": domain,
            }

        # Track subjects for classification and product matching
        if subject and len(co["subjects"]) < 20:
            co["subjects"].append(subject)

        # Track dated subjects (date + subject + extract) for chronological context
        if subject and thread_date and len(co["dated_subjects"]) < 30:
            co["dated_subjects"].append([thread_date, subject, snippet[:200] if snippet and snippet != "nan" else ""])

        # Track body snippets for enriched context
        if snippet and snippet != "nan" and len(co["snippets"]) < 10:
            co["snippets"].append(snippet[:200])

        # Track full body text for richer AI classification (new column from GAS)
        body_text = str(row.get("body_text", "")).strip()
        if body_text and body_text != "nan" and len(co["bodies"]) < 10:
            co["bodies"].append(body_text[:1000])

        # Track subjects per contact for role inference
        if from_email and subject:
            if len(co["contact_subjects"][from_email]) < 5:
                co["contact_subjects"][from_email].append(subject)

    return dict(companies)


def process_pipeline(reprocess=False):
    """Main pipeline entry point.

    Args:
        reprocess: If True, re-read 'done' rows from the Sheet and merge them
                   into existing data. Useful for backfilling after a fix.
    """
    print("=" * 60)
    print("  Alter5 BI — Pipeline automático Gmail → Dashboard")
    if reprocess:
        print("  ⚡ MODO REPROCESS: re-leyendo emails ya procesados")
    print("=" * 60)
    print()

    paths = get_data_paths(PROJECT_DIR)

    # 1. Connect to Google Sheet
    print("  [1/7] Conectando con Google Sheet...")
    gc = get_gspread_client()
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        raise RuntimeError("GOOGLE_SHEET_ID env var not set")
    sheet = gc.open_by_key(sheet_id)

    # 2. Read pending emails (or done+pending if reprocessing)
    label = "pendientes + procesados" if reprocess else "pendientes"
    print(f"  [2/7] Leyendo emails {label}...")
    ws, pending = read_pending_emails(sheet, reprocess=reprocess)
    if not pending:
        print(f"  → No hay emails {label}. Nada que hacer.")
        return False

    print(f"  → {len(pending)} emails encontrados")

    # 2b. Filter relevant emails with AI (skip for reprocess — already filtered)
    if reprocess:
        print("  [2b/7] Saltando filtro IA (reprocess: ya fueron filtrados)")
        relevant = pending
        ignored = []
    else:
        print("  [2b/7] Filtrando emails relevantes con IA...")
        relevant, ignored = filter_relevant_emails(pending)
        print(f"  → {len(relevant)} relevantes, {len(ignored)} ignorados")

    if ignored:
        ignored_rows = [row["_sheet_row"] for row in ignored]
        mark_rows_ignored(ws, ignored_rows)

    if not relevant:
        print("  → Ningún email relevante. Nada que hacer.")
        return False

    pending = relevant

    # 3. Group by company domain
    print("  [3/7] Agrupando por empresa...")
    grouped = group_emails_by_company(pending)
    print(f"  → {len(grouped)} dominios únicos")

    # 4. Load existing data
    print("  [4/7] Cargando datos existentes...")
    full_path = paths["full"]
    if os.path.exists(full_path):
        with open(full_path, "r", encoding="utf-8") as f:
            existing_data = json.load(f)
    else:
        existing_data = {"companies": {}, "employees": []}

    all_companies = existing_data.get("companies", {})
    employees = existing_data.get("employees", [])
    print(f"  → {len(all_companies)} empresas existentes")

    # Load blocklist to skip blocked domains
    blocklist_path = os.path.join(PROJECT_DIR, "src", "data", "blocklist.json")
    blocked_domains = set()
    if os.path.exists(blocklist_path):
        with open(blocklist_path, "r", encoding="utf-8") as f:
            blocked_domains = set(json.load(f).get("domains", []))
        if blocked_domains:
            print(f"  → {len(blocked_domains)} dominios en blocklist")

    # 5. Classify NEW domains + RE-CLASSIFY existing domains that need it
    print("  [5/7] Clasificando empresas con IA...")

    new_domains = []
    reclassify_domains = []

    for d in grouped:
        if d in blocked_domains:
            continue
        if d not in all_companies:
            # New domain — classify from scratch
            new_domains.append(
                (d, grouped[d]["subjects"], grouped[d]["snippets"],
                 d.split(".")[0].title(), grouped[d].get("bodies", []))
            )
        else:
            # Existing domain — check if re-classification needed
            existing = all_companies[d]
            enrichment = existing.get("enrichment") or {}
            needs_reclassify = False

            # Case 1: No enrichment at all (pre-enrichment imports)
            if not enrichment or enrichment.get("_tv") != 2:
                needs_reclassify = True

            # Case 2: Classified as "No relevante" or "Other" but receiving new emails
            elif enrichment.get("role") == "No relevante" or enrichment.get("grp") == "Other":
                needs_reclassify = True

            # Case 3: Significantly more emails since last classification
            elif enrichment.get("_email_count", 0) > 0:
                current_interactions = existing.get("interactions", 0)
                prev_count = enrichment.get("_email_count", 0)
                if current_interactions >= prev_count * 2 and current_interactions - prev_count >= 5:
                    needs_reclassify = True

            if needs_reclassify:
                # Use ALL available data (existing + new) for re-classification
                all_subjects = existing.get("subjects", []) + grouped[d]["subjects"]
                all_snippets = existing.get("snippets", []) + grouped[d]["snippets"]
                all_bodies = grouped[d].get("bodies", [])
                name = existing.get("name", d.split(".")[0].title())
                reclassify_domains.append(
                    (d, all_subjects[:20], all_snippets[:15], name, all_bodies)
                )

    classifications = {}

    # Pre-load verified companies once for both classification passes
    verified_overrides = load_verified_companies() if (new_domains or reclassify_domains) else {}

    if new_domains:
        print(f"  → {len(new_domains)} dominios nuevos a clasificar")
        new_cls = classify_domains_with_gemini(new_domains, verified=verified_overrides)
        classifications.update(new_cls)
        log_classifications_batch(sheet, new_cls, "gemini-2.5-flash-new")

    if reclassify_domains:
        print(f"  → {len(reclassify_domains)} dominios existentes a re-clasificar")
        recls = classify_domains_with_gemini(reclassify_domains, verified=verified_overrides)
        classifications.update(recls)
        log_classifications_batch(sheet, recls, "gemini-2.5-flash-reclassify")

    if not new_domains and not reclassify_domains:
        print("  → No hay dominios que clasificar")

    # Classify roles for new contacts (with email context for better accuracy)
    all_new_contacts = []
    for domain, data in grouped.items():
        if domain in blocked_domains:
            continue
        contact_subjects = data.get("contact_subjects", {})
        bodies = data.get("bodies", [])
        for email, contact in data["contacts"].items():
            subjs = contact_subjects.get(email, [])
            # Pass the first body where this contact appears (for signature detection)
            contact_bodies = bodies[:2] if bodies else []
            all_new_contacts.append((contact["name"], email, domain, subjs, contact_bodies))

    role_map = {}
    if all_new_contacts:
        print(f"  → Clasificando roles de {len(all_new_contacts)} contactos...")
        role_map = classify_roles_with_gemini(all_new_contacts)

    # 6. Merge into existing data
    print("  [6/7] Fusionando datos...")
    new_count = 0
    updated_count = 0

    for domain, data in grouped.items():
        if domain in blocked_domains:
            continue
        # Build per-employee company records and merge each one
        for emp_id, emp_stats in data["employees"].items():
            contacts_list = []
            for email, contact in data["contacts"].items():
                role = role_map.get(email, "No identificado")
                contacts_list.append({
                    "name": contact["name"],
                    "email": email,
                    "role": role,
                })

            # Build company data for this employee
            cls = classifications.get(domain, {})
            subjects = data.get("subjects", [])
            snippets = data.get("snippets", [])

            new_company_data = {
                "name": domain.split(".")[0].title(),  # fallback name from domain
                "domain": domain,
                "sectors": "",  # legacy field, kept for compat
                "nContacts": len(contacts_list),
                "interactions": emp_stats["interactions"],
                "relType": "",  # legacy field, kept for compat
                "firstDate": emp_stats["firstDate"] if emp_stats["firstDate"] != "9999-12-31" else "",
                "lastDate": emp_stats["lastDate"] if emp_stats["lastDate"] != "0000-01-01" else "",
                "context": f"Emails sobre: {', '.join(subjects[:3])}"[:150],
                "contacts": contacts_list[:5],
                "timeline": [],  # Will be calculated by merge
                "subjects": subjects[:20],
                "dated_subjects": sorted(data.get("dated_subjects", []), key=lambda x: x[0])[:30],
                "snippets": snippets[:10],
            }

            # Preserve existing name if company already exists
            if domain in all_companies:
                new_company_data["name"] = all_companies[domain].get("name", new_company_data["name"])

            is_new = domain not in all_companies
            all_companies[domain] = merge_company(
                all_companies.get(domain),
                new_company_data,
                emp_id,
            )

            # Assign enrichment: for NEW companies always, for existing if re-classified
            if is_new or domain in classifications:
                enr = cls.get("enrichment")
                if enr:
                    # Add classification metadata for tracking re-classification triggers
                    enr["_classified_at"] = datetime.utcnow().isoformat()
                    enr["_email_count"] = all_companies[domain].get("interactions", 0)
                    all_companies[domain]["enrichment"] = enr

            if is_new:
                new_count += 1
                # Only count once per domain
                break
        else:
            updated_count += 1

    # Update employees registry
    emp_ids = {e["id"] for e in employees}
    for domain, data in grouped.items():
        for emp_id in data["employees"]:
            if emp_id not in emp_ids:
                employees.append({
                    "id": emp_id,
                    "name": emp_id.replace("_", " ").title(),
                    "importedAt": datetime.now().isoformat(),
                    "companiesCount": 0,
                })
                emp_ids.add(emp_id)

    # Recount companies per employee
    emp_company_count = defaultdict(int)
    for co in all_companies.values():
        for emp_id in co.get("sources", {}):
            emp_company_count[emp_id] += 1
    for e in employees:
        if e["id"] in emp_company_count:
            e["companiesCount"] = emp_company_count[e["id"]]

    print(f"  → {new_count} empresas nuevas, {updated_count} actualizadas")

    # 6b. Generate quarterly summaries for companies missing them
    print("  [6b/7] Generando resumenes trimestrales...")
    summary_count = generate_quarterly_summaries(all_companies)
    if summary_count:
        print(f"  → {summary_count} empresas con nuevos resumenes trimestrales")

    # 7. Write output files
    print("  [7/7] Escribiendo archivos JSON...")

    full_data = {"companies": all_companies, "employees": employees}
    with open(paths["full"], "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)

    compact = export_to_compact(all_companies)
    with open(paths["compact"], "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

    with open(paths["employees"], "w", encoding="utf-8") as f:
        json.dump(employees, f, ensure_ascii=False, indent=2)

    # Mark rows as done in the sheet (skip for reprocess — already done)
    if not reprocess:
        print("  → Marcando emails como procesados en la Sheet...")
        row_indices = [row["_sheet_row"] for row in pending]
        mark_rows_done(ws, row_indices)
    else:
        print("  → Reprocess: emails ya estaban marcados como done")

    print()
    print(f"  OK: {len(all_companies)} empresas totales en el dashboard")
    print(f"  OK: {new_count} nuevas + {updated_count} actualizadas")
    print()

    return True


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    reprocess = "--reprocess" in sys.argv
    had_changes = process_pipeline(reprocess=reprocess)
    sys.exit(0 if had_changes else 0)
