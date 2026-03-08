#!/usr/bin/env python3
"""
Contact Finder — finds the key financial contact for a company using a cascade:
  1. Apollo (people search by company domain + target roles)
  2. Findymail (email verification/search using name + domain or LinkedIn URL)
  3. Fallback manual (returns Sales Nav search URL)

Requires: APOLLO_API_KEY, FINDYMAIL_API_KEY environment variables
"""

import json
import os
import sys
import urllib.request
import urllib.error
import ssl

APOLLO_API_KEY = os.environ.get("APOLLO_API_KEY", "")
FINDYMAIL_API_KEY = os.environ.get("FINDYMAIL_API_KEY", "")

# SSL context
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
    if not os.environ.get("CI"):
        SSL_CTX.check_hostname = False
        SSL_CTX.verify_mode = ssl.CERT_NONE

APOLLO_PEOPLE_SEARCH_URL = "https://api.apollo.io/v1/people/search"
APOLLO_PEOPLE_MATCH_URL = "https://api.apollo.io/v1/people/match"
FINDYMAIL_SEARCH_URL = "https://app.findymail.com/api/search"
FINDYMAIL_LINKEDIN_URL = "https://app.findymail.com/api/search/linkedin"


def _post_json(url, payload, headers):
    """Make a POST request with JSON payload, return parsed response."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        return None, f"HTTP {e.code}: {body[:200]}"
    except Exception as e:
        return None, str(e)


def _search_apollo(domain, target_roles):
    """
    Search Apollo for people at a company with target roles.
    Returns best candidate or None.
    """
    if not APOLLO_API_KEY:
        return None, "APOLLO_API_KEY not set"

    headers = {
        "X-Api-Key": APOLLO_API_KEY,
        "Content-Type": "application/json",
    }

    payload = {
        "organization_domains": [domain],
        "person_titles": target_roles,
        "person_seniorities": ["c_suite", "director", "vp", "manager"],
        "per_page": 5,
    }

    data, err = _post_json(APOLLO_PEOPLE_SEARCH_URL, payload, headers)
    if err:
        print(f"[contact_finder] Apollo search error: {err}")
        return None, err

    people = data.get("people", [])
    if not people:
        return None, "No people found in Apollo"

    # Prefer people with verified email
    for person in people:
        if person.get("email") and person.get("email_status") == "verified":
            return person, None

    # Return first person even without verified email
    return people[0], None


def _find_email_findymail(name, domain):
    """
    Find email using Findymail by name + domain.
    Returns email string or None.
    """
    if not FINDYMAIL_API_KEY:
        return None, "FINDYMAIL_API_KEY not set"

    headers = {
        "Authorization": f"Bearer {FINDYMAIL_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {"name": name, "domain": domain}

    data, err = _post_json(FINDYMAIL_SEARCH_URL, payload, headers)
    if err:
        print(f"[contact_finder] Findymail search error: {err}")
        return None, err

    email = data.get("email") or data.get("data", {}).get("email")
    if email:
        return email, None
    return None, "Email not found in Findymail"


def find_contact_by_linkedin(linkedin_url, domain=None):
    """
    Find contact email from a LinkedIn profile URL using Findymail.
    Returns contact dict.
    """
    if not FINDYMAIL_API_KEY:
        return {
            "status": "error",
            "error": "FINDYMAIL_API_KEY not set",
        }

    headers = {
        "Authorization": f"Bearer {FINDYMAIL_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {"linkedin_url": linkedin_url}
    if domain:
        payload["domain"] = domain

    data, err = _post_json(FINDYMAIL_LINKEDIN_URL, payload, headers)
    if err:
        return {"status": "error", "error": err}

    email = data.get("email") or data.get("data", {}).get("email")
    name = data.get("name") or data.get("data", {}).get("name", "")
    role = data.get("job_title") or data.get("data", {}).get("job_title", "")

    if email:
        return {
            "status": "found",
            "source": "findymail_linkedin",
            "contact_name": name,
            "contact_role": role,
            "contact_email": email,
            "contact_linkedin": linkedin_url,
        }

    return {"status": "not_found", "source": "findymail_linkedin"}


def find_contact(company_name, domain, target_roles=None, linkedin_company_url=None):
    """
    Main contact finding cascade: Apollo → Findymail → fallback manual.

    Args:
        company_name: company display name
        domain: company domain (e.g. "company.es")
        target_roles: list of target role titles (default: CFO/CEO/Director Financiero)
        linkedin_company_url: optional LinkedIn company page URL

    Returns:
        dict with contact data and status
    """
    if target_roles is None:
        target_roles = ["CFO", "CEO", "Director Financiero", "Head of Finance",
                        "Chief Financial Officer", "Finance Director"]

    print(f"[contact_finder] Searching contact for {company_name} ({domain})...")

    # PASO 1: Apollo — search by company domain + target roles
    apollo_person, apollo_err = _search_apollo(domain, target_roles)

    if apollo_person:
        name = f"{apollo_person.get('first_name', '')} {apollo_person.get('last_name', '')}".strip()
        role = apollo_person.get("title", "")
        email = apollo_person.get("email", "")
        email_status = apollo_person.get("email_status", "")
        linkedin_url = apollo_person.get("linkedin_url", "")

        # If Apollo has verified email — use directly
        if email and email_status == "verified":
            print(f"[contact_finder] Found via Apollo (verified email): {name}")
            return {
                "status": "found",
                "source": "apollo",
                "contact_name": name,
                "contact_role": role,
                "contact_email": email,
                "contact_linkedin": linkedin_url,
                "apollo_data": apollo_person,
                "findymail_status": "found",
            }

        # Apollo has person but no verified email → try Findymail
        if name and domain:
            print(f"[contact_finder] Apollo found {name}, trying Findymail for email...")
            email_fm, fm_err = _find_email_findymail(name, domain)
            if email_fm:
                print(f"[contact_finder] Found via Apollo + Findymail: {name}")
                return {
                    "status": "found",
                    "source": "apollo+findymail",
                    "contact_name": name,
                    "contact_role": role,
                    "contact_email": email_fm,
                    "contact_linkedin": linkedin_url,
                    "apollo_data": apollo_person,
                    "findymail_status": "found",
                }

        # Apollo found person but no email found anywhere
        if name:
            print(f"[contact_finder] Apollo found {name} but no email")
            return {
                "status": "partial",
                "source": "apollo",
                "contact_name": name,
                "contact_role": role,
                "contact_email": None,
                "contact_linkedin": linkedin_url,
                "apollo_data": apollo_person,
                "findymail_status": "not_found",
            }

    # PASO 2: Try Findymail directly with common role names
    if domain and FINDYMAIL_API_KEY:
        for role_hint in ["CFO", "Director Financiero"]:
            email_fm, fm_err = _find_email_findymail(role_hint, domain)
            if email_fm:
                print(f"[contact_finder] Found via Findymail direct: {role_hint}@{domain}")
                return {
                    "status": "found",
                    "source": "findymail",
                    "contact_name": "",
                    "contact_role": role_hint,
                    "contact_email": email_fm,
                    "contact_linkedin": None,
                    "apollo_data": None,
                    "findymail_status": "found",
                }

    # PASO 3: Fallback — return Sales Nav search URL for manual lookup
    roles_str = target_roles[0].replace(' ', '+') if target_roles else 'CFO'
    sales_nav_url = (
        f"https://www.linkedin.com/sales/search/people"
        f"?keywords={company_name.replace(' ', '+')}+{roles_str}"
        f"&currentCompany[]={company_name.replace(' ', '%20')}"
    )

    print(f"[contact_finder] No contact found for {company_name}, manual required")
    return {
        "status": "manual_required",
        "source": "fallback",
        "contact_name": None,
        "contact_role": None,
        "contact_email": None,
        "contact_linkedin": None,
        "apollo_data": None,
        "findymail_status": "not_found",
        "sales_nav_search": sales_nav_url,
        "suggested_roles": target_roles,
    }


if __name__ == "__main__":
    # CLI usage: python contact_finder.py "Company Name" "domain.com"
    if len(sys.argv) < 3:
        print("Usage: python contact_finder.py 'Company Name' 'domain.com'")
        sys.exit(1)

    result = find_contact(sys.argv[1], sys.argv[2])
    print(json.dumps(result, indent=2, ensure_ascii=False))
