import { STATUS_LABELS, STATUS_COLORS, STATUS_BG, EMERALD_SECTORS, BLUE_SECTORS } from '../utils/constants';

/* ── Color logic for sector badges ── */
function sectorColor(sector) {
  if (EMERALD_SECTORS.some(s => sector.includes(s))) return { color: "#10B981", bg: "#ECFDF5" };
  if (BLUE_SECTORS.some(s => sector.includes(s))) return { color: "#3B82F6", bg: "#EFF6FF" };
  return { color: "#1B3A5C", bg: "#F1F5F9" };
}

/* ── Badge ── */
export function Badge({ children, color, bg, variant }) {
  let c = color || "#1B3A5C";
  let b = bg || "#F1F5F9";

  if (variant === "sector") {
    const sc = sectorColor(children);
    c = sc.color; b = sc.bg;
  } else if (variant === "type") {
    c = "#3B82F6"; b = "#EFF6FF";
  } else if (variant === "employee") {
    c = "#1B3A5C"; b = "#F7F9FC";
  }

  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 9, fontWeight: 500, color: c, background: b,
      whiteSpace: "nowrap", lineHeight: "16px", letterSpacing: "0.02em",
    }}>
      {children}
    </span>
  );
}

/* ── Status Badge ── */
export function StatusBadge({ status }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 600,
      color: STATUS_COLORS[status], background: STATUS_BG[status],
      whiteSpace: "nowrap", lineHeight: "16px", letterSpacing: "0.02em",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%", background: STATUS_COLORS[status],
      }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

/* ── Score Bar ── */
export function ScoreBar({ score, max = 100, label }) {
  const pct = (score / max) * 100;
  const gradient = pct > 60
    ? "linear-gradient(90deg, #3B82F6, #10B981)"
    : pct > 30
      ? "linear-gradient(90deg, #3B82F6, #60A5FA)"
      : "#E2E8F0";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label && (
        <span style={{
          width: 56, fontSize: 10, fontWeight: 700, color: "#6B7F94",
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>{label}</span>
      )}
      <div style={{
        flex: 1, height: 4, background: "#F1F5F9", borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 2,
          background: gradient, transition: "width 0.3s ease",
        }} />
      </div>
      <span style={{
        width: 22, textAlign: "right", fontWeight: 700, color: "#1A2B3D", fontSize: 11,
      }}>{score}</span>
    </div>
  );
}

/* ── KPI Card ── */
export function KPI({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 10, padding: "16px 18px",
      border: "1px solid #E2E8F0",
    }}>
      <div style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: "2.5px",
        color: "#6B7F94", marginBottom: 6, fontWeight: 700,
      }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 800, color: accent || "#1A2B3D",
        lineHeight: 1, letterSpacing: "-1.5px",
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: "#6B7F94", marginTop: 6, fontWeight: 400 }}>{sub}</div>
      )}
    </div>
  );
}

/* ── Filter Chip ── */
export function FilterChip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 10px", borderRadius: 4, fontSize: 12, fontWeight: 500,
      cursor: "pointer", textAlign: "left", lineHeight: 1.4,
      border: active ? "1px solid #10B981" : "1px solid transparent",
      background: active ? "#ECFDF5" : "transparent",
      color: active ? "#10B981" : "#6B7F94",
      transition: "all 0.12s ease",
    }}>
      {label}
    </button>
  );
}

/* ── Section Label (uppercase) ── */
export function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, textTransform: "uppercase", color: "#6B7F94",
      fontWeight: 700, letterSpacing: "2.5px", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}
