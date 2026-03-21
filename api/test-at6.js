// Test 1: CORS + method check + secret check (same as at-proxy first half)
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

  return res.status(200).json({ ok: true, table, step: 'parsed body' });
}
