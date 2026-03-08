import { useState, useMemo, useEffect, useCallback } from 'react';
import { fetchCandidateTargets, upsertCandidateTarget } from '../utils/airtableCandidates';
import { fetchSentDomains, getCampaigns, getCampaign, addRecipients, startCampaign, sendTestEmail } from '../utils/campaignApi';
import { callGemini } from '../utils/gemini';
import { getSenders } from '../utils/senderConfig';

// ── Design tokens (same palette as BridgeCampaignView) ──────────────
const T = {
  bg:          '#F7F9FC',
  white:       '#FFFFFF',
  sidebar:     '#F1F5F9',
  border:      '#E2E8F0',
  borderLight: '#F1F5F9',
  title:       '#1A2B3D',
  text:        '#334155',
  muted:       '#6B7F94',
  dim:         '#94A3B8',
  primary:     '#3B82F6',
  primaryBg:   '#EFF6FF',
  emerald:     '#10B981',
  emeraldBg:   '#ECFDF5',
  amber:       '#F59E0B',
  amberBg:     '#FFFBEB',
  red:         '#EF4444',
  redBg:       '#FEF2F2',
  sans:        "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  mono:        "'JetBrains Mono', 'Fira Code', monospace",
};

const PAGE_SIZE = 50;

// ── Helpers (mirrored from CandidateSearchView) ──────────────────────

function contactPriority(role) {
  const r = (role || '').toLowerCase().trim();
  if (/\bceo\b/.test(r) || /director\s*general/.test(r) || /\bdg\b/.test(r) ||
      /managing\s*director/.test(r) || /\bmd\b/.test(r)) return 1;
  if (/\bcfo\b/.test(r) || /director\s*financier/.test(r) ||
      /head\s*of\s*finance/.test(r) || /responsable\s*financier/.test(r) ||
      /chief\s*financial/.test(r)) return 2;
  if (r.includes('financiaci') && r.includes('estructurada')) return 3;
  if (/\bm&a\b|\bm\s*&\s*a\b/.test(r)) return 4;
  if (!r || r === 'no identificado' || r === 'nan') return 6;
  return 5;
}

function roleBadgeStyle(role) {
  const r = (role || '').toLowerCase();
  if (/\bceo\b|director\s*general|\bdg\b|managing\s*director|\bmd\b/.test(r))
    return { color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' };
  if (/\bcfo\b|director\s*financier|head\s*of\s*finance|chief\s*financial/.test(r))
    return { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
  if (r.includes('financiaci') && r.includes('estructurada'))
    return { color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' };
  if (/\bdirector\b|\bhead\b|\bjefe\b|\bjefa\b/.test(r))
    return { color: '#6366F1', bg: '#EEF2FF', border: '#C7D2FE' };
  return { color: '#6B7F94', bg: '#F1F5F9', border: '#E2E8F0' };
}

function cleanRole(role) {
  const r = (role || '').trim();
  if (!r || r.toLowerCase() === 'nan' || r.toLowerCase() === 'no identificado') return '';
  return r;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

function normalizeName(name) {
  let n = (name || '').trim();
  if (!n) return n;
  if (n.length > 2 && n === n.toUpperCase() && /[A-Z]/.test(n)) n = toTitleCase(n);
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isGenericEmail(email) {
  const localPart = (email || '').split('@')[0].toLowerCase();
  return ['info', 'admin', 'contact', 'noreply', 'no-reply', 'hola', 'hello'].some(g => localPart === g);
}

function cleanContacts(contacts) {
  if (!contacts?.length) return [];
  const seen = new Set();
  return contacts
    .filter(ct => ct.email && EMAIL_RE.test(ct.email.toLowerCase()))
    .filter(ct => { const e = ct.email.toLowerCase(); if (seen.has(e)) return false; seen.add(e); return true; })
    .map(ct => ({ ...ct, email: ct.email.toLowerCase(), name: normalizeName(ct.name) }));
}

function explorerScore(c) {
  let score = 0;
  const enrichment = c.detail?.enrichment || {};
  if ((enrichment._tv || 0) >= 2 && c.role !== 'No relevante') score += 25;
  else if ((enrichment._tv || 0) >= 2) score += 10;
  const identified = (c.detail?.contacts || []).filter(
    ct => ct.role && ct.role !== 'No identificado' && ct.role !== '' && ct.email
  );
  if (identified.length >= 2) score += 20;
  else if (identified.length === 1) score += 10;
  const hasTopContact = identified.some(ct => contactPriority(ct.role) <= 2);
  if (hasTopContact) score += 10;
  if (c.interactions > 100) score += 20;
  else if (c.interactions > 50) score += 12;
  else if (c.interactions > 20) score += 6;
  else if (c.interactions > 5) score += 2;
  if (c.monthsAgo <= 6) score += 15;
  else if (c.monthsAgo <= 18) score += 8;
  else if (c.monthsAgo <= 36) score += 3;
  if ((c.detail?.context || '').length > 200) score += 5;
  return Math.min(100, score);
}

// ── Toast ────────────────────────────────────────────────────────────
function Toast({ msg, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  const isErr = msg?.startsWith('Error') || msg?.startsWith('⚠');
  return (
    <div style={{
      position: 'fixed', bottom: 88, left: '50%', transform: 'translateX(-50%)',
      background: isErr ? T.red : T.title, color: T.white,
      padding: '10px 20px', borderRadius: 8, fontFamily: T.sans, fontSize: 14,
      fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      pointerEvents: 'none',
    }}>{msg}</div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export default function BridgeExplorerView({ allCompanies, campaignRef, previousTargets = {}, currentUser, onBack }) {
  // Data state
  const [trackingDomains, setTrackingDomains] = useState(new Set());
  const [trackingError, setTrackingError] = useState(false);
  const [savedTargets, setSavedTargets] = useState({});
  const [loadingData, setLoadingData] = useState(true);

  // Campaign detection
  const [bridgeCampaignId, setBridgeCampaignId] = useState(null);
  const [bridgeCampaign, setBridgeCampaign] = useState(null);

  // LLM ordering
  const [llmOpen, setLlmOpen] = useState(false);
  const [llmInstructions, setLlmInstructions] = useState('');
  const [llmOrdering, setLlmOrdering] = useState(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmLastRun, setLlmLastRun] = useState(null);
  const [llmProgress, setLlmProgress] = useState('');

  // Filters
  const [segFilter, setSegFilter] = useState('todas');
  const [typeFilter, setTypeFilter] = useState('todos');
  const [techFilter, setTechFilter] = useState([]);
  const [geoFilter, setGeoFilter] = useState([]);
  const [targetFilter, setTargetFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [minScore, setMinScore] = useState(0);

  // Selection & UI
  const [selectedContacts, setSelectedContacts] = useState({}); // domain → Set<email>
  const [expandedCompany, setExpandedCompany] = useState(null);
  const [selectedForSend, setSelectedForSend] = useState(new Set());
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(null);
  const [toast, setToast] = useState(null);

  // Send wizard
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  // Step 2: subject
  const [subjectMode, setSubjectMode] = useState('existing'); // 'existing' | 'new'
  const [customSubject, setCustomSubject] = useState('');
  // Step 3: sender
  const [senders, setSenders] = useState([]);
  const [selectedSender, setSelectedSender] = useState(null);
  // Step 3: wizard recipients (editable list)
  const [wizardRecipients, setWizardRecipients] = useState([]);
  // Step 3: action states
  const [testEmailSent, setTestEmailSent] = useState(false);
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [preparingLoading, setPreparingLoading] = useState(false);
  const [preparedOk, setPreparedOk] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(false);
  const [launchResult, setLaunchResult] = useState(null);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [wizardError, setWizardError] = useState('');

  const showToast = useCallback(msg => setToast(msg), []);

  // ── Load data on mount ─────────────────────────────────────────────
  useEffect(() => {
    loadData();
    // Load senders for wizard
    setSenders(getSenders());
  }, []);

  async function loadData() {
    setLoadingData(true);
    try {
      // 1. Sent domains (anti-duplicate shield)
      let domains = new Set();
      try { domains = await fetchSentDomains(); }
      catch { setTrackingError(true); }
      setTrackingDomains(domains);

      // 2. Saved targets in Airtable
      const targets = await fetchCandidateTargets(campaignRef).catch(() => ({}));
      setSavedTargets(targets || {});

      // 3. Auto-detect Bridge campaign ID
      try {
        const res = await getCampaigns();
        const campaigns = res.campaigns || [];
        const bridgeCamps = campaigns.filter(c => (c.name || '').toLowerCase().includes('bridge'));
        if (bridgeCamps.length > 0) {
          bridgeCamps.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
          const campId = bridgeCamps[0].id;
          setBridgeCampaignId(campId);
          // Fetch full campaign details for wizard
          const detail = await getCampaign(campId).catch(() => null);
          setBridgeCampaign(detail?.campaign || bridgeCamps[0]);
        }
      } catch { /* non-blocking */ }

    } finally {
      setLoadingData(false);
    }
  }

  // ── Derive candidates list ─────────────────────────────────────────
  const candidates = useMemo(() => {
    return allCompanies
      .filter(c => {
        const domain = c.domain?.toLowerCase();
        if (!domain) return false;

        // Absolute shield: already contacted
        if (trackingDomains.has(domain)) return false;

        // Exclude companies already approved/sent in previous waves
        const prevStatus = previousTargets[domain]?.status;
        if (prevStatus === 'approved' || prevStatus === 'sent' || prevStatus === 'selected') return false;

        // Only Originación companies (Bridge target segment)
        if (c.role !== 'Originación') return false;

        // Needs at least one contactable email
        if (!c.detail?.contacts?.some(ct => ct.email)) return false;

        // Status filter
        const savedStatus = savedTargets[domain]?.status;
        if (savedStatus === 'sent') return false;
        if (savedStatus === 'rejected') return false; // always exclude rejected

        if (statusFilter === 'pending') {
          // Show pending (no record) and skipped — approved excluded from Explorer
          const allowedStatuses = new Set(['pending', 'skipped']);
          if (savedStatus && !allowedStatuses.has(savedStatus)) return false;
        } else if (statusFilter === 'skipped') {
          if (savedStatus !== 'skipped') return false;
        }
        // 'all' => show all non-sent, non-rejected (including approved, selected, pending, skipped)

        // Segment filter
        if (segFilter !== 'todas' && c.segment !== segFilter) return false;

        // Type filter
        if (typeFilter !== 'todos' && c.companyType !== typeFilter) return false;

        // Tech filter
        if (techFilter.length > 0 && !techFilter.every(t => c.technologies?.includes(t))) return false;

        // Geo filter
        if (geoFilter.length > 0 && !geoFilter.some(g => c.geography?.includes(g))) return false;

        // Target priority filter
        if (targetFilter !== 'todos') {
          const contacts = c.detail?.contacts || [];
          const hasPriority = contacts.some(ct => {
            const rank = contactPriority(ct.role);
            if (targetFilter === 'ceo_dg') return rank === 1;
            if (targetFilter === 'cfo_df') return rank === 2;
            if (targetFilter === 'fin_estructurada') return rank === 3;
            return false;
          });
          if (!hasPriority) return false;
        }

        // Text search
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          if (!c.name?.toLowerCase().includes(q) && !domain.includes(q)) return false;
        }

        return true;
      })
      .map(c => {
        const sc = explorerScore(c);
        const llmEntry = llmOrdering?.find(l => l.domain === c.domain?.toLowerCase());
        return {
          ...c,
          explorerScore: sc,
          llmScore: llmEntry?.score ?? null,
          llmReason: llmEntry?.reason ?? null,
        };
      })
      .filter(c => c.explorerScore >= minScore)
      .sort((a, b) => {
        if (llmOrdering) {
          const aS = a.llmScore ?? -1;
          const bS = b.llmScore ?? -1;
          if (aS !== bS) return bS - aS;
        }
        return b.explorerScore - a.explorerScore;
      });
  }, [allCompanies, trackingDomains, savedTargets, previousTargets, segFilter, typeFilter,
      techFilter, geoFilter, targetFilter, statusFilter, searchQuery, minScore, llmOrdering]);

  // Unique filter values
  const allSegments = useMemo(() => {
    const s = new Set(allCompanies.filter(c => c.role === 'Originación').map(c => c.segment).filter(Boolean));
    return [...s].sort();
  }, [allCompanies]);
  const allTypes = useMemo(() => {
    const s = new Set(allCompanies.filter(c => c.role === 'Originación').map(c => c.companyType).filter(Boolean));
    return [...s].sort();
  }, [allCompanies]);
  const allTechs = useMemo(() => {
    const s = new Set();
    allCompanies.filter(c => c.role === 'Originación').forEach(c => (c.technologies || []).forEach(t => s.add(t)));
    return [...s].sort();
  }, [allCompanies]);
  const allGeos = useMemo(() => {
    const s = new Set();
    allCompanies.filter(c => c.role === 'Originación').forEach(c => (c.geography || []).forEach(g => s.add(g)));
    return [...s].sort();
  }, [allCompanies]);

  const paged = candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Selected contact count
  const totalSelectedContacts = useMemo(() => {
    let count = 0;
    for (const domain of selectedForSend) {
      const company = allCompanies.find(c => c.domain?.toLowerCase() === domain);
      const contacts = selectedContacts[domain];
      if (contacts) count += contacts.size;
      else if (company) {
        const cleaned = cleanContacts(company.detail?.contacts || []);
        const top = cleaned.sort((a, b) => contactPriority(a.role) - contactPriority(b.role))[0];
        if (top) count += 1;
      }
    }
    return count;
  }, [selectedForSend, selectedContacts, allCompanies]);

  // ── LLM Ordering ──────────────────────────────────────────────────
  async function runLlmOrdering() {
    if (!llmInstructions.trim() || candidates.length === 0) return;
    setLlmLoading(true);
    setLlmProgress('');
    try {
      const BATCH = 150;
      const batches = [];
      for (let i = 0; i < candidates.length; i += BATCH) batches.push(candidates.slice(i, i + BATCH));

      let allResults = [];
      for (let bi = 0; bi < batches.length; bi++) {
        setLlmProgress(`Procesando batch ${bi + 1}/${batches.length}...`);
        const sample = batches[bi].map(c => ({
          domain: c.domain,
          name: c.name,
          segment: c.segment || '',
          type: c.companyType || '',
          tech: c.technologies || [],
          geo: c.geography || [],
          interactions: c.interactions,
          monthsAgo: c.monthsAgo,
          topContactRole: (() => {
            const contacts = (c.detail?.contacts || []).filter(ct => ct.email && ct.role);
            if (!contacts.length) return 'Sin contacto identificado';
            return [...contacts].sort((a, b) => contactPriority(a.role) - contactPriority(b.role))[0].role;
          })(),
          senales: c.senales || [],
          contextSnippet: (c.detail?.context || '').slice(0, 200),
        }));

        const prompt = `Eres un asistente de Alter5, consultora de financiación de energías renovables.

El usuario quiere priorizar empresas candidatas para recibir un email sobre el programa Bridge Debt Energy (financiación puente para proyectos renovables utility-scale, 18-24 meses, sin garantía corporativa, desde 2M EUR).

INSTRUCCIONES DEL USUARIO:
${llmInstructions}

LISTA DE EMPRESAS CANDIDATAS (${sample.length}):
${JSON.stringify(sample, null, 2)}

Responde SOLO con un JSON válido, array ordenado de mayor a menor prioridad:
[
  { "domain": "empresa.com", "score": 95, "reason": "frase corta de justificación" },
  ...
]
Incluye todas las empresas de la lista. Score de 0 a 100.`;

        const result = await callGemini(prompt, 0.2);
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          allResults = [...allResults, ...parsed];
        }
      }

      setLlmOrdering(allResults);
      setLlmLastRun(new Date());
      setLlmProgress('');
    } catch (err) {
      console.error('LLM ordering failed:', err);
      setLlmProgress('Error al procesar. La lista mantiene el orden estático.');
    } finally {
      setLlmLoading(false);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────
  function getContactsForCompany(company) {
    const domain = company.domain?.toLowerCase();
    if (selectedContacts[domain]?.size > 0) {
      return [...selectedContacts[domain]];
    }
    // Default: top-1 contact
    const cleaned = cleanContacts(company.detail?.contacts || []);
    const sorted = [...cleaned].sort((a, b) => contactPriority(a.role) - contactPriority(b.role));
    return sorted.slice(0, 1).map(ct => ct.email);
  }

  function initContactsForCompany(company) {
    const domain = company.domain?.toLowerCase();
    if (selectedContacts[domain]) return; // already initialized
    const cleaned = cleanContacts(company.detail?.contacts || []);
    const sorted = [...cleaned].sort((a, b) => contactPriority(a.role) - contactPriority(b.role));
    const top1 = sorted.slice(0, 1).map(ct => ct.email);
    setSelectedContacts(prev => ({ ...prev, [domain]: new Set(top1) }));
  }

  async function handleAction(company, status) {
    const domain = company.domain?.toLowerCase();
    if (!domain) return;
    setSaving(domain);
    const existing = savedTargets[domain];
    const contacts = status === 'selected' ? getContactsForCompany(company) : (existing?.selectedContacts || []);
    try {
      const result = await upsertCandidateTarget({
        id: existing?.id || null,
        domain,
        companyName: company.name,
        status,
        selectedContacts: contacts.map(email => {
          const ct = (company.detail?.contacts || []).find(c => c.email?.toLowerCase() === email);
          return ct ? { email, name: ct.name || '', role: ct.role || '' } : { email };
        }),
        campaignRef,
        segment: company.segment || '',
        companyType: company.companyType || '',
        technologies: company.technologies || [],
        reviewedBy: currentUser || 'Salvador Carrillo',
        reviewedAt: new Date().toISOString().split('T')[0],
      });

      setSavedTargets(prev => ({
        ...prev,
        [domain]: {
          ...prev[domain],
          id: result.id || existing?.id,
          domain,
          companyName: company.name,
          status,
          selectedContacts: contacts,
          campaignRef,
        },
      }));

      if (status === 'selected') {
        setSelectedForSend(prev => new Set([...prev, domain]));
        showToast(`✓ ${company.name} añadida`);
        setExpandedCompany(null);
      } else if (status === 'skipped') {
        setSelectedForSend(prev => { const n = new Set(prev); n.delete(domain); return n; });
        showToast(`→ ${company.name} saltada`);
        setExpandedCompany(null);
      } else if (status === 'rejected') {
        setSelectedForSend(prev => { const n = new Set(prev); n.delete(domain); return n; });
        showToast(`✕ ${company.name} descartada`);
        setExpandedCompany(null);
      } else if (status === 'pending') {
        setSelectedForSend(prev => { const n = new Set(prev); n.delete(domain); return n; });
        showToast(`↩ ${company.name} recuperada`);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setSaving(null);
    }
  }

  // ── Wizard helpers ─────────────────────────────────────────────────
  function buildWizardRecipients() {
    const list = [];
    for (const domain of selectedForSend) {
      const company = allCompanies.find(c => c.domain?.toLowerCase() === domain);
      if (!company) continue;
      const cleaned = cleanContacts(company.detail?.contacts || []);
      const contactEmails = getContactsForCompany(company);
      for (const email of contactEmails) {
        const ct = cleaned.find(c => c.email === email);
        if (ct) {
          list.push({
            email,
            name: ct.name || '',
            lastName: '',
            organization: company.name || '',
            role: ct.role || '',
            domain,
          });
        }
      }
    }
    return list;
  }

  function openWizard() {
    const recipients = buildWizardRecipients();
    setWizardRecipients(recipients);
    setWizardStep(1);
    setSubjectMode('existing');
    setCustomSubject('');
    setSelectedSender(senders[0] || null);
    setTestEmailSent(false);
    setPreparedOk(false);
    setLaunchResult(null);
    setConfirmLaunch(false);
    setWizardError('');
    setShowWizard(true);
  }

  function getSubjectForWizard() {
    if (subjectMode === 'new') return customSubject;
    if (bridgeCampaign) {
      const winner = bridgeCampaign.abWinner;
      if (winner === 'B' && bridgeCampaign.subjectB) return bridgeCampaign.subjectB;
      return bridgeCampaign.subjectA || '';
    }
    return '';
  }

  async function handleTestEmail() {
    if (!bridgeCampaignId) {
      setWizardError('No se encontró la campaña Bridge. No es posible enviar prueba.');
      return;
    }
    setTestEmailLoading(true);
    setWizardError('');
    try {
      await sendTestEmail(bridgeCampaignId, 'salvador.carrillo@alter-5.com');
      setTestEmailSent(true);
    } catch (err) {
      setWizardError(`Error al enviar prueba: ${err.message}`);
    } finally {
      setTestEmailLoading(false);
    }
  }

  async function handlePrepare() {
    if (!bridgeCampaignId) {
      setWizardError('No se encontró la campaña Bridge. Por favor actualiza desde el dashboard.');
      return;
    }
    if (wizardRecipients.length === 0) {
      setWizardError('No hay destinatarios seleccionados.');
      return;
    }
    setPreparingLoading(true);
    setWizardError('');
    try {
      // Add recipients to the Bridge campaign
      const recipientsPayload = wizardRecipients.map(r => ({
        email: r.email,
        name: r.name,
        lastName: r.lastName || '',
        organization: r.organization,
        role: r.role || '',
      }));
      await addRecipients(bridgeCampaignId, recipientsPayload);

      // Mark all selected companies as 'sent' in Airtable
      const markPromises = [...selectedForSend].map(async domain => {
        const company = allCompanies.find(c => c.domain?.toLowerCase() === domain);
        if (!company) return;
        const existing = savedTargets[domain];
        await upsertCandidateTarget({
          id: existing?.id || null,
          domain,
          companyName: company.name,
          status: 'sent',
          selectedContacts: existing?.selectedContacts || [],
          campaignRef,
          segment: company.segment || '',
          companyType: company.companyType || '',
          technologies: company.technologies || [],
          reviewedBy: currentUser || 'Salvador Carrillo',
          reviewedAt: new Date().toISOString().split('T')[0],
        });
      });
      await Promise.all(markPromises);

      setSavedTargets(prev => {
        const next = { ...prev };
        for (const domain of selectedForSend) {
          next[domain] = { ...(next[domain] || {}), status: 'sent' };
        }
        return next;
      });

      setPreparedOk(true);
      showToast(`✅ ${wizardRecipients.length} emails preparados.`);
    } catch (err) {
      setWizardError(`Error al preparar: ${err.message}`);
    } finally {
      setPreparingLoading(false);
    }
  }

  async function handleLaunch() {
    if (!bridgeCampaignId) return;
    setLaunchLoading(true);
    setWizardError('');
    try {
      const result = await startCampaign(bridgeCampaignId);
      setLaunchResult(result);
      setConfirmLaunch(false);
    } catch (err) {
      setWizardError(`Error al lanzar: ${err.message}`);
    } finally {
      setLaunchLoading(false);
    }
  }

  // ── STATUS BADGE ──────────────────────────────────────────────────
  function statusBadge(status) {
    const cfg = {
      selected:  { label: 'Seleccionada', color: '#059669', bg: '#ECFDF5' },
      approved:  { label: 'Aprobada',     color: '#2563EB', bg: '#EFF6FF' },
      skipped:   { label: 'Saltada',      color: '#D97706', bg: '#FFFBEB' },
      rejected:  { label: 'Descartada',   color: '#EF4444', bg: '#FEF2F2' },
      pending:   { label: 'Pendiente',    color: '#6B7F94', bg: '#F1F5F9' },
    }[status] || { label: status, color: '#6B7F94', bg: '#F1F5F9' };
    return (
      <span style={{
        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        color: cfg.color, background: cfg.bg, fontFamily: T.sans,
      }}>{cfg.label}</span>
    );
  }

  // ── Company Card ──────────────────────────────────────────────────
  function CompanyCard({ company }) {
    const domain = company.domain?.toLowerCase();
    const saved = savedTargets[domain];
    const status = saved?.status || 'pending';
    const isExpanded = expandedCompany === domain;
    const isSelected = selectedForSend.has(domain);
    const isSaving = saving === domain;
    const contacts = cleanContacts(company.detail?.contacts || [])
      .sort((a, b) => contactPriority(a.role) - contactPriority(b.role));
    const selectedEmails = selectedContacts[domain] || new Set();

    const borderColor = isSelected ? T.emerald :
      status === 'skipped' ? T.amber :
      status === 'rejected' ? T.red :
      T.border;

    function toggleContact(email) {
      setSelectedContacts(prev => {
        const cur = new Set(prev[domain] || []);
        if (cur.has(email)) cur.delete(email); else cur.add(email);
        return { ...prev, [domain]: cur };
      });
    }

    return (
      <div style={{
        background: T.white,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 10,
        marginBottom: 8,
        transition: 'border-color 0.2s',
        overflow: 'hidden',
      }}>
        {/* Compact row */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px', cursor: 'pointer',
          }}
          onClick={() => {
            if (!isExpanded) initContactsForCompany(company);
            setExpandedCompany(isExpanded ? null : domain);
          }}
        >
          {/* Score */}
          <div style={{
            minWidth: 36, height: 36, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: company.explorerScore >= 70 ? T.emeraldBg : company.explorerScore >= 40 ? T.amberBg : T.sidebar,
            fontSize: 12, fontWeight: 700, fontFamily: T.mono,
            color: company.explorerScore >= 70 ? T.emerald : company.explorerScore >= 40 ? T.amber : T.muted,
          }}>{company.explorerScore}</div>

          {/* Company info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 14, color: T.title }}>
                {company.name}
              </span>
              {statusBadge(status)}
              {isSelected && <span style={{ fontSize: 12, color: T.emerald, fontWeight: 600 }}>✓</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
              {company.companyType && <span style={{ fontSize: 11, color: T.muted }}>{company.companyType}</span>}
              {company.segment && <span style={{ fontSize: 11, color: T.muted }}>· {company.segment}</span>}
              {(company.geography || []).slice(0, 2).map(g => (
                <span key={g} style={{ fontSize: 11, color: T.muted }}>· {g}</span>
              ))}
              {company.interactions > 0 && (
                <span style={{ fontSize: 11, color: T.dim }}>· {company.interactions} emails</span>
              )}
            </div>
            {company.llmReason && (
              <div style={{ marginTop: 4, fontSize: 11, color: '#6366F1', fontStyle: 'italic' }}>
                ⭐ {company.llmReason}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            {status !== 'selected' && status !== 'sent' && (
              <button
                disabled={isSaving}
                onClick={() => { initContactsForCompany(company); handleAction(company, 'selected'); }}
                style={{
                  padding: '5px 12px', borderRadius: 6, border: 'none',
                  background: T.emerald, color: T.white, fontSize: 12, fontWeight: 600,
                  cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1,
                  fontFamily: T.sans,
                }}
              >✓ Seleccionar</button>
            )}
            {status !== 'skipped' && status !== 'sent' && status !== 'selected' && (
              <button
                disabled={isSaving}
                onClick={() => handleAction(company, 'skipped')}
                style={{
                  padding: '5px 12px', borderRadius: 6, border: `1px solid ${T.border}`,
                  background: T.white, color: T.muted, fontSize: 12, fontWeight: 500,
                  cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1,
                  fontFamily: T.sans,
                }}
              >→ Saltar</button>
            )}
            {(status === 'skipped' || status === 'pending') && (
              <button
                disabled={isSaving}
                onClick={() => handleAction(company, 'pending')}
                style={{
                  padding: '5px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
                  background: T.white, color: T.muted, fontSize: 11,
                  cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1,
                  fontFamily: T.sans, display: status === 'skipped' ? 'block' : 'none',
                }}
              >↩ Recuperar</button>
            )}
            {status === 'selected' && (
              <button
                disabled={isSaving}
                onClick={() => handleAction(company, 'pending')}
                style={{
                  padding: '5px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
                  background: T.white, color: T.red, fontSize: 11,
                  cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1,
                  fontFamily: T.sans,
                }}
              >Quitar</button>
            )}
            <span style={{ fontSize: 13, color: T.dim }}>{isExpanded ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Expanded */}
        {isExpanded && (
          <div style={{ borderTop: `1px solid ${T.borderLight}`, padding: '14px 16px' }}>
            <div style={{ fontFamily: T.sans, fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 10 }}>
              Contactos para este envío:
            </div>
            {contacts.length === 0 && (
              <div style={{ color: T.dim, fontSize: 12, fontFamily: T.sans }}>Sin contactos con email</div>
            )}
            {contacts.map((ct, idx) => {
              const isTop = idx === 0;
              const badge = roleBadgeStyle(ct.role);
              const checked = selectedEmails.has(ct.email);
              return (
                <div key={ct.email} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 8px', borderRadius: 6, marginBottom: 4,
                  background: checked ? T.emeraldBg : 'transparent',
                  cursor: 'pointer',
                }} onClick={() => toggleContact(ct.email)}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleContact(ct.email)}
                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: T.emerald }}
                    onClick={e => e.stopPropagation()}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isTop && <span style={{ fontSize: 11, color: T.amber }}>⭐</span>}
                      <span style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 600, color: T.title }}>
                        {ct.name || ct.email}
                      </span>
                      {isTop && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: T.amber, background: T.amberBg,
                          padding: '1px 6px', borderRadius: 999,
                        }}>RECOMENDADO</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 11, color: T.dim }}>{ct.email}</span>
                      {cleanRole(ct.role) && (
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 999, fontWeight: 600,
                          color: badge.color, background: badge.bg, border: `1px solid ${badge.border}`,
                        }}>{cleanRole(ct.role)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Context snippet */}
            {(company.detail?.context || '').length > 20 && (
              <div style={{ marginTop: 10, padding: '8px 10px', background: T.sidebar, borderRadius: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4 }}>Contexto:</div>
                <div style={{ fontSize: 12, color: T.text, fontFamily: T.sans, lineHeight: 1.5 }}>
                  {(company.detail?.context || '').slice(0, 300)}
                  {company.detail?.context?.length > 300 ? '...' : ''}
                </div>
              </div>
            )}

            {/* Action buttons in expanded view */}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                disabled={isSaving || selectedEmails.size === 0}
                onClick={() => handleAction(company, 'selected')}
                style={{
                  padding: '8px 16px', borderRadius: 7, border: 'none',
                  background: selectedEmails.size > 0 ? T.emerald : T.dim,
                  color: T.white, fontSize: 13, fontWeight: 600, cursor: selectedEmails.size > 0 ? 'pointer' : 'not-allowed',
                  fontFamily: T.sans, opacity: isSaving ? 0.6 : 1,
                }}
              >✓ Seleccionar con {selectedEmails.size} contacto{selectedEmails.size !== 1 ? 's' : ''}</button>
              <button
                disabled={isSaving}
                onClick={() => handleAction(company, 'skipped')}
                style={{
                  padding: '8px 16px', borderRadius: 7, border: `1px solid ${T.border}`,
                  background: T.white, color: T.muted, fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', fontFamily: T.sans, opacity: isSaving ? 0.6 : 1,
                }}
              >→ Saltar por ahora</button>
              <button
                disabled={isSaving}
                onClick={() => handleAction(company, 'rejected')}
                style={{
                  padding: '8px 16px', borderRadius: 7, border: `1px solid ${T.red}`,
                  background: T.white, color: T.red, fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', fontFamily: T.sans, opacity: isSaving ? 0.6 : 1,
                }}
              >✕ Descartar</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Send Wizard ────────────────────────────────────────────────────
  function SendWizard() {
    if (!showWizard) return null;

    const subject = getSubjectForWizard();
    const sender = selectedSender || senders[0] || { name: 'Leticia Menendez', email: 'leticia@alter-5.com' };

    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} onClick={e => { if (e.target === e.currentTarget) setShowWizard(false); }}>
        <div style={{
          background: T.white, borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          width: '90%', maxWidth: 680, maxHeight: '90vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Wizard header */}
          <div style={{
            padding: '20px 24px', borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 16, color: T.title }}>
                Preparar envío
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {[1, 2, 3].map(s => (
                  <div key={s} style={{
                    padding: '3px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                    fontFamily: T.sans,
                    background: wizardStep === s ? T.primary : wizardStep > s ? T.emeraldBg : T.sidebar,
                    color: wizardStep === s ? T.white : wizardStep > s ? T.emerald : T.muted,
                  }}>
                    {s === 1 ? '1. Empresas' : s === 2 ? '2. Asunto' : '3. Enviar'}
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setShowWizard(false)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 20, color: T.dim, padding: 4,
              }}
            >✕</button>
          </div>

          {/* Wizard body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

            {/* Step 1: Preview */}
            {wizardStep === 1 && (
              <div>
                <div style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 14, color: T.title, marginBottom: 14 }}>
                  {selectedForSend.size} empresa{selectedForSend.size !== 1 ? 's' : ''} seleccionadas · {totalSelectedContacts} contacto{totalSelectedContacts !== 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[...selectedForSend].map(domain => {
                    const company = allCompanies.find(c => c.domain?.toLowerCase() === domain);
                    if (!company) return null;
                    const emails = getContactsForCompany(company);
                    const cleanedAll = cleanContacts(company.detail?.contacts || []);
                    return (
                      <div key={domain} style={{
                        padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.border}`,
                        background: T.white,
                      }}>
                        <div style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 13, color: T.title }}>
                          {company.name}
                        </div>
                        {emails.map(email => {
                          const ct = cleanedAll.find(c => c.email === email);
                          return (
                            <div key={email} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <span style={{ fontSize: 12, color: T.muted }}>{email}</span>
                              {ct?.role && <span style={{ fontSize: 11, color: T.dim }}>— {ct.role}</span>}
                              <button
                                onClick={() => {
                                  setWizardRecipients(prev => prev.filter(r => r.email !== email));
                                }}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  color: T.dim, fontSize: 14, padding: '0 4px',
                                }}
                              >✕</button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Subject */}
            {wizardStep === 2 && (
              <div>
                <div style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 14, color: T.title, marginBottom: 16 }}>
                  ¿Qué asunto vas a usar?
                </div>
                {bridgeCampaign && (
                  <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16, cursor: 'pointer' }}>
                    <input
                      type="radio" checked={subjectMode === 'existing'}
                      onChange={() => setSubjectMode('existing')}
                      style={{ marginTop: 2, accentColor: T.primary }}
                    />
                    <div>
                      <div style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 13, color: T.title, marginBottom: 4 }}>
                        Usar el asunto de la campaña Bridge
                      </div>
                      <div style={{
                        padding: '8px 12px', background: T.sidebar, borderRadius: 6,
                        fontSize: 12, color: T.text, fontFamily: T.sans,
                      }}>
                        {bridgeCampaign.subjectA || '(sin asunto)'}
                        {bridgeCampaign.abWinner === 'B' && bridgeCampaign.subjectB && (
                          <span style={{ marginLeft: 8, color: T.emerald, fontWeight: 600 }}>[Variante B ganadora]</span>
                        )}
                      </div>
                    </div>
                  </label>
                )}
                <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input
                    type="radio" checked={subjectMode === 'new'}
                    onChange={() => setSubjectMode('new')}
                    style={{ marginTop: 2, accentColor: T.primary }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 13, color: T.title, marginBottom: 6 }}>
                      Escribir un asunto nuevo
                    </div>
                    <input
                      type="text"
                      value={customSubject}
                      onChange={e => setCustomSubject(e.target.value)}
                      onFocus={() => setSubjectMode('new')}
                      placeholder="Asunto del email..."
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 7,
                        border: `1px solid ${T.border}`, fontFamily: T.sans, fontSize: 13,
                        color: T.text, outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </label>
              </div>
            )}

            {/* Step 3: Sender + launch */}
            {wizardStep === 3 && (
              <div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 13, color: T.title, marginBottom: 8 }}>
                    Remitente
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {senders.map(s => (
                      <label key={s.email} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          checked={selectedSender?.email === s.email}
                          onChange={() => setSelectedSender(s)}
                          style={{ accentColor: T.primary }}
                        />
                        <span style={{ fontFamily: T.sans, fontSize: 13, color: T.text }}>
                          {s.name} <span style={{ color: T.muted }}>({s.email})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{
                    marginTop: 10, padding: '8px 12px', background: T.amberBg,
                    borderRadius: 6, fontSize: 12, color: T.amber, fontFamily: T.sans,
                  }}>
                    ⚠ El remitente real depende de la cuenta Gmail que autorizó el script GAS.
                    Si el remitente seleccionado no es el propietario del script, el email puede enviarse
                    "en nombre de" esa cuenta. Para enviar desde otra cuenta, contacta al administrador del script.
                  </div>
                </div>

                {/* Summary */}
                <div style={{
                  padding: '12px 14px', background: T.sidebar, borderRadius: 8, marginBottom: 20,
                  fontFamily: T.sans, fontSize: 13, color: T.text,
                }}>
                  <div style={{ fontWeight: 600, color: T.title, marginBottom: 8 }}>Resumen</div>
                  <div>· {wizardRecipients.length} contactos en {selectedForSend.size} empresa{selectedForSend.size !== 1 ? 's' : ''}</div>
                  {subject && <div>· Asunto: <em>{subject}</em></div>}
                  <div>· Remitente: {sender.name}</div>
                  {bridgeCampaignId && <div style={{ color: T.muted, fontSize: 11, marginTop: 4 }}>Campaña: {bridgeCampaignId}</div>}
                </div>

                {/* Error banner */}
                {wizardError && (
                  <div style={{
                    padding: '10px 14px', background: T.redBg, border: `1px solid #FECACA`,
                    borderRadius: 8, fontSize: 13, color: T.red, fontFamily: T.sans, marginBottom: 16,
                  }}>{wizardError}</div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Test email */}
                  <button
                    disabled={testEmailLoading || !bridgeCampaignId}
                    onClick={handleTestEmail}
                    style={{
                      padding: '10px 16px', borderRadius: 8, border: `1px solid ${T.border}`,
                      background: testEmailSent ? T.emeraldBg : T.white,
                      color: testEmailSent ? T.emerald : T.text,
                      fontSize: 13, fontWeight: 600, cursor: testEmailLoading ? 'not-allowed' : 'pointer',
                      fontFamily: T.sans, display: 'flex', alignItems: 'center', gap: 8,
                      opacity: !bridgeCampaignId ? 0.5 : 1,
                    }}
                  >
                    {testEmailLoading ? '⏳ Enviando prueba...' : testEmailSent ? '✅ Prueba enviada' : '📧 Enviar email de prueba'}
                    {!testEmailLoading && !testEmailSent && (
                      <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>→ salvador.carrillo@alter-5.com</span>
                    )}
                  </button>

                  {/* Prepare */}
                  {!preparedOk ? (
                    <button
                      disabled={preparingLoading || !bridgeCampaignId || wizardRecipients.length === 0}
                      onClick={handlePrepare}
                      style={{
                        padding: '10px 16px', borderRadius: 8, border: 'none',
                        background: T.primary, color: T.white,
                        fontSize: 13, fontWeight: 600,
                        cursor: preparingLoading ? 'not-allowed' : 'pointer',
                        fontFamily: T.sans, opacity: (!bridgeCampaignId || wizardRecipients.length === 0) ? 0.5 : 1,
                      }}
                    >
                      {preparingLoading ? '⏳ Preparando...' : `✓ Preparar envío (${wizardRecipients.length} emails)`}
                    </button>
                  ) : (
                    <div style={{
                      padding: '10px 16px', borderRadius: 8, background: T.emeraldBg,
                      color: T.emerald, fontSize: 13, fontWeight: 600, fontFamily: T.sans,
                    }}>
                      ✅ Listo. {wizardRecipients.length} emails preparados.
                    </div>
                  )}

                  {/* Launch */}
                  {preparedOk && !launchResult && (
                    <>
                      {!confirmLaunch ? (
                        <button
                          onClick={() => setConfirmLaunch(true)}
                          style={{
                            padding: '10px 16px', borderRadius: 8, border: 'none',
                            background: T.emerald, color: T.white,
                            fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            fontFamily: T.sans,
                          }}
                        >🚀 Lanzar envío ahora</button>
                      ) : (
                        <div style={{
                          padding: '14px', borderRadius: 8, border: `1.5px solid ${T.red}`,
                          background: T.redBg,
                        }}>
                          <div style={{ fontFamily: T.sans, fontSize: 13, color: T.red, fontWeight: 600, marginBottom: 10 }}>
                            ¿Estás seguro? Se enviarán {wizardRecipients.length} emails desde {sender.email}.
                            Esta acción no se puede deshacer.
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              disabled={launchLoading}
                              onClick={handleLaunch}
                              style={{
                                padding: '8px 16px', borderRadius: 7, border: 'none',
                                background: T.red, color: T.white, fontSize: 13, fontWeight: 600,
                                cursor: launchLoading ? 'not-allowed' : 'pointer', fontFamily: T.sans,
                              }}
                            >{launchLoading ? '⏳ Lanzando...' : '🚀 Confirmar lanzamiento'}</button>
                            <button
                              onClick={() => setConfirmLaunch(false)}
                              style={{
                                padding: '8px 16px', borderRadius: 7, border: `1px solid ${T.border}`,
                                background: T.white, color: T.muted, fontSize: 13,
                                cursor: 'pointer', fontFamily: T.sans,
                              }}
                            >Cancelar</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Launch result */}
                  {launchResult && (
                    <div style={{
                      padding: '12px 14px', borderRadius: 8,
                      background: launchResult.errors?.length ? T.amberBg : T.emeraldBg,
                      border: `1px solid ${launchResult.errors?.length ? T.amber : T.emerald}`,
                    }}>
                      <div style={{
                        fontFamily: T.sans, fontSize: 13, fontWeight: 600,
                        color: launchResult.errors?.length ? T.amber : T.emerald,
                      }}>
                        {launchResult.errors?.length
                          ? `⚠ ${launchResult.sent || 0} enviados, ${launchResult.errors.length} errores`
                          : `✅ ${launchResult.sent || 0} emails enviados correctamente`}
                      </div>
                      {launchResult.errors?.length > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: T.text }}>
                          {launchResult.errors.map((e, i) => (
                            <div key={i}>{e.email}: {e.error}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Wizard footer */}
          <div style={{
            padding: '14px 24px', borderTop: `1px solid ${T.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <button
              onClick={() => { if (wizardStep > 1) setWizardStep(wizardStep - 1); else setShowWizard(false); }}
              style={{
                padding: '8px 16px', borderRadius: 7, border: `1px solid ${T.border}`,
                background: T.white, color: T.muted, fontSize: 13, cursor: 'pointer', fontFamily: T.sans,
              }}
            >{wizardStep > 1 ? '← Volver' : 'Cancelar'}</button>
            {wizardStep < 3 && (
              <button
                disabled={wizardStep === 2 && subjectMode === 'new' && !customSubject.trim()}
                onClick={() => setWizardStep(wizardStep + 1)}
                style={{
                  padding: '8px 20px', borderRadius: 7, border: 'none',
                  background: T.primary, color: T.white, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: T.sans,
                  opacity: (wizardStep === 2 && subjectMode === 'new' && !customSubject.trim()) ? 0.5 : 1,
                }}
              >Siguiente →</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────
  if (loadingData) {
    return (
      <div style={{
        minHeight: '100vh', background: T.bg, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontFamily: T.sans,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div style={{ color: T.muted, fontSize: 15 }}>Cargando candidatos...</div>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(candidates.length / PAGE_SIZE);

  return (
    <div style={{ minHeight: '100vh', background: T.bg }}>
      {/* Header */}
      <header style={{
        background: T.white, borderBottom: `1px solid ${T.border}`,
        padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent',
              cursor: 'pointer', color: T.muted, fontSize: 13, fontWeight: 500,
              fontFamily: T.sans,
            }}
          >
            <span style={{ fontSize: 16 }}>←</span> Volver a la campaña
          </button>
          <div style={{ width: 1, height: 28, background: T.border }} />
          <div>
            <div style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 15, color: T.title, display: 'flex', alignItems: 'center', gap: 8 }}>
              Bridge Energy Debt — Nuevos candidatos
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                background: T.primaryBg, color: T.primary, border: `1px solid ${T.primary}33`,
              }}>{campaignRef}</span>
            </div>
            <div style={{ fontFamily: T.sans, fontSize: 12, color: T.muted }}>
              {candidates.length} empresas por revisar · {selectedForSend.size} seleccionadas
              {Object.keys(previousTargets).length > 0 && (
                <span style={{ marginLeft: 6 }}>
                  · {Object.values(previousTargets).filter(t => t.status === 'approved' || t.status === 'sent' || t.status === 'selected').length} excluidas de waves anteriores
                </span>
              )}
              {trackingError && (
                <span style={{ color: T.amber, marginLeft: 8 }}>⚠ Error al cargar dominios enviados</span>
              )}
            </div>
          </div>
        </div>
        {selectedForSend.size > 0 && (
          <button
            onClick={openWizard}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: T.emerald, color: T.white, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: T.sans,
            }}
          >Preparar envío para {selectedForSend.size} empresa{selectedForSend.size !== 1 ? 's' : ''} →</button>
        )}
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>

        {/* LLM Panel */}
        <div style={{
          background: T.white, border: `1px solid ${T.border}`, borderRadius: 10,
          marginBottom: 16, overflow: 'hidden',
        }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', cursor: 'pointer',
            }}
            onClick={() => setLlmOpen(v => !v)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              <span style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 13, color: T.title }}>
                Ordenar con IA
              </span>
              {llmLastRun && (
                <span style={{ fontSize: 11, color: T.muted }}>
                  · Última ordenación: {new Date(llmLastRun).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {llmOrdering && <span style={{ fontSize: 11, color: T.emerald, fontWeight: 600 }}>✓ Activa</span>}
            </div>
            <span style={{ color: T.dim, fontSize: 13 }}>{llmOpen ? '▲' : '▼'}</span>
          </div>
          {llmOpen && (
            <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${T.borderLight}` }}>
              <textarea
                value={llmInstructions}
                onChange={e => setLlmInstructions(e.target.value)}
                placeholder="Ej: Prioriza empresas con CEO o Director Financiero identificado, que trabajen en solar y estén en España o Portugal..."
                rows={3}
                style={{
                  width: '100%', marginTop: 12, padding: '10px 12px',
                  borderRadius: 7, border: `1px solid ${T.border}`,
                  fontFamily: T.sans, fontSize: 13, color: T.text, resize: 'vertical',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <button
                  disabled={llmLoading || !llmInstructions.trim()}
                  onClick={runLlmOrdering}
                  style={{
                    padding: '8px 16px', borderRadius: 7, border: 'none',
                    background: llmLoading ? T.sidebar : T.primary,
                    color: llmLoading ? T.muted : T.white,
                    fontSize: 13, fontWeight: 600, cursor: llmLoading ? 'not-allowed' : 'pointer',
                    fontFamily: T.sans,
                  }}
                >{llmLoading ? '⏳ Procesando...' : '✨ Reordenar lista'}</button>
                {llmOrdering && (
                  <button
                    onClick={() => setLlmOrdering(null)}
                    style={{
                      padding: '8px 12px', borderRadius: 7, border: `1px solid ${T.border}`,
                      background: T.white, color: T.muted, fontSize: 12,
                      cursor: 'pointer', fontFamily: T.sans,
                    }}
                  >✕ Quitar ordenación IA</button>
                )}
                {llmProgress && (
                  <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans }}>{llmProgress}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{
          background: T.white, border: `1px solid ${T.border}`, borderRadius: 10,
          padding: '14px 16px', marginBottom: 16,
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}>
          {/* Segment */}
          <select
            value={segFilter}
            onChange={e => { setSegFilter(e.target.value); setPage(0); }}
            style={{
              padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
              fontFamily: T.sans, fontSize: 12, color: T.text, background: T.white,
            }}
          >
            <option value="todas">Todos los segmentos</option>
            {allSegments.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Type */}
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(0); }}
            style={{
              padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
              fontFamily: T.sans, fontSize: 12, color: T.text, background: T.white,
            }}
          >
            <option value="todos">Todos los tipos</option>
            {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Target priority */}
          <select
            value={targetFilter}
            onChange={e => { setTargetFilter(e.target.value); setPage(0); }}
            style={{
              padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
              fontFamily: T.sans, fontSize: 12, color: T.text, background: T.white,
            }}
          >
            <option value="todos">Todos los targets</option>
            <option value="ceo_dg">Con CEO / Director General</option>
            <option value="cfo_df">Con Director Financiero</option>
            <option value="fin_estructurada">Con Fin. Estructurada</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
            style={{
              padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
              fontFamily: T.sans, fontSize: 12, color: T.text, background: T.white,
            }}
          >
            <option value="pending">Sin revisar</option>
            <option value="skipped">Saltadas</option>
            <option value="all">Todas (excl. enviadas y descartadas)</option>
          </select>

          {/* Min score */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans }}>Score mín:</span>
            <input
              type="number" min={0} max={100} value={minScore}
              onChange={e => { setMinScore(Number(e.target.value)); setPage(0); }}
              style={{
                width: 54, padding: '5px 8px', borderRadius: 6, border: `1px solid ${T.border}`,
                fontFamily: T.sans, fontSize: 12, color: T.text,
              }}
            />
          </div>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
            placeholder="Buscar empresa o dominio..."
            style={{
              flex: 1, minWidth: 180, padding: '6px 10px', borderRadius: 6,
              border: `1px solid ${T.border}`, fontFamily: T.sans, fontSize: 12,
              color: T.text, outline: 'none',
            }}
          />

          {/* Reset */}
          {(segFilter !== 'todas' || typeFilter !== 'todos' || targetFilter !== 'todos' ||
            statusFilter !== 'pending' || minScore > 0 || searchQuery || techFilter.length || geoFilter.length) && (
            <button
              onClick={() => {
                setSegFilter('todas'); setTypeFilter('todos'); setTargetFilter('todos');
                setStatusFilter('pending'); setMinScore(0); setSearchQuery('');
                setTechFilter([]); setGeoFilter([]); setPage(0);
              }}
              style={{
                padding: '5px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
                background: T.white, color: T.muted, fontSize: 11, cursor: 'pointer',
                fontFamily: T.sans,
              }}
            >✕ Resetear filtros</button>
          )}
        </div>

        {/* Tech & Geo chips */}
        {(allTechs.length > 0 || allGeos.length > 0) && (
          <div style={{
            background: T.white, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: '10px 16px', marginBottom: 16,
            display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans }}>Tecnologías:</span>
            {allTechs.slice(0, 10).map(t => {
              const active = techFilter.includes(t);
              return (
                <button key={t} onClick={() => {
                  setTechFilter(prev => active ? prev.filter(x => x !== t) : [...prev, t]);
                  setPage(0);
                }} style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                  border: active ? 'none' : `1px solid ${T.border}`,
                  background: active ? T.primary : T.white,
                  color: active ? T.white : T.muted,
                  cursor: 'pointer', fontFamily: T.sans,
                }}>{t}</button>
              );
            })}
            <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans, marginLeft: 8 }}>Geografía:</span>
            {allGeos.slice(0, 8).map(g => {
              const active = geoFilter.includes(g);
              return (
                <button key={g} onClick={() => {
                  setGeoFilter(prev => active ? prev.filter(x => x !== g) : [...prev, g]);
                  setPage(0);
                }} style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                  border: active ? 'none' : `1px solid ${T.border}`,
                  background: active ? '#6366F1' : T.white,
                  color: active ? T.white : T.muted,
                  cursor: 'pointer', fontFamily: T.sans,
                }}>{g}</button>
              );
            })}
          </div>
        )}

        {/* Counter */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <span style={{ fontFamily: T.sans, fontSize: 13, color: T.muted }}>
            Mostrando {paged.length > 0 ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, candidates.length)}` : '0'} de {candidates.length} candidatas
          </span>
          {selectedForSend.size > 0 && (
            <button
              onClick={() => {
                setSelectedForSend(new Set());
                // Deselect all in Airtable too? Skip for now — just clear local state
              }}
              style={{
                padding: '4px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
                background: T.white, color: T.muted, fontSize: 11, cursor: 'pointer', fontFamily: T.sans,
              }}
            >Deseleccionar todas</button>
          )}
        </div>

        {/* Candidates list */}
        {candidates.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 20px', fontFamily: T.sans, color: T.muted,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.title, marginBottom: 8 }}>
              No hay candidatas que coincidan con los filtros
            </div>
            <div style={{ fontSize: 13 }}>
              {trackingError
                ? 'Error al cargar dominios enviados. Revisa la conexión.'
                : 'Prueba a ajustar los filtros o cambiar el estado.'}
            </div>
          </div>
        ) : (
          paged.map(company => (
            <CompanyCard key={company.domain} company={company} />
          ))
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24, paddingBottom: 80,
          }}>
            <button
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              style={{
                padding: '7px 14px', borderRadius: 7, border: `1px solid ${T.border}`,
                background: T.white, color: page === 0 ? T.dim : T.text, cursor: page === 0 ? 'default' : 'pointer',
                fontFamily: T.sans, fontSize: 13,
              }}
            >← Anterior</button>
            <span style={{ padding: '7px 12px', fontFamily: T.sans, fontSize: 13, color: T.muted }}>
              Página {page + 1} de {totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              style={{
                padding: '7px 14px', borderRadius: 7, border: `1px solid ${T.border}`,
                background: T.white, color: page >= totalPages - 1 ? T.dim : T.text,
                cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                fontFamily: T.sans, fontSize: 13,
              }}
            >Siguiente →</button>
          </div>
        )}
      </main>

      {/* Floating bar */}
      {selectedForSend.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
          background: T.title, borderTop: `1px solid rgba(255,255,255,0.1)`,
          padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontFamily: T.sans, fontSize: 14, color: T.white, fontWeight: 500 }}>
            ✓ {selectedForSend.size} empresa{selectedForSend.size !== 1 ? 's' : ''} seleccionada{selectedForSend.size !== 1 ? 's' : ''}
            <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 8 }}>
              · {totalSelectedContacts} contacto{totalSelectedContacts !== 1 ? 's' : ''}
            </span>
          </span>
          <button
            onClick={openWizard}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: T.emerald, color: T.white, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: T.sans,
            }}
          >Preparar envío para seleccionadas →</button>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* Send Wizard */}
      <SendWizard />
    </div>
  );
}
