#!/usr/bin/env python3
"""
verify_domain_redirects.py — Detecta dominios redirigidos/fusionados en el CRM.

Phase 1: HTTP HEAD requests asincrono para detectar redirects
Phase 2: Propuesta de merge para dominios que redirigen a otro dominio del CRM
--apply: Ejecuta el merge consolidando contactos, timeline, enrichment

Uso:
  python scripts/verify_domain_redirects.py
  python scripts/verify_domain_redirects.py --dry-run
  python scripts/verify_domain_redirects.py --domain solarpack.es
  python scripts/verify_domain_redirects.py --top 100 --batch-size 20
  python scripts/verify_domain_redirects.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, TypedDict
from urllib.parse import urlparse

import aiohttp

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANIES_FULL = os.path.join(BASE_DIR, "src", "data", "companies_full.json")
COMPANIES_COMPACT = os.path.join(BASE_DIR, "src", "data", "companies.json")
OUTPUT_FILE = os.path.join(BASE_DIR, "src", "data", "domain_redirects.json")

# ── Dominios a ignorar (no son webs de empresa) ──────────────────────────────
SKIP_SUFFIXES = {".scraper.es"}
SKIP_PREFIXES = {"mail.", "email.", "updates.", "communication.", "newsletter.",
                 "notifications.", "noreply.", "bounce.", "mailer."}
SKIP_DOMAINS = {
    "hubspotemail.net", "appspotmail.com", "microsoftonline.com",
    "googlemail.com", "outlook.com", "hotmail.com", "gmail.com",
    "yahoo.com", "yahoo.es", "live.com", "icloud.com", "aol.com",
    "protonmail.com", "proton.me", "mailchimp.com", "sendgrid.net",
    "mandrillapp.com", "amazonses.com", "mailgun.org", "postmarkapp.com",
    "constantcontact.com", "hubspot.com", "salesforce.com",
    "google.com", "microsoft.com", "apple.com",
}


# ── Terminal colors ───────────────────────────────────────────────────────────
class C:
    BOLD = "\033[1m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    DIM = "\033[2m"
    RESET = "\033[0m"


# ── Types ─────────────────────────────────────────────────────────────────────
class RedirectResult(TypedDict):
    from_domain: str
    to_domain: str
    to_in_crm: bool
    from_company: str
    to_company: str
    from_emails: int
    to_emails: int
    from_contacts: int
    to_contacts: int
    action: str  # MERGE | REBRANDED


class MergeReport(TypedDict):
    from_domain: str
    to_domain: str
    combined_contacts: int
    combined_emails: int
    richer_enrichment: str  # domain with more enrichment fields
    canonical_domain: str
    contacts_detail: list[dict[str, str]]


# ── Helpers ───────────────────────────────────────────────────────────────────
def should_skip_domain(domain: str) -> bool:
    """Check if a domain should be skipped from redirect checking."""
    domain_lower = domain.lower()
    for suffix in SKIP_SUFFIXES:
        if domain_lower.endswith(suffix):
            return True
    if domain_lower in SKIP_DOMAINS:
        return True
    for prefix in SKIP_PREFIXES:
        if domain_lower.startswith(prefix):
            return True
    return False


def extract_domain(url: str) -> str:
    """Extract the domain from a URL, stripping www. prefix."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if host.startswith("www."):
        host = host[4:]
    return host.lower()


def count_emails(company: dict[str, Any]) -> int:
    """Count total emails from timeline entries."""
    return sum(t.get("emails", 0) for t in company.get("timeline", []))


def count_enrichment_fields(enrichment: dict[str, Any] | None) -> int:
    """Count how many non-internal fields are populated in enrichment."""
    if not enrichment:
        return 0
    count = 0
    for key, val in enrichment.items():
        if key.startswith("_"):
            continue
        if val is None or val == "" or val == [] or val == {}:
            continue
        count += 1
    return count


def deduplicate_contacts(
    contacts_a: list[dict[str, Any]],
    contacts_b: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge two contact lists, dedup by email, keep richest role info."""
    by_email: dict[str, dict[str, Any]] = {}
    for c in contacts_a + contacts_b:
        email = (c.get("email") or "").lower().strip()
        if not email:
            continue
        existing = by_email.get(email)
        if existing is None:
            by_email[email] = dict(c)
        else:
            # Keep the one with a better role
            existing_role = (existing.get("role") or "").strip()
            new_role = (c.get("role") or "").strip()
            if (not existing_role or existing_role == "No identificado" or existing_role == "nan") \
                    and new_role and new_role != "No identificado" and new_role != "nan":
                by_email[email] = dict(c)
            # Keep nombre/apellido if missing
            if not existing.get("nombre") and c.get("nombre"):
                by_email[email]["nombre"] = c["nombre"]
            if not existing.get("apellido") and c.get("apellido"):
                by_email[email]["apellido"] = c["apellido"]
    return list(by_email.values())


def merge_timelines(
    tl_a: list[dict[str, Any]],
    tl_b: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge timelines by quarter, summing emails and keeping longer summaries."""
    by_quarter: dict[str, dict[str, Any]] = {}
    for t in tl_a + tl_b:
        q = t.get("quarter", "")
        if not q:
            continue
        if q in by_quarter:
            by_quarter[q]["emails"] = by_quarter[q].get("emails", 0) + t.get("emails", 0)
            existing_summary = by_quarter[q].get("summary", "") or ""
            new_summary = t.get("summary", "") or ""
            if len(new_summary) > len(existing_summary):
                by_quarter[q]["summary"] = new_summary
        else:
            by_quarter[q] = dict(t)
    return sorted(by_quarter.values(), key=lambda x: x.get("quarter", ""))


def merge_sources(
    src_a: dict[str, Any] | list[Any],
    src_b: dict[str, Any] | list[Any],
) -> dict[str, Any]:
    """Merge employee source dicts. Handle both dict and list formats."""
    # Normalize to dict format
    def to_dict(src: dict | list) -> dict[str, Any]:
        if isinstance(src, list):
            result = {}
            for item in src:
                if isinstance(item, dict) and "employee" in item:
                    result[item["employee"]] = item
            return result
        return src or {}

    merged = dict(to_dict(src_a))
    for emp, data in to_dict(src_b).items():
        if emp not in merged:
            merged[emp] = data
        else:
            # Sum interactions
            existing = merged[emp]
            if isinstance(existing, dict) and isinstance(data, dict):
                existing["interactions"] = existing.get("interactions", 0) + data.get("interactions", 0)
                # Keep earliest firstDate
                if data.get("firstDate") and (not existing.get("firstDate") or data["firstDate"] < existing["firstDate"]):
                    existing["firstDate"] = data["firstDate"]
                # Keep latest lastDate
                if data.get("lastDate") and (not existing.get("lastDate") or data["lastDate"] > existing["lastDate"]):
                    existing["lastDate"] = data["lastDate"]
                # Merge contacts within source
                if "contacts" in data and "contacts" in existing:
                    existing["contacts"] = deduplicate_contacts(
                        existing.get("contacts", []), data.get("contacts", [])
                    )
    return merged


def merge_enrichments(
    enr_a: dict[str, Any] | None,
    enr_b: dict[str, Any] | None,
) -> dict[str, Any]:
    """Merge enrichments, preferring the one with more fields. Combine scraper data."""
    if not enr_a and not enr_b:
        return {}
    if not enr_a:
        return dict(enr_b)  # type: ignore
    if not enr_b:
        return dict(enr_a)

    count_a = count_enrichment_fields(enr_a)
    count_b = count_enrichment_fields(enr_b)

    # Use the richer one as base
    if count_a >= count_b:
        merged = dict(enr_a)
        other = enr_b
    else:
        merged = dict(enr_b)
        other = enr_a

    # Fill in missing fields from the other
    for key, val in other.items():
        if key.startswith("_"):
            continue
        if key not in merged or merged[key] is None or merged[key] == "" or merged[key] == []:
            merged[key] = val

    # Combine scraper data if both have it
    scraper_a = enr_a.get("scraper")
    scraper_b = enr_b.get("scraper")
    if scraper_a and scraper_b:
        merged["scraper"] = merge_scraper_data(scraper_a, scraper_b)

    return merged


def merge_scraper_data(
    sc_a: dict[str, Any],
    sc_b: dict[str, Any],
) -> dict[str, Any]:
    """Combine scraper enrichment from two entries."""
    projects_a = sc_a.get("projects", [])
    projects_b = sc_b.get("projects", [])

    # Dedup projects by name
    seen = set()
    combined_projects = []
    for p in projects_a + projects_b:
        name = p.get("name", "")
        if name not in seen:
            seen.add(name)
            combined_projects.append(p)

    techs = sorted(set((sc_a.get("technologies") or []) + (sc_b.get("technologies") or [])))
    statuses = sorted(set((sc_a.get("statuses") or []) + (sc_b.get("statuses") or [])))
    spv_names = sorted(set((sc_a.get("spv_names") or []) + (sc_b.get("spv_names") or [])))

    return {
        "n_projects": len(combined_projects),
        "mw_total": sc_a.get("mw_total", 0) + sc_b.get("mw_total", 0),
        "mwp_total": sc_a.get("mwp_total", 0) + sc_b.get("mwp_total", 0),
        "capex_eur": sc_a.get("capex_eur", 0) + sc_b.get("capex_eur", 0),
        "technologies": techs,
        "statuses": statuses,
        "n_spvs": len(spv_names),
        "spv_names": spv_names,
        "projects": combined_projects,
        "matched_parent": sc_a.get("matched_parent") or sc_b.get("matched_parent"),
    }


# ── Phase 1: Domain redirect detection ───────────────────────────────────────
async def check_domain_redirect(
    session: aiohttp.ClientSession,
    domain: str,
    timeout: int,
    semaphore: asyncio.Semaphore,
) -> tuple[str, str | None, str | None]:
    """
    Check if a domain redirects to a different domain.
    Returns (original_domain, final_domain_or_None, error_or_None).
    """
    async with semaphore:
        url = f"https://{domain}"
        try:
            async with session.head(
                url,
                timeout=aiohttp.ClientTimeout(total=timeout),
                allow_redirects=True,
                ssl=False,
            ) as resp:
                final_url = str(resp.url)
                final_domain = extract_domain(final_url)
                if final_domain and final_domain != domain and final_domain != f"www.{domain}":
                    return (domain, final_domain, None)
                return (domain, None, None)
        except Exception:
            # Try HTTP fallback
            try:
                url_http = f"http://{domain}"
                async with session.head(
                    url_http,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                    allow_redirects=True,
                    ssl=False,
                ) as resp:
                    final_url = str(resp.url)
                    final_domain = extract_domain(final_url)
                    if final_domain and final_domain != domain and final_domain != f"www.{domain}":
                        return (domain, final_domain, None)
                    return (domain, None, None)
            except Exception as e:
                error_type = type(e).__name__
                return (domain, None, error_type)


async def check_all_domains(
    domains: list[str],
    batch_size: int,
    timeout: int,
) -> list[tuple[str, str | None, str | None]]:
    """Check all domains for redirects with concurrency control."""
    semaphore = asyncio.Semaphore(batch_size)
    connector = aiohttp.TCPConnector(limit=batch_size, ssl=False)
    results: list[tuple[str, str | None, str | None]] = []

    async with aiohttp.ClientSession(
        connector=connector,
        headers={"User-Agent": "Mozilla/5.0 (compatible; Alter5-BI/1.0)"},
    ) as session:
        tasks = [
            check_domain_redirect(session, domain, timeout, semaphore)
            for domain in domains
        ]

        completed = 0
        total = len(tasks)
        for coro in asyncio.as_completed(tasks):
            result = await coro
            results.append(result)
            completed += 1
            if completed % 100 == 0 or completed == total:
                pct = completed * 100 // total
                print(f"  {C.DIM}[{completed}/{total}] {pct}% checked...{C.RESET}")

    return results


# ── Phase 2: Merge proposal ──────────────────────────────────────────────────
def generate_merge_report(
    redirect: RedirectResult,
    companies: dict[str, Any],
) -> MergeReport | None:
    """Generate a detailed merge report for a MERGE candidate."""
    from_domain = redirect["from_domain"]
    to_domain = redirect["to_domain"]

    from_comp = companies.get(from_domain, {})
    to_comp = companies.get(to_domain, {})

    if not from_comp or not to_comp:
        return None

    from_contacts = from_comp.get("contacts", [])
    to_contacts = to_comp.get("contacts", [])
    merged_contacts = deduplicate_contacts(from_contacts, to_contacts)

    from_emails = count_emails(from_comp)
    to_emails = count_emails(to_comp)

    from_enr_count = count_enrichment_fields(from_comp.get("enrichment"))
    to_enr_count = count_enrichment_fields(to_comp.get("enrichment"))
    richer = from_domain if from_enr_count > to_enr_count else to_domain

    contacts_detail = []
    for c in merged_contacts:
        contacts_detail.append({
            "name": c.get("name", ""),
            "email": c.get("email", ""),
            "role": c.get("role", "No identificado"),
            "source": from_domain if any(
                fc.get("email", "").lower() == (c.get("email") or "").lower()
                for fc in from_contacts
            ) else to_domain,
        })

    return {
        "from_domain": from_domain,
        "to_domain": to_domain,
        "combined_contacts": len(merged_contacts),
        "combined_emails": from_emails + to_emails,
        "richer_enrichment": richer,
        "canonical_domain": to_domain,
        "contacts_detail": contacts_detail,
    }


# ── Phase 3: Apply merge ─────────────────────────────────────────────────────
def apply_merges(
    redirects: list[RedirectResult],
    full_data: dict[str, Any],
    compact: dict[str, Any],
) -> tuple[int, list[str]]:
    """
    Apply MERGE operations: consolidate source into target domain.
    Returns (merge_count, list of removed domains).
    """
    companies = full_data["companies"]
    merge_candidates = [r for r in redirects if r["action"] == "MERGE"]
    merged_count = 0
    removed_domains: list[str] = []

    for redirect in merge_candidates:
        from_domain = redirect["from_domain"]
        to_domain = redirect["to_domain"]

        from_comp = companies.get(from_domain)
        to_comp = companies.get(to_domain)

        if not from_comp or not to_comp:
            print(f"  {C.YELLOW}SKIP{C.RESET} {from_domain} -> {to_domain} (missing entry)")
            continue

        print(f"  {C.GREEN}MERGE{C.RESET} {from_domain} -> {to_domain}")

        # Merge contacts
        to_comp["contacts"] = deduplicate_contacts(
            to_comp.get("contacts", []),
            from_comp.get("contacts", []),
        )
        to_comp["nContacts"] = len(to_comp["contacts"])

        # Merge timeline
        to_comp["timeline"] = merge_timelines(
            to_comp.get("timeline", []),
            from_comp.get("timeline", []),
        )

        # Recalculate interactions
        to_comp["interactions"] = (to_comp.get("interactions", 0) or 0) + (from_comp.get("interactions", 0) or 0)

        # Merge context
        from_ctx = (from_comp.get("context") or "").strip()
        to_ctx = (to_comp.get("context") or "").strip()
        if from_ctx and to_ctx:
            to_comp["context"] = to_ctx + " | " + from_ctx
        elif from_ctx:
            to_comp["context"] = from_ctx

        # Merge sources
        to_comp["sources"] = merge_sources(
            to_comp.get("sources", {}),
            from_comp.get("sources", {}),
        )

        # Merge subjects
        to_subjects = to_comp.get("subjects", []) or []
        from_subjects = from_comp.get("subjects", []) or []
        to_comp["subjects"] = list(set(to_subjects + from_subjects))

        # Merge dated_subjects
        to_ds = to_comp.get("dated_subjects", []) or []
        from_ds = from_comp.get("dated_subjects", []) or []
        to_comp["dated_subjects"] = to_ds + from_ds

        # Merge snippets
        to_snip = to_comp.get("snippets", []) or []
        from_snip = from_comp.get("snippets", []) or []
        to_comp["snippets"] = to_snip + from_snip

        # Merge enrichment
        to_comp["enrichment"] = merge_enrichments(
            to_comp.get("enrichment"),
            from_comp.get("enrichment"),
        )

        # Add aliases and merge tracking
        enrichment = to_comp["enrichment"]
        aliases = enrichment.get("aliases", [])
        if from_domain not in aliases:
            aliases.append(from_domain)
        enrichment["aliases"] = aliases
        merged_from = enrichment.get("_merged_from", [])
        merged_from.append({
            "domain": from_domain,
            "merged_at": datetime.now(timezone.utc).isoformat(),
            "from_name": from_comp.get("name", ""),
        })
        enrichment["_merged_from"] = merged_from

        # Update dates
        from_first = from_comp.get("firstDate", "")
        to_first = to_comp.get("firstDate", "")
        if from_first and (not to_first or from_first < to_first):
            to_comp["firstDate"] = from_first

        from_last = from_comp.get("lastDate", "")
        to_last = to_comp.get("lastDate", "")
        if from_last and (not to_last or from_last > to_last):
            to_comp["lastDate"] = from_last

        # Update employee sources string
        from_sources_keys = set()
        if isinstance(from_comp.get("sources"), dict):
            from_sources_keys = set(from_comp["sources"].keys())
        to_sources_keys = set()
        if isinstance(to_comp.get("sources"), dict):
            to_sources_keys = set(to_comp["sources"].keys())
        all_employees = sorted(from_sources_keys | to_sources_keys)
        # Keep employeeSources as a comma-separated string (used in compact format)

        # Remove old domain entry
        del companies[from_domain]
        removed_domains.append(from_domain)
        merged_count += 1

    # Rebuild compact format from scratch
    if merged_count > 0:
        _rebuild_compact(full_data, compact)

    return merged_count, removed_domains


def _rebuild_compact(
    full_data: dict[str, Any],
    compact: dict[str, Any],
) -> None:
    """Rebuild companies.json compact format from companies_full.json data."""
    companies = full_data["companies"]
    new_r: list[list[Any]] = []
    new_d: dict[str, list[Any]] = {}

    for domain, comp in companies.items():
        idx = len(new_r)

        # Compute employee sources string
        sources = comp.get("sources", {})
        if isinstance(sources, dict):
            emp_str = ",".join(sorted(sources.keys()))
        else:
            emp_str = ""

        record = [
            comp.get("name", ""),
            domain,
            comp.get("sectors", ""),
            comp.get("nContacts", 0),
            comp.get("interactions", 0),
            comp.get("relType", ""),
            comp.get("firstDate", ""),
            comp.get("lastDate", ""),
            emp_str,
        ]
        new_r.append(record)

        # Build detail
        contacts_compact = []
        for c in comp.get("contacts", []):
            contacts_compact.append([
                c.get("name", ""),
                c.get("role", ""),
                c.get("email", ""),
                c.get("nombre", ""),
                c.get("apellido", ""),
            ])

        timeline_compact = []
        for t in comp.get("timeline", []):
            entry = [t.get("quarter", ""), t.get("emails", 0)]
            summary = t.get("summary", "")
            if summary:
                entry.append(summary)
            timeline_compact.append(entry)

        context = comp.get("context", "")

        sources_compact = []
        if isinstance(sources, dict):
            for emp_id, src_data in sorted(sources.items()):
                if isinstance(src_data, dict):
                    sources_compact.append([emp_id, src_data.get("interactions", 0)])
                else:
                    sources_compact.append([emp_id, 0])

        subjects = comp.get("subjects", []) or []
        enrichment = comp.get("enrichment") or {}

        dated_subjects_compact = []
        for ds in comp.get("dated_subjects", []) or []:
            if isinstance(ds, list):
                # Already in compact format [date, subject, extract?]
                dated_subjects_compact.append(ds)
            elif isinstance(ds, dict):
                entry = [ds.get("date", ""), ds.get("subject", "")]
                extract_text = ds.get("extract", "")
                if extract_text:
                    entry.append(extract_text)
                dated_subjects_compact.append(entry)

        new_d[str(idx)] = [
            contacts_compact,
            timeline_compact,
            context,
            sources_compact,
            subjects,
            enrichment,
            dated_subjects_compact,
        ]

    compact["r"] = new_r
    compact["d"] = new_d


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Detecta dominios redirigidos/fusionados en el CRM"
    )
    parser.add_argument("--dry-run", action="store_true", help="Solo reportar, no escribir archivos")
    parser.add_argument("--batch-size", type=int, default=50, help="Requests concurrentes (default 50)")
    parser.add_argument("--timeout", type=int, default=5, help="Timeout por request en segundos (default 5)")
    parser.add_argument("--domain", type=str, help="Testear un solo dominio")
    parser.add_argument("--top", type=int, help="Solo comprobar top N empresas por emails")
    parser.add_argument("--apply", action="store_true", help="Aplicar merges en companies_full.json y companies.json")
    parser.add_argument("--from-cache", action="store_true", help="Usar domain_redirects.json existente (no re-escanear)")
    args = parser.parse_args()

    print(f"\n{C.BOLD}{'='*60}{C.RESET}")
    print(f"{C.BOLD}  Domain Redirect Checker — Alter5 CRM{C.RESET}")
    print(f"{C.BOLD}{'='*60}{C.RESET}\n")

    # Load data
    print(f"{C.CYAN}Loading companies_full.json...{C.RESET}")
    with open(COMPANIES_FULL, "r", encoding="utf-8") as f:
        full_data = json.load(f)
    companies: dict[str, Any] = full_data["companies"]
    print(f"  Total companies: {len(companies)}")

    # Also load compact for potential merge
    print(f"{C.CYAN}Loading companies.json (compact)...{C.RESET}")
    with open(COMPANIES_COMPACT, "r", encoding="utf-8") as f:
        compact = json.load(f)
    print(f"  Compact records: {len(compact['r'])}")

    # Build domain set
    all_domains = set(companies.keys())

    # Filter domains to check
    domains_with_emails: list[tuple[str, int]] = []
    skipped_scraper = 0
    skipped_generic = 0

    for domain in all_domains:
        if should_skip_domain(domain):
            if domain.endswith(".scraper.es"):
                skipped_scraper += 1
            else:
                skipped_generic += 1
            continue
        email_count = count_emails(companies[domain])
        # Also check enrichment._email_count
        enr = companies[domain].get("enrichment") or {}
        email_count = max(email_count, enr.get("_email_count", 0))
        domains_with_emails.append((domain, email_count))

    # Sort by email count descending
    domains_with_emails.sort(key=lambda x: x[1], reverse=True)

    print(f"  Skipped .scraper.es: {skipped_scraper}")
    print(f"  Skipped generic: {skipped_generic}")
    print(f"  Domains to check: {len(domains_with_emails)}")

    # Apply --domain filter
    if args.domain:
        domains_with_emails = [(d, e) for d, e in domains_with_emails if d == args.domain]
        if not domains_with_emails:
            # Maybe domain was skipped, force it
            email_count = count_emails(companies.get(args.domain, {}))
            domains_with_emails = [(args.domain, email_count)]
        print(f"  Filtered to single domain: {args.domain}")

    # Apply --top filter
    if args.top:
        domains_with_emails = domains_with_emails[:args.top]
        print(f"  Limited to top {args.top} by email count")

    domains_to_check = [d for d, _ in domains_with_emails]

    # --from-cache: load redirects from domain_redirects.json instead of scanning
    if args.from_cache:
        print(f"\n{C.CYAN}Loading cached results from {OUTPUT_FILE}...{C.RESET}")
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            cached = json.load(f)
        redirects: list[RedirectResult] = cached["redirects"]
        errors = cached.get("errors", 0)
        no_redirect = cached.get("no_redirect", 0)
        domains_to_check = [r["from_domain"] for r in redirects]  # for summary
        print(f"  Loaded {len(redirects)} redirects ({cached.get('checked_at', '?')})")
    else:
        print(f"\n{C.CYAN}Phase 1: Checking {len(domains_to_check)} domains for redirects...{C.RESET}")
        print(f"  Batch size: {args.batch_size}, Timeout: {args.timeout}s\n")

        # Run async checks
        results = asyncio.run(check_all_domains(domains_to_check, args.batch_size, args.timeout))

        # Process results
        redirects: list[RedirectResult] = []
        errors = 0
        no_redirect = 0

        for original, final, error in results:
            if error:
                errors += 1
                continue
            if final is None:
                no_redirect += 1
                continue

            # Redirect detected
            from_comp = companies.get(original, {})
            to_comp = companies.get(final, {})
            to_in_crm = final in all_domains

            redirect: RedirectResult = {
                "from_domain": original,
                "to_domain": final,
                "to_in_crm": to_in_crm,
                "from_company": from_comp.get("name", original),
                "to_company": to_comp.get("name", final) if to_in_crm else final,
                "from_emails": count_emails(from_comp),
                "to_emails": count_emails(to_comp) if to_in_crm else 0,
                "from_contacts": len(from_comp.get("contacts", [])),
                "to_contacts": len(to_comp.get("contacts", [])) if to_in_crm else 0,
                "action": "MERGE" if to_in_crm else "REBRANDED",
            }
            redirects.append(redirect)

        # Sort: MERGE first, then by email count
        redirects.sort(key=lambda r: (0 if r["action"] == "MERGE" else 1, -r["from_emails"]))

    # Phase 1 summary
    merges = [r for r in redirects if r["action"] == "MERGE"]
    rebranded = [r for r in redirects if r["action"] == "REBRANDED"]

    print(f"\n{C.BOLD}{'='*60}{C.RESET}")
    print(f"{C.BOLD}  Phase 1 Results{C.RESET}")
    print(f"{C.BOLD}{'='*60}{C.RESET}")
    print(f"  Checked:      {len(domains_to_check)}")
    print(f"  No redirect:  {no_redirect}")
    print(f"  Errors:       {errors}")
    print(f"  {C.GREEN}MERGE:        {len(merges)}{C.RESET}")
    print(f"  {C.YELLOW}REBRANDED:    {len(rebranded)}{C.RESET}")
    print(f"  Total redirects: {len(redirects)}")

    # Print MERGE candidates
    if merges:
        print(f"\n{C.BOLD}{C.GREEN}MERGE candidates (both domains in CRM):{C.RESET}")
        for r in merges:
            print(f"  {C.GREEN}>{C.RESET} {r['from_domain']} -> {C.BOLD}{r['to_domain']}{C.RESET}")
            print(f"    {r['from_company']} ({r['from_emails']} emails, {r['from_contacts']} contacts)")
            print(f"    -> {r['to_company']} ({r['to_emails']} emails, {r['to_contacts']} contacts)")

    # Print REBRANDED
    if rebranded:
        print(f"\n{C.BOLD}{C.YELLOW}REBRANDED (target domain not in CRM):{C.RESET}")
        for r in rebranded[:30]:  # Limit output
            print(f"  {C.YELLOW}>{C.RESET} {r['from_domain']} -> {r['to_domain']}")
            print(f"    {r['from_company']} ({r['from_emails']} emails)")
        if len(rebranded) > 30:
            print(f"  {C.DIM}... and {len(rebranded) - 30} more{C.RESET}")

    # Phase 2: Merge reports
    if merges:
        print(f"\n{C.BOLD}{'='*60}{C.RESET}")
        print(f"{C.BOLD}  Phase 2: Merge Reports{C.RESET}")
        print(f"{C.BOLD}{'='*60}{C.RESET}")

        merge_reports: list[MergeReport] = []
        for r in merges:
            report = generate_merge_report(r, companies)
            if report:
                merge_reports.append(report)
                print(f"\n  {C.BOLD}{r['from_domain']} -> {r['to_domain']}{C.RESET}")
                print(f"    Combined contacts: {report['combined_contacts']}")
                print(f"    Combined emails:   {report['combined_emails']}")
                print(f"    Richer enrichment: {report['richer_enrichment']}")
                print(f"    Canonical domain:  {C.GREEN}{report['canonical_domain']}{C.RESET}")
                print(f"    Contacts:")
                for c in report["contacts_detail"]:
                    role_str = c['role'] if c['role'] != 'No identificado' else C.DIM + c['role'] + C.RESET
                    print(f"      - {c['name']} <{c['email']}> [{role_str}] (from {c['source']})")

    # Save results
    output = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "total_checked": len(domains_to_check),
        "redirects": redirects,
        "errors": errors,
        "no_redirect": no_redirect,
    }

    if not args.dry_run:
        print(f"\n{C.CYAN}Saving results to {OUTPUT_FILE}...{C.RESET}")
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"  Written {OUTPUT_FILE}")

    # Phase 3: Apply merges
    if args.apply and merges:
        if args.dry_run:
            print(f"\n{C.YELLOW}--dry-run active, skipping --apply{C.RESET}")
        else:
            print(f"\n{C.BOLD}{'='*60}{C.RESET}")
            print(f"{C.BOLD}  Phase 3: Applying Merges{C.RESET}")
            print(f"{C.BOLD}{'='*60}{C.RESET}")

            merged_count, removed = apply_merges(redirects, full_data, compact)

            if merged_count > 0:
                print(f"\n{C.CYAN}Writing companies_full.json...{C.RESET}")
                with open(COMPANIES_FULL, "w", encoding="utf-8") as f:
                    json.dump(full_data, f, ensure_ascii=False)
                size_full = os.path.getsize(COMPANIES_FULL) / (1024 * 1024)
                print(f"  Written ({size_full:.1f} MB)")

                print(f"{C.CYAN}Writing companies.json (compact)...{C.RESET}")
                with open(COMPANIES_COMPACT, "w", encoding="utf-8") as f:
                    json.dump(compact, f, ensure_ascii=False)
                size_compact = os.path.getsize(COMPANIES_COMPACT) / (1024 * 1024)
                print(f"  Written ({size_compact:.1f} MB)")

                print(f"\n{C.GREEN}Merged {merged_count} companies.{C.RESET}")
                print(f"  Removed domains: {', '.join(removed)}")
                print(f"  New total: {len(full_data['companies'])} companies")
            else:
                print(f"\n{C.YELLOW}No merges applied.{C.RESET}")
    elif args.apply and not merges:
        print(f"\n{C.YELLOW}No MERGE candidates found.{C.RESET}")

    # Final summary
    print(f"\n{C.BOLD}{'='*60}{C.RESET}")
    print(f"{C.BOLD}  Summary{C.RESET}")
    print(f"{C.BOLD}{'='*60}{C.RESET}")
    print(f"  Domains checked:   {len(domains_to_check)}")
    print(f"  MERGE candidates:  {C.GREEN}{len(merges)}{C.RESET}")
    print(f"  REBRANDED:         {C.YELLOW}{len(rebranded)}{C.RESET}")
    print(f"  Errors/timeouts:   {errors}")
    if not args.dry_run:
        print(f"  Results saved to:  {OUTPUT_FILE}")
    else:
        print(f"  {C.DIM}(dry-run, no files written){C.RESET}")
    print()


if __name__ == "__main__":
    main()
