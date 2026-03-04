import { useState } from 'react';
import { TEAM_MEMBERS } from '../utils/airtableProspects';
import { createCampaign, scheduleFollowUp } from '../utils/campaignApi';

const STEPS = [
  { id: 1, label: 'Tipo' },
  { id: 2, label: 'Destinatarios' },
  { id: 3, label: 'Contenido' },
  { id: 4, label: 'Remitente' },
  { id: 5, label: 'Revisar' },
];

/**
 * CampaignCreationPanel — 5-step wizard to create a campaign or follow-up.
 *
 * @param {function} onClose — close the panel
 * @param {function} onCreated — called after successful creation
 * @param {Array} prospects — list of prospects from Airtable (for recipient selection)
 */
export default function CampaignCreationPanel({ onClose, onCreated, prospects = [], initialRecipients = [] }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: Type
  const [campaignType, setCampaignType] = useState(null); // 'mass' | 'individual_followup'

  // Step 2: Recipients
  const [selectedProspects, setSelectedProspects] = useState([]); // prospect IDs
  const [manualEmails, setManualEmails] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [preloadedRecipients] = useState(() => initialRecipients); // from Candidatas

  // Step 3: Content
  const [name, setName] = useState('');
  const [subjectA, setSubjectA] = useState('');
  const [bodyA, setBodyA] = useState('');
  const [subjectB, setSubjectB] = useState('');
  const [bodyB, setBodyB] = useState('');
  const [enableAB, setEnableAB] = useState(false);
  const [instructions, setInstructions] = useState(''); // for follow-up AI generation

  // Step 4: Sender + Schedule
  const [senderIdx, setSenderIdx] = useState(6); // default Leticia (index 6)
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const [abTestPercent, setAbTestPercent] = useState(20);
  const [abWinnerCriteria, setAbWinnerCriteria] = useState('aperturas');

  const sender = TEAM_MEMBERS[senderIdx] || TEAM_MEMBERS[6];

  function canProceed() {
    switch (step) {
      case 1: return !!campaignType;
      case 2: return preloadedRecipients.length > 0 || selectedProspects.length > 0 || manualEmails.trim().length > 0;
      case 3:
        if (campaignType === 'individual_followup') return instructions.trim().length > 0;
        return name.trim().length > 0 && subjectA.trim().length > 0 && bodyA.trim().length > 0;
      case 4: return true;
      case 5: return true;
      default: return false;
    }
  }

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      if (campaignType === 'individual_followup') {
        // Parse recipients
        const emails = getRecipientList();
        for (const r of emails) {
          await scheduleFollowUp({
            email: r.email,
            name: r.name || '',
            organization: r.organization || '',
            instructions,
            scheduledAt: scheduledDate && scheduledTime
              ? `${scheduledDate}T${scheduledTime}:00`
              : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            senderEmail: sender.email,
            senderName: sender.name,
          });
        }
      } else {
        const recipients = getRecipientList();
        await createCampaign({
          name,
          type: 'mass',
          senderEmail: sender.email,
          senderName: sender.name,
          subjectA,
          bodyA,
          subjectB: enableAB ? subjectB : '',
          bodyB: enableAB ? bodyB : '',
          abTestPercent: enableAB ? abTestPercent : 0,
          abWinnerCriteria: enableAB ? abWinnerCriteria : '',
          recipients,
        });
      }
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function getRecipientList() {
    const list = [];
    // From preloaded recipients (Candidatas)
    for (const r of preloadedRecipients) {
      if (r.email && !list.some(x => x.email === r.email)) {
        list.push({ email: r.email, name: r.name || '', lastName: r.lastName || '', organization: r.organization || '' });
      }
    }
    // From selected prospects
    for (const id of selectedProspects) {
      const p = prospects.find(pr => pr.id === id);
      if (p) {
        const email = p.contactEmail || '';
        if (email && !list.some(r => r.email === email)) {
          list.push({ email, name: p.name, organization: p.name, prospectId: p.id });
        }
      }
    }
    // From manual input
    if (manualEmails.trim()) {
      for (const line of manualEmails.split('\n')) {
        const email = line.trim().toLowerCase();
        if (email && email.includes('@') && !list.some(r => r.email === email)) {
          list.push({ email, name: '', organization: '' });
        }
      }
    }
    return list;
  }

  // Filtered prospects for search
  const filteredProspects = prospects.filter(p => {
    if (!recipientSearch.trim()) return true;
    const q = recipientSearch.toLowerCase();
    return (p.name || '').toLowerCase().includes(q)
      || (p.contactEmail || '').toLowerCase().includes(q);
  });

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 99,
      }} />
      {/* Panel */}
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
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1A2B3D' }}>
              Nueva campaña
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7F94' }}>
              Paso {step} de 5 — {STEPS[step - 1].label}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0',
            background: 'transparent', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6B7F94',
          }}>×</button>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '12px 24px', display: 'flex', gap: 4 }}>
          {STEPS.map(s => (
            <div key={s.id} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: s.id <= step ? '#3B82F6' : '#E2E8F0',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
          {step === 1 && (
            <StepType campaignType={campaignType} setCampaignType={setCampaignType} />
          )}
          {step === 2 && (
            <StepRecipients
              campaignType={campaignType}
              prospects={filteredProspects}
              selectedProspects={selectedProspects}
              setSelectedProspects={setSelectedProspects}
              manualEmails={manualEmails}
              setManualEmails={setManualEmails}
              recipientSearch={recipientSearch}
              setRecipientSearch={setRecipientSearch}
              preloadedRecipients={preloadedRecipients}
            />
          )}
          {step === 3 && (
            <StepContent
              campaignType={campaignType}
              name={name} setName={setName}
              subjectA={subjectA} setSubjectA={setSubjectA}
              bodyA={bodyA} setBodyA={setBodyA}
              subjectB={subjectB} setSubjectB={setSubjectB}
              bodyB={bodyB} setBodyB={setBodyB}
              enableAB={enableAB} setEnableAB={setEnableAB}
              instructions={instructions} setInstructions={setInstructions}
            />
          )}
          {step === 4 && (
            <StepSender
              campaignType={campaignType}
              senderIdx={senderIdx} setSenderIdx={setSenderIdx}
              scheduledDate={scheduledDate} setScheduledDate={setScheduledDate}
              scheduledTime={scheduledTime} setScheduledTime={setScheduledTime}
              abTestPercent={abTestPercent} setAbTestPercent={setAbTestPercent}
              abWinnerCriteria={abWinnerCriteria} setAbWinnerCriteria={setAbWinnerCriteria}
              enableAB={enableAB}
            />
          )}
          {step === 5 && (
            <StepReview
              campaignType={campaignType}
              name={name}
              subjectA={subjectA} bodyA={bodyA}
              subjectB={subjectB} bodyB={bodyB}
              enableAB={enableAB}
              instructions={instructions}
              sender={sender}
              scheduledDate={scheduledDate} scheduledTime={scheduledTime}
              abTestPercent={abTestPercent} abWinnerCriteria={abWinnerCriteria}
              recipientCount={getRecipientList().length}
            />
          )}

          {error && (
            <div style={{
              marginTop: 12, padding: 10, background: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: 8,
              fontSize: 12, color: '#DC2626',
            }}>{error}</div>
          )}
        </div>

        {/* Footer: navigation buttons */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: '1px solid #E2E8F0', background: '#FFFFFF',
              color: '#334155', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >{step > 1 ? '← Atrás' : 'Cancelar'}</button>

          {step < 5 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: canProceed() ? '#3B82F6' : '#E2E8F0',
                color: canProceed() ? '#FFFFFF' : '#94A3B8',
                fontSize: 13, fontWeight: 600, cursor: canProceed() ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >Siguiente →</button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={loading}
              style={{
                padding: '8px 24px', borderRadius: 8, border: 'none',
                background: loading ? '#94A3B8' : '#10B981',
                color: '#FFFFFF', fontSize: 13, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >{loading ? 'Creando...' : 'Crear campaña'}</button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Step 1: Type ──────────────────────────────────────────────────
function StepType({ campaignType, setCampaignType }) {
  const types = [
    {
      id: 'individual_followup',
      icon: '✉',
      title: 'Follow-up 1-a-1',
      desc: 'Email personalizado generado por IA, con envío automático en la fecha que elijas.',
    },
    {
      id: 'mass',
      icon: '📨',
      title: 'Campaña masiva',
      desc: 'Envío a lista de contactos con A/B testing, tracking de aperturas y clics.',
    },
  ];

  return (
    <div>
      <h3 style={sectionTitle}>¿Qué tipo de envío quieres crear?</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
        {types.map(t => (
          <button
            key={t.id}
            onClick={() => setCampaignType(t.id)}
            style={{
              padding: 20, borderRadius: 12, border: '2px solid',
              borderColor: campaignType === t.id ? '#3B82F6' : '#E2E8F0',
              background: campaignType === t.id ? '#EFF6FF' : '#FFFFFF',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>{t.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1A2B3D', marginBottom: 6 }}>
              {t.title}
            </div>
            <div style={{ fontSize: 12, color: '#6B7F94', lineHeight: 1.5 }}>
              {t.desc}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: Recipients ────────────────────────────────────────────
function StepRecipients({
  campaignType, prospects, selectedProspects, setSelectedProspects,
  manualEmails, setManualEmails, recipientSearch, setRecipientSearch,
  preloadedRecipients = [],
}) {
  const isFollowUp = campaignType === 'individual_followup';

  function toggleProspect(id) {
    if (isFollowUp) {
      // Single select for follow-up
      setSelectedProspects(selectedProspects.includes(id) ? [] : [id]);
    } else {
      setSelectedProspects(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    }
  }

  // Group preloaded by organization
  const preloadedByOrg = {};
  for (const r of preloadedRecipients) {
    const org = r.organization || 'Sin empresa';
    if (!preloadedByOrg[org]) preloadedByOrg[org] = [];
    preloadedByOrg[org].push(r);
  }

  return (
    <div>
      <h3 style={sectionTitle}>
        {isFollowUp ? '¿A quién le envías el follow-up?' : 'Selecciona destinatarios'}
      </h3>

      {/* Preloaded recipients from Candidatas */}
      {preloadedRecipients.length > 0 && (
        <div style={{
          padding: 14, background: '#F5F3FF', borderRadius: 8,
          border: '1px solid #DDD6FE', marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6B21A8', marginBottom: 8 }}>
            {preloadedRecipients.length} contactos de {Object.keys(preloadedByOrg).length} empresas (desde Candidatas)
          </div>
          <div style={{ maxHeight: 160, overflow: 'auto' }}>
            {Object.entries(preloadedByOrg).map(([org, contacts]) => (
              <div key={org} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED' }}>{org}</div>
                {contacts.map(c => (
                  <div key={c.email} style={{ fontSize: 11, color: '#6B7F94', paddingLeft: 8 }}>
                    {c.name} {c.lastName} — {c.email}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Buscar prospect..."
        value={recipientSearch}
        onChange={e => setRecipientSearch(e.target.value)}
        style={{ ...inputStyle, marginBottom: 12 }}
      />

      {/* Prospect list */}
      <div style={{
        maxHeight: 260, overflow: 'auto', border: '1px solid #E2E8F0',
        borderRadius: 8, marginBottom: 14,
      }}>
        {prospects.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#6B7F94', fontSize: 12 }}>
            No hay prospects disponibles
          </div>
        ) : (
          prospects.map(p => {
            const isSelected = selectedProspects.includes(p.id);
            return (
              <div
                key={p.id}
                onClick={() => toggleProspect(p.id)}
                style={{
                  padding: '8px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderBottom: '1px solid #F1F5F9',
                  background: isSelected ? '#EFF6FF' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: isFollowUp ? '50%' : 4,
                  border: `2px solid ${isSelected ? '#3B82F6' : '#CBD5E1'}`,
                  background: isSelected ? '#3B82F6' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: '#FFF', flexShrink: 0,
                }}>
                  {isSelected && '✓'}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2B3D' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7F94' }}>
                    {p.contactEmail || 'Sin email'}
                    {p.stage && ` · ${p.stage}`}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Manual emails */}
      <label style={labelStyle}>Emails manuales (uno por línea)</label>
      <textarea
        value={manualEmails}
        onChange={e => setManualEmails(e.target.value)}
        placeholder="nombre@empresa.com&#10;otro@empresa.com"
        rows={3}
        style={{ ...inputStyle, resize: 'vertical' }}
      />

      <p style={{ fontSize: 11, color: '#6B7F94', marginTop: 8 }}>
        {preloadedRecipients.length > 0 ? `${preloadedRecipients.length} de Candidatas` : ''}
        {preloadedRecipients.length > 0 && selectedProspects.length > 0 ? ' + ' : ''}
        {selectedProspects.length > 0 ? `${selectedProspects.length} prospect${selectedProspects.length !== 1 ? 's' : ''}` : ''}
        {manualEmails.trim() ? ` + ${manualEmails.trim().split('\n').filter(l => l.trim()).length} manual(es)` : ''}
        {preloadedRecipients.length === 0 && selectedProspects.length === 0 && !manualEmails.trim() ? '0 destinatarios seleccionados' : ''}
      </p>
    </div>
  );
}

// ── Step 3: Content ───────────────────────────────────────────────
function StepContent({
  campaignType,
  name, setName,
  subjectA, setSubjectA,
  bodyA, setBodyA,
  subjectB, setSubjectB,
  bodyB, setBodyB,
  enableAB, setEnableAB,
  instructions, setInstructions,
}) {
  if (campaignType === 'individual_followup') {
    return (
      <div>
        <h3 style={sectionTitle}>Instrucciones para la IA</h3>
        <p style={{ fontSize: 12, color: '#6B7F94', marginBottom: 12 }}>
          Describe en lenguaje natural qué quieres decir. Gemini generará el email personalizado.
        </p>
        <textarea
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="Ej: Recuérdale que tenemos una reunión el jueves y que necesitamos el NDA firmado antes."
          rows={6}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
    );
  }

  return (
    <div>
      <h3 style={sectionTitle}>Contenido de la campaña</h3>

      <label style={labelStyle}>Nombre de la campaña</label>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Bridge Debt — Ola 2"
        style={{ ...inputStyle, marginBottom: 14 }}
      />

      {/* Variante A */}
      <div style={{
        padding: 14, background: '#F7F9FC', borderRadius: 8,
        border: '1px solid #E2E8F0', marginBottom: 12,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#3B82F6', marginBottom: 8 }}>
          Variante A {!enableAB && '(única)'}
        </div>
        <label style={labelStyle}>Asunto</label>
        <input
          type="text" value={subjectA}
          onChange={e => setSubjectA(e.target.value)}
          placeholder="Asunto del email"
          style={{ ...inputStyle, marginBottom: 8 }}
        />
        <label style={labelStyle}>Cuerpo (HTML)</label>
        <textarea
          value={bodyA}
          onChange={e => setBodyA(e.target.value)}
          placeholder="<p>Hola {{nombre}},</p>..."
          rows={6}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
        />
      </div>

      {/* A/B toggle */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 13, color: '#334155', cursor: 'pointer', marginBottom: 12,
      }}>
        <input
          type="checkbox" checked={enableAB}
          onChange={e => setEnableAB(e.target.checked)}
        />
        Activar test A/B (añadir Variante B)
      </label>

      {/* Variante B */}
      {enableAB && (
        <div style={{
          padding: 14, background: '#FFFBEB', borderRadius: 8,
          border: '1px solid #FDE68A',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#D97706', marginBottom: 8 }}>
            Variante B
          </div>
          <label style={labelStyle}>Asunto</label>
          <input
            type="text" value={subjectB}
            onChange={e => setSubjectB(e.target.value)}
            placeholder="Asunto alternativo"
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <label style={labelStyle}>Cuerpo (HTML)</label>
          <textarea
            value={bodyB}
            onChange={e => setBodyB(e.target.value)}
            placeholder="<p>Hola {{nombre}},</p>..."
            rows={6}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
          />
        </div>
      )}
    </div>
  );
}

// ── Step 4: Sender + Schedule ─────────────────────────────────────
function StepSender({
  campaignType,
  senderIdx, setSenderIdx,
  scheduledDate, setScheduledDate,
  scheduledTime, setScheduledTime,
  abTestPercent, setAbTestPercent,
  abWinnerCriteria, setAbWinnerCriteria,
  enableAB,
}) {
  return (
    <div>
      <h3 style={sectionTitle}>Remitente y programación</h3>

      <label style={labelStyle}>¿Quién envía?</label>
      <select
        value={senderIdx}
        onChange={e => setSenderIdx(Number(e.target.value))}
        style={{ ...inputStyle, marginBottom: 14 }}
      >
        {TEAM_MEMBERS.map((m, i) => (
          <option key={m.email} value={i}>
            {m.name} ({m.email})
          </option>
        ))}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Fecha de envío</label>
          <input
            type="date" value={scheduledDate}
            onChange={e => setScheduledDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Hora (CET)</label>
          <input
            type="time" value={scheduledTime}
            onChange={e => setScheduledTime(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {campaignType === 'mass' && enableAB && (
        <>
          <label style={labelStyle}>
            Porcentaje A/B test: {abTestPercent}%
          </label>
          <input
            type="range" min="10" max="50" step="5"
            value={abTestPercent}
            onChange={e => setAbTestPercent(Number(e.target.value))}
            style={{ width: '100%', marginBottom: 14 }}
          />
          <p style={{ fontSize: 11, color: '#6B7F94', marginBottom: 14 }}>
            El {abTestPercent}% recibirá el test (mitad A, mitad B).
            El {100 - abTestPercent}% recibirá la variante ganadora.
          </p>

          <label style={labelStyle}>Criterio para elegir ganador</label>
          <select
            value={abWinnerCriteria}
            onChange={e => setAbWinnerCriteria(e.target.value)}
            style={{ ...inputStyle, marginBottom: 14 }}
          >
            <option value="aperturas">Tasa de apertura</option>
            <option value="clics">Tasa de clics</option>
            <option value="respuestas">Tasa de respuesta</option>
          </select>
        </>
      )}

      {campaignType === 'individual_followup' && (
        <div style={{
          padding: 12, background: '#F5F3FF', borderRadius: 8,
          border: '1px solid #DDD6FE', fontSize: 12, color: '#6B21A8',
        }}>
          La noche anterior se generará el borrador con Gemini. A la hora programada se envía automáticamente si el contacto no ha respondido.
        </div>
      )}
    </div>
  );
}

// ── Step 5: Review ────────────────────────────────────────────────
function StepReview({
  campaignType, name, subjectA, bodyA, subjectB, bodyB,
  enableAB, instructions, sender, scheduledDate, scheduledTime,
  abTestPercent, abWinnerCriteria, recipientCount,
}) {
  const isFollowUp = campaignType === 'individual_followup';
  const dateStr = scheduledDate
    ? new Date(`${scheduledDate}T${scheduledTime || '10:00'}`).toLocaleString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      })
    : 'Inmediato';

  return (
    <div>
      <h3 style={sectionTitle}>Revisar antes de crear</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ReviewRow label="Tipo" value={isFollowUp ? 'Follow-up 1-a-1' : 'Campaña masiva'} />
        {!isFollowUp && <ReviewRow label="Nombre" value={name} />}
        <ReviewRow label="Destinatarios" value={`${recipientCount} contacto${recipientCount !== 1 ? 's' : ''}`} />
        <ReviewRow label="Remitente" value={`${sender.name} (${sender.email})`} />
        <ReviewRow label="Envío" value={dateStr} />

        {isFollowUp ? (
          <ReviewRow label="Instrucciones IA" value={instructions} />
        ) : (
          <>
            <ReviewRow label="Asunto A" value={subjectA} />
            {enableAB && (
              <>
                <ReviewRow label="Asunto B" value={subjectB} />
                <ReviewRow label="Test A/B" value={`${abTestPercent}% · Criterio: ${abWinnerCriteria}`} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div style={{
      padding: '10px 14px', background: '#F7F9FC', borderRadius: 8,
      border: '1px solid #E2E8F0',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7F94', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#1A2B3D', whiteSpace: 'pre-wrap' }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────
const sectionTitle = {
  margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#1A2B3D',
};

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
