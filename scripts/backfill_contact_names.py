"""
===============================================================
  Alter5 BI — Backfill: Split contact names into nombre/apellido
===============================================================

  Classifies contacts into categories and resolves names:
  - GOOD (has space): deterministic split → nombre + apellido
  - PARSEABLE (first.last): regex parse → nombre + apellido
  - ALIAS (jrf, ggalindo): Gemini inference
  - FIRST_ONLY (solo nombre): Gemini inference
  - SYSTEM (jira, noreply): mark _system=True

  Usage:
    export GEMINI_API_KEY="AIza..."
    python scripts/backfill_contact_names.py --stats           # just show stats
    python scripts/backfill_contact_names.py --dry-run         # preview changes
    python scripts/backfill_contact_names.py --top 50          # test with 50 companies
    python scripts/backfill_contact_names.py --domain X        # single company
    python scripts/backfill_contact_names.py                   # full backfill

  Estimated: ~80 Gemini calls for ~1,587 contacts ≈ 6 min
===============================================================
"""

import json
import os
import re
import sys
import time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from import_mailbox import export_to_compact, get_data_paths

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
GEMINI_BATCH_SIZE = 20  # contacts per Gemini call
GEMINI_RPM_DELAY = float(os.environ.get("GEMINI_RPM_DELAY", "4.5"))
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# System/functional accounts — aliases that are never real people
SYSTEM_PATTERNS = re.compile(
    r"^(jira|noreply|no-reply|no\.reply|info|admin|support|helpdesk|help|"
    r"contacto|contact|hola|hello|hi|office|billing|invoices?|factura|"
    r"rrhh|hr|comunicacion|comunicaciones|marketing|ventas|sales|"
    r"notificaciones?|notifications?|alertas?|alerts?|sistema|system|"
    r"webmaster|postmaster|mailer-daemon|bounce|unsubscribe|"
    r"suscripciones|newsletter|press|prensa|legal|compliance|"
    r"reception|recepcion|general|equipo|team|"
    r"contabilidad|accounting|finanzas|finance|tesoreria|treasury|"
    r"it|itsupport|soporte|servicedesk|registro|register|"
    r"alter5|alter5-sd|acoboo)$",
    re.IGNORECASE,
)

# Regex for parseable patterns: first.last, first_last, first-last
PARSEABLE_RE = re.compile(r"^([a-záéíóúñü]+)[._-]([a-záéíóúñü]+)$", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------
def classify_contact(name, email):
    """Classify a contact into GOOD/PARSEABLE/ALIAS/FIRST_ONLY/SYSTEM."""
    if not name:
        return "ALIAS"

    local = email.split("@")[0] if email else ""

    # System accounts
    if SYSTEM_PATTERNS.match(local) or SYSTEM_PATTERNS.match(name):
        return "SYSTEM"

    # Already has nombre+apellido
    if " " in name.strip() and len(name.strip().split()) >= 2:
        # Check it's not just an alias with a dot converted to space
        parts = name.strip().split()
        if all(len(p) > 1 for p in parts):
            return "GOOD"

    # Check if the name itself is parseable (first.last format)
    m = PARSEABLE_RE.match(name)
    if m:
        return "PARSEABLE"

    # Check email local part for parseable pattern
    if local:
        m = PARSEABLE_RE.match(local)
        if m and len(m.group(1)) > 1 and len(m.group(2)) > 1:
            return "PARSEABLE"

    # Single word name that looks like a real first name (capitalized, 3+ chars)
    if name[0].isupper() and len(name) >= 3 and name.isalpha():
        return "FIRST_ONLY"

    return "ALIAS"


def parse_deterministic(name, email, category):
    """Parse nombre/apellido for GOOD and PARSEABLE contacts."""
    if category == "GOOD":
        parts = name.strip().split()
        nombre = parts[0]
        apellido = " ".join(parts[1:])
        return nombre, apellido

    if category == "PARSEABLE":
        # Try name first
        m = PARSEABLE_RE.match(name)
        if m:
            return m.group(1).title(), m.group(2).title()
        # Then email local part
        local = email.split("@")[0] if email else ""
        m = PARSEABLE_RE.match(local)
        if m:
            return m.group(1).title(), m.group(2).title()

    return "", ""


# ---------------------------------------------------------------------------
# Gemini batch inference
# ---------------------------------------------------------------------------
def resolve_names_with_gemini(contacts_batch):
    """Use Gemini to infer real names from aliases.

    Args:
        contacts_batch: list of dicts with keys:
            name, email, domain, company_name, enrichment_role

    Returns:
        dict of email -> {nombre, apellido, confianza}
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key or not contacts_batch:
        return {}

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(GEMINI_MODEL)
    except Exception as e:
        print(f"  [warn] Gemini init failed: {e}")
        return {}

    results = {}
    total_batches = (len(contacts_batch) + GEMINI_BATCH_SIZE - 1) // GEMINI_BATCH_SIZE

    for batch_start in range(0, len(contacts_batch), GEMINI_BATCH_SIZE):
        batch = contacts_batch[batch_start:batch_start + GEMINI_BATCH_SIZE]
        batch_num = batch_start // GEMINI_BATCH_SIZE + 1

        if batch_num % 5 == 1 or batch_num == total_batches:
            print(f"  [names] batch {batch_num}/{total_batches} ({batch_start + len(batch)}/{len(contacts_batch)} contactos)")

        lines = []
        for ct in batch:
            company_ctx = f" | empresa: {ct['company_name']}" if ct.get("company_name") else ""
            role_ctx = f" | sector: {ct['enrichment_role']}" if ct.get("enrichment_role") else ""
            lines.append(f"- {ct['name']} <{ct['email']}>{company_ctx}{role_ctx}")

        prompt = f"""Eres un analista que necesita identificar nombres reales de personas a partir de sus alias de email.

Para cada contacto, infiere el nombre y apellido reales usando estas pistas:
1. El alias de email (ej: "afmontells" → probablemente "Antonio Fernández Montells" o "Alejandro F. Montells")
2. El dominio de la empresa (da contexto cultural: .es español, .de alemán, .it italiano)
3. El nombre de la empresa y sector (ayuda a desambiguar)
4. Patrones comunes: primera letra = inicial del nombre, resto = apellido (ej: "jgarcia" → "J. García")

Reglas:
- Si puedes inferir el nombre completo con razonable certeza → confianza "alta"
- Si solo puedes hacer una estimación educada → confianza "media"
- Si es imposible de determinar (ej: "xyz123") → confianza "baja", deja nombre/apellido vacíos
- Para nombres solo (sin apellido), intenta inferir el apellido del email si es posible
- Capitaliza correctamente (ej: "garcía" → "García")
- Mantén acentos y caracteres especiales correctos para nombres españoles

Contactos:
{chr(10).join(lines)}

Responde SOLO con JSON válido, un objeto donde cada clave es el email:
{{"email@ejemplo.com": {{"nombre": "Juan", "apellido": "García López", "confianza": "alta"}}}}

Si un contacto tiene confianza "baja", devuelve nombre="" y apellido=""."""

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
            print(f"  [warn] Gemini name resolution failed for batch {batch_num}: {e}")

        if batch_start + GEMINI_BATCH_SIZE < len(contacts_batch):
            time.sleep(GEMINI_RPM_DELAY)

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def load_companies():
    paths = get_data_paths(PROJECT_DIR)
    full_path = paths["full"]
    if not os.path.exists(full_path):
        print(f"  [error] {full_path} not found")
        sys.exit(1)
    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data, paths


def save_companies(data, paths):
    with open(paths["full"], "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    compact = export_to_compact(data["companies"])
    with open(paths["compact"], "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

    print(f"  OK: Written {paths['full']}")
    print(f"  OK: Written {paths['compact']}")


def main():
    args = sys.argv[1:]
    stats_only = False
    dry_run = False
    top_n = None
    target_domain = None

    i = 0
    while i < len(args):
        if args[i] == "--stats":
            stats_only = True
            i += 1
        elif args[i] == "--dry-run":
            dry_run = True
            i += 1
        elif args[i] == "--top" and i + 1 < len(args):
            top_n = int(args[i + 1])
            i += 2
        elif args[i] == "--domain" and i + 1 < len(args):
            target_domain = args[i + 1]
            i += 2
        else:
            i += 1

    print("=" * 60)
    print("  Alter5 BI — Backfill: Nombre/Apellido de contactos")
    print("=" * 60)
    print()

    # Load data
    print("  [1/4] Cargando datos...")
    data, paths = load_companies()
    all_companies = data.get("companies", {})
    print(f"  → {len(all_companies)} empresas")

    # Classify all contacts
    print("  [2/4] Clasificando contactos...")
    categories = {"GOOD": [], "PARSEABLE": [], "ALIAS": [], "FIRST_ONLY": [], "SYSTEM": []}
    already_done = 0

    companies_to_process = {}
    if target_domain:
        if target_domain in all_companies:
            companies_to_process = {target_domain: all_companies[target_domain]}
        else:
            print(f"  [error] Domain {target_domain} not found")
            sys.exit(1)
    else:
        companies_to_process = all_companies

    for domain, co in companies_to_process.items():
        contacts = co.get("contacts", [])
        if isinstance(contacts, dict):
            contacts = list(contacts.values())
        for ct in contacts:
            # Skip already processed
            if ct.get("nombre") and ct.get("apellido"):
                already_done += 1
                continue

            name = ct.get("name", "")
            email = ct.get("email", "")
            cat = classify_contact(name, email)
            enrichment_role = (co.get("enrichment") or {}).get("role", "")
            categories[cat].append({
                "name": name,
                "email": email,
                "domain": domain,
                "company_name": co.get("name", ""),
                "enrichment_role": enrichment_role,
                "contact_ref": ct,  # direct reference for in-place update
            })

    total = sum(len(v) for v in categories.values())
    print(f"  → {total} contactos a procesar ({already_done} ya tienen nombre/apellido)")
    print()
    print(f"  Categorías:")
    print(f"    GOOD       {len(categories['GOOD']):5d}  (nombre completo → split determinístico)")
    print(f"    PARSEABLE  {len(categories['PARSEABLE']):5d}  (first.last → parse regex)")
    print(f"    ALIAS      {len(categories['ALIAS']):5d}  (abreviaturas → Gemini)")
    print(f"    FIRST_ONLY {len(categories['FIRST_ONLY']):5d}  (solo nombre → Gemini)")
    print(f"    SYSTEM     {len(categories['SYSTEM']):5d}  (cuentas funcionales → marcar)")
    print()

    gemini_count = len(categories["ALIAS"]) + len(categories["FIRST_ONLY"])
    est_calls = (gemini_count + GEMINI_BATCH_SIZE - 1) // GEMINI_BATCH_SIZE if gemini_count > 0 else 0
    est_time = est_calls * GEMINI_RPM_DELAY / 60
    print(f"  Llamadas Gemini estimadas: ~{est_calls}")
    print(f"  Tiempo estimado: ~{est_time:.1f} minutos")

    if stats_only:
        # Show sample of each category
        for cat_name, items in categories.items():
            if items:
                print(f"\n  Ejemplo {cat_name} (primeros 5):")
                for item in items[:5]:
                    print(f"    {item['name']:30s} <{item['email']}> ({item['domain']})")
        return

    if dry_run and not target_domain:
        # Show what would change
        print("\n  [DRY RUN] Ejemplo de cambios:")
        for item in categories["GOOD"][:5]:
            n, a = parse_deterministic(item["name"], item["email"], "GOOD")
            print(f"    GOOD:      {item['name']:30s} → nombre={n}, apellido={a}")
        for item in categories["PARSEABLE"][:5]:
            n, a = parse_deterministic(item["name"], item["email"], "PARSEABLE")
            print(f"    PARSEABLE: {item['name']:30s} → nombre={n}, apellido={a}")
        for item in categories["ALIAS"][:5]:
            print(f"    ALIAS:     {item['name']:30s} <{item['email']}> → Gemini")
        for item in categories["FIRST_ONLY"][:5]:
            print(f"    FIRST_ONLY:{item['name']:30s} <{item['email']}> → Gemini")
        for item in categories["SYSTEM"][:5]:
            print(f"    SYSTEM:    {item['name']:30s} <{item['email']}> → _system=True")
        return

    # Apply top_n limit (to total Gemini contacts)
    gemini_contacts = categories["ALIAS"] + categories["FIRST_ONLY"]
    if top_n and len(gemini_contacts) > top_n:
        gemini_contacts = gemini_contacts[:top_n]
        print(f"  → Limitado a {top_n} contactos para Gemini")

    # Step 3a: Deterministic parse (GOOD + PARSEABLE)
    print("  [3/4] Parseando nombres determinísticamente...")
    det_count = 0
    for cat_name in ("GOOD", "PARSEABLE"):
        for item in categories[cat_name]:
            nombre, apellido = parse_deterministic(item["name"], item["email"], cat_name)
            if nombre:
                ct = item["contact_ref"]
                ct["nombre"] = nombre
                ct["apellido"] = apellido
                # Update display name for PARSEABLE (was alias before)
                if cat_name == "PARSEABLE":
                    ct["name"] = f"{nombre} {apellido}".strip()
                det_count += 1

    print(f"  → {det_count} contactos parseados determinísticamente")

    # Step 3b: Mark SYSTEM contacts
    sys_count = 0
    for item in categories["SYSTEM"]:
        ct = item["contact_ref"]
        ct["_system"] = True
        sys_count += 1
    print(f"  → {sys_count} contactos marcados como _system")

    # Step 3c: Gemini for ALIAS + FIRST_ONLY
    if gemini_contacts:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            print("  [warn] GEMINI_API_KEY not set — skipping Gemini resolution")
        else:
            print(f"  [3b/4] Resolviendo {len(gemini_contacts)} nombres con Gemini...")
            gemini_results = resolve_names_with_gemini(gemini_contacts)

            applied = 0
            skipped_low = 0
            for item in gemini_contacts:
                email = item["email"]
                if email in gemini_results:
                    result = gemini_results[email]
                    confianza = result.get("confianza", "baja")
                    if confianza in ("alta", "media") and result.get("nombre"):
                        ct = item["contact_ref"]
                        ct["nombre"] = result["nombre"]
                        ct["apellido"] = result.get("apellido", "")
                        ct["name"] = f"{result['nombre']} {result.get('apellido', '')}".strip()
                        ct["_name_source"] = "gemini"
                        ct["_name_confidence"] = confianza
                        applied += 1
                    else:
                        skipped_low += 1

            print(f"  → {applied} nombres resueltos por Gemini")
            if skipped_low:
                print(f"  → {skipped_low} omitidos (confianza baja)")

    # Save
    if dry_run:
        print("\n  [DRY RUN] No se guardan cambios")
        return

    print("  [4/4] Guardando resultados...")
    data["companies"] = all_companies
    save_companies(data, paths)

    # Summary
    total_with_nombre = 0
    total_contacts = 0
    total_system = 0
    for co in all_companies.values():
        contacts = co.get("contacts", [])
        if isinstance(contacts, dict):
            contacts = list(contacts.values())
        for ct in contacts:
            total_contacts += 1
            if ct.get("nombre"):
                total_with_nombre += 1
            if ct.get("_system"):
                total_system += 1

    print()
    print(f"  BACKFILL COMPLETADO")
    print(f"  → {total_with_nombre}/{total_contacts} contactos con nombre/apellido ({total_with_nombre*100//total_contacts}%)")
    print(f"  → {total_system} contactos marcados como sistema")
    print()


if __name__ == "__main__":
    main()
