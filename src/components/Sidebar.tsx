import { Search } from 'lucide-react';
import { COMPANY_ROLES, ORIGINACION_SEGMENTS, COMPANY_TYPES_V2, CORPORATE_ACTIVITIES, TECHNOLOGIES, COMPANY_TYPES, ALL_COMPANY_TYPES, STATUS_LABELS, STATUS_COLORS, PRODUCTS, MARKET_ROLES } from '../utils/constants';
import { getOpportunityStages, getOpportunityCounts } from '../utils/data';
import { font } from '../theme/tokens';

/* ── Role pill color map (active state) ── */
const ROLE_ACTIVE_COLORS: Record<string, string> = {
  "Originacion": "#B45309",
  "Originación": "#B45309",
  "Inversion": "#1D4ED8",
  "Inversión": "#1D4ED8",
  "Services": "#64748B",
  "No relevante": "#DC2626",
};

/* ── Status dot colors ── */
const STATUS_DOT_COLORS: Record<string, string> = {
  active: "#10B981",
  dormant: "#F59E0B",
  lost: "#EF4444",
};

/* ── Shared pill styles ── */
const pillBase: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 9px",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: font.family,
  transition: "all 0.12s ease",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
};

const pillInactive: React.CSSProperties = {
  ...pillBase,
  fontWeight: 400,
  border: "1px solid #E2E8F0",
  background: "#FFFFFF",
  color: "#64748B",
};

const pillActive: React.CSSProperties = {
  ...pillBase,
  fontWeight: 600,
  border: "none",
  background: "#1E293B",
  color: "#FFFFFF",
};

function pillActiveColored(bg: string): React.CSSProperties {
  return {
    ...pillBase,
    fontWeight: 600,
    border: "none",
    background: bg,
    color: "#FFFFFF",
  };
}

/* ── Section header ── */
const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#94A3B8",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  marginBottom: 8,
  display: "flex",
  alignItems: "center",
};

/* ── Count badge inside pill ── */
function Count({ n, active }: { n: number; active?: boolean }) {
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 600,
      color: active ? "rgba(255,255,255,0.7)" : "#94A3B8",
      marginLeft: 2,
    }}>
      {n}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sidebar — Figma Make FilterSidebar design
   ═══════════════════════════════════════════════════════════════ */

export default function Sidebar({
  companies, employees,
  selEmployees, setSelEmployees,
  selGroups, setSelGroups,
  selTypes, setSelTypes,
  selSegments, setSelSegments,
  selActivities, setSelActivities,
  selTech, setSelTech,
  selStatus, setSelStatus,
  selProduct, setSelProduct,
  selMarketRoles, setSelMarketRoles,
  selPipeline, setSelPipeline,
  productMatches,
  setPage,
  search,
  onSearchChange,
}: {
  companies: any[];
  employees: any[];
  selEmployees: string[];
  setSelEmployees: (v: any) => void;
  selGroups: string[];
  setSelGroups: (v: any) => void;
  selTypes: string[];
  setSelTypes: (v: any) => void;
  selSegments: string[];
  setSelSegments: (v: any) => void;
  selActivities: string[];
  setSelActivities: (v: any) => void;
  selTech: string[];
  setSelTech: (v: any) => void;
  selStatus: string[];
  setSelStatus: (v: any) => void;
  selProduct: string;
  setSelProduct: (v: any) => void;
  selMarketRoles: string[];
  setSelMarketRoles: (v: any) => void;
  selPipeline: string;
  setSelPipeline: (v: any) => void;
  productMatches: Map<number, any[]>;
  setPage: (v: number) => void;
  search?: string;
  onSearchChange?: (v: string) => void;
}) {
  const toggle = (arr: string[], setArr: (v: any) => void, val: string) => {
    setArr((prev: string[]) => prev.includes(val) ? prev.filter((x: string) => x !== val) : [...prev, val]);
    setPage(0);
  };

  const hasFilters = selGroups.length > 0 || selTypes.length > 0 || selSegments.length > 0 || selActivities.length > 0 || selTech.length > 0 || selStatus.length > 0 || selEmployees.length > 0 || selMarketRoles.length > 0 || !!selProduct || !!selPipeline;

  // ── Counts ──
  const statusCounts = {
    active: companies.filter(c => c.status === "active").length,
    dormant: companies.filter(c => c.status === "dormant").length,
    lost: companies.filter(c => c.status === "lost").length,
  };

  const roleCounts: Record<string, number> = {};
  for (const r of COMPANY_ROLES) {
    roleCounts[r.id] = companies.filter(c => c.role === r.id).length;
  }

  const segmentCounts: Record<string, number> = {};
  for (const s of ORIGINACION_SEGMENTS) {
    segmentCounts[s.id] = companies.filter(c => c.role === "Originación" && c.segment === s.id).length;
  }

  const showSegments = selGroups.length === 0 || selGroups.includes("Originación");
  const originacionSelected = selGroups.includes("Originación");

  // Determine available types
  let availableTypes: string[] = [];
  if (selGroups.length > 0) {
    for (const role of selGroups) {
      if (role === "Originación") {
        if (selSegments.length > 0) {
          for (const seg of selSegments) {
            const key = `Originación > ${seg}`;
            availableTypes.push(...((COMPANY_TYPES_V2 as Record<string, string[]>)[key] || []));
          }
        } else {
          availableTypes.push(...(COMPANY_TYPES_V2["Originación > Project Finance"] || []));
        }
      } else if (role === "Inversión") {
        availableTypes.push(...(COMPANY_TYPES_V2["Inversión > Deuda"] || []));
        availableTypes.push(...(COMPANY_TYPES_V2["Inversión > Equity"] || []));
      } else if (role === "Services") {
        availableTypes.push(...(COMPANY_TYPES_V2["Services"] || []));
      }
      availableTypes.push(...((COMPANY_TYPES as Record<string, string[]>)[role] || []));
    }
    availableTypes = [...new Set(availableTypes)];
  } else {
    availableTypes = ALL_COMPANY_TYPES;
  }

  const typeCounts: Record<string, number> = {};
  for (const t of availableTypes) {
    typeCounts[t] = companies.filter(c => c.companyType === t).length;
  }

  const showActivities = originacionSelected && (selSegments.length === 0 || selSegments.includes("Corporate Finance"));

  const activityCounts: Record<string, number> = {};
  if (showActivities) {
    for (const act of CORPORATE_ACTIVITIES) {
      activityCounts[act] = companies.filter(c => c.activities?.includes(act)).length;
    }
  }

  const techCounts: Record<string, number> = {};
  for (const t of TECHNOLOGIES) {
    techCounts[t.id] = companies.filter(c => c.technologies?.includes(t.id)).length;
  }

  const marketRoleCounts: Record<string, number> = {};
  for (const mr of MARKET_ROLES) {
    marketRoleCounts[mr.id] = companies.filter(c => c.marketRoles?.includes(mr.id)).length;
  }

  const productCounts: Record<string, number> = {};
  for (const product of PRODUCTS) {
    let count = 0;
    for (const c of companies) {
      const matches = productMatches?.get(c.idx) || [];
      if (matches.some((m: any) => m.id === product.id && m.score >= 15)) count++;
    }
    productCounts[product.id] = count;
  }

  // Employee names for pills
  const employeeNames = ["Todos", ...employees.map((e: any) => e.name?.split(" ")[0] || e.name)];

  return (
    <div style={{
      width: 270,
      flexShrink: 0,
      background: "#FFFFFF",
      borderRight: "1px solid #E2E8F0",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      fontFamily: font.family,
      maxHeight: "calc(100vh - 60px)",
    }}>
      {/* ── Search ── */}
      <div style={{ padding: "18px 16px 0" }}>
        <div style={{ position: "relative" }}>
          <Search size={13} color="#94A3B8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input
            placeholder="Buscar empresa..."
            value={search ?? ""}
            onChange={e => onSearchChange?.(e.target.value)}
            style={{
              width: "100%",
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: 8,
              padding: "8px 10px 8px 30px",
              fontSize: 13,
              color: "#0F172A",
              outline: "none",
              boxSizing: "border-box" as const,
              fontFamily: font.family,
            }}
          />
        </div>
      </div>

      {/* ── Empleado ── */}
      <FilterSection title="Empleado">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {employeeNames.map(name => {
            const isTodos = name === "Todos";
            const isActive = isTodos ? selEmployees.length === 0 : selEmployees.includes(name);
            return (
              <button
                key={name}
                onClick={() => {
                  if (isTodos) {
                    setSelEmployees([]);
                  } else {
                    toggle(selEmployees, setSelEmployees, name);
                  }
                  setPage(0);
                }}
                style={isActive ? pillActive : pillInactive}
              >
                {name}
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* ── Rol ── */}
      <FilterSection title="Rol">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {COMPANY_ROLES.map(g => {
            const active = selGroups.includes(g.id);
            const activeColor = ROLE_ACTIVE_COLORS[g.id] || "#1E293B";
            return (
              <button
                key={g.id}
                onClick={() => toggle(selGroups, setSelGroups, g.id)}
                style={active ? pillActiveColored(activeColor) : pillInactive}
              >
                {g.label}
                <Count n={roleCounts[g.id]} active={active} />
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* ── Tecnologia ── */}
      <FilterSection title="Tecnologia">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {TECHNOLOGIES.map(t => {
            const active = selTech.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggle(selTech, setSelTech, t.id)}
                style={active ? pillActiveColored("#0EA5E9") : pillInactive}
              >
                <span style={{ fontSize: 11 }}>{t.icon}</span>
                {t.label}
                <Count n={techCounts[t.id]} active={active} />
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* ── Estado de Empresa (radio dots) ── */}
      <FilterSection title="Estado">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(["active", "dormant", "lost"] as const).map(s => {
            const active = selStatus.includes(s);
            const dotColor = STATUS_DOT_COLORS[s];
            return (
              <button
                key={s}
                onClick={() => toggle(selStatus, setSelStatus, s)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: font.family,
                }}
              >
                {/* Radio circle */}
                <span style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: `2px solid ${active ? dotColor : "#CBD5E1"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "all 0.12s ease",
                }}>
                  {active && (
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: dotColor,
                    }} />
                  )}
                </span>
                <span style={{
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  color: active ? "#0F172A" : "#64748B",
                }}>
                  {(STATUS_LABELS as any)[s]}
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#94A3B8",
                  marginLeft: "auto",
                }}>
                  {statusCounts[s]}
                </span>
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* ── Product Match ── */}
      <FilterSection title="Product Match">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {PRODUCTS.map(p => {
            const active = selProduct === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setSelProduct((prev: string) => prev === p.id ? "" : p.id);
                  setPage(0);
                }}
                style={active ? pillActiveColored(p.color) : pillInactive}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: active ? "#FFFFFF" : p.color,
                  display: "inline-block", flexShrink: 0,
                }} />
                {p.name}
                <Count n={productCounts[p.id]} active={active} />
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* ── Spacer to push clear button to bottom ── */}
      <div style={{ flex: 1 }} />

      {/* ── Limpiar filtros ── */}
      <div style={{ padding: "18px 16px 24px" }}>
        <button
          onClick={() => {
            setSelEmployees([]);
            setSelGroups([]);
            setSelSegments([]);
            setSelTypes([]);
            setSelActivities([]);
            setSelTech([]);
            setSelStatus([]);
            setSelMarketRoles([]);
            setSelPipeline("");
            setSelProduct("");
            if (onSearchChange) onSearchChange("");
            setPage(0);
          }}
          style={{
            width: "100%",
            background: hasFilters ? "#F8FAFC" : "#FAFAFA",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "9px",
            fontSize: 12,
            fontWeight: 500,
            color: hasFilters ? "#64748B" : "#CBD5E1",
            cursor: hasFilters ? "pointer" : "default",
            fontFamily: font.family,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (hasFilters) {
              e.currentTarget.style.background = "#F1F5F9";
              e.currentTarget.style.borderColor = "#94A3B8";
              e.currentTarget.style.color = "#475569";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = hasFilters ? "#F8FAFC" : "#FAFAFA";
            e.currentTarget.style.borderColor = "#E2E8F0";
            e.currentTarget.style.color = hasFilters ? "#64748B" : "#CBD5E1";
          }}
        >
          Limpiar filtros
        </button>
      </div>
    </div>
  );
}

/* ── Filter Section wrapper ── */
function FilterSection({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 16px 0" }}>
      <div style={sectionHeaderStyle}>{title}</div>
      {children}
    </div>
  );
}
