"""
Migrate companies_full.json from v1 taxonomy to v2 taxonomy.

Deterministic mapping for known types, flags unknowns for re-enrichment.

Usage:
    python scripts/migrate_taxonomy_v2.py              # migrate all
    python scripts/migrate_taxonomy_v2.py --dry-run    # preview only
    python scripts/migrate_taxonomy_v2.py --reenrich   # re-classify "Other" types via Gemini
"""

import json
import os
import sys
import time
from collections import Counter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import export_to_compact, get_data_paths

# ── Deterministic v1 → v2 mapping ──────────────────────────────────

# (legacy_group, legacy_type) → (role, segment, type_v2)
TYPE_MAP = {
    # Capital Seeker → Originación
    ("Capital Seeker", "Developer"):        ("Originación", "Project Finance", "Developer"),
    ("Capital Seeker", "IPP"):              ("Originación", "Project Finance", "IPP"),
    ("Capital Seeker", "Utility"):          ("Originación", "Project Finance", "Developer + IPP"),
    ("Capital Seeker", "Asset Owner"):      ("Originación", "Project Finance", "IPP"),
    ("Capital Seeker", "Corporate"):        ("Originación", "Corporate Finance", ""),
    ("Capital Seeker", "EPC / Contractor"): ("Originación", "Corporate Finance", ""),
    ("Capital Seeker", "Renewable Fund"):   ("Originación", "Project Finance", "Developer"),
    ("Capital Seeker", "Other"):            ("Originación", "", ""),  # needs reenrich

    # Investor → Inversión
    ("Investor", "Renewable Fund"):         ("Inversión", "", "Fondo renovable"),
    ("Investor", "Institutional Investor"): ("Inversión", "", "Bonista / Institucional"),
    ("Investor", "Bank"):                   ("Inversión", "", "Banco"),
    ("Investor", "Family Office"):          ("Inversión", "", "Fondo de deuda"),
    ("Investor", "Infrastructure Fund"):    ("Inversión", "", "Fondo de infraestructura"),
    ("Investor", "Other"):                  ("Inversión", "", ""),  # needs reenrich

    # Services → Ecosistema
    ("Services", "Legal Advisor"):          ("Ecosistema", "", "Asesor legal"),
    ("Services", "Financial Advisor"):      ("Ecosistema", "", "Asesor financiero"),
    ("Services", "Technical Advisor"):      ("Ecosistema", "", "Asesor técnico"),
    ("Services", "EPC / Contractor"):       ("Ecosistema", "", "Ingeniería"),
    ("Services", "Consultant"):             ("Ecosistema", "", "Consultor de precios"),
    ("Services", "Platform / Tech"):        ("Ecosistema", "", ""),
    ("Services", "Other"):                  ("Ecosistema", "", ""),  # needs reenrich
    ("Services", "Public Institution"):     ("Ecosistema", "", "Asociación / Institución"),

    # Other → No relevante / Ecosistema
    ("Other", "Public Institution"):        ("Ecosistema", "", "Asociación / Institución"),
    ("Other", "Association"):               ("Ecosistema", "", "Asociación / Institución"),
    ("Other", "Other"):                     ("No relevante", "", ""),
    ("Other", "Financial Advisor"):         ("Ecosistema", "", "Asesor financiero"),
    ("Other", "Utility"):                   ("Originación", "Project Finance", "Developer + IPP"),

    # Cross-category misclassifications in v1
    ("Services", "Bank"):                   ("Inversión", "", "Banco"),
    ("Services", "Utility"):                ("Originación", "Project Finance", "Developer + IPP"),
    ("Services", "Institutional Investor"): ("Inversión", "", "Bonista / Institucional"),
    ("Services", "Family Office"):          ("Inversión", "", "Fondo de deuda"),
    ("Investor", "Financial Advisor"):      ("Ecosistema", "", "Asesor financiero"),
    ("Investor", "IPP"):                    ("Originación", "Project Finance", "IPP"),
    ("Investor", "Utility"):                ("Originación", "Project Finance", "Developer + IPP"),
    ("Investor", "Developer"):              ("Originación", "Project Finance", "Developer"),
    ("Investor", "Public Institution"):     ("Ecosistema", "", "Asociación / Institución"),
    ("Capital Seeker", "Financial Advisor"):("Ecosistema", "", "Asesor financiero"),
    ("Capital Seeker", "Public Institution"):("Ecosistema", "", "Asociación / Institución"),
    ("Capital Seeker", "Institutional Investor"):("Inversión", "", "Bonista / Institucional"),
    ("Capital Seeker", "Bank"):             ("Inversión", "", "Banco"),
}

# Activities inference from v1 subtipo field
SUBTIPO_TO_ACTIVITIES = {
    "EPC/Proveedor": ["EPC / Construcción renovable"],
    "Autoconsumo": ["Autoconsumo industrial/comercial"],
}

ROLE_TO_LEGACY_GROUP = {
    "Originación": "Capital Seeker",
    "Inversión": "Investor",
    "Ecosistema": "Services",
    "No relevante": "Other",
}


def migrate_company(enrichment):
    """Migrate a single company's enrichment from v1 to v2."""
    if not enrichment:
        return None

    # Already migrated
    if enrichment.get("_tv", 0) >= 2:
        return enrichment

    grp = enrichment.get("grp", "Other")
    tp = enrichment.get("tp", "Other")

    key = (grp, tp)
    if key in TYPE_MAP:
        role, segment, type_v2 = TYPE_MAP[key]
    else:
        # Fallback: map group, leave type empty
        role = {"Capital Seeker": "Originación", "Investor": "Inversión",
                "Services": "Ecosistema"}.get(grp, "No relevante")
        segment = ""
        type_v2 = ""

    # Infer activities from subtipo if Corporate Finance
    activities = []
    if segment == "Corporate Finance":
        st = enrichment.get("st", "")
        if st in SUBTIPO_TO_ACTIVITIES:
            activities = SUBTIPO_TO_ACTIVITIES[st]
        # Also check from legacy type
        if tp == "EPC / Contractor":
            activities = ["EPC / Construcción renovable"]

    # Carry forward existing fields
    new_enrichment = dict(enrichment)  # preserve all existing fields
    new_enrichment.update({
        "_tv": 2,
        "role": role,
        "seg": segment,
        "tp2": type_v2,
        "act": activities,
        "tech": enrichment.get("tech", []),
        "geo": enrichment.get("geo", []),
        # Keep existing fields: grp, tp, mr, ds, pp, sc, st, fc
    })

    return new_enrichment


def main():
    dry_run = "--dry-run" in sys.argv
    reenrich = "--reenrich" in sys.argv

    paths = get_data_paths(PROJECT_DIR)
    full_path = paths["full"]

    print(f"Loading {full_path}...")
    with open(full_path) as f:
        data = json.load(f)

    companies = data["companies"]
    print(f"  {len(companies)} companies loaded")

    # Migrate
    stats = Counter()
    needs_reenrich = []

    for domain, co in companies.items():
        e = co.get("enrichment")
        if not e:
            stats["no_enrichment"] += 1
            continue

        if e.get("_tv", 0) >= 2:
            stats["already_v2"] += 1
            continue

        migrated = migrate_company(e)
        if migrated:
            role = migrated["role"]
            tp2 = migrated["tp2"]
            stats[f"migrated:{role}"] += 1

            if not tp2 and role != "No relevante":
                needs_reenrich.append(domain)
                stats["needs_reenrich"] += 1

            if not dry_run:
                co["enrichment"] = migrated

    # Print stats
    print("\n=== Migration stats ===")
    for key, count in sorted(stats.items()):
        print(f"  {key}: {count}")
    print(f"\n  Needs re-enrichment: {len(needs_reenrich)}")

    if dry_run:
        print("\n[DRY RUN] No files modified.")
        if needs_reenrich:
            print(f"\nDomains needing re-enrichment (first 20):")
            for d in needs_reenrich[:20]:
                e = companies[d].get("enrichment", {})
                print(f"  {d} ({e.get('grp')}/{e.get('tp')})")
        return

    # Save
    print(f"\nWriting {full_path}...")
    with open(full_path, "w") as f:
        json.dump(data, f, ensure_ascii=False)

    # Regenerate compact
    compact_path = paths["compact"]
    print(f"Regenerating {compact_path}...")
    compact = export_to_compact(companies)
    with open(compact_path, "w") as f:
        json.dump(compact, f, ensure_ascii=False)

    print(f"Done! {sum(v for k, v in stats.items() if k.startswith('migrated:'))} companies migrated.")

    if reenrich and needs_reenrich:
        print(f"\n=== Re-enrichment ({len(needs_reenrich)} domains) ===")
        reenrich_with_gemini(companies, needs_reenrich, data, paths)


def reenrich_with_gemini(companies, domains, data, paths):
    """Re-classify domains with incomplete v2 mapping using Gemini."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  [error] GEMINI_API_KEY not set — skipping re-enrichment")
        return

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
    except Exception as e:
        print(f"  [error] Gemini init failed: {e}")
        return

    from process_sheet_emails import (
        COMPANY_TYPES_V2, CORPORATE_ACTIVITIES, TECHNOLOGIES,
        GEOGRAPHIES, COMMERCIAL_PHASES, MARKET_ROLES_LIST,
    )

    batch_size = 6
    updated = 0

    for i in range(0, len(domains), batch_size):
        batch = domains[i:i + batch_size]

        lines = []
        for domain in batch:
            co = companies[domain]
            name = co.get("name", domain)
            context = co.get("context", "")[:200]
            subjects = co.get("subjects", [])[:5]
            subj_text = " | ".join(subjects)
            lines.append(f"- {domain} ({name}): subjects=[{subj_text}] context=[{context}]")

        prompt = f"""Eres un analista de Alter5, consultora de financiación de energías renovables.

Clasifica estas empresas con la taxonomía v2:

ROLE: Originación | Inversión | Ecosistema | No relevante
SEGMENT (solo Originación): Project Finance | Corporate Finance
TYPE:
  Originación > PF: {", ".join(COMPANY_TYPES_V2["Originación > Project Finance"])}
  Inversión: {", ".join(COMPANY_TYPES_V2["Inversión > Deuda"] + COMPANY_TYPES_V2["Inversión > Equity"])}
  Ecosistema: {", ".join(COMPANY_TYPES_V2["Ecosistema"])}
ACTIVITIES (solo Corp. Finance): {json.dumps(CORPORATE_ACTIVITIES, ensure_ascii=False)}
TECHNOLOGIES: {json.dumps(TECHNOLOGIES, ensure_ascii=False)}

Empresas:
{chr(10).join(lines)}

Responde SOLO con JSON:
{{"dominio.com": {{"role": "...", "segment": "...", "type": "...", "activities": [...], "technologies": [...]}}}}"""

        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1]
                if text.endswith("```"):
                    text = text.rsplit("```", 1)[0]
                text = text.strip()

            parsed = json.loads(text)
            for domain in batch:
                if domain in parsed:
                    entry = parsed[domain]
                    e = companies[domain].get("enrichment", {})
                    e["role"] = entry.get("role", e.get("role", "No relevante"))
                    e["seg"] = entry.get("segment", "")
                    e["tp2"] = entry.get("type", "")
                    e["act"] = entry.get("activities", [])
                    e["tech"] = entry.get("technologies", [])
                    # Update legacy
                    e["grp"] = ROLE_TO_LEGACY_GROUP.get(e["role"], "Other")
                    e["tp"] = e["tp2"] or "Other"
                    updated += 1
                    print(f"  {domain} → {e['role']} / {e.get('seg','')} / {e.get('tp2','')}")
        except Exception as ex:
            print(f"  [warn] Batch failed: {ex}")

        if i + batch_size < len(domains):
            time.sleep(4.5)

    # Save updated data
    print(f"\n  Updated {updated}/{len(domains)} domains")
    full_path = paths["full"]
    with open(full_path, "w") as f:
        json.dump(data, f, ensure_ascii=False)

    compact_path = paths["compact"]
    compact = export_to_compact(companies)
    with open(compact_path, "w") as f:
        json.dump(compact, f, ensure_ascii=False)

    print("  Files saved.")


if __name__ == "__main__":
    main()
