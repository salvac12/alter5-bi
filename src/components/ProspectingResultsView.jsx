import { useState, useEffect, useMemo } from 'react';
import { fetchJobResults, updateReviewStatus, exportToCampaignTargets } from '../utils/airtableProspecting';
import ProspectingCompanyCard from './ProspectingCompanyCard';

const COLORS = {
  bg: '#F7F9FC',
  header: '#1A2B3D',
  blue: '#3B82F6',
  green: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  purple: '#8B5CF6',
  border: '#E2E8F0',
  text: '#6B7F94',
};

function KPICard({ label, value, color }) {
  return (
    <div style={{
      background: '#FFFFFF', border: `1px solid ${COLORS.border}`,
      borderRadius: 8, padding: '10px 14px', textAlign: 'center', minWidth: 80,
    }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || COLORS.header }}>{value}</div>
      <div style={{ fontSize: 10, color: COLORS.text, marginTop: 1, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

export default function ProspectingResultsView({ jobId, jobName, currentUser, onBack }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);

  // Filters
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [signalsFilter, setSignalsFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJobResults(jobId);
        setCompanies(data);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleReview = async (recordId, newStatus) => {
    setCompanies(prev =>
      prev.map(c => c.id === recordId ? { ...c, reviewStatus: newStatus } : c)
    );
    const res = await updateReviewStatus(recordId, newStatus, currentUser?.name || '');
    if (!res) {
      showToast('⚠️ Error al guardar el estado');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const exported = await exportToCampaignTargets(companies, jobName);
      showToast(`✅ ${exported} empresa${exported !== 1 ? 's' : ''} exportada${exported !== 1 ? 's' : ''} a Candidatas`);
    } catch (err) {
      showToast(`❌ Error al exportar: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  // Available filter options
  const availableCountries = useMemo(() => {
    const set = new Set(companies.map(c => c.country).filter(Boolean));
    return Array.from(set).sort();
  }, [companies]);

  // Filtered companies
  const filtered = useMemo(() => {
    return companies.filter(c => {
      if (confidenceFilter !== 'all' && c.confidence !== confidenceFilter) return false;
      if (countryFilter !== 'all' && c.country !== countryFilter) return false;
      if (signalsFilter === 'with' && !c.financingSignals) return false;
      if (signalsFilter === 'without' && c.financingSignals) return false;
      if (statusFilter !== 'all' && c.reviewStatus !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return c.companyName.toLowerCase().includes(q) ||
               (c.companyUrl || '').toLowerCase().includes(q) ||
               (c.description || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [companies, confidenceFilter, countryFilter, signalsFilter, statusFilter, searchQuery]);

  // KPIs
  const kpis = useMemo(() => ({
    total: companies.length,
    high: companies.filter(c => c.confidence === 'high').length,
    medium: companies.filter(c => c.confidence === 'medium').length,
    low: companies.filter(c => c.confidence === 'low').length,
    approved: companies.filter(c => c.reviewStatus === 'approved').length,
    pending: companies.filter(c => c.reviewStatus === 'pending').length,
    withEmail: companies.filter(c => c.contactEmail).length,
  }), [companies]);

  const selectStyle = {
    padding: '5px 10px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
    fontSize: 12, fontFamily: 'inherit', background: '#FFFFFF', color: COLORS.header, outline: 'none',
  };

  return (
    <div style={{ maxHeight: 'calc(100vh - 57px)', overflow: 'auto', background: COLORS.bg }}>
      {/* Header */}
      <div style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              padding: '5px 12px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
              background: '#FFFFFF', color: COLORS.text,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ← Volver
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: COLORS.header, letterSpacing: '-0.5px' }}>
              {jobName}
            </h2>
            <div style={{ fontSize: 11, color: COLORS.text, marginTop: 1 }}>
              {kpis.total} encontradas · {kpis.approved} aprobadas · {kpis.pending} pendientes
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <KPICard label="Total" value={kpis.total} />
          <KPICard label="Alta conf." value={kpis.high} color={COLORS.green} />
          <KPICard label="Media" value={kpis.medium} color={COLORS.amber} />
          <KPICard label="Baja" value={kpis.low} color={COLORS.red} />
          <KPICard label="Aprobadas" value={kpis.approved} color={COLORS.green} />
          <KPICard label="Pendientes" value={kpis.pending} color={COLORS.text} />
          <KPICard label="Con email" value={kpis.withEmail} color={COLORS.blue} />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={confidenceFilter} onChange={e => setConfidenceFilter(e.target.value)} style={selectStyle}>
            <option value="all">Confianza: Todas</option>
            <option value="high">Alta</option>
            <option value="medium">Media</option>
            <option value="low">Baja</option>
          </select>

          <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)} style={selectStyle}>
            <option value="all">País: Todos</option>
            {availableCountries.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select value={signalsFilter} onChange={e => setSignalsFilter(e.target.value)} style={selectStyle}>
            <option value="all">Signals: Todas</option>
            <option value="with">Con signals</option>
            <option value="without">Sin signals</option>
          </select>

          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="all">Estado: Todos</option>
            <option value="pending">Pendientes</option>
            <option value="approved">Aprobadas</option>
            <option value="skipped">Saltadas</option>
            <option value="rejected">Rechazadas</option>
          </select>

          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar empresa o dominio..."
            style={{
              ...selectStyle,
              padding: '5px 12px', flexGrow: 1, minWidth: 180,
            }}
          />
        </div>

        <div style={{ fontSize: 11, color: COLORS.text }}>
          {filtered.length} empresa{filtered.length !== 1 ? 's' : ''} mostrada{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Company list */}
      <div style={{ padding: '12px 24px 100px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: COLORS.text }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 13 }}>Cargando resultados...</div>
          </div>
        ) : error ? (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
            padding: '12px 16px', color: '#991B1B', fontSize: 13,
          }}>
            Error al cargar: {error}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '40px 0',
            background: '#FFFFFF', borderRadius: 12, border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🔎</div>
            <div style={{ fontSize: 13, color: COLORS.text }}>
              {companies.length === 0 ? 'Sin resultados para este job' : 'Sin resultados con los filtros actuales'}
            </div>
          </div>
        ) : (
          filtered.map(company => (
            <ProspectingCompanyCard
              key={company.id}
              company={company}
              onApprove={() => handleReview(company.id, 'approved')}
              onSkip={() => handleReview(company.id, 'skipped')}
              onReject={() => handleReview(company.id, 'rejected')}
              onReset={() => handleReview(company.id, 'pending')}
              currentUser={currentUser}
              onContactUpdated={(updated) => {
                setCompanies(prev =>
                  prev.map(c => c.id === company.id ? { ...c, ...updated } : c)
                );
              }}
            />
          ))
        )}
      </div>

      {/* Sticky footer */}
      {kpis.approved > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#FFFFFF', borderTop: `1px solid ${COLORS.border}`,
          padding: '12px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', zIndex: 50,
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
        }}>
          <span style={{ fontSize: 13, color: COLORS.header, fontWeight: 600 }}>
            {kpis.approved} aprobada{kpis.approved !== 1 ? 's' : ''} · {kpis.withEmail} con email
          </span>
          <button
            onClick={handleExport}
            disabled={exporting || kpis.withEmail === 0}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: (exporting || kpis.withEmail === 0) ? '#E2E8F0' : COLORS.green,
              color: '#FFFFFF', fontSize: 13, fontWeight: 700,
              cursor: (exporting || kpis.withEmail === 0) ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {exporting ? '⏳ Exportando...' : '📤 Exportar a CandidateSearch'}
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, right: 24, zIndex: 200,
          background: COLORS.header, color: '#FFFFFF', padding: '10px 20px',
          borderRadius: 8, fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          animation: 'slideUp 0.2s ease',
        }}>
          {toast}
          <style>{`@keyframes slideUp { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
        </div>
      )}
    </div>
  );
}
