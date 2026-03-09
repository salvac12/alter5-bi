import { useState, useEffect, useCallback } from 'react';
import { fetchProspectingJobs } from '../utils/airtableProspecting';
import ProspectingCriteriaModal from './ProspectingCriteriaModal';
import ProspectingResultsView from './ProspectingResultsView';

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

function StatusBadge({ status }) {
  const config = {
    pending: { color: '#92400E', bg: '#FEF3C7', label: '⏳ Pendiente' },
    running: { color: '#1D4ED8', bg: '#EFF6FF', label: '🔄 En curso' },
    completed: { color: '#065F46', bg: '#ECFDF5', label: '✅ Completado' },
    failed: { color: '#991B1B', bg: '#FEF2F2', label: '❌ Fallido' },
  };
  const c = config[status] || config.pending;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
      background: c.bg, color: c.color,
    }}>
      {c.label}
    </span>
  );
}

function KPICard({ label, value, color }) {
  return (
    <div style={{
      background: '#FFFFFF', border: `1px solid ${COLORS.border}`,
      borderRadius: 8, padding: '12px 16px', minWidth: 100, textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || COLORS.header }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.text, marginTop: 2, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

export default function ProspectingView({ currentUser }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedJobName, setSelectedJobName] = useState('');

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetchProspectingJobs();
      setJobs(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Polling every 30s for running jobs
  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'running');
    if (!hasRunning) return;

    const interval = setInterval(loadJobs, 30000);
    return () => clearInterval(interval);
  }, [jobs, loadJobs]);

  const kpis = {
    total: jobs.length,
    running: jobs.filter(j => j.status === 'running').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    companies: jobs.reduce((s, j) => s + (j.totalCompanies || 0), 0),
  };

  // Show results view for selected job
  if (selectedJobId) {
    return (
      <ProspectingResultsView
        jobId={selectedJobId}
        jobName={selectedJobName}
        currentUser={currentUser}
        onBack={() => { setSelectedJobId(null); setSelectedJobName(''); loadJobs(); }}
      />
    );
  }

  return (
    <div style={{ maxHeight: 'calc(100vh - 57px)', overflow: 'auto', background: COLORS.bg }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: COLORS.header, letterSpacing: '-0.5px' }}>
              Prospección Automática
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: COLORS.text }}>
              Descubrir nuevas empresas target con IA
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: COLORS.purple, color: '#FFFFFF',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            + Nueva búsqueda
          </button>
        </div>

        {/* KPIs */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <KPICard label="Total jobs" value={kpis.total} />
          <KPICard label="En curso" value={kpis.running} color={COLORS.blue} />
          <KPICard label="Completados" value={kpis.completed} color={COLORS.green} />
          <KPICard label="Empresas encontradas" value={kpis.companies} color={COLORS.purple} />
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '0 24px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: COLORS.text }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 13 }}>Cargando jobs...</div>
          </div>
        ) : error ? (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
            padding: '12px 16px', color: '#991B1B', fontSize: 13,
          }}>
            Error al cargar: {error}
          </div>
        ) : jobs.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 0',
            background: '#FFFFFF', borderRadius: 12, border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.header, marginBottom: 6 }}>
              Sin búsquedas todavía
            </div>
            <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 20 }}>
              Lanza tu primera búsqueda automática para descubrir empresas target
            </div>
            <button
              onClick={() => setShowModal(true)}
              style={{
                padding: '9px 22px', borderRadius: 8, border: 'none',
                background: COLORS.purple, color: '#FFFFFF',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              + Nueva búsqueda
            </button>
          </div>
        ) : (
          <div style={{ background: '#FFFFFF', borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 2fr 120px 80px 80px 120px 150px',
              gap: 0, padding: '10px 16px',
              background: '#F8FAFC', borderBottom: `1px solid ${COLORS.border}`,
              fontSize: 11, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              <div>Nombre</div>
              <div>Criterios</div>
              <div>Estado</div>
              <div>Empresas</div>
              <div>Aprobadas</div>
              <div>Creado</div>
              <div>Acciones</div>
            </div>

            {/* Rows */}
            {jobs.map((job, idx) => (
              <JobRow
                key={job.jobId}
                job={job}
                isLast={idx === jobs.length - 1}
                onReview={() => { setSelectedJobId(job.jobId); setSelectedJobName(job.jobName); }}
                onRetry={() => {
                  // TODO: implement retry
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <ProspectingCriteriaModal
          currentUser={currentUser}
          onClose={() => setShowModal(false)}
          onJobCreated={() => {
            setShowModal(false);
            setTimeout(loadJobs, 2000); // refresh after short delay
          }}
        />
      )}
    </div>
  );
}

function JobRow({ job, isLast, onReview, onRetry }) {
  const criteriaStr = [
    job.criteria?.description,
    job.criteria?.focus_countries?.join(', '),
  ].filter(Boolean).join(' · ');

  const createdDate = job.createdAt
    ? new Date(job.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })
    : '—';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '2fr 2fr 120px 80px 80px 120px 150px',
      gap: 0, padding: '12px 16px', alignItems: 'center',
      borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`,
      transition: 'background 0.1s',
    }}
      onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.header }}>{job.jobName}</div>
        <div style={{ fontSize: 10, color: COLORS.text, marginTop: 1 }}>{job.jobId}</div>
      </div>
      <div style={{ fontSize: 11, color: COLORS.text, paddingRight: 8 }}>
        {criteriaStr || '—'}
      </div>
      <div>
        <StatusBadge status={job.status} />
        {job.status === 'running' && (
          <div style={{ fontSize: 10, color: COLORS.blue, marginTop: 3 }}>
            Actualizando cada 30s...
          </div>
        )}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.header, textAlign: 'center' }}>
        {job.totalCompanies || 0}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.green, textAlign: 'center' }}>
        {job.approvedCount || 0}
      </div>
      <div style={{ fontSize: 11, color: COLORS.text }}>{createdDate}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {job.status === 'completed' && (
          <button
            onClick={onReview}
            style={{
              padding: '5px 12px', borderRadius: 6, border: `1px solid ${COLORS.blue}`,
              background: '#EFF6FF', color: COLORS.blue,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Revisar →
          </button>
        )}
        {job.status === 'failed' && (
          <button
            onClick={onRetry}
            style={{
              padding: '5px 12px', borderRadius: 6, border: `1px solid ${COLORS.amber}`,
              background: '#FFFBEB', color: '#92400E',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Reintentar
          </button>
        )}
        {job.status === 'running' && (
          <span style={{ fontSize: 11, color: COLORS.text }}>En progreso...</span>
        )}
        {job.status === 'pending' && (
          <span style={{ fontSize: 11, color: COLORS.text }}>⏳ Esperando...</span>
        )}
      </div>
    </div>
  );
}
