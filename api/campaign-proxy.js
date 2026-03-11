/**
 * Vercel serverless proxy for Campaign/FollowUp operations.
 * Forwards requests to Google Apps Script Web App with token injected server-side.
 *
 * Some GAS actions live in doGet (dashboard, pipeline, getConversation, etc.)
 * while mutations live in doPost. The proxy auto-routes based on the action.
 *
 * Env vars (server-side only, NOT VITE_*):
 *   GAS_WEB_APP_URL    — deployed Web App URL
 *   GAS_API_TOKEN       — shared POST auth token
 *   CAMPAIGN_PROXY_SECRET — shared secret between browser ↔ proxy
 */

// Actions handled by GAS doGet (query string params, no token needed)
const GET_ACTIONS = new Set([
  'dashboard',
  'pipeline',
  'getConversation',
  'getFollowUpCandidates',
  'getConversaciones',
  // These are also in doGet in the deployed GAS
  'getCampaigns',
  'getCampaign',
]);

// Actions handled by GAS doPost (JSON body with token)
const POST_ACTIONS = new Set([
  'getCampaigns',
  'getCampaign',
  'getFollowUps',
  'getCampaignRecipients',
  'createCampaign',
  'startCampaign',
  'updateCampaignStatus',
  'addRecipients',
  'scheduleFollowUp',
  'cancelFollowUp',
  'getCampaignDashboard',
  'updateCampaign',
  'sendDraft',
  'saveDraft',
  'composeFromInstructions',
  'classifyReply',
  'generateFollowUpBatch',
  'sendFollowUpBatch',
  'moveStage',
  'addNote',
  'generateFollowUp',
  'improveMessage',
  'sendTestEmail',
  'createDrafts',
  'sendDrafts',
]);

const ALL_ACTIONS = new Set([...GET_ACTIONS, ...POST_ACTIONS]);

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

  if (!action || !ALL_ACTIONS.has(action)) {
    return res.status(400).json({ error: `Action "${action}" not allowed` });
  }

  const gasUrl = process.env.GAS_WEB_APP_URL;
  const gasToken = process.env.GAS_API_TOKEN;
  if (!gasUrl) return res.status(500).json({ error: 'GAS_WEB_APP_URL not configured' });

  try {
    let gasRes;

    // Try GET first for actions that exist in doGet
    if (GET_ACTIONS.has(action)) {
      const qs = new URLSearchParams({ action, ...params });
      gasRes = await fetch(`${gasUrl}?${qs}`, {
        method: 'GET',
        redirect: 'follow',
      });
    } else {
      // POST with token for mutations
      const gasBody = { action, token: gasToken, ...params };
      gasRes = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(gasBody),
        redirect: 'follow',
      });
    }

    const text = await gasRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    // If GET returned no useful data and action also exists in POST, try POST
    if (GET_ACTIONS.has(action) && POST_ACTIONS.has(action)) {
      const isEmpty = !data || (Array.isArray(data.campaigns) && data.campaigns.length === 0 && !data.success);
      if (isEmpty) {
        const gasBody = { action, token: gasToken, ...params };
        const postRes = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(gasBody),
          redirect: 'follow',
        });
        const postText = await postRes.text();
        try {
          const postData = JSON.parse(postText);
          if (postData.success || postData.campaigns?.length > 0) {
            return res.status(200).json(postData);
          }
        } catch { /* use GET result */ }
      }
    }

    return res.status(gasRes.ok ? 200 : gasRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'GAS request failed: ' + err.message });
  }
}
