/**
 * Distribution - Investor Selection — Airtable REST API client.
 *
 * Fetches "Investor - Strategic Notes" from the investor selection table.
 * Same base as Opportunities/Prospects (appVu3TvSZ1E4tj0J).
 */

const BASE_ID = "appVu3TvSZ1E4tj0J";
const TABLE_NAME = "Distribution - Investor Selection";
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

  const token = getToken();
  if (!token) return new Map();

  const allRecords: any[] = [];
  let offset = "";

  try {
    do {
      let url = `${API_ROOT}?pageSize=100`;
      // Only fetch fields we need
      url += `&fields[]=${encodeURIComponent("Investor - Strategic Notes")}`;
      url += `&fields[]=${encodeURIComponent("Name")}`;
      if (offset) url += `&offset=${offset}`;

      const res = await fetch(url, { headers: headers() });
      if (!res.ok) {
        console.warn("InvestorNotes fetch error:", res.status);
        return notesCache || new Map();
      }
      const data = await res.json();
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
