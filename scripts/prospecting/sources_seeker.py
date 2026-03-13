#!/usr/bin/env python3
"""
Sources Seeker — uses Gemini 2.5 Flash REST API with Google Search grounding
to find data sources where target companies are listed.

Input: search criteria dict
Output: JSON with 10-15 sources where Company Seeker will look for companies

Requires: GEMINI_API_KEY environment variable
"""

import json
import os
import sys
import requests

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

SOURCES_PROMPT_TEMPLATE = """You are a senior corporate intelligence analyst for Alter5, a European financial intermediary that structures debt and equity transactions for companies across ANY sector.

YOUR MISSION: Find high-quality data SOURCES (not companies directly) where another AI agent will extract lists of target companies.

TARGET COMPANY PROFILE:
- What these companies do: {description}
- Financing needed: {target_market_role}
- Asset type / sector: {asset_type} → {sector}
- Target countries: {focus_countries}
- FEI/EU eligibility: {fei_eligible}

SOURCE HIERARCHY (search in this priority order):
1. SECTORAL ASSOCIATIONS & TRADE BODIES - member directories
2. OFFICIAL GOVERNMENT & REGULATORY REGISTRIES
3. SPECIALIZED SECTOR DATABASES
4. RANKINGS & MEDIA - "Top 50/100" lists in trade press
5. FINANCIAL DATABASES - publicly accessible portions

CRITICAL RULES:
- SECTOR AGNOSTICISM: Use ONLY the criteria above to find sources. Do NOT assume sector from Alter5's background.
- FINANCING TYPE DRIVES SELECTION: For Debt/Borrower → find ASSET OWNERS and DEVELOPERS. For Equity → find SELLERS and ASSET MANAGERS.
- GEOGRAPHIC PRECISION: For each country, find country-SPECIFIC sources in the local language.
- PAGINATION: Visit each URL and check for pagination. Split into chunks of max 5 pages each.
- Return AT LEAST 10 sources. Quality over quantity.

Return ONLY a valid JSON array with fields: source_name, url, page_range_start, page_range_end, total_pages_in_source, description, source_type, reliability, access_type, estimated_companies, language, has_detail_pages, financing_relevance, notes"""


def run(criteria: dict) -> dict:
    """
    Find data sources using Gemini 2.5 Flash REST API with Google Search grounding.
    """
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY environment variable not set")

    prompt = SOURCES_PROMPT_TEMPLATE.format(
        description=criteria.get("description", ""),
        target_market_role=criteria.get("target_market_role", ""),
        asset_type=criteria.get("asset_type", ""),
        sector=criteria.get("sector", ""),
        focus_countries=", ".join(criteria.get("focus_countries", [])),
        fei_eligible=criteria.get("fei_eligible", False),
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"google_search": {}}],
    }

    print(f"[sources_seeker] Calling {GEMINI_MODEL} with Google Search grounding...")
    resp = requests.post(
        GEMINI_API_URL,
        params={"key": GEMINI_API_KEY},
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"{resp.status_code} {resp.text[:500]}")

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise RuntimeError("No candidates in Gemini response")

    raw_text = ""
    for part in candidates[0].get("content", {}).get("parts", []):
        if "text" in part:
            raw_text += part["text"]

    raw_text = raw_text.strip()

    # Extract JSON from response (handle markdown code blocks)
    if "```json" in raw_text:
        raw_text = raw_text.split("```json")[1].split("```")[0].strip()
    elif "```" in raw_text:
        raw_text = raw_text.split("```")[1].split("```")[0].strip()

    try:
        sources_list = json.loads(raw_text)
        if isinstance(sources_list, list):
            result = {"sources": sources_list}
        elif isinstance(sources_list, dict) and "sources" in sources_list:
            result = sources_list
        else:
            result = {"sources": sources_list if isinstance(sources_list, list) else []}
    except json.JSONDecodeError as e:
        print(f"[sources_seeker] WARNING: Could not parse JSON response: {e}")
        print(f"[sources_seeker] Raw response: {raw_text[:500]}")
        result = {"sources": [], "raw_response": raw_text}

    print(f"[sources_seeker] Found {len(result.get('sources', []))} sources")
    return result


if __name__ == "__main__":
    # CLI usage: python sources_seeker.py '{"description": "...", ...}'
    if len(sys.argv) < 2:
        print("Usage: python sources_seeker.py '<criteria_json>'")
        sys.exit(1)

    criteria = json.loads(sys.argv[1])
    result = run(criteria)
    print(json.dumps(result, indent=2, ensure_ascii=False))
