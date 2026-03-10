import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Mail, BarChart2, Users, MessageSquare, Play, Pause,
  ChevronRight, Zap, Clock, TrendingUp, Eye, CheckCircle2,
  ArrowUpRight, Filter,
} from 'lucide-react';

// ── Design tokens ────────────────────────────────────────────────
const COLORS = {
  bg: '#F0F4F8',
  card: '#FFFFFF',
  border: '#E2E8F0',
  surface: '#1E293B',
  text: '#1A2B3D',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  accent: '#3B82F6',
  green: '#10B981',
  purple: '#8B5CF6',
  orange: '#F97316',
  yellow: '#F59E0B',
  red: '#EF4444',
};

const FONT = "'DM Sans', sans-serif";

// ── Status config ─────────────────────────────────────────────────
const STATUS_CONFIG = {
  draft:     { label: 'Borrador',   color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8' },
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

// ── KPI config ───────────────────────────────────────────────────
const KPI_CONFIG = [
  { key: 'active',  icon: BarChart2,      accent: COLORS.green,  label: 'Campanas activas' },
  { key: 'sent',    icon: Mail,           accent: COLORS.accent, label: 'Emails enviados' },
  { key: 'open',    icon: TrendingUp,     accent: COLORS.orange, label: 'Tasa apertura' },
  { key: 'replies', icon: MessageSquare,  accent: COLORS.purple, label: 'Respuestas' },
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

  // ── KPI calculations ──
  const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
  const totalSent = campaigns.reduce((sum, c) => sum + (c.totalSent || 0), 0);
  const totalOpened = campaigns.reduce((sum, c) => sum + (c.totalOpened || 0), 0);
  const totalReplied = campaigns.reduce((sum, c) => sum + (c.totalReplied || 0), 0);
  const openRate = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) + '%' : '\u2014';
  const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) + '%' : '\u2014';

  const kpiValues = {
    active: activeCampaigns,
    sent: totalSent,
    open: openRate,
    replies: totalReplied,
  };

  // ── Filter campaigns by tab ──
  const filtered = filterCampaigns(campaigns, tab, search);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400, fontFamily: FONT }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: `3px solid ${COLORS.border}`, borderTopColor: COLORS.orange,
            animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
          }} />
          <p style={{ fontSize: 13, color: COLORS.textMuted }}>Cargando campanas...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        margin: 24, padding: 20, background: '#FEF2F2', border: '1px solid #FECACA',
        borderRadius: 14, color: '#DC2626', fontSize: 13, fontFamily: FONT,
      }}>
        Error: {error}
        <button onClick={onRefresh} style={{
          marginLeft: 12, padding: '4px 12px', borderRadius: 8,
          border: '1px solid #DC2626', background: 'transparent',
          color: '#DC2626', cursor: 'pointer', fontSize: 12, fontFamily: FONT,
        }}>Reintentar</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto', fontFamily: FONT }}>
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <h1 style={{
              fontSize: 28, fontWeight: 700, margin: 0,
              background: 'linear-gradient(90deg, #F97316, #F59E0B)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.02em',
              fontFamily: FONT,
            }}>
              Campanas
            </h1>
            <span style={{
              padding: '3px 10px', borderRadius: 20,
              background: 'rgba(249,115,22,0.1)', color: '#C2410C',
              fontSize: 12, fontWeight: 600, fontFamily: FONT,
            }}>
              {activeCampaigns} activa{activeCampaigns !== 1 ? 's' : ''}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: COLORS.textSecondary, fontFamily: FONT }}>
            Gestion y seguimiento de campanas de outreach comercial
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={{
            padding: '8px 16px', borderRadius: 10,
            border: `1px solid ${COLORS.border}`, background: COLORS.card,
            color: COLORS.textSecondary, fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Filter size={14} />
            Filtros
          </button>
          <button
            onClick={onCreateCampaign}
            style={{
              padding: '8px 18px', borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #F97316, #F59E0B)',
              color: '#FFFFFF',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 2px 8px rgba(249,115,22,0.3)',
              transition: 'box-shadow 0.15s, transform 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(249,115,22,0.4)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(249,115,22,0.3)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <Plus size={15} strokeWidth={2.5} />
            Nueva Campana
          </button>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {KPI_CONFIG.map((kpi, idx) => (
          <KpiCard
            key={kpi.key}
            Icon={kpi.icon}
            accent={kpi.accent}
            label={kpi.label}
            value={kpiValues[kpi.key]}
            delay={idx * 0.06}
          />
        ))}
      </div>

      {/* ── Filter Tabs + Count ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 18, flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(t => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '7px 16px', borderRadius: 8,
                  border: isActive ? 'none' : `1px solid ${COLORS.border}`,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  fontFamily: FONT, transition: 'all 0.15s ease',
                  background: isActive ? '#1E293B' : COLORS.card,
                  color: isActive ? '#FFFFFF' : COLORS.textSecondary,
                  boxShadow: isActive ? '0 2px 6px rgba(30,41,59,0.18)' : 'none',
                }}
              >{t.label}</button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '7px 14px', borderRadius: 10, border: `1px solid ${COLORS.border}`,
              fontSize: 13, fontFamily: FONT, width: 200,
              outline: 'none', transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = COLORS.orange}
            onBlur={e => e.target.style.borderColor = COLORS.border}
          />
          <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: FONT, whiteSpace: 'nowrap' }}>
            {filtered.length} {filtered.length === 1 ? 'campana' : 'campanas'}
          </span>
        </div>
      </div>

      {/* ── Campaign list ── */}
      {filtered.length === 0 ? (
        <div style={{
          padding: 48, textAlign: 'center', color: COLORS.textSecondary,
          background: COLORS.bg, borderRadius: 16, border: `1px dashed ${COLORS.border}`,
          fontFamily: FONT,
        }}>
          <p style={{ fontSize: 14, marginBottom: 10 }}>
            {search ? 'Sin resultados para esta busqueda' : 'No hay campanas en esta categoria'}
          </p>
          <button onClick={onCreateCampaign} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg, #F97316, #F59E0B)',
            color: '#FFFFFF', fontSize: 12,
            cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
          }}>Crear primera campana</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((campaign, idx) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              isHovered={hoverCard === campaign.id}
              onMouseEnter={() => setHoverCard(campaign.id)}
              onMouseLeave={() => setHoverCard(null)}
              onClick={() => onSelectCampaign(campaign)}
              delay={idx * 0.04}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────
function KpiCard({ Icon, accent, label, value, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
      style={{
        background: COLORS.card,
        borderRadius: 14,
        border: `1px solid ${COLORS.border}`,
        padding: '20px 22px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        fontFamily: FONT,
      }}
    >
      {/* Top accent gradient bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${accent}, ${accent}44)`,
      }} />

      {/* ArrowUpRight top-right */}
      <div style={{ position: 'absolute', top: 14, right: 14 }}>
        <ArrowUpRight size={14} color="#CBD5E1" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Icon square */}
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${accent}14`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={18} color={accent} strokeWidth={2} />
        </div>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 600, color: COLORS.textSecondary,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2,
          }}>
            {label}
          </div>
          <div style={{
            fontSize: 26, fontWeight: 600, color: COLORS.text,
            letterSpacing: '-0.03em', lineHeight: 1.1,
          }}>
            {value}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Status Badge ─────────────────────────────────────────────────
function StatusBadge({ status }) {
  const st = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      fontSize: 10, fontWeight: 600,
      color: st.color, background: st.bg,
      fontFamily: FONT,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />
      {st.label}
    </span>
  );
}

// ── Type Badge ───────────────────────────────────────────────────
function TypeBadge({ type }) {
  const isMass = type === 'mass';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 20,
      fontSize: 10, fontWeight: 600,
      color: isMass ? '#1D4ED8' : '#C2410C',
      background: isMass ? '#EFF6FF' : '#FFF7ED',
      fontFamily: FONT,
    }}>
      {!isMass && <Zap size={10} />}
      {isMass ? 'Puntual' : 'Continuada'}
    </span>
  );
}

// ── Metric Pill ──────────────────────────────────────────────────
function MetricPill({ Icon, value, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 8,
      background: '#F8FAFC',
      fontSize: 11, color: COLORS.textSecondary, fontFamily: FONT,
    }}>
      <Icon size={12} color={COLORS.textMuted} />
      <span style={{ fontWeight: 600, color: COLORS.text }}>{value}</span>
      <span>{label}</span>
    </div>
  );
}

// ── Open Rate Bar ────────────────────────────────────────────────
function OpenRateBar({ rate, hasSent }) {
  if (!hasSent) return null;
  const barColor = rate >= 40 ? COLORS.green : rate >= 25 ? COLORS.orange : COLORS.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: COLORS.textMuted, fontFamily: FONT }}>
        Apertura
      </span>
      <div style={{
        width: 80, height: 5, background: '#F1F5F9',
        borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(rate, 100)}%`, height: '100%',
          background: barColor, borderRadius: 3,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: barColor, minWidth: 32, textAlign: 'right', fontFamily: FONT }}>
        {rate.toFixed(0)}%
      </span>
    </div>
  );
}

// ── Campaign Card ────────────────────────────────────────────────
function CampaignCard({ campaign, isHovered, onMouseEnter, onMouseLeave, onClick, delay = 0 }) {
  const st = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;
  const isPaused = campaign.status === 'paused';
  const isActive = campaign.status === 'active';
  const isMass = campaign.type === 'mass';

  const openRate = campaign.totalSent > 0
    ? (campaign.totalOpened / campaign.totalSent) * 100
    : 0;
  const hasSent = campaign.totalSent > 0;

  const companies = campaign.totalRecipients || 0;
  const sent = campaign.totalSent || 0;
  const replies = campaign.totalReplied || 0;
  const followUps = campaign.followUpCount || 0;

  const dateStr = campaign.createdTime
    ? new Date(campaign.createdTime).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  // Left accent bar gradient
  const accentGradient = isPaused
    ? COLORS.yellow
    : isMass
      ? 'linear-gradient(180deg, #3B82F6, #6366F1)'
      : 'linear-gradient(180deg, #F97316, #F59E0B)';

  // Progress (mock: use open rate as proxy for completeness)
  const progress = hasSent ? Math.min(Math.round(openRate), 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: '24px 26px',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        opacity: isPaused ? 0.85 : 1,
        boxShadow: isHovered
          ? '0 8px 24px rgba(0,0,0,0.08), 0 0 0 1px rgba(59,130,246,0.1)'
          : '0 1px 4px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.2s ease',
        fontFamily: FONT,
      }}
    >
      {/* Left accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: 4,
        background: accentGradient,
      }} />

      {/* Row 1: Type + Status + Name + Description + Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <TypeBadge type={campaign.type} />
          <StatusBadge status={campaign.status} />
          <span style={{
            fontSize: 16, fontWeight: 600, color: COLORS.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: FONT,
          }}>
            {campaign.name}
          </span>
          {campaign.description && (
            <span style={{
              fontSize: 12, color: COLORS.textMuted,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontFamily: FONT,
            }}>
              {campaign.description}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 12 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onClick && onClick()}
            style={{
              padding: '5px 12px', borderRadius: 8,
              border: `1px solid ${COLORS.border}`, background: COLORS.card,
              color: COLORS.textSecondary, fontSize: 11, fontWeight: 500,
              cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4,
              transition: 'border-color 0.15s',
            }}
          >
            <Eye size={12} />
            Ver detalle
          </button>
          {isActive && (
            <button style={{
              padding: '5px 12px', borderRadius: 8,
              border: `1px solid ${COLORS.orange}40`, background: 'transparent',
              color: COLORS.orange, fontSize: 11, fontWeight: 500,
              cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Pause size={12} />
              Pausar
            </button>
          )}
          {isPaused && (
            <button style={{
              padding: '5px 12px', borderRadius: 8,
              border: 'none',
              background: 'linear-gradient(135deg, #F97316, #F59E0B)',
              color: '#FFFFFF', fontSize: 11, fontWeight: 500,
              cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Play size={12} />
              Reanudar
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Trigger pills (if triggers exist) */}
      {campaign.triggers && campaign.triggers.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {campaign.triggers.map((trigger, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 20,
              background: '#FFF7ED', color: '#C2410C',
              fontSize: 10, fontWeight: 500, fontFamily: FONT,
            }}>
              <Zap size={10} />
              {trigger}
            </span>
          ))}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: '#F1F5F9', marginBottom: 12 }} />

      {/* Row 3: Metrics + Open Rate */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: hasSent ? 10 : 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <MetricPill Icon={Users} value={companies} label="empresas" />
          <MetricPill Icon={Mail} value={sent} label="enviados" />
          <MetricPill Icon={MessageSquare} value={replies} label="respuestas" />
          {followUps > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 8,
              background: '#F5F3FF', color: '#7C3AED',
              fontSize: 11, fontWeight: 600, fontFamily: FONT,
            }}>
              {followUps} follow-up{followUps !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <OpenRateBar rate={openRate} hasSent={hasSent} />
      </div>

      {/* Row 4: Timing + Progress */}
      {(dateStr || hasSent) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: COLORS.textMuted, fontFamily: FONT }}>
            <Clock size={12} color={COLORS.textMuted} />
            {dateStr && (
              <>
                <span>Ultima ejecucion: {dateStr}</span>
                <ChevronRight size={12} color={COLORS.textMuted} />
                <span>Proxima: pendiente</span>
              </>
            )}
            {campaign.senderName && (
              <span style={{ marginLeft: 4, color: COLORS.textSecondary }}>
                · {campaign.senderName}
              </span>
            )}
          </div>
          {hasSent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 80, height: 5, background: '#F1F5F9',
                borderRadius: 3, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${progress}%`, height: '100%',
                  background: 'linear-gradient(90deg, #F97316, #F59E0B)',
                  borderRadius: 3, transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: COLORS.textSecondary, fontFamily: FONT }}>
                {progress}% completada
              </span>
            </div>
          )}
        </div>
      )}

      {/* A/B label if applicable */}
      {campaign.type === 'mass' && campaign.subjectB && (
        <span style={{
          position: 'absolute', top: 10, right: 16,
          padding: '2px 8px', borderRadius: 6,
          background: '#EFF6FF', color: '#3B82F6',
          fontSize: 9, fontWeight: 700, fontFamily: FONT,
        }}>
          A/B
        </span>
      )}
    </motion.div>
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
