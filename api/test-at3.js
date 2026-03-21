// Test 3: Minimal — just CORS + env check. No req.body, no req.headers custom
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  return res.status(200).json({ ok: true, method: req.method });
}
