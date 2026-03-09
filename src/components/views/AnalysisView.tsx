/* ═══════════════════════════════════════════════════════════════
   AnalysisView — Analysis dashboard with KPIs, stage chart,
   and product breakdown
   ═══════════════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, DollarSign, BarChart3, Percent, Loader2 } from 'lucide-react';
import { colors, font, layout, spacing, shadows, transitions } from '../../theme/tokens';
import { fetchAllOpportunities, KANBAN_STAGES, STAGE_COLORS } from '../../utils/airtable';

// ── Types ───────────────────────────────────────────────────────

interface NormalizedDeal {
  id: string;
  name: string;
  stage: string;
  amount: number;
  product: string;
  isDebt: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────

function normalizeDeal(record: any): NormalizedDeal {
  const f = record.fields || {};
  const name = f['Transaction Name'] || f['Name'] || 'Sin nombre';
  const stage = f['Global Status'] || 'New';
  const amount = parseFloat(f['Amount'] || f['Transaction Size'] || 0) || 0;
  const product = f['Product'] || f['Type of Product'] || '';
  const isDebt = /debt|finance|pf guaranteed/i.test(product);

  return { id: record.id, name, stage, amount, product, isDebt };
}

function formatEur(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

// ── Component ───────────────────────────────────────────────────

export function AnalysisView() {
  const [deals, setDeals] = useState<NormalizedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAllOpportunities()
      .then(records => {
        if (!cancelled) {
          setDeals(records.map(normalizeDeal));
          setError(null);
        }
      })
      .catch(err => {
        if (!cancelled) setError(err.message || 'Error cargando datos');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // ── Computed data ─────────────────────────────────────────

  const kpis = useMemo(() => {
    const totalDeals = deals.length;
    const totalVolume = deals.reduce((s, d) => s + d.amount, 0);
    const avgSize = totalDeals > 0 ? totalVolume / totalDeals : 0;
    return { totalDeals, totalVolume, avgSize };
  }, [deals]);

  const stageData = useMemo(() => {
    const counts: Record<string, { count: number; volume: number }> = {};
    for (const stage of KANBAN_STAGES) {
      counts[stage] = { count: 0, volume: 0 };
    }
    for (const deal of deals) {
      if (counts[deal.stage]) {
        counts[deal.stage].count++;
        counts[deal.stage].volume += deal.amount;
      }
    }
    const maxCount = Math.max(...Object.values(counts).map(c => c.count), 1);
    return { counts, maxCount };
  }, [deals]);

  const productBreakdown = useMemo(() => {
    const debt = deals.filter(d => d.isDebt);
    const equity = deals.filter(d => !d.isDebt);
    const debtVol = debt.reduce((s, d) => s + d.amount, 0);
    const equityVol = equity.reduce((s, d) => s + d.amount, 0);
    const total = debtVol + equityVol || 1;
    return {
      debt: { count: debt.length, volume: debtVol, pct: (debtVol / total) * 100 },
      equity: { count: equity.length, volume: equityVol, pct: (equityVol / total) * 100 },
    };
  }, [deals]);

  // ── Styles ──────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    padding: spacing['2xl'],
    maxWidth: 1200,
    margin: '0 auto',
    fontFamily: font.family,
  };

  const pageTitle: React.CSSProperties = {
    fontSize: font.size['2xl'],
    fontWeight: font.weight.bold,
    color: colors.text.primary,
    marginBottom: spacing['2xl'],
  };

  const kpiRowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: spacing.lg,
    marginBottom: spacing['3xl'],
  };

  const kpiCardStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: layout.borderRadius.lg,
    padding: spacing.xl,
    boxShadow: shadows.sm,
    border: `1px solid ${colors.light.border}`,
  };

  const kpiLabelStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.secondary,
    fontWeight: font.weight.medium,
    marginBottom: spacing.sm,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  };

  const kpiValueStyle: React.CSSProperties = {
    fontSize: font.size['2xl'],
    fontWeight: font.weight.bold,
    color: colors.text.primary,
  };

  const sectionStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: layout.borderRadius.lg,
    padding: spacing['2xl'],
    boxShadow: shadows.sm,
    border: `1px solid ${colors.light.border}`,
    marginBottom: spacing['2xl'],
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xl,
  };

  const barRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  };

  const barLabelStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.secondary,
    width: 110,
    flexShrink: 0,
    textAlign: 'right' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  };

  const barTrackStyle: React.CSSProperties = {
    flex: 1,
    height: 28,
    background: colors.light.bg,
    borderRadius: layout.borderRadius.sm,
    position: 'relative',
    overflow: 'hidden',
  };

  const barCountStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.secondary,
    width: 40,
    textAlign: 'right' as const,
    fontWeight: font.weight.medium,
    flexShrink: 0,
  };

  const pieContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['3xl'],
    flexWrap: 'wrap' as const,
  };

  const pieRingStyle: React.CSSProperties = {
    width: 160,
    height: 160,
    borderRadius: '50%',
    background: `conic-gradient(
      ${colors.accent.blue} 0% ${productBreakdown.debt.pct}%,
      ${colors.accent.green} ${productBreakdown.debt.pct}% 100%
    )`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  const pieInnerStyle: React.CSSProperties = {
    width: 100,
    height: 100,
    borderRadius: '50%',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
  };

  const pieTotalStyle: React.CSSProperties = {
    fontSize: font.size['2xl'],
    fontWeight: font.weight.bold,
    color: colors.text.primary,
    lineHeight: 1,
  };

  const pieTotalLabel: React.CSSProperties = {
    fontSize: font.size.xs,
    color: colors.text.secondary,
    marginTop: 2,
  };

  const legendStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
  };

  const legendItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
  };

  const legendDotStyle = (color: string): React.CSSProperties => ({
    width: 12,
    height: 12,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  });

  const legendTextStyle: React.CSSProperties = {
    fontSize: font.size.md,
    color: colors.text.primary,
    fontWeight: font.weight.medium,
  };

  const legendSubStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.secondary,
  };

  const loadingStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 400,
    flexDirection: 'column',
    gap: spacing.md,
    color: colors.text.secondary,
    fontFamily: font.family,
  };

  const stageShortLabels: Record<string, string> = {
    'New': 'New',
    'Origination - Preparation & NDA': 'Prep & NDA',
    'Origination - Financial Analysis': 'Fin. Analysis',
    'Origination - Termsheet': 'Termsheet',
    'Distribution - Preparation': 'Dist. Prep',
    'Distribution - Ongoing': 'Dist. Ongoing',
    'In Execution': 'Execution',
    'Closed Successfully': 'Closed',
    'Rejection & Loss': 'Lost',
  };

  // ── Loading ───────────────────────────────────────────────

  if (loading) {
    return (
      <div style={loadingStyle}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 size={32} color={colors.accent.blue} />
        </motion.div>
        <span style={{ fontSize: font.size.md }}>Cargando analisis...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={loadingStyle}>
        <span style={{ color: colors.accent.red, fontSize: font.size.md }}>{error}</span>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <motion.div
      style={containerStyle}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div style={pageTitle}>Analisis de Pipeline</div>

      {/* KPIs */}
      <div style={kpiRowStyle}>
        {[
          { label: 'Total Deals', value: kpis.totalDeals.toString(), Icon: BarChart3, color: colors.accent.blue },
          { label: 'Volumen Total', value: `${formatEur(kpis.totalVolume)}`, Icon: DollarSign, color: colors.accent.green },
          { label: 'Tamano Medio', value: `${formatEur(kpis.avgSize)}`, Icon: TrendingUp, color: colors.accent.purple },
          { label: 'Crecimiento', value: '+12%', Icon: Percent, color: colors.accent.orange },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            style={kpiCardStyle}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, ...transitions.spring }}
          >
            <div style={kpiLabelStyle}>
              <kpi.Icon size={14} color={kpi.color} />
              {kpi.label}
            </div>
            <div style={{ ...kpiValueStyle, color: kpi.color }}>{kpi.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Bar chart by stage */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Deals por fase</div>
        {KANBAN_STAGES.map((stage, i) => {
          const data = stageData.counts[stage];
          const pct = (data.count / stageData.maxCount) * 100;
          const stageColor = (STAGE_COLORS as any)[stage]?.color || colors.accent.blue;
          const label = stageShortLabels[stage] || stage;

          return (
            <div key={stage} style={barRowStyle}>
              <div style={barLabelStyle} title={stage}>{label}</div>
              <div style={barTrackStyle}>
                <motion.div
                  style={{
                    height: '100%',
                    borderRadius: layout.borderRadius.sm,
                    background: stageColor,
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: spacing.sm,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(pct, data.count > 0 ? 4 : 0)}%` }}
                  transition={{ delay: i * 0.05, duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
                >
                  {data.count > 0 && pct > 15 && (
                    <span style={{ fontSize: font.size.xs, color: '#fff', fontWeight: font.weight.semibold }}>
                      {formatEur(data.volume)}
                    </span>
                  )}
                </motion.div>
              </div>
              <div style={barCountStyle}>{data.count}</div>
            </div>
          );
        })}
      </div>

      {/* Product breakdown */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Desglose por producto</div>
        <div style={pieContainerStyle}>
          <div style={pieRingStyle}>
            <div style={pieInnerStyle}>
              <div style={pieTotalStyle}>{deals.length}</div>
              <div style={pieTotalLabel}>deals</div>
            </div>
          </div>
          <div style={legendStyle}>
            <div style={legendItemStyle}>
              <div style={legendDotStyle(colors.accent.blue)} />
              <div>
                <div style={legendTextStyle}>
                  Debt &mdash; {productBreakdown.debt.count} deals ({productBreakdown.debt.pct.toFixed(0)}%)
                </div>
                <div style={legendSubStyle}>{formatEur(productBreakdown.debt.volume)}</div>
              </div>
            </div>
            <div style={legendItemStyle}>
              <div style={legendDotStyle(colors.accent.green)} />
              <div>
                <div style={legendTextStyle}>
                  Equity / M&A &mdash; {productBreakdown.equity.count} deals ({productBreakdown.equity.pct.toFixed(0)}%)
                </div>
                <div style={legendSubStyle}>{formatEur(productBreakdown.equity.volume)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
