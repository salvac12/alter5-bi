/* ── Company Groups (replaces Sectors + Tipos + Subtipos) ── */
export const COMPANY_GROUPS = [
  { id: "Capital Seeker", label: "Capital Seeker", color: "#F59E0B" },
  { id: "Investor", label: "Investor", color: "#3B82F6" },
  { id: "Services", label: "Services", color: "#6B7F94" },
  { id: "Other", label: "Other", color: "#94A3B8" },
];

/* ── Company Types (per group) ── */
export const COMPANY_TYPES = {
  "Capital Seeker": ["Developer", "IPP", "Utility", "Asset Owner", "Corporate"],
  "Investor": ["Renewable Fund", "Institutional Investor", "Bank", "Family Office", "Infrastructure Fund"],
  "Services": ["Legal Advisor", "Financial Advisor", "Technical Advisor", "EPC / Contractor", "Consultant", "Platform / Tech"],
  "Other": ["Public Institution", "Association", "Other"],
};

/* ── All types flat (for cases where no group filter is active) ── */
export const ALL_COMPANY_TYPES = Object.values(COMPANY_TYPES).flat();

/* ── Deal Stages (only for Capital Seekers) ── */
export const DEAL_STAGES = [
  "Prospect", "Opportunity", "Documentation",
  "TS Preparation", "TS Sent / Discussion", "Signing", "Distribution",
];

/* ── Status config ── */
export const STATUS_LABELS = { active: "Activa", dormant: "Dormida", lost: "Perdida" };
export const STATUS_COLORS = { active: "#10B981", dormant: "#F59E0B", lost: "#EF4444" };
export const STATUS_BG = { active: "#ECFDF5", dormant: "#FFFBEB", lost: "#FEF2F2" };

/* ── Scoring weights ── */
export const GROUP_WEIGHTS = {
  "Capital Seeker": 20,
  "Investor": 18,
  "Services": 8,
  "Other": 2,
};

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
