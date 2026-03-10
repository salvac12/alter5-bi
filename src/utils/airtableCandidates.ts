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
  const safeCampaignRef = String(campaignRef).replace(/"/g, '\\"');
  const formula = encodeURIComponent(`{CampaignRef}="${safeCampaignRef}"`);

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

// ── FETCH ALL BRIDGE TARGETS (across all waves) ─────────────────────

/**
 * Fetch ALL CampaignTargets whose CampaignRef starts with a given prefix.
 * Used to detect the next wave number and to find approved companies across waves.
 * Returns { allTargets: Map<domain, record>, maxWave: number }
 */
export async function fetchAllBridgeTargets(refPrefix = "Bridge_Q1") {
  const all = [];
  let offset = null;
  // FIND() with LEFT() to match prefix — e.g. Bridge_Q1, Bridge_Q1_W2, etc.
  const formula = encodeURIComponent(
    `FIND("${refPrefix}", {CampaignRef}) = 1`
  );

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

  // Build domain → record map (latest wave wins for duplicates)
  const map = {};
  let maxWave = 1; // Wave 1 = Bridge_Q1 (original)

  for (const rec of all) {
    const domain = (rec.fields.Domain || "").toLowerCase();
    const ref = rec.fields.CampaignRef || "";
    // Detect wave number: Bridge_Q1 = W1, Bridge_Q1_W2 = W2, etc.
    const waveMatch = ref.match(/_W(\d+)$/);
    const waveNum = waveMatch ? parseInt(waveMatch[1], 10) : 1;
    if (waveNum > maxWave) maxWave = waveNum;

    if (domain) {
      let selectedContacts = [];
      try { selectedContacts = JSON.parse(rec.fields.SelectedContacts || "[]"); } catch { /* noop */ }
      // Keep the most recent entry per domain (higher wave or same wave)
      if (!map[domain] || waveNum >= (map[domain]._waveNum || 1)) {
        map[domain] = {
          id: rec.id,
          domain,
          companyName: rec.fields.CompanyName || "",
          status: rec.fields.Status || "pending",
          selectedContacts,
          campaignRef: ref,
          segment: rec.fields.Segment || "",
          companyType: rec.fields.CompanyType || "",
          technologies: (() => { try { return JSON.parse(rec.fields.Technologies || "[]"); } catch { return []; } })(),
          reviewedBy: rec.fields.ReviewedBy || "",
          reviewedAt: rec.fields.ReviewedAt || "",
          notes: rec.fields.Notes || "",
          _waveNum: waveNum,
        };
      }
    }
  }
  return { allTargets: map, maxWave };
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
