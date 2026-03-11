import { useState, useEffect } from 'react';
import { Badge, StatusBadge, ScoreBar, SectionLabel } from './UI';
import { getCompanyDataByDomain, saveCompanyData, qualifyCountry, qualifyCompanySize, getCompanyContacts, saveCompanyContacts, getAllEnrichmentOverrides, canHideCompany } from '../utils/companyData';
import { COUNTRIES, COMPANY_SIZES, COMPANY_ROLES, COMPANY_TYPES, ORIGINACION_SEGMENTS, COMPANY_TYPES_V2, CORPORATE_ACTIVITIES, TECHNOLOGIES, ASSET_PHASES, GEOGRAPHIES, COMMERCIAL_PHASES, MARKET_ROLES, PRODUCTS } from '../utils/constants';
import { saveVerification, invalidateVerifiedCache } from '../utils/airtableVerified';
import { isGeminiConfigured } from '../utils/gemini';

/** Priority rank for sorting: lower = higher priority */
function contactPriorityRank(role) {
  const r = (role || "").toLowerCase().trim();
  if (/\bceo\b|\bcfo\b/.test(r)) return 1;
  if (r.includes("financiaci") && r.includes("estructurada")) return 2;
  if (/\bm&a\b|\bm\s*&\s*a\b/.test(r)) return 3;
  if (!r || r === "no identificado") return 5;
  return 4;
}

/** Priority info for display: rank, label, accent color */
function contactPriorityInfo(role) {
  const r = (role || "").toLowerCase().trim();
  if (/\bceo\b|\bcfo\b/.test(r))
    return { rank: 1, label: "CEO / CFO", color: "#F59E0B" };
  if (r.includes("financiaci") && r.includes("estructurada"))
    return { rank: 2, label: "Fin. Estructurada", color: "#3B82F6" };
  if (/\bm&a\b|\bm\s*&\s*a\b/.test(r))
    return { rank: 3, label: "M&A", color: "#10B981" };
  if (!r || r === "no identificado")
    return { rank: 5, label: "Cargo desconocido", color: "#6B7F94" };
  return { rank: 4, label: role, color: "#94A3B8" };
}

export default function DetailPanel({ company, onClose, onDelete, onEnrichmentSave, productMatches, currentUser, verifiedCompanies, onVerifiedUpdate }) {
  if (!company) return null;
  const c = company;
  const det = c.detail;

  // Tab state
  const [activeTab, setActiveTab] = useState('resumen');
  const [expandedSubject, setExpandedSubject] = useState(null);

  // Estado para datos manuales
  const [manualData, setManualData] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Estado para edición de contactos
  const [isEditingContacts, setIsEditingContacts] = useState(false);
  const [editedContacts, setEditedContacts] = useState([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', role: '', email: '' });

  // Estado para edición de clasificación (taxonomy v2)
  const [isEditingEnrichment, setIsEditingEnrichment] = useState(false);
  const [editedMR, setEditedMR] = useState([]);
  const [editedRole, setEditedRole] = useState('');
  const [editedSegment, setEditedSegment] = useState('');
  const [editedType, setEditedType] = useState('');
  const [editedActivities, setEditedActivities] = useState([]);
  const [editedTech, setEditedTech] = useState([]);
  const [editedGeo, setEditedGeo] = useState([]);
  const [editedAssetPhase, setEditedAssetPhase] = useState('');
  const [editedCommPhase, setEditedCommPhase] = useState('');
  // Verification state
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [verificationError, setVerificationError] = useState(null);
  const [verifyCooldown, setVerifyCooldown] = useState(false);

  // Legacy alias for backward compat in rest of file
  const editedGroup = editedRole;
  const setEditedGroup = setEditedRole;
  // Cargar datos al abrir el panel
  useEffect(() => {
    if (c.domain) {
      setActiveTab('resumen');
      setExpandedSubject(null);

      const data = getCompanyDataByDomain(c.domain);
      setManualData(data);
      setEditedData(data);

      const savedContacts = getCompanyContacts(c.domain);
      setEditedContacts(savedContacts || (det?.contacts || []));

      setEditedMR(c.marketRoles || []);
      setEditedRole(c.role || c.group || '');
      setEditedSegment(c.segment || '');
      setEditedType(c.companyType || '');
      setEditedActivities(c.activities || []);
      setEditedTech(c.technologies || []);
      setEditedGeo(c.geography || []);
      setEditedAssetPhase(c.assetPhase || '');
      setEditedCommPhase(c.commercialPhase || '');
      setIsEditingEnrichment(false);
      setVerificationResult(null);
      setVerificationError(null);
      setIsVerifying(false);
    }
  }, [c.domain, det?.contacts, c.marketRoles, c.role, c.group, c.companyType, c.segment, c.activities, c.technologies, c.geography, c.assetPhase, c.commercialPhase]);

  const qualifiedCountry = qualifyCountry(c);
  const qualifiedSize = qualifyCompanySize(c);

  const handleSave = () => {
    const success = saveCompanyData(c.domain, editedData);
    if (success) {
      setManualData(editedData);
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditedData(manualData);
    setIsEditing(false);
  };

  const updateField = (field, value) => {
    setEditedData(prev => ({ ...prev, [field]: value }));
  };

  // Handlers para contactos
  const handleSaveContacts = () => {
    const success = saveCompanyContacts(c.domain, editedContacts);
    if (success) {
      setIsEditingContacts(false);
      setShowAddContact(false);
      setNewContact({ name: '', role: '', email: '' });
    }
  };

  const handleCancelContactsEdit = () => {
    const savedContacts = getCompanyContacts(c.domain);
    setEditedContacts(savedContacts || (det?.contacts || []));
    setIsEditingContacts(false);
    setShowAddContact(false);
    setNewContact({ name: '', role: '', email: '' });
  };

  const handleAddContact = () => {
    if (newContact.name.trim()) {
      setEditedContacts(prev => [...prev, { ...newContact }]);
      setNewContact({ name: '', role: '', email: '' });
      setShowAddContact(false);
    }
  };

  const handleUpdateContact = (index, field, value) => {
    setEditedContacts(prev => prev.map((ct, i) =>
      i === index ? { ...ct, [field]: value } : ct
    ));
  };

  const handleDeleteContact = (index) => {
    setEditedContacts(prev => prev.filter((_, i) => i !== index));
  };

  // Handlers para clasificación (taxonomy v2)
  const handleSaveEnrichment = () => {
    if (onEnrichmentSave) {
      const success = onEnrichmentSave(c.domain, {
        role: editedRole,
        seg: editedSegment,
        tp2: editedType,
        act: editedActivities,
        tech: editedTech,
        geo: editedGeo,
        mr: editedMR,
        // Legacy compat
        grp: editedRole,
        tp: editedType,
      });
      if (success) setIsEditingEnrichment(false);
    }
  };

  const handleCancelEnrichment = () => {
    setEditedMR(c.marketRoles || []);
    setEditedRole(c.role || c.group || '');
    setEditedSegment(c.segment || '');
    setEditedType(c.companyType || '');
    setEditedActivities(c.activities || []);
    setEditedTech(c.technologies || []);
    setEditedGeo(c.geography || []);
    setEditedAssetPhase(c.assetPhase || '');
    setEditedCommPhase(c.commercialPhase || '');
    setIsEditingEnrichment(false);
  };

  const toggleMarketRole = (roleId) => {
    setEditedMR(prev =>
      prev.includes(roleId) ? prev.filter(r => r !== roleId) : [...prev, roleId]
    );
  };

  // Get verification status for this company
  const verifiedRecord = verifiedCompanies?.get?.(c.domain) || null;
  const verificationStatus = verifiedRecord?.status || null;

  // Verify company using Gemini + Google Search grounding (browser-side)
  const handleVerify = async () => {
    setIsVerifying(true);
    setVerificationError(null);
    setVerificationResult(null);

    const apiKey = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      setVerificationError("VITE_GEMINI_API_KEY no configurada");
      setIsVerifying(false);
      return;
    }

    // Build current classification summary
    const currRole = c.role || c.group || "Sin clasificar";
    const currSeg = c.segment || "";
    const currType = c.companyType || "";
    const currMR = (c.marketRoles || []).join(", ");

    // Build email context from subjects
    const subjects = (det?.subjects || []).slice(0, 15).join(" | ");
    const datedSubjects = (det?.datedSubjects || []).slice(0, 5).map(ds => ds.extract || ds.subject || "").filter(Boolean).join(" // ");

    const prompt = `Eres un analista de verificacion de Alter5, consultora de financiacion de energias renovables.

TAREA: Verificar la clasificacion de "${c.name || c.domain}" (dominio: ${c.domain}).

CLASIFICACION ACTUAL: Role=${currRole}${currSeg ? `, Segment=${currSeg}` : ""}${currType ? `, Type=${currType}` : ""}${currMR ? `, MarketRoles=[${currMR}]` : ""}

CONTEXTO DE EMAILS: [${subjects}]
${datedSubjects ? `EXTRACTOS: [${datedSubjects.slice(0, 1500)}]` : ""}

INSTRUCCIONES:
1. BUSCA en internet que hace realmente esta empresa
2. DISTINGUE entre "lo que la empresa ES" (su negocio real) y "de que habla con Alter5"
3. Compara con la clasificacion actual

TAXONOMIA:
- Role: ["Originacion", "Inversion", "Services", "No relevante"]
- Segment Originacion: ["Project Finance", "Corporate Finance"]
- Segment Inversion: ["Deuda", "Equity"]
- Types Inversion>Deuda: ["Fondo de deuda", "Banco", "Bonista / Institucional"]
- Types Inversion>Equity: ["Fondo de infraestructura", "Private equity", "Fondo renovable", "IPP comprador", "Utility compradora"]
- Types Originacion>PF: ["Developer", "IPP", "Developer + IPP"]
- Types Services: ["Asesor legal", "Asesor tecnico", "Consultor de precios", "Asset manager", "Ingenieria", "Asesor financiero", "Asociacion / Institucion"]
- Market Roles: ["Borrower", "Seller (M&A)", "Buyer Investor (M&A)", "Debt Investor", "Equity Investor", "Partner & Services"]

FORMATO (JSON valido, sin markdown):
{"company_description": "...", "web_sources": "...", "verified_role": "...", "verified_segment": "...", "verified_type": "...", "verified_market_roles": [...], "mismatch": true/false, "mismatch_explanation": "...", "confidence": "alta|media|baja"}`;

    try {
      const GEMINI_MODEL = "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.2 },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Parse JSON from response
      let cleaned = rawText.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      // Try to find JSON object in text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];

      const result = JSON.parse(cleaned);
      setVerificationResult(result);
    } catch (err) {
      console.error("Verification failed:", err);
      setVerificationError(err.message?.includes("JSON") ? "Respuesta invalida de IA — intenta de nuevo" : (err.message || "Error desconocido"));
    } finally {
      setIsVerifying(false);
      // Rate limit: 30s cooldown between verifications
      setVerifyCooldown(true);
      setTimeout(() => setVerifyCooldown(false), 30000);
    }
  };

  // Accept verification result and apply it
  const handleAcceptVerification = async () => {
    if (!verificationResult) return;

    const v = verificationResult;

    // Map to enrichment fields
    const overrides = {
      role: v.verified_role || editedRole,
      seg: v.verified_segment || "",
      tp2: v.verified_type || "",
      act: editedActivities,
      tech: editedTech,
      geo: editedGeo,
      mr: v.verified_market_roles || editedMR,
      grp: v.verified_role || editedRole,
      tp: v.verified_type || editedType,
    };

    // Save to localStorage via parent handler
    if (onEnrichmentSave) {
      onEnrichmentSave(c.domain, overrides);
    }

    // Also save verification details to Airtable
    try {
      await saveVerification(c.domain, {
        companyName: c.name || c.domain,
        previousClassification: `${c.role || ""}${c.segment ? " > " + c.segment : ""}${c.companyType ? " > " + c.companyType : ""}`,
        role: v.verified_role || "",
        segment: v.verified_segment || "",
        type: v.verified_type || "",
        marketRoles: v.verified_market_roles || [],
        webDescription: v.company_description || "",
        webSources: v.web_sources || "",
        status: "Verified",
        verifiedBy: currentUser?.name || "manual",
        mismatch: v.mismatch || false,
        notes: v.mismatch_explanation || "",
      });
      invalidateVerifiedCache();
      if (onVerifiedUpdate) onVerifiedUpdate();
    } catch (err) {
      console.warn("Failed to save verification to Airtable:", err);
    }

    // Update local UI state
    setEditedRole(v.verified_role || editedRole);
    setEditedSegment(v.verified_segment || "");
    setEditedType(v.verified_type || "");
    if (v.verified_market_roles?.length) setEditedMR(v.verified_market_roles);
    setVerificationResult(null);
  };

  // Types available for the selected role + segment
  const availableTypes = (() => {
    if (editedRole === "Originación") {
      if (editedSegment === "Project Finance") return COMPANY_TYPES_V2["Originación > Project Finance"] || [];
      if (editedSegment === "Corporate Finance") return COMPANY_TYPES_V2["Originación > Corporate Finance"] || [];
      return [...(COMPANY_TYPES_V2["Originación > Project Finance"] || [])];
    }
    if (editedRole === "Inversión") return [...(COMPANY_TYPES_V2["Inversión > Deuda"] || []), ...(COMPANY_TYPES_V2["Inversión > Equity"] || [])];
    if (editedRole === "Services") return COMPANY_TYPES_V2["Services"] || [];
    // Legacy fallback
    return COMPANY_TYPES[editedRole] || COMPANY_TYPES[editedGroup] || [];
  })();

  // Get group color
  const roleDef = COMPANY_ROLES.find(g => g.id === c.role) || COMPANY_ROLES.find(g => g.id === c.group);
  const groupColor = roleDef?.color || "#94A3B8";

  return (
    <div className="slide-in" style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 720, maxWidth: "100vw",
      background: "#0A1628", zIndex: 100,
      overflow: "auto", boxShadow: "-12px 0 40px rgba(10,22,40,0.4)",
    }}>
      <div style={{ padding: 28 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{
              margin: 0, fontSize: 26, fontWeight: 800, color: "#FFFFFF",
              letterSpacing: "-1px", lineHeight: 1.2,
            }}>{c.name}</h2>
            <div style={{ fontSize: 14, color: "#6B7F94", marginTop: 6, fontWeight: 400 }}>{c.domain}</div>
          </div>
          <button onClick={onClose} style={{
            background: "#132238", border: "1px solid #1B3A5C", color: "#6B7F94",
            width: 36, height: 36, borderRadius: 8, cursor: "pointer", fontSize: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#1B3A5C";
            e.currentTarget.style.color = "#FFFFFF";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#132238";
            e.currentTarget.style.color = "#6B7F94";
          }}
          >✕</button>
        </div>

        {/* Tags */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
          <StatusBadge status={c.status} />
          {/* Group badge */}
          <span style={{
            padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: groupColor + "20", color: groupColor, border: `1px solid ${groupColor}40`,
          }}>{c.group}</span>
          {/* Type badge */}
          {c.companyType && (
            <span style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: "#8B5CF620", color: "#A78BFA", border: "1px solid #8B5CF640",
            }}>{c.companyType}</span>
          )}
          {/* Market role badges */}
          {c.marketRoles?.map((role, i) => {
            const mrDef = MARKET_ROLES.find(m => m.id === role);
            const col = mrDef?.color || "#6B7F94";
            return (
              <span key={`mr${i}`} style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: col + "20", color: col, border: `1px solid ${col}40`,
              }}>{role}</span>
            );
          })}
          {/* Airtable pipeline badge */}
          {c.opportunity && (
            <span style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: "#8B5CF620", color: "#A78BFA", border: "1px solid #8B5CF640",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              <span style={{ fontSize: 9 }}>AT</span>
              {c.opportunity.stage}
            </span>
          )}
        </div>

        {/* Tab Bar */}
        <div style={{
          display: "flex", gap: 0, marginBottom: 20,
          borderBottom: "1px solid #1B3A5C",
        }}>
          {[
            { id: 'resumen', label: 'Resumen' },
            { id: 'timeline', label: 'Timeline' },
            { id: 'detalles', label: 'Detalles' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid #3B82F6" : "2px solid transparent",
                color: activeTab === tab.id ? "#FFFFFF" : "#6B7F94",
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 700 : 600,
                padding: "10px 18px",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) e.currentTarget.style.color = "#94A3B8";
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) e.currentTarget.style.color = "#6B7F94";
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══ TAB: Resumen ═══ */}
        {activeTab === 'resumen' && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Company Type */}
            {c.companyType && (
              <SummaryRow label="Tipo de empresa" value={c.companyType} />
            )}

            {/* Market Roles */}
            {c.marketRoles?.length > 0 && (
              <div style={{
                background: "#132238", borderRadius: 10, padding: "12px 16px",
                border: "1px solid #1B3A5C",
              }}>
                <div style={{
                  fontSize: 9, color: "#6B7F94", textTransform: "uppercase",
                  letterSpacing: "1.5px", fontWeight: 700, marginBottom: 8,
                }}>Market Roles</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {c.marketRoles.map((role, i) => {
                    const mrDef = MARKET_ROLES.find(m => m.id === role);
                    const col = mrDef?.color || "#6B7F94";
                    return (
                      <span key={i} style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: col + "20", color: col, border: `1px solid ${col}40`,
                      }}>{role}</span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Contactos (solo nombres) */}
            {editedContacts.length > 0 && (
              <SummaryRow
                label="Contactos"
                value={editedContacts.map(ct => ct.name).join(", ")}
              />
            )}

            {/* Total Interacciones */}
            <SummaryRow label="Total interacciones" value={c.interactions.toLocaleString()} />

            {/* Airtable Pipeline */}
            {c.opportunity && (
              <div style={{
                background: "#132238", borderRadius: 10, padding: "12px 16px",
                border: "1px solid #8B5CF640",
              }}>
                <div style={{
                  fontSize: 9, color: "#6B7F94", textTransform: "uppercase",
                  letterSpacing: "1.5px", fontWeight: 700, marginBottom: 8,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  Pipeline Airtable
                  <span style={{
                    fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
                    background: "#8B5CF620", color: "#A78BFA",
                  }}>LIVE</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>
                    {c.opportunity.stage}
                  </div>
                  {c.opportunity.amount > 0 && (
                    <div style={{ fontSize: 12, color: "#94A3B8" }}>
                      {c.opportunity.amount.toLocaleString("es-ES")} {c.opportunity.currency}
                    </div>
                  )}
                  {c.opportunity.owner && (
                    <div style={{ fontSize: 11, color: "#6B7F94" }}>
                      {c.opportunity.owner}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Productos IA */}
            {c.productosIA?.length > 0 && (
              <div style={{
                background: "#132238", borderRadius: 10, padding: "12px 16px",
                border: "1px solid #1B3A5C",
              }}>
                <div style={{
                  fontSize: 9, color: "#6B7F94", textTransform: "uppercase",
                  letterSpacing: "1.5px", fontWeight: 700, marginBottom: 8,
                }}>Productos potenciales</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {c.productosIA.map((p, i) => {
                    const confColors = { alta: "#10B981", media: "#F59E0B", baja: "#6B7F94" };
                    const col = confColors[p.c] || "#6B7F94";
                    return (
                      <span key={i} style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: col + "15", color: "#FFFFFF", border: `1px solid ${col}40`,
                      }}>
                        {p.p}
                        <span style={{
                          fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
                          background: col + "30", color: col, textTransform: "uppercase",
                        }}>{p.c}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Senales */}
            {c.senales?.length > 0 && (
              <div style={{
                background: "#132238", borderRadius: 10, padding: "12px 16px",
                border: "1px solid #1B3A5C",
              }}>
                <div style={{
                  fontSize: 9, color: "#6B7F94", textTransform: "uppercase",
                  letterSpacing: "1.5px", fontWeight: 700, marginBottom: 8,
                }}>Senales clave</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {c.senales.map((s, i) => (
                    <span key={i} style={{
                      padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: "#0A1628", color: "#94A3B8", border: "1px solid #1B3A5C",
                    }}>{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Historico trimestral compacto */}
            {det?.timeline?.length > 0 && (
              <SummaryRow
                label="Historico trimestral"
                value={det.timeline.map(t => `${t.quarter}: ${t.emails}`).join(" | ")}
              />
            )}

            {/* Primera / Ultima fecha */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <SummaryRow label="Primera fecha" value={c.firstDate || "—"} />
              <SummaryRow label="Ultima fecha" value={c.lastDate || "—"} />
            </div>

            {/* Resumen de la relacion — cronologico con fechas */}
            {(det?.datedSubjects?.length > 0 || det?.context) && (
              <div style={{
                background: "linear-gradient(135deg, #1B3A5C 0%, #132238 100%)",
                borderRadius: 10, padding: "12px 16px",
                border: "1px solid #2A4A6C",
              }}>
                <div style={{
                  fontSize: 9, color: "#6B7F94", textTransform: "uppercase",
                  letterSpacing: "1.5px", fontWeight: 700, marginBottom: 10,
                }}>Resumen de la relacion</div>
                {det.datedSubjects?.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {[...det.datedSubjects].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((ds, i) => {
                      const isExpanded = expandedSubject === i;
                      const hasExtract = !!ds.extract;
                      return (
                        <div key={i}
                          onClick={() => hasExtract && setExpandedSubject(isExpanded ? null : i)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 6,
                            cursor: hasExtract ? "pointer" : "default",
                            background: isExpanded ? "#0A162840" : "transparent",
                            transition: "background 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (hasExtract && !isExpanded) e.currentTarget.style.background = "#0A162820";
                          }}
                          onMouseLeave={(e) => {
                            if (!isExpanded) e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700, color: "#60A5FA",
                              whiteSpace: "nowrap", minWidth: 80,
                              fontFamily: "'DM Sans', monospace",
                            }}>{ds.date}</span>
                            <span style={{
                              fontSize: 12, color: "#FFFFFF", fontWeight: 400, lineHeight: 1.5,
                              flex: 1,
                            }}>{ds.subject}</span>
                            {hasExtract && (
                              <span style={{
                                fontSize: 10, color: "#475569", flexShrink: 0,
                                transition: "transform 0.15s ease",
                                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                              }}>▼</span>
                            )}
                          </div>
                          {isExpanded && ds.extract && (
                            <div style={{
                              marginTop: 8, marginLeft: 90, padding: "10px 12px",
                              background: "#0A1628", borderRadius: 6,
                              border: "1px solid #1B3A5C",
                              fontSize: 12, color: "#94A3B8", lineHeight: 1.6,
                              fontWeight: 400,
                            }}>{ds.extract}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{
                    fontSize: 13, color: "#FFFFFF", lineHeight: 1.7, margin: 0, fontWeight: 400,
                  }}>{det.context}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: Timeline ═══ */}
        {activeTab === 'timeline' && (
          <div>
            {/* Timeline table */}
            {det?.timeline?.length > 0 ? (
              <>
                <div style={{
                  background: "#132238", borderRadius: 12, padding: 18,
                  marginBottom: 20, border: "1px solid #1B3A5C",
                }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Trimestre", "Emails", "Resumen"].map(h => (
                          <th key={h} style={{
                            textAlign: "left", fontSize: 9, color: "#6B7F94",
                            textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700,
                            padding: "8px 10px", borderBottom: "1px solid #1B3A5C",
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...det.timeline].reverse().map((t, i) => (
                        <tr key={i} style={{
                          borderBottom: "1px solid #0A1628",
                        }}>
                          <td style={{
                            padding: "10px", fontSize: 12, fontWeight: 700,
                            color: "#FFFFFF", whiteSpace: "nowrap", width: 80,
                          }}>{t.quarter}</td>
                          <td style={{
                            padding: "10px", fontSize: 12, fontWeight: 600,
                            color: "#60A5FA", width: 60, textAlign: "center",
                          }}>{t.emails}</td>
                          <td style={{
                            padding: "10px", fontSize: 12, color: t.summary ? "#94A3B8" : "#475569",
                            fontStyle: t.summary ? "normal" : "italic", lineHeight: 1.5,
                          }}>{t.summary || "Sin resumen"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Bar chart (reused from existing) */}
                <div style={{
                  marginBottom: 20, background: "#132238", borderRadius: 12,
                  padding: 18, border: "1px solid #1B3A5C",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <span style={{ fontSize: 20 }}>📈</span>
                    <DarkSectionTitle style={{ marginBottom: 0 }}>
                      Historico de interacciones
                    </DarkSectionTitle>
                    <span style={{
                      marginLeft: "auto", fontSize: 11, color: "#6B7F94", fontWeight: 600,
                    }}>{det.timeline.length} trimestres</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {det.timeline.map((t, i) => {
                      const maxE = Math.max(...det.timeline.map(x => x.emails));
                      const pct = (t.emails / maxE) * 100;
                      const isRecent = i < 3;
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
                          <span style={{
                            width: 70, fontSize: 12,
                            color: isRecent ? "#FFFFFF" : "#6B7F94",
                            fontFamily: "'DM Sans', monospace",
                            fontWeight: isRecent ? 700 : 600,
                          }}>{t.quarter}</span>
                          <div style={{
                            flex: 1, height: 20, background: "#0A1628",
                            borderRadius: 6, overflow: "hidden", position: "relative",
                          }}>
                            <div style={{
                              height: "100%", width: `${pct}%`,
                              background: isRecent
                                ? "linear-gradient(90deg, #10B981, #059669)"
                                : "linear-gradient(90deg, #3B82F6, #2563EB)",
                              borderRadius: 6, transition: "width 0.3s ease",
                            }} />
                            {t.emails > 0 && (
                              <span style={{
                                position: "absolute", right: 8, top: "50%",
                                transform: "translateY(-50%)", fontSize: 10, fontWeight: 700,
                                color: pct > 30 ? "#FFFFFF" : "#94A3B8",
                              }}>{t.emails} emails</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{
                    marginTop: 12, padding: 12, background: "#0A1628", borderRadius: 8,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <div>
                      <div style={{ fontSize: 9, color: "#6B7F94", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700 }}>
                        Total historico
                      </div>
                      <div style={{ fontSize: 18, color: "#FFFFFF", fontWeight: 800, marginTop: 2 }}>
                        {det.timeline.reduce((sum, t) => sum + t.emails, 0).toLocaleString()} emails
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#6B7F94", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700 }}>
                        Promedio trimestral
                      </div>
                      <div style={{ fontSize: 18, color: "#10B981", fontWeight: 800, marginTop: 2 }}>
                        {Math.round(det.timeline.reduce((sum, t) => sum + t.emails, 0) / det.timeline.length)} emails
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{
                background: "#132238", borderRadius: 12, padding: 30,
                border: "1px solid #1B3A5C", textAlign: "center",
              }}>
                <span style={{ fontSize: 11, color: "#6B7F94", fontWeight: 600 }}>
                  Sin datos de timeline para esta empresa
                </span>
              </div>
            )}

            {/* Per-employee breakdown */}
            {det?.sources?.length > 1 && (
              <div style={{
                background: "#132238", borderRadius: 12, padding: 18, border: "1px solid #1B3A5C",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <span style={{ fontSize: 20 }}>📊</span>
                  <DarkSectionTitle style={{ marginBottom: 0 }}>
                    Interacciones por buzon
                  </DarkSectionTitle>
                </div>
                {det.sources.map((s, i) => {
                  const maxS = Math.max(...det.sources.map(x => x.interactions));
                  const empName = s.employee.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
                  const pct = (s.interactions / maxS) * 100;
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 12, marginBottom: 10, padding: "8px 0",
                    }}>
                      <span style={{
                        width: 140, fontSize: 12, color: "#FFFFFF", fontWeight: 600,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{empName}</span>
                      <div style={{
                        flex: 1, height: 18, background: "#0A1628",
                        borderRadius: 6, overflow: "hidden", position: "relative",
                      }}>
                        <div style={{
                          height: "100%", width: `${pct}%`,
                          background: "linear-gradient(90deg, #3B82F6, #10B981)",
                          borderRadius: 6, transition: "width 0.3s ease",
                        }} />
                        {s.interactions > 0 && (
                          <span style={{
                            position: "absolute", right: 8, top: "50%",
                            transform: "translateY(-50%)", fontSize: 10, fontWeight: 700,
                            color: pct > 30 ? "#FFFFFF" : "#94A3B8",
                          }}>{s.interactions.toLocaleString()} emails</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: Detalles ═══ */}
        {activeTab === 'detalles' && (<>
        {/* Clasificación — Editable */}
        <div style={{
          background: "#132238", borderRadius: 12, padding: 18,
          marginBottom: 20, border: isEditingEnrichment ? "2px solid #8B5CF6" : "1px solid #1B3A5C",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
          }}>
            <span style={{ fontSize: 16 }}>🏷️</span>
            <DarkSectionTitle style={{ marginBottom: 0, color: isEditingEnrichment ? "#A78BFA" : "#6B7F94" }}>
              Clasificación
            </DarkSectionTitle>
            <span style={{ flex: 1 }} />
            {!isEditingEnrichment ? (
              <button
                onClick={() => setIsEditingEnrichment(true)}
                style={{
                  background: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
                  border: "none", color: "#FFFFFF",
                  padding: "5px 10px", borderRadius: 6,
                  fontSize: 10, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                ✏️ Editar
              </button>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={handleCancelEnrichment}
                  style={{
                    background: "#1B3A5C", border: "1px solid #2A4A6C",
                    color: "#94A3B8", padding: "5px 10px", borderRadius: 6,
                    fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveEnrichment}
                  style={{
                    background: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
                    border: "none", color: "#FFFFFF",
                    padding: "5px 10px", borderRadius: 6,
                    fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  💾 Guardar
                </button>
              </div>
            )}
          </div>

          {/* Role & Segment */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <DarkFieldLabel>Role</DarkFieldLabel>
              {isEditingEnrichment ? (
                <DarkSelect value={editedRole} onChange={(e) => {
                  setEditedRole(e.target.value);
                  setEditedSegment('');
                  setEditedType('');
                  setEditedActivities([]);
                }}>
                  <option value="">Sin clasificar</option>
                  {COMPANY_ROLES.map(g => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </DarkSelect>
              ) : (
                <span style={{
                  fontSize: 13, fontWeight: 600,
                  color: c.role ? groupColor : "#475569",
                  fontStyle: c.role ? "normal" : "italic",
                }}>{c.role || "Sin clasificar"}</span>
              )}
            </div>
            <div>
              <DarkFieldLabel>Segmento</DarkFieldLabel>
              {isEditingEnrichment ? (
                editedRole === "Originación" ? (
                  <DarkSelect value={editedSegment} onChange={(e) => {
                    setEditedSegment(e.target.value);
                    setEditedType('');
                    setEditedActivities([]);
                  }}>
                    <option value="">Sin segmento</option>
                    {ORIGINACION_SEGMENTS.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </DarkSelect>
                ) : (
                  <span style={{ fontSize: 12, color: "#475569", fontStyle: "italic" }}>N/A</span>
                )
              ) : (
                <span style={{
                  fontSize: 13, fontWeight: 600,
                  color: c.segment ? "#A78BFA" : "#475569",
                  fontStyle: c.segment ? "normal" : "italic",
                }}>{c.segment || "—"}</span>
              )}
            </div>
          </div>

          {/* Type */}
          {availableTypes.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <DarkFieldLabel>Tipo</DarkFieldLabel>
              {isEditingEnrichment ? (
                <DarkSelect value={editedType} onChange={(e) => setEditedType(e.target.value)}>
                  <option value="">Sin tipo</option>
                  {availableTypes.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </DarkSelect>
              ) : (
                <span style={{
                  fontSize: 13, fontWeight: 600,
                  color: c.companyType ? "#A78BFA" : "#475569",
                  fontStyle: c.companyType ? "normal" : "italic",
                }}>{c.companyType || "Sin tipo"}</span>
              )}
            </div>
          )}

          {/* Activities (Corporate Finance) */}
          {(editedRole === "Originación" && editedSegment === "Corporate Finance") && isEditingEnrichment && (
            <div style={{ marginBottom: 14 }}>
              <DarkFieldLabel>Actividades</DarkFieldLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {CORPORATE_ACTIVITIES.map(act => {
                  const active = editedActivities.includes(act);
                  return (
                    <span key={act} onClick={() => setEditedActivities(prev =>
                      prev.includes(act) ? prev.filter(a => a !== act) : [...prev, act]
                    )} style={{
                      padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                      background: active ? "#F59E0B20" : "#0A1628",
                      color: active ? "#F59E0B" : "#475569",
                      border: `1px solid ${active ? "#F59E0B40" : "#1B3A5C"}`,
                      cursor: "pointer", userSelect: "none",
                    }}>{act}</span>
                  );
                })}
              </div>
            </div>
          )}
          {/* Show activities read-only */}
          {!isEditingEnrichment && c.activities?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <DarkFieldLabel>Actividades</DarkFieldLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {c.activities.map(act => (
                  <span key={act} style={{
                    padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                    background: "#F59E0B20", color: "#F59E0B", border: "1px solid #F59E0B40",
                  }}>{act}</span>
                ))}
              </div>
            </div>
          )}

          {/* Technologies */}
          <div style={{ marginBottom: 14 }}>
            <DarkFieldLabel>Tecnología</DarkFieldLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {TECHNOLOGIES.map(t => {
                const active = isEditingEnrichment
                  ? editedTech.includes(t.id)
                  : (c.technologies || []).includes(t.id);
                return (
                  <span key={t.id} onClick={isEditingEnrichment ? () => setEditedTech(prev =>
                    prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id]
                  ) : undefined} style={{
                    padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600,
                    background: active ? "#3B82F620" : "#0A1628",
                    color: active ? "#60A5FA" : "#475569",
                    border: `1px solid ${active ? "#3B82F640" : "#1B3A5C"}`,
                    cursor: isEditingEnrichment ? "pointer" : "default",
                    userSelect: "none", opacity: isEditingEnrichment && !active ? 0.6 : 1,
                  }}>{t.icon} {t.label}</span>
                );
              })}
            </div>
          </div>

          {/* Geography */}
          {isEditingEnrichment && (
            <div style={{ marginBottom: 14 }}>
              <DarkFieldLabel>Geografía</DarkFieldLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {GEOGRAPHIES.map(g => {
                  const active = editedGeo.includes(g);
                  return (
                    <span key={g} onClick={() => setEditedGeo(prev =>
                      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
                    )} style={{
                      padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                      background: active ? "#10B98120" : "#0A1628",
                      color: active ? "#10B981" : "#475569",
                      border: `1px solid ${active ? "#10B98140" : "#1B3A5C"}`,
                      cursor: "pointer", userSelect: "none",
                    }}>{g}</span>
                  );
                })}
              </div>
            </div>
          )}
          {!isEditingEnrichment && c.geography?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <DarkFieldLabel>Geografía</DarkFieldLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {c.geography.map(g => (
                  <span key={g} style={{
                    padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                    background: "#10B98120", color: "#10B981", border: "1px solid #10B98140",
                  }}>{g}</span>
                ))}
              </div>
            </div>
          )}

          {/* Market Roles */}
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 9, color: "#6B7F94", textTransform: "uppercase",
              letterSpacing: "1.5px", fontWeight: 700, marginBottom: 8,
            }}>Market Roles</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MARKET_ROLES.map(mr => {
                const active = isEditingEnrichment
                  ? editedMR.includes(mr.id)
                  : (c.marketRoles || []).includes(mr.id);
                return (
                  <span
                    key={mr.id}
                    onClick={isEditingEnrichment ? () => toggleMarketRole(mr.id) : undefined}
                    style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                      background: active ? mr.color + "20" : "#0A1628",
                      color: active ? mr.color : "#475569",
                      border: `1px solid ${active ? mr.color + "40" : "#1B3A5C"}`,
                      cursor: isEditingEnrichment ? "pointer" : "default",
                      opacity: isEditingEnrichment && !active ? 0.6 : 1,
                      transition: "all 0.15s ease",
                      userSelect: "none",
                    }}
                  >
                    {mr.label}
                  </span>
                );
              })}
            </div>
          </div>

        </div>

        {/* ═══ Verification Section ═══ */}
        <div style={{
          background: "#132238", borderRadius: 12, padding: 18,
          marginBottom: 20,
          border: verificationStatus === "Verified" ? "1px solid #10B98140"
            : verificationStatus === "Edited" ? "1px solid #8B5CF640"
            : verificationResult?.mismatch ? "1px solid #EF444440"
            : "1px solid #1B3A5C",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 16 }}>
              {verificationStatus === "Verified" || verificationStatus === "Edited" ? "\u2705" : "\uD83D\uDD0D"}
            </span>
            <DarkSectionTitle style={{ marginBottom: 0 }}>
              Verificacion
            </DarkSectionTitle>
            <span style={{ flex: 1 }} />

            {/* Status badge */}
            {verificationStatus && (
              <span style={{
                padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                background: verificationStatus === "Verified" ? "#10B98120"
                  : verificationStatus === "Edited" ? "#8B5CF620"
                  : verificationStatus === "Pending Review" ? "#F59E0B20"
                  : "#EF444420",
                color: verificationStatus === "Verified" ? "#10B981"
                  : verificationStatus === "Edited" ? "#8B5CF6"
                  : verificationStatus === "Pending Review" ? "#F59E0B"
                  : "#EF4444",
                border: `1px solid ${
                  verificationStatus === "Verified" ? "#10B98140"
                  : verificationStatus === "Edited" ? "#8B5CF640"
                  : verificationStatus === "Pending Review" ? "#F59E0B40"
                  : "#EF444440"
                }`,
              }}>
                {verificationStatus}
              </span>
            )}

            {/* Verify button */}
            <button
              onClick={handleVerify}
              disabled={isVerifying || verifyCooldown}
              style={{
                background: (isVerifying || verifyCooldown)
                  ? "#1B3A5C"
                  : "linear-gradient(135deg, #F59E0B, #D97706)",
                border: "none", color: (isVerifying || verifyCooldown) ? "#6B7F94" : "#FFFFFF",
                padding: "5px 12px", borderRadius: 6,
                fontSize: 10, fontWeight: 700,
                cursor: (isVerifying || verifyCooldown) ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: (isVerifying || verifyCooldown) ? 0.7 : 1,
              }}
            >
              {isVerifying ? "Verificando..." : verifyCooldown ? "Espera..." : "Verificar"}
            </button>
          </div>

          {/* Verified web description (from Airtable) */}
          {verifiedRecord?.webDescription && !verificationResult && (
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              background: "#0A1628", border: "1px solid #1B3A5C",
              marginBottom: 10,
            }}>
              <div style={{ fontSize: 9, color: "#6B7F94", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700, marginBottom: 6 }}>
                Descripcion web
              </div>
              <p style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.6, margin: 0 }}>
                {verifiedRecord.webDescription}
              </p>
              {verifiedRecord.verifiedAt && (
                <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>
                  Verificado por {verifiedRecord.verifiedBy || "agente"} el {new Date(verifiedRecord.verifiedAt).toLocaleDateString("es-ES")}
                </div>
              )}
            </div>
          )}

          {/* Verification error */}
          {verificationError && (
            <div style={{
              padding: "8px 12px", borderRadius: 6,
              background: "#EF444415", border: "1px solid #EF444430",
              color: "#EF4444", fontSize: 12, marginBottom: 10,
            }}>
              Error: {verificationError}
            </div>
          )}

          {/* Verification result (comparison view) */}
          {verificationResult && (
            <div style={{ marginTop: 4 }}>
              {/* Web description found */}
              <div style={{
                padding: "10px 12px", borderRadius: 8,
                background: "#0A1628", border: "1px solid #1B3A5C",
                marginBottom: 12,
              }}>
                <div style={{ fontSize: 9, color: "#6B7F94", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700, marginBottom: 6 }}>
                  Resultado de verificacion web
                </div>
                <p style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.6, margin: 0 }}>
                  {verificationResult.company_description || "Sin descripcion encontrada"}
                </p>
                {verificationResult.web_sources && (
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>
                    Fuentes: {verificationResult.web_sources}
                  </div>
                )}
              </div>

              {/* Comparison: Current vs Suggested */}
              {verificationResult.mismatch && (
                <div style={{
                  padding: "10px 12px", borderRadius: 8,
                  background: "#EF444410", border: "1px solid #EF444430",
                  marginBottom: 12,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#EF4444", marginBottom: 6 }}>
                    DISCREPANCIA DETECTADA
                  </div>
                  <p style={{ fontSize: 12, color: "#FCA5A5", lineHeight: 1.5, margin: 0 }}>
                    {verificationResult.mismatch_explanation}
                  </p>
                </div>
              )}

              {/* Side-by-side comparison */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div style={{ padding: "8px 10px", borderRadius: 6, background: "#1B3A5C30", border: "1px solid #1B3A5C" }}>
                  <div style={{ fontSize: 9, color: "#6B7F94", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Actual</div>
                  <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.6 }}>
                    <div>Role: <span style={{ color: "#CBD5E1", fontWeight: 600 }}>{c.role || c.group || "?"}</span></div>
                    {c.segment && <div>Seg: <span style={{ color: "#CBD5E1", fontWeight: 600 }}>{c.segment}</span></div>}
                    {c.companyType && <div>Tipo: <span style={{ color: "#CBD5E1", fontWeight: 600 }}>{c.companyType}</span></div>}
                    {(c.marketRoles || []).length > 0 && <div>MR: <span style={{ color: "#CBD5E1", fontWeight: 600 }}>{c.marketRoles.join(", ")}</span></div>}
                  </div>
                </div>
                <div style={{
                  padding: "8px 10px", borderRadius: 6,
                  background: verificationResult.mismatch ? "#F59E0B10" : "#10B98110",
                  border: `1px solid ${verificationResult.mismatch ? "#F59E0B30" : "#10B98130"}`,
                }}>
                  <div style={{ fontSize: 9, color: verificationResult.mismatch ? "#F59E0B" : "#10B981", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Sugerido</div>
                  <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.6 }}>
                    <div>Role: <span style={{ color: "#CBD5E1", fontWeight: 600 }}>{verificationResult.verified_role || "?"}</span></div>
                    {verificationResult.verified_segment && <div>Seg: <span style={{ color: "#CBD5E1", fontWeight: 600 }}>{verificationResult.verified_segment}</span></div>}
                    {verificationResult.verified_type && <div>Tipo: <span style={{ color: "#CBD5E1", fontWeight: 600 }}>{verificationResult.verified_type}</span></div>}
                    {(verificationResult.verified_market_roles || []).length > 0 && <div>MR: <span style={{ color: "#CBD5E1", fontWeight: 600 }}>{verificationResult.verified_market_roles.join(", ")}</span></div>}
                  </div>
                </div>
              </div>

              {/* Confidence */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: "#6B7F94" }}>Confianza:</span>
                <span style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                  background: verificationResult.confidence === "alta" ? "#10B98120" : verificationResult.confidence === "media" ? "#F59E0B20" : "#6B7F9420",
                  color: verificationResult.confidence === "alta" ? "#10B981" : verificationResult.confidence === "media" ? "#F59E0B" : "#6B7F94",
                }}>
                  {verificationResult.confidence || "?"}
                </span>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleAcceptVerification}
                  style={{
                    flex: 1,
                    background: "linear-gradient(135deg, #10B981, #059669)",
                    border: "none", color: "#FFFFFF",
                    padding: "8px 14px", borderRadius: 6,
                    fontSize: 11, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Aceptar sugerencia
                </button>
                <button
                  onClick={() => setVerificationResult(null)}
                  style={{
                    background: "#1B3A5C", border: "1px solid #2A4A6C",
                    color: "#94A3B8", padding: "8px 14px", borderRadius: 6,
                    fontSize: 11, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Descartar
                </button>
              </div>
            </div>
          )}

          {/* No verification yet */}
          {!verificationResult && !verifiedRecord && !verificationError && !isVerifying && (
            <p style={{ fontSize: 11, color: "#475569", margin: 0, fontStyle: "italic" }}>
              Pulsa "Verificar" para buscar en internet que hace realmente esta empresa y validar la clasificacion.
            </p>
          )}
        </div>

        {/* Enrichment: Productos IA & Senales */}
        {(c.productosIA?.length > 0 || c.senales?.length > 0) && (
          <div style={{
            background: "#132238", borderRadius: 12, padding: 18,
            marginBottom: 20, border: "1px solid #8B5CF640",
          }}>
            {c.productosIA?.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>🤖</span>
                  <DarkSectionTitle style={{ marginBottom: 0 }}>Productos IA (Gemini)</DarkSectionTitle>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: c.senales?.length ? 16 : 0 }}>
                  {c.productosIA.map((p, i) => {
                    const confColors = { alta: "#10B981", media: "#F59E0B", baja: "#6B7F94" };
                    const col = confColors[p.c] || "#6B7F94";
                    return (
                      <span key={i} style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: col + "15", color: "#FFFFFF", border: `1px solid ${col}40`,
                      }}>
                        {p.p}
                        <span style={{
                          fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
                          background: col + "30", color: col, textTransform: "uppercase",
                        }}>{p.c}</span>
                      </span>
                    );
                  })}
                </div>
              </>
            )}
            {c.senales?.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>📡</span>
                  <DarkSectionTitle style={{ marginBottom: 0 }}>Senales clave</DarkSectionTitle>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {c.senales.map((s, i) => (
                    <span key={i} style={{
                      padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: "#0A1628", color: "#94A3B8", border: "1px solid #1B3A5C",
                    }}>{s}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Context/Summary */}
        {det?.context && (
          <div style={{
            background: "linear-gradient(135deg, #1B3A5C 0%, #132238 100%)",
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
            border: "1px solid #2A4A6C",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}>
              <span style={{ fontSize: 20 }}>💼</span>
              <DarkSectionTitle style={{ marginBottom: 0, color: "#94A3B8" }}>
                Resumen de la relación
              </DarkSectionTitle>
            </div>
            <p style={{
              fontSize: 14,
              color: "#FFFFFF",
              lineHeight: 1.7,
              margin: 0,
              fontWeight: 400,
            }}>
              {det.context}
            </p>
          </div>
        )}

        {/* Product Matches */}
        <ProductMatchSection companyIdx={c.idx} productMatches={productMatches} />

        {/* Employee sources */}
        {c.employees.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 20 }}>
            {c.employees.map(emp => (
              <span key={emp} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                color: "#60A5FA", background: "#132238", letterSpacing: "0.02em",
                border: "1px solid #1B3A5C",
              }}>
                📧 {emp.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
              </span>
            ))}
          </div>
        )}

        {/* Score */}
        <div style={{
          background: "linear-gradient(135deg, #1B3A5C 0%, #132238 100%)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 20,
          border: "1px solid #2A4A6C",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>⭐</span>
              <span style={{
                fontSize: 12,
                textTransform: "uppercase",
                color: "#94A3B8",
                fontWeight: 700,
                letterSpacing: "2px",
              }}>Score de Prioridad</span>
            </div>
            <div style={{
              background: "linear-gradient(135deg, #3B82F6, #10B981)",
              padding: "8px 20px",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <span style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: "-1.5px",
                color: "#FFFFFF",
              }}>{c.score}</span>
              <span style={{
                fontSize: 12,
                color: "#FFFFFF",
                opacity: 0.8,
              }}>/100</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ScoreBarDark score={c.volScore} max={35} label="Volumen" />
            <ScoreBarDark score={c.recScore} max={30} label="Recencia" />
            <ScoreBarDark score={c.netScore} max={15} label="Red" />
            <ScoreBarDark score={c.groupScore} max={20} label="Grupo" />
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Interacciones", value: c.interactions.toLocaleString(), big: true, icon: "📊" },
            { label: "Contactos", value: c.nContacts, big: true, icon: "👥" },
            { label: "Primera vez", value: c.firstDate, icon: "🗓️" },
            { label: "Último contacto", value: c.lastDate, icon: "📅" },
          ].map((m, i) => (
            <div key={i} style={{
              background: "#132238", borderRadius: 10, padding: "14px 16px",
              border: "1px solid #1B3A5C",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#1B3A5C";
              e.currentTarget.style.borderColor = "#2A4A6C";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#132238";
              e.currentTarget.style.borderColor = "#1B3A5C";
            }}
            >
              <div style={{
                fontSize: 10, color: "#6B7F94", fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "2px",
                marginBottom: 6,
              }}>
                <span style={{ marginRight: 6 }}>{m.icon}</span>
                {m.label}
              </div>
              <div style={{
                fontSize: m.big ? 22 : 15, fontWeight: m.big ? 800 : 600,
                color: "#FFFFFF",
                letterSpacing: m.big ? "-1px" : "0",
              }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Per-employee breakdown */}
        {det?.sources?.length > 1 && (
          <div style={{
            marginBottom: 20,
            background: "#132238",
            borderRadius: 12,
            padding: 18,
            border: "1px solid #1B3A5C",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
            }}>
              <span style={{ fontSize: 20 }}>📊</span>
              <DarkSectionTitle style={{ marginBottom: 0 }}>
                Interacciones por buzón
              </DarkSectionTitle>
            </div>
            {det.sources.map((s, i) => {
              const maxS = Math.max(...det.sources.map(x => x.interactions));
              const empName = s.employee.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
              const pct = (s.interactions / maxS) * 100;

              return (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 10,
                  padding: "8px 0",
                }}>
                  <span style={{
                    width: 140,
                    fontSize: 12,
                    color: "#FFFFFF",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>{empName}</span>
                  <div style={{
                    flex: 1,
                    height: 18,
                    background: "#0A1628",
                    borderRadius: 6,
                    overflow: "hidden",
                    position: "relative",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: "linear-gradient(90deg, #3B82F6, #10B981)",
                      borderRadius: 6,
                      transition: "width 0.3s ease",
                    }} />
                    {s.interactions > 0 && (
                      <span style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: 10,
                        fontWeight: 700,
                        color: pct > 30 ? "#FFFFFF" : "#94A3B8",
                      }}>
                        {s.interactions.toLocaleString()} emails
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Contacts - EDITABLE */}
        {(editedContacts.length > 0 || isEditingContacts) && (
          <div style={{
            marginBottom: 20,
            background: "#132238",
            borderRadius: 12,
            padding: 18,
            border: isEditingContacts ? "2px solid #3B82F6" : "1px solid #1B3A5C",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
            }}>
              <span style={{ fontSize: 20 }}>👤</span>
              <DarkSectionTitle style={{ marginBottom: 0, color: isEditingContacts ? "#60A5FA" : "#6B7F94" }}>
                Contactos clave
              </DarkSectionTitle>
              <span style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "#6B7F94",
                fontWeight: 600,
              }}>
                {editedContacts.length} contactos
              </span>
              {!isEditingContacts ? (
                <button
                  onClick={() => setIsEditingContacts(true)}
                  style={{
                    background: "linear-gradient(135deg, #3B82F6, #10B981)",
                    border: "none",
                    color: "#FFFFFF",
                    padding: "5px 10px",
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  ✏️ Editar
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={handleCancelContactsEdit}
                    style={{
                      background: "#1B3A5C",
                      border: "1px solid #2A4A6C",
                      color: "#94A3B8",
                      padding: "5px 10px",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveContacts}
                    style={{
                      background: "linear-gradient(135deg, #3B82F6, #10B981)",
                      border: "none",
                      color: "#FFFFFF",
                      padding: "5px 10px",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    💾 Guardar
                  </button>
                </div>
              )}
            </div>

            {/* Contact list */}
            {!isEditingContacts ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[...editedContacts]
                  .sort((a, b) => contactPriorityRank(a.role) - contactPriorityRank(b.role))
                  .map((ct, i) => {
                    const { rank, label, color } = contactPriorityInfo(ct.role);
                    return (
                      <div key={i} style={{
                        padding: "12px 14px",
                        background: rank <= 3 ? color + "10" : "#0A1628",
                        borderRadius: 8,
                        border: `1px solid ${rank <= 3 ? color + "40" : "#1B3A5C"}`,
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = rank <= 3 ? color + "20" : "#132238";
                        e.currentTarget.style.transform = "translateY(-2px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = rank <= 3 ? color + "10" : "#0A1628";
                        e.currentTarget.style.transform = "translateY(0)";
                      }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                          <span style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: "#FFFFFF",
                            flex: 1,
                            lineHeight: 1.3,
                          }}>{ct.nombre ? <>{ct.nombre} <span style={{ fontWeight: 400 }}>{ct.apellido}</span></> : ct.name}</span>
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.5px",
                            padding: "3px 7px",
                            borderRadius: 4,
                            background: color + "30",
                            color,
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                            marginLeft: 8,
                          }}>{label}</span>
                        </div>
                        <div style={{
                          fontSize: 10,
                          color: "#6B7F94",
                          marginBottom: ct.email ? 4 : 0,
                          fontWeight: 600,
                        }}>
                          {ct.role || "Cargo desconocido"}
                        </div>
                        {ct.email && (
                          <div style={{
                            fontSize: 11,
                            color: "#60A5FA",
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            📧 {ct.email}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {editedContacts.map((ct, i) => (
                  <div key={i} style={{
                    background: "#0A1628",
                    borderRadius: 8,
                    padding: "12px 14px",
                    border: "1px solid #2A4A6C",
                  }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        type="text"
                        value={ct.nombre || ct.name?.split(' ')[0] || ''}
                        onChange={(e) => {
                          handleUpdateContact(i, 'nombre', e.target.value);
                          handleUpdateContact(i, 'name', `${e.target.value} ${ct.apellido || ''}`.trim());
                        }}
                        placeholder="Nombre"
                        style={{
                          flex: 1,
                          background: "#132238",
                          border: "1px solid #2A4A6C",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#FFFFFF",
                          fontSize: 13,
                          fontFamily: "inherit",
                          fontWeight: 600,
                          outline: "none",
                        }}
                      />
                      <input
                        type="text"
                        value={ct.apellido || ct.name?.split(' ').slice(1).join(' ') || ''}
                        onChange={(e) => {
                          handleUpdateContact(i, 'apellido', e.target.value);
                          handleUpdateContact(i, 'name', `${ct.nombre || ''} ${e.target.value}`.trim());
                        }}
                        placeholder="Apellido"
                        style={{
                          flex: 1,
                          background: "#132238",
                          border: "1px solid #2A4A6C",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#FFFFFF",
                          fontSize: 13,
                          fontFamily: "inherit",
                          fontWeight: 400,
                          outline: "none",
                        }}
                      />
                      <button
                        onClick={() => handleDeleteContact(i)}
                        style={{
                          background: "#7F1D1D",
                          border: "1px solid #991B1B",
                          color: "#FCA5A5",
                          padding: "6px 10px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                        title="Eliminar contacto"
                      >
                        🗑️
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        value={ct.role || ''}
                        onChange={(e) => handleUpdateContact(i, 'role', e.target.value)}
                        placeholder="Cargo"
                        style={{
                          flex: 1,
                          background: "#132238",
                          border: "1px solid #2A4A6C",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#94A3B8",
                          fontSize: 12,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                      <input
                        type="email"
                        value={ct.email || ''}
                        onChange={(e) => handleUpdateContact(i, 'email', e.target.value)}
                        placeholder="Email"
                        style={{
                          flex: 1,
                          background: "#132238",
                          border: "1px solid #2A4A6C",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#60A5FA",
                          fontSize: 11,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>
                ))}

                {/* Add new contact */}
                {!showAddContact ? (
                  <button
                    onClick={() => setShowAddContact(true)}
                    style={{
                      background: "#132238",
                      border: "1px dashed #2A4A6C",
                      color: "#60A5FA",
                      padding: "10px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    ➕ Añadir contacto
                  </button>
                ) : (
                  <div style={{
                    background: "#0A1628",
                    borderRadius: 8,
                    padding: "12px 14px",
                    border: "2px solid #10B981",
                  }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        type="text"
                        value={newContact.name}
                        onChange={(e) => setNewContact(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Nombre *"
                        style={{
                          flex: 1,
                          background: "#132238",
                          border: "1px solid #2A4A6C",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#FFFFFF",
                          fontSize: 13,
                          fontFamily: "inherit",
                          fontWeight: 600,
                          outline: "none",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        type="text"
                        value={newContact.role}
                        onChange={(e) => setNewContact(prev => ({ ...prev, role: e.target.value }))}
                        placeholder="Cargo"
                        style={{
                          flex: 1,
                          background: "#132238",
                          border: "1px solid #2A4A6C",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#94A3B8",
                          fontSize: 12,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                      <input
                        type="email"
                        value={newContact.email}
                        onChange={(e) => setNewContact(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="Email"
                        style={{
                          flex: 1,
                          background: "#132238",
                          border: "1px solid #2A4A6C",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#60A5FA",
                          fontSize: 11,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => {
                          setShowAddContact(false);
                          setNewContact({ name: '', role: '', email: '' });
                        }}
                        style={{
                          flex: 1,
                          background: "#1B3A5C",
                          border: "1px solid #2A4A6C",
                          color: "#94A3B8",
                          padding: "6px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleAddContact}
                        disabled={!newContact.name.trim()}
                        style={{
                          flex: 1,
                          background: newContact.name.trim() ? "linear-gradient(135deg, #10B981, #059669)" : "#1B3A5C",
                          border: "none",
                          color: newContact.name.trim() ? "#FFFFFF" : "#6B7F94",
                          padding: "6px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: newContact.name.trim() ? "pointer" : "not-allowed",
                          fontFamily: "inherit",
                        }}
                      >
                        ✅ Añadir
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        {det?.timeline?.length > 0 && (
          <div style={{
            marginBottom: 20,
            background: "#132238",
            borderRadius: 12,
            padding: 18,
            border: "1px solid #1B3A5C",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
            }}>
              <span style={{ fontSize: 20 }}>📈</span>
              <DarkSectionTitle style={{ marginBottom: 0 }}>
                Histórico de interacciones
              </DarkSectionTitle>
              <span style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "#6B7F94",
                fontWeight: 600,
              }}>
                {det.timeline.length} trimestres
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {det.timeline.map((t, i) => {
                const maxE = Math.max(...det.timeline.map(x => x.emails));
                const pct = (t.emails / maxE) * 100;
                const isRecent = i < 3;

                return (
                  <div key={i} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "6px 0",
                  }}>
                    <span style={{
                      width: 70,
                      fontSize: 12,
                      color: isRecent ? "#FFFFFF" : "#6B7F94",
                      fontFamily: "'DM Sans', monospace",
                      fontWeight: isRecent ? 700 : 600,
                    }}>{t.quarter}</span>
                    <div style={{
                      flex: 1,
                      height: 20,
                      background: "#0A1628",
                      borderRadius: 6,
                      overflow: "hidden",
                      position: "relative",
                    }}>
                      <div style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: isRecent
                          ? "linear-gradient(90deg, #10B981, #059669)"
                          : "linear-gradient(90deg, #3B82F6, #2563EB)",
                        borderRadius: 6,
                        transition: "width 0.3s ease",
                      }} />
                      {t.emails > 0 && (
                        <span style={{
                          position: "absolute",
                          right: 8,
                          top: "50%",
                          transform: "translateY(-50%)",
                          fontSize: 10,
                          fontWeight: 700,
                          color: pct > 30 ? "#FFFFFF" : "#94A3B8",
                        }}>
                          {t.emails} emails
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{
              marginTop: 12,
              padding: 12,
              background: "#0A1628",
              borderRadius: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 9, color: "#6B7F94", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700 }}>
                  Total histórico
                </div>
                <div style={{ fontSize: 18, color: "#FFFFFF", fontWeight: 800, marginTop: 2 }}>
                  {det.timeline.reduce((sum, t) => sum + t.emails, 0).toLocaleString()} emails
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#6B7F94", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700 }}>
                  Promedio trimestral
                </div>
                <div style={{ fontSize: 18, color: "#10B981", fontWeight: 800, marginTop: 2 }}>
                  {Math.round(det.timeline.reduce((sum, t) => sum + t.emails, 0) / det.timeline.length)} emails
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Información cualificada */}
        <div style={{
          marginTop: 20, padding: 14, background: "#132238", borderRadius: 10,
          border: "1px solid #1B3A5C", marginBottom: 16,
        }}>
          <DarkSectionTitle>Cualificación automática</DarkSectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <InfoField
              label="País"
              value={COUNTRIES.find(c => c.id === qualifiedCountry)?.label || "Sin clasificar"}
              icon="🌍"
            />
            <InfoField
              label="Tamaño"
              value={COMPANY_SIZES.find(s => s.id === qualifiedSize)?.label || "Sin datos"}
              icon="👥"
            />
          </div>
        </div>

        {/* Manual fields */}
        <div style={{
          marginTop: 0, padding: 14, background: "#132238", borderRadius: 10,
          border: "1px dashed #1B3A5C",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <DarkSectionTitle style={{ marginBottom: 0 }}>Datos manuales</DarkSectionTitle>
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                style={{
                  background: "linear-gradient(135deg, #3B82F6, #10B981)",
                  border: "none",
                  color: "#FFFFFF",
                  padding: "6px 12px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ✏️ Editar
              </button>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={handleCancel}
                  style={{
                    background: "#1B3A5C",
                    border: "1px solid #2A4A6C",
                    color: "#94A3B8",
                    padding: "6px 12px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  style={{
                    background: "linear-gradient(135deg, #3B82F6, #10B981)",
                    border: "none",
                    color: "#FFFFFF",
                    padding: "6px 12px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  💾 Guardar
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <EditableField
              label="Facturación anual"
              value={isEditing ? editedData.revenue : manualData.revenue}
              placeholder="Ej: 5M €, 10M €, 50M €"
              isEditing={isEditing}
              onChange={(v) => updateField('revenue', v)}
            />
            <EditableField
              label="Número de empleados"
              value={isEditing ? editedData.employeesCount : manualData.employeesCount}
              placeholder="Ej: 25, 150, 500"
              isEditing={isEditing}
              type="number"
              onChange={(v) => updateField('employeesCount', v)}
            />
            <SelectField
              label="País (manual)"
              value={isEditing ? editedData.country : manualData.country}
              options={COUNTRIES}
              placeholder="Seleccionar país..."
              isEditing={isEditing}
              onChange={(v) => updateField('country', v)}
            />
            <SelectField
              label="Importancia"
              value={isEditing ? editedData.priority : manualData.priority}
              options={[
                { id: 'high', label: '⭐⭐⭐ Alta' },
                { id: 'medium', label: '⭐⭐ Media' },
                { id: 'low', label: '⭐ Baja' },
              ]}
              placeholder="Seleccionar prioridad..."
              isEditing={isEditing}
              onChange={(v) => updateField('priority', v)}
            />
            <EditableField
              label="Sitio web"
              value={isEditing ? editedData.website : manualData.website}
              placeholder={`https://${c.domain}`}
              isEditing={isEditing}
              isLink={true}
              onChange={(v) => updateField('website', v)}
            />
            <EditableField
              label="LinkedIn"
              value={isEditing ? editedData.linkedin : manualData.linkedin}
              placeholder="https://linkedin.com/company/..."
              isEditing={isEditing}
              onChange={(v) => updateField('linkedin', v)}
            />
            <EditableField
              label="Notas"
              value={isEditing ? editedData.notes : manualData.notes}
              placeholder="Añadir notas, observaciones o comentarios..."
              isEditing={isEditing}
              multiline
              onChange={(v) => updateField('notes', v)}
            />
          </div>
        </div>

        {/* Delete button */}
        <div style={{
          marginTop: 20,
          paddingTop: 20,
          borderTop: "1px solid #1B3A5C",
        }}>
          {(() => {
            const canHide = canHideCompany(c, currentUser);
            const disabled = isEditing || !canHide;
            return (
              <>
                <button
                  onClick={() => canHide && setShowDeleteConfirm(true)}
                  disabled={disabled}
                  title={!canHide ? "Solo un admin o el dueño del buzón puede ocultar esta empresa" : undefined}
                  style={{
                    width: "100%",
                    background: disabled ? "#1B3A5C" : "#EF4444",
                    border: "none",
                    color: disabled ? "#6B7F94" : "#FFFFFF",
                    padding: "10px 16px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    opacity: disabled ? 0.5 : 1,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled) {
                      e.currentTarget.style.background = "#DC2626";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!disabled) {
                      e.currentTarget.style.background = "#EF4444";
                      e.currentTarget.style.transform = "translateY(0)";
                    }
                  }}
                >
                  🗑️ Ocultar empresa
                </button>
                {isEditing && (
                  <p style={{
                    fontSize: 11,
                    color: "#6B7F94",
                    textAlign: "center",
                    marginTop: 8,
                    marginBottom: 0,
                  }}>
                    Guarda o cancela los cambios antes de ocultar
                  </p>
                )}
                {!canHide && !isEditing && (
                  <p style={{
                    fontSize: 11,
                    color: "#F59E0B",
                    textAlign: "center",
                    marginTop: 8,
                    marginBottom: 0,
                  }}>
                    Solo un admin o el dueño del buzón puede ocultar esta empresa
                  </p>
                )}
              </>
            );
          })()}
        </div>
        </>)}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <>
          <div
            onClick={() => setShowDeleteConfirm(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(10,22,40,0.7)",
              zIndex: 150,
            }}
          />
          <div style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "#0A1628",
            borderRadius: 12,
            padding: 28,
            maxWidth: 440,
            width: "90%",
            border: "1px solid #1B3A5C",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            zIndex: 151,
          }}>
            <div style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#FFFFFF",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <span style={{ fontSize: 28 }}>⚠️</span>
              Confirmar ocultación
            </div>
            <p style={{
              fontSize: 14,
              color: "#94A3B8",
              lineHeight: 1.6,
              marginBottom: 20,
            }}>
              ¿Estás seguro de que deseas ocultar <strong style={{ color: "#FFFFFF" }}>{c.name}</strong>?
              La empresa desaparecerá de la vista pero se puede restaurar desde localStorage.
            </p>
            <div style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
            }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  background: "#132238",
                  border: "1px solid #2A4A6C",
                  color: "#94A3B8",
                  padding: "10px 20px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1B3A5C";
                  e.currentTarget.style.color = "#FFFFFF";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#132238";
                  e.currentTarget.style.color = "#94A3B8";
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (onDelete) {
                    onDelete(c.domain);
                  }
                  setShowDeleteConfirm(false);
                }}
                style={{
                  background: "#EF4444",
                  border: "none",
                  color: "#FFFFFF",
                  padding: "10px 20px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#DC2626";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#EF4444";
                }}
              >
                🗑️ Ocultar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Product match section for detail panel ── */
function ProductMatchSection({ companyIdx, productMatches }) {
  const matches = productMatches?.get(companyIdx) || [];
  const relevant = matches.filter(m => m.score >= 10);

  if (relevant.length === 0) return null;

  const SIGNAL_LABELS = {
    keyword_high: "Keyword fuerte",
    keyword_med: "Keyword medio",
    keyword_low: "Keyword débil",
    marketRole: "Market Role",
    group: "Grupo",
    role: "Rol contacto",
    activity: "Actividad reciente",
  };

  return (
    <div style={{
      background: "linear-gradient(135deg, #1B3A5C 0%, #132238 100%)",
      borderRadius: 12,
      padding: 20,
      marginBottom: 20,
      border: "1px solid #2A4A6C",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
      }}>
        <span style={{ fontSize: 20 }}>🎯</span>
        <DarkSectionTitle style={{ marginBottom: 0, color: "#94A3B8" }}>
          Productos potenciales
        </DarkSectionTitle>
        <span style={{
          marginLeft: "auto", fontSize: 11, color: "#6B7F94", fontWeight: 600,
        }}>
          {relevant.length} match{relevant.length !== 1 ? "es" : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {relevant.map((match) => (
          <div key={match.id} style={{
            background: "#0A1628",
            borderRadius: 10,
            padding: 16,
            border: `1px solid ${match.color}40`,
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: "50%", background: match.color,
                }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "#FFFFFF" }}>
                  {match.name}
                </span>
              </div>
              <div style={{
                background: match.color + "25",
                padding: "4px 12px",
                borderRadius: 6,
                display: "flex", alignItems: "baseline", gap: 3,
              }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: match.color }}>
                  {match.score}
                </span>
                <span style={{ fontSize: 10, color: match.color, opacity: 0.7 }}>/100</span>
              </div>
            </div>

            {/* Score bar */}
            <div style={{
              height: 6, background: "#132238", borderRadius: 3, overflow: "hidden", marginBottom: 12,
            }}>
              <div style={{
                height: "100%", width: `${match.score}%`, borderRadius: 3,
                background: `linear-gradient(90deg, ${match.color}, ${match.color}99)`,
                transition: "width 0.3s ease",
              }} />
            </div>

            {/* Subcategories */}
            {(() => {
              const productDef = PRODUCTS.find(p => p.id === match.id);
              if (!productDef?.subcategories) return null;
              return (
                <div style={{
                  marginBottom: 10, padding: "8px 10px",
                  background: "#132238", borderRadius: 6,
                  border: `1px solid ${match.color}20`,
                }}>
                  <div style={{
                    fontSize: 9, color: "#6B7F94", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6,
                  }}>Subcategorías</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {productDef.subcategories.map(sub => (
                      <span key={sub.id} style={{
                        fontSize: 10, color: match.color, fontWeight: 600,
                        padding: "2px 8px", borderRadius: 4,
                        background: match.color + "10", border: `1px solid ${match.color}25`,
                      }}>
                        {sub.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Signals */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {match.signals.slice(0, 8).map((sig, i) => (
                <span key={i} style={{
                  fontSize: 10, fontWeight: 600,
                  padding: "3px 7px", borderRadius: 4,
                  background: sig.type.startsWith("keyword_high") ? match.color + "20"
                    : sig.type === "marketRole" ? "#3B82F620"
                    : sig.type === "group" ? "#F59E0B20"
                    : sig.type === "role" ? "#10B98120"
                    : "#6B7F9415",
                  color: sig.type.startsWith("keyword_high") ? match.color
                    : sig.type === "marketRole" ? "#60A5FA"
                    : sig.type === "group" ? "#FBBF24"
                    : sig.type === "role" ? "#34D399"
                    : "#94A3B8",
                  whiteSpace: "nowrap",
                }}>
                  {SIGNAL_LABELS[sig.type] || sig.type}: {sig.value}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Dark theme score bar ── */
function ScoreBarDark({ score, max, label }) {
  const pct = (score / max) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {label && (
        <span style={{
          width: 70,
          fontSize: 11,
          fontWeight: 700,
          color: "#94A3B8",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>{label}</span>
      )}
      <div style={{
        flex: 1,
        height: 8,
        background: "#0A1628",
        borderRadius: 4,
        overflow: "hidden",
        position: "relative",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          borderRadius: 4,
          background: pct > 70
            ? "linear-gradient(90deg, #10B981, #059669)"
            : pct > 40
              ? "linear-gradient(90deg, #3B82F6, #2563EB)"
              : "linear-gradient(90deg, #6B7F94, #475569)",
          transition: "width 0.3s ease",
        }} />
      </div>
      <div style={{
        display: "flex",
        alignItems: "baseline",
        gap: 2,
        minWidth: 50,
      }}>
        <span style={{
          fontWeight: 800,
          color: "#FFFFFF",
          fontSize: 14,
        }}>{score}</span>
        <span style={{
          fontSize: 10,
          color: "#6B7F94",
          fontWeight: 600,
        }}>/{max}</span>
      </div>
    </div>
  );
}

/* ── Summary row for Resumen tab ── */
function SummaryRow({ label, value }) {
  return (
    <div style={{
      background: "#132238", borderRadius: 10, padding: "12px 16px",
      border: "1px solid #1B3A5C",
    }}>
      <div style={{
        fontSize: 9, color: "#6B7F94", textTransform: "uppercase",
        letterSpacing: "1.5px", fontWeight: 700, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: 13, color: "#FFFFFF", fontWeight: 500, lineHeight: 1.5,
      }}>{value}</div>
    </div>
  );
}

function DarkSectionTitle({ children, style = {} }) {
  return (
    <div style={{
      fontSize: 10, textTransform: "uppercase", color: "#6B7F94",
      fontWeight: 700, letterSpacing: "2.5px", marginBottom: 8,
      ...style,
    }}>{children}</div>
  );
}

function DarkFieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 9, color: "#6B7F94", textTransform: "uppercase",
      letterSpacing: "1.5px", fontWeight: 700, marginBottom: 6,
    }}>{children}</div>
  );
}

function DarkSelect({ value, onChange, children }) {
  return (
    <select value={value} onChange={onChange} style={{
      width: "100%", background: "#0A1628",
      border: "1px solid #8B5CF640", borderRadius: 4,
      padding: "7px 8px", color: "#FFFFFF", fontSize: 12,
      fontFamily: "inherit", outline: "none", cursor: "pointer",
    }}>
      {children}
    </select>
  );
}

/* ── Info Field (read-only) ── */
function InfoField({ label, value, icon }) {
  return (
    <div style={{
      background: "#0A1628", borderRadius: 6, padding: "10px 12px",
      border: "1px solid #1B3A5C",
    }}>
      <div style={{
        fontSize: 9, color: "#6B7F94", marginBottom: 4,
        textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700,
      }}>
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}
        {label}
      </div>
      <div style={{
        fontSize: 13, color: "#FFFFFF", fontWeight: 600,
      }}>
        {value}
      </div>
    </div>
  );
}

/* ── Editable Field ── */
function EditableField({ label, value, placeholder, isEditing, onChange, type = "text", multiline = false, isLink = false }) {
  const displayValue = value || placeholder;
  const hasValue = !!value;

  if (!isEditing) {
    return (
      <div style={{
        background: "#0A1628", borderRadius: 6, padding: "10px 12px",
        border: "1px solid #1B3A5C",
      }}>
        <div style={{
          fontSize: 9, color: "#6B7F94", marginBottom: 4,
          textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700,
        }}>
          {label}
        </div>
        {isLink && (hasValue || placeholder) ? (
          <a
            href={hasValue ? value : placeholder}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 13,
              color: "#60A5FA",
              fontWeight: 500,
              textDecoration: "none",
              display: "block",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.textDecoration = "underline";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.textDecoration = "none";
            }}
          >
            🔗 {hasValue ? value : displayValue}
          </a>
        ) : (
          <div style={{
            fontSize: 13,
            color: hasValue ? "#FFFFFF" : "#475569",
            fontWeight: hasValue ? 500 : 400,
            fontStyle: hasValue ? "normal" : "italic",
            whiteSpace: multiline ? "pre-wrap" : "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {hasValue ? value : displayValue}
          </div>
        )}
      </div>
    );
  }

  const InputComponent = multiline ? "textarea" : "input";

  return (
    <div style={{
      background: "#0A1628", borderRadius: 6, padding: "10px 12px",
      border: "2px solid #3B82F6",
    }}>
      <div style={{
        fontSize: 9, color: "#60A5FA", marginBottom: 6,
        textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700,
      }}>
        {label}
      </div>
      <InputComponent
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          background: "#132238",
          border: "1px solid #2A4A6C",
          borderRadius: 4,
          padding: "8px 10px",
          color: "#FFFFFF",
          fontSize: 13,
          fontFamily: "inherit",
          fontWeight: 500,
          outline: "none",
          resize: multiline ? "vertical" : "none",
          minHeight: multiline ? 80 : "auto",
        }}
        onFocus={(e) => {
          e.target.style.borderColor = "#3B82F6";
          e.target.style.background = "#1A2B3D";
        }}
        onBlur={(e) => {
          e.target.style.borderColor = "#2A4A6C";
          e.target.style.background = "#132238";
        }}
      />
    </div>
  );
}

/* ── Select Field ── */
function SelectField({ label, value, options, placeholder, isEditing, onChange }) {
  const displayValue = value
    ? (options.find(o => o.id === value)?.label || value)
    : placeholder;
  const hasValue = !!value;

  if (!isEditing) {
    return (
      <div style={{
        background: "#0A1628", borderRadius: 6, padding: "10px 12px",
        border: "1px solid #1B3A5C",
      }}>
        <div style={{
          fontSize: 9, color: "#6B7F94", marginBottom: 4,
          textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700,
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 13,
          color: hasValue ? "#FFFFFF" : "#475569",
          fontWeight: hasValue ? 500 : 400,
          fontStyle: hasValue ? "normal" : "italic",
        }}>
          {displayValue}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "#0A1628", borderRadius: 6, padding: "10px 12px",
      border: "2px solid #3B82F6",
    }}>
      <div style={{
        fontSize: 9, color: "#60A5FA", marginBottom: 6,
        textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 700,
      }}>
        {label}
      </div>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          background: "#132238",
          border: "1px solid #2A4A6C",
          borderRadius: 4,
          padding: "8px 10px",
          color: "#FFFFFF",
          fontSize: 13,
          fontFamily: "inherit",
          fontWeight: 500,
          outline: "none",
          cursor: "pointer",
        }}
        onFocus={(e) => {
          e.target.style.borderColor = "#3B82F6";
          e.target.style.background = "#1A2B3D";
        }}
        onBlur={(e) => {
          e.target.style.borderColor = "#2A4A6C";
          e.target.style.background = "#132238";
        }}
      >
        <option value="">{placeholder}</option>
        {options.map(opt => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
