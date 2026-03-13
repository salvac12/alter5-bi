/* ═══════════════════════════════════════════════════════════════
   Taxonomía v2 — Roles, Segments, Types, Activities, Attributes
   ═══════════════════════════════════════════════════════════════ */

/* ── Company Roles (replaces Groups) ── */
export const COMPANY_ROLES = [
  { id: "Originación", label: "Originación", color: "#F59E0B" },
  { id: "Inversión", label: "Inversión", color: "#3B82F6" },
  { id: "Services", label: "Services", color: "#6B7F94" },
  { id: "No relevante", label: "No relevante", color: "#94A3B8" },
];

/* ── Segments (only for Originación) ── */
export const ORIGINACION_SEGMENTS = [
  { id: "Project Finance", label: "Project Finance" },
  { id: "Corporate Finance", label: "Corporate Finance" },
];

/* ── Company Types v2 (per role + segment context) ── */
export const COMPANY_TYPES_V2 = {
  // Originación > Project Finance
  "Originación > Project Finance": ["Developer", "IPP", "Developer + IPP"],
  // Originación > Corporate Finance — no fixed types, uses activities
  "Originación > Corporate Finance": [],
  // Inversión subtypes by debt/equity
  "Inversión > Deuda": ["Fondo de deuda", "Banco", "Bonista / Institucional"],
  "Inversión > Equity": ["Fondo de infraestructura", "Private equity", "Fondo renovable", "IPP comprador", "Utility compradora"],
  // Services
  "Services": ["Asesor legal", "Asesor técnico", "Consultor de precios", "Asset manager", "Ingeniería", "Asesor financiero", "Asociación / Institución"],
};

/* ── All v2 types flat ── */
export const ALL_COMPANY_TYPES_V2 = Object.values(COMPANY_TYPES_V2).flat();

/* ── Corporate Finance Activities (multi-select) ── */
export const CORPORATE_ACTIVITIES = [
  "Autoconsumo industrial/comercial",
  "Movilidad / Cargadores EV",
  "EPC / Construcción renovable",
  "Almacenamiento / BESS distribuido",
  "Data centers",
  "Electrointensivo",
  "Biogás / Biometano",
  "Hidrógeno verde",
  "Eficiencia energética",
  "Calor renovable / Biomasa",
  "Redes / Infraestructura eléctrica",
  "Agritech / Agrovoltaica",
];

/* ── Originación: Business Lines (from enrich_originacion.py) ── */
export const ORIGINACION_BUSINESS_LINES = [
  { id: "Utility-scale developer", label: "Utility-scale developer", icon: "\u26A1" },
  { id: "Autoconsumo industrial", label: "Autoconsumo industrial", icon: "\uD83C\uDFED" },
  { id: "Autoconsumo residencial", label: "Autoconsumo residencial", icon: "\uD83C\uDFE0" },
  { id: "EPC / Construcci\u00F3n", label: "EPC / Construcci\u00F3n", icon: "\uD83D\uDD27" },
  { id: "IPP", label: "IPP", icon: "\uD83D\uDD0C" },
  { id: "O&M / Asset Management", label: "O&M / Asset Mgmt", icon: "\uD83D\uDEE0\uFE0F" },
  { id: "Almacenamiento / BESS", label: "BESS", icon: "\uD83D\uDD0B" },
  { id: "Hidr\u00F3geno verde", label: "H2 Verde", icon: "\uD83D\uDCA7" },
  { id: "Biog\u00E1s / Biometano", label: "Biog\u00E1s", icon: "\u267B\uFE0F" },
  { id: "Agrovoltaica", label: "Agrovoltaica", icon: "\uD83C\uDF31" },
  { id: "Cargadores EV / Movilidad", label: "EV / Movilidad", icon: "\uD83D\uDE97" },
  { id: "Trading / PPA", label: "Trading / PPA", icon: "\uD83D\uDCCA" },
];

/* ── Originación: Project Scales ── */
export const PROJECT_SCALES = [
  { id: "Utility-scale", label: "Utility-scale", color: "#3B82F6" },
  { id: "Distribuido", label: "Distribuido", color: "#F59E0B" },
  { id: "Mixto", label: "Mixto", color: "#8B5CF6" },
];

/* ── Inversión: Investor Types (from enrich_inversion.py) ── */
export const INVESTOR_TYPES_WEB = [
  { id: "Fondo de deuda", label: "Fondo de deuda", icon: "\uD83D\uDCB0" },
  { id: "Fondo de infraestructura", label: "Fondo infra", icon: "\uD83C\uDFD7\uFE0F" },
  { id: "Private equity", label: "Private equity", icon: "\uD83D\uDCC8" },
  { id: "Fondo renovable", label: "Fondo renovable", icon: "\uD83C\uDF3F" },
  { id: "Banco comercial", label: "Banco comercial", icon: "\uD83C\uDFE6" },
  { id: "Banco de inversi\u00F3n", label: "Banco inversi\u00F3n", icon: "\uD83C\uDFE6" },
  { id: "Gestora de activos", label: "Gestora", icon: "\uD83D\uDCBC" },
  { id: "Family office", label: "Family office", icon: "\uD83C\uDFE0" },
  { id: "Aseguradora / Pensiones", label: "Aseguradora", icon: "\uD83D\uDEE1\uFE0F" },
  { id: "Utility / Energ\u00E9tica", label: "Utility", icon: "\u26A1" },
  { id: "DFI / Multilateral", label: "DFI", icon: "\uD83C\uDF0D" },
  { id: "Bonista / Institucional", label: "Institucional", icon: "\uD83C\uDFDB\uFE0F" },
  { id: "Plataforma de crowdfunding", label: "Crowdfunding", icon: "\uD83D\uDC65" },
  { id: "Corporate venture", label: "Corp. venture", icon: "\uD83C\uDFAF" },
];

/* ── Inversión: Investor Focus ── */
export const INVESTOR_FOCUS_OPTIONS = [
  { id: "Deuda senior", label: "Deuda senior", color: "#3B82F6" },
  { id: "Deuda mezzanine", label: "Mezzanine", color: "#6366F1" },
  { id: "Project Finance", label: "Project Finance", color: "#0EA5E9" },
  { id: "Corporate lending", label: "Corporate lending", color: "#14B8A6" },
  { id: "Equity mayor\u00EDa", label: "Equity mayor\u00EDa", color: "#10B981" },
  { id: "Equity minor\u00EDa", label: "Equity minor\u00EDa", color: "#34D399" },
  { id: "Co-inversi\u00F3n", label: "Co-inversi\u00F3n", color: "#8B5CF6" },
  { id: "M&A / Adquisiciones", label: "M&A", color: "#EC4899" },
  { id: "Greenfield development", label: "Greenfield", color: "#F59E0B" },
  { id: "Brownfield / Operativo", label: "Brownfield", color: "#78716C" },
  { id: "Trading / PPA", label: "Trading / PPA", color: "#F97316" },
];

/* ── Technologies (multi-select) ── */
export const TECHNOLOGIES = [
  { id: "Solar", label: "Solar", icon: "☀️" },
  { id: "Eólica", label: "Eólica", icon: "💨" },
  { id: "BESS", label: "BESS", icon: "🔋" },
  { id: "Biogás", label: "Biogás", icon: "♻️" },
  { id: "Hidrógeno", label: "Hidrógeno", icon: "⚡" },
  { id: "Otra", label: "Otra", icon: "🔧" },
];

/* ── Asset Phases ── */
export const ASSET_PHASES = ["Desarrollo", "RTB", "Construcción", "Operativo"];

/* ── Geographies ── */
export const GEOGRAPHIES = ["España", "Portugal", "Italia", "Francia", "Alemania", "UK", "Otro"];

/* ── Commercial Phases ── */
export const COMMERCIAL_PHASES = [
  "Sin contactar",
  "Primer contacto",
  "Exploración",
  "Negociación",
  "Cliente activo",
  "Dormido",
];

/* ── Scoring weights (by role) ── */
export const ROLE_WEIGHTS = {
  "Originación": 20,
  "Inversión": 18,
  "Services": 8,
  "No relevante": 0,
};

/* ═══════════════════════════════════════════════════════
   Legacy aliases — backward compat during transition
   ═══════════════════════════════════════════════════════ */
export const COMPANY_GROUPS = COMPANY_ROLES;
export const GROUP_WEIGHTS = {
  "Capital Seeker": 20,
  "Investor": 18,
  "Other": 2,
  // v2 roles also in same map for scoring (includes Services: 8)
  ...ROLE_WEIGHTS,
};
export const COMPANY_TYPES = {
  "Capital Seeker": ["Developer", "IPP", "Utility", "Asset Owner", "Corporate"],
  "Investor": ["Renewable Fund", "Institutional Investor", "Bank", "Family Office", "Infrastructure Fund"],
  "Other": ["Public Institution", "Association", "Other"],
  // v2 roles map to their types
  "Originación": [...(COMPANY_TYPES_V2["Originación > Project Finance"] || []), ...(COMPANY_TYPES_V2["Originación > Corporate Finance"] || [])],
  "Inversión": [...(COMPANY_TYPES_V2["Inversión > Deuda"] || []), ...(COMPANY_TYPES_V2["Inversión > Equity"] || [])],
  "Services": [...(COMPANY_TYPES_V2["Services"] || []), "Legal Advisor", "Financial Advisor", "Technical Advisor", "EPC / Contractor", "Consultant", "Platform / Tech"],
  "No relevante": [],
};
export const ALL_COMPANY_TYPES = [...new Set(Object.values(COMPANY_TYPES).flat())];

/* ── Status config ── */
export const STATUS_LABELS = { active: "Activa", dormant: "Dormida", lost: "Perdida" };
export const STATUS_COLORS = { active: "#10B981", dormant: "#F59E0B", lost: "#EF4444" };
export const STATUS_BG = { active: "#ECFDF5", dormant: "#FFFBEB", lost: "#FEF2F2" };

export const REF_DATE = new Date();
export const PER_PAGE = 50;

/* ── Productos Alter5 — taxonomía para matching ── */
export const PRODUCTS = [
  {
    id: "debt",
    name: "Debt",
    short: "Debt",
    color: "#3B82F6",
    description: "Financiación de deuda para proyectos renovables: project finance, corporate loans, refinanciación",
    subcategories: [
      { id: "project_finance", name: "Project Finance" },
      { id: "asset_backed", name: "Asset Backed" },
      { id: "development_debt", name: "Development Debt" },
      { id: "corporate_loan", name: "Corporate Loan" },
      { id: "pf_guaranteed", name: "Project Finance Guaranteed" },
    ],
    keywords: {
      high: [
        "term sheet", "term-sheet", "préstamo construcción", "construction loan",
        "deuda senior", "financiación de proyecto", "project finance",
        "préstamo puente", "bridge loan", "bridge financing", "EPC",
        "cierre financiero", "financial close", "closing",
        "refinanciación", "refinancing", "refinanciar", "reestructuración",
        "restructuring", "deuda existente", "existing debt", "amortización",
        "swap", "cobertura", "hedging",
      ],
      medium: [
        "fotovoltaic", "eólic", "parque solar", "parque eólico", "wind farm",
        "solar farm", "utility-scale", "utility scale", "greenfield",
        "RTB", "ready to build", "ready-to-build", "BESS", "baterías",
        "almacenamiento", "storage", "COD", "GEB", "FEI",
        "construcción", "construction",
        "operativo", "operating", "en operación", "operational",
        "parque operativo", "deuda senior", "senior debt",
        "bonista", "bondholder", "bono verde", "green bond",
      ],
      low: [
        "renovable", "energía", "solar", "eólico", "eolico", "wind",
        "MW", "MWp", "MWh", "GW", "pipeline", "cartera de proyectos",
        "portfolio", "merchant", "PPA",
        "fotovoltaic", "eólic",
      ],
    },
    dealRoles: ["Borrower", "Debt Investor"],
    groupBonus: "Capital Seeker",
    roleBonus: "Originación",
    roles: [
      "structured finance", "project finance", "financiación estructurada",
      "cfo", "chief financial officer", "director financiero",
      "head of finance", "tesorero", "treasurer", "asset management",
    ],
  },
  {
    id: "equity",
    name: "Equity",
    short: "Equity",
    color: "#10B981",
    description: "Inversión en equity, M&A y colocación a inversores para proyectos y activos renovables",
    subcategories: [
      { id: "ma", name: "M&A" },
      { id: "co_development", name: "Co-Development" },
      { id: "equity_investment", name: "Equity Investment" },
    ],
    keywords: {
      high: [
        "inversor", "investor", "colocación", "placement", "fondo",
        "fund", "family office", "asset manager", "gestora",
        "mandato", "mandate", "co-inversión", "co-investment",
        "m&a", "compraventa", "adquisición", "acquisition", "venta",
        "sale", "due diligence", "valoración", "valuation",
        "sell-side", "buy-side", "marketplace", "teaser",
      ],
      medium: [
        "rentabilidad", "yield", "retorno", "return", "TIR", "IRR",
        "cupón", "coupon", "bono", "bond", "nota", "note",
        "tramo", "tranche", "mezzanine",
        "transacción", "transaction", "deal", "pipeline de ventas",
        "asset rotation", "rotación de activos", "SPV",
        "cambio de titularidad", "SPA",
      ],
      low: [
        "renovable", "energía", "solar", "eólico", "MW",
        "fotovoltaic", "portfolio", "cartera", "proyecto",
      ],
    },
    dealRoles: ["Seller (M&A)", "Buyer Investor (M&A)", "Equity Investor"],
    groupBonus: "Investor",
    roleBonus: "Inversión",
    roles: [
      "portfolio manager", "fund manager", "investment director",
      "cio", "chief investment officer", "analyst",
      "gestor de fondos", "director de inversiones",
      "m&a", "corporate finance", "business development",
      "desarrollo de negocio", "director comercial",
      "investment banking", "origination",
    ],
  },
];

/* ── Market Roles (clasificación Gemini) ── */
export const MARKET_ROLES = [
  { id: "Borrower", label: "Borrower", color: "#F59E0B" },
  { id: "Seller (M&A)", label: "Seller (M&A)", color: "#EF4444" },
  { id: "Buyer Investor (M&A)", label: "Buyer Investor (M&A)", color: "#8B5CF6" },
  { id: "Debt Investor", label: "Debt Investor", color: "#3B82F6" },
  { id: "Equity Investor", label: "Equity Investor", color: "#10B981" },
  { id: "Partner & Services", label: "Partner & Services", color: "#6B7F94" },
];

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
