# Alter5 Business Intelligence

Dashboard de inteligencia comercial para Alter5 — analisis, clasificacion y pipeline de la red de contactos empresariales en el sector de financiacion de energias renovables.

**Stack:** React 18 + Vite 5 | Python 3.11 | Gemini AI | Airtable | GitHub Actions | Vercel

---

## Estado actual (Febrero 2026)

| Metrica | Valor |
|---------|-------|
| Empresas | ~3,317 (fusionadas de 3 buzones + pipeline Gmail) |
| Buzones activos | Salvador Carrillo, Leticia Menendez |
| Buzon historico | Guillermo Souto (ya no en la empresa) |
| Oportunidades Airtable | ~114 deals activos en 9 stages |
| Prospects | Kanban pre-pipeline con 5 stages (Airtable) |
| Productos | Debt, Equity (con subcategorias) |
| Pipeline CI/CD | Gmail -> Sheet -> Gemini -> JSON -> Vercel (diario 04:00 UTC) |
| Clasificacion IA | Gemini 2.0 Flash (grupo, tipo, market roles, productos, senales) |
| Empresas enriquecidas IA | 1,882 (Guillermo + Leticia) |

---

## Inicio rapido

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar Airtable (necesario para Prospects y Pipeline views)
echo "VITE_AIRTABLE_PAT=tu_token_aqui" > .env

# 3. Arrancar en desarrollo
npm run dev

# 4. Abrir en el navegador
# -> http://localhost:5173
```

---

## Arquitectura

```
                  Gmail (2 buzones activos)
                        |
                  Google Apps Script
                  (scanMailboxes.gs)
                  ~03:12 UTC diario
                        |
                  Google Sheet
               (alter5-bi-pipeline)
                   raw_emails tab
                        |
              GitHub Actions (04:00 UTC)
                   /          \
     process_sheet_emails.py   sync_airtable_opportunities.py
        (Gemini 2.0 Flash)           (Airtable REST API)
                   \          /
              src/data/*.json
                        |
                   Vite build
                        |
                    Vercel CDN
```

### Flujo de datos

1. **Google Apps Script** escanea 2 buzones Gmail (Salvador + Leticia) diariamente (~03:12 UTC) y escribe emails pendientes en Google Sheet
2. **GitHub Actions** se ejecuta a las 04:00 UTC:
   - `process_sheet_emails.py` lee emails pendientes, clasifica con Gemini AI, fusiona con `companies_full.json`
   - `sync_airtable_opportunities.py` descarga oportunidades de Airtable -> `opportunities.json`
3. **Bot commits** los JSONs actualizados y push a `main`
4. **Vercel** detecta el push y redespliega automaticamente

### Flujo de ventas

```
Prospects (5 stages)  ──>  Pipeline (9 stages)  ──>  Closed
Lead -> Interesado -> Reunion -> Doc. Pendiente -> Term-Sheet  |  conversion automatica a Opportunity
```

---

## Estructura del proyecto

```
alter5-bi/
├── .github/workflows/
│   └── process-emails.yml        # CI/CD: Gmail pipeline diario (04:00 UTC) + dispatch manual
├── api/
│   ├── notify-task.js            # Serverless: notificaciones email via Resend API
│   └── fetch-gdoc.js             # Serverless: proxy CORS Google Docs
├── data_sources/                  # Excels originales (no en git)
├── scripts/
│   ├── gas/
│   │   ├── scanMailboxes.gs       # Google Apps Script (2 buzones: Salvador + Leticia)
│   │   └── README.md              # Guia setup completo del pipeline
│   ├── import_mailbox.py          # Importador de buzones Excel
│   ├── import_enriched.py         # Importador de datos enriquecidos v2 (Gemini)
│   ├── import_campaign.py         # Importador de datos de campana
│   ├── process_sheet_emails.py    # Pipeline principal: Sheet -> Gemini -> JSON (soporta --reprocess)
│   ├── sync_airtable_opportunities.py  # Airtable -> opportunities.json
│   ├── create_prospects_table.py  # Crear tabla Prospects en Airtable (una vez)
│   └── reclassify_products.py     # Re-clasificacion masiva Debt/Equity
├── src/
│   ├── main.jsx                   # Entry point React
│   ├── App.jsx                    # App principal: tabs Empresas | Prospects | Pipeline
│   ├── index.css                  # Design tokens y estilos globales
│   ├── components/
│   │   ├── UI.jsx                 # Badge, KPI, FilterChip, ScoreBar, Tooltip
│   │   ├── Sidebar.jsx            # Filtros CRM (7 dimensiones + 2 futuras)
│   │   ├── CompanyTable.jsx       # Tabla ordenable con paginacion
│   │   ├── DetailPanel.jsx        # Ficha empresa: Resumen, Timeline, Detalles, enrichment IA
│   │   ├── EmployeeTabs.jsx       # Tabs por buzon (Todos, Salvador, Guillermo, Leticia)
│   │   ├── ProspectsView.jsx      # Kanban Prospects (5 columnas)
│   │   ├── ProspectPanel.jsx      # CRUD Prospects slide-in panel
│   │   ├── ProspectTasks.jsx      # Gestion tareas con asignacion y notificaciones
│   │   ├── KanbanView.jsx         # Vista Kanban Pipeline (9 columnas, drag & drop)
│   │   └── OpportunityPanel.jsx   # Panel CRUD oportunidades Airtable
│   ├── utils/
│   │   ├── constants.js           # Taxonomia, productos, scoring weights
│   │   ├── data.js                # Parsing, scoring, product matching, CSV export
│   │   ├── companyData.js         # localStorage: datos manuales, hidden, overrides
│   │   ├── airtable.js            # Cliente REST Airtable Opportunities
│   │   ├── airtableProspects.js   # Cliente REST Airtable Prospects (sanitiza linked records)
│   │   ├── airtableTasks.js       # Sync tareas con Airtable
│   │   └── gemini.js              # Integracion Gemini AI
│   └── data/
│       ├── companies.json         # ~8MB datos compactos (trackeado en git, auto-generado)
│       ├── companies_full.json    # ~15MB datos completos (trackeado en git, auto-generado)
│       ├── employees.json         # 3 empleados registrados
│       └── opportunities.json     # Oportunidades Airtable (auto-generado)
├── .env                           # VITE_AIRTABLE_PAT (no en git)
├── package.json                   # React 18, Vite 5, lodash
├── vite.config.js                 # Config Vite con React plugin
├── vercel.json                    # Deploy config, headers, cache
├── requirements.txt               # Python: gspread, google-auth, google-generativeai
├── CLAUDE.md                      # Instrucciones para Claude Code
├── ESTADO_PROYECTO.md             # Estado detallado del proyecto
├── DEPLOY.md                      # Guia deploy completa
└── README.md                      # Este archivo
```

**IMPORTANTE:** `companies_full.json` debe estar trackeado en git (no en `.gitignore`). El GitHub Action lo necesita como base para el merge incremental.

---

## Vistas del frontend

### Vista Empresas (tab por defecto)

- **KPIs**: Total, Activas, Dormidas, Perdidas, Score medio
- **Filtros laterales**: Company Group, Company Type, Market Role, Estado, Subtipo Empresa, Fase Comercial, Producto Alter5
- **Tabs buzones**: Todos | Salvador | Guillermo | Leticia
- **Tabla**: Score, Empresa, Group, Type, Market Role, Producto, Status, Emails, Contactos, Ultimo contacto
- **Panel detalle**: slide-in con Resumen, Timeline, Detalles, enrichment IA (subtipo, fase, productos potenciales, senales clave, market roles)
- **Ordenamiento**: por score descendente por defecto

### Vista Prospects (tab Prospects)

- **Kanban board**: 5 columnas (Lead -> Interesado -> Reunion -> Doc. Pendiente -> Term-Sheet)
- **CRUD completo**: crear, editar, eliminar prospects via Airtable API
- **Multi-contactos**: JSON array en campo Contacts (nombre, email, rol)
- **Tareas**: asignacion a equipo con notificaciones email via Resend API
- **Integracion Google Docs**: contexto de reuniones
- **Filtros**: por origen (Referral, Evento, Campana, Cold Outreach, Web/Inbound, Otro)
- **Deal Manager**: asignable por prospect
- **Productos**: con subcategorias (Corporate Debt, Project Finance, Development Debt, PF Guaranteed, Investment, Co-Development, M&A)
- **Conversion**: automatica de Prospect -> Opportunity (Pipeline)

### Vista Pipeline (tab Pipeline con badge AT)

- **Kanban board**: 9 columnas replicando Airtable
- **Drag & drop**: HTML5 nativo, actualiza Airtable en tiempo real
- **Busqueda**: filtrar oportunidades por nombre
- **Filtro Debt/Equity**
- **CRUD completo**: crear, editar, eliminar oportunidades
- **Panel lateral**: formulario con todos los campos Airtable
- **Cross-project**: accesible via URL params `?view=pipeline&add=Empresa&stage=New`

---

## Taxonomia (4 dimensiones)

### Company Group
| Group | Weight | Descripcion |
|-------|--------|-------------|
| Capital Seeker | 20 | Developer, IPP, Utility, Asset Owner, Corporate |
| Investor | 18 | Renewable Fund, Institutional, Bank, Family Office |
| Services | 8 | Legal, Financial, Technical Advisor, EPC |
| Other | 2 | Public Institution, Association |

### Market Roles
| Role | Color | Descripcion |
|------|-------|-------------|
| Borrower | Amber | Prestatario potencial |
| Seller (M&A) | Red | Vendedor de activos/proyectos |
| Buyer Investor (M&A) | Purple | Comprador de activos |
| Debt Investor | Blue | Inversor en deuda |
| Equity Investor | Green | Inversor en equity |
| Partner & Services | Gray | Proveedor/asesor/partner |

### Productos Alter5
- **Debt**: Project Finance, Asset Backed, Development Debt, Corporate Loan, PF Guaranteed
- **Equity**: M&A, Co-Development, Equity Investment

### Prospect Stages
Lead -> Interesado -> Reunion -> Documentacion Pendiente -> Listo para Term-Sheet

### Pipeline Stages (Airtable)
New -> Origination (Prep & NDA -> Fin. Analysis -> Termsheet) -> Distribution (Prep -> Ongoing) -> In Execution -> Closed / Lost

---

## Sistema de scoring (0-100)

| Dimension | Max | Que mide |
|-----------|-----|----------|
| Volumen | 35 | Total interacciones (escala logaritmica) |
| Recencia | 30 | Meses desde ultimo contacto (penaliza 1.5/mes) |
| Red | 15 | Numero de contactos en la empresa (3 pts/contacto) |
| Grupo | 20 | Peso estrategico del Company Group |

### Scoring de productos con IA
- Si la empresa tiene clasificacion Gemini: alta=90, media=60, baja=30
- Si no tiene: fallback al keyword scoring existente

### Estados
- **Activa**: ultimo contacto < 6 meses
- **Dormida**: entre 6 y 18 meses
- **Perdida**: > 18 meses

---

## Integraciones

### Airtable
- **Base**: `appVu3TvSZ1E4tj0J` (Alter5 OS)
- **Tabla Opportunities**: Pipeline deals (9 stages, filtro: Transaction + Active)
- **Tabla BETA-Prospects**: Pre-pipeline leads (5 stages, conversion a Opportunity)
  - Campos JSON: `Contacts` almacenado como JSON.stringify en multilineText
  - Campo `Tasks`: linked record en Airtable (no enviar en PATCH/POST)
  - Product: singleSelect con subcategorias
- **Token scope necesario**: `data.records:read` + `data.records:write`
- **Sync**: diario via GitHub Actions (read) + browser CRUD (read/write)

### Google Workspace
- **Gmail**: 2 buzones activos (Salvador, Leticia) + 1 historico (Guillermo)
- **Google Sheets**: `alter5-bi-pipeline` con tabs `raw_emails`, `config`, `ai_classifications`
- **Gemini 2.0 Flash**: Clasificacion IA (grupo, tipo, market roles, productos, senales)
- **Service Account**: `alter5-ai-crm` project, con OAuth2 delegation por usuario

### GitHub Actions
- **Workflow**: `process-emails.yml`
- **Frecuencia**: Diario 04:00 UTC + manual dispatch (con opcion `reprocess`)
- **Secrets**: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GEMINI_API_KEY`, `GOOGLE_SHEET_ID`, `AIRTABLE_PAT`

### Vercel Serverless Functions
- `api/notify-task.js` — Notificaciones email via Resend API (asignacion de tareas)
- `api/fetch-gdoc.js` — Proxy CORS para Google Docs (contexto reuniones)

---

## Pipedrive Comparison

Script para comparar todos los contactos y organizaciones de Pipedrive CRM contra los datos locales de `companies_full.json`.

```bash
# Basico — imprime el reporte en stdout
PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py

# Guardar reporte JSON completo
PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py --output report.json

# Exportar CSVs (5 ficheros en el directorio actual)
PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py --csv

# Mostrar detalle de matching fuzzy
PIPEDRIVE_API_TOKEN=xxxxx python scripts/compare_pipedrive.py --verbose
```

El script:
1. Carga `src/data/companies_full.json` (~3,943 empresas)
2. Descarga todas las Organizaciones, Contactos y Deals de Pipedrive (paginado)
3. Aplica matching por dominio exacto, nombre fuzzy (>85%) y dominio de email
4. Genera un reporte con 5 secciones: solo en Pipedrive, solo en local, matches, contactos solo en Pipedrive, contactos solo en local
5. Opcional: JSON estructurado (`--output`) y CSVs (`--csv`)

No requiere dependencias externas (usa `urllib.request` como el resto de scripts).

---

## Variables de entorno

### Frontend (Vite — build time)
| Variable | Descripcion | Donde |
|----------|-------------|-------|
| `VITE_AIRTABLE_PAT` | Token Airtable para CRUD | `.env` (local) + Vercel Settings |

### GitHub Actions (runtime)
| Secret | Descripcion |
|--------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Credenciales Service Account (JSON completo) |
| `GEMINI_API_KEY` | API Key de Google AI Studio |
| `GOOGLE_SHEET_ID` | ID del Google Sheet pipeline |
| `AIRTABLE_PAT` | Personal Access Token de Airtable |

---

## Anadir un nuevo buzon de correo

```bash
# 1. Copia el Excel a data_sources/
cp ~/Downloads/analisis_contactos_NOMBRE.xlsx data_sources/

# 2. Ejecuta el importador
python scripts/import_mailbox.py data_sources/analisis_contactos_NOMBRE.xlsx "Nombre Apellido"

# 3. Reinicia el servidor de desarrollo
# Ctrl+C + npm run dev
```

El script fusiona automaticamente: si una empresa aparece en varios buzones, combina interacciones, contactos y timelines.

---

## Build y deploy

```bash
# Build local
npm run build          # Genera dist/
npm run preview        # Preview del build (recomendado para testing)

# Deploy Vercel (automatico via Git push)
git push origin main   # Vercel detecta y redespliega

# Deploy Vercel (manual)
vercel --prod
```

**Documentacion completa de deploy:** [DEPLOY.md](./DEPLOY.md)

---

## Funcionalidades

- [x] Dashboard multi-buzon (3 empleados, datos fusionados)
- [x] Scoring 0-100 con 4 dimensiones
- [x] Filtros combinables (7 dimensiones activas + 2 futuras)
- [x] Clasificacion IA con Gemini (grupo, tipo, market roles, productos)
- [x] Enriquecimiento IA v2 (subtipo, fase, senales clave, 500 chars contexto)
- [x] Product matching Debt/Equity con scoring de confianza
- [x] Panel detalle con Timeline trimestral y extractos de email
- [x] Edicion inline de clasificacion y contactos
- [x] Exportacion CSV compatible con Airtable
- [x] Vista Prospects: Kanban 5 columnas, CRUD Airtable, multi-contactos, tareas
- [x] Vista Pipeline: Kanban 9 columnas, drag & drop, CRUD Airtable bidireccional
- [x] Conversion automatica Prospect -> Opportunity
- [x] Notificaciones email para asignacion de tareas (Resend API)
- [x] URL params para cross-project (`?view=pipeline&add=X&stage=Y`)
- [x] CI/CD diario: Gmail -> Gemini -> JSON -> Vercel (04:00 UTC)
- [x] Modo reprocess para backfill de emails historicos
- [ ] Filtro por tamano de empresa (requiere datos LinkedIn)
- [ ] Filtro por pais (requiere clasificacion por idioma)
- [ ] Graficos de distribucion por grupo/tipo
- [ ] Notificaciones de cambios en pipeline

---

## Historial de versiones

| Version | Fecha | Descripcion |
|---------|-------|-------------|
| v1.6.0 | 2026-02-27 | Fix pipeline Gmail + Tasks linked record |
| v1.5.1 | 2026-02-26 | Multi-contactos Prospects + subproductos |
| v1.5.0 | 2026-02-22 | Market Roles (6 categorias) |
| v1.4.0 | 2026-02-22 | Datos enriquecidos v2 con IA (1,882 empresas) |
| v1.3.0 | 2026-02-22 | Pipeline automatico Gmail -> Dashboard |
| v1.2.0 | 2026-02-20 | Gestion avanzada de empresas y contactos |
| v1.1.0 | 2026-02-20 | Sistema de edicion y cualificacion |
| v1.0.0 | 2026-02-20 | Dashboard inicial |

---

## Licencia

Uso interno Alter5. No redistribuir.
