/**
 * Distribution - Investor Selection -- Airtable REST API client.
 *
 * Fetches "Investor - Strategic Notes" from the investor selection table.
 * Same base as Opportunities/Prospects (appVu3TvSZ1E4tj0J).
 * All requests go through /api/airtable-proxy (Vercel serverless).
 */

import { airtableProxy, isProxyConfigured } from './proxyClient';

const TABLE_NAME = "Distribution - Investor Selection";

// -- In-memory cache --
let notesCache: Map<string, string[]> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all investor strategic notes from Airtable (with cache).
 * Returns Map<companyName, string[]> for O(1) lookups.
 */
export async function fetchAllInvestorNotes(): Promise<Map<string, string[]>> {
  const now = Date.now();
  if (notesCache && (now - cacheTimestamp) < CACHE_TTL) {
    return notesCache;
  }

  if (!isProxyConfigured()) return new Map();

  const allRecords: any[] = [];
  let offset = "";

  try {
    do {
      const data = await airtableProxy({
        table: TABLE_NAME,
        method: 'GET',
        pageSize: 100,
        fieldsList: ["Investor - Strategic Notes", "Name"],
        ...(offset ? { offset } : {}),
      });
      allRecords.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);
  } catch (err: any) {
    console.warn("InvestorNotes fetch failed:", err.message);
    return notesCache || new Map();
  }

  const map = new Map<string, string[]>();
  for (const r of allRecords) {
    const name = r.fields.Name || "";
    const notes = r.fields["Investor - Strategic Notes"];
    if (!name || !notes) continue;
    // Notes can be a string or array of strings
    const notesArr = Array.isArray(notes) ? notes : [notes];
    if (notesArr.length > 0) {
      map.set(name, notesArr);
    }
  }

  notesCache = map;
  cacheTimestamp = now;
  return map;
}

/**
 * Get strategic notes for a single company by name.
 */
export async function getInvestorNotes(companyName: string): Promise<string[] | null> {
  const all = await fetchAllInvestorNotes();
  return all.get(companyName) || null;
}
