import { COMPANY_GROUPS, COMPANY_TYPES, ALL_COMPANY_TYPES, DEAL_STAGES, STATUS_LABELS, COMPANY_SIZES, COUNTRIES, PRODUCTS, MARKET_ROLES } from '../utils/constants';
import { FilterChip, ComingSoonBadge, Tooltip } from './UI';

export default function Sidebar({
  companies, employees,
  selEmployees, setSelEmployees,
  selGroups, setSelGroups,
  selTypes, setSelTypes,
  selStages, setSelStages,
  selStatus, setSelStatus,
  selProduct, setSelProduct,
  selMarketRoles, setSelMarketRoles,
  productMatches,
  setPage,
}) {
  const toggle = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
    setPage(0);
  };

  const hasFilters = selGroups.length > 0 || selTypes.length > 0 || selStages.length > 0 || selStatus.length > 0 || selEmployees.length > 0 || selMarketRoles.length > 0 || !!selProduct;

  const statusCounts = {
    active: companies.filter(c => c.status === "active").length,
    dormant: companies.filter(c => c.status === "dormant").length,
    lost: companies.filter(c => c.status === "lost").length,
  };

  const totalActiveFilters = selEmployees.length + selGroups.length + selTypes.length + selStages.length + selStatus.length + selMarketRoles.length + (selProduct ? 1 : 0);

  const groupCounts = {};
  for (const g of COMPANY_GROUPS) {
    groupCounts[g.id] = companies.filter(c => c.group === g.id).length;
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

  // Determine which types to show based on selected groups
  const availableTypes = selGroups.length > 0
    ? selGroups.flatMap(g => COMPANY_TYPES[g] || [])
    : ALL_COMPANY_TYPES;

  // Type counts
  const typeCounts = {};
  for (const t of availableTypes) {
    typeCounts[t] = companies.filter(c => c.companyType === t).length;
  }

  // Deal stage counts (only Capital Seekers)
  const stageCounts = {};
  const capitalSeekerCompanies = companies.filter(c => c.group === "Capital Seeker");
  for (const s of DEAL_STAGES) {
    stageCounts[s] = capitalSeekerCompanies.filter(c => c.dealStage === s).length;
  }

  // Show deal stages only if Capital Seeker is in filters or no group filter active
  const showDealStages = selGroups.length === 0 || selGroups.includes("Capital Seeker");

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

      {/* Company Group */}
      <FilterSection title="Company Group">
        {COMPANY_GROUPS.map(g => (
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
                  {groupCounts[g.id]}
                </span>
              </span>
            }
            active={selGroups.includes(g.id)}
            onClick={() => toggle(selGroups, setSelGroups, g.id)}
          />
        ))}
      </FilterSection>

      {/* Company Type */}
      <FilterSection title="Company Type">
        {availableTypes.map(t => (
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

      {/* Deal Stage (only when Capital Seekers visible) */}
      {showDealStages && (
        <FilterSection title="Deal Stage">
          {DEAL_STAGES.map(s => (
            <FilterChip key={s}
              label={
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {s}
                  <span style={{
                    fontSize: 10, color: "#94A3B8", fontWeight: 600, marginLeft: "auto",
                  }}>
                    {stageCounts[s]}
                  </span>
                </span>
              }
              active={selStages.includes(s)}
              onClick={() => toggle(selStages, setSelStages, s)}
            />
          ))}
        </FilterSection>
      )}

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

      {/* Separador visual */}
      <div style={{
        margin: "24px 0",
        borderTop: "2px solid #E2E8F0",
        paddingTop: 16,
      }}>
        <div style={{
          fontSize: 11,
          textTransform: "uppercase",
          color: "#94A3B8",
          fontWeight: 600,
          letterSpacing: "1px",
          textAlign: "center",
        }}>
          FILTROS FUTUROS
        </div>
      </div>

      {/* Tamaño Empresa (disabled) */}
      <FilterSection title={
        <span>
          Tamaño Empresa
          <ComingSoonBadge />
        </span>
      }>
        {COMPANY_SIZES.map(size => (
          <Tooltip key={size.id} text="Requiere cualificación de datos de LinkedIn">
            <FilterChip
              label={size.label}
              active={false}
              onClick={() => {}}
              style={{
                opacity: 0.4,
                cursor: "not-allowed",
              }}
            />
          </Tooltip>
        ))}
      </FilterSection>

      {/* País (disabled) */}
      <FilterSection title={
        <span>
          País
          <ComingSoonBadge />
        </span>
      }>
        {COUNTRIES.map(country => (
          <Tooltip key={country.id} text="Requiere cualificación de datos por idioma de correos">
            <FilterChip
              label={country.label}
              active={false}
              onClick={() => {}}
              style={{
                opacity: 0.4,
                cursor: "not-allowed",
              }}
            />
          </Tooltip>
        ))}
      </FilterSection>

      {/* Clear */}
      {hasFilters && (
        <button
          onClick={() => {
            setSelEmployees([]); setSelGroups([]); setSelTypes([]); setSelStages([]); setSelStatus([]); setSelMarketRoles([]); setSelProduct(""); setPage(0);
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
