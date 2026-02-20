/* ── Filter options ── */
export const SECTORS = [
  "Asesor Financiero", "Banca", "Construcción", "Consultoría", "Energía",
  "Fintech", "Institucional", "Inversión", "Inversor/Fondo", "Legal",
  "Otro", "Renovables", "Tecnología"
];

export const TIPOS = [
  "Asesor Financiero", "Asesor Legal", "Asesor Técnico", "Banco", "Consultoría",
  "Institucional", "Inversor/Fondo", "Networking", "No identificado", "Otro",
  "Partnership", "Potencial Prestatario", "Proveedor"
];

/* ── Status config ── */
export const STATUS_LABELS = { active: "Activa", dormant: "Dormida", lost: "Perdida" };
export const STATUS_COLORS = { active: "#10B981", dormant: "#F59E0B", lost: "#EF4444" };
export const STATUS_BG = { active: "#ECFDF5", dormant: "#FFFBEB", lost: "#FEF2F2" };

/* ── Scoring weights ── */
export const TYPE_WEIGHTS = {
  "Potencial Prestatario": 20,
  "Inversor/Fondo": 18,
  "Partnership": 16,
  "Banco": 15,
  "Asesor Financiero": 12,
  "Institucional": 10,
  "Consultoría": 8,
  "Asesor Legal": 8,
  "Asesor Técnico": 8,
  "Networking": 6,
  "Proveedor": 5,
  "Otro": 2,
  "No identificado": 1,
};

/* ── Color rules: which badge gets which color ── */
/* Emerald → sectors, ESG, sustainability, energy, EIF, renewables */
export const EMERALD_SECTORS = ["Renovables", "Energía", "Institucional"];
/* Blue → platform, solutions, tech, AI, fintech */
export const BLUE_SECTORS = ["Fintech", "Tecnología", "Consultoría"];

export const REF_DATE = new Date("2026-02-14");
export const PER_PAGE = 50;

/* ── Tamaño de empresa (rangos de empleados) ── */
export const COMPANY_SIZES = [
  { id: "micro", label: "Micro (1-10)", min: 1, max: 10 },
  { id: "small", label: "Pequeña (11-50)", min: 11, max: 50 },
  { id: "medium", label: "Mediana (51-200)", min: 51, max: 200 },
  { id: "large", label: "Grande (201-500)", min: 201, max: 500 },
  { id: "xlarge", label: "Muy Grande (500+)", min: 500, max: Infinity },
  { id: "unknown", label: "Sin datos", min: null, max: null },
];

/* ── Países (preparado para futuro) ── */
export const COUNTRIES = [
  { id: "es", label: "España" },
  { id: "intl", label: "Internacional" },
  { id: "unknown", label: "Sin clasificar" },
];
