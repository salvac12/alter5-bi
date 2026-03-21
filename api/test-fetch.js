export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const r = await fetch('https://httpbin.org/get');
    const data = await r.json();
    return res.status(200).json({ ok: true, fetched: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
