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
import sys
import time
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

PERSONAL_DOMAINS = {
    "gmail.com", "hotmail.com", "yahoo.com", "outlook.com",
    "live.com", "icloud.com", "yahoo.es", "hotmail.es",
    "googlemail.com", "protonmail.com", "me.com", "msn.com",
}

GEMINI_BATCH_SIZE = 10
GEMINI_RPM_DELAY = 4.5  # seconds between calls to stay under 15 req/min


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


def read_pending_emails(sheet):
    """Read rows with status 'pending' from raw_emails tab."""
    ws = sheet.worksheet("raw_emails")
    records = ws.get_all_records()

    pending = []
    for i, row in enumerate(records):
        if str(row.get("processed", "")).strip().lower() == "pending":
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
        model = genai.GenerativeModel("gemini-2.0-flash")
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
            snippet = str(row.get("body_snippet", ""))[:150]
            lines.append(f"{i}: from={from_email} | subject={subject} | snippet={snippet}")

        prompt = f"""Eres un filtro de emails para Alter-5, una empresa de consultoría tecnológica y soluciones digitales.

Analiza estos emails y decide cuáles son RELEVANTES para el negocio (oportunidades comerciales, comunicación con clientes, partners, proveedores, contactos profesionales, propuestas, reuniones de negocio) y cuáles NO son relevantes (newsletters, notificaciones automáticas de herramientas/apps, marketing masivo, facturas/recibos, spam, suscripciones, alertas de sistemas, emails personales no profesionales).

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


def classify_domains_with_gemini(domains_with_context):
    """Classify a list of domains into group + type + enrichment using Gemini.

    Args:
        domains_with_context: list of (domain, [subjects], [snippets]) tuples

    Returns:
        dict of domain -> {"group": str, "type": str, "enrichment": {"grp","tp","ds","mr"} | None}
    """
    default = {"group": "Other", "type": "Other", "enrichment": None}
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  [warn] GEMINI_API_KEY not set — using defaults")
        return {d: dict(default) for d, _, _ in domains_with_context}

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
    except Exception as e:
        print(f"  [warn] Gemini init failed: {e} — using defaults")
        return {d: dict(default) for d, _, _ in domains_with_context}

    results = {}

    # Build type descriptions for prompt
    type_lines = []
    for grp, types in COMPANY_TYPES.items():
        type_lines.append(f"  {grp}: [{', '.join(types)}]")
    types_block = "\n".join(type_lines)

    # Process in batches
    for batch_start in range(0, len(domains_with_context), GEMINI_BATCH_SIZE):
        batch = domains_with_context[batch_start:batch_start + GEMINI_BATCH_SIZE]

        lines = []
        for domain, subjects, snippets in batch:
            subj_text = " | ".join(subjects[:5])
            snip_text = " // ".join(snippets[:3])[:300]
            lines.append(f"- {domain}: subjects=[{subj_text}] snippets=[{snip_text}]")

        prompt = f"""Eres un analista de Alter-5, empresa de consultoría especializada en financiación de proyectos de energía renovable.

Clasifica estas empresas por su dominio web, los asuntos de email y los fragmentos de conversación.

Para cada empresa determina:
1. group (grupo de empresa): una de [{", ".join(COMPANY_GROUPS)}]
   - Capital Seeker: empresas que buscan financiación (developers, IPPs, utilities, asset owners)
   - Investor: proveedores de capital (bancos, fondos, family offices, institucionales)
   - Services: asesores, consultores, EPC, legal, técnicos
   - Other: asociaciones, instituciones públicas, no clasificados
2. type (tipo de empresa, según el grupo):
{types_block}
3. deal_stage (solo si group es "Capital Seeker"): una de [{", ".join(DEAL_STAGES)}]
   Si NO es Capital Seeker, dejar como null.
4. market_roles (roles de mercado, puede ser MÁS DE UNO): subconjunto de [{", ".join(MARKET_ROLES_LIST)}]

Empresas:
{chr(10).join(lines)}

Responde SOLO con un JSON válido, sin markdown ni explicaciones. Formato exacto:
{{"dominio1.com": {{"group": "...", "type": "...", "deal_stage": "..." o null, "market_roles": ["..."]}}, "dominio2.com": {{...}}}}"""

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
            for domain, _, _ in batch:
                if domain in parsed:
                    entry = parsed[domain]
                    group = entry.get("group", "Other")
                    comp_type = entry.get("type", "Other")
                    deal_stage = entry.get("deal_stage")
                    market_roles = entry.get("market_roles", [])

                    # Validate group
                    if group not in COMPANY_GROUPS:
                        group = "Other"

                    # Validate type belongs to group
                    valid_types = COMPANY_TYPES.get(group, [])
                    if comp_type not in valid_types:
                        comp_type = valid_types[-1] if valid_types else "Other"

                    # Validate deal stage (only for Capital Seekers)
                    if group != "Capital Seeker":
                        deal_stage = None
                    elif deal_stage and deal_stage not in DEAL_STAGES:
                        deal_stage = "Prospect"

                    # Validate market roles
                    valid_mr = [r for r in market_roles if r in MARKET_ROLES_LIST]

                    enrichment = {
                        "grp": group,
                        "tp": comp_type,
                        "mr": valid_mr if valid_mr else [],
                    }
                    if deal_stage:
                        enrichment["ds"] = deal_stage

                    results[domain] = {
                        "group": group,
                        "type": comp_type,
                        "enrichment": enrichment,
                    }
                else:
                    results[domain] = dict(default)
        except Exception as e:
            print(f"  [warn] Gemini batch failed: {e}")
            for domain, _, _ in batch:
                results[domain] = dict(default)

        if batch_start + GEMINI_BATCH_SIZE < len(domains_with_context):
            time.sleep(GEMINI_RPM_DELAY)

    return results


def classify_roles_with_gemini(contacts_to_classify):
    """Classify contact roles using Gemini.

    Args:
        contacts_to_classify: list of (name, email, domain) tuples

    Returns:
        dict of email -> role string
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key or not contacts_to_classify:
        return {}

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
    except Exception:
        return {}

    results = {}

    for batch_start in range(0, len(contacts_to_classify), GEMINI_BATCH_SIZE):
        batch = contacts_to_classify[batch_start:batch_start + GEMINI_BATCH_SIZE]

        lines = []
        for name, email, domain in batch:
            lines.append(f"- {name} <{email}> ({domain})")

        prompt = f"""Para cada contacto, estima su cargo/rol profesional basándote en su nombre y email.

Contactos:
{chr(10).join(lines)}

Responde SOLO con un JSON válido: {{"email": "cargo estimado"}}
Si no puedes estimar el cargo, usa "No identificado"."""

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
        model = genai.GenerativeModel("gemini-2.0-flash")
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
        "snippets": [],
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

        # Track body snippets for enriched context
        if snippet and snippet != "nan" and len(co["snippets"]) < 10:
            co["snippets"].append(snippet[:200])

    return dict(companies)


def process_pipeline():
    """Main pipeline entry point."""
    print("=" * 60)
    print("  Alter5 BI — Pipeline automático Gmail → Dashboard")
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

    # 2. Read pending emails
    print("  [2/7] Leyendo emails pendientes...")
    ws, pending = read_pending_emails(sheet)
    if not pending:
        print("  → No hay emails pendientes. Nada que hacer.")
        return False

    print(f"  → {len(pending)} emails pendientes encontrados")

    # 2b. Filter relevant emails with AI
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

    # 5. Classify NEW domains with Gemini
    print("  [5/7] Clasificando empresas nuevas con IA...")
    new_domains = [
        (d, grouped[d]["subjects"], grouped[d]["snippets"])
        for d in grouped if d not in all_companies
    ]
    if new_domains:
        print(f"  → {len(new_domains)} dominios nuevos a clasificar")
        classifications = classify_domains_with_gemini(new_domains)
        log_classifications_batch(sheet, classifications, "gemini-2.0-flash")
    else:
        print("  → No hay dominios nuevos (solo actualizaciones)")
        classifications = {}

    # Classify roles for new contacts
    all_new_contacts = []
    for domain, data in grouped.items():
        for email, contact in data["contacts"].items():
            all_new_contacts.append((contact["name"], email, domain))

    role_map = {}
    if all_new_contacts:
        print(f"  → Clasificando roles de {len(all_new_contacts)} contactos...")
        role_map = classify_roles_with_gemini(all_new_contacts)

    # 6. Merge into existing data
    print("  [6/7] Fusionando datos...")
    new_count = 0
    updated_count = 0

    for domain, data in grouped.items():
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

            # Assign enrichment for NEW companies only (don't overwrite existing)
            if is_new:
                enr = cls.get("enrichment")
                if enr:
                    all_companies[domain]["enrichment"] = enr
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

    # Mark rows as done in the sheet
    print("  → Marcando emails como procesados en la Sheet...")
    row_indices = [row["_sheet_row"] for row in pending]
    mark_rows_done(ws, row_indices)

    print()
    print(f"  OK: {len(all_companies)} empresas totales en el dashboard")
    print(f"  OK: {new_count} nuevas + {updated_count} actualizadas")
    print()

    return True


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    had_changes = process_pipeline()
    sys.exit(0 if had_changes else 0)
