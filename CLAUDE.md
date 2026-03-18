# Alter5 BI — Claude Code Instructions

## Project
Dashboard de inteligencia comercial para Alter5 (financiacion energias renovables).
React 18 + Vite 5 frontend, Python scripts, Airtable API, Vercel deploy.

## Deploy
- Cuando termines una tarea, siempre haz merge a main y push a origin
- Vercel despliega automáticamente desde main

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
- `python scripts/enrich_from_scraper.py` — cruzar scraper España con CRM, enriquecer empresas existentes
- `python scripts/enrich_from_scraper.py --dry-run` — preview sin escribir
- `python scripts/import_scraper_companies.py` — importar empresas del scraper que no están en CRM
- `python scripts/import_scraper_companies.py --dry-run` — preview sin escribir
- `python scripts/enrich_contacts.py --top 100` — enriquecer roles de contactos top 100 por prioridad campaña
- `python scripts/enrich_contacts.py --domain X` — enriquecer contactos de una empresa concreta
- `python scripts/enrich_contacts.py --unidentified` — solo empresas con contactos "No identificado"
- `python scripts/enrich_contacts.py --force` — re-enriquecer contactos con rol pero sin LinkedIn URL
- `python scripts/enrich_contacts.py --all-types` — enriquecer todas las empresas (no solo Originacion)
- `python scripts/enrich_contacts.py --backend gemini` — forzar backend Gemini (default: Perplexity)
- `python scripts/enrich_contacts.py --dry-run` — preview sin escribir
- `python scripts/merge_duplicates.py` — mergear empresas duplicadas (dominios redundantes)
- `python scripts/merge_duplicates.py --dry-run` — preview sin escribir

## Architecture
- **3 vistas**: Empresas (tabla CRM con ~5,261 empresas), Prospects (Kanban pre-pipeline) y Pipeline (Kanban Airtable con ~114 deals)
- **Datos empresas**: `src/data/companies.json` (compact), `companies_full.json` (dict by domain, trackeado en git)
- **Datos pipeline**: live API Airtable (`src/utils/airtable.js`) + static `src/data/opportunities.json`
- **Datos prospects**: live API Airtable (`src/utils/airtableProspects.js`), tabla "BETA-Prospects"
- **Enrichment**: AI-generated taxonomy con localStorage overrides editables inline
- **Verificacion**: Agente Gemini + Google Search que verifica clasificaciones vs web real, persiste en Airtable "Verified-Companies"
- **Scraper España**: 5,652 proyectos renovables (SPVs, MW, tecnologías, permisos) cruzados con CRM. 738 empresas con datos scraper (129 existentes + 609 importadas)
- **Quality Score**: `qualityScore` (0-100) en `data.ts` mide completitud de datos (enrichment, roles contacto, timeline, contexto, market roles, scraper). Labels: alta/media/baja. Dot visual en CompanyTable

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

### Scraper España → CRM enrichment
```
alter5-scraper-spain (proyectos renovables MITECO/CCAA)
    |
scraper_projects.json (5,652 proyectos: SPV, MW, MWp, capex, tecnología, permisos)
    |
spv_parent_mapping.json (2,531 SPV→empresa matriz, resolución por empresaMatriz + heurísticas)
    |
enrich_from_scraper.py (cruza con CRM por fuzzy name matching)
    | Agrega: proyectos, MW total, MWp, capex, tecnologías, estados permisos, SPVs
    | Inyecta enrichment.scraper en empresas matched (129 empresas)
    |
import_scraper_companies.py (importa empresas NO en CRM)
    | 609 nuevas empresas con dominio .scraper.es
    | Clasificación inferida: Originación/Developer, contexto generado
    | Enrichment completo: role, segment, tech, geo, mr, scraper block
    |
companies_full.json + companies.json (5,550 empresas totales)
    |
Dashboard:
    | CompanyTable: columna MW sortable
    | DetailPanel: tab "Proyectos" (KPIs, barras tech, chips permisos, tabla proyectos, SPVs)
    | App.tsx: filtros "Escala MW" y "Tech scraper"
```

Nota: empresas importadas del scraper tienen dominio `.scraper.es` (pseudo-dominio) y 0 contactos/interacciones.
Se pueden enriquecer con contactos cuando se establezca relación comercial.

### Deduplicación de empresas
```
scripts/merge_duplicates.py
    | MERGE_RULES: lista de (target_domain, [dominios_a_absorber])
    | Merge: sources, contacts (dedup email), timeline, subjects, enrichment
    | Tracking: enrichment._merged_from[], enrichment.aliases[]
    |
    | Batch 1 (17-mar-2026): 31 dominios → 20 targets (ABO Wind→ABO Energy, Apex, Sabadell...)
    | Batch 2 (17-mar-2026): 100 dominios → 93 targets (OPDEnergy, Sancus, BBVA, Microsoft...)
    | Total eliminados: 131 duplicados. CRM: 5,392 → 5,261 empresas
```

### Contact enrichment (roles + LinkedIn)
```
enrich_contacts.py (--top N, --domain X, --force, --all-types, --backend)
    |
    | Backend 1: Perplexity Sonar (default, PERPLEXITY_API_KEY)
    |   - Busca en web: "{nombre} {empresa} LinkedIn"
    |   - Devuelve: role, linkedin_url, source, confidence
    |   - Coste: ~$5-8 / 1000 empresas
    |   - NOTA: LinkedIn URLs de Perplexity son ALUCINADAS (19/20 falsas)
    |   - Los ROLES sí son fiables (verificados por búsqueda web)
    |
    | Backend 2: Gemini + Google Search grounding (fallback, GEMINI_API_KEY)
    |   - Similar pero no devuelve LinkedIn URLs
    |
    | Estado (17-mar-2026): 154 contactos con rol verificado en 74 empresas
    | LinkedIn URLs: eliminadas (no fiables). Pendiente: integrar Apollo.io
    |
    | Backend 3: Apollo.io People Match (preferred, APOLLO_API_KEY)
    |   - Nombre + dominio → LinkedIn URL REAL + cargo verificado + foto
    |   - 1 crédito por contacto, free tier 10,000/mes
    |   - Rate limit: ~200 requests/hora (free tier)
    |   - Coverage España: ~40-60% (Apollo es US-centric)
    |   - NOTA: LinkedIn URLs de Apollo son REALES (verificadas)
    |
    | Backend 3b: Apollo.io People Search (discovery, FREE)
    |   - Dominio → encontrar decisores (CFO, CEO, Head of BD)
    |   - No consume créditos (búsqueda gratis, nombres obfuscados)
    |   - Enrich posterior con People Match (1 crédito) para datos completos
    |   - Uso: --discover-dm para descubrir decision makers nuevos
    |
    | Estado Apollo (18-mar-2026):
    |   - API key configurada (APOLLO_API_KEY en .env)
    |   - Batch 1: 7 contactos enriquecidos en 3 empresas (Ignis, Enfinity, Recurrent Energy)
    |   - LinkedIn URLs reales + cargos: CEO, COO, CGO, Dir. Desarrollo, GM Operations
    |   - Rate limit alcanzado tras ~200 requests. Ejecutar en batches espaciados ~1h
    |   - 1,087 empresas Originación pendientes de enriquecer
    |
companies_full.json (contactos con _role_source, _role_confidence, _role_verified_at)
    |
companies.json (compact: contact[5] = linkedinUrl)
    |
DetailPanel.tsx + CandidateSearchView.tsx (UI preparada para mostrar LinkedIn URLs)
```

### Siguiente paso: Apollo.io (EN PROGRESO)
```
Ejecutar enrich_contacts.py en batches para cubrir las ~1,087 empresas restantes:
    | python scripts/enrich_contacts.py --backend apollo --top 100
    | Espaciar ejecuciones ~1 hora por rate limit (~200 req/h free tier)
    | Estimado: ~5-6 batches para cubrir todas las empresas
    |
    | Después: --discover-dm para encontrar decisores nuevos en empresas sin CFO/CEO
    | python scripts/enrich_contacts.py --backend apollo --top 100 --discover-dm
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
- `scripts/enrich_from_scraper.py` — Cruza scraper_projects.json + spv_parent_mapping.json con CRM (fuzzy match)
- `scripts/import_scraper_companies.py` — Importa empresas del scraper no en CRM (dominio .scraper.es)
- `scripts/enrich_contacts.py` — Enriquece roles de contactos via Perplexity Sonar (default) o Gemini (fallback)
- `scripts/merge_duplicates.py` — Merge de empresas duplicadas (TLDs, subdominios, typos, rebrands)
- `src/data/scraper_projects.json` — 5,652 proyectos renovables España (SPV, MW, tech, permisos)
- `src/data/spv_parent_mapping.json` — 2,531 mapeos SPV→empresa matriz
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
- `src/data/companies.json` — formato compacto para React (~8MB, trackeado en git, 5,550 empresas)
- `src/data/companies_full.json` — formato completo dict by domain (~15MB, trackeado en git desde 27-feb-2026)
- `src/data/employees.json` — registro de 3 empleados con contadores
- `src/data/opportunities.json` — snapshot de oportunidades Airtable
- `src/data/scraper_projects.json` — 5,652 proyectos renovables España (1.6MB, fuente: alter5-scraper-spain)
- `src/data/spv_parent_mapping.json` — 2,531 mapeos SPV→empresa matriz (367KB, generado por resolve_spv_parents.py)

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
