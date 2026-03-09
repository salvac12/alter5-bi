/* ═══════════════════════════════════════════════════════════════
   ExportDialog — Modal for exporting data to CSV / Excel
   ═══════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, FileSpreadsheet, FileText, Check } from 'lucide-react';
import { colors, font, layout, spacing, shadows, transitions, darkPanel } from '../../theme/tokens';

// ── Types ───────────────────────────────────────────────────────

interface ExportColumn {
  key: string;
  label: string;
}

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  data: Record<string, any>[];
  columns: ExportColumn[];
}

// ── Component ───────────────────────────────────────────────────

export function ExportDialog({ isOpen, onClose, data, columns }: ExportDialogProps) {
  const [format, setFormat] = useState<'csv' | 'excel'>('csv');
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    () => new Set(columns.map(c => c.key))
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const toggleColumn = (key: string) => {
    setSelectedColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedColumns.size === columns.length) {
      setSelectedColumns(new Set());
    } else {
      setSelectedColumns(new Set(columns.map(c => c.key)));
    }
  };

  const filteredData = useMemo(() => {
    if (!dateFrom && !dateTo) return data;
    return data.filter(row => {
      const dateVal = row.createdAt || row.date || row.firstDate || '';
      if (!dateVal) return true;
      if (dateFrom && dateVal < dateFrom) return false;
      if (dateTo && dateVal > dateTo) return false;
      return true;
    });
  }, [data, dateFrom, dateTo]);

  const handleExport = () => {
    const cols = columns.filter(c => selectedColumns.has(c.key));
    if (cols.length === 0) return;

    // Build CSV content
    const header = cols.map(c => `"${c.label}"`).join(',');
    const rows = filteredData.map(row =>
      cols.map(c => {
        const val = row[c.key];
        if (val == null) return '""';
        const str = Array.isArray(val) ? val.join('; ') : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      }).join(',')
    );
    const csvContent = [header, ...rows].join('\n');

    // BOM for Excel UTF-8 compatibility
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alter5-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onClose();
  };

  // ── Styles ──────────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
    padding: spacing.xl,
  };

  const modalStyle: React.CSSProperties = {
    background: colors.dark.bg,
    borderRadius: layout.borderRadius.xl,
    border: `1px solid ${colors.dark.border}`,
    maxWidth: 520,
    width: '100%',
    maxHeight: '85vh',
    overflow: 'auto',
    boxShadow: shadows.panel,
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.xl} ${spacing['2xl']}`,
    borderBottom: `1px solid ${colors.dark.border}`,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: font.size.xl,
    fontWeight: font.weight.semibold,
    color: colors.text.onDark,
    fontFamily: font.family,
  };

  const closeBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: colors.text.onDarkSecondary,
    padding: spacing.xs,
    borderRadius: layout.borderRadius.sm,
    display: 'flex',
    alignItems: 'center',
  };

  const bodyStyle: React.CSSProperties = {
    padding: spacing['2xl'],
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xl,
  };

  const sectionLabelStyle: React.CSSProperties = {
    ...darkPanel.label,
    marginBottom: spacing.sm,
  };

  const tabsRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: spacing.sm,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: `${spacing.sm} ${spacing.md}`,
    borderRadius: layout.borderRadius.md,
    border: `1px solid ${active ? colors.accent.blue : colors.dark.border}`,
    background: active ? `${colors.accent.blue}15` : colors.dark.card,
    color: active ? colors.accent.blue : colors.text.onDarkSecondary,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    fontFamily: font.family,
    fontSize: font.size.md,
    fontWeight: font.weight.medium,
    transition: transitions.fast,
  });

  const columnsGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: spacing.sm,
    maxHeight: 180,
    overflow: 'auto',
  };

  const checkboxRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    cursor: 'pointer',
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: layout.borderRadius.sm,
    transition: transitions.fast,
  };

  const checkboxStyle = (checked: boolean): React.CSSProperties => ({
    width: 18,
    height: 18,
    borderRadius: 4,
    border: `1.5px solid ${checked ? colors.accent.blue : colors.dark.border}`,
    background: checked ? colors.accent.blue : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: transitions.fast,
  });

  const dateRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: spacing.md,
  };

  const dateInputStyle: React.CSSProperties = {
    ...darkPanel.input,
    flex: 1,
    colorScheme: 'dark',
  };

  const exportBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: `${spacing.md} ${spacing.xl}`,
    borderRadius: layout.borderRadius.md,
    border: 'none',
    background: `linear-gradient(135deg, ${colors.accent.blue}, ${colors.accent.green})`,
    color: '#fff',
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    fontFamily: font.family,
    cursor: selectedColumns.size > 0 ? 'pointer' : 'not-allowed',
    opacity: selectedColumns.size > 0 ? 1 : 0.5,
    transition: transitions.fast,
    width: '100%',
  };

  const footerStyle: React.CSSProperties = {
    padding: `${spacing.lg} ${spacing['2xl']} ${spacing.xl}`,
    borderTop: `1px solid ${colors.dark.border}`,
  };

  const infoStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.onDarkSecondary,
    marginBottom: spacing.md,
    fontFamily: font.family,
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          style={overlayStyle}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            style={modalStyle}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={transitions.spring}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={headerStyle}>
              <span style={titleStyle}>Exportar datos</span>
              <button style={closeBtnStyle} onClick={onClose} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={bodyStyle}>
              {/* Format selector */}
              <div>
                <div style={sectionLabelStyle}>Formato</div>
                <div style={tabsRowStyle}>
                  <button style={tabStyle(format === 'csv')} onClick={() => setFormat('csv')}>
                    <FileText size={16} /> CSV
                  </button>
                  <button style={tabStyle(format === 'excel')} onClick={() => setFormat('excel')}>
                    <FileSpreadsheet size={16} /> Excel
                  </button>
                </div>
              </div>

              {/* Column selection */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={sectionLabelStyle}>Columnas ({selectedColumns.size}/{columns.length})</div>
                  <button
                    onClick={toggleAll}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: colors.accent.blue,
                      fontSize: font.size.sm,
                      fontFamily: font.family,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {selectedColumns.size === columns.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                  </button>
                </div>
                <div style={columnsGridStyle}>
                  {columns.map(col => {
                    const checked = selectedColumns.has(col.key);
                    return (
                      <div
                        key={col.key}
                        style={checkboxRowStyle}
                        onClick={() => toggleColumn(col.key)}
                      >
                        <div style={checkboxStyle(checked)}>
                          {checked && <Check size={12} color="#fff" />}
                        </div>
                        <span style={{ fontSize: font.size.sm, color: colors.text.onDark, fontFamily: font.family }}>
                          {col.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Date range */}
              <div>
                <div style={sectionLabelStyle}>Rango de fechas (opcional)</div>
                <div style={dateRowStyle}>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    style={dateInputStyle}
                    placeholder="Desde"
                  />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    style={dateInputStyle}
                    placeholder="Hasta"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={footerStyle}>
              <div style={infoStyle}>
                {filteredData.length} registros &middot; {selectedColumns.size} columnas
              </div>
              <button
                style={exportBtnStyle}
                onClick={handleExport}
                disabled={selectedColumns.size === 0}
              >
                <Download size={16} />
                Exportar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
