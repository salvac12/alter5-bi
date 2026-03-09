/* ═══════════════════════════════════════════════════════════════
   Alter5 BI — Design Tokens (inline-style friendly)
   Based on Figma Make file UX2FQbSclbHJu39o5nyAaG
   ═══════════════════════════════════════════════════════════════ */

// ── Colors ───────────────────────────────────────────────────────

export const colors = {
  // App chrome
  appBg: '#13285B',
  contentBg: '#F0F4F8',
  headerBg: 'rgba(19,40,91,0.85)',

  // Dark surfaces (panels, cards)
  dark: {
    bg: '#0A1628',
    card: '#132238',
    border: '#1B3A5C',
    surface: '#1E293B',
    hover: '#243B53',
  },

  // Light surfaces
  light: {
    bg: '#F0F4F8',
    card: '#FFFFFF',
    border: '#E2E8F0',
    hover: '#F8FAFC',
  },

  // Accent palette
  accent: {
    blue: '#3B82F6',
    green: '#10B981',
    purple: '#8B5CF6',
    orange: '#F97316',
    red: '#EF4444',
    yellow: '#F59E0B',
    cyan: '#06B6D4',
  },

  // Text
  text: {
    primary: '#1A2B3D',
    secondary: '#6B7F94',
    muted: '#94A3B8',
    onDark: '#F1F5F9',
    onDarkSecondary: '#94A3B8',
    onDarkMuted: '#64748B',
  },

  // Status
  status: {
    active: '#10B981',
    dormant: '#F59E0B',
    lost: '#EF4444',
  },

  // Product colors
  product: {
    debt: '#3B82F6',
    equity: '#10B981',
    prospects: '#8B5CF6',
  },
} as const;

// ── Typography ───────────────────────────────────────────────────

export const font = {
  family: "'DM Sans', system-ui, -apple-system, sans-serif",
  size: {
    xs: '11px',
    sm: '12px',
    base: '13px',
    md: '14px',
    lg: '16px',
    xl: '18px',
    '2xl': '24px',
    '3xl': '30px',
  },
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.3,
    normal: 1.5,
    relaxed: 1.6,
  },
} as const;

// ── Spacing ──────────────────────────────────────────────────────

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
  '4xl': '40px',
} as const;

// ── Layout ───────────────────────────────────────────────────────

export const layout = {
  headerHeight: 60,
  sideNavWidth: 200,
  sideNavCollapsedWidth: 64,
  sidebarWidth: 270,
  detailPanelWidth: 720,
  cerebroWidth: 900,
  borderRadius: {
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '20px',
    full: '9999px',
  },
} as const;

// ── Shadows ──────────────────────────────────────────────────────

export const shadows = {
  sm: '0 1px 2px rgba(0,0,0,0.05)',
  md: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
  xl: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
  panel: '0 25px 50px -12px rgba(0,0,0,0.25)',
  glow: (color: string) => `0 0 20px ${color}33`,
} as const;

// ── Transitions ──────────────────────────────────────────────────

export const transitions = {
  fast: '0.15s ease',
  normal: '0.2s ease',
  smooth: '0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  spring: { type: 'spring' as const, damping: 30, stiffness: 300 },
  springPanel: { type: 'spring' as const, damping: 28, stiffness: 280 },
} as const;

// ── Dark panel presets (reusable across DetailPanel, ProspectPanel, etc.) ──

export const darkPanel = {
  container: {
    background: colors.dark.bg,
    color: colors.text.onDark,
  },
  card: {
    background: colors.dark.card,
    borderRadius: layout.borderRadius.lg,
    border: `1px solid ${colors.dark.border}`,
    padding: spacing['2xl'],
  },
  input: {
    background: colors.dark.card,
    border: `1px solid ${colors.dark.border}`,
    borderRadius: layout.borderRadius.sm,
    color: colors.text.onDark,
    padding: `${spacing.sm} ${spacing.md}`,
    fontSize: font.size.md,
    outline: 'none',
    width: '100%',
  },
  inputFocus: {
    borderColor: colors.accent.blue,
    boxShadow: `0 0 0 2px ${colors.accent.blue}33`,
  },
  label: {
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
    color: colors.text.onDarkSecondary,
    marginBottom: spacing.xs,
  },
  divider: {
    borderTop: `1px solid ${colors.dark.border}`,
    margin: `${spacing.lg} 0`,
  },
} as const;
