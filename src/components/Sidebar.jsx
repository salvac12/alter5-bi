import { SECTORS, TIPOS, STATUS_LABELS } from '../utils/constants';
import { FilterChip, SectionLabel } from './UI';

export default function Sidebar({
  companies, employees,
  selEmployees, setSelEmployees,
  selSectors, setSelSectors,
  selTipos, setSelTipos,
  selStatus, setSelStatus,
  setPage,
}) {
  const toggle = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
    setPage(0);
  };

  const hasFilters = selSectors.length > 0 || selTipos.length > 0 || selStatus.length > 0 || selEmployees.length > 0;

  const statusCounts = {
    active: companies.filter(c => c.status === "active").length,
    dormant: companies.filter(c => c.status === "dormant").length,
    lost: companies.filter(c => c.status === "lost").length,
  };

  return (
    <div style={{
      width: 216, minWidth: 216, borderRight: "1px solid #E2E8F0",
      padding: "16px 14px", overflow: "auto", maxHeight: "calc(100vh - 57px)",
      background: "#FFFFFF",
    }}>
      {/* Employees */}
      {employees.length > 1 && (
        <FilterSection title="Buzón">
          {employees.map(emp => (
            <FilterChip key={emp.id}
              label={`${emp.name} (${emp.count})`}
              active={selEmployees.includes(emp.id)}
              onClick={() => toggle(selEmployees, setSelEmployees, emp.id)}
            />
          ))}
        </FilterSection>
      )}

      {/* Status */}
      <FilterSection title="Estado">
        {["active", "dormant", "lost"].map(s => (
          <FilterChip key={s}
            label={`${STATUS_LABELS[s]} (${statusCounts[s]})`}
            active={selStatus.includes(s)}
            onClick={() => toggle(selStatus, setSelStatus, s)}
          />
        ))}
      </FilterSection>

      {/* Sector */}
      <FilterSection title="Sector">
        {SECTORS.map(s => (
          <FilterChip key={s} label={s}
            active={selSectors.includes(s)}
            onClick={() => toggle(selSectors, setSelSectors, s)}
          />
        ))}
      </FilterSection>

      {/* Type */}
      <FilterSection title="Tipo Relación">
        {TIPOS.map(t => (
          <FilterChip key={t} label={t}
            active={selTipos.includes(t)}
            onClick={() => toggle(selTipos, setSelTipos, t)}
          />
        ))}
      </FilterSection>

      {/* Clear */}
      {hasFilters && (
        <button
          onClick={() => {
            setSelEmployees([]); setSelSectors([]); setSelTipos([]); setSelStatus([]); setPage(0);
          }}
          style={{
            marginTop: 12, width: "100%", padding: "7px 12px", borderRadius: 6,
            border: "none", cursor: "pointer", fontWeight: 600, fontSize: 11,
            background: "#FEF2F2", color: "#EF4444",
            fontFamily: "inherit",
          }}
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

function FilterSection({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10, textTransform: "uppercase", color: "#6B7F94",
        fontWeight: 700, letterSpacing: "2.5px", marginBottom: 6,
      }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}
