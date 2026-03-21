// Test 2: Full airtable proxy logic (copy of at-proxy.js)
export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://alter5-bi.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.headers['x-proxy-secret'];
  const expected = process.env.CAMPAIGN_PROXY_SECRET;
  if (!expected || secret !== expected) {
    return res.status(403).json({ error: 'Invalid proxy secret' });
  }

  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: 'AIRTABLE_PAT not configured' });

  const { table, recordId, method, fields, formula, records, pageSize, offset, sort, fieldsList } = req.body || {};
  if (!table) return res.status(400).json({ error: 'Missing table name' });

  const BASE_ID = 'appVu3TvSZ1E4tj0J';
  let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
  if (recordId) url += `/${recordId}`;

  const airtableMethod = method || 'GET';

  if (airtableMethod === 'GET' && !recordId) {
    const params = new URLSearchParams();
    if (formula) params.set('filterByFormula', formula);
    if (pageSize) params.set('pageSize', String(pageSize));
    if (offset) params.set('offset', offset);
    if (sort) params.set('sort', sort);
    if (fieldsList && Array.isArray(fieldsList)) {
      for (const f of fieldsList) params.append('fields[]', f);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    const fetchOpts = { method: airtableMethod, headers };
    if (['POST', 'PATCH', 'PUT'].includes(airtableMethod)) {
      const body = records ? { records } : fields ? { fields } : {};
      fetchOpts.body = JSON.stringify(body);
    }
    const airtableRes = await fetch(url, fetchOpts);
    let data;
    try {
      data = await airtableRes.json();
    } catch {
      const text = await airtableRes.text().catch(() => '');
      return res.status(airtableRes.status).json({ error: `Non-JSON response: ${text.slice(0, 200)}` });
    }
    return res.status(airtableRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Airtable request failed: ' + err.message });
  }
}
