import { useState, useMemo, useEffect } from 'react';
import alter5Logo from './assets/alter5-logo.svg';
import { parseCompanies, getEmployees, downloadCSV, calculateProductMatches, getBestProductMatch, getOpportunityStages, getOpportunityCounts } from './utils/data';
import { PER_PAGE, PRODUCTS } from './utils/constants';
import { KPI } from './components/UI';
import Sidebar from './components/Sidebar';
import CompanyTable from './components/CompanyTable';
import DetailPanel from './components/DetailPanel';
import EmployeeTabs from './components/EmployeeTabs';
import KanbanView from './components/KanbanView';
import OpportunityPanel from './components/OpportunityPanel';
import ProspectsView from './components/ProspectsView';
import ProspectPanel from './components/ProspectPanel';
import CerebroSearch from './components/CerebroSearch';
import { getHiddenCompanies, hideCompany, getAllEnrichmentOverrides, saveEnrichmentOverride } from './utils/companyData';

export default function App() {
  const allCompanies = useMemo(() => parseCompanies(), []);
  const [hiddenCompanies, setHiddenCompanies] = useState(() => getHiddenCompanies());
  const [enrichmentOverrides, setEnrichmentOverrides] = useState(() => getAllEnrichmentOverrides());

  // ── View state: "empresas" | "pipeline" | "prospects" ──
  const [activeView, setActiveView] = useState("empresas");

  // ── Pipeline panel state ──
  const [selectedOpp, setSelectedOpp] = useState(null);
  const [isCreatingOpp, setIsCreatingOpp] = useState(false);
  const [newOppStage, setNewOppStage] = useState("New");
  const [kanbanKey, setKanbanKey] = useState(0); // bump to force refresh

  // ── Prospects panel state ──
  const [selectedProspect, setSelectedProspect] = useState(null);
  const [isCreatingProspect, setIsCreatingProspect] = useState(false);
  const [newProspectStage, setNewProspectStage] = useState("Lead");
  const [prospectsKey, setProspectsKey] = useState(0);

  // ── URL params: ?view=pipeline|prospects&add=CompanyName&stage=New ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    if (view === "pipeline") {
      setActiveView("pipeline");
      const addName = params.get("add");
      const stage = params.get("stage") || "New";
      if (addName) {
        setNewOppStage(stage);
        setIsCreatingOpp(true);
      }
    } else if (view === "prospects") {
      setActiveView("prospects");
      const addName = params.get("add");
      const stage = params.get("stage") || "Lead";
      if (addName) {
        setNewProspectStage(stage);
        setIsCreatingProspect(true);
      }
    }
  }, []);

  // Filtrar empresas ocultas y aplicar enrichment overrides
  const companies = useMemo(() => {
    return allCompanies
      .filter(c => !hiddenCompanies.includes(c.domain))
      .map(c => {
        const ov = enrichmentOverrides[c.domain];
        if (!ov) return c;
        return {
          ...c,
          marketRoles: ov.mr !== undefined ? ov.mr : c.marketRoles,
          group: ov.grp !== undefined ? ov.grp : c.group,
          companyType: ov.tp !== undefined ? ov.tp : c.companyType,
        };
      });
  }, [allCompanies, hiddenCompanies, enrichmentOverrides]);

  const employees = useMemo(() => getEmployees(companies), [companies]);

  const [search, setSearch] = useState("");
  const [activeEmployeeTab, setActiveEmployeeTab] = useState("all");
  const [selEmployees, setSelEmployees] = useState([]);
  const [selGroups, setSelGroups] = useState([]);
  const [selTypes, setSelTypes] = useState([]);
  const [selStatus, setSelStatus] = useState([]);
  const [selProduct, setSelProduct] = useState("");
  const [selMarketRoles, setSelMarketRoles] = useState([]);
  const [selPipeline, setSelPipeline] = useState("");  // "" | "_any" | stage name
  const [sortBy, setSortBy] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [selected, setSelected] = useState(null);
  const [showCerebro, setShowCerebro] = useState(false);
  const [page, setPage] = useState(0);

  const productMatches = useMemo(() => calculateProductMatches(companies), [companies]);

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
        c.group.toLowerCase().includes(q) ||
        c.companyType.toLowerCase().includes(q) ||
        c.marketRoles.some(mr => mr.toLowerCase().includes(q))
      );
    }
    if (selEmployees.length) list = list.filter(c => selEmployees.some(e => c.employees.includes(e)));
    if (selGroups.length) list = list.filter(c => selGroups.includes(c.group));
    if (selTypes.length) list = list.filter(c => selTypes.includes(c.companyType));
    if (selStatus.length) list = list.filter(c => selStatus.includes(c.status));
    if (selMarketRoles.length) list = list.filter(c => selMarketRoles.some(mr => c.marketRoles.includes(mr)));
    if (selPipeline) {
      if (selPipeline === "_any") {
        list = list.filter(c => !!c.opportunity);
      } else {
        list = list.filter(c => c.opportunity?.stage === selPipeline);
      }
    }
    if (selProduct) {
      list = list.filter(c => {
        const matches = productMatches.get(c.idx) || [];
        return matches.some(m => m.id === selProduct && m.score >= 15);
      });
    }

    return [...list].sort((a, b) => {
      const m = sortDir === "desc" ? -1 : 1;
      if (sortBy === "name") return m * a.name.localeCompare(b.name);
      if (sortBy === "lastDate") return m * (a.lastDate || "").localeCompare(b.lastDate || "");
      if (sortBy === "productScore") {
        const aMatch = getBestProductMatch(productMatches, a.idx);
        const bMatch = getBestProductMatch(productMatches, b.idx);
        return m * ((aMatch?.score || 0) - (bMatch?.score || 0));
      }
      return m * (a[sortBy] - b[sortBy]);
    });
  }, [companies, activeEmployeeTab, search, selEmployees, selGroups, selTypes, selStatus, selMarketRoles, selPipeline, selProduct, productMatches, sortBy, sortDir]);

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

  const handleKpiClick = (status) => {
    if (selStatus.length === 1 && selStatus[0] === status) {
      // Toggle off: clear filter, restore default sort
      setSelStatus([]);
      setSortBy("score");
      setSortDir("desc");
    } else {
      setSelStatus([status]);
      setSortBy("lastDate");
      setSortDir("desc");
    }
    setPage(0);
  };

  const handleTabChange = (tabId) => {
    setActiveEmployeeTab(tabId);
    setPage(0);
  };

  const handleEnrichmentSave = (domain, overrides) => {
    const success = saveEnrichmentOverride(domain, overrides);
    if (success) {
      setEnrichmentOverrides(getAllEnrichmentOverrides());
    }
    return success;
  };

  const handleDeleteCompany = (domain) => {
    const success = hideCompany(domain);
    if (success) {
      setHiddenCompanies(getHiddenCompanies());
      setSelected(null);
    }
    return success;
  };

  // ── Pipeline handlers ──
  const handleSelectOpp = (opp) => {
    setSelectedOpp(opp);
    setIsCreatingOpp(false);
  };

  const handleCreateOpp = (stage) => {
    setNewOppStage(stage || "New");
    setSelectedOpp(null);
    setIsCreatingOpp(true);
  };

  const handleOppSaved = () => {
    setSelectedOpp(null);
    setIsCreatingOpp(false);
    setKanbanKey(k => k + 1); // refresh kanban
  };

  const handleOppDeleted = () => {
    setSelectedOpp(null);
    setKanbanKey(k => k + 1); // refresh kanban
  };

  // ── Prospects handlers ──
  const handleSelectProspect = (p) => {
    setSelectedProspect(p);
    setIsCreatingProspect(false);
  };

  const handleCreateProspect = (stage) => {
    setNewProspectStage(stage || "Lead");
    setSelectedProspect(null);
    setIsCreatingProspect(true);
  };

  const handleProspectSaved = () => {
    setSelectedProspect(null);
    setIsCreatingProspect(false);
    setProspectsKey(k => k + 1);
  };

  const handleProspectDeleted = () => {
    setSelectedProspect(null);
    setProspectsKey(k => k + 1);
  };

  const handleProspectConverted = () => {
    setSelectedProspect(null);
    setIsCreatingProspect(false);
    setProspectsKey(k => k + 1);
    // Also refresh Pipeline kanban in case user switches
    setKanbanKey(k => k + 1);
  };

  const subtitle = employees.length === 1
    ? `Red de contactos · ${employees[0].name}`
    : `${employees.length} buzones · ${companies.length} empresas`;

  return (
    <div style={{ minHeight: "100vh", background: "#F7F9FC" }}>
      {/* ── Nav (White) ── */}
      <div style={{
        padding: "0 24px", background: "#FFFFFF",
        borderBottom: "1px solid #E2E8F0",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, flexWrap: "wrap", minHeight: 57,
      }}>
        {/* Left: Logo + Title + Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={alter5Logo} alt="Alter5" style={{ height: 32 }} />
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

          {/* View tabs */}
          <div style={{
            display: "flex", gap: 0, marginLeft: 16,
            background: "#F1F5F9", borderRadius: 8, padding: 3,
          }}>
            {[
              { id: "empresas", label: "Empresas" },
              { id: "prospects", label: "Prospects", badge: "PR" },
              { id: "pipeline", label: "Pipeline", badge: "AT" },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                style={{
                  padding: "6px 18px", borderRadius: 6, border: "none",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                  fontFamily: "inherit", transition: "all 0.15s ease",
                  background: activeView === tab.id ? "#FFFFFF" : "transparent",
                  color: activeView === tab.id ? "#1A2B3D" : "#6B7F94",
                  boxShadow: activeView === tab.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {tab.label}
                {tab.badge && (
                  <span style={{
                    marginLeft: 6, fontSize: 8, fontWeight: 800,
                    padding: "1px 5px", borderRadius: 4,
                    background: activeView === tab.id
                      ? (tab.id === "prospects" ? "#8B5CF620" : "#3B82F620")
                      : "#E2E8F040",
                    color: activeView === tab.id
                      ? (tab.id === "prospects" ? "#8B5CF6" : "#3B82F6")
                      : "#94A3B8",
                    textTransform: "uppercase", letterSpacing: "0.5px",
                    verticalAlign: "middle",
                  }}>{tab.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Search + CSV (only in empresas view) */}
        {activeView === "empresas" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Buscar empresa, grupo, tipo..."
              style={{
                width: 260, padding: "7px 14px", borderRadius: 6,
                border: "1px solid #E2E8F0", background: "#F7F9FC",
                color: "#1A2B3D", fontSize: 13, outline: "none",
                fontFamily: "inherit", fontWeight: 400,
              }}
            />
            <button
              onClick={() => downloadCSV(filtered, productMatches)}
              style={{
                padding: "7px 16px", borderRadius: 6, border: "none",
                background: "linear-gradient(135deg, #3B82F6, #10B981)",
                color: "#FFFFFF", fontSize: 12, fontWeight: 700,
                cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
                letterSpacing: "-0.2px",
              }}
            >
              CSV ({filtered.length})
            </button>
            <button
              onClick={() => setShowCerebro(true)}
              style={{
                padding: "7px 16px", borderRadius: 6, border: "none",
                background: "linear-gradient(135deg, #8B5CF6, #3B82F6)",
                color: "#FFFFFF", fontSize: 12, fontWeight: 700,
                cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
                letterSpacing: "-0.2px", display: "flex", alignItems: "center", gap: 6,
              }}
            >
              &#129504; Cerebro
            </button>
          </div>
        )}
      </div>

      {/* ── Content area ── */}
      {activeView === "empresas" ? (
        /* ── Empresas view ── */
        <div style={{ display: "flex" }}>
          {/* Sidebar */}
          <Sidebar
            companies={companies} employees={employees}
            selEmployees={selEmployees} setSelEmployees={setSelEmployees}
            selGroups={selGroups} setSelGroups={setSelGroups}
            selTypes={selTypes} setSelTypes={setSelTypes}
            selStatus={selStatus} setSelStatus={setSelStatus}
            selProduct={selProduct} setSelProduct={setSelProduct}
            selMarketRoles={selMarketRoles} setSelMarketRoles={setSelMarketRoles}
            selPipeline={selPipeline} setSelPipeline={setSelPipeline}
            productMatches={productMatches}
            setPage={setPage}
          />

          {/* Main */}
          <div style={{ flex: 1, overflow: "auto", maxHeight: "calc(100vh - 57px)" }}>
            {/* KPIs */}
            <div style={{
              padding: "16px 20px",
              display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10,
            }}>
              <KPI label="Total empresas" value={stats.total} sub={`${filtered.length} filtradas`} />
              <KPI label="Activas" value={stats.active} accent="#10B981" sub="< 6 meses"
                onClick={() => handleKpiClick("active")} active={selStatus.length === 1 && selStatus[0] === "active"} />
              <KPI label="Dormidas" value={stats.dormant} accent="#F59E0B" sub="6-18 meses"
                onClick={() => handleKpiClick("dormant")} active={selStatus.length === 1 && selStatus[0] === "dormant"} />
              <KPI label="Perdidas" value={stats.lost} accent="#EF4444" sub="> 18 meses"
                onClick={() => handleKpiClick("lost")} active={selStatus.length === 1 && selStatus[0] === "lost"} />
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
              {filtered.length} empresas · Pagina {page + 1}/{totalPages || 1}
            </div>

            {/* Table */}
            <CompanyTable
              companies={paginated}
              sortBy={sortBy} sortDir={sortDir} onSort={handleSort}
              onSelect={setSelected} selected={selected}
              page={page} totalPages={totalPages} setPage={setPage}
              productMatches={productMatches}
            />
          </div>
        </div>
      ) : activeView === "prospects" ? (
        /* ── Prospects (Kanban) view ── */
        <ProspectsView
          key={prospectsKey}
          onSelectProspect={handleSelectProspect}
          onCreateProspect={handleCreateProspect}
        />
      ) : (
        /* ── Pipeline (Kanban) view ── */
        <KanbanView
          key={kanbanKey}
          onSelectOpportunity={handleSelectOpp}
          onCreateOpportunity={handleCreateOpp}
        />
      )}

      {/* ── Company Detail overlay (empresas view) ── */}
      {activeView === "empresas" && selected && (
        <>
          <div onClick={() => setSelected(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.35)", zIndex: 99 }}
          />
          <DetailPanel
            company={selected}
            onClose={() => setSelected(null)}
            onDelete={handleDeleteCompany}
            onEnrichmentSave={handleEnrichmentSave}
            productMatches={productMatches}
          />
        </>
      )}

      {/* ── Opportunity Panel (pipeline view) ── */}
      {(selectedOpp || isCreatingOpp) && (
        <>
          <div onClick={() => { setSelectedOpp(null); setIsCreatingOpp(false); }}
            style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.35)", zIndex: 99 }}
          />
          <OpportunityPanel
            opportunity={selectedOpp}
            isNew={isCreatingOpp}
            initialStage={newOppStage}
            onClose={() => { setSelectedOpp(null); setIsCreatingOpp(false); }}
            onSaved={handleOppSaved}
            onDeleted={handleOppDeleted}
          />
        </>
      )}

      {/* ── Prospect Panel (prospects view) ── */}
      {(selectedProspect || isCreatingProspect) && (
        <ProspectPanel
          prospect={selectedProspect}
          isNew={isCreatingProspect}
          initialStage={newProspectStage}
          onClose={() => { setSelectedProspect(null); setIsCreatingProspect(false); }}
          onSaved={handleProspectSaved}
          onDeleted={handleProspectDeleted}
          onConverted={handleProspectConverted}
        />
      )}

      {/* ── Cerebro AI overlay ── */}
      {showCerebro && (
        <CerebroSearch
          companies={companies}
          onClose={() => setShowCerebro(false)}
          onSelectCompany={(company) => {
            setShowCerebro(false);
            setSelected(company);
          }}
        />
      )}
    </div>
  );
}
