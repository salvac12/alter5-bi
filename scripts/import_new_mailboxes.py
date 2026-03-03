"""
═══════════════════════════════════════════════════════════════
  Alter5 BI — Auto-detect & import new mailbox Excels
═══════════════════════════════════════════════════════════════

  USO:
    python scripts/import_new_mailboxes.py [--dry-run]

  QUÉ HACE:
    1. Escanea data_sources/*.xlsx
    2. Compara contra data_sources/.imported.json
    3. Para cada fichero nuevo, pide nombre (o lo extrae del filename)
    4. Ejecuta el import completo (merge + enrichment + Sheet + manifest)

  REQUISITOS:
    pip install pandas openpyxl google-generativeai gspread google-auth
═══════════════════════════════════════════════════════════════
"""

import argparse
import glob
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import load_manifest, main as import_main


def guess_employee_name(filename):
    """Try to extract employee name from filename.

    Examples:
        'analisis_miguel_solana_v2.xlsx' -> 'Miguel Solana'
        'miguel_solana.xlsx' -> 'Miguel Solana'
    """
    base = os.path.splitext(filename)[0]
    # Remove common prefixes/suffixes
    base = re.sub(r"^analisis_", "", base, flags=re.IGNORECASE)
    base = re.sub(r"_?contactos_?", "", base, flags=re.IGNORECASE)
    base = re.sub(r"_v\d+.*$", "", base, flags=re.IGNORECASE)
    base = re.sub(r"\s*\(\d+\)\s*$", "", base)
    base = re.sub(r"_?final_?", "", base, flags=re.IGNORECASE)

    # Convert underscores to spaces and title-case
    name = base.replace("_", " ").strip()
    if name:
        return name.title()
    return None


def scan_new_files():
    """Scan data_sources/ for .xlsx files not yet in the manifest."""
    data_dir = os.path.join(PROJECT_DIR, "data_sources")
    if not os.path.isdir(data_dir):
        print("  ✗ data_sources/ directory not found")
        return []

    manifest = load_manifest()
    xlsx_files = sorted(glob.glob(os.path.join(data_dir, "*.xlsx")))
    new_files = []

    for filepath in xlsx_files:
        filename = os.path.basename(filepath)
        # Skip temp files
        if filename.startswith("~$"):
            continue
        if filename not in manifest:
            new_files.append(filepath)

    return new_files


def main():
    parser = argparse.ArgumentParser(description="Auto-detect & import new mailbox Excels")
    parser.add_argument("--dry-run", action="store_true", help="Only show what would be imported")
    parser.add_argument("--email", help="Email corporativo (applies to all new imports)")
    parser.add_argument("--no-enrich", action="store_true", help="Skip Gemini enrichment")
    parser.add_argument("--no-sheet", action="store_true", help="Skip Google Sheet registration")
    args = parser.parse_args()

    new_files = scan_new_files()

    if not new_files:
        print("  ✓ No hay ficheros nuevos en data_sources/")
        return

    print(f"  Encontrados {len(new_files)} fichero(s) nuevo(s):")
    for f in new_files:
        print(f"    - {os.path.basename(f)}")
    print()

    if args.dry_run:
        print("  (dry-run — no se importará nada)")
        return

    for filepath in new_files:
        filename = os.path.basename(filepath)
        guessed = guess_employee_name(filename)

        if sys.stdin.isatty():
            name_input = input(f"  Nombre para '{filename}' [{guessed or '???'}]: ").strip()
            employee_name = name_input or guessed
            if not employee_name:
                print(f"  ✗ No se pudo determinar el nombre — saltando {filename}")
                continue

            email_input = input(f"  Email corporativo [{args.email or 'ninguno'}]: ").strip()
            employee_email = email_input or args.email
        else:
            # Non-interactive mode
            employee_name = guessed
            if not employee_name:
                print(f"  ✗ No se pudo extraer nombre de '{filename}' — saltando")
                continue
            employee_email = args.email

        print()
        print("═" * 60)
        print(f"  Importando: {filename} → {employee_name}")
        print("═" * 60)

        # Build sys.argv for import_main
        argv_backup = sys.argv
        sys.argv = ["import_mailbox.py", filepath, employee_name]
        if employee_email:
            sys.argv += ["--email", employee_email]
        if args.no_enrich:
            sys.argv.append("--no-enrich")
        if args.no_sheet:
            sys.argv.append("--no-sheet")

        try:
            import_main()
        except SystemExit:
            pass
        finally:
            sys.argv = argv_backup

        print()

    print("  ✓ Importación completada")


if __name__ == "__main__":
    main()
