/**
 * Airtable REST API client for Prospects table.
 *
 * Uses VITE_AIRTABLE_PAT (env var injected at build time by Vite).
 * Base: appVu3TvSZ1E4tj0J  |  Table: Prospects
 */

const BASE_ID = "appVu3TvSZ1E4tj0J";
const TABLE_NAME = "Prospects";
const API_ROOT = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;

// Also need Opportunities API for conversion
const OPP_TABLE = "Opportunities";
const OPP_API_ROOT = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(OPP_TABLE)}`;

function getToken() {
  return import.meta.env.VITE_AIRTABLE_PAT || "";
}

function headers() {
  return {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

// ── Prospect Stages ─────────────────────────────────────────────────

export const PROSPECT_STAGES = [
  "Lead",
  "Interesado",
  "Reunion",
  "Documentacion Pendiente",
  "Listo para Term-Sheet",
];

export const PROSPECT_STAGE_COLORS = {
  "Lead":                       { bg: "#F5F3FF", color: "#6B21A8", border: "#DDD6FE" },
  "Interesado":                 { bg: "#ECFDF5", color: "#047857", border: "#A7F3D0" },
  "Reunion":                    { bg: "#FFFBEB", color: "#D97706", border: "#FDE68A" },
  "Documentacion Pendiente":    { bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA" },
  "Listo para Term-Sheet":      { bg: "#ECFDF5", color: "#059669", border: "#A7F3D0" },
};

export const PROSPECT_STAGE_SHORT = {
  "Lead":                       "Lead",
  "Interesado":                 "Interesado",
  "Reunion":                    "Reunion",
  "Documentacion Pendiente":    "Doc. Pend.",
  "Listo para Term-Sheet":      "Term-Sheet",
};

// ── Origin options ──────────────────────────────────────────────────

export const ORIGIN_OPTIONS = [
  "Referral",
  "Evento",
  "Campana",
  "Cold Outreach",
  "Web/Inbound",
  "Otro",
];

// ── Team members placeholder ────────────────────────────────────────

export const TEAM_MEMBERS = [
  "Otro",
  // Will be populated with real names later
];

// ── READ ────────────────────────────────────────────────────────────

/**
 * Fetch all active prospects from Airtable (handles pagination).
 */
export async function fetchAllProspects() {
  const all = [];
  let offset = null;
  const formula = encodeURIComponent(
    'OR({Record Status} = "Active", {Record Status} = BLANK())'
  );

  do {
    let url = `${API_ROOT}?filterByFormula=${formula}`;
    if (offset) url += `&offset=${offset}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable Prospects GET ${res.status}: ${body}`);
    }
    const data = await res.json();
    all.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);

  return all;
}

/**
 * Fetch a single prospect record by ID.
 */
export async function fetchProspect(recordId) {
  const res = await fetch(`${API_ROOT}/${recordId}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Prospects GET ${res.status}: ${body}`);
  }
  return res.json();
}

// ── CREATE ──────────────────────────────────────────────────────────

/**
 * Create a new prospect record.
 */
export async function createProspect(fields) {
  const res = await fetch(API_ROOT, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Prospects POST ${res.status}: ${body}`);
  }
  return res.json();
}

// ── UPDATE ──────────────────────────────────────────────────────────

/**
 * Update an existing prospect (PATCH — partial update).
 */
export async function updateProspect(recordId, fields) {
  const res = await fetch(`${API_ROOT}/${recordId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Prospects PATCH ${res.status}: ${body}`);
  }
  return res.json();
}

// ── DELETE ───────────────────────────────────────────────────────────

/**
 * Delete a prospect by ID.
 */
export async function deleteProspect(recordId) {
  const res = await fetch(`${API_ROOT}/${recordId}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Prospects DELETE ${res.status}: ${body}`);
  }
  return res.json();
}

// ── CONVERSION: Prospect → Opportunity ──────────────────────────────

/**
 * Convert a prospect to an opportunity in the Opportunities table.
 * Creates a new Opportunity record and marks the prospect as Converted.
 * @param {object} prospect - Normalized prospect object
 * @returns {{ opportunity: object, prospect: object }} Both updated records
 */
export async function convertToOpportunity(prospect) {
  // 1. Create Opportunity in Opportunities table
  const oppFields = {
    "Opportunity Name": prospect.name,
    "Global Status": "Origination - Termsheet",
    "Targeted Ticket Size": prospect.amount || 0,
    "Currency": prospect.currency || "EUR",
    "Notes": `Convertido desde Prospect.\n\nContexto:\n${prospect.context || ""}\n\nPr. pasos:\n${prospect.nextSteps || ""}`,
    "Record Status": "Active",
  };

  const oppRes = await fetch(OPP_API_ROOT, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields: oppFields }),
  });
  if (!oppRes.ok) {
    const body = await oppRes.text();
    throw new Error(`Failed to create Opportunity: ${oppRes.status}: ${body}`);
  }
  const newOpp = await oppRes.json();

  // 2. Mark prospect as converted
  const prospectUpdate = {
    "Converted": true,
    "Opportunity ID": newOpp.id,
    "Stage": "Listo para Term-Sheet",
  };

  const prospRes = await fetch(`${API_ROOT}/${prospect.id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields: prospectUpdate }),
  });
  if (!prospRes.ok) {
    const body = await prospRes.text();
    throw new Error(`Prospect conversion update failed: ${prospRes.status}: ${body}`);
  }
  const updatedProspect = await prospRes.json();

  return { opportunity: newOpp, prospect: updatedProspect };
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Normalize a raw Airtable record into our app shape */
export function normalizeProspect(record) {
  const f = record.fields || {};
  const name = f["Prospect Name"] || "";
  const stage = f["Stage"] || "Lead";
  let amount = f["Amount"] || 0;
  if (typeof amount === "string") {
    amount = parseFloat(amount.replace(/,/g, "").replace(/\./g, "")) || 0;
  }
  let currency = f["Currency"] || "EUR";
  if (Array.isArray(currency)) currency = "EUR";
  const product = f["Product"] || "";
  const origin = f["Origin"] || "";
  const context = f["Context"] || "";
  const nextSteps = f["Next Steps"] || "";
  const assignedTo = f["Assigned To"] || "";
  const assignedEmail = f["Assigned Email"] || "";
  const converted = !!f["Converted"];
  const opportunityId = f["Opportunity ID"] || "";
  const recordStatus = f["Record Status"] || "Active";

  return {
    id: record.id,
    name: name.trim(),
    stage,
    amount: amount || 0,
    currency: String(currency),
    product: String(product),
    origin: String(origin),
    context,
    nextSteps,
    assignedTo: String(assignedTo),
    assignedEmail,
    converted,
    opportunityId,
    recordStatus,
    _raw: f,
  };
}

/** Check if a prospect is valid (not junk) */
export function isValidProspect(p) {
  const name = (p.name || "").trim();
  if (!name || name.length < 2) return false;
  if (!p.stage) return false;
  if (p.recordStatus && /^(archived|deleted|inactive)$/i.test(p.recordStatus)) return false;
  return true;
}
