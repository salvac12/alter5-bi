import { useState } from 'react';
import { updateContactData } from '../utils/airtableProspecting';

const COLORS = {
  header: '#1A2B3D',
  blue: '#3B82F6',
  green: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  purple: '#8B5CF6',
  border: '#E2E8F0',
  text: '#6B7F94',
};

const FLAG_MAP = {
  ES: '🇪🇸', IT: '🇮🇹', FR: '🇫🇷', DE: '🇩🇪', PT: '🇵🇹',
  UK: '🇬🇧', PL: '🇵🇱', NL: '🇳🇱', BE: '🇧🇪', CH: '🇨🇭', AT: '🇦🇹',
};

function confidenceConfig(confidence) {
  return {
    high: { color: '#065F46', bg: '#ECFDF5', dot: '#10B981', label: 'Alta' },
    medium: { color: '#92400E', bg: '#FEF3C7', dot: '#F59E0B', label: 'Media' },
    low: { color: '#991B1B', bg: '#FEF2F2', dot: '#EF4444', label: 'Baja' },
  }[confidence] || { color: '#6B7F94', bg: '#F1F5F9', dot: '#94A3B8', label: '—' };
}

function roleBadge(role) {
  return {
    'Originación': { color: '#92400E', bg: '#FEF3C7' },
    'Inversión': { color: '#1D4ED8', bg: '#EFF6FF' },
    'Services': { color: '#374151', bg: '#F3F4F6' },
    'No relevante': { color: '#6B7280', bg: '#F9FAFB' },
  }[role] || { color: '#6B7F94', bg: '#F1F5F9' };
}

function Badge({ text, color, bg }) {
  if (!text) return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
      background: bg, color,
    }}>
      {text}
    </span>
  );
}

function CardBorder({ reviewStatus }) {
  return {
    approved: '2px solid #10B981',
    rejected: '2px solid #EF4444',
    skipped: '1px solid #E2E8F0',
    pending: '1px solid #E2E8F0',
  }[reviewStatus] || '1px solid #E2E8F0';
}

function CardBg({ reviewStatus }) {
  return {
    approved: '#F0FDF4',
    rejected: '#FFF5F5',
    skipped: '#FFFFFF',
    pending: '#FFFFFF',
  }[reviewStatus] || '#FFFFFF';
}

export default function ProspectingCompanyCard({
  company,
  onApprove,
  onSkip,
  onReject,
  onReset,
  onContactUpdated,
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [linkedinInput, setLinkedinInput] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualRole, setManualRole] = useState('');
  const [findingContact, setFindingContact] = useState(false);
  const [contactToast, setContactToast] = useState('');

  const confidence = confidenceConfig(company.confidence);
  const rb = roleBadge(company.role);
  const flag = FLAG_MAP[company.country] || '🌍';
  const domain = extractDomain(company.companyUrl);

  const isApproved = company.reviewStatus === 'approved';
  const isRejected = company.reviewStatus === 'rejected';
  const isSkipped = company.reviewStatus === 'skipped';

  const showContactToast = (msg) => {
    setContactToast(msg);
    setTimeout(() => setContactToast(''), 3000);
  };

  const handleFindByLinkedIn = async () => {
    if (!linkedinInput.trim()) return;
    setFindingContact(true);
    try {
      const result = await updateContactData(company.id, {
        contactLinkedIn: linkedinInput.trim(),
        findymailStatus: 'pending',
      });
      if (result) {
        onContactUpdated?.({ contactLinkedIn: linkedinInput.trim() });
        showContactToast('LinkedIn guardado. Findymail procesará el email.');
      }
    } catch (err) {
      showContactToast('Error al guardar LinkedIn');
    } finally {
      setFindingContact(false);
    }
  };

  const handleSaveManualContact = async () => {
    if (!manualName.trim() && !manualRole.trim()) return;
    setFindingContact(true);
    try {
      const result = await updateContactData(company.id, {
        contactName: manualName.trim(),
        contactRole: manualRole.trim(),
        findymailStatus: 'pending',
      });
      if (result) {
        onContactUpdated?.({ contactName: manualName.trim(), contactRole: manualRole.trim() });
        showContactToast('Contacto guardado');
      }
    } catch (err) {
      showContactToast('Error al guardar contacto');
    } finally {
      setFindingContact(false);
    }
  };

  return (
    <div style={{
      border: CardBorder({ reviewStatus: company.reviewStatus }),
      borderRadius: 8,
      background: CardBg({ reviewStatus: company.reviewStatus }),
      overflow: 'hidden',
      opacity: isSkipped ? 0.6 : 1,
      transition: 'all 0.15s ease',
    }}>
      {/* Main row */}
      <div style={{ padding: '12px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Confidence dot */}
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: confidence.dot, display: 'inline-block', flexShrink: 0 }} />
            <span style={{
              fontSize: 14, fontWeight: 800, color: COLORS.header,
              textDecoration: isRejected ? 'line-through' : 'none',
            }}>
              {company.companyName}
            </span>
            {domain && (
              <a
                href={company.companyUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: COLORS.blue, textDecoration: 'none' }}
              >
                {domain}
              </a>
            )}
            <span style={{ fontSize: 12, color: COLORS.text }}>{flag} {company.country}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: confidence.bg, color: confidence.color,
            }}>
              Fit: {confidence.label}
            </span>
          </div>
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {company.role && <Badge text={company.role} color={rb.color} bg={rb.bg} />}
          {company.segment && <Badge text={company.segment} color="#1D4ED8" bg="#EFF6FF" />}
          {company.companyType && <Badge text={company.companyType} color="#374151" bg="#F3F4F6" />}
          {company.assetType && <Badge text={company.assetType} color="#374151" bg="#F8FAFC" />}
        </div>

        {/* Description */}
        {company.description && (
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
            {company.description}
          </p>
        )}

        {/* Financing signals */}
        <div style={{
          padding: '6px 10px', borderRadius: 6, marginBottom: 10,
          background: company.financingSignals ? '#FFFBEB' : '#F8FAFC',
          border: `1px solid ${company.financingSignals ? '#FDE68A' : COLORS.border}`,
        }}>
          {company.financingSignals ? (
            <span style={{ fontSize: 11, color: '#92400E' }}>
              ⚡ <strong>Signals:</strong> {company.financingSignals}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: COLORS.text }}>Sin financing signals detectadas</span>
          )}
        </div>

        {/* Contact section */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Contacto
          </div>

          {company.contactEmail ? (
            // Has email → show contact info
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: COLORS.header }}>
                👤 {company.contactName || 'Desconocido'}
                {company.contactRole && <span style={{ color: COLORS.text }}> ({company.contactRole})</span>}
              </span>
              <a href={`mailto:${company.contactEmail}`} style={{ fontSize: 11, color: COLORS.blue }}>
                {company.contactEmail}
              </a>
              <span style={{ fontSize: 10, color: '#065F46', background: '#ECFDF5', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>✅</span>
            </div>
          ) : company.contactName && !company.contactEmail ? (
            // Has name but no email
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: COLORS.header }}>
                👤 {company.contactName}
                {company.contactRole && <span style={{ color: COLORS.text }}> ({company.contactRole})</span>}
              </span>
              <span style={{ fontSize: 10, color: '#92400E', background: '#FEF3C7', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>Sin email</span>
            </div>
          ) : (
            // No contact at all → show finder tools
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Sales Nav + LinkedIn finder row */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <a
                  href={`https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(company.companyName + ' CFO')}&currentCompany[]=${encodeURIComponent(company.companyName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '4px 10px', borderRadius: 5, border: `1px solid #0077B5`,
                    background: '#F0F8FF', color: '#0077B5',
                    fontSize: 11, fontWeight: 600, textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  🔗 Buscar en Sales Nav
                </a>
                <input
                  value={linkedinInput}
                  onChange={e => setLinkedinInput(e.target.value)}
                  placeholder="Pegar LinkedIn URL del contacto..."
                  style={{
                    padding: '4px 8px', borderRadius: 5, border: `1px solid ${COLORS.border}`,
                    fontSize: 11, fontFamily: 'inherit', outline: 'none', width: 220,
                  }}
                />
                <button
                  onClick={handleFindByLinkedIn}
                  disabled={findingContact || !linkedinInput.trim()}
                  style={{
                    padding: '4px 10px', borderRadius: 5, border: `1px solid ${COLORS.blue}`,
                    background: '#EFF6FF', color: COLORS.blue,
                    fontSize: 11, fontWeight: 600, cursor: findingContact ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  → Findymail
                </button>
              </div>

              {/* Manual name + role row */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={manualName}
                  onChange={e => setManualName(e.target.value)}
                  placeholder="Nombre contacto"
                  style={{
                    padding: '4px 8px', borderRadius: 5, border: `1px solid ${COLORS.border}`,
                    fontSize: 11, fontFamily: 'inherit', outline: 'none', width: 150,
                  }}
                />
                <input
                  value={manualRole}
                  onChange={e => setManualRole(e.target.value)}
                  placeholder="Cargo"
                  style={{
                    padding: '4px 8px', borderRadius: 5, border: `1px solid ${COLORS.border}`,
                    fontSize: 11, fontFamily: 'inherit', outline: 'none', width: 120,
                  }}
                />
                <button
                  onClick={handleSaveManualContact}
                  disabled={findingContact || (!manualName.trim() && !manualRole.trim())}
                  style={{
                    padding: '4px 10px', borderRadius: 5, border: `1px solid ${COLORS.purple}`,
                    background: '#F5F3FF', color: COLORS.purple,
                    fontSize: 11, fontWeight: 600, cursor: findingContact ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Guardar
                </button>
              </div>

              {contactToast && (
                <div style={{ fontSize: 11, color: '#065F46', fontWeight: 600 }}>{contactToast}</div>
              )}
            </div>
          )}
        </div>

        {/* Sources */}
        {company.sourcesFound?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
            {company.sourcesFound.slice(0, 3).map((s, i) => (
              <span key={i} style={{
                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                background: '#F1F5F9', color: COLORS.text, border: `1px solid ${COLORS.border}`,
              }}>
                {typeof s === 'string' ? s : s.source_name || s.source_url || 'Fuente'}
              </span>
            ))}
            {company.sourcesFound.length > 3 && (
              <span style={{ fontSize: 9, color: COLORS.text }}>+{company.sourcesFound.length - 3} más</span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {company.reviewStatus !== 'approved' ? (
              <button
                onClick={onApprove}
                style={{
                  padding: '5px 13px', borderRadius: 6, border: `1px solid #10B981`,
                  background: '#ECFDF5', color: '#065F46',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                ✅ Aprobar
              </button>
            ) : (
              <button
                onClick={onReset}
                style={{
                  padding: '5px 13px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
                  background: '#F8FAFC', color: COLORS.text,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Deshacer
              </button>
            )}

            {company.reviewStatus !== 'skipped' ? (
              <button
                onClick={onSkip}
                style={{
                  padding: '5px 13px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
                  background: '#F8FAFC', color: COLORS.text,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                ⏭️ Saltar
              </button>
            ) : null}

            {company.reviewStatus !== 'rejected' ? (
              <button
                onClick={onReject}
                style={{
                  padding: '5px 13px', borderRadius: 6, border: `1px solid #EF4444`,
                  background: '#FFF5F5', color: '#991B1B',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                ❌ Rechazar
              </button>
            ) : null}
          </div>

          {/* Detail toggle */}
          <button
            onClick={() => setShowDetail(v => !v)}
            style={{
              padding: '5px 12px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
              background: '#FFFFFF', color: COLORS.text,
              fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {showDetail ? '▲ Ocultar' : '▼ Ver detalle'}
          </button>
        </div>
      </div>

      {/* Detail panel */}
      {showDetail && (
        <div style={{
          borderTop: `1px solid ${COLORS.border}`,
          padding: '12px 16px',
          background: '#F8FAFC',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
        }}>
          {company.marketRoles?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', marginBottom: 4 }}>Market Roles</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {company.marketRoles.map((r, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#EFF6FF', color: COLORS.blue, fontWeight: 600 }}>{r}</span>
                ))}
              </div>
            </div>
          )}

          {company.technologies?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', marginBottom: 4 }}>Tecnologías</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {company.technologies.map((t, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#F0FDF4', color: '#065F46', fontWeight: 600 }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {company.geography?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', marginBottom: 4 }}>Geografía</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {company.geography.map((g, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#F5F3FF', color: COLORS.purple, fontWeight: 600 }}>
                    {FLAG_MAP[g] || ''} {g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {company.taxId && company.taxId !== 'PENDING' && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', marginBottom: 4 }}>Tax ID</div>
              <div style={{ fontSize: 12, color: COLORS.header }}>{company.taxId}</div>
            </div>
          )}

          {company.estimatedSize && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', marginBottom: 4 }}>Tamaño estimado</div>
              <div style={{ fontSize: 12, color: COLORS.header }}>{company.estimatedSize}</div>
            </div>
          )}

          {company.classificationNotes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', marginBottom: 4 }}>Notas clasificación</div>
              <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{company.classificationNotes}</div>
            </div>
          )}

          {company.notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', marginBottom: 4 }}>Notas</div>
              <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{company.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function extractDomain(url) {
  if (!url) return '';
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return u.hostname.replace('www.', '');
  } catch {
    return url.replace('www.', '').split('/')[0];
  }
}
