import { useState, useRef, useEffect } from "react";
import { queryCerebro, isGeminiConfigured } from "../utils/gemini";
import { updateFeedback } from "../utils/airtableCerebro";

const EXAMPLES = [
  "Term sheets enviados",
  "Developers sin contacto 1 ano",
  "Empresas con proyectos BESS",
  "IPPs mas activos",
  "Fondos interesados en deuda",
  "Actividad autoconsumo industrial",
];

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  active: { bg: "#0D3321", color: "#10B981", label: "Activa" },
  dormant: { bg: "#3D2E05", color: "#F59E0B", label: "Dormida" },
  lost: { bg: "#3B1114", color: "#EF4444", label: "Perdida" },
};

export default function CerebroSearch({ companies, onClose, onSelectCompany }: {
  companies: any[];
  onClose: () => void;
  onSelectCompany: (company: any) => void;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null); // { answer, matchedCompanies }
  const [error, setError] = useState<string | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null); // Airtable record ID for feedback
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSearch = async (q?: string) => {
    const text = (q || question).trim();
    if (!text) return;
    if (!isGeminiConfigured()) {
      setError("Proxy no configurado (VITE_CAMPAIGN_PROXY_SECRET).");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setRecordId(null);
    setFeedback(null);

    try {
      const res = await queryCerebro(text, companies);
      setResult(res);
      // Resolve the Airtable save promise to get the record ID for feedback
      if (res.savePromise) {
        res.savePromise.then((id: string) => { if (id) setRecordId(id); });
      }
    } catch (err: any) {
      console.error("Cerebro error:", err);
      setError(err.message || "Error al consultar Gemini.");
    } finally {
      setLoading(false);
    }
  };

  const handleExample = (ex: string) => {
    setQuestion(ex);
    handleSearch(ex);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(10,22,40,0.8)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "100%", maxWidth: 900, maxHeight: "90vh",
          background: "#0A1628", borderRadius: 20,
          border: "1px solid #1B3A5C",
          boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg, #8B5CF6, #3B82F6)",
            padding: "20px 24px", display: "flex", alignItems: "center",
            justifyContent: "space-between", flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>&#129504;</span>
            <span style={{ color: "#fff", fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>
              Cerebro Alter5
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.2)", border: "none",
              color: "#fff", width: 32, height: 32, borderRadius: 10,
              fontSize: 18, cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}
          >
            &#10005;
          </button>
        </div>

        {/* Search input */}
        <div style={{ padding: "20px 24px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe tu pregunta..."
              style={{
                flex: 1, padding: "14px 18px", fontSize: 16,
                border: "2px solid #1B3A5C", borderRadius: 14,
                outline: "none", fontFamily: "inherit",
                transition: "border-color 0.2s, box-shadow 0.2s",
                background: "#132238", color: "#F1F5F9",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#3B82F6";
                e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.25)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#1B3A5C";
                e.target.style.boxShadow = "none";
              }}
            />
            <button
              onClick={() => handleSearch()}
              disabled={loading || !question.trim()}
              style={{
                padding: "14px 22px", borderRadius: 14, border: "none",
                background: loading || !question.trim()
                  ? "#1E293B"
                  : "linear-gradient(135deg, #8B5CF6, #3B82F6)",
                color: loading || !question.trim() ? "#64748B" : "#fff",
                fontSize: 15, fontWeight: 600,
                cursor: loading || !question.trim() ? "default" : "pointer",
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              {loading ? "..." : "Buscar"}
            </button>
          </div>

          {/* Example chips — 2x2 grid suggestion cards */}
          {!result && !loading && (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: 10, marginTop: 16,
            }}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => handleExample(ex)}
                  style={{
                    padding: "10px 16px", borderRadius: 14, fontSize: 13,
                    border: "1px solid #1B3A5C", background: "#132238",
                    color: "#94A3B8", cursor: "pointer", fontFamily: "inherit",
                    transition: "all 0.15s", textAlign: "left",
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = "#243B53";
                    (e.target as HTMLElement).style.borderColor = "#8B5CF6";
                    (e.target as HTMLElement).style.color = "#F1F5F9";
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = "#132238";
                    (e.target as HTMLElement).style.borderColor = "#1B3A5C";
                    (e.target as HTMLElement).style.color = "#94A3B8";
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results area */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 24px" }}>
          {/* Loading — typing indicator */}
          {loading && (
            <div style={{
              textAlign: "center", padding: "48px 0", color: "#94A3B8",
            }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 6, marginBottom: 16,
              }}>
                <span className="cerebro-dot" style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#8B5CF6",
                  animation: "cerebroDotBounce 1.2s infinite ease-in-out",
                  animationDelay: "0s",
                }} />
                <span className="cerebro-dot" style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#8B5CF6",
                  animation: "cerebroDotBounce 1.2s infinite ease-in-out",
                  animationDelay: "0.2s",
                }} />
                <span className="cerebro-dot" style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#8B5CF6",
                  animation: "cerebroDotBounce 1.2s infinite ease-in-out",
                  animationDelay: "0.4s",
                }} />
              </div>
              <style>{`
                @keyframes cerebroDotBounce {
                  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
                  40% { transform: translateY(-8px); opacity: 1; }
                }
              `}</style>
              <p style={{ fontSize: 14, margin: 0 }}>
                Buscando en {companies.length.toLocaleString()} empresas...
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              style={{
                padding: "14px 18px", borderRadius: 14,
                background: "#2D1215", border: "1px solid #7F1D1D",
                color: "#FCA5A5", fontSize: 14, marginTop: 8,
              }}
            >
              {error}
            </div>
          )}

          {/* Answer */}
          {result && (
            <>
              <div
                style={{
                  whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7,
                  color: "#F1F5F9", padding: "16px 20px",
                  background: "#132238", borderRadius: 14,
                  border: "1px solid #1B3A5C",
                }}
              >
                {result.answer}
              </div>

              {/* Feedback buttons */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                paddingTop: 12, paddingBottom: 12, marginBottom: 12,
                borderBottom: result.matchedCompanies.length > 0 ? "1px solid #1B3A5C" : "none",
              }}>
                <span style={{ fontSize: 12, color: "#64748B" }}>
                  {feedback ? (feedback === "up" ? "Gracias por el feedback" : "Se usara para mejorar") : "Esta respuesta fue util?"}
                </span>
                <button
                  onClick={() => {
                    setFeedback("up");
                    if (recordId) updateFeedback(recordId, true);
                  }}
                  style={{
                    background: feedback === "up" ? "#0D3321" : "transparent",
                    border: feedback === "up" ? "1px solid #10B981" : "1px solid #1B3A5C",
                    borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                    fontSize: 14, color: feedback === "up" ? "#10B981" : "#64748B",
                    transition: "all 0.15s",
                  }}
                  title="Respuesta util"
                >
                  &#9650;
                </button>
                <button
                  onClick={() => {
                    setFeedback("down");
                    if (recordId) updateFeedback(recordId, false);
                  }}
                  style={{
                    background: feedback === "down" ? "#3B1114" : "transparent",
                    border: feedback === "down" ? "1px solid #EF4444" : "1px solid #1B3A5C",
                    borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                    fontSize: 14, color: feedback === "down" ? "#EF4444" : "#64748B",
                    transition: "all 0.15s",
                  }}
                  title="Respuesta no util"
                >
                  &#9660;
                </button>
              </div>

              {/* Company cards */}
              {result.matchedCompanies.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p style={{
                    fontSize: 13, fontWeight: 600, color: "#94A3B8",
                    textTransform: "uppercase", letterSpacing: "0.5px",
                    margin: "0 0 12px",
                  }}>
                    Empresas encontradas ({result.matchedCompanies.length})
                    <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 8, fontSize: 12 }}>
                      Pulsa en una para ver su ficha
                    </span>
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {result.matchedCompanies.map((c: any) => {
                      const st = STATUS_COLORS[c.status] || STATUS_COLORS.lost;
                      return (
                        <button
                          key={c.domain}
                          onClick={() => onSelectCompany(c)}
                          style={{
                            textAlign: "left", padding: "12px 16px",
                            borderRadius: 14, border: "1px solid #1B3A5C",
                            background: "#132238", cursor: "pointer",
                            fontFamily: "inherit", transition: "all 0.15s",
                            display: "flex", flexDirection: "column", gap: 4,
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.borderColor = "#8B5CF6";
                            (e.currentTarget as HTMLElement).style.background = "#243B53";
                            (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(139,92,246,0.2)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.borderColor = "#1B3A5C";
                            (e.currentTarget as HTMLElement).style.background = "#132238";
                            (e.currentTarget as HTMLElement).style.boxShadow = "none";
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 14, color: "#F1F5F9" }}>
                            {c.name}
                          </span>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            {c.detail?.enrichment?.st && (
                              <span style={{
                                fontSize: 11, padding: "2px 8px", borderRadius: 10,
                                background: "#8B5CF620", color: "#A78BFA", fontWeight: 500,
                              }}>
                                {c.detail.enrichment.st}
                              </span>
                            )}
                            <span style={{
                              fontSize: 11, padding: "2px 8px", borderRadius: 10,
                              background: st.bg, color: st.color, fontWeight: 500,
                            }}>
                              {st.label}
                            </span>
                            <span style={{ fontSize: 11, color: "#64748B" }}>
                              {c.interactions} emails
                            </span>
                          </div>
                          {c.detail?.enrichment?.fc && (
                            <span style={{ fontSize: 12, color: "#94A3B8" }}>
                              Fase: {c.detail.enrichment.fc}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
