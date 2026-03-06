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
import UserSelector from './components/UserSelector';
import CampaignsView from './components/CampaignsView';
import CampaignCreationPanel from './components/CampaignCreationPanel';
import CampaignDetailView from './components/CampaignDetailView';
import BridgeCampaignView from './components/BridgeCampaignView';
import FollowUpQuickPanel from './components/FollowUpQuickPanel';
import { getCampaigns } from './utils/campaignApi';
import { getHiddenCompanies, hideCompany, getAllEnrichmentOverrides, saveEnrichmentOverride, isSuspiciousCompany } from './utils/companyData';
import { fetchAllVerified, saveVerification, invalidateVerifiedCache } from './utils/airtableVerified';
import { getCurrentUser } from './utils/userConfig';
import CleanupToolbar from './components/CleanupToolbar';
import blocklist from './data/blocklist.json';

export default function App() {
  const allCompanies = useMemo(() => parseCompanies(), []);
  const [hiddenCompanies, setHiddenCompanies] = useState(() => getHiddenCompanies());
  const [enrichmentOverrides, setEnrichmentOverrides] = useState(() => getAllEnrichmentOverrides());
  const [verifiedCompanies, setVerifiedCompanies] = useState(new Map());

  // Load verified companies from Airtable on mount
  useEffect(() => {
    fetchAllVerified()
      .then(map => setVerifiedCompanies(map))
      .catch(() => {});
  }, []);

  // ── User identity ──
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser());
  const [showUserSelector, setShowUserSelector] = useState(false);

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

  // ── Campaigns state ──
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState(null);
  const [showCampaignCreation, setShowCampaignCreation] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [selectedCampaignName, setSelectedCampaignName] = useState(null);
  const [showFollowUpQuick, setShowFollowUpQuick] = useState(null); // prospect obj or null

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
    } else if (view === "campanas") {
      setActiveView("campanas");
    }
  }, []);

  // ── Lazy load campaigns when tab is active ──
  useEffect(() => {
    if (activeView === "campanas" && campaigns.length === 0 && !campaignsLoading) {
      loadCampaigns();
    }
  }, [activeView]);

  async function loadCampaigns() {
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const campData = await getCampaigns();
      setCampaigns(campData.campaigns || []);
    } catch (err) {
      console.error('[Campaigns] loadCampaigns error:', err);
      setCampaignsError(err.message);
    } finally {
      setCampaignsLoading(false);
    }
  }

  const blockedDomains = useMemo(() => new Set(blocklist.domains || []), []);

  // Filtrar empresas ocultas, bloqueadas, y aplicar enrichment overrides
  const companies = useMemo(() => {
    return allCompanies
      .filter(c => !hiddenCompanies.includes(c.domain))
      .filter(c => !blockedDomains.has(c.domain))
      .map(c => {
        const ov = enrichmentOverrides[c.domain];
        if (!ov) return c;
        const role = ov.role !== undefined ? ov.role : (ov.grp !== undefined ? ov.grp : c.role);
        return {
          ...c,
          role,
          group: role, // alias
          segment: ov.seg !== undefined ? ov.seg : c.segment,
          marketRoles: ov.mr !== undefined ? ov.mr : c.marketRoles,
          companyType: ov.tp2 !== undefined ? ov.tp2 : (ov.tp !== undefined ? ov.tp : c.companyType),
          activities: ov.act !== undefined ? ov.act : c.activities,
          technologies: ov.tech !== undefined ? ov.tech : c.technologies,
          geography: ov.geo !== undefined ? ov.geo : c.geography,
        };
      });
  }, [allCompanies, hiddenCompanies, blockedDomains, enrichmentOverrides]);

  const employees = useMemo(() => getEmployees(companies), [companies]);

  const [search, setSearch] = useState("");
  const [activeEmployeeTab, setActiveEmployeeTab] = useState("all");
  const [selEmployees, setSelEmployees] = useState([]);
  const [selGroups, setSelGroups] = useState([]);     // roles (v2) / groups (legacy alias)
  const [selSegments, setSelSegments] = useState([]);  // Originación segments
  const [selTypes, setSelTypes] = useState([]);
  const [selActivities, setSelActivities] = useState([]); // Corporate Finance activities
  const [selTech, setSelTech] = useState([]);           // Technologies
  const [selStatus, setSelStatus] = useState([]);
  const [selProduct, setSelProduct] = useState("");
  const [selMarketRoles, setSelMarketRoles] = useState([]);
  const [selPipeline, setSelPipeline] = useState("");  // "" | "_any" | stage name
  const [sortBy, setSortBy] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [selected, setSelected] = useState(null);
  const [showCerebro, setShowCerebro] = useState(false);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [cleanupSelection, setCleanupSelection] = useState(new Set());
  const [cleanupFilter, setCleanupFilter] = useState(null); // null | 'suspicious' | 'selected'
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
        c.role.toLowerCase().includes(q) ||
        (c.segment || "").toLowerCase().includes(q) ||
        c.companyType.toLowerCase().includes(q) ||
        c.marketRoles.some(mr => mr.toLowerCase().includes(q))
      );
    }
    if (selEmployees.length) list = list.filter(c => selEmployees.some(e => c.employees.includes(e)));
    if (selGroups.length) list = list.filter(c => selGroups.includes(c.role));
    if (selSegments.length) list = list.filter(c => selSegments.includes(c.segment));
    if (selTypes.length) list = list.filter(c => selTypes.includes(c.companyType));
    if (selActivities.length) list = list.filter(c => selActivities.some(a => c.activities?.includes(a)));
    if (selTech.length) list = list.filter(c => selTech.some(t => c.technologies?.includes(t)));
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

    // Cleanup mode filters
    if (cleanupMode && cleanupFilter === 'suspicious') {
      list = list.filter(c => isSuspiciousCompany(c));
    } else if (cleanupMode && cleanupFilter === 'selected') {
      list = list.filter(c => cleanupSelection.has(c.domain));
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
  }, [companies, activeEmployeeTab, search, selEmployees, selGroups, selSegments, selTypes, selActivities, selTech, selStatus, selMarketRoles, selPipeline, selProduct, productMatches, sortBy, sortDir, cleanupMode, cleanupFilter, cleanupSelection]);

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

      // Also persist to Airtable Verified-Companies (fire-and-forget)
      const company = companies.find(c => c.domain === domain);
      saveVerification(domain, {
        companyName: company?.name || domain,
        role: overrides.role || "",
        segment: overrides.seg || "",
        type: overrides.tp2 || "",
        activities: overrides.act || [],
        technologies: overrides.tech || [],
        geography: overrides.geo || [],
        marketRoles: overrides.mr || [],
        status: "Edited",
        verifiedBy: currentUser?.name || "manual",
      }).then(() => {
        invalidateVerifiedCache();
        fetchAllVerified().then(map => setVerifiedCompanies(map)).catch(() => {});
      }).catch(err => console.warn("Verified save failed:", err));
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

  // ── Cleanup handlers ──
  const handleToggleCleanup = (domain) => {
    setCleanupSelection(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const suspiciousMap = useMemo(() => {
    const map = new Map();
    companies.forEach(c => {
      const reason = isSuspiciousCompany(c);
      if (reason) map.set(c.domain, reason);
    });
    return map;
  }, [companies]);

  const handleSelectSuspicious = () => {
    // Select all suspicious + filter to show only them
    setCleanupSelection(prev => {
      const next = new Set(prev);
      companies.forEach(c => {
        if (isSuspiciousCompany(c)) next.add(c.domain);
      });
      return next;
    });
    setCleanupFilter('suspicious');
    setPage(0);
  };

  const handleSelectPage = () => {
    setCleanupSelection(prev => {
      const next = new Set(prev);
      paginated.forEach(c => next.add(c.domain));
      return next;
    });
  };

  const handleExportBlocklist = () => {
    const existingDomains = new Set(blocklist.domains || []);
    cleanupSelection.forEach(d => existingDomains.add(d));
    const data = {
      domains: [...existingDomains].sort(),
      updatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blocklist.json";
    a.click();
    URL.revokeObjectURL(url);
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
              { id: "campanas", label: "Campañas", badge: "EM" },
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
                      ? (tab.id === "prospects" ? "#8B5CF620" : tab.id === "campanas" ? "#7C3AED20" : "#3B82F620")
                      : "#E2E8F040",
                    color: activeView === tab.id
                      ? (tab.id === "prospects" ? "#8B5CF6" : tab.id === "campanas" ? "#7C3AED" : "#3B82F6")
                      : "#94A3B8",
                    textTransform: "uppercase", letterSpacing: "0.5px",
                    verticalAlign: "middle",
                  }}>{tab.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: User chip + Search + CSV */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* User chip */}
          {currentUser && (
            <button
              onClick={() => setShowUserSelector(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px 5px 6px", borderRadius: 20,
                border: "1px solid #E2E8F0", background: "#F7F9FC",
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.background = "#F7F9FC"; }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: "linear-gradient(135deg, #3B82F6, #10B981)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 800, color: "#FFFFFF",
              }}>
                {currentUser.name.split(' ').map(w => w[0]).join('').toUpperCase()}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1A2B3D" }}>
                {currentUser.name.split(' ')[0]}
              </span>
              {currentUser.isAdmin && (
                <span style={{
                  fontSize: 8, fontWeight: 800, color: "#F59E0B",
                  background: "#FEF3C7", padding: "1px 5px", borderRadius: 4,
                }}>ADMIN</span>
              )}
            </button>
          )}
        </div>

        {/* Search + CSV (only in empresas view) */}
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
            <button
              onClick={() => { setCleanupMode(m => !m); setCleanupSelection(new Set()); setCleanupFilter(null); setPage(0); }}
              style={{
                padding: "7px 16px", borderRadius: 6,
                border: cleanupMode ? "none" : "1px solid #E2E8F0",
                background: cleanupMode
                  ? "linear-gradient(135deg, #EF4444, #F59E0B)"
                  : "#F7F9FC",
                color: cleanupMode ? "#FFFFFF" : "#6B7F94",
                fontSize: 12, fontWeight: 700,
                cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
                letterSpacing: "-0.2px",
              }}
            >
              {cleanupMode ? "Limpieza ON" : "Limpieza"}
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
            selSegments={selSegments} setSelSegments={setSelSegments}
            selTypes={selTypes} setSelTypes={setSelTypes}
            selActivities={selActivities} setSelActivities={setSelActivities}
            selTech={selTech} setSelTech={setSelTech}
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

            {/* Cleanup Toolbar */}
            {cleanupMode && (
              <CleanupToolbar
                selectionCount={cleanupSelection.size}
                filteredCount={filtered.length}
                suspiciousCount={suspiciousMap.size}
                onSelectSuspicious={handleSelectSuspicious}
                onSelectPage={handleSelectPage}
                onClearSelection={() => { setCleanupSelection(new Set()); setCleanupFilter(null); setPage(0); }}
                onExport={handleExportBlocklist}
                onExit={() => { setCleanupMode(false); setCleanupSelection(new Set()); setCleanupFilter(null); setPage(0); }}
                cleanupFilter={cleanupFilter}
                onShowAll={() => { setCleanupFilter(null); setPage(0); }}
                onShowSelected={() => { setCleanupFilter('selected'); setPage(0); }}
              />
            )}

            {/* Table */}
            <CompanyTable
              companies={paginated}
              sortBy={sortBy} sortDir={sortDir} onSort={handleSort}
              onSelect={setSelected} selected={selected}
              page={page} totalPages={totalPages} setPage={setPage}
              productMatches={productMatches}
              cleanupMode={cleanupMode}
              cleanupSelection={cleanupSelection}
              onToggleCleanup={handleToggleCleanup}
              suspiciousMap={suspiciousMap}
              verifiedCompanies={verifiedCompanies}
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
      ) : activeView === "campanas" && selectedCampaignId && selectedCampaignName && selectedCampaignName.toLowerCase().includes('bridge') ? (
        /* ── Bridge Energy Program — full standalone dashboard ── */
        <BridgeCampaignView
          onBack={() => { setSelectedCampaignId(null); setSelectedCampaignName(null); loadCampaigns(); }}
        />
      ) : activeView === "campanas" && selectedCampaignId ? (
        /* ── Generic campaign detail view ── */
        <CampaignDetailView
          campaignId={selectedCampaignId}
          allCompanies={companies}
          onBack={() => { setSelectedCampaignId(null); setSelectedCampaignName(null); loadCampaigns(); }}
        />
      ) : activeView === "campanas" ? (
        /* ── Campaigns list ── */
        <CampaignsView
          campaigns={campaigns}
          loading={campaignsLoading}
          error={campaignsError}
          onRefresh={loadCampaigns}
          onCreateCampaign={() => setShowCampaignCreation(true)}
          onSelectCampaign={(c) => { setSelectedCampaignId(c.id); setSelectedCampaignName(c.name || ''); }}
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
            currentUser={currentUser}
            verifiedCompanies={verifiedCompanies}
            onVerifiedUpdate={() => fetchAllVerified().then(map => setVerifiedCompanies(map)).catch(() => {})}
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

      {/* ── Campaign Creation Panel ── */}
      {showCampaignCreation && (
        <CampaignCreationPanel
          onClose={() => setShowCampaignCreation(false)}
          onCreated={() => { setShowCampaignCreation(false); loadCampaigns(); }}
          allCompanies={companies}
        />
      )}

      {/* ── Follow-up Quick Panel ── */}
      {showFollowUpQuick && (
        <FollowUpQuickPanel
          prospect={showFollowUpQuick}
          onClose={() => setShowFollowUpQuick(null)}
          onScheduled={() => { setShowFollowUpQuick(null); loadCampaigns(); }}
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

      {/* User selector: dropdown when changing */}
      {showUserSelector && (
        <UserSelector
          currentUser={currentUser}
          onSelect={(user) => {
            if (user) setCurrentUser(user);
            setShowUserSelector(false);
          }}
        />
      )}
    </div>
  );
}
