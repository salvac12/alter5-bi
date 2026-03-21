// Test 3: full airtable proxy replica
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: 'AIRTABLE_PAT not configured' });

  const { table, method } = req.body || {};
  if (!table) return res.status(400).json({ error: 'Missing table' });

  const BASE_ID = 'appVu3TvSZ1E4tj0J';
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?pageSize=1`;

  try {
    const airtableRes = await fetch(url, {
      method: method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await airtableRes.json();
    return res.status(airtableRes.status).json({ ok: true, status: airtableRes.status, recordCount: (data.records || []).length });
  } catch (err) {
    return res.status(502).json({ error: err.message, stack: err.stack });
  }
}
