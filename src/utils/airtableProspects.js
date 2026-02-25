/**
 * Prospects data layer — localStorage backend.
 *
 * Same interface as the Airtable version so ProspectsView / ProspectPanel
 * work unchanged. When the Airtable "Prospects" table is ready, swap back
 * to API calls.
 */

import { createOpportunity } from './airtable';

const LS_KEY = "alter5_prospects";

function generateId() {
  return "loc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch { return []; }
}

function saveAll(records) {
  localStorage.setItem(LS_KEY, JSON.stringify(records));
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
];

// ── READ ────────────────────────────────────────────────────────────

export async function fetchAllProspects() {
  const records = loadAll();
  // Return in Airtable record shape: { id, fields }
  return records
    .filter(r => {
      const status = r.fields?.["Record Status"] || "Active";
      return status === "Active" || !status;
    })
    .map(r => ({ id: r.id, fields: r.fields }));
}

export async function fetchProspect(recordId) {
  const records = loadAll();
  const found = records.find(r => r.id === recordId);
  if (!found) throw new Error(`Prospect ${recordId} not found`);
  return { id: found.id, fields: found.fields };
}

// ── CREATE ──────────────────────────────────────────────────────────

export async function createProspect(fields) {
  const records = loadAll();
  const newRecord = { id: generateId(), fields: { ...fields } };
  records.push(newRecord);
  saveAll(records);
  return { id: newRecord.id, fields: newRecord.fields };
}

// ── UPDATE ──────────────────────────────────────────────────────────

export async function updateProspect(recordId, fields) {
  const records = loadAll();
  const idx = records.findIndex(r => r.id === recordId);
  if (idx === -1) throw new Error(`Prospect ${recordId} not found`);
  records[idx].fields = { ...records[idx].fields, ...fields };
  saveAll(records);
  return { id: records[idx].id, fields: records[idx].fields };
}

// ── DELETE ───────────────────────────────────────────────────────────

export async function deleteProspect(recordId) {
  const records = loadAll();
  const filtered = records.filter(r => r.id !== recordId);
  saveAll(filtered);
  return { id: recordId, deleted: true };
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

  // 2. Mark prospect as converted in localStorage
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
  const assignedEmail = f["Assigned Email"] || "";
  const converted = !!f["Converted"];
  const opportunityId = f["Opportunity ID"] || "";
  const recordStatus = f["Record Status"] || "Active";
  const tasks = f["Tasks"] || [];

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
