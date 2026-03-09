import { useState, useEffect, useMemo } from 'react';
import { KPI } from './UI';
import {
  getCampaign, getConversation, sendDraft, saveDraft, composeFromInstructions,
  classifyReply, getFollowUps, generateFollowUpBatch, sendFollowUpBatch,
} from '../utils/campaignApi';

// ── Proxy helper for GAS GET endpoints ───────────────────────────
async function proxyFetch(action, params = {}) {
  const secret = import.meta.env.VITE_CAMPAIGN_PROXY_SECRET || '';
  const res = await fetch('/api/campaign-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-proxy-secret': secret },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Proxy error ${res.status}`);
  return data;
}

// ── Constants ─────────────────────────────────────────────────────
const SUB_TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'contactos', label: 'Contactos' },
  { id: 'respuestas', label: 'Respuestas' },
  { id: 'seguimiento', label: 'Seguimiento' },
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
  const isReplied = normalStatus === 'replied' || c.respondido === 'Si' || c.respondido === 'Sí';
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '3px solid #E2E8F0', borderTopColor: '#3B82F6',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
          }} />
          <p style={{ fontSize: 13, color: '#6B7F94' }}>Cargando campana...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ margin: 24, padding: 20, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, color: '#DC2626', fontSize: 13 }}>
        Error: {error}
        <button onClick={loadData} style={{ marginLeft: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #DC2626', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Reintentar</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #E2E8F0',
            background: '#FFFFFF', color: '#334155', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >{'\u2190'} Volver</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#1A2B3D' }}>
            {campaign?.name || 'Campana'}
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6B7F94' }}>
            {campaign?.type === 'mass' ? 'Masiva' : '1-a-1'}
            {campaign?.senderName ? ` \u00b7 ${campaign.senderName}` : ''}
            {campaign?.status ? ` \u00b7 ${campaign.status}` : ''}
            {contactos.length > 0 ? ` \u00b7 ${contactos.length} contactos` : ''}
          </p>
        </div>
      </div>

      {/* ── Sub-tabs ── */}
      <div style={{ display: 'flex', gap: 0, background: '#F1F5F9', borderRadius: 8, padding: 3, marginBottom: 20 }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: '6px 18px', borderRadius: 6, border: 'none',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', transition: 'all 0.15s ease',
              background: subTab === t.id ? '#FFFFFF' : 'transparent',
              color: subTab === t.id ? '#1A2B3D' : '#6B7F94',
              boxShadow: subTab === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Sub-tab content ── */}
      {subTab === 'resumen' && <TabResumen campaign={campaign} metricas={metricas} contactos={contactos} />}
      {subTab === 'contactos' && <TabContactos contactos={contactos} />}
      {subTab === 'respuestas' && <TabRespuestas contactos={contactos} campaign={campaign} campaignId={campaignId} />}
      {subTab === 'seguimiento' && <TabSeguimiento campaign={campaign} campaignId={campaignId} contactos={contactos} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Sub-tab: Resumen
// ══════════════════════════════════════════════════════════════════
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

  const funnel = [
    { label: 'Total contactos', value: totalContacts, color: '#64748B' },
    { label: 'Enviados', value: totalSent, color: '#3B82F6' },
    { label: 'Abiertos', value: totalOpened, color: '#10B981' },
    { label: 'Clics', value: totalClicked, color: '#F59E0B' },
    { label: 'Respondidos', value: totalReplied, color: '#8B5CF6' },
  ];
  const maxVal = Math.max(totalContacts, 1);

  // A/B variants from metricas
  const varA = metricas?.A;
  const varB = metricas?.B;
  const varFinal = metricas?.Final;
  const hasAB = varA && varB && (varA.enviados > 0 || varB.enviados > 0);

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 24 }}>
        <KPI label="Total" value={totalContacts} accent="#64748B" />
        <KPI label="Enviados" value={totalSent} accent="#3B82F6" />
        <KPI label="Abiertos" value={`${totalOpened} (${pct(totalOpened)})`} accent="#10B981" />
        <KPI label="Clics" value={`${totalClicked} (${pct(totalClicked)})`} accent="#F59E0B" />
        <KPI label="Respondidos" value={`${totalReplied} (${pct(totalReplied)})`} accent="#8B5CF6" />
      </div>

      {/* Funnel */}
      <div style={{ padding: 20, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#1A2B3D' }}>Embudo de conversion</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {funnel.map(f => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 110, fontSize: 12, color: '#6B7F94', textAlign: 'right' }}>{f.label}</span>
              <div style={{ flex: 1, height: 28, background: '#F1F5F9', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{
                  width: `${(f.value / maxVal) * 100}%`,
                  height: '100%', background: f.color, borderRadius: 6,
                  transition: 'width 0.4s ease',
                  minWidth: f.value > 0 ? 2 : 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
                }}>
                  {f.value > 0 && (f.value / maxVal) > 0.15 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF' }}>{f.value}</span>
                  )}
                </div>
              </div>
              <span style={{ width: 50, fontSize: 13, fontWeight: 700, color: '#1A2B3D' }}>{f.value}</span>
            </div>
          ))}
        </div>
        {totalErrors > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#DC2626' }}>Errores: {totalErrors}</div>
        )}
      </div>

      {/* A/B Test comparison */}
      {hasAB && (
        <div style={{ padding: 20, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#1A2B3D' }}>Test A/B</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ABColumn label="A" subject={campaign?.subjectA} data={varA} color="#3B82F6" />
            <ABColumn label="B" subject={campaign?.subjectB} data={varB} color="#F59E0B" />
          </div>
          {varFinal && varFinal.total > 0 && (
            <div style={{ marginTop: 16, padding: 14, background: '#F7F9FC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#1A2B3D', marginBottom: 8 }}>Grupo Final</div>
              <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#6B7F94' }}>
                <span>Total: <strong style={{ color: '#1A2B3D' }}>{varFinal.total}</strong></span>
                <span>Enviados: <strong style={{ color: '#1A2B3D' }}>{varFinal.enviados}</strong></span>
                <span>Pendientes: <strong style={{ color: '#D97706' }}>{varFinal.pendientes}</strong></span>
                <span>Abiertos: <strong style={{ color: '#10B981' }}>{varFinal.abiertos}</strong></span>
                <span>Clics: <strong style={{ color: '#F59E0B' }}>{varFinal.clics}</strong></span>
                <span>Respondidos: <strong style={{ color: '#8B5CF6' }}>{varFinal.respondidos}</strong></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Campaign info */}
      <div style={{ padding: 20, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#1A2B3D' }}>Informacion</h3>
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
  const isBetter = (otherData) => {
    if (!otherData || !data.enviados || !otherData.enviados) return false;
    return (data.tasaApertura || 0) > (otherData.tasaApertura || 0);
  };

  return (
    <div style={{ padding: 14, background: '#F7F9FC', borderRadius: 8, border: `2px solid ${color}20` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color }}>Variante {label}</span>
      </div>
      {subject && (
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1A2B3D', marginBottom: 10, lineHeight: 1.4 }}>
          {subject}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <div>
          <span style={{ color: '#6B7F94' }}>Enviados</span>
          <div style={{ fontWeight: 700, color: '#1A2B3D' }}>{data.enviados || 0}</div>
        </div>
        <div>
          <span style={{ color: '#6B7F94' }}>Aperturas</span>
          <div style={{ fontWeight: 700, color: '#10B981' }}>{data.abiertos || 0} ({pct(data.abiertos)})</div>
        </div>
        <div>
          <span style={{ color: '#6B7F94' }}>Clics</span>
          <div style={{ fontWeight: 700, color: '#F59E0B' }}>{data.clics || 0} ({pct(data.clics)})</div>
        </div>
        <div>
          <span style={{ color: '#6B7F94' }}>Respondidos</span>
          <div style={{ fontWeight: 700, color: '#8B5CF6' }}>{data.respondidos || 0} ({pct(data.respondidos)})</div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7F94', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
      <div style={{ fontSize: 13, color: '#1A2B3D', marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Sub-tab: Contactos
// ══════════════════════════════════════════════════════════════════
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
              padding: '4px 12px', borderRadius: 20, border: 'none',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: filter === f.id ? '#3B82F6' : '#F1F5F9',
              color: filter === f.id ? '#FFFFFF' : '#6B7F94',
              transition: 'all 0.15s',
            }}
          >{f.label} ({counts[f.id] || 0})</button>
        ))}
        <input
          type="text" placeholder="Buscar nombre/email/empresa..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto', padding: '5px 12px', borderRadius: 8,
            border: '1px solid #E2E8F0', fontSize: 12, fontFamily: 'inherit',
            width: 220, outline: 'none',
          }}
        />
      </div>

      <div style={{ marginBottom: 8, fontSize: 11, color: '#6B7F94' }}>
        Mostrando {filtered.length} de {contactos.length} contactos
      </div>

      {/* Table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 70px 80px 65px 65px 90px',
          padding: '8px 14px', background: '#F7F9FC', borderBottom: '1px solid #E2E8F0',
          fontSize: 10, fontWeight: 700, color: '#6B7F94', textTransform: 'uppercase', letterSpacing: '0.5px',
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
          <div style={{ padding: 24, textAlign: 'center', color: '#6B7F94', fontSize: 13 }}>Sin contactos</div>
        ) : filtered.map((c, i) => (
          <div key={c.email || i}>
            <div
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{
                display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 70px 80px 65px 65px 90px',
                padding: '10px 14px', borderBottom: '1px solid #F1F5F9',
                fontSize: 12, color: '#334155', cursor: 'pointer',
                background: expanded === i ? '#EFF6FF' : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre || '\u2014'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.organizacion || '\u2014'}</span>
              <span>
                {c.variante ? (
                  <span style={{
                    padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: c.variante === 'A' ? '#EFF6FF' : c.variante === 'B' ? '#FFFBEB' : '#F1F5F9',
                    color: c.variante === 'A' ? '#3B82F6' : c.variante === 'B' ? '#D97706' : '#6B7F94',
                  }}>{c.variante}</span>
                ) : '\u2014'}
              </span>
              <StatusBadge status={c.status} />
              <span style={{ fontWeight: c.numAperturas > 0 ? 700 : 400 }}>{c.numAperturas || 0}</span>
              <span style={{ fontWeight: c.numClics > 0 ? 700 : 400 }}>{c.numClics || 0}</span>
              <span style={{ fontSize: 11, color: '#6B7F94' }}>
                {c.fechaEnvio ? new Date(c.fechaEnvio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '\u2014'}
              </span>
            </div>

            {/* Expanded: tracking timeline */}
            {expanded === i && (
              <div style={{ padding: '12px 14px 12px 28px', background: '#F7F9FC', borderBottom: '1px solid #E2E8F0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 12 }}>
                  {c.fechaEnvio && (
                    <div>
                      <span style={{ color: '#6B7F94' }}>Enviado: </span>
                      <span style={{ color: '#1A2B3D' }}>{new Date(c.fechaEnvio).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  {c.primeraApertura && (
                    <div>
                      <span style={{ color: '#6B7F94' }}>Primera apertura: </span>
                      <span style={{ color: '#10B981' }}>{new Date(c.primeraApertura).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  {c.primerClic && (
                    <div>
                      <span style={{ color: '#6B7F94' }}>Primer clic: </span>
                      <span style={{ color: '#F59E0B' }}>{new Date(c.primerClic).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  <div>
                    <span style={{ color: '#6B7F94' }}>Aperturas totales: </span>
                    <span style={{ fontWeight: 700, color: '#1A2B3D' }}>{c.numAperturas}</span>
                  </div>
                  <div>
                    <span style={{ color: '#6B7F94' }}>Clics totales: </span>
                    <span style={{ fontWeight: 700, color: '#1A2B3D' }}>{c.numClics}</span>
                  </div>
                  <div>
                    <span style={{ color: '#6B7F94' }}>Grupo: </span>
                    <span style={{ color: '#1A2B3D' }}>{c.grupo || 'N/A'}</span>
                  </div>
                  {c.respondido && (
                    <div>
                      <span style={{ color: '#8B5CF6', fontWeight: 700 }}>Ha respondido</span>
                      {c.respuestaEnviada === 'Si' && <span style={{ marginLeft: 8, color: '#10B981', fontWeight: 600 }}>Resp. enviada</span>}
                    </div>
                  )}
                  {c.seguimientosEnviados > 0 && (
                    <div>
                      <span style={{ color: '#6B7F94' }}>Follow-ups: </span>
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
    sent: { label: 'Enviado', bg: '#EFF6FF', color: '#3B82F6' },
    opened: { label: 'Abierto', bg: '#ECFDF5', color: '#059669' },
    clicked: { label: 'Clic', bg: '#FFFBEB', color: '#D97706' },
    replied: { label: 'Respondido', bg: '#F5F3FF', color: '#7C3AED' },
    error: { label: 'Error', bg: '#FEF2F2', color: '#DC2626' },
    pending: { label: 'Pendiente', bg: '#F1F5F9', color: '#6B7F94' },
  };
  const c = config[status] || config.pending;
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: c.bg, color: c.color,
    }}>{c.label}</span>
  );
}

// ══════════════════════════════════════════════════════════════════
// Sub-tab: Respuestas (Agente IA)
// ══════════════════════════════════════════════════════════════════
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
              padding: '5px 14px', borderRadius: 20, border: 'none',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: viewFilter === f.id ? '#8B5CF6' : '#F1F5F9',
              color: viewFilter === f.id ? '#FFFFFF' : '#6B7F94',
            }}
          >{f.label}</button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#6B7F94', fontSize: 13, background: '#F7F9FC', borderRadius: 10, border: '1px dashed #E2E8F0' }}>
          {viewFilter === 'pending' ? 'No hay respuestas pendientes de gestionar' : 'No hay respuestas procesadas'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map(c => (
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
            />
          ))}
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, background: '#1A2B3D', color: '#FFFFFF',
          fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>{toast}</div>
      )}
    </div>
  );
}

function ResponseCard({
  contact, isExpanded, onExpand, conversation, convLoading,
  draftText, setDraftText, draftLoading, sendingDraft,
  onCompose, onSaveDraft, onSendDraft,
}) {
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
      {/* Summary row */}
      <div onClick={onExpand} style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B3D' }}>
            {contact.nombre || contact.email}
            {contact.organizacion && <span style={{ fontWeight: 400, color: '#6B7F94' }}> \u2014 {contact.organizacion}</span>}
          </div>
          <div style={{ fontSize: 12, color: '#6B7F94', marginTop: 2 }}>{contact.email}</div>
        </div>
        {contact.respuestaEnviada === 'Si' && (
          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#ECFDF5', color: '#059669' }}>
            Resp. enviada
          </span>
        )}
        <span style={{ fontSize: 14, color: '#6B7F94' }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {/* Expanded: conversation + draft */}
      {isExpanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #F1F5F9' }}>
          {convLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#6B7F94', fontSize: 12 }}>Cargando conversacion...</div>
          ) : conversation?.error ? (
            <div style={{ padding: 12, color: '#DC2626', fontSize: 12 }}>Error cargando la conversacion</div>
          ) : (
            <>
              {/* Last reply from contact */}
              {conversation?.respuesta && (
                <div style={{ margin: '12px 0', padding: 12, background: '#FFF7ED', borderRadius: 8, border: '1px solid #FED7AA' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#EA580C', marginBottom: 4 }}>Respuesta del contacto</div>
                  <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {conversation.respuesta.cuerpo || conversation.respuesta}
                  </div>
                </div>
              )}

              {/* Existing draft */}
              {conversation?.borrador && conversation.borrador.cuerpo && (
                <div style={{ margin: '8px 0', padding: 10, background: '#EFF6FF', borderRadius: 8, border: '1px solid #BFDBFE' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#3B82F6', marginBottom: 4 }}>
                    Borrador existente ({conversation.borrador.estado || 'preparado'})
                  </div>
                </div>
              )}

              {/* Draft editor */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1A2B3D' }}>Borrador de respuesta</span>
                  <button
                    onClick={onCompose} disabled={draftLoading}
                    style={{
                      padding: '3px 10px', borderRadius: 6, border: '1px solid #DDD6FE',
                      background: '#F5F3FF', color: '#7C3AED', fontSize: 11, fontWeight: 600,
                      cursor: draftLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    }}
                  >{draftLoading ? 'Generando...' : 'Generar con IA'}</button>
                </div>
                <textarea
                  value={draftText} onChange={e => setDraftText(e.target.value)} rows={6}
                  placeholder="Escribe o genera un borrador con IA..."
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8,
                    border: '1px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit',
                    resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={onSaveDraft} style={{
                    padding: '6px 14px', borderRadius: 6, border: '1px solid #E2E8F0',
                    background: '#FFFFFF', color: '#334155', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>Guardar borrador</button>
                  <button
                    onClick={onSendDraft} disabled={sendingDraft || !draftText.trim()}
                    style={{
                      padding: '6px 14px', borderRadius: 6, border: 'none',
                      background: sendingDraft || !draftText.trim() ? '#CBD5E1' : '#10B981',
                      color: '#FFFFFF', fontSize: 12, fontWeight: 700,
                      cursor: sendingDraft || !draftText.trim() ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
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

// ══════════════════════════════════════════════════════════════════
// Sub-tab: Seguimiento
// ══════════════════════════════════════════════════════════════════
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
        <KPI label="Elegibles follow-up" value={eligible.length} accent="#3B82F6" />
        <KPI label="Programados" value={scheduled.length} accent="#7C3AED" />
        <KPI label="Generando" value={generatingFU.length} accent="#F59E0B" />
        <KPI label="Enviados" value={sent.length} accent="#10B981" />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button
          onClick={handleGenerateBatch}
          disabled={generating || eligible.length === 0}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: generating || eligible.length === 0 ? '#CBD5E1' : 'linear-gradient(135deg, #7C3AED, #3B82F6)',
            color: '#FFFFFF', fontSize: 13, fontWeight: 700,
            cursor: generating || eligible.length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >{generating ? 'Generando...' : `Follow-up masivo (${eligible.length} elegibles)`}</button>

        {scheduled.length > 0 && (
          <button
            onClick={handleSendBatch} disabled={sending}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: sending ? '#CBD5E1' : '#10B981',
              color: '#FFFFFF', fontSize: 13, fontWeight: 700,
              cursor: sending ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >{sending ? 'Enviando...' : `Enviar ${scheduled.length} listos`}</button>
        )}
      </div>

      {/* Follow-up list */}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#6B7F94', fontSize: 13 }}>Cargando follow-ups...</div>
      ) : followUps.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center', color: '#6B7F94', fontSize: 13,
          background: '#F7F9FC', borderRadius: 10, border: '1px dashed #E2E8F0',
        }}>
          No hay follow-ups registrados para esta campana
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {followUps.map(fu => (
            <FollowUpRow key={fu.id} followUp={fu} />
          ))}
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, background: '#1A2B3D', color: '#FFFFFF',
          fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>{toast}</div>
      )}
    </div>
  );
}

function FollowUpRow({ followUp }) {
  const statusConfig = {
    scheduled: { label: 'Programado', color: '#7C3AED', bg: '#F5F3FF' },
    generating: { label: 'Generando', color: '#D97706', bg: '#FFFBEB' },
    draft_ready: { label: 'Borrador listo', color: '#3B82F6', bg: '#EFF6FF' },
    sent: { label: 'Enviado', color: '#059669', bg: '#ECFDF5' },
    cancelled: { label: 'Cancelado', color: '#DC2626', bg: '#FEF2F2' },
  };
  const st = statusConfig[followUp.status] || statusConfig.scheduled;

  return (
    <div style={{
      padding: '10px 16px', background: '#FFFFFF',
      border: '1px solid #E2E8F0', borderRadius: 8,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{
        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
        background: st.bg, color: st.color,
      }}>{st.label}</span>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1A2B3D' }}>
          {followUp.name || followUp.email}
        </span>
        {followUp.email && (
          <span style={{ fontSize: 12, color: '#6B7F94', marginLeft: 8 }}>{followUp.email}</span>
        )}
      </div>
      {followUp.scheduledAt && (
        <span style={{ fontSize: 11, color: '#6B7F94' }}>
          {new Date(followUp.scheduledAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}
