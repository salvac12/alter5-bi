#!/usr/bin/env python3
"""
===============================================================
  Alter5 BI -- Ghost Company Detector
===============================================================

  Detects closed, rebranded, or dead-domain companies in the CRM.

  Phase 1: DNS resolution check for all domains
  Phase 2: Gemini research for NXDOMAIN companies with recent activity
  Phase 3: Propose actions (MERGE / RENAME / ARCHIVE / KEEP / CLEAN)

  Usage:
    python scripts/detect_ghost_companies.py                    # DNS + Gemini top 50
    python scripts/detect_ghost_companies.py --dns-only         # only DNS check
    python scripts/detect_ghost_companies.py --top 100          # research top 100
    python scripts/detect_ghost_companies.py --dry-run          # don't modify files
    python scripts/detect_ghost_companies.py --from-cache       # skip DNS, use cached
    python scripts/detect_ghost_companies.py --category recent_activity
    python scripts/detect_ghost_companies.py --apply            # apply proposed actions

  Estimated time: DNS ~2min (5k domains), Gemini ~3s per domain
===============================================================
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, TypedDict

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

COMPANIES_FULL = os.path.join(PROJECT_DIR, "src", "data", "companies_full.json")
COMPANIES_COMPACT = os.path.join(PROJECT_DIR, "src", "data", "companies.json")
GHOST_FILE = os.path.join(PROJECT_DIR, "src", "data", "ghost_companies.json")

# ── Gemini config ──────────────────────────────────────────────────────────────
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_RPM_DELAY = float(os.environ.get("GEMINI_RPM_DELAY", "3"))

# SSL context
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

# ── Terminal colors ────────────────────────────────────────────────────────────
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


# ── Skip lists ─────────────────────────────────────────────────────────────────
SKIP_SUFFIXES = {".scraper.es"}
SKIP_PREFIXES = {
    "mail.", "email.", "updates.", "communication.", "newsletter.",
    "notifications.", "noreply.", "bounce.", "mailer.",
}
SKIP_DOMAINS = {
    "hubspotemail.net", "appspotmail.com", "microsoftonline.com",
    "googlemail.com", "outlook.com", "hotmail.com", "gmail.com",
    "yahoo.com", "yahoo.es", "live.com", "icloud.com", "aol.com",
    "protonmail.com", "proton.me", "mailchimp.com", "sendgrid.net",
    "mandrillapp.com", "amazonses.com", "mailgun.org", "postmarkapp.com",
    "constantcontact.com", "hubspot.com", "salesforce.com",
    "google.com", "microsoft.com", "apple.com",
}

# Servicios/herramientas que no son relaciones comerciales reales
TOOL_SERVICE_KEYWORDS = {
    "hubspot", "atlassian", "mailchimp", "notion", "gitlab", "read.ai",
    "pipedrive", "apollo", "eventbrite", "zoom", "calendly", "docusign",
    "slack", "zapier", "stripe", "intercom", "datadog", "github", "vercel",
    "trello", "asana", "monday", "airtable", "figma", "canva", "miro",
    "loom", "typeform", "surveymonkey", "jotform", "formstack",
    "twilio", "segment", "mixpanel", "amplitude", "hotjar", "fullstory",
    "zendesk", "freshdesk", "crisp", "drift", "gong", "chorus",
    "dropbox", "box", "wetransfer", "clickup", "basecamp",
    "sentry", "pagerduty", "opsgenie", "statuspage", "jira",
    "confluence", "bitbucket", "circleci", "travisci", "netlify",
    "cloudflare", "aws", "heroku", "digitalocean", "linode",
    "mailjet", "sendinblue", "brevo", "convertkit", "substack",
    "linkedin", "twitter", "facebook", "instagram", "tiktok",
    "whatsapp", "telegram", "signal", "discord",
    "grammarly", "1password", "lastpass", "bitwarden",
    "unsplash", "pexels", "shutterstock",
    "calendarhero", "doodle", "acuityscheduling",
    "coda", "quip", "smartsheet",
}

# Sufijos compuestos de ccTLD (no cuentan como subdomain)
COMPOUND_TLDS = {
    ".co.uk", ".co.jp", ".co.kr", ".co.nz", ".co.za", ".co.in",
    ".com.es", ".com.br", ".com.mx", ".com.ar", ".com.co", ".com.au",
    ".com.tr", ".com.cn", ".com.sg", ".com.hk",
    ".org.uk", ".org.es",
    ".net.au", ".net.br",
    ".ac.uk", ".gov.uk",
}

# Fecha de corte para "old_activity" (2 anios antes de hoy 2026-03-14)
CUTOFF_DATE = "2024-03-14"


# ── Types ──────────────────────────────────────────────────────────────────────
class GhostEntry(TypedDict, total=False):
    domain: str
    name: str
    category: str  # subdomain | tool_service | no_activity | old_activity | recent_activity
    email_count: int
    interactions: int
    last_date: str
    first_date: str
    dns_status: str  # nxdomain | ok
    # Gemini research (Phase 2)
    research: dict[str, Any] | None
    proposed_action: str  # MERGE | RENAME | ARCHIVE | KEEP | CLEAN
    action_detail: str


# ── Helpers ────────────────────────────────────────────────────────────────────
def should_skip_domain(domain: str) -> bool:
    """Check if domain should be skipped from ghost detection."""
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


def count_emails(company: dict[str, Any]) -> int:
    """Email count: max of enrichment._email_count and timeline sum."""
    timeline_sum = sum(t.get("emails", 0) for t in company.get("timeline", []))
    enrichment_count = (company.get("enrichment") or {}).get("_email_count", 0) or 0
    return max(enrichment_count, timeline_sum)


def is_subdomain(domain: str) -> bool:
    """Detect if domain is a subdomain (3+ parts, excluding compound TLDs)."""
    domain_lower = domain.lower()
    # Quitar compound TLDs antes de contar
    for tld in COMPOUND_TLDS:
        if domain_lower.endswith(tld):
            base = domain_lower[: -len(tld)]
            return "." in base
    parts = domain_lower.split(".")
    return len(parts) >= 3


def is_tool_service(domain: str) -> bool:
    """Detect if domain belongs to a tool/service."""
    domain_lower = domain.lower()
    for keyword in TOOL_SERVICE_KEYWORDS:
        if keyword in domain_lower:
            return True
    return False


def classify_nxdomain(domain: str, company: dict[str, Any]) -> str:
    """Classify an NXDOMAIN company into a category."""
    if is_subdomain(domain):
        return "subdomain"
    if is_tool_service(domain):
        return "tool_service"

    last_date = company.get("lastDate", "") or ""
    interactions = company.get("interactions", 0) or 0
    emails = count_emails(company)

    if interactions == 0 and emails == 0:
        return "no_activity"
    if last_date and last_date < CUTOFF_DATE:
        return "old_activity"
    return "recent_activity"


# ── Phase 1: DNS Check ────────────────────────────────────────────────────────
async def dns_resolve(domain: str, semaphore: asyncio.Semaphore, timeout: float = 5.0) -> tuple[str, bool]:
    """Resolve a domain via DNS. Returns (domain, resolves_ok)."""
    async with semaphore:
        loop = asyncio.get_event_loop()
        try:
            await asyncio.wait_for(
                loop.run_in_executor(None, socket.getaddrinfo, domain, None),
                timeout=timeout,
            )
            return (domain, True)
        except (socket.gaierror, asyncio.TimeoutError, OSError):
            return (domain, False)


async def phase1_dns_check(
    companies: dict[str, Any],
    concurrency: int = 20,
) -> tuple[list[str], list[str]]:
    """
    DNS-resolve all domains. Returns (ok_domains, nxdomain_domains).
    """
    domains_to_check: list[str] = []
    skipped = 0

    for domain in companies:
        if should_skip_domain(domain):
            skipped += 1
            continue
        # Skip domains already with aliases (already merged)
        enrichment = companies[domain].get("enrichment") or {}
        if enrichment.get("aliases"):
            skipped += 1
            continue
        domains_to_check.append(domain)

    print(f"\n{C.BOLD}Phase 1: DNS Resolution{C.RESET}")
    print(f"  Domains to check: {C.CYAN}{len(domains_to_check)}{C.RESET}")
    print(f"  Skipped: {C.DIM}{skipped}{C.RESET}")

    semaphore = asyncio.Semaphore(concurrency)
    tasks = [dns_resolve(d, semaphore) for d in domains_to_check]

    ok_domains: list[str] = []
    nxdomain_domains: list[str] = []

    done = 0
    total = len(tasks)

    for coro in asyncio.as_completed(tasks):
        domain, resolves = await coro
        done += 1
        if resolves:
            ok_domains.append(domain)
        else:
            nxdomain_domains.append(domain)
        if done % 200 == 0 or done == total:
            print(f"  Progress: {done}/{total} ({len(nxdomain_domains)} NXDOMAIN so far)", end="\r")

    print(f"\n  {C.GREEN}OK{C.RESET}: {len(ok_domains)}  |  {C.RED}NXDOMAIN{C.RESET}: {len(nxdomain_domains)}")
    return ok_domains, nxdomain_domains


def classify_nxdomains(
    nxdomain_domains: list[str],
    companies: dict[str, Any],
) -> dict[str, list[GhostEntry]]:
    """Classify NXDOMAIN domains into categories."""
    categories: dict[str, list[GhostEntry]] = {
        "recent_activity": [],
        "old_activity": [],
        "no_activity": [],
        "subdomain": [],
        "tool_service": [],
    }

    for domain in nxdomain_domains:
        comp = companies.get(domain, {})
        cat = classify_nxdomain(domain, comp)
        entry: GhostEntry = {
            "domain": domain,
            "name": comp.get("name", domain),
            "category": cat,
            "email_count": count_emails(comp),
            "interactions": comp.get("interactions", 0) or 0,
            "last_date": comp.get("lastDate", "") or "",
            "first_date": comp.get("firstDate", "") or "",
            "dns_status": "nxdomain",
            "research": None,
            "proposed_action": "",
            "action_detail": "",
        }
        categories[cat].append(entry)

    # Ordenar recent_activity y old_activity por email_count desc
    for cat in ("recent_activity", "old_activity"):
        categories[cat].sort(key=lambda e: e["email_count"], reverse=True)

    print(f"\n  {C.BOLD}Classification:{C.RESET}")
    for cat, entries in categories.items():
        color = {
            "recent_activity": C.RED,
            "old_activity": C.YELLOW,
            "no_activity": C.DIM,
            "subdomain": C.CYAN,
            "tool_service": C.MAGENTA,
        }.get(cat, C.RESET)
        print(f"    {color}{cat}{C.RESET}: {len(entries)}")

    return categories


# ── Phase 2: Gemini Research ──────────────────────────────────────────────────
def research_company_gemini(
    domain: str,
    name: str,
    context: str,
    enrichment: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Use Gemini + Google Search to research a potentially dead company."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print(f"  {C.YELLOW}WARN{C.RESET} GEMINI_API_KEY not set, skipping research")
        return None

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}"

    role = (enrichment or {}).get("role", "Unknown")
    segment = (enrichment or {}).get("segment", "")
    comp_type = (enrichment or {}).get("type", "")

    prompt = f"""Investiga la empresa "{name}" (dominio: {domain}).
Su dominio ya no resuelve en DNS. Necesito saber que le paso.

Informacion del CRM:
- Rol: {role}
- Segmento: {segment}
- Tipo: {comp_type}
- Contexto: {context[:500] if context else "N/A"}

Busca en Google:
1. Esta empresa sigue activa? Tiene una web diferente?
2. Fue rebranded? Cual es el nuevo nombre/dominio?
3. Fue adquirida? Por quien?
4. Cerro/quebro?

Responde SOLO con JSON valido (sin markdown):
{{
  "status": "active|rebranded|acquired|closed|unknown",
  "new_name": "Nuevo nombre o null",
  "new_domain": "nuevodominio.com o null",
  "acquirer": "Empresa adquiriente o null",
  "acquirer_domain": "dominio.com del adquiriente o null",
  "explanation": "Breve explicacion de que paso",
  "confidence": "alta|media|baja",
  "sources": "URLs consultadas"
}}"""

    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0.2},
    }).encode("utf-8")

    req = urllib.request.Request(
        api_url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    for attempt in range(2):  # retry once
        try:
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            text = ""
            for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                if "text" in part:
                    text += part["text"]
            text = text.strip()

            if not text:
                print(f"    {C.YELLOW}WARN{C.RESET} Empty response for {domain}")
                return None

            # Limpiar markdown fences
            if text.startswith("```"):
                text = text.split("\n", 1)[1]
                if text.endswith("```"):
                    text = text.rsplit("```", 1)[0]
                text = text.strip()

            result = json.loads(text)
            return result

        except json.JSONDecodeError:
            # Intentar extraer JSON del response
            try:
                json_match = re.search(r'\{[\s\S]*\}', text)
                if json_match:
                    return json.loads(json_match.group())
            except Exception:
                pass
            print(f"    {C.YELLOW}WARN{C.RESET} JSON parse error for {domain}")
            return None

        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8") if e.fp else ""
            print(f"    {C.YELLOW}WARN{C.RESET} Gemini API error {e.code} for {domain}: {body[:200]}")
            if attempt == 0:
                print(f"    Retrying in 5s...")
                time.sleep(5)
                continue
            return None

        except Exception as e:
            print(f"    {C.YELLOW}WARN{C.RESET} Gemini failed for {domain}: {e}")
            if attempt == 0:
                print(f"    Retrying in 5s...")
                time.sleep(5)
                continue
            return None

    return None


def propose_action(
    entry: GhostEntry,
    research: dict[str, Any] | None,
    crm_domains: set[str],
) -> tuple[str, str]:
    """Propose an action based on Gemini research results."""
    category = entry["category"]

    # Sin Gemini research, proponer segun categoria
    if not research:
        if category == "tool_service":
            return "CLEAN", "Tool/service, not a real business relationship"
        if category == "subdomain":
            return "CLEAN", "Subdomain of a real domain"
        if category == "no_activity":
            return "CLEAN", "NXDOMAIN with zero activity"
        return "ARCHIVE", f"NXDOMAIN, category={category}, no research available"

    status = research.get("status", "unknown")
    new_domain = research.get("new_domain")
    acquirer_domain = research.get("acquirer_domain")

    if status == "active":
        return "KEEP", research.get("explanation", "Company appears still active despite DNS issue")

    if status == "rebranded":
        if new_domain and new_domain.lower() in crm_domains:
            return "MERGE", f"Rebranded -> {new_domain} (exists in CRM)"
        if new_domain:
            return "RENAME", f"Rebranded -> {new_domain} (not in CRM)"
        return "ARCHIVE", f"Rebranded but new domain unknown: {research.get('explanation', '')}"

    if status == "acquired":
        target = acquirer_domain or new_domain
        if target and target.lower() in crm_domains:
            return "MERGE", f"Acquired by {research.get('acquirer', '?')} -> {target} (in CRM)"
        if target:
            return "RENAME", f"Acquired -> {target} ({research.get('acquirer', '?')})"
        return "ARCHIVE", f"Acquired by {research.get('acquirer', '?')}, no new domain found"

    if status == "closed":
        return "ARCHIVE", f"Company closed: {research.get('explanation', '')}"

    # unknown
    return "ARCHIVE", f"Status unknown: {research.get('explanation', 'No info found')}"


def phase2_gemini_research(
    categories: dict[str, list[GhostEntry]],
    companies: dict[str, Any],
    crm_domains: set[str],
    top_n: int = 50,
    target_category: str | None = None,
) -> None:
    """Research NXDOMAIN companies with Gemini + Google Search."""
    # Seleccionar empresas a investigar
    if target_category:
        to_research = categories.get(target_category, [])[:top_n]
    else:
        to_research = categories.get("recent_activity", [])[:top_n]

    if not to_research:
        print(f"\n{C.BOLD}Phase 2: Gemini Research{C.RESET}")
        print(f"  {C.DIM}No companies to research{C.RESET}")
        return

    print(f"\n{C.BOLD}Phase 2: Gemini Research{C.RESET}")
    print(f"  Researching {C.CYAN}{len(to_research)}{C.RESET} companies ({GEMINI_RPM_DELAY}s delay)")

    for i, entry in enumerate(to_research, 1):
        domain = entry["domain"]
        comp = companies.get(domain, {})
        name = comp.get("name", domain)
        context = comp.get("context", "") or ""
        enrichment = comp.get("enrichment")

        print(f"\n  [{i}/{len(to_research)}] {C.BOLD}{name}{C.RESET} ({domain})")
        print(f"    Emails: {entry['email_count']}  Last: {entry['last_date']}")

        # Skip if already researched (cached from previous run)
        if entry.get("research") and entry["research"].get("status"):
            research = entry["research"]
            print(f"    {C.DIM}(cached){C.RESET}")
        else:
            research = research_company_gemini(domain, name, context, enrichment)
            entry["research"] = research

        if research:
            status = research.get("status", "unknown")
            confidence = research.get("confidence", "?")
            explanation = research.get("explanation", "")[:80]
            color = {
                "active": C.GREEN,
                "rebranded": C.BLUE,
                "acquired": C.MAGENTA,
                "closed": C.RED,
            }.get(status, C.YELLOW)
            print(f"    {color}{status}{C.RESET} (conf: {confidence}) - {explanation}")

        # Proponer accion
        action, detail = propose_action(entry, research, crm_domains)
        entry["proposed_action"] = action
        entry["action_detail"] = detail

        action_color = {
            "MERGE": C.GREEN,
            "RENAME": C.BLUE,
            "ARCHIVE": C.RED,
            "KEEP": C.GREEN,
            "CLEAN": C.DIM,
        }.get(action, C.RESET)
        print(f"    -> {action_color}{action}{C.RESET}: {detail[:80]}")

        if i < len(to_research):
            time.sleep(GEMINI_RPM_DELAY)

    # Proponer acciones para categorias sin research
    for cat in ("tool_service", "subdomain", "no_activity"):
        for entry in categories.get(cat, []):
            if not entry["proposed_action"]:
                action, detail = propose_action(entry, None, crm_domains)
                entry["proposed_action"] = action
                entry["action_detail"] = detail

    # old_activity sin research tambien
    for entry in categories.get("old_activity", []):
        if not entry["proposed_action"]:
            entry["proposed_action"] = "ARCHIVE"
            entry["action_detail"] = f"NXDOMAIN, last activity {entry['last_date']}"


# ── Phase 3: Summary + Apply ─────────────────────────────────────────────────
def print_summary(categories: dict[str, list[GhostEntry]]) -> None:
    """Print summary table of proposed actions."""
    print(f"\n{C.BOLD}{'=' * 70}{C.RESET}")
    print(f"{C.BOLD}Phase 3: Proposed Actions Summary{C.RESET}")
    print(f"{'=' * 70}")

    action_counts: dict[str, int] = {}
    all_entries: list[GhostEntry] = []
    for entries in categories.values():
        all_entries.extend(entries)

    for entry in all_entries:
        action = entry.get("proposed_action", "UNKNOWN")
        action_counts[action] = action_counts.get(action, 0) + 1

    for action in ("MERGE", "RENAME", "ARCHIVE", "KEEP", "CLEAN", ""):
        count = action_counts.get(action, 0)
        if count == 0 and action:
            continue
        if not action:
            # Sin propuesta
            unprop = action_counts.get("", 0)
            if unprop:
                print(f"  {C.DIM}PENDING{C.RESET}: {unprop}")
            continue
        color = {
            "MERGE": C.GREEN,
            "RENAME": C.BLUE,
            "ARCHIVE": C.RED,
            "KEEP": C.GREEN,
            "CLEAN": C.DIM,
        }.get(action, C.RESET)
        print(f"  {color}{action}{C.RESET}: {count}")

    # Mostrar MERGEs y RENAMEs en detalle
    merges = [e for e in all_entries if e.get("proposed_action") == "MERGE"]
    renames = [e for e in all_entries if e.get("proposed_action") == "RENAME"]
    keeps = [e for e in all_entries if e.get("proposed_action") == "KEEP"]

    if merges:
        print(f"\n  {C.GREEN}{C.BOLD}MERGE candidates:{C.RESET}")
        for e in merges:
            new_domain = (e.get("research") or {}).get("new_domain", "?")
            print(f"    {e['domain']} -> {new_domain}  ({e['name']}, {e['email_count']} emails)")

    if renames:
        print(f"\n  {C.BLUE}{C.BOLD}RENAME candidates:{C.RESET}")
        for e in renames:
            new_domain = (e.get("research") or {}).get("new_domain", "?")
            print(f"    {e['domain']} -> {new_domain}  ({e['name']}, {e['email_count']} emails)")

    if keeps:
        print(f"\n  {C.GREEN}{C.BOLD}KEEP (still active):{C.RESET}")
        for e in keeps[:10]:
            print(f"    {e['domain']}  ({e['name']}, {e['email_count']} emails)")
        if len(keeps) > 10:
            print(f"    ... and {len(keeps) - 10} more")


# ── Apply logic ───────────────────────────────────────────────────────────────
def deduplicate_contacts(
    contacts_a: list[dict[str, Any]],
    contacts_b: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge two contact lists, dedup by email."""
    by_email: dict[str, dict[str, Any]] = {}
    for c in contacts_a + contacts_b:
        email = (c.get("email") or "").lower().strip()
        if not email:
            continue
        existing = by_email.get(email)
        if existing is None:
            by_email[email] = dict(c)
        else:
            existing_role = (existing.get("role") or "").strip()
            new_role = (c.get("role") or "").strip()
            if (not existing_role or existing_role in ("No identificado", "nan")) \
                    and new_role and new_role not in ("No identificado", "nan"):
                by_email[email] = dict(c)
            if not existing.get("nombre") and c.get("nombre"):
                by_email[email]["nombre"] = c["nombre"]
            if not existing.get("apellido") and c.get("apellido"):
                by_email[email]["apellido"] = c["apellido"]
    return list(by_email.values())


def merge_timelines(
    tl_a: list[dict[str, Any]],
    tl_b: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge timelines by quarter."""
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
    """Merge employee source dicts."""
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
            existing = merged[emp]
            if isinstance(existing, dict) and isinstance(data, dict):
                existing["interactions"] = existing.get("interactions", 0) + data.get("interactions", 0)
                if data.get("firstDate") and (not existing.get("firstDate") or data["firstDate"] < existing["firstDate"]):
                    existing["firstDate"] = data["firstDate"]
                if data.get("lastDate") and (not existing.get("lastDate") or data["lastDate"] > existing["lastDate"]):
                    existing["lastDate"] = data["lastDate"]
    return merged


def count_enrichment_fields(enrichment: dict[str, Any] | None) -> int:
    """Count non-internal populated fields."""
    if not enrichment:
        return 0
    return sum(
        1 for k, v in enrichment.items()
        if not k.startswith("_") and v is not None and v != "" and v != [] and v != {}
    )


def merge_enrichments(
    enr_a: dict[str, Any] | None,
    enr_b: dict[str, Any] | None,
) -> dict[str, Any]:
    """Merge enrichments, preferring the richer one."""
    if not enr_a and not enr_b:
        return {}
    if not enr_a:
        return dict(enr_b)  # type: ignore
    if not enr_b:
        return dict(enr_a)

    count_a = count_enrichment_fields(enr_a)
    count_b = count_enrichment_fields(enr_b)

    if count_a >= count_b:
        merged = dict(enr_a)
        other = enr_b
    else:
        merged = dict(enr_b)
        other = enr_a

    for key, val in other.items():
        if key.startswith("_"):
            continue
        if key not in merged or merged[key] is None or merged[key] == "" or merged[key] == []:
            merged[key] = val

    return merged


def apply_merge(
    from_domain: str,
    to_domain: str,
    companies: dict[str, Any],
) -> bool:
    """Merge from_domain into to_domain (consolidate contacts, timeline, enrichment)."""
    from_comp = companies.get(from_domain)
    to_comp = companies.get(to_domain)

    if not from_comp or not to_comp:
        print(f"    {C.YELLOW}SKIP{C.RESET} {from_domain} -> {to_domain} (missing entry)")
        return False

    print(f"    {C.GREEN}MERGE{C.RESET} {from_domain} -> {to_domain}")

    # Contacts
    to_comp["contacts"] = deduplicate_contacts(
        to_comp.get("contacts", []),
        from_comp.get("contacts", []),
    )
    to_comp["nContacts"] = len(to_comp["contacts"])

    # Timeline
    to_comp["timeline"] = merge_timelines(
        to_comp.get("timeline", []),
        from_comp.get("timeline", []),
    )

    # Interactions
    to_comp["interactions"] = (to_comp.get("interactions", 0) or 0) + (from_comp.get("interactions", 0) or 0)

    # Context
    from_ctx = (from_comp.get("context") or "").strip()
    to_ctx = (to_comp.get("context") or "").strip()
    if from_ctx and to_ctx:
        to_comp["context"] = to_ctx + " | " + from_ctx
    elif from_ctx:
        to_comp["context"] = from_ctx

    # Sources
    to_comp["sources"] = merge_sources(
        to_comp.get("sources", {}),
        from_comp.get("sources", {}),
    )

    # Subjects
    to_subjects = to_comp.get("subjects", []) or []
    from_subjects = from_comp.get("subjects", []) or []
    to_comp["subjects"] = list(set(to_subjects + from_subjects))

    # Dated subjects (handle both list and dict format)
    to_ds = to_comp.get("dated_subjects", []) or []
    from_ds = from_comp.get("dated_subjects", []) or []
    to_comp["dated_subjects"] = to_ds + from_ds

    # Snippets
    to_snip = to_comp.get("snippets", []) or []
    from_snip = from_comp.get("snippets", []) or []
    to_comp["snippets"] = to_snip + from_snip

    # Enrichment
    to_comp["enrichment"] = merge_enrichments(
        to_comp.get("enrichment"),
        from_comp.get("enrichment"),
    )

    # Aliases + merge tracking
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

    # Dates
    from_first = from_comp.get("firstDate", "")
    to_first = to_comp.get("firstDate", "")
    if from_first and (not to_first or from_first < to_first):
        to_comp["firstDate"] = from_first

    from_last = from_comp.get("lastDate", "")
    to_last = to_comp.get("lastDate", "")
    if from_last and (not to_last or from_last > to_last):
        to_comp["lastDate"] = from_last

    # Remove old domain
    del companies[from_domain]
    return True


def apply_rename(
    old_domain: str,
    new_domain: str,
    companies: dict[str, Any],
) -> bool:
    """Rename a domain (company rebranded, new domain not in CRM)."""
    comp = companies.get(old_domain)
    if not comp:
        print(f"    {C.YELLOW}SKIP{C.RESET} {old_domain} (not found)")
        return False

    if new_domain in companies:
        print(f"    {C.YELLOW}SKIP{C.RESET} {old_domain} -> {new_domain} (target already exists, use MERGE)")
        return False

    print(f"    {C.BLUE}RENAME{C.RESET} {old_domain} -> {new_domain}")

    enrichment = comp.get("enrichment") or {}
    aliases = enrichment.get("aliases", [])
    if old_domain not in aliases:
        aliases.append(old_domain)
    enrichment["aliases"] = aliases
    enrichment["_renamed_at"] = datetime.now(timezone.utc).isoformat()
    enrichment["_renamed_from"] = old_domain
    comp["enrichment"] = enrichment

    # Mover la key en el dict
    companies[new_domain] = comp
    del companies[old_domain]
    return True


def apply_archive(
    domain: str,
    reason: str,
    companies: dict[str, Any],
) -> bool:
    """Mark a company as archived."""
    comp = companies.get(domain)
    if not comp:
        return False

    enrichment = comp.get("enrichment") or {}
    enrichment["_archived"] = True
    enrichment["_archived_reason"] = reason
    enrichment["_archived_at"] = datetime.now(timezone.utc).isoformat()
    comp["enrichment"] = enrichment
    return True


def apply_actions(
    categories: dict[str, list[GhostEntry]],
    full_data: dict[str, Any],
) -> dict[str, int]:
    """Apply all proposed actions. Returns counts by action type."""
    companies = full_data["companies"]
    counts: dict[str, int] = {"MERGE": 0, "RENAME": 0, "ARCHIVE": 0, "CLEAN": 0, "KEEP": 0, "SKIP": 0}

    all_entries: list[GhostEntry] = []
    for entries in categories.values():
        all_entries.extend(entries)

    print(f"\n{C.BOLD}Applying actions...{C.RESET}")

    for entry in all_entries:
        action = entry.get("proposed_action", "")
        domain = entry["domain"]
        research = entry.get("research") or {}

        if action == "MERGE":
            new_domain = research.get("new_domain") or research.get("acquirer_domain")
            if new_domain and new_domain.lower() in {d.lower() for d in companies}:
                # Encontrar el dominio exacto (case-insensitive match)
                target = next((d for d in companies if d.lower() == new_domain.lower()), None)
                if target and apply_merge(domain, target, companies):
                    counts["MERGE"] += 1
                else:
                    counts["SKIP"] += 1
            else:
                counts["SKIP"] += 1

        elif action == "RENAME":
            new_domain = research.get("new_domain") or research.get("acquirer_domain")
            if new_domain and apply_rename(domain, new_domain.lower(), companies):
                counts["RENAME"] += 1
            else:
                counts["SKIP"] += 1

        elif action == "ARCHIVE":
            if apply_archive(domain, entry.get("action_detail", "Ghost company"), companies):
                counts["ARCHIVE"] += 1

        elif action == "CLEAN":
            reason = "tool/service" if entry["category"] == "tool_service" else entry.get("action_detail", "Cleaned")
            if apply_archive(domain, reason, companies):
                counts["CLEAN"] += 1

        elif action == "KEEP":
            counts["KEEP"] += 1

    return counts


def rebuild_compact(
    full_data: dict[str, Any],
    compact: dict[str, Any],
) -> None:
    """Rebuild companies.json compact format from companies_full.json data."""
    companies = full_data["companies"]
    new_r: list[list[Any]] = []
    new_d: dict[str, list[Any]] = {}

    for domain, comp in companies.items():
        idx = len(new_r)

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
            tl_entry = [t.get("quarter", ""), t.get("emails", 0)]
            summary = t.get("summary", "")
            if summary:
                tl_entry.append(summary)
            timeline_compact.append(tl_entry)

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
                dated_subjects_compact.append(ds)
            elif isinstance(ds, dict):
                ds_entry = [ds.get("date", ""), ds.get("subject", "")]
                extract_text = ds.get("extract", "")
                if extract_text:
                    ds_entry.append(extract_text)
                dated_subjects_compact.append(ds_entry)

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


# ── Save/Load helpers ─────────────────────────────────────────────────────────
def save_ghost_file(
    categories: dict[str, list[GhostEntry]],
    ok_count: int,
    nxdomain_count: int,
) -> None:
    """Save ghost_companies.json with all classification and research data."""
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dns_ok_count": ok_count,
        "nxdomain_count": nxdomain_count,
        "categories": {},
    }
    for cat, entries in categories.items():
        output["categories"][cat] = entries

    with open(GHOST_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n  Saved {C.CYAN}{GHOST_FILE}{C.RESET}")


def load_ghost_file() -> tuple[dict[str, list[GhostEntry]], int, int]:
    """Load existing ghost_companies.json."""
    with open(GHOST_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    categories = data.get("categories", {})
    return categories, data.get("dns_ok_count", 0), data.get("nxdomain_count", 0)


def mark_dns_status(
    companies: dict[str, Any],
    ok_domains: list[str],
    nxdomain_domains: list[str],
) -> None:
    """Mark DNS status in enrichment for all checked domains."""
    now = datetime.now(timezone.utc).isoformat()
    for domain in ok_domains:
        comp = companies.get(domain)
        if comp:
            enrichment = comp.get("enrichment") or {}
            enrichment["_dns_status"] = "ok"
            enrichment["_dns_checked_at"] = now
            comp["enrichment"] = enrichment

    for domain in nxdomain_domains:
        comp = companies.get(domain)
        if comp:
            enrichment = comp.get("enrichment") or {}
            enrichment["_dns_status"] = "nxdomain"
            enrichment["_dns_checked_at"] = now
            comp["enrichment"] = enrichment


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Detecta ghost companies (dominios muertos) en el CRM"
    )
    parser.add_argument("--dns-only", action="store_true", help="Solo Phase 1 (DNS check)")
    parser.add_argument("--top", type=int, default=50, help="Top N NXDOMAIN companies to research (default: 50)")
    parser.add_argument("--dry-run", action="store_true", help="No modificar companies_full.json")
    parser.add_argument("--apply", action="store_true", help="Aplicar acciones propuestas")
    parser.add_argument("--from-cache", action="store_true", help="Usar ghost_companies.json existente")
    parser.add_argument("--category", type=str, default=None,
                        choices=["recent_activity", "old_activity", "no_activity", "subdomain", "tool_service"],
                        help="Solo procesar una categoria")
    args = parser.parse_args()

    # Cargar datos
    print(f"{C.BOLD}Loading CRM data...{C.RESET}")
    with open(COMPANIES_FULL, "r", encoding="utf-8") as f:
        full_data = json.load(f)

    companies = full_data["companies"]
    crm_domains = {d.lower() for d in companies}
    total = len(companies)
    print(f"  {C.CYAN}{total}{C.RESET} companies loaded")

    if args.from_cache:
        # Cargar desde cache
        print(f"\n{C.BOLD}Loading from cache: {GHOST_FILE}{C.RESET}")
        try:
            categories, ok_count, nxdomain_count = load_ghost_file()
            print(f"  DNS OK: {ok_count}  |  NXDOMAIN: {nxdomain_count}")
            for cat, entries in categories.items():
                print(f"    {cat}: {len(entries)}")
        except FileNotFoundError:
            print(f"  {C.RED}ERROR{C.RESET}: {GHOST_FILE} not found. Run without --from-cache first.")
            sys.exit(1)

        ok_domains: list[str] = []
        nxdomain_domains: list[str] = []
        for entries in categories.values():
            for e in entries:
                nxdomain_domains.append(e["domain"])
    else:
        # Phase 1: DNS check
        ok_domains, nxdomain_domains = asyncio.run(phase1_dns_check(companies))
        ok_count = len(ok_domains)
        nxdomain_count = len(nxdomain_domains)

        # Classify NXDOMAIN
        categories = classify_nxdomains(nxdomain_domains, companies)

        # Mark DNS status in enrichment
        if not args.dry_run:
            mark_dns_status(companies, ok_domains, nxdomain_domains)

        # Save classification
        save_ghost_file(categories, ok_count, nxdomain_count)

    # Phase 2: Gemini research (unless --dns-only)
    if not args.dns_only:
        phase2_gemini_research(
            categories, companies, crm_domains,
            top_n=args.top,
            target_category=args.category,
        )
        # Re-save with research results
        save_ghost_file(categories, ok_count, nxdomain_count)

    # Phase 3: Summary
    print_summary(categories)

    # Apply actions if requested
    if args.apply and not args.dry_run:
        with open(COMPANIES_COMPACT, "r", encoding="utf-8") as f:
            compact_data = json.load(f)

        counts = apply_actions(categories, full_data)

        print(f"\n{C.BOLD}Results:{C.RESET}")
        for action, count in sorted(counts.items()):
            if count > 0:
                print(f"  {action}: {count}")

        # Rebuild compact and save
        if counts["MERGE"] > 0 or counts["RENAME"] > 0:
            rebuild_compact(full_data, compact_data)

        print(f"\n{C.BOLD}Saving files...{C.RESET}")
        with open(COMPANIES_FULL, "w", encoding="utf-8") as f:
            json.dump(full_data, f, ensure_ascii=False)
        print(f"  {C.GREEN}Saved{C.RESET} {COMPANIES_FULL}")

        with open(COMPANIES_COMPACT, "w", encoding="utf-8") as f:
            json.dump(compact_data, f, ensure_ascii=False)
        print(f"  {C.GREEN}Saved{C.RESET} {COMPANIES_COMPACT}")

        # Re-save ghost file with updated actions
        save_ghost_file(categories, ok_count, nxdomain_count)

    elif not args.dry_run and not args.apply:
        # Save DNS status marks even without --apply
        if not args.from_cache:
            print(f"\n{C.BOLD}Saving DNS status to companies_full.json...{C.RESET}")
            with open(COMPANIES_FULL, "w", encoding="utf-8") as f:
                json.dump(full_data, f, ensure_ascii=False)
            print(f"  {C.GREEN}Saved{C.RESET} {COMPANIES_FULL}")

    elif args.dry_run:
        print(f"\n{C.DIM}--dry-run: no files modified{C.RESET}")

    total_nxdomain = sum(len(entries) for entries in categories.values())
    print(f"\n{C.BOLD}Done.{C.RESET} {total_nxdomain} NXDOMAIN domains classified.")
    if not args.apply and not args.dns_only:
        print(f"{C.DIM}Run with --apply to execute proposed actions.{C.RESET}")


if __name__ == "__main__":
    main()
