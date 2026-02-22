/* ── Filter options ── */
export const SECTORS = [
  "Asesor Financiero", "Asociación", "Banca", "Construcción", "Consultoría",
  "Energía", "Fintech", "Institucional", "Inversión", "Inversor/Fondo",
  "Legal", "Otro", "Renovables", "Tecnología"
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
      {
        id: "project_finance",
        name: "Project Finance",
        children: ["Short Term", "Medium Term", "Long Term", "Development Debt", "AssetCo Debt"],
      },
      {
        id: "corporate_loan",
        name: "Corporate Loan",
        children: ["Corporate Debt", "HoldCo Debt", "Project Finance Guaranteed"],
      },
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
    sectors: ["Renovables", "Energía", "Energia"],
    relTypes: ["Potencial Prestatario"],
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
    sectors: ["Inversor/Fondo", "Inversión", "Banca", "Renovables", "Energía", "Energia", "Asesor Financiero", "Consultoría"],
    relTypes: ["Inversor/Fondo", "Banco", "Potencial Prestatario", "Asesor Financiero", "Partnership"],
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

/* ── Subtipos de empresa (enrichment IA) ── */
export const SUBTIPOS_EMPRESA = [
  "Desarrollador", "IPP", "Fondo Renovable", "Utility", "EPC/Proveedor",
  "Asesor", "Inversor Institucional", "Banco/Entidad Financiera",
  "Family Office", "Administracion Publica", "Plataforma Crowdfunding", "Otro"
];

export const FASES_COMERCIALES = [
  "Primer contacto", "Exploracion", "Negociacion",
  "Cliente activo", "Dormido", "Descartado"
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
