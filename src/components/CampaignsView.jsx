import { useState } from 'react';
import { KPI } from './UI';

// ── Status config ─────────────────────────────────────────────────
const STATUS_CONFIG = {
  draft:     { label: 'Borrador',   color: '#6B7F94', bg: '#F1F5F9', dot: '#94A3B8' },
  active:    { label: 'Activa',     color: '#059669', bg: '#ECFDF5', dot: '#10B981' },
  paused:    { label: 'Pausada',    color: '#D97706', bg: '#FFFBEB', dot: '#F59E0B' },
  completed: { label: 'Completada', color: '#6B21A8', bg: '#F5F3FF', dot: '#8B5CF6' },
  cancelled: { label: 'Cancelada',  color: '#DC2626', bg: '#FEF2F2', dot: '#EF4444' },
};

const TABS = [
  { id: 'active', label: 'Activas' },
  { id: 'draft', label: 'Borradores' },
  { id: 'completed', label: 'Completadas' },
  { id: 'all', label: 'Todas' },
];

// ── Main component ────────────────────────────────────────────────
export default function CampaignsView({
  campaigns,
  loading,
  error,
  onRefresh,
  onCreateCampaign,
  onSelectCampaign,
}) {
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [hoverCard, setHoverCard] = useState(null);

  // ── KPI calculations (campaigns only) ──
  const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
  const totalSent = campaigns.reduce((sum, c) => sum + (c.totalSent || 0), 0);
  const totalReplied = campaigns.reduce((sum, c) => sum + (c.totalReplied || 0), 0);
  const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) + '%' : '\u2014';

  // ── Filter campaigns by tab ──
  const filtered = filterCampaigns(campaigns, tab, search);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '3px solid #E2E8F0', borderTopColor: '#3B82F6',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
          }} />
          <p style={{ fontSize: 13, color: '#6B7F94' }}>Cargando campanas...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        margin: 24, padding: 20, background: '#FEF2F2', border: '1px solid #FECACA',
        borderRadius: 10, color: '#DC2626', fontSize: 13,
      }}>
        Error: {error}
        <button onClick={onRefresh} style={{
          marginLeft: 12, padding: '4px 12px', borderRadius: 6,
          border: '1px solid #DC2626', background: 'transparent',
          color: '#DC2626', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
        }}>Reintentar</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
      {/* ── KPI Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        <KPI label="Campanas activas" value={activeCampaigns} accent="#10B981" />
        <KPI label="Emails enviados" value={totalSent} accent="#3B82F6" />
        <KPI label="Tasa respuesta" value={replyRate} accent="#F59E0B" />
      </div>

      {/* ── Header: tabs + search + create button ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', gap: 0, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '5px 14px', borderRadius: 6, border: 'none',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s ease',
                background: tab === t.id ? '#FFFFFF' : 'transparent',
                color: tab === t.id ? '#1A2B3D' : '#6B7F94',
                boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >{t.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '6px 12px', borderRadius: 8, border: '1px solid #E2E8F0',
              fontSize: 13, fontFamily: 'inherit', width: 200,
              outline: 'none', transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = '#3B82F6'}
            onBlur={e => e.target.style.borderColor = '#E2E8F0'}
          />
          <button
            onClick={onCreateCampaign}
            style={{
              padding: '7px 16px', borderRadius: 8,
              border: 'none', background: '#3B82F6', color: '#FFFFFF',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#2563EB'}
            onMouseLeave={e => e.currentTarget.style.background = '#3B82F6'}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            Nueva campana
          </button>
        </div>
      </div>

      {/* ── Campaign list ── */}
      {filtered.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: '#6B7F94',
          background: '#F7F9FC', borderRadius: 10, border: '1px dashed #E2E8F0',
        }}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>
            {search ? 'Sin resultados para esta busqueda' : 'No hay campanas en esta categoria'}
          </p>
          <button onClick={onCreateCampaign} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid #3B82F6',
            background: 'transparent', color: '#3B82F6', fontSize: 12,
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
          }}>Crear primera campana</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(campaign => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              isHovered={hoverCard === campaign.id}
              onMouseEnter={() => setHoverCard(campaign.id)}
              onMouseLeave={() => setHoverCard(null)}
              onClick={() => onSelectCampaign(campaign)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Campaign Card ─────────────────────────────────────────────────
function CampaignCard({ campaign, isHovered, onMouseEnter, onMouseLeave, onClick }) {
  const st = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;
  const openRate = campaign.totalSent > 0
    ? ((campaign.totalOpened / campaign.totalSent) * 100).toFixed(0) + '%'
    : '\u2014';
  const replyRate = campaign.totalSent > 0
    ? ((campaign.totalReplied / campaign.totalSent) * 100).toFixed(0) + '%'
    : '\u2014';

  const dateStr = campaign.createdTime
    ? new Date(campaign.createdTime).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: 10,
        padding: '14px 18px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        transform: isHovered ? 'translateY(-1px)' : 'none',
        boxShadow: isHovered
          ? '0 4px 12px rgba(0,0,0,0.08), 0 0 0 1px rgba(59,130,246,0.15)'
          : '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Row 1: status + name + arrow */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 8px', borderRadius: 4,
            fontSize: 10, fontWeight: 600,
            color: st.color, background: st.bg,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} />
            {st.label}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1A2B3D' }}>
            {campaign.name}
          </span>
        </div>
        <span style={{ fontSize: 12, color: isHovered ? '#3B82F6' : '#6B7F94', transition: 'color 0.15s' }}>
          Ver detalle \u2192
        </span>
      </div>

      {/* Row 2: meta + metrics */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: '#6B7F94', flexWrap: 'wrap' }}>
        <span>
          {campaign.type === 'mass' ? 'Masiva' : '1-a-1'}
          {campaign.type === 'mass' && campaign.subjectB && ' \u00b7 A/B'}
        </span>
        {campaign.senderName && <span>\u00b7 {campaign.senderName}</span>}
        {dateStr && <span>\u00b7 {dateStr}</span>}
        {campaign.totalSent > 0 ? (
          <>
            <span style={{ color: '#334155', fontWeight: 600 }}>
              Enviados: {campaign.totalSent}
            </span>
            <span>Abiertos: {campaign.totalOpened || 0} ({openRate})</span>
            <span>Respondidos: {campaign.totalReplied || 0} ({replyRate})</span>
          </>
        ) : campaign.status === 'draft' ? (
          <span style={{ fontStyle: 'italic' }}>Sin enviar</span>
        ) : null}
        {(campaign.followUpCount || 0) > 0 && (
          <span style={{
            padding: '1px 8px', borderRadius: 10,
            background: '#F5F3FF', color: '#7C3AED', fontWeight: 600,
          }}>
            {campaign.followUpCount} follow-up{campaign.followUpCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Filter logic ──────────────────────────────────────────────────
function filterCampaigns(campaigns, tab, search) {
  let items = [...campaigns];

  switch (tab) {
    case 'active':
      items = items.filter(c => c.status === 'active');
      break;
    case 'draft':
      items = items.filter(c => c.status === 'draft');
      break;
    case 'completed':
      items = items.filter(c => c.status === 'completed');
      break;
    // 'all' — no filter
  }

  if (search.trim()) {
    const q = search.toLowerCase();
    items = items.filter(c => {
      const name = (c.name || '').toLowerCase();
      const sender = (c.senderName || '').toLowerCase();
      return name.includes(q) || sender.includes(q);
    });
  }

  items.sort((a, b) => {
    const dateA = a.createdTime || '';
    const dateB = b.createdTime || '';
    return dateB.localeCompare(dateA);
  });

  return items;
}
