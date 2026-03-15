/**
 * Vercel serverless proxy for Gemini API.
 * Keeps GEMINI_API_KEY server-side only.
 *
 * Env vars (server-side, NOT VITE_*):
 *   GEMINI_API_KEY          — Google Gemini API key
 *   CAMPAIGN_PROXY_SECRET   — shared secret between browser <-> proxy
 *   ALLOWED_ORIGIN          — CORS origin (default: https://alter5-bi.vercel.app)
 */

export default async function handler(req, res) {
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const { prompt, temperature = 0.3, model = 'gemini-2.5-flash', tools } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature },
    };
    // Support optional tools (e.g. google_search grounding)
    if (tools) requestBody.tools = tools;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await geminiRes.json();
    return res.status(geminiRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Gemini request failed: ' + err.message });
  }
}
