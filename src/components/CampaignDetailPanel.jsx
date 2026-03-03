import { useState, useEffect } from 'react';
import { getCampaignRecipients, updateCampaignStatus, startCampaign } from '../utils/campaignApi';

const STATUS_CONFIG = {
  draft:     { label: 'Borrador',   color: '#6B7F94', bg: '#F1F5F9' },
  active:    { label: 'Activa',     color: '#059669', bg: '#ECFDF5' },
  paused:    { label: 'Pausada',    color: '#D97706', bg: '#FFFBEB' },
  completed: { label: 'Completada', color: '#6B21A8', bg: '#F5F3FF' },
  cancelled: { label: 'Cancelada',  color: '#DC2626', bg: '#FEF2F2' },
};

const RECIPIENT_STATUS = {
  pending:  { label: 'Pendiente',  color: '#6B7F94', bg: '#F1F5F9' },
  sent:     { label: 'Enviado',    color: '#3B82F6', bg: '#EFF6FF' },
  opened:   { label: 'Abierto',    color: '#D97706', bg: '#FFFBEB' },
  clicked:  { label: 'Clic',       color: '#F97316', bg: '#FFF7ED' },
  replied:  { label: 'Respondido', color: '#059669', bg: '#ECFDF5' },
  error:    { label: 'Error',      color: '#DC2626', bg: '#FEF2F2' },
};

/**
 * CampaignDetailPanel — Full detail of a campaign with recipients table.
 */
export default function CampaignDetailPanel({ campaign, onClose, onUpdated }) {
  if (!campaign) return null;

  const [recipients, setRecipients] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recipientFilter, setRecipientFilter] = useState('all');

  const st = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;

  useEffect(() => {
    loadRecipients();
  }, [campaign.id]);

  async function loadRecipients() {
    try {
      setLoadingRecipients(true);
      const data = await getCampaignRecipients(campaign.id);
      setRecipients(data.recipients || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingRecipients(false);
    }
  }

  async function handleAction(action) {
    setActionLoading(true);
    setError(null);
    try {
      if (action === 'start') {
        await startCampaign(campaign.id);
      } else {
        await updateCampaignStatus(campaign.id, action);
      }
      onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  // Metrics
  const sent = recipients.filter(r => r.status !== 'pending' && r.status !== 'error').length;
  const opened = recipients.filter(r => ['opened', 'clicked', 'replied'].includes(r.status)).length;
  const clicked = recipients.filter(r => ['clicked', 'replied'].includes(r.status)).length;
  const replied = recipients.filter(r => r.status === 'replied').length;

  const filteredRecipients = recipientFilter === 'all'
    ? recipients
    : recipients.filter(r => r.status === recipientFilter);

  // A/B comparison data
  const hasAB = campaign.subjectB;
  const variantA = recipients.filter(r => r.variant === 'A');
  const variantB = recipients.filter(r => r.variant === 'B');

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 99,
      }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 720,
        background: '#FFFFFF', zIndex: 100,
        boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 24px', borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
              color: st.color, background: st.bg,
            }}>{st.label}</span>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1A2B3D' }}>
              {campaign.name}
            </h2>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0',
            background: 'transparent', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6B7F94',
          }}>×</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
          {/* Quick metrics */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20,
          }}>
            <MetricCard label="Enviados" value={sent} total={recipients.length} color="#3B82F6" />
            <MetricCard label="Abiertos" value={opened} total={sent} color="#D97706" />
            <MetricCard label="Clics" value={clicked} total={sent} color="#F97316" />
            <MetricCard label="Respondidos" value={replied} total={sent} color="#10B981" />
          </div>

          {/* A/B Comparison */}
          {hasAB && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1A2B3D', marginBottom: 10 }}>
                Comparativa A/B
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <ABCard
                  variant="A"
                  subject={campaign.subjectA}
                  recipients={variantA}
                  color="#3B82F6"
                  bg="#EFF6FF"
                  isWinner={campaign.abWinner === 'A'}
                />
                <ABCard
                  variant="B"
                  subject={campaign.subjectB}
                  recipients={variantB}
                  color="#D97706"
                  bg="#FFFBEB"
                  isWinner={campaign.abWinner === 'B'}
                />
              </div>
            </div>
          )}

          {/* Campaign info */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20,
          }}>
            <InfoRow label="Remitente" value={`${campaign.senderName} (${campaign.senderEmail})`} />
            <InfoRow label="Tipo" value={campaign.type === 'mass' ? 'Campaña masiva' : 'Follow-up 1-a-1'} />
            {campaign.notes && <InfoRow label="Notas" value={campaign.notes} />}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {campaign.status === 'draft' && (
              <ActionBtn label="Iniciar envío" color="#10B981"
                loading={actionLoading} onClick={() => handleAction('start')} />
            )}
            {campaign.status === 'active' && (
              <ActionBtn label="Pausar" color="#D97706"
                loading={actionLoading} onClick={() => handleAction('paused')} />
            )}
            {campaign.status === 'paused' && (
              <ActionBtn label="Reanudar" color="#10B981"
                loading={actionLoading} onClick={() => handleAction('active')} />
            )}
            {(campaign.status === 'draft' || campaign.status === 'active' || campaign.status === 'paused') && (
              <ActionBtn label="Cancelar campaña" color="#EF4444"
                loading={actionLoading} onClick={() => handleAction('cancelled')} />
            )}
          </div>

          {error && (
            <div style={{
              marginBottom: 12, padding: 10, background: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: 8,
              fontSize: 12, color: '#DC2626',
            }}>{error}</div>
          )}

          {/* Recipients table */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1A2B3D', margin: 0 }}>
              Destinatarios ({filteredRecipients.length})
            </h3>
            <div style={{ display: 'flex', gap: 4 }}>
              {['all', 'pending', 'sent', 'opened', 'replied'].map(f => (
                <button
                  key={f}
                  onClick={() => setRecipientFilter(f)}
                  style={{
                    padding: '3px 8px', borderRadius: 4, border: 'none',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit',
                    background: recipientFilter === f ? '#3B82F620' : '#F1F5F9',
                    color: recipientFilter === f ? '#3B82F6' : '#6B7F94',
                  }}
                >{f === 'all' ? 'Todos' : (RECIPIENT_STATUS[f]?.label || f)}</button>
              ))}
            </div>
          </div>

          {loadingRecipients ? (
            <p style={{ fontSize: 12, color: '#6B7F94', textAlign: 'center', padding: 20 }}>
              Cargando destinatarios...
            </p>
          ) : (
            <div style={{
              border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F7F9FC' }}>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Nombre</th>
                    <th style={thStyle}>Variante</th>
                    <th style={thStyle}>Estado</th>
                    <th style={thStyle}>Aperturas</th>
                    <th style={thStyle}>Clics</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecipients.map((r, i) => {
                    const rs = RECIPIENT_STATUS[r.status] || RECIPIENT_STATUS.pending;
                    return (
                      <tr key={r.email + i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={tdStyle}>{r.email}</td>
                        <td style={tdStyle}>{r.name || '—'}</td>
                        <td style={tdStyle}>
                          {r.variant && (
                            <span style={{
                              padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                              background: r.variant === 'A' ? '#EFF6FF' : '#FFFBEB',
                              color: r.variant === 'A' ? '#3B82F6' : '#D97706',
                            }}>{r.variant}</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <span style={{
                            padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            color: rs.color, background: rs.bg,
                          }}>{rs.label}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{r.openCount || 0}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{r.clickCount || 0}</td>
                      </tr>
                    );
                  })}
                  {filteredRecipients.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#6B7F94' }}>
                        Sin destinatarios
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────
function MetricCard({ label, value, total, color }) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(0) + '%' : '—';
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8, background: '#F7F9FC',
      border: '1px solid #E2E8F0',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7F94', textTransform: 'uppercase', letterSpacing: '1px' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.2, marginTop: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: '#6B7F94' }}>{pct}</div>
    </div>
  );
}

function ABCard({ variant, subject, recipients, color, bg, isWinner }) {
  const sent = recipients.filter(r => r.status !== 'pending').length;
  const opened = recipients.filter(r => ['opened', 'clicked', 'replied'].includes(r.status)).length;
  const replied = recipients.filter(r => r.status === 'replied').length;
  const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(0) + '%' : '—';
  const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(0) + '%' : '—';

  return (
    <div style={{
      padding: 12, borderRadius: 8, background: bg,
      border: isWinner ? `2px solid ${color}` : '1px solid #E2E8F0',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
      }}>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 800,
          color, background: '#FFFFFF',
        }}>Variante {variant}</span>
        {isWinner && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#10B981' }}>GANADORA</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#334155', marginBottom: 8, fontStyle: 'italic' }}>
        {subject || 'Sin asunto'}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#6B7F94' }}>
        <span>Enviados: <b style={{ color: '#334155' }}>{sent}</b></span>
        <span>Apertura: <b style={{ color }}>{openRate}</b></span>
        <span>Respuesta: <b style={{ color: '#10B981' }}>{replyRate}</b></span>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7F94', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#334155', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ActionBtn({ label, color, loading, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        padding: '6px 14px', borderRadius: 6, border: `1px solid ${color}`,
        background: 'transparent', color,
        fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', opacity: loading ? 0.6 : 1,
      }}
    >{loading ? '...' : label}</button>
  );
}

const thStyle = {
  padding: '8px 10px', textAlign: 'left', fontWeight: 700,
  color: '#6B7F94', fontSize: 10, textTransform: 'uppercase',
  letterSpacing: '0.5px', borderBottom: '1px solid #E2E8F0',
};

const tdStyle = {
  padding: '8px 10px', color: '#334155',
};
