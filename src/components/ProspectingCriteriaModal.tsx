import { useState } from 'react';
import { createProspectingJob, triggerGitHubAction } from '../utils/airtableProspecting';

const COLORS = {
  header: '#1A2B3D',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  border: '#E2E8F0',
  text: '#6B7F94',
  bg: '#F7F9FC',
};

const COUNTRIES = [
  { code: 'ES', flag: '🇪🇸', label: 'España' },
  { code: 'PT', flag: '🇵🇹', label: 'Portugal' },
  { code: 'IT', flag: '🇮🇹', label: 'Italia' },
  { code: 'FR', flag: '🇫🇷', label: 'Francia' },
  { code: 'DE', flag: '🇩🇪', label: 'Alemania' },
  { code: 'UK', flag: '🇬🇧', label: 'UK' },
  { code: 'PL', flag: '🇵🇱', label: 'Polonia' },
  { code: 'NL', flag: '🇳🇱', label: 'Países Bajos' },
  { code: 'BE', flag: '🇧🇪', label: 'Bélgica' },
  { code: 'CH', flag: '🇨🇭', label: 'Suiza' },
  { code: 'AT', flag: '🇦🇹', label: 'Austria' },
];

const FINANCING_TYPES = [
  { value: 'debt_pf', label: 'Deuda - Project Finance' },
  { value: 'debt_cf', label: 'Deuda - Corporate Finance' },
  { value: 'equity', label: 'Equity / M&A' },
  { value: 'debt_equity', label: 'Deuda + Equity' },
];

const COMPANY_TYPES = [
  { value: 'developer', label: 'Promotor / Developer' },
  { value: 'ipp', label: 'IPP / Operador' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'fund', label: 'Fondo inversor' },
  { value: 'other', label: 'Otro' },
];

function RadioGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {options.map(opt => (
        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="radio"
            name={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            style={{ accentColor: COLORS.purple }}
          />
          <span style={{ fontSize: 13, color: COLORS.header }}>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

function CountryChip({ country, selected, onToggle }) {
  return (
    <button
      onClick={() => onToggle(country.code)}
      style={{
        padding: '4px 10px', borderRadius: 20, border: `1px solid ${selected ? COLORS.purple : COLORS.border}`,
        background: selected ? '#F5F3FF' : '#FFFFFF',
        color: selected ? COLORS.purple : COLORS.text,
        fontSize: 12, fontWeight: selected ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
        transition: 'all 0.1s',
      }}
    >
      {country.flag} {country.code}
    </button>
  );
}

export default function ProspectingCriteriaModal({ currentUser, onClose, onJobCreated }) {
  const [jobName, setJobName] = useState('');
  const [financingType, setFinancingType] = useState('debt_pf');
  const [companyType, setCompanyType] = useState('developer');
  const [companyTypeOther, setCompanyTypeOther] = useState('');
  const [assetType, setAssetType] = useState('');
  const [selectedCountries, setSelectedCountries] = useState(['ES']);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const toggleCountry = (code) => {
    setSelectedCountries(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const getTargetMarketRole = () => {
    const map = {
      debt_pf: 'Debt / Project Finance',
      debt_cf: 'Debt / Corporate Finance',
      equity: 'Equity / M&A',
      debt_equity: 'Debt + Equity',
    };
    return map[financingType] || 'Debt / Project Finance';
  };

  const getSector = () => {
    if (assetType.toLowerCase().includes('solar') || assetType.toLowerCase().includes('eólica') || assetType.toLowerCase().includes('renovable')) {
      return 'Energía Renovable';
    }
    if (assetType.toLowerCase().includes('data center')) return 'Data Centers';
    if (assetType.toLowerCase().includes('logística') || assetType.toLowerCase().includes('frío')) return 'Logística';
    if (assetType.toLowerCase().includes('inmobiliaria') || assetType.toLowerCase().includes('real estate')) return 'Real Estate';
    return 'Multi-sector';
  };

  const handleSubmit = async () => {
    if (!jobName.trim()) { setError('El nombre de la búsqueda es obligatorio'); return; }
    if (!assetType.trim()) { setError('El tipo de activo / sector es obligatorio'); return; }
    if (selectedCountries.length === 0) { setError('Selecciona al menos un país'); return; }

    setError('');
    setSubmitting(true);

    const criteria = {
      description: description.trim() || `${companyType === 'other' ? companyTypeOther : COMPANY_TYPES.find(t => t.value === companyType)?.label} · ${assetType}`,
      target_market_role: getTargetMarketRole(),
      asset_type: assetType,
      sector: getSector(),
      focus_countries: selectedCountries,
      fei_eligible: false,
      company_type: companyType === 'other' ? companyTypeOther : companyType,
      financing_type: financingType,
      job_name: jobName.trim(),
      created_by: currentUser?.name || 'unknown',
    };

    try {
      const { jobId } = await createProspectingJob(criteria, jobName.trim(), currentUser?.name || '');

      // Trigger GitHub Action
      try {
        await triggerGitHubAction(criteria, jobId);
        setToast(`✅ Búsqueda "${jobName}" lanzada correctamente`);
      } catch (ghErr) {
        // Job created in Airtable but GitHub Action failed
        console.warn('[ProspectingCriteriaModal] GitHub Action trigger failed:', ghErr.message);
        setToast(`⚠️ Job creado (${jobId}) pero no se pudo lanzar el Action. Lánzalo manualmente en GitHub.`);
      }

      setTimeout(() => {
        onJobCreated?.();
      }, 1500);
    } catch (err) {
      setError(`Error al crear el job: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.4)', zIndex: 200 }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 201, width: 580, maxHeight: '90vh', overflow: 'auto',
        background: '#FFFFFF', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: `1px solid ${COLORS.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: COLORS.header }}>
              🚀 Nueva búsqueda
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: COLORS.text }}>
              Define los criterios para encontrar empresas target automáticamente
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 20,
            color: COLORS.text, padding: '2px 6px', borderRadius: 4,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Job name */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: COLORS.header, display: 'block', marginBottom: 6 }}>
              Nombre de la búsqueda *
            </label>
            <input
              value={jobName}
              onChange={e => setJobName(e.target.value)}
              placeholder="Ej: Promotores Solar España Q1 2026"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: `1px solid ${COLORS.border}`, fontSize: 13,
                fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Financing type */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: COLORS.header, display: 'block', marginBottom: 8 }}>
              ¿Qué buscan estas empresas?
            </label>
            <RadioGroup options={FINANCING_TYPES} value={financingType} onChange={setFinancingType} />
          </div>

          {/* Company type */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: COLORS.header, display: 'block', marginBottom: 8 }}>
              Tipo de empresa
            </label>
            <RadioGroup options={COMPANY_TYPES} value={companyType} onChange={setCompanyType} />
            {companyType === 'other' && (
              <input
                value={companyTypeOther}
                onChange={e => setCompanyTypeOther(e.target.value)}
                placeholder="Especifica el tipo..."
                style={{
                  marginTop: 8, width: '100%', padding: '7px 12px', borderRadius: 6,
                  border: `1px solid ${COLORS.border}`, fontSize: 13,
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                }}
              />
            )}
          </div>

          {/* Asset type */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: COLORS.header, display: 'block', marginBottom: 6 }}>
              Tipo de activo / sector *
            </label>
            <textarea
              value={assetType}
              onChange={e => setAssetType(e.target.value)}
              placeholder="Ej: parques solares utility-scale, data centers, centros logísticos de frío..."
              rows={2}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: `1px solid ${COLORS.border}`, fontSize: 13,
                fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Countries */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: COLORS.header, display: 'block', marginBottom: 8 }}>
              Países objetivo *
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {COUNTRIES.map(c => (
                <CountryChip
                  key={c.code}
                  country={c}
                  selected={selectedCountries.includes(c.code)}
                  onToggle={toggleCountry}
                />
              ))}
            </div>
            {selectedCountries.length === 0 && (
              <div style={{ fontSize: 11, color: COLORS.text, marginTop: 4 }}>
                Selecciona al menos un país
              </div>
            )}
          </div>

          {/* Additional description */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: COLORS.header, display: 'block', marginBottom: 6 }}>
              Descripción adicional <span style={{ fontWeight: 400, color: COLORS.text }}>(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Contexto adicional sobre el perfil buscado..."
              rows={2}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: `1px solid ${COLORS.border}`, fontSize: 13,
                fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6,
              padding: '8px 12px', color: '#991B1B', fontSize: 12,
            }}>
              {error}
            </div>
          )}

          {/* Info note */}
          <div style={{
            background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 6,
            padding: '8px 12px', fontSize: 11, color: '#5B21B6',
          }}>
            💡 El proceso tarda ~10-15 minutos. Recibirás las empresas en esta vista cuando esté listo.
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: `1px solid ${COLORS.border}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 18px', borderRadius: 8, border: `1px solid ${COLORS.border}`,
              background: '#FFFFFF', color: COLORS.text,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: submitting ? '#DDD6FE' : COLORS.purple, color: '#FFFFFF',
              fontSize: 13, fontWeight: 700, cursor: submitting ? 'default' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {submitting ? '⏳ Lanzando...' : '🚀 Lanzar búsqueda'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 300,
          background: COLORS.header, color: '#FFFFFF', padding: '10px 20px',
          borderRadius: 8, fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
