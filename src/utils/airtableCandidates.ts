/**
 * CampaignTargets data layer -- Airtable REST API backend.
 *
 * Same base as Prospects (appVu3TvSZ1E4tj0J), table "CampaignTargets".
 * Tracks which companies have been reviewed for campaign targeting.
 * All requests go through /api/airtable-proxy (Vercel serverless).
 */

import { airtableProxy } from './proxyClient';

const TABLE_NAME = "CampaignTargets";

// -- READ --------------------------------------------------------------------

/**
 * Fetch all targets for a given campaign reference.
 * Returns a Map<domain, record> for fast lookups.
 */
export async function fetchCandidateTargets(campaignRef) {
  const all = [];
  let offset = null;
  const formula = `{CampaignRef}="${campaignRef}"`;

  do {
    const data = await airtableProxy({
      table: TABLE_NAME,
      method: 'GET',
      formula,
      ...(offset ? { offset } : {}),
    });
    all.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);

  // Build domain -> record map
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

// -- CREATE / UPDATE ---------------------------------------------------------

/**
 * Upsert a candidate target by domain.
 * If record.id exists -> PATCH, otherwise -> POST.
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
    return airtableProxy({
      table: TABLE_NAME,
      method: 'PATCH',
      recordId: record.id,
      fields,
    });
  } else {
    // POST new
    return airtableProxy({
      table: TABLE_NAME,
      method: 'POST',
      fields,
    });
  }
}

// -- FETCH ALL BRIDGE TARGETS (across all waves) -----------------------------

/**
 * Fetch ALL CampaignTargets whose CampaignRef starts with a given prefix.
 * Used to detect the next wave number and to find approved companies across waves.
 * Returns { allTargets: Map<domain, record>, maxWave: number }
 */
export async function fetchAllBridgeTargets(refPrefix = "Bridge_Q1") {
  const all = [];
  let offset = null;
  // FIND() with LEFT() to match prefix
  const formula = `FIND("${refPrefix}", {CampaignRef}) = 1`;

  do {
    const data = await airtableProxy({
      table: TABLE_NAME,
      method: 'GET',
      formula,
      ...(offset ? { offset } : {}),
    });
    all.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);

  // Build domain -> record map (latest wave wins for duplicates)
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

// -- DELETE ------------------------------------------------------------------

export async function deleteCandidateTarget(recordId) {
  return airtableProxy({
    table: TABLE_NAME,
    method: 'DELETE',
    recordId,
  });
}
