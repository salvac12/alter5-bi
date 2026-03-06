# Alter5 BI — Claude Code Instructions

## Project
Dashboard de inteligencia comercial para Alter5 (financiacion energias renovables).
React 18 + Vite 5 frontend, Python scripts, Airtable API, Vercel deploy.

## Commands
- `npm run dev` — dev server (tiene CSP eval issues, usar preview)
- `npm run preview` — build + preview (recomendado para testing)
- `npm run build` — production build
- `python scripts/sync_airtable_opportunities.py` — sync Airtable Opportunities -> JSON
- `python scripts/process_sheet_emails.py` — pipeline Gmail -> companies.json (diario en CI)
- `python scripts/process_sheet_emails.py --reprocess` — releer emails ya procesados (backfill)
- `python scripts/backfill_classifications.py` — re-clasificar todas las empresas con pipeline mejorado
- `python scripts/backfill_classifications.py --top 500` — re-clasificar top 500 por interacciones
- `python scripts/backfill_classifications.py --unclassified` — solo empresas sin enrichment v2
- `python scripts/backfill_classifications.py --roles` — tambien re-clasificar roles de contactos
- `python scripts/backfill_classifications.py --dry-run` — preview sin escribir
- `python scripts/create_prospects_table.py` — crear tabla Prospects en Airtable (una vez)
- `python scripts/verify_classifications.py --top 50` — verificar top 50 empresas con Gemini + Google Search
- `python scripts/verify_classifications.py --domain X` — verificar una empresa concreta
- `python scripts/verify_classifications.py --top 200 --unverified` — solo empresas sin verificar
- `python scripts/verify_classifications.py --mismatched` — solo empresas con mismatch detectado
- `python scripts/verify_classifications.py --force` — re-verificar incluso ya verificadas
- `python scripts/verify_classifications.py --dry-run` — preview sin escribir a Airtable
- `python scripts/create_verified_table.py` — crear tabla Verified-Companies en Airtable (una vez, YA EJECUTADO)

## Architecture
- **3 vistas**: Empresas (tabla CRM con ~3,943 empresas), Prospects (Kanban pre-pipeline) y Pipeline (Kanban Airtable con ~114 deals)
- **Datos empresas**: `src/data/companies.json` (compact), `companies_full.json` (dict by domain, trackeado en git)
- **Datos pipeline**: live API Airtable (`src/utils/airtable.js`) + static `src/data/opportunities.json`
- **Datos prospects**: live API Airtable (`src/utils/airtableProspects.js`), tabla "BETA-Prospects"
- **Enrichment**: AI-generated taxonomy con localStorage overrides editables inline
- **Verificacion**: Agente Gemini + Google Search que verifica clasificaciones vs web real, persiste en Airtable "Verified-Companies"
- **Quality Score**: `qualityScore` (0-100) en `data.js` mide completitud de datos (enrichment, roles contacto, timeline, contexto, market roles). Labels: alta/media/baja. Dot visual en CompanyTable

### Flujo de ventas
```
Prospects (5 stages)  -->  Pipeline (9 stages)  -->  Closed
Lead -> Interesado -> Reunion -> Doc. Pendiente -> Term-Sheet  |  conversion automatica a Opportunity
```

### Pipeline automatico Gmail -> Dashboard
```
Gmail (8 buzones: Salvador, Leticia, Javier, Miguel, Carlos, Gonzalo, Rafael + historico Guillermo)
    |
Google Apps Script (scanMailboxes.gs, trigger ~03:12 UTC)
    | format=full: captura subject + snippet + body_text (max 2000 chars)
    |
Google Sheet "alter5-bi-pipeline" (tab raw_emails, 10 columnas, status=pending)
    |
GitHub Actions (04:00 UTC, process-emails.yml)
    |
process_sheet_emails.py (Gemini filtra + clasifica + re-clasifica)
    | - Filtro relevancia: usa body_text completo (no solo snippet)
    | - Clasificacion: 15 subjects + 5 bodies (2000 chars) por empresa
    | - Re-clasificacion automatica: empresas sin enrichment, "No relevante", o con muchos emails nuevos
    | - Roles de contacto: usa subjects + body para inferir cargo (no solo nombre+email)
    |
companies_full.json + companies.json (merge incremental)
    | enrichment._classified_at, _email_count para tracking de re-clasificacion
    |
git commit + push -> Vercel auto-deploy
```

Nota: Guillermo Souto ya no esta en la empresa. Su buzon no se escanea, pero sus datos historicos permanecen.

### Verificacion de clasificaciones
```
companies_full.json (clasificacion actual por email context)
    |
verify_classifications.py (--top N, --domain X, --unverified, --force)
    | Gemini 2.5 Flash REST API + Google Search grounding
    | Compara: clasificacion actual vs datos reales de web
    | Detecta mismatches (ej: "Fondo de deuda" cuando es "Fondo de infraestructura")
    |
Airtable "Verified-Companies" (status: Pending Review)
    | Campos: Domain, Role, Segment, Type, Technologies, Geography, Market Roles
    | Web Description, Web Sources, Mismatch, Notes, Confidence
    |
process_sheet_emails.py (prioridad: Verified > known_companies > Gemini)
    | Protege clasificaciones verificadas de ser sobreescritas
    |
Dashboard (DetailPanel: seccion Verificacion, CompanyTable: dot de estado)
    | Verde=Verified, Morado=Edited, Amarillo=Pending Review
```

## Key Files
- `src/App.jsx` — main router, state management, 3 tabs (Empresas/Prospects/Pipeline)
- `src/utils/airtable.js` — Airtable REST client Opportunities, normalizeRecord, stages
- `src/utils/airtableProspects.js` — Airtable REST client Prospects, convertToOpportunity, stages
- `src/utils/constants.js` — taxonomia (Group, Type, DealStage, MarketRole, Products)
- `src/utils/data.js` — parsers, product matching, exports
- `src/utils/companyData.js` — localStorage overrides, hidden companies
- `src/components/ProspectsView.jsx` — Prospects Kanban board (5 columnas)
- `src/components/ProspectPanel.jsx` — Prospects CRUD slide-in panel
- `src/components/KanbanView.jsx` — Pipeline Kanban board (9 columnas)
- `src/components/OpportunityPanel.jsx` — Pipeline CRUD slide-in panel
- `src/components/Sidebar.jsx` — filtros CRM (empresas view)
- `src/components/DetailPanel.jsx` — detalle empresa con tabs
- `src/components/CompanyTable.jsx` — tabla de empresas
- `src/components/EmployeeTabs.jsx` — tabs por empleado/buzon
- `src/components/UI.jsx` — KPI cards y componentes UI comunes
- `src/components/CerebroSearch.jsx` — Cerebro AI overlay (busqueda inteligente)
- `src/utils/airtableCerebro.js` — Airtable REST client para Cerebro-Knowledge (base de conocimiento)
- `src/utils/gemini.js` — Gemini AI client + queryCerebro() (busqueda en 4 fases)
- `scripts/create_cerebro_table.py` — crear tabla Cerebro-Knowledge en Airtable (una vez, YA EJECUTADO)
- `scripts/process_sheet_emails.py` — Pipeline Gmail: Sheet -> Gemini -> JSON (soporta --reprocess, re-clasificacion automatica)
- `scripts/backfill_classifications.py` — Re-clasificacion masiva de empresas existentes (--top N, --unclassified, --roles, --dry-run)
- `scripts/sync_airtable_opportunities.py` — Airtable Opportunities -> JSON sync
- `scripts/gas/scanMailboxes.gs` — Google Apps Script que escanea Gmail (format=full, captura body_text)
- `scripts/create_prospects_table.py` — crear tabla Prospects via Meta API
- `scripts/verify_classifications.py` — Agente de verificacion: Gemini + Google Search grounding vs clasificacion actual
- `scripts/create_verified_table.py` — crear tabla Verified-Companies via Meta API (una vez, YA EJECUTADO)
- `src/utils/airtableVerified.js` — Airtable REST client para Verified-Companies (cache 5 min, upsert)
- `.github/workflows/process-emails.yml` — CI/CD diario + dispatch manual con opcion reprocess

## Airtable Tables
- **Opportunities** — Pipeline deals (9 stages, filtro: Transaction + Active)
- **BETA-Prospects** (`tblAAc8XXwo8rNHR1`) — Pre-pipeline leads (5 stages, conversion a Opportunity)
  - `Tasks`: campo cambiado a **linked record** (multipleRecordLinks) — NO enviar como JSON string
  - `Contacts`: multilineText con JSON.stringify de array `[{name, email, role}]`
  - Product: singleSelect (Corporate Debt, Project Finance, Development Debt, PF Guaranteed, Investment, Co-Development, M&A)
  - Multi-contactos: campo `Contacts` (JSON array), `Contact Email` mantiene primer email por backward compat
- **Cerebro-Knowledge** (`tbliZ7zNci5TUCAhj`) — Base de conocimiento del Cerebro AI
  - Campos: Question, Answer, Keywords, MatchedDomains, MatchCount, Useful, NotUseful, CreatedAt
  - Client: `src/utils/airtableCerebro.js`
  - Cache en memoria con TTL 5 min
- **Verified-Companies** (`tbl1Zdil8FeljzpBa`) — Verificaciones de clasificacion por agente AI
  - Campos: Domain (PK), Company Name, Role, Segment, Type, Technologies, Geography, Market Roles
  - Web Description, Web Sources, Previous Classification, Mismatch, Notes, Confidence
  - Status: singleSelect (Pending Review, Verified, Edited, Rejected)
  - Verified By: agent | manual, Verified At: ISO datetime
  - Client: `src/utils/airtableVerified.js` (cache 5 min)
  - Prioridad en pipeline: Verified-Companies > known_companies.json > Gemini classification
  - Valores singleSelect SIN acentos (ej: "Originacion", "Inversion", "Asesor tecnico")
- Base ID: `appVu3TvSZ1E4tj0J`
- Token: `VITE_AIRTABLE_PAT` (env var, scopes: data.records:read/write, schema.bases:read/write)

## Data Files
- `src/data/companies.json` — formato compacto para React (~8MB, trackeado en git)
- `src/data/companies_full.json` — formato completo dict by domain (~15MB, trackeado en git desde 27-feb-2026)
- `src/data/employees.json` — registro de 3 empleados con contadores
- `src/data/opportunities.json` — snapshot de oportunidades Airtable

**IMPORTANTE**: `companies_full.json` DEBE estar en git (no en .gitignore) para que el GitHub Action tenga la base completa al hacer merge incremental. Sin este fichero, el pipeline parte de cero y pierde las empresas existentes.

## Conventions
- Inline styles (CSS-in-JS objects), no CSS modules
- Spanish UI labels, English code/comments
- Airtable linked record fields come as arrays — always handle `Array.isArray()`
- Airtable singleSelect: no enviar `""` (eliminar campo del objeto antes de POST/PATCH)
- Airtable linked records en PATCH: sanitizar arrays de record IDs antes de enviar
- `Contacts` en Prospects: se guarda como `JSON.stringify()` en multilineText
- `Tasks` en Prospects: campo linked record — NO enviar como JSON string, se sincroniza via syncTasksToAirtable()
- Colors: Debt=#3B82F6, Equity/M&A=#10B981, Prospects=#8B5CF6
- Git: conventional commits en espanol (`feat:`, `fix:`, `ui:`, `docs:`)
- Prospects identity: purple gradient (#8B5CF6 -> #3B82F6), Pipeline: blue-green (#3B82F6 -> #10B981)
