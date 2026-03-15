/**
 * Airtable REST API client for Internal - Tasks table.
 *
 * Syncs prospect tasks to Airtable, linking Owner (Config - Users)
 * and Opportunity (if prospect was converted).
 * All requests go through /api/airtable-proxy (Vercel serverless).
 */

import { TEAM_MEMBERS } from './airtableProspects';
import { airtableProxy, isProxyConfigured } from './proxyClient';

const TABLE_NAME = "Internal - Tasks";
const USERS_TABLE_ID = "tblb3kyXSnXS0GPjy";

// -- Status mapping ----------------------------------------------------------

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

// -- User cache (email -> recordId) ------------------------------------------

const userCache = new Map();

export async function fetchUserByEmail(email) {
  if (!email) return null;
  if (userCache.has(email)) return userCache.get(email);

  try {
    const formula = `{Email}="${email}"`;
    // Use the users table ID directly as the table name
    const data = await airtableProxy({
      table: USERS_TABLE_ID,
      method: 'GET',
      formula,
      pageSize: 1,
    });
    const recordId = data.records?.[0]?.id || null;
    if (recordId) userCache.set(email, recordId);
    return recordId;
  } catch (err) {
    console.warn(`Config - Users lookup failed for ${email}:`, err.message);
    return null;
  }
}

// -- Resolve owner name -> Airtable record ID --------------------------------

async function resolveOwner(assignedToName) {
  if (!assignedToName) return null;
  const member = TEAM_MEMBERS.find(m => m.name === assignedToName);
  if (!member) return null;
  return fetchUserByEmail(member.email);
}

// -- CREATE ------------------------------------------------------------------

export async function createAirtableTask(task, opportunityId) {
  const fields: Record<string, any> = {
    "Name": task.text || "",
    "Status": STATUS_MAP[task.status] || "To do",
  };

  if (task.description) fields["Description"] = task.description;
  if (task.dueDate) fields["Deadline"] = task.dueDate;

  const ownerRecId = await resolveOwner(task.assignedTo);
  if (ownerRecId) fields["Owner"] = [ownerRecId];

  if (opportunityId) fields["Opportunity"] = [opportunityId];

  const record = await airtableProxy({
    table: TABLE_NAME,
    method: 'POST',
    fields,
  });
  return record.id;
}

// -- UPDATE ------------------------------------------------------------------

export async function updateAirtableTask(airtableId, task) {
  const fields: Record<string, any> = {
    "Name": task.text || "",
    "Status": STATUS_MAP[task.status] || "To do",
  };

  if (task.description !== undefined) fields["Description"] = task.description || "";
  if (task.dueDate !== undefined) fields["Deadline"] = task.dueDate || null;

  const ownerRecId = await resolveOwner(task.assignedTo);
  if (ownerRecId) {
    fields["Owner"] = [ownerRecId];
  }

  return airtableProxy({
    table: TABLE_NAME,
    method: 'PATCH',
    recordId: airtableId,
    fields,
  });
}

// -- Sync all tasks for a prospect -------------------------------------------

/**
 * Sync an array of tasks to Airtable.
 * - Tasks without airtableId -> create
 * - Tasks with airtableId -> update
 * Returns updated tasks array with airtableIds populated.
 */
export async function syncTasksToAirtable(tasks, opportunityId) {
  if (!isProxyConfigured() || !tasks?.length) return { tasks, synced: 0, errors: 0 };

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
