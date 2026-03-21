/**
 * Vercel serverless proxy for Campaign/FollowUp operations.
 * Forwards requests to Google Apps Script Web App.
 */

const GET_ACTIONS = new Set([
  'dashboard', 'pipeline', 'getConversation', 'getConversacionCompleta',
  'getFollowUpCandidates', 'getConversaciones', 'getCampaigns', 'getCampaign',
]);

const POST_ACTIONS = new Set([
  'getCampaigns', 'getCampaign', 'getFollowUps', 'getCampaignRecipients',
  'createCampaign', 'startCampaign', 'updateCampaignStatus', 'addRecipients',
  'scheduleFollowUp', 'cancelFollowUp', 'getCampaignDashboard', 'updateCampaign',
  'sendDraft', 'saveDraft', 'composeAndSaveDraft', 'composeFromInstructions',
  'classifyReply', 'generateFollowUpBatch', 'sendFollowUpBatch',
  'moveStage', 'addNote', 'generateFollowUp', 'improveMessage',
  'uploadMeetingNotes', 'sendTestEmail', 'createDrafts', 'sendDrafts',
]);

const ALL_ACTIONS = new Set([...GET_ACTIONS, ...POST_ACTIONS]);

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

    if (GET_ACTIONS.has(action)) {
      const qs = new URLSearchParams({ action, ...params });
      gasRes = await fetch(`${gasUrl}?${qs}`, { method: 'GET', redirect: 'follow' });
    } else {
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
