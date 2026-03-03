import { StatusBadge } from './UI';
import { getBestProductMatch } from '../utils/data';
import { MARKET_ROLES, COMPANY_ROLES } from '../utils/constants';
import { SUSPECT_LABELS } from './CleanupToolbar';

const ROLE_COLOR_MAP = Object.fromEntries(COMPANY_ROLES.map(g => [g.id, g.color]));

const COLUMNS = [
  { key: "score", label: "Score", w: 58, sortable: true },
  { key: "name", label: "Empresa", w: 180, sortable: true },
  { key: null, label: "Role", w: 100, sortable: false },
  { key: null, label: "Seg / Tipo", w: 130, sortable: false },
  { key: null, label: "Market Role", w: 120, sortable: false },
  { key: "productScore", label: "Producto", w: 110, sortable: true },
  { key: null, label: "Estado", w: 76, sortable: false },
  { key: "interactions", label: "Emails", w: 72, sortable: true },
  { key: "nContacts", label: "Cont.", w: 55, sortable: true },
  { key: "monthsAgo", label: "Último", w: 70, sortable: true },
];

export default function CompanyTable({
  companies, sortBy, sortDir, onSort, onSelect, selected,
  page, totalPages, setPage, productMatches,
  cleanupMode, cleanupSelection, onToggleCleanup, suspiciousMap,
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
            {cleanupMode && (
              <th style={{ padding: "16px 8px", width: 36, borderBottom: "2px solid #E2E8F0" }} />
            )}
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
            const isChecked = cleanupMode && cleanupSelection?.has(c.domain);
            const suspectReason = cleanupMode && suspiciousMap?.get(c.domain);

            return (
              <tr key={c.idx}
                onClick={() => cleanupMode ? onToggleCleanup(c.domain) : onSelect(c)}
                className="row-hover fade-in"
                style={{
                  cursor: "pointer",
                  background: isChecked
                    ? "rgba(239, 68, 68, 0.06)"
                    : isSelected
                      ? "linear-gradient(90deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%)"
                      : "#FFFFFF",
                  animationDelay: `${i * 12}ms`,
                  borderBottom: "1px solid #F1F5F9",
                  borderLeft: isChecked
                    ? "4px solid #EF4444"
                    : suspectReason
                      ? "4px solid #F59E0B"
                      : isSelected ? "4px solid #3B82F6" : "4px solid transparent",
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
              {/* Cleanup checkbox */}
              {cleanupMode && (
                <td style={{ padding: "10px 8px", width: 36, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={isChecked || false}
                    onChange={() => onToggleCleanup(c.domain)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#EF4444" }}
                  />
                </td>
              )}

              {/* Score */}
              <td style={{ padding: "10px" }}>
                <ScoreChip score={c.score} />
              </td>

              {/* Company */}
              <td style={{ padding: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontWeight: 600, color: "#1A2B3D", fontSize: 13, lineHeight: 1.3 }}>{c.name}</div>
                  {cleanupMode && suspectReason && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                      background: SUSPECT_LABELS[suspectReason].color + "18",
                      color: SUSPECT_LABELS[suspectReason].color,
                      whiteSpace: "nowrap",
                    }}>
                      {SUSPECT_LABELS[suspectReason].text}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#6B7F94", fontWeight: 400 }}>{c.domain}</div>
              </td>

              {/* Role */}
              <td style={{ padding: "10px" }}>
                <RoleBadge role={c.role} />
              </td>

              {/* Segment / Type */}
              <td style={{ padding: "10px" }}>
                <SegmentTypeCell segment={c.segment} companyType={c.companyType} />
              </td>

              {/* Market Role */}
              <td style={{ padding: "10px" }}>
                <MarketRoleCell roles={c.marketRoles} />
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

/* ── Role badge for table rows ── */
function RoleBadge({ role }) {
  const color = ROLE_COLOR_MAP[role] || "#94A3B8";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: color + "15", color: color, border: `1px solid ${color}25`,
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {role}
    </span>
  );
}

/* ── Segment / Type cell for table rows ── */
function SegmentTypeCell({ segment, companyType }) {
  const label = segment || companyType;
  if (!label) return <span style={{ fontSize: 11, color: "#CBD5E1" }}>—</span>;
  const secondary = segment && companyType ? companyType : null;
  return (
    <div>
      <span style={{
        display: "inline-block",
        padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
        background: "#8B5CF615", color: "#7C3AED", border: "1px solid #8B5CF625",
        whiteSpace: "nowrap", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {label}
      </span>
      {secondary && (
        <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 500, marginTop: 2 }}>
          {secondary}
        </div>
      )}
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

/* ── Market role badges for table rows ── */
const MARKET_ROLE_MAP = Object.fromEntries(MARKET_ROLES.map(mr => [mr.id, mr]));

function MarketRoleCell({ roles }) {
  if (!roles || roles.length === 0) {
    return <span style={{ fontSize: 11, color: "#CBD5E1" }}>—</span>;
  }
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {roles.slice(0, 2).map((r, i) => {
        const mr = MARKET_ROLE_MAP[r];
        const color = mr?.color || "#94A3B8";
        return (
          <span key={i} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
            background: color + "15", color: color, border: `1px solid ${color}25`,
            whiteSpace: "nowrap",
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
            {r.length > 14 ? r.slice(0, 12) + "…" : r}
          </span>
        );
      })}
      {roles.length > 2 && (
        <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>+{roles.length - 2}</span>
      )}
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
