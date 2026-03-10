import { useState, useEffect, useRef } from 'react';
import {
  updateOpportunity,
  createOpportunity,
  deleteOpportunity,
  KANBAN_STAGES,
  STAGE_COLORS,
  STAGE_SHORT_LABELS
} from '../utils/airtable';
import { TEAM_MEMBERS } from '../utils/airtableProspects';

// ── Dark theme tokens ────────────────────────────────────────────
const DK = {
  bg: '#0A1628',
  card: '#132238',
  border: '#1B3A5C',
  surface: '#1E293B',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  accent: '#3B82F6',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444',
};

const RADIUS = { sm: 6, md: 10, lg: 14 };

/**
 * OpportunityPanel - Slide-in panel for creating/editing Airtable opportunities
 *
 * @param {object} opportunity - Normalized opportunity object (null when closed)
 * @param {boolean} isNew - True when creating a new opportunity
 * @param {string} initialStage - Pre-selected stage for new opportunities
 * @param {function} onClose - Called when panel closes
 * @param {function} onSaved - Called after successful save/create with updated record
 * @param {function} onDeleted - Called after successful delete with recordId
 */
export default function OpportunityPanel({
  opportunity,
  isNew,
  initialStage,
  onClose,
  onSaved,
  onDeleted
}) {
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    stage: initialStage || 'New',
    phase: '',
    amount: '',
    currency: 'EUR',
    dealManager: '',
    notes: ''
  });

  // UI state
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success'|'error', message: '' }

  // Feedback timeout ref — clear on unmount
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current); }, []);

  // Initialize form data when opportunity changes
  useEffect(() => {
    if (isNew) {
      setFormData({
        name: '',
        stage: initialStage || 'New',
        phase: '',
        amount: '',
        currency: 'EUR',
        dealManager: '',
        notes: ''
      });
    } else if (opportunity) {
      // Load existing opportunity data
      const raw = opportunity._raw || {};
      setFormData({
        name: opportunity.name || '',
        stage: opportunity.stage || 'New',
        phase: opportunity.phase || '',
        amount: opportunity.amount ? String(opportunity.amount) : '',
        currency: opportunity.currency || 'EUR',
        dealManager: opportunity.dealManager || raw['Deal Manager'] || raw['Responsible'] || '',
        notes: raw['Notes'] || ''
      });
    }
  }, [opportunity, isNew, initialStage]);

  // Guard: render nothing if no data (AFTER all hooks to respect Rules of Hooks)
  if (!opportunity && !isNew) return null;

  // Show feedback toast
  const showFeedback = (type, message) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback({ type, message });
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3500);
  };

  // Format amount for display
  const formatAmount = (value) => {
    if (!value) return '';
    const num = parseFloat(String(value).replace(/[^\d.]/g, ''));
    if (isNaN(num)) return '';
    return new Intl.NumberFormat('es-ES').format(num);
  };

  // Parse amount from formatted string
  const parseAmount = (formatted) => {
    if (!formatted) return 0;
    const cleaned = String(formatted).replace(/[^\d]/g, '');
    return parseFloat(cleaned) || 0;
  };

  // Update form field
  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Validate form
  const validateForm = () => {
    if (!formData.name.trim()) {
      showFeedback('error', 'El nombre de la oportunidad es obligatorio');
      return false;
    }
    if (!formData.stage) {
      showFeedback('error', 'Debes seleccionar un estado');
      return false;
    }
    return true;
  };

  // Handle save
  const handleSave = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      // Prepare Airtable fields
      const fields = {
        'Opportunity Name': formData.name.trim(),
        'Global Status': formData.stage,
        'Workflow Phase (Debt)': formData.phase.trim(),
        'Targeted Ticket Size': parseAmount(formData.amount),
        'Currency': formData.currency,
        'Deal Manager': formData.dealManager || undefined,
        'Notes': formData.notes.trim()
      };

      // Remove undefined fields
      Object.keys(fields).forEach(k => {
        if (fields[k] === undefined || fields[k] === '') delete fields[k];
      });

      let result;
      if (isNew) {
        // Create new opportunity
        result = await createOpportunity(fields);
        showFeedback('success', 'Oportunidad creada correctamente');
      } else {
        // Update existing opportunity
        result = await updateOpportunity(opportunity.id, fields);
        showFeedback('success', 'Oportunidad actualizada correctamente');
      }

      // Notify parent with updated record
      if (onSaved) {
        onSaved(result);
      }

      // Close panel after brief delay to show success message
      setTimeout(() => {
        onClose();
      }, 1000);

    } catch (error) {
      console.error('Error saving opportunity:', error);
      showFeedback('error', error.message || 'Error al guardar la oportunidad');
    } finally {
      setLoading(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (isNew || !opportunity?.id) return;

    setLoading(true);
    try {
      await deleteOpportunity(opportunity.id);
      showFeedback('success', 'Oportunidad eliminada correctamente');

      // Notify parent
      if (onDeleted) {
        onDeleted(opportunity.id);
      }

      // Close panel after brief delay
      setTimeout(() => {
        setShowDeleteConfirm(false);
        onClose();
      }, 1000);

    } catch (error) {
      console.error('Error deleting opportunity:', error);
      showFeedback('error', error.message || 'Error al eliminar la oportunidad');
      setShowDeleteConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !loading) {
      onClose();
    }
  };

  // Get stage color
  const getStageColor = (stage) => {
    return STAGE_COLORS[stage] || { bg: '#F7F9FC', color: '#1A2B3D', border: '#E2E8F0' };
  };

  const currentStageColor = getStageColor(formData.stage);

  // ── Dark input style helpers ──
  const darkInputStyle = (disabled) => ({
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 500,
    color: DK.text,
    background: DK.card,
    border: `2px solid ${DK.border}`,
    borderRadius: RADIUS.md,
    outline: 'none',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : 'text',
  });

  const darkSelectStyle = (disabled) => ({
    ...darkInputStyle(disabled),
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const darkFocus = (e) => {
    e.currentTarget.style.borderColor = DK.accent;
    e.currentTarget.style.boxShadow = `0 0 0 3px ${DK.accent}20`;
  };

  const darkBlur = (e) => {
    e.currentTarget.style.borderColor = DK.border;
    e.currentTarget.style.boxShadow = 'none';
  };

  return (
    <>
      {/* Backdrop overlay */}
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 22, 40, 0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
          animation: 'fadeIn 0.2s ease-out'
        }}
      />

      {/* Slide-in panel */}
      <div
        className="slide-in"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: '100vw',
          background: DK.bg,
          zIndex: 101,
          overflow: 'auto',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '24px 28px',
          borderBottom: `1px solid ${DK.border}`,
          background: DK.surface,
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {/* Airtable badge */}
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  background: DK.purple,
                  borderRadius: RADIUS.sm,
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#FFFFFF',
                  letterSpacing: '0.5px'
                }}>
                  AT
                </div>
                <h2 style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 800,
                  color: DK.text,
                  letterSpacing: '-0.5px',
                  lineHeight: 1.2
                }}>
                  {isNew ? 'Nueva oportunidad' : (formData.name || 'Editar oportunidad')}
                </h2>
              </div>
              {!isNew && opportunity?.id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    fontSize: 12,
                    color: DK.textMuted,
                    fontWeight: 500,
                    fontFamily: 'monospace'
                  }}>
                    {opportunity.id}
                  </div>
                  {opportunity.businessType && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.3px',
                      background: opportunity.businessType === 'Debt' ? `${DK.accent}20` : `${DK.green}20`,
                      color: opportunity.businessType === 'Debt' ? DK.accent : DK.green,
                    }}>
                      {opportunity.businessType}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              disabled={loading}
              style={{
                background: 'transparent',
                border: 'none',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: loading ? 'not-allowed' : 'pointer',
                borderRadius: RADIUS.sm,
                color: DK.textMuted,
                fontSize: 20,
                transition: 'all 0.15s',
                opacity: loading ? 0.5 : 1
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = DK.border;
                  e.currentTarget.style.color = DK.text;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = DK.textMuted;
              }}
            >
              \u2715
            </button>
          </div>
        </div>

        {/* Form content */}
        <div style={{
          flex: 1,
          padding: 28,
          overflow: 'auto'
        }}>
          {/* Opportunity Name */}
          <DarkFormField label="Nombre de la oportunidad" required>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Ej: Financiacion proyecto ABC"
              disabled={loading}
              style={darkInputStyle(loading)}
              onFocus={darkFocus}
              onBlur={darkBlur}
            />
          </DarkFormField>

          {/* Global Status (Stage) */}
          <DarkFormField label="Estado global" required>
            <div style={{ marginBottom: 8 }}>
              <select
                value={formData.stage}
                onChange={(e) => updateField('stage', e.target.value)}
                disabled={loading}
                style={darkSelectStyle(loading)}
                onFocus={darkFocus}
                onBlur={darkBlur}
              >
                {KANBAN_STAGES.map(stage => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </div>
            {/* Stage preview badge */}
            {formData.stage && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                background: currentStageColor.bg,
                color: currentStageColor.color,
                border: `1px solid ${currentStageColor.border}`,
                borderRadius: RADIUS.sm,
                fontSize: 12,
                fontWeight: 600
              }}>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: currentStageColor.color
                }} />
                {STAGE_SHORT_LABELS[formData.stage] || formData.stage}
              </div>
            )}
          </DarkFormField>

          {/* Workflow Phase */}
          <DarkFormField label="Fase del workflow (Debt)">
            <input
              type="text"
              value={formData.phase}
              onChange={(e) => updateField('phase', e.target.value)}
              placeholder="Ej: Due Diligence"
              disabled={loading}
              style={darkInputStyle(loading)}
              onFocus={darkFocus}
              onBlur={darkBlur}
            />
          </DarkFormField>

          {/* Deal Manager */}
          <DarkFormField label="Deal Manager">
            <select
              value={formData.dealManager}
              onChange={(e) => updateField('dealManager', e.target.value)}
              disabled={loading}
              style={darkSelectStyle(loading)}
              onFocus={darkFocus}
              onBlur={darkBlur}
            >
              <option value="">-- Sin asignar --</option>
              {TEAM_MEMBERS.map(m => (
                <option key={m.email} value={m.name}>{m.name}</option>
              ))}
            </select>
          </DarkFormField>

          {/* Amount and Currency */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
            <DarkFormField label="Ticket objetivo">
              <input
                type="text"
                value={formData.amount}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^\d]/g, '');
                  updateField('amount', value);
                }}
                placeholder="0"
                disabled={loading}
                style={{ ...darkInputStyle(loading), textAlign: 'right', fontWeight: 600 }}
                onFocus={darkFocus}
                onBlur={(e) => {
                  darkBlur(e);
                  // Format on blur
                  if (formData.amount) {
                    updateField('amount', String(parseAmount(formData.amount)));
                  }
                }}
              />
              {formData.amount && (
                <div style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: DK.textSecondary,
                  textAlign: 'right',
                  fontWeight: 500
                }}>
                  {formatAmount(formData.amount)} {formData.currency}
                </div>
              )}
            </DarkFormField>

            <DarkFormField label="Moneda">
              <select
                value={formData.currency}
                onChange={(e) => updateField('currency', e.target.value)}
                disabled={loading}
                style={{ ...darkSelectStyle(loading), width: 90 }}
                onFocus={darkFocus}
                onBlur={darkBlur}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </select>
            </DarkFormField>
          </div>

          {/* Notes */}
          <DarkFormField label="Notas">
            <textarea
              value={formData.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Notas adicionales sobre la oportunidad..."
              disabled={loading}
              rows={5}
              style={{
                ...darkInputStyle(loading),
                resize: 'vertical',
                minHeight: 100,
                lineHeight: 1.5,
                fontWeight: 400,
              }}
              onFocus={darkFocus}
              onBlur={darkBlur}
            />
          </DarkFormField>
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '20px 28px',
          borderTop: `1px solid ${DK.border}`,
          background: DK.surface,
          flexShrink: 0,
          display: 'flex',
          gap: 12,
          alignItems: 'center'
        }}>
          {/* Delete button (only in edit mode) */}
          {!isNew && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={loading}
              style={{
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 600,
                color: DK.red,
                background: 'transparent',
                border: `2px solid ${DK.red}30`,
                borderRadius: RADIUS.md,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                fontFamily: 'inherit',
                opacity: loading ? 0.5 : 1
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = `${DK.red}15`;
                  e.currentTarget.style.borderColor = `${DK.red}50`;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = `${DK.red}30`;
              }}
            >
              Eliminar
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={loading}
            style={{
              padding: '12px 28px',
              fontSize: 14,
              fontWeight: 700,
              color: '#FFFFFF',
              background: loading ? DK.textMuted : `linear-gradient(135deg, ${DK.accent}, ${DK.green})`,
              border: 'none',
              borderRadius: RADIUS.md,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              fontFamily: 'inherit',
              boxShadow: loading ? 'none' : `0 2px 8px ${DK.accent}40`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 120,
              justifyContent: 'center'
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = `0 4px 12px ${DK.accent}50`;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = `0 2px 8px ${DK.accent}40`;
            }}
          >
            {loading ? (
              <>
                <Spinner />
                Guardando...
              </>
            ) : (
              isNew ? 'Crear oportunidad' : 'Guardar cambios'
            )}
          </button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <>
          {/* Dialog backdrop */}
          <div
            onClick={() => !loading && setShowDeleteConfirm(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(10, 22, 40, 0.7)',
              zIndex: 150
            }}
          />
          {/* Dialog */}
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: DK.card,
            borderRadius: RADIUS.lg,
            padding: 28,
            maxWidth: 420,
            width: '90%',
            border: `1px solid ${DK.border}`,
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
            zIndex: 151
          }}>
            <div style={{
              fontSize: 20,
              fontWeight: 800,
              color: DK.text,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 10
            }}>
              Confirmar eliminacion
            </div>
            <div style={{
              fontSize: 14,
              color: DK.textSecondary,
              lineHeight: 1.6,
              marginBottom: 24
            }}>
              Estas seguro de que deseas eliminar esta oportunidad? Esta accion no se puede deshacer.
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: DK.textSecondary,
                  background: DK.surface,
                  border: `2px solid ${DK.border}`,
                  borderRadius: RADIUS.md,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: 'inherit',
                  opacity: loading ? 0.5 : 1
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.background = DK.border;
                    e.currentTarget.style.color = DK.text;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = DK.surface;
                  e.currentTarget.style.color = DK.textSecondary;
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#FFFFFF',
                  background: loading ? DK.textMuted : DK.red,
                  border: 'none',
                  borderRadius: RADIUS.md,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.background = '#DC2626';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.currentTarget.style.background = DK.red;
                  }
                }}
              >
                {loading ? (
                  <>
                    <Spinner />
                    Eliminando...
                  </>
                ) : (
                  'Eliminar'
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Feedback toast */}
      {feedback && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: feedback.type === 'success' ? DK.green : DK.red,
          color: '#FFFFFF',
          padding: '14px 20px',
          borderRadius: RADIUS.md,
          fontSize: 14,
          fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          maxWidth: 400,
          animation: 'slideInUp 0.3s ease-out'
        }}>
          <span style={{ fontSize: 18 }}>
            {feedback.type === 'success' ? '\u2713' : '\u2717'}
          </span>
          {feedback.message}
        </div>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .slide-in {
          animation: slideInRight 0.25s ease-out;
        }
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}

/* ── Dark Form Field Wrapper ── */
function DarkFormField({ label, required, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <label style={{
        display: 'block',
        fontSize: 12,
        fontWeight: 700,
        color: DK.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: 8
      }}>
        {label}
        {required && (
          <span style={{ color: DK.red, marginLeft: 4 }}>*</span>
        )}
      </label>
      {children}
    </div>
  );
}

/* ── Loading Spinner ── */
function Spinner() {
  return (
    <div style={{
      width: 14,
      height: 14,
      border: '2px solid rgba(255, 255, 255, 0.3)',
      borderTopColor: '#FFFFFF',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite'
    }}>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
