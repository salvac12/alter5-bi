/**
 * Airtable REST API client for Internal - Tasks table.
 *
 * Syncs prospect tasks to Airtable, linking Owner (Config - Users)
 * and Opportunity (if prospect was converted).
 */

import { TEAM_MEMBERS } from './airtableProspects';

const BASE_ID = "appVu3TvSZ1E4tj0J";
const TABLE_NAME = "Internal - Tasks";
const USERS_TABLE_ID = "tblb3kyXSnXS0GPjy";
const API_ROOT = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
const USERS_API = `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}`;

function getToken() {
  return import.meta.env.VITE_AIRTABLE_PAT || "";
}

function headers() {
  return {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

// ── Status mapping ──────────────────────────────────────────────────

export const STATUS_MAP = {
  pendiente: "To do",
  en_curso: "Doing",
  hecho: "Done",
};

const STATUS_MAP_REVERSE = {
  "To do": "pendiente",
  "Doing": "en_curso",
  "Done": "hecho",
};

// ── User cache (email → recordId) ──────────────────────────────────

const userCache = new Map();

export async function fetchUserByEmail(email) {
  if (!email) return null;
  if (userCache.has(email)) return userCache.get(email);

  const formula = encodeURIComponent(`{Email}="${email}"`);
  const res = await fetch(`${USERS_API}?filterByFormula=${formula}&maxRecords=1`, {
    headers: headers(),
  });
  if (!res.ok) {
    console.warn(`Config - Users lookup failed for ${email}:`, res.status);
    return null;
  }
  const data = await res.json();
  const recordId = data.records?.[0]?.id || null;
  if (recordId) userCache.set(email, recordId);
  return recordId;
}

// ── Resolve owner name → Airtable record ID ────────────────────────

async function resolveOwner(assignedToName) {
  if (!assignedToName) return null;
  const member = TEAM_MEMBERS.find(m => m.name === assignedToName);
  if (!member) return null;
  return fetchUserByEmail(member.email);
}

// ── CREATE ──────────────────────────────────────────────────────────

export async function createAirtableTask(task, opportunityId) {
  const fields = {
    "Name": task.text || "",
    "Status": STATUS_MAP[task.status] || "To do",
  };

  if (task.description) fields["Description"] = task.description;
  if (task.dueDate) fields["Deadline"] = task.dueDate;

  const ownerRecId = await resolveOwner(task.assignedTo);
  if (ownerRecId) fields["Owner"] = [ownerRecId];

  if (opportunityId) fields["Opportunity"] = [opportunityId];

  const res = await fetch(API_ROOT, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Tasks POST ${res.status}: ${body}`);
  }
  const record = await res.json();
  return record.id;
}

// ── UPDATE ──────────────────────────────────────────────────────────

export async function updateAirtableTask(airtableId, task) {
  const fields = {
    "Name": task.text || "",
    "Status": STATUS_MAP[task.status] || "To do",
  };

  if (task.description !== undefined) fields["Description"] = task.description || "";
  if (task.dueDate !== undefined) fields["Deadline"] = task.dueDate || null;

  const ownerRecId = await resolveOwner(task.assignedTo);
  if (ownerRecId) {
    fields["Owner"] = [ownerRecId];
  }

  const res = await fetch(`${API_ROOT}/${airtableId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Tasks PATCH ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Sync all tasks for a prospect ───────────────────────────────────

/**
 * Sync an array of tasks to Airtable.
 * - Tasks without airtableId → create
 * - Tasks with airtableId → update
 * Returns updated tasks array with airtableIds populated.
 */
export async function syncTasksToAirtable(tasks, opportunityId) {
  if (!getToken() || !tasks?.length) return { tasks, synced: 0, errors: 0 };

  let synced = 0;
  let errors = 0;
  const updatedTasks = [...tasks];

  for (let i = 0; i < updatedTasks.length; i++) {
    const task = updatedTasks[i];
    try {
      if (!task.airtableId) {
        const airtableId = await createAirtableTask(task, opportunityId);
        updatedTasks[i] = { ...task, airtableId };
        synced++;
      } else {
        await updateAirtableTask(task.airtableId, task);
        synced++;
      }
    } catch (err) {
      console.warn(`Task sync failed for "${task.text}":`, err.message);
      errors++;
    }
  }

  return { tasks: updatedTasks, synced, errors };
}
