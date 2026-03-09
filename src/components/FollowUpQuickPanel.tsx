import { useState } from 'react';
import { TEAM_MEMBERS } from '../utils/airtableProspects';
import { scheduleFollowUp, cancelFollowUp } from '../utils/campaignApi';

/**
 * FollowUpQuickPanel — Quick overlay to schedule a 1-a-1 follow-up from ProspectsView.
 *
 * @param {object|null} prospect — prospect to schedule for (null = closed)
 * @param {object|null} existingFollowUp — existing follow-up to view/cancel (null = new)
 * @param {function} onClose — close panel
 * @param {function} onScheduled — called after scheduling/cancel
 */
export default function FollowUpQuickPanel({ prospect, existingFollowUp, onClose, onScheduled }) {
  if (!prospect) return null;

  const isViewing = !!existingFollowUp;

  const [instructions, setInstructions] = useState(existingFollowUp?.instructions || '');
  const [senderIdx, setSenderIdx] = useState(() => {
    if (existingFollowUp?.senderEmail) {
      const idx = TEAM_MEMBERS.findIndex(m => m.email === existingFollowUp.senderEmail);
      return idx >= 0 ? idx : 6;
    }
    return 6; // Leticia by default
  });
  const [scheduledDate, setScheduledDate] = useState(() => {
    if (existingFollowUp?.scheduledAt) {
      return existingFollowUp.scheduledAt.split('T')[0];
    }
    // Default: tomorrow
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    return tomorrow.toISOString().split('T')[0];
  });
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sender = TEAM_MEMBERS[senderIdx] || TEAM_MEMBERS[6];

  async function handleSchedule() {
    setLoading(true);
    setError(null);
    try {
      await scheduleFollowUp({
        email: prospect.contactEmail,
        name: prospect.name || '',
        organization: prospect.name || '',
        instructions,
        scheduledAt: `${scheduledDate}T${scheduledTime}:00`,
        senderEmail: sender.email,
        senderName: sender.name,
      });
      onScheduled();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!existingFollowUp?.id) return;
    setLoading(true);
    setError(null);
    try {
      await cancelFollowUp(existingFollowUp.id);
      onScheduled();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 99,
      }} />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
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
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1A2B3D' }}>
              {isViewing ? 'Follow-up programado' : 'Programar follow-up'}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7F94' }}>
              {prospect.name} · {prospect.contactEmail}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0',
            background: 'transparent', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6B7F94',
          }}>×</button>
        </div>

        {/* Form */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {/* Status badge for existing */}
          {isViewing && (
            <div style={{
              padding: '8px 12px', borderRadius: 8, marginBottom: 16,
              background: '#F5F3FF', border: '1px solid #DDD6FE',
              fontSize: 12, color: '#7C3AED', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7C3AED' }} />
              Estado: {existingFollowUp.status}
              {existingFollowUp.scheduledAt && (
                <span style={{ fontWeight: 400, marginLeft: 8 }}>
                  · {new Date(existingFollowUp.scheduledAt).toLocaleString('es-ES')}
                </span>
              )}
            </div>
          )}

          {/* Sender */}
          <label style={labelStyle}>Remitente</label>
          <select
            value={senderIdx}
            onChange={e => setSenderIdx(Number(e.target.value))}
            disabled={isViewing}
            style={{ ...inputStyle, marginBottom: 14 }}
          >
            {TEAM_MEMBERS.map((m, i) => (
              <option key={m.email} value={i}>{m.name}</option>
            ))}
          </select>

          {/* Date + Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Fecha</label>
              <input
                type="date" value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                disabled={isViewing}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Hora (CET)</label>
              <input
                type="time" value={scheduledTime}
                onChange={e => setScheduledTime(e.target.value)}
                disabled={isViewing}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Instructions */}
          <label style={labelStyle}>Instrucciones para Gemini</label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            disabled={isViewing}
            placeholder="Ej: Hazle seguimiento a la llamada del martes. Pregunta si revisó el term sheet."
            rows={5}
            style={{ ...inputStyle, resize: 'vertical' }}
          />

          {/* Draft preview (if exists) */}
          {existingFollowUp?.draftHtml && (
            <div style={{ marginTop: 16 }}>
              <label style={labelStyle}>Borrador generado</label>
              <div style={{
                padding: 12, background: '#F7F9FC', borderRadius: 8,
                border: '1px solid #E2E8F0', fontSize: 13, color: '#334155',
                maxHeight: 200, overflow: 'auto',
              }}
                dangerouslySetInnerHTML={{ __html: existingFollowUp.draftHtml }}
              />
            </div>
          )}

          {/* Info */}
          {!isViewing && (
            <div style={{
              marginTop: 14, padding: 10, background: '#F5F3FF',
              borderRadius: 8, border: '1px solid #DDD6FE',
              fontSize: 11, color: '#6B21A8', lineHeight: 1.5,
            }}>
              La noche anterior se generará el borrador con IA.
              Se enviará automáticamente a la hora programada si el contacto no ha respondido.
            </div>
          )}

          {error && (
            <div style={{
              marginTop: 12, padding: 10, background: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: 8,
              fontSize: 12, color: '#DC2626',
            }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid #E2E8F0',
            background: '#FFFFFF', color: '#334155', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Cerrar</button>

          {isViewing ? (
            existingFollowUp.status === 'scheduled' || existingFollowUp.status === 'draft_ready' ? (
              <button onClick={handleCancel} disabled={loading} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: loading ? '#94A3B8' : '#EF4444', color: '#FFFFFF',
                fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}>{loading ? 'Cancelando...' : 'Cancelar envío'}</button>
            ) : null
          ) : (
            <button
              onClick={handleSchedule}
              disabled={loading || !instructions.trim()}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: loading || !instructions.trim() ? '#94A3B8' : '#7C3AED',
                color: '#FFFFFF', fontSize: 13, fontWeight: 700,
                cursor: loading || !instructions.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >{loading ? 'Programando...' : 'Programar follow-up'}</button>
          )}
        </div>
      </div>
    </>
  );
}

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#6B7F94',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px',
};

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: '1px solid #E2E8F0', fontSize: 13,
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  outline: 'none', boxSizing: 'border-box',
};
