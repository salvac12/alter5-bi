/**
 * Vercel serverless proxy for Campaign/FollowUp operations.
 * Forwards POST requests to Google Apps Script Web App with token injected server-side.
 *
 * Env vars (server-side only, NOT VITE_*):
 *   GAS_WEB_APP_URL    — deployed Web App URL
 *   GAS_API_TOKEN       — shared POST auth token
 *   CAMPAIGN_PROXY_SECRET — shared secret between browser ↔ proxy
 */
const ALLOWED_ACTIONS = new Set([
  // GET-style (proxied as POST with action)
  'getCampaigns',
  'getCampaign',
  'getFollowUps',
  'getCampaignRecipients',
  // Mutations
  'createCampaign',
  'startCampaign',
  'updateCampaignStatus',
  'addRecipients',
  'scheduleFollowUp',
  'cancelFollowUp',
]);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  const body = req.body || {};
  const { action, ...params } = body;

  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: `Action "${action}" not allowed` });
  }

  const gasUrl = process.env.GAS_WEB_APP_URL;
  const gasToken = process.env.GAS_API_TOKEN;
  if (!gasUrl) return res.status(500).json({ error: 'GAS_WEB_APP_URL not configured' });

  try {
    const gasBody = { action, token: gasToken, ...params };
    const gasRes = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(gasBody),
      redirect: 'follow',
    });

    const text = await gasRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return res.status(gasRes.ok ? 200 : gasRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'GAS request failed: ' + err.message });
  }
}
