import React, { useState, useEffect } from 'react';
import {
  fetchAllProspects,
  updateProspect,
  normalizeProspect,
  isValidProspect,
  convertToOpportunity,
  PROSPECT_STAGES,
  PROSPECT_STAGE_COLORS,
  PROSPECT_STAGE_SHORT,
  ORIGIN_OPTIONS,
} from '../utils/airtableProspects';
import { isAirtableConfigured } from '../utils/airtable';

/**
 * ProspectsView - Kanban board for Alter5 Prospects funnel
 *
 * 5 columns: Lead → Interesado → Reunion → Doc. Pendiente → Listo para Term-Sheet
 * Drag & drop to move prospects between stages.
 * Auto-conversion to Opportunity when dropped in "Listo para Term-Sheet".
 */
export default function ProspectsView({ onSelectProspect, onCreateProspect }) {
  const [prospects, setProspects] = useState([]);
  const [filteredProspects, setFilteredProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [originFilter, setOriginFilter] = useState('All');
  const [draggedCard, setDraggedCard] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [converting, setConverting] = useState(null); // prospect being converted
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [pendingDrop, setPendingDrop] = useState(null); // { prospect, targetStage }
  const [toast, setToast] = useState(null);

  // Fetch data on mount
  useEffect(() => {
    loadProspects();
  }, []);

  // Filter prospects
  useEffect(() => {
    let filtered = prospects;

    if (originFilter !== 'All') {
      filtered = filtered.filter(p => p.origin === originFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.origin.toLowerCase().includes(query) ||
        p.product.toLowerCase().includes(query)
      );
    }

    setFilteredProspects(filtered);
  }, [searchQuery, originFilter, prospects]);

  async function loadProspects() {
    if (!isAirtableConfigured()) {
      setError('Airtable no configurado. Configura VITE_AIRTABLE_PAT.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const records = await fetchAllProspects();
      const normalized = records.map(normalizeProspect).filter(isValidProspect);
      // Exclude already converted prospects
      setProspects(normalized.filter(p => !p.converted));
    } catch (err) {
      console.error('Failed to load prospects:', err);
      setError(err.message || 'Error al cargar prospects');
    } finally {
      setLoading(false);
    }
  }

  function showToast(type, message) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  // Drag handlers
  function handleDragStart(e, prospect) {
    setDraggedCard(prospect);
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  }

  function handleDragEnd(e) {
    e.currentTarget.style.opacity = '1';
    setDraggedCard(null);
    setDragOverColumn(null);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDragEnter(stage) {
    setDragOverColumn(stage);
  }

  async function handleDrop(e, targetStage) {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedCard || draggedCard.stage === targetStage) return;

    // If dropping into "Listo para Term-Sheet", show conversion dialog
    if (targetStage === "Listo para Term-Sheet") {
      setPendingDrop({ prospect: draggedCard, targetStage });
      setShowConvertDialog(true);
      return;
    }

    // Normal stage move
    try {
      const updated = prospects.map(p =>
        p.id === draggedCard.id ? { ...p, stage: targetStage } : p
      );
      setProspects(updated);

      await updateProspect(draggedCard.id, { "Stage": targetStage });
    } catch (err) {
      console.error('Failed to update prospect stage:', err);
      setProspects(prospects);
      showToast('error', 'Error al mover prospect: ' + err.message);
    }
  }

  // Handle conversion confirmation
  async function handleConvert() {
    if (!pendingDrop) return;
    const { prospect } = pendingDrop;

    setConverting(prospect.id);
    try {
      await convertToOpportunity(prospect);
      // Remove from prospects list (it's now an Opportunity)
      setProspects(prev => prev.filter(p => p.id !== prospect.id));
      showToast('success', `"${prospect.name}" convertido a Oportunidad (Termsheet)`);
    } catch (err) {
      console.error('Conversion failed:', err);
      showToast('error', 'Error al convertir: ' + err.message);
    } finally {
      setConverting(null);
      setShowConvertDialog(false);
      setPendingDrop(null);
    }
  }

  function handleCancelConvert() {
    setShowConvertDialog(false);
    setPendingDrop(null);
  }

  // Move to last stage WITHOUT converting
  async function handleMoveOnly() {
    if (!pendingDrop) return;
    const { prospect, targetStage } = pendingDrop;

    try {
      const updated = prospects.map(p =>
        p.id === prospect.id ? { ...p, stage: targetStage } : p
      );
      setProspects(updated);
      await updateProspect(prospect.id, { "Stage": targetStage });
    } catch (err) {
      console.error('Failed to move prospect:', err);
      setProspects(prospects);
      showToast('error', 'Error al mover prospect');
    } finally {
      setShowConvertDialog(false);
      setPendingDrop(null);
    }
  }

  // Group by stage
  const prospectsByStage = PROSPECT_STAGES.reduce((acc, stage) => {
    acc[stage] = filteredProspects.filter(p => p.stage === stage);
    return acc;
  }, {});

  const totalCount = filteredProspects.length;
  const totalAmount = filteredProspects.reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Prospects</h2>
          <span style={styles.count}>
            {totalCount} prospects
            {totalAmount > 0 && (
              <span style={{ marginLeft: 8, color: '#3B82F6', fontWeight: 700 }}>
                {formatAmount(totalAmount, 'EUR')}
              </span>
            )}
          </span>
        </div>

        <div style={styles.headerRight}>
          {/* Search */}
          <div style={styles.searchContainer}>
            <svg style={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="11" cy="11" r="8" strokeWidth="2"/>
              <path d="m21 21-4.35-4.35" strokeWidth="2"/>
            </svg>
            <input
              type="text"
              placeholder="Buscar prospects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={styles.clearButton}>
                x
              </button>
            )}
          </div>

          {/* Origin filter */}
          <div style={styles.filterGroup}>
            {['All', ...ORIGIN_OPTIONS.slice(0, 3)].map(filter => (
              <button
                key={filter}
                onClick={() => setOriginFilter(filter)}
                style={{
                  ...styles.filterButton,
                  ...(originFilter === filter ? styles.filterButtonActive : {}),
                }}
              >
                {filter === 'All' ? 'Todos' : filter}
              </button>
            ))}
          </div>

          {/* Create button */}
          <button
            onClick={() => onCreateProspect && onCreateProspect(null)}
            style={styles.createButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #7C3AED, #2563EB)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #8B5CF6, #3B82F6)';
            }}
          >
            <span style={styles.createIcon}>+</span>
            Nuevo Prospect
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={styles.errorContainer}>
          <div style={styles.errorIcon}>{'\u26A0'}</div>
          <div>
            <div style={styles.errorTitle}>Error al cargar prospects</div>
            <div style={styles.errorMessage}>{error}</div>
          </div>
          <button onClick={loadProspects} style={styles.retryButton}>
            Reintentar
          </button>
        </div>
      )}

      {/* Board */}
      <div style={styles.boardContainer}>
        <div style={styles.board}>
          {PROSPECT_STAGES.map((stage) => (
            <ProspectColumn
              key={stage}
              stage={stage}
              prospects={prospectsByStage[stage] || []}
              loading={loading}
              isDragOver={dragOverColumn === stage}
              onDragOver={handleDragOver}
              onDragEnter={() => handleDragEnter(stage)}
              onDragLeave={() => {}}
              onDrop={(e) => handleDrop(e, stage)}
              onCardDragStart={handleDragStart}
              onCardDragEnd={handleDragEnd}
              onCardClick={onSelectProspect}
              onAddClick={() => onCreateProspect && onCreateProspect(stage)}
            />
          ))}
        </div>
      </div>

      {/* Conversion dialog */}
      {showConvertDialog && pendingDrop && (
        <>
          <div
            onClick={handleCancelConvert}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(26, 43, 61, 0.6)',
              zIndex: 150,
            }}
          />
          <div role="dialog" aria-labelledby="convert-title" aria-describedby="convert-desc" style={styles.convertDialog}>
            <div id="convert-title" style={styles.convertDialogHeader}>
              Convertir a Oportunidad
            </div>
            <div id="convert-desc" style={styles.convertDialogBody}>
              <strong>{pendingDrop.prospect.name}</strong> esta listo para pasar al Pipeline como oportunidad activa.
            </div>
            <div style={styles.convertDialogBody2}>
              <strong style={{ display: 'block', marginBottom: 6 }}>Que sucedera:</strong>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                <li>Se creara una oportunidad en Pipeline (etapa: Origination - Termsheet)</li>
                <li>El importe y datos se copiaran automaticamente</li>
                <li>Este prospect se marcara como convertido y desaparecera de esta vista</li>
              </ul>
            </div>
            <div style={styles.convertDialogActions}>
              <button
                onClick={handleCancelConvert}
                disabled={!!converting}
                style={styles.convertCancelBtn}
              >
                Cancelar
              </button>
              <button
                onClick={handleConvert}
                disabled={!!converting}
                style={styles.convertConfirmBtn}
              >
                {converting ? 'Convirtiendo...' : 'Convertir a Oportunidad'}
              </button>
            </div>
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <button
                onClick={handleMoveOnly}
                disabled={!!converting}
                style={styles.convertMoveOnlyBtnSubtle}
              >
                Solo mover sin convertir
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.type === 'success' ? '#10B981' : '#EF4444',
          color: '#FFFFFF', padding: '14px 20px', borderRadius: 10,
          fontSize: 14, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 200,
          display: 'flex', alignItems: 'center', gap: 10, maxWidth: 400,
          animation: 'slideInUp 0.3s ease-out',
        }}>
          <span style={{ fontSize: 18 }}>
            {toast.type === 'success' ? '\u2713' : '\u2717'}
          </span>
          {toast.message}
        </div>
      )}

      <style>{`
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes dialogFadeIn {
          from { opacity: 0; transform: translate(-50%, -48%); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
        button:focus-visible {
          outline: 2px solid #8B5CF6;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

// ── Column Component ────────────────────────────────────────────────

function ProspectColumn({
  stage, prospects, loading, isDragOver,
  onDragOver, onDragEnter, onDragLeave, onDrop,
  onCardDragStart, onCardDragEnd, onCardClick, onAddClick,
}) {
  const colors = PROSPECT_STAGE_COLORS[stage] || { bg: '#F7F9FC', color: '#6B7F94', border: '#E2E8F0' };
  const shortLabel = PROSPECT_STAGE_SHORT[stage] || stage;
  const isLastStage = stage === "Listo para Term-Sheet";

  const totalAmount = prospects.reduce((sum, p) => sum + (p.amount || 0), 0);

  const columnStyle = {
    ...styles.column,
    background: isDragOver
      ? `linear-gradient(to bottom, ${colors.bg}, #FFFFFF)`
      : colors.bg,
    borderTop: `3px solid ${isDragOver ? colors.color : colors.border}`,
    boxShadow: isDragOver
      ? `0 0 0 2px ${colors.color}40, 0 8px 16px rgba(0,0,0,0.08)`
      : isLastStage
        ? '0 0 0 1px #05966940, 0 4px 12px rgba(5, 150, 105, 0.08)'
        : 'none',
  };

  return (
    <div
      style={columnStyle}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Column Header */}
      <div style={styles.columnHeader}>
        <div style={styles.columnTitle}>
          <span style={{ color: colors.color, fontWeight: 700 }}>
            {shortLabel}
          </span>
          {isLastStage && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 5px',
              borderRadius: 3, background: '#22C55E20', color: '#22C55E',
              marginLeft: 2,
            }}>CONV</span>
          )}
          <span style={styles.columnCount}>
            {prospects.length}
          </span>
        </div>
        <button
          onClick={onAddClick}
          style={{
            ...styles.columnAddButton,
            color: colors.color,
            borderColor: colors.border,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.bg;
            e.currentTarget.style.borderColor = colors.color;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = colors.border;
          }}
        >
          +
        </button>
      </div>

      {/* Amount summary */}
      {totalAmount > 0 && (
        <div style={{
          padding: '4px 16px 8px', fontSize: 11, fontWeight: 600,
          color: colors.color, opacity: 0.8,
        }}>
          {formatAmount(totalAmount, 'EUR')}
        </div>
      )}

      {/* Cards */}
      <div style={styles.cardsContainer}>
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : prospects.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: 28, opacity: 0.3, marginBottom: 8 }}>
              {isLastStage ? '\u2705' : '\u{1F4CB}'}
            </div>
            <div style={styles.emptyText}>Sin prospects</div>
          </div>
        ) : (
          prospects.map((prospect) => (
            <ProspectCard
              key={prospect.id}
              prospect={prospect}
              stageColor={colors.color}
              onDragStart={onCardDragStart}
              onDragEnd={onCardDragEnd}
              onClick={() => onCardClick && onCardClick(prospect)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Card Component ──────────────────────────────────────────────────

function ProspectCard({ prospect, stageColor, onDragStart, onDragEnd, onClick }) {
  const [isHovered, setIsHovered] = useState(false);
  const formattedAmount = formatAmount(prospect.amount, prospect.currency);

  const cardStyle = {
    ...styles.card,
    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
    boxShadow: isHovered
      ? '0 8px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(139, 92, 246, 0.3)'
      : '0 2px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
  };

  return (
    <div
      draggable
      tabIndex={0}
      role="button"
      aria-label={`Prospect: ${prospect.name}${formattedAmount ? ', ' + formattedAmount : ''}`}
      onDragStart={(e) => onDragStart(e, prospect)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      style={cardStyle}
    >
      {/* Drag handle */}
      <div style={styles.dragHandle}>
        <div style={styles.dragHandleDot} />
        <div style={styles.dragHandleDot} />
        <div style={styles.dragHandleDot} />
      </div>

      {/* Content */}
      <div style={styles.cardContent}>
        <div style={styles.cardTitle}>
          {prospect.name || 'Sin nombre'}
        </div>

        {formattedAmount && (
          <div style={styles.cardAmount}>
            {formattedAmount}
          </div>
        )}

        {/* Badges row */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {/* Product badge */}
          {prospect.product && prospect.product !== '(pendiente)' && (
            <span style={{
              ...styles.badge,
              background: '#EFF6FF',
              color: '#3B82F6',
            }}>
              {prospect.product}
            </span>
          )}

          {/* Origin badge */}
          {prospect.origin && (
            <span style={{
              ...styles.badge,
              background: `${stageColor}15`,
              color: stageColor,
            }}>
              {prospect.origin}
            </span>
          )}
        </div>

        {/* Indicators */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
          {prospect.context && (
            <span style={{ fontSize: 11, color: '#6B7F94', display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Notas
            </span>
          )}
          {prospect.assignedTo && prospect.assignedTo !== 'Otro' && (
            <span style={{ fontSize: 11, color: '#6B7F94', display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              {prospect.assignedTo}
            </span>
          )}
          {prospect.tasks && prospect.tasks.length > 0 && (
            <span style={{
              fontSize: 11, color: '#8B5CF6', display: 'flex', alignItems: 'center', gap: 3,
              fontWeight: 600,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 11l3 3L22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              {prospect.tasks.filter(t => t.status === 'hecho').length}/{prospect.tasks.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div style={styles.skeleton}>
      <div style={styles.skeletonLine} />
      <div style={{ ...styles.skeletonLine, width: '60%', marginTop: 8 }} />
      <div style={{ ...styles.skeletonLine, width: '40%', marginTop: 12, height: 20 }} />
    </div>
  );
}

// ── Format helper ───────────────────────────────────────────────────

function formatAmount(amount, currency = "EUR") {
  if (!amount || amount === 0) return null;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M ${currency}`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K ${currency}`;
  return `${amount} ${currency}`;
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#F7F9FC',
    overflow: 'hidden',
  },

  // Header
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    background: '#FFFFFF',
    borderBottom: '1px solid #E2E8F0',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 800,
    color: '#1A2B3D',
    margin: 0,
    letterSpacing: '-0.5px',
  },
  count: {
    fontSize: 13,
    color: '#6B7F94',
    fontWeight: 500,
  },
  headerRight: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },

  // Search
  searchContainer: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    color: '#94A3B8',
    pointerEvents: 'none',
  },
  searchInput: {
    padding: '8px 36px 8px 36px',
    borderRadius: 8,
    border: '1px solid #E2E8F0',
    fontSize: 13,
    fontFamily: "'DM Sans', system-ui",
    width: 260,
    outline: 'none',
    transition: 'all 0.2s ease',
    background: '#FFFFFF',
  },
  clearButton: {
    position: 'absolute',
    right: 8,
    background: 'none',
    border: 'none',
    color: '#94A3B8',
    fontSize: 16,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1,
    borderRadius: 4,
  },

  // Filter
  filterGroup: {
    display: 'flex',
    gap: 0,
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid #E2E8F0',
  },
  filterButton: {
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: '#6B7F94',
    background: '#FFFFFF',
    border: 'none',
    borderRight: '1px solid #E2E8F0',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: "'DM Sans', system-ui",
  },
  filterButtonActive: {
    background: '#8B5CF6',
    color: '#FFFFFF',
  },

  // Create button
  createButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: "'DM Sans', system-ui",
  },
  createIcon: {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
  },

  // Error
  errorContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    margin: '20px 24px',
    padding: '16px 20px',
    background: '#FEF2F2',
    border: '1px solid #FEE2E2',
    borderRadius: 8,
  },
  errorIcon: {
    fontSize: 24,
    color: '#EF4444',
    fontWeight: 700,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#DC2626',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 12,
    color: '#991B1B',
  },
  retryButton: {
    marginLeft: 'auto',
    padding: '6px 14px',
    background: '#FFFFFF',
    border: '1px solid #FCA5A5',
    borderRadius: 6,
    color: '#DC2626',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', system-ui",
  },

  // Board
  boardContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '0 24px 24px',
  },
  board: {
    display: 'flex',
    gap: 16,
    minHeight: '100%',
    paddingTop: 20,
  },

  // Column
  column: {
    minWidth: 280,
    maxWidth: 280,
    flex: '0 0 280px',
    display: 'flex',
    flexDirection: 'column',
    background: '#FFFFFF',
    borderRadius: 10,
    transition: 'all 0.2s ease',
  },
  columnHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid #E2E8F0',
  },
  columnTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  columnCount: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    height: 22,
    padding: '0 6px',
    background: '#F1F5F9',
    borderRadius: 11,
    fontSize: 11,
    fontWeight: 700,
    color: '#475569',
  },
  columnAddButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: '1px solid #E2E8F0',
    background: 'transparent',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
    lineHeight: 1,
  },

  // Cards
  cardsContainer: {
    flex: 1,
    padding: '12px',
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },

  // Card
  card: {
    background: '#FFFFFF',
    borderRadius: 8,
    padding: '12px',
    cursor: 'grab',
    transition: 'all 0.2s ease',
    userSelect: 'none',
  },
  dragHandle: {
    display: 'flex',
    gap: 2,
    marginBottom: 8,
    opacity: 0.3,
  },
  dragHandleDot: {
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: '#94A3B8',
  },
  cardContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#1A2B3D',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  cardAmount: {
    fontSize: 13,
    fontWeight: 700,
    color: '#8B5CF6',
    letterSpacing: '-0.3px',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 7px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
    maxWidth: 120,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Empty
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: 500,
  },

  // Skeleton
  skeleton: {
    background: '#FFFFFF',
    borderRadius: 8,
    padding: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
  },
  skeletonLine: {
    height: 14,
    background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
    backgroundSize: '200% 100%',
    borderRadius: 4,
  },

  // Convert dialog
  convertDialog: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: '#FFFFFF',
    borderRadius: 12,
    padding: 28,
    maxWidth: 480,
    width: '90%',
    border: '1px solid #E2E8F0',
    boxShadow: '0 20px 60px rgba(26, 43, 61, 0.3)',
    zIndex: 151,
    animation: 'dialogFadeIn 0.2s ease-out',
  },
  convertDialogHeader: {
    fontSize: 20,
    fontWeight: 800,
    color: '#1A2B3D',
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  convertDialogBody: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 1.6,
    marginBottom: 8,
  },
  convertDialogBody2: {
    fontSize: 13,
    color: '#6B7F94',
    lineHeight: 1.5,
    marginBottom: 24,
    padding: '10px 14px',
    background: '#F7F9FC',
    borderRadius: 6,
    border: '1px solid #E2E8F0',
  },
  convertDialogActions: {
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
  },
  convertCancelBtn: {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    color: '#6B7F94',
    background: '#F7F9FC',
    border: '2px solid #E2E8F0',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  convertMoveOnlyBtnSubtle: {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 500,
    color: '#6B7F94',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    textUnderlineOffset: '3px',
  },
  convertConfirmBtn: {
    padding: '10px 22px',
    fontSize: 14,
    fontWeight: 700,
    color: '#FFFFFF',
    background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 2px 8px rgba(139, 92, 246, 0.25)',
  },
};
