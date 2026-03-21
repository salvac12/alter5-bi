export default async function handler(req, res) {
  // CORS
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://alter5-bi.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Check env vars
  const secret = req.headers['x-proxy-secret'];
  const expected = process.env.CAMPAIGN_PROXY_SECRET;
  const hasToken = !!process.env.AIRTABLE_PAT;

  return res.status(200).json({
    ok: true,
    node: process.version,
    secretMatch: secret === expected,
    hasExpected: !!expected,
    hasToken,
    method: req.method,
    bodyKeys: Object.keys(req.body || {}),
  });
}
