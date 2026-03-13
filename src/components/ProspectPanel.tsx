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
  TASK_TEMPLATES,
} from '../utils/airtableProspects';
import { isGeminiConfigured, summarizeMeetingNotes, extractTasksFromNotes, generateProspectIntelligence } from '../utils/gemini';
import { syncTasksToAirtable } from '../utils/airtableTasks';
import ProspectTasks from './ProspectTasks';

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
  yellow: '#F59E0B',
  orange: '#F97316',
};

const RADIUS = { sm: 6, md: 10, lg: 14 };

// Domains for internal tools — never match prospects to these companies
const INTERNAL_TOOL_DOMAINS = [
  'atlassian.com', 'atlassian.net', 'jira.com',
  'slack.com', 'slack-edge.com',
  'google.com', 'gmail.com', 'googlemail.com', 'google.es',
  'microsoft.com', 'outlook.com', 'office365.com', 'office.com', 'live.com', 'hotmail.com',
  'zoom.us', 'zoom.com',
  'notion.so', 'notion.com',
  'github.com', 'gitlab.com', 'bitbucket.org',
  'trello.com', 'asana.com', 'monday.com', 'clickup.com',
  'hubspot.com', 'salesforce.com', 'pipedrive.com',
  'mailchimp.com', 'sendgrid.net', 'sendgrid.com',
  'calendly.com', 'docusign.com', 'docusign.net',
  'dropbox.com', 'box.com',
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com',
  'airtable.com', 'typeform.com', 'intercom.io',
  'vercel.com', 'netlify.com', 'heroku.com', 'aws.amazon.com',
  'stripe.com', 'paypal.com',
  'canva.com', 'figma.com', 'miro.com',
  'alter-5.com',
];

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
  companies = [],
}) {
  if (!prospect && !isNew) return null;

  const [formData, setFormData] = useState({
    name: '',
    stage: initialStage || 'Lead',
    dealManager: '',
    amount: '',
    currency: 'EUR',
    product: '',
    origin: '',
    context: '',
    nextSteps: '',
    assignedTo: '',
    assignedEmail: '',
    contactEmail: '',
  });

  const [contacts, setContacts] = useState([]);

  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // AI notes + tasks state
  const [meetingNotesInput, setMeetingNotesInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  // AI Intelligence state
  const [aiIntelLoading, setAiIntelLoading] = useState(false);
  const [aiIntelError, setAiIntelError] = useState<string | null>(null);
  const [nextStepsOpen, setNextStepsOpen] = useState(false);
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    if (isNew) {
      setFormData({
        name: '',
        stage: initialStage || 'Lead',
        dealManager: '',
        amount: '',
        currency: 'EUR',
        product: '',
        origin: '',
        context: '',
        nextSteps: '',
        assignedTo: '',
        assignedEmail: '',
        contactEmail: '',
      });
      setContacts([]);
    } else if (prospect) {
      setFormData({
        name: prospect.name || '',
        stage: prospect.stage || 'Lead',
        dealManager: prospect.dealManager || '',
        amount: prospect.amount ? String(prospect.amount) : '',
        currency: prospect.currency || 'EUR',
        product: prospect.product || '',
        origin: prospect.origin || '',
        context: prospect.context || '',
        nextSteps: prospect.nextSteps || '',
        assignedTo: prospect.assignedTo || '',
        assignedEmail: prospect.assignedEmail || '',
        contactEmail: prospect.contactEmail || '',
      });
      // Load contacts array; fallback to single contactEmail for backward compat
      if (prospect.contacts && prospect.contacts.length > 0) {
        setContacts(prospect.contacts);
      } else if (prospect.contactEmail) {
        setContacts([{ name: '', email: prospect.contactEmail, role: '' }]);
      } else {
        setContacts([]);
      }
    }
  }, [prospect, isNew, initialStage]);

  // Load tasks from prospect
  useEffect(() => {
    if (isNew) {
      setTasks([]);
    } else if (prospect?._raw?.['Tasks']) {
      setTasks(Array.isArray(prospect._raw['Tasks']) ? prospect._raw['Tasks'] : []);
    } else if (prospect?.tasks) {
      setTasks(Array.isArray(prospect.tasks) ? prospect.tasks : []);
    } else {
      setTasks([]);
    }
    setMeetingNotesInput('');
    setAiError(null);
  }, [prospect, isNew]);

  // ── Match prospect to company in CRM data ──
  const matchedCompany = (() => {
    if (!companies.length || isNew) return null;
    const prospectName = (formData.name || '').trim().toLowerCase();
    const prospectEmails = contacts.map(c => (c.email || '').toLowerCase()).filter(Boolean);
    const prospectDomains = prospectEmails
      .map(e => e.split('@')[1])
      .filter(d => d && !INTERNAL_TOOL_DOMAINS.some(t => d === t || d.endsWith('.' + t)));

    // 1) Exact domain match from contact emails
    for (const domain of prospectDomains) {
      const match = companies.find(c => c.domain === domain);
      if (match) return match;
    }
    // 2) Name exact match
    if (prospectName) {
      const match = companies.find(c => c.name.toLowerCase() === prospectName);
      if (match) return match;
    }
    // 3) Name contains or is contained
    if (prospectName && prospectName.length >= 4) {
      const match = companies.find(c => {
        const cn = c.name.toLowerCase();
        return cn.includes(prospectName) || prospectName.includes(cn);
      });
      if (match) return match;
    }
    return null;
  })();

  const handleAiProcess = async () => {
    setAiLoading(true);
    setAiError(null);

    try {
      const notesText = meetingNotesInput.trim();

      if (!notesText) {
        setAiError('No hay notas para procesar');
        setAiLoading(false);
        return;
      }

      const prospectName = formData.name || 'Prospect';

      // Run summarize + extract in parallel
      const [summaryResult, tasksResult] = await Promise.allSettled([
        summarizeMeetingNotes(notesText, prospectName),
        extractTasksFromNotes(notesText, prospectName),
      ]);

      // Prepend summary to Context with timestamp
      if (summaryResult.status === 'fulfilled' && summaryResult.value) {
        const timestamp = new Date().toLocaleString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        const summaryBlock = `[Resumen IA ${timestamp}]\n${summaryResult.value}\n\n`;
        updateField('context', summaryBlock + formData.context);
      } else if (summaryResult.status === 'rejected') {
        console.warn('Summary failed:', summaryResult.reason);
      }

      // Merge extracted tasks + populate "Proximos pasos" field
      if (tasksResult.status === 'fulfilled' && tasksResult.value?.length > 0) {
        const newTasks = tasksResult.value;
        setTasks(prev => [...prev, ...newTasks]);

        // Build readable next-steps text and prepend to field
        const timestamp = new Date().toLocaleString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        const stepsText = newTasks.map((t, i) => {
          let line = `${i + 1}. ${t.text}`;
          if (t.assignedTo) line += ` \u2192 ${t.assignedTo}`;
          if (t.dueDate) line += ` (${t.dueDate})`;
          return line;
        }).join('\n');
        const stepsBlock = `[Pr\u00f3ximos pasos IA ${timestamp}]\n${stepsText}\n\n`;
        updateField('nextSteps', stepsBlock + formData.nextSteps);
      } else if (tasksResult.status === 'rejected') {
        console.warn('Task extraction failed:', tasksResult.reason);
      }

      // Show partial error if one failed
      if (summaryResult.status === 'rejected' && tasksResult.status === 'rejected') {
        setAiError('Error al procesar notas. Verifica tu API key.');
      } else {
        setMeetingNotesInput('');
        showFeedback('success', 'Notas procesadas con IA');
      }
    } catch (err) {
      console.error('AI processing error:', err);
      setAiError(err.message || 'Error al procesar con IA');
    } finally {
      setAiLoading(false);
    }
  };

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
      // Filter out empty contacts
      const validContacts = contacts.filter(c => c.name.trim() || c.email.trim());

      const fields = {
        'Prospect Name': formData.name.trim(),
        'Stage': formData.stage,
        'Deal Manager': formData.dealManager || undefined,
        'Amount': parseAmount(formData.amount),
        'Currency': formData.currency,
        'Product': formData.product || undefined,
        'Origin': formData.origin || undefined,
        'Context': formData.context.trim(),
        'Next Steps': formData.nextSteps.trim(),
        'Assigned To': formData.assignedTo || undefined,
        'Contact Email': validContacts[0]?.email || undefined,
        'Assigned Email': formData.assignedEmail.trim() || undefined,
        'Contacts': JSON.stringify(validContacts),
        // Tasks field is now a linked record in Airtable — don't send as JSON string.
        // Tasks are synced separately via syncTasksToAirtable().
      };

      // Remove undefined/empty fields (Airtable rejects empty strings for single-select)
      Object.keys(fields).forEach(k => {
        if (fields[k] === undefined || fields[k] === '') delete fields[k];
      });

      // Detect tasks with assignedTo that haven't been notified yet
      const tasksToNotify = tasks.filter(t =>
        t.assignedTo && !t.notifiedAt && t.status !== 'hecho'
      );

      let result;
      if (isNew) {
        fields['Record Status'] = 'Active';
        result = await createProspect(fields);
      } else {
        result = await updateProspect(prospect.id, fields);
      }

      // Sync tasks to Airtable (non-blocking — errors don't prevent save)
      let airtableSyncMsg = '';
      try {
        const opportunityId = prospect?.opportunityId || '';
        const syncResult = await syncTasksToAirtable(tasks, opportunityId);
        if (syncResult.synced > 0) {
          // Update local state with airtableIds from sync
          setTasks(syncResult.tasks);
          airtableSyncMsg = syncResult.errors > 0
            ? ` (${syncResult.synced} tareas sync, ${syncResult.errors} error)`
            : '';
        }
      } catch (syncErr) {
        console.warn('Airtable task sync failed:', syncErr);
        airtableSyncMsg = ' (sync Airtable pendiente)';
      }

      // Send email notifications for newly assigned tasks
      const notifiedNames = [];
      if (tasksToNotify.length > 0) {
        const notifyPromises = tasksToNotify.map(async (task) => {
          const member = TEAM_MEMBERS.find(m => m.name === task.assignedTo);
          if (!member) return;

          try {
            const resp = await fetch('/api/notify-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: member.email,
                toName: member.name,
                taskText: task.text,
                taskDescription: task.description || '',
                prospectName: formData.name.trim(),
                assignedBy: formData.dealManager || 'Alter5 BI',
                dueDate: task.dueDate || '',
                prospectContext: formData.context.trim(),
                dashboardUrl: window.location.origin + '/?tab=prospects',
              }),
            });

            if (resp.ok) {
              // Mark task as notified
              task.notifiedAt = new Date().toISOString();
              notifiedNames.push(member.name.split(' ')[0]);
            }
          } catch (err) {
            console.warn('Notification failed for', member.name, err);
          }
        });

        await Promise.allSettled(notifyPromises);

        // Update tasks with notifiedAt timestamps
        if (notifiedNames.length > 0) {
          const updatedFields = { 'Tasks': JSON.stringify(tasks) };
          if (!isNew) {
            await updateProspect(result.id, updatedFields);
          }
        }
      }

      const feedbackMsg = notifiedNames.length > 0
        ? `Guardado. Notificacion enviada a ${notifiedNames.join(', ')}.${airtableSyncMsg}`
        : (isNew ? 'Prospect creado correctamente' : 'Prospect actualizado correctamente') + airtableSyncMsg;
      showFeedback('success', feedbackMsg);

      if (onSaved) onSaved(result);

      setTimeout(() => { onClose(); }, 1200);
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
          background: 'rgba(10, 22, 40, 0.6)',
          backdropFilter: 'blur(4px)',
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
          background: DK.bg, zIndex: 101,
          overflow: 'auto',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.4)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '24px 28px',
          borderBottom: `1px solid ${DK.border}`,
          background: DK.surface,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {/* Prospect badge */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32,
                  background: `linear-gradient(135deg, ${DK.purple}, ${DK.accent})`,
                  borderRadius: RADIUS.sm,
                  fontSize: 13, fontWeight: 800, color: '#FFFFFF',
                  letterSpacing: '0.5px',
                }}>
                  PR
                </div>
                <h2 style={{
                  margin: 0, fontSize: 22, fontWeight: 800,
                  color: DK.text, letterSpacing: '-0.5px', lineHeight: 1.2,
                }}>
                  {isNew ? 'Nuevo prospect' : (formData.name || 'Editar prospect')}
                </h2>
              </div>
              {!isNew && prospect?.id && (
                <div style={{
                  fontSize: 12, color: DK.textMuted,
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
                borderRadius: RADIUS.sm, color: DK.textMuted, fontSize: 20,
                transition: 'all 0.15s',
                opacity: loading ? 0.5 : 1,
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

        {/* Form */}
        <div style={{ flex: 1, padding: 28, overflow: 'auto' }}>

          {/* ── AI Intelligence Section (top of panel for existing prospects) ── */}
          {!isNew && (prospect?.aiSummary || matchedCompany) && (
            <div style={{
              marginBottom: 22, padding: 16,
              background: (() => {
                const isFalsePositive = (prospect?.aiSummary || '').includes('FALSO POSITIVO');
                return isFalsePositive
                  ? `linear-gradient(135deg, ${DK.red}10, ${DK.red}05)`
                  : `linear-gradient(135deg, ${DK.purple}15, ${DK.accent}15)`;
              })(),
              borderRadius: RADIUS.md,
              border: (() => {
                const isFalsePositive = (prospect?.aiSummary || '').includes('FALSO POSITIVO');
                return isFalsePositive
                  ? `1px solid ${DK.red}60`
                  : `1px solid ${DK.purple}40`;
              })(),
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 10,
              }}>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 700, color: DK.purple,
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  <span style={{ fontSize: 14 }}>✦</span>
                  Resumen de la relacion
                  {(prospect?.aiSummary || '').includes('FALSO POSITIVO') && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: DK.red,
                      background: `${DK.red}20`, borderRadius: 4,
                      padding: '2px 6px', marginLeft: 4,
                    }}>
                      FALSO POSITIVO
                    </span>
                  )}
                  {(prospect?.aiSummary || '').includes('Confianza baja') && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: DK.yellow,
                      background: `${DK.yellow}20`, borderRadius: 4,
                      padding: '2px 6px', marginLeft: 4,
                    }}>
                      REVISAR
                    </span>
                  )}
                </label>
                {prospect?.aiSummary && (
                  <button
                    onClick={async () => {
                      if (!matchedCompany) return;
                      setAiIntelLoading(true);
                      setAiIntelError(null);
                      try {
                        const result = await generateProspectIntelligence(
                          formData.name,
                          matchedCompany,
                          formData.context,
                        );
                        await updateProspect(prospect.id, { "AI Summary": result.summary });
                        if (result.suggestedNextSteps.length > 0 && !formData.nextSteps) {
                          const stepsText = result.suggestedNextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
                          updateField('nextSteps', stepsText);
                          await updateProspect(prospect.id, { "Next Steps": stepsText });
                        }
                        if (prospect) prospect.aiSummary = result.summary;
                        showFeedback('success', 'Inteligencia IA actualizada');
                      } catch (err: any) {
                        setAiIntelError(err.message || 'Error al generar inteligencia IA');
                      } finally {
                        setAiIntelLoading(false);
                      }
                    }}
                    disabled={aiIntelLoading || !matchedCompany}
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600,
                      color: DK.purple, background: `${DK.purple}15`,
                      border: `1px solid ${DK.purple}30`, borderRadius: RADIUS.sm,
                      cursor: aiIntelLoading ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 4,
                      opacity: aiIntelLoading ? 0.6 : 1,
                    }}
                  >
                    {aiIntelLoading ? <><Spinner />Regenerando...</> : 'Regenerar'}
                  </button>
                )}
              </div>

              {prospect?.aiSummary ? (
                <div style={{
                  fontSize: 13, color: DK.text,
                  whiteSpace: 'pre-wrap', lineHeight: 1.6,
                  padding: '10px 12px',
                  background: `${DK.bg}80`,
                  borderRadius: RADIUS.sm,
                  border: `1px solid ${DK.border}`,
                }}>
                  {prospect.aiSummary}
                </div>
              ) : (
                <div>
                  <p style={{
                    fontSize: 12, color: DK.textSecondary,
                    margin: '0 0 10px 0', lineHeight: 1.5,
                  }}>
                    Genera un analisis de inteligencia comercial basado en el historial CRM de esta empresa.
                  </p>
                  {aiIntelError && (
                    <div style={{
                      marginBottom: 8, fontSize: 12, color: DK.red,
                      fontWeight: 500, padding: '6px 8px',
                      background: `${DK.red}15`, borderRadius: 4,
                    }}>
                      {aiIntelError}
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      if (!matchedCompany) return;
                      setAiIntelLoading(true);
                      setAiIntelError(null);
                      try {
                        const result = await generateProspectIntelligence(
                          formData.name,
                          matchedCompany,
                          formData.context,
                        );
                        if (!isNew && prospect?.id) {
                          await updateProspect(prospect.id, { "AI Summary": result.summary });
                          if (result.suggestedNextSteps.length > 0 && !formData.nextSteps) {
                            const stepsText = result.suggestedNextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
                            updateField('nextSteps', stepsText);
                            await updateProspect(prospect.id, { "Next Steps": stepsText });
                          }
                          if (prospect) prospect.aiSummary = result.summary;
                        }
                        showFeedback('success', 'Inteligencia IA generada');
                      } catch (err: any) {
                        setAiIntelError(err.message || 'Error al generar inteligencia IA');
                      } finally {
                        setAiIntelLoading(false);
                      }
                    }}
                    disabled={aiIntelLoading || !isGeminiConfigured()}
                    style={{
                      padding: '8px 16px', fontSize: 12, fontWeight: 700,
                      color: '#FFFFFF',
                      background: aiIntelLoading ? DK.textMuted : `linear-gradient(135deg, ${DK.purple}, ${DK.accent})`,
                      border: 'none', borderRadius: RADIUS.sm,
                      cursor: aiIntelLoading ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {aiIntelLoading ? (
                      <><Spinner />Analizando...</>
                    ) : (
                      <><span>✦</span>Generar Inteligencia IA</>
                    )}
                  </button>
                </div>
              )}

              {aiIntelError && prospect?.aiSummary && (
                <div style={{
                  marginTop: 8, fontSize: 12, color: DK.red,
                  fontWeight: 500, padding: '6px 8px',
                  background: `${DK.red}15`, borderRadius: 4,
                }}>
                  {aiIntelError}
                </div>
              )}
            </div>
          )}

          {/* Prospect Name */}
          <DarkFormField label="Nombre de la empresa" required>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Ej: Solaria Energia"
              disabled={loading}
              style={darkInputStyle(loading)}
              onFocus={darkFocus}
              onBlur={darkBlur}
            />
          </DarkFormField>

          {/* Contacts */}
          <DarkFormField label={`Contactos (${contacts.length})`}>
            {contacts.map((c, idx) => (
              <div key={idx} style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                gap: 8, marginBottom: 8, alignItems: 'start',
              }}>
                <input
                  type="text"
                  value={c.nombre || c.name?.split(' ')[0] || ''}
                  onChange={(e) => {
                    const updated = [...contacts];
                    const nombre = e.target.value;
                    const apellido = updated[idx].apellido || '';
                    updated[idx] = { ...updated[idx], nombre, name: `${nombre} ${apellido}`.trim() };
                    setContacts(updated);
                  }}
                  placeholder="Nombre"
                  disabled={loading}
                  style={{ ...darkInputStyle(loading), fontSize: 13 }}
                  onFocus={darkFocus}
                  onBlur={darkBlur}
                />
                <input
                  type="text"
                  value={c.apellido || c.name?.split(' ').slice(1).join(' ') || ''}
                  onChange={(e) => {
                    const updated = [...contacts];
                    const apellido = e.target.value;
                    const nombre = updated[idx].nombre || '';
                    updated[idx] = { ...updated[idx], apellido, name: `${nombre} ${apellido}`.trim() };
                    setContacts(updated);
                  }}
                  placeholder="Apellido"
                  disabled={loading}
                  style={{ ...darkInputStyle(loading), fontSize: 13 }}
                  onFocus={darkFocus}
                  onBlur={darkBlur}
                />
                <input
                  type="email"
                  value={c.email}
                  onChange={(e) => {
                    const updated = [...contacts];
                    updated[idx] = { ...updated[idx], email: e.target.value };
                    setContacts(updated);
                  }}
                  placeholder="email@empresa.com"
                  disabled={loading}
                  style={{ ...darkInputStyle(loading), fontSize: 13 }}
                  onFocus={darkFocus}
                  onBlur={darkBlur}
                />
                <input
                  type="text"
                  value={c.role}
                  onChange={(e) => {
                    const updated = [...contacts];
                    updated[idx] = { ...updated[idx], role: e.target.value };
                    setContacts(updated);
                  }}
                  placeholder="Cargo"
                  disabled={loading}
                  style={{ ...darkInputStyle(loading), fontSize: 13 }}
                  onFocus={darkFocus}
                  onBlur={darkBlur}
                />
                <button
                  onClick={() => setContacts(contacts.filter((_, i) => i !== idx))}
                  disabled={loading}
                  style={{
                    width: 32, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: `2px solid ${DK.red}30`, borderRadius: RADIUS.sm,
                    color: DK.red, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = `${DK.red}15`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  title="Eliminar contacto"
                >
                  \u2715
                </button>
              </div>
            ))}
            <button
              onClick={() => setContacts([...contacts, { name: '', email: '', role: '', nombre: '', apellido: '' }])}
              disabled={loading}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                color: DK.purple, background: `${DK.purple}15`,
                border: `1.5px dashed ${DK.purple}50`, borderRadius: RADIUS.sm,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = `${DK.purple}25`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `${DK.purple}15`; }}
            >
              + Anadir contacto
            </button>
          </DarkFormField>

          {/* Stage */}
          <DarkFormField label="Stage" required>
            <div style={{ marginBottom: 8 }}>
              <select
                value={formData.stage}
                onChange={(e) => updateField('stage', e.target.value)}
                disabled={loading}
                style={darkSelectStyle(loading)}
                onFocus={darkFocus}
                onBlur={darkBlur}
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
                borderRadius: RADIUS.sm, fontSize: 12, fontWeight: 600,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: currentStageColor.color,
                }} />
                {PROSPECT_STAGE_SHORT[formData.stage] || formData.stage}
              </div>
            )}
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

          {/* Amount + Currency */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
            <DarkFormField label="Importe">
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
                  if (formData.amount) {
                    updateField('amount', String(parseAmount(formData.amount)));
                  }
                }}
              />
              {formData.amount && (
                <div style={{
                  marginTop: 6, fontSize: 12, color: DK.textSecondary,
                  textAlign: 'right', fontWeight: 500,
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

          {/* Product */}
          <DarkFormField label="Producto">
            <select
              value={formData.product}
              onChange={(e) => updateField('product', e.target.value)}
              disabled={loading}
              style={darkSelectStyle(loading)}
              onFocus={darkFocus}
              onBlur={darkBlur}
            >
              <option value="">-- Seleccionar --</option>
              <optgroup label="Debt">
                <option value="Corporate Debt">Corporate Debt</option>
                <option value="Project Finance">Project Finance</option>
                <option value="Development Debt">Development Debt</option>
                <option value="Project Finance (Guaranteed)">Project Finance (Guaranteed)</option>
              </optgroup>
              <optgroup label="Equity">
                <option value="Investment">Investment</option>
                <option value="Co-Development">Co-Development</option>
                <option value="M&A">M&A</option>
              </optgroup>
            </select>
          </DarkFormField>

          {/* Origin */}
          <DarkFormField label="Origen">
            <select
              value={formData.origin}
              onChange={(e) => updateField('origin', e.target.value)}
              disabled={loading}
              style={darkSelectStyle(loading)}
              onFocus={darkFocus}
              onBlur={darkBlur}
            >
              <option value="">-- Seleccionar --</option>
              {ORIGIN_OPTIONS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </DarkFormField>

          {/* Context */}
          <DarkFormField label="Contexto / Notas de reunion">
            <textarea
              value={formData.context}
              onChange={(e) => updateField('context', e.target.value)}
              placeholder="Notas de reunion, transcripcion, contexto..."
              disabled={loading}
              rows={5}
              style={darkTextareaStyle(loading)}
              onFocus={darkFocus}
              onBlur={darkBlur}
            />
          </DarkFormField>

          {/* Next Steps — collapsible */}
          <div style={{ marginBottom: 18 }}>
            <div
              onClick={() => setNextStepsOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                cursor: 'pointer', userSelect: 'none',
                padding: '6px 0',
              }}
            >
              <span style={{
                fontSize: 10, color: DK.textSecondary,
                transition: 'transform 0.15s',
                transform: nextStepsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                display: 'inline-block',
              }}>▶</span>
              <label style={{
                fontSize: 12, fontWeight: 600, color: DK.textSecondary,
                cursor: 'pointer',
              }}>
                Sugerencias de avance
                {formData.nextSteps && !nextStepsOpen && (
                  <span style={{ fontWeight: 400, marginLeft: 6, color: DK.textMuted, fontSize: 11 }}>
                    ({formData.nextSteps.split('\n').filter(l => l.trim()).length} items)
                  </span>
                )}
              </label>
            </div>
            {nextStepsOpen && (
              <textarea
                value={formData.nextSteps}
                onChange={(e) => updateField('nextSteps', e.target.value)}
                placeholder="Tareas pendientes, siguiente reunion..."
                disabled={loading}
                rows={3}
                style={{ ...darkTextareaStyle(loading), marginTop: 4 }}
                onFocus={darkFocus}
                onBlur={darkBlur}
              />
            )}
          </div>

          {/* ── Company Activity Section (multi-mailbox timeline) ── */}
          {matchedCompany && (
            <CompanyActivitySection company={matchedCompany} />
          )}

          {/* AI Intelligence section moved to top of form */}

          {/* ── AI Meeting Notes Section ────────────────── */}
          <div style={{
            marginBottom: 22, padding: 16,
            background: `linear-gradient(135deg, ${DK.purple}15, ${DK.accent}15)`,
            borderRadius: RADIUS.md, border: `1px solid ${DK.purple}40`,
          }}>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 700, color: DK.purple,
              textTransform: 'uppercase', letterSpacing: '0.5px',
              marginBottom: 10,
              alignItems: 'center', gap: 6,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={DK.purple} strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 6 }}>
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
              Notas de reunion IA
              {!isGeminiConfigured() && (
                <span style={{ fontSize: 10, fontWeight: 500, color: DK.textMuted, marginLeft: 6 }}>(sin configurar)</span>
              )}
            </label>

            <textarea
              value={meetingNotesInput}
              onChange={(e) => setMeetingNotesInput(e.target.value)}
              placeholder="Pega aqui notas de reunion, transcripcion, resumen IA o texto libre..."
              disabled={loading || aiLoading}
              rows={4}
              style={{
                ...darkTextareaStyle(loading || aiLoading),
                background: DK.card,
                border: `1.5px solid ${DK.purple}40`,
                fontSize: 13,
              }}
              onFocus={darkFocus}
              onBlur={darkBlur}
            />

            {aiError && (
              <div style={{
                marginTop: 8, fontSize: 12, color: DK.red,
                fontWeight: 500, padding: '6px 8px',
                background: `${DK.red}15`, borderRadius: 4,
              }}>
                {aiError}
              </div>
            )}

            <button
              onClick={handleAiProcess}
              disabled={loading || aiLoading || !isGeminiConfigured() || !meetingNotesInput.trim()}
              style={{
                marginTop: 10, padding: '8px 16px',
                fontSize: 12, fontWeight: 700,
                color: '#FFFFFF',
                background: (aiLoading || !isGeminiConfigured()) ? DK.textMuted : `linear-gradient(135deg, ${DK.purple}, ${DK.accent})`,
                border: 'none', borderRadius: RADIUS.sm,
                cursor: (aiLoading || !isGeminiConfigured()) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {aiLoading ? (
                <>
                  <Spinner />
                  Procesando...
                </>
              ) : !isGeminiConfigured() ? (
                'Gemini API no configurada'
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                  </svg>
                  Generar resumen y tareas
                </>
              )}
            </button>
          </div>

          {/* ── Tasks Section ─────────────────────────────── */}
          <DarkFormField label={`Tareas (${tasks.filter(t => t.status === 'hecho').length}/${tasks.length})`}>
            <ProspectTasks
              tasks={tasks}
              onChange={setTasks}
              disabled={loading}
            />
          </DarkFormField>

          {/* (Deal Manager moved above Amount) */}
        </div>

        {/* Footer */}
        <div style={{
          padding: '20px 28px',
          borderTop: `1px solid ${DK.border}`,
          background: DK.surface,
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
                color: DK.red, background: 'transparent',
                border: `2px solid ${DK.red}30`, borderRadius: RADIUS.md,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s', fontFamily: 'inherit',
                opacity: loading ? 0.5 : 1,
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

          {/* Convert button (edit mode, not already converted) */}
          {!isNew && !prospect?.converted && (
            <button
              onClick={handleConvert}
              disabled={loading}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: 600,
                color: DK.purple, background: `${DK.purple}20`,
                border: `2px solid ${DK.purple}40`, borderRadius: RADIUS.md,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s', fontFamily: 'inherit',
                opacity: loading ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = `${DK.purple}30`;
                  e.currentTarget.style.borderColor = DK.purple;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `${DK.purple}20`;
                e.currentTarget.style.borderColor = `${DK.purple}40`;
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
              background: loading ? DK.textMuted : `linear-gradient(135deg, ${DK.purple}, ${DK.accent})`,
              border: 'none', borderRadius: RADIUS.md,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s', fontFamily: 'inherit',
              boxShadow: loading ? 'none' : `0 2px 8px ${DK.purple}40`,
              display: 'flex', alignItems: 'center', gap: 8,
              minWidth: 120, justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = `0 4px 12px ${DK.purple}50`;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = `0 2px 8px ${DK.purple}40`;
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
              background: 'rgba(10, 22, 40, 0.7)',
              zIndex: 150,
            }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: DK.card, borderRadius: RADIUS.lg, padding: 28,
            maxWidth: 420, width: '90%',
            border: `1px solid ${DK.border}`,
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
            zIndex: 151,
          }}>
            <div style={{
              fontSize: 20, fontWeight: 800, color: DK.text,
              marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              Confirmar eliminacion
            </div>
            <div style={{
              fontSize: 14, color: DK.textSecondary, lineHeight: 1.6, marginBottom: 24,
            }}>
              Vas a eliminar el prospect <strong style={{ color: DK.text }}>{formData.name}</strong>. Esta accion no se puede deshacer.
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
                style={{
                  padding: '10px 20px', fontSize: 14, fontWeight: 600,
                  color: DK.textSecondary, background: DK.surface,
                  border: `2px solid ${DK.border}`, borderRadius: RADIUS.md,
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
                  color: '#FFFFFF', background: loading ? DK.textMuted : DK.red,
                  border: 'none', borderRadius: RADIUS.md,
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
          background: feedback.type === 'success' ? DK.green : DK.red,
          color: '#FFFFFF', padding: '14px 20px', borderRadius: RADIUS.md,
          fontSize: 14, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 200,
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

// ── Company Activity Section (multi-mailbox timeline) ───────────────

function CompanyActivitySection({ company }) {
  const [expanded, setExpanded] = useState(false);

  const detail = company.detail;
  if (!detail) return null;

  const sources = detail.sources || [];
  const timeline = (detail.timeline || [])
    .filter(t => t.emails > 0)
    .sort((a, b) => b.quarter.localeCompare(a.quarter));
  const datedSubjects = (detail.datedSubjects || [])
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const totalEmails = company.interactions || 0;
  const employeeNames = {
    salvador_carrillo: 'Salvador',
    'leticia_men\u00e9ndez': 'Leticia',
    javier_ruiz: 'Javier',
    miguel_solana: 'Miguel',
    'carlos_almod\u00f3var': 'Carlos',
    gonzalo_de_gracia: 'Gonzalo',
    rafael_nevado: 'Rafael',
    guillermo_souto: 'Guillermo',
  };

  const employeeColors = {
    salvador_carrillo: DK.accent,
    'leticia_men\u00e9ndez': DK.purple,
    javier_ruiz: DK.yellow,
    miguel_solana: DK.green,
    'carlos_almod\u00f3var': DK.red,
    gonzalo_de_gracia: '#06B6D4',
    rafael_nevado: DK.orange,
    guillermo_souto: '#6B7280',
  };

  // Build per-employee stats from sources
  const employeeStats = sources
    .filter(s => s.interactions > 0)
    .sort((a, b) => b.interactions - a.interactions);

  // Recent subjects (last 8)
  const recentSubjects = datedSubjects.slice(0, expanded ? 20 : 6);

  return (
    <div style={{
      marginBottom: 22, padding: 16,
      background: `linear-gradient(135deg, ${DK.accent}10, ${DK.green}10)`,
      borderRadius: RADIUS.md, border: `1px solid ${DK.accent}30`,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <label style={{
          fontSize: 12, fontWeight: 700, color: DK.accent,
          textTransform: 'uppercase', letterSpacing: '0.5px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={DK.accent} strokeWidth="2" style={{ verticalAlign: 'middle' }}>
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
          Actividad CRM
          <span style={{
            fontSize: 10, fontWeight: 600, color: DK.textMuted,
            textTransform: 'none', letterSpacing: 0,
          }}>
            ({company.domain})
          </span>
        </label>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: DK.accent,
          }}>
            {totalEmails} emails
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 6px',
            borderRadius: 4,
            background: company.status === 'active' ? `${DK.green}20` : company.status === 'dormant' ? `${DK.yellow}20` : `${DK.red}20`,
            color: company.status === 'active' ? DK.green : company.status === 'dormant' ? DK.yellow : DK.red,
          }}>
            {company.status === 'active' ? 'Activa' : company.status === 'dormant' ? 'Dormida' : 'Inactiva'}
          </span>
        </div>
      </div>

      {/* Company classification badges */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {company.role && company.role !== 'No relevante' && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            borderRadius: 4, background: `${DK.accent}20`, color: DK.accent,
            border: `1px solid ${DK.accent}30`,
          }}>{company.role}</span>
        )}
        {company.segment && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            borderRadius: 4, background: `${DK.green}20`, color: DK.green,
            border: `1px solid ${DK.green}30`,
          }}>{company.segment}</span>
        )}
        {company.companyType && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            borderRadius: 4, background: `${DK.orange}20`, color: DK.orange,
            border: `1px solid ${DK.orange}30`,
          }}>{company.companyType}</span>
        )}
      </div>

      {/* Employee activity bars */}
      {employeeStats.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: DK.textSecondary,
            marginBottom: 8,
          }}>
            Actividad por buzon
          </div>
          {employeeStats.map(src => {
            const empId = src.employee;
            const empName = employeeNames[empId] || empId.replace(/_/g, ' ');
            const empColor = employeeColors[empId] || DK.textMuted;
            const pct = Math.min(100, Math.round((src.interactions / totalEmails) * 100));
            return (
              <div key={empId} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 4,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: empColor,
                  minWidth: 70, textAlign: 'right',
                }}>
                  {empName}
                </span>
                <div style={{
                  flex: 1, height: 6, background: DK.border,
                  borderRadius: 3, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: empColor, borderRadius: 3,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: DK.textMuted,
                  minWidth: 28, textAlign: 'right',
                }}>
                  {src.interactions}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Timeline quarters */}
      {timeline.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: DK.textSecondary,
            marginBottom: 8,
          }}>
            Timeline de interacciones
          </div>
          <div style={{
            display: 'flex', gap: 3, flexWrap: 'wrap',
          }}>
            {timeline.slice(0, expanded ? 20 : 8).map(t => (
              <div key={t.quarter} style={{
                padding: '3px 8px', borderRadius: 4,
                background: DK.card, border: `1px solid ${DK.border}`,
                fontSize: 10, fontWeight: 500, color: DK.textSecondary,
                display: 'flex', alignItems: 'center', gap: 4,
              }} title={t.summary || ''}>
                <span style={{ fontWeight: 600, color: DK.text }}>{t.quarter}</span>
                <span style={{
                  background: t.emails >= 10 ? DK.accent : t.emails >= 5 ? '#60A5FA' : '#93C5FD',
                  color: '#FFFFFF', fontSize: 9, fontWeight: 700,
                  padding: '0 4px', borderRadius: 3, minWidth: 16, textAlign: 'center',
                }}>
                  {t.emails}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent email subjects */}
      {recentSubjects.length > 0 && (
        <div style={{ marginBottom: expanded ? 10 : 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: DK.textSecondary,
            marginBottom: 6,
          }}>
            Emails recientes
          </div>
          {recentSubjects.map((ds, i) => (
            <div key={i} style={{
              display: 'flex', gap: 8, alignItems: 'baseline',
              padding: '3px 0', borderBottom: i < recentSubjects.length - 1 ? `1px solid ${DK.border}20` : 'none',
            }}>
              <span style={{
                fontSize: 10, fontWeight: 600, color: DK.textMuted,
                minWidth: 62, flexShrink: 0,
              }}>
                {ds.date ? new Date(ds.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : ''}
              </span>
              <span style={{
                fontSize: 11, color: DK.text, fontWeight: 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {ds.subject}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Context summary */}
      {detail.context && expanded && (
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: DK.card, borderRadius: RADIUS.sm,
          border: `1px solid ${DK.border}`,
          fontSize: 11, color: DK.textSecondary, lineHeight: 1.5,
          maxHeight: 120, overflow: 'auto',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: DK.textMuted, marginBottom: 4, textTransform: 'uppercase' }}>
            Contexto CRM
          </div>
          {detail.context}
        </div>
      )}

      {/* Expand/collapse toggle */}
      {(timeline.length > 8 || datedSubjects.length > 6 || detail.context) && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 8, padding: '4px 10px',
            fontSize: 11, fontWeight: 600,
            color: DK.accent, background: 'transparent',
            border: 'none', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {expanded ? 'Ver menos' : 'Ver mas detalle'}
        </button>
      )}
    </div>
  );
}

// ── Reusable sub-components ─────────────────────────────────────────

function DarkFormField({ label, required, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 700,
        color: DK.textSecondary, textTransform: 'uppercase',
        letterSpacing: '0.5px', marginBottom: 8,
      }}>
        {label}
        {required && <span style={{ color: DK.red, marginLeft: 4 }}>*</span>}
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

// ── Shared dark style helpers ────────────────────────────────────────

function darkInputStyle(loading) {
  return {
    width: '100%', padding: '10px 12px',
    fontSize: 14, fontWeight: 500, color: DK.text,
    background: DK.card, border: `2px solid ${DK.border}`,
    borderRadius: RADIUS.md, outline: 'none',
    transition: 'all 0.15s', fontFamily: 'inherit',
    opacity: loading ? 0.6 : 1,
    cursor: loading ? 'not-allowed' : 'text',
  };
}

function darkSelectStyle(loading) {
  return {
    width: '100%', padding: '10px 12px',
    fontSize: 14, fontWeight: 500, color: DK.text,
    background: DK.card, border: `2px solid ${DK.border}`,
    borderRadius: RADIUS.md, outline: 'none',
    cursor: loading ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', opacity: loading ? 0.6 : 1,
    transition: 'all 0.15s',
  };
}

function darkTextareaStyle(loading) {
  return {
    width: '100%', padding: '10px 12px',
    fontSize: 14, fontWeight: 400, color: DK.text,
    background: DK.card, border: `2px solid ${DK.border}`,
    borderRadius: RADIUS.md, outline: 'none',
    transition: 'all 0.15s', fontFamily: 'inherit',
    opacity: loading ? 0.6 : 1,
    cursor: loading ? 'not-allowed' : 'text',
    resize: 'vertical', minHeight: 80, lineHeight: 1.5,
  };
}

function darkFocus(e) {
  e.currentTarget.style.borderColor = DK.purple;
  e.currentTarget.style.boxShadow = `0 0 0 3px ${DK.purple}20`;
}

function darkBlur(e) {
  e.currentTarget.style.borderColor = DK.border;
  e.currentTarget.style.boxShadow = 'none';
}
