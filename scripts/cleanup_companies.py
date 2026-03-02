#!/usr/bin/env python3
"""
Alter5 BI — Cleanup: elimina empresas de la blocklist de companies_full.json
y regenera companies.json compacto.

Uso:
  python scripts/cleanup_companies.py            # ejecutar
  python scripts/cleanup_companies.py --dry-run   # solo mostrar lo que se eliminaria
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

# Import export_to_compact from import_mailbox
sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import export_to_compact, get_data_paths


def main():
    dry_run = "--dry-run" in sys.argv

    paths = get_data_paths(PROJECT_DIR)
    blocklist_path = os.path.join(PROJECT_DIR, "src", "data", "blocklist.json")

    # Load blocklist
    if not os.path.exists(blocklist_path):
        print("No se encontro blocklist.json")
        sys.exit(1)

    with open(blocklist_path, "r", encoding="utf-8") as f:
        blocklist = json.load(f)

    blocked_domains = set(blocklist.get("domains", []))
    if not blocked_domains:
        print("La blocklist esta vacia. Nada que hacer.")
        sys.exit(0)

    print(f"Blocklist: {len(blocked_domains)} dominios")

    # Load companies_full.json
    full_path = paths["full"]
    if not os.path.exists(full_path):
        print(f"No se encontro {full_path}")
        sys.exit(1)

    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_companies = data.get("companies", {})
    original_count = len(all_companies)

    # Find domains to remove
    to_remove = [d for d in blocked_domains if d in all_companies]
    not_found = [d for d in blocked_domains if d not in all_companies]

    print(f"Empresas actuales: {original_count}")
    print(f"A eliminar: {len(to_remove)}")
    if not_found:
        print(f"No encontradas (ya eliminadas o inexistentes): {len(not_found)}")

    if not to_remove:
        print("No hay empresas que eliminar.")
        sys.exit(0)

    # Show what will be removed
    print("\nDominios a eliminar:")
    for d in sorted(to_remove):
        name = all_companies[d].get("name", d)
        interactions = all_companies[d].get("interactions", 0)
        print(f"  - {d} ({name}, {interactions} emails)")

    if dry_run:
        print(f"\n[DRY RUN] Se eliminarian {len(to_remove)} empresas. No se hicieron cambios.")
        sys.exit(0)

    # Remove domains
    for d in to_remove:
        del all_companies[d]

    print(f"\nEliminadas {len(to_remove)} empresas. Quedan: {len(all_companies)}")

    # Save companies_full.json
    data["companies"] = all_companies
    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"Guardado: {full_path}")

    # Regenerate companies.json compact
    compact = export_to_compact(all_companies)
    compact_path = paths["compact"]
    with open(compact_path, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False)
    print(f"Regenerado: {compact_path}")

    print(f"\nLimpieza completada: {original_count} -> {len(all_companies)} empresas")


if __name__ == "__main__":
    main()
