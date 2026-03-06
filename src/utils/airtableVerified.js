/**
 * Verified-Companies — Airtable REST API backend.
 *
 * Stores company classification verifications (agent + manual edits).
 * The pipeline (process_sheet_emails.py) reads from this table to
 * avoid overwriting verified classifications.
 *
 * Same base as Opportunities/Prospects (appVu3TvSZ1E4tj0J).
 * Table: "Verified-Companies" (create with scripts/create_verified_table.py)
 */

const BASE_ID = "appVu3TvSZ1E4tj0J";
const TABLE_NAME = "Verified-Companies";
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
let verifiedCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all verified companies from Airtable (with cache).
 * Returns Map<domain, VerifiedRecord> for O(1) lookups.
 */
export async function fetchAllVerified() {
  const now = Date.now();
  if (verifiedCache && (now - cacheTimestamp) < CACHE_TTL) {
    return verifiedCache;
  }

  const token = getToken();
  if (!token) return new Map();

  const allRecords = [];
  let offset = "";

  try {
    do {
      let url = `${API_ROOT}?pageSize=100`;
      if (offset) url += `&offset=${offset}`;

      const res = await fetch(url, { headers: headers() });
      if (!res.ok) {
        console.warn("Verified fetch error:", res.status);
        return verifiedCache || new Map();
      }
      const data = await res.json();
      allRecords.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);
  } catch (err) {
    console.warn("Verified fetch failed:", err.message);
    return verifiedCache || new Map();
  }

  const map = new Map();
  for (const r of allRecords) {
    const domain = r.fields.Domain || "";
    if (!domain) continue;
    map.set(domain, {
      id: r.id,
      domain,
      companyName: r.fields["Company Name"] || "",
      previousClassification: r.fields["Previous Classification"] || "",
      role: r.fields.Role || "",
      segment: r.fields.Segment || "",
      type: r.fields.Type || "",
      activities: r.fields.Activities || [],
      technologies: r.fields.Technologies || [],
      geography: r.fields.Geography || [],
      marketRoles: r.fields["Market Roles"] || [],
      webDescription: r.fields["Web Description"] || "",
      webSources: r.fields["Web Sources"] || "",
      status: r.fields.Status || "",
      verifiedBy: r.fields["Verified By"] || "",
      verifiedAt: r.fields["Verified At"] || "",
      notes: r.fields.Notes || "",
      mismatch: r.fields.Mismatch || false,
    });
  }

  verifiedCache = map;
  cacheTimestamp = now;
  return map;
}

/**
 * Get verification status for a single domain.
 * Returns the record or null.
 */
export async function getVerification(domain) {
  const all = await fetchAllVerified();
  return all.get(domain) || null;
}

/**
 * Save (create or update) a verification for a company.
 * If a record already exists for this domain, it updates via PATCH.
 * Otherwise, it creates a new record via POST.
 */
export async function saveVerification(domain, data) {
  const token = getToken();
  if (!token || !domain) return null;

  // Build Airtable fields
  const fields = {
    Domain: domain,
  };
  if (data.companyName) fields["Company Name"] = data.companyName;
  if (data.previousClassification) fields["Previous Classification"] = data.previousClassification;
  if (data.role) fields.Role = data.role;
  if (data.segment) fields.Segment = data.segment;
  if (data.type) fields.Type = data.type;
  if (data.activities?.length) fields.Activities = data.activities;
  if (data.technologies?.length) fields.Technologies = data.technologies;
  if (data.geography?.length) fields.Geography = data.geography;
  if (data.marketRoles?.length) fields["Market Roles"] = data.marketRoles;
  if (data.webDescription) fields["Web Description"] = data.webDescription;
  if (data.webSources) fields["Web Sources"] = data.webSources;
  if (data.status) fields.Status = data.status;
  if (data.verifiedBy) fields["Verified By"] = data.verifiedBy;
  if (data.notes !== undefined) fields.Notes = data.notes || "";
  if (data.mismatch !== undefined) fields.Mismatch = !!data.mismatch;

  fields["Verified At"] = new Date().toISOString();

  // Check if record exists
  const existing = await getVerification(domain);

  try {
    let res;
    if (existing) {
      // PATCH existing
      res = await fetch(`${API_ROOT}/${existing.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ fields }),
      });
    } else {
      // POST new
      res = await fetch(API_ROOT, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ fields }),
      });
    }

    if (!res.ok) {
      const body = await res.text();
      console.error("Verified save error:", res.status, body);
      return null;
    }

    const record = await res.json();

    // Invalidate cache
    verifiedCache = null;

    return record.id;
  } catch (err) {
    console.error("Verified save failed:", err.message);
    return null;
  }
}

/**
 * Invalidate the cache (useful after external writes).
 */
export function invalidateVerifiedCache() {
  verifiedCache = null;
  cacheTimestamp = 0;
}
