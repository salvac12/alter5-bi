import React, { useState, useEffect, useRef } from 'react';
import {
  fetchAllOpportunities,
  updateOpportunity,
  normalizeRecord,
  isAirtableConfigured,
  KANBAN_STAGES,
  STAGE_COLORS,
  STAGE_SHORT_LABELS
} from '../utils/airtable';

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
export default function KanbanView({ onSelectOpportunity, onCreateOpportunity }) {
  const [opportunities, setOpportunities] = useState([]);
  const [filteredOpportunities, setFilteredOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedCard, setDraggedCard] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);

  // Fetch data on mount
  useEffect(() => {
    loadOpportunities();
  }, []);

  // Filter opportunities when search query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredOpportunities(opportunities);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredOpportunities(
        opportunities.filter(opp =>
          opp.name.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, opportunities]);

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
      const normalized = records.map(normalizeRecord);
      setOpportunities(normalized);
    } catch (err) {
      console.error('Failed to load opportunities:', err);
      setError(err.message || 'Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  }

  // Drag handlers
  function handleDragStart(e, opportunity) {
    setDraggedCard(opportunity);
    e.dataTransfer.effectAllowed = 'move';
    // Add a subtle opacity to the dragged element
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

  function handleDragLeave() {
    // Only clear if we're actually leaving the column area
    // This prevents flickering when moving over child elements
  }

  async function handleDrop(e, targetStage) {
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
    } catch (err) {
      console.error('Failed to update opportunity stage:', err);
      // Revert on error
      setOpportunities(opportunities);
      alert('Failed to update stage: ' + err.message);
    }
  }

  // Group opportunities by stage
  const opportunitiesByStage = KANBAN_STAGES.reduce((acc, stage) => {
    acc[stage] = filteredOpportunities.filter(opp => opp.stage === stage);
    return acc;
  }, {});

  const totalCount = filteredOpportunities.length;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Pipeline Board</h2>
          <span style={styles.count}>{totalCount} opportunities</span>
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
              placeholder="Search opportunities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={styles.clearButton}
              >
                ×
              </button>
            )}
          </div>

          {/* Create button */}
          <button
            onClick={() => onCreateOpportunity && onCreateOpportunity(null)}
            style={styles.createButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #2563EB, #059669)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #3B82F6, #10B981)';
            }}
          >
            <span style={styles.createIcon}>+</span>
            New Opportunity
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={styles.errorContainer}>
          <div style={styles.errorIcon}>⚠</div>
          <div>
            <div style={styles.errorTitle}>Failed to load opportunities</div>
            <div style={styles.errorMessage}>{error}</div>
          </div>
          <button onClick={loadOpportunities} style={styles.retryButton}>
            Retry
          </button>
        </div>
      )}

      {/* Board */}
      <div style={styles.boardContainer}>
        <div style={styles.board}>
          {KANBAN_STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              opportunities={opportunitiesByStage[stage] || []}
              loading={loading}
              isDragOver={dragOverColumn === stage}
              onDragOver={handleDragOver}
              onDragEnter={() => handleDragEnter(stage)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage)}
              onCardDragStart={handleDragStart}
              onCardDragEnd={handleDragEnd}
              onCardClick={onSelectOpportunity}
              onAddClick={() => onCreateOpportunity && onCreateOpportunity(stage)}
            />
          ))}
        </div>
      </div>
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
}) {
  const colors = STAGE_COLORS[stage] || { bg: '#F7F9FC', color: '#6B7F94', border: '#E2E8F0' };
  const shortLabel = STAGE_SHORT_LABELS[stage] || stage;

  const columnStyle = {
    ...styles.column,
    background: isDragOver
      ? `linear-gradient(to bottom, ${colors.bg}, #FFFFFF)`
      : colors.bg,
    borderTop: `3px solid ${isDragOver ? colors.color : colors.border}`,
    boxShadow: isDragOver
      ? `0 0 0 2px ${colors.color}40, 0 8px 16px rgba(0,0,0,0.08)`
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
          <span style={styles.columnCount}>
            {opportunities.length}
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
            <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>📋</div>
            <div style={styles.emptyText}>No opportunities</div>
          </div>
        ) : (
          opportunities.map((opportunity) => (
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
}) {
  const [isHovered, setIsHovered] = useState(false);
  const formattedAmount = formatAmount(opportunity.amount, opportunity.currency);

  const cardStyle = {
    ...styles.card,
    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
    boxShadow: isHovered
      ? '0 8px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(59, 130, 246, 0.3)'
      : '0 2px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, opportunity)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
          {opportunity.name || 'Unnamed Opportunity'}
        </div>

        {formattedAmount && (
          <div style={styles.cardAmount}>
            {formattedAmount}
          </div>
        )}

        {opportunity.phase && (
          <div style={styles.cardPhase}>
            <span style={{
              ...styles.phaseBadge,
              background: `${stageColor}15`,
              color: stageColor,
            }}>
              {opportunity.phase}
            </span>
          </div>
        )}

        {opportunity.recordStatus && (
          <div style={styles.cardStatus}>
            <StatusDot status={opportunity.recordStatus} />
            <span style={{ fontSize: 11, color: '#6B7F94' }}>
              {opportunity.recordStatus}
            </span>
          </div>
        )}
      </div>
    </div>
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
function StatusDot({ status }) {
  const colorMap = {
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
function formatAmount(amount, currency = "EUR") {
  if (!amount || amount === 0) return null;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M ${currency}`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K ${currency}`;
  return `${amount} ${currency}`;
}

/**
 * Styles
 */
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
    fontSize: 20,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1,
    borderRadius: 4,
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

  // Error state
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

  // Cards container
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
    gap: 8,
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
    color: '#3B82F6',
    letterSpacing: '-0.3px',
  },
  cardPhase: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  phaseBadge: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
  },
  cardStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
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
