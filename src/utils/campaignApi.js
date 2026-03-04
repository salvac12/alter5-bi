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

// ── Campaigns ──────────────────────────────────────────────────────

export async function getCampaigns(filters = {}) {
  return proxyFetch('getCampaigns', filters);
}

export async function getCampaign(id) {
  return proxyFetch('getCampaign', { id });
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
