import React from 'react';
import { STATUS_LABELS, STATUS_COLORS, STATUS_BG } from '../utils/constants';
import { colors, font, layout, spacing } from '../theme/tokens';

/* ── Badge ── */
export function Badge({ children, color, bg, variant }: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  variant?: string;
}) {
  let c = color || colors.text.secondary;
  let b = bg || colors.light.hover;

  if (variant === "type") {
    c = colors.accent.blue; b = "#EFF6FF";
  } else if (variant === "employee") {
    c = colors.text.primary; b = colors.light.hover;
  }

  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 9, fontWeight: font.weight.medium, color: c, background: b,
      whiteSpace: "nowrap", lineHeight: "16px", letterSpacing: "0.02em",
    }}>
      {children}
    </span>
  );
}

/* ── Status Badge ── */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 600,
      color: (STATUS_COLORS as any)[status], background: (STATUS_BG as any)[status],
      whiteSpace: "nowrap", lineHeight: "16px", letterSpacing: "0.02em",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%", background: (STATUS_COLORS as any)[status],
      }} />
      {(STATUS_LABELS as any)[status]}
    </span>
  );
}

/* ── Score Bar ── */
export function ScoreBar({ score, max = 100, label }: {
  score: number;
  max?: number;
  label?: string;
}) {
  const pct = (score / max) * 100;
  const gradient = pct > 60
    ? `linear-gradient(90deg, ${colors.accent.blue}, ${colors.accent.green})`
    : pct > 30
      ? `linear-gradient(90deg, ${colors.accent.blue}, #60A5FA)`
      : colors.light.border;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label && (
        <span style={{
          width: 56, fontSize: 10, fontWeight: 700, color: colors.text.secondary,
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>{label}</span>
      )}
      <div style={{
        flex: 1, height: 4, background: colors.light.hover, borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 2,
          background: gradient, transition: "width 0.3s ease",
        }} />
      </div>
      <span style={{
        width: 22, textAlign: "right", fontWeight: 700, color: colors.text.primary, fontSize: 11,
      }}>{score}</span>
    </div>
  );
}

/* ── KPI Card (V2: accent border-top) ── */
export function KPI({ label, value, sub, accent, onClick, active }: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div onClick={onClick} style={{
      background: active ? `${accent || colors.accent.blue}08` : '#FFFFFF',
      borderRadius: layout.borderRadius.lg,
      padding: '16px 18px',
      border: active ? `2px solid ${accent || colors.accent.blue}` : `1px solid ${colors.light.border}`,
      borderTop: accent ? `3px solid ${accent}` : undefined,
      cursor: onClick ? "pointer" : "default",
      transition: "all 0.15s ease",
      boxShadow: active ? `0 0 0 3px ${accent || colors.accent.blue}15` : 'none',
    }}>
      <div style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: "2.5px",
        color: colors.text.secondary, marginBottom: 6, fontWeight: 700,
      }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 800, color: accent || colors.text.primary,
        lineHeight: 1, letterSpacing: "-1.5px",
      }}>{typeof value === 'number' ? value.toLocaleString('es-ES') : value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: colors.text.secondary, marginTop: 6, fontWeight: 400 }}>{sub}</div>
      )}
    </div>
  );
}

/* ── Filter Chip (V2: pill style) ── */
export function FilterChip({ label, active, onClick, style = {} }: {
  label: string;
  active: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px", borderRadius: layout.borderRadius.full, fontSize: 12, fontWeight: 500,
      cursor: "pointer", textAlign: "left", lineHeight: 1.4,
      border: active ? `1px solid ${colors.accent.blue}` : "1px solid transparent",
      background: active ? `${colors.accent.blue}12` : "transparent",
      color: active ? colors.accent.blue : colors.text.secondary,
      transition: "all 0.12s ease",
      fontFamily: font.family,
      ...style,
    }}>
      {label}
    </button>
  );
}

/* ── Section Label (uppercase) ── */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, textTransform: "uppercase", color: colors.text.secondary,
      fontWeight: 700, letterSpacing: "2.5px", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

/* ── Badge "Proximamente" ── */
export function ComingSoonBadge() {
  return (
    <span style={{
      display: "inline-block",
      background: "#FEF3C7",
      color: "#92400E",
      border: "1px solid #FCD34D",
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.5px",
      textTransform: "uppercase",
      marginLeft: 8,
    }}>
      Proximamente
    </span>
  );
}

/* ── Tooltip ── */
export function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
  const [show, setShow] = React.useState(false);

  return (
    <div style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: "absolute",
          left: "100%",
          top: "50%",
          transform: "translateY(-50%)",
          marginLeft: 8,
          background: colors.dark.surface,
          color: "white",
          padding: "8px 12px",
          borderRadius: layout.borderRadius.sm,
          fontSize: 12,
          maxWidth: 200,
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
          zIndex: 1000,
          whiteSpace: "normal",
          pointerEvents: "none",
        }}>
          {text}
          <div style={{
            position: "absolute",
            right: "100%",
            top: "50%",
            transform: "translateY(-50%)",
            width: 0,
            height: 0,
            borderTop: "6px solid transparent",
            borderBottom: "6px solid transparent",
            borderRight: `6px solid ${colors.dark.surface}`,
          }} />
        </div>
      )}
    </div>
  );
}
