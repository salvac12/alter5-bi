import { useState, useMemo, useEffect, useCallback } from 'react';
import { KPI } from './UI';
import { fetchCandidateTargets, upsertCandidateTarget } from '../utils/airtableCandidates';
import { fetchSentDomains } from '../utils/campaignApi';
import { getCurrentUser } from '../utils/userConfig';

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_CAMPAIGN_REF = 'Bridge_Q1';
const PAGE_SIZE = 50;

const STATUS_TABS = [
  { id: 'pending',  label: 'Pendientes' },
  { id: 'approved', label: 'Aprobadas' },
  { id: 'skipped',  label: 'Saltadas' },
  { id: 'rejected', label: 'Rechazadas' },
  { id: 'all',      label: 'Todas' },
];

const STATUS_COLORS = {
  approved: { color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  rejected: { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  skipped:  { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  pending:  { color: '#6B7F94', bg: '#F1F5F9', border: '#E2E8F0' },
};

// ── Helpers ─────────────────────────────────────────────────────────

function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { nombre: "", apellidos: "" };
  return { nombre: parts[0], apellidos: parts.slice(1).join(" ") };
}

function contactPriority(role) {
  const r = (role || "").toLowerCase().trim();
  if (/\bceo\b|\bcfo\b/.test(r)) return 1;
  if (r.includes("financiaci") && r.includes("estructurada")) return 2;
  if (/\bm&a\b|\bm\s*&\s*a\b/.test(r)) return 3;
  if (!r || r === "no identificado" || r === "nan") return 5;
  return 4;
}

function cleanRole(role) {
  const r = (role || "").trim();
  if (!r || r.toLowerCase() === "nan" || r.toLowerCase() === "no identificado") return "";
  return r;
}

function roleBadgeStyle(role) {
  const r = (role || "").toLowerCase();
  if (/\bceo\b|\bcfo\b/.test(r)) return { color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' };
  if (/\bdirector\b|\bhead\b|\bjefe\b|\bjefa\b/.test(r)) return { color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' };
  return { color: '#6B7F94', bg: '#F1F5F9', border: '#E2E8F0' };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isGenericName(name) {
  const n = (name || "").trim();
  if (n.length < 3) return true;
  if (!/\s/.test(n)) return true; // no space = probably not first+last
  const lower = n.toLowerCase();
  if (['info', 'admin', 'contact', 'no name', 'n/a', 'unknown'].some(g => lower.includes(g))) return true;
  return false;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

function normalizeName(name) {
  let n = (name || "").trim();
  if (!n) return n;
  // Detect ALL CAPS (2+ word chars all uppercase)
  if (n.length > 2 && n === n.toUpperCase() && /[A-Z]/.test(n)) {
    n = toTitleCase(n);
  }
  return n;
}

/** Dedup + validate + normalize contacts for a company */
function cleanContacts(contacts) {
  if (!contacts || !contacts.length) return [];
  const seen = new Set();
  const result = [];
  for (const ct of contacts) {
    if (!ct.email) continue;
    const emailLower = ct.email.toLowerCase().trim();
    if (seen.has(emailLower)) continue;
    if (!EMAIL_RE.test(emailLower)) continue;
    seen.add(emailLower);
    result.push({
      ...ct,
      email: emailLower,
      name: normalizeName(ct.name),
      _genericName: isGenericName(ct.name),
    });
  }
  return result;
}

// ── Component ───────────────────────────────────────────────────────

export default function CandidateSearchView({
  allCompanies,
  onCreateCampaign,
  campaignRef = DEFAULT_CAMPAIGN_REF,
  onRecipientsChange,
  embeddedMode = false,
}) {
  // Data state
  const [trackingDomains, setTrackingDomains] = useState(new Set());
  const [trackingOk, setTrackingOk] = useState(false); // true only if tracking loaded successfully with >0 domains
  const [savedTargets, setSavedTargets] = useState({});
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [trackingWarning, setTrackingWarning] = useState(false); // show warning banner
  const [trackingOverride, setTrackingOverride] = useState(false); // user manually acknowledged risk

  // Filters
  const [statusFilter, setStatusFilter] = useState('pending');
  const [segFilter, setSegFilter] = useState('todas');
  const [typeFilter, setTypeFilter] = useState('todos');
  const [techFilter, setTechFilter] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Selection & UI
  const [selectedContacts, setSelectedContacts] = useState({});
  const [selectedForSend, setSelectedForSend] = useState(new Set()); // domains selected for this batch
  const [expandedCompany, setExpandedCompany] = useState(null);
  const [page, setPage] = useState(0);
  const [showExportModal, setShowExportModal] = useState(false);
  const [saving, setSaving] = useState(null); // domain being saved
  const [toast, setToast] = useState(null);

  const currentUser = useMemo(() => getCurrentUser(), []);

  // ── Load data on mount ──
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoadingData(true);
    setLoadError(null);
    setTrackingWarning(false);
    setTrackingOverride(false);
    try {
      let domains = null;
      let trackingFailed = false;
      try {
        domains = await fetchSentDomains();
      } catch {
        trackingFailed = true;
      }

      const targets = await fetchCandidateTargets(campaignRef).catch(() => ({}));

      const domainSet = (domains instanceof Set && domains.size > 0) ? domains : new Set();
      setTrackingDomains(domainSet);
      setSavedTargets(targets || {});

      // Only warn if the API call itself failed (not if it returned 0 domains — that's normal initially)
      if (trackingFailed) {
        setTrackingWarning(true);
        setTrackingOk(false);
      } else {
        setTrackingOk(true);
      }
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoadingData(false);
    }
  }

  // ── Derive unique filter options from Originacion companies ──
  const originacionCompanies = useMemo(() => {
    return allCompanies.filter(c =>
      c.role === 'Originación' &&
      c.detail?.contacts?.some(ct => ct.email)
    );
  }, [allCompanies]);

  const filterOptions = useMemo(() => {
    const segments = new Map();
    const types = new Map();
    const techs = new Map();

    for (const c of originacionCompanies) {
      const isExcluded = c.domain && trackingDomains.has(c.domain?.toLowerCase());
      if (isExcluded) continue;
      if (c.segment) segments.set(c.segment, (segments.get(c.segment) || 0) + 1);
      if (c.companyType) types.set(c.companyType, (types.get(c.companyType) || 0) + 1);
      for (const t of (c.technologies || [])) {
        techs.set(t, (techs.get(t) || 0) + 1);
      }
    }

    return {
      segments: [...segments.entries()].sort((a, b) => b[1] - a[1]),
      types: [...types.entries()].sort((a, b) => b[1] - a[1]),
      techs: [...techs.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [originacionCompanies, trackingDomains]);

  // ── Filter candidates ──
  const candidates = useMemo(() => {
    return originacionCompanies.filter(c => {
      // Exclude already-sent domains
      if (c.domain && trackingDomains.has(c.domain.toLowerCase())) return false;
      // Segment filter
      if (segFilter !== 'todas' && c.segment !== segFilter) return false;
      // Type filter
      if (typeFilter !== 'todos' && c.companyType !== typeFilter) return false;
      // Tech filter (AND)
      if (techFilter.length > 0 && !techFilter.every(t => c.technologies?.includes(t))) return false;
      // Text search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !c.domain?.toLowerCase().includes(q)) return false;
      }
      // Status filter
      const status = savedTargets[c.domain?.toLowerCase()]?.status || 'pending';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      return true;
    });
  }, [originacionCompanies, trackingDomains, segFilter, typeFilter, techFilter, searchQuery, statusFilter, savedTargets]);

  const paginated = candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(candidates.length / PAGE_SIZE);

  // ── KPI stats ──
  const kpis = useMemo(() => {
    const available = originacionCompanies.filter(c => !trackingDomains.has(c.domain?.toLowerCase())).length;
    const contacted = originacionCompanies.filter(c => trackingDomains.has(c.domain?.toLowerCase())).length;
    let approvedCount = 0;
    let approvedContacts = 0;
    for (const [, t] of Object.entries(savedTargets)) {
      if (t.status === 'approved') {
        approvedCount++;
        approvedContacts += (t.selectedContacts || []).length;
      }
    }
    return { available, contacted, approvedCount, approvedContacts };
  }, [originacionCompanies, trackingDomains, savedTargets]);

  // ── Actions ──

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleAction(company, status) {
    const domain = company.domain?.toLowerCase();
    if (!domain) return;
    setSaving(domain);

    const existing = savedTargets[domain];
    const contacts = status === 'approved'
      ? getSelectedContactsForCompany(company)
      : (existing?.selectedContacts || []);

    try {
      const result = await upsertCandidateTarget({
        id: existing?.id || null,
        domain,
        companyName: company.name,
        status,
        selectedContacts: contacts,
        campaignRef: campaignRef,
        segment: company.segment || '',
        companyType: company.companyType || '',
        technologies: company.technologies || [],
        reviewedBy: currentUser?.name || '',
      });

      // Update local state
      setSavedTargets(prev => ({
        ...prev,
        [domain]: {
          ...prev[domain],
          id: result.id,
          domain,
          companyName: company.name,
          status,
          selectedContacts: contacts,
          campaignRef: campaignRef,
          segment: company.segment || '',
          companyType: company.companyType || '',
          reviewedBy: currentUser?.name || '',
          reviewedAt: new Date().toISOString().split('T')[0],
        },
      }));

      const labels = { approved: 'Aprobada', rejected: 'Rechazada', skipped: 'Saltada', pending: 'Deshecho' };
      showToast(`${company.name}: ${labels[status] || status}`);

      // Notify parent in embedded mode
      if (onRecipientsChange) {
        // Collect all approved recipients after this update
        const updatedTargets = { ...savedTargets, [domain]: { ...savedTargets[domain], status, selectedContacts: contacts } };
        const approvedRecipients = buildRecipientsFromTargets(updatedTargets);
        onRecipientsChange(approvedRecipients);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setSaving(null);
    }
  }

  function buildRecipientsFromTargets(targets) {
    const recipients = [];
    for (const [, target] of Object.entries(targets)) {
      if (target.status !== 'approved') continue;
      const cleaned = cleanContacts(target.selectedContacts || []);
      for (const ct of cleaned) {
        const normalized = normalizeName(ct.name);
        const { nombre, apellidos } = splitName(normalized);
        recipients.push({
          email: ct.email,
          name: nombre,
          lastName: apellidos,
          organization: target.companyName || '',
          role: cleanRole(ct.role),
        });
      }
    }
    return recipients;
  }

  function getSelectedContactsForCompany(company) {
    const domain = company.domain?.toLowerCase();
    const sel = selectedContacts[domain];
    const contacts = cleanContacts((company.detail?.contacts || []).filter(ct => ct.email));
    if (!sel) {
      return contacts.map(ct => ({ name: ct.name, email: ct.email, role: ct.role }));
    }
    return contacts
      .filter(ct => sel.has(ct.email))
      .map(ct => ({ name: ct.name, email: ct.email, role: ct.role }));
  }

  function toggleContact(domain, email) {
    const d = domain.toLowerCase();
    setSelectedContacts(prev => {
      const existing = prev[d];
      if (!existing) {
        // First toggle: find company, select all EXCEPT this one
        const company = originacionCompanies.find(c => c.domain?.toLowerCase() === d);
        const allEmails = (company?.detail?.contacts || []).filter(ct => ct.email).map(ct => ct.email);
        const newSet = new Set(allEmails);
        newSet.delete(email);
        return { ...prev, [d]: newSet };
      }
      const newSet = new Set(existing);
      if (newSet.has(email)) newSet.delete(email);
      else newSet.add(email);
      return { ...prev, [d]: newSet };
    });
  }

  function isContactSelected(domain, email) {
    const d = domain?.toLowerCase();
    const sel = selectedContacts[d];
    if (!sel) return true; // All selected by default
    return sel.has(email);
  }

  function toggleExpand(domain) {
    setExpandedCompany(prev => prev === domain ? null : domain);
  }

  // ── Send selection (buckets) ──

  function toggleSendSelection(domain) {
    setSelectedForSend(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  const approvedDomains = useMemo(() => {
    return Object.entries(savedTargets)
      .filter(([, t]) => t.status === 'approved')
      .map(([d]) => d);
  }, [savedTargets]);

  function selectAllApprovedVisible() {
    const visibleApproved = candidates
      .filter(c => (savedTargets[c.domain?.toLowerCase()]?.status) === 'approved')
      .map(c => c.domain?.toLowerCase());
    setSelectedForSend(prev => {
      const next = new Set(prev);
      for (const d of visibleApproved) next.add(d);
      return next;
    });
  }

  function deselectAll() {
    setSelectedForSend(new Set());
  }

  // ── CSV Export ──

  function generateCSV() {
    const rows = [];
    const domainsToExport = selectedForSend.size > 0 ? selectedForSend : null;
    for (const [domain, target] of Object.entries(savedTargets)) {
      if (target.status !== 'approved') continue;
      if (domainsToExport && !domainsToExport.has(domain)) continue;
      const company = originacionCompanies.find(c => c.domain?.toLowerCase() === domain);
      const cleaned = cleanContacts(target.selectedContacts || []);
      for (const ct of cleaned) {
        const normalized = normalizeName(ct.name);
        const { nombre, apellidos } = splitName(normalized);
        rows.push([
          ct.email || '',
          nombre,
          apellidos,
          target.companyName || company?.name || '',
          cleanRole(ct.role),
          target.segment || company?.segment || '',
          '', // LinkedIn
          '', // IA
          target.companyType || company?.companyType || '',
          '', // Desc
          '', // Score
          '', // Emails
          (company?.geography?.[0]) || '',
        ]);
      }
    }

    // Sort by priority (CEO/CFO first)
    rows.sort((a, b) => {
      const prioA = contactPriority(a[4]);
      const prioB = contactPriority(b[4]);
      return prioA - prioB;
    });

    const headers = ['Email', 'Nombre', 'Apellido', 'Organizacion', 'Cargo', 'Etiqueta', 'LinkedIn', 'IA', 'Tipo', 'Desc', 'Score', 'Emails', 'Pais'];
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `candidatas_${campaignRef}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportModal(false);
    showToast(`CSV descargado: ${rows.length} contactos`);
  }

  // ── Create Campaign from selected approved contacts ──
  function handleCreateCampaign() {
    const recipients = [];
    const domainsToExport = selectedForSend.size > 0 ? selectedForSend : null;
    for (const [domain, target] of Object.entries(savedTargets)) {
      if (target.status !== 'approved') continue;
      if (domainsToExport && !domainsToExport.has(domain)) continue;
      const company = originacionCompanies.find(c => c.domain?.toLowerCase() === domain);
      const cleaned = cleanContacts(target.selectedContacts || []);
      for (const ct of cleaned) {
        const normalized = normalizeName(ct.name);
        const { nombre, apellidos } = splitName(normalized);
        recipients.push({
          email: ct.email,
          name: nombre,
          lastName: apellidos,
          organization: target.companyName || company?.name || '',
          role: cleanRole(ct.role),
        });
      }
    }
    if (onCreateCampaign) onCreateCampaign(recipients);
  }

  // ── Export summary ── (counts for selected-for-send bucket, or all approved if none selected)
  const exportSummary = useMemo(() => {
    let companies = 0;
    let contacts = 0;
    const bySegment = {};
    const domainsToCount = selectedForSend.size > 0 ? selectedForSend : null;
    for (const [domain, t] of Object.entries(savedTargets)) {
      if (t.status !== 'approved') continue;
      if (domainsToCount && !domainsToCount.has(domain)) continue;
      companies++;
      const cleaned = cleanContacts(t.selectedContacts || []);
      const n = cleaned.length;
      contacts += n;
      const seg = t.segment || 'Sin segmento';
      bySegment[seg] = (bySegment[seg] || 0) + n;
    }
    return { companies, contacts, bySegment };
  }, [savedTargets, selectedForSend]);

  // Actions are blocked if tracking data failed to load and user hasn't overridden
  const actionsBlocked = trackingWarning && !trackingOverride;

  // ── Render ──

  if (loadingData) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '3px solid #E2E8F0', borderTopColor: '#7C3AED',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
          }} />
          <p style={{ fontSize: 13, color: '#6B7F94' }}>Cargando empresas candidatas...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{
        margin: 24, padding: 20, background: '#FEF2F2', border: '1px solid #FECACA',
        borderRadius: 10, color: '#DC2626', fontSize: 13,
      }}>
        Error: {loadError}
        <button onClick={loadData} style={{
          marginLeft: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #FECACA',
          background: '#FFFFFF', color: '#DC2626', fontSize: 12, cursor: 'pointer',
        }}>Reintentar</button>
      </div>
    );
  }

  return (
    <div style={{ maxHeight: embeddedMode ? 'none' : 'calc(100vh - 57px)', overflow: 'auto', position: 'relative' }}>
      {/* ── Header ── */}
      <div style={{ padding: embeddedMode ? '12px 0 0' : '20px 24px 0' }}>
        {!embeddedMode && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1A2B3D', letterSpacing: '-0.5px' }}>
              Buscar Empresas Candidatas
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6B7F94' }}>
              Empresas de Originacion sin contactar · Campana {campaignRef}
            </p>
          </div>
          {exportSummary.contacts > 0 && (
            <button
              onClick={() => !actionsBlocked && setShowExportModal(true)}
              disabled={actionsBlocked}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: actionsBlocked ? '#CBD5E1' : 'linear-gradient(135deg, #7C3AED, #3B82F6)',
                color: '#FFFFFF', fontSize: 13, fontWeight: 700,
                cursor: actionsBlocked ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                opacity: actionsBlocked ? 0.6 : 1,
              }}
              title={actionsBlocked ? 'Bloqueado: no se verificaron los dominios ya enviados' : ''}
            >
              Generar CSV ({exportSummary.contacts})
            </button>
          )}
        </div>
        )}

        {/* ── Embedded mode summary ── */}
        {embeddedMode && exportSummary.contacts > 0 && (
          <div style={{
            padding: '10px 14px', background: '#ECFDF5', borderRadius: 8,
            border: '1px solid #A7F3D0', marginBottom: 12, fontSize: 13, color: '#059669', fontWeight: 600,
          }}>
            {exportSummary.contacts} contactos de {exportSummary.companies} empresas seleccionados
          </div>
        )}

        {/* ── KPIs ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
          <KPI label="Disponibles" value={kpis.available} accent="#7C3AED" sub="empresas sin contactar" />
          <KPI label="Ya contactadas" value={kpis.contacted} accent="#6B7F94" sub="dominios en Tracking" />
          <KPI label="Aprobadas" value={kpis.approvedCount} accent="#059669" sub="empresas seleccionadas" />
          <KPI label="Contactos sel." value={kpis.approvedContacts} accent="#3B82F6" sub="para el CSV" />
        </div>

        {/* ── Tracking warning banner ── */}
        {trackingWarning && (
          <div style={{
            padding: '12px 16px', borderRadius: 8, marginBottom: 16,
            background: '#FEF2F2', border: '1px solid #FECACA',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>&#9888;</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', marginBottom: 4 }}>
                No se pudieron cargar los dominios ya enviados
              </div>
              <p style={{ fontSize: 12, color: '#991B1B', margin: '0 0 8px', lineHeight: 1.5 }}>
                La lista puede incluir empresas que ya recibieron la campana.
                Aprobar o exportar sin esta verificacion puede causar envios duplicados.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={loadData}
                  style={{
                    padding: '5px 14px', borderRadius: 6, border: '1px solid #FECACA',
                    background: '#FFFFFF', color: '#DC2626', fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Reintentar
                </button>
                {!trackingOverride && (
                  <button
                    onClick={() => setTrackingOverride(true)}
                    style={{
                      padding: '5px 14px', borderRadius: 6, border: '1px solid #E2E8F0',
                      background: '#FFFFFF', color: '#6B7F94', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Continuar bajo mi responsabilidad
                  </button>
                )}
                {trackingOverride && (
                  <span style={{ fontSize: 11, color: '#D97706', fontWeight: 600, alignSelf: 'center' }}>
                    Modo sin verificacion activo — revisa manualmente antes de enviar
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <div style={{ padding: '0 24px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 0, background: '#F1F5F9', borderRadius: 8, padding: 3, width: 'fit-content' }}>
          {STATUS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setStatusFilter(tab.id); setPage(0); }}
              style={{
                padding: '5px 14px', borderRadius: 6, border: 'none',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: statusFilter === tab.id ? '#FFFFFF' : 'transparent',
                color: statusFilter === tab.id ? '#1A2B3D' : '#6B7F94',
                boxShadow: statusFilter === tab.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Segment + Type + Tech + Search */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Segment */}
          <select
            value={segFilter}
            onChange={e => { setSegFilter(e.target.value); setPage(0); }}
            style={{
              padding: '6px 10px', borderRadius: 6, border: '1px solid #E2E8F0',
              fontSize: 12, color: '#1A2B3D', background: '#FFFFFF', fontFamily: 'inherit',
            }}
          >
            <option value="todas">Todos los segmentos</option>
            {filterOptions.segments.map(([seg, n]) => (
              <option key={seg} value={seg}>{seg} ({n})</option>
            ))}
          </select>

          {/* Type */}
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(0); }}
            style={{
              padding: '6px 10px', borderRadius: 6, border: '1px solid #E2E8F0',
              fontSize: 12, color: '#1A2B3D', background: '#FFFFFF', fontFamily: 'inherit',
            }}
          >
            <option value="todos">Todos los tipos</option>
            {filterOptions.types.map(([tp, n]) => (
              <option key={tp} value={tp}>{tp} ({n})</option>
            ))}
          </select>

          {/* Tech multi-select as chips */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {filterOptions.techs.slice(0, 8).map(([tech, n]) => {
              const active = techFilter.includes(tech);
              return (
                <button
                  key={tech}
                  onClick={() => {
                    setTechFilter(prev => active ? prev.filter(t => t !== tech) : [...prev, tech]);
                    setPage(0);
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 12, border: '1px solid',
                    borderColor: active ? '#7C3AED' : '#E2E8F0',
                    background: active ? '#F5F3FF' : '#FFFFFF',
                    color: active ? '#7C3AED' : '#6B7F94',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {tech} ({n})
                </button>
              );
            })}
          </div>

          {/* Search */}
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
            placeholder="Buscar empresa o dominio..."
            style={{
              padding: '6px 12px', borderRadius: 6, border: '1px solid #E2E8F0',
              fontSize: 12, color: '#1A2B3D', background: '#FFFFFF', fontFamily: 'inherit',
              width: 200, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* ── Count ── */}
      <div style={{ padding: '0 24px 8px', fontSize: 11, color: '#6B7F94', fontWeight: 500 }}>
        Mostrando {Math.min(page * PAGE_SIZE + 1, candidates.length)}-{Math.min((page + 1) * PAGE_SIZE, candidates.length)} de {candidates.length} empresas
      </div>

      {/* ── Company list ── */}
      <div style={{ padding: '0 24px 120px' }}>
        {paginated.length === 0 ? (
          <div style={{
            padding: 40, textAlign: 'center', color: '#6B7F94', fontSize: 13,
            background: '#FFFFFF', borderRadius: 10, border: '1px solid #E2E8F0',
          }}>
            No hay empresas con este filtro
          </div>
        ) : (
          paginated.map(company => {
            const domainKey = company.domain?.toLowerCase();
            return (
              <CompanyCard
                key={company.domain}
                company={company}
                savedTarget={savedTargets[domainKey]}
                expanded={expandedCompany === company.domain}
                onToggleExpand={() => toggleExpand(company.domain)}
                onAction={(status) => handleAction(company, status)}
                isContactSelected={(email) => isContactSelected(company.domain, email)}
                onToggleContact={(email) => toggleContact(company.domain, email)}
                isSaving={saving === domainKey}
                actionsBlocked={actionsBlocked}
                isSelectedForSend={selectedForSend.has(domainKey)}
                onToggleSendSelection={() => toggleSendSelection(domainKey)}
              />
            );
          })
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: '6px 16px', borderRadius: 6, border: '1px solid #E2E8F0',
                background: '#FFFFFF', color: page === 0 ? '#CBD5E1' : '#1A2B3D',
                fontSize: 12, fontWeight: 600, cursor: page === 0 ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Anterior
            </button>
            <span style={{ padding: '6px 0', fontSize: 12, color: '#6B7F94', fontWeight: 500 }}>
              Pagina {page + 1} de {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{
                padding: '6px 16px', borderRadius: 6, border: '1px solid #E2E8F0',
                background: '#FFFFFF', color: page >= totalPages - 1 ? '#CBD5E1' : '#1A2B3D',
                fontSize: 12, fontWeight: 600, cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Siguiente
            </button>
          </div>
        )}
      </div>

      {/* ── Sticky footer ── */}
      {kpis.approvedCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#FFFFFF', borderTop: '1px solid #E2E8F0',
          padding: '12px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', zIndex: 50,
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#1A2B3D', fontWeight: 600 }}>
              {kpis.approvedCount} aprobadas
              {selectedForSend.size > 0 && (
                <> · <span style={{ color: '#7C3AED' }}>{selectedForSend.size} seleccionadas</span></>
              )}
              {' '}({exportSummary.contacts} contactos)
            </span>
            <button
              onClick={selectAllApprovedVisible}
              style={{
                padding: '4px 10px', borderRadius: 5, border: '1px solid #E2E8F0',
                background: '#F7F9FC', color: '#6B7F94', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Seleccionar visibles
            </button>
            {selectedForSend.size > 0 && (
              <button
                onClick={deselectAll}
                style={{
                  padding: '4px 10px', borderRadius: 5, border: '1px solid #E2E8F0',
                  background: '#F7F9FC', color: '#6B7F94', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Deseleccionar
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {onCreateCampaign && (
              <button
                onClick={() => !actionsBlocked && handleCreateCampaign()}
                disabled={actionsBlocked || exportSummary.contacts === 0}
                style={{
                  padding: '8px 24px', borderRadius: 8, border: 'none',
                  background: (actionsBlocked || exportSummary.contacts === 0) ? '#CBD5E1' : 'linear-gradient(135deg, #7C3AED, #6366F1)',
                  color: '#FFFFFF', fontSize: 13, fontWeight: 700,
                  cursor: (actionsBlocked || exportSummary.contacts === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  opacity: (actionsBlocked || exportSummary.contacts === 0) ? 0.6 : 1,
                }}
              >
                Crear Campaña ({exportSummary.contacts})
              </button>
            )}
            <button
              onClick={() => !actionsBlocked && exportSummary.contacts > 0 && setShowExportModal(true)}
              disabled={actionsBlocked || exportSummary.contacts === 0}
              style={{
                padding: '8px 24px', borderRadius: 8,
                border: (actionsBlocked || exportSummary.contacts === 0) ? 'none' : '1px solid #E2E8F0',
                background: (actionsBlocked || exportSummary.contacts === 0) ? '#CBD5E1' : '#FFFFFF',
                color: (actionsBlocked || exportSummary.contacts === 0) ? '#FFFFFF' : '#334155', fontSize: 13, fontWeight: 700,
                cursor: (actionsBlocked || exportSummary.contacts === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                opacity: (actionsBlocked || exportSummary.contacts === 0) ? 0.6 : 1,
              }}
            >
              {actionsBlocked ? 'Verificacion pendiente' : 'Generar CSV'}
            </button>
          </div>
        </div>
      )}

      {/* ── Export modal ── */}
      {showExportModal && (
        <>
          <div onClick={() => setShowExportModal(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 100 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#FFFFFF', borderRadius: 12, padding: 24, zIndex: 101,
            width: 400, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800, color: '#1A2B3D' }}>
              Exportar CSV
            </h3>
            <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}>
                <strong>{exportSummary.contacts}</strong> contactos de <strong>{exportSummary.companies}</strong> empresas
              </p>
              <div style={{ margin: '8px 0', padding: '10px 12px', background: '#F7F9FC', borderRadius: 8 }}>
                {Object.entries(exportSummary.bySegment).map(([seg, n]) => (
                  <div key={seg} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                    <span style={{ color: '#6B7F94' }}>{seg}</span>
                    <span style={{ fontWeight: 700, color: '#1A2B3D' }}>{n}</span>
                  </div>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 11, color: '#6B7F94' }}>
                Formato: 13 columnas compatibles con el Gestor de Campanas
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setShowExportModal(false)}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: '1px solid #E2E8F0',
                  background: '#FFFFFF', color: '#6B7F94', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={generateCSV}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  background: 'linear-gradient(135deg, #7C3AED, #3B82F6)',
                  color: '#FFFFFF', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Descargar CSV ({exportSummary.contacts})
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, right: 24, zIndex: 200,
          background: '#1A2B3D', color: '#FFFFFF', padding: '10px 20px',
          borderRadius: 8, fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          animation: 'slideUp 0.2s ease',
        }}>
          {toast}
          <style>{`@keyframes slideUp { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
        </div>
      )}
    </div>
  );
}

// ── CompanyCard sub-component ───────────────────────────────────────

function CompanyCard({
  company, savedTarget, expanded, onToggleExpand,
  onAction, isContactSelected, onToggleContact, isSaving, actionsBlocked,
  isSelectedForSend, onToggleSendSelection,
}) {
  const [hover, setHover] = useState(false);
  const status = savedTarget?.status || 'pending';
  const contacts = cleanContacts((company.detail?.contacts || []).filter(ct => ct.email));
  const sc = STATUS_COLORS[status] || STATUS_COLORS.pending;

  // Approved compact view
  if (status === 'approved' && !expanded) {
    return (
      <div
        style={{
          padding: '10px 16px', marginBottom: 6, borderRadius: 8,
          border: `1px solid ${isSelectedForSend ? '#7C3AED' : sc.border}`,
          background: isSelectedForSend ? '#F5F3FF' : sc.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={onToggleExpand}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={!!isSelectedForSend}
            onChange={(e) => { e.stopPropagation(); onToggleSendSelection(); }}
            onClick={(e) => e.stopPropagation()}
            style={{ accentColor: '#7C3AED', cursor: 'pointer' }}
            title="Incluir en este envio"
          />
          <span style={{ color: '#059669', fontSize: 14 }}>&#10003;</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>{company.name}</span>
          <span style={{ fontSize: 11, color: '#6B7F94' }}>
            · {contacts.length} contactos
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          style={{
            padding: '3px 10px', borderRadius: 6, border: '1px solid #A7F3D0',
            background: '#FFFFFF', color: '#059669', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Editar
        </button>
      </div>
    );
  }

  // Rejected compact view
  if (status === 'rejected' && !expanded) {
    return (
      <div style={{
        padding: '10px 16px', marginBottom: 6, borderRadius: 8,
        border: '1px solid #F1F5F9', background: '#FAFBFC',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        opacity: 0.6,
      }}>
        <span style={{ fontSize: 13, color: '#94A3B8', textDecoration: 'line-through' }}>{company.name}</span>
        <button
          onClick={() => onAction('pending')}
          disabled={isSaving}
          style={{
            padding: '3px 10px', borderRadius: 6, border: '1px solid #E2E8F0',
            background: '#FFFFFF', color: '#6B7F94', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Deshacer
        </button>
      </div>
    );
  }

  // Skipped compact view
  if (status === 'skipped' && !expanded) {
    return (
      <div style={{
        padding: '10px 16px', marginBottom: 6, borderRadius: 8,
        border: '1px solid #F1F5F9', background: '#FAFBFC',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        opacity: 0.5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#94A3B8' }}>{company.name}</span>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4,
            background: '#FFFBEB', color: '#D97706', fontWeight: 600,
          }}>Saltada</span>
        </div>
        <button
          onClick={() => onAction('pending')}
          disabled={isSaving}
          style={{
            padding: '3px 10px', borderRadius: 6, border: '1px solid #E2E8F0',
            background: '#FFFFFF', color: '#6B7F94', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Deshacer
        </button>
      </div>
    );
  }

  // Full card (pending or expanded)
  return (
    <div
      style={{
        marginBottom: 8, borderRadius: 10,
        border: `1px solid ${hover ? '#CBD5E1' : '#E2E8F0'}`,
        background: '#FFFFFF',
        transition: 'all 0.15s ease',
        boxShadow: hover ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', cursor: 'pointer',
        }}
        onClick={onToggleExpand}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1A2B3D' }}>{company.name}</span>
            {company.domain && (
              <span style={{ fontSize: 11, color: '#94A3B8' }}>{company.domain}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {company.segment && (
              <Badge text={company.segment} color="#6B21A8" bg="#F5F3FF" />
            )}
            {company.companyType && (
              <Badge text={company.companyType} color="#1E40AF" bg="#EFF6FF" />
            )}
            {(company.technologies || []).map(t => (
              <Badge key={t} text={t} color="#047857" bg="#ECFDF5" />
            ))}
            <span style={{ fontSize: 11, color: '#6B7F94', marginLeft: 4, alignSelf: 'center' }}>
              {contacts.length} contacto{contacts.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
          <ActionBtn label="Aprobar" color="#059669" bg="#ECFDF5" border="#A7F3D0"
            onClick={() => onAction('approved')} disabled={isSaving || actionsBlocked} />
          <ActionBtn label="Saltar" color="#D97706" bg="#FFFBEB" border="#FDE68A"
            onClick={() => onAction('skipped')} disabled={isSaving || actionsBlocked} />
          <ActionBtn label="Rechazar" color="#DC2626" bg="#FEF2F2" border="#FECACA"
            onClick={() => onAction('rejected')} disabled={isSaving || actionsBlocked} />
        </div>
      </div>

      {/* Expanded: contacts list */}
      {expanded && contacts.length > 0 && (
        <div style={{
          borderTop: '1px solid #F1F5F9', padding: '8px 16px 12px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7F94', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Contactos ({contacts.length})
          </div>
          {[...contacts].sort((a, b) => contactPriority(a.role) - contactPriority(b.role)).map(ct => {
            const selected = isContactSelected(ct.email);
            const role = cleanRole(ct.role);
            const badge = role ? roleBadgeStyle(role) : null;
            return (
              <label
                key={ct.email}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
                  background: selected ? '#F7F9FC' : 'transparent',
                  marginBottom: 2,
                  opacity: ct._genericName ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleContact(ct.email)}
                  style={{ accentColor: '#7C3AED' }}
                />
                <span style={{
                  fontSize: 13, fontWeight: 600, color: '#1A2B3D', minWidth: 140,
                  fontStyle: ct._genericName ? 'italic' : 'normal',
                }}>
                  {ct.name}
                </span>
                {badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4,
                    background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                    whiteSpace: 'nowrap',
                  }}>
                    {role}
                  </span>
                )}
                <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 'auto' }}>{ct.email}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tiny sub-components ─────────────────────────────────────────────

function Badge({ text, color, bg }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
      background: bg, color,
    }}>
      {text}
    </span>
  );
}

function ActionBtn({ label, color, bg, border, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 12px', borderRadius: 6, border: `1px solid ${border}`,
        background: bg, color, fontSize: 11, fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
