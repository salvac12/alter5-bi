# Alter5 BI — Claude Code Instructions

## Project
Dashboard de inteligencia comercial para Alter5 (financiación energías renovables).
React 18 + Vite 5 frontend, Python scripts, Airtable API, Vercel deploy.

## Commands
- `npm run dev` — dev server (tiene CSP eval issues, usar preview)
- `npm run preview` — build + preview (recomendado para testing)
- `npm run build` — production build
- `python scripts/sync_airtable_opportunities.py` — sync Airtable → JSON

## Architecture
- **2 vistas**: Empresas (tabla CRM con 3,294 empresas) y Pipeline (Kanban Airtable con ~97 deals)
- **Datos empresas**: `src/data/companies.json` (compact), `companies_full.json` (dict by domain)
- **Datos pipeline**: live API Airtable (`src/utils/airtable.js`) + static `src/data/opportunities.json`
- **Enrichment**: AI-generated taxonomy con localStorage overrides editables inline

## Key Files
- `src/App.jsx` — main router, state management
- `src/utils/airtable.js` — Airtable REST client, normalizeRecord, stages
- `src/utils/constants.js` — taxonomía (Group, Type, DealStage, MarketRole, Products)
- `src/utils/data.js` — parsers, product matching, exports
- `src/components/KanbanView.jsx` — Pipeline Kanban board
- `src/components/OpportunityPanel.jsx` — Airtable CRUD panel
- `src/components/Sidebar.jsx` — filtros CRM
- `src/components/DetailPanel.jsx` — detalle empresa con tabs
- `scripts/sync_airtable_opportunities.py` — Airtable → JSON sync

## Conventions
- Inline styles (CSS-in-JS objects), no CSS modules
- Spanish UI labels, English code/comments
- Airtable linked record fields come as arrays — always handle `Array.isArray()`
- Colors: Debt=#3B82F6, Equity/M&A=#10B981, palette from design system in styles
- Git: conventional commits in Spanish (`feat:`, `fix:`, `ui:`, `docs:`)
