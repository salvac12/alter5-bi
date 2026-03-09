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

const STATUS_COLORS = {
  active: { bg: "#ECFDF5", color: "#059669", label: "Activa" },
  dormant: { bg: "#FEF3C7", color: "#D97706", label: "Dormida" },
  lost: { bg: "#FEE2E2", color: "#DC2626", label: "Perdida" },
};

export default function CerebroSearch({ companies, onClose, onSelectCompany }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { answer, matchedCompanies }
  const [error, setError] = useState(null);
  const [recordId, setRecordId] = useState(null); // Airtable record ID for feedback
  const [feedback, setFeedback] = useState(null); // "up" | "down" | null
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSearch = async (q) => {
    const text = (q || question).trim();
    if (!text) return;
    if (!isGeminiConfigured()) {
      setError("API key de Gemini no configurada (VITE_GEMINI_API_KEY).");
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
        res.savePromise.then(id => { if (id) setRecordId(id); });
      }
    } catch (err) {
      console.error("Cerebro error:", err);
      setError(err.message || "Error al consultar Gemini.");
    } finally {
      setLoading(false);
    }
  };

  const handleExample = (ex) => {
    setQuestion(ex);
    handleSearch(ex);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
        width: "100%", maxWidth: 900, maxHeight: "90vh",
          background: "#fff", borderRadius: 16,
          boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
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
              color: "#fff", width: 32, height: 32, borderRadius: 8,
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
                flex: 1, padding: "12px 16px", fontSize: 15,
                border: "2px solid #E5E7EB", borderRadius: 10,
                outline: "none", fontFamily: "inherit",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#8B5CF6")}
              onBlur={(e) => (e.target.style.borderColor = "#E5E7EB")}
            />
            <button
              onClick={() => handleSearch()}
              disabled={loading || !question.trim()}
              style={{
                padding: "12px 20px", borderRadius: 10, border: "none",
                background: loading || !question.trim()
                  ? "#D1D5DB"
                  : "linear-gradient(135deg, #8B5CF6, #3B82F6)",
                color: "#fff", fontSize: 15, fontWeight: 600,
                cursor: loading || !question.trim() ? "default" : "pointer",
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              {loading ? "..." : "Buscar"}
            </button>
          </div>

          {/* Example chips */}
          {!result && !loading && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => handleExample(ex)}
                  style={{
                    padding: "6px 14px", borderRadius: 20, fontSize: 13,
                    border: "1px solid #E5E7EB", background: "#F9FAFB",
                    color: "#374151", cursor: "pointer", fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = "#EDE9FE";
                    e.target.style.borderColor = "#8B5CF6";
                    e.target.style.color = "#7C3AED";
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = "#F9FAFB";
                    e.target.style.borderColor = "#E5E7EB";
                    e.target.style.color = "#374151";
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
          {/* Loading */}
          {loading && (
            <div style={{ textAlign: "center", padding: "48px 0", color: "#6B7280" }}>
              <div
                style={{
                  width: 36, height: 36, border: "3px solid #E5E7EB",
                  borderTopColor: "#8B5CF6", borderRadius: "50%",
                  margin: "0 auto 16px",
                  animation: "cerebro-spin 0.8s linear infinite",
                }}
              />
              <style>{`@keyframes cerebro-spin { to { transform: rotate(360deg); } }`}</style>
              <p style={{ fontSize: 14, margin: 0 }}>
                Buscando en {companies.length.toLocaleString()} empresas...
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              style={{
                padding: "14px 18px", borderRadius: 10,
                background: "#FEF2F2", color: "#DC2626",
                fontSize: 14, marginTop: 8,
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
                  color: "#1F2937", padding: "16px 0",
                }}
              >
                {result.answer}
              </div>

              {/* Feedback buttons */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                paddingBottom: 12, marginBottom: 12,
                borderBottom: result.matchedCompanies.length > 0 ? "1px solid #E5E7EB" : "none",
              }}>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                  {feedback ? (feedback === "up" ? "Gracias por el feedback" : "Se usara para mejorar") : "Esta respuesta fue util?"}
                </span>
                <button
                  onClick={() => {
                    setFeedback("up");
                    if (recordId) updateFeedback(recordId, true);
                  }}
                  style={{
                    background: feedback === "up" ? "#ECFDF5" : "transparent",
                    border: feedback === "up" ? "1px solid #10B981" : "1px solid #E5E7EB",
                    borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                    fontSize: 14, color: feedback === "up" ? "#059669" : "#9CA3AF",
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
                    background: feedback === "down" ? "#FEF2F2" : "transparent",
                    border: feedback === "down" ? "1px solid #EF4444" : "1px solid #E5E7EB",
                    borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                    fontSize: 14, color: feedback === "down" ? "#DC2626" : "#9CA3AF",
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
                    fontSize: 13, fontWeight: 600, color: "#6B7280",
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
                    {result.matchedCompanies.map((c) => {
                      const st = STATUS_COLORS[c.status] || STATUS_COLORS.lost;
                      return (
                        <button
                          key={c.domain}
                          onClick={() => onSelectCompany(c)}
                          style={{
                            textAlign: "left", padding: "10px 14px",
                            borderRadius: 8, border: "1px solid #E5E7EB",
                            background: "#FAFAFA", cursor: "pointer",
                            fontFamily: "inherit", transition: "all 0.15s",
                            display: "flex", flexDirection: "column", gap: 4,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "#8B5CF6";
                            e.currentTarget.style.boxShadow = "0 2px 8px rgba(139,92,246,0.15)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "#E5E7EB";
                            e.currentTarget.style.boxShadow = "none";
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>
                            {c.name}
                          </span>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            {c.detail?.enrichment?.st && (
                              <span style={{
                                fontSize: 11, padding: "2px 8px", borderRadius: 10,
                                background: "#EDE9FE", color: "#7C3AED", fontWeight: 500,
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
                            <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                              {c.interactions} emails
                            </span>
                          </div>
                          {c.detail?.enrichment?.fc && (
                            <span style={{ fontSize: 12, color: "#6B7280" }}>
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
