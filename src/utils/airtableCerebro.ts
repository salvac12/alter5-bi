/**
 * Cerebro Knowledge Base — Airtable REST API backend.
 *
 * Stores past Q&A from the Cerebro AI so that future queries
 * benefit from accumulated organizational knowledge.
 *
 * Same base as Opportunities/Prospects (appVu3TvSZ1E4tj0J).
 * Table: "Cerebro-Knowledge" (create with scripts/create_cerebro_table.py)
 */

const BASE_ID = "appVu3TvSZ1E4tj0J";
const TABLE_NAME = "Cerebro-Knowledge";
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

// ── In-memory cache ──────────────────────────────────────────────────
// Avoids re-fetching from Airtable on every query within the same session.
let knowledgeCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all knowledge entries from Airtable (with cache).
 * Returns array of { id, question, answer, keywords, matchedDomains, matchCount, useful, notUseful, createdAt }
 */
export async function fetchAllKnowledge() {
  const now = Date.now();
  if (knowledgeCache && (now - cacheTimestamp) < CACHE_TTL) {
    return knowledgeCache;
  }

  const token = getToken();
  if (!token) return [];

  const allRecords = [];
  let offset = "";

  try {
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      params.set("sort[0][field]", "CreatedAt");
      params.set("sort[0][direction]", "desc");
      if (offset) params.set("offset", offset);

      const res = await fetch(`${API_ROOT}?${params}`, { headers: headers() });
      if (!res.ok) {
        console.warn("Cerebro KB fetch error:", res.status);
        return knowledgeCache || [];
      }
      const data = await res.json();
      allRecords.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);
  } catch (err) {
    console.warn("Cerebro KB fetch failed:", err.message);
    return knowledgeCache || [];
  }

  knowledgeCache = allRecords.map(r => ({
    id: r.id,
    question: r.fields.Question || "",
    answer: r.fields.Answer || "",
    keywords: (r.fields.Keywords || "").split(",").map(k => k.trim()).filter(Boolean),
    matchedDomains: parseJsonSafe(r.fields.MatchedDomains, []),
    matchCount: r.fields.MatchCount || 0,
    useful: r.fields.Useful || false,
    notUseful: r.fields.NotUseful || false,
    createdAt: r.fields.CreatedAt || "",
  }));
  cacheTimestamp = now;

  return knowledgeCache;
}

function parseJsonSafe(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Find knowledge entries relevant to the given keywords.
 * Returns top N entries sorted by keyword overlap, excluding entries marked NotUseful.
 */
export async function fetchRelevantKnowledge(keywords, maxResults = 5) {
  const all = await fetchAllKnowledge();
  if (!all.length || !keywords.length) return [];

  // Score each knowledge entry by keyword overlap with the new query
  const scored = all
    .filter(entry => !entry.notUseful) // skip bad answers
    .map(entry => {
      const entryKws = new Set(entry.keywords);
      const overlap = keywords.filter(kw => entryKws.has(kw)).length;
      // Boost entries that were marked useful
      const boost = entry.useful ? 1 : 0;
      return { entry, score: overlap + boost };
    })
    .filter(s => s.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map(s => s.entry);
}

/**
 * Save a new knowledge entry to Airtable (fire-and-forget).
 * Returns the created record ID, or null on error.
 */
export async function saveKnowledge({ question, answer, keywords, matchedDomains, matchCount }) {
  const token = getToken();
  if (!token) return null;

  const fields = {
    Question: question.slice(0, 500),
    Answer: answer.slice(0, 10000),
    Keywords: keywords.join(", "),
    MatchedDomains: JSON.stringify(matchedDomains.slice(0, 100)),
    MatchCount: matchCount,
    CreatedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(API_ROOT, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      console.warn("Cerebro KB save error:", res.status);
      return null;
    }
    const data = await res.json();
    // Invalidate cache so next fetch picks up the new entry
    knowledgeCache = null;
    return data.id;
  } catch (err) {
    console.warn("Cerebro KB save failed:", err.message);
    return null;
  }
}

/**
 * Update the Useful/NotUseful feedback on a knowledge entry.
 */
export async function updateFeedback(recordId, useful) {
  const token = getToken();
  if (!token || !recordId) return;

  const fields = useful
    ? { Useful: true, NotUseful: false }
    : { Useful: false, NotUseful: true };

  try {
    await fetch(`${API_ROOT}/${recordId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ fields }),
    });
    // Update cache entry if present
    if (knowledgeCache) {
      const entry = knowledgeCache.find(e => e.id === recordId);
      if (entry) {
        entry.useful = fields.Useful;
        entry.notUseful = fields.NotUseful;
      }
    }
  } catch (err) {
    console.warn("Cerebro KB feedback update failed:", err.message);
  }
}
