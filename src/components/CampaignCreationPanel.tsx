import { useState, useCallback, useMemo } from 'react';
import { createCampaign, scheduleFollowUp } from '../utils/campaignApi';
import { getSenders, addSender, removeSender } from '../utils/senderConfig';
import CandidateSearchView from './CandidateSearchView';

const STEPS = [
  { id: 1, label: 'Tipo' },
  { id: 2, label: 'Configuracion' },
  { id: 3, label: 'Email' },
  { id: 4, label: 'Candidatas' },
  { id: 5, label: 'Remitente' },
  { id: 6, label: 'Revisar' },
];

/**
 * CampaignCreationPanel — 6-step wizard to create a campaign or follow-up.
 */
export default function CampaignCreationPanel({ onClose, onCreated, allCompanies = [] }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: Type
  const [campaignType, setCampaignType] = useState(null); // 'mass' | 'individual_followup'

  // Step 2: Config
  const [name, setName] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const [knowledgeBase, setKnowledgeBase] = useState('');

  // Step 3: Email content
  const [subjectA, setSubjectA] = useState('');
  const [bodyA, setBodyA] = useState('');
  const [subjectB, setSubjectB] = useState('');
  const [bodyB, setBodyB] = useState('');
  const [enableAB, setEnableAB] = useState(false);
  const [abTestPercent, setAbTestPercent] = useState(20);
  const [abWinnerCriteria, setAbWinnerCriteria] = useState('aperturas');
  const [instructions, setInstructions] = useState(''); // follow-up AI

  // Step 4: Candidates (from CandidateSearchView embedded)
  const [recipients, setRecipients] = useState([]);
  const [manualEmails, setManualEmails] = useState('');
  const campaignRef = useMemo(() => getCampaignRef(name), [name]);

  // Step 5: Sender
  const [senders, setSenders] = useState(() => getSenders());
  const [selectedSender, setSelectedSender] = useState(0);
  const [showAddSender, setShowAddSender] = useState(false);
  const [newSenderName, setNewSenderName] = useState('');
  const [newSenderEmail, setNewSenderEmail] = useState('');

  const sender = senders[selectedSender] || senders[0] || { name: '', email: '' };

  const handleRecipientsChange = useCallback((list) => {
    setRecipients(list);
  }, []);

  function getRecipientList() {
    const list = [...recipients];
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

  function canProceed() {
    switch (step) {
      case 1: return !!campaignType;
      case 2:
        if (campaignType === 'individual_followup') return true;
        return name.trim().length > 0;
      case 3:
        if (campaignType === 'individual_followup') return instructions.trim().length > 0;
        return subjectA.trim().length > 0 && bodyA.trim().length > 0;
      case 4:
        if (campaignType === 'individual_followup') return manualEmails.trim().length > 0;
        return getRecipientList().length > 0;
      case 5: return senders.length > 0;
      case 6: return true;
      default: return false;
    }
  }

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      if (campaignType === 'individual_followup') {
        const emails = getRecipientList();
        for (const r of emails) {
          await scheduleFollowUp({
            email: r.email,
            name: r.name || '',
            organization: r.organization || '',
            instructions,
            knowledgeBase,
            scheduledAt: scheduledDate && scheduledTime
              ? `${scheduledDate}T${scheduledTime}:00`
              : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            senderEmail: sender.email,
            senderName: sender.name,
          });
        }
      } else {
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
          knowledgeBase,
          scheduledAt: scheduledDate && scheduledTime
            ? `${scheduledDate}T${scheduledTime}:00`
            : undefined,
          recipients: getRecipientList(),
        });
      }
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleAddSender() {
    if (newSenderName.trim() && newSenderEmail.trim()) {
      const updated = addSender({ name: newSenderName.trim(), email: newSenderEmail.trim() });
      setSenders(updated);
      setNewSenderName('');
      setNewSenderEmail('');
      setShowAddSender(false);
    }
  }

  function handleRemoveSender(email) {
    const updated = removeSender(email);
    setSenders(updated);
    if (selectedSender >= updated.length) setSelectedSender(Math.max(0, updated.length - 1));
  }

  // For follow-up, skip step 4 (Candidatas) — use simplified manual input
  const effectiveSteps = campaignType === 'individual_followup'
    ? STEPS // still show all but step 4 has manual input
    : STEPS;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.35)', zIndex: 99,
      }} />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 960,
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
              Nueva campana
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7F94' }}>
              Paso {step} de 6 \u2014 {effectiveSteps[step - 1].label}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E8F0',
            background: 'transparent', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6B7F94',
          }}>\u00d7</button>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '12px 24px', display: 'flex', gap: 4 }}>
          {effectiveSteps.map(s => (
            <div key={s.id} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: s.id <= step ? '#3B82F6' : '#E2E8F0',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
          {step === 1 && <StepType campaignType={campaignType} setCampaignType={setCampaignType} />}
          {step === 2 && (
            <StepConfig
              campaignType={campaignType}
              name={name} setName={setName}
              scheduledDate={scheduledDate} setScheduledDate={setScheduledDate}
              scheduledTime={scheduledTime} setScheduledTime={setScheduledTime}
              knowledgeBase={knowledgeBase} setKnowledgeBase={setKnowledgeBase}
            />
          )}
          {step === 3 && (
            <StepEmail
              campaignType={campaignType}
              subjectA={subjectA} setSubjectA={setSubjectA}
              bodyA={bodyA} setBodyA={setBodyA}
              subjectB={subjectB} setSubjectB={setSubjectB}
              bodyB={bodyB} setBodyB={setBodyB}
              enableAB={enableAB} setEnableAB={setEnableAB}
              abTestPercent={abTestPercent} setAbTestPercent={setAbTestPercent}
              abWinnerCriteria={abWinnerCriteria} setAbWinnerCriteria={setAbWinnerCriteria}
              instructions={instructions} setInstructions={setInstructions}
            />
          )}
          {step === 4 && (
            campaignType === 'mass' ? (
              <div>
                <h3 style={sectionTitle}>Seleccionar candidatas</h3>
                <CandidateSearchView
                  allCompanies={allCompanies}
                  campaignRef={campaignRef}
                  embeddedMode
                  onRecipientsChange={handleRecipientsChange}
                />
                {/* Manual fallback */}
                <div style={{ marginTop: 16 }}>
                  <label style={labelStyle}>Emails adicionales (uno por linea)</label>
                  <textarea
                    value={manualEmails}
                    onChange={e => setManualEmails(e.target.value)}
                    placeholder="nombre@empresa.com"
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>
                <p style={{ fontSize: 12, color: '#6B7F94', marginTop: 8 }}>
                  {getRecipientList().length} contacto{getRecipientList().length !== 1 ? 's' : ''} seleccionados
                </p>
              </div>
            ) : (
              <div>
                <h3 style={sectionTitle}>Destinatarios del follow-up</h3>
                <label style={labelStyle}>Emails (uno por linea)</label>
                <textarea
                  value={manualEmails}
                  onChange={e => setManualEmails(e.target.value)}
                  placeholder="nombre@empresa.com&#10;otro@empresa.com"
                  rows={5}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
                <p style={{ fontSize: 11, color: '#6B7F94', marginTop: 8 }}>
                  {manualEmails.trim() ? manualEmails.trim().split('\n').filter(l => l.trim()).length : 0} email(s)
                </p>
              </div>
            )
          )}
          {step === 5 && (
            <StepSender
              senders={senders}
              selectedSender={selectedSender} setSelectedSender={setSelectedSender}
              showAddSender={showAddSender} setShowAddSender={setShowAddSender}
              newSenderName={newSenderName} setNewSenderName={setNewSenderName}
              newSenderEmail={newSenderEmail} setNewSenderEmail={setNewSenderEmail}
              onAddSender={handleAddSender}
              onRemoveSender={handleRemoveSender}
            />
          )}
          {step === 6 && (
            <StepReview
              campaignType={campaignType}
              name={name} subjectA={subjectA} bodyA={bodyA}
              subjectB={subjectB} bodyB={bodyB}
              enableAB={enableAB} instructions={instructions}
              sender={sender}
              scheduledDate={scheduledDate} scheduledTime={scheduledTime}
              abTestPercent={abTestPercent} abWinnerCriteria={abWinnerCriteria}
              recipientCount={getRecipientList().length}
              knowledgeBase={knowledgeBase}
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

        {/* Footer */}
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
          >{step > 1 ? '\u2190 Atras' : 'Cancelar'}</button>

          {step < 6 ? (
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
            >Siguiente \u2192</button>
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
            >{loading ? 'Creando...' : 'Crear campana'}</button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Helper: generate campaignRef from name ──
const _fallbackRef = 'Campaign_' + Date.now().toString(36);
function getCampaignRef(name) {
  if (!name.trim()) return _fallbackRef;
  return name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
}

// ── Step 1: Type ──────────────────────────────────────────────────
function StepType({ campaignType, setCampaignType }) {
  const types = [
    {
      id: 'mass',
      icon: '\ud83d\udce8',
      title: 'Campana masiva',
      desc: 'Envio a lista de contactos con A/B testing, tracking de aperturas y clics.',
    },
    {
      id: 'individual_followup',
      icon: '\u2709',
      title: 'Follow-up 1-a-1',
      desc: 'Email personalizado generado por IA, con envio automatico en la fecha que elijas.',
    },
  ];

  return (
    <div>
      <h3 style={sectionTitle}>Que tipo de envio quieres crear?</h3>
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
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1A2B3D', marginBottom: 6 }}>{t.title}</div>
            <div style={{ fontSize: 12, color: '#6B7F94', lineHeight: 1.5 }}>{t.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: Config + KB ───────────────────────────────────────────
function StepConfig({
  campaignType, name, setName,
  scheduledDate, setScheduledDate, scheduledTime, setScheduledTime,
  knowledgeBase, setKnowledgeBase,
}) {
  return (
    <div>
      <h3 style={sectionTitle}>Configuracion</h3>

      {campaignType !== 'individual_followup' && (
        <>
          <label style={labelStyle}>Nombre de la campana</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Bridge Debt \u2014 Ola 2"
            style={{ ...inputStyle, marginBottom: 14 }}
          />
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Fecha de envio</label>
          <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Hora (CET)</label>
          <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} style={inputStyle} />
        </div>
      </div>

      <label style={labelStyle}>Base de conocimiento</label>
      <textarea
        value={knowledgeBase} onChange={e => setKnowledgeBase(e.target.value)}
        placeholder="Describe el producto, propuesta de valor, proximos pasos esperados..."
        rows={8}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <p style={{ fontSize: 11, color: '#6B7F94', marginTop: 4 }}>
        Este texto sera usado por la IA para generar borradores y respuestas personalizadas.
      </p>
    </div>
  );
}

// ── Step 3: Email ─────────────────────────────────────────────────
function StepEmail({
  campaignType,
  subjectA, setSubjectA, bodyA, setBodyA,
  subjectB, setSubjectB, bodyB, setBodyB,
  enableAB, setEnableAB,
  abTestPercent, setAbTestPercent, abWinnerCriteria, setAbWinnerCriteria,
  instructions, setInstructions,
}) {
  if (campaignType === 'individual_followup') {
    return (
      <div>
        <h3 style={sectionTitle}>Instrucciones para la IA</h3>
        <p style={{ fontSize: 12, color: '#6B7F94', marginBottom: 12 }}>
          Describe en lenguaje natural que quieres decir. Gemini generara el email personalizado.
        </p>
        <textarea
          value={instructions} onChange={e => setInstructions(e.target.value)}
          placeholder="Ej: Recuerdale que tenemos una reunion el jueves y que necesitamos el NDA firmado antes."
          rows={6}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
    );
  }

  return (
    <div>
      <h3 style={sectionTitle}>Contenido del email</h3>

      {/* Variante A */}
      <div style={{
        padding: 14, background: '#F7F9FC', borderRadius: 8,
        border: '1px solid #E2E8F0', marginBottom: 12,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#3B82F6', marginBottom: 8 }}>
          Variante A {!enableAB && '(unica)'}
        </div>
        <label style={labelStyle}>Asunto</label>
        <input type="text" value={subjectA} onChange={e => setSubjectA(e.target.value)}
          placeholder="Asunto del email" style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={labelStyle}>Cuerpo (HTML)</label>
        <textarea value={bodyA} onChange={e => setBodyA(e.target.value)}
          placeholder="<p>Hola {{nombre}},</p>..." rows={6}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }} />
      </div>

      {/* A/B toggle */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 13, color: '#334155', cursor: 'pointer', marginBottom: 12,
      }}>
        <input type="checkbox" checked={enableAB} onChange={e => setEnableAB(e.target.checked)} />
        Activar test A/B (anadir Variante B)
      </label>

      {/* Variante B */}
      {enableAB && (
        <div style={{
          padding: 14, background: '#FFFBEB', borderRadius: 8,
          border: '1px solid #FDE68A', marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#D97706', marginBottom: 8 }}>Variante B</div>
          <label style={labelStyle}>Asunto</label>
          <input type="text" value={subjectB} onChange={e => setSubjectB(e.target.value)}
            placeholder="Asunto alternativo" style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Cuerpo (HTML)</label>
          <textarea value={bodyB} onChange={e => setBodyB(e.target.value)}
            placeholder="<p>Hola {{nombre}},</p>..." rows={6}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }} />
        </div>
      )}

      {enableAB && (
        <>
          <label style={labelStyle}>Porcentaje A/B test: {abTestPercent}%</label>
          <input type="range" min="10" max="50" step="5" value={abTestPercent}
            onChange={e => setAbTestPercent(Number(e.target.value))} style={{ width: '100%', marginBottom: 8 }} />
          <p style={{ fontSize: 11, color: '#6B7F94', marginBottom: 14 }}>
            El {abTestPercent}% recibira el test (mitad A, mitad B). El {100 - abTestPercent}% recibira la variante ganadora.
          </p>
          <label style={labelStyle}>Criterio para elegir ganador</label>
          <select value={abWinnerCriteria} onChange={e => setAbWinnerCriteria(e.target.value)}
            style={{ ...inputStyle, marginBottom: 14 }}>
            <option value="aperturas">Tasa de apertura</option>
            <option value="clics">Tasa de clics</option>
            <option value="respuestas">Tasa de respuesta</option>
          </select>
        </>
      )}
    </div>
  );
}

// ── Step 5: Sender ────────────────────────────────────────────────
function StepSender({
  senders, selectedSender, setSelectedSender,
  showAddSender, setShowAddSender,
  newSenderName, setNewSenderName, newSenderEmail, setNewSenderEmail,
  onAddSender, onRemoveSender,
}) {
  return (
    <div>
      <h3 style={sectionTitle}>Remitente</h3>

      <label style={labelStyle}>Quien envia?</label>
      <select
        value={selectedSender}
        onChange={e => setSelectedSender(Number(e.target.value))}
        style={{ ...inputStyle, marginBottom: 14 }}
      >
        {senders.map((s, i) => (
          <option key={s.email} value={i}>{s.name} ({s.email})</option>
        ))}
      </select>

      {/* Manage senders */}
      <button
        onClick={() => setShowAddSender(!showAddSender)}
        style={{
          padding: '4px 12px', borderRadius: 6, border: '1px solid #E2E8F0',
          background: 'transparent', color: '#6B7F94', fontSize: 12,
          cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12,
        }}
      >{showAddSender ? 'Ocultar gestion' : 'Gestionar remitentes'}</button>

      {showAddSender && (
        <div style={{
          padding: 14, background: '#F7F9FC', borderRadius: 8,
          border: '1px solid #E2E8F0',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1A2B3D', marginBottom: 10 }}>Remitentes configurados</div>

          {senders.map(s => (
            <div key={s.email} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 0', borderBottom: '1px solid #E2E8F0',
            }}>
              <span style={{ fontSize: 13, color: '#334155' }}>{s.name} ({s.email})</span>
              <button
                onClick={() => onRemoveSender(s.email)}
                style={{
                  padding: '2px 8px', borderRadius: 4, border: '1px solid #FECACA',
                  background: '#FEF2F2', color: '#DC2626', fontSize: 10, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >Quitar</button>
            </div>
          ))}

          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="text" placeholder="Nombre" value={newSenderName}
              onChange={e => setNewSenderName(e.target.value)}
              style={{ ...inputStyle, flex: 1 }} />
            <input type="email" placeholder="email@empresa.com" value={newSenderEmail}
              onChange={e => setNewSenderEmail(e.target.value)}
              style={{ ...inputStyle, flex: 1 }} />
            <button onClick={onAddSender} style={{
              padding: '8px 14px', borderRadius: 6, border: 'none',
              background: '#3B82F6', color: '#FFFFFF', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>Anadir</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 6: Review ────────────────────────────────────────────────
function StepReview({
  campaignType, name, subjectA, bodyA, subjectB, bodyB,
  enableAB, instructions, sender, scheduledDate, scheduledTime,
  abTestPercent, abWinnerCriteria, recipientCount, knowledgeBase,
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
        <ReviewRow label="Tipo" value={isFollowUp ? 'Follow-up 1-a-1' : 'Campana masiva'} />
        {!isFollowUp && <ReviewRow label="Nombre" value={name} />}
        <ReviewRow label="Destinatarios" value={`${recipientCount} contacto${recipientCount !== 1 ? 's' : ''}`} />
        <ReviewRow label="Remitente" value={`${sender.name} (${sender.email})`} />
        <ReviewRow label="Envio" value={dateStr} />

        {isFollowUp ? (
          <ReviewRow label="Instrucciones IA" value={instructions} />
        ) : (
          <>
            <ReviewRow label="Asunto A" value={subjectA} />
            {enableAB && (
              <>
                <ReviewRow label="Asunto B" value={subjectB} />
                <ReviewRow label="Test A/B" value={`${abTestPercent}% \u00b7 Criterio: ${abWinnerCriteria}`} />
              </>
            )}
          </>
        )}

        {knowledgeBase && (
          <ReviewRow label="Base conocimiento" value={knowledgeBase.slice(0, 200) + (knowledgeBase.length > 200 ? '...' : '')} />
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
        {value || '\u2014'}
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
