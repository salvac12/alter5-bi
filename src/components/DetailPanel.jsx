import { Badge, StatusBadge, ScoreBar, SectionLabel } from './UI';

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

export default function DetailPanel({ company, onClose }) {
  if (!company) return null;
  const c = company;
  const det = c.detail;

  return (
    <div className="slide-in" style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 460, maxWidth: "100vw",
      background: "#0A1628", zIndex: 100,
      overflow: "auto", boxShadow: "-12px 0 40px rgba(10,22,40,0.4)",
    }}>
      <div style={{ padding: 24 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h2 style={{
              margin: 0, fontSize: 22, fontWeight: 800, color: "#FFFFFF",
              letterSpacing: "-0.8px", lineHeight: 1.2,
            }}>{c.name}</h2>
            <div style={{ fontSize: 13, color: "#6B7F94", marginTop: 3, fontWeight: 400 }}>{c.domain}</div>
          </div>
          <button onClick={onClose} style={{
            background: "#132238", border: "1px solid #1B3A5C", color: "#6B7F94",
            width: 30, height: 30, borderRadius: 6, cursor: "pointer", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit",
          }}>✕</button>
        </div>

        {/* Tags */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 18 }}>
          <StatusBadge status={c.status} />
          {c.sectors.split(", ").map((s, i) => (
            <Badge key={i} variant="sector">{s}</Badge>
          ))}
          {c.relType.split(", ").map((t, i) => (
            <Badge key={`t${i}`} variant="type">{t}</Badge>
          ))}
        </div>

        {/* Employee sources */}
        {c.employees.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 18 }}>
            {c.employees.map(emp => (
              <span key={emp} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 8px", borderRadius: 4, fontSize: 9, fontWeight: 600,
                color: "#60A5FA", background: "#132238", letterSpacing: "0.02em",
              }}>
                📧 {emp.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
              </span>
            ))}
          </div>
        )}

        {/* Score */}
        <div style={{
          background: "#132238", borderRadius: 10, padding: 16, marginBottom: 16,
          border: "1px solid #1B3A5C",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{
              fontSize: 10, textTransform: "uppercase", color: "#6B7F94",
              fontWeight: 700, letterSpacing: "2.5px",
            }}>Score</span>
            <span style={{
              fontSize: 24, fontWeight: 800, letterSpacing: "-1px",
              background: "linear-gradient(90deg, #3B82F6, #10B981)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>{c.score}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ScoreBarDark score={c.volScore} max={35} label="Volumen" />
            <ScoreBarDark score={c.recScore} max={30} label="Recencia" />
            <ScoreBarDark score={c.netScore} max={15} label="Red" />
            <ScoreBarDark score={c.typeScore} max={20} label="Tipo" />
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          {[
            { label: "Interacciones", value: c.interactions.toLocaleString(), big: true },
            { label: "Contactos", value: c.nContacts, big: true },
            { label: "Primera vez", value: c.firstDate },
            { label: "Último contacto", value: c.lastDate },
          ].map((m, i) => (
            <div key={i} style={{
              background: "#132238", borderRadius: 8, padding: "10px 12px",
              border: "1px solid #1B3A5C",
            }}>
              <div style={{
                fontSize: 10, color: "#6B7F94", fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "2.5px",
              }}>{m.label}</div>
              <div style={{
                fontSize: m.big ? 20 : 13, fontWeight: m.big ? 800 : 600,
                color: "#FFFFFF", marginTop: 2,
                letterSpacing: m.big ? "-0.8px" : "0",
              }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Per-employee breakdown */}
        {det?.sources?.length > 1 && (
          <div style={{ marginBottom: 18 }}>
            <DarkSectionTitle>Interacciones por buzón</DarkSectionTitle>
            {det.sources.map((s, i) => {
              const maxS = Math.max(...det.sources.map(x => x.interactions));
              const empName = s.employee.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{
                    width: 100, fontSize: 11, color: "#6B7F94", fontWeight: 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{empName}</span>
                  <div style={{
                    flex: 1, height: 14, background: "#0A1628", borderRadius: 3, overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%", width: `${(s.interactions / maxS) * 100}%`,
                      background: "linear-gradient(90deg, #3B82F6, #10B981)", borderRadius: 3,
                    }} />
                  </div>
                  <span style={{
                    width: 48, textAlign: "right", fontSize: 11, fontWeight: 700, color: "#FFFFFF",
                  }}>{s.interactions.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Context */}
        {det?.context && (
          <div style={{ marginBottom: 18 }}>
            <DarkSectionTitle>Contexto</DarkSectionTitle>
            <p style={{ fontSize: 13, color: "#94A3B8", lineHeight: 1.6, margin: 0, fontWeight: 400 }}>
              {det.context}
            </p>
          </div>
        )}

        {/* Contacts */}
        {det?.contacts?.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <DarkSectionTitle>Contactos clave</DarkSectionTitle>
            {[...det.contacts]
              .sort((a, b) => contactPriorityRank(a.role) - contactPriorityRank(b.role))
              .map((ct, i) => {
                const { rank, label, color } = contactPriorityInfo(ct.role);
                return (
                  <div key={i} style={{
                    padding: "9px 12px", background: "#132238", borderRadius: 6, marginBottom: 4,
                    border: `1px solid ${rank <= 3 ? color + "40" : "#1B3A5C"}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>{ct.name}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                        padding: "2px 6px", borderRadius: 3,
                        background: color + "20", color,
                      }}>{label}</span>
                    </div>
                    {ct.email && (
                      <div style={{ fontSize: 11, color: "#60A5FA", marginTop: 3, fontWeight: 400 }}>
                        {ct.email}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {/* Timeline */}
        {det?.timeline?.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <DarkSectionTitle>Actividad trimestral</DarkSectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {det.timeline.map((t, i) => {
                const maxE = Math.max(...det.timeline.map(x => x.emails));
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 52, fontSize: 10, color: "#6B7F94", fontFamily: "'DM Sans', monospace",
                      fontWeight: 600,
                    }}>{t.quarter}</span>
                    <div style={{
                      flex: 1, height: 14, background: "#0A1628", borderRadius: 3, overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%", width: `${(t.emails / maxE) * 100}%`,
                        background: "#10B981", borderRadius: 3,
                      }} />
                    </div>
                    <span style={{
                      width: 38, textAlign: "right", fontSize: 11, fontWeight: 700, color: "#FFFFFF",
                    }}>{t.emails}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Manual fields */}
        <div style={{
          marginTop: 20, padding: 14, background: "#132238", borderRadius: 10,
          border: "1px dashed #1B3A5C",
        }}>
          <DarkSectionTitle>Datos manuales</DarkSectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {["Facturación", "Empleados", "Importancia", "Notas"].map(f => (
              <div key={f} style={{
                background: "#0A1628", borderRadius: 6, padding: "7px 10px",
                border: "1px solid #1B3A5C",
              }}>
                <div style={{
                  fontSize: 8, color: "#6B7F94", marginBottom: 1,
                  textTransform: "uppercase", letterSpacing: "2px", fontWeight: 700,
                }}>{f}</div>
                <div style={{ fontSize: 12, color: "#1B3A5C", fontStyle: "italic", fontWeight: 400 }}>
                  Sin datos
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Dark theme score bar ── */
function ScoreBarDark({ score, max, label }) {
  const pct = (score / max) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label && (
        <span style={{
          width: 56, fontSize: 10, fontWeight: 700, color: "#6B7F94",
          textTransform: "uppercase", letterSpacing: "0.03em",
        }}>{label}</span>
      )}
      <div style={{
        flex: 1, height: 4, background: "#0A1628", borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 2,
          background: pct > 60
            ? "linear-gradient(90deg, #3B82F6, #10B981)"
            : pct > 30 ? "#3B82F6" : "#1B3A5C",
          transition: "width 0.3s ease",
        }} />
      </div>
      <span style={{ width: 20, textAlign: "right", fontWeight: 700, color: "#FFFFFF", fontSize: 11 }}>
        {score}
      </span>
    </div>
  );
}

function DarkSectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 10, textTransform: "uppercase", color: "#6B7F94",
      fontWeight: 700, letterSpacing: "2.5px", marginBottom: 8,
    }}>{children}</div>
  );
}
