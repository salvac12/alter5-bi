"""
===============================================================
  Alter5 BI — Reclasificación de empresas por producto con IA
===============================================================

  Re-procesa las empresas existentes usando Gemini para
  clasificar qué productos Alter5 aplican a cada una.

  Variables de entorno requeridas:
    GEMINI_API_KEY  — API key de Google AI Studio

  Uso:
    export GEMINI_API_KEY="AIza..."
    python scripts/reclassify_products.py [--dry-run] [--limit N]

  Opciones:
    --dry-run   Muestra resultados sin escribir archivos
    --limit N   Procesar solo las primeras N empresas
===============================================================
"""

import json
import os
import sys
import time
import argparse
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import get_data_paths, export_to_compact

PRODUCTS = [
    {
        "id": "debt",
        "name": "Debt",
        "description": "Financiación de deuda para proyectos renovables: project finance (short/medium/long term, development debt, AssetCo debt), corporate loans (corporate debt, HoldCo debt, PF guaranteed), refinanciación",
    },
    {
        "id": "equity",
        "name": "Equity",
        "description": "Inversión en equity, M&A, co-development y colocación a inversores institucionales para proyectos y activos renovables",
    },
]

BATCH_SIZE = 8
RPM_DELAY = 5.0


def build_prompt(batch):
    """Build a Gemini prompt for a batch of companies."""
    product_list = "\n".join(
        f'  - "{p["id"]}": {p["description"]}'
        for p in PRODUCTS
    )
    product_ids = ", ".join(f'"{p["id"]}"' for p in PRODUCTS)

    companies_block = []
    for co in batch:
        context = co.get("context", "")
        subjects = co.get("subjects", [])
        contacts = co.get("contacts", [])
        sectors = co.get("sectors", "")
        rel_type = co.get("relType", "")

        subj_text = " | ".join(subjects[:8]) if subjects else "(sin subjects)"
        roles_text = ", ".join(
            f'{c.get("name", "")} ({c.get("role", "N/A")})'
            for c in contacts[:4]
        )

        companies_block.append(
            f'- domain="{co["domain"]}" sector="{sectors}" relType="{rel_type}"\n'
            f'  contexto: {context}\n'
            f'  subjects: {subj_text}\n'
            f'  contactos: {roles_text}'
        )

    return f"""Eres un analista de banca de inversión en energías renovables.
Clasifica cada empresa según qué productos financieros de Alter5 podrían necesitar.

Productos disponibles:
{product_list}

Para cada empresa, devuelve un JSON con los IDs de productos que aplican y una
puntuación de confianza (0-100). Solo incluye productos con confianza >= 20.

Empresas a clasificar:
{chr(10).join(companies_block)}

Responde SOLO con un JSON válido, sin markdown ni explicaciones. Formato exacto:
{{
  "dominio1.com": [{{"product": "{PRODUCTS[0]['id']}", "confidence": 85, "reason": "razón breve"}}],
  "dominio2.com": []
}}

Los IDs válidos son: {product_ids}
Si la empresa NO es relevante para ningún producto, devuelve una lista vacía."""


def classify_batch(model, batch):
    """Classify a batch of companies using Gemini."""
    prompt = build_prompt(batch)

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()

        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text.rsplit("```", 1)[0]
            text = text.strip()

        return json.loads(text)
    except Exception as e:
        print(f"  [warn] Gemini batch failed: {e}")
        return {}


def main():
    parser = argparse.ArgumentParser(description="Reclasificar empresas por producto con Gemini")
    parser.add_argument("--dry-run", action="store_true", help="No escribir archivos")
    parser.add_argument("--limit", type=int, default=0, help="Procesar solo N empresas")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  Error: GEMINI_API_KEY no está configurada")
        sys.exit(1)

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
    except Exception as e:
        print(f"  Error inicializando Gemini: {e}")
        sys.exit(1)

    paths = get_data_paths(PROJECT_DIR)

    print("=" * 60)
    print("  Alter5 BI — Reclasificación por producto")
    print("=" * 60)
    print()

    # Load existing data
    full_path = paths["full"]
    if not os.path.exists(full_path):
        print(f"  Error: No se encuentra {full_path}")
        sys.exit(1)

    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_companies = data.get("companies", {})
    employees = data.get("employees", [])
    print(f"  → {len(all_companies)} empresas cargadas")

    # Filter: only process companies with Renovables/Energía sector or Potencial Prestatario
    candidates = []
    for domain, co in all_companies.items():
        sectors = (co.get("sectors", "") or "").lower()
        rel_type = (co.get("relType", "") or "").lower()
        is_energy = any(s in sectors for s in ["renovable", "energía", "energia", "solar", "eólic"])
        is_finance = any(r in rel_type for r in ["potencial prestatario", "inversor", "banco", "partnership"])
        is_advisor = any(r in rel_type for r in ["asesor financiero", "asesor legal"])

        if is_energy or is_finance or is_advisor:
            candidates.append(co)

    if args.limit:
        candidates = candidates[:args.limit]

    print(f"  → {len(candidates)} empresas candidatas para clasificación")
    print()

    # Process in batches
    all_results = {}
    total_batches = (len(candidates) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[batch_idx:batch_idx + BATCH_SIZE]
        batch_num = batch_idx // BATCH_SIZE + 1
        domains = [co["domain"] for co in batch]

        print(f"  [{batch_num}/{total_batches}] Clasificando: {', '.join(domains[:3])}...")

        results = classify_batch(model, batch)
        all_results.update(results)

        if batch_idx + BATCH_SIZE < len(candidates):
            time.sleep(RPM_DELAY)

    # Summarize results
    print()
    print("  === Resultados ===")
    product_counts = {p["id"]: 0 for p in PRODUCTS}
    classified = 0

    for domain, matches in all_results.items():
        if matches:
            classified += 1
            for m in matches:
                pid = m.get("product", "")
                if pid in product_counts:
                    product_counts[pid] += 1

    print(f"  → {classified}/{len(candidates)} empresas con al menos 1 producto")
    for p in PRODUCTS:
        print(f"    {p['name']}: {product_counts[p['id']]} empresas")

    # Save results to companies_full.json
    if not args.dry_run:
        print()
        print("  Guardando clasificaciones...")

        for domain, matches in all_results.items():
            if domain in all_companies:
                all_companies[domain]["productMatches"] = [
                    {"product": m["product"], "confidence": m["confidence"], "reason": m.get("reason", "")}
                    for m in matches
                ]

        full_data = {"companies": all_companies, "employees": employees}
        with open(paths["full"], "w", encoding="utf-8") as f:
            json.dump(full_data, f, ensure_ascii=False, indent=2)

        compact = export_to_compact(all_companies)
        with open(paths["compact"], "w", encoding="utf-8") as f:
            json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

        print(f"  ✓ Archivos actualizados")

    # Save detailed results log
    log_path = os.path.join(PROJECT_DIR, "scripts", "product_classification_log.json")
    log_data = {
        "timestamp": datetime.now().isoformat(),
        "total_candidates": len(candidates),
        "total_classified": classified,
        "product_counts": product_counts,
        "results": all_results,
    }
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(log_data, f, ensure_ascii=False, indent=2)
    print(f"  ✓ Log guardado en {log_path}")

    print()
    print("  Listo. Reinicia el servidor de desarrollo para ver los cambios.")
    print()


if __name__ == "__main__":
    main()
