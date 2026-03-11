/**
 * Bridge Campaign <-> Prospects sync logic.
 *
 * Detects stage advancement signals from two sources:
 * 1. Bridge pipeline cards (GAS endpoint ?action=pipeline)
 * 2. CRM meeting keywords in company email subjects
 *
 * Produces "sync suggestions" that the ProspectsView can display as
 * actionable banners (apply / dismiss).
 */

import { PROSPECT_STAGES } from './airtableProspects';

const API_URL = import.meta.env.VITE_BRIDGE_WEB_APP_URL || '';

// ── Types ────────────────────────────────────────────────────────────

export interface BridgeCard {
  email: string;
  etapa: string;
  nombre?: string;
  empresa?: string;
  [key: string]: unknown;
}

export interface SyncSuggestion {
  prospectId: string;
  prospectName: string;
  currentStage: string;
  suggestedStage: string;
  source: 'bridge' | 'crm-meeting';
  evidence: string[];
}

// ── Stage ordering helpers ───────────────────────────────────────────

const STAGE_INDEX: Record<string, number> = {};
PROSPECT_STAGES.forEach((s, i) => { STAGE_INDEX[s] = i; });

const BRIDGE_TO_PROSPECT: Record<string, string> = {
  reunion: 'Reunion',
  subida_docs: 'Documentacion Pendiente',
  doc_completada: 'Listo para Term-Sheet',
};

// nurturing and descartado don't map to advancement

function stageIsMoreAdvanced(suggested: string, current: string): boolean {
  const si = STAGE_INDEX[suggested];
  const ci = STAGE_INDEX[current];
  if (si == null || ci == null) return false;
  return si > ci;
}

// ── Meeting detection keywords ───────────────────────────────────────

const MEETING_KEYWORDS = [
  'reunion', 'reunión', 'llamada', 'meeting', 'call',
  'agenda', 'convocatoria', 'videollamada', 'teams', 'zoom',
];

const MEETING_RE = new RegExp(MEETING_KEYWORDS.join('|'), 'i');

// ── Fetch Bridge pipeline cards ──────────────────────────────────────

export async function fetchBridgePipelineCards(): Promise<BridgeCard[]> {
  if (!API_URL) return [];
  try {
    const res = await fetch(API_URL + '?action=pipeline');
    if (!res.ok) return [];
    const data = await res.json();
    if (data && Array.isArray(data.pipeline)) return data.pipeline;
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

// ── Detect meeting from CRM company data ─────────────────────────────

export function detectMeetingFromCRM(company: any): { hasMeeting: boolean; evidence: string[] } {
  const evidence: string[] = [];

  // Check datedSubjects
  const datedSubjects = company?.detail?.datedSubjects || [];
  for (const ds of datedSubjects) {
    const text = `${ds.subject || ''} ${ds.extract || ''}`;
    if (MEETING_RE.test(text)) {
      evidence.push(ds.subject || text.trim());
    }
  }

  // Check plain subjects
  const subjects = company?.detail?.subjects || [];
  for (const subj of subjects) {
    if (MEETING_RE.test(subj) && !evidence.includes(subj)) {
      evidence.push(subj);
    }
  }

  return { hasMeeting: evidence.length > 0, evidence: evidence.slice(0, 5) };
}

// ── Match prospect to bridge card by email domain ────────────────────

function extractDomain(email: string): string {
  const parts = (email || '').split('@');
  return (parts[1] || '').toLowerCase();
}

export function matchProspectToBridge(
  prospect: any,
  bridgeCards: BridgeCard[],
): BridgeCard | null {
  // Collect all domains from prospect contacts
  const domains = new Set<string>();
  const emails: string[] = [];
  if (prospect.contactEmail) emails.push(prospect.contactEmail);
  if (Array.isArray(prospect.contacts)) {
    for (const c of prospect.contacts) {
      if (c.email) emails.push(c.email);
    }
  }
  for (const e of emails) {
    const d = extractDomain(e);
    if (d) domains.add(d);
  }

  if (domains.size === 0) return null;

  // Find all matching cards, pick the most advanced stage (excluding descartado)
  const BRIDGE_ORDER = ['nurturing', 'reunion', 'subida_docs', 'doc_completada'];
  let best: BridgeCard | null = null;
  let bestIdx = -1;

  for (const card of bridgeCards) {
    const cardDomain = extractDomain(card.email);
    if (!cardDomain || !domains.has(cardDomain)) continue;
    if (card.etapa === 'descartado') continue;

    const idx = BRIDGE_ORDER.indexOf(card.etapa);
    if (idx > bestIdx) {
      best = card;
      bestIdx = idx;
    }
  }

  return best;
}

// ── Compute sync suggestions ─────────────────────────────────────────

export function computeSyncSuggestions(
  prospects: any[],
  bridgeCards: BridgeCard[],
  companies: any[],
  companyByName: Map<string, any>,
): SyncSuggestion[] {
  const suggestions: SyncSuggestion[] = [];

  // Helper: find CRM company for a prospect (same logic as ProspectsView)
  function findCompany(prospect: any): any {
    const name = (prospect.name || '').trim().toLowerCase();
    if (companyByName.has(name)) return companyByName.get(name);
    const emails: string[] = [];
    if (prospect.contactEmail) emails.push(prospect.contactEmail);
    if (Array.isArray(prospect.contacts)) {
      for (const c of prospect.contacts) { if (c.email) emails.push(c.email); }
    }
    for (const email of emails) {
      const domain = extractDomain(email);
      if (domain && companyByName.has(domain)) return companyByName.get(domain);
    }
    if (name.length >= 4) {
      for (const c of companies) {
        const cn = c.name.toLowerCase();
        if (cn.includes(name) || name.includes(cn)) return c;
      }
    }
    return null;
  }

  for (const prospect of prospects) {
    let suggestedStage: string | null = null;
    let source: 'bridge' | 'crm-meeting' = 'bridge';
    let evidence: string[] = [];

    // 1. Bridge card match
    const bridgeCard = matchProspectToBridge(prospect, bridgeCards);
    if (bridgeCard) {
      const mappedStage = BRIDGE_TO_PROSPECT[bridgeCard.etapa];
      if (mappedStage && stageIsMoreAdvanced(mappedStage, prospect.stage)) {
        suggestedStage = mappedStage;
        source = 'bridge';
        evidence = [`Bridge: etapa "${bridgeCard.etapa}" (${bridgeCard.email})`];
      }
    }

    // 2. CRM meeting detection
    const company = findCompany(prospect);
    if (company) {
      const { hasMeeting, evidence: meetingEvidence } = detectMeetingFromCRM(company);
      if (hasMeeting) {
        const meetingStage = 'Reunion';
        // Take the more advanced of bridge suggestion vs CRM meeting
        if (!suggestedStage || stageIsMoreAdvanced(meetingStage, suggestedStage)) {
          // Only upgrade if also more advanced than current
          if (stageIsMoreAdvanced(meetingStage, prospect.stage)) {
            suggestedStage = meetingStage;
            source = 'crm-meeting';
            evidence = meetingEvidence.map(e => `CRM: "${e}"`);
          }
        }
        // If bridge suggestion is already more advanced, keep it but add CRM evidence
        if (suggestedStage && suggestedStage !== meetingStage && source === 'bridge') {
          evidence = [...evidence, ...meetingEvidence.slice(0, 2).map(e => `CRM: "${e}"`)];
        }
      }
    }

    if (suggestedStage && stageIsMoreAdvanced(suggestedStage, prospect.stage)) {
      suggestions.push({
        prospectId: prospect.id,
        prospectName: prospect.name,
        currentStage: prospect.stage,
        suggestedStage,
        source,
        evidence,
      });
    }
  }

  return suggestions;
}
