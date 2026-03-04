/**
 * CampaignTargets data layer — Airtable REST API backend.
 *
 * Same base as Prospects (appVu3TvSZ1E4tj0J), table "CampaignTargets".
 * Tracks which companies have been reviewed for campaign targeting.
 */

const BASE_ID = "appVu3TvSZ1E4tj0J";
const TABLE_NAME = "CampaignTargets";
const API_ROOT = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;

function getToken() {
  return import.meta.env.VITE_AIRTABLE_PAT || "";
}

function headers() {
  return {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

// ── READ ────────────────────────────────────────────────────────────

/**
 * Fetch all targets for a given campaign reference.
 * Returns a Map<domain, record> for fast lookups.
 */
export async function fetchCandidateTargets(campaignRef) {
  const all = [];
  let offset = null;
  const formula = encodeURIComponent(`{CampaignRef}="${campaignRef}"`);

  do {
    let url = `${API_ROOT}?filterByFormula=${formula}`;
    if (offset) url += `&offset=${offset}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable CampaignTargets GET ${res.status}: ${body}`);
    }
    const data = await res.json();
    all.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);

  // Build domain → record map
  const map = {};
  for (const rec of all) {
    const domain = (rec.fields.Domain || "").toLowerCase();
    if (domain) {
      let selectedContacts = [];
      try { selectedContacts = JSON.parse(rec.fields.SelectedContacts || "[]"); } catch { /* noop */ }
      map[domain] = {
        id: rec.id,
        domain,
        companyName: rec.fields.CompanyName || "",
        status: rec.fields.Status || "pending",
        selectedContacts,
        campaignRef: rec.fields.CampaignRef || "",
        segment: rec.fields.Segment || "",
        companyType: rec.fields.CompanyType || "",
        technologies: (() => { try { return JSON.parse(rec.fields.Technologies || "[]"); } catch { return []; } })(),
        reviewedBy: rec.fields.ReviewedBy || "",
        reviewedAt: rec.fields.ReviewedAt || "",
        notes: rec.fields.Notes || "",
      };
    }
  }
  return map;
}

// ── CREATE / UPDATE ─────────────────────────────────────────────────

/**
 * Upsert a candidate target by domain.
 * If record.id exists → PATCH, otherwise → POST.
 */
export async function upsertCandidateTarget(record) {
  const fields = {
    Domain: record.domain,
    CompanyName: record.companyName || "",
    Status: record.status || "pending",
    SelectedContacts: JSON.stringify(record.selectedContacts || []),
    CampaignRef: record.campaignRef || "",
    Segment: record.segment || "",
    CompanyType: record.companyType || "",
    Technologies: JSON.stringify(record.technologies || []),
    ReviewedBy: record.reviewedBy || "",
    ReviewedAt: record.reviewedAt || new Date().toISOString().split("T")[0],
    Notes: record.notes || "",
  };

  if (record.id) {
    // PATCH existing
    const res = await fetch(`${API_ROOT}/${record.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable CampaignTargets PATCH ${res.status}: ${body}`);
    }
    return res.json();
  } else {
    // POST new
    const res = await fetch(API_ROOT, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable CampaignTargets POST ${res.status}: ${body}`);
    }
    return res.json();
  }
}

// ── DELETE ───────────────────────────────────────────────────────────

export async function deleteCandidateTarget(recordId) {
  const res = await fetch(`${API_ROOT}/${recordId}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable CampaignTargets DELETE ${res.status}: ${body}`);
  }
  return res.json();
}
