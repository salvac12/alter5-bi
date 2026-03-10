import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ============================================================
// DESIGN TOKENS (debe coincidir con App.jsx)
// ============================================================
const T = {
  bg:         "#F7F9FC",
  white:      "#FFFFFF",
  sidebar:    "#F1F5F9",
  border:     "#E2E8F0",
  borderLight:"#F1F5F9",
  title:      "#1A2B3D",
  text:       "#334155",
  muted:      "#6B7F94",
  dim:        "#94A3B8",
  primary:    "#3B82F6",
  primaryBg:  "#EFF6FF",
  emerald:    "#10B981",
  emeraldBg:  "#ECFDF5",
  amber:      "#F59E0B",
  amberBg:    "#FFFBEB",
  red:        "#EF4444",
  redBg:      "#FEF2F2",
  sans:       "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  mono:       "'JetBrains Mono', 'Fira Code', monospace",
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Detecta si un texto contiene HTML real (etiquetas como <p>, <strong>, etc.)
 * Gemini deberia generar siempre HTML segun el prompt, pero si no lo hace
 * se muestra en textarea de texto plano como fallback.
 */
const isHtmlContent = (text) => text && /<[a-z][\s\S]*?>/i.test(text);

/**
 * Fallback: elimina marcadores Markdown basicos si Gemini genero texto plano
 * en vez de HTML (ocurre a veces a pesar del prompt).
 */
const stripMarkdown = (text) => {
  if (!text) return text;
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^[*-]\s+/gm, "• ")
    .replace(/_{2,}/g, "")
    .trim();
};

/**
 * Formatea una fecha ISO a formato legible en espanol.
 */
const fmtDate = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
};

/**
 * Formatea una fecha ISO mostrando dia y mes de forma compacta.
 */
const fmtDateShort = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
};

/**
 * Genera iniciales a partir de nombre y apellido.
 */
const getInitials = (nombre, apellido) => {
  return `${(nombre || "")[0] || ""}${(apellido || "")[0] || ""}`.toUpperCase();
};

/**
 * Extrae texto plano limpio de un contenido HTML para el boton "Ver mas".
 */
const stripHtmlTags = (html) => {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

// Limite de caracteres antes de truncar el cuerpo del mensaje en el hilo
const CHARS_PREVIEW = 400;

// ============================================================
// SPINNER COMPONENT
// ============================================================
function Spinner({ size = 20, color = T.primary }) {
  return (
    <div style={{
      width: size,
      height: size,
      border: `2px solid ${color}33`,
      borderTopColor: color,
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
    }} />
  );
}

// ============================================================
// SKELETON LOADER
// ============================================================
function Skeleton({ width = "100%", height = 16, borderRadius = 4 }) {
  return (
    <div style={{
      width,
      height,
      borderRadius,
      background: `linear-gradient(90deg, ${T.border} 25%, ${T.borderLight} 50%, ${T.border} 75%)`,
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite",
    }} />
  );
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================
function Toast({ type, message, onClose }) {
  const config = {
    success: { bg: T.emeraldBg, border: T.emerald, icon: "check" },
    error: { bg: T.redBg, border: T.red, icon: "x" },
  };
  const c = config[type] || config.success;

  useEffect(() => {
    if (type === "success") {
      const timer = setTimeout(onClose, 4000);
      return () => clearTimeout(timer);
    }
  }, [type, onClose]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 20px",
      background: c.bg,
      borderLeft: `4px solid ${c.border}`,
      borderRadius: 8,
      marginBottom: 16,
      animation: "fadeUp 0.3s ease",
    }}>
      <span style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: c.border,
        color: T.white,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
      }}>
        {c.icon === "check" ? "✓" : "×"}
      </span>
      <span style={{ flex: 1, fontSize: 14, color: T.text }}>{message}</span>
      {type === "error" && (
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: T.muted,
            fontSize: 18,
            padding: 4,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ============================================================
// CONFIRMATION MODAL
// ============================================================
function ConfirmModal({ contacto, draftPreview, onConfirm, onCancel, sending }) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 1001,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    }}>
      {/* Overlay */}
      <div
        onClick={onCancel}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.5)",
          animation: "fadeIn 0.2s ease",
        }}
      />

      {/* Modal */}
      <div style={{
        position: "relative",
        background: T.white,
        borderRadius: 16,
        padding: 24,
        maxWidth: 400,
        width: "100%",
        boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        animation: "fadeUp 0.3s ease",
      }}>
        <h3 style={{
          margin: "0 0 16px 0",
          fontSize: 18,
          fontWeight: 700,
          color: T.title,
        }}>
          Enviar respuesta?
        </h3>

        <p style={{
          margin: "0 0 12px 0",
          fontSize: 14,
          color: T.text,
        }}>
          Se enviara un email a:
        </p>

        <div style={{
          padding: "12px 16px",
          background: T.bg,
          borderRadius: 8,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.title }}>
            {contacto.nombre} {contacto.apellido}
          </div>
          <div style={{ fontSize: 13, color: T.muted }}>
            {contacto.email}
          </div>
        </div>

        <div style={{
          padding: "12px 16px",
          background: T.primaryBg,
          borderRadius: 8,
          marginBottom: 20,
          borderLeft: `3px solid ${T.primary}`,
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: T.muted,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 8,
          }}>
            Preview
          </div>
          <div style={{
            fontSize: 13,
            color: T.text,
            lineHeight: 1.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}>
            {draftPreview}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onCancel}
            disabled={sending}
            style={{
              flex: 1,
              padding: "12px 20px",
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: T.text,
              cursor: sending ? "not-allowed" : "pointer",
              fontFamily: T.sans,
              opacity: sending ? 0.5 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={sending}
            style={{
              flex: 1,
              padding: "12px 20px",
              background: T.primary,
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: T.white,
              cursor: sending ? "not-allowed" : "pointer",
              fontFamily: T.sans,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {sending ? (
              <>
                <Spinner size={16} color={T.white} />
                Enviando...
              </>
            ) : (
              "Enviar ahora"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MENSAJE HILO — un email individual dentro del thread
// ============================================================
/**
 * Renderiza un mensaje del hilo de conversacion estilo cliente de correo.
 *
 * Props:
 *   mensaje  — objeto del historial: { de, cuerpo, fecha, asunto, esNuestro }
 *   isLast   — boolean: si es el ultimo mensaje (marca "Pendiente de respuesta")
 *   contacto — objeto del contacto principal (para calcular sus iniciales)
 */
function MensajeHilo({ mensaje, isLast, contacto }) {
  const [expandido, setExpandido] = useState(isLast);

  const esNuestro = mensaje.esNuestro === true;

  // Texto plano para calcular longitud y para el preview truncado
  const textoPlano = isHtmlContent(mensaje.cuerpo)
    ? stripHtmlTags(mensaje.cuerpo)
    : (mensaje.cuerpo || "");

  const necesitaTruncar = textoPlano.length > CHARS_PREVIEW;
  const textoPrevisualizacion = necesitaTruncar && !expandido
    ? textoPlano.substring(0, CHARS_PREVIEW)
    : null;

  // Iniciales del avatar
  const iniciales = esNuestro
    ? "LM"
    : getInitials(contacto?.nombre, contacto?.apellido) || "?";

  // Color del avatar: azul para Leticia, verde para contacto externo
  const avatarBg = esNuestro ? T.primary : T.emerald;

  // Nombre para mostrar en el badge de cabecera
  const nombreDisplay = esNuestro
    ? "Leticia"
    : `${contacto?.nombre || ""} ${contacto?.apellido || ""}`.trim() || mensaje.de;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 0,
      // Mensajes nuestros: fondo azul suave; externos: fondo blanco con borde
      background: esNuestro ? T.primaryBg : T.white,
      border: `1px solid ${esNuestro ? T.primary + "22" : T.border}`,
      // Ultimo mensaje del contacto externo: borde izquierdo verde destacado
      borderLeft: (!esNuestro && isLast)
        ? `3px solid ${T.emerald}`
        : esNuestro
          ? `1px solid ${T.primary}22`
          : `1px solid ${T.border}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Cabecera del mensaje */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderBottom: `1px solid ${esNuestro ? T.primary + "18" : T.border}`,
        background: esNuestro ? T.primary + "0A" : T.bg,
      }}>
        {/* Avatar */}
        <div style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: avatarBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T.white,
          fontSize: 11,
          fontWeight: 700,
          fontFamily: T.mono,
          flexShrink: 0,
          letterSpacing: "0.03em",
        }}>
          {iniciales}
        </div>

        {/* Nombre + fecha */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}>
            <span style={{
              fontSize: 13,
              fontWeight: 600,
              color: T.title,
            }}>
              {nombreDisplay}
            </span>

            {esNuestro && (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                color: T.primary,
                background: T.primaryBg,
                border: `1px solid ${T.primary}33`,
                borderRadius: 4,
                padding: "1px 6px",
                letterSpacing: "0.04em",
              }}>
                Leticia (IA)
              </span>
            )}

            {/* Badge "Pendiente" solo en el ultimo mensaje externo */}
            {!esNuestro && isLast && (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                color: T.emerald,
                background: T.emeraldBg,
                border: `1px solid ${T.emerald}33`,
                borderRadius: 4,
                padding: "1px 6px",
                letterSpacing: "0.04em",
              }}>
                Pendiente de respuesta
              </span>
            )}
          </div>

          {mensaje.fecha && (
            <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>
              {fmtDateShort(mensaje.fecha)}
            </div>
          )}
        </div>
      </div>

      {/* Cuerpo del mensaje */}
      <div style={{ padding: "12px 14px" }}>
        {necesitaTruncar && !expandido ? (
          /* Modo truncado: texto plano cortado */
          <div style={{
            fontSize: 13,
            lineHeight: 1.65,
            color: T.text,
            whiteSpace: "pre-wrap",
          }}>
            {textoPrevisualizacion}
            <span style={{ color: T.dim }}>...</span>
          </div>
        ) : isHtmlContent(mensaje.cuerpo) ? (
          /* HTML: renderizado completo */
          <div
            dangerouslySetInnerHTML={{ __html: mensaje.cuerpo }}
            style={{
              fontSize: 13,
              lineHeight: 1.65,
              color: T.text,
              fontFamily: T.sans,
            }}
          />
        ) : (
          /* Texto plano */
          <div style={{
            fontSize: 13,
            lineHeight: 1.65,
            color: T.text,
            whiteSpace: "pre-wrap",
          }}>
            {mensaje.cuerpo || "Sin contenido"}
          </div>
        )}

        {/* Boton Ver mas / Ver menos */}
        {necesitaTruncar && (
          <button
            onClick={() => setExpandido(!expandido)}
            style={{
              marginTop: 8,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: T.primary,
              fontFamily: T.sans,
              padding: 0,
              letterSpacing: "0.02em",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            {expandido ? "Ver menos" : "Ver mas"}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// HILO DE CONVERSACION — columna izquierda completa
// ============================================================
/**
 * Renderiza el hilo completo de la conversacion.
 * Si hay historial lo muestra. Si no, hace fallback al campo respuesta.cuerpo.
 */
function HiloConversacion({ historial, respuesta, contacto, hiloRef }) {
  const tieneHistorial = Array.isArray(historial) && historial.length > 0;

  if (!tieneHistorial) {
    // Fallback: solo el ultimo mensaje del contacto (comportamiento anterior)
    return (
      <div style={{ padding: "16px 16px 0" }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: T.muted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 10,
        }}>
          Respuesta del cliente
        </div>
        <div style={{
          padding: 14,
          background: T.white,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${T.emerald}`,
          borderRadius: 10,
          fontSize: 13,
          lineHeight: 1.65,
          color: T.text,
          whiteSpace: "pre-wrap",
        }}>
          {respuesta?.cuerpo || "Sin contenido disponible"}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 16px 0" }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: T.muted,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginBottom: 12,
      }}>
        Hilo de conversacion — {historial.length} mensajes
      </div>

      {/* Lista de mensajes */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {historial.map((mensaje, idx) => {
          const isLast = idx === historial.length - 1;
          return (
            <div
              key={idx}
              ref={isLast ? hiloRef : null}
            >
              <MensajeHilo
                mensaje={mensaje}
                isLast={isLast}
                contacto={contacto}
              />
            </div>
          );
        })}
      </div>

      {/* Espaciado inferior dentro del scroll */}
      <div style={{ height: 16 }} />
    </div>
  );
}

// ============================================================
// MAIN SLIDE-OVER PANEL
// ============================================================
export default function SlideOverPanel({
  isOpen,
  onClose,
  contacto,
  apiUrl,
  apiToken,
  onSendSuccess
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [conversacion, setConversacion] = useState(null);
  const [draftText, setDraftText] = useState("");
  const [originalDraft, setOriginalDraft] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState(null);
  // "preview": renderiza el HTML del borrador | "edit": textarea para editar
  const [viewMode, setViewMode] = useState("preview");

  const panelRef = useRef(null);
  // Ref al ultimo mensaje del hilo para auto-scroll
  const ultimoMensajeRef = useRef(null);
  // Ref al contenedor scrollable de la columna izquierda
  const hiloScrollRef = useRef(null);

  // Detecta si el borrador actual es HTML o texto plano
  const draftIsHtml = useMemo(() => isHtmlContent(draftText), [draftText]);

  // Fetch conversation data
  const fetchConversation = useCallback(async () => {
    if (!contacto?.email || !apiUrl) return;

    setLoading(true);
    setError(null);

    try {
      const url = `${apiUrl}?action=getConversation&email=${encodeURIComponent(contacto.email)}`;
      const response = await fetch(url);

      if (!response.ok) throw new Error("Error al cargar");

      const data = await response.json();
      setConversacion(data);

      if (data.borrador?.cuerpo) {
        const raw = data.borrador.cuerpo;
        // Si es HTML lo usamos tal cual; si es texto plano limpiamos el Markdown
        const content = isHtmlContent(raw) ? raw : stripMarkdown(raw);
        setDraftText(content);
        setOriginalDraft(content);
        setViewMode("preview");
      } else {
        setDraftText("");
        setOriginalDraft("");
      }
    } catch (err) {
      setError(err.message || "No se pudo cargar la conversacion");
    } finally {
      setLoading(false);
    }
  }, [contacto?.email, apiUrl]);

  // Load data when panel opens
  useEffect(() => {
    if (isOpen && contacto) {
      setSent(false);
      setSaved(false);
      setToast(null);
      setViewMode("preview");
      fetchConversation();
    }
  }, [isOpen, contacto, fetchConversation]);

  // Auto-scroll al ultimo mensaje del hilo una vez que los datos cargan
  useEffect(() => {
    if (!loading && conversacion && ultimoMensajeRef.current) {
      // Pequeno delay para que el DOM se haya pintado
      const timer = setTimeout(() => {
        ultimoMensajeRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [loading, conversacion]);

  // Check if draft has been modified
  const isDraftModified = draftText !== originalDraft;

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape" && isOpen && !showConfirm) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, showConfirm, onClose]);

  // Handle save draft
  const handleSave = async () => {
    setSaving(true);

    try {
      // Content-Type: text/plain evita el preflight CORS de Google Apps Script
      const response = await fetch(`${apiUrl}?action=saveDraft`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          email: contacto.email,
          borradorCuerpo: draftText,
          token: apiToken,
        }),
      });

      if (!response.ok) throw new Error("Error al guardar");

      setOriginalDraft(draftText);
      setSaved(true);
      setToast({ type: "success", message: "Borrador guardado correctamente" });

      // Reset saved indicator after 3 seconds
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setToast({ type: "error", message: "Error al guardar. Intenta de nuevo." });
    } finally {
      setSaving(false);
    }
  };

  // Handle send
  const handleSend = async () => {
    setSending(true);

    try {
      // Content-Type: text/plain evita el preflight CORS de Google Apps Script
      const response = await fetch(`${apiUrl}?action=sendDraft`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          email: contacto.email,
          draftId: conversacion?.borrador?.draftId,
          cuerpoEditado: draftText !== originalDraft ? draftText : undefined,
          token: apiToken,
        }),
      });

      if (!response.ok) throw new Error("Error al enviar");

      setSent(true);
      setShowConfirm(false);
      setToast({ type: "success", message: "Respuesta enviada correctamente" });

      if (onSendSuccess) {
        onSendSuccess(contacto.email);
      }
    } catch (err) {
      setShowConfirm(false);
      setToast({ type: "error", message: "Error al enviar. Intenta de nuevo." });
    } finally {
      setSending(false);
    }
  };

  // Don't render if not open
  if (!isOpen) return null;

  const hasDraft = conversacion?.borrador?.existe && conversacion?.borrador?.estado === "listo";
  const draftPending = conversacion?.borrador?.estado === "preparando";

  // Historial del hilo (nuevo campo del API) — puede ser undefined en versiones antiguas
  const historial = conversacion?.historial;

  return (
    <>
      {/* Additional styles for animations */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideOut {
          from { transform: translateX(0); }
          to { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Estilos para el HTML renderizado dentro de los mensajes del hilo */
        .mensaje-html-content p { margin: 0 0 10px 0; }
        .mensaje-html-content p:last-child { margin-bottom: 0; }
        .mensaje-html-content ul,
        .mensaje-html-content ol { margin: 0 0 10px 16px; padding: 0; }
        .mensaje-html-content li { margin-bottom: 4px; }
        .mensaje-html-content strong { font-weight: 600; }
        .mensaje-html-content a { color: #3B82F6; }
      `}</style>

      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.3)",
          zIndex: 999,
          animation: "fadeIn 0.2s ease",
        }}
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-title"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: "100vw",
          height: "100vh",
          background: T.white,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* ── Header ── */}
        <header style={{
          padding: "14px 20px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          background: T.white,
        }}>
          <button
            onClick={onClose}
            aria-label="Cerrar panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: "transparent",
              cursor: "pointer",
              color: T.muted,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: T.sans,
              transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.bg}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
            Cerrar
          </button>

          <h2
            id="panel-title"
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: T.title,
            }}
          >
            {loading
              ? "Cargando conversacion..."
              : `Conversacion con ${contacto?.nombre || ""} ${contacto?.apellido || ""}`.trim()
            }
          </h2>

          {/* Indicador de estado del contacto */}
          {!loading && conversacion?.respuesta?.fecha && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: T.muted,
            }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: T.emerald,
                flexShrink: 0,
              }} />
              Respondio el {fmtDate(conversacion.respuesta.fecha)}
            </div>
          )}

          {loading && <div style={{ width: 80 }} />}
        </header>

        {/* Toast notifications — fuera del scroll, pegadas al header */}
        {toast && (
          <div style={{ padding: "12px 20px 0", flexShrink: 0 }}>
            <Toast
              type={toast.type}
              message={toast.message}
              onClose={() => setToast(null)}
            />
          </div>
        )}

        {/* ── Cuerpo principal: 2 columnas ── */}
        <div style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          overflow: "hidden",
        }}>

          {/* ─────────────────────────────────────────────
              COLUMNA IZQUIERDA: Hilo de conversacion
          ───────────────────────────────────────────── */}
          <div
            ref={hiloScrollRef}
            style={{
              width: 480,
              flexShrink: 0,
              borderRight: `1px solid ${T.border}`,
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              background: T.bg,
            }}
          >
            {/* Info del contacto en cabecera de la columna */}
            <div style={{
              padding: "14px 16px",
              background: T.white,
              borderBottom: `1px solid ${T.border}`,
              flexShrink: 0,
            }}>
              {loading ? (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Skeleton width={40} height={40} borderRadius={10} />
                  <div style={{ flex: 1 }}>
                    <Skeleton width="55%" height={15} />
                    <div style={{ height: 6 }} />
                    <Skeleton width="75%" height={12} />
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {/* Avatar del contacto */}
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: T.primary,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: T.white,
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: T.mono,
                    flexShrink: 0,
                  }}>
                    {getInitials(contacto?.nombre, contacto?.apellido)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: T.title,
                      marginBottom: 2,
                    }}>
                      {contacto?.nombre} {contacto?.apellido}
                    </div>
                    <div style={{
                      fontSize: 12,
                      color: T.muted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {contacto?.organizacion
                        ? `${contacto.organizacion} · `
                        : ""
                      }
                      {contacto?.email}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Estado de carga de la columna izquierda */}
            {loading && (
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{
                    padding: 14,
                    background: T.white,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                  }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <Skeleton width={30} height={30} borderRadius={8} />
                      <div style={{ flex: 1 }}>
                        <Skeleton width="40%" height={12} />
                        <div style={{ height: 4 }} />
                        <Skeleton width="25%" height={10} />
                      </div>
                    </div>
                    <Skeleton width="100%" height={12} />
                    <div style={{ height: 5 }} />
                    <Skeleton width="80%" height={12} />
                    <div style={{ height: 5 }} />
                    <Skeleton width={i === 2 ? "60%" : "90%"} height={12} />
                  </div>
                ))}
              </div>
            )}

            {/* Error en la columna izquierda */}
            {error && !loading && (
              <div style={{ padding: 32, textAlign: "center" }}>
                <div style={{
                  width: 44,
                  height: 44,
                  margin: "0 auto 14px",
                  borderRadius: "50%",
                  background: T.amberBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                }}>
                  ⚠
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.title, marginBottom: 6 }}>
                  No se pudo cargar la conversacion
                </div>
                <div style={{ fontSize: 13, color: T.muted, marginBottom: 18 }}>
                  Verifica tu conexion e intenta nuevamente.
                </div>
                <button
                  onClick={fetchConversation}
                  style={{
                    padding: "9px 20px",
                    background: "transparent",
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    color: T.text,
                    cursor: "pointer",
                    fontFamily: T.sans,
                  }}
                >
                  Reintentar
                </button>
              </div>
            )}

            {/* Hilo de conversacion — contenido principal */}
            {!loading && !error && (
              <HiloConversacion
                historial={historial}
                respuesta={conversacion?.respuesta}
                contacto={contacto}
                hiloRef={ultimoMensajeRef}
              />
            )}
          </div>

          {/* ─────────────────────────────────────────────
              COLUMNA DERECHA: Borrador de respuesta
          ───────────────────────────────────────────── */}
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
            minWidth: 0,
            background: T.white,
          }}>
            <div style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column" }}>

              {/* ── Header del borrador ── */}
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                gap: 8,
                flexWrap: "wrap",
                flexShrink: 0,
              }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: T.muted,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}>
                  Borrador de respuesta
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {hasDraft && (
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 11px",
                      background: T.primaryBg,
                      border: `1px solid ${T.primary}22`,
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      color: T.primary,
                    }}>
                      <span>✨</span>
                      Preparado por Leticia (IA)
                    </div>
                  )}

                  {/* Toggle Vista previa / Editar — solo cuando hay borrador y no esta enviado */}
                  {hasDraft && !sent && (
                    <div style={{
                      display: "flex",
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      overflow: "hidden",
                    }}>
                      {["preview", "edit"].map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setViewMode(mode)}
                          style={{
                            padding: "6px 14px",
                            border: "none",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            fontFamily: T.sans,
                            background: viewMode === mode ? T.primary : T.white,
                            color: viewMode === mode ? T.white : T.muted,
                            transition: "all 0.15s",
                          }}
                        >
                          {mode === "preview" ? "Vista previa" : "Editar"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Skeleton del borrador mientras carga ── */}
              {loading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Skeleton width="100%" height={14} />
                  <Skeleton width="90%" height={14} />
                  <Skeleton width="95%" height={14} />
                  <Skeleton width="70%" height={14} />
                  <div style={{ height: 8 }} />
                  <Skeleton width="100%" height={14} />
                  <Skeleton width="85%" height={14} />
                </div>
              )}

              {/* ── Contenido del borrador ── */}
              {!loading && (
                <>
                  {draftPending ? (
                    /* Estado: borrador en preparacion */
                    <div style={{
                      padding: 32,
                      background: T.amberBg,
                      border: `1px dashed ${T.amber}`,
                      borderRadius: 10,
                      textAlign: "center",
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      <div style={{ width: 40, height: 40, marginBottom: 16 }}>
                        <Spinner size={40} color={T.amber} />
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: T.title, marginBottom: 8 }}>
                        Leticia esta preparando el borrador
                      </div>
                      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5, marginBottom: 16 }}>
                        Esto puede tardar unos minutos.
                      </div>
                      <button
                        onClick={fetchConversation}
                        style={{
                          padding: "8px 16px",
                          background: "transparent",
                          border: `1px solid ${T.amber}`,
                          borderRadius: 6,
                          fontSize: 13,
                          fontWeight: 500,
                          color: T.amber,
                          cursor: "pointer",
                          fontFamily: T.sans,
                        }}
                      >
                        Actualizar ahora
                      </button>
                    </div>

                  ) : hasDraft ? (
                    viewMode === "preview" ? (
                      /* Vista previa: renderiza el HTML de Gemini */
                      <div
                        dangerouslySetInnerHTML={{ __html: draftText }}
                        style={{
                          padding: "20px 24px",
                          background: T.white,
                          border: `1px solid ${T.border}`,
                          borderRadius: 10,
                          fontSize: 14,
                          lineHeight: 1.7,
                          color: T.text,
                          fontFamily: T.sans,
                          minHeight: 200,
                          overflowY: "auto",
                          flex: 1,
                        }}
                      />
                    ) : (
                      /* Modo edicion: textarea con el HTML/texto */
                      <textarea
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        disabled={sent}
                        style={{
                          width: "100%",
                          flex: 1,
                          minHeight: 300,
                          padding: 16,
                          background: sent ? T.bg : T.white,
                          border: `1px solid ${T.border}`,
                          borderRadius: 10,
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: T.text,
                          fontFamily: T.mono,
                          resize: "vertical",
                          outline: "none",
                          transition: "border-color 0.2s, box-shadow 0.2s",
                          boxSizing: "border-box",
                        }}
                        onFocus={(e) => {
                          if (!sent) {
                            e.target.style.borderColor = T.primary;
                            e.target.style.boxShadow = `0 0 0 3px ${T.primary}22`;
                          }
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor = T.border;
                          e.target.style.boxShadow = "none";
                        }}
                      />
                    )

                  ) : (
                    /* Sin borrador disponible */
                    <div style={{
                      padding: 24,
                      background: T.bg,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      textAlign: "center",
                      color: T.muted,
                      fontSize: 14,
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      No hay borrador disponible para este contacto.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>{/* fin 2 columnas */}

        {/* ── Footer: botones de accion ── */}
        {!loading && !error && (
          <footer style={{
            padding: "14px 20px",
            borderTop: `1px solid ${T.border}`,
            background: T.white,
            flexShrink: 0,
          }}>
            {/* Indicador de modificacion del borrador */}
            {isDraftModified && !sent && (
              <div style={{
                marginBottom: 10,
                padding: "7px 12px",
                background: T.amberBg,
                borderRadius: 6,
                fontSize: 13,
                color: T.amber,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}>
                <span style={{ fontSize: 8 }}>●</span>
                Borrador modificado — guarda los cambios antes de enviar
              </div>
            )}

            {/* Botones */}
            <div style={{ display: "flex", gap: 12 }}>
              {/* Guardar */}
              <button
                onClick={handleSave}
                disabled={!isDraftModified || saving || sent || draftPending}
                style={{
                  flex: 1,
                  padding: "13px 20px",
                  background: saved ? T.emeraldBg : "transparent",
                  border: `1px solid ${saved ? T.emerald : isDraftModified ? T.primary : T.border}`,
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  color: saved ? T.emerald : isDraftModified ? T.primary : T.muted,
                  cursor: (!isDraftModified || saving || sent) ? "not-allowed" : "pointer",
                  fontFamily: T.sans,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "all 0.2s",
                }}
              >
                {saving ? (
                  <>
                    <Spinner size={16} color={T.primary} />
                    Guardando...
                  </>
                ) : saved ? (
                  <>
                    <span>✓</span>
                    Guardado
                  </>
                ) : (
                  "Guardar borrador"
                )}
              </button>

              {/* Enviar */}
              <button
                onClick={() => setShowConfirm(true)}
                disabled={!hasDraft || sent || draftPending || !draftText}
                style={{
                  flex: 1,
                  padding: "13px 20px",
                  background: sent
                    ? T.emerald
                    : (!hasDraft || draftPending || !draftText)
                      ? T.border
                      : T.primary,
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  color: sent
                    ? T.white
                    : (!hasDraft || draftPending || !draftText)
                      ? T.muted
                      : T.white,
                  cursor: (!hasDraft || sent || draftPending || !draftText) ? "not-allowed" : "pointer",
                  fontFamily: T.sans,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "all 0.2s",
                }}
              >
                {sent ? (
                  <>
                    <span>✓</span>
                    Enviado
                  </>
                ) : draftPending ? (
                  <>
                    <Spinner size={16} color={T.muted} />
                    Preparando...
                  </>
                ) : (
                  "Enviar respuesta"
                )}
              </button>
            </div>

            {sent && (
              <div style={{
                marginTop: 10,
                textAlign: "center",
                fontSize: 13,
                color: T.emerald,
              }}>
                Respuesta enviada correctamente
              </div>
            )}
          </footer>
        )}
      </aside>

      {/* Confirmation Modal */}
      {showConfirm && (
        <ConfirmModal
          contacto={contacto}
          draftPreview={
            draftIsHtml
              ? stripHtmlTags(draftText).substring(0, 150) + (stripHtmlTags(draftText).length > 150 ? "..." : "")
              : draftText.substring(0, 150) + (draftText.length > 150 ? "..." : "")
          }
          onConfirm={handleSend}
          onCancel={() => setShowConfirm(false)}
          sending={sending}
        />
      )}
    </>
  );
}
