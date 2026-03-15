/**
 * Verified-Companies -- Airtable REST API backend.
 *
 * Stores company classification verifications (agent + manual edits).
 * The pipeline (process_sheet_emails.py) reads from this table to
 * avoid overwriting verified classifications.
 *
 * Same base as Opportunities/Prospects (appVu3TvSZ1E4tj0J).
 * Table: "Verified-Companies"
 * All requests go through /api/airtable-proxy (Vercel serverless).
 */

import { airtableProxy, isProxyConfigured } from './proxyClient';

const TABLE_NAME = "Verified-Companies";

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

  if (!isProxyConfigured()) return new Map();

  const allRecords = [];
  let offset = "";

  try {
    do {
      const data = await airtableProxy({
        table: TABLE_NAME,
        method: 'GET',
        pageSize: 100,
        ...(offset ? { offset } : {}),
      });
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
      website: r.fields.Website || "",
      mismatch: r.fields.Mismatch || false,
      confidence: r.fields.Confidence || "",
      employeeCount: r.fields["Employee Count"] || null,
      employeeCountSource: r.fields["Employee Count Source"] || "",
      estimatedRevenueEur: r.fields["Estimated Revenue EUR"] || null,
      revenueSource: r.fields["Revenue Source"] || "",
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
  if (!isProxyConfigured() || !domain) return null;

  // Build Airtable fields
  const fields: Record<string, any> = {
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
    let record;
    if (existing) {
      // PATCH existing
      record = await airtableProxy({
        table: TABLE_NAME,
        method: 'PATCH',
        recordId: existing.id,
        fields,
      });
    } else {
      // POST new
      record = await airtableProxy({
        table: TABLE_NAME,
        method: 'POST',
        fields,
      });
    }

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

// -- Accent mapping: Airtable singleSelect (no accents) -> enrichment (with accents) --
const ROLE_ACCENT_MAP = {
  "Originacion": "Originación",
  "Inversion": "Inversión",
  "Services": "Services",
  "No relevante": "No relevante",
};

const TYPE_ACCENT_MAP = {
  "Asesor tecnico": "Asesor técnico",
  "Asociacion / Institucion": "Asociación / Institución",
  "Ingenieria": "Ingeniería",
};

const TECH_ACCENT_MAP = {
  "Eolica": "Eólica",
  "Biogas": "Biogás",
  "Hidrogeno": "Hidrógeno",
};

const GEO_ACCENT_MAP = {
  "Espana": "España",
};

function mapAccent(value, map) {
  return map[value] || value;
}

function mapAccentArray(arr, map) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(v => map[v] || v);
}

/**
 * Convert a verified record from Airtable format to enrichment override format
 * (with proper accents restored).
 * Returns an object compatible with saveEnrichmentOverride().
 */
export function verifiedToEnrichmentOverride(verified) {
  if (!verified || !verified.role) return null;

  const override: Record<string, any> = {};
  if (verified.role) override.role = mapAccent(verified.role, ROLE_ACCENT_MAP);
  if (verified.segment) override.seg = verified.segment; // segments don't have accents
  if (verified.type) override.tp2 = mapAccent(verified.type, TYPE_ACCENT_MAP);
  if (verified.technologies?.length) override.tech = mapAccentArray(verified.technologies, TECH_ACCENT_MAP);
  if (verified.geography?.length) override.geo = mapAccentArray(verified.geography, GEO_ACCENT_MAP);
  if (verified.marketRoles?.length) override.mr = verified.marketRoles; // no accents needed

  return override;
}
