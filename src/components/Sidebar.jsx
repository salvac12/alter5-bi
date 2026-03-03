import { COMPANY_ROLES, ORIGINACION_SEGMENTS, COMPANY_TYPES_V2, CORPORATE_ACTIVITIES, TECHNOLOGIES, COMPANY_TYPES, ALL_COMPANY_TYPES, STATUS_LABELS, COMPANY_SIZES, COUNTRIES, PRODUCTS, MARKET_ROLES } from '../utils/constants';
import { getOpportunityStages, getOpportunityCounts } from '../utils/data';
import { FilterChip, ComingSoonBadge, Tooltip } from './UI';

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
}) {
  const toggle = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
    setPage(0);
  };

  const hasFilters = selGroups.length > 0 || selTypes.length > 0 || selSegments.length > 0 || selActivities.length > 0 || selTech.length > 0 || selStatus.length > 0 || selEmployees.length > 0 || selMarketRoles.length > 0 || !!selProduct || !!selPipeline;

  const statusCounts = {
    active: companies.filter(c => c.status === "active").length,
    dormant: companies.filter(c => c.status === "dormant").length,
    lost: companies.filter(c => c.status === "lost").length,
  };

  const totalActiveFilters = selEmployees.length + selGroups.length + selSegments.length + selTypes.length + selActivities.length + selTech.length + selStatus.length + selMarketRoles.length + (selProduct ? 1 : 0) + (selPipeline ? 1 : 0);

  // Role counts
  const roleCounts = {};
  for (const r of COMPANY_ROLES) {
    roleCounts[r.id] = companies.filter(c => c.role === r.id).length;
  }

  // Segment counts (only when Originación is selected)
  const segmentCounts = {};
  for (const s of ORIGINACION_SEGMENTS) {
    segmentCounts[s.id] = companies.filter(c => c.role === "Originación" && c.segment === s.id).length;
  }

  // Show segment filter only when Originación is among selected roles (or no role filter)
  const showSegments = selGroups.length === 0 || selGroups.includes("Originación");
  const originacionSelected = selGroups.includes("Originación");

  // Determine which types to show based on selected roles + segments
  let availableTypes = [];
  if (selGroups.length > 0) {
    for (const role of selGroups) {
      if (role === "Originación") {
        if (selSegments.length > 0) {
          for (const seg of selSegments) {
            const key = `Originación > ${seg}`;
            availableTypes.push(...(COMPANY_TYPES_V2[key] || []));
          }
        } else {
          availableTypes.push(...(COMPANY_TYPES_V2["Originación > Project Finance"] || []));
          // Corporate Finance has no fixed types
        }
      } else if (role === "Inversión") {
        availableTypes.push(...(COMPANY_TYPES_V2["Inversión > Deuda"] || []));
        availableTypes.push(...(COMPANY_TYPES_V2["Inversión > Equity"] || []));
      } else if (role === "Ecosistema") {
        availableTypes.push(...(COMPANY_TYPES_V2["Ecosistema"] || []));
      }
      // Also include legacy types for this role via COMPANY_TYPES
      availableTypes.push(...(COMPANY_TYPES[role] || []));
    }
    // Deduplicate
    availableTypes = [...new Set(availableTypes)];
  } else {
    availableTypes = ALL_COMPANY_TYPES;
  }

  // Type counts
  const typeCounts = {};
  for (const t of availableTypes) {
    typeCounts[t] = companies.filter(c => c.companyType === t).length;
  }

  // Show activities filter when Corporate Finance is selected
  const showActivities = originacionSelected && (selSegments.length === 0 || selSegments.includes("Corporate Finance"));

  // Activity counts
  const activityCounts = {};
  if (showActivities) {
    for (const act of CORPORATE_ACTIVITIES) {
      activityCounts[act] = companies.filter(c => c.activities?.includes(act)).length;
    }
  }

  // Technology counts
  const techCounts = {};
  for (const t of TECHNOLOGIES) {
    techCounts[t.id] = companies.filter(c => c.technologies?.includes(t.id)).length;
  }

  const marketRoleCounts = {};
  for (const mr of MARKET_ROLES) {
    marketRoleCounts[mr.id] = companies.filter(c => c.marketRoles?.includes(mr.id)).length;
  }

  const productCounts = {};
  for (const product of PRODUCTS) {
    let count = 0;
    for (const c of companies) {
      const matches = productMatches?.get(c.idx) || [];
      if (matches.some(m => m.id === product.id && m.score >= 15)) count++;
    }
    productCounts[product.id] = count;
  }

  return (
    <div style={{
      width: 280, minWidth: 280, borderRight: "1px solid #E2E8F0",
      padding: "20px", overflow: "auto", maxHeight: "calc(100vh - 57px)",
      background: "#FFFFFF",
    }}>
      {/* Header con badge contador */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
      }}>
        <div style={{
          fontSize: 14,
          textTransform: "uppercase",
          color: "#1E293B",
          fontWeight: 700,
          letterSpacing: "0.5px",
        }}>
          FILTROS
        </div>
        {totalActiveFilters > 0 && (
          <div style={{
            background: "linear-gradient(135deg, #3B82F6, #10B981)",
            color: "white",
            borderRadius: 12,
            padding: "4px 8px",
            fontSize: 12,
            fontWeight: 600,
            minWidth: 24,
            textAlign: "center",
          }}>
            {totalActiveFilters}
          </div>
        )}
      </div>

      {/* Role (replaces Company Group) */}
      <FilterSection title="Role">
        {COMPANY_ROLES.map(g => (
          <FilterChip key={g.id}
            label={
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: g.color, display: "inline-block", flexShrink: 0,
                }} />
                {g.label}
                <span style={{
                  fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                }}>
                  {roleCounts[g.id]}
                </span>
              </span>
            }
            active={selGroups.includes(g.id)}
            onClick={() => toggle(selGroups, setSelGroups, g.id)}
          />
        ))}
      </FilterSection>

      {/* Segment (conditional, only when Originación selected) */}
      {showSegments && originacionSelected && (
        <FilterSection title="Segmento">
          {ORIGINACION_SEGMENTS.map(s => (
            <FilterChip key={s.id}
              label={
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {s.label}
                  <span style={{
                    fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                  }}>
                    {segmentCounts[s.id]}
                  </span>
                </span>
              }
              active={selSegments.includes(s.id)}
              onClick={() => toggle(selSegments, setSelSegments, s.id)}
            />
          ))}
        </FilterSection>
      )}

      {/* Type (dynamic based on role + segment) */}
      {availableTypes.length > 0 && (
        <FilterSection title="Tipo">
          {availableTypes.filter(t => typeCounts[t] > 0).map(t => (
            <FilterChip key={t}
              label={
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {t}
                  <span style={{
                    fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                  }}>
                    {typeCounts[t]}
                  </span>
                </span>
              }
              active={selTypes.includes(t)}
              onClick={() => toggle(selTypes, setSelTypes, t)}
            />
          ))}
        </FilterSection>
      )}

      {/* Corporate Finance Activities (conditional multi-select) */}
      {showActivities && (
        <FilterSection title="Actividad Corp. Finance">
          {CORPORATE_ACTIVITIES.filter(act => activityCounts[act] > 0).map(act => (
            <FilterChip key={act}
              label={
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11 }}>{act}</span>
                  <span style={{
                    fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                  }}>
                    {activityCounts[act]}
                  </span>
                </span>
              }
              active={selActivities.includes(act)}
              onClick={() => toggle(selActivities, setSelActivities, act)}
            />
          ))}
        </FilterSection>
      )}

      {/* Technology */}
      <FilterSection title="Tecnología">
        {TECHNOLOGIES.map(t => (
          <FilterChip key={t.id}
            label={
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12 }}>{t.icon}</span>
                {t.label}
                <span style={{
                  fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                }}>
                  {techCounts[t.id]}
                </span>
              </span>
            }
            active={selTech.includes(t.id)}
            onClick={() => toggle(selTech, setSelTech, t.id)}
          />
        ))}
      </FilterSection>

      {/* Market Role */}
      <FilterSection title="Market Role">
        {MARKET_ROLES.map(mr => (
          <FilterChip key={mr.id}
            label={
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: mr.color, display: "inline-block", flexShrink: 0,
                }} />
                {mr.label}
                <span style={{
                  fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                }}>
                  {marketRoleCounts[mr.id]}
                </span>
              </span>
            }
            active={selMarketRoles.includes(mr.id)}
            onClick={() => toggle(selMarketRoles, setSelMarketRoles, mr.id)}
          />
        ))}
      </FilterSection>

      {/* Status */}
      <FilterSection title="Estado de Empresa">
        {["active", "dormant", "lost"].map(s => (
          <FilterChip key={s}
            label={`${STATUS_LABELS[s]} (${statusCounts[s]})`}
            active={selStatus.includes(s)}
            onClick={() => toggle(selStatus, setSelStatus, s)}
          />
        ))}
      </FilterSection>

      {/* Pipeline Airtable */}
      {(() => {
        const stages = getOpportunityStages();
        const oppCounts = getOpportunityCounts(companies);
        if (oppCounts._any === 0 && stages.length === 0) return null;
        return (
          <FilterSection title={
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Pipeline
              <span style={{
                fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
                background: "#8B5CF620", color: "#A78BFA", textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>Airtable</span>
            </span>
          }>
            <FilterChip
              label={
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: "#8B5CF6", display: "inline-block", flexShrink: 0,
                  }} />
                  Todas las oportunidades
                  <span style={{
                    fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                  }}>{oppCounts._any || 0}</span>
                </span>
              }
              active={selPipeline === "_any"}
              onClick={() => {
                setSelPipeline(prev => prev === "_any" ? "" : "_any");
                setPage(0);
              }}
            />
            {stages.map(stage => (
              <FilterChip key={stage}
                label={
                  <span style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 14 }}>
                    {stage}
                    <span style={{
                      fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                    }}>{oppCounts[stage] || 0}</span>
                  </span>
                }
                active={selPipeline === stage}
                onClick={() => {
                  setSelPipeline(prev => prev === stage ? "" : stage);
                  setPage(0);
                }}
              />
            ))}
          </FilterSection>
        );
      })()}

      {/* Producto Alter5 */}
      <FilterSection title="Producto Alter5">
        {PRODUCTS.map(p => (
          <div key={p.id}>
            <FilterChip
              label={
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: p.color, display: "inline-block", flexShrink: 0,
                  }} />
                  {p.name}
                  <span style={{
                    fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                  }}>
                    {productCounts[p.id]}
                  </span>
                </span>
              }
              active={selProduct === p.id}
              onClick={() => {
                setSelProduct(prev => prev === p.id ? "" : p.id);
                setPage(0);
              }}
            />
            {p.subcategories && (
              <div style={{ marginLeft: 20, marginTop: 2, marginBottom: 6 }}>
                {p.subcategories.map(sub => (
                  <div key={sub.id} style={{
                    fontSize: 10, color: "#6B7F94", fontWeight: 600,
                    padding: "2px 0", display: "flex", alignItems: "center", gap: 4,
                  }}>
                    <span style={{ color: p.color, fontSize: 8 }}>├</span>
                    {sub.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </FilterSection>

      {/* Clear */}
      {hasFilters && (
        <button
          onClick={() => {
            setSelEmployees([]); setSelGroups([]); setSelSegments([]); setSelTypes([]); setSelActivities([]); setSelTech([]); setSelStatus([]); setSelMarketRoles([]); setSelPipeline(""); setSelProduct(""); setPage(0);
          }}
          style={{
            marginTop: 20,
            width: "100%",
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #CBD5E1",
            cursor: "pointer",
            fontWeight: 500,
            fontSize: 14,
            background: "transparent",
            color: "#64748B",
            fontFamily: "inherit",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#F8FAFC";
            e.currentTarget.style.borderColor = "#94A3B8";
            e.currentTarget.style.color = "#475569";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "#CBD5E1";
            e.currentTarget.style.color = "#64748B";
          }}
        >
          Limpiar todos
        </button>
      )}
    </div>
  );
}

function FilterSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 12,
        textTransform: "uppercase",
        color: "#6B7F94",
        fontWeight: 700,
        letterSpacing: "0.5px",
        marginBottom: 8,
        display: "flex",
        alignItems: "center",
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}
