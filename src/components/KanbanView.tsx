import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  fetchAllOpportunities,
  updateOpportunity,
  normalizeRecord,
  isValidOpportunity,
  isAirtableConfigured,
  KANBAN_STAGES,
  STAGE_COLORS,
  STAGE_SHORT_LABELS
} from '../utils/airtable';

/* ─── Light theme constants ──────────────────────────────────── */

const LIGHT = {
  bg: '#F0F4F8',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  columnHeaderBg: '#1E293B',
  columnHeaderText: '#F1F5F9',
  columnHeaderBorder: '#334155',
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Debt: { bg: '#EFF6FF', text: '#3B82F6' },
  'M&A': { bg: '#F0FDF4', text: '#10B981' },
  Equity: { bg: '#F0FDF4', text: '#10B981' },
};

/**
 * KanbanView - Professional Kanban board for Alter5 BI
 *
 * Features:
 * - 9 columns representing pipeline stages
 * - Native HTML5 drag & drop
 * - Live Airtable integration
 * - Search and filter
 * - Loading and error states
 * - Responsive design
 */
export default function KanbanView({ onSelectOpportunity, onCreateOpportunity }: {
  onSelectOpportunity?: (opportunity: any) => void;
  onCreateOpportunity?: (stage: string | null) => void;
}) {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [filteredOpportunities, setFilteredOpportunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [businessFilter, setBusinessFilter] = useState('All');
  const [draggedCard, setDraggedCard] = useState<any>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  // Fetch data on mount
  useEffect(() => {
    loadOpportunities();
  }, []);

  // Filter opportunities when search query or business filter changes
  useEffect(() => {
    let filtered = opportunities;

    // Business type filter
    if (businessFilter !== 'All') {
      filtered = filtered.filter(opp => opp.businessType === businessFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(opp =>
        opp.name.toLowerCase().includes(query)
      );
    }

    setFilteredOpportunities(filtered);
  }, [searchQuery, businessFilter, opportunities]);

  async function loadOpportunities() {
    if (!isAirtableConfigured()) {
      setError('Airtable is not configured. Please set VITE_AIRTABLE_PAT.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const records = await fetchAllOpportunities();
      const normalized = records.map(normalizeRecord).filter(isValidOpportunity);
      setOpportunities(normalized);
    } catch (err: any) {
      console.error('Failed to load opportunities:', err);
      setError(err.message || 'Error al cargar oportunidades');
    } finally {
      setLoading(false);
    }
  }

  function showToast(type: string, message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  // Drag handlers
  function handleDragStart(e: React.DragEvent, opportunity: any) {
    setDraggedCard(opportunity);
    e.dataTransfer.effectAllowed = 'move';
    // Add a subtle opacity to the dragged element
    (e.currentTarget as HTMLElement).style.opacity = '0.5';
  }

  function handleDragEnd(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).style.opacity = '1';
    setDraggedCard(null);
    setDragOverColumn(null);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDragEnter(stage: string) {
    setDragOverColumn(stage);
  }

  function handleDragLeave() {
    // Only clear if we're actually leaving the column area
    // This prevents flickering when moving over child elements
  }

  async function handleDrop(e: React.DragEvent, targetStage: string) {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedCard || draggedCard.stage === targetStage) {
      return;
    }

    try {
      // Optimistically update UI
      const updatedOpportunities = opportunities.map(opp =>
        opp.id === draggedCard.id
          ? { ...opp, stage: targetStage }
          : opp
      );
      setOpportunities(updatedOpportunities);

      // Update in Airtable
      await updateOpportunity(draggedCard.id, { "Global Status": targetStage });
      showToast('success', `"${draggedCard.name}" movido a ${STAGE_SHORT_LABELS[targetStage] || targetStage}`);
    } catch (err: any) {
      console.error('Failed to update opportunity stage:', err);
      // Revert on error
      setOpportunities(opportunities);
      showToast('error', 'Error al mover oportunidad: ' + err.message);
    }
  }

  // Group opportunities by stage
  const opportunitiesByStage = KANBAN_STAGES.reduce((acc: any, stage: string) => {
    acc[stage] = filteredOpportunities.filter(opp => opp.stage === stage);
    return acc;
  }, {});

  // Pre-compute totals for the funnel strip (uses all opportunities, not filtered)
  const stageTotals = KANBAN_STAGES.reduce((acc: any, stage: string) => {
    const opps = opportunities.filter(o => o.stage === stage);
    acc[stage] = { count: opps.length, amount: opps.reduce((s: number, o: any) => s + (o.amount || 0), 0) };
    return acc;
  }, {});

  // Funnel strip: compute segment widths
  const totalPipelineCount = opportunities.length || 1;

  const totalCount = filteredOpportunities.length;
  const totalAmount = filteredOpportunities.reduce((sum: number, opp: any) => sum + (opp.amount || 0), 0);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Pipeline</h2>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11, color: LIGHT.textMuted, fontWeight: 500 }}>Total activo</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#3B82F6' }}>
                {totalAmount > 0 ? formatAmount(totalAmount, 'EUR') : '—'}
              </span>
            </div>
            <div style={{ width: 1, height: 28, background: LIGHT.border }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11, color: LIGHT.textMuted, fontWeight: 500 }}>Deals activos</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: LIGHT.textPrimary }}>{totalCount}</span>
            </div>
          </div>
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
              placeholder="Buscar oportunidades..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={styles.clearButton}
              >
                x
              </button>
            )}
          </div>

          {/* Business type filter */}
          <div style={styles.filterGroup}>
            {['All', 'Debt', 'M&A'].map(filter => (
              <button
                key={filter}
                onClick={() => setBusinessFilter(filter)}
                style={{
                  ...styles.filterButton,
                  ...(businessFilter === filter ? styles.filterButtonActive : {}),
                }}
              >
                {filter === 'All' ? 'Todos' : filter}
              </button>
            ))}
          </div>

          {/* Create button */}
          <button
            onClick={() => onCreateOpportunity && onCreateOpportunity(null)}
            style={styles.createButton}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'linear-gradient(135deg, #2563EB, #059669)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'linear-gradient(135deg, #3B82F6, #10B981)';
            }}
          >
            <span style={styles.createIcon}>+</span>
            Nueva Oportunidad
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={styles.errorContainer}>
          <div style={styles.errorIcon}>{'\u26A0'}</div>
          <div>
            <div style={styles.errorTitle}>Error al cargar oportunidades</div>
            <div style={styles.errorMessage}>{error}</div>
          </div>
          <button onClick={loadOpportunities} style={styles.retryButton}>
            Reintentar
          </button>
        </div>
      )}

      {/* Funnel strip — colored horizontal bar showing stage distribution */}
      {!loading && opportunities.length > 0 && (
        <div style={{
          padding: '10px 24px', background: LIGHT.surface,
          borderBottom: `1px solid ${LIGHT.border}`, flexShrink: 0,
        }}>
          {/* Funnel bar */}
          <div style={{
            display: 'flex', height: 6, borderRadius: 9999, overflow: 'hidden',
            background: '#E2E8F0', marginBottom: 8,
          }}>
            {KANBAN_STAGES.map((stage: string) => {
              const { count } = stageTotals[stage] || { count: 0 };
              const pct = (count / totalPipelineCount) * 100;
              const stageColors = STAGE_COLORS[stage] || { color: '#6B7F94' };
              if (pct === 0) return null;
              return (
                <div
                  key={stage}
                  title={`${STAGE_SHORT_LABELS[stage] || stage}: ${count}`}
                  style={{
                    width: `${pct}%`, height: '100%',
                    background: stageColors.color,
                    transition: 'width 0.3s ease',
                  }}
                />
              );
            })}
          </div>
          {/* Stage labels */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
            {KANBAN_STAGES.map((stage: string, i: number) => {
              const { count, amount: stageAmount } = stageTotals[stage] || { count: 0, amount: 0 };
              const stageColors = STAGE_COLORS[stage] || { bg: '#F7F9FC', color: '#6B7F94', border: '#E2E8F0' };
              const shortLabel = STAGE_SHORT_LABELS[stage] || stage;
              return (
                <React.Fragment key={stage}>
                  {i > 0 && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  )}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0,
                    background: count > 0 ? `${stageColors.color}10` : 'transparent',
                    border: count > 0 ? `1px solid ${stageColors.color}20` : '1px solid transparent',
                  }}>
                    <span style={{ color: stageColors.color, fontWeight: 700, fontSize: 11 }}>{shortLabel}</span>
                    <span style={{
                      background: stageColors.color, color: '#FFFFFF',
                      borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 800, lineHeight: '16px',
                    }}>{count}</span>
                    {stageAmount > 0 && (
                      <span style={{ color: LIGHT.textMuted, fontSize: 10 }}>
                        {formatAmount(stageAmount, 'EUR')}
                      </span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Board */}
      <div style={styles.boardContainer}>
        <div style={styles.board}>
          {KANBAN_STAGES.map((stage: string) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              opportunities={opportunitiesByStage[stage] || []}
              loading={loading}
              isDragOver={dragOverColumn === stage}
              onDragOver={handleDragOver}
              onDragEnter={() => handleDragEnter(stage)}
              onDragLeave={handleDragLeave}
              onDrop={(e: React.DragEvent) => handleDrop(e, stage)}
              onCardDragStart={handleDragStart}
              onCardDragEnd={handleDragEnd}
              onCardClick={onSelectOpportunity}
              onAddClick={() => onCreateOpportunity && onCreateOpportunity(stage)}
            />
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.type === 'success' ? '#10B981' : '#EF4444',
          color: '#FFFFFF', padding: '14px 20px', borderRadius: 10,
          fontSize: 14, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 200,
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
      `}</style>
    </div>
  );
}

/**
 * KanbanColumn - Single column in the Kanban board
 */
function KanbanColumn({
  stage,
  opportunities,
  loading,
  isDragOver,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onCardClick,
  onAddClick,
}: {
  stage: string;
  opportunities: any[];
  loading: boolean;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onCardDragStart: (e: React.DragEvent, opportunity: any) => void;
  onCardDragEnd: (e: React.DragEvent) => void;
  onCardClick?: (opportunity: any) => void;
  onAddClick: () => void;
}) {
  const colors = STAGE_COLORS[stage] || { bg: '#F7F9FC', color: '#6B7F94', border: '#E2E8F0' };
  const shortLabel = STAGE_SHORT_LABELS[stage] || stage;

  const totalAmount = opportunities.reduce((sum: number, opp: any) => sum + (opp.amount || 0), 0);

  const columnStyle: React.CSSProperties = {
    ...styles.column,
    background: isDragOver
      ? `linear-gradient(to bottom, ${colors.color}08, ${LIGHT.surfaceAlt})`
      : LIGHT.surfaceAlt,
    border: isDragOver
      ? `1px solid ${colors.color}40`
      : `1px solid ${LIGHT.border}`,
    boxShadow: isDragOver
      ? `0 0 0 2px ${colors.color}20, 0 4px 12px rgba(0,0,0,0.08)`
      : '0 1px 3px rgba(0,0,0,0.04)',
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
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: colors.color,
            boxShadow: `0 0 6px ${colors.color}`,
            flexShrink: 0,
          }} />
          <span style={{ color: LIGHT.columnHeaderText, fontWeight: 700 }}>
            {shortLabel}
          </span>
          <span style={styles.columnCount}>
            {opportunities.length}
          </span>
        </div>
        <button
          onClick={onAddClick}
          style={{
            ...styles.columnAddButton,
            color: '#94A3B8',
            borderColor: LIGHT.columnHeaderBorder,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = '#334155';
            (e.currentTarget as HTMLElement).style.borderColor = colors.color;
            (e.currentTarget as HTMLElement).style.color = colors.color;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.borderColor = LIGHT.columnHeaderBorder;
            (e.currentTarget as HTMLElement).style.color = '#94A3B8';
          }}
        >
          +
        </button>
      </div>

      {/* Amount summary + mini progress */}
      <div style={{
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: `1px solid ${LIGHT.border}`,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: totalAmount > 0 ? colors.color : LIGHT.textMuted,
        }}>
          {totalAmount > 0 ? formatAmount(totalAmount, 'EUR') : '—'}
        </span>
        {/* Mini progress bar */}
        <div style={{
          flex: 1, height: 3, borderRadius: 2,
          background: LIGHT.border,
        }}>
          <div style={{
            height: '100%', borderRadius: 2,
            background: colors.color,
            width: `${Math.min(100, (opportunities.length / Math.max(1, 20)) * 100)}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Cards */}
      <div style={styles.cardsContainer}>
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : opportunities.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>{'\u{1F4CB}'}</div>
            <div style={styles.emptyText}>Sin oportunidades</div>
          </div>
        ) : (
          opportunities.map((opportunity: any) => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              stageColor={colors.color}
              onDragStart={onCardDragStart}
              onDragEnd={onCardDragEnd}
              onClick={() => onCardClick && onCardClick(opportunity)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * OpportunityCard - Individual card representing an opportunity
 */
function OpportunityCard({
  opportunity,
  stageColor,
  onDragStart,
  onDragEnd,
  onClick
}: {
  opportunity: any;
  stageColor: string;
  onDragStart: (e: React.DragEvent, opportunity: any) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  const formattedAmount = formatAmount(opportunity.amount, opportunity.currency);
  const initials = getInitials(opportunity.name);
  const typeStyle = TYPE_COLORS[opportunity.businessType] || TYPE_COLORS.Debt;

  return (
    <motion.div
      draggable
      tabIndex={0}
      role="button"
      aria-label={`Oportunidad: ${opportunity.name}${formattedAmount ? ', ' + formattedAmount : ''}`}
      onDragStart={(e) => onDragStart(e as any, opportunity)}
      onDragEnd={(e) => onDragEnd(e as any)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{
        background: LIGHT.surface,
        borderRadius: 12,
        padding: 0,
        cursor: 'grab',
        userSelect: 'none',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
      }}
    >
      {/* Top accent gradient */}
      <div style={{
        height: 3,
        background: `linear-gradient(90deg, ${stageColor}, ${stageColor}80)`,
      }} />

      <div style={{ padding: '12px' }}>
        {/* Avatar + Title */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: `${stageColor}15`,
            color: stageColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, flexShrink: 0,
            letterSpacing: '0.5px',
          }}>
            {initials}
          </div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: LIGHT.textPrimary,
            lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            flex: 1,
          }}>
            {opportunity.name || 'Sin nombre'}
          </div>
        </div>

        {/* Amount */}
        {formattedAmount && (
          <div style={{
            fontSize: 20, fontWeight: 700, color: '#3B82F6',
            letterSpacing: '-0.5px', marginBottom: 8,
          }}>
            {formattedAmount}
          </div>
        )}

        {/* Business type badge */}
        {opportunity.businessType && (
          <div style={{ marginBottom: 6 }}>
            <span style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: 999,
              fontSize: 10, fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase',
              background: typeStyle.bg, color: typeStyle.text,
            }}>
              {opportunity.businessType}
            </span>
          </div>
        )}

        {/* Probability bar */}
        {opportunity.probability != null && opportunity.probability > 0 && (
          <div style={{ marginBottom: 6 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 3,
            }}>
              <span style={{ fontSize: 10, color: LIGHT.textMuted, fontWeight: 500 }}>Probabilidad</span>
              <span style={{ fontSize: 10, color: stageColor, fontWeight: 700 }}>{opportunity.probability}%</span>
            </div>
            <div style={{
              height: 4, borderRadius: 2, background: LIGHT.border,
            }}>
              <div style={{
                height: '100%', borderRadius: 2, background: stageColor,
                width: `${opportunity.probability}%`, transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}

        {opportunity.phase && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{
              display: 'inline-block', padding: '3px 8px', borderRadius: 4,
              fontSize: 10, fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase',
              background: `${stageColor}10`, color: stageColor,
            }}>
              {opportunity.phase}
            </span>
          </div>
        )}

        {opportunity.recordStatus && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
          }}>
            <StatusDot status={opportunity.recordStatus} />
            <span style={{ fontSize: 11, color: LIGHT.textMuted }}>
              {opportunity.recordStatus}
            </span>
          </div>
        )}

        {/* Footer: manager + date */}
        {(opportunity.dealManager || opportunity.updatedAt) && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 8, borderTop: `1px solid ${LIGHT.borderLight}`, marginTop: 4,
          }}>
            {opportunity.dealManager && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: '#3B82F6', color: '#FFFFFF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700,
                }}>
                  {opportunity.dealManager.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <span style={{ fontSize: 11, color: LIGHT.textSecondary, fontWeight: 500 }}>
                  {opportunity.dealManager.split(' ')[0]}
                </span>
              </div>
            )}
            {opportunity.updatedAt && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={LIGHT.textMuted} strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span style={{ fontSize: 10, color: LIGHT.textMuted }}>
                  {formatDate(opportunity.updatedAt)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * SkeletonCard - Loading placeholder
 */
function SkeletonCard() {
  return (
    <div style={styles.skeleton}>
      <div style={styles.skeletonLine} />
      <div style={{ ...styles.skeletonLine, width: '60%', marginTop: 8 }} />
      <div style={{ ...styles.skeletonLine, width: '40%', marginTop: 12, height: 20 }} />
    </div>
  );
}

/**
 * StatusDot - Colored dot for record status
 */
function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    'Active': '#10B981',
    'Dormant': '#F59E0B',
    'Lost': '#EF4444',
  };
  const color = colorMap[status] || '#94A3B8';

  return (
    <div style={{
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: color,
      boxShadow: `0 0 0 2px ${color}20`,
    }} />
  );
}

/**
 * Format amount helper
 */
function formatAmount(amount: number | null | undefined, currency = "EUR"): string | null {
  if (!amount || amount === 0) return null;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M ${currency}`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K ${currency}`;
  return `${amount} ${currency}`;
}

function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr.slice(0, 10);
  }
}

/**
 * Styles — Light theme
 */
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: LIGHT.bg,
    overflow: 'hidden',
  },

  // Header
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    background: LIGHT.surface,
    borderBottom: `1px solid ${LIGHT.border}`,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: 800,
    color: LIGHT.textPrimary,
    margin: 0,
    letterSpacing: '-0.5px',
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
    color: LIGHT.textMuted,
    pointerEvents: 'none',
  },
  searchInput: {
    padding: '8px 36px 8px 36px',
    borderRadius: 10,
    border: `1px solid ${LIGHT.border}`,
    fontSize: 13,
    fontFamily: "'DM Sans', system-ui",
    width: 240,
    outline: 'none',
    transition: 'all 0.2s ease',
    background: LIGHT.surfaceAlt,
    color: LIGHT.textPrimary,
  },
  clearButton: {
    position: 'absolute',
    right: 8,
    background: 'none',
    border: 'none',
    color: LIGHT.textMuted,
    fontSize: 20,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1,
    borderRadius: 4,
  },

  // Business type filter
  filterGroup: {
    display: 'flex',
    gap: 0,
    borderRadius: 10,
    overflow: 'hidden',
    border: `1px solid ${LIGHT.border}`,
  },
  filterButton: {
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: LIGHT.textSecondary,
    background: LIGHT.surface,
    border: 'none',
    borderRight: `1px solid ${LIGHT.border}`,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: "'DM Sans', system-ui",
  },
  filterButtonActive: {
    background: '#1E293B',
    color: '#FFFFFF',
  },

  // Create button
  createButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: 'linear-gradient(135deg, #3B82F6, #10B981)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 10,
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

  // Error state
  errorContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    margin: '20px 24px',
    padding: '16px 20px',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: 10,
  },
  errorIcon: {
    fontSize: 24,
    color: '#EF4444',
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#991B1B',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 12,
    color: '#DC2626',
  },
  retryButton: {
    marginLeft: 'auto',
    padding: '6px 14px',
    background: LIGHT.surface,
    border: '1px solid #FECACA',
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
    gap: 14,
    minHeight: '100%',
    paddingTop: 16,
  },

  // Column
  column: {
    minWidth: 280,
    maxWidth: 280,
    display: 'flex',
    flexDirection: 'column',
    background: LIGHT.surfaceAlt,
    borderRadius: 14,
    border: `1px solid ${LIGHT.border}`,
    transition: 'all 0.2s ease',
  },
  columnHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px',
    background: LIGHT.columnHeaderBg,
    borderRadius: '14px 14px 0 0',
  },
  columnTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: LIGHT.columnHeaderText,
  },
  columnCount: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 20,
    padding: '0 6px',
    background: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    fontSize: 10,
    fontWeight: 700,
    color: '#CBD5E1',
  },
  columnAddButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: '1px solid',
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

  // Cards container
  cardsContainer: {
    flex: 1,
    padding: '10px',
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },

  // Empty state
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
    color: LIGHT.textMuted,
    fontWeight: 500,
  },

  // Skeleton
  skeleton: {
    background: LIGHT.surface,
    borderRadius: 12,
    padding: '12px',
    border: `1px solid ${LIGHT.border}`,
  },
  skeletonLine: {
    height: 14,
    background: `linear-gradient(90deg, ${LIGHT.border} 25%, #F1F5F9 50%, ${LIGHT.border} 75%)`,
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s infinite',
    borderRadius: 4,
  },
};

// Add shimmer animation via CSS-in-JS
if (typeof document !== 'undefined') {
  const styleSheet = document.styleSheets[0];
  const keyframes = `
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  try {
    styleSheet.insertRule(keyframes, styleSheet.cssRules.length);
  } catch (e) {
    // Rule might already exist
  }
}
