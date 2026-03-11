import { useState } from 'react';
import { getBestProductMatch } from '../utils/data';
import { MARKET_ROLES, COMPANY_ROLES, PER_PAGE } from '../utils/constants';
import { SUSPECT_LABELS } from './CleanupToolbar';

/* ── Helpers ── */

const scoreGradient = (s: number) =>
  s >= 80 ? "linear-gradient(135deg,#10B981,#059669)" :
  s >= 65 ? "linear-gradient(135deg,#3B82F6,#6366F1)" :
  s >= 50 ? "linear-gradient(135deg,#F59E0B,#D97706)" : "";

const qualityDot = (s: number) =>
  s >= 65 ? "#10B981" : s >= 45 ? "#F59E0B" : "#EF4444";

const ROLE_COLOR_MAP: Record<string, string> = Object.fromEntries(
  COMPANY_ROLES.map(g => [g.id, g.color])
);

const MARKET_ROLE_MAP: Record<string, { color: string }> = Object.fromEntries(
  MARKET_ROLES.map(mr => [mr.id, mr])
);

/* ── Column definitions ── */

const COLUMNS = [
  { key: "name",         label: "Empresa",     sortable: true },
  { key: null,           label: "Rol",         sortable: false },
  { key: null,           label: "Seg / Tipo",  sortable: false },
  { key: null,           label: "Market Role",  sortable: false },
  { key: "productScore", label: "Producto",    sortable: true },
  { key: null,           label: "Estado",      sortable: false },
  { key: "interactions", label: "Emails",      sortable: true },
  { key: "nContacts",    label: "Cont.",       sortable: true },
  { key: "employeeCount", label: "Empl.",      sortable: true },
  { key: "monthsAgo",   label: "Ultimo",       sortable: true },
  { key: "score",        label: "Score",       sortable: true },
];

/* ── Sub-components ── */

function ScoreChip({ score }: { score: number }) {
  const grad = scoreGradient(score);
  return (
    <div style={{
      width: 34, height: 34, borderRadius: 8, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: grad || "#F1F5F9",
      fontSize: 12, fontWeight: 700, color: grad ? "#FFFFFF" : "#64748B",
      letterSpacing: "-0.02em", flexShrink: 0,
      boxShadow: grad ? "0 2px 8px rgba(59,130,246,0.25)" : "none",
    }}>
      {score}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const cfg: Record<string, { bg: string; color: string }> = {
    "Originacion":  { bg: "rgba(245,158,11,0.1)",  color: "#B45309" },
    "Originaci\u00f3n": { bg: "rgba(245,158,11,0.1)",  color: "#B45309" },
    "Inversion":    { bg: "rgba(59,130,246,0.1)",  color: "#1D4ED8" },
    "Inversi\u00f3n":   { bg: "rgba(59,130,246,0.1)",  color: "#1D4ED8" },
    "Services":     { bg: "rgba(100,116,139,0.1)", color: "#475569" },
    "No relevante": { bg: "rgba(239,68,68,0.08)",  color: "#DC2626" },
  };
  const c = cfg[role] ?? cfg["Services"];
  return (
    <span style={{
      background: c.bg, color: c.color, fontSize: 10, fontWeight: 600,
      padding: "2px 8px", borderRadius: 5, whiteSpace: "nowrap",
    }}>
      {role}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const cfg: Record<string, { color: string; label: string; bg: string }> = {
    active:  { color: "#10B981", label: "Active",  bg: "rgba(16,185,129,0.08)" },
    dormant: { color: "#F59E0B", label: "Dormant", bg: "rgba(245,158,11,0.08)" },
    lost:    { color: "#EF4444", label: "Lost",    bg: "rgba(239,68,68,0.08)" },
  };
  const c = cfg[status] ?? cfg["active"];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: c.bg, color: c.color, fontSize: 10, fontWeight: 600,
      padding: "2px 8px", borderRadius: 5, whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%", background: c.color,
        display: "inline-block",
      }} />
      {c.label}
    </span>
  );
}

function SegmentTypeCell({ segment, companyType }: { segment: string; companyType: string }) {
  if (!segment && !companyType) {
    return <span style={{ fontSize: 11, color: "#CBD5E1" }}>&mdash;</span>;
  }
  return (
    <div>
      {segment && <div style={{ fontSize: 12, color: "#475569" }}>{segment}</div>}
      {companyType && <div style={{ fontSize: 11, color: "#94A3B8" }}>{companyType}</div>}
    </div>
  );
}

function MarketRoleCell({ roles }: { roles: string[] }) {
  if (!roles || roles.length === 0) {
    return <span style={{ fontSize: 11, color: "#CBD5E1" }}>&mdash;</span>;
  }
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 150 }}>
      {roles.slice(0, 2).map((r, i) => (
        <span key={i} style={{
          fontSize: 10, color: "#64748B", background: "#F1F5F9",
          padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
        }}>
          {r.length > 14 ? r.slice(0, 12) + "\u2026" : r}
        </span>
      ))}
      {roles.length > 2 && (
        <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>+{roles.length - 2}</span>
      )}
    </div>
  );
}

function ProductMatchCell({ companyIdx, productMatches }: { companyIdx: number; productMatches: any }) {
  const best = getBestProductMatch(productMatches, companyIdx);
  if (!best || best.score < 15) {
    return <span style={{ fontSize: 11, color: "#CBD5E1" }}>&mdash;</span>;
  }

  // Map to display category
  const name: string = best.name || best.short || "";
  let displayName = name;
  let pColor = "#8B5CF6";

  if (/debt/i.test(name)) {
    displayName = "Debt";
    pColor = "#3B82F6";
  } else if (/equity|investment|co-development/i.test(name)) {
    displayName = "Equity";
    pColor = "#10B981";
  } else if (/m&a/i.test(name)) {
    displayName = "M&A";
    pColor = "#8B5CF6";
  }

  return (
    <span style={{
      fontSize: 10, color: pColor, background: `${pColor}12`,
      padding: "2px 7px", borderRadius: 4, fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {displayName}
    </span>
  );
}

function VerifiedIcon({ status }: { status?: string }) {
  if (!status) return null;
  const color =
    status === "Verified" ? "#10B981" :
    status === "Edited" ? "#8B5CF6" :
    status === "Pending Review" ? "#F59E0B" : "#6B7F94";
  return (
    <span title={`Verificado: ${status}`} style={{
      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
      background: color, display: "inline-block",
    }} />
  );
}

/* ── Sort header ── */

function SortTh({
  label, sortKey, sortBy, sortDir, onSort, isSortable,
}: {
  label: string;
  sortKey: string | null;
  sortBy: string;
  sortDir: string;
  onSort: (key: string) => void;
  isSortable: boolean;
}) {
  const isActive = isSortable && sortBy === sortKey;

  return (
    <th
      onClick={isSortable && sortKey ? () => onSort(sortKey) : undefined}
      style={{
        padding: "10px 12px",
        textAlign: "left",
        fontSize: 10,
        fontWeight: 700,
        color: isActive ? "#0F172A" : "#94A3B8",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        userSelect: "none",
        cursor: isSortable ? "pointer" : "default",
        borderBottom: "1px solid #F1F5F9",
        background: "#FAFAFA",
        transition: "color 0.15s ease",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {label}
        {isSortable && (
          <span style={{
            display: "inline-flex", flexDirection: "column", fontSize: 8,
            lineHeight: 1, color: isActive ? "#0F172A" : "#CBD5E1",
          }}>
            <span style={{
              opacity: isActive && sortDir === "asc" ? 1 : 0.35,
              lineHeight: "8px",
            }}>{"\u25B2"}</span>
            <span style={{
              opacity: isActive && sortDir === "desc" ? 1 : 0.35,
              lineHeight: "8px",
            }}>{"\u25BC"}</span>
          </span>
        )}
      </span>
    </th>
  );
}

/* ── Page button ── */

function PageBtn({ children, onClick, disabled, active }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: 30, height: 30, borderRadius: 6,
      border: active ? "none" : "1px solid #E2E8F0",
      background: active ? "#1E293B" : "#FFFFFF",
      color: disabled ? "#CBD5E1" : active ? "#FFFFFF" : "#64748B",
      fontSize: 12, fontWeight: active ? 700 : 500,
      cursor: disabled ? "default" : "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontFamily: "inherit",
      transition: "all 0.15s ease",
    }}>
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CompanyTable — Figma Make EmpresasView Table
   ═══════════════════════════════════════════════════════════════ */

export default function CompanyTable({
  companies, sortBy, sortDir, onSort, onSelect, selected,
  page, totalPages, setPage, productMatches,
  cleanupMode, cleanupSelection, onToggleCleanup, suspiciousMap,
  verifiedCompanies,
  bulkSelection, onToggleBulkSelect, onSelectAllPage, onBulkHide, onClearBulkSelection,
}: any) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const hasBulkSelection = bulkSelection && bulkSelection.size > 0;
  const allPageSelected = companies.length > 0 && companies.every((c: any) => bulkSelection?.has(c.domain));
  const somePageSelected = companies.some((c: any) => bulkSelection?.has(c.domain));

  const totalCompanies = totalPages * PER_PAGE;
  const showFrom = page * PER_PAGE + 1;
  const showTo = Math.min((page + 1) * PER_PAGE, totalCompanies);

  return (
    <div style={{ padding: "0 28px 28px", overflow: "auto" }}>
      {/* White card wrapper */}
      <div style={{
        background: "#FFFFFF",
        borderRadius: 14,
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #F1F5F9", background: "#FAFAFA" }}>
              {/* Checkbox header */}
              <th style={{
                width: 44, padding: "10px 12px",
                borderBottom: "1px solid #F1F5F9",
                background: "#FAFAFA",
              }}>
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                  onChange={onSelectAllPage}
                  title={allPageSelected ? "Deseleccionar pagina" : "Seleccionar toda la pagina"}
                  style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#3B82F6" }}
                />
              </th>

              {/* Cleanup mode header */}
              {cleanupMode && (
                <th style={{
                  width: 36, padding: "10px 8px",
                  borderBottom: "1px solid #F1F5F9",
                  background: "#FAFAFA",
                }} />
              )}

              {/* Data columns */}
              {COLUMNS.map((col, i) => (
                <SortTh
                  key={i}
                  label={col.label}
                  sortKey={col.key}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={onSort}
                  isSortable={col.sortable}
                />
              ))}
            </tr>
          </thead>

          <tbody>
            {companies.map((c: any, i: number) => {
              const isSelected = selected?.idx === c.idx;
              const isBulkChecked = bulkSelection?.has(c.domain);
              const isCleanupChecked = cleanupMode && cleanupSelection?.has(c.domain);
              const suspectReason = cleanupMode && suspiciousMap?.get(c.domain);
              const verifiedStatus = verifiedCompanies?.get?.(c.domain)?.status;
              const isHovered = hoveredIdx === c.idx;

              const qScore = c.qualityScore ?? 0;

              // Row background
              const rowBg =
                isBulkChecked ? "rgba(59,130,246,0.06)" :
                isCleanupChecked ? "rgba(239,68,68,0.06)" :
                isSelected ? "rgba(59,130,246,0.06)" :
                isHovered ? "linear-gradient(90deg,#F8FAFC,#F1F5F9)" :
                "transparent";

              // Left border
              const rowBorderLeft =
                isBulkChecked ? "3px solid #3B82F6" :
                isCleanupChecked ? "3px solid #EF4444" :
                suspectReason ? "3px solid #F59E0B" :
                isSelected ? "3px solid #3B82F6" :
                isHovered ? "3px solid #E2E8F0" :
                "3px solid transparent";

              return (
                <tr
                  key={c.idx}
                  onClick={() => cleanupMode ? onToggleCleanup(c.domain) : onSelect(c)}
                  onMouseEnter={() => setHoveredIdx(c.idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{
                    borderBottom: "1px solid #F8FAFC",
                    cursor: "pointer",
                    background: rowBg,
                    borderLeft: rowBorderLeft,
                    transition: "all 0.15s",
                  }}
                >
                  {/* Checkbox + quality dot */}
                  <td style={{ padding: "10px 12px", width: 44 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div
                        onClick={(e) => { e.stopPropagation(); onToggleBulkSelect(c.domain); }}
                        style={{
                          width: 14, height: 14, borderRadius: 4,
                          border: `1.5px solid ${isBulkChecked ? "#3B82F6" : "#CBD5E1"}`,
                          background: isBulkChecked ? "#3B82F6" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", flexShrink: 0,
                          transition: "all 0.15s",
                        }}
                      >
                        {isBulkChecked && (
                          <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5L4.5 7.5L8 2.5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div
                        title={`Quality: ${qScore}/100`}
                        style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: qualityDot(qScore), flexShrink: 0,
                        }}
                      />
                    </div>
                  </td>

                  {/* Cleanup checkbox */}
                  {cleanupMode && (
                    <td style={{ padding: "10px 8px", width: 36, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isCleanupChecked || false}
                        onChange={() => onToggleCleanup(c.domain)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#EF4444" }}
                      />
                    </td>
                  )}

                  {/* Empresa: avatar + name + domain + verified */}
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 7,
                        background: `${qualityDot(qScore)}18`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 700, color: qualityDot(qScore),
                        flexShrink: 0,
                      }}>
                        {String(c.name).slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          display: "flex", alignItems: "center", gap: 5,
                        }}>
                          <span style={{
                            fontSize: 13, fontWeight: 600, color: "#0F172A",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {c.name}
                          </span>
                          <VerifiedIcon status={verifiedStatus} />
                          {cleanupMode && suspectReason && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                              background: (SUSPECT_LABELS as any)[suspectReason].color + "18",
                              color: (SUSPECT_LABELS as any)[suspectReason].color,
                              whiteSpace: "nowrap", flexShrink: 0,
                            }}>
                              {(SUSPECT_LABELS as any)[suspectReason].text}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#94A3B8" }}>{c.domain}</div>
                      </div>
                    </div>
                  </td>

                  {/* Role */}
                  <td style={{ padding: "10px 12px" }}>
                    <RoleBadge role={c.role} />
                  </td>

                  {/* Seg / Tipo */}
                  <td style={{ padding: "10px 12px" }}>
                    <SegmentTypeCell segment={c.segment} companyType={c.companyType} />
                  </td>

                  {/* Market Role */}
                  <td style={{ padding: "10px 12px" }}>
                    <MarketRoleCell roles={c.marketRoles} />
                  </td>

                  {/* Producto */}
                  <td style={{ padding: "10px 12px" }}>
                    <ProductMatchCell companyIdx={c.idx} productMatches={productMatches} />
                  </td>

                  {/* Estado */}
                  <td style={{ padding: "10px 12px" }}>
                    <StatusDot status={c.status} />
                  </td>

                  {/* Emails */}
                  <td style={{
                    padding: "10px 12px", fontWeight: 600, fontSize: 13,
                    fontVariantNumeric: "tabular-nums", color: "#0F172A",
                  }}>
                    {c.interactions.toLocaleString()}
                  </td>

                  {/* Contacts */}
                  <td style={{
                    padding: "10px 12px", fontSize: 13,
                    fontVariantNumeric: "tabular-nums", color: "#64748B",
                  }}>
                    {c.nContacts}
                  </td>

                  {/* Employee count (verified > enrichment) */}
                  <td style={{
                    padding: "10px 12px", fontSize: 13,
                    fontVariantNumeric: "tabular-nums", color: "#64748B",
                  }}>
                    {(() => {
                      const v = verifiedCompanies?.get?.(c.domain);
                      const emp = v?.employeeCount || c.employeeCount;
                      return emp ? emp.toLocaleString() : "—";
                    })()}
                  </td>

                  {/* Last date */}
                  <td style={{
                    padding: "10px 12px", fontSize: 12, color: "#94A3B8",
                    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                  }}>
                    {c.lastDate}
                  </td>

                  {/* Score */}
                  <td style={{ padding: "10px 12px" }}>
                    <ScoreChip score={qScore} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            padding: "14px 20px",
            borderTop: "1px solid #F1F5F9",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 12, color: "#94A3B8" }}>
              Mostrando {showFrom}-{showTo} de {totalCompanies} &middot; {PER_PAGE} por pagina
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {/* Previous */}
              <PageBtn
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
              >
                {"\u2039"}
              </PageBtn>

              {/* Page numbers */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(0, Math.min(totalPages - 5, page - 2)) + i;
                if (p >= totalPages) return null;
                return (
                  <PageBtn key={p} onClick={() => setPage(p)} active={p === page}>
                    {p + 1}
                  </PageBtn>
                );
              })}

              {/* Next */}
              <PageBtn
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
              >
                {"\u203A"}
              </PageBtn>
            </div>
          </div>
        )}
      </div>

      {/* Floating bulk action bar */}
      {hasBulkSelection && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#0A1628", borderRadius: 12, padding: "12px 20px",
          display: "flex", alignItems: "center", gap: 16,
          border: "1px solid #2A4A6C",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          zIndex: 90,
          animation: "fadeIn 0.2s ease both",
        }}>
          <span style={{ fontSize: 13, color: "#94A3B8", fontWeight: 500 }}>
            <strong style={{ color: "#FFFFFF" }}>{bulkSelection.size}</strong>
            {" "}empresa{bulkSelection.size !== 1 ? "s" : ""} seleccionada{bulkSelection.size !== 1 ? "s" : ""}
          </span>
          <button
            onClick={onClearBulkSelection}
            style={{
              background: "#132238", border: "1px solid #2A4A6C",
              color: "#94A3B8", padding: "7px 14px", borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#1B3A5C";
              (e.currentTarget as HTMLButtonElement).style.color = "#FFFFFF";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#132238";
              (e.currentTarget as HTMLButtonElement).style.color = "#94A3B8";
            }}
          >
            Deseleccionar
          </button>
          <button
            onClick={onBulkHide}
            style={{
              background: "#EF4444", border: "none",
              color: "#FFFFFF", padding: "7px 16px", borderRadius: 6,
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#DC2626";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#EF4444";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            }}
          >
            Ocultar seleccionadas
          </button>
        </div>
      )}
    </div>
  );
}
