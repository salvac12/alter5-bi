/**
 * Airtable REST API client for browser-side CRUD operations.
 *
 * All requests go through /api/airtable-proxy (Vercel serverless).
 * Base: appVu3TvSZ1E4tj0J  |  Table: Opportunities
 */

import { airtableProxy, isProxyConfigured } from './proxyClient';

const TABLE_NAME = "Opportunities";

/** Check if Airtable integration is configured */
export function isAirtableConfigured() {
  return isProxyConfigured();
}

// -- READ --------------------------------------------------------------------

/**
 * Fetch all records from the Opportunities table (handles pagination).
 * Returns raw Airtable records: [{ id, fields, createdTime }, ...]
 */
export async function fetchAllOpportunities() {
  const all = [];
  let offset = null;
  const formula =
    'AND({Type of opportunity} = "Transaction", {Record Status} = "Active", {Global Status} != "Stand-by")';

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

  return all;
}

/**
 * Fetch a single record by ID.
 */
export async function fetchOpportunity(recordId) {
  return airtableProxy({
    table: TABLE_NAME,
    method: 'GET',
    recordId,
  });
}

// -- CREATE ------------------------------------------------------------------

/**
 * Create a new opportunity record.
 * @param {object} fields - Airtable field values
 * @returns {object} Created record { id, fields, createdTime }
 */
export async function createOpportunity(fields) {
  return airtableProxy({
    table: TABLE_NAME,
    method: 'POST',
    fields,
  });
}

// -- UPDATE ------------------------------------------------------------------

/**
 * Update an existing record (PATCH -- partial update).
 * @param {string} recordId - Airtable record ID (rec...)
 * @param {object} fields - Fields to update
 * @returns {object} Updated record
 */
export async function updateOpportunity(recordId, fields) {
  return airtableProxy({
    table: TABLE_NAME,
    method: 'PATCH',
    recordId,
    fields,
  });
}

/**
 * Batch update multiple records (max 10 per request per Airtable limits).
 * @param {Array<{id: string, fields: object}>} updates
 */
export async function batchUpdateOpportunities(updates) {
  const results = [];
  // Airtable allows max 10 records per batch request
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const data = await airtableProxy({
      table: TABLE_NAME,
      method: 'PATCH',
      records: batch,
    });
    results.push(...(data.records || []));
  }
  return results;
}

// -- DELETE ------------------------------------------------------------------

/**
 * Delete a record by ID.
 */
export async function deleteOpportunity(recordId) {
  return airtableProxy({
    table: TABLE_NAME,
    method: 'DELETE',
    recordId,
  });
}

// -- Helpers -----------------------------------------------------------------

/** Junk / test name patterns to exclude */
const JUNK_NAMES = /^(test|prueba|unnamed|sin nombre|xxx|aaa|bbb|dummy|ejemplo|sample|sabri)\b/i;
const JUNK_EXACT = new Set(["all", "defense", "lm8", "bwb", "dvp"]);

/** Check if a normalized record is a real opportunity (not junk/archived/inactive) */
export function isValidOpportunity(opp) {
  const name = (opp.name || "").trim();
  // No name or too short
  if (!name || name.length < 3) return false;
  // Known junk patterns
  if (JUNK_NAMES.test(name)) return false;
  // Known junk exact names (case-insensitive)
  if (JUNK_EXACT.has(name.toLowerCase())) return false;
  // Archived, deleted, or inactive records
  if (opp.recordStatus && /^(archived|deleted|inactive)$/i.test(opp.recordStatus)) return false;
  // Stand-by records are paused/on-hold -- exclude from active pipeline views.
  if (opp.stage && opp.stage.toLowerCase() === "stand-by") return false;
  // No stage assigned -- orphan record
  if (!opp.stage) return false;
  return true;
}

/** Normalize a raw Airtable record into our app shape */
export function normalizeRecord(record) {
  const f = record.fields || {};
  const name = f["Opportunity Name"] || f["Name"] || "";
  const stage = f["Global Status"] || f["Stage"] || "";
  const phase = f["Workflow Phase (Debt)"] || "";
  let amount = f["Targeted Ticket Size"] || f["Amount"] || 0;
  if (typeof amount === "string") {
    amount = parseFloat(amount.replace(/,/g, "").replace(/\./g, "")) || 0;
  }
  let currency = f["Currency"] || "EUR";
  if (Array.isArray(currency)) currency = "EUR"; // linked record IDs
  const recordStatus = f["Record Status"] || "";

  // Business type from linked "Type (from Business Program)" field
  let businessType = f["Type (from Business Program)"] || "";
  if (Array.isArray(businessType)) businessType = businessType[0] || "";

  // Deal Manager / Responsible
  const dealManager = f["Deal Manager"] || f["Responsible"] || f["Assigned To"] || "";

  return {
    id: record.id,
    name: name.trim(),
    stage,
    phase,
    amount: amount || 0,
    currency: String(currency),
    recordStatus,
    businessType: String(businessType),
    dealManager: String(dealManager),
    // Keep raw fields for editing
    _raw: f,
  };
}

/** Kanban stage ordering (matches Airtable "Global Status" values) */
export const KANBAN_STAGES = [
  "New",
  "Origination - Preparation & NDA",
  "Origination - Financial Analysis",
  "Origination - Termsheet",
  "Distribution - Preparation",
  "Distribution - Ongoing",
  "In Execution",
  "Closed Successfully",
  "Rejection & Loss",
];

/** Stage color map */
export const STAGE_COLORS = {
  "New":                                { bg: "#EFF6FF", color: "#3B82F6", border: "#BFDBFE" },
  "Origination - Preparation & NDA":    { bg: "#FFF7ED", color: "#F97316", border: "#FED7AA" },
  "Origination - Financial Analysis":   { bg: "#FFFBEB", color: "#F59E0B", border: "#FDE68A" },
  "Origination - Termsheet":            { bg: "#FEF3C7", color: "#D97706", border: "#FCD34D" },
  "Distribution - Preparation":         { bg: "#F0FDF4", color: "#22C55E", border: "#BBF7D0" },
  "Distribution - Ongoing":             { bg: "#ECFDF5", color: "#10B981", border: "#A7F3D0" },
  "In Execution":                       { bg: "#EDE9FE", color: "#8B5CF6", border: "#C4B5FD" },
  "Closed Successfully":                { bg: "#F0FDFA", color: "#14B8A6", border: "#99F6E4" },
  "Rejection & Loss":                   { bg: "#FEF2F2", color: "#EF4444", border: "#FECACA" },
};

/** Short labels for column headers */
export const STAGE_SHORT_LABELS = {
  "New":                                "New",
  "Origination - Preparation & NDA":    "Prep & NDA",
  "Origination - Financial Analysis":   "Fin. Analysis",
  "Origination - Termsheet":            "Termsheet",
  "Distribution - Preparation":         "Dist. Prep",
  "Distribution - Ongoing":             "Dist. Ongoing",
  "In Execution":                       "Execution",
  "Closed Successfully":                "Closed",
  "Rejection & Loss":                   "Lost",
};
