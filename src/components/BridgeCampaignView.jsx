import { useState, useEffect, useCallback, useRef } from "react";
import DOMPurify from 'dompurify';
import BridgeSlideOverPanel from "./BridgeSlideOverPanel";
import BridgeExplorerView from "./BridgeExplorerView";
import { fetchAllBridgeTargets } from "../utils/airtableCandidates";

// ============================================================
// CONFIG — all GAS calls go through /api/campaign-proxy
// ============================================================
import { proxyFetch } from "../utils/campaignApi";

// ============================================================
// ALTER5 BRAND TOKENS (Figma Make Design System)
// ============================================================
const T = {
  // Backgrounds
  bg:         "#F0F4F8",      // Fondo principal
  white:      "#FFFFFF",      // Cards y superficies
  sidebar:    "#F1F5F9",      // Sidebar/filtros

  // Borders
  border:     "#E2E8F0",      // Bordes sutiles
  borderLight:"#F1F5F9",      // Bordes muy sutiles

  // Text
  title:      "#0F172A",      // Títulos y texto principal
  text:       "#334155",      // Texto normal
  muted:      "#64748B",      // Texto secundario
  dim:        "#94A3B8",      // Texto muy sutil

  // Brand Colors
  primary:    "#3B82F6",      // Azul principal (botones, logo)
  primaryBg:  "#EFF6FF",      // Fondo azul sutil

  // Status Colors
  emerald:    "#10B981",      // Verde - Activo/Éxito
  emeraldBg:  "#ECFDF5",      // Fondo verde
  amber:      "#F59E0B",      // Amarillo - Dormido/Pendiente
  amberBg:    "#FFFBEB",      // Fondo amarillo
  red:        "#EF4444",      // Rojo - Perdido/Error
  redBg:      "#FEF2F2",      // Fondo rojo
  blue:       "#3B82F6",      // Azul - Info
  blueBg:     "#EFF6FF",      // Fondo azul

  // Typography
  sans:       "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  mono:       "'JetBrains Mono', 'Fira Code', monospace",
};

// ============================================================
// PIPELINE CONSTANTS
// ============================================================
const PIPELINE_STAGES = [
  { id: 'nurturing', label: 'Nurturing', tab: 'prospects' },
  { id: 'reunion', label: 'Reunión', tab: 'prospects' },
  { id: 'subida_docs', label: 'Subida docs', tab: 'oportunidades' },
  { id: 'doc_completada', label: 'Doc completada', tab: 'oportunidades' },
];

const STAGE_COLORS = {
  nurturing:      { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8' },
  reunion:        { bg: '#FFFBEB', border: '#F59E0B', text: '#B45309' },
  subida_docs:    { bg: '#FFF7ED', border: '#F97316', text: '#C2410C' },
  doc_completada: { bg: '#ECFDF5', border: '#10B981', text: '#047857' },
  descartado:     { bg: '#F3F4F6', border: '#6B7280', text: '#374151' },
};

const STAGE_ORDER = ['nurturing', 'reunion', 'subida_docs', 'doc_completada'];

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function getSuggestions(card, contacts) {
  if (card.etapa === 'descartado') return null;
  const contact = contacts.find(c => c.email === card.email);
  if (!contact) return null;

  if (card.etapa === 'nurturing') {
    const numInteractions = (contact.numAperturas || 0) + (contact.numClics || 0);
    if (numInteractions >= 4) return { stage: 'reunion', label: 'Sugerir → Reunión' };
  }

  const notesStr = JSON.stringify(card.notas || []).toLowerCase();
  const keywords = ['reunion', 'reunión', 'llamada', 'meeting', 'call', 'agenda'];
  if (card.etapa !== 'reunion' && card.etapa !== 'subida_docs' && card.etapa !== 'doc_completada') {
    if (keywords.some(k => notesStr.includes(k))) return { stage: 'reunion', label: 'Sugerir → Reunión' };
  }

  const negKeywords = ['no interesa', 'no estamos interesados', 'unsubscribe', 'baja'];
  if (negKeywords.some(k => notesStr.includes(k))) return { stage: 'descartado', label: 'Sugerir → Descartado' };

  return null;
}

// ============================================================
// MOCK DATA
// ============================================================
const MOCK = {
  actualizado: new Date().toISOString(),
  metricas: {
    total: 156, errores: 0,
    A: { enviados: 16, abiertos: 11, clics: 5, respondidos: 3, tasaApertura: 0.6875, tasaClics: 0.3125, tasaRespuesta: 0.1875 },
    B: { enviados: 16, abiertos: 9, clics: 7, respondidos: 4, tasaApertura: 0.5625, tasaClics: 0.4375, tasaRespuesta: 0.25 },
    Final: { total: 124, enviados: 0, pendientes: 124, abiertos: 0, clics: 0, respondidos: 0 },
  },
  contactos: [
    { email: "carlos.ruiz@solaren.es", nombre: "Carlos", apellido: "Ruiz", organizacion: "Solaren Energy", grupo: "Test", variante: "A", estado: "Respondido", fechaEnvio: "2026-02-14T10:00:00Z", primeraApertura: "2026-02-14T11:23:00Z", numAperturas: 4, primerClic: "2026-02-14T11:24:00Z", numClics: 2, respondido: "Sí" },
    { email: "ana.garcia@renovaplus.com", nombre: "Ana", apellido: "García", organizacion: "RenovaPlus", grupo: "Test", variante: "A", estado: "Clic", fechaEnvio: "2026-02-14T10:02:00Z", primeraApertura: "2026-02-14T14:05:00Z", numAperturas: 2, primerClic: "2026-02-14T14:06:00Z", numClics: 1, respondido: "No" },
    { email: "jorge.vidal@greenfield.eu", nombre: "Jorge", apellido: "Vidal", organizacion: "Greenfield Capital", grupo: "Test", variante: "B", estado: "Respondido", fechaEnvio: "2026-02-14T10:04:00Z", primeraApertura: "2026-02-14T12:30:00Z", numAperturas: 3, primerClic: "2026-02-14T12:31:00Z", numClics: 3, respondido: "Sí" },
    { email: "marta.lopez@sunvest.es", nombre: "Marta", apellido: "López", organizacion: "Sunvest Iberia", grupo: "Test", variante: "B", estado: "Abierto", fechaEnvio: "2026-02-14T10:06:00Z", primeraApertura: "2026-02-15T09:15:00Z", numAperturas: 1, primerClic: null, numClics: 0, respondido: "No" },
    { email: "pablo.sanchez@eolica.com", nombre: "Pablo", apellido: "Sánchez", organizacion: "Eólica Investments", grupo: "Test", variante: "A", estado: "Enviado", fechaEnvio: "2026-02-14T10:08:00Z", primeraApertura: null, numAperturas: 0, primerClic: null, numClics: 0, respondido: "No" },
    { email: "lucia.fernandez@helios.es", nombre: "Lucía", apellido: "Fernández", organizacion: "Helios Solar", grupo: "Test", variante: "A", estado: "Abierto", fechaEnvio: "2026-02-14T10:10:00Z", primeraApertura: "2026-02-15T16:42:00Z", numAperturas: 2, primerClic: null, numClics: 0, respondido: "No" },
    { email: "diego.martin@windcorp.eu", nombre: "Diego", apellido: "Martín", organizacion: "WindCorp Europe", grupo: "Test", variante: "B", estado: "Clic", fechaEnvio: "2026-02-14T10:12:00Z", primeraApertura: "2026-02-14T18:20:00Z", numAperturas: 5, primerClic: "2026-02-14T18:22:00Z", numClics: 2, respondido: "No" },
    { email: "elena.torres@photon.es", nombre: "Elena", apellido: "Torres", organizacion: "Photon Renewables", grupo: "Final", variante: "-", estado: "", fechaEnvio: null, primeraApertura: null, numAperturas: 0, primerClic: null, numClics: 0, respondido: "No" },
    { email: "marcos.diaz@solardev.es", nombre: "Marcos", apellido: "Díaz", organizacion: "SolarDev", grupo: "Test", variante: "B", estado: "Respondido", fechaEnvio: "2026-02-14T10:14:00Z", primeraApertura: "2026-02-14T15:10:00Z", numAperturas: 6, primerClic: "2026-02-14T15:12:00Z", numClics: 4, respondido: "Sí" },
    { email: "carmen.navarro@ibervolt.com", nombre: "Carmen", apellido: "Navarro", organizacion: "Ibervolt", grupo: "Test", variante: "A", estado: "Respondido", fechaEnvio: "2026-02-14T10:16:00Z", primeraApertura: "2026-02-14T13:45:00Z", numAperturas: 3, primerClic: "2026-02-14T13:47:00Z", numClics: 1, respondido: "Sí" },
  ],
};

const MOCK_PIPELINE = [
  { email: "carlos.ruiz@solaren.es", etapa: "nurturing", fechaCambio: "2026-02-18T10:00:00Z", notas: [{ fecha: "2026-02-16T10:00:00Z", texto: "Interesado en condiciones del programa" }, { fecha: "2026-02-18T10:00:00Z", texto: "Pregunta sobre plazos y garantías" }], sugerencia: null, fechaCreacion: "2026-02-15T10:00:00Z", etapaAnterior: null, historial: [{ etapa: "nurturing", fecha: "2026-02-15T10:00:00Z" }], ultimoEmail: { cuerpo: "Hola Leticia, me gustaría conocer las condiciones específicas del programa Bridge Debt para nuestro parque solar de 50MW en Extremadura...", fecha: "18/02/2026 10:00", esLeticia: false, totalMensajes: 3 } },
  { email: "jorge.vidal@greenfield.eu", etapa: "reunion", fechaCambio: "2026-02-19T14:00:00Z", notas: [{ fecha: "2026-02-17T09:00:00Z", texto: "Muy interesado, pide reunión" }, { fecha: "2026-02-19T14:00:00Z", texto: "Reunión agendada 25 feb 10:00" }], sugerencia: null, fechaCreacion: "2026-02-16T10:00:00Z", etapaAnterior: "nurturing", historial: [{ etapa: "nurturing", fecha: "2026-02-16T10:00:00Z" }, { etapa: "reunion", fecha: "2026-02-19T14:00:00Z" }], ultimoEmail: { cuerpo: "Perfecto, agendamos para el martes 25 a las 10:00. Nos conectamos por Teams.", fecha: "19/02/2026 14:00", esLeticia: true, totalMensajes: 5 } },
  { email: "marcos.diaz@solardev.es", etapa: "nurturing", fechaCambio: "2026-02-15T15:10:00Z", notas: [{ fecha: "2026-02-15T15:10:00Z", texto: "Pidió más información sobre el programa" }], sugerencia: null, fechaCreacion: "2026-02-15T15:10:00Z", etapaAnterior: null, historial: [{ etapa: "nurturing", fecha: "2026-02-15T15:10:00Z" }], ultimoEmail: { cuerpo: "Buenos días, he recibido su email sobre el Bridge Debt Energy Program. Tenemos un proyecto en fase RTB de 30MW y nos interesaría...", fecha: "15/02/2026 15:10", esLeticia: false, totalMensajes: 2 } },
  { email: "carmen.navarro@ibervolt.com", etapa: "subida_docs", fechaCambio: "2026-02-20T11:00:00Z", notas: [{ fecha: "2026-02-16T13:45:00Z", texto: "Interesada en financiación puente" }, { fecha: "2026-02-18T10:00:00Z", texto: "Reunión completada, envía docs parciales" }, { fecha: "2026-02-20T11:00:00Z", texto: "Subió balance y proyecciones, falta PPA" }], sugerencia: null, fechaCreacion: "2026-02-16T13:45:00Z", etapaAnterior: "reunion", historial: [{ etapa: "nurturing", fecha: "2026-02-16T13:45:00Z" }, { etapa: "reunion", fecha: "2026-02-18T10:00:00Z" }, { etapa: "subida_docs", fecha: "2026-02-20T11:00:00Z" }], ultimoEmail: { cuerpo: "Adjunto el balance y las proyecciones del proyecto. El PPA lo tendremos firmado la próxima semana.", fecha: "20/02/2026 11:00", esLeticia: false, totalMensajes: 7 } },
];

// ============================================================
// HELPERS
// ============================================================
const pct = (n) => (n * 100).toFixed(1) + "%";
const fmtDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

const GENERIC_DOMAINS = ['gmail.com','hotmail.com','outlook.com','yahoo.com','live.com','icloud.com','protonmail.com'];

function getDisplayName(contact) {
  const org = contact.organizacion?.trim();
  const firstName = (contact.nombre || '').trim().toLowerCase();
  // If org looks like a real company name (not just the person's first name), use it
  if (org && org.toLowerCase() !== firstName) return org;
  // Fallback: derive company name from email domain
  const domain = contact.email?.split('@')[1];
  if (domain && !GENERIC_DOMAINS.includes(domain))
    return domain.replace(/\.(com|es|net|org|eu|io)$/,'').split(/[-_.]/).map(w => w[0].toUpperCase()+w.slice(1)).join(' ');
  // If org exists but matched first name, still use it over generic
  if (org) return org;
  return `${contact.nombre||''} ${contact.apellido||''}`.trim() || contact.email;
}

// ============================================================
// GLOBAL STYLES
// ============================================================
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; color: ${T.text}; font-family: ${T.sans}; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: ${T.bg}; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${T.muted}; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;

// ============================================================
// COMPONENTS
// ============================================================

function KPI({ label, value, sub, color = T.title, onClick }) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => clickable && setHovered(true)}
      onMouseLeave={() => clickable && setHovered(false)}
      style={{
        background: hovered ? T.primaryBg : T.white,
        borderRadius: 12,
        padding: "18px 20px",
        border: `1px solid ${hovered ? T.primary : T.border}`,
        borderTop: `3px solid ${color}`,
        animation: "fadeUp 0.4s ease both",
        cursor: clickable ? "pointer" : "default",
        transition: "background 0.15s, border-color 0.15s",
        position: "relative",
      }}
    >
      {clickable && (
        <div style={{
          position: "absolute",
          top: 10,
          right: 14,
          fontSize: 11,
          color: hovered ? T.primary : T.dim,
          transition: "color 0.15s",
          fontWeight: 600,
          letterSpacing: "0.02em",
        }}>Ver →</div>
      )}
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: T.muted,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontSize: 20,
        fontWeight: 600,
        color: hovered ? T.primary : color,
        fontFamily: T.sans,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        transition: "color 0.15s",
      }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: T.muted, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

function Funnel({ label, count, total, color, idx = 0 }) {
  const [w, setW] = useState(0);
  useEffect(() => { setTimeout(() => setW(total > 0 ? (count / total) * 100 : 0), 150 + idx * 120); }, [count, total, idx]);
  const rate = total > 0 ? pct(count / total) : "0%";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 80px", alignItems: "center", gap: 16, padding: "12px 0" }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: T.text }}>{label}</span>
      <div style={{ height: 8, borderRadius: 4, background: T.borderLight, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          borderRadius: 4,
          width: `${w}%`,
          background: color,
          transition: "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
        }} />
      </div>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontFamily: T.sans, fontSize: 15, fontWeight: 700, color: T.title }}>{count}</span>
        <span style={{ fontSize: 12, color: T.muted, marginLeft: 6 }}>{rate}</span>
      </div>
    </div>
  );
}

function ABMetric({ label, a, b, fmt = "pct", aTotal, bTotal }) {
  const dA = fmt === "pct" ? pct(a) : a;
  const dB = fmt === "pct" ? pct(b) : b;
  const win = a > b ? "A" : b > a ? "B" : null;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 140px 1fr",
      alignItems: "center",
      padding: "16px 0",
      borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontFamily: T.sans,
          fontSize: 22,
          fontWeight: 700,
          color: win === "A" ? T.primary : T.title,
        }}>{dA}</span>
        {fmt === "pct" && aTotal !== undefined && (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2, fontFamily: T.sans }}>
            ({Math.round(a * aTotal)}/{aTotal})
          </div>
        )}
        {win === "A" && <div style={{ fontSize: 10, fontWeight: 600, color: T.emerald, marginTop: 4 }}>● MEJOR</div>}
      </div>
      <div style={{
        textAlign: "center",
        fontSize: 12,
        fontWeight: 600,
        color: T.muted,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}>{label}</div>
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontFamily: T.sans,
          fontSize: 22,
          fontWeight: 700,
          color: win === "B" ? T.emerald : T.title,
        }}>{dB}</span>
        {fmt === "pct" && bTotal !== undefined && (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2, fontFamily: T.sans }}>
            ({Math.round(b * bTotal)}/{bTotal})
          </div>
        )}
        {win === "B" && <div style={{ fontSize: 10, fontWeight: 600, color: T.emerald, marginTop: 4 }}>● MEJOR</div>}
      </div>
    </div>
  );
}

function StatusBadge({ estado }) {
  let s;
  if (estado?.startsWith("Error")) {
    s = { c: T.red, bg: T.redBg };
  } else {
    const map = {
      Respondido: { c: T.emerald, bg: T.emeraldBg },
      Clic:       { c: T.primary, bg: T.primaryBg },
      Abierto:    { c: T.amber, bg: T.amberBg },
      Enviado:    { c: T.muted, bg: T.sidebar },
      "":         { c: T.dim, bg: "transparent" },
    };
    s = map[estado] || map[""];
  }
  const displayText = estado?.startsWith("Error") ? "Error" : (estado || "Pendiente");
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 13,
      fontWeight: 500,
      color: s.c,
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: s.c,
      }} />
      {displayText}
    </span>
  );
}

function VarBadge({ v }) {
  if (!v || v === "-") return <span style={{ color: T.dim }}>—</span>;
  const isA = v === "A";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 28,
      height: 28,
      borderRadius: 7,
      fontSize: 12,
      fontWeight: 700,
      fontFamily: T.sans,
      color: T.white,
      background: isA ? T.primary : T.emerald,
    }}>{v}</span>
  );
}

function TabBtn({ active, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "#1E293B" : "transparent",
      color: active ? "#FFFFFF" : T.muted,
      border: "none",
      borderRadius: 8,
      padding: "10px 20px",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: T.sans,
      transition: "all 0.2s",
    }}>{label}</button>
  );
}

function FilterChip({ active, label, count, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? T.primaryBg : "transparent",
      color: active ? T.primary : T.muted,
      border: `1px solid ${active ? T.primary : T.border}`,
      borderRadius: 8,
      padding: "6px 14px",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 500,
      fontFamily: T.sans,
      transition: "all 0.2s",
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: active ? T.primary : T.dim,
        }}>({count})</span>
      )}
    </button>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: T.white,
      borderRadius: 14,
      padding: 24,
      border: `1px solid ${T.border}`,
      animation: "fadeUp 0.4s ease both",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      ...style,
    }}>{children}</div>
  );
}

function CardTitle({ children }) {
  return (
    <h3 style={{
      margin: "0 0 20px 0",
      fontSize: 12,
      fontWeight: 700,
      color: T.muted,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}>{children}</h3>
  );
}

function RateBox({ label, value, color }) {
  return (
    <div style={{
      background: T.bg,
      borderRadius: 12,
      padding: 18,
      textAlign: "center",
      border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontFamily: T.sans,
        fontSize: 24,
        fontWeight: 700,
        color,
        letterSpacing: "-0.02em",
      }}>{value}</div>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: T.muted,
        marginTop: 6,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}>{label}</div>
    </div>
  );
}

// ============================================================
// EMPRESAS TAB — HELPERS & COMPONENTS
// ============================================================

const STATUS_RANK = { Respondido: 5, Clic: 4, Abierto: 3, Enviado: 2, Error: 1, "": 0 };
function getStatusRank(estado) {
  if (estado?.startsWith("Error")) return STATUS_RANK.Error;
  return STATUS_RANK[estado] || 0;
}
function getBestStatus(contactos) {
  let best = 0, bestEstado = "";
  for (const c of contactos) {
    const r = getStatusRank(c.estado);
    if (r > best) { best = r; bestEstado = c.estado; }
  }
  return bestEstado;
}
function statusColor(estado) {
  if (estado?.startsWith("Error")) return T.red;
  const map = { Respondido: T.emerald, Clic: T.primary, Abierto: T.amber, Enviado: T.muted };
  return map[estado] || T.border;
}

function buildCompanyData(contacts) {
  const byOrg = {};
  for (const c of contacts) {
    const org = (c.organizacion || "Sin organización").trim();
    if (!byOrg[org]) byOrg[org] = [];
    byOrg[org].push(c);
  }
  return Object.entries(byOrg).map(([org, contactos]) => {
    const enviados = contactos.filter(c => c.estado).length;
    const abiertos = contactos.filter(c => (c.numAperturas || 0) > 0).length;
    const clics = contactos.filter(c => (c.numClics || 0) > 0).length;
    const respondidos = contactos.filter(c => c.respondido === "Si" || c.respondido === "Sí" || c.estado === "Respondido").length;
    const errores = contactos.filter(c => c.estado?.startsWith("Error")).length;
    const bestStatus = getBestStatus(contactos);
    // Sort contacts within company: best engagement first
    contactos.sort((a, b) => getStatusRank(b.estado) - getStatusRank(a.estado));
    return { org, contactos, total: contactos.length, enviados, abiertos, clics, respondidos, errores, bestStatus, bestRank: getStatusRank(bestStatus) };
  });
}

// Group pipeline cards by company — returns one entry per org with most advanced stage
function groupPipelineByCompany(cards, contacts) {
  const byOrg = {};
  for (const card of cards) {
    const ct = contacts.find(c => c.email === card.email);
    let org = ct?.organizacion?.trim();
    if (!org) {
      // Fallback: derive from email domain
      const domain = card.email?.split('@')[1];
      if (domain && !GENERIC_DOMAINS.includes(domain))
        org = domain.replace(/\.(com|es|net|org|eu|io)$/,'').split(/[-_.]/).map(w => w[0].toUpperCase()+w.slice(1)).join(' ');
      else
        org = 'Sin organizacion';
    }
    if (!byOrg[org]) byOrg[org] = [];
    byOrg[org].push({ ...card, _contact: ct });
  }

  return Object.entries(byOrg).map(([org, groupCards]) => {
    // Sort by stage advancement (most advanced first)
    groupCards.sort((a, b) => STAGE_ORDER.indexOf(b.etapa) - STAGE_ORDER.indexOf(a.etapa));

    // If ALL are descartado, company is descartado
    const allDescartado = groupCards.every(c => c.etapa === 'descartado');

    // Best stage = most advanced non-descartado stage, or descartado if all are
    let bestStage = 'descartado';
    if (!allDescartado) {
      const activeCards = groupCards.filter(c => c.etapa !== 'descartado');
      activeCards.sort((a, b) => STAGE_ORDER.indexOf(b.etapa) - STAGE_ORDER.indexOf(a.etapa));
      bestStage = activeCards[0]?.etapa || 'descartado';
    }

    // Representative card = the one with best stage (for fechaCambio, notas, etc.)
    const rep = groupCards.find(c => c.etapa === bestStage) || groupCards[0];

    // Build contacts list with individual stages
    const subContacts = groupCards.map(c => ({
      email: c.email,
      nombre: c._contact?.nombre || '',
      apellido: c._contact?.apellido || '',
      etapa: c.etapa,
      fechaCambio: c.fechaCambio,
      card: c,
    }));

    return {
      ...rep,
      etapa: bestStage,
      _isCompanyGroup: true,
      _org: org,
      _contacts: subContacts,
      _contactCount: groupCards.length,
      // Most recent fechaCambio across all contacts
      fechaCambio: groupCards.reduce((latest, c) => {
        if (!c.fechaCambio) return latest;
        if (!latest) return c.fechaCambio;
        return c.fechaCambio > latest ? c.fechaCambio : latest;
      }, null),
    };
  });
}

function exportCampaignCSV(companies) {
  const headers = ["Empresa", "Dominio", "Contactos", "Abiertos", "Clics", "Respondidos", "Errores", "MejorEstado"];
  const rows = companies.map(c => {
    // Extract domain from the first contact email
    const emails = c.contactos.map(ct => ct.email).filter(Boolean);
    const domain = emails.length > 0
      ? emails[0].split("@")[1] || ""
      : "";
    return [c.org, domain, c.total, c.abiertos, c.clics, c.respondidos, c.errores, c.bestStatus];
  });
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = "alter5_campaign_for_bi.csv"; a.click();
  URL.revokeObjectURL(url);
}

function exportContactsCSV(contacts) {
  const headers = ["Email", "Nombre", "Apellido", "Organizacion", "Grupo", "Variante", "Estado", "Aperturas", "Clics", "Respondido", "FechaEnvio", "PrimeraApertura"];
  const rows = contacts.map(c => [
    c.email, c.nombre || '', c.apellido || '', c.organizacion || '',
    c.grupo || '', c.variante || '', c.estado || '',
    c.numAperturas || 0, c.numClics || 0, c.respondido || 'No',
    c.fechaEnvio || '', c.primeraApertura || '',
  ]);
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = "alter5_contactos.csv"; a.click();
  URL.revokeObjectURL(url);
}

function fmtShortDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function CompanyRow({ company, expanded, onToggle }) {
  const [hovered, setHovered] = useState(false);
  const { org, contactos, total, abiertos, clics, respondidos, bestStatus } = company;
  const borderColor = statusColor(bestStatus);

  // Build engagement summary
  const parts = [];
  if (abiertos > 0) parts.push(`${abiertos} apert.`);
  if (clics > 0) parts.push(`${clics} clic${clics > 1 ? "s" : ""}`);
  if (respondidos > 0) parts.push(`${respondidos} resp.`);

  return (
    <div>
      <div
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 20px",
          background: hovered ? T.bg : T.white,
          borderBottom: `1px solid ${T.border}`,
          cursor: "pointer",
          transition: "background 0.15s",
          position: "relative",
          borderLeft: `4px solid ${borderColor}`,
        }}
      >
        {/* Company name + count */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15,
            fontWeight: 600,
            color: T.title,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>{org}</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>
            {total} contacto{total > 1 ? "s" : ""}
          </div>
        </div>

        {/* Best engagement badge */}
        <div style={{ flexShrink: 0, margin: "0 16px" }}>
          <StatusBadge estado={bestStatus} />
        </div>

        {/* Engagement summary */}
        <div style={{
          flexShrink: 0,
          width: 220,
          textAlign: "right",
          fontSize: 13,
          color: T.muted,
        }}>
          {parts.length > 0 ? parts.join(" · ") : "—"}
        </div>

        {/* Chevron */}
        <span style={{
          flexShrink: 0,
          marginLeft: 12,
          fontSize: 12,
          color: T.muted,
          transition: "transform 0.2s ease",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          display: "inline-block",
        }}>▶</span>
      </div>

      {/* Expanded contacts */}
      {expanded && (
        <div style={{
          borderBottom: `1px solid ${T.border}`,
          borderLeft: `4px solid ${T.border}`,
        }}>
          {contactos.map((c, i) => {
            const timeline = [];
            if (c.fechaEnvio) timeline.push(`Enviado ${fmtShortDate(c.fechaEnvio)}`);
            if (c.primeraApertura) timeline.push(`Abierto ${fmtShortDate(c.primeraApertura)}${(c.numAperturas || 0) > 1 ? ` (${c.numAperturas}×)` : ""}`);
            if (c.primerClic) timeline.push(`Clic ${fmtShortDate(c.primerClic)}${(c.numClics || 0) > 1 ? ` (${c.numClics}×)` : ""}`);
            if (c.estado === "Respondido") timeline.push("Respondido");

            return (
              <div key={c.email || i} style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 20px 10px 40px",
                background: T.bg,
                borderBottom: i < contactos.length - 1 ? `1px solid ${T.border}50` : "none",
              }}>
                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: T.text }}>
                    {c.nombre} {c.apellido}
                  </span>
                  <span style={{ fontSize: 12, color: T.dim, marginLeft: 8 }}>{c.email}</span>
                </div>

                {/* Variante */}
                {c.variante && c.variante !== "-" && (
                  <span style={{
                    flexShrink: 0,
                    padding: "2px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: T.sans,
                    borderRadius: 4,
                    color: T.muted,
                    border: `1px solid ${T.border}`,
                    marginRight: 8,
                  }}>{c.variante}</span>
                )}

                {/* Status badge */}
                <div style={{ flexShrink: 0, margin: "0 12px" }}>
                  <StatusBadge estado={c.estado} />
                </div>

                {/* Timeline */}
                <div style={{
                  flexShrink: 0,
                  width: 320,
                  textAlign: "right",
                  fontSize: 12,
                  fontFamily: T.sans,
                  color: T.muted,
                }}>
                  {timeline.join(" · ") || "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FollowUpRow({ item, onClick, onDismiss }) {
  const [hovered, setHovered] = useState(false);
  const [dismissHovered, setDismissHovered] = useState(false);
  const sc = item.stage ? (STAGE_COLORS[item.stage] || STAGE_COLORS.nurturing) : null;
  const stageLabel = item.stage ? (PIPELINE_STAGES.find(s => s.id === item.stage)?.label || item.stage) : null;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderRadius: 8,
        cursor: "pointer",
        background: hovered ? T.primaryBg : "transparent",
        transition: "background 0.15s",
      }}
    >
      {/* Stage color dot */}
      <div style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: sc ? sc.border : T.primary,
        boxShadow: sc ? `0 0 0 3px ${sc.bg}` : `0 0 0 3px ${T.primaryBg}`,
      }} />

      {/* Company name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.title, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.displayName}
        </div>
        <div style={{ fontSize: 12, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.personName}{item.personName && ' · '}{item.email}
        </div>
      </div>

      {/* Stage badge */}
      {sc && stageLabel && (
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: sc.text, background: sc.bg,
          padding: '3px 10px', borderRadius: 6, flexShrink: 0,
        }}>{stageLabel}</span>
      )}

      {/* Priority badge */}
      {!item.stage && (
        <StatusBadge estado={item.contact.estado} />
      )}

      <span style={{ fontSize: 12, color: T.dim, flexShrink: 0, minWidth: 60, textAlign: "right" }}>
        {timeAgo(item.lastDate)}
      </span>

      {/* Dismiss button */}
      <button
        onClick={e => { e.stopPropagation(); onDismiss(item.key); }}
        onMouseEnter={() => setDismissHovered(true)}
        onMouseLeave={() => setDismissHovered(false)}
        style={{
          background: dismissHovered ? T.redBg : 'transparent',
          border: `1px solid ${dismissHovered ? T.red + '55' : 'transparent'}`,
          borderRadius: 6, padding: '2px 6px', cursor: 'pointer',
          fontSize: 13, color: dismissHovered ? T.red : T.dim,
          flexShrink: 0, transition: 'all 0.15s', lineHeight: 1,
        }}
        title="Ocultar de seguimiento"
      >✕</button>
    </div>
  );
}

// ============================================================
// RESPONSE ITEM COMPONENT
// ============================================================

function ResponseItem({ contact, pipelineCard, isExpanded, onToggle, onMoveStage, onViewDetail, onOpenPanel, onDismiss, onComposeFromInstructions, composeInstrLoading, isResponded }) {
  const [hovered, setHovered] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [generatedDraft, setGeneratedDraft] = useState(null);
  const displayName = getDisplayName(contact);
  const personName = `${contact.nombre || ''} ${contact.apellido || ''}`.trim();
  const hasTeamReply = isResponded !== undefined ? isResponded : (contact.respuestaEnviada === "Si" || contact.respuestaEnviada === "Sí");
  const statusColor = hasTeamReply ? T.emerald : T.red;

  const responseDate = pipelineCard?.ultimoEmail?.fecha || contact.primeraApertura || contact.fechaEnvio;
  let responseDateISO = responseDate;
  if (responseDate && responseDate.includes('/')) {
    const [datePart, timePart] = responseDate.split(' ');
    const [day, month, year] = datePart.split('/');
    responseDateISO = `${year}-${month}-${day}T${timePart || '00:00'}:00Z`;
  }

  const messageBody = pipelineCard?.ultimoEmail?.cuerpo;
  const totalMessages = pipelineCard?.ultimoEmail?.totalMensajes || 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: T.white,
        borderRadius: 12,
        border: `1px solid ${hovered ? T.border : T.borderLight}`,
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? '0 2px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.03)',
        animation: 'fadeUp 0.3s ease both',
      }}
    >
      {/* Collapsed header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px', cursor: 'pointer',
          background: isExpanded ? T.bg : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        {/* Status dot */}
        <div style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: statusColor,
          boxShadow: `0 0 0 3px ${hasTeamReply ? T.emeraldBg : T.redBg}`,
        }} />

        {/* Company name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: T.title,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{displayName}</div>
          <div style={{
            fontSize: 12, color: T.muted, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {personName && personName !== displayName && <>{personName} · </>}
            {contact.email}
            {responseDateISO && <> · {timeAgo(responseDateISO)}</>}
          </div>
        </div>

        {/* Messages badge */}
        {totalMessages > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600, fontFamily: T.sans,
            color: T.primary, background: T.primaryBg,
            padding: '2px 8px', borderRadius: 4, flexShrink: 0,
          }}>{totalMessages} msgs</span>
        )}

        {/* Pipeline stage badge */}
        {pipelineCard && pipelineCard.etapa !== 'nurturing' && (() => {
          const sc2 = STAGE_COLORS[pipelineCard.etapa] || STAGE_COLORS.nurturing;
          const sl = PIPELINE_STAGES.find(s => s.id === pipelineCard.etapa)?.label || pipelineCard.etapa;
          return (
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: sc2.text, background: sc2.bg,
              padding: '3px 10px', borderRadius: 6, flexShrink: 0,
            }}>{sl}</span>
          );
        })()}

        {/* Status badge */}
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: hasTeamReply ? T.emerald : T.amber,
          background: hasTeamReply ? T.emeraldBg : T.amberBg,
          padding: '3px 10px', borderRadius: 6, flexShrink: 0,
        }}>{hasTeamReply ? 'Respondida' : 'Pendiente'}</span>

        {/* Chevron */}
        <span style={{
          fontSize: 16, color: T.muted, flexShrink: 0,
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }}>▾</span>

        {/* Dismiss button */}
        {onDismiss && (
          <span
            onClick={(e) => { e.stopPropagation(); onDismiss(contact.email); }}
            title="Ocultar de la lista"
            style={{
              fontSize: 14, color: T.muted, flexShrink: 0, cursor: 'pointer',
              width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 4, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.redBg; e.currentTarget.style.color = T.red; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = T.muted; }}
          >✕</span>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${T.border}` }}>
          {/* Message card */}
          <div style={{ marginTop: 14 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: T.muted, marginBottom: 6,
            }}>Mensaje original</div>
            {messageBody ? (
              <div style={{
                background: T.bg, borderRadius: 8, padding: '12px 14px',
                fontSize: 13, lineHeight: 1.6, color: T.text,
                borderLeft: `3px solid ${T.emerald}`,
                maxHeight: 200, overflowY: 'auto',
              }}>{messageBody}</div>
            ) : (
              <div style={{
                background: T.bg, borderRadius: 8, padding: '20px 14px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.4 }}>📭</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.muted }}>No hay contenido disponible</div>
                <div style={{ fontSize: 12, color: T.dim, marginTop: 4 }}>
                  El sistema detectó una respuesta pero no pudo extraer el texto
                </div>
              </div>
            )}
          </div>

          {/* Draft card */}
          {pipelineCard?.ultimoEmail?.esLeticia && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: T.muted, marginBottom: 6,
              }}>Borrador IA</div>
              <div style={{
                background: T.blueBg, borderRadius: 8, padding: '12px 14px',
                fontSize: 13, lineHeight: 1.6, color: T.text,
                borderLeft: `3px solid ${T.primary}`,
                maxHeight: 200, overflowY: 'auto',
              }}>{pipelineCard.ultimoEmail.cuerpo}</div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            {/* Ver conversación — opens PipelineDetail or SlideOverPanel */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (pipelineCard && onViewDetail) onViewDetail(pipelineCard);
                else if (onOpenPanel) onOpenPanel(contact);
              }}
              style={{
                background: T.primaryBg, color: T.primary,
                border: `1px solid ${T.primary}`, borderRadius: 8,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: T.sans, transition: 'all 0.15s',
              }}
            >Ver conversación</button>
            {/* Redactar con IA */}
            <button
              onClick={(e) => { e.stopPropagation(); setShowCompose(!showCompose); setGeneratedDraft(null); }}
              style={{
                background: showCompose ? T.primary : T.white, color: showCompose ? T.white : T.primary,
                border: `1px solid ${T.primary}`, borderRadius: 8,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: T.sans, transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >&#9998; Redactar con IA</button>
            {/* Stage actions — show for nurturing or no pipeline card */}
            {(!pipelineCard || pipelineCard.etapa === 'nurturing') && (
              <button
                onClick={(e) => { e.stopPropagation(); onMoveStage(contact.email, 'reunion'); }}
                style={{
                  background: STAGE_COLORS.reunion.bg, color: STAGE_COLORS.reunion.text,
                  border: `1px solid ${STAGE_COLORS.reunion.border}`, borderRadius: 8,
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  fontFamily: T.sans, transition: 'all 0.15s',
                }}
              >→ Reunión</button>
            )}
            {/* Descartar */}
            <button
              onClick={(e) => { e.stopPropagation(); onMoveStage(contact.email, 'descartado'); }}
              style={{
                background: 'transparent', color: T.muted,
                border: `1px solid ${T.border}`, borderRadius: 8,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: T.sans, transition: 'all 0.15s', marginLeft: 'auto',
              }}
            >Descartar</button>
          </div>

          {/* Compose from instructions UI */}
          {showCompose && (
            <div style={{ marginTop: 14, background: T.bg, borderRadius: 10, padding: 16, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.title, marginBottom: 8 }}>
                Instrucciones para la IA
              </div>
              <textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder='Ej: "Dile que le envío el NDA y propongo llamada el jueves a las 10h"'
                style={{
                  width: '100%', minHeight: 80, padding: '10px 12px', fontSize: 13,
                  fontFamily: T.sans, borderRadius: 8, border: `1px solid ${T.border}`,
                  background: T.white, color: T.text, resize: 'vertical', lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!instructions.trim()) return;
                    const result = await onComposeFromInstructions(contact.email, instructions.trim());
                    if (result) setGeneratedDraft(result.borrador);
                  }}
                  disabled={!instructions.trim() || composeInstrLoading === contact.email}
                  style={{
                    background: T.primary, color: T.white, border: 'none', borderRadius: 8,
                    padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: T.sans, opacity: (!instructions.trim() || composeInstrLoading === contact.email) ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >{composeInstrLoading === contact.email ? 'Generando...' : 'Generar borrador'}</button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowCompose(false); setGeneratedDraft(null); setInstructions(''); }}
                  style={{
                    background: 'transparent', color: T.muted, border: `1px solid ${T.border}`,
                    borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: T.sans,
                  }}
                >Cancelar</button>
              </div>

              {/* Generated draft preview */}
              {generatedDraft && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Borrador generado
                  </div>
                  <div
                    style={{
                      background: T.white, borderRadius: 8, padding: '14px 16px',
                      fontSize: 13, lineHeight: 1.7, color: T.text,
                      borderLeft: `3px solid ${T.primary}`,
                      maxHeight: 300, overflowY: 'auto',
                    }}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(generatedDraft) }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pipelineCard && onViewDetail) onViewDetail(pipelineCard);
                      else if (onOpenPanel) onOpenPanel(contact);
                    }}
                    style={{
                      marginTop: 10, background: T.emerald, color: T.white, border: 'none',
                      borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', fontFamily: T.sans,
                    }}
                  >Ver borrador y enviar</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// PIPELINE COMPONENTS
// ============================================================

function PipelineKPIs({ cards, tab, onFilterChange, contacts }) {
  const isInt = (email) => email.toLowerCase().endsWith('@alter-5.com') || email.toLowerCase().endsWith('@alter5.com');
  const external = cards.filter(c => !isInt(c.email));
  // Group by company for accurate counts
  const groups = groupPipelineByCompany(external, contacts || []);
  const activeGroups = groups.filter(g => g.etapa !== 'descartado');

  if (tab === 'prospects') {
    const prospectGroups = activeGroups.filter(g => g.etapa === 'nurturing' || g.etapa === 'reunion');
    const nurturing = prospectGroups.filter(g => g.etapa === 'nurturing').length;
    const reunion = prospectGroups.filter(g => g.etapa === 'reunion').length;
    const total = nurturing + reunion;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        <KPI label="Total prospects" value={total} sub="empresas" color={T.primary} onClick={onFilterChange ? () => onFilterChange("todas") : undefined} />
        <KPI label="Nurturing" value={nurturing} sub={total > 0 ? pct(nurturing / total) + ' del total' : ''} color={STAGE_COLORS.nurturing.border} onClick={onFilterChange ? () => onFilterChange("nurturing") : undefined} />
        <KPI label="Reuniones" value={reunion} sub={total > 0 ? pct(reunion / total) + ' del total' : ''} color={STAGE_COLORS.reunion.border} onClick={onFilterChange ? () => onFilterChange("reunion") : undefined} />
      </div>
    );
  }
  const oppGroups = activeGroups.filter(g => g.etapa === 'subida_docs' || g.etapa === 'doc_completada');
  const subidaDocs = oppGroups.filter(g => g.etapa === 'subida_docs').length;
  const docCompletada = oppGroups.filter(g => g.etapa === 'doc_completada').length;
  const total = subidaDocs + docCompletada;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
      <KPI label="Total" value={total} sub="empresas" color={T.primary} onClick={onFilterChange ? () => onFilterChange("todas") : undefined} />
      <KPI label="Subida docs" value={subidaDocs} sub="en proceso" color={STAGE_COLORS.subida_docs.border} onClick={onFilterChange ? () => onFilterChange("subida_docs") : undefined} />
      <KPI label="Completada" value={docCompletada} sub="listas" color={STAGE_COLORS.doc_completada.border} onClick={onFilterChange ? () => onFilterChange("doc_completada") : undefined} />
    </div>
  );
}

function PipelineListItem({ card, contact, isExpanded, onToggle, onViewDetail, onMoveCard, onGenerateFollowUp, followUpLoading, onComposeFromInstructions, composeInstrLoading }) {
  const [hovered, setHovered] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeInstr, setComposeInstr] = useState('');
  const [composeDraft, setComposeDraft] = useState(null);
  const sc = STAGE_COLORS[card.etapa] || STAGE_COLORS.descartado;
  const days = daysSince(card.fechaCambio);
  const displayContact = contact || { email: card.email, organizacion: '', nombre: '', apellido: '' };
  const isGroup = card._isCompanyGroup && card._contactCount > 1;
  const displayName = isGroup ? card._org : getDisplayName(displayContact);
  const personName = isGroup
    ? card._contacts.map(sc => `${sc.nombre} ${sc.apellido}`.trim()).filter(Boolean).join(', ')
    : `${displayContact.nombre || ''} ${displayContact.apellido || ''}`.trim();
  const stageLabel = PIPELINE_STAGES.find(s => s.id === card.etapa)?.label || card.etapa;
  const totalMessages = card.ultimoEmail?.totalMensajes || 0;
  const messageBody = card.ultimoEmail?.cuerpo;
  const lastNote = (card.notas && card.notas.length > 0) ? card.notas[card.notas.length - 1] : null;

  // Next stages for action buttons
  const nextStages = {
    nurturing: [{ id: 'reunion', label: 'Reunion' }],
    reunion: [{ id: 'subida_docs', label: 'Subida docs' }],
    subida_docs: [{ id: 'doc_completada', label: 'Doc completada' }],
    doc_completada: [],
  };
  const actions = nextStages[card.etapa] || [];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: T.white, borderRadius: 12,
        border: `1px solid ${hovered ? T.border : T.borderLight}`,
        overflow: 'hidden', transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? '0 2px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.03)',
        animation: 'fadeUp 0.3s ease both',
      }}
    >
      {/* Collapsed header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px', cursor: 'pointer',
          background: isExpanded ? T.bg : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        {/* Stage color dot */}
        <div style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: sc.border,
          boxShadow: `0 0 0 3px ${sc.bg}`,
        }} />

        {/* Company name + person */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: T.title,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {displayName}
            {isGroup && (
              <span style={{
                fontSize: 11, fontWeight: 600, fontFamily: T.sans,
                color: T.primary, background: T.primaryBg,
                padding: '1px 7px', borderRadius: 4, flexShrink: 0,
              }}>{card._contactCount} contactos</span>
            )}
          </div>
          <div style={{
            fontSize: 12, color: T.muted, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {isGroup
              ? <>{personName}{card.fechaCambio && <> · {timeAgo(card.fechaCambio)}</>}</>
              : <>{personName && personName !== displayName && <>{personName} · </>}{card.email}{card.fechaCambio && <> · {timeAgo(card.fechaCambio)}</>}</>
            }
          </div>
        </div>

        {/* Conversation button — opens slider directly */}
        <span
          onClick={e => { e.stopPropagation(); onViewDetail(card); }}
          title="Ver conversación"
          style={{
            fontSize: 11, fontWeight: 600, fontFamily: T.sans,
            color: T.primary, background: T.primaryBg,
            padding: '3px 10px', borderRadius: 6, flexShrink: 0,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            border: `1px solid transparent`, transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = T.primary + '44'; e.currentTarget.style.background = T.primary + '18'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = T.primaryBg; }}
        >
          <span style={{ fontSize: 13 }}>&#128172;</span>
          {totalMessages > 0 ? `${totalMessages} msgs` : 'Ver'}
        </span>

        {/* Stage badge */}
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: sc.text, background: sc.bg,
          padding: '3px 10px', borderRadius: 6, flexShrink: 0,
        }}>{stageLabel}</span>

        {/* Days badge */}
        <span style={{
          fontSize: 11, fontWeight: 600, fontFamily: T.sans,
          color: days > 7 ? T.amber : T.muted,
          background: days > 7 ? T.amberBg : T.bg,
          padding: '2px 8px', borderRadius: 4, flexShrink: 0,
        }}>{days}d</span>

        {/* Chevron */}
        <span style={{
          fontSize: 16, color: T.muted, flexShrink: 0,
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }}>▾</span>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${T.border}` }}>
          {/* Message preview */}
          <div style={{ marginTop: 14 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: T.muted, marginBottom: 6,
            }}>Ultimo mensaje</div>
            {messageBody ? (
              <div style={{
                background: T.bg, borderRadius: 8, padding: '12px 14px',
                fontSize: 13, lineHeight: 1.6, color: T.text,
                borderLeft: `3px solid ${card.ultimoEmail?.esLeticia ? T.primary : T.emerald}`,
                maxHeight: 200, overflowY: 'auto',
              }}>{messageBody}</div>
            ) : (
              <div style={{
                background: T.bg, borderRadius: 8, padding: '16px 14px',
                textAlign: 'center', color: T.dim, fontSize: 13,
              }}>Sin preview disponible</div>
            )}
          </div>

          {/* Last note */}
          {lastNote && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: T.muted, marginBottom: 6,
              }}>Ultima nota</div>
              <div style={{
                background: T.amberBg, borderRadius: 8, padding: '10px 14px',
                fontSize: 12, lineHeight: 1.5, color: T.text,
                borderLeft: `3px solid ${T.amber}`,
              }}>
                {lastNote.texto}
                <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>{timeAgo(lastNote.fecha)}</div>
              </div>
            </div>
          )}

          {/* Sub-contacts list for company groups */}
          {isGroup && (
            <div style={{ marginTop: 14 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: T.muted, marginBottom: 8,
              }}>Contactos ({card._contactCount})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {card._contacts.map(sc => {
                  const scColor = STAGE_COLORS[sc.etapa] || STAGE_COLORS.descartado;
                  const scLabel = PIPELINE_STAGES.find(s => s.id === sc.etapa)?.label || sc.etapa;
                  return (
                    <div
                      key={sc.email}
                      onClick={e => { e.stopPropagation(); onViewDetail(sc.card); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        background: T.bg, borderRadius: 8, cursor: 'pointer',
                        border: `1px solid transparent`, transition: 'border-color 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = T.border}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                    >
                      <div style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: scColor.border,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.title }}>
                          {`${sc.nombre} ${sc.apellido}`.trim() || sc.email}
                        </span>
                        <span style={{ fontSize: 12, color: T.dim, marginLeft: 8 }}>{sc.email}</span>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: scColor.text, background: scColor.bg,
                        padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                      }}>{scLabel}</span>
                      <span style={{ fontSize: 12, color: T.primary }}>→</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            {actions.map(a => {
              const asc = STAGE_COLORS[a.id] || STAGE_COLORS.nurturing;
              return (
                <button
                  key={a.id}
                  onClick={e => { e.stopPropagation(); onMoveCard(card.email, a.id); }}
                  style={{
                    background: asc.bg, color: asc.text,
                    border: `1px solid ${asc.border}`, borderRadius: 8,
                    padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: T.sans, transition: 'all 0.15s',
                  }}
                >→ {a.label}</button>
              );
            })}
            {/* Redactar con IA — inline compose */}
            <button
              onClick={e => { e.stopPropagation(); setShowCompose(!showCompose); setComposeDraft(null); }}
              style={{
                background: showCompose ? T.primary : T.white, color: showCompose ? T.white : T.primary,
                border: `1px solid ${T.primary}`, borderRadius: 8,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: T.sans, transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >&#9998; Redactar con IA</button>
            <button
              onClick={e => { e.stopPropagation(); onViewDetail(card); }}
              style={{
                background: 'transparent', color: T.primary,
                border: `1px solid ${T.border}`, borderRadius: 8,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: T.sans, transition: 'all 0.15s',
              }}
            >Ver conversacion</button>
            <button
              onClick={e => { e.stopPropagation(); if (confirm('Descartar ' + (displayContact.organizacion || card.email) + ' de prospects?')) onMoveCard(card.email, 'descartado'); }}
              style={{
                background: 'transparent', color: T.dim,
                border: `1px solid ${T.border}`, borderRadius: 8,
                padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                fontFamily: T.sans, transition: 'all 0.15s', marginLeft: 'auto',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = T.red; e.currentTarget.style.borderColor = T.red + '55'; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.dim; e.currentTarget.style.borderColor = T.border; }}
              title="Descartar"
            >&#10005;</button>
          </div>

          {/* Compose from instructions UI */}
          {showCompose && (
            <div style={{ marginTop: 14, background: T.bg, borderRadius: 10, padding: 16, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.title, marginBottom: 8 }}>
                Instrucciones para la IA
              </div>
              <textarea
                value={composeInstr}
                onChange={e => setComposeInstr(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder='Ej: "Dile que le envío el NDA y propongo llamada el jueves a las 10h"'
                style={{
                  width: '100%', minHeight: 80, padding: '10px 12px', fontSize: 13,
                  fontFamily: T.sans, borderRadius: 8, border: `1px solid ${T.border}`,
                  background: T.white, color: T.text, resize: 'vertical', lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!composeInstr.trim()) return;
                    const result = await onComposeFromInstructions(card.email, composeInstr.trim());
                    if (result) setComposeDraft(result.borrador);
                  }}
                  disabled={!composeInstr.trim() || composeInstrLoading === card.email}
                  style={{
                    background: T.primary, color: T.white, border: 'none', borderRadius: 8,
                    padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: T.sans, opacity: (!composeInstr.trim() || composeInstrLoading === card.email) ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >{composeInstrLoading === card.email ? 'Generando...' : 'Generar borrador'}</button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowCompose(false); setComposeDraft(null); setComposeInstr(''); }}
                  style={{
                    background: 'transparent', color: T.muted, border: `1px solid ${T.border}`,
                    borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: T.sans,
                  }}
                >Cancelar</button>
              </div>

              {/* Generated draft preview */}
              {composeDraft && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Borrador generado
                  </div>
                  <div
                    style={{
                      background: T.white, borderRadius: 8, padding: '14px 16px',
                      fontSize: 13, lineHeight: 1.7, color: T.text,
                      borderLeft: `3px solid ${T.primary}`,
                      maxHeight: 300, overflowY: 'auto',
                    }}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(composeDraft) }}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); onViewDetail(card); }}
                    style={{
                      marginTop: 10, background: T.emerald, color: T.white, border: 'none',
                      borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', fontFamily: T.sans,
                    }}
                  >Ver borrador y enviar</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PipelineDetail({ card, contact, onClose, onMoveCard, onAddNote, conversationCache, onGenerateFollowUp, followUpLoading, onImproveMessage, improveLoading, onComposeAndSave, composeLoading }) {
  const [newNote, setNewNote] = useState('');
  const [messages, setMessages] = useState(null);
  const [conversationData, setConversationData] = useState(null);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [showStage, setShowStage] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedMsg, setExpandedMsg] = useState(0); // First (most recent) auto-expanded
  // Edit draft states
  const [editingDraft, setEditingDraft] = useState(false);
  const [editDraftText, setEditDraftText] = useState('');
  const [sendingDraft, setSendingDraft] = useState(false);
  // Meeting notes states
  const [showMeetingNotes, setShowMeetingNotes] = useState(false);
  const [meetingNoteText, setMeetingNoteText] = useState('');
  const [meetingFile, setMeetingFile] = useState(null);
  const [uploadingNotes, setUploadingNotes] = useState(false);
  // Compose message states
  const [composeText, setComposeText] = useState('');
  const [draftCreated, setDraftCreated] = useState(false);

  const scrollRef = useRef(null);

  // Fetch conversation helper — always goes to backend (1 Gmail search)
  const fetchConversation = useCallback((forceRefresh = false) => {
    if (!card?.email) return;
    setMsgsLoading(true);
    setExpandedMsg(0);

    // Check session cache (with 2-minute TTL) unless force refresh
    if (!forceRefresh && conversationCache && conversationCache[card.email]) {
      const cached = conversationCache[card.email];
      const cacheAge = Date.now() - (cached._ts || 0);
      if (cacheAge < 120000) { // 2 min TTL
        setConversationData(cached);
        setMessages(cached.mensajes || cached);
        setMsgsLoading(false);
        return;
      }
    }

    // Optimized: 1 call to getConversacionCompleta (1 Gmail search)
    proxyFetch("getConversacionCompleta", { email: card.email })
      .then(data => {
        if (data.success && data.mensajes && data.mensajes.length > 0) {
          data._ts = Date.now();
          if (conversationCache) conversationCache[card.email] = data;
          setConversationData(data);
          setMessages(data.mensajes);
          return;
        }
        // Fallback: try legacy getConversation endpoint
        return proxyFetch("getConversation", { email: card.email })
          .then(d => {
            if (d.success && d.respuesta) {
              const fallbackData = { mensajes: [{ fecha: d.respuesta.fecha, remitente: card.email, esLeticia: false, cuerpo: d.respuesta.cuerpo }], _ts: Date.now(), resumen: null };
              if (conversationCache) conversationCache[card.email] = fallbackData;
              setConversationData(fallbackData);
              setMessages(fallbackData.mensajes);
            } else {
              setMessages([]);
            }
          });
      })
      .catch(() => setMessages([]))
      .finally(() => setMsgsLoading(false));
  }, [card?.email, conversationCache]);

  // Initial fetch on mount
  useEffect(() => {
    if (!card?.email) return;
    setMessages(null);
    setConversationData(null);
    fetchConversation();
  }, [card?.email, fetchConversation]);

  if (!card) return null;
  const sc = STAGE_COLORS[card.etapa] || STAGE_COLORS.descartado;
  const nombre = contact ? `${contact.nombre || ''} ${contact.apellido || ''}`.trim() : card.email;
  const org = contact?.organizacion || '';
  const firstName = (contact?.nombre || nombre.split(' ')[0] || '').trim();
  const initials = (org || nombre).substring(0, 2).toUpperCase();

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    onAddNote(card.email, newNote.trim());
    setNewNote('');
  };

  // Collapsible section header helper
  const CollapsibleHeader = ({ label, isOpen, onToggle }) => (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', cursor: 'pointer', borderTop: `1px solid ${T.border}`,
        background: T.white, userSelect: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.bg; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.white; }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{
        fontSize: 12, color: T.muted, transition: 'transform 0.2s',
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block',
      }}>&#9660;</span>
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />

      {/* Panel — 720px, flex column, no global padding */}
      <div style={{
        position: 'relative', width: 720, height: '100%', background: T.white,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        animation: 'fadeUp 0.25s ease both',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── DARK HEADER ── */}
        <div style={{
          background: '#1E293B', padding: '20px 24px', flexShrink: 0,
          position: 'relative',
        }}>
          <button onClick={onClose} style={{
            position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none',
            fontSize: 18, cursor: 'pointer', color: '#94A3B8', padding: 4, lineHeight: 1,
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#E2E8F0'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}
          >&#10005;</button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12, background: sc.border, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: T.sans,
            }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#F1F5F9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {org || nombre}
              </div>
              {org && <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 2 }}>{nombre}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 12, color: '#64748B' }}>{card.email}</span>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                  borderRadius: 6, background: `${sc.border}22`, border: `1px solid ${sc.border}44`,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: sc.border }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: sc.border }}>
                    {PIPELINE_STAGES.find(s => s.id === card.etapa)?.label || card.etapa}
                  </span>
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>{daysSince(card.fechaCambio)}d</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── STAGE PROGRESS BAR ── */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '10px 24px',
          background: '#F8FAFC', borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          {PIPELINE_STAGES.map((stage, i) => {
            const stageIdx = STAGE_ORDER.indexOf(card.etapa);
            const thisIdx = STAGE_ORDER.indexOf(stage.id);
            const isCompleted = thisIdx < stageIdx;
            const isCurrent = thisIdx === stageIdx;
            const stColor = STAGE_COLORS[stage.id];
            return (
              <div key={stage.id} style={{ display: 'flex', alignItems: 'center', flex: i < PIPELINE_STAGES.length - 1 ? 1 : 0 }}>
                <div style={{
                  width: isCurrent ? 14 : 10, height: isCurrent ? 14 : 10, borderRadius: '50%', flexShrink: 0,
                  background: isCompleted || isCurrent ? stColor.border : T.borderLight,
                  border: isCurrent ? `2px solid ${stColor.border}` : 'none',
                  boxShadow: isCurrent ? `0 0 0 3px ${stColor.border}33` : 'none',
                  transition: 'all 0.3s',
                }} title={stage.label} />
                {i < PIPELINE_STAGES.length - 1 && (
                  <div style={{
                    flex: 1, height: 2, marginLeft: 4, marginRight: 4,
                    background: isCompleted ? stColor.border : T.borderLight,
                    borderStyle: isCompleted ? 'solid' : 'dashed',
                    borderWidth: isCompleted ? 0 : '1px 0 0 0',
                    borderColor: T.border,
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── CONVERSATION THREAD (scrollable, flex:1) ── */}
        <div
          ref={scrollRef}
          style={{
            flex: 1, overflowY: 'auto', padding: '20px 24px',
            background: T.bg,
          }}
        >
          {msgsLoading ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: 40,
            }}>
              <div style={{
                width: 28, height: 28, border: `3px solid ${T.borderLight}`, borderTopColor: T.primary,
                borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: 12,
              }} />
              <span style={{ fontSize: 13, color: T.muted }}>Cargando conversacion...</span>
            </div>
          ) : messages && messages.length > 0 ? (
            <>
              {/* AI Summary Card */}
              {conversationData?.resumen && (
                <div style={{
                  padding: '16px 20px', marginBottom: 20, borderRadius: 12,
                  background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
                  border: '1px solid #93C5FD',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                  }}>
                    <span style={{ fontSize: 14 }}>&#10024;</span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: '#1D4ED8',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>Resumen IA</span>
                  </div>
                  <div style={{
                    fontSize: 13, lineHeight: 1.6, color: '#1E40AF',
                    fontFamily: T.sans,
                  }}>{conversationData.resumen}</div>
                </div>
              )}

              {/* Calendar Verified Meeting Card */}
              {conversationData?.reunion?.hayReunion && (
                <div style={{
                  padding: '16px 20px', marginBottom: 20, borderRadius: 12,
                  background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
                  border: '1px solid #34D399',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                  }}>
                    <span style={{ fontSize: 14 }}>&#128197;</span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: '#047857',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>Reunion verificada</span>
                    {conversationData.reunion.estado && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                        background: conversationData.reunion.estado === 'Confirmada' ? '#A7F3D0' : conversationData.reunion.estado === 'Rechazada' ? '#FECACA' : '#FDE68A',
                        color: conversationData.reunion.estado === 'Confirmada' ? '#065F46' : conversationData.reunion.estado === 'Rechazada' ? '#991B1B' : '#92400E',
                      }}>{conversationData.reunion.estado}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#065F46', marginBottom: 4 }}>
                    {conversationData.reunion.titulo}
                  </div>
                  <div style={{ fontSize: 12, color: '#047857' }}>
                    {conversationData.reunion.fecha ? new Date(conversationData.reunion.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    {conversationData.reunion.calendario ? ` · ${conversationData.reunion.calendario}` : ''}
                  </div>

                  {/* Meeting Notes Button + Form */}
                  {!showMeetingNotes ? (
                    <button
                      onClick={() => setShowMeetingNotes(true)}
                      style={{
                        marginTop: 12, padding: '8px 16px', borderRadius: 8,
                        background: '#065F46', color: '#fff', border: 'none',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.sans,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#047857'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#065F46'; }}
                    >
                      <span>&#128221;</span> Subir notas de reunion
                    </button>
                  ) : (
                    <div style={{ marginTop: 12, padding: '14px 16px', background: '#fff', borderRadius: 10, border: '1px solid #A7F3D0' }}>
                      <textarea
                        placeholder="Escribe las notas de la reunion, conclusiones y proximos pasos..."
                        value={meetingNoteText}
                        onChange={e => setMeetingNoteText(e.target.value)}
                        style={{
                          width: '100%', minHeight: 100, padding: '10px 12px', borderRadius: 8,
                          border: '1px solid #D1FAE5', fontSize: 13, fontFamily: T.sans,
                          color: T.text, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                        }}
                        onFocus={e => e.target.style.borderColor = '#34D399'}
                        onBlur={e => e.target.style.borderColor = '#D1FAE5'}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                        <input
                          type="file"
                          id="meetingFileInput"
                          accept=".pdf,.doc,.docx,.txt"
                          style={{ display: 'none' }}
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            if (f.size > 10 * 1024 * 1024) { alert('Archivo demasiado grande (max 10MB)'); return; }
                            setMeetingFile(f);
                          }}
                        />
                        <button
                          onClick={() => document.getElementById('meetingFileInput').click()}
                          style={{
                            padding: '6px 12px', borderRadius: 6, border: '1px solid #D1FAE5',
                            background: '#ECFDF5', fontSize: 12, color: '#047857', cursor: 'pointer',
                            fontFamily: T.sans, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <span>&#128206;</span> Adjuntar archivo
                        </button>
                        {meetingFile && (
                          <span style={{ fontSize: 12, color: '#047857', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {meetingFile.name}
                            <button onClick={() => { setMeetingFile(null); document.getElementById('meetingFileInput').value = ''; }}
                              style={{ background: 'none', border: 'none', color: '#991B1B', cursor: 'pointer', fontSize: 14, marginLeft: 4 }}>&#10005;</button>
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => { setShowMeetingNotes(false); setMeetingNoteText(''); setMeetingFile(null); }}
                          disabled={uploadingNotes}
                          style={{
                            padding: '8px 16px', borderRadius: 8, border: '1px solid #D1FAE5',
                            background: '#fff', fontSize: 13, color: T.muted, cursor: 'pointer', fontFamily: T.sans,
                          }}
                        >Cancelar</button>
                        <button
                          disabled={uploadingNotes || (!meetingNoteText.trim() && !meetingFile)}
                          onClick={async () => {
                            setUploadingNotes(true);
                            try {
                              let fileBase64 = '';
                              let fileName = '';
                              let fileType = '';
                              if (meetingFile) {
                                const b64 = await new Promise((res, rej) => {
                                  const reader = new FileReader();
                                  reader.onload = () => res(reader.result.split(',')[1]);
                                  reader.onerror = rej;
                                  reader.readAsDataURL(meetingFile);
                                });
                                fileBase64 = b64;
                                fileName = meetingFile.name;
                                fileType = meetingFile.type;
                              }
                              const result = await proxyFetch('uploadMeetingNotes', {
                                  email: card.email,
                                  noteText: meetingNoteText.trim(),
                                  fileName, fileBase64, fileType,
                              });
                              if (result.success) {
                                let noteDisplay = meetingNoteText.trim();
                                if (result.driveUrl) noteDisplay += '\nArchivo: ' + result.driveUrl;
                                onAddNote(card.email, '[NOTAS REUNION] ' + noteDisplay);
                                setShowMeetingNotes(false);
                                setMeetingNoteText('');
                                setMeetingFile(null);
                              } else {
                                alert('Error: ' + (result.error || 'Error desconocido'));
                              }
                            } catch (err) {
                              alert('Error de conexion: ' + err.message);
                            } finally {
                              setUploadingNotes(false);
                            }
                          }}
                          style={{
                            padding: '8px 20px', borderRadius: 8, border: 'none',
                            background: (uploadingNotes || (!meetingNoteText.trim() && !meetingFile)) ? '#A7F3D0' : '#065F46',
                            color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: T.sans,
                            cursor: (uploadingNotes || (!meetingNoteText.trim() && !meetingFile)) ? 'default' : 'pointer',
                          }}
                        >{uploadingNotes ? 'Guardando...' : 'Guardar notas'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Message history header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 16, padding: '10px 14px',
                borderRadius: 10, background: T.white, border: `1px solid ${T.border}`,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: T.muted,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>Historial</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => fetchConversation(true)}
                    disabled={msgsLoading}
                    title="Refrescar conversacion"
                    style={{
                      background: 'none', border: 'none', cursor: msgsLoading ? 'default' : 'pointer',
                      fontSize: 14, color: T.muted, padding: '2px 6px', borderRadius: 4,
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => { if (!msgsLoading) e.currentTarget.style.color = T.primary; }}
                    onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
                  >&#8635;</button>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 24, height: 24, padding: '0 8px', borderRadius: 12,
                    background: T.border, color: T.text, fontSize: 13, fontWeight: 600,
                  }}>{messages.length}</span>
                </div>
              </div>

              {/* Messages as cards — newest first */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[...messages].reverse().map((msg, i) => {
                  const isLeticia = msg.esLeticia;
                  const contactName = nombre || card.email.split('@')[0];
                  const msgBody = msg.cuerpo || '';
                  const isExp = expandedMsg === i;
                  const needsTruncate = !isExp && i > 0 && msgBody.length > 400;
                  const displayBody = needsTruncate ? msgBody.substring(0, 400) + '...' : msgBody;
                  // Most recent Leticia message = editable draft candidate
                  const isDraftCandidate = i === 0 && isLeticia && msg.esBorrador !== false;

                  return (
                    <div key={i} style={{
                      borderRadius: 8, overflow: 'hidden',
                      background: isLeticia ? T.primaryBg : '#FAFBFC',
                      border: `1px solid ${editingDraft && isDraftCandidate ? T.primary : T.border}`,
                      borderLeft: isLeticia ? `4px solid ${T.primary}` : `4px solid ${T.emerald}`,
                      boxShadow: '0 1px 3px 0 rgba(0,0,0,0.03)',
                    }}>
                      {/* Card header */}
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', gap: 12, flexWrap: 'wrap',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', padding: '4px 10px',
                            borderRadius: 4, fontSize: 13, fontWeight: 600, lineHeight: 1.2,
                            background: isLeticia ? T.primary : T.emerald, color: '#fff',
                          }}>{isLeticia ? 'Leticia (IA)' : contactName}</span>
                          <span style={{
                            fontSize: 13, color: T.muted, fontFamily: T.sans,
                          }}>{isLeticia ? 'leticia@alter-5.com' : card.email}</span>
                          {isDraftCandidate && !editingDraft && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                              color: T.amber, background: T.amberBg,
                              padding: '2px 8px', borderRadius: 4, letterSpacing: '0.05em',
                            }}>Borrador</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, color: T.muted, whiteSpace: 'nowrap' }}>{msg.fecha}</span>
                          {isDraftCandidate && !editingDraft && (
                            <button
                              onClick={() => { setEditingDraft(true); setEditDraftText(msgBody); }}
                              style={{
                                background: T.white, border: `1px solid ${T.border}`, borderRadius: 6,
                                padding: '4px 10px', fontSize: 12, fontWeight: 600, color: T.primary,
                                cursor: 'pointer', fontFamily: T.sans, transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = T.primaryBg; }}
                              onMouseLeave={e => { e.currentTarget.style.background = T.white; }}
                            >&#9998; Editar</button>
                          )}
                        </div>
                      </div>
                      {/* Card body — editable if draft */}
                      {editingDraft && isDraftCandidate ? (
                        <div style={{ padding: '4px 16px 16px' }}>
                          <textarea
                            value={editDraftText}
                            onChange={e => setEditDraftText(e.target.value)}
                            style={{
                              width: '100%', minHeight: 200, padding: '12px 14px', fontSize: 14,
                              fontFamily: T.sans, lineHeight: 1.65, color: T.text,
                              borderRadius: 8, border: `1px solid ${T.border}`,
                              background: T.white, resize: 'vertical', boxSizing: 'border-box',
                              outline: 'none',
                            }}
                            onFocus={e => e.target.style.borderColor = T.primary}
                            onBlur={e => e.target.style.borderColor = T.border}
                          />
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button
                              onClick={() => { setEditingDraft(false); setEditDraftText(''); }}
                              style={{
                                padding: '8px 16px', borderRadius: 8,
                                border: `1px solid ${T.border}`, background: T.white,
                                color: T.text, fontSize: 13, fontWeight: 500,
                                cursor: 'pointer', fontFamily: T.sans,
                              }}
                            >Cancelar</button>
                            <button
                              onClick={async () => {
                                if (!editDraftText.trim() || sendingDraft) return;
                                setSendingDraft(true);
                                try {
                                  const htmlBody = editDraftText.trim()
                                    .split('\n\n').map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
                                  const data = await proxyFetch("sendDraft", { email: card.email, cuerpoEditado: htmlBody });
                                  if (data.success) {
                                    setEditingDraft(false);
                                    setEditDraftText('');
                                    // Refresh conversation
                                    if (conversationCache) delete conversationCache[card.email];
                                    fetchConversation(true);
                                    alert('Respuesta enviada correctamente');
                                  } else {
                                    alert('Error: ' + (data.error || 'No se pudo enviar'));
                                  }
                                } catch (err) {
                                  alert('Error de conexion: ' + err.message);
                                } finally {
                                  setSendingDraft(false);
                                }
                              }}
                              disabled={!editDraftText.trim() || sendingDraft}
                              style={{
                                padding: '8px 20px', borderRadius: 8, border: 'none',
                                background: sendingDraft ? T.border : T.emerald,
                                color: '#fff', fontSize: 13, fontWeight: 600,
                                cursor: sendingDraft ? 'default' : 'pointer',
                                fontFamily: T.sans, display: 'flex', alignItems: 'center', gap: 6,
                              }}
                            >{sendingDraft ? 'Enviando...' : 'Enviar respuesta'}</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          padding: '4px 16px 16px', fontSize: 14, lineHeight: 1.65,
                          color: T.text, fontFamily: T.sans,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxHeight: isExp || i === 0 ? 'none' : (needsTruncate ? 'none' : 300),
                          overflowY: (isExp || i === 0 || needsTruncate) ? 'visible' : 'auto',
                        }}>
                          {displayBody}
                          {needsTruncate && (
                            <button
                              onClick={() => setExpandedMsg(i)}
                              style={{
                                display: 'inline', background: 'none', border: 'none',
                                color: T.primary, fontSize: 13, fontWeight: 600,
                                cursor: 'pointer', padding: '0 4px', fontFamily: T.sans,
                              }}
                            >Ver mas</button>
                          )}
                          {isExp && i > 0 && msgBody.length > 400 && (
                            <button
                              onClick={() => setExpandedMsg(-1)}
                              style={{
                                display: 'block', background: 'none', border: 'none',
                                color: T.muted, fontSize: 12, cursor: 'pointer',
                                padding: '6px 0 0', fontFamily: T.sans,
                              }}
                            >Ver menos</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '40px 20px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.title, marginBottom: 6 }}>Sin mensajes</div>
              <div style={{ fontSize: 13, color: T.muted, maxWidth: 300, lineHeight: 1.4 }}>
                Las conversaciones apareceran aqui cuando se reciban respuestas o se generen borradores
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER — Compose / Follow-up ── */}
        <div style={{
          padding: '14px 24px', borderTop: `1px solid ${T.border}`, background: '#fff', flexShrink: 0,
        }}>
          {card.etapa === 'nurturing' ? (
            draftCreated ? (
              /* Post-draft confirmation */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                  background: T.emeraldBg, borderRadius: 8, border: `1px solid ${T.emerald}33`,
                  width: '100%', justifyContent: 'center',
                }}>
                  <span style={{ color: T.emerald, fontSize: 16 }}>&#10003;</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#047857' }}>
                    Borrador creado en Gmail
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <button
                    onClick={() => { setDraftCreated(false); setComposeText(''); }}
                    style={{
                      flex: 1, padding: '10px 16px', borderRadius: 8,
                      border: `1px solid ${T.border}`, background: T.white,
                      color: T.text, fontWeight: 500, fontSize: 13, fontFamily: T.sans, cursor: 'pointer',
                    }}
                  >Redactar otro</button>
                  <button
                    onClick={() => {
                      // Invalidate cache and reload conversation to show fresh draft
                      if (conversationCache) delete conversationCache[card.email];
                      setDraftCreated(false);
                      setComposeText('');
                      // Trigger re-fetch by resetting messages
                      setMessages(null);
                      setMsgsLoading(true);
                      proxyFetch("getConversacionCompleta", { email: card.email })
                        .then(data => {
                          if (data.success && data.mensajes) {
                            if (conversationCache) conversationCache[card.email] = data;
                            setConversationData(data);
                            setMessages(data.mensajes);
                          }
                        })
                        .catch(() => {})
                        .finally(() => setMsgsLoading(false));
                    }}
                    style={{
                      flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none',
                      background: T.primary, color: '#fff', fontWeight: 600, fontSize: 13,
                      fontFamily: T.sans, cursor: 'pointer',
                    }}
                  >Ver borrador</button>
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>
                  Revisa el borrador en Gmail o desde Contactos antes de enviar
                </div>
              </div>
            ) : (
              /* Compose section */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea
                  placeholder="Escribe tu mensaje..."
                  value={composeText}
                  onChange={e => setComposeText(e.target.value)}
                  style={{
                    width: '100%', minHeight: 80, maxHeight: 200, padding: '10px 14px',
                    borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13,
                    fontFamily: T.sans, color: T.text, resize: 'vertical',
                    outline: 'none', boxSizing: 'border-box', lineHeight: 1.5,
                  }}
                  onFocus={e => e.target.style.borderColor = T.primary}
                  onBlur={e => e.target.style.borderColor = T.border}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  {/* Mejorar con IA */}
                  <button
                    onClick={async () => {
                      if (!composeText.trim()) return;
                      const mejorado = await onImproveMessage(card.email, composeText.trim());
                      if (mejorado) setComposeText(mejorado);
                    }}
                    disabled={!composeText.trim() || improveLoading || composeLoading}
                    style={{
                      flex: 1, padding: '10px 16px', borderRadius: 8,
                      border: `1px solid ${T.primary}33`,
                      background: (!composeText.trim() || improveLoading || composeLoading) ? T.bg : T.primaryBg,
                      color: (!composeText.trim() || improveLoading || composeLoading) ? T.dim : T.primary,
                      fontWeight: 600, fontSize: 13, fontFamily: T.sans,
                      cursor: (!composeText.trim() || improveLoading || composeLoading) ? 'default' : 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    {improveLoading ? (
                      <>
                        <span style={{
                          display: 'inline-block', width: 14, height: 14,
                          border: `2px solid ${T.primary}33`, borderTopColor: T.primary,
                          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                        }} />
                        Mejorando...
                      </>
                    ) : (
                      <>&#10024; Mejorar con IA</>
                    )}
                  </button>
                  {/* Crear borrador */}
                  <button
                    onClick={async () => {
                      if (!composeText.trim()) return;
                      // Convert plain text to simple HTML
                      const htmlMsg = composeText.trim()
                        .split('\n\n').map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('') +
                        '<p>Leticia Menéndez<br>Structured Finance — Alter5</p>';
                      const ok = await onComposeAndSave(card.email, htmlMsg);
                      if (ok) setDraftCreated(true);
                    }}
                    disabled={!composeText.trim() || composeLoading || improveLoading}
                    style={{
                      flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none',
                      background: (!composeText.trim() || composeLoading || improveLoading) ? T.border : T.primary,
                      color: '#fff', fontWeight: 600, fontSize: 13, fontFamily: T.sans,
                      cursor: (!composeText.trim() || composeLoading || improveLoading) ? 'default' : 'pointer',
                      opacity: (!composeText.trim() || composeLoading || improveLoading) ? 0.6 : 1,
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    {composeLoading ? (
                      <>
                        <span style={{
                          display: 'inline-block', width: 14, height: 14,
                          border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
                          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                        }} />
                        Creando borrador...
                      </>
                    ) : (
                      'Crear borrador'
                    )}
                  </button>
                </div>
                {/* Auto follow-up alternative */}
                {onGenerateFollowUp && (
                  <button
                    onClick={() => onGenerateFollowUp(card)}
                    disabled={followUpLoading === card.email || improveLoading || composeLoading}
                    style={{
                      width: '100%', padding: '8px 16px', borderRadius: 8,
                      border: `1px solid ${T.border}`, background: T.white,
                      color: (followUpLoading === card.email) ? T.dim : T.muted,
                      fontWeight: 500, fontSize: 12, fontFamily: T.sans,
                      cursor: (followUpLoading === card.email || improveLoading || composeLoading) ? 'default' : 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >{followUpLoading === card.email ? 'Generando follow-up con IA...' : 'O generar follow-up automatico con IA'}</button>
                )}
                <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>
                  Escribe tu mensaje, mejoralo con IA si quieres, y crea un borrador en Gmail con tracking
                </div>
              </div>
            )
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10 }}>
                <input disabled placeholder="Composicion disponible en etapa Seguimiento"
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 8, border: '1px solid #E2E8F0',
                    background: '#F8FAFC', fontSize: 13, color: '#94A3B8', fontFamily: T.sans, outline: 'none',
                  }} />
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6, textAlign: 'center' }}>
                Mueve el contacto a Seguimiento para redactar mensajes personalizados
              </div>
            </>
          )}
        </div>

        {/* ── COLLAPSIBLE SECTIONS ── */}

        {/* Mover a etapa */}
        <CollapsibleHeader label="Mover a etapa" isOpen={showStage} onToggle={() => setShowStage(!showStage)} />
        {showStage && (
          <div style={{ padding: '12px 24px 16px', background: T.white }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[...PIPELINE_STAGES, { id: 'descartado', label: 'Descartado' }]
                .filter(s => s.id !== card.etapa)
                .map(s => {
                  const sColor = STAGE_COLORS[s.id];
                  return (
                    <button
                      key={s.id}
                      onClick={() => onMoveCard(card.email, s.id)}
                      style={{
                        background: sColor.bg, border: `1px solid ${sColor.border}55`, borderRadius: 6,
                        padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                        color: sColor.text, fontFamily: T.sans, transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = sColor.border; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = sColor.border + '55'; }}
                    >{s.label}</button>
                  );
                })
              }
            </div>
          </div>
        )}

        {/* Notas */}
        <CollapsibleHeader label="Notas" isOpen={showNotes} onToggle={() => setShowNotes(!showNotes)} />
        {showNotes && (
          <div style={{ padding: '12px 24px 16px', background: T.white }}>
            {(card.notas || []).length === 0 ? (
              <div style={{ fontSize: 13, color: T.dim, padding: '4px 0 8px' }}>Sin notas</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                {(card.notas || []).map((n, i) => (
                  <div key={i} style={{
                    padding: '8px 12px', background: T.bg, borderRadius: 8, border: `1px solid ${T.border}`,
                  }}>
                    <div style={{ fontSize: 13, color: T.text }}>{n.texto}</div>
                    <div style={{ fontSize: 11, color: T.dim, marginTop: 4 }}>{fmtDate(n.fecha)}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Anadir nota..."
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                style={{
                  flex: 1, padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8,
                  fontSize: 13, fontFamily: T.sans, color: T.text, background: T.bg, outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = T.primary}
                onBlur={e => e.target.style.borderColor = T.border}
              />
              <button
                onClick={handleAddNote}
                disabled={!newNote.trim()}
                style={{
                  background: newNote.trim() ? T.primary : T.border, color: T.white, border: 'none',
                  borderRadius: 8, padding: '8px 16px', cursor: newNote.trim() ? 'pointer' : 'default',
                  fontSize: 13, fontWeight: 600, fontFamily: T.sans,
                }}
              >Anadir</button>
            </div>
          </div>
        )}

        {/* Historial */}
        <CollapsibleHeader label="Historial de etapas" isOpen={showHistory} onToggle={() => setShowHistory(!showHistory)} />
        {showHistory && (
          <div style={{ padding: '12px 24px 16px', background: T.white }}>
            <div style={{ position: 'relative', paddingLeft: 20 }}>
              <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, background: T.border }} />
              {(card.historial || []).map((h, i) => {
                const hColor = STAGE_COLORS[h.etapa] || STAGE_COLORS.descartado;
                return (
                  <div key={i} style={{ position: 'relative', marginBottom: 12 }}>
                    <div style={{
                      position: 'absolute', left: -17, top: 3, width: 10, height: 10,
                      borderRadius: '50%', background: hColor.border, border: `2px solid ${T.white}`,
                    }} />
                    <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>
                      {PIPELINE_STAGES.find(s => s.id === h.etapa)?.label || h.etapa}
                    </div>
                    <div style={{ fontSize: 11, color: T.dim }}>{fmtDate(h.fecha)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN
// ============================================================
export default function BridgeCampaignView({ onBack, allCompanies }) {
  const [showExplorer, setShowExplorer] = useState(false);
  const [nextWaveRef, setNextWaveRef] = useState(null);
  const [previousTargets, setPreviousTargets] = useState({}); // all targets across waves
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mock, setMock] = useState(false);
  const [tab, setTab] = useState("resumen");
  const [filter, setFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedContact, setSelectedContact] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Empresas tab state
  const [expandedOrgs, setExpandedOrgs] = useState({});
  const [empFilter, setEmpFilter] = useState("todas");
  const [empSearch, setEmpSearch] = useState("");
  const [empSort, setEmpSort] = useState("az"); // "az" | "engagement" | "contactos"
  // Pipeline state
  const [pipelineData, setPipelineData] = useState([]);
  const [selectedPipelineCard, setSelectedPipelineCard] = useState(null);
  // Prospects tab state
  const [expandedProspects, setExpandedProspects] = useState(new Set());
  const [prospectSearch, setProspectSearch] = useState("");
  const [prospectFilter, setProspectFilter] = useState("todas");
  // Oportunidades tab state
  const [expandedOpps, setExpandedOpps] = useState(new Set());
  const [oppSearch, setOppSearch] = useState("");
  const [oppFilter, setOppFilter] = useState("todas");
  // Respuestas tab state
  const [respFilter, setRespFilter] = useState("todas");
  const [respSearch, setRespSearch] = useState("");
  const [expandedResp, setExpandedResp] = useState(new Set());
  const [dismissedResp, setDismissedResp] = useState(new Set());
  // Dismissed follow-ups (persists in session)
  const [dismissedFollowUps, setDismissedFollowUps] = useState(new Set());
  // Follow-up draft generation loading state (email in progress, or null)
  const [followUpLoading, setFollowUpLoading] = useState(null);
  // Follow-up draft overlay state: { email, card, borrador, draftId, editing, editText, scheduling, scheduleDate, sending }
  const [followUpDraft, setFollowUpDraft] = useState(null);
  // Compose message states
  const [improveLoading, setImproveLoading] = useState(false);
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeInstrLoading, setComposeInstrLoading] = useState(null); // email currently loading
  // Seguimiento tab state
  const [seguimientoStep, setSeguimientoStep] = useState(1); // 1=select, 2=instructions, 3=preview
  const [seguimientoCandidatos, setSeguimientoCandidatos] = useState([]);
  const [seguimientoLoading, setSeguimientoLoading] = useState(false);
  const [seguimientoFilter, setSeguimientoFilter] = useState('clics'); // 'clics', 'abiertos', 'todos'
  const [seguimientoSelected, setSeguimientoSelected] = useState({}); // {orgName: true/false}
  const [seguimientoInstrucciones, setSeguimientoInstrucciones] = useState('');
  const [seguimientoIncluirKB, setSeguimientoIncluirKB] = useState(true);
  const [seguimientoGenerando, setSeguimientoGenerando] = useState(false);
  const [seguimientoBorradores, setSeguimientoBorradores] = useState([]); // generated drafts
  const [seguimientoEnviando, setSeguimientoEnviando] = useState(false);
  const [seguimientoResultado, setSeguimientoResultado] = useState(null); // {enviados, errores}
  const [seguimientoExpandido, setSeguimientoExpandido] = useState({}); // expanded draft previews
  // Cache de conversaciones por email (evita re-fetch al re-clic)
  const conversationCacheRef = useRef({});

  const handleContactClick = (contact) => {
    if (contact.respondido === "Si" || contact.respondido === "Sí" || contact.estado === "Respondido") {
      setSelectedContact(contact);
      setPanelOpen(true);
    }
  };

  const handlePanelClose = () => {
    setPanelOpen(false);
    setTimeout(() => setSelectedContact(null), 300);
  };

  const handleSendSuccess = (email) => {
    console.log("Email sent successfully to:", email);
  };

  const handleGenerateFollowUp = async (card) => {
    if (followUpLoading) return;
    setFollowUpLoading(card.email);
    try {
      const data = await proxyFetch("generateFollowUp", { email: card.email });
      if (data.success) {
        // Invalidate session cache
        delete conversationCacheRef.current[card.email];
        // Show draft in dedicated overlay
        setFollowUpDraft({
          email: card.email,
          card,
          borrador: data.borrador,
          draftId: data.draftId,
          editing: false,
          editText: '',
          scheduling: false,
          scheduleDate: '',
          sending: false,
        });
      } else {
        alert("Error: " + (data.error || "No se pudo generar el seguimiento"));
      }
    } catch (err) {
      alert("Error de conexion: " + err.message);
    } finally {
      setFollowUpLoading(null);
    }
  };

  const handleImproveMessage = async (email, texto) => {
    if (improveLoading) return null;
    setImproveLoading(true);
    try {
      const data = await proxyFetch("improveMessage", { email, texto });
      if (data.success) {
        return data.textoMejorado;
      } else {
        alert("Error: " + (data.error || "No se pudo mejorar el mensaje"));
        return null;
      }
    } catch (err) {
      alert("Error de conexion: " + err.message);
      return null;
    } finally {
      setImproveLoading(false);
    }
  };

  const handleComposeAndSave = async (email, mensaje, asunto) => {
    if (composeLoading) return false;
    setComposeLoading(true);
    try {
      const data = await proxyFetch("composeAndSaveDraft", { email, mensaje, asunto });
      if (data.success) {
        // Invalidate cache so PipelineDetail re-fetches with fresh draft
        delete conversationCacheRef.current[email];
        return true;
      } else {
        alert("Error: " + (data.error || "No se pudo crear el borrador"));
        return false;
      }
    } catch (err) {
      alert("Error de conexion: " + err.message);
      return false;
    } finally {
      setComposeLoading(false);
    }
  };

  const handleComposeFromInstructions = async (email, instrucciones) => {
    if (composeInstrLoading) return null;
    setComposeInstrLoading(email);
    try {
      const data = await proxyFetch("composeFromInstructions", { email, instrucciones });
      if (data.success) {
        delete conversationCacheRef.current[email];
        return data;
      } else {
        alert("Error: " + (data.error || "No se pudo generar el email"));
        return null;
      }
    } catch (err) {
      alert("Error de conexion: " + err.message);
      return null;
    } finally {
      setComposeInstrLoading(null);
    }
  };

  // --- Seguimiento handlers ---
  const loadSeguimientoCandidatos = async () => {
    setSeguimientoLoading(true);
    try {
      const data = await proxyFetch("getFollowUpCandidates");
      if (data.success) {
        setSeguimientoCandidatos(data.candidatos || []);
        // Pre-select all orgs
        const orgs = {};
        (data.candidatos || []).forEach(c => {
          const org = c.organizacion || c.email.split('@')[1] || 'Sin organización';
          orgs[org] = true;
        });
        setSeguimientoSelected(orgs);
      }
    } catch (err) {
      console.error("Error loading candidates:", err);
    } finally {
      setSeguimientoLoading(false);
    }
  };

  const getSeguimientoFiltered = () => {
    // Build set of orgs AND domains active in pipeline (excl. descartado)
    const pipelineOrgs = new Set();
    const pipelineDomains = new Set();
    pipelineData.forEach(p => {
      if (p.etapa && p.etapa !== 'descartado') {
        const org = (p.organizacion || '').trim().toLowerCase();
        if (org) pipelineOrgs.add(org);
        // Also resolve org from contacts if pipeline card lacks it
        const ct = contacts.find(ct => ct.email === p.email);
        if (ct) {
          const ctOrg = (ct.organizacion || '').trim().toLowerCase();
          if (ctOrg) pipelineOrgs.add(ctOrg);
        }
        // Domain-based exclusion (defense in depth)
        const dom = p.email?.split('@')[1]?.toLowerCase();
        if (dom && !GENERIC_DOMAINS.includes(dom)) pipelineDomains.add(dom);
      }
    });
    return seguimientoCandidatos.filter(c => {
      // Exclude by org name
      const cOrg = (c.organizacion || '').trim().toLowerCase();
      if (cOrg && pipelineOrgs.has(cOrg)) return false;
      // Exclude by email domain (catches cases where org name differs)
      const cDom = c.email?.split('@')[1]?.toLowerCase();
      if (cDom && !GENERIC_DOMAINS.includes(cDom) && pipelineDomains.has(cDom)) return false;
      if (seguimientoFilter === 'clics') return (c.numClics || 0) > 0;
      if (seguimientoFilter === 'abiertos') return (c.numAperturas || 0) > 0;
      return true; // 'todos' = all without response
    });
  };

  const getSeguimientoByOrg = () => {
    const filtered = getSeguimientoFiltered();
    const groups = {};
    filtered.forEach(c => {
      const org = c.organizacion || c.email.split('@')[1] || 'Sin organización';
      if (!groups[org]) groups[org] = { org, contactos: [], totalClics: 0, totalAperturas: 0, yaSeguimiento: false };
      groups[org].contactos.push(c);
      groups[org].totalClics += (c.numClics || 0);
      groups[org].totalAperturas += (c.numAperturas || 0);
      if ((c.seguimientosEnviados || 0) > 0) groups[org].yaSeguimiento = true;
    });
    return Object.values(groups).sort((a, b) => b.totalClics - a.totalClics);
  };

  const getSelectedEmails = () => {
    const filtered = getSeguimientoFiltered();
    return filtered
      .filter(c => {
        const org = c.organizacion || c.email.split('@')[1] || 'Sin organización';
        return seguimientoSelected[org];
      })
      .map(c => c.email);
  };

  const handleGenerarSeguimiento = async () => {
    const emails = getSelectedEmails();
    if (!emails.length || !seguimientoInstrucciones.trim()) return;
    setSeguimientoGenerando(true);
    try {
      const data = await proxyFetch("generateFollowUpBatch", {
          emails,
          instrucciones: seguimientoInstrucciones,
          incluirKB: seguimientoIncluirKB,
      });
      if (data.success) {
        setSeguimientoBorradores(data.borradores || []);
        setSeguimientoStep(3);
        // Pre-select all
        const exp = {};
        (data.borradores || []).forEach((_, i) => { exp[i] = false; });
        setSeguimientoExpandido(exp);
      } else {
        alert("Error: " + (data.error || "No se pudieron generar los emails"));
      }
    } catch (err) {
      alert("Error de conexión: " + err.message);
    } finally {
      setSeguimientoGenerando(false);
    }
  };

  const handleEnviarSeguimiento = async () => {
    const emailsToSend = seguimientoBorradores.filter((_, i) => seguimientoExpandido[i] !== 'excluded');
    if (!emailsToSend.length) return;
    setSeguimientoEnviando(true);
    try {
      const data = await proxyFetch("sendFollowUpBatch", {
          emails: emailsToSend.map(b => ({ email: b.email, asunto: b.asunto, cuerpoHtml: b.cuerpoHtml })),
      });
      if (data.success) {
        setSeguimientoResultado({ enviados: data.totalEnviados || 0, errores: data.totalErrores || 0 });
      } else {
        alert("Error: " + (data.error || "No se pudieron enviar"));
      }
    } catch (err) {
      alert("Error de conexión: " + err.message);
    } finally {
      setSeguimientoEnviando(false);
    }
  };

  const resetSeguimiento = () => {
    setSeguimientoStep(1);
    setSeguimientoBorradores([]);
    setSeguimientoResultado(null);
    setSeguimientoInstrucciones('');
    loadSeguimientoCandidatos();
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch paralelo: dashboard + pipeline + Airtable targets al mismo tiempo
      const [dashboardRes, pipelineRes, atResult] = await Promise.all([
        proxyFetch("dashboard").catch(() => null),
        proxyFetch("pipeline").catch(() => null),
        fetchAllBridgeTargets("Bridge_Q1").catch(() => ({ allTargets: {}, maxWave: 1 })),
      ]);
      if (!dashboardRes) throw new Error("Dashboard fetch failed");

      // If GAS dashboard returns very few contacts but Airtable has more,
      // augment with CampaignTargets data (LEGACY_SHEET_ID might not be configured)
      const gasContacts = dashboardRes.contactos || [];
      const { allTargets } = atResult;
      const atEntries = Object.values(allTargets);
      const sentTargets = atEntries.filter(t =>
        t.status === 'approved' || t.status === 'sent' || t.status === 'selected'
      );

      if (gasContacts.length < 10 && sentTargets.length > gasContacts.length) {
        // Build contact records from Airtable CampaignTargets as fallback
        const seenEmails = new Set(gasContacts.map(c => (c.email || '').toLowerCase()));
        const augmented = [...gasContacts];
        for (const t of sentTargets) {
          const contacts = t.selectedContacts || [];
          for (const ct of contacts) {
            const email = (ct.email || '').toLowerCase().trim();
            if (!email || seenEmails.has(email)) continue;
            seenEmails.add(email);
            augmented.push({
              email,
              nombre: ct.name || '',
              apellido: '',
              organizacion: t.companyName || '',
              grupo: t.campaignRef || '',
              variante: '-',
              estado: 'Enviado',
              fechaEnvio: t.reviewedAt || null,
              primeraApertura: null,
              numAperturas: 0,
              primerClic: null,
              numClics: 0,
              respondido: 'No',
            });
          }
        }
        dashboardRes.contactos = augmented;
        dashboardRes._augmentedFromAirtable = true;
      }

      setData(dashboardRes);
      setMock(false);
      // Pipeline es opcional (falla silenciosa)
      if (pipelineRes && pipelineRes.success !== false && pipelineRes.pipeline) {
        setPipelineData(pipelineRes.pipeline);
      }
    } catch {
      setData(MOCK);
      setPipelineData(MOCK_PIPELINE);
      setMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Pipeline handlers
  const moveCard = useCallback(async (email, newStage) => {
    // Optimistic update
    setPipelineData(prev => {
      const exists = prev.some(c => c.email === email);
      if (exists) {
        return prev.map(c => {
          if (c.email !== email) return c;
          const now = new Date().toISOString();
          return {
            ...c,
            etapaAnterior: c.etapa,
            etapa: newStage,
            fechaCambio: now,
            historial: [...(c.historial || []), { etapa: newStage, fecha: now }],
          };
        });
      }
      // Contact not in pipeline yet — add optimistically
      const now = new Date().toISOString();
      return [...prev, {
        email,
        etapa: newStage,
        fechaCambio: now,
        notas: [],
        sugerencia: '',
        fechaCreacion: now,
        etapaAnterior: '',
        historial: [{ etapa: newStage, fecha: now }],
        ultimoEmail: null,
      }];
    });
    setSelectedPipelineCard(prev => {
      if (!prev || prev.email !== email) return prev;
      const now = new Date().toISOString();
      return {
        ...prev,
        etapaAnterior: prev.etapa,
        etapa: newStage,
        fechaCambio: now,
        historial: [...(prev.historial || []), { etapa: newStage, fecha: now }],
      };
    });

    try {
      await proxyFetch("moveStage", { email, newStage });
    } catch (err) { console.error("Error moving card:", err); }
  }, []);

  const addNote = useCallback(async (email, noteText) => {
    const note = { fecha: new Date().toISOString(), texto: noteText };
    setPipelineData(prev => prev.map(c => {
      if (c.email !== email) return c;
      return { ...c, notas: [...(c.notas || []), note] };
    }));
    setSelectedPipelineCard(prev => {
      if (!prev || prev.email !== email) return prev;
      return { ...prev, notas: [...(prev.notas || []), note] };
    });

    try {
      await proxyFetch("addNote", { email, note: noteText });
    } catch (err) { console.error("Error adding note:", err); }
  }, []);

  const contacts = data?.contactos || [];

  const dismissFollowUp = useCallback((key) => {
    setDismissedFollowUps(prev => new Set([...prev, key]));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Compute next wave ref when Explorer is opened
  const handleOpenExplorer = useCallback(async () => {
    try {
      const { allTargets, maxWave } = await fetchAllBridgeTargets("Bridge_Q1");
      const nextWave = maxWave + 1;
      setNextWaveRef(`Bridge_Q1_W${nextWave}`);
      setPreviousTargets(allTargets);
    } catch {
      // Fallback: use W2 if we can't detect
      setNextWaveRef("Bridge_Q1_W2");
      setPreviousTargets({});
    }
    setShowExplorer(true);
  }, []);

  if (loading) return (
    <div style={{
      minHeight: "100vh",
      background: T.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 16,
    }}>
      <style>{globalCSS}</style>
      <div style={{
        width: 40,
        height: 40,
        border: `3px solid ${T.border}`,
        borderTopColor: T.primary,
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <span style={{ color: T.muted, fontSize: 14 }}>Cargando datos...</span>
    </div>
  );

  const m = data?.metricas;

  // Contactos con tracking real: usamos el MAYOR entre el conteo del backend (ENVIO en Log)
  // y los contactos que realmente tienen actividad (aperturas/clics/respuestas).
  // Los contactos recuperados de Gmail que reciben nuevas aperturas incrementan este numero.
  const backendRastreados = data?.contactosRastreados || 0;
  const activityCount = contacts.filter(c =>
    (c.numAperturas || 0) > 0 || (c.numClics || 0) > 0 || c.respondido === "Si" || c.respondido === "Sí" || c.estado === "Respondido"
  ).length;
  const tRastreados = Math.max(backendRastreados, activityCount) || 1;

  // KPIs calculated directly from contacts
  const tTotal = contacts.length;
  const tE = contacts.filter(c => c.estado && !c.estado.startsWith("Error")).length;
  const tErrors = contacts.filter(c => c.estado?.startsWith("Error")).length;
  const tEntregados = tE;
  const tA = contacts.filter(c => (c.numAperturas || 0) > 0).length;
  const tC = contacts.filter(c => (c.numClics || 0) > 0).length;
  const tR = contacts.filter(c => c.respondido === "Si" || c.respondido === "Sí" || c.estado === "Respondido").length;
  const tPendientes = contacts.filter(c => !c.estado).length;
  const tEnviadosTotal = tE + tErrors;

  const esRespondido = (c) =>
    c.respondido === "Sí" || c.respondido === "Si" || c.estado === "Respondido";

  // Apply filter
  let filtered = contacts.filter(c => {
    if (filter === "A") return c.variante === "A";
    if (filter === "B") return c.variante === "B";
    if (filter === "enviados") return c.estado && !c.estado.startsWith("Error");
    if (filter === "respondidos") return esRespondido(c);
    if (filter === "pendientes") return !c.estado;
    if (filter === "abiertos") return (c.numAperturas || 0) > 0;
    if (filter === "clics") return (c.numClics || 0) > 0;
    if (filter === "errores") return c.estado?.startsWith("Error");
    return true;
  });

  // Apply search
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(c =>
      (c.nombre || "").toLowerCase().includes(q) ||
      (c.apellido || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.organizacion || "").toLowerCase().includes(q)
    );
  }

  // Pagination
  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const goToFilter = (f) => {
    setFilter(f);
    setSearch("");
    setPage(0);
    setTab("contactos");
  };

  // Follow-up queue: prioritized contacts for Resumen tab
  const followUpItems = (() => {
    // Check if the team has replied using multiple signals
    const _genericDomains = new Set(['gmail.com','hotmail.com','outlook.com','yahoo.com','live.com','icloud.com','protonmail.com']);
    const _corpDomain = (em) => { const d = (em||'').toLowerCase().split('@')[1]||''; return _genericDomains.has(d) ? '' : d; };
    const teamHasReplied = (contact) => {
      if (contact.respuestaEnviada === "Si" || contact.respuestaEnviada === "Sí") return true;
      const pCard = pipelineData.find(p => p.email === contact.email);
      if (pCard && ['reunion', 'subida_docs', 'doc_completada'].includes(pCard.etapa)) return true;
      if (pCard?.ultimoEmail?.esLeticia === "Si" || pCard?.ultimoEmail?.esLeticia === true) return true;
      const dom = _corpDomain(contact.email);
      if (dom) {
        const cc = pipelineData.filter(p => _corpDomain(p.email) === dom && p.etapa !== 'descartado');
        if (cc.some(p => ['reunion', 'subida_docs', 'doc_completada'].includes(p.etapa))) return true;
        if (cc.some(p => p.ultimoEmail?.esLeticia === "Si" || p.ultimoEmail?.esLeticia === true)) return true;
        if (contacts.some(c => c.email !== contact.email && _corpDomain(c.email) === dom && (c.respuestaEnviada === "Si" || c.respuestaEnviada === "Sí"))) return true;
      }
      return false;
    };
    const isDiscarded = (email) => {
      const pCard = pipelineData.find(p => p.email === email);
      return pCard && pCard.etapa === 'descartado';
    };

    // Respondidos where the team hasn't replied yet
    const respondidosSinEnvio = contacts.filter(c =>
      esRespondido(c) && !teamHasReplied(c) && !isDiscarded(c.email)
    ).map(c => ({ contact: c, priority: 1 }));

    const clickers = contacts.filter(c =>
      (c.numClics || 0) > 0 && !esRespondido(c) && !isDiscarded(c.email)
    ).map(c => ({ contact: c, priority: 2 }));

    const warmOpens = contacts.filter(c =>
      (c.numAperturas || 0) >= 3 && !esRespondido(c) && (c.numClics || 0) === 0 && !isDiscarded(c.email)
    ).map(c => ({ contact: c, priority: 3 }));

    const all = [...respondidosSinEnvio, ...clickers, ...warmOpens];

    // Deduplicate by company: keep highest priority contact per org
    const byCompany = {};
    for (const item of all) {
      const dn = getDisplayName(item.contact);
      if (!byCompany[dn] || item.priority < byCompany[dn].priority) {
        byCompany[dn] = item;
      }
    }

    return Object.values(byCompany)
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 15)
      .map(item => {
        const c = item.contact;
        const pCard = pipelineData.find(p => p.email === c.email);
        const dn = getDisplayName(c);
        const personName = `${c.nombre || ''} ${c.apellido || ''}`.trim();
        return {
          key: c.email,
          email: c.email,
          displayName: dn,
          personName: personName !== dn ? personName : '',
          contact: c,
          stage: pCard?.etapa || null,
          lastDate: c.primeraApertura || c.primerClic || c.fechaEnvio,
          priority: item.priority,
        };
      })
      .filter(item => !dismissedFollowUps.has(item.key));
  })();

  // Winner logic
  const aWins = (m?.A?.tasaApertura||0) > (m?.B?.tasaApertura||0);
  const bWins = (m?.B?.tasaApertura||0) > (m?.A?.tasaApertura||0);
  const hasEnough = (m?.A?.enviados||0) >= 5 && (m?.B?.enviados||0) >= 5;

  if (showExplorer) {
    return (
      <BridgeExplorerView
        allCompanies={allCompanies || []}
        campaignRef={nextWaveRef || "Bridge_Q1_W2"}
        previousTargets={previousTargets}
        bridgeContacts={data?.contactos || []}
        campaignMetrics={data?.metricas || null}
        currentUser="Salvador Carrillo"
        onBack={() => setShowExplorer(false)}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>
      <style>{globalCSS}</style>
      {/* ─── HEADER ─── */}
      <header style={{
        background: T.white,
        borderBottom: `1px solid ${T.border}`,
        padding: "16px 32px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
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
              Campanas
            </button>
          )}
          {/* Gradient icon */}
          <div style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: "linear-gradient(135deg, #1D4ED8, #059669)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <span style={{ color: "#fff", fontSize: 18, lineHeight: 1 }}>⚡</span>
          </div>
          <div>
            <h1 style={{
              fontSize: 18,
              fontWeight: 700,
              background: "linear-gradient(90deg, #1D4ED8, #059669)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
            }}>
              Bridge Energy Program
            </h1>
            <span style={{ fontSize: 12, color: T.muted }}>Fast-track financing for ready-to-build projects</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {mock && (
            <span style={{
              fontSize: 12,
              fontWeight: 500,
              color: T.amber,
              background: T.amberBg,
              padding: "6px 12px",
              borderRadius: 6,
            }}>Datos de ejemplo</span>
          )}
          <span style={{ fontSize: 12, color: T.dim }}>
            {data?.actualizado && fmtDate(data.actualizado)}
          </span>
          <button onClick={load} style={{
            background: T.white,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            color: T.text,
            padding: "9px 16px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: T.sans,
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = T.bg; }}
          onMouseLeave={e => { e.currentTarget.style.background = T.white; }}
          >↻ Actualizar</button>
          <button onClick={handleOpenExplorer} style={{
            background: "linear-gradient(135deg, #1D4ED8, #059669)",
            border: "none",
            borderRadius: 8,
            color: "#FFFFFF",
            padding: "9px 18px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: T.sans,
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "opacity 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >+ Buscar más candidatos</button>
        </div>
      </header>

      {/* ─── BODY ─── */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px" }}>

        {/* KPIs — 7 columns */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 14, marginBottom: 28 }}>
          <KPI label="Empresas" value={new Set(contacts.map(c => c.organizacion).filter(Boolean)).size} sub="organizaciones" color={T.primary} onClick={() => setTab("empresas")} />
          <KPI label="Contactos" value={tTotal} sub={tPendientes > 0 ? `${tPendientes} pendientes` : "todos enviados"} color={T.primary} onClick={() => goToFilter("todos")} />
          <KPI label="Enviados" value={tEnviadosTotal} sub={tEntregados+" entregados"} color={T.primary} onClick={() => goToFilter("enviados")} />
          <KPI label="Abiertos" value={tA} sub={tRastreados ? pct(tA/tRastreados)+` (${tRastreados} rastreados)` : ""} color={T.emerald} onClick={() => goToFilter("abiertos")} />
          <KPI label="Clics" value={tC} sub={tRastreados ? pct(tC/tRastreados)+` (${tRastreados} rastreados)` : ""} color={T.amber} onClick={() => goToFilter("clics")} />
          <KPI label="Respondidos" value={tR} sub={tEntregados ? pct(tR/tEntregados)+" de entregados" : ""} color={T.emerald} onClick={() => setTab("respuestas")} />
          <KPI label="Rebotados" value={tErrors} sub={tEnviadosTotal ? pct(tErrors/tEnviadosTotal)+" de enviados" : ""} color={T.red} onClick={() => goToFilter("errores")} />
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex",
          gap: 4,
          marginBottom: 24,
          background: T.white,
          borderRadius: 12,
          padding: 4,
          border: `1px solid ${T.border}`,
          width: "fit-content",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}>
          <TabBtn active={tab==="resumen"} label="Resumen" onClick={()=>setTab("resumen")} />
          <TabBtn active={tab==="respuestas"} label="Respuestas" onClick={()=>setTab("respuestas")} />
          <TabBtn active={tab==="empresas"} label="Empresas" onClick={()=>setTab("empresas")} />
          <TabBtn active={tab==="contactos"} label="Contactos" onClick={()=>setTab("contactos")} />
          <TabBtn active={tab==="ab"} label="Test A/B" onClick={()=>setTab("ab")} />
          <TabBtn active={tab==="prospects"} label="Prospects" onClick={()=>setTab("prospects")} />
          <TabBtn active={tab==="oportunidades"} label="Oportunidades" onClick={()=>setTab("oportunidades")} />
          <TabBtn active={tab==="seguimiento"} label="Seguimiento" onClick={()=>{ setTab("seguimiento"); if(!seguimientoCandidatos.length) loadSeguimientoCandidatos(); }} />

        </div>

        {/* ─── TAB: RESUMEN ─── */}
        {tab === "resumen" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <Card>
                <CardTitle>Embudo de conversión</CardTitle>
                <Funnel label="Enviados" count={tEnviadosTotal} total={tTotal||1} color={T.primary} idx={0} />
                <Funnel label="Entregados" count={tEntregados} total={tEnviadosTotal||1} color={T.primary} idx={1} />
                <Funnel label={`Abiertos (de ${tRastreados} rastreados)`} count={tA} total={tRastreados||1} color={T.emerald} idx={2} />
                <Funnel label={`Clics (de ${tRastreados} rastreados)`} count={tC} total={tRastreados||1} color={T.amber} idx={3} />
                <Funnel label="Respondidos" count={tR} total={tEntregados||1} color={T.emerald} idx={4} />
              </Card>

              <Card>
                <CardTitle>Tasas de conversión</CardTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
                  <RateBox label="Apertura" value={tRastreados>0?pct(tA/tRastreados):"—"} color={T.emerald} />
                  <RateBox label="Clic" value={tRastreados>0?pct(tC/tRastreados):"—"} color={T.amber} />
                  <RateBox label="Respuesta" value={tEntregados>0?pct(tR/tEntregados):"—"} color={T.emerald} />
                  <RateBox label="Clic / Apertura" value={tA>0?pct(tC/tA):"—"} color={T.primary} />
                </div>
                <div style={{
                  padding: 16,
                  background: T.bg,
                  borderRadius: 10,
                  border: `1px solid ${T.border}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: T.muted,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}>Grupo final</div>
                      <div style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: T.title,
                        marginTop: 4,
                      }}>{m?.Final?.total||0} contactos</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{
                        fontFamily: T.sans,
                        fontSize: 24,
                        fontWeight: 700,
                        color: (m?.Final?.pendientes||0) > 0 ? T.amber : T.emerald,
                      }}>
                        {m?.Final?.pendientes||0}
                      </div>
                      <div style={{ fontSize: 12, color: T.muted }}>pendientes</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Pipeline KPIs — acceso rápido a Prospects */}
            {pipelineData.length > 0 && (() => {
              const isInt = (email) => email.toLowerCase().endsWith('@alter-5.com') || email.toLowerCase().endsWith('@alter5.com');
              const pGroups = groupPipelineByCompany(pipelineData.filter(c => !isInt(c.email)), contacts);
              const pActiveG = pGroups.filter(g => g.etapa !== 'descartado');
              const pNurt = pActiveG.filter(g => g.etapa === 'nurturing').length;
              const pReun = pActiveG.filter(g => g.etapa === 'reunion').length;
              const pSubida = pActiveG.filter(g => g.etapa === 'subida_docs').length;
              const pComp = pActiveG.filter(g => g.etapa === 'doc_completada').length;
              const pTotal = pActiveG.length;
              // Conversiones acumulativas (empresas que han pasado por esa etapa o superior)
              const pasaronReunion = pReun + pSubida + pComp;
              const pasaronDocs = pSubida + pComp;
              return (
                <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 20 }}>
                  <KPI label="Nurturing" value={pNurt} sub="empresas" color={STAGE_COLORS.nurturing.border}
                    onClick={() => { setProspectFilter("nurturing"); setTab("prospects"); }} />
                  <KPI label="Reuniones" value={pReun} sub="empresas" color={STAGE_COLORS.reunion.border}
                    onClick={() => { setProspectFilter("reunion"); setTab("prospects"); }} />
                  <KPI label="Subida docs" value={pSubida} sub="empresas" color={STAGE_COLORS.subida_docs.border}
                    onClick={() => { setOppFilter("subida_docs"); setTab("oportunidades"); }} />
                  <KPI label="Completada" value={pComp} sub="empresas" color={STAGE_COLORS.doc_completada.border}
                    onClick={() => { setOppFilter("doc_completada"); setTab("oportunidades"); }} />
                </div>
                <Card style={{ marginTop: 14 }}>
                  <CardTitle>Conversión Pipeline</CardTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                    <RateBox label="Respuesta" value={tEntregados > 0 ? pct(tR / tEntregados) : "—"} color={STAGE_COLORS.nurturing.border} />
                    <RateBox label="Respuesta → Reunión" value={pTotal > 0 ? pct(pasaronReunion / pTotal) : "—"} color={STAGE_COLORS.reunion.border} />
                    <RateBox label="Reunión → Docs" value={pasaronReunion > 0 ? pct(pasaronDocs / pasaronReunion) : "—"} color={STAGE_COLORS.subida_docs.border} />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: T.muted, textAlign: 'center' }}>
                    {tR} respondidos · {pTotal} en pipeline · {pasaronReunion} con reunion · {pasaronDocs} con docs
                  </div>
                </Card>
                </>
              );
            })()}

            {/* Follow-Up Queue */}
            {followUpItems.length > 0 && (
              <Card style={{ marginTop: 20 }}>
                <CardTitle>Seguimiento prioritario</CardTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {followUpItems.map(item => (
                    <FollowUpRow
                      key={item.key}
                      item={item}
                      onDismiss={dismissFollowUp}
                      onClick={() => {
                        if (esRespondido(item.contact)) {
                          const pCard = pipelineData.find(p => p.email === item.contact.email);
                          if (pCard) {
                            setSelectedPipelineCard(pCard);
                          } else {
                            handleContactClick(item.contact);
                          }
                        } else {
                          goToFilter("clics");
                        }
                      }}
                    />
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {/* ─── TAB: RESPUESTAS ─── */}
        {tab === "respuestas" && (() => {
          const respondidos = contacts.filter(c =>
            (c.respondido === "Sí" || c.respondido === "Si" || c.estado === "Respondido")
            && !dismissedResp.has(c.email)
          );
          // Also exclude descartados from Pipeline
          const respondidosActivos = respondidos.filter(c => {
            const pCard = pipelineData.find(p => p.email === c.email);
            return !pCard || pCard.etapa !== 'descartado';
          });

          // Determine if team has replied using multiple signals:
          // 1. respuestaEnviada = "Si" (sent via dashboard)
          // 2. Pipeline stage past nurturing (reunion, subida_docs, doc_completada = clearly handled)
          // 3. Last message in thread is from Leticia/team
          // Helper: extract corporate domain from email (ignore generic domains)
          const genericDomains = new Set(['gmail.com','hotmail.com','outlook.com','yahoo.com','live.com','icloud.com','protonmail.com']);
          const corpDomain = (email) => {
            const d = (email || '').toLowerCase().split('@')[1] || '';
            return genericDomains.has(d) ? '' : d;
          };

          const teamReplied = (contact, pCard) => {
            if (contact.respuestaEnviada === "Si" || contact.respuestaEnviada === "Sí") return true;
            if (pCard && ['reunion', 'subida_docs', 'doc_completada'].includes(pCard.etapa)) return true;
            if (pCard?.ultimoEmail?.esLeticia === "Si" || pCard?.ultimoEmail?.esLeticia === true) return true;
            // Signal 4: check same company in Pipeline (by domain)
            const dom = corpDomain(contact.email);
            if (dom) {
              const companyCards = pipelineData.filter(p => corpDomain(p.email) === dom && p.etapa !== 'descartado');
              // 4a: any company member in advanced stage
              if (companyCards.some(p => ['reunion', 'subida_docs', 'doc_completada'].includes(p.etapa))) return true;
              // 4b: any company member where last message is from Leticia/team
              if (companyCards.some(p => p.ultimoEmail?.esLeticia === "Si" || p.ultimoEmail?.esLeticia === true)) return true;
            }
            // Signal 5: another contact from same company already marked as replied
            if (dom) {
              const sameCompanyReplied = contacts.some(c =>
                c.email !== contact.email && corpDomain(c.email) === dom &&
                (c.respuestaEnviada === "Si" || c.respuestaEnviada === "Sí")
              );
              if (sameCompanyReplied) return true;
            }
            return false;
          };

          let respList = respondidosActivos.map(c => {
            const pCard = pipelineData.find(p => p.email === c.email);
            return { contact: c, pipelineCard: pCard || null, isResponded: teamReplied(c, pCard) };
          });

          // Filter
          if (respFilter === "pendientes") respList = respList.filter(r => !r.isResponded);
          else if (respFilter === "respondidas") respList = respList.filter(r => r.isResponded);

          // Search
          if (respSearch.trim()) {
            const q = respSearch.trim().toLowerCase();
            respList = respList.filter(r =>
              getDisplayName(r.contact).toLowerCase().includes(q) ||
              (r.contact.nombre || '').toLowerCase().includes(q) ||
              (r.contact.apellido || '').toLowerCase().includes(q) ||
              (r.contact.email || '').toLowerCase().includes(q)
            );
          }

          // Sort: pendientes first, then by date (most recent first)
          respList.sort((a, b) => {
            if (a.isResponded !== b.isResponded) return a.isResponded ? 1 : -1;
            const aDate = a.pipelineCard?.ultimoEmail?.fecha || a.contact.primeraApertura || '';
            const bDate = b.pipelineCard?.ultimoEmail?.fecha || b.contact.primeraApertura || '';
            return bDate.localeCompare(aDate);
          });

          const allWithStatus = respondidosActivos.map(c => {
            const pCard = pipelineData.find(p => p.email === c.email);
            return teamReplied(c, pCard);
          });
          const countRespondidas = allWithStatus.filter(Boolean).length;
          const countPendientes = respondidosActivos.length - countRespondidas;

          const toggleResp = (email) => {
            setExpandedResp(prev => {
              const next = new Set(prev);
              if (next.has(email)) next.delete(email); else next.add(email);
              return next;
            });
          };

          return (
            <>
              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
                <KPI label="Total respuestas" value={respondidosActivos.length} sub="contactos que respondieron" color={T.primary}
                  onClick={() => setRespFilter("todas")} />
                <KPI label="Pendientes" value={countPendientes} sub="esperando respuesta del equipo" color={T.red}
                  onClick={() => setRespFilter("pendientes")} />
                <KPI label="Respondidas" value={countRespondidas} sub="equipo ya respondió" color={T.emerald}
                  onClick={() => setRespFilter("respondidas")} />
              </div>

              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {/* Header: search + filters */}
                <div style={{
                  padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                }}>
                  <input
                    value={respSearch}
                    onChange={e => setRespSearch(e.target.value)}
                    placeholder="Buscar empresa, contacto o email..."
                    style={{
                      flex: 1, minWidth: 200, padding: '8px 14px', borderRadius: 8,
                      border: `1px solid ${T.border}`, fontSize: 13, fontFamily: T.sans,
                      outline: 'none', color: T.text,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <FilterChip active={respFilter==="todas"} label="Todas" count={respondidosActivos.length} onClick={() => setRespFilter("todas")} />
                    <FilterChip active={respFilter==="pendientes"} label="Pendientes" count={countPendientes} onClick={() => setRespFilter("pendientes")} />
                    <FilterChip active={respFilter==="respondidas"} label="Respondidas" count={countRespondidas} onClick={() => setRespFilter("respondidas")} />
                  </div>
                </div>

                {/* List */}
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {respList.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: T.muted }}>
                      <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>📬</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>No hay respuestas{respFilter !== "todas" ? ` ${respFilter}` : ''}</div>
                      {respSearch && <div style={{ fontSize: 12, marginTop: 4, color: T.dim }}>Prueba con otra búsqueda</div>}
                    </div>
                  ) : (
                    respList.map(({ contact, pipelineCard, isResponded }) => (
                      <ResponseItem
                        key={contact.email}
                        contact={contact}
                        pipelineCard={pipelineCard}
                        isResponded={isResponded}
                        isExpanded={expandedResp.has(contact.email)}
                        onToggle={() => toggleResp(contact.email)}
                        onMoveStage={moveCard}
                        onViewDetail={c => setSelectedPipelineCard(c)}
                        onOpenPanel={handleContactClick}
                        onDismiss={(email) => setDismissedResp(prev => new Set([...prev, email]))}
                        onComposeFromInstructions={handleComposeFromInstructions}
                        composeInstrLoading={composeInstrLoading}
                      />
                    ))
                  )}
                </div>
              </Card>
            </>
          );
        })()}

        {/* ─── TAB: EMPRESAS ─── */}
        {tab === "empresas" && (() => {
          const allCompanies = buildCompanyData(contacts);

          // Company-level KPIs
          const totalEmpresas = allCompanies.length;
          const empConApertura = allCompanies.filter(e => e.abiertos > 0).length;
          const empConClic = allCompanies.filter(e => e.clics > 0).length;
          const empConResp = allCompanies.filter(e => e.respondidos > 0).length;

          // Filter companies
          let filtered2 = allCompanies;
          if (empFilter === "respondidas") filtered2 = filtered2.filter(e => e.respondidos > 0);
          else if (empFilter === "clics") filtered2 = filtered2.filter(e => e.clics > 0);
          else if (empFilter === "abiertas") filtered2 = filtered2.filter(e => e.abiertos > 0);
          else if (empFilter === "enviadas") filtered2 = filtered2.filter(e => e.abiertos === 0 && e.enviados > 0);
          else if (empFilter === "errores") filtered2 = filtered2.filter(e => e.errores > 0);

          // Search
          if (empSearch.trim()) {
            const q = empSearch.trim().toLowerCase();
            filtered2 = filtered2.filter(e => e.org.toLowerCase().includes(q));
          }

          // Sort
          if (empSort === "az") filtered2.sort((a, b) => a.org.localeCompare(b.org, "es"));
          else if (empSort === "engagement") filtered2.sort((a, b) => b.bestRank - a.bestRank || b.respondidos - a.respondidos || b.clics - a.clics || b.abiertos - a.abiertos);
          else if (empSort === "contactos") filtered2.sort((a, b) => b.total - a.total);

          const toggleOrg = (org) => setExpandedOrgs(prev => ({ ...prev, [org]: !prev[org] }));
          const sortLabels = { az: "A-Z", engagement: "Engagement", contactos: "N.º contactos" };
          const nextSort = { az: "engagement", engagement: "contactos", contactos: "az" };

          return (
            <>
              {/* KPIs empresa */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
                <KPI label="Empresas" value={totalEmpresas} sub={`de ${contacts.length} contactos`} color={T.primary} />
                <KPI label="Con apertura" value={empConApertura} sub={totalEmpresas ? pct(empConApertura / totalEmpresas) + " de empresas" : ""} color={T.amber} />
                <KPI label="Con clic" value={empConClic} sub={totalEmpresas ? pct(empConClic / totalEmpresas) + " de empresas" : ""} color={T.primary} />
                <KPI label="Con respuesta" value={empConResp} sub={totalEmpresas ? pct(empConResp / totalEmpresas) + " de empresas" : ""} color={T.emerald} />
              </div>

              <Card style={{ padding: 0, overflow: "hidden" }}>
                {/* Search + Filters + Sort */}
                <div style={{
                  padding: "12px 20px",
                  borderBottom: `1px solid ${T.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}>
                  <input
                    type="text"
                    placeholder="Buscar empresa..."
                    value={empSearch}
                    onChange={e => setEmpSearch(e.target.value)}
                    style={{
                      width: 240,
                      padding: "8px 14px",
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      fontSize: 14,
                      fontFamily: T.sans,
                      color: T.text,
                      background: T.bg,
                      outline: "none",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={e => e.target.style.borderColor = T.primary}
                    onBlur={e => e.target.style.borderColor = T.border}
                  />

                  <div style={{ width: 1, height: 24, background: T.border, margin: "0 4px" }} />

                  <FilterChip active={empFilter==="todas"} label="Todas" count={allCompanies.length} onClick={() => setEmpFilter("todas")} />
                  <FilterChip active={empFilter==="respondidas"} label="Respondidas" count={empConResp} onClick={() => setEmpFilter("respondidas")} />
                  <FilterChip active={empFilter==="clics"} label="Con clics" count={empConClic} onClick={() => setEmpFilter("clics")} />
                  <FilterChip active={empFilter==="abiertas"} label="Abiertas" count={empConApertura} onClick={() => setEmpFilter("abiertas")} />
                  <FilterChip active={empFilter==="enviadas"} label="Solo enviadas" count={allCompanies.filter(e => e.abiertos === 0 && e.enviados > 0).length} onClick={() => setEmpFilter("enviadas")} />
                  <FilterChip active={empFilter==="errores"} label="Errores" count={allCompanies.filter(e => e.errores > 0).length} onClick={() => setEmpFilter("errores")} />

                  {/* Sort button */}
                  <button
                    onClick={() => setEmpSort(prev => nextSort[prev])}
                    style={{
                      marginLeft: "auto",
                      background: T.primaryBg,
                      border: `1px solid ${T.primary}33`,
                      borderRadius: 6,
                      padding: "6px 14px",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 500,
                      color: T.primary,
                      fontFamily: T.sans,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    ↕ {sortLabels[empSort]}
                  </button>
                  <button
                    onClick={() => exportCampaignCSV(filtered2)}
                    style={{
                      background: T.emeraldBg,
                      border: `1px solid ${T.emerald}33`,
                      borderRadius: 6,
                      padding: "6px 14px",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 500,
                      color: T.emerald,
                      fontFamily: T.sans,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    CSV Empresas
                  </button>
                </div>

                {/* Results count */}
                <div style={{
                  padding: "8px 20px",
                  borderBottom: `1px solid ${T.border}`,
                  fontSize: 13,
                  color: T.muted,
                  background: T.bg,
                }}>
                  {filtered2.length} empresa{filtered2.length !== 1 ? "s" : ""}
                </div>

                {/* Company list */}
                <div style={{ maxHeight: "calc(100vh - 400px)", overflowY: "auto" }}>
                  {filtered2.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: T.muted, fontSize: 14 }}>
                      No hay empresas con este filtro
                    </div>
                  ) : (
                    filtered2.map(company => (
                      <CompanyRow
                        key={company.org}
                        company={company}
                        expanded={!!expandedOrgs[company.org]}
                        onToggle={() => toggleOrg(company.org)}
                      />
                    ))
                  )}
                </div>
              </Card>
            </>
          );
        })()}

        {/* ─── TAB: A/B ─── */}
        {tab === "ab" && (
          <Card>
            {/* Labels */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr", marginBottom: 28 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  background: T.primaryBg,
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: `1px solid ${T.primary}22`,
                }}>
                  <span style={{
                    fontFamily: T.sans,
                    fontSize: 18,
                    fontWeight: 700,
                    color: T.primary,
                  }}>A</span>
                  <span style={{ fontSize: 13, color: T.primary, fontWeight: 500 }}>
                    Email + enlace ({m?.A?.enviados||0} envíos)
                  </span>
                </div>
              </div>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: T.dim,
                fontSize: 13,
                fontWeight: 600,
              }}>VS</div>
              <div style={{ textAlign: "center" }}>
                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  background: T.emeraldBg,
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: `1px solid ${T.emerald}22`,
                }}>
                  <span style={{
                    fontFamily: T.sans,
                    fontSize: 18,
                    fontWeight: 700,
                    color: T.emerald,
                  }}>B</span>
                  <span style={{ fontSize: 13, color: T.emerald, fontWeight: 500 }}>
                    Email + PDF ({m?.B?.enviados||0} envíos)
                  </span>
                </div>
              </div>
            </div>

            <ABMetric label="Enviados" a={m?.A?.enviados||0} b={m?.B?.enviados||0} fmt="num" />
            <ABMetric label="Apertura" a={m?.A?.tasaApertura||0} b={m?.B?.tasaApertura||0} aTotal={m?.A?.enviados||0} bTotal={m?.B?.enviados||0} />
            <ABMetric label="Clics" a={m?.A?.tasaClics||0} b={m?.B?.tasaClics||0} aTotal={m?.A?.enviados||0} bTotal={m?.B?.enviados||0} />
            <ABMetric label="Respuesta" a={m?.A?.tasaRespuesta||0} b={m?.B?.tasaRespuesta||0} aTotal={m?.A?.enviados||0} bTotal={m?.B?.enviados||0} />

            {/* Winner */}
            <div style={{
              marginTop: 28,
              padding: 24,
              background: hasEnough ? T.emeraldBg : T.bg,
              borderRadius: 10,
              textAlign: "center",
              border: `1px solid ${hasEnough ? T.emerald+"33" : T.border}`,
            }}>
              {hasEnough ? (
                <>
                  <div style={{ fontSize: 13, color: T.muted, marginBottom: 8 }}>Recomendación basada en tasa de apertura</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: aWins ? T.primary : T.emerald }}>
                    {aWins ? "Variante A gana por aperturas" : bWins ? "Variante B gana por aperturas" : "Empate entre variantes"}
                  </div>
                  <div style={{
                    fontSize: 13,
                    color: T.muted,
                    marginTop: 8,
                    fontFamily: T.sans,
                  }}>
                    → Ejecuta enviarGanador{aWins ? "A" : "B"}()
                  </div>
                </>
              ) : (
                <span style={{ color: T.muted, fontSize: 14 }}>
                  Esperando mínimo 5 envíos por variante para determinar ganador
                </span>
              )}
            </div>
          </Card>
        )}

        {/* ─── TAB: CONTACTOS ─── */}
        {tab === "contactos" && (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {/* Search bar */}
            <div style={{
              padding: "12px 20px",
              borderBottom: `1px solid ${T.border}`,
            }}>
              <input
                type="text"
                placeholder="Buscar contacto..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                style={{
                  width: "100%",
                  padding: "8px 14px",
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: T.sans,
                  color: T.text,
                  background: T.bg,
                  outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = T.primary}
                onBlur={e => e.target.style.borderColor = T.border}
              />
            </div>

            {/* Filter chips */}
            <div style={{
              padding: "12px 20px",
              borderBottom: `1px solid ${T.border}`,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}>
              <FilterChip
                active={filter==="todos"}
                label="Todos"
                count={contacts.length}
                onClick={()=>{ setFilter("todos"); setPage(0); }}
              />
              <FilterChip
                active={filter==="A"}
                label="Variante A"
                count={contacts.filter(c=>c.variante==="A").length}
                onClick={()=>{ setFilter("A"); setPage(0); }}
              />
              <FilterChip
                active={filter==="B"}
                label="Variante B"
                count={contacts.filter(c=>c.variante==="B").length}
                onClick={()=>{ setFilter("B"); setPage(0); }}
              />
              <FilterChip
                active={filter==="abiertos"}
                label="Abiertos"
                count={contacts.filter(c=>(c.numAperturas||0)>0).length}
                onClick={()=>{ setFilter("abiertos"); setPage(0); }}
              />
              <FilterChip
                active={filter==="clics"}
                label="Clics"
                count={contacts.filter(c=>(c.numClics||0)>0).length}
                onClick={()=>{ setFilter("clics"); setPage(0); }}
              />
              <FilterChip
                active={filter==="respondidos"}
                label="Respondidos"
                count={contacts.filter(esRespondido).length}
                onClick={()=>{ setFilter("respondidos"); setPage(0); }}
              />
              <FilterChip
                active={filter==="pendientes"}
                label="Pendientes"
                count={contacts.filter(c=>!c.estado).length}
                onClick={()=>{ setFilter("pendientes"); setPage(0); }}
              />
              <FilterChip
                active={filter==="errores"}
                label="Errores"
                count={tErrors}
                onClick={()=>{ setFilter("errores"); setPage(0); }}
              />
              <span style={{
                marginLeft: "auto",
                fontSize: 13,
                color: T.muted,
              }}>{filtered.length} contactos</span>
              <button
                onClick={() => exportContactsCSV(filtered)}
                style={{
                  background: T.emeraldBg,
                  border: `1px solid ${T.emerald}33`,
                  borderRadius: 6,
                  padding: "6px 14px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  color: T.emerald,
                  fontFamily: T.sans,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                CSV Contactos
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#FAFAFA" }}>
                    {["VAR.", "CONTACTO", "ORGANIZACION", "ESTADO", "APERTURAS", "CLICS", "ULTIMO"].map(h => (
                      <th key={h} style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        fontSize: 10,
                        fontWeight: 700,
                        color: T.muted,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        borderBottom: `1px solid ${T.border}`,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((c, i) => {
                    const isRespondido = c.respondido === "Si" || c.respondido === "Sí" || c.estado === "Respondido";
                    const isSelected = selectedContact?.email === c.email;
                    return (
                    <tr key={i}
                      onClick={() => handleContactClick(c)}
                      style={{
                        borderBottom: `1px solid ${T.border}`,
                        transition: "background 0.15s, border-left 0.15s",
                        cursor: isRespondido ? "pointer" : "default",
                        background: isSelected ? T.primaryBg : T.white,
                        borderLeft: isSelected ? `3px solid ${T.primary}` : "3px solid transparent",
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) e.currentTarget.style.background = isRespondido ? T.primaryBg : T.bg;
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) e.currentTarget.style.background = T.white;
                      }}
                    >
                      <td style={{ padding: "14px 16px" }}>
                        <VarBadge v={c.variante} />
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: T.title }}>{c.nombre} {c.apellido}</div>
                        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{c.email}</div>
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: 14, color: T.text }}>{c.organizacion}</td>
                      <td style={{ padding: "14px 16px" }}><StatusBadge estado={c.estado} /></td>
                      <td style={{
                        padding: "14px 16px",
                        fontFamily: T.sans,
                        fontSize: 14,
                        fontWeight: 600,
                        color: c.numAperturas>0 ? T.title : T.dim,
                      }}>{c.numAperturas||0}</td>
                      <td style={{
                        padding: "14px 16px",
                        fontFamily: T.sans,
                        fontSize: 14,
                        fontWeight: 600,
                        color: c.numClics>0 ? T.title : T.dim,
                      }}>{c.numClics||0}</td>
                      <td style={{ padding: "14px 16px", fontSize: 13, color: T.muted }}>
                        {(c.respondido==="Si" || c.respondido==="Sí") ? fmtDate(c.primeraApertura) : c.primerClic ? fmtDate(c.primerClic) : c.primeraApertura ? fmtDate(c.primeraApertura) : c.fechaEnvio ? fmtDate(c.fechaEnvio) : "-"}
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{
                padding: "12px 20px",
                borderTop: `1px solid ${T.border}`,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 16,
              }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  style={{
                    background: "transparent",
                    border: `1px solid ${T.border}`,
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: safePage === 0 ? T.dim : T.text,
                    cursor: safePage === 0 ? "default" : "pointer",
                    fontFamily: T.sans,
                  }}
                >← Anterior</button>
                <span style={{ fontSize: 13, color: T.muted }}>
                  Página {safePage + 1} de {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  style={{
                    background: "transparent",
                    border: `1px solid ${T.border}`,
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: safePage >= totalPages - 1 ? T.dim : T.text,
                    cursor: safePage >= totalPages - 1 ? "default" : "pointer",
                    fontFamily: T.sans,
                  }}
                >Siguiente →</button>
              </div>
            )}
          </Card>
        )}
        {/* ─── TAB: PROSPECTS ─── */}
        {tab === "prospects" && (() => {
          const isInternal = (email) => email.toLowerCase().endsWith('@alter-5.com') || email.toLowerCase().endsWith('@alter5.com');
          // Deduplicate by email
          // Group all non-internal pipeline cards by company
          const externalCards = pipelineData.filter(c => !isInternal(c.email));
          const allGroups = groupPipelineByCompany(externalCards, contacts);

          // Prospects: companies whose best stage is nurturing or reunion
          let prospectCards = allGroups.filter(g => g.etapa === 'nurturing' || g.etapa === 'reunion');
          const countNurturing = prospectCards.filter(c => c.etapa === 'nurturing').length;
          const countReunion = prospectCards.filter(c => c.etapa === 'reunion').length;

          if (prospectFilter === "nurturing") prospectCards = prospectCards.filter(c => c.etapa === 'nurturing');
          else if (prospectFilter === "reunion") prospectCards = prospectCards.filter(c => c.etapa === 'reunion');

          if (prospectSearch.trim()) {
            const q = prospectSearch.trim().toLowerCase();
            prospectCards = prospectCards.filter(g => {
              // Search org name
              if (g._org.toLowerCase().includes(q)) return true;
              // Search any contact email or name
              return g._contacts.some(sc =>
                sc.email.toLowerCase().includes(q) ||
                `${sc.nombre} ${sc.apellido}`.toLowerCase().includes(q)
              );
            });
          }

          prospectCards.sort((a, b) => (b.fechaCambio || '').localeCompare(a.fechaCambio || ''));

          const toggleProspect = (key) => {
            setExpandedProspects(prev => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            });
          };

          return (
            <>
              <PipelineKPIs cards={pipelineData} tab="prospects" onFilterChange={setProspectFilter} contacts={contacts} />
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{
                  padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                }}>
                  <input
                    value={prospectSearch}
                    onChange={e => setProspectSearch(e.target.value)}
                    placeholder="Buscar empresa o email..."
                    style={{
                      flex: 1, minWidth: 200, padding: '8px 14px', borderRadius: 8,
                      border: `1px solid ${T.border}`, fontSize: 13, fontFamily: T.sans,
                      outline: 'none', color: T.text,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <FilterChip active={prospectFilter==="todas"} label="Todas" count={countNurturing + countReunion} onClick={() => setProspectFilter("todas")} />
                    <FilterChip active={prospectFilter==="nurturing"} label="Nurturing" count={countNurturing} onClick={() => setProspectFilter("nurturing")} />
                    <FilterChip active={prospectFilter==="reunion"} label="Reunión" count={countReunion} onClick={() => setProspectFilter("reunion")} />
                  </div>
                </div>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {prospectCards.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: T.muted }}>
                      <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>📋</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>No hay prospects en esta vista</div>
                      {prospectSearch && <div style={{ fontSize: 12, marginTop: 4, color: T.dim }}>Prueba con otra busqueda</div>}
                    </div>
                  ) : (
                    prospectCards.map(card => (
                      <PipelineListItem
                        key={card._org}
                        card={card}
                        contact={contacts.find(c => c.email === card.email)}
                        isExpanded={expandedProspects.has(card._org)}
                        onToggle={() => toggleProspect(card._org)}
                        onViewDetail={c => setSelectedPipelineCard(c)}
                        onMoveCard={moveCard}
                        onGenerateFollowUp={handleGenerateFollowUp}
                        followUpLoading={followUpLoading}
                        onComposeFromInstructions={handleComposeFromInstructions}
                        composeInstrLoading={composeInstrLoading}
                      />
                    ))
                  )}
                </div>
              </Card>
            </>
          );
        })()}

        {/* ─── TAB: OPORTUNIDADES ─── */}
        {tab === "oportunidades" && (() => {
          const isInternalOpp = (email) => email.toLowerCase().endsWith('@alter-5.com') || email.toLowerCase().endsWith('@alter5.com');
          // Group by company — reuse allGroups from Prospects if same render, otherwise recompute
          const externalCardsOpp = pipelineData.filter(c => !isInternalOpp(c.email));
          const allGroupsOpp = groupPipelineByCompany(externalCardsOpp, contacts);

          // Oportunidades: companies whose best stage is subida_docs or doc_completada
          let oppCards = allGroupsOpp.filter(g => g.etapa === 'subida_docs' || g.etapa === 'doc_completada');
          const countSubidaDocs = oppCards.filter(c => c.etapa === 'subida_docs').length;
          const countCompletada = oppCards.filter(c => c.etapa === 'doc_completada').length;

          if (oppFilter === "subida_docs") oppCards = oppCards.filter(c => c.etapa === 'subida_docs');
          else if (oppFilter === "doc_completada") oppCards = oppCards.filter(c => c.etapa === 'doc_completada');

          if (oppSearch.trim()) {
            const q = oppSearch.trim().toLowerCase();
            oppCards = oppCards.filter(g => {
              if (g._org.toLowerCase().includes(q)) return true;
              return g._contacts.some(sc =>
                sc.email.toLowerCase().includes(q) ||
                `${sc.nombre} ${sc.apellido}`.toLowerCase().includes(q)
              );
            });
          }

          oppCards.sort((a, b) => (b.fechaCambio || '').localeCompare(a.fechaCambio || ''));

          const toggleOpp = (key) => {
            setExpandedOpps(prev => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            });
          };

          return (
            <>
              <PipelineKPIs cards={pipelineData} tab="oportunidades" onFilterChange={setOppFilter} contacts={contacts} />
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{
                  padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                }}>
                  <input
                    value={oppSearch}
                    onChange={e => setOppSearch(e.target.value)}
                    placeholder="Buscar empresa o email..."
                    style={{
                      flex: 1, minWidth: 200, padding: '8px 14px', borderRadius: 8,
                      border: `1px solid ${T.border}`, fontSize: 13, fontFamily: T.sans,
                      outline: 'none', color: T.text,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <FilterChip active={oppFilter==="todas"} label="Todas" count={countSubidaDocs + countCompletada} onClick={() => setOppFilter("todas")} />
                    <FilterChip active={oppFilter==="subida_docs"} label="Subida docs" count={countSubidaDocs} onClick={() => setOppFilter("subida_docs")} />
                    <FilterChip active={oppFilter==="doc_completada"} label="Completada" count={countCompletada} onClick={() => setOppFilter("doc_completada")} />
                  </div>
                </div>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {oppCards.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: T.muted }}>
                      <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>📋</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>No hay oportunidades en esta vista</div>
                      {oppSearch && <div style={{ fontSize: 12, marginTop: 4, color: T.dim }}>Prueba con otra busqueda</div>}
                    </div>
                  ) : (
                    oppCards.map(card => (
                      <PipelineListItem
                        key={card._org}
                        card={card}
                        contact={contacts.find(c => c.email === card.email)}
                        isExpanded={expandedOpps.has(card._org)}
                        onToggle={() => toggleOpp(card._org)}
                        onViewDetail={c => setSelectedPipelineCard(c)}
                        onMoveCard={moveCard}
                        onGenerateFollowUp={handleGenerateFollowUp}
                        followUpLoading={followUpLoading}
                        onComposeFromInstructions={handleComposeFromInstructions}
                        composeInstrLoading={composeInstrLoading}
                      />
                    ))
                  )}
                </div>
              </Card>
            </>
          );
        })()}

        {/* ─── TAB: SEGUIMIENTO ─── */}
        {tab === "seguimiento" && (
          <Card>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <CardTitle>Seguimiento automático</CardTitle>
                <p style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
                  {seguimientoStep === 1 && "Selecciona las empresas a las que enviar seguimiento"}
                  {seguimientoStep === 2 && "Escribe las instrucciones para generar los emails"}
                  {seguimientoStep === 3 && (seguimientoResultado ? "Envío completado" : "Revisa los emails generados antes de enviar")}
                </p>
              </div>
              {/* Step indicator */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {[1, 2, 3].map(s => (
                  <div key={s} style={{
                    width: 32, height: 32, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 600,
                    background: seguimientoStep >= s ? T.primary : T.border,
                    color: seguimientoStep >= s ? "#fff" : T.muted,
                    transition: "all 0.2s"
                  }}>{s}</div>
                ))}
              </div>
            </div>

            {/* Step 1: Select */}
            {seguimientoStep === 1 && (
              <>
                {/* Filter chips */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {[
                    { key: 'clics', label: 'Hicieron clic' },
                    { key: 'abiertos', label: 'Solo abrieron' },
                    { key: 'todos', label: 'Todos sin responder' },
                  ].map(f => (
                    <button key={f.key} onClick={() => setSeguimientoFilter(f.key)} style={{
                      padding: "6px 14px", borderRadius: 6, border: `1px solid ${seguimientoFilter === f.key ? T.primary : T.border}`,
                      background: seguimientoFilter === f.key ? T.primaryBg : T.white,
                      color: seguimientoFilter === f.key ? T.primary : T.text,
                      fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: T.sans,
                    }}>{f.label} ({seguimientoCandidatos.filter(c => {
                      if (f.key === 'clics') return (c.numClics || 0) > 0;
                      if (f.key === 'abiertos') return (c.numAperturas || 0) > 0;
                      return true;
                    }).length})</button>
                  ))}
                </div>

                {seguimientoLoading ? (
                  <div style={{ textAlign: "center", padding: 40, color: T.muted }}>Cargando candidatos...</div>
                ) : (
                  <>
                    {/* Select all / none */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontSize: 13, color: T.muted }}>
                        {Object.values(seguimientoSelected).filter(Boolean).length} de {getSeguimientoByOrg().length} empresas seleccionadas
                      </span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => {
                          const all = {};
                          getSeguimientoByOrg().forEach(g => { all[g.org] = true; });
                          setSeguimientoSelected(all);
                        }} style={{ fontSize: 12, color: T.primary, background: "none", border: "none", cursor: "pointer", fontFamily: T.sans }}>
                          Seleccionar todas
                        </button>
                        <button onClick={() => setSeguimientoSelected({})} style={{ fontSize: 12, color: T.muted, background: "none", border: "none", cursor: "pointer", fontFamily: T.sans }}>
                          Deseleccionar todas
                        </button>
                      </div>
                    </div>

                    {/* Company list */}
                    <div style={{ maxHeight: 450, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
                      {getSeguimientoByOrg().map((group, idx) => (
                        <div key={group.org} style={{
                          display: "flex", alignItems: "center", padding: "12px 16px", gap: 12,
                          borderBottom: idx < getSeguimientoByOrg().length - 1 ? `1px solid ${T.border}` : "none",
                          background: seguimientoSelected[group.org] ? T.white : "#FAFBFC",
                          transition: "background 0.15s",
                        }}>
                          <input
                            type="checkbox"
                            checked={!!seguimientoSelected[group.org]}
                            onChange={() => setSeguimientoSelected(prev => ({ ...prev, [group.org]: !prev[group.org] }))}
                            style={{ width: 18, height: 18, accentColor: T.primary, cursor: "pointer" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: T.title }}>{group.org}</div>
                            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                              {group.contactos.length} contacto{group.contactos.length > 1 ? "s" : ""} — {group.totalClics} clics, {group.totalAperturas} aperturas
                            </div>
                          </div>
                          {group.yaSeguimiento && (
                            <span style={{
                              fontSize: 11, padding: "3px 8px", borderRadius: 4,
                              background: T.amberBg, color: T.amber, fontWeight: 500,
                            }}>Ya recibió seguimiento</span>
                          )}
                        </div>
                      ))}
                      {getSeguimientoByOrg().length === 0 && (
                        <div style={{ textAlign: "center", padding: 40, color: T.muted }}>No hay candidatos con el filtro seleccionado</div>
                      )}
                    </div>

                    {/* Next button */}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                      <button
                        onClick={() => setSeguimientoStep(2)}
                        disabled={getSelectedEmails().length === 0}
                        style={{
                          padding: "10px 24px", borderRadius: 8, border: "none",
                          background: getSelectedEmails().length > 0 ? T.primary : T.border,
                          color: getSelectedEmails().length > 0 ? "#fff" : T.muted,
                          fontSize: 14, fontWeight: 600, cursor: getSelectedEmails().length > 0 ? "pointer" : "not-allowed",
                          fontFamily: T.sans,
                        }}>
                        Siguiente — {getSelectedEmails().length} contactos →
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Step 2: Instructions */}
            {seguimientoStep === 2 && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: T.title, display: "block", marginBottom: 8 }}>
                    Instrucciones para la IA
                  </label>
                  <textarea
                    value={seguimientoInstrucciones}
                    onChange={e => setSeguimientoInstrucciones(e.target.value)}
                    placeholder="Ej: Recordarles el programa Bridge Debt, mencionar que la fecha límite de presentación es a finales de marzo. Ofrecerles una llamada para resolver dudas..."
                    style={{
                      width: "100%", minHeight: 160, padding: 14, borderRadius: 8,
                      border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.sans,
                      color: T.text, resize: "vertical", lineHeight: 1.6,
                      outline: "none",
                    }}
                  />
                  <p style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>
                    La IA generará un email personalizado para cada empresa usando estas instrucciones como guía.
                  </p>
                </div>

                <div style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
                  borderRadius: 8, background: T.sidebar, marginBottom: 20,
                }}>
                  <input
                    type="checkbox"
                    checked={seguimientoIncluirKB}
                    onChange={() => setSeguimientoIncluirKB(!seguimientoIncluirKB)}
                    style={{ width: 18, height: 18, accentColor: T.primary, cursor: "pointer" }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.title }}>Incluir base de conocimiento del programa</div>
                    <div style={{ fontSize: 12, color: T.muted }}>La IA tendrá acceso a los documentos del Bridge Debt Energy Program para contextualizar</div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <button onClick={() => setSeguimientoStep(1)} style={{
                    padding: "10px 20px", borderRadius: 8, border: `1px solid ${T.border}`,
                    background: T.white, color: T.text, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: T.sans,
                  }}>← Volver</button>
                  <button
                    onClick={handleGenerarSeguimiento}
                    disabled={!seguimientoInstrucciones.trim() || seguimientoGenerando}
                    style={{
                      padding: "10px 24px", borderRadius: 8, border: "none",
                      background: seguimientoInstrucciones.trim() && !seguimientoGenerando ? T.primary : T.border,
                      color: seguimientoInstrucciones.trim() && !seguimientoGenerando ? "#fff" : T.muted,
                      fontSize: 14, fontWeight: 600, cursor: seguimientoInstrucciones.trim() && !seguimientoGenerando ? "pointer" : "not-allowed",
                      fontFamily: T.sans,
                    }}>
                    {seguimientoGenerando ? `Generando emails (${getSelectedEmails().length})...` : `Generar emails (${getSelectedEmails().length})`}
                  </button>
                </div>
              </>
            )}

            {/* Step 3: Preview & Send */}
            {seguimientoStep === 3 && (
              <>
                {seguimientoResultado ? (
                  /* Result summary */
                  <div style={{ textAlign: "center", padding: 40 }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>
                      {seguimientoResultado.errores === 0 ? "✓" : "⚠"}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: T.title, marginBottom: 8 }}>
                      Envío completado
                    </div>
                    <div style={{ fontSize: 15, color: T.text, marginBottom: 4 }}>
                      Enviados: <strong style={{ color: T.emerald }}>{seguimientoResultado.enviados}</strong>
                    </div>
                    {seguimientoResultado.errores > 0 && (
                      <div style={{ fontSize: 15, color: T.text }}>
                        Errores: <strong style={{ color: T.red }}>{seguimientoResultado.errores}</strong>
                      </div>
                    )}
                    <button onClick={resetSeguimiento} style={{
                      marginTop: 24, padding: "10px 24px", borderRadius: 8, border: "none",
                      background: T.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: T.sans,
                    }}>Volver al inicio</button>
                  </div>
                ) : (
                  <>
                    {/* Draft list */}
                    <div style={{ marginBottom: 12, fontSize: 13, color: T.muted }}>
                      {seguimientoBorradores.length} email{seguimientoBorradores.length !== 1 ? "s" : ""} generado{seguimientoBorradores.length !== 1 ? "s" : ""}
                      {" — "}
                      {seguimientoBorradores.filter((_, i) => seguimientoExpandido[i] !== 'excluded').length} seleccionados para envío
                    </div>

                    <div style={{ maxHeight: 500, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 16 }}>
                      {seguimientoBorradores.map((b, idx) => {
                        const excluded = seguimientoExpandido[idx] === 'excluded';
                        const expanded = seguimientoExpandido[idx] === true;
                        return (
                          <div key={idx} style={{
                            borderBottom: idx < seguimientoBorradores.length - 1 ? `1px solid ${T.border}` : "none",
                            opacity: excluded ? 0.4 : 1,
                            transition: "opacity 0.2s",
                          }}>
                            <div style={{
                              display: "flex", alignItems: "center", padding: "12px 16px", gap: 12, cursor: "pointer",
                            }}
                              onClick={() => {
                                if (!excluded) setSeguimientoExpandido(prev => ({ ...prev, [idx]: prev[idx] === true ? false : true }));
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!excluded}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setSeguimientoExpandido(prev => ({
                                    ...prev,
                                    [idx]: prev[idx] === 'excluded' ? false : 'excluded'
                                  }));
                                }}
                                style={{ width: 18, height: 18, accentColor: T.primary, cursor: "pointer" }}
                              />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: T.title }}>
                                  {b.nombre || b.email} — {b.organizacion}
                                </div>
                                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                                  Asunto: {b.asunto}
                                </div>
                              </div>
                              <span style={{ fontSize: 18, color: T.muted, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
                            </div>
                            {expanded && (
                              <div style={{
                                padding: "0 16px 16px 48px",
                                borderTop: `1px solid ${T.border}`,
                                paddingTop: 12,
                              }}>
                                <div
                                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(b.cuerpoHtml) }}
                                  style={{
                                    fontSize: 13, lineHeight: 1.7, color: T.text,
                                    background: T.sidebar, padding: 16, borderRadius: 8,
                                    maxHeight: 300, overflowY: "auto",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <button onClick={() => setSeguimientoStep(2)} style={{
                        padding: "10px 20px", borderRadius: 8, border: `1px solid ${T.border}`,
                        background: T.white, color: T.text, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: T.sans,
                      }}>← Volver</button>
                      <button
                        onClick={handleEnviarSeguimiento}
                        disabled={seguimientoEnviando || seguimientoBorradores.filter((_, i) => seguimientoExpandido[i] !== 'excluded').length === 0}
                        style={{
                          padding: "10px 24px", borderRadius: 8, border: "none",
                          background: !seguimientoEnviando ? T.emerald : T.border,
                          color: !seguimientoEnviando ? "#fff" : T.muted,
                          fontSize: 14, fontWeight: 600,
                          cursor: !seguimientoEnviando ? "pointer" : "not-allowed",
                          fontFamily: T.sans,
                        }}>
                        {seguimientoEnviando
                          ? "Enviando..."
                          : `Enviar ${seguimientoBorradores.filter((_, i) => seguimientoExpandido[i] !== 'excluded').length} emails`
                        }
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </Card>
        )}
      </main>

      {/* Pipeline detail panel */}
      {selectedPipelineCard && (
        <PipelineDetail
          card={selectedPipelineCard}
          contact={contacts.find(c => c.email === selectedPipelineCard.email)}
          conversationCache={conversationCacheRef.current}
          onClose={() => setSelectedPipelineCard(null)}
          onMoveCard={moveCard}
          onAddNote={addNote}
          onGenerateFollowUp={handleGenerateFollowUp}
          followUpLoading={followUpLoading}
          onImproveMessage={handleImproveMessage}
          improveLoading={improveLoading}
          onComposeAndSave={handleComposeAndSave}
          composeLoading={composeLoading}
        />
      )}

      {/* Follow-up draft overlay */}
      {followUpDraft && (() => {
        const d = followUpDraft;
        const nombre = d.card?.nombre || d.card?.email?.split('@')[0] || '';
        const org = d.card?.organizacion || '';

        const handleSendNow = async () => {
          setFollowUpDraft(prev => ({ ...prev, sending: true }));
          try {
            const htmlBody = d.editing && d.editText.trim()
              ? d.editText.trim().split('\n\n').map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('')
              : d.borrador;
            const data = await proxyFetch("sendDraft", { email: d.email, cuerpoEditado: htmlBody });
            if (data.success) {
              delete conversationCacheRef.current[d.email];
              setFollowUpDraft(null);
              alert('Follow-up enviado correctamente');
            } else {
              alert('Error: ' + (data.error || 'No se pudo enviar'));
            }
          } catch (err) {
            alert('Error de conexion: ' + err.message);
          } finally {
            setFollowUpDraft(prev => prev ? { ...prev, sending: false } : null);
          }
        };

        const handleSchedule = async () => {
          if (!d.scheduleDate) { alert('Selecciona una fecha y hora'); return; }
          setFollowUpDraft(prev => ({ ...prev, sending: true }));
          try {
            const htmlBody = d.editing && d.editText.trim()
              ? d.editText.trim().split('\n\n').map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('')
              : d.borrador;
            const scheduledAt = new Date(d.scheduleDate).toISOString();
            const data = await proxyFetch("scheduleFollowUp", { email: d.email, htmlBody, scheduledAt });
            if (data.success) {
              setFollowUpDraft(null);
              alert(data.message || 'Follow-up programado');
            } else {
              alert('Error: ' + (data.error || 'No se pudo programar'));
            }
          } catch (err) {
            alert('Error de conexion: ' + err.message);
          } finally {
            setFollowUpDraft(prev => prev ? { ...prev, sending: false } : null);
          }
        };

        // Min datetime: now + 1 hour
        const minDate = new Date(Date.now() + 3600000).toISOString().slice(0, 16);

        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} onClick={() => !d.sending && setFollowUpDraft(null)}>
            <div style={{
              background: T.white, borderRadius: 16, width: '90%', maxWidth: 720,
              maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
              padding: 0,
            }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{
                padding: '20px 24px 16px', borderBottom: `1px solid ${T.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: T.title, fontFamily: T.sans }}>
                    Follow-up generado con IA
                  </div>
                  <div style={{ fontSize: 14, color: T.muted, marginTop: 2 }}>
                    {nombre}{org ? ` — ${org}` : ''} ({d.email})
                  </div>
                </div>
                <button onClick={() => !d.sending && setFollowUpDraft(null)} style={{
                  background: 'none', border: 'none', fontSize: 22, color: T.muted,
                  cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
                }}>&times;</button>
              </div>

              {/* Body — preview or edit */}
              <div style={{ padding: '20px 24px' }}>
                {d.editing ? (
                  <textarea
                    value={d.editText}
                    onChange={e => setFollowUpDraft(prev => ({ ...prev, editText: e.target.value }))}
                    style={{
                      width: '100%', minHeight: 300, padding: '14px 16px', fontSize: 14,
                      fontFamily: T.sans, lineHeight: 1.7, color: T.text,
                      borderRadius: 8, border: `1px solid ${T.primary}`,
                      background: T.white, resize: 'vertical', boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <div style={{
                    padding: '16px 20px', borderRadius: 10, border: `1px solid ${T.border}`,
                    background: '#FAFBFC', fontSize: 14, lineHeight: 1.7, color: T.text,
                    fontFamily: T.sans, maxHeight: 400, overflowY: 'auto',
                  }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(d.borrador) }} />
                )}

                {/* Edit / Preview toggle */}
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  {d.editing ? (
                    <button onClick={() => setFollowUpDraft(prev => ({ ...prev, editing: false }))} style={{
                      background: T.white, border: `1px solid ${T.border}`, borderRadius: 6,
                      padding: '6px 14px', fontSize: 13, fontWeight: 500, color: T.text,
                      cursor: 'pointer', fontFamily: T.sans,
                    }}>Vista previa</button>
                  ) : (
                    <button onClick={() => setFollowUpDraft(prev => ({
                      ...prev, editing: true,
                      editText: prev.editText || prev.borrador.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<[^>]+>/g, ''),
                    }))} style={{
                      background: T.white, border: `1px solid ${T.border}`, borderRadius: 6,
                      padding: '6px 14px', fontSize: 13, fontWeight: 600, color: T.primary,
                      cursor: 'pointer', fontFamily: T.sans,
                    }}>&#9998; Editar</button>
                  )}
                </div>
              </div>

              {/* Schedule section */}
              {d.scheduling && (
                <div style={{
                  padding: '0 24px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.sans }}>
                    Enviar el:
                  </label>
                  <input
                    type="datetime-local"
                    min={minDate}
                    value={d.scheduleDate}
                    onChange={e => setFollowUpDraft(prev => ({ ...prev, scheduleDate: e.target.value }))}
                    style={{
                      padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.border}`,
                      fontSize: 13, fontFamily: T.sans, color: T.text, outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans }}>
                    Se cancela si responde antes
                  </span>
                </div>
              )}

              {/* Actions footer */}
              <div style={{
                padding: '16px 24px 20px', borderTop: `1px solid ${T.border}`,
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              }}>
                <button onClick={handleSendNow} disabled={d.sending} style={{
                  background: d.sending ? T.border : T.emerald, color: '#fff', border: 'none',
                  borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600,
                  cursor: d.sending ? 'default' : 'pointer', fontFamily: T.sans,
                }}>{d.sending ? 'Enviando...' : 'Enviar ahora'}</button>

                {!d.scheduling ? (
                  <button onClick={() => setFollowUpDraft(prev => ({ ...prev, scheduling: true }))} disabled={d.sending} style={{
                    background: T.white, border: `1px solid ${T.border}`, borderRadius: 8,
                    padding: '10px 20px', fontSize: 14, fontWeight: 500, color: T.text,
                    cursor: 'pointer', fontFamily: T.sans, display: 'flex', alignItems: 'center', gap: 6,
                  }}>&#128197; Programar envio</button>
                ) : (
                  <button onClick={handleSchedule} disabled={d.sending || !d.scheduleDate} style={{
                    background: d.sending || !d.scheduleDate ? T.border : T.primary,
                    color: '#fff', border: 'none', borderRadius: 8,
                    padding: '10px 20px', fontSize: 14, fontWeight: 600,
                    cursor: d.sending || !d.scheduleDate ? 'default' : 'pointer', fontFamily: T.sans,
                  }}>{d.sending ? 'Programando...' : 'Confirmar programacion'}</button>
                )}

                <button onClick={() => !d.sending && setFollowUpDraft(null)} disabled={d.sending} style={{
                  background: 'none', border: 'none', padding: '10px 16px',
                  fontSize: 14, color: T.muted, cursor: 'pointer', fontFamily: T.sans,
                }}>Cancelar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Slide-over panel for conversation view */}
      <BridgeSlideOverPanel
        isOpen={panelOpen}
        onClose={handlePanelClose}
        contacto={selectedContact}
        proxyFetch={proxyFetch}
        onSendSuccess={handleSendSuccess}
      />
    </div>
  );
}
