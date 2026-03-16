import { useState, useEffect, useMemo } from 'react';
import { getCampaigns, getCampaignRecipients, addRecipients } from '../utils/campaignApi';

function contactPriority(role: string) {
  const r = (role || "").toLowerCase().trim();
  if (/\bceo\b|director\s*general|\bdg\b|managing\s*director|\bmd\b/.test(r)) return 1;
  if (/\bcfo\b|director\s*financier|head\s*of\s*finance|chief\s*financial/.test(r)) return 2;
  if (r.includes("financiaci") && r.includes("estructurada")) return 3;
  if (/\bm&a\b|\bm\s*&\s*a\b/.test(r)) return 4;
  if (!r || r === "no identificado" || r === "nan") return 6;
  return 5;
}

function getBestContact(company: any) {
  const contacts = (company.detail?.contacts || []).filter((c: any) => c.email);
  if (contacts.length === 0) return null;
  const sorted = [...contacts].sort((a: any, b: any) => contactPriority(a.role) - contactPriority(b.role));
  return sorted[0];
}

interface AddToCampaignModalProps {
  companies: any[];
  onClose: () => void;
  onDone: () => void;
}

export default function AddToCampaignModal({ companies, onClose, onDone }: AddToCampaignModalProps) {
  const [campaignList, setCampaignList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [sentDomains, setSentDomains] = useState<Set<string>>(new Set());
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [excludeContacted, setExcludeContacted] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Load campaigns on mount
  useEffect(() => {
    setLoading(true);
    getCampaigns()
      .then(data => {
        const valid = (data.campaigns || []).filter((c: any) =>
          ['draft', 'active', 'sent'].includes(c.status)
        );
        setCampaignList(valid);
      })
      .catch(() => setCampaignList([]))
      .finally(() => setLoading(false));
  }, []);

  // Load recipients when campaign selected
  useEffect(() => {
    if (!selectedCampaignId) { setSentDomains(new Set()); return; }
    setLoadingRecipients(true);
    getCampaignRecipients(selectedCampaignId)
      .then(data => {
        const domains = new Set<string>();
        for (const r of (data.recipients || [])) {
          if (r.domain) domains.add(r.domain.toLowerCase());
          // Also extract domain from email
          if (r.email) {
            const d = r.email.split('@')[1];
            if (d) domains.add(d.toLowerCase());
          }
        }
        setSentDomains(domains);
      })
      .catch(() => setSentDomains(new Set()))
      .finally(() => setLoadingRecipients(false));
  }, [selectedCampaignId]);

  // Compute breakdown
  const breakdown = useMemo(() => {
    const withContact: any[] = [];
    const noContact: any[] = [];
    const alreadySent: any[] = [];

    for (const c of companies) {
      const best = getBestContact(c);
      if (!best) {
        noContact.push(c);
        continue;
      }
      if (excludeContacted && sentDomains.has((c.domain || '').toLowerCase())) {
        alreadySent.push(c);
        continue;
      }
      withContact.push({ company: c, contact: best });
    }
    return { withContact, noContact, alreadySent };
  }, [companies, sentDomains, excludeContacted]);

  async function handleSubmit() {
    if (!selectedCampaignId || breakdown.withContact.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const recipients = breakdown.withContact.map(({ company, contact }: any) => ({
        email: contact.email,
        name: contact.name || '',
        organization: company.name || '',
        domain: company.domain || '',
      }));
      await addRecipients(selectedCampaignId, recipients);
      setSuccess(true);
      setTimeout(() => onDone(), 1200);
    } catch (err: any) {
      setError(err.message || 'Error al anadir empresas');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCampaign = campaignList.find(c => c.id === selectedCampaignId);

  const statusColors: Record<string, { bg: string; color: string }> = {
    draft: { bg: '#F1F5F9', color: '#64748B' },
    active: { bg: '#ECFDF5', color: '#059669' },
    sent: { bg: '#EFF6FF', color: '#2563EB' },
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0,
        background: 'rgba(10,22,40,0.7)', zIndex: 200,
        backdropFilter: 'blur(4px)',
      }} />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: '#FFFFFF', borderRadius: 16, padding: 0,
        maxWidth: 520, width: '92%', maxHeight: '80vh',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #F1F5F9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#1A2B3D' }}>
              Anadir a campana existente
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7F94' }}>
              {companies.length} empresa{companies.length !== 1 ? 's' : ''} seleccionada{companies.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0',
            background: 'transparent', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6B7F94',
          }}>{'\u00d7'}</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#6B7F94', fontSize: 13 }}>
              Cargando campanas...
            </div>
          ) : campaignList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 14, color: '#6B7F94', marginBottom: 8 }}>No hay campanas disponibles.</p>
              <p style={{ fontSize: 12, color: '#94A3B8' }}>Crea una campana primero desde la vista de Campanas.</p>
            </div>
          ) : (
            <>
              {/* Campaign list */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7F94', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Selecciona campana
                </label>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {campaignList.map(c => {
                    const isSelected = c.id === selectedCampaignId;
                    const sc = statusColors[c.status] || statusColors.draft;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCampaignId(c.id)}
                        style={{
                          padding: '10px 14px', borderRadius: 8,
                          border: `2px solid ${isSelected ? '#3B82F6' : '#E2E8F0'}`,
                          background: isSelected ? '#EFF6FF' : '#FFFFFF',
                          cursor: 'pointer', textAlign: 'left',
                          fontFamily: 'inherit', transition: 'all 0.15s ease',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2B3D' }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                            {c.totalSent || 0} enviados
                          </div>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px',
                          borderRadius: 4, background: sc.bg, color: sc.color,
                          textTransform: 'uppercase',
                        }}>{c.status}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Exclude toggle */}
              {selectedCampaignId && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
                  padding: '10px 12px', background: '#F8FAFC', borderRadius: 8,
                }}>
                  <input
                    type="checkbox"
                    checked={excludeContacted}
                    onChange={() => setExcludeContacted(v => !v)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 12, color: '#334155' }}>
                    Excluir ya contactadas en esta campana
                  </span>
                </div>
              )}

              {/* Summary */}
              {selectedCampaignId && !loadingRecipients && (
                <div style={{
                  padding: '14px 16px', background: '#F8FAFC',
                  borderRadius: 10, marginBottom: 16,
                }}>
                  <div style={{ fontSize: 12, color: '#334155', marginBottom: 6 }}>
                    <strong>{companies.length}</strong> empresas seleccionadas
                  </div>
                  {breakdown.alreadySent.length > 0 && (
                    <div style={{ fontSize: 12, color: '#94A3B8', textDecoration: 'line-through', marginBottom: 4 }}>
                      {breakdown.alreadySent.length} ya contactadas (excluidas)
                    </div>
                  )}
                  {breakdown.noContact.length > 0 && (
                    <div style={{ fontSize: 12, color: '#F59E0B', marginBottom: 4 }}>
                      {breakdown.noContact.length} sin contactos (omitidas)
                    </div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#059669', marginTop: 4 }}>
                    {breakdown.withContact.length} empresa{breakdown.withContact.length !== 1 ? 's' : ''} a anadir
                  </div>
                </div>
              )}

              {loadingRecipients && selectedCampaignId && (
                <div style={{ textAlign: 'center', padding: 16, color: '#6B7F94', fontSize: 12 }}>
                  Verificando destinatarios...
                </div>
              )}

              {/* Preview list */}
              {selectedCampaignId && !loadingRecipients && breakdown.withContact.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowPreview(v => !v)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: '#3B82F6', fontWeight: 600,
                      padding: 0, fontFamily: 'inherit', marginBottom: 8,
                    }}
                  >
                    {showPreview ? 'Ocultar' : 'Ver'} preview ({breakdown.withContact.length})
                  </button>
                  {showPreview && (
                    <div style={{
                      maxHeight: 180, overflow: 'auto',
                      border: '1px solid #E2E8F0', borderRadius: 8,
                    }}>
                      {breakdown.withContact.map(({ company, contact }: any, i: number) => (
                        <div key={company.domain} style={{
                          padding: '8px 12px', fontSize: 12,
                          borderBottom: i < breakdown.withContact.length - 1 ? '1px solid #F1F5F9' : 'none',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                          <div>
                            <span style={{ fontWeight: 600, color: '#1A2B3D' }}>{company.name}</span>
                            <span style={{ color: '#94A3B8', marginLeft: 6 }}>{company.domain}</span>
                          </div>
                          <span style={{ color: '#6B7F94', fontSize: 11 }}>{contact.email}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* All already contacted */}
              {selectedCampaignId && !loadingRecipients &&
                breakdown.withContact.length === 0 && breakdown.alreadySent.length > 0 && (
                <div style={{
                  padding: 16, background: '#FFFBEB', borderRadius: 8,
                  fontSize: 12, color: '#92400E', textAlign: 'center',
                }}>
                  Todas las empresas seleccionadas ya fueron contactadas en esta campana.
                </div>
              )}
            </>
          )}

          {error && (
            <div style={{
              marginTop: 12, padding: 10, background: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: 8,
              fontSize: 12, color: '#DC2626',
            }}>{error}</div>
          )}

          {success && (
            <div style={{
              marginTop: 12, padding: 10, background: '#ECFDF5',
              border: '1px solid #A7F3D0', borderRadius: 8,
              fontSize: 12, color: '#059669', fontWeight: 600,
            }}>
              {breakdown.withContact.length} empresa{breakdown.withContact.length !== 1 ? 's' : ''} anadida{breakdown.withContact.length !== 1 ? 's' : ''} correctamente.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid #F1F5F9',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: '1px solid #E2E8F0', background: '#FFFFFF',
              color: '#334155', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={!selectedCampaignId || breakdown.withContact.length === 0 || submitting || success}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: (!selectedCampaignId || breakdown.withContact.length === 0 || submitting || success)
                ? '#E2E8F0' : '#059669',
              color: (!selectedCampaignId || breakdown.withContact.length === 0 || submitting || success)
                ? '#94A3B8' : '#FFFFFF',
              fontSize: 13, fontWeight: 700,
              cursor: (!selectedCampaignId || breakdown.withContact.length === 0 || submitting || success)
                ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Anadiendo...' : success ? 'Anadidas' : `Anadir ${breakdown.withContact.length} empresa${breakdown.withContact.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </>
  );
}
