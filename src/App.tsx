import { useState, useMemo, useEffect } from 'react';
import { parseCompanies, getEmployees, downloadCSV, calculateProductMatches, getBestProductMatch } from './utils/data';
import { PER_PAGE, COMPANY_ROLES, TECHNOLOGIES, PRODUCTS, ALL_COMPANY_TYPES, STATUS_LABELS, STATUS_COLORS } from './utils/constants';
import CompanyTable from './components/CompanyTable';
import DetailPanel from './components/DetailPanel';
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
import ProspectingView from './components/ProspectingView';
import CandidateSearchView from './components/CandidateSearchView';
import { AnalysisView } from './components/views/AnalysisView';
import { HelpOverlay } from './components/shared/HelpOverlay';
import { getCampaigns } from './utils/campaignApi';
import { getHiddenCompanies, hideCompany, getAllEnrichmentOverrides, saveEnrichmentOverride, isSuspiciousCompany } from './utils/companyData';
import { fetchAllVerified, saveVerification, invalidateVerifiedCache, verifiedToEnrichmentOverride } from './utils/airtableVerified';
import { getCurrentUser } from './utils/userConfig';
import CleanupToolbar from './components/CleanupToolbar';
import AppShell from './components/layout/AppShell';
import blocklist from './data/blocklist.json';
import type { ViewId } from './types';

export default function App() {
  const allCompanies = useMemo(() => parseCompanies(), []);
  const [hiddenCompanies, setHiddenCompanies] = useState(() => getHiddenCompanies());
  const [enrichmentOverrides, setEnrichmentOverrides] = useState(() => getAllEnrichmentOverrides());
  const [verifiedCompanies, setVerifiedCompanies] = useState(new Map());

  // Load verified companies from Airtable on mount and auto-apply as enrichment overrides
  useEffect(() => {
    fetchAllVerified()
      .then(map => {
        setVerifiedCompanies(map);
        // Auto-apply verified/mismatch classifications as localStorage overrides
        let applied = 0;
        const currentOverrides = getAllEnrichmentOverrides();
        for (const [domain, v] of map) {
          // Only apply if the record has a role and is a mismatch or has verified/edited status
          if (!v.role) continue;
          const dominated = v.status === "Verified" || v.status === "Edited";
          const pendingMismatch = v.status === "Pending Review" && v.mismatch;
          if (!dominated && !pendingMismatch) continue;
          // Skip if user already has a manual override (don't overwrite their edits)
          if (currentOverrides[domain]?.updatedAt) continue;
          const override = verifiedToEnrichmentOverride(v);
          if (override) {
            saveEnrichmentOverride(domain, override);
            applied++;
          }
        }
        if (applied > 0) {
          console.log(`[Verified] Auto-applied ${applied} verified classifications`);
          setEnrichmentOverrides(getAllEnrichmentOverrides());
        }
      })
      .catch(() => {});
  }, []);

  // ── User identity ──
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser());
  const [showUserSelector, setShowUserSelector] = useState(false);

  // ── View state ──
  const [activeView, setActiveView] = useState<ViewId>("empresas");

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
  const [showHelp, setShowHelp] = useState(false);

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

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '/' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setShowHelp(h => !h); }
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setShowCerebro(true); }
      if (e.key === 'Escape') { setShowHelp(false); setShowCerebro(false); setSelected(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Lazy load campaigns when tab is active ──
  useEffect(() => {
    if (activeView === "campanas" && campaigns.length === 0 && !campaignsLoading) {
      loadCampaigns();
    }
  }, [activeView, campaigns.length, campaignsLoading]);

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
        const role = (ov.role !== undefined ? ov.role : (ov.grp !== undefined ? ov.grp : c.role)) || c.role || "No relevante";
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
  const [showFilters, setShowFilters] = useState(false);
  const [bulkSelection, setBulkSelection] = useState(new Set());
  const [showBulkHideConfirm, setShowBulkHideConfirm] = useState(false);
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
        (c.role || "").toLowerCase().includes(q) ||
        (c.segment || "").toLowerCase().includes(q) ||
        (c.companyType || "").toLowerCase().includes(q) ||
        (c.marketRoles || []).some(mr => mr.toLowerCase().includes(q))
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

  // ── Bulk selection handlers ──
  const handleToggleBulkSelect = (domain) => {
    setBulkSelection(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const handleSelectAllPage = () => {
    setBulkSelection(prev => {
      const allOnPage = paginated.map(c => c.domain);
      const allSelected = allOnPage.every(d => prev.has(d));
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all on page
        allOnPage.forEach(d => next.delete(d));
      } else {
        // Select all on page
        allOnPage.forEach(d => next.add(d));
      }
      return next;
    });
  };

  const handleBulkHide = () => {
    if (bulkSelection.size === 0) return;
    bulkSelection.forEach(domain => hideCompany(domain));
    setHiddenCompanies(getHiddenCompanies());
    setBulkSelection(new Set());
    setShowBulkHideConfirm(false);
    setSelected(null);
    setPage(0);
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

  // ── View change handler (also handles Bridge sub-views) ──
  const handleViewChange = (view: ViewId) => {
    // Bridge campaigns is a sub-view of campanas in the SideNav
    if (view === 'bridge-campaigns') {
      setActiveView('campanas');
      // Simulate selecting a bridge campaign
      setSelectedCampaignId('bridge');
      setSelectedCampaignName('Bridge Energy Program');
      return;
    }
    setActiveView(view);
    // Reset campaign sub-navigation when leaving campanas
    if (view !== 'campanas') {
      setSelectedCampaignId(null);
      setSelectedCampaignName(null);
    }
  };

  return (
    <AppShell
      activeView={activeView}
      onViewChange={handleViewChange}
      search={search}
      onSearchChange={(val) => { setSearch(val); setPage(0); }}
      onOpenCerebro={() => setShowCerebro(true)}
      onExportCSV={() => downloadCSV(filtered, productMatches)}
      filteredCount={filtered.length}
      cleanupMode={cleanupMode}
      onToggleCleanup={() => { setCleanupMode(m => !m); setCleanupSelection(new Set()); setCleanupFilter(null); setPage(0); }}
      currentUser={currentUser}
      onOpenSettings={() => setShowUserSelector(true)}
      subtitle={subtitle}
    >
      {/* ── Content area ── */}
      {activeView === "empresas" ? (
        <div style={{ height: `calc(100vh - 60px)`, overflow: "auto", background: "#F0F4F8" }}>
          {/* ── Toolbar: Search + Filtros + Export + Cerebro ── */}
          <div style={{ padding: "18px 28px 0", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {/* Search */}
            <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
              <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                placeholder="Buscar empresa..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                style={{
                  width: "100%", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 8,
                  padding: "8px 12px 8px 32px", fontSize: 13, color: "#0F172A", outline: "none",
                  boxSizing: "border-box" as const, fontFamily: "'DM Sans', sans-serif",
                }}
              />
            </div>

            {/* Filtros toggle */}
            <button
              onClick={() => setShowFilters(f => !f)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: showFilters ? "#1E293B" : "#FFFFFF",
                border: showFilters ? "none" : "1px solid #E2E8F0",
                borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 500,
                color: showFilters ? "#FFFFFF" : "#475569",
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.15s ease",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Filtros
              {(() => {
                const count = selGroups.length + selTypes.length + selTech.length + selStatus.length + (selProduct ? 1 : 0);
                return count > 0 ? (
                  <span style={{
                    background: showFilters ? "#3B82F6" : "#3B82F6",
                    color: "#FFFFFF", fontSize: 10, fontWeight: 700,
                    borderRadius: 10, minWidth: 18, height: 18,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    padding: "0 5px",
                  }}>{count}</span>
                ) : null;
              })()}
            </button>

            {/* Exportar CSV */}
            <button onClick={() => downloadCSV(filtered, productMatches)} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 500, color: "#3B82F6", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Exportar
            </button>

            {/* Cerebro AI */}
            <button onClick={() => setShowCerebro(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg, #7C3AED, #4F46E5)", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#FFFFFF", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 2px 8px rgba(124,58,237,0.3)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
              Cerebro AI
            </button>

            {/* Spacer + count */}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#94A3B8", whiteSpace: "nowrap" }}>{filtered.length} empresas</span>
          </div>

          {/* ── Filter Dropdown Panel ── */}
          {showFilters && (
            <div style={{
              margin: "10px 28px 0", padding: "16px 20px",
              background: "#FFFFFF", borderRadius: 12,
              border: "1px solid #E2E8F0",
              boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
            }}>
              {/* Active filters summary + clear */}
              {(selGroups.length > 0 || selTypes.length > 0 || selTech.length > 0 || selStatus.length > 0 || selProduct) && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #F1F5F9" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>Activos:</span>
                    {selGroups.map(g => (
                      <span key={g} onClick={() => { setSelGroups(prev => prev.filter(x => x !== g)); setPage(0); }}
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#FEF3C7", color: "#92400E", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {g} <span style={{ fontSize: 9, opacity: 0.6 }}>x</span>
                      </span>
                    ))}
                    {selTypes.map(t => (
                      <span key={t} onClick={() => { setSelTypes(prev => prev.filter(x => x !== t)); setPage(0); }}
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#EDE9FE", color: "#5B21B6", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {t} <span style={{ fontSize: 9, opacity: 0.6 }}>x</span>
                      </span>
                    ))}
                    {selTech.map(t => (
                      <span key={t} onClick={() => { setSelTech(prev => prev.filter(x => x !== t)); setPage(0); }}
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#E0F2FE", color: "#075985", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {t} <span style={{ fontSize: 9, opacity: 0.6 }}>x</span>
                      </span>
                    ))}
                    {selStatus.map(s => (
                      <span key={s} onClick={() => { setSelStatus(prev => prev.filter(x => x !== s)); setPage(0); }}
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: STATUS_COLORS[s] + "20", color: STATUS_COLORS[s], fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {(STATUS_LABELS as any)[s]} <span style={{ fontSize: 9, opacity: 0.6 }}>x</span>
                      </span>
                    ))}
                    {selProduct && (
                      <span onClick={() => { setSelProduct(""); setPage(0); }}
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#DBEAFE", color: "#1D4ED8", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {PRODUCTS.find(p => p.id === selProduct)?.name || selProduct} <span style={{ fontSize: 9, opacity: 0.6 }}>x</span>
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => { setSelGroups([]); setSelTypes([]); setSelTech([]); setSelStatus([]); setSelProduct(""); setPage(0); }}
                    style={{ fontSize: 11, color: "#94A3B8", background: "none", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap", fontFamily: "'DM Sans', sans-serif" }}
                  >Limpiar todo</button>
                </div>
              )}

              {/* Filter rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Rol */}
                <FilterRow label="Rol">
                  {COMPANY_ROLES.map(r => {
                    const active = selGroups.includes(r.id);
                    const count = companies.filter(c => c.role === r.id).length;
                    return (
                      <FilterPill key={r.id} active={active} color={r.color}
                        onClick={() => { setSelGroups(prev => prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id]); setPage(0); }}>
                        {r.label} <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>{count}</span>
                      </FilterPill>
                    );
                  })}
                </FilterRow>

                {/* Tipo */}
                <FilterRow label="Tipo">
                  {ALL_COMPANY_TYPES.filter(t => {
                    // Only show types that have at least 1 company
                    return companies.some(c => c.companyType === t);
                  }).map(t => {
                    const active = selTypes.includes(t);
                    const count = companies.filter(c => c.companyType === t).length;
                    return (
                      <FilterPill key={t} active={active} color="#8B5CF6"
                        onClick={() => { setSelTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]); setPage(0); }}>
                        {t} <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>{count}</span>
                      </FilterPill>
                    );
                  })}
                </FilterRow>

                {/* Tecnología */}
                <FilterRow label="Tecnología">
                  {TECHNOLOGIES.map(t => {
                    const active = selTech.includes(t.id);
                    const count = companies.filter(c => c.technologies?.includes(t.id)).length;
                    return (
                      <FilterPill key={t.id} active={active} color="#0EA5E9"
                        onClick={() => { setSelTech(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id]); setPage(0); }}>
                        {t.icon} {t.label} <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>{count}</span>
                      </FilterPill>
                    );
                  })}
                </FilterRow>

                {/* Estado */}
                <FilterRow label="Estado">
                  {(["active", "dormant", "lost"] as const).map(s => {
                    const active = selStatus.includes(s);
                    const count = companies.filter(c => c.status === s).length;
                    return (
                      <FilterPill key={s} active={active} color={STATUS_COLORS[s]}
                        onClick={() => { setSelStatus(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]); setPage(0); }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLORS[s], display: "inline-block", flexShrink: 0 }} />
                        {(STATUS_LABELS as any)[s]} <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>{count}</span>
                      </FilterPill>
                    );
                  })}
                </FilterRow>

                {/* Producto */}
                <FilterRow label="Producto">
                  {PRODUCTS.map(p => {
                    const active = selProduct === p.id;
                    let count = 0;
                    for (const c of companies) {
                      const matches = productMatches?.get(c.idx) || [];
                      if (matches.some((m: any) => m.id === p.id && m.score >= 15)) count++;
                    }
                    return (
                      <FilterPill key={p.id} active={active} color={p.color}
                        onClick={() => { setSelProduct(prev => prev === p.id ? "" : p.id); setPage(0); }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: active ? "#FFFFFF" : p.color, display: "inline-block", flexShrink: 0 }} />
                        {p.name} <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>{count}</span>
                      </FilterPill>
                    );
                  })}
                </FilterRow>
              </div>
            </div>
          )}

          {/* KPI Row */}
          <div style={{ display: "flex", gap: 14, padding: "18px 28px 0", flexShrink: 0 }}>
            <KpiCard value={stats.total.toLocaleString('es-ES')} label="Total empresas" sub="en base de datos" color="#3B82F6" onClick={() => { setSelStatus([]); setPage(0); }} />
            <KpiCard value={stats.active.toLocaleString('es-ES')} label="Activas" sub="ultimos 6 meses" color="#10B981" onClick={() => handleKpiClick("active")} active={selStatus.length === 1 && selStatus[0] === "active"} />
            <KpiCard value={stats.dormant.toLocaleString('es-ES')} label="Dormidas" sub="6-18 meses" color="#F59E0B" onClick={() => handleKpiClick("dormant")} active={selStatus.length === 1 && selStatus[0] === "dormant"} />
            <KpiCard value={stats.lost.toLocaleString('es-ES')} label="Perdidas" sub="mas de 18 meses" color="#EF4444" onClick={() => handleKpiClick("lost")} active={selStatus.length === 1 && selStatus[0] === "lost"} />
            <KpiCard value={String(stats.avgScore)} label="Score medio" sub="de 100 posibles" color="#8B5CF6" />
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
            page={page} totalPages={totalPages} setPage={setPage} filteredCount={filtered.length}
            productMatches={productMatches}
            cleanupMode={cleanupMode}
            cleanupSelection={cleanupSelection}
            onToggleCleanup={handleToggleCleanup}
            suspiciousMap={suspiciousMap}
            verifiedCompanies={verifiedCompanies}
            bulkSelection={bulkSelection}
            onToggleBulkSelect={handleToggleBulkSelect}
            onSelectAllPage={handleSelectAllPage}
            onBulkHide={() => setShowBulkHideConfirm(true)}
            onClearBulkSelection={() => setBulkSelection(new Set())}
          />
        </div>
      ) : activeView === "prospects" ? (
        <ProspectsView
          key={prospectsKey}
          onSelectProspect={handleSelectProspect}
          onCreateProspect={handleCreateProspect}
          companies={companies}
        />
      ) : activeView === "campanas" && selectedCampaignId && selectedCampaignName && selectedCampaignName.toLowerCase().includes('bridge') ? (
        <BridgeCampaignView
          allCompanies={companies}
          onBack={() => { setSelectedCampaignId(null); setSelectedCampaignName(null); loadCampaigns(); }}
        />
      ) : activeView === "campanas" && selectedCampaignId ? (
        <CampaignDetailView
          campaignId={selectedCampaignId}
          allCompanies={companies}
          onBack={() => { setSelectedCampaignId(null); setSelectedCampaignName(null); loadCampaigns(); }}
        />
      ) : activeView === "campanas" ? (
        <CampaignsView
          campaigns={campaigns}
          loading={campaignsLoading}
          error={campaignsError}
          onRefresh={loadCampaigns}
          onCreateCampaign={() => setShowCampaignCreation(true)}
          onSelectCampaign={(c) => { setSelectedCampaignId(c.id); setSelectedCampaignName(c.name || ''); }}
        />
      ) : activeView === "prospeccion" ? (
        <ProspectingView currentUser={currentUser} />
      ) : activeView === "candidates" ? (
        <CandidateSearchView
          allCompanies={companies}
        />
      ) : activeView === "analysis" ? (
        <AnalysisView />
      ) : activeView === "structuring" ? (
        <PlaceholderView title="Structuring" description="Gestion de estructuracion de deals en curso." icon="FileText" />
      ) : activeView === "distribution" ? (
        <PlaceholderView title="Distribution" description="Distribucion y sindicacion de operaciones." icon="Send" />
      ) : activeView === "closing" ? (
        <PlaceholderView title="Closing" description="Gestion de cierre de operaciones." icon="CheckCircle2" />
      ) : (
        <KanbanView
          key={kanbanKey}
          onSelectOpportunity={handleSelectOpp}
          onCreateOpportunity={handleCreateOpp}
        />
      )}

      {/* ── Company Detail overlay ── */}
      {activeView === "empresas" && selected && (
        <>
          <div onClick={() => setSelected(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.5)", zIndex: 99, backdropFilter: "blur(4px)" }}
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

      {/* ── Opportunity Panel ── */}
      {(selectedOpp || isCreatingOpp) && (
        <>
          <div onClick={() => { setSelectedOpp(null); setIsCreatingOpp(false); }}
            style={{ position: "fixed", inset: 0, background: "rgba(10,22,40,0.5)", zIndex: 99, backdropFilter: "blur(4px)" }}
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

      {/* ── Prospect Panel ── */}
      {(selectedProspect || isCreatingProspect) && (
        <ProspectPanel
          prospect={selectedProspect}
          isNew={isCreatingProspect}
          initialStage={newProspectStage}
          onClose={() => { setSelectedProspect(null); setIsCreatingProspect(false); }}
          onSaved={handleProspectSaved}
          onDeleted={handleProspectDeleted}
          onConverted={handleProspectConverted}
          companies={companies}
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

      {/* ── User selector ── */}
      {showUserSelector && (
        <UserSelector
          currentUser={currentUser}
          onSelect={(user) => {
            if (user) setCurrentUser(user);
            setShowUserSelector(false);
          }}
        />
      )}

      {/* ── Help overlay ── */}
      {showHelp && (
        <HelpOverlay isOpen={showHelp} onClose={() => setShowHelp(false)} />
      )}

      {/* ── Bulk Hide Confirmation Modal ── */}
      {showBulkHideConfirm && (
        <>
          <div
            onClick={() => setShowBulkHideConfirm(false)}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(10,22,40,0.7)", zIndex: 200,
              backdropFilter: "blur(4px)",
            }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: "#0A1628", borderRadius: 14, padding: 28,
            maxWidth: 480, width: "90%",
            border: "1px solid #1B3A5C",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            zIndex: 201,
          }}>
            <div style={{
              fontSize: 20, fontWeight: 800, color: "#FFFFFF",
              marginBottom: 12, display: "flex", alignItems: "center", gap: 10,
            }}>
              Confirmar ocultacion masiva
            </div>
            <p style={{
              fontSize: 14, color: "#94A3B8", lineHeight: 1.6, marginBottom: 8,
            }}>
              Vas a ocultar <strong style={{ color: "#FFFFFF" }}>{bulkSelection.size}</strong> empresa{bulkSelection.size !== 1 ? "s" : ""} de la vista.
            </p>
            <p style={{
              fontSize: 12, color: "#6B7F94", lineHeight: 1.5, marginBottom: 20,
            }}>
              Las empresas desapareceran de la tabla pero no se eliminan permanentemente. Se pueden restaurar desde localStorage.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowBulkHideConfirm(false)}
                style={{
                  background: "#132238", border: "1px solid #1B3A5C",
                  color: "#94A3B8", padding: "10px 20px", borderRadius: 8,
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkHide}
                style={{
                  background: "#EF4444", border: "none",
                  color: "#FFFFFF", padding: "10px 20px", borderRadius: 8,
                  fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Ocultar {bulkSelection.size} empresa{bulkSelection.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

/* ── Filter helpers ── */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.08em",
        textTransform: "uppercase" as const, width: 80, flexShrink: 0, paddingTop: 6,
        fontFamily: "'DM Sans', sans-serif",
      }}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{children}</div>
    </div>
  );
}

function FilterPill({ children, active, color, onClick }: {
  children: React.ReactNode; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
      fontFamily: "'DM Sans', sans-serif", transition: "all 0.12s ease",
      display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1.4,
      whiteSpace: "nowrap" as const,
      fontWeight: active ? 600 : 400,
      border: active ? "none" : "1px solid #E2E8F0",
      background: active ? color : "#FFFFFF",
      color: active ? "#FFFFFF" : "#64748B",
    }}>
      {children}
    </button>
  );
}

function KpiCard({ value, label, sub, color, onClick, active }: {
  value: string; label: string; sub: string; color: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <div onClick={onClick} style={{
      flex: 1, background: "#FFFFFF", borderRadius: 12, padding: "16px 18px",
      boxShadow: active ? `0 0 0 2px ${color}40` : "0 2px 6px rgba(0,0,0,0.05)",
      borderTop: `3px solid ${color}`, cursor: onClick ? "pointer" : "default",
      transition: "box-shadow 0.15s ease",
    }}>
      <div style={{ fontSize: 22, fontWeight: 600, color: "#0F172A", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: "#94A3B8" }}>{sub}</div>
    </div>
  );
}

function PlaceholderView({ title, description }: { title: string; description: string; icon?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "calc(100vh - 60px)", background: "#F0F4F8", gap: 12 }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
      </div>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#0F172A", fontFamily: "'DM Sans', sans-serif" }}>{title}</h2>
      <p style={{ margin: 0, fontSize: 14, color: "#64748B", maxWidth: 400, textAlign: "center" }}>{description}</p>
      <span style={{ fontSize: 11, color: "#94A3B8", background: "#E2E8F0", padding: "4px 12px", borderRadius: 6, fontWeight: 500 }}>Proximamente</span>
    </div>
  );
}
