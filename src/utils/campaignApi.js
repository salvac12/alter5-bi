/**
 * Campaign & Follow-up API layer.
 * All calls go through /api/campaign-proxy (Vercel serverless) → GAS Web App.
 */

const PROXY_URL = '/api/campaign-proxy';

function getSecret() {
  return import.meta.env.VITE_CAMPAIGN_PROXY_SECRET || '';
}

async function proxyFetch(action, params = {}) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-proxy-secret': getSecret(),
    },
    body: JSON.stringify({ action, ...params }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `Proxy error ${res.status}`);
  }
  return data;
}

// ── Airtable direct read (fallback when GAS is outdated) ──────────

const AT_BASE = 'appVu3TvSZ1E4tj0J';
const AT_CAMPAIGNS_TABLE = 'Campaigns';

function atToken() {
  return import.meta.env.VITE_AIRTABLE_PAT || '';
}

async function fetchCampaignsFromAirtable(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set('filterByFormula', `{Status} = '${filters.status}'`);
  }
  params.set('sort[0][field]', 'Name');
  params.set('sort[0][direction]', 'asc');

  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_CAMPAIGNS_TABLE)}?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${atToken()}` },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}`);
  const data = await res.json();

  const campaigns = (data.records || []).map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      createdTime: r.createdTime,
      name: f.Name || '',
      type: f.Type || 'mass',
      status: f.Status || 'draft',
      senderEmail: f.SenderEmail || '',
      senderName: f.SenderName || '',
      subjectA: f.SubjectA || '',
      subjectB: f.SubjectB || '',
      abTestPercent: f.AbTestPercent || 0,
      abWinnerCriteria: f.AbWinnerCriteria || 'aperturas',
      abWinner: f.AbWinner || null,
      totalSent: f.TotalSent || 0,
      totalOpened: f.TotalOpened || 0,
      totalClicked: f.TotalClicked || 0,
      totalReplied: f.TotalReplied || 0,
      notes: f.Notes || '',
      knowledgeBase: f.KnowledgeBase || '',
      createdBy: f.CreatedBy || '',
    };
  });

  return { success: true, campaigns, total: campaigns.length };
}

// ── Campaigns ──────────────────────────────────────────────────────

export async function getCampaigns(filters = {}) {
  // Try GAS proxy first, fallback to direct Airtable if GAS returns empty/invalid
  try {
    const data = await proxyFetch('getCampaigns', filters);
    if (data.success && data.campaigns?.length > 0) return data;
  } catch { /* GAS failed, try Airtable */ }

  return fetchCampaignsFromAirtable(filters);
}

export async function getCampaign(id) {
  // Try GAS proxy first, fallback to direct Airtable
  try {
    const data = await proxyFetch('getCampaign', { id });
    if (data.success && data.campaign) return data;
  } catch { /* GAS failed, try Airtable */ }

  // Direct Airtable read
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_CAMPAIGNS_TABLE)}/${id}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${atToken()}` },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}`);
  const r = await res.json();
  const f = r.fields || {};
  return {
    success: true,
    campaign: {
      id: r.id,
      createdTime: r.createdTime,
      name: f.Name || '',
      type: f.Type || 'mass',
      status: f.Status || 'draft',
      senderEmail: f.SenderEmail || '',
      senderName: f.SenderName || '',
      subjectA: f.SubjectA || '',
      bodyA: f.BodyA || '',
      subjectB: f.SubjectB || '',
      bodyB: f.BodyB || '',
      abTestPercent: f.AbTestPercent || 0,
      abWinnerCriteria: f.AbWinnerCriteria || 'aperturas',
      abWinner: f.AbWinner || null,
      totalSent: f.TotalSent || 0,
      totalOpened: f.TotalOpened || 0,
      totalClicked: f.TotalClicked || 0,
      totalReplied: f.TotalReplied || 0,
      notes: f.Notes || '',
      knowledgeBase: f.KnowledgeBase || '',
      createdBy: f.CreatedBy || '',
    },
  };
}

export async function createCampaign(data) {
  return proxyFetch('createCampaign', data);
}

export async function startCampaign(campaignId) {
  return proxyFetch('startCampaign', { campaignId });
}

export async function updateCampaignStatus(campaignId, status) {
  return proxyFetch('updateCampaignStatus', { campaignId, status });
}

export async function addRecipients(campaignId, recipients) {
  return proxyFetch('addRecipients', { campaignId, recipients });
}

export async function getCampaignRecipients(campaignId) {
  return proxyFetch('getCampaignRecipients', { campaignId });
}

export async function updateCampaign(campaignId, fields) {
  return proxyFetch('updateCampaign', { campaignId, fields });
}

// ── Campaign dashboard & detail ───────────────────────────────────

export async function getCampaignDashboard(campaignId) {
  return proxyFetch('getCampaignDashboard', { campaignId });
}

export async function getFollowUpCandidates(campaignId) {
  return proxyFetch('getFollowUpCandidates', { campaignId });
}

export async function getConversation(email, campaignId) {
  return proxyFetch('getConversation', { email, campaignId });
}

// ── Drafts & sending ──────────────────────────────────────────────

export async function sendDraft({ email, campaignId, threadId, draftId, editedBody }) {
  return proxyFetch('sendDraft', { email, campaignId, threadId, draftId, editedBody });
}

export async function saveDraft({ email, campaignId, body }) {
  return proxyFetch('saveDraft', { email, campaignId, body });
}

export async function composeFromInstructions({ email, campaignId, instructions }) {
  return proxyFetch('composeFromInstructions', { email, campaignId, instructions });
}

// ── Reply classification ──────────────────────────────────────────

export async function classifyReply({ email, campaignId, replyText }) {
  return proxyFetch('classifyReply', { email, campaignId, replyText });
}

// ── Follow-ups ─────────────────────────────────────────────────────

export async function getFollowUps(filters = {}) {
  return proxyFetch('getFollowUps', filters);
}

export async function scheduleFollowUp(data) {
  return proxyFetch('scheduleFollowUp', data);
}

export async function cancelFollowUp(followUpId) {
  return proxyFetch('cancelFollowUp', { followUpId });
}

export async function generateFollowUpBatch({ campaignId, contacts, instructions }) {
  return proxyFetch('generateFollowUpBatch', { campaignId, contacts, instructions });
}

export async function sendFollowUpBatch({ campaignId, contacts }) {
  return proxyFetch('sendFollowUpBatch', { campaignId, contacts });
}

// ── Tracking domains ──────────────────────────────────────────────

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'live.com', 'msn.com', 'aol.com', 'protonmail.com', 'zoho.com',
]);

/**
 * Fetch domains that have already been contacted (from GAS Tracking sheet).
 * Returns a Set<string> of lowercase domains.
 */
export async function fetchSentDomains() {
  const data = await proxyFetch('dashboard');
  const domains = new Set();
  const contactos = data?.contactos || [];
  for (const c of contactos) {
    const email = c.email || "";
    const d = email.split("@")[1]?.toLowerCase();
    if (d && !GENERIC_DOMAINS.has(d)) {
      domains.add(d);
    }
  }
  return domains;
}
