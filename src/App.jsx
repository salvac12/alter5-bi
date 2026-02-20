import { useState, useMemo } from 'react';
import { parseCompanies, getEmployees, downloadCSV } from './utils/data';
import { PER_PAGE } from './utils/constants';
import { KPI } from './components/UI';
import Sidebar from './components/Sidebar';
import CompanyTable from './components/CompanyTable';
import DetailPanel from './components/DetailPanel';
import EmployeeTabs from './components/EmployeeTabs';

export default function App() {
  const companies = useMemo(() => parseCompanies(), []);
  const employees = useMemo(() => getEmployees(companies), [companies]);

  const [search, setSearch] = useState("");
  const [activeEmployeeTab, setActiveEmployeeTab] = useState("all");
  const [selEmployees, setSelEmployees] = useState([]);
  const [selSectors, setSelSectors] = useState([]);
  const [selTipos, setSelTipos] = useState([]);
  const [selStatus, setSelStatus] = useState([]);
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let list = companies;

    // Filtro por tab de empleado
    if (activeEmployeeTab !== "all") {
      list = list.filter(c => c.employees.includes(activeEmployeeTab));
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q) ||
        c.sectors.toLowerCase().includes(q) ||
        c.relType.toLowerCase().includes(q)
      );
    }
    if (selEmployees.length) list = list.filter(c => selEmployees.some(e => c.employees.includes(e)));
    if (selSectors.length) list = list.filter(c => selSectors.some(s => c.sectors.includes(s)));
    if (selTipos.length) list = list.filter(c => selTipos.some(t => c.relType.includes(t)));
    if (selStatus.length) list = list.filter(c => selStatus.includes(c.status));

    return [...list].sort((a, b) => {
      const m = sortDir === "desc" ? -1 : 1;
      if (sortBy === "name") return m * a.name.localeCompare(b.name);
      return m * (a[sortBy] - b[sortBy]);
    });
  }, [companies, activeEmployeeTab, search, selEmployees, selSectors, selTipos, selStatus, sortBy, sortDir]);

  const paginated = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  // Stats basados en el tab activo (no en todas las empresas)
  const tabFilteredCompanies = useMemo(() => {
    if (activeEmployeeTab === "all") return companies;
    return companies.filter(c => c.employees.includes(activeEmployeeTab));
  }, [companies, activeEmployeeTab]);

  const stats = useMemo(() => ({
    total: tabFilteredCompanies.length,
    active: tabFilteredCompanies.filter(c => c.status === "active").length,
    dormant: tabFilteredCompanies.filter(c => c.status === "dormant").length,
    lost: tabFilteredCompanies.filter(c => c.status === "lost").length,
    avgScore: tabFilteredCompanies.length > 0
      ? Math.round(tabFilteredCompanies.reduce((s, c) => s + c.score, 0) / tabFilteredCompanies.length)
      : 0,
  }), [tabFilteredCompanies]);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const handleTabChange = (tabId) => {
    setActiveEmployeeTab(tabId);
    setPage(0); // Resetear paginación al cambiar de tab
  };

  const subtitle = employees.length === 1
    ? `Red de contactos · ${employees[0].name}`
    : `${employees.length} buzones · ${companies.length} empresas`;

  return (
    <div style={{ minHeight: "100vh", background: "#F7F9FC" }}>
      {/* ── Nav (White) ── */}
      <div style={{
        padding: "12px 24px", background: "#FFFFFF",
        borderBottom: "1px solid #E2E8F0",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Logo mark with gradient */}
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: "linear-gradient(135deg, #3B82F6, #10B981)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 13, color: "#FFFFFF", letterSpacing: "-0.5px",
          }}>A5</div>
          <div>
            <h1 style={{
              fontSize: 15, fontWeight: 800, margin: 0,
              color: "#1A2B3D", letterSpacing: "-0.5px",
            }}>
              Business Intelligence
            </h1>
            <p style={{
              fontSize: 11, color: "#6B7F94", margin: 0, fontWeight: 400,
            }}>{subtitle}</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Buscar empresa, dominio, sector..."
            style={{
              width: 260, padding: "7px 14px", borderRadius: 6,
              border: "1px solid #E2E8F0", background: "#F7F9FC",
              color: "#1A2B3D", fontSize: 13, outline: "none",
              fontFamily: "inherit", fontWeight: 400,
            }}
          />
          {/* CTA with gradient */}
          <button
            onClick={() => downloadCSV(filtered)}
            style={{
              padding: "7px 16px", borderRadius: 6, border: "none",
              background: "linear-gradient(135deg, #3B82F6, #10B981)",
              color: "#FFFFFF", fontSize: 12, fontWeight: 700,
              cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
              letterSpacing: "-0.2px",
            }}
          >
            ↓ CSV ({filtered.length})
          </button>
        </div>
      </div>

      <div style={{ display: "flex" }}>
        {/* ── Sidebar ── */}
        <Sidebar
          companies={companies} employees={employees}
          selEmployees={selEmployees} setSelEmployees={setSelEmployees}
          selSectors={selSectors} setSelSectors={setSelSectors}
          selTipos={selTipos} setSelTipos={setSelTipos}
          selStatus={selStatus} setSelStatus={setSelStatus}
          setPage={setPage}
        />

        {/* ── Main ── */}
        <div style={{ flex: 1, overflow: "auto", maxHeight: "calc(100vh - 57px)" }}>
          {/* KPIs */}
          <div style={{
            padding: "16px 20px",
            display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10,
          }}>
            <KPI label="Total empresas" value={stats.total} sub={`${filtered.length} filtradas`} />
            <KPI label="Activas" value={stats.active} accent="#10B981" sub="< 6 meses" />
            <KPI label="Dormidas" value={stats.dormant} accent="#F59E0B" sub="6-18 meses" />
            <KPI label="Perdidas" value={stats.lost} accent="#EF4444" sub="> 18 meses" />
            <KPI label="Score medio" value={stats.avgScore} accent="#3B82F6" sub="/100 puntos" />
          </div>

          {/* Employee Tabs */}
          <EmployeeTabs
            activeTab={activeEmployeeTab}
            onTabChange={handleTabChange}
            totalCount={companies.length}
          />

          {/* Count */}
          <div style={{
            padding: "4px 20px 8px", fontSize: 11, color: "#6B7F94", fontWeight: 500,
          }}>
            {filtered.length} empresas · Página {page + 1}/{totalPages || 1}
          </div>

          {/* Table */}
          <CompanyTable
            companies={paginated}
            sortBy={sortBy} sortDir={sortDir} onSort={handleSort}
            onSelect={setSelected} selected={selected}
            page={page} totalPages={totalPages} setPage={setPage}
          />
        </div>
      </div>

      {/* ── Detail overlay ── */}
      {selected && (
        <div onClick={() => setSelected(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.35)", zIndex: 99 }}
        />
      )}
      <DetailPanel company={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
