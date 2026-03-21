import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Pause, Play, Edit2, Copy, Mail,
  TrendingUp, MousePointer, MessageSquare, Eye, Users, Clock,
} from 'lucide-react';
import { KPI } from './UI';
import {
  getCampaign, getConversation, sendDraft, saveDraft, composeFromInstructions,
  classifyReply, getFollowUps, generateFollowUpBatch, sendFollowUpBatch,
} from '../utils/campaignApi';

// ── Design tokens ────────────────────────────────────────────────
const COLORS = {
  bg: '#F0F4F8',
  card: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0F172A',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  accent: '#3B82F6',
  green: '#10B981',
  purple: '#8B5CF6',
  orange: '#F97316',
  yellow: '#F59E0B',
  red: '#EF4444',
  dark: '#1E293B',
};

const RADIUS = { sm: 6, md: 10, lg: 14 };

const FONT = "'DM Sans', sans-serif";

const CARD_SHADOW = '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)';

// ── Proxy helper for GAS GET endpoints ───────────────────────────
async function proxyFetch(action, params = {}) {
  const secret = import.meta.env.VITE_CAMPAIGN_PROXY_SECRET || '';
  const res = await fetch('/api/campaign-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-proxy-secret': secret },
    body: JSON.stringify({ action, ...params }),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(`Campaign proxy returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || data.error) throw new Error(data.error || `Proxy error ${res.status}`);
  return data;
}

// ── Constants ─────────────────────────────────────────────────────
const SUB_TABS = [
  { id: 'resumen', label: 'Resumen', icon: TrendingUp },
  { id: 'contactos', label: 'Contactos', icon: Users },
  { id: 'respuestas', label: 'Respuestas', icon: MessageSquare },
  { id: 'seguimiento', label: 'Seguimiento', icon: Clock },
];

const ESTADO_MAP = {
  'enviado': 'sent',
  'abierto': 'opened',
  'clic': 'clicked',
  'respondido': 'replied',
  'error': 'error',
};

const CONTACT_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'sent', label: 'Enviado' },
  { id: 'opened', label: 'Abierto' },
  { id: 'clicked', label: 'Clic' },
  { id: 'replied', label: 'Respondido' },
  { id: 'pending', label: 'Pendiente' },
  { id: 'error', label: 'Error' },
];

// Normalize GAS contact to a consistent shape
function normalizeContact(c) {
  const estado = (c.estado || '').toLowerCase();
  const normalStatus = ESTADO_MAP[estado] || (estado ? estado : 'pending');
  const isReplied = normalStatus === 'replied' || c.respondido === 'Si' || c.respondido === 'S\u00ed';
  return {
    email: c.email || '',
    nombre: [c.nombre, c.apellido].filter(Boolean).join(' ') || '',
    organizacion: c.organizacion || '',
    grupo: c.grupo || '',
    variante: c.variante || '',
    status: isReplied ? 'replied' : normalStatus,
    fechaEnvio: c.fechaEnvio || null,
    primeraApertura: c.primeraApertura || null,
    numAperturas: c.numAperturas || 0,
    primerClic: c.primerClic || null,
    numClics: c.numClics || 0,
    respondido: isReplied,
    respuestaEnviada: c.respuestaEnviada || '',
    seguimientosEnviados: c.seguimientosEnviados || 0,
    ultimoSeguimiento: c.ultimoSeguimiento || null,
  };
}

// ── Tab content animation ─────────────────────────────────────────
const tabMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: 'easeOut' },
};

// ── Helper: badge count for each tab ──────────────────────────────
function getTabBadge(tabId, contactos) {
  if (tabId === 'contactos') return contactos.length || null;
  if (tabId === 'respuestas') {
    const replied = contactos.filter(c => c.respondido).length;
    return replied > 0 ? replied : null;
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────
export default function CampaignDetailView({ campaignId, onBack }) {
  const [subTab, setSubTab] = useState('resumen');
  const [campaign, setCampaign] = useState(null);
  const [contactos, setContactos] = useState([]);
  const [metricas, setMetricas] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadData(); }, [campaignId]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      // Load campaign from Airtable + dashboard from GAS Tracking sheet
      const [campData, dashData] = await Promise.all([
        getCampaign(campaignId),
        proxyFetch('dashboard').catch(() => null),
      ]);
      setCampaign(campData.campaign || campData);

      if (dashData) {
        const rawContactos = (dashData.contactos || []).map(normalizeContact);
        setContactos(rawContactos);
        setMetricas(dashData.metricas || null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400, fontFamily: FONT }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: `3px solid ${COLORS.border}`, borderTopColor: COLORS.accent,
            animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
          }} />
          <p style={{ fontSize: 13, color: COLORS.textMuted }}>Cargando campana...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ margin: 24, padding: 20, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: RADIUS.md, color: '#DC2626', fontSize: 13, fontFamily: FONT }}>
        Error: {error}
        <button onClick={loadData} style={{ marginLeft: 12, padding: '4px 12px', borderRadius: RADIUS.sm, border: '1px solid #DC2626', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontFamily: FONT }}>Reintentar</button>
      </div>
    );
  }

  const isActive = campaign?.status === 'active' || campaign?.status === 'sending';
  const statusColor = isActive ? COLORS.green : COLORS.orange;
  const statusLabel = isActive ? 'Activa' : (campaign?.status || 'Borrador');

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto', fontFamily: FONT }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        {/* Back link */}
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: 0, border: 'none', background: 'transparent',
            color: COLORS.textSecondary, fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: FONT, marginBottom: 12,
          }}
        >
          <ArrowLeft size={15} />
          Volver a Campanas
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            {/* Campaign name + status badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h2 style={{
                margin: 0, fontSize: 20, fontWeight: 600,
                color: COLORS.text, letterSpacing: '-0.02em',
              }}>
                {campaign?.name || 'Campana'}
              </h2>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 20,
                background: `${statusColor}14`, fontSize: 11, fontWeight: 600,
                color: statusColor,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: statusColor,
                }} />
                {statusLabel}
              </span>
            </div>

            {/* Subtitle */}
            <p style={{ margin: 0, fontSize: 13, color: COLORS.textSecondary }}>
              {campaign?.type === 'mass' ? 'Campana Masiva' : 'Campana Puntual'}
              {campaign?.senderName ? ` \u00b7 ${campaign.senderName}` : ''}
              {campaign?.createdTime ? ` \u00b7 Del ${new Date(campaign.createdTime).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
              {contactos.length > 0 ? ` \u00b7 ${contactos.length} contactos` : ''}
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '7px 14px', borderRadius: 8,
              border: `1px solid ${COLORS.border}`, background: COLORS.card,
              color: COLORS.textSecondary, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: FONT,
            }}>
              {isActive ? <Pause size={14} /> : <Play size={14} />}
              {isActive ? 'Pausar' : 'Reanudar'}
            </button>
            <button style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '7px 14px', borderRadius: 8,
              border: `1px solid ${COLORS.border}`, background: COLORS.card,
              color: COLORS.textSecondary, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: FONT,
            }}>
              <Edit2 size={14} />
              Editar
            </button>
            <button style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '7px 10px', borderRadius: 8,
              border: `1px solid ${COLORS.border}`, background: COLORS.card,
              color: COLORS.textSecondary, cursor: 'pointer',
            }}>
              <Copy size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Tab bar (Figma design) ── */}
      <div style={{
        display: 'flex', gap: 6, padding: 4, marginBottom: 24,
        background: COLORS.card, borderRadius: 10,
        border: `1px solid ${COLORS.border}`,
      }}>
        {SUB_TABS.map(t => {
          const isActive = subTab === t.id;
          const Icon = t.icon;
          const badge = getTabBadge(t.id, contactos);
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                fontSize: 13, fontWeight: isActive ? 600 : 500,
                cursor: 'pointer', fontFamily: FONT,
                transition: 'all 0.15s ease',
                background: isActive ? COLORS.dark : 'transparent',
                color: isActive ? '#FFFFFF' : COLORS.textSecondary,
              }}
            >
              <Icon size={15} />
              {t.label}
              {badge != null && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 18, height: 18, borderRadius: 9,
                  padding: '0 5px', fontSize: 10, fontWeight: 700,
                  background: COLORS.orange, color: '#FFFFFF',
                  lineHeight: 1,
                }}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Sub-tab content with AnimatePresence ── */}
      <AnimatePresence mode="wait">
        {subTab === 'resumen' && (
          <motion.div key="resumen" {...tabMotion}>
            <TabResumen campaign={campaign} metricas={metricas} contactos={contactos} />
          </motion.div>
        )}
        {subTab === 'contactos' && (
          <motion.div key="contactos" {...tabMotion}>
            <TabContactos contactos={contactos} />
          </motion.div>
        )}
        {subTab === 'respuestas' && (
          <motion.div key="respuestas" {...tabMotion}>
            <TabRespuestas contactos={contactos} campaign={campaign} campaignId={campaignId} />
          </motion.div>
        )}
        {subTab === 'seguimiento' && (
          <motion.div key="seguimiento" {...tabMotion}>
            <TabSeguimiento campaign={campaign} campaignId={campaignId} contactos={contactos} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ======================================================================
// Sub-tab: Resumen
// ======================================================================
function TabResumen({ campaign, metricas, contactos }) {
  // Use GAS metricas if available, otherwise compute from contacts
  const g = metricas?.Global || {};
  const totalContacts = metricas?.total || contactos.length;
  const totalSent = g.enviados || contactos.filter(c => c.status !== 'pending').length;
  const totalOpened = g.abiertos || contactos.filter(c => ['opened', 'clicked', 'replied'].includes(c.status)).length;
  const totalClicked = g.clics || contactos.filter(c => c.status === 'clicked').length;
  const totalReplied = g.respondidos || contactos.filter(c => c.respondido).length;
  const totalErrors = metricas?.errores || contactos.filter(c => c.status === 'error').length;

  const pct = (n) => totalSent > 0 ? ((n / totalSent) * 100).toFixed(1) + '%' : '\u2014';

  const kpis = [
    { label: 'Enviados', value: totalSent, sub: `de ${totalContacts}`, accent: COLORS.accent, icon: Mail },
    { label: 'Abiertos', value: totalOpened, sub: pct(totalOpened), accent: COLORS.orange, icon: Eye },
    { label: 'Con clic', value: totalClicked, sub: pct(totalClicked), accent: COLORS.purple, icon: MousePointer },
    { label: 'Respondidos', value: totalReplied, sub: pct(totalReplied), accent: COLORS.green, icon: MessageSquare },
  ];

  const funnel = [
    { label: 'Total contactos', value: totalContacts, color: '#64748B' },
    { label: 'Enviados', value: totalSent, color: COLORS.accent },
    { label: 'Abiertos', value: totalOpened, color: COLORS.green },
    { label: 'Clics', value: totalClicked, color: COLORS.yellow },
    { label: 'Respondidos', value: totalReplied, color: COLORS.purple },
  ];
  const maxVal = Math.max(totalContacts, 1);

  // A/B variants from metricas
  const varA = metricas?.A;
  const varB = metricas?.B;
  const varFinal = metricas?.Final;
  const hasAB = varA && varB && (varA.enviados > 0 || varB.enviados > 0);

  return (
    <div>
      {/* KPI cards with colored top border + icon */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} style={{
              background: COLORS.card, borderRadius: 12,
              borderTop: `3px solid ${k.accent}`,
              padding: '16px 18px',
              boxShadow: CARD_SHADOW,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: COLORS.textSecondary,
                  textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: FONT,
                }}>{k.label}</span>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: `${k.accent}14`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={16} color={k.accent} />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 600, color: COLORS.text, fontFamily: FONT, lineHeight: 1 }}>
                {k.value}
              </div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 4 }}>{k.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Funnel */}
      <div style={{ padding: 20, background: COLORS.card, borderRadius: 12, boxShadow: CARD_SHADOW, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: COLORS.text, fontFamily: FONT }}>Embudo de conversion</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {funnel.map(f => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 110, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right', fontFamily: FONT }}>{f.label}</span>
              <div style={{ flex: 1, height: 28, background: COLORS.bg, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
                <div style={{
                  width: `${(f.value / maxVal) * 100}%`,
                  height: '100%', background: f.color, borderRadius: RADIUS.sm,
                  transition: 'width 0.4s ease',
                  minWidth: f.value > 0 ? 2 : 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
                }}>
                  {f.value > 0 && (f.value / maxVal) > 0.15 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF' }}>{f.value}</span>
                  )}
                </div>
              </div>
              <span style={{ width: 50, fontSize: 13, fontWeight: 700, color: COLORS.text, fontFamily: FONT }}>{f.value}</span>
            </div>
          ))}
        </div>
        {totalErrors > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#DC2626' }}>Errores: {totalErrors}</div>
        )}
      </div>

      {/* A/B Test comparison */}
      {hasAB && (
        <div style={{ padding: 20, background: COLORS.card, borderRadius: 12, boxShadow: CARD_SHADOW, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: COLORS.text, fontFamily: FONT }}>Test A/B</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ABColumn label="A" subject={campaign?.subjectA} data={varA} color={COLORS.accent} />
            <ABColumn label="B" subject={campaign?.subjectB} data={varB} color={COLORS.yellow} />
          </div>
          {varFinal && varFinal.total > 0 && (
            <div style={{ marginTop: 16, padding: 14, background: COLORS.bg, borderRadius: 8, border: `1px solid ${COLORS.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.text, marginBottom: 8, fontFamily: FONT }}>Grupo Final</div>
              <div style={{ display: 'flex', gap: 20, fontSize: 12, color: COLORS.textSecondary, fontFamily: FONT }}>
                <span>Total: <strong style={{ color: COLORS.text }}>{varFinal.total}</strong></span>
                <span>Enviados: <strong style={{ color: COLORS.text }}>{varFinal.enviados}</strong></span>
                <span>Pendientes: <strong style={{ color: '#D97706' }}>{varFinal.pendientes}</strong></span>
                <span>Abiertos: <strong style={{ color: COLORS.green }}>{varFinal.abiertos}</strong></span>
                <span>Clics: <strong style={{ color: COLORS.yellow }}>{varFinal.clics}</strong></span>
                <span>Respondidos: <strong style={{ color: COLORS.purple }}>{varFinal.respondidos}</strong></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Campaign info */}
      <div style={{ padding: 20, background: COLORS.card, borderRadius: 12, boxShadow: CARD_SHADOW }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: COLORS.text, fontFamily: FONT }}>Informacion</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
          <InfoRow label="Remitente" value={campaign?.senderName || '\u2014'} />
          <InfoRow label="Tipo" value={campaign?.type === 'mass' ? 'Masiva' : '1-a-1'} />
          <InfoRow label="Fecha" value={campaign?.createdTime ? new Date(campaign.createdTime).toLocaleDateString('es-ES') : '\u2014'} />
          <InfoRow label="Estado" value={campaign?.status || '\u2014'} />
          <InfoRow label="Test A/B" value={campaign?.subjectB ? `${campaign.abTestPercent || 50}% test` : 'No'} />
          {campaign?.abWinner && <InfoRow label="Ganador A/B" value={`Variante ${campaign.abWinner}`} />}
        </div>
      </div>
    </div>
  );
}

function ABColumn({ label, subject, data = {}, color }) {
  const pct = (n) => data.enviados > 0 ? ((n / data.enviados) * 100).toFixed(1) + '%' : '\u2014';

  return (
    <div style={{ padding: 14, background: COLORS.bg, borderRadius: 8, border: `2px solid ${color}20` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color, fontFamily: FONT }}>Variante {label}</span>
      </div>
      {subject && (
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, marginBottom: 10, lineHeight: 1.4, fontFamily: FONT }}>
          {subject}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <div>
          <span style={{ color: COLORS.textSecondary }}>Enviados</span>
          <div style={{ fontWeight: 700, color: COLORS.text }}>{data.enviados || 0}</div>
        </div>
        <div>
          <span style={{ color: COLORS.textSecondary }}>Aperturas</span>
          <div style={{ fontWeight: 700, color: COLORS.green }}>{data.abiertos || 0} ({pct(data.abiertos)})</div>
        </div>
        <div>
          <span style={{ color: COLORS.textSecondary }}>Clics</span>
          <div style={{ fontWeight: 700, color: COLORS.yellow }}>{data.clics || 0} ({pct(data.clics)})</div>
        </div>
        <div>
          <span style={{ color: COLORS.textSecondary }}>Respondidos</span>
          <div style={{ fontWeight: 700, color: COLORS.purple }}>{data.respondidos || 0} ({pct(data.respondidos)})</div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: FONT }}>
        {label}
      </span>
      <div style={{ fontSize: 13, color: COLORS.text, marginTop: 2, fontFamily: FONT }}>{value}</div>
    </div>
  );
}

// ======================================================================
// Sub-tab: Contactos
// ======================================================================
function TabContactos({ contactos }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [sortBy, setSortBy] = useState(null);

  const filtered = useMemo(() => {
    let list = [...contactos];
    if (filter !== 'all') {
      list = list.filter(c => c.status === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.email.toLowerCase().includes(q) ||
        c.nombre.toLowerCase().includes(q) ||
        c.organizacion.toLowerCase().includes(q)
      );
    }
    // Sort: by organizacion by default, group contacts by company
    list.sort((a, b) => {
      if (sortBy === 'opens') return (b.numAperturas || 0) - (a.numAperturas || 0);
      if (sortBy === 'clicks') return (b.numClics || 0) - (a.numClics || 0);
      return (a.organizacion || '').localeCompare(b.organizacion || '');
    });
    return list;
  }, [contactos, filter, search, sortBy]);

  // Count per status
  const counts = useMemo(() => {
    const c = {};
    CONTACT_FILTERS.forEach(f => {
      c[f.id] = f.id === 'all' ? contactos.length : contactos.filter(ct => ct.status === f.id).length;
    });
    return c;
  }, [contactos]);

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {CONTACT_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '5px 14px', borderRadius: 20, border: 'none',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
              background: filter === f.id ? COLORS.dark : COLORS.bg,
              color: filter === f.id ? '#FFFFFF' : COLORS.textSecondary,
              transition: 'all 0.15s',
            }}
          >{f.label} ({counts[f.id] || 0})</button>
        ))}
        <input
          type="text" placeholder="Buscar nombre/email/empresa..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto', padding: '6px 14px', borderRadius: 8,
            border: `1px solid ${COLORS.border}`, fontSize: 12, fontFamily: FONT,
            width: 220, outline: 'none', background: COLORS.card,
          }}
        />
      </div>

      <div style={{ marginBottom: 8, fontSize: 11, color: COLORS.textSecondary, fontFamily: FONT }}>
        Mostrando {filtered.length} de {contactos.length} contactos
      </div>

      {/* Table */}
      <div style={{ background: COLORS.card, borderRadius: 12, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 70px 80px 65px 65px 90px',
          padding: '10px 16px', background: '#FAFAFA', borderBottom: `1px solid ${COLORS.border}`,
          fontSize: 10, fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase',
          letterSpacing: '0.08em', fontFamily: FONT,
        }}>
          <span>Email</span>
          <span>Nombre</span>
          <span>Empresa</span>
          <span>Variante</span>
          <span>Estado</span>
          <span style={{ cursor: 'pointer' }} onClick={() => setSortBy(sortBy === 'opens' ? null : 'opens')}>
            Apert. {sortBy === 'opens' ? '\u25BC' : ''}
          </span>
          <span style={{ cursor: 'pointer' }} onClick={() => setSortBy(sortBy === 'clicks' ? null : 'clicks')}>
            Clics {sortBy === 'clicks' ? '\u25BC' : ''}
          </span>
          <span>Fecha envio</span>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: COLORS.textSecondary, fontSize: 13, fontFamily: FONT }}>Sin contactos</div>
        ) : filtered.map((c, i) => (
          <div key={c.email || i}>
            <div
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{
                display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 70px 80px 65px 65px 90px',
                padding: '10px 16px', borderBottom: '1px solid #F1F5F9',
                fontSize: 12, color: '#334155', cursor: 'pointer', fontFamily: FONT,
                background: expanded === i ? '#F8FAFC' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (expanded !== i) e.currentTarget.style.background = '#FAFAFA'; }}
              onMouseLeave={e => { if (expanded !== i) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre || '\u2014'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.organizacion || '\u2014'}</span>
              <span>
                {c.variante ? (
                  <span style={{
                    padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: c.variante === 'A' ? '#EFF6FF' : c.variante === 'B' ? '#FFFBEB' : '#F1F5F9',
                    color: c.variante === 'A' ? COLORS.accent : c.variante === 'B' ? '#D97706' : COLORS.textSecondary,
                  }}>{c.variante}</span>
                ) : '\u2014'}
              </span>
              <StatusBadge status={c.status} />
              <span style={{ fontWeight: c.numAperturas > 0 ? 700 : 400 }}>{c.numAperturas || 0}</span>
              <span style={{ fontWeight: c.numClics > 0 ? 700 : 400 }}>{c.numClics || 0}</span>
              <span style={{ fontSize: 11, color: COLORS.textSecondary }}>
                {c.fechaEnvio ? new Date(c.fechaEnvio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '\u2014'}
              </span>
            </div>

            {/* Expanded: tracking timeline */}
            {expanded === i && (
              <div style={{ padding: '12px 16px 12px 28px', background: '#F8FAFC', borderBottom: `1px solid ${COLORS.border}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 12, fontFamily: FONT }}>
                  {c.fechaEnvio && (
                    <div>
                      <span style={{ color: COLORS.textSecondary }}>Enviado: </span>
                      <span style={{ color: COLORS.text }}>{new Date(c.fechaEnvio).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  {c.primeraApertura && (
                    <div>
                      <span style={{ color: COLORS.textSecondary }}>Primera apertura: </span>
                      <span style={{ color: COLORS.green }}>{new Date(c.primeraApertura).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  {c.primerClic && (
                    <div>
                      <span style={{ color: COLORS.textSecondary }}>Primer clic: </span>
                      <span style={{ color: COLORS.yellow }}>{new Date(c.primerClic).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  <div>
                    <span style={{ color: COLORS.textSecondary }}>Aperturas totales: </span>
                    <span style={{ fontWeight: 700, color: COLORS.text }}>{c.numAperturas}</span>
                  </div>
                  <div>
                    <span style={{ color: COLORS.textSecondary }}>Clics totales: </span>
                    <span style={{ fontWeight: 700, color: COLORS.text }}>{c.numClics}</span>
                  </div>
                  <div>
                    <span style={{ color: COLORS.textSecondary }}>Grupo: </span>
                    <span style={{ color: COLORS.text }}>{c.grupo || 'N/A'}</span>
                  </div>
                  {c.respondido && (
                    <div>
                      <span style={{ color: COLORS.purple, fontWeight: 700 }}>Ha respondido</span>
                      {c.respuestaEnviada === 'Si' && <span style={{ marginLeft: 8, color: COLORS.green, fontWeight: 600 }}>Resp. enviada</span>}
                    </div>
                  )}
                  {c.seguimientosEnviados > 0 && (
                    <div>
                      <span style={{ color: COLORS.textSecondary }}>Follow-ups: </span>
                      <span style={{ fontWeight: 700, color: '#7C3AED' }}>{c.seguimientosEnviados}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    sent: { label: 'Enviado', bg: '#ECFDF5', color: '#059669' },
    opened: { label: 'Abierto', bg: '#ECFDF5', color: '#059669' },
    clicked: { label: 'Clic', bg: '#F5F3FF', color: '#7C3AED' },
    replied: { label: 'Respondido', bg: '#FFF7ED', color: '#EA580C' },
    error: { label: 'Error', bg: '#FEF2F2', color: '#DC2626' },
    pending: { label: 'Pendiente', bg: '#F1F5F9', color: '#CBD5E1' },
  };
  const c = config[status] || config.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
      background: c.bg, color: c.color, fontFamily: FONT,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.color }} />
      {c.label}
    </span>
  );
}

// ======================================================================
// Sub-tab: Respuestas (Agente IA)
// ======================================================================
function TabRespuestas({ contactos, campaign, campaignId }) {
  const [viewFilter, setViewFilter] = useState('pending');
  const [expandedEmail, setExpandedEmail] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [convLoading, setConvLoading] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [toast, setToast] = useState(null);

  // Contactos que han respondido
  const replied = useMemo(() => contactos.filter(c => c.respondido), [contactos]);
  const pendingReplies = replied.filter(c => c.respuestaEnviada !== 'Si');
  const answeredReplies = replied.filter(c => c.respuestaEnviada === 'Si');
  const visible = viewFilter === 'pending' ? pendingReplies : answeredReplies;

  async function handleExpand(email) {
    if (expandedEmail === email) {
      setExpandedEmail(null);
      setConversation(null);
      return;
    }
    setExpandedEmail(email);
    setConversation(null);
    setDraftText('');
    setConvLoading(true);
    try {
      const data = await proxyFetch('getConversation', { email });
      setConversation(data);
      // If there's a draft, pre-fill
      if (data?.borrador?.cuerpo) setDraftText(data.borrador.cuerpo);
    } catch {
      setConversation({ error: true });
    } finally {
      setConvLoading(false);
    }
  }

  async function handleCompose(email) {
    setDraftLoading(true);
    try {
      const res = await composeFromInstructions({ email, campaignId, instructions: 'Genera una respuesta profesional basada en el contexto de la conversacion y el KB de la campana.' });
      setDraftText(res.body || res.draft || res.borrador || '');
      showToast('Borrador generado');
    } catch { showToast('Error generando borrador'); }
    finally { setDraftLoading(false); }
  }

  async function handleSaveDraft(email) {
    try {
      await saveDraft({ email, campaignId, body: draftText });
      showToast('Borrador guardado');
    } catch { showToast('Error guardando'); }
  }

  async function handleSendDraft(email) {
    setSendingDraft(true);
    try {
      await sendDraft({ email, campaignId, editedBody: draftText });
      showToast('Email enviado');
      setExpandedEmail(null);
    } catch { showToast('Error enviando'); }
    finally { setSendingDraft(false); }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div>
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'pending', label: `Pendientes (${pendingReplies.length})` },
          { id: 'answered', label: `Resp. enviada (${answeredReplies.length})` },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setViewFilter(f.id)}
            style={{
              padding: '6px 16px', borderRadius: 20, border: 'none',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
              background: viewFilter === f.id ? COLORS.dark : COLORS.bg,
              color: viewFilter === f.id ? '#FFFFFF' : COLORS.textSecondary,
              transition: 'all 0.15s',
            }}
          >{f.label}</button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center', color: COLORS.textSecondary, fontSize: 13,
          background: COLORS.card, borderRadius: 12, boxShadow: CARD_SHADOW,
          border: `1px dashed ${COLORS.border}`, fontFamily: FONT,
        }}>
          {viewFilter === 'pending' ? 'No hay respuestas pendientes de gestionar' : 'No hay respuestas procesadas'}
        </div>
      ) : (
        <div style={{ background: COLORS.card, borderRadius: 12, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          {visible.map((c, idx) => (
            <ResponseCard
              key={c.email}
              contact={c}
              isExpanded={expandedEmail === c.email}
              onExpand={() => handleExpand(c.email)}
              conversation={expandedEmail === c.email ? conversation : null}
              convLoading={convLoading && expandedEmail === c.email}
              draftText={draftText}
              setDraftText={setDraftText}
              draftLoading={draftLoading}
              sendingDraft={sendingDraft}
              onCompose={() => handleCompose(c.email)}
              onSaveDraft={() => handleSaveDraft(c.email)}
              onSendDraft={() => handleSendDraft(c.email)}
              isLast={idx === visible.length - 1}
            />
          ))}
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, background: COLORS.dark, color: '#FFFFFF',
          fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          fontFamily: FONT,
        }}>{toast}</div>
      )}
    </div>
  );
}

function ResponseCard({
  contact, isExpanded, onExpand, conversation, convLoading,
  draftText, setDraftText, draftLoading, sendingDraft,
  onCompose, onSaveDraft, onSendDraft, isLast,
}) {
  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid #F1F5F9' }}>
      {/* Summary row */}
      <div
        onClick={onExpand}
        style={{
          padding: '14px 18px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 12,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#FAFAFA'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, fontFamily: FONT }}>
            {contact.organizacion || contact.nombre || contact.email}
          </div>
          <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2, fontFamily: FONT }}>
            {contact.nombre && contact.organizacion ? `${contact.nombre} \u00b7 ` : ''}{contact.email}
          </div>
        </div>
        <StatusBadge status={contact.status} />
        {contact.respuestaEnviada === 'Si' && (
          <span style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600,
            background: '#ECFDF5', color: '#059669', fontFamily: FONT,
          }}>Resp. enviada</span>
        )}
        <button
          onClick={e => { e.stopPropagation(); onExpand(); }}
          style={{
            padding: '5px 12px', borderRadius: 6, border: `1px solid ${COLORS.accent}`,
            background: 'transparent', color: COLORS.accent, fontSize: 12,
            fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
          }}
        >Responder</button>
        <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {/* Expanded: conversation + draft */}
      {isExpanded && (
        <div style={{ padding: '0 18px 18px', borderTop: '1px solid #F1F5F9' }}>
          {convLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: COLORS.textSecondary, fontSize: 12, fontFamily: FONT }}>Cargando conversacion...</div>
          ) : conversation?.error ? (
            <div style={{ padding: 12, color: '#DC2626', fontSize: 12, fontFamily: FONT }}>Error cargando la conversacion</div>
          ) : (
            <>
              {/* Last reply from contact */}
              {conversation?.respuesta && (
                <div style={{ margin: '12px 0', padding: 14, background: '#FFF7ED', borderRadius: 10, border: '1px solid #FED7AA' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#EA580C', marginBottom: 4, fontFamily: FONT }}>Respuesta del contacto</div>
                  <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5, fontFamily: FONT }}>
                    {conversation.respuesta.cuerpo || conversation.respuesta}
                  </div>
                </div>
              )}

              {/* Existing draft */}
              {conversation?.borrador && conversation.borrador.cuerpo && (
                <div style={{ margin: '8px 0', padding: 12, background: '#EFF6FF', borderRadius: 10, border: '1px solid #BFDBFE' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.accent, marginBottom: 4, fontFamily: FONT }}>
                    Borrador existente ({conversation.borrador.estado || 'preparado'})
                  </div>
                </div>
              )}

              {/* Draft editor */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, fontFamily: FONT }}>Borrador de respuesta</span>
                  <button
                    onClick={onCompose} disabled={draftLoading}
                    style={{
                      padding: '4px 12px', borderRadius: RADIUS.sm, border: '1px solid #DDD6FE',
                      background: '#F5F3FF', color: '#7C3AED', fontSize: 11, fontWeight: 600,
                      cursor: draftLoading ? 'not-allowed' : 'pointer', fontFamily: FONT,
                    }}
                  >{draftLoading ? 'Generando...' : 'Generar con IA'}</button>
                </div>
                <textarea
                  value={draftText} onChange={e => setDraftText(e.target.value)} rows={6}
                  placeholder="Escribe o genera un borrador con IA..."
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10,
                    border: `1px solid ${COLORS.border}`, fontSize: 13, fontFamily: FONT,
                    resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                    background: '#FAFAFA',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={onSaveDraft} style={{
                    padding: '7px 16px', borderRadius: 8, border: `1px solid ${COLORS.border}`,
                    background: COLORS.card, color: '#334155', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: FONT,
                  }}>Guardar borrador</button>
                  <button
                    onClick={onSendDraft} disabled={sendingDraft || !draftText.trim()}
                    style={{
                      padding: '7px 16px', borderRadius: 8, border: 'none',
                      background: sendingDraft || !draftText.trim() ? '#CBD5E1' : COLORS.accent,
                      color: '#FFFFFF', fontSize: 12, fontWeight: 700,
                      cursor: sendingDraft || !draftText.trim() ? 'not-allowed' : 'pointer',
                      fontFamily: FONT,
                    }}
                  >{sendingDraft ? 'Enviando...' : 'Enviar'}</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ======================================================================
// Sub-tab: Seguimiento
// ======================================================================
function TabSeguimiento({ campaign, campaignId, contactos }) {
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { loadFollowUps(); }, [campaignId]);

  async function loadFollowUps() {
    setLoading(true);
    try {
      const data = await getFollowUps({ campaignId });
      setFollowUps(data.followUps || []);
    } catch { setFollowUps([]); }
    finally { setLoading(false); }
  }

  // Eligible: opened/clicked but NOT replied
  const eligible = useMemo(() =>
    contactos.filter(c => (c.status === 'opened' || c.status === 'clicked') && !c.respondido),
    [contactos]
  );

  const scheduled = followUps.filter(f => f.status === 'scheduled' || f.status === 'draft_ready');
  const generatingFU = followUps.filter(f => f.status === 'generating');
  const sent = followUps.filter(f => f.status === 'sent');

  async function handleGenerateBatch() {
    setGenerating(true);
    try {
      await generateFollowUpBatch({
        campaignId,
        contacts: eligible.map(c => ({ email: c.email, name: c.nombre })),
        instructions: 'Follow-up profesional recordando la conversacion previa. Tono amable y directo.',
      });
      showToast('Borradores en generacion');
      await loadFollowUps();
    } catch { showToast('Error generando borradores'); }
    finally { setGenerating(false); }
  }

  async function handleSendBatch() {
    setSending(true);
    try {
      const ready = followUps.filter(f => f.status === 'draft_ready');
      await sendFollowUpBatch({
        campaignId,
        contacts: ready.map(f => ({ email: f.email, followUpId: f.id })),
      });
      showToast('Follow-ups enviados');
      await loadFollowUps();
    } catch { showToast('Error enviando'); }
    finally { setSending(false); }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Elegibles follow-up', value: eligible.length, accent: COLORS.accent, icon: Users },
          { label: 'Programados', value: scheduled.length, accent: '#7C3AED', icon: Clock },
          { label: 'Generando', value: generatingFU.length, accent: COLORS.yellow, icon: Mail },
          { label: 'Enviados', value: sent.length, accent: COLORS.green, icon: MessageSquare },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} style={{
              background: COLORS.card, borderRadius: 12,
              borderTop: `3px solid ${k.accent}`,
              padding: '16px 18px', boxShadow: CARD_SHADOW,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: COLORS.textSecondary,
                  textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: FONT,
                }}>{k.label}</span>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: `${k.accent}14`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={16} color={k.accent} />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 600, color: COLORS.text, fontFamily: FONT }}>{k.value}</div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{
        background: COLORS.card, borderRadius: 12, boxShadow: CARD_SHADOW,
        padding: 20, marginBottom: 20,
      }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: COLORS.text, fontFamily: FONT }}>Acciones</h3>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleGenerateBatch}
            disabled={generating || eligible.length === 0}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: generating || eligible.length === 0 ? '#CBD5E1' : COLORS.accent,
              color: '#FFFFFF', fontSize: 13, fontWeight: 700,
              cursor: generating || eligible.length === 0 ? 'not-allowed' : 'pointer',
              fontFamily: FONT,
            }}
          >{generating ? 'Generando...' : `Activar seguimiento (${eligible.length} elegibles)`}</button>

          {scheduled.length > 0 && (
            <button
              onClick={handleSendBatch} disabled={sending}
              style={{
                padding: '8px 18px', borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                background: sending ? '#CBD5E1' : COLORS.card,
                color: sending ? '#FFFFFF' : COLORS.text, fontSize: 13, fontWeight: 600,
                cursor: sending ? 'not-allowed' : 'pointer', fontFamily: FONT,
              }}
            >{sending ? 'Enviando...' : `Guardar borrador (${scheduled.length})`}</button>
          )}
        </div>
      </div>

      {/* Follow-up list */}
      <div style={{ background: COLORS.card, borderRadius: 12, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: COLORS.textSecondary, fontSize: 13, fontFamily: FONT }}>Cargando follow-ups...</div>
        ) : followUps.length === 0 ? (
          <div style={{
            padding: 32, textAlign: 'center', color: COLORS.textSecondary, fontSize: 13,
            fontFamily: FONT,
          }}>
            No hay follow-ups registrados para esta campana
          </div>
        ) : (
          followUps.map((fu, idx) => (
            <FollowUpRow key={fu.id} followUp={fu} isLast={idx === followUps.length - 1} />
          ))
        )}
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, background: COLORS.dark, color: '#FFFFFF',
          fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          fontFamily: FONT,
        }}>{toast}</div>
      )}
    </div>
  );
}

function FollowUpRow({ followUp, isLast }) {
  const statusConfig = {
    scheduled: { label: 'Programado', color: '#7C3AED', bg: '#F5F3FF' },
    generating: { label: 'Generando', color: '#D97706', bg: '#FFFBEB' },
    draft_ready: { label: 'Borrador listo', color: COLORS.accent, bg: '#EFF6FF' },
    sent: { label: 'Enviado', color: '#059669', bg: '#ECFDF5' },
    cancelled: { label: 'Cancelado', color: '#DC2626', bg: '#FEF2F2' },
  };
  const st = statusConfig[followUp.status] || statusConfig.scheduled;

  return (
    <div style={{
      padding: '12px 18px',
      borderBottom: isLast ? 'none' : '1px solid #F1F5F9',
      display: 'flex', alignItems: 'center', gap: 12,
      transition: 'background 0.1s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = '#FAFAFA'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600,
        background: st.bg, color: st.color, fontFamily: FONT,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.color }} />
        {st.label}
      </span>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, fontFamily: FONT }}>
          {followUp.name || followUp.email}
        </span>
        {followUp.email && (
          <span style={{ fontSize: 12, color: COLORS.textSecondary, marginLeft: 8, fontFamily: FONT }}>{followUp.email}</span>
        )}
      </div>
      {followUp.scheduledAt && (
        <span style={{ fontSize: 11, color: COLORS.textSecondary, fontFamily: FONT }}>
          {new Date(followUp.scheduledAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}
