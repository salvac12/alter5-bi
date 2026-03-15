/**
 * Vercel serverless proxy for Airtable API.
 * Keeps AIRTABLE_PAT server-side only.
 *
 * Env vars (server-side, NOT VITE_*):
 *   AIRTABLE_PAT           — Airtable Personal Access Token
 *   CAMPAIGN_PROXY_SECRET   — shared secret between browser <-> proxy
 *   ALLOWED_ORIGIN          — CORS origin (default: https://alter5-bi.vercel.app)
 */

export default async function handler(req, res) {
  // CORS
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://alter5-bi.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Validate proxy secret
  const secret = req.headers['x-proxy-secret'];
  const expected = process.env.CAMPAIGN_PROXY_SECRET;
  if (!expected || secret !== expected) {
    return res.status(403).json({ error: 'Invalid proxy secret' });
  }

  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: 'AIRTABLE_PAT not configured' });

  // Extract request params from body
  const { table, recordId, method, fields, formula, records, pageSize, offset, sort, fieldsList } = req.body || {};

  if (!table) return res.status(400).json({ error: 'Missing table name' });

  const BASE_ID = 'appVu3TvSZ1E4tj0J';
  let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;

  // Build URL for specific operations
  if (recordId) url += `/${recordId}`;

  // Determine the HTTP method to use against Airtable
  // All browser requests come as POST to the proxy; the `method` field says what to do
  const airtableMethod = method || 'GET';

  // For GET requests, add query params
  if (airtableMethod === 'GET' && !recordId) {
    const params = new URLSearchParams();
    if (formula) params.set('filterByFormula', formula);
    if (pageSize) params.set('pageSize', String(pageSize));
    if (offset) params.set('offset', offset);
    if (sort) params.set('sort', sort);
    // Support fields[] array params
    if (fieldsList && Array.isArray(fieldsList)) {
      for (const f of fieldsList) {
        params.append('fields[]', f);
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    const fetchOptions = { method: airtableMethod, headers };

    if (['POST', 'PATCH', 'PUT'].includes(airtableMethod)) {
      const body = records ? { records } : fields ? { fields } : {};
      fetchOptions.body = JSON.stringify(body);
    }

    const airtableRes = await fetch(url, fetchOptions);
    const data = await airtableRes.json();
    return res.status(airtableRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Airtable request failed: ' + err.message });
  }
}
