/**
 * Prospects data layer — Airtable REST API backend.
 *
 * Same base as Opportunities (appVu3TvSZ1E4tj0J), table "Prospects".
 * Uses VITE_AIRTABLE_PAT (env var injected at build time by Vite).
 */

import { createOpportunity } from './airtable';

const BASE_ID = "appVu3TvSZ1E4tj0J";
const TABLE_NAME = "BETA-Prospects";
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

// ── Team members ────────────────────────────────────────────────────

export const TEAM_MEMBERS = [
  { name: "Carlos Almodovar", email: "carlos.almodovar@alter-5.com" },
  { name: "Gonzalo de Gracia", email: "gonzalo.degracia@alter-5.com" },
  { name: "Miguel Solana", email: "miguel.solana@alter-5.com" },
  { name: "Salvador Carrillo", email: "salvador.carrillo@alter-5.com" },
  { name: "Rafael Nevado", email: "rafael.nevado@alter-5.com" },
  { name: "Javier Ruiz", email: "javier.ruiz@alter-5.com" },
  { name: "Leticia Menendez", email: "leticia.menendez@alter-5.com" },
];

// ── Task templates ──────────────────────────────────────────────────

export const TASK_TEMPLATES = [
  "Convocar reunion",
  "Reclamar informacion",
  "Preparar Term-Sheet",
];

// ── READ ────────────────────────────────────────────────────────────

/**
 * Fetch all active prospects (handles pagination).
 * Returns raw Airtable records: [{ id, fields, createdTime }, ...]
 */
export async function fetchAllProspects() {
  const all = [];
  let offset = null;
  const formula = encodeURIComponent('{Record Status}="Active"');

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
 * Fetch a single prospect by ID.
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
 * @param {object} fields - Airtable field values
 * @returns {object} Created record { id, fields, createdTime }
 */
export async function createProspect(fields) {
  // Sanitize: strip linked-record arrays that shouldn't be sent as raw values
  const clean = { ...fields };
  for (const [k, v] of Object.entries(clean)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string" && v[0].startsWith("rec")) {
      delete clean[k];
    }
  }

  const res = await fetch(API_ROOT, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields: clean }),
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
 * @param {string} recordId - Airtable record ID (rec...)
 * @param {object} fields - Fields to update
 * @returns {object} Updated record
 */
export async function updateProspect(recordId, fields) {
  // Sanitize: remove fields that are arrays of record IDs (linked records read
  // from Airtable) — sending them as-is causes 422.
  const clean = { ...fields };
  for (const [k, v] of Object.entries(clean)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string" && v[0].startsWith("rec")) {
      delete clean[k];
    }
  }

  const res = await fetch(`${API_ROOT}/${recordId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields: clean }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Prospects PATCH ${res.status}: ${body}`);
  }
  return res.json();
}

// ── DELETE ───────────────────────────────────────────────────────────

/**
 * Delete a prospect record by ID.
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

export async function convertToOpportunity(prospect) {
  // 1. Create Opportunity in Airtable Opportunities table
  const oppFields = {
    "Opportunity Name": prospect.name,
    "Global Status": "Origination - Termsheet",
    "Targeted Ticket Size": prospect.amount || 0,
    "Currency": prospect.currency || "EUR",
    "Notes": `Convertido desde Prospect.\n\nContexto:\n${prospect.context || ""}\n\nPr. pasos:\n${prospect.nextSteps || ""}`,
    "Record Status": "Active",
  };

  const newOpp = await createOpportunity(oppFields);

  // 2. Mark prospect as converted
  const updated = await updateProspect(prospect.id, {
    "Converted": true,
    "Opportunity ID": newOpp.id,
    "Stage": "Listo para Term-Sheet",
  });

  return { opportunity: newOpp, prospect: { id: updated.id, fields: updated.fields } };
}

// ── Helpers ─────────────────────────────────────────────────────────

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
  const contactEmail = f["Contact Email"] || "";
  const assignedEmail = f["Assigned Email"] || "";

  // Contacts stored as JSON string in multilineText field
  let contacts = [];
  try { contacts = JSON.parse(f["Contacts"] || "[]"); } catch { contacts = []; }
  const converted = !!f["Converted"];
  const opportunityId = f["Opportunity ID"] || "";
  const recordStatus = f["Record Status"] || "Active";
  const dealManager = f["Deal Manager"] || "";

  // Tasks are stored as JSON string in Airtable multilineText field
  let tasks = [];
  try { tasks = JSON.parse(f["Tasks"] || "[]"); } catch { tasks = []; }

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
    contactEmail,
    contacts,
    dealManager,
    converted,
    opportunityId,
    recordStatus,
    tasks,
    _raw: f,
  };
}

export function isValidProspect(p) {
  const name = (p.name || "").trim();
  if (!name || name.length < 2) return false;
  if (!p.stage) return false;
  if (p.recordStatus && /^(archived|deleted|inactive)$/i.test(p.recordStatus)) return false;
  return true;
}
