import { useState, useEffect } from 'react';
import { Badge, StatusBadge, ScoreBar, SectionLabel } from './UI';
import { getCompanyDataByDomain, saveCompanyData, qualifyCountry, qualifyCompanySize, getCompanyContacts, saveCompanyContacts } from '../utils/companyData';
import { COUNTRIES, COMPANY_SIZES, SECTORS, MARKET_ROLES } from '../utils/constants';

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

export default function DetailPanel({ company, onClose, onDelete, productMatches }) {
  if (!company) return null;
  const c = company;
  const det = c.detail;

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

  // Cargar datos manuales al abrir el panel
  useEffect(() => {
    if (c.domain) {
      const data = getCompanyDataByDomain(c.domain);
      setManualData(data);
      setEditedData(data);

      // Cargar contactos guardados o usar los originales
      const savedContacts = getCompanyContacts(c.domain);
      setEditedContacts(savedContacts || (det?.contacts || []));
    }
  }, [c.domain, det?.contacts]);

  // Datos cualificados
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
    // Recargar contactos guardados o usar originales
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
          {/* Mostrar sector editado si existe, sino el original */}
          {(manualData.sector ? [manualData.sector] : c.sectors.split(", ")).map((s, i) => (
            <Badge key={i} variant="sector">{s}</Badge>
          ))}
          {c.relType.split(", ").map((t, i) => (
            <Badge key={`t${i}`} variant="type">{t}</Badge>
          ))}
          {c.subtipo && (
            <span style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: "#8B5CF620", color: "#A78BFA", border: "1px solid #8B5CF640",
            }}>{c.subtipo}</span>
          )}
          {c.fase && (
            <span style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: c.fase.includes("activo") ? "#10B98120" : c.fase.includes("Negociacion") ? "#F59E0B20" : c.fase.includes("Descartado") ? "#EF444420" : "#3B82F620",
              color: c.fase.includes("activo") ? "#34D399" : c.fase.includes("Negociacion") ? "#FBBF24" : c.fase.includes("Descartado") ? "#F87171" : "#60A5FA",
              border: `1px solid ${c.fase.includes("activo") ? "#10B98140" : c.fase.includes("Negociacion") ? "#F59E0B40" : c.fase.includes("Descartado") ? "#EF444440" : "#3B82F640"}`,
            }}>{c.fase}</span>
          )}
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

        {/* Context/Summary - HIGHLIGHTED */}
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

        {/* Score - MEJORADO */}
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
            <ScoreBarDark score={c.typeScore} max={20} label="Tipo" />
          </div>
        </div>

        {/* Metrics - Grid ampliado */}
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

        {/* Per-employee breakdown - MEJORADO */}
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
                          }}>{ct.name}</span>
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
                        value={ct.name}
                        onChange={(e) => handleUpdateContact(i, 'name', e.target.value)}
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

        {/* Timeline - MEJORADO */}
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
                const isRecent = i < 3; // Los 3 trimestres más recientes

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
            {/* Facturación */}
            <EditableField
              label="Facturación anual"
              value={isEditing ? editedData.revenue : manualData.revenue}
              placeholder="Ej: 5M €, 10M €, 50M €"
              isEditing={isEditing}
              onChange={(v) => updateField('revenue', v)}
            />

            {/* Empleados */}
            <EditableField
              label="Número de empleados"
              value={isEditing ? editedData.employeesCount : manualData.employeesCount}
              placeholder="Ej: 25, 150, 500"
              isEditing={isEditing}
              type="number"
              onChange={(v) => updateField('employeesCount', v)}
            />

            {/* Sector */}
            <SelectField
              label="Sector"
              value={isEditing ? editedData.sector : manualData.sector}
              options={SECTORS.map(s => ({ id: s, label: s }))}
              placeholder={c.sectors || "Seleccionar sector..."}
              isEditing={isEditing}
              onChange={(v) => updateField('sector', v)}
            />

            {/* País (manual override) */}
            <SelectField
              label="País (manual)"
              value={isEditing ? editedData.country : manualData.country}
              options={COUNTRIES}
              placeholder="Seleccionar país..."
              isEditing={isEditing}
              onChange={(v) => updateField('country', v)}
            />

            {/* Importancia/Prioridad */}
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

            {/* Sitio web */}
            <EditableField
              label="Sitio web"
              value={isEditing ? editedData.website : manualData.website}
              placeholder={`https://${c.domain}`}
              isEditing={isEditing}
              isLink={true}
              onChange={(v) => updateField('website', v)}
            />

            {/* LinkedIn */}
            <EditableField
              label="LinkedIn"
              value={isEditing ? editedData.linkedin : manualData.linkedin}
              placeholder="https://linkedin.com/company/..."
              isEditing={isEditing}
              onChange={(v) => updateField('linkedin', v)}
            />

            {/* Notas */}
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
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isEditing}
            style={{
              width: "100%",
              background: isEditing ? "#1B3A5C" : "#EF4444",
              border: "none",
              color: isEditing ? "#6B7F94" : "#FFFFFF",
              padding: "10px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: isEditing ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: isEditing ? 0.5 : 1,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!isEditing) {
                e.currentTarget.style.background = "#DC2626";
                e.currentTarget.style.transform = "translateY(-1px)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isEditing) {
                e.currentTarget.style.background = "#EF4444";
                e.currentTarget.style.transform = "translateY(0)";
              }
            }}
          >
            🗑️ Eliminar empresa
          </button>
          {isEditing && (
            <p style={{
              fontSize: 11,
              color: "#6B7F94",
              textAlign: "center",
              marginTop: 8,
              marginBottom: 0,
            }}>
              Guarda o cancela los cambios antes de eliminar
            </p>
          )}
        </div>
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
              Confirmar eliminación
            </div>
            <p style={{
              fontSize: 14,
              color: "#94A3B8",
              lineHeight: 1.6,
              marginBottom: 20,
            }}>
              ¿Estás seguro de que deseas eliminar <strong style={{ color: "#FFFFFF" }}>{c.name}</strong>?
              Esta acción ocultará la empresa de la vista pero se puede restaurar desde localStorage.
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
                🗑️ Eliminar
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
    sector: "Sector",
    relType: "Tipo relación",
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

            {/* Signals */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {match.signals.slice(0, 8).map((sig, i) => (
                <span key={i} style={{
                  fontSize: 10, fontWeight: 600,
                  padding: "3px 7px", borderRadius: 4,
                  background: sig.type.startsWith("keyword_high") ? match.color + "20"
                    : sig.type === "relType" ? "#3B82F620"
                    : sig.type === "role" ? "#10B98120"
                    : "#6B7F9415",
                  color: sig.type.startsWith("keyword_high") ? match.color
                    : sig.type === "relType" ? "#60A5FA"
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

/* ── Dark theme score bar - MEJORADO ── */
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

function DarkSectionTitle({ children, style = {} }) {
  return (
    <div style={{
      fontSize: 10, textTransform: "uppercase", color: "#6B7F94",
      fontWeight: 700, letterSpacing: "2.5px", marginBottom: 8,
      ...style,
    }}>{children}</div>
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

  // Modo edición
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

  // Modo edición
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
