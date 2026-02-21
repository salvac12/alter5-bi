import { Badge, StatusBadge } from './UI';
import { getBestProductMatch } from '../utils/data';

const COLUMNS = [
  { key: "score", label: "Score", w: 58, sortable: true },
  { key: "name", label: "Empresa", w: 190, sortable: true },
  { key: null, label: "Sector", w: 140, sortable: false },
  { key: null, label: "Tipo", w: 110, sortable: false },
  { key: "productScore", label: "Producto", w: 120, sortable: true },
  { key: null, label: "Estado", w: 76, sortable: false },
  { key: "interactions", label: "Emails", w: 72, sortable: true },
  { key: "nContacts", label: "Cont.", w: 60, sortable: true },
  { key: "monthsAgo", label: "Último", w: 80, sortable: true },
];

export default function CompanyTable({
  companies, sortBy, sortDir, onSort, onSelect, selected,
  page, totalPages, setPage, productMatches,
}) {
  const SortIcon = ({ col }) => {
    if (sortBy !== col) {
      return <span style={{ color: "#CBD5E1", fontSize: 12, opacity: 0.6, marginLeft: 4 }}>↕</span>;
    }
    return (
      <span style={{
        color: "#3B82F6",
        fontSize: 14,
        marginLeft: 4,
        display: "inline-block",
        transition: "transform 0.2s ease"
      }}>
        {sortDir === "desc" ? "↓" : "↑"}
      </span>
    );
  };

  return (
    <div style={{ padding: "0 20px 20px", overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {COLUMNS.map((col, i) => {
              const isActive = sortBy === col.key;
              const isSortable = col.sortable;

              return (
                <th key={i}
                  onClick={isSortable ? () => onSort(col.key) : undefined}
                  style={{
                    padding: "16px 12px",
                    textAlign: "left",
                    fontSize: 13,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: isActive ? "#3B82F6" : "#64748B",
                    fontWeight: isActive ? 700 : 600,
                    cursor: isSortable ? "pointer" : "default",
                    width: col.w,
                    whiteSpace: "nowrap",
                    userSelect: "none",
                    background: isActive
                      ? "linear-gradient(180deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0.02) 100%)"
                      : "transparent",
                    borderBottom: isActive ? "3px solid #3B82F6" : "2px solid #E2E8F0",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (isSortable && !isActive) {
                      e.currentTarget.style.background = "#F8FAFC";
                      e.currentTarget.style.color = "#475569";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isSortable && !isActive) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "#64748B";
                    }
                  }}
                >
                  {col.label} {isSortable && <SortIcon col={col.key} />}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {companies.map((c, i) => {
            const isSelected = selected?.idx === c.idx;

            return (
              <tr key={c.idx}
                onClick={() => onSelect(c)}
                className="row-hover fade-in"
                style={{
                  cursor: "pointer",
                  background: isSelected
                    ? "linear-gradient(90deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%)"
                    : "#FFFFFF",
                  animationDelay: `${i * 12}ms`,
                  borderBottom: "1px solid #F1F5F9",
                  borderLeft: isSelected ? "4px solid #3B82F6" : "4px solid transparent",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "linear-gradient(90deg, #F8FAFC 0%, #F1F5F9 100%)";
                    e.currentTarget.style.borderLeft = "3px solid #3B82F6";
                    e.currentTarget.style.transform = "translateX(2px)";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.04)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "#FFFFFF";
                    e.currentTarget.style.borderLeft = "4px solid transparent";
                    e.currentTarget.style.transform = "translateX(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              >
              {/* Score */}
              <td style={{ padding: "10px" }}>
                <ScoreChip score={c.score} />
              </td>

              {/* Company */}
              <td style={{ padding: "10px" }}>
                <div style={{ fontWeight: 600, color: "#1A2B3D", fontSize: 13, lineHeight: 1.3 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "#6B7F94", fontWeight: 400 }}>{c.domain}</div>
              </td>

              {/* Sector */}
              <td style={{ padding: "10px" }}>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {c.sectors.split(", ").slice(0, 2).map((s, j) => (
                    <Badge key={j} variant="sector">{s}</Badge>
                  ))}
                </div>
              </td>

              {/* Type */}
              <td style={{ padding: "10px" }}>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {c.relType.split(", ").slice(0, 1).map((t, j) => (
                    <Badge key={j} variant="type">{t}</Badge>
                  ))}
                </div>
              </td>

              {/* Product Match */}
              <td style={{ padding: "10px" }}>
                <ProductMatchCell companyIdx={c.idx} productMatches={productMatches} />
              </td>

              {/* Status */}
              <td style={{ padding: "10px" }}><StatusBadge status={c.status} /></td>

              {/* Interactions */}
              <td style={{ padding: "10px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#1A2B3D" }}>
                {c.interactions.toLocaleString()}
              </td>

              {/* Contacts */}
              <td style={{ padding: "10px", fontVariantNumeric: "tabular-nums", color: "#6B7F94" }}>
                {c.nContacts}
              </td>

              {/* Last date */}
              <td style={{ padding: "10px", fontSize: 12, color: "#6B7F94", fontVariantNumeric: "tabular-nums" }}>
                {c.lastDate}
              </td>
            </tr>
          );
          })}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 16 }}>
          <PageBtn onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            ← Anterior
          </PageBtn>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(0, Math.min(totalPages - 5, page - 2)) + i;
            if (p >= totalPages) return null;
            return <PageBtn key={p} onClick={() => setPage(p)} active={p === page}>{p + 1}</PageBtn>;
          })}
          <PageBtn onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
            Siguiente →
          </PageBtn>
        </div>
      )}
    </div>
  );
}

/* ── Score chip with gradient ── */
function ScoreChip({ score }) {
  const isHigh = score > 65;
  const isMid = score > 35;
  return (
    <div style={{
      width: 34, height: 34, borderRadius: 8, display: "flex",
      alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: 12, letterSpacing: "-0.5px",
      color: isHigh ? "#FFFFFF" : isMid ? "#FFFFFF" : "#6B7F94",
      background: isHigh
        ? "linear-gradient(135deg, #3B82F6, #10B981)"
        : isMid
          ? "#3B82F6"
          : "#F1F5F9",
    }}>
      {score}
    </div>
  );
}

/* ── Product match badge for table rows ── */
function ProductMatchCell({ companyIdx, productMatches }) {
  const best = getBestProductMatch(productMatches, companyIdx);
  if (!best || best.score < 15) {
    return <span style={{ fontSize: 11, color: "#CBD5E1" }}>—</span>;
  }

  const opacity = best.score >= 50 ? 1 : best.score >= 30 ? 0.8 : 0.6;

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 8px", borderRadius: 6,
      background: best.color + "15",
      border: `1px solid ${best.color}30`,
      opacity,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: best.color, flexShrink: 0,
      }} />
      <span style={{
        fontSize: 11, fontWeight: 600, color: best.color,
        whiteSpace: "nowrap",
      }}>
        {best.short}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, color: best.color,
        opacity: 0.7,
      }}>
        {best.score}
      </span>
    </div>
  );
}

/* ── Page button ── */
function PageBtn({ children, onClick, disabled, active }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "6px 12px", borderRadius: 6, fontSize: 12, fontFamily: "inherit",
      cursor: disabled ? "default" : "pointer", minWidth: 32,
      fontWeight: active ? 700 : 500,
      border: "1px solid " + (active ? "#3B82F6" : "#E2E8F0"),
      background: active ? "#EFF6FF" : "#FFFFFF",
      color: disabled ? "#E2E8F0" : active ? "#3B82F6" : "#6B7F94",
    }}>
      {children}
    </button>
  );
}
