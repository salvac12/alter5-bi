import { useState, useEffect, useMemo } from 'react';
import { KPI } from './UI';
import {
  getCampaign, getCampaignDashboard, getFollowUpCandidates,
  getConversation, sendDraft, saveDraft, composeFromInstructions,
  classifyReply, getFollowUps, generateFollowUpBatch, sendFollowUpBatch,
  updateCampaign,
} from '../utils/campaignApi';

// ── Constants ─────────────────────────────────────────────────────
const SUB_TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'contactos', label: 'Contactos' },
  { id: 'respuestas', label: 'Respuestas' },
  { id: 'seguimiento', label: 'Seguimiento' },
];

const CONTACT_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendiente' },
  { id: 'sent', label: 'Enviado' },
  { id: 'opened', label: 'Abierto' },
  { id: 'clicked', label: 'Clic' },
  { id: 'replied', label: 'Respondido' },
  { id: 'error', label: 'Error' },
];

const PIPELINE_STAGES = [
  'Nurturing', 'Reunion', 'Subida docs', 'Doc completada', 'Descartado',
];

// ── Main component ────────────────────────────────────────────────
export default function CampaignDetailView({ campaignId, onBack }) {
  const [subTab, setSubTab] = useState('resumen');
  const [campaign, setCampaign] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, [campaignId]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [campData, dashData] = await Promise.all([
        getCampaign(campaignId),
        getCampaignDashboard(campaignId).catch(() => null),
      ]);
      setCampaign(campData.campaign || campData);
      setDashboard(dashData);
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

  const contactos = dashboard?.contactos || [];
  const metricas = dashboard?.metricas || {};

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
        >\u2190 Volver</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#1A2B3D' }}>
            {campaign?.name || 'Campana'}
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6B7F94' }}>
            {campaign?.type === 'mass' ? 'Masiva' : '1-a-1'}
            {campaign?.senderName ? ` \u00b7 ${campaign.senderName}` : ''}
            {campaign?.status ? ` \u00b7 ${campaign.status}` : ''}
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
      {subTab === 'resumen' && (
        <TabResumen campaign={campaign} metricas={metricas} contactos={contactos} />
      )}
      {subTab === 'contactos' && (
        <TabContactos contactos={contactos} campaign={campaign} />
      )}
      {subTab === 'respuestas' && (
        <TabRespuestas contactos={contactos} campaign={campaign} campaignId={campaignId} />
      )}
      {subTab === 'seguimiento' && (
        <TabSeguimiento campaign={campaign} campaignId={campaignId} contactos={contactos} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Sub-tab: Resumen
// ══════════════════════════════════════════════════════════════════
function TabResumen({ campaign, metricas, contactos }) {
  const totalSent = metricas.enviados || campaign?.totalSent || 0;
  const totalOpened = metricas.abiertos || campaign?.totalOpened || 0;
  const totalClicked = metricas.clics || 0;
  const totalReplied = metricas.respondidos || campaign?.totalReplied || 0;

  const pct = (n) => totalSent > 0 ? ((n / totalSent) * 100).toFixed(1) + '%' : '\u2014';

  // Funnel data
  const funnel = [
    { label: 'Enviados', value: totalSent, color: '#3B82F6' },
    { label: 'Abiertos', value: totalOpened, color: '#10B981' },
    { label: 'Clics', value: totalClicked, color: '#F59E0B' },
    { label: 'Respondidos', value: totalReplied, color: '#8B5CF6' },
  ];
  const maxVal = Math.max(totalSent, 1);

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <KPI label="Enviados" value={totalSent} accent="#3B82F6" />
        <KPI label="Abiertos" value={pct(totalOpened)} accent="#10B981" />
        <KPI label="Clics" value={pct(totalClicked)} accent="#F59E0B" />
        <KPI label="Respondidos" value={pct(totalReplied)} accent="#8B5CF6" />
      </div>

      {/* Funnel */}
      <div style={{
        padding: 20, background: '#FFFFFF', border: '1px solid #E2E8F0',
        borderRadius: 10, marginBottom: 20,
      }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#1A2B3D' }}>Funnel</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {funnel.map(f => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 90, fontSize: 12, color: '#6B7F94', textAlign: 'right' }}>{f.label}</span>
              <div style={{ flex: 1, height: 24, background: '#F1F5F9', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{
                  width: `${(f.value / maxVal) * 100}%`,
                  height: '100%', background: f.color, borderRadius: 6,
                  transition: 'width 0.4s ease',
                  minWidth: f.value > 0 ? 2 : 0,
                }} />
              </div>
              <span style={{ width: 50, fontSize: 13, fontWeight: 700, color: '#1A2B3D' }}>{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* A/B comparison */}
      {campaign?.subjectB && (
        <div style={{
          padding: 20, background: '#FFFFFF', border: '1px solid #E2E8F0',
          borderRadius: 10, marginBottom: 20,
        }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#1A2B3D' }}>Comparativa A/B</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ABColumn label="A" subject={campaign.subjectA} metricas={metricas.varianteA} color="#3B82F6" />
            <ABColumn label="B" subject={campaign.subjectB} metricas={metricas.varianteB} color="#F59E0B" />
          </div>
        </div>
      )}

      {/* Campaign info */}
      <div style={{
        padding: 20, background: '#FFFFFF', border: '1px solid #E2E8F0',
        borderRadius: 10,
      }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#1A2B3D' }}>Informacion</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
          <InfoRow label="Remitente" value={campaign?.senderName || '\u2014'} />
          <InfoRow label="Tipo" value={campaign?.type === 'mass' ? 'Masiva' : '1-a-1'} />
          <InfoRow label="Fecha" value={campaign?.createdTime ? new Date(campaign.createdTime).toLocaleDateString('es-ES') : '\u2014'} />
          <InfoRow label="Estado" value={campaign?.status || '\u2014'} />
        </div>
        {campaign?.knowledgeBase && (
          <div style={{ marginTop: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7F94', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Base de conocimiento
            </span>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {campaign.knowledgeBase.slice(0, 300)}{campaign.knowledgeBase.length > 300 ? '...' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ABColumn({ label, subject, metricas = {}, color }) {
  return (
    <div style={{ padding: 14, background: '#F7F9FC', borderRadius: 8, border: `2px solid ${color}20` }}>
      <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 8 }}>Variante {label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2B3D', marginBottom: 10 }}>{subject || '\u2014'}</div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6B7F94' }}>
        <span>Env: {metricas.enviados || 0}</span>
        <span>Abiertos: {metricas.abiertos || 0}</span>
        <span>Clics: {metricas.clics || 0}</span>
        <span>Resp: {metricas.respondidos || 0}</span>
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
function TabContactos({ contactos, campaign }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  const filtered = useMemo(() => {
    let list = [...contactos];
    if (filter !== 'all') {
      list = list.filter(c => (c.status || c.estado || '').toLowerCase() === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.email || '').toLowerCase().includes(q) ||
        (c.nombre || c.name || '').toLowerCase().includes(q) ||
        (c.empresa || c.organization || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [contactos, filter, search]);

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {CONTACT_FILTERS.map(f => {
          const count = f.id === 'all' ? contactos.length : contactos.filter(c => (c.status || c.estado || '').toLowerCase() === f.id).length;
          return (
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
            >{f.label} ({count})</button>
          );
        })}
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

      {/* Table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 120px 140px 80px 70px 60px 60px 100px',
          padding: '8px 14px', background: '#F7F9FC', borderBottom: '1px solid #E2E8F0',
          fontSize: 10, fontWeight: 700, color: '#6B7F94', textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          <span>Email</span><span>Nombre</span><span>Empresa</span>
          <span>Variante</span><span>Estado</span><span>Apert.</span><span>Clics</span><span>Fecha</span>
        </div>
        {/* Rows */}
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#6B7F94', fontSize: 13 }}>Sin contactos</div>
        ) : filtered.map((c, i) => (
          <div key={c.email || i}>
            <div
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 120px 140px 80px 70px 60px 60px 100px',
                padding: '10px 14px', borderBottom: '1px solid #F1F5F9',
                fontSize: 12, color: '#334155', cursor: 'pointer',
                background: expanded === i ? '#EFF6FF' : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</span>
              <span>{c.nombre || c.name || '\u2014'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.empresa || c.organization || '\u2014'}</span>
              <span>{c.variante || c.variant || '\u2014'}</span>
              <StatusBadge status={c.status || c.estado} />
              <span>{c.aperturas || c.opens || 0}</span>
              <span>{c.clics || c.clicks || 0}</span>
              <span style={{ fontSize: 11, color: '#6B7F94' }}>
                {c.fechaEnvio ? new Date(c.fechaEnvio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '\u2014'}
              </span>
            </div>
            {/* Expanded: tracking timeline */}
            {expanded === i && (
              <div style={{ padding: '12px 14px 12px 28px', background: '#F7F9FC', borderBottom: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7F94', marginBottom: 6 }}>Timeline</div>
                {(c.eventos || c.events || []).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(c.eventos || c.events || []).map((ev, j) => (
                      <div key={j} style={{ fontSize: 11, color: '#334155' }}>
                        <span style={{ color: '#6B7F94', marginRight: 8 }}>{ev.fecha || ev.date || ''}</span>
                        {ev.tipo || ev.type || ev.action || ''}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>Sin eventos registrados</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  const config = {
    sent: { bg: '#EFF6FF', color: '#3B82F6' },
    opened: { bg: '#ECFDF5', color: '#059669' },
    clicked: { bg: '#FFFBEB', color: '#D97706' },
    replied: { bg: '#F5F3FF', color: '#7C3AED' },
    error: { bg: '#FEF2F2', color: '#DC2626' },
    pending: { bg: '#F1F5F9', color: '#6B7F94' },
  };
  const c = config[s] || config.pending;
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: c.bg, color: c.color,
    }}>{status || 'Pendiente'}</span>
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
  const [classifyResult, setClassifyResult] = useState(null);
  const [toast, setToast] = useState(null);

  const replied = useMemo(() =>
    contactos.filter(c => (c.status || c.estado || '').toLowerCase() === 'replied'),
    [contactos]
  );

  const pendingReplies = replied.filter(c => !c.teamReplied);
  const answeredReplies = replied.filter(c => c.teamReplied);
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
    setClassifyResult(null);
    setConvLoading(true);
    try {
      const data = await getConversation(email, campaignId);
      setConversation(data);
      if (data?.draftBody) setDraftText(data.draftBody);
      // Auto-classify
      if (data?.lastReply) {
        const result = await classifyReply({ email, campaignId, replyText: data.lastReply }).catch(() => null);
        setClassifyResult(result);
      }
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
      setDraftText(res.body || res.draft || '');
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
          { id: 'answered', label: `Respondidas (${answeredReplies.length})` },
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
          {viewFilter === 'pending' ? 'No hay respuestas pendientes' : 'No hay respuestas procesadas'}
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
              classifyResult={classifyResult}
              onCompose={() => handleCompose(c.email)}
              onSaveDraft={() => handleSaveDraft(c.email)}
              onSendDraft={() => handleSendDraft(c.email)}
            />
          ))}
        </div>
      )}

      {/* Toast */}
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
  draftText, setDraftText, draftLoading, sendingDraft, classifyResult,
  onCompose, onSaveDraft, onSendDraft,
}) {
  const name = contact.nombre || contact.name || contact.email;
  const org = contact.empresa || contact.organization || '';
  const preview = contact.lastReplyPreview || contact.lastReply || '';

  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Summary row */}
      <div
        onClick={onExpand}
        style={{
          padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
          transition: 'background 0.1s',
        }}
      >
        {/* Pipeline stage badge */}
        {classifyResult?.etapa && isExpanded && (
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
            background: '#F5F3FF', color: '#7C3AED',
          }}>{classifyResult.etapa}</span>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B3D' }}>
            {name} {org && <span style={{ fontWeight: 400, color: '#6B7F94' }}>\u2014 {org}</span>}
          </div>
          {!isExpanded && preview && (
            <p style={{
              margin: '4px 0 0', fontSize: 12, color: '#6B7F94',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 600,
            }}>{preview}</p>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>
          {contact.fechaRespuesta ? new Date(contact.fechaRespuesta).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : ''}
        </span>
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
              {/* Thread */}
              <div style={{ maxHeight: 300, overflow: 'auto', margin: '12px 0', padding: 12, background: '#F7F9FC', borderRadius: 8 }}>
                {(conversation?.mensajes || conversation?.messages || []).map((msg, i) => (
                  <div key={i} style={{
                    marginBottom: 10, padding: 10, borderRadius: 8,
                    background: msg.from === 'equipo' || msg.direction === 'sent' ? '#EFF6FF' : '#FFFFFF',
                    border: '1px solid #E2E8F0',
                  }}>
                    <div style={{ fontSize: 10, color: '#6B7F94', marginBottom: 4 }}>
                      {msg.from || msg.sender || ''} \u00b7 {msg.fecha || msg.date || ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {msg.texto || msg.body || msg.text || ''}
                    </div>
                  </div>
                ))}
                {(conversation?.mensajes || conversation?.messages || []).length === 0 && (
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>Sin mensajes</span>
                )}
              </div>

              {/* AI summary */}
              {conversation?.resumen && (
                <div style={{
                  padding: 10, background: '#F5F3FF', borderRadius: 8,
                  border: '1px solid #DDD6FE', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', marginBottom: 4 }}>Resumen IA</div>
                  <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>{conversation.resumen}</div>
                </div>
              )}

              {/* Classification result */}
              {classifyResult && (
                <div style={{
                  padding: 8, background: '#ECFDF5', borderRadius: 6,
                  border: '1px solid #A7F3D0', marginBottom: 12,
                  display: 'flex', gap: 12, fontSize: 12, color: '#059669',
                }}>
                  <span>Clasificacion: <strong>{classifyResult.etapa}</strong></span>
                  {classifyResult.confianza && <span>Confianza: {classifyResult.confianza}</span>}
                  {classifyResult.motivo && <span>\u00b7 {classifyResult.motivo}</span>}
                </div>
              )}

              {/* Draft editor */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1A2B3D' }}>Borrador de respuesta</span>
                  <button
                    onClick={onCompose}
                    disabled={draftLoading}
                    style={{
                      padding: '3px 10px', borderRadius: 6, border: '1px solid #DDD6FE',
                      background: '#F5F3FF', color: '#7C3AED', fontSize: 11, fontWeight: 600,
                      cursor: draftLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    }}
                  >{draftLoading ? 'Generando...' : 'Generar con IA'}</button>
                </div>
                <textarea
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  rows={6}
                  placeholder="Escribe o genera un borrador con IA..."
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8,
                    border: '1px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit',
                    resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={onSaveDraft}
                    style={{
                      padding: '6px 14px', borderRadius: 6, border: '1px solid #E2E8F0',
                      background: '#FFFFFF', color: '#334155', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >Guardar borrador</button>
                  <button
                    onClick={onSendDraft}
                    disabled={sendingDraft || !draftText.trim()}
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

  useEffect(() => {
    loadFollowUps();
  }, [campaignId]);

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
    contactos.filter(c => {
      const s = (c.status || c.estado || '').toLowerCase();
      return (s === 'opened' || s === 'clicked') && s !== 'replied';
    }),
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
        contacts: eligible.map(c => ({ email: c.email, name: c.nombre || c.name || '' })),
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
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
            onClick={handleSendBatch}
            disabled={sending}
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
          No hay follow-ups para esta campana
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
