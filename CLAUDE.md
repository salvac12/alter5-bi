# Alter5 BI — Claude Code Instructions

## Project
Dashboard de inteligencia comercial para Alter5 (financiacion energias renovables).
React 18 + Vite 5 frontend, Python scripts, Airtable API, Vercel deploy.

## Commands
- `npm run dev` — dev server (tiene CSP eval issues, usar preview)
- `npm run preview` — build + preview (recomendado para testing)
- `npm run build` — production build
- `python scripts/sync_airtable_opportunities.py` — sync Airtable Opportunities -> JSON
- `python scripts/create_prospects_table.py` — crear tabla Prospects en Airtable (una vez)

## Architecture
- **3 vistas**: Empresas (tabla CRM con 3,294 empresas), Prospects (Kanban pre-pipeline) y Pipeline (Kanban Airtable con ~114 deals)
- **Datos empresas**: `src/data/companies.json` (compact), `companies_full.json` (dict by domain)
- **Datos pipeline**: live API Airtable (`src/utils/airtable.js`) + static `src/data/opportunities.json`
- **Datos prospects**: live API Airtable (`src/utils/airtableProspects.js`), tabla "Prospects"
- **Enrichment**: AI-generated taxonomy con localStorage overrides editables inline

### Flujo de ventas
```
Prospects (5 stages)  -->  Pipeline (9 stages)  -->  Closed
Lead -> Interesado -> Reunion -> Doc. Pendiente -> Term-Sheet  |  conversion automatica a Opportunity
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
- `scripts/sync_airtable_opportunities.py` — Airtable Opportunities -> JSON sync
- `scripts/create_prospects_table.py` — crear tabla Prospects via Meta API

## Airtable Tables
- **Opportunities** — Pipeline deals (9 stages, filtro: Transaction + Active)
- **BETA-Prospects** (`tblAAc8XXwo8rNHR1`) — Pre-pipeline leads (5 stages, conversion a Opportunity)
  - JSON fields: `Tasks` y `Contacts` se almacenan como JSON.stringify en multilineText
  - Product: singleSelect (Corporate Debt, Project Finance, Development Debt, PF Guaranteed, Investment, Co-Development, M&A)
  - Multi-contactos: campo `Contacts` (JSON array de `{name, email, role}`), `Contact Email` mantiene primer email por backward compat
- Base ID: `appVu3TvSZ1E4tj0J`
- Token: `VITE_AIRTABLE_PAT` (env var, scopes: data.records:read/write, schema.bases:read/write)

## Conventions
- Inline styles (CSS-in-JS objects), no CSS modules
- Spanish UI labels, English code/comments
- Airtable linked record fields come as arrays — always handle `Array.isArray()`
- Airtable singleSelect: no enviar `""` (eliminar campo del objeto antes de POST/PATCH)
- JSON en Airtable: Tasks y Contacts se guardan como `JSON.stringify()` en multilineText y se parsean con `JSON.parse()` en normalizeProspect
- Colors: Debt=#3B82F6, Equity/M&A=#10B981, Prospects=#8B5CF6
- Git: conventional commits en espanol (`feat:`, `fix:`, `ui:`, `docs:`)
- Prospects identity: purple gradient (#8B5CF6 -> #3B82F6), Pipeline: blue-green (#3B82F6 -> #10B981)
