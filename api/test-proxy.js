// Test 2: async + CORS + body access
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-proxy-secret'];
  const expected = process.env.CAMPAIGN_PROXY_SECRET;
  const hasToken = !!process.env.AIRTABLE_PAT;
  const bodyKeys = Object.keys(req.body || {});

  return res.status(200).json({ ok: true, node: process.version, secret: !!secret, hasToken, bodyKeys });
}
