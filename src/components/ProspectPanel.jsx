import { useState, useEffect } from 'react';
import {
  updateProspect,
  createProspect,
  deleteProspect,
  convertToOpportunity,
  PROSPECT_STAGES,
  PROSPECT_STAGE_COLORS,
  PROSPECT_STAGE_SHORT,
  ORIGIN_OPTIONS,
  TEAM_MEMBERS,
} from '../utils/airtableProspects';

/**
 * ProspectPanel - Slide-in panel for creating/editing Prospects
 *
 * @param {object} prospect - Normalized prospect object (null when closed)
 * @param {boolean} isNew - True when creating a new prospect
 * @param {string} initialStage - Pre-selected stage for new prospects
 * @param {function} onClose - Called when panel closes
 * @param {function} onSaved - Called after successful save/create
 * @param {function} onDeleted - Called after successful delete
 * @param {function} onConverted - Called after conversion to opportunity
 */
export default function ProspectPanel({
  prospect,
  isNew,
  initialStage,
  onClose,
  onSaved,
  onDeleted,
  onConverted,
}) {
  if (!prospect && !isNew) return null;

  const [formData, setFormData] = useState({
    name: '',
    stage: initialStage || 'Lead',
    amount: '',
    currency: 'EUR',
    product: '',
    origin: '',
    context: '',
    nextSteps: '',
    assignedTo: '',
    assignedEmail: '',
  });

  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (isNew) {
      setFormData({
        name: '',
        stage: initialStage || 'Lead',
        amount: '',
        currency: 'EUR',
        product: '',
        origin: '',
        context: '',
        nextSteps: '',
        assignedTo: '',
        assignedEmail: '',
      });
    } else if (prospect) {
      setFormData({
        name: prospect.name || '',
        stage: prospect.stage || 'Lead',
        amount: prospect.amount ? String(prospect.amount) : '',
        currency: prospect.currency || 'EUR',
        product: prospect.product || '',
        origin: prospect.origin || '',
        context: prospect.context || '',
        nextSteps: prospect.nextSteps || '',
        assignedTo: prospect.assignedTo || '',
        assignedEmail: prospect.assignedEmail || '',
      });
    }
  }, [prospect, isNew, initialStage]);

  const showFeedback = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const formatAmount = (value) => {
    if (!value) return '';
    const num = parseFloat(String(value).replace(/[^\d.]/g, ''));
    if (isNaN(num)) return '';
    return new Intl.NumberFormat('es-ES').format(num);
  };

  const parseAmount = (formatted) => {
    if (!formatted) return 0;
    const cleaned = String(formatted).replace(/[^\d]/g, '');
    return parseFloat(cleaned) || 0;
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      showFeedback('error', 'El nombre del prospect es obligatorio');
      return false;
    }
    if (!formData.stage) {
      showFeedback('error', 'Debes seleccionar un stage');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const fields = {
        'Prospect Name': formData.name.trim(),
        'Stage': formData.stage,
        'Amount': parseAmount(formData.amount),
        'Currency': formData.currency,
        'Product': formData.product || undefined,
        'Origin': formData.origin || undefined,
        'Context': formData.context.trim(),
        'Next Steps': formData.nextSteps.trim(),
        'Assigned To': formData.assignedTo || undefined,
        'Assigned Email': formData.assignedEmail.trim() || undefined,
      };

      // Remove undefined fields (Airtable doesn't like undefined in single-select)
      Object.keys(fields).forEach(k => {
        if (fields[k] === undefined) delete fields[k];
      });

      let result;
      if (isNew) {
        // Add Record Status for new records
        fields['Record Status'] = 'Active';
        result = await createProspect(fields);
        showFeedback('success', 'Prospect creado correctamente');
      } else {
        result = await updateProspect(prospect.id, fields);
        showFeedback('success', 'Prospect actualizado correctamente');
      }

      if (onSaved) onSaved(result);

      setTimeout(() => { onClose(); }, 1000);
    } catch (error) {
      console.error('Error saving prospect:', error);
      showFeedback('error', error.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (isNew || !prospect?.id) return;

    setLoading(true);
    try {
      await deleteProspect(prospect.id);
      showFeedback('success', 'Prospect eliminado');

      if (onDeleted) onDeleted(prospect.id);

      setTimeout(() => {
        setShowDeleteConfirm(false);
        onClose();
      }, 1000);
    } catch (error) {
      console.error('Error deleting prospect:', error);
      showFeedback('error', error.message || 'Error al eliminar');
      setShowDeleteConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  const handleConvert = async () => {
    if (isNew || !prospect?.id) return;

    setLoading(true);
    try {
      const result = await convertToOpportunity(prospect);
      showFeedback('success', `Convertido a Oportunidad: ${prospect.name}`);

      if (onConverted) onConverted(result);

      setTimeout(() => { onClose(); }, 1500);
    } catch (error) {
      console.error('Error converting prospect:', error);
      showFeedback('error', error.message || 'Error al convertir');
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !loading) onClose();
  };

  const currentStageColor = PROSPECT_STAGE_COLORS[formData.stage] || { bg: '#F7F9FC', color: '#1A2B3D', border: '#E2E8F0' };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(26, 43, 61, 0.4)',
          backdropFilter: 'blur(2px)',
          zIndex: 100,
          animation: 'fadeIn 0.2s ease-out',
        }}
      />

      {/* Panel */}
      <div
        className="slide-in"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 460, maxWidth: '100vw',
          background: '#FFFFFF', zIndex: 101,
          overflow: 'auto',
          boxShadow: '-8px 0 32px rgba(26, 43, 61, 0.12)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '24px 28px',
          borderBottom: '1px solid #E2E8F0',
          background: '#F7F9FC',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {/* Prospect badge */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32,
                  background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
                  borderRadius: 8,
                  fontSize: 13, fontWeight: 800, color: '#FFFFFF',
                  letterSpacing: '0.5px',
                }}>
                  PR
                </div>
                <h2 style={{
                  margin: 0, fontSize: 22, fontWeight: 800,
                  color: '#1A2B3D', letterSpacing: '-0.5px', lineHeight: 1.2,
                }}>
                  {isNew ? 'Nuevo prospect' : (formData.name || 'Editar prospect')}
                </h2>
              </div>
              {!isNew && prospect?.id && (
                <div style={{
                  fontSize: 12, color: '#6B7F94',
                  fontWeight: 500, fontFamily: 'monospace',
                }}>
                  {prospect.id}
                </div>
              )}
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              disabled={loading}
              style={{
                background: 'transparent', border: 'none',
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: loading ? 'not-allowed' : 'pointer',
                borderRadius: 6, color: '#6B7F94', fontSize: 20,
                transition: 'all 0.15s',
                opacity: loading ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = '#E2E8F0';
                  e.currentTarget.style.color = '#1A2B3D';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#6B7F94';
              }}
            >
              \u2715
            </button>
          </div>
        </div>

        {/* Form */}
        <div style={{ flex: 1, padding: 28, overflow: 'auto' }}>
          {/* Prospect Name */}
          <FormField label="Nombre de la empresa" required>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Ej: Solaria Energia"
              disabled={loading}
              style={inputStyle(loading)}
              onFocus={focusStyle}
              onBlur={blurStyle}
            />
          </FormField>

          {/* Stage */}
          <FormField label="Stage" required>
            <div style={{ marginBottom: 8 }}>
              <select
                value={formData.stage}
                onChange={(e) => updateField('stage', e.target.value)}
                disabled={loading}
                style={selectStyle(loading)}
                onFocus={focusStyle}
                onBlur={blurStyle}
              >
                {PROSPECT_STAGES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {formData.stage && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px',
                background: currentStageColor.bg,
                color: currentStageColor.color,
                border: `1px solid ${currentStageColor.border}`,
                borderRadius: 6, fontSize: 12, fontWeight: 600,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: currentStageColor.color,
                }} />
                {PROSPECT_STAGE_SHORT[formData.stage] || formData.stage}
              </div>
            )}
          </FormField>

          {/* Amount + Currency */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
            <FormField label="Importe">
              <input
                type="text"
                value={formData.amount}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^\d]/g, '');
                  updateField('amount', value);
                }}
                placeholder="0"
                disabled={loading}
                style={{ ...inputStyle(loading), textAlign: 'right', fontWeight: 600 }}
                onFocus={focusStyle}
                onBlur={(e) => {
                  blurStyle(e);
                  if (formData.amount) {
                    updateField('amount', String(parseAmount(formData.amount)));
                  }
                }}
              />
              {formData.amount && (
                <div style={{
                  marginTop: 6, fontSize: 12, color: '#6B7F94',
                  textAlign: 'right', fontWeight: 500,
                }}>
                  {formatAmount(formData.amount)} {formData.currency}
                </div>
              )}
            </FormField>

            <FormField label="Moneda">
              <select
                value={formData.currency}
                onChange={(e) => updateField('currency', e.target.value)}
                disabled={loading}
                style={{ ...selectStyle(loading), width: 90 }}
                onFocus={focusStyle}
                onBlur={blurStyle}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </select>
            </FormField>
          </div>

          {/* Product */}
          <FormField label="Producto">
            <input
              type="text"
              value={formData.product}
              onChange={(e) => updateField('product', e.target.value)}
              placeholder="(pendiente de definir)"
              disabled={loading}
              style={inputStyle(loading)}
              onFocus={focusStyle}
              onBlur={blurStyle}
            />
          </FormField>

          {/* Origin */}
          <FormField label="Origen">
            <select
              value={formData.origin}
              onChange={(e) => updateField('origin', e.target.value)}
              disabled={loading}
              style={selectStyle(loading)}
              onFocus={focusStyle}
              onBlur={blurStyle}
            >
              <option value="">-- Seleccionar --</option>
              {ORIGIN_OPTIONS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </FormField>

          {/* Context */}
          <FormField label="Contexto / Notas de reunion">
            <textarea
              value={formData.context}
              onChange={(e) => updateField('context', e.target.value)}
              placeholder="Notas de reunion, transcripcion, contexto..."
              disabled={loading}
              rows={5}
              style={textareaStyle(loading)}
              onFocus={focusStyle}
              onBlur={blurStyle}
            />
          </FormField>

          {/* Next Steps */}
          <FormField label="Proximos pasos">
            <textarea
              value={formData.nextSteps}
              onChange={(e) => updateField('nextSteps', e.target.value)}
              placeholder="Tareas pendientes, siguiente reunion..."
              disabled={loading}
              rows={3}
              style={textareaStyle(loading)}
              onFocus={focusStyle}
              onBlur={blurStyle}
            />
          </FormField>

          {/* Assigned To */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Asignado a">
              <select
                value={formData.assignedTo}
                onChange={(e) => updateField('assignedTo', e.target.value)}
                disabled={loading}
                style={selectStyle(loading)}
                onFocus={focusStyle}
                onBlur={blurStyle}
              >
                <option value="">-- Sin asignar --</option>
                {TEAM_MEMBERS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </FormField>

            {/* Show email field when "Otro" is selected */}
            {formData.assignedTo === 'Otro' && (
              <FormField label="Email del asignado">
                <input
                  type="email"
                  value={formData.assignedEmail}
                  onChange={(e) => updateField('assignedEmail', e.target.value)}
                  placeholder="nombre@empresa.com"
                  disabled={loading}
                  style={inputStyle(loading)}
                  onFocus={focusStyle}
                  onBlur={blurStyle}
                />
              </FormField>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '20px 28px',
          borderTop: '1px solid #E2E8F0',
          background: '#F7F9FC',
          flexShrink: 0,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          {/* Delete button (edit mode only) */}
          {!isNew && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={loading}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: 600,
                color: '#EF4444', background: 'transparent',
                border: '2px solid #FEE2E2', borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s', fontFamily: 'inherit',
                opacity: loading ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = '#FEF2F2';
                  e.currentTarget.style.borderColor = '#FECACA';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = '#FEE2E2';
              }}
            >
              Eliminar
            </button>
          )}

          {/* Convert button (edit mode, not already converted) */}
          {!isNew && !prospect?.converted && (
            <button
              onClick={handleConvert}
              disabled={loading}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: 600,
                color: '#8B5CF6', background: '#EDE9FE',
                border: '2px solid #C4B5FD', borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s', fontFamily: 'inherit',
                opacity: loading ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = '#DDD6FE';
                  e.currentTarget.style.borderColor = '#8B5CF6';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#EDE9FE';
                e.currentTarget.style.borderColor = '#C4B5FD';
              }}
            >
              Convertir a Oportunidad
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={loading}
            style={{
              padding: '12px 28px', fontSize: 14, fontWeight: 700,
              color: '#FFFFFF',
              background: loading ? '#94A3B8' : 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
              border: 'none', borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s', fontFamily: 'inherit',
              boxShadow: loading ? 'none' : '0 2px 8px rgba(139, 92, 246, 0.25)',
              display: 'flex', alignItems: 'center', gap: 8,
              minWidth: 120, justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.35)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(139, 92, 246, 0.25)';
            }}
          >
            {loading ? (
              <>
                <Spinner />
                Guardando...
              </>
            ) : (
              isNew ? 'Crear prospect' : 'Guardar cambios'
            )}
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <>
          <div
            onClick={() => !loading && setShowDeleteConfirm(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(26, 43, 61, 0.6)',
              zIndex: 150,
            }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#FFFFFF', borderRadius: 12, padding: 28,
            maxWidth: 420, width: '90%',
            border: '1px solid #E2E8F0',
            boxShadow: '0 20px 60px rgba(26, 43, 61, 0.3)',
            zIndex: 151,
          }}>
            <div style={{
              fontSize: 20, fontWeight: 800, color: '#1A2B3D',
              marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              Confirmar eliminacion
            </div>
            <div style={{
              fontSize: 14, color: '#6B7F94', lineHeight: 1.6, marginBottom: 24,
            }}>
              Vas a eliminar el prospect <strong>{formData.name}</strong>. Esta accion no se puede deshacer.
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
                style={{
                  padding: '10px 20px', fontSize: 14, fontWeight: 600,
                  color: '#6B7F94', background: '#F7F9FC',
                  border: '2px solid #E2E8F0', borderRadius: 8,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: loading ? 0.5 : 1,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                style={{
                  padding: '10px 20px', fontSize: 14, fontWeight: 700,
                  color: '#FFFFFF', background: loading ? '#94A3B8' : '#EF4444',
                  border: 'none', borderRadius: 8,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                {loading ? (<><Spinner /> Eliminando...</>) : 'Eliminar'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {feedback && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: feedback.type === 'success' ? '#10B981' : '#EF4444',
          color: '#FFFFFF', padding: '14px 20px', borderRadius: 10,
          fontSize: 14, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 200,
          display: 'flex', alignItems: 'center', gap: 10, maxWidth: 400,
          animation: 'slideInUp 0.3s ease-out',
        }}>
          <span style={{ fontSize: 18 }}>
            {feedback.type === 'success' ? '\u2713' : '\u2717'}
          </span>
          {feedback.message}
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .slide-in {
          animation: slideInRight 0.25s ease-out;
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

// ── Reusable sub-components ─────────────────────────────────────────

function FormField({ label, required, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 700,
        color: '#6B7F94', textTransform: 'uppercase',
        letterSpacing: '0.5px', marginBottom: 8,
      }}>
        {label}
        {required && <span style={{ color: '#EF4444', marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 14, height: 14,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#FFFFFF',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Shared style helpers ────────────────────────────────────────────

function inputStyle(loading) {
  return {
    width: '100%', padding: '10px 12px',
    fontSize: 14, fontWeight: 500, color: '#1A2B3D',
    background: '#FFFFFF', border: '2px solid #E2E8F0',
    borderRadius: 8, outline: 'none',
    transition: 'all 0.15s', fontFamily: 'inherit',
    opacity: loading ? 0.6 : 1,
    cursor: loading ? 'not-allowed' : 'text',
  };
}

function selectStyle(loading) {
  return {
    width: '100%', padding: '10px 12px',
    fontSize: 14, fontWeight: 500, color: '#1A2B3D',
    background: '#FFFFFF', border: '2px solid #E2E8F0',
    borderRadius: 8, outline: 'none',
    cursor: loading ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', opacity: loading ? 0.6 : 1,
    transition: 'all 0.15s',
  };
}

function textareaStyle(loading) {
  return {
    width: '100%', padding: '10px 12px',
    fontSize: 14, fontWeight: 400, color: '#1A2B3D',
    background: '#FFFFFF', border: '2px solid #E2E8F0',
    borderRadius: 8, outline: 'none',
    transition: 'all 0.15s', fontFamily: 'inherit',
    opacity: loading ? 0.6 : 1,
    cursor: loading ? 'not-allowed' : 'text',
    resize: 'vertical', minHeight: 80, lineHeight: 1.5,
  };
}

function focusStyle(e) {
  e.currentTarget.style.borderColor = '#8B5CF6';
  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(139, 92, 246, 0.1)';
}

function blurStyle(e) {
  e.currentTarget.style.borderColor = '#E2E8F0';
  e.currentTarget.style.boxShadow = 'none';
}
