import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  fetchAllProspects,
  updateProspect,
  normalizeProspect,
  isValidProspect,
  convertToOpportunity,
  PROSPECT_STAGES,
  PROSPECT_STAGE_COLORS,
  PROSPECT_STAGE_SHORT,
  ORIGIN_OPTIONS,
} from '../utils/airtableProspects';
import { isAirtableConfigured } from '../utils/airtable';
import { isGeminiConfigured, generateProspectIntelligence } from '../utils/gemini';
import {
  fetchBridgePipelineCards,
  computeSyncSuggestions,
  type SyncSuggestion,
} from '../utils/bridgeProspectSync';

// Domains for internal tools — never match prospects to these companies
const INTERNAL_TOOL_DOMAINS = [
  'atlassian.com', 'atlassian.net', 'jira.com',
  'slack.com', 'slack-edge.com',
  'google.com', 'gmail.com', 'googlemail.com', 'google.es',
  'microsoft.com', 'outlook.com', 'office365.com', 'office.com', 'live.com', 'hotmail.com',
  'zoom.us', 'zoom.com',
  'notion.so', 'notion.com',
  'github.com', 'gitlab.com', 'bitbucket.org',
  'trello.com', 'asana.com', 'monday.com', 'clickup.com',
  'hubspot.com', 'salesforce.com', 'pipedrive.com',
  'mailchimp.com', 'sendgrid.net', 'sendgrid.com',
  'calendly.com', 'docusign.com', 'docusign.net',
  'dropbox.com', 'box.com',
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com',
  'airtable.com', 'typeform.com', 'intercom.io',
  'vercel.com', 'netlify.com', 'heroku.com', 'aws.amazon.com',
  'stripe.com', 'paypal.com',
  'canva.com', 'figma.com', 'miro.com',
  'alter-5.com',
];

/** Check if a domain belongs to an internal tool (should not be used for matching) */
function isInternalDomain(domain: string | undefined | null): boolean {
  if (!domain) return true;
  return INTERNAL_TOOL_DOMAINS.some(t => domain === t || domain.endsWith('.' + t));
}

// ── Figma Stage Colors ─────────────────────────────────────────────────
// These override the legacy PROSPECT_STAGE_COLORS for the new Figma design
const FIGMA_STAGE_COLORS: Record<string, string> = {
  'Lead': '#6366F1',
  'Interesado': '#3B82F6',
  'Reunion': '#8B5CF6',
  'Documentacion Pendiente': '#F59E0B',
  'Listo para Term-Sheet': '#10B981',
};

// ── Product color mapping ──────────────────────────────────────────────
function getProductColor(product: string): string {
  const p = (product || '').toLowerCase();
  if (p.includes('corporate')) return '#3B82F6';
  if (p.includes('project')) return '#8B5CF6';
  if (p.includes('development')) return '#06B6D4';
  if (p.includes('guaranteed') || p.includes('pf g')) return '#6366F1';
  if (p.includes('investment') || p.includes('inversion')) return '#10B981';
  if (p.includes('co-development') || p.includes('co-dev')) return '#F59E0B';
  if (p.includes('m&a') || p.includes('m&a')) return '#EF4444';
  return '#64748B';
}

/**
 * ProspectsView - Kanban board for Alter5 Prospects funnel
 *
 * 5 columns: Lead -> Interesado -> Reunion -> Doc. Pendiente -> Listo para Term-Sheet
 * Drag & drop to move prospects between stages.
 * Auto-conversion to Opportunity when dropped in "Listo para Term-Sheet".
 */
export default function ProspectsView({ onSelectProspect, onCreateProspect, companies = [] }: {
  onSelectProspect?: (prospect: any) => void;
  onCreateProspect?: (stage: string | null) => void;
  companies?: any[];
}) {
  const [prospects, setProspects] = useState<any[]>([]);
  const [filteredProspects, setFilteredProspects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [originFilter, setOriginFilter] = useState('All');
  const [draggedCard, setDraggedCard] = useState<any>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null); // prospect being converted
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ prospect: any; targetStage: string } | null>(null);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [syncSuggestions, setSyncSuggestions] = useState<SyncSuggestion[]>([]);
  const [syncDismissed, setSyncDismissed] = useState<Set<string>>(new Set());
  const [rawRecords, setRawRecords] = useState<any[] | null>(null);
  const prevCompaniesLen = useRef(0);

  // Fetch data on mount
  useEffect(() => {
    loadProspects();
  }, []);

  // Re-process when companies arrive (from [] to real data)
  useEffect(() => {
    if (rawRecords && companies.length > 0 && prevCompaniesLen.current === 0) {
      processProspects(rawRecords);
    }
    prevCompaniesLen.current = companies.length;
  }, [companies.length, rawRecords]);

  // Filter prospects
  useEffect(() => {
    let filtered = prospects;

    if (originFilter !== 'All') {
      filtered = filtered.filter(p => p.origin === originFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.origin.toLowerCase().includes(query) ||
        p.product.toLowerCase().includes(query)
      );
    }

    setFilteredProspects(filtered);
  }, [searchQuery, originFilter, prospects]);

  // --- Shared helpers for prospect processing ---
  const domainFromEmail = (email: string): string => {
    const at = email.indexOf('@');
    return at > 0 ? email.slice(at + 1).toLowerCase() : '';
  };

  const domainToName = (domain: string): string => {
    const base = domain.split('.')[0] || domain;
    return base
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c: string) => c.toUpperCase());
  };

  const isDomainLike = (s: string): boolean => /^[\w.-]+\.\w{2,}$/.test(s);

  const CORP_SUFFIXES = /[,.]?\s*\b(s\.?a\.?u?\.?|s\.?l\.?u?\.?|s\.?l\.?|gmbh|ltd\.?|inc\.?|llc|plc|corp\.?|group|holding|capital)\s*\.?\s*$/i;

  const stripCorpSuffix = (name: string): string => {
    let prev = name;
    for (let i = 0; i < 3; i++) {
      const cleaned = prev.replace(CORP_SUFFIXES, '').trim();
      if (cleaned === prev) break;
      prev = cleaned;
    }
    return prev;
  };

  const getAllDomains = (p: any): string[] => {
    const domains: string[] = [];
    if (p.contactEmail) {
      const d = domainFromEmail(p.contactEmail);
      if (d && !isInternalDomain(d)) domains.push(d);
    }
    if (p.contacts?.length) {
      for (const c of p.contacts) {
        const d = domainFromEmail(c.email || '');
        if (d && !isInternalDomain(d) && !domains.includes(d)) domains.push(d);
      }
    }
    return domains;
  };

  /** Process raw Airtable records with current companies data */
  function processProspects(active: any[]) {
    // Deep-clone so re-processing doesn't mutate previously stored records
    const records = active.map((p: any) => ({ ...p, contacts: p.contacts ? [...p.contacts] : [] }));

    // Build domain→CRM company lookup
    const crmByDomain = new Map<string, any>();
    for (const c of companies) {
      if (c.domain && !isInternalDomain(c.domain)) {
        crmByDomain.set(c.domain.toLowerCase(), c);
      }
    }

    const nameFromDomain = (domain: string): string => {
      const crm = crmByDomain.get(domain.toLowerCase());
      if (crm) return crm.name;
      return domainToName(domain);
    };

    // Step 1: Fix names that are emails or domains
    for (const p of records) {
      let name = (p.name || '').trim();
      if (name.includes('@')) {
        const domain = domainFromEmail(name);
        name = domain && !isInternalDomain(domain) ? nameFromDomain(domain) : name;
      } else if (isDomainLike(name)) {
        const domain = name.toLowerCase();
        name = !isInternalDomain(domain) ? nameFromDomain(domain) : domainToName(domain);
      } else if (name.length < 2 && p.contactEmail) {
        const domain = domainFromEmail(p.contactEmail);
        if (domain && !isInternalDomain(domain)) name = nameFromDomain(domain);
      }
      p.name = name;
    }

    // Step 2: Filter out non-prospect companies
    const NON_PROSPECT_ROLES = new Set(['Inversión', 'Inversion', 'Services', 'Ecosistema', 'No relevante', 'Otro']);

    const filtered = records.filter((p: any) => {
      const domains = getAllDomains(p);
      for (const d of domains) {
        const crm = crmByDomain.get(d);
        if (crm) {
          const role = crm.role || crm.group || '';
          if (NON_PROSPECT_ROLES.has(role)) return false;
        }
      }
      const pName = (p.name || '').trim().toLowerCase();
      if (pName.length >= 4) {
        for (const c of companies) {
          if (c.name.toLowerCase() === pName) {
            const role = c.role || c.group || '';
            if (NON_PROSPECT_ROLES.has(role)) return false;
            break;
          }
        }
      }
      return true;
    });

    // Step 3: Aggressive multi-key dedup
    const normalizeName = (name: string): string => {
      return stripCorpSuffix(name)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const stageOrder: Record<string, number> = {};
    PROSPECT_STAGES.forEach((s: string, i: number) => { stageOrder[s] = i; });

    const prospectScore = (p: any): number => {
      let score = stageOrder[p.stage] ?? 0;
      if (p.amount > 0) score += 10;
      if (p.product) score += 5;
      if (p.contactEmail) score += 3;
      if (p.contacts?.length) score += 3;
      if (p.context) score += 2;
      if (p.nextSteps) score += 2;
      return score;
    };

    const pickBetter = (a: any, b: any): any => {
      const sa = prospectScore(a);
      const sb = prospectScore(b);
      if (sa !== sb) return sa > sb ? a : b;
      return a.id > b.id ? a : b;
    };

    const byName = new Map<string, any>();
    const byDomain = new Map<string, any>();
    const spacelessKey = (nk: string): string => nk.replace(/\s/g, '');

    const registerDomains = (p: any) => {
      for (const d of getAllDomains(p)) {
        byDomain.set(d, p);
      }
    };

    for (const p of filtered) {
      const nk = normalizeName(p.name);
      if (!nk) continue;
      const sk = spacelessKey(nk);

      const pDomains = getAllDomains(p);
      let domainMatch: any = undefined;
      for (const d of pDomains) {
        domainMatch = byDomain.get(d);
        if (domainMatch) break;
      }
      if (!domainMatch) {
        for (const d of pDomains) {
          const crm = crmByDomain.get(d);
          if (crm?.domain) {
            domainMatch = byDomain.get(crm.domain);
            if (domainMatch) break;
          }
        }
      }
      const nameMatch = byName.get(nk) || byName.get(sk);
      const existing = domainMatch || nameMatch;

      if (existing) {
        const winner = pickBetter(existing, p);
        const loser = winner === existing ? p : existing;
        if (loser.contacts?.length && winner.contacts) {
          const existingEmails = new Set(winner.contacts.map((c: any) => c.email?.toLowerCase()));
          for (const c of loser.contacts) {
            if (c.email && !existingEmails.has(c.email.toLowerCase())) {
              winner.contacts.push(c);
            }
          }
        }
        const winnerNk = normalizeName(winner.name);
        const existingNk = normalizeName(existing.name);
        byName.set(nk, winner);
        byName.set(sk, winner);
        byName.set(winnerNk, winner);
        byName.set(spacelessKey(winnerNk), winner);
        byName.set(existingNk, winner);
        byName.set(spacelessKey(existingNk), winner);
        registerDomains(winner);
        registerDomains(loser);
      } else {
        byName.set(nk, p);
        byName.set(sk, p);
        registerDomains(p);
      }
    }

    const deduped = [...new Set(byName.values())];
    setProspects(deduped);

    // Build companyByName for sync suggestions
    const cbnMap = new Map<string, any>();
    for (const c of companies) {
      cbnMap.set(c.name.toLowerCase(), c);
      if (c.domain && !isInternalDomain(c.domain)) {
        cbnMap.set(c.domain, c);
      }
    }

    // Run Bridge + CRM sync detection in background
    fetchBridgePipelineCards().then(bridgeCards => {
      const suggestions = computeSyncSuggestions(deduped, bridgeCards, companies, cbnMap);
      setSyncSuggestions(suggestions);
    }).catch(() => { /* silent */ });
  }

  async function loadProspects() {
    if (!isAirtableConfigured()) {
      setError('Airtable proxy no configurado. Configura VITE_CAMPAIGN_PROXY_SECRET.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const records = await fetchAllProspects();
      const normalized = records.map(normalizeProspect).filter(isValidProspect);
      const active = normalized.filter((p: any) => !p.converted);
      setRawRecords(active);
      processProspects(active);
    } catch (err: any) {
      console.error('Failed to load prospects:', err);
      setError(err.message || 'Error al cargar prospects');
    } finally {
      setLoading(false);
    }
  }

  function showToast(type: string, message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  // Drag handlers
  function handleDragStart(e: React.DragEvent, prospect: any) {
    setDraggedCard(prospect);
    e.dataTransfer.effectAllowed = 'move';
    (e.currentTarget as HTMLElement).style.opacity = '0.5';
  }

  function handleDragEnd(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).style.opacity = '1';
    setDraggedCard(null);
    setDragOverColumn(null);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDragEnter(stage: string) {
    setDragOverColumn(stage);
  }

  async function handleDrop(e: React.DragEvent, targetStage: string) {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedCard || draggedCard.stage === targetStage) return;

    // If dropping into "Listo para Term-Sheet", show conversion dialog
    if (targetStage === "Listo para Term-Sheet") {
      setPendingDrop({ prospect: draggedCard, targetStage });
      setShowConvertDialog(true);
      return;
    }

    // Normal stage move
    try {
      const updated = prospects.map(p =>
        p.id === draggedCard.id ? { ...p, stage: targetStage } : p
      );
      setProspects(updated);

      await updateProspect(draggedCard.id, { "Stage": targetStage });

      // Fire-and-forget: regen AI intelligence for new stage
      if (isGeminiConfigured()) {
        const matchedCo = findCompanyForProspect(draggedCard);
        generateProspectIntelligence(
          draggedCard.name,
          matchedCo,
          draggedCard.context || "",
          { product: draggedCard.product, stage: targetStage, contacts: draggedCard.contacts, notes: draggedCard.context, amount: String(draggedCard.amount || ""), origin: draggedCard.origin, assignedTo: draggedCard.assignedTo },
        ).then(async (result) => {
          const aiFields: Record<string, any> = {
            "AI Summary": result.summary,
            "AI Generated At": new Date().toISOString(),
          };
          if (result.suggestedStage) aiFields["AI Suggested Stage"] = result.suggestedStage;
          await updateProspect(draggedCard.id, aiFields);
          setProspects(prev => prev.map(p =>
            p.id === draggedCard.id ? { ...p, aiSummary: result.summary, aiSuggestedStage: result.suggestedStage || "", aiGeneratedAt: new Date().toISOString() } : p
          ));
        }).catch(err => console.warn("AI regen after drop failed:", err));
      }
    } catch (err: any) {
      console.error('Failed to update prospect stage:', err);
      setProspects(prospects);
      showToast('error', 'Error al mover prospect: ' + err.message);
    }
  }

  // Handle conversion confirmation
  async function handleConvert() {
    if (!pendingDrop) return;
    const { prospect } = pendingDrop;

    setConverting(prospect.id);
    try {
      await convertToOpportunity(prospect);
      // Remove from prospects list (it's now an Opportunity)
      setProspects(prev => prev.filter(p => p.id !== prospect.id));
      showToast('success', `"${prospect.name}" convertido a Oportunidad (Termsheet)`);
    } catch (err: any) {
      console.error('Conversion failed:', err);
      showToast('error', 'Error al convertir: ' + err.message);
    } finally {
      setConverting(null);
      setShowConvertDialog(false);
      setPendingDrop(null);
    }
  }

  function handleCancelConvert() {
    setShowConvertDialog(false);
    setPendingDrop(null);
  }

  // Move to last stage WITHOUT converting
  async function handleMoveOnly() {
    if (!pendingDrop) return;
    const { prospect, targetStage } = pendingDrop;

    try {
      const updated = prospects.map(p =>
        p.id === prospect.id ? { ...p, stage: targetStage } : p
      );
      setProspects(updated);
      await updateProspect(prospect.id, { "Stage": targetStage });

      // Fire-and-forget: regen AI intelligence for new stage
      if (isGeminiConfigured()) {
        const matchedCo = findCompanyForProspect(prospect);
        generateProspectIntelligence(
          prospect.name,
          matchedCo,
          prospect.context || "",
          { product: prospect.product, stage: targetStage, contacts: prospect.contacts, notes: prospect.context, amount: String(prospect.amount || ""), origin: prospect.origin, assignedTo: prospect.assignedTo },
        ).then(async (result) => {
          const aiFields: Record<string, any> = {
            "AI Summary": result.summary,
            "AI Generated At": new Date().toISOString(),
          };
          if (result.suggestedStage) aiFields["AI Suggested Stage"] = result.suggestedStage;
          await updateProspect(prospect.id, aiFields);
          setProspects(prev => prev.map(p =>
            p.id === prospect.id ? { ...p, aiSummary: result.summary, aiSuggestedStage: result.suggestedStage || "", aiGeneratedAt: new Date().toISOString() } : p
          ));
        }).catch(err => console.warn("AI regen after move failed:", err));
      }
    } catch (err: any) {
      console.error('Failed to move prospect:', err);
      setProspects(prospects);
      showToast('error', 'Error al mover prospect');
    } finally {
      setShowConvertDialog(false);
      setPendingDrop(null);
    }
  }

  // ── Sync handlers ────────────────────────────────────────────────

  const pendingSuggestions = syncSuggestions.filter(s => !syncDismissed.has(s.prospectId));

  async function handleApplySync(suggestion: SyncSuggestion) {
    try {
      // Optimistic UI update
      setProspects(prev => prev.map(p =>
        p.id === suggestion.prospectId ? { ...p, stage: suggestion.suggestedStage } : p
      ));
      setSyncSuggestions(prev => prev.filter(s => s.prospectId !== suggestion.prospectId));
      await updateProspect(suggestion.prospectId, { "Stage": suggestion.suggestedStage });
      showToast('success', `"${suggestion.prospectName}" movido a ${suggestion.suggestedStage}`);
    } catch (err: any) {
      // Revert
      setProspects(prev => prev.map(p =>
        p.id === suggestion.prospectId ? { ...p, stage: suggestion.currentStage } : p
      ));
      showToast('error', 'Error al aplicar sugerencia: ' + err.message);
    }
  }

  async function handleApplyAllSync() {
    for (const s of pendingSuggestions) {
      await handleApplySync(s);
    }
  }

  function handleDismissSync(prospectId: string) {
    setSyncDismissed(prev => new Set(prev).add(prospectId));
  }

  // Check if a prospect has a pending sync suggestion
  const syncSuggestionMap = useMemo(() => {
    const map = new Map<string, SyncSuggestion>();
    for (const s of pendingSuggestions) {
      map.set(s.prospectId, s);
    }
    return map;
  }, [pendingSuggestions]);

  // Group by stage
  const prospectsByStage = PROSPECT_STAGES.reduce((acc: any, stage: string) => {
    acc[stage] = filteredProspects.filter(p => p.stage === stage);
    return acc;
  }, {});

  // Pre-compute totals for the funnel strip (uses all prospects, not filtered)
  const stageTotals = PROSPECT_STAGES.reduce((acc: any, stage: string) => {
    const ps = prospects.filter(p => p.stage === stage);
    acc[stage] = { count: ps.length, amount: ps.reduce((s: number, p: any) => s + (p.amount || 0), 0) };
    return acc;
  }, {});

  const totalCount = filteredProspects.length;
  const totalAmount = filteredProspects.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

  // Build company name lookup for matching prospects to CRM data
  // Exclude internal tool domains from the domain index
  const companyByName = useMemo(() => {
    const map = new Map();
    for (const c of companies) {
      map.set(c.name.toLowerCase(), c);
      if (c.domain && !isInternalDomain(c.domain)) {
        map.set(c.domain, c);
      }
    }
    return map;
  }, [companies]);

  function findCompanyForProspect(prospect: any) {
    const name = (prospect.name || '').trim().toLowerCase();
    // Direct name match
    if (companyByName.has(name)) return companyByName.get(name);
    // Domain from contacts (skip internal tool domains like atlassian, jira, slack, etc.)
    const emails = prospect.contacts?.map((c: any) => c.email) || [];
    if (prospect.contactEmail) emails.push(prospect.contactEmail);
    for (const email of emails) {
      const domain = (email || '').split('@')[1];
      if (domain && !isInternalDomain(domain) && companyByName.has(domain)) return companyByName.get(domain);
    }
    // Partial name match
    if (name.length >= 4) {
      for (const c of companies) {
        const cn = c.name.toLowerCase();
        if (cn.includes(name) || name.includes(cn)) return c;
      }
    }
    return null;
  }

  return (
    <div style={styles.container}>
      {/* Page Header */}
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div style={styles.headerLeft}>
            <h2 style={styles.title}>Prospects</h2>
            <span style={styles.countBadge}>{totalCount} activos</span>
          </div>
          <div style={styles.headerRight}>
            {/* Search */}
            <div style={styles.searchContainer}>
              <svg style={styles.searchIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder="Buscar prospects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={styles.clearButton}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Filters toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              style={{
                ...styles.filterToggleBtn,
                ...(showFilters ? { borderColor: '#6366F1', color: '#6366F1' } : {}),
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              Filtros
            </button>

            {/* Create button */}
            <button
              onClick={() => onCreateProspect && onCreateProspect(null)}
              style={styles.createButton}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = '#0F1D4A';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = '#13285B';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Nuevo Prospect
            </button>
          </div>
        </div>

        {/* Subtitle with pipeline total */}
        {totalAmount > 0 && (
          <div style={styles.subtitle}>
            Pipeline total: <span style={{ fontWeight: 700, color: '#0F172A' }}>{formatAmount(totalAmount, 'EUR')}</span>
          </div>
        )}

        {/* Origin filter pills (shown when filters active) */}
        {showFilters && (
          <div style={styles.filterRow}>
            {['All', ...ORIGIN_OPTIONS].map(filter => (
              <button
                key={filter}
                onClick={() => setOriginFilter(filter)}
                style={{
                  ...styles.filterPill,
                  ...(originFilter === filter ? styles.filterPillActive : {}),
                }}
              >
                {filter === 'All' ? 'Todos' : filter}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div style={styles.errorContainer}>
          <div style={styles.errorIcon}>{'\u26A0'}</div>
          <div>
            <div style={styles.errorTitle}>Error al cargar prospects</div>
            <div style={styles.errorMessage}>{error}</div>
          </div>
          <button onClick={loadProspects} style={styles.retryButton}>
            Reintentar
          </button>
        </div>
      )}

      {/* Sync suggestions banner */}
      {pendingSuggestions.length > 0 && (
        <div style={{
          margin: '0 36px', padding: '12px 16px',
          background: 'linear-gradient(135deg, #EEF2FF, #F5F3FF)',
          border: '1px solid #C7D2FE',
          borderRadius: 12,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: pendingSuggestions.length > 1 ? 10 : 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#4338CA' }}>
                {pendingSuggestions.length} {pendingSuggestions.length === 1 ? 'sugerencia' : 'sugerencias'} de avance
              </span>
            </div>
            {pendingSuggestions.length > 1 && (
              <button
                onClick={handleApplyAllSync}
                style={{
                  fontSize: 12, fontWeight: 600, color: '#FFFFFF',
                  background: '#6366F1', border: 'none', borderRadius: 6,
                  padding: '5px 12px', cursor: 'pointer',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Aplicar todos
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendingSuggestions.map(s => (
              <div key={s.prospectId} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', background: '#FFFFFF',
                borderRadius: 8, border: '1px solid #E0E7FF',
              }}>
                {/* Source icon */}
                <div style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: s.source === 'bridge' ? '#DBEAFE' : '#EDE9FE',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {s.source === 'bridge' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2.5">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>
                    {s.prospectName}
                  </span>
                  <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8 }}>
                    {s.currentStage} → <span style={{ fontWeight: 600, color: '#4338CA' }}>{s.suggestedStage}</span>
                  </span>
                  {s.evidence.length > 0 && (
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.evidence[0]}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <button
                  onClick={() => handleApplySync(s)}
                  style={{
                    fontSize: 12, fontWeight: 600, color: '#FFFFFF',
                    background: '#6366F1', border: 'none', borderRadius: 6,
                    padding: '5px 10px', cursor: 'pointer', flexShrink: 0,
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Aplicar
                </button>
                <button
                  onClick={() => handleDismissSync(s.prospectId)}
                  style={{
                    fontSize: 12, fontWeight: 500, color: '#94A3B8',
                    background: 'transparent', border: '1px solid #E2E8F0', borderRadius: 6,
                    padding: '5px 10px', cursor: 'pointer', flexShrink: 0,
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Ignorar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Board */}
      <div style={styles.boardContainer}>
        <div style={styles.board}>
          {PROSPECT_STAGES.map((stage: string) => (
            <ProspectColumn
              key={stage}
              stage={stage}
              prospects={prospectsByStage[stage] || []}
              loading={loading}
              isDragOver={dragOverColumn === stage}
              onDragOver={handleDragOver}
              onDragEnter={() => handleDragEnter(stage)}
              onDragLeave={() => {}}
              onDrop={(e: React.DragEvent) => handleDrop(e, stage)}
              onCardDragStart={handleDragStart}
              onCardDragEnd={handleDragEnd}
              onCardClick={onSelectProspect}
              onAddClick={() => onCreateProspect && onCreateProspect(stage)}
              findCompany={findCompanyForProspect}
              syncSuggestionMap={syncSuggestionMap}
            />
          ))}
        </div>
      </div>

      {/* Conversion dialog */}
      {showConvertDialog && pendingDrop && (
        <>
          <div
            onClick={handleCancelConvert}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(15, 23, 42, 0.6)',
              backdropFilter: 'blur(8px)',
              zIndex: 150,
            }}
          />
          <div role="dialog" aria-labelledby="convert-title" aria-describedby="convert-desc" style={styles.convertDialog}>
            <div id="convert-title" style={styles.convertDialogHeader}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'rgba(16, 185, 129, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
                  <polyline points="17 1 21 5 17 9"/>
                  <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <polyline points="7 23 3 19 7 15"/>
                  <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
              </div>
              <span>Convertir a Oportunidad</span>
            </div>
            <div id="convert-desc" style={styles.convertDialogBody}>
              <strong>{pendingDrop.prospect.name}</strong> esta listo para pasar al Pipeline como oportunidad activa.
            </div>
            <div style={styles.convertDialogBody2}>
              <strong style={{ display: 'block', marginBottom: 6, color: '#0F172A' }}>Que sucedera:</strong>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                <li>Se creara una oportunidad en Pipeline (etapa: Origination - Termsheet)</li>
                <li>El importe y datos se copiaran automaticamente</li>
                <li>Este prospect se marcara como convertido y desaparecera de esta vista</li>
              </ul>
            </div>
            <div style={styles.convertDialogActions}>
              <button
                onClick={handleCancelConvert}
                disabled={!!converting}
                style={styles.convertCancelBtn}
              >
                Cancelar
              </button>
              <button
                onClick={handleConvert}
                disabled={!!converting}
                style={styles.convertConfirmBtn}
              >
                {converting ? 'Convirtiendo...' : 'Convertir a Oportunidad'}
              </button>
            </div>
            <div style={{ marginTop: 8, textAlign: 'right' as const }}>
              <button
                onClick={handleMoveOnly}
                disabled={!!converting}
                style={styles.convertMoveOnlyBtnSubtle}
              >
                Solo mover sin convertir
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.type === 'success' ? '#10B981' : '#EF4444',
          color: '#FFFFFF', padding: '14px 20px', borderRadius: 12,
          fontSize: 14, fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif",
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 200,
          display: 'flex', alignItems: 'center', gap: 10, maxWidth: 400,
          animation: 'slideInUp 0.3s ease-out',
        }}>
          <span style={{ fontSize: 18 }}>
            {toast.type === 'success' ? '\u2713' : '\u2717'}
          </span>
          {toast.message}
        </div>
      )}

      <style>{`
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes dialogFadeIn {
          from { opacity: 0; transform: translate(-50%, -48%); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes syncPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.5); }
          50% { box-shadow: 0 0 0 6px rgba(99,102,241,0); }
        }
        button:focus-visible {
          outline: 2px solid #6366F1;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

// ── Column Component ────────────────────────────────────────────────

function ProspectColumn({
  stage, prospects, loading, isDragOver,
  onDragOver, onDragEnter, onDragLeave, onDrop,
  onCardDragStart, onCardDragEnd, onCardClick, onAddClick,
  findCompany, syncSuggestionMap,
}: {
  stage: string;
  prospects: any[];
  loading: boolean;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onCardDragStart: (e: React.DragEvent, prospect: any) => void;
  onCardDragEnd: (e: React.DragEvent) => void;
  onCardClick?: (prospect: any) => void;
  onAddClick: () => void;
  findCompany: (prospect: any) => any;
  syncSuggestionMap: Map<string, SyncSuggestion>;
}) {
  const colColor = (FIGMA_STAGE_COLORS as Record<string, string>)[stage] || '#6366F1';
  const shortLabel = (PROSPECT_STAGE_SHORT as Record<string, string>)[stage] || stage;
  const isLastStage = stage === "Listo para Term-Sheet";

  const totalAmount = prospects.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

  const columnStyle: React.CSSProperties = {
    ...styles.column,
    background: isDragOver ? `${colColor}08` : 'transparent',
    transition: 'background 0.2s ease',
  };

  return (
    <div
      style={columnStyle}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Column Header — dark pill */}
      <div style={styles.columnHeader}>
        <div style={styles.columnHeaderLeft}>
          {/* Colored dot with glow */}
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: colColor,
            boxShadow: `0 0 6px ${colColor}80`,
            flexShrink: 0,
          }} />
          <span style={styles.columnStageName}>
            {shortLabel}
          </span>
          {isLastStage && (
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1px 4px',
              borderRadius: 3, background: '#22C55E25', color: '#22C55E',
              letterSpacing: '0.05em', textTransform: 'uppercase' as const,
            }}>CONV</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Count badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 20, height: 20, padding: '0 6px',
            borderRadius: 6,
            background: `${colColor}30`,
            color: colColor,
            fontSize: 11, fontWeight: 700,
          }}>
            {prospects.length}
          </span>
          {/* Add button */}
          <button
            onClick={onAddClick}
            style={styles.columnAddButton}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#334155';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Pipeline amount bar + amount text */}
      <div style={{ padding: '0 4px' }}>
        <div style={{
          height: 2,
          background: colColor,
          borderRadius: 1,
          opacity: totalAmount > 0 ? 1 : 0.2,
        }} />
        {totalAmount > 0 && (
          <div style={{
            padding: '4px 10px 0', fontSize: 11, fontWeight: 600,
            color: colColor,
          }}>
            {formatAmount(totalAmount, 'EUR')}
          </div>
        )}
      </div>

      {/* Cards */}
      <div style={styles.cardsContainer}>
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : prospects.length === 0 ? (
          <div style={{
            ...styles.emptyState,
            border: `2px dashed ${colColor}40`,
            borderRadius: 14,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={`${colColor}60`} strokeWidth="1.5" style={{ marginBottom: 6 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <path d="M12 8v8M8 12h8"/>
            </svg>
            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500 }}>Arrastra aqui</div>
          </div>
        ) : (
          prospects.map((prospect: any) => (
            <KanbanCard
              key={prospect.id}
              prospect={prospect}
              colColor={colColor}
              onDragStart={onCardDragStart}
              onDragEnd={onCardDragEnd}
              onClick={() => onCardClick && onCardClick(prospect)}
              matchedCompany={findCompany ? findCompany(prospect) : null}
              syncSuggestion={syncSuggestionMap.get(prospect.id) || null}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── TaskPill Component ───────────────────────────────────────────────

function TaskPill({ tasks }: { tasks: any[] }) {
  if (!tasks || tasks.length === 0) return null;

  // Determine overall task status
  const allDone = tasks.every((t: any) => t.status === 'hecho');
  const hasPending = tasks.some((t: any) => t.status === 'pendiente' || t.status === 'espera');
  const hasReunion = tasks.some((t: any) =>
    (t.title || t.name || '').toLowerCase().includes('reunion') ||
    (t.title || t.name || '').toLowerCase().includes('convocar')
  );

  let bg: string, color: string, label: string;
  let icon: React.ReactNode;

  if (allDone) {
    bg = 'rgba(16,185,129,0.1)';
    color = '#047857';
    label = 'Listo';
    icon = (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    );
  } else if (hasReunion) {
    bg = 'rgba(139,92,246,0.1)';
    color = '#7C3AED';
    label = 'Reunion';
    icon = (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    );
  } else if (hasPending) {
    bg = 'rgba(245,158,11,0.1)';
    color = '#B45309';
    label = 'Espera';
    icon = (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    );
  } else {
    bg = 'rgba(100,116,139,0.1)';
    color = '#64748B';
    label = `${tasks.filter((t: any) => t.status === 'hecho').length}/${tasks.length}`;
    icon = (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    );
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 500, color,
      padding: '4px 8px', borderRadius: 6,
      background: bg,
    }}>
      {icon}
      {label}
    </span>
  );
}

// ── KanbanCard Component (Figma design) ──────────────────────────────

function KanbanCard({ prospect, colColor, onDragStart, onDragEnd, onClick, matchedCompany, syncSuggestion }: {
  prospect: any;
  colColor: string;
  onDragStart: (e: React.DragEvent, prospect: any) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onClick: () => void;
  matchedCompany: any;
  syncSuggestion: SyncSuggestion | null;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const formattedAmount = formatAmount(prospect.amount, prospect.currency);

  // Company initials (2 letters)
  const companyInitials = getInitials(prospect.name || 'SP');

  // Owner info
  const ownerName = prospect.dealManager || prospect.assignedTo || '';
  const ownerInitials = getInitials(ownerName);
  const ownerFirstName = ownerName.split(' ')[0] || '';

  // Product color
  const productColor = getProductColor(prospect.product);

  // Pending task count for notification badge
  const pendingTaskCount = (prospect.tasks || []).filter((t: any) => t.status !== 'hecho').length;

  // Last contact date (from matched company if available)
  const lastContactInfo = matchedCompany ? `${matchedCompany.interactions} emails` : null;

  // Employee initials for CRM activity
  const employeeColors: Record<string, string> = {
    salvador_carrillo: '#3B82F6',
    'leticia_men\u00e9ndez': '#8B5CF6',
    javier_ruiz: '#F59E0B',
    miguel_solana: '#10B981',
    'carlos_almod\u00f3var': '#EF4444',
    gonzalo_de_gracia: '#06B6D4',
    rafael_nevado: '#F97316',
    guillermo_souto: '#6B7280',
  };
  const employeeInitials: Record<string, string> = {
    salvador_carrillo: 'SC',
    'leticia_men\u00e9ndez': 'LM',
    javier_ruiz: 'JR',
    miguel_solana: 'MS',
    'carlos_almod\u00f3var': 'CA',
    gonzalo_de_gracia: 'GG',
    rafael_nevado: 'RN',
    guillermo_souto: 'GS',
  };

  return (
    <motion.div
      draggable
      tabIndex={0}
      role="button"
      aria-label={`Prospect: ${prospect.name}${formattedAmount ? ', ' + formattedAmount : ''}`}
      onDragStart={(e) => onDragStart(e as any, prospect)}
      onDragEnd={(e) => onDragEnd(e as any)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{
        position: 'relative',
        background: '#FFFFFF',
        borderRadius: 14,
        padding: 0,
        cursor: 'grab',
        userSelect: 'none',
        boxShadow: isHovered
          ? '0 12px 32px rgba(0,0,0,0.10)'
          : '0 2px 8px rgba(0,0,0,0.05)',
        transition: 'box-shadow 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Top accent gradient line */}
      <div style={{
        height: 3,
        background: `linear-gradient(90deg, ${colColor}cc, ${colColor}44)`,
      }} />

      {/* Task notification badge */}
      {pendingTaskCount > 0 && (
        <div style={{
          position: 'absolute', top: 8, right: 10,
          width: 16, height: 16, borderRadius: '50%',
          background: '#EF4444',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: '#FFFFFF',
          zIndex: 2,
        }}>
          {pendingTaskCount}
        </div>
      )}

      {/* Sync suggestion indicator */}
      {syncSuggestion && (
        <div style={{
          position: 'absolute', top: pendingTaskCount > 0 ? 28 : 8, right: 10,
          width: 18, height: 18, borderRadius: '50%',
          background: '#6366F1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2,
          animation: 'syncPulse 2s ease-in-out infinite',
        }} title={`Sugerencia: mover a ${syncSuggestion.suggestedStage}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3">
            <polyline points="7 17 17 7"/>
            <polyline points="7 7 17 7 17 17"/>
          </svg>
        </div>
      )}

      <div style={{ padding: 16 }}>
        {/* Row 1: Avatar + Company name + sector */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          marginBottom: 10,
        }}>
          {/* Company avatar */}
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: `${colColor}18`,
            border: `1.5px solid ${colColor}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: colColor,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {companyInitials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: '#0F172A',
              lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {prospect.name || 'Sin nombre'}
              {prospect.aiSummary && (
                <span style={{ color: '#8B5CF6', fontSize: 11, marginLeft: 4 }} title="Inteligencia IA disponible">✦</span>
              )}
            </div>
            {prospect.origin && (
              <div style={{
                fontSize: 11, color: '#94A3B8', marginTop: 2,
                fontFamily: "'DM Sans', sans-serif",
              }}>
                {prospect.origin}
              </div>
            )}
          </div>
          {/* "..." menu on hover */}
          {isHovered && (
            <div style={{
              width: 20, height: 20, borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#94A3B8', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', flexShrink: 0,
            }}>
              ...
            </div>
          )}
        </div>

        {/* Row 2: Product badge */}
        {prospect.product && prospect.product !== '(pendiente)' && (
          <div style={{ marginBottom: 10 }}>
            <span style={{
              display: 'inline-block',
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const,
              color: productColor,
              background: `${productColor}12`,
              borderRadius: 5,
              padding: '3px 8px',
              letterSpacing: '0.02em',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {prospect.product}
            </span>
          </div>
        )}

        {/* Row 3: Amount + probability */}
        {(formattedAmount || (prospect.probability != null && prospect.probability > 0)) && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              {formattedAmount && (
                <span style={{
                  fontSize: 22, fontWeight: 600, color: '#0F172A',
                  letterSpacing: '-0.03em',
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                  {formattedAmount}
                </span>
              )}
              {prospect.probability != null && prospect.probability > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontSize: 12, fontWeight: 600, color: colColor,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colColor} strokeWidth="2">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                    <polyline points="17 6 23 6 23 12"/>
                  </svg>
                  {prospect.probability}%
                </span>
              )}
            </div>
            {/* Probability bar */}
            {prospect.probability != null && prospect.probability > 0 && (
              <div style={{
                width: '100%', height: 3, borderRadius: 9999,
                background: '#F1F5F9', overflow: 'hidden', marginTop: 6,
              }}>
                <div style={{
                  width: `${Math.min(prospect.probability, 100)}%`,
                  height: '100%', borderRadius: 9999,
                  background: `linear-gradient(90deg, ${colColor}aa, ${colColor})`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: '#F1F5F9', margin: '0 -16px', marginBottom: 10 }} />

        {/* Row 4: Owner + TaskPill or last contact */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {ownerName ? (
              <>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: '#E2E8F0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, color: '#64748B',
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                  {ownerInitials}
                </div>
                <span style={{
                  fontSize: 11, color: '#64748B', fontWeight: 500,
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                  {ownerFirstName}
                </span>
              </>
            ) : (
              <span style={{
                fontSize: 11, color: '#CBD5E1', fontWeight: 500, fontStyle: 'italic',
                fontFamily: "'DM Sans', sans-serif",
              }}>
                Sin asignar
              </span>
            )}
          </div>

          {/* Right: TaskPill or CRM info */}
          {prospect.tasks && prospect.tasks.length > 0 ? (
            <TaskPill tasks={prospect.tasks} />
          ) : lastContactInfo ? (
            <span style={{
              fontSize: 11, color: '#94A3B8', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 4,
              fontFamily: "'DM Sans', sans-serif",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              {lastContactInfo}
            </span>
          ) : null}
        </div>

        {/* CRM Activity indicator (below the owner row) */}
        {matchedCompany && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginTop: 8, padding: '5px 8px',
            background: '#F8FAFC', borderRadius: 6,
            border: '1px solid #F1F5F9',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2.5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#3B82F6', fontFamily: "'DM Sans', sans-serif" }}>
              {matchedCompany.interactions} emails
            </span>
            <span style={{
              fontSize: 9, fontWeight: 600, padding: '1px 5px',
              borderRadius: 4,
              background: matchedCompany.status === 'active' ? '#D1FAE5' : matchedCompany.status === 'dormant' ? '#FEF3C7' : '#FEE2E2',
              color: matchedCompany.status === 'active' ? '#059669' : matchedCompany.status === 'dormant' ? '#D97706' : '#DC2626',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {matchedCompany.status === 'active' ? 'Activa' : matchedCompany.status === 'dormant' ? 'Dormida' : 'Inactiva'}
            </span>
            {/* Employee dots */}
            <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
              {matchedCompany.employees.slice(0, 4).map((empId: string) => (
                <div key={empId} title={empId.replace(/_/g, ' ')} style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: employeeColors[empId] || '#6B7F94',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 6, fontWeight: 800, color: '#FFFFFF',
                  letterSpacing: '-0.5px',
                }}>
                  {employeeInitials[empId] || '?'}
                </div>
              ))}
              {matchedCompany.employees.length > 4 && (
                <div style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: '#94A3B8',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 7, fontWeight: 700, color: '#FFFFFF',
                }}>
                  +{matchedCompany.employees.length - 4}
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI suggested stage mini badge */}
        {prospect.aiSuggestedStage && prospect.aiSuggestedStage !== prospect.stage && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            marginTop: 6, padding: '3px 8px',
            background: '#F5F3FF', borderRadius: 5,
            border: '1px solid #DDD6FE',
          }}>
            <span style={{ fontSize: 9, color: '#8B5CF6', fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
              ✦ →
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700, color: '#6B21A8',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {(PROSPECT_STAGE_SHORT as any)[prospect.aiSuggestedStage] || prospect.aiSuggestedStage}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    }}>
      <div style={{ height: 3, background: '#E2E8F0' }} />
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s ease infinite',
          }} />
          <div style={{ flex: 1 }}>
            <div style={{
              height: 14, width: '80%', borderRadius: 4, marginBottom: 6,
              background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s ease infinite',
            }} />
            <div style={{
              height: 10, width: '50%', borderRadius: 4,
              background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s ease infinite',
            }} />
          </div>
        </div>
        <div style={{
          height: 20, width: '40%', borderRadius: 4,
          background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s ease infinite',
        }} />
      </div>
    </div>
  );
}

// ── Helper functions ─────────────────────────────────────────────────

function formatAmount(amount: number | null | undefined, currency = "EUR"): string | null {
  if (!amount || amount === 0) return null;
  if (amount >= 1_000_000) return `\u20AC${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `\u20AC${(amount / 1_000).toFixed(0)}K`;
  return `\u20AC${amount}`;
}

function getInitials(name: string): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

// ── Styles ──────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#F0F4F8',
    overflow: 'hidden',
    fontFamily: "'DM Sans', sans-serif",
  },

  // Header
  header: {
    padding: '24px 36px 16px',
    background: '#FFFFFF',
    borderBottom: '1px solid #E2E8F0',
  },
  headerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 600,
    color: '#0F172A',
    margin: 0,
    fontFamily: "'DM Sans', sans-serif",
  },
  countBadge: {
    fontSize: 12,
    fontWeight: 600,
    color: '#6366F1',
    background: 'rgba(99, 102, 241, 0.1)',
    padding: '3px 10px',
    borderRadius: 99,
    fontFamily: "'DM Sans', sans-serif",
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 6,
    fontWeight: 500,
    fontFamily: "'DM Sans', sans-serif",
  },
  headerRight: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },

  // Search
  searchContainer: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    color: '#94A3B8',
    pointerEvents: 'none',
  },
  searchInput: {
    padding: '8px 36px 8px 36px',
    borderRadius: 10,
    border: '1px solid #E2E8F0',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    width: 220,
    outline: 'none',
    transition: 'all 0.2s ease',
    background: '#FFFFFF',
    color: '#0F172A',
  },
  clearButton: {
    position: 'absolute',
    right: 8,
    background: 'none',
    border: 'none',
    color: '#94A3B8',
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Filters toggle button
  filterToggleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    background: '#FFFFFF',
    color: '#64748B',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: "'DM Sans', sans-serif",
  },

  // Filter pills row
  filterRow: {
    display: 'flex',
    gap: 6,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  filterPill: {
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 500,
    color: '#64748B',
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: 99,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: "'DM Sans', sans-serif",
  },
  filterPillActive: {
    background: '#6366F1',
    color: '#FFFFFF',
    borderColor: '#6366F1',
  },

  // Create button
  createButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: '#13285B',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: "'DM Sans', sans-serif",
    boxShadow: '0 2px 8px rgba(19, 40, 91, 0.25)',
  },

  // Error
  errorContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    margin: '20px 36px',
    padding: '16px 20px',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: 12,
  },
  errorIcon: {
    fontSize: 24,
    color: '#EF4444',
    fontWeight: 700,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#DC2626',
    marginBottom: 4,
    fontFamily: "'DM Sans', sans-serif",
  },
  errorMessage: {
    fontSize: 12,
    color: '#EF4444',
    fontFamily: "'DM Sans', sans-serif",
  },
  retryButton: {
    marginLeft: 'auto',
    padding: '6px 14px',
    background: '#FFFFFF',
    border: '1px solid #FECACA',
    borderRadius: 8,
    color: '#DC2626',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },

  // Board
  boardContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '20px 36px 36px',
  },
  board: {
    display: 'flex',
    gap: 16,
    minHeight: '100%',
  },

  // Column
  column: {
    minWidth: 290,
    maxWidth: 290,
    flex: '0 0 290px',
    display: 'flex',
    flexDirection: 'column',
  },
  columnHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: '#1E293B',
    borderRadius: 10,
    marginBottom: 4,
  },
  columnHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  columnStageName: {
    fontSize: 11,
    fontWeight: 700,
    color: '#FFFFFF',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    fontFamily: "'DM Sans', sans-serif",
  },
  columnAddButton: {
    width: 22,
    height: 22,
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: '#94A3B8',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  },

  // Cards
  cardsContainer: {
    flex: 1,
    padding: '8px 0',
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },

  // Empty
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 20px',
    textAlign: 'center',
  },

  // Convert dialog
  convertDialog: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    maxWidth: 480,
    width: '90%',
    border: '1px solid #E2E8F0',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
    zIndex: 151,
    animation: 'dialogFadeIn 0.2s ease-out',
    fontFamily: "'DM Sans', sans-serif",
  },
  convertDialogHeader: {
    fontSize: 20,
    fontWeight: 700,
    color: '#0F172A',
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontFamily: "'DM Sans', sans-serif",
  },
  convertDialogBody: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 1.6,
    marginBottom: 8,
    fontFamily: "'DM Sans', sans-serif",
  },
  convertDialogBody2: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 1.5,
    marginBottom: 24,
    padding: '12px 16px',
    background: '#F8FAFC',
    borderRadius: 12,
    border: '1px solid #E2E8F0',
    fontFamily: "'DM Sans', sans-serif",
  },
  convertDialogActions: {
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
  },
  convertCancelBtn: {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    color: '#64748B',
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  convertMoveOnlyBtnSubtle: {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 500,
    color: '#94A3B8',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    textUnderlineOffset: '3px',
  },
  convertConfirmBtn: {
    padding: '10px 22px',
    fontSize: 14,
    fontWeight: 700,
    color: '#FFFFFF',
    background: '#10B981',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
  },
};
