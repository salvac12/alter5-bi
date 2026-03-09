/* ═══════════════════════════════════════════════════════════════
   HelpOverlay — Keyboard shortcuts + quick start guide
   ═══════════════════════════════════════════════════════════════ */

import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard, BookOpen } from 'lucide-react';
import { colors, font, layout, spacing, shadows, transitions } from '../../theme/tokens';

// ── Types ───────────────────────────────────────────────────────

interface HelpOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Data ────────────────────────────────────────────────────────

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: 'Abrir Cerebro AI' },
  { keys: ['Ctrl', 'E'], description: 'Ir a Empresas' },
  { keys: ['Ctrl', 'P'], description: 'Ir a Pipeline' },
  { keys: ['Ctrl', '/'], description: 'Abrir esta ayuda' },
  { keys: ['Esc'], description: 'Cerrar panel/overlay activo' },
];

const QUICK_STEPS = [
  { title: 'Explora las empresas', text: 'Usa la vista Empresas para buscar, filtrar y analizar las +3,000 empresas del CRM. Haz clic en una para ver su detalle completo.' },
  { title: 'Gestiona el Pipeline', text: 'En Pipeline puedes ver y mover deals entre las 9 fases del ciclo de ventas. Arrastra tarjetas para cambiar su estado.' },
  { title: 'Genera Prospects', text: 'Crea nuevos leads en la vista Prospects. Asigna un deal manager, producto y probabilidad de cierre.' },
  { title: 'Usa el Cerebro AI', text: 'Pulsa Ctrl+K para abrir el asistente inteligente. Pregunta sobre empresas, deals, o tendencias del mercado.' },
  { title: 'Exporta datos', text: 'Desde cualquier tabla puedes exportar los datos filtrados a CSV para analisis externo.' },
];

// ── Component ───────────────────────────────────────────────────

export function HelpOverlay({ isOpen, onClose }: HelpOverlayProps) {
  // ── Styles ──────────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9500,
    padding: spacing.xl,
  };

  const modalStyle: React.CSSProperties = {
    background: colors.dark.bg,
    borderRadius: layout.borderRadius.xl,
    border: `1px solid ${colors.dark.border}`,
    maxWidth: 900,
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
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
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
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 0,
    fontFamily: font.family,
  };

  const columnStyle: React.CSSProperties = {
    padding: spacing['2xl'],
  };

  const leftColumnStyle: React.CSSProperties = {
    ...columnStyle,
    borderRight: `1px solid ${colors.dark.border}`,
  };

  const columnTitleStyle: React.CSSProperties = {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text.onDark,
    marginBottom: spacing.xl,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  };

  const shortcutRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.md} 0`,
    borderBottom: `1px solid ${colors.dark.border}20`,
  };

  const keysContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
  };

  const keyBadgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: layout.borderRadius.sm,
    background: colors.dark.surface,
    border: `1px solid ${colors.dark.border}`,
    color: colors.text.onDark,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    minWidth: 28,
    lineHeight: 1,
  };

  const shortcutDescStyle: React.CSSProperties = {
    fontSize: font.size.md,
    color: colors.text.onDarkSecondary,
  };

  const stepStyle: React.CSSProperties = {
    display: 'flex',
    gap: spacing.md,
    marginBottom: spacing.xl,
  };

  const stepNumberStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadius.full,
    background: `${colors.accent.blue}20`,
    color: colors.accent.blue,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    flexShrink: 0,
    marginTop: 2,
  };

  const stepTitleStyle: React.CSSProperties = {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text.onDark,
    marginBottom: spacing.xs,
  };

  const stepTextStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.onDarkSecondary,
    lineHeight: font.lineHeight.relaxed,
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
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={transitions.spring}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={headerStyle}>
              <div style={titleStyle}>
                <Keyboard size={20} color={colors.accent.blue} />
                Ayuda y atajos de teclado
              </div>
              <button style={closeBtnStyle} onClick={onClose} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>

            {/* Body — two columns */}
            <div style={bodyStyle}>
              {/* Left: Keyboard shortcuts */}
              <div style={leftColumnStyle}>
                <div style={columnTitleStyle}>
                  <Keyboard size={16} />
                  Atajos de teclado
                </div>
                {SHORTCUTS.map((shortcut, i) => (
                  <div key={i} style={shortcutRowStyle}>
                    <div style={keysContainerStyle}>
                      {shortcut.keys.map((key, ki) => (
                        <span key={ki}>
                          <span style={keyBadgeStyle}>{key}</span>
                          {ki < shortcut.keys.length - 1 && (
                            <span style={{ color: colors.text.onDarkMuted, fontSize: font.size.xs, margin: `0 ${spacing.xs}` }}>
                              +
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                    <span style={shortcutDescStyle}>{shortcut.description}</span>
                  </div>
                ))}
              </div>

              {/* Right: Quick start guide */}
              <div style={columnStyle}>
                <div style={columnTitleStyle}>
                  <BookOpen size={16} />
                  Guia rapida
                </div>
                {QUICK_STEPS.map((step, i) => (
                  <div key={i} style={stepStyle}>
                    <div style={stepNumberStyle}>{i + 1}</div>
                    <div>
                      <div style={stepTitleStyle}>{step.title}</div>
                      <div style={stepTextStyle}>{step.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
