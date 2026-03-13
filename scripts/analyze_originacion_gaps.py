#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Analisis de gaps: Originacion local vs Airtable
===============================================================

  Cruza empresas locales (companies_full.json) con Airtable
  (Stakeholders_Companies + Business_Units) para encontrar:

  1. Gaps: empresas en Airtable NO en local (y viceversa)
  2. Complementariedad: datos que tiene cada fuente
  3. Consistencia: mismatches de clasificacion

  READ-ONLY: solo hace GET a Airtable, no modifica nada.

  Usage:
    export AIRTABLE_PAT="patXXX..."    (o VITE_AIRTABLE_PAT)

    python scripts/analyze_originacion_gaps.py                  # reporte completo
    python scripts/analyze_originacion_gaps.py --json report.json  # export JSON
    python scripts/analyze_originacion_gaps.py --verbose        # detalle por empresa
===============================================================
"""

import argparse
import json
import os
import re
import ssl
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from import_mailbox import get_data_paths

# ---------------------------------------------------------------------------
# SSL context (same pattern as verify_classifications.py)
# ---------------------------------------------------------------------------
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# ---------------------------------------------------------------------------
# Airtable config
# ---------------------------------------------------------------------------
AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID", "appVu3TvSZ1E4tj0J")
COMPANIES_TABLE = "Stakeholders_Companies"
BU_TABLE = "Stakeholders_Business_Units"

# Role mapping: Airtable "Type of market role" -> local enrichment.role
AT_ROLE_TO_LOCAL = {
    "Capital Seeker": "Originacion",
    "Investor": "Inversion",
    "Ecosystem": "Ecosistema",
}
LOCAL_ROLE_TO_AT = {v: k for k, v in AT_ROLE_TO_LOCAL.items()}


def load_pat():
    """Load Airtable PAT from env or .env file."""
    pat = os.environ.get("AIRTABLE_PAT") or os.environ.get("VITE_AIRTABLE_PAT", "")
    if pat:
        return pat

    # Try reading from .env file
    env_file = os.path.join(PROJECT_DIR, ".env")
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key in ("AIRTABLE_PAT", "VITE_AIRTABLE_PAT") and val:
                    return val
    return ""


def normalize_name(name):
    """Normalize company name for fuzzy matching: strip accents, lowercase, remove suffixes."""
    if not name:
        return ""
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    name = name.lower().strip()
    # Remove common suffixes
    for suffix in [" s.l.", " s.a.", " s.l.u.", " s.a.u.", " gmbh", " ltd", " inc", " corp", " llc", " ag", " plc"]:
        if name.endswith(suffix):
            name = name[:-len(suffix)].strip()
    # Remove trailing punctuation
    name = re.sub(r'[.,;]+$', '', name).strip()
    return name


def extract_domain_from_url(url):
    """Extract clean domain from a URL."""
    if not url:
        return ""
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        netloc = urllib.parse.urlparse(url).netloc.lower()
        # Strip www.
        if netloc.startswith("www."):
            netloc = netloc[4:]
        # Strip port
        if ":" in netloc:
            netloc = netloc.split(":")[0]
        return netloc
    except Exception:
        return ""


def airtable_headers(pat):
    return {
        "Authorization": f"Bearer {pat}",
        "Content-Type": "application/json",
    }


def fetch_airtable_paginated(pat, table_name, fields=None, formula=None):
    """Fetch all records from an Airtable table with pagination. Read-only."""
    base_url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{urllib.parse.quote(table_name)}"
    records = []
    offset = None
    page = 0

    while True:
        params = []
        if fields:
            for f in fields:
                params.append(f"fields%5B%5D={urllib.parse.quote(f)}")
        if formula:
            params.append(f"filterByFormula={urllib.parse.quote(formula)}")
        params.append("pageSize=100")
        if offset:
            params.append(f"offset={offset}")

        url = base_url + "?" + "&".join(params)
        req = urllib.request.Request(url, headers=airtable_headers(pat))

        try:
            with urllib.request.urlopen(req, context=SSL_CTX) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8") if e.fp else ""
            print(f"  ERROR: Airtable API {e.code} on {table_name}: {body[:200]}")
            break

        batch = data.get("records", [])
        records.extend(batch)
        page += 1

        offset = data.get("offset")
        if not offset:
            break

    return records


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def load_local_companies():
    """Load companies_full.json and build indices."""
    paths = get_data_paths(PROJECT_DIR)
    full_path = paths["full"]

    if not os.path.exists(full_path):
        print(f"ERROR: {full_path} not found")
        sys.exit(1)

    with open(full_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    # Unwrap nested structure: {companies: {domain: ...}, employees: [...]}
    if isinstance(raw, dict) and "companies" in raw:
        companies = raw["companies"]
    else:
        companies = raw

    print(f"  Local: {len(companies)} empresas cargadas")

    # Index by domain (all companies)
    by_domain = {}
    for domain, co in companies.items():
        by_domain[domain.lower()] = co

    # Index by normalized name -> domain (for fallback matching)
    by_name = {}
    for domain, co in companies.items():
        name = co.get("name", "")
        if name:
            nname = normalize_name(name)
            if nname:
                by_name[nname] = domain.lower()

    # Set of Originacion domains
    originacion_domains = set()
    for domain, co in companies.items():
        enr = co.get("enrichment", {})
        role = enr.get("role", "")
        if role in ("Originacion", "Originación"):
            originacion_domains.add(domain.lower())

    print(f"  Local Originacion: {len(originacion_domains)} empresas")
    return by_domain, by_name, originacion_domains


def fetch_stakeholder_companies(pat):
    """Fetch Stakeholders_Companies from Airtable."""
    fields = [
        "Company Name", "Home URL", "Description", "Num Employees",
        "Market role", "Type of market role", "Target Company",
        "HQ Country", "Sector", "Subsector", "Record Status",
        "Tax ID", "Company Legal Name", "Business Units",
        "Parent Company", "Ultimate Parent Company",
        "Available Yearly Results",
    ]
    print(f"  Fetching {COMPANIES_TABLE}...")
    records = fetch_airtable_paginated(pat, COMPANIES_TABLE, fields=fields)
    print(f"  Airtable Companies: {len(records)} records")
    return records


def fetch_business_units(pat):
    """Fetch active Business Units from Airtable."""
    fields = [
        "Business Unit Name", "Company", "Company_Name_Replication",
        "Company URL", "Market_Role_Names", "Type of market role",
        "Sector_Names", "Subsector_Names", "Focus_Countries_Name",
        "Focus Region", "Ticket Size Minimum", "Ticket Size Maximum",
        "Trust Level", "Strategic Notes", "Record Status",
        "Financing Structures",
    ]
    print(f"  Fetching {BU_TABLE} (Active only)...")
    records = fetch_airtable_paginated(
        pat, BU_TABLE, fields=fields,
        formula='{Record Status} = "Active"'
    )
    print(f"  Airtable Business Units: {len(records)} records")
    return records


def resolve_bus_to_companies(bus_records, company_records):
    """Group Business Units by parent company record ID."""
    # Build company record ID -> parsed company
    company_by_id = {}
    for rec in company_records:
        company_by_id[rec["id"]] = rec

    # Group BUs by company record ID
    bus_by_company_id = {}
    for bu_rec in bus_records:
        fields = bu_rec.get("fields", {})
        company_links = fields.get("Company", [])
        if isinstance(company_links, list):
            for cid in company_links:
                bus_by_company_id.setdefault(cid, []).append(fields)
        elif company_links:
            bus_by_company_id.setdefault(company_links, []).append(fields)

    return bus_by_company_id


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------
def parse_airtable_companies(at_records):
    """Parse raw Airtable records into structured dicts."""
    parsed = []
    for rec in at_records:
        f = rec.get("fields", {})
        name = f.get("Company Name", "")
        url = f.get("Home URL", "")
        domain = extract_domain_from_url(url)

        # Type of market role can be multipleSelects (list)
        market_roles = f.get("Type of market role", [])
        if isinstance(market_roles, str):
            market_roles = [market_roles]
        elif not isinstance(market_roles, list):
            market_roles = []

        parsed.append({
            "record_id": rec["id"],
            "name": name,
            "url": url,
            "domain": domain,
            "market_roles": market_roles,
            "market_role_rollup": f.get("Market role", ""),
            "target": f.get("Target Company", ""),
            "description": f.get("Description", ""),
            "num_employees": f.get("Num Employees"),
            "hq_country": f.get("HQ Country", []),
            "sector": f.get("Sector", ""),
            "subsector": f.get("Subsector", ""),
            "record_status": f.get("Record Status", ""),
            "tax_id": f.get("Tax ID", ""),
            "legal_name": f.get("Company Legal Name", ""),
            "bu_ids": f.get("Business Units", []),
            "parent": f.get("Parent Company", []),
            "ultimate_parent": f.get("Ultimate Parent Company", []),
            "yearly_results": f.get("Available Yearly Results", []),
            "nda_status": f.get("NDA Status", ""),  # may not exist in all bases
        })
    return parsed


def match_companies(at_parsed, local_by_domain, local_by_name):
    """Match Airtable companies to local companies."""
    matched = []       # (at_company, local_domain, match_type)
    at_unmatched = []  # at_company with no local match

    for atc in at_parsed:
        # Strategy 1: domain match
        if atc["domain"] and atc["domain"] in local_by_domain:
            matched.append((atc, atc["domain"], "domain"))
            continue

        # Strategy 2: normalized name match
        nname = normalize_name(atc["name"])
        if nname and nname in local_by_name:
            matched.append((atc, local_by_name[nname], "name"))
            continue

        at_unmatched.append(atc)

    return matched, at_unmatched


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
def _total_interactions(co):
    """Get total interactions from a company dict."""
    total = co.get("interactions", 0)
    if not total:
        sources = co.get("sources", {})
        if isinstance(sources, dict):
            total = sum(s.get("interactions", 0) for s in sources.values() if isinstance(s, dict))
    return total


def analyze_gaps(matched, at_unmatched, at_parsed, local_by_domain, originacion_domains):
    """Produce full gap analysis."""

    # Matched local domains (from AT perspective)
    matched_local_domains = set(m[1] for m in matched)

    # AT companies not in local — filter to Capital Seeker only
    at_gaps = [
        atc for atc in at_unmatched
        if "Capital Seeker" in atc["market_roles"]
    ]
    at_gaps_all = at_unmatched  # all roles

    # Local Originacion not in AT
    local_gaps = []
    for domain in sorted(originacion_domains):
        if domain not in matched_local_domains:
            co = local_by_domain.get(domain, {})
            local_gaps.append((domain, co))

    # Sort local gaps by interactions (most active first)
    def interaction_count(item):
        domain, co = item
        # Top-level interactions field, or sum from sources dict
        total = co.get("interactions", 0)
        if not total:
            sources = co.get("sources", {})
            if isinstance(sources, dict):
                total = sum(s.get("interactions", 0) for s in sources.values() if isinstance(s, dict))
        return total

    local_gaps.sort(key=interaction_count, reverse=True)

    return {
        "matched": matched,
        "at_gaps_originacion": at_gaps,
        "at_gaps_all": at_gaps_all,
        "local_gaps": local_gaps,
    }


def analyze_complementary(matched, bus_by_company_id, local_by_domain):
    """Analyze what complementary data each side has for matched companies."""
    results = []
    # Counters for summary
    at_only_fields = {
        "num_employees": 0, "tax_id": 0, "legal_name": 0,
        "description": 0, "hq_country": 0, "parent": 0,
        "yearly_results": 0, "target": 0, "nda_status": 0,
        "bu_ticket_size": 0, "bu_trust_level": 0,
        "bu_strategic_notes": 0, "bu_focus_countries": 0,
        "bu_financing_structures": 0,
    }
    local_only_fields = {
        "interactions": 0, "contacts_with_roles": 0,
        "timeline": 0, "email_context": 0,
        "technologies": 0, "segment": 0, "type": 0,
        "phase": 0, "products": 0, "signals": 0, "quality_score": 0,
    }

    for atc, local_domain, match_type in matched:
        co = local_by_domain.get(local_domain, {})
        enr = co.get("enrichment", {})
        bus = bus_by_company_id.get(atc["record_id"], [])

        entry = {
            "at_name": atc["name"],
            "local_domain": local_domain,
            "match_type": match_type,
            "at_extras": [],
            "local_extras": [],
        }

        # Airtable-only fields
        if atc.get("num_employees"):
            at_only_fields["num_employees"] += 1
            entry["at_extras"].append("num_employees")
        if atc.get("tax_id"):
            at_only_fields["tax_id"] += 1
            entry["at_extras"].append("tax_id")
        if atc.get("legal_name"):
            at_only_fields["legal_name"] += 1
            entry["at_extras"].append("legal_name")
        if atc.get("description"):
            at_only_fields["description"] += 1
            entry["at_extras"].append("description")
        if atc.get("hq_country"):
            at_only_fields["hq_country"] += 1
            entry["at_extras"].append("hq_country")
        if atc.get("parent") or atc.get("ultimate_parent"):
            at_only_fields["parent"] += 1
            entry["at_extras"].append("parent")
        if atc.get("yearly_results"):
            at_only_fields["yearly_results"] += 1
            entry["at_extras"].append("yearly_results")
        if atc.get("target"):
            at_only_fields["target"] += 1
            entry["at_extras"].append("target")
        if atc.get("nda_status"):
            at_only_fields["nda_status"] += 1
            entry["at_extras"].append("nda_status")

        # BU-level fields
        for bu in bus:
            if bu.get("Ticket Size Minimum") or bu.get("Ticket Size Maximum"):
                at_only_fields["bu_ticket_size"] += 1
                entry["at_extras"].append("bu_ticket_size")
                break
        for bu in bus:
            if bu.get("Trust Level") is not None:
                at_only_fields["bu_trust_level"] += 1
                entry["at_extras"].append("bu_trust_level")
                break
        for bu in bus:
            if bu.get("Strategic Notes"):
                at_only_fields["bu_strategic_notes"] += 1
                entry["at_extras"].append("bu_strategic_notes")
                break
        for bu in bus:
            if bu.get("Focus_Countries_Name"):
                at_only_fields["bu_focus_countries"] += 1
                entry["at_extras"].append("bu_focus_countries")
                break
        for bu in bus:
            if bu.get("Financing Structures"):
                at_only_fields["bu_financing_structures"] += 1
                entry["at_extras"].append("bu_financing_structures")
                break

        # Local-only fields
        total_interactions = _total_interactions(co)
        if total_interactions > 0:
            local_only_fields["interactions"] += 1
            entry["local_extras"].append(f"interactions({total_interactions})")

        contacts = co.get("contacts", [])
        contacts_with_role = [c for c in contacts if c.get("role") and c["role"] != "unknown"]
        if contacts_with_role:
            local_only_fields["contacts_with_roles"] += 1
            entry["local_extras"].append(f"contacts_with_roles({len(contacts_with_role)})")

        if co.get("timeline"):
            local_only_fields["timeline"] += 1
            entry["local_extras"].append("timeline")

        if enr.get("sc") or enr.get("context") or enr.get("summary"):
            local_only_fields["email_context"] += 1
            entry["local_extras"].append("email_context")

        if enr.get("tech"):
            local_only_fields["technologies"] += 1
            entry["local_extras"].append("technologies")

        if enr.get("seg"):
            local_only_fields["segment"] += 1
            entry["local_extras"].append("segment")

        if enr.get("tp") or enr.get("tp2"):
            local_only_fields["type"] += 1
            entry["local_extras"].append("type")

        if enr.get("fc"):
            local_only_fields["phase"] += 1
            entry["local_extras"].append("phase")

        if enr.get("pp"):
            local_only_fields["products"] += 1
            entry["local_extras"].append("products")

        if enr.get("pi") or enr.get("signals"):
            local_only_fields["signals"] += 1
            entry["local_extras"].append("signals")

        if co.get("qualityScore") or enr.get("qualityScore"):
            local_only_fields["quality_score"] += 1
            entry["local_extras"].append("quality_score")

        results.append(entry)

    return {
        "entries": results,
        "at_only_summary": at_only_fields,
        "local_only_summary": local_only_fields,
    }


def _strip_accents(s):
    """Remove accents for comparison: Originación -> Originacion."""
    nfkd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")


def analyze_consistency(matched, local_by_domain):
    """Find classification mismatches between Airtable and local."""
    mismatches = []

    for atc, local_domain, match_type in matched:
        co = local_by_domain.get(local_domain, {})
        enr = co.get("enrichment", {})
        local_role = enr.get("role", "")
        if not local_role:
            continue

        # Map AT roles to local equivalent (without accents)
        at_roles = atc.get("market_roles", [])
        at_local_roles = set()
        for ar in at_roles:
            mapped = AT_ROLE_TO_LOCAL.get(ar)
            if mapped:
                at_local_roles.add(mapped)

        if not at_local_roles:
            continue

        # Compare without accents
        local_role_normalized = _strip_accents(local_role)
        at_normalized = {_strip_accents(r) for r in at_local_roles}

        if local_role_normalized not in at_normalized:
            mismatches.append({
                "domain": local_domain,
                "name": atc["name"],
                "at_roles": at_roles,
                "at_mapped": list(at_local_roles),
                "local_role": local_role,
                "match_type": match_type,
            })

    return mismatches


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def print_report(summary, gaps, complementary, consistency, verbose=False):
    """Print formatted text report to stdout."""
    print()
    print("=" * 70)
    print("  ANALISIS DE GAPS: ORIGINACION LOCAL vs AIRTABLE STAKEHOLDERS")
    print("=" * 70)

    # Section 1: Executive summary
    print()
    print("─" * 70)
    print("  1. RESUMEN EJECUTIVO")
    print("─" * 70)
    print(f"  Local total:           {summary['local_total']:,} empresas")
    print(f"  Local Originacion:     {summary['local_originacion']:,} empresas")
    print(f"  AT Companies total:    {summary['at_total']:,} records")
    print(f"  AT Capital Seeker:     {summary['at_capital_seeker']:,} records")
    print(f"  AT Investor:           {summary['at_investor']:,} records")
    print(f"  AT Ecosystem:          {summary['at_ecosystem']:,} records")
    print(f"  Business Units:        {summary['bu_total']:,} records (active)")
    print()
    print(f"  Matched by domain:     {summary['matched_domain']:,}")
    print(f"  Matched by name:       {summary['matched_name']:,}")
    print(f"  Total matched:         {summary['matched_total']:,}")
    print(f"  AT sin match (total):  {summary['at_unmatched']:,}")
    print(f"  AT sin match (CS):     {summary['at_unmatched_cs']:,} (Capital Seeker)")

    # Section 2: AT gaps (Capital Seeker not in local)
    at_gaps = gaps["at_gaps_originacion"]
    print()
    print("─" * 70)
    print(f"  2. EN AIRTABLE PERO NO EN LOCAL — Capital Seeker ({len(at_gaps)})")
    print("─" * 70)
    if at_gaps:
        print(f"  {'Empresa':<40} {'URL':<30} {'Sector'}")
        print(f"  {'─'*40} {'─'*30} {'─'*20}")
        for atc in sorted(at_gaps, key=lambda x: x["name"]):
            name = (atc["name"] or "???")[:39]
            url = (atc["url"] or "-")[:29]
            sector = ""
            if isinstance(atc.get("sector"), str):
                sector = atc["sector"][:20]
            elif isinstance(atc.get("sector"), list):
                sector = ", ".join(str(s) for s in atc["sector"])[:20]
            print(f"  {name:<40} {url:<30} {sector}")
    else:
        print("  (ninguna)")

    # Section 3: Local gaps (Originacion not in AT)
    local_gaps = gaps["local_gaps"]
    print()
    print("─" * 70)
    print(f"  3. EN LOCAL PERO NO EN AIRTABLE — Originacion ({len(local_gaps)})")
    print("─" * 70)
    if local_gaps:
        shown = local_gaps if verbose else local_gaps[:50]
        print(f"  {'Domain':<35} {'Nombre':<30} {'Int.':<6} {'Segmento':<15}")
        print(f"  {'─'*35} {'─'*30} {'─'*6} {'─'*15}")
        for domain, co in shown:
            name = (co.get("name", "") or domain)[:29]
            total_int = _total_interactions(co)
            segment = co.get("enrichment", {}).get("seg", "")[:14]
            print(f"  {domain:<35} {name:<30} {total_int:<6} {segment:<15}")
        if not verbose and len(local_gaps) > 50:
            print(f"  ... y {len(local_gaps) - 50} mas (usa --verbose para ver todas)")
    else:
        print("  (ninguna)")

    # Section 4: Complementary data
    print()
    print("─" * 70)
    print(f"  4. DATOS COMPLEMENTARIOS (empresas matched: {summary['matched_total']})")
    print("─" * 70)

    at_s = complementary["at_only_summary"]
    local_s = complementary["local_only_summary"]

    print()
    print("  SOLO EN AIRTABLE:")
    for field, count in sorted(at_s.items(), key=lambda x: -x[1]):
        if count > 0:
            pct = count * 100 / max(summary["matched_total"], 1)
            print(f"    {field:<30} {count:>5} ({pct:.0f}%)")

    print()
    print("  SOLO EN LOCAL:")
    for field, count in sorted(local_s.items(), key=lambda x: -x[1]):
        if count > 0:
            pct = count * 100 / max(summary["matched_total"], 1)
            print(f"    {field:<30} {count:>5} ({pct:.0f}%)")

    # Section 5: Consistency
    print()
    print("─" * 70)
    print(f"  5. MISMATCHES DE CLASIFICACION ({len(consistency)})")
    print("─" * 70)
    if consistency:
        print(f"  {'Domain':<30} {'AT Roles':<25} {'Local Role':<15}")
        print(f"  {'─'*30} {'─'*25} {'─'*15}")
        for m in sorted(consistency, key=lambda x: x["domain"]):
            domain = m["domain"][:29]
            at_roles = ", ".join(m["at_roles"])[:24]
            local_role = m["local_role"][:14]
            print(f"  {domain:<30} {at_roles:<25} {local_role:<15}")
    else:
        print("  (ninguno)")

    print()
    print("=" * 70)
    print("  FIN DEL REPORTE")
    print("=" * 70)


def export_json(summary, gaps, complementary, consistency, path):
    """Export full analysis as JSON."""
    output = {
        "summary": summary,
        "at_gaps_originacion": [
            {"name": a["name"], "url": a["url"], "domain": a["domain"],
             "market_roles": a["market_roles"], "sector": a.get("sector", "")}
            for a in gaps["at_gaps_originacion"]
        ],
        "local_gaps": [
            {"domain": domain, "name": co.get("name", ""),
             "interactions": _total_interactions(co),
             "segment": co.get("enrichment", {}).get("seg", ""),
             "type": co.get("enrichment", {}).get("tp", ""),
             "n_contacts": len(co.get("contacts", []))}
            for domain, co in gaps["local_gaps"]
        ],
        "complementary": {
            "at_only_summary": complementary["at_only_summary"],
            "local_only_summary": complementary["local_only_summary"],
        },
        "consistency_mismatches": consistency,
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n  JSON exportado: {path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Analisis de gaps Originacion: local vs Airtable")
    parser.add_argument("--json", metavar="FILE", help="Export detallado en JSON")
    parser.add_argument("--verbose", action="store_true", help="Detalle completo (no truncar listas)")
    args = parser.parse_args()

    pat = load_pat()
    if not pat:
        print("ERROR: AIRTABLE_PAT no configurado (env, VITE_AIRTABLE_PAT, o .env)")
        sys.exit(1)

    print("Cargando datos...")
    local_by_domain, local_by_name, originacion_domains = load_local_companies()

    # Fetch Airtable data
    at_raw = fetch_stakeholder_companies(pat)
    bu_raw = fetch_business_units(pat)

    # Parse AT companies
    at_parsed = parse_airtable_companies(at_raw)

    # Count AT roles
    at_capital_seeker = sum(1 for a in at_parsed if "Capital Seeker" in a["market_roles"])
    at_investor = sum(1 for a in at_parsed if "Investor" in a["market_roles"])
    at_ecosystem = sum(1 for a in at_parsed if "Ecosystem" in a["market_roles"])

    # Resolve BUs to companies
    bus_by_company_id = resolve_bus_to_companies(bu_raw, at_raw)

    # Match
    print("\nMatching empresas...")
    matched, at_unmatched = match_companies(at_parsed, local_by_domain, local_by_name)
    matched_domain = sum(1 for _, _, t in matched if t == "domain")
    matched_name = sum(1 for _, _, t in matched if t == "name")

    # Count unmatched Capital Seeker
    at_unmatched_cs = sum(1 for a in at_unmatched if "Capital Seeker" in a["market_roles"])

    summary = {
        "local_total": len(local_by_domain),
        "local_originacion": len(originacion_domains),
        "at_total": len(at_parsed),
        "at_capital_seeker": at_capital_seeker,
        "at_investor": at_investor,
        "at_ecosystem": at_ecosystem,
        "bu_total": len(bu_raw),
        "matched_domain": matched_domain,
        "matched_name": matched_name,
        "matched_total": len(matched),
        "at_unmatched": len(at_unmatched),
        "at_unmatched_cs": at_unmatched_cs,
    }

    # Gaps
    gaps = analyze_gaps(matched, at_unmatched, at_parsed, local_by_domain, originacion_domains)

    # Complementary data
    complementary = analyze_complementary(matched, bus_by_company_id, local_by_domain)

    # Consistency
    consistency = analyze_consistency(matched, local_by_domain)

    # Report
    print_report(summary, gaps, complementary, consistency, verbose=args.verbose)

    # JSON export
    if args.json:
        export_json(summary, gaps, complementary, consistency, args.json)


if __name__ == "__main__":
    main()
