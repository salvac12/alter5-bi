#!/usr/bin/env python3
"""
Merge duplicate companies in companies_full.json.

Consolidates companies that are the same entity but have different domains
(different TLDs, subdomains, typos, rebrands).

Usage:
    python scripts/merge_duplicates.py              # execute merges
    python scripts/merge_duplicates.py --dry-run    # preview only
"""

import json
import os
import sys
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
FULL_FILE = os.path.join(ROOT, "src", "data", "companies_full.json")
COMPACT_FILE = os.path.join(ROOT, "src", "data", "companies.json")

# Import export_to_compact from import_mailbox
sys.path.insert(0, SCRIPT_DIR)
from import_mailbox import export_to_compact

# ──────────────────────────────────────────────────────────────
# MERGE RULES: (target_domain, [domains_to_absorb])
# target = the canonical domain that survives
# ──────────────────────────────────────────────────────────────
MERGE_RULES = [
    # === Known rebrands ===
    ("aboenergy.com", ["abo-wind.es", "abo-wind.fr"]),

    # === Same company, different TLD / subdomain ===
    ("apexgroup.com", ["apexfs.group", "apexfs.com", "apexfunds.co.uk"]),
    ("acoboo.com", ["acoboo.atlassian.net", "acoboo.help"]),
    ("bancsabadell.com", ["comunica.bancsabadell.com"]),
    ("atainsights.com", ["ata.email", "em-577710.atainsights.com", "email.atainsights.com", "my.atainsights.com"]),
    ("bankinter.com", ["bakinter.com"]),  # typo
    ("gruposantander.com", ["gruposantander.es"]),
    ("ithaka.com", ["ithaka.es"]),  # nota: ithaka.es tiene 127 interactions
    ("grupotec.es", ["grupotec.com"]),
    ("eversheds-sutherland.es", ["eversheds-sutherland.com"]),
    ("caixabank.com", ["empresas.caixabank.com", "email.caixabank.com", "events.caixabank.com"]),
    ("soltec.com", ["external.soltec.com"]),
    ("crowdcube.com", ["info.crowdcube.com", "crowdcube.zendesk.com"]),
    ("enerlandgroup.com", ["enerlandgorup.com"]),  # typo
    ("triodos.es", ["triodos.nl"]),
    ("mirabaud-msl.com", ["mirabaud.com"]),
    ("ignis.es", ["ignis.com"]),
    ("cinkcoworking.es", ["cink-emprende.es", "cinkcoworking.com"]),
    ("deloitte.es", ["bdhnotifications.deloitte.com"]),
    ("qenergy.com", ["qualitasenergy.com"]),
]


def merge_into_target(target_co, donor_co, donor_domain):
    """Merge donor company data into target company."""
    now = datetime.now(timezone.utc).isoformat()

    # ── Sources: copy all employee sources from donor ──
    if "sources" not in target_co:
        target_co["sources"] = {}

    donor_sources = donor_co.get("sources", {})
    for emp_id, src_data in donor_sources.items():
        if emp_id not in target_co["sources"]:
            target_co["sources"][emp_id] = src_data
        else:
            # Merge into existing employee source
            existing_src = target_co["sources"][emp_id]
            existing_src["interactions"] = existing_src.get("interactions", 0) + src_data.get("interactions", 0)
            if src_data.get("firstDate", "") and (not existing_src.get("firstDate") or src_data["firstDate"] < existing_src["firstDate"]):
                existing_src["firstDate"] = src_data["firstDate"]
            if src_data.get("lastDate", "") and (not existing_src.get("lastDate") or src_data["lastDate"] > existing_src["lastDate"]):
                existing_src["lastDate"] = src_data["lastDate"]
            # Merge contacts within source
            seen = {c.get("email") or c.get("name") for c in existing_src.get("contacts", [])}
            for c in src_data.get("contacts", []):
                key = c.get("email") or c.get("name")
                if key not in seen:
                    existing_src.setdefault("contacts", []).append(c)
                    seen.add(key)
            # Merge timelines within source
            qt = {}
            for t in existing_src.get("timeline", []):
                qt[t["quarter"]] = qt.get(t["quarter"], 0) + t["emails"]
            for t in src_data.get("timeline", []):
                qt[t["quarter"]] = qt.get(t["quarter"], 0) + t["emails"]
            existing_src["timeline"] = [{"quarter": q, "emails": e} for q, e in sorted(qt.items(), reverse=True)][:8]
            # Combine context
            if src_data.get("context") and src_data["context"] not in existing_src.get("context", ""):
                existing_src["context"] = (existing_src.get("context", "") + " | " + src_data["context"])[:500]

    # ── Recalculate aggregates ──
    all_interactions = sum(s.get("interactions", 0) for s in target_co["sources"].values())
    valid_firsts = [s["firstDate"] for s in target_co["sources"].values() if s.get("firstDate")]
    valid_lasts = [s["lastDate"] for s in target_co["sources"].values() if s.get("lastDate")]
    target_co["interactions"] = all_interactions
    target_co["firstDate"] = min(valid_firsts) if valid_firsts else ""
    target_co["lastDate"] = max(valid_lasts) if valid_lasts else ""

    # ── Merge contacts (dedup by email) ──
    seen_emails = {}
    all_contacts = []
    for s in sorted(target_co["sources"].values(), key=lambda x: x.get("lastDate", ""), reverse=True):
        for c in s.get("contacts", []):
            email = c.get("email", "")
            key = email or c.get("name", "")
            if key and key not in seen_emails:
                seen_emails[key] = len(all_contacts)
                entry = dict(c)  # copy all fields including _linkedin_url, _role_source etc
                all_contacts.append(entry)
            elif key:
                idx = seen_emails[key]
                # Fill missing fields
                for field in ("role", "nombre", "apellido", "_linkedin_url", "_role_source", "_role_confidence"):
                    if not all_contacts[idx].get(field) and c.get(field):
                        all_contacts[idx][field] = c[field]
    target_co["contacts"] = all_contacts[:5]
    target_co["nContacts"] = len(all_contacts)

    # ── Merge timelines ──
    quarter_totals = {}
    summaries = {}
    for s in target_co["sources"].values():
        for t in s.get("timeline", []):
            quarter_totals[t["quarter"]] = quarter_totals.get(t["quarter"], 0) + t["emails"]
            if t.get("summary"):
                summaries[t["quarter"]] = t["summary"]
    target_co["timeline"] = [
        {"quarter": q, "emails": e, **({"summary": summaries[q]} if q in summaries else {})}
        for q, e in sorted(quarter_totals.items(), reverse=True)
    ][:8]

    # ── Merge subjects ──
    old_subj = set(target_co.get("subjects", []))
    for s in donor_co.get("subjects", []):
        if s not in old_subj:
            target_co.setdefault("subjects", []).append(s)
            old_subj.add(s)
    if "subjects" in target_co:
        target_co["subjects"] = target_co["subjects"][:30]

    # ── Merge dated_subjects ──
    old_ds = target_co.get("dated_subjects", [])
    seen_ds = {ds[1] for ds in old_ds if len(ds) > 1}
    for ds in donor_co.get("dated_subjects", []):
        if len(ds) > 1 and ds[1] not in seen_ds:
            old_ds.append(ds)
            seen_ds.add(ds[1])
    target_co["dated_subjects"] = sorted(old_ds, key=lambda x: x[0] if x else "")[-30:]

    # ── Merge snippets ──
    old_snip = target_co.get("snippets", [])
    new_snip = donor_co.get("snippets", [])
    target_co["snippets"] = list({s: None for s in old_snip + new_snip}.keys())[:15]

    # ── Merge enrichment (keep richer) ──
    target_enr = target_co.get("enrichment", {}) or {}
    donor_enr = donor_co.get("enrichment", {}) or {}
    for key, val in donor_enr.items():
        if key not in target_enr or (not target_enr[key] and val):
            target_enr[key] = val
    if target_enr:
        target_co["enrichment"] = target_enr

    # ── Merge context ──
    donor_ctx = donor_co.get("context", "")
    target_ctx = target_co.get("context", "")
    if donor_ctx and donor_ctx not in target_ctx:
        target_co["context"] = (target_ctx + " | " + donor_ctx)[:500]

    # ── Track merge ──
    merged_from = target_co.get("enrichment", {}).get("_merged_from", [])
    merged_from.append({
        "domain": donor_domain,
        "merged_at": now,
        "from_name": donor_co.get("name", donor_domain),
    })
    target_co.setdefault("enrichment", {})["_merged_from"] = merged_from

    aliases = target_co.get("enrichment", {}).get("aliases", [])
    if donor_domain not in aliases:
        aliases.append(donor_domain)
    target_co["enrichment"]["aliases"] = aliases

    return target_co


def main():
    dry_run = "--dry-run" in sys.argv

    with open(FULL_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    companies = data["companies"]
    total_merged = 0
    total_removed = 0

    for target_domain, donor_domains in MERGE_RULES:
        if target_domain not in companies:
            print(f"⚠ Target {target_domain} not found, skipping")
            continue

        target = companies[target_domain]
        old_interactions = target.get("interactions", 0)
        old_contacts = target.get("nContacts", 0)

        for donor_domain in donor_domains:
            if donor_domain not in companies:
                continue

            donor = companies[donor_domain]
            d_int = donor.get("interactions", 0)
            d_ct = donor.get("nContacts", 0)

            print(f"  ← {donor_domain} ({donor.get('name', '?')}, {d_int} int, {d_ct} contacts)")

            if not dry_run:
                merge_into_target(target, donor, donor_domain)
                del companies[donor_domain]

            total_removed += 1

        new_interactions = target.get("interactions", 0) if not dry_run else old_interactions
        new_contacts = target.get("nContacts", 0) if not dry_run else old_contacts

        print(f"→ {target_domain} ({target.get('name', '?')}): {old_interactions}→{new_interactions} int, {old_contacts}→{new_contacts} contacts")
        total_merged += 1
        print()

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Merged {total_removed} domains into {total_merged} targets")
    print(f"Companies: {len(companies) + (total_removed if dry_run else 0)} → {len(companies) if not dry_run else len(companies) - total_removed + total_removed}")

    if not dry_run:
        # Save full
        with open(FULL_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print(f"✓ Saved {FULL_FILE}")

        # Export compact
        compact = export_to_compact(companies)
        with open(COMPACT_FILE, "w", encoding="utf-8") as f:
            json.dump(compact, f, ensure_ascii=False)
        print(f"✓ Saved {COMPACT_FILE}")


if __name__ == "__main__":
    main()
