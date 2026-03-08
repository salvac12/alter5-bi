#!/usr/bin/env python3
"""
Company Seeker — uses Claude claude-sonnet-4-5 with web search to extract and verify
companies from sources found by Sources Seeker, classifying them with Alter5 taxonomy.

Input: search criteria + list of sources
Output: JSON with verified companies and their classifications

Requires: ANTHROPIC_API_KEY environment variable
"""

import json
import os
import sys

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

COMPANY_SEEKER_PROMPT_TEMPLATE = """<instructions>

<role>
You are a senior corporate intelligence researcher and financial analyst for Alter5, a European financial intermediary that structures debt and equity transactions for companies across ANY sector — renewable energy, real estate, logistics, cold storage, data centers, infrastructure, and beyond.

Your task has TWO parts executed sequentially:
PART 1 — EXTRACTION: Find and verify real companies from provided sources
PART 2 — CLASSIFICATION: Classify each company using Alter5's taxonomy
</role>

<alter5-context>
Alter5 connects companies that need financing with capital providers. The sector is an attribute of the asset, not of the business. Classification must reflect the company's FINANCING NEED:
- DEBT: Project Finance, Corporate Finance, Bridge Loans, Refinancing
- EQUITY: M&A sell-side, Co-development, Equity placement
</alter5-context>

<search-criteria>
{criteria_json}
</search-criteria>

<input-sources>
{sources_json}
</input-sources>

<extraction-methodology>
STEP 1 — VISIT AND EXTRACT from each source URL respecting page ranges
STEP 2 — VERIFY each company: find corporate website, confirm sector, look for FINANCING SIGNALS
  - For Debt: "projects under development", "pipeline", "construction", "expansion", "seeking financing"
  - For Equity: "portfolio sale", "asset rotation", "co-investment", "RTB", "M&A"
STEP 3 — TAX ID: attempt lookup max 30 seconds per company, use PENDING if not found
STEP 4 — DEDUPLICATE across sources
</extraction-methodology>

<classification-taxonomy>
ROLE: Originación (needs financing) | Inversión (provides capital) | Ecosistema (advisor) | No relevante
SEGMENT (only if Originación): Project Finance | Corporate Finance
COMPANY TYPE:
  Originación > Project Finance: Developer | IPP | Developer + IPP
  Inversión > Deuda: Fondo de deuda | Banco | Bonista / Institucional  
  Inversión > Equity: Fondo de infraestructura | Private equity | Fondo renovable | IPP comprador | Utility compradora
MARKET ROLES (multiple): Borrower | Seller (M&A) | Buyer Investor (M&A) | Debt Investor | Equity Investor | Partner & Services
</classification-taxonomy>

<quality-rules>
- Target 30-60 verified companies per search. Quality over quantity.
- VERIFIED WEBSITE IS MANDATORY for high/medium confidence
- NEVER fabricate names, URLs, tax IDs or descriptions
- FINANCING SIGNALS are highest-value data for Alter5
</quality-rules>

<output-format>
Return ONLY valid JSON:
{{
  "search_metadata": {{
    "search_date": "YYYY-MM-DD",
    "criteria_summary": "string",
    "total_companies_found": 0,
    "high_confidence_count": 0,
    "medium_confidence_count": 0,
    "low_confidence_count": 0,
    "sources_consulted": 0
  }},
  "companies": [
    {{
      "company_name": "string",
      "company_url": "string",
      "country": "ISO code",
      "tax_id": "string or PENDING",
      "tax_id_format": "ES-CIF | FR-SIRET | DE-HRB | IT-CF | PENDING",
      "brief_description": "string",
      "financing_signals": "string or NULL",
      "asset_type": "string",
      "estimated_size": "string or NULL",
      "sources_found": [{{"source_name": "string", "source_url": "string"}}],
      "alter5_classification": {{
        "role": "string",
        "segment": "string or NULL",
        "company_type": "string",
        "market_roles": ["string"],
        "asset_type_tag": "string",
        "geography": ["ISO codes"],
        "technologies": ["string"],
        "classification_confidence": "high | medium | low",
        "classification_notes": "string"
      }},
      "contact_hints": {{
        "linkedin_company_url": "string or NULL",
        "target_roles": ["CFO", "Director Financiero", "Head of Finance"],
        "notes": "string"
      }},
      "confidence": "high | medium | low",
      "discard_reason": "NULL or string",
      "notes": "string"
    }}
  ]
}}
</output-format>

</instructions>"""


def run(criteria: dict, sources: dict) -> dict:
    """
    Extract and classify companies from sources using Claude claude-sonnet-4-5 with web search.

    Args:
        criteria: search criteria dict
        sources: dict with "sources" list from sources_seeker

    Returns:
        dict with "search_metadata" and "companies" list
    """
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY environment variable not set")

    try:
        import anthropic
    except ImportError:
        raise ImportError("anthropic package required: pip install anthropic")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    criteria_json = json.dumps(criteria, indent=2, ensure_ascii=False)
    sources_list = sources.get("sources", [])
    sources_json = json.dumps(sources_list, indent=2, ensure_ascii=False)

    prompt = COMPANY_SEEKER_PROMPT_TEMPLATE.format(
        criteria_json=criteria_json,
        sources_json=sources_json,
    )

    print(f"[company_seeker] Calling Claude claude-sonnet-4-5 with {len(sources_list)} sources...")

    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=8192,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 20}],
        messages=[{"role": "user", "content": prompt}],
    )

    # Extract text content from response
    raw_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            raw_text += block.text

    raw_text = raw_text.strip()

    # Extract JSON from response (handle markdown code blocks)
    if "```json" in raw_text:
        raw_text = raw_text.split("```json")[1].split("```")[0].strip()
    elif "```" in raw_text:
        raw_text = raw_text.split("```")[1].split("```")[0].strip()

    # Find JSON object in response
    start_idx = raw_text.find("{")
    if start_idx > 0:
        raw_text = raw_text[start_idx:]

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError as e:
        print(f"[company_seeker] WARNING: Could not parse JSON response: {e}")
        print(f"[company_seeker] Raw response: {raw_text[:500]}")
        result = {
            "search_metadata": {
                "search_date": "",
                "criteria_summary": criteria.get("description", ""),
                "total_companies_found": 0,
                "high_confidence_count": 0,
                "medium_confidence_count": 0,
                "low_confidence_count": 0,
                "sources_consulted": len(sources_list),
            },
            "companies": [],
            "raw_response": raw_text,
        }

    companies = result.get("companies", [])
    print(f"[company_seeker] Found {len(companies)} companies")
    return result


if __name__ == "__main__":
    # CLI usage: python company_seeker.py '<criteria_json>' '<sources_json>'
    if len(sys.argv) < 3:
        print("Usage: python company_seeker.py '<criteria_json>' '<sources_json>'")
        sys.exit(1)

    criteria = json.loads(sys.argv[1])
    sources = json.loads(sys.argv[2])
    result = run(criteria, sources)
    print(json.dumps(result, indent=2, ensure_ascii=False))
