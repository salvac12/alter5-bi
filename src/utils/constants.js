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

export const REF_DATE = new Date("2026-02-14");
export const PER_PAGE = 50;

/* ── Productos Alter5 — taxonomía para matching ── */
export const PRODUCTS = [
  {
    id: "construction_loan",
    name: "Préstamo Construcción",
    short: "Constr.",
    color: "#F59E0B",
    description: "Project finance para construcción de proyectos utility-scale (solar, eólico, BESS)",
    keywords: {
      high: [
        "term sheet", "term-sheet", "préstamo construcción", "construction loan",
        "deuda senior", "financiación de proyecto", "project finance",
        "préstamo puente", "bridge loan", "bridge financing", "EPC",
        "cierre financiero", "financial close", "closing",
      ],
      medium: [
        "fotovoltaic", "eólic", "parque solar", "parque eólico", "wind farm",
        "solar farm", "utility-scale", "utility scale", "greenfield",
        "RTB", "ready to build", "ready-to-build", "BESS", "baterías",
        "almacenamiento", "storage", "COD", "GEB", "FEI",
        "construcción", "construction",
      ],
      low: [
        "renovable", "energía", "solar", "eólico", "eolico", "wind",
        "MW", "MWp", "MWh", "GW", "pipeline", "cartera de proyectos",
        "portfolio", "merchant", "PPA",
      ],
    },
    sectors: ["Renovables", "Energía", "Energia"],
    relTypes: ["Potencial Prestatario"],
    roles: [
      "structured finance", "project finance", "financiación estructurada",
      "cfo", "chief financial officer", "director financiero",
      "head of finance", "tesorero", "treasurer",
    ],
  },
  {
    id: "refinancing",
    name: "Refinanciación",
    short: "Refin.",
    color: "#3B82F6",
    description: "Refinanciación de deuda existente en proyectos operativos renewables",
    keywords: {
      high: [
        "refinanciación", "refinancing", "refinanciar", "reestructuración",
        "restructuring", "deuda existente", "existing debt", "amortización",
        "swap", "cobertura", "hedging",
      ],
      medium: [
        "operativo", "operating", "COD", "en operación", "operational",
        "parque operativo", "deuda senior", "senior debt",
        "bonista", "bondholder", "bono verde", "green bond",
      ],
      low: [
        "renovable", "energía", "solar", "eólico", "MW", "MWp",
        "fotovoltaic", "eólic", "merchant", "PPA",
      ],
    },
    sectors: ["Renovables", "Energía", "Energia"],
    relTypes: ["Potencial Prestatario"],
    roles: [
      "structured finance", "project finance", "financiación estructurada",
      "cfo", "chief financial officer", "director financiero",
      "head of finance", "asset management",
    ],
  },
  {
    id: "investor_placement",
    name: "Colocación Inversores",
    short: "Inv.",
    color: "#8B5CF6",
    description: "Colocación de deuda/equity a inversores institucionales para proyectos renovables",
    keywords: {
      high: [
        "inversor", "investor", "colocación", "placement", "fondo",
        "fund", "family office", "asset manager", "gestora",
        "mandato", "mandate", "co-inversión", "co-investment",
      ],
      medium: [
        "rentabilidad", "yield", "retorno", "return", "TIR", "IRR",
        "cupón", "coupon", "bono", "bond", "nota", "note",
        "tramo", "tranche", "mezzanine",
      ],
      low: [
        "renovable", "energía", "solar", "eólico", "MW",
        "fotovoltaic", "portfolio", "cartera",
      ],
    },
    sectors: ["Inversor/Fondo", "Inversión", "Banca"],
    relTypes: ["Inversor/Fondo", "Banco"],
    roles: [
      "portfolio manager", "fund manager", "investment director",
      "cio", "chief investment officer", "analyst",
      "gestor de fondos", "director de inversiones",
    ],
  },
  {
    id: "advisory",
    name: "Advisory / M&A",
    short: "M&A",
    color: "#10B981",
    description: "Asesoramiento en compraventa de proyectos y activos renovables",
    keywords: {
      high: [
        "m&a", "compraventa", "adquisición", "acquisition", "venta",
        "sale", "due diligence", "valoración", "valuation",
        "mandate", "mandato", "sell-side", "buy-side",
        "marketplace", "teaser",
      ],
      medium: [
        "transacción", "transaction", "deal", "pipeline de ventas",
        "asset rotation", "rotación de activos", "SPV",
        "cambio de titularidad", "SPA",
      ],
      low: [
        "renovable", "energía", "solar", "eólico", "MW",
        "fotovoltaic", "portfolio", "cartera", "proyecto",
      ],
    },
    sectors: ["Renovables", "Energía", "Energia", "Asesor Financiero", "Consultoría"],
    relTypes: ["Potencial Prestatario", "Asesor Financiero", "Partnership"],
    roles: [
      "m&a", "corporate finance", "business development",
      "desarrollo de negocio", "director comercial",
      "investment banking", "origination",
    ],
  },
];

/* ── Subtipos de empresa (enrichment IA) ── */
export const SUBTIPOS_EMPRESA = [
  "Desarrollador", "IPP", "Fondo Renovable", "Utility", "EPC/Proveedor",
  "Asesor", "Inversor Institucional", "Banco/Entidad Financiera",
  "Family Office", "Administracion Publica", "Otro"
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
