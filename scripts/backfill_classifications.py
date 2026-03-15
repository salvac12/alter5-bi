"""
===============================================================
  Alter5 BI — Backfill: Re-classify all companies with improved pipeline
===============================================================

  Re-classifies ALL companies in companies_full.json using the improved
  Gemini prompts and expanded context (more subjects, snippets, bodies).

  This script does NOT require Google Sheet access — it works directly
  with the existing companies_full.json data.

  Usage:
    export GEMINI_API_KEY="AIza..."
    python scripts/backfill_classifications.py                    # all companies
    python scripts/backfill_classifications.py --top 500          # top 500 by interactions
    python scripts/backfill_classifications.py --unclassified     # only companies without enrichment
    python scripts/backfill_classifications.py --dry-run          # preview without writing
    python scripts/backfill_classifications.py --roles            # also re-classify contact roles

  Estimated cost: ~550 Gemini calls for 3,317 companies ≈ $5-10
  Estimated time: ~45 minutes
===============================================================
"""

import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from import_mailbox import export_to_compact, get_data_paths
from process_sheet_emails import (
    classify_domains_with_gemini,
    classify_roles_with_gemini,
    load_known_companies,
    build_known_result,
)


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


def _atomic_json_write(path, data, **kwargs):
    """Write JSON to a file atomically using temp file + os.replace."""
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, **kwargs)
        os.replace(tmp_path, path)
    except BaseException:
        os.unlink(tmp_path)
        raise


def save_companies(data, paths):
    """Write companies_full.json and companies.json."""
    _atomic_json_write(paths["full"], data, indent=2)

    compact = export_to_compact(data["companies"])
    _atomic_json_write(paths["compact"], compact, separators=(",", ":"))

    print(f"  OK: Written {paths['full']}")
    print(f"  OK: Written {paths['compact']}")


def main():
    args = sys.argv[1:]
    top_n = None
    unclassified_only = False
    dry_run = False
    do_roles = False

    i = 0
    while i < len(args):
        if args[i] == "--top" and i + 1 < len(args):
            top_n = int(args[i + 1])
            i += 2
        elif args[i] == "--unclassified":
            unclassified_only = True
            i += 1
        elif args[i] == "--dry-run":
            dry_run = True
            i += 1
        elif args[i] == "--roles":
            do_roles = True
            i += 1
        else:
            i += 1

    print("=" * 60)
    print("  Alter5 BI — Backfill: Re-clasificación masiva")
    print("=" * 60)
    print()

    # Check API key
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  [error] GEMINI_API_KEY not set")
        sys.exit(1)

    # Load data
    print("  [1/4] Cargando datos existentes...")
    data, paths = load_companies()
    all_companies = data.get("companies", {})
    print(f"  → {len(all_companies)} empresas en la base de datos")

    # Load blocklist
    blocklist_path = os.path.join(PROJECT_DIR, "src", "data", "blocklist.json")
    blocked_domains = set()
    if os.path.exists(blocklist_path):
        with open(blocklist_path, "r", encoding="utf-8") as f:
            blocked_domains = set(json.load(f).get("domains", []))

    # Load known companies (these skip Gemini)
    known = load_known_companies()

    # Select companies to re-classify
    print("  [2/4] Seleccionando empresas a re-clasificar...")
    candidates = []
    for domain, co in all_companies.items():
        if domain in blocked_domains:
            continue
        if domain in known:
            # Update from known_companies.json directly
            co["enrichment"] = build_known_result(known[domain]).get("enrichment", co.get("enrichment"))
            continue

        enrichment = co.get("enrichment") or {}

        if unclassified_only:
            # Only companies without v2 enrichment
            if enrichment.get("_tv") == 2:
                continue

        candidates.append((domain, co))

    # Sort by interactions descending (highest value companies first)
    candidates.sort(key=lambda x: x[1].get("interactions", 0), reverse=True)

    if top_n:
        candidates = candidates[:top_n]

    print(f"  → {len(candidates)} empresas seleccionadas para re-clasificación")

    if dry_run:
        print()
        print("  [DRY RUN] Primeras 20 empresas que se re-clasificarían:")
        for domain, co in candidates[:20]:
            enr = co.get("enrichment") or {}
            role = enr.get("role", "sin clasificar")
            interactions = co.get("interactions", 0)
            print(f"    {domain:40s} | role={role:20s} | emails={interactions}")
        print()
        print(f"  Total: {len(candidates)} empresas")
        est_calls = len(candidates) // 6 + 1
        est_time = est_calls * 4.5 / 60
        print(f"  Llamadas Gemini estimadas: ~{est_calls}")
        print(f"  Tiempo estimado: ~{est_time:.0f} minutos")
        return

    # Build classification tuples
    print("  [3/4] Re-clasificando con Gemini...")
    domain_tuples = []
    for domain, co in candidates:
        subjects = co.get("subjects", [])
        snippets = co.get("snippets", [])
        name = co.get("name", domain.split(".")[0].title())
        # No bodies available from historical data (only from new GAS captures)
        domain_tuples.append((domain, subjects[:20], snippets[:15], name, []))

    est_calls = len(domain_tuples) // 6 + 1
    est_time = est_calls * 4.5 / 60
    print(f"  → {len(domain_tuples)} empresas, ~{est_calls} llamadas Gemini, ~{est_time:.0f} min estimado")

    classifications = classify_domains_with_gemini(domain_tuples)

    # Apply classifications
    classified_count = 0
    for domain, cls in classifications.items():
        enr = cls.get("enrichment")
        if enr and domain in all_companies:
            enr["_classified_at"] = datetime.now(timezone.utc).isoformat()
            enr["_email_count"] = all_companies[domain].get("interactions", 0)
            enr["_backfill"] = True  # mark as backfill-generated
            all_companies[domain]["enrichment"] = enr
            classified_count += 1

    print(f"  → {classified_count} empresas re-clasificadas")

    # Optionally re-classify contact roles
    if do_roles:
        print("  [3b/4] Re-clasificando roles de contactos...")
        contacts_to_classify = []
        for domain, co in candidates:
            for contact in co.get("contacts", []):
                if contact.get("role", "No identificado") == "No identificado":
                    name = contact.get("name", "")
                    email = contact.get("email", "")
                    if name and email:
                        # Get subjects for this contact from the company subjects
                        subjects = co.get("subjects", [])[:5]
                        contacts_to_classify.append((name, email, domain, subjects, []))

        if contacts_to_classify:
            print(f"  → {len(contacts_to_classify)} contactos sin rol a re-clasificar")
            role_map = classify_roles_with_gemini(contacts_to_classify)

            updated_roles = 0
            for domain, co in all_companies.items():
                for contact in co.get("contacts", []):
                    email = contact.get("email", "")
                    if email in role_map and role_map[email] != "No identificado":
                        contact["role"] = role_map[email]
                        updated_roles += 1
            print(f"  → {updated_roles} roles de contacto actualizados")
        else:
            print("  → No hay contactos sin rol que re-clasificar")

    # Save
    print("  [4/4] Guardando resultados...")
    data["companies"] = all_companies
    save_companies(data, paths)

    print()
    print(f"  BACKFILL COMPLETADO")
    print(f"  → {classified_count} empresas re-clasificadas")
    print()


if __name__ == "__main__":
    main()
