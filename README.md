# Alter5 Business Intelligence

Dashboard de inteligencia comercial para Alter5 — analisis, clasificacion y pipeline de la red de contactos empresariales en el sector de financiacion de energias renovables.

**Stack:** React 18 + Vite 5 | Python 3.11 | Gemini AI | Airtable | GitHub Actions | Vercel

---

## Estado actual (Febrero 2026)

| Metrica | Valor |
|---------|-------|
| Empresas | ~3.272 (fusionadas de 3 buzones) |
| Buzones | Salvador Carrillo, Guillermo Souto, Leticia Menendez |
| Oportunidades Airtable | ~227 activas en 9 stages |
| Productos | Debt, Equity (con subcategorias) |
| Pipeline CI/CD | Gmail -> Sheet -> Gemini -> JSON -> Vercel (diario 03:00 UTC) |
| Clasificacion IA | Gemini 2.0 Flash (grupo, tipo, market roles, productos, senales) |

---

## Inicio rapido

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar Airtable (opcional, para Pipeline view)
echo "VITE_AIRTABLE_PAT=tu_token_aqui" > .env

# 3. Arrancar en desarrollo
npm run dev

# 4. Abrir en el navegador
# -> http://localhost:5173
```

---

## Arquitectura

```
                  Gmail (3 buzones)
                        |
                  Google Apps Script
                  (scanMailboxes.gs)
                        |
                  Google Sheet
                  (raw_emails tab)
                        |
              GitHub Actions (diario 03:00 UTC)
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

1. **Google Apps Script** escanea 3 buzones Gmail diariamente y escribe emails pendientes en Google Sheet
2. **GitHub Actions** se ejecuta a las 03:00 UTC:
   - `process_sheet_emails.py` lee emails pendientes, clasifica con Gemini AI, actualiza `companies.json`
   - `sync_airtable_opportunities.py` descarga oportunidades de Airtable -> `opportunities.json`
3. **Bot commits** los JSONs actualizados y push a `main`
4. **Vercel** detecta el push y redespliega automaticamente

---

## Estructura del proyecto

```
alter5-bi/
├── .github/workflows/
│   └── process-emails.yml        # CI/CD: Gmail pipeline diario + Airtable sync
├── data_sources/                  # Excels originales (no en git)
├── scripts/
│   ├── gas/
│   │   ├── scanMailboxes.gs       # Google Apps Script para Gmail
│   │   └── README.md              # Guia setup completo del pipeline
│   ├── import_mailbox.py          # Importador de buzones Excel
│   ├── process_sheet_emails.py    # Pipeline principal: Sheet -> Gemini -> JSON
│   ├── sync_airtable_opportunities.py  # Airtable -> opportunities.json
│   ├── backfill_dated_subjects.py # Backfill de subjects con fecha
│   ├── reclassify_products.py     # Re-clasificacion masiva Debt/Equity
│   ├── import_enriched.py         # Importar clasificaciones
│   ├── import_campaign.py         # Importar datos de campanas
│   └── migrate_taxonomy.py        # Migracion entre taxonomias
├── src/
│   ├── main.jsx                   # Entry point React
│   ├── App.jsx                    # App principal: tabs Empresas | Pipeline
│   ├── index.css                  # Design tokens y estilos globales
│   ├── assets/
│   │   └── alter5-logo.svg        # Logo Alter5
│   ├── components/
│   │   ├── UI.jsx                 # Badge, KPI, FilterChip, ScoreBar, Tooltip
│   │   ├── Sidebar.jsx            # 7 filtros: Group, Type, Role, Status, Pipeline, Product
│   │   ├── CompanyTable.jsx       # Tabla ordenable con paginacion
│   │   ├── DetailPanel.jsx        # Ficha empresa: Resumen, Timeline, Detalles
│   │   ├── EmployeeTabs.jsx       # Tabs por buzon (Todos, Salvador, Guillermo, Leticia)
│   │   ├── KanbanView.jsx         # Vista Kanban pipeline (9 columnas, drag & drop)
│   │   └── OpportunityPanel.jsx   # Panel CRUD oportunidades Airtable
│   ├── utils/
│   │   ├── constants.js           # Taxonomia, productos, scoring weights
│   │   ├── data.js                # Parsing, scoring, product matching, CSV export
│   │   ├── companyData.js         # localStorage: datos manuales, hidden, overrides
│   │   └── airtable.js            # Cliente REST Airtable (fetch, create, update, delete)
│   └── data/
│       ├── companies.json         # ~8MB datos compactos (auto-generado)
│       ├── companies_full.json    # Datos completos (no en git)
│       ├── employees.json         # 3 empleados registrados
│       └── opportunities.json     # 227 oportunidades Airtable (auto-generado)
├── .env                           # VITE_AIRTABLE_PAT (no en git)
├── package.json                   # React 18, Vite 5, lodash
├── vite.config.js                 # Config Vite con React plugin
├── vercel.json                    # Deploy config, headers, cache
├── requirements.txt               # Python: gspread, google-auth, google-generativeai
├── deploy-vercel.sh               # Script deploy Vercel
├── DEPLOY.md                      # Guia deploy completa
└── README.md                      # Este archivo
```

---

## Vistas del frontend

### Vista Empresas (tab por defecto)

- **KPIs**: Total, Activas, Dormidas, Perdidas, Score medio
- **Filtros laterales**: Company Group, Company Type, Market Role, Estado, Pipeline Airtable, Producto Alter5
- **Tabs buzones**: Todos | Salvador | Guillermo | Leticia
- **Tabla**: Score, Empresa, Group, Type, Market Role, Producto, Status, Emails, Contactos, Ultimo contacto
- **Panel detalle**: slide-in con 3 tabs (Resumen, Timeline, Detalles), edicion inline de clasificacion

### Vista Pipeline (tab Pipeline con badge AT)

- **Kanban board**: 9 columnas replicando Airtable
- **Drag & drop**: HTML5 nativo, actualiza Airtable en tiempo real
- **Busqueda**: filtrar oportunidades por nombre
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
Borrower, Seller (M&A), Buyer Investor (M&A), Debt Investor, Equity Investor, Partner & Services

### Productos Alter5
- **Debt**: Project Finance, Asset Backed, Development Debt, Corporate Loan, PF Guaranteed
- **Equity**: M&A, Co-Development, Equity Investment

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

### Estados
- **Activa**: ultimo contacto < 6 meses
- **Dormida**: entre 6 y 18 meses
- **Perdida**: > 18 meses

---

## Integraciones

### Airtable
- **Base**: `appVu3TvSZ1E4tj0J` (Alter5 OS)
- **Tabla**: Opportunities
- **Campos**: Opportunity Name, Global Status, Workflow Phase (Debt), Targeted Ticket Size, Currency, Record Status
- **Token scope necesario**: `data.records:read` + `data.records:write`
- **Sync**: diario via GitHub Actions (read) + browser CRUD (read/write)

### Google Workspace
- **Gmail**: 3 buzones (Salvador, Guillermo, Leticia)
- **Google Sheets**: Pipeline de emails pendientes
- **Gemini 2.0 Flash**: Clasificacion IA (grupo, tipo, market roles, productos, senales)
- **Service Account**: Para acceso programatico desde GitHub Actions

### GitHub Actions
- **Workflow**: `process-emails.yml`
- **Frecuencia**: Diario 03:00 UTC + manual dispatch
- **Secrets**: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GEMINI_API_KEY`, `GOOGLE_SHEET_ID`, `AIRTABLE_PAT`

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
npm run preview        # Preview del build

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
- [x] Product matching Debt/Equity con scoring de confianza
- [x] Panel detalle con Timeline trimestral y extractos de email
- [x] Edicion inline de clasificacion y contactos
- [x] Exportacion CSV compatible con Airtable
- [x] Pipeline Airtable: filtro en sidebar + badges
- [x] Vista Kanban con drag & drop y CRUD bidireccional
- [x] URL params para cross-project (`?view=pipeline&add=X&stage=Y`)
- [x] CI/CD diario: Gmail -> Gemini -> JSON -> Vercel
- [ ] Filtro por tamano de empresa (requiere datos LinkedIn)
- [ ] Filtro por pais (requiere clasificacion por idioma)
- [ ] Graficos de distribucion por grupo/tipo
- [ ] Notificaciones de cambios en pipeline

---

## Historial de versiones

| Commit | Fecha | Descripcion |
|--------|-------|-------------|
| `5fb28af` | 2026-02-24 | Kanban Pipeline view con CRUD bidireccional Airtable |
| `d294ae1` | 2026-02-24 | Integrar pipeline de oportunidades desde Airtable API |
| `85c4884` | 2026-02-24 | Eliminar Deal Stage del frontend |
| `1eedcce` | 2026-02-23 | Extracto de email expandible por subject |
| `f7f1400` | 2026-02-23 | Backfill dated_subjects y quarterly summaries |
| `e0f5e38` | 2026-02-23 | Resumen cronologico con fechas por email |
| `12e60a5` | 2026-02-22 | DetailPanel con pestanas + summaries trimestrales |
| `d9367f1` | 2026-02-22 | Simplificar taxonomia: 6 sistemas -> 4 dimensiones |
| `f8b818c` | 2026-02-20 | Scoring IA, import 3 buzones, REF_DATE dinamica |

---

## Licencia

Uso interno Alter5. No redistribuir.
