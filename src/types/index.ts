/* ═══════════════════════════════════════════════════════════════
   Alter5 BI — Shared TypeScript types
   ═══════════════════════════════════════════════════════════════ */

// ── Company ──────────────────────────────────────────────────────

export type CompanyStatus = 'active' | 'dormant' | 'lost';

export type CompanyRole = 'Originación' | 'Inversión' | 'Services' | 'No relevante';

export type VerifiedStatus = 'Pending Review' | 'Verified' | 'Edited' | 'Rejected';

export interface CompanyContact {
  name: string;
  role: string;
  email: string;
  linkedinUrl?: string;
}

export interface TimelineEntry {
  quarter: string;
  emails: number;
  summary: string;
}

export interface DatedSubject {
  date: string;
  subject: string;
  extract: string;
}

export interface EmployeeSource {
  employee: string;
  interactions: number;
}

export interface Enrichment {
  _tv?: number;
  _classified_at?: string;
  _email_count?: number;
  role?: string;
  seg?: string;
  tp2?: string;
  tp?: string;
  grp?: string;
  act?: string[];
  tech?: string[];
  geo?: string[];
  mr?: string[];
  pp?: string[];
  sc?: string[];
  fase_activo?: string;
  fase?: string;
  fc?: string;
  [key: string]: any;
}

export interface CompanyDetail {
  contacts: CompanyContact[];
  timeline: TimelineEntry[];
  context: string;
  sources: EmployeeSource[];
  subjects: string[];
  enrichment: Enrichment | null;
  datedSubjects: DatedSubject[];
}

export interface Opportunity {
  stage: string;
  name?: string;
  amount?: number;
  product?: string;
}

export interface Company {
  idx: number;
  name: string;
  domain: string;
  sector: string;
  contacts: number;
  interactions: number;
  firstDate: string;
  lastDate: string;
  employees: string[];
  status: CompanyStatus;
  score: number;
  qualityScore: number;
  role: string;
  group: string;
  segment: string;
  companyType: string;
  activities: string[];
  technologies: string[];
  geography: string[];
  assetPhase: string;
  commercialPhase: string;
  marketRoles: string[];
  productosIA: string[];
  senales: string[];
  opportunity: Opportunity | null;
  detail: CompanyDetail | null;
}

// ── Prospects ────────────────────────────────────────────────────

export type ProspectStage = 'Lead' | 'Interesado' | 'Reunion' | 'Documentacion Pendiente' | 'Listo para Term-Sheet';

export type ProductType =
  | 'Corporate Debt'
  | 'Project Finance'
  | 'Development Debt'
  | 'PF Guaranteed'
  | 'Investment'
  | 'Co-Development'
  | 'M&A';

export interface ProspectContact {
  name: string;
  email: string;
  role: string;
}

export interface Prospect {
  id: string;
  name: string;
  stage: ProspectStage;
  product: ProductType | string;
  amount: number;
  probability: number;
  contactName: string;
  contactEmail: string;
  contacts: ProspectContact[];
  notes: string;
  nextStep: string;
  assignedTo: string;
  origin: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  tasks: any[];
  [key: string]: any;
}

// ── Pipeline Opportunities ───────────────────────────────────────

export interface PipelineOpportunity {
  id: string;
  name: string;
  stage: string;
  amount: number;
  product: string;
  type: string;
  contactName: string;
  contactEmail: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  closedDate: string;
  probability: number;
  [key: string]: any;
}

// ── Campaigns ────────────────────────────────────────────────────

export interface Campaign {
  id: string;
  name: string;
  status: string;
  type: string;
  subject: string;
  totalRecipients: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
  bounceCount: number;
  createdAt: string;
  updatedAt: string;
  triggers: string[];
  [key: string]: any;
}

// ── Verified Companies ───────────────────────────────────────────

export interface VerifiedCompany {
  domain: string;
  companyName: string;
  role: string;
  segment: string;
  type: string;
  technologies: string[];
  geography: string[];
  marketRoles: string[];
  webDescription: string;
  webSources: string[];
  previousClassification: string;
  mismatch: boolean;
  notes: string;
  confidence: number;
  status: VerifiedStatus;
  verifiedBy: string;
  verifiedAt: string;
}

// ── UI State ─────────────────────────────────────────────────────

export type ViewId = 'empresas' | 'prospects' | 'pipeline' | 'structuring' | 'distribution' | 'closing' | 'campanas' | 'analysis' | 'prospeccion' | 'bridge-campaigns' | 'bridge-explorer' | 'candidates';

export interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  section?: string;
}

// ── Toast ────────────────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}
