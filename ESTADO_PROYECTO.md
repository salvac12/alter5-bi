# Estado del Proyecto - Alter5 BI
**Fecha actualizacion:** 2 de marzo de 2026
**Ultima modificacion:** Cerebro AI — buscador inteligente + base de conocimiento Airtable

---

## Resumen Ejecutivo

Dashboard de Business Intelligence para analisis y clasificacion de la red de contactos empresariales de Alter5, con sistema de scoring multi-dimensional, gestion multi-buzon, enriquecimiento de datos con Gemini, pipeline automatico Gmail -> Dashboard, y **Cerebro AI** — buscador inteligente con lenguaje natural y base de conocimiento organizacional.

---

## Estado Actual

### Completado

1. **Configuracion del proyecto**
   - React 18.3.1 + Vite 5.4
   - Lodash para utilidades de datos
   - Node >= 18.0.0

2. **Datos importados**
   - Salvador Carrillo: 2,202 empresas (18/02/2026)
   - Guillermo Souto: 1,511 empresas (18/02/2026) — historico, ya no activo
   - Leticia Menendez: 681 empresas (18/02/2026)
   - **Total tras fusion + pipeline:** 3,317 empresas (23 nuevas via pipeline Gmail)
   - **Con datos enriquecidos IA:** 1,882 empresas (Guillermo + Leticia v2)
   - **Market Roles:** Preparado, pendiente de datos (procesando en Colab con Gemini)

3. **Enriquecimiento IA v2**
   - Analisis con Gemini de los buzones de Guillermo (1,503 empresas) y Leticia (682 empresas)
   - Campos nuevos por empresa: subtipo empresa, fase comercial, productos potenciales IA, senales clave, **market roles**
   - Contexto ampliado de 150 a 500 caracteres
   - Script `import_enriched.py` para merge sin sobreescribir datos de otros buzones
   - Scoring de productos usa clasificacion IA directa cuando existe (alta=90, media=60, baja=30), fallback a keyword scoring

4. **Funcionalidades core**
   - Sistema de scoring 0-100 (Volumen 35% + Recencia 30% + Red 15% + Tipo 20%)
   - Estados de relacion: Activa (<6m), Dormida (6-18m), Perdida (>18m)
   - Sistema de tabs por empleado (Todos/Salvador/Guillermo/Leticia)
   - **Ordenamiento por score descendente por defecto** (empresas mas relevantes primero)
   - Busqueda libre por nombre/dominio/sector/tipo/subtipo/fase/market role
   - Filtros combinables: estado, sector, tipo relacion, **subtipo empresa**, **fase comercial**, **market role**, producto Alter5
   - Filtros preparados para futuro (Tamano Empresa y Pais) con estado disabled
   - Badge contador de filtros activos en sidebar
   - Tabla ordenable y paginada
   - Exportacion CSV (compatible Airtable)

   **Ficha de empresa detallada:**
   - Badges de subtipo empresa (morado), fase comercial (coloreado) y **market roles** (coloreados)
   - Productos potenciales IA con nivel de confianza (alta/media/baja)
   - Senales clave como chips
   - Market Roles como badges coloreados (6 roles posibles)
   - Contexto completo (500 chars en vez de 150)
   - Sistema de eliminacion de empresas con confirmacion modal
   - Edicion completa de contactos (anadir, editar, eliminar)
   - Sector editable con desplegable
   - Website clickable con valor por defecto desde dominio
   - Campos editables: facturacion, empleados, sector, pais, prioridad, web, LinkedIn, notas
   - Almacenamiento persistente en localStorage
   - Panel de detalle con desglose por empleado
   - Timeline de interacciones visual
   - Contactos clave priorizados

5. **Vista Prospects (Kanban pre-pipeline)**
   - 5 columnas: Lead, Interesado, Reunion, Doc. Pendiente, Term-Sheet
   - CRUD completo con Airtable REST API (tabla BETA-Prospects)
   - Multi-contactos (JSON array en campo Contacts)
   - Tareas con asignacion a equipo y notificaciones por email (Resend API)
   - Integracion Google Docs para contexto de reuniones
   - Conversion automatica Prospect -> Opportunity
   - Filtro por origen (Referral, Evento, Campana, Cold Outreach, Web/Inbound, Otro)
   - Deal Manager asignable
   - Productos con subcategorias (Corporate Debt, Project Finance, etc.)

6. **Vista Pipeline (Kanban Airtable)**
   - 9 columnas replicando stages de Airtable Opportunities
   - Drag & drop HTML5 nativo con sync en tiempo real
   - CRUD completo: crear, editar, eliminar oportunidades
   - ~114 deals activos
   - Filtro Debt/Equity

7. **Sistema de importacion**
   - `scripts/import_mailbox.py` — Importacion manual de buzones Excel
   - `scripts/import_enriched.py` — Importacion de analisis enriquecido v2 (Gemini)
   - `scripts/import_campaign.py` — Importacion de datos de campana
   - Todos los exportadores preservan campo enrichment (indice 5 en details)
   - Fusion automatica de empresas duplicadas entre buzones

8. **Pipeline automatico Gmail -> Dashboard (v1.6.0 — CORREGIDO 27-feb)**
   - Google Apps Script escanea buzones de Salvador y Leticia diariamente (trigger ~03:12 UTC)
   - Autenticacion via Service Account + OAuth2 (tokens por usuario)
   - Emails nuevos en Google Sheet (tab `raw_emails`) con status `pending`
   - GitHub Actions (04:00 UTC) procesa pendientes y commitea JSONs
   - Filtro de relevancia con IA: Gemini descarta emails no comerciales
   - Clasificacion automatica y fusion incremental con datos existentes
   - Vercel auto-despliega al detectar cambios en `main`
   - **Modo `--reprocess`**: releer emails ya marcados como "done" (backfill)
   - **Dispatch manual** con opcion `reprocess=true` desde GitHub Actions UI

   **Problemas resueltos (27-feb-2026):**
   - `companies_full.json` estaba en `.gitignore` — el Action partia de cero cada vez. Corregido: ahora trackeado en git.
   - Cron del Action era 03:00 UTC (antes del GAS). Corregido a 04:00 UTC.
   - 162 emails perdidos recuperados via `--reprocess` (23 empresas nuevas + 54 actualizadas).

   **Infraestructura configurada:**
   - Google Cloud project: `alter5-ai-crm`
   - Service Account con tokens OAuth2 por usuario (scopes: gmail.readonly + spreadsheets)
   - Google Sheet `alter5-bi-pipeline` con 3 tabs: `raw_emails`, `config`, `ai_classifications`
   - GitHub Secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GEMINI_API_KEY`, `GOOGLE_SHEET_ID`, `AIRTABLE_PAT`

9. **Serverless Functions (Vercel)**
   - `api/notify-task.js` — Notificaciones email via Resend API (asignacion de tareas)
   - `api/fetch-gdoc.js` — Proxy CORS para Google Docs (sin commitear, pendiente)

10. **Deploy y versioning**
    - Git repository: `https://github.com/salvac12/alter5-bi.git`
    - Branch: `main`
    - Deploy en Vercel (auto-deploy on push)
    - Panel Vercel: `https://vercel.com/salvas-workspaces-projects/alter5-bi`

11. **Cerebro AI — Buscador inteligente con lenguaje natural (v1.7.0)**
    - Overlay modal accesible desde boton en la barra de navegacion (vista Empresas)
    - Busqueda en lenguaje natural en espanol sobre las 3,317 empresas
    - **Arquitectura de 4 fases:**
      1. **Keyword extraction**: normaliza acentos, filtra stop words (140+ palabras en espanol), stemming basico de plurales
      2. **Knowledge retrieval**: busca Q&A relevantes en Airtable (base de conocimiento organizacional)
      3. **Gemini analysis**: envia top 50 empresas + contexto de conocimiento previo a Gemini 2.5 Flash
      4. **Knowledge save**: guarda pregunta + respuesta en Airtable (fire-and-forget, no bloquea)
    - **Busqueda exhaustiva**: recorre TODOS los campos de cada empresa (nombre, dominio, grupo, tipo, sector, contexto, senales, market roles, productos IA, subjects, dated_subjects, timeline)
    - **Stemming espanol**: "sheets" matchea "sheet", "inversiones" matchea "inversion"
    - Devuelve TODAS las empresas que coinciden como tarjetas clickables (no solo las mencionadas por Gemini)
    - Tarjetas muestran: nombre, subtipo (badge morado), estado (Activa/Dormida/Perdida), emails, fase comercial
    - Click en tarjeta abre la ficha detallada de la empresa
    - 6 ejemplos de busqueda pre-configurados como chips clickables
    - Atajos de teclado: Enter para buscar, Escape para cerrar

    **Base de conocimiento organizacional (Airtable):**
    - Tabla `Cerebro-Knowledge` (ID: `tbliZ7zNci5TUCAhj`) en base `appVu3TvSZ1E4tj0J`
    - Campos: Question, Answer, Keywords, MatchedDomains, MatchCount, Useful, NotUseful, CreatedAt
    - Cache en memoria con TTL de 5 minutos (evita re-fetch en cada query)
    - Paginacion completa para datasets grandes
    - Entradas marcadas "NotUseful" se excluyen automaticamente del contexto futuro
    - Entradas marcadas "Useful" reciben boost en scoring de relevancia

    **Sistema de feedback:**
    - Botones thumbs up/down en cada respuesta
    - Feedback se guarda en Airtable (PATCH al record de la consulta)
    - Texto contextual: "Esta respuesta fue util?" -> "Gracias por el feedback" / "Se usara para mejorar"

---

## Estructura del Proyecto

```
alter5-bi/
├── .github/
│   └── workflows/
│       └── process-emails.yml    # Pipeline automatico Gmail (04:00 UTC + dispatch manual)
├── api/
│   ├── notify-task.js            # Serverless: notificaciones email (Resend)
│   └── fetch-gdoc.js             # Serverless: proxy CORS Google Docs (sin commitear)
├── data_sources/                  # Excel originales (.gitignore)
├── scripts/
│   ├── import_mailbox.py          # Importador manual de buzones
│   ├── import_enriched.py         # Importador de datos enriquecidos v2 (Gemini)
│   ├── import_campaign.py         # Importador de datos de campana
│   ├── process_sheet_emails.py    # Pipeline automatico (Sheet -> Gemini -> JSON, soporta --reprocess)
│   ├── sync_airtable_opportunities.py  # Airtable -> opportunities.json
│   ├── create_prospects_table.py  # Crear tabla Prospects en Airtable (una vez)
│   ├── create_cerebro_table.py    # Crear tabla Cerebro-Knowledge en Airtable (una vez, YA EJECUTADO)
│   ├── reclassify_products.py     # Reclasificacion de productos
│   └── gas/
│       ├── scanMailboxes.gs       # Google Apps Script (2 buzones: Salvador + Leticia)
│       └── README.md
├── src/
│   ├── App.jsx                    # Estado global, filtros, layout, 3 tabs
│   ├── main.jsx
│   ├── index.css
│   ├── components/
│   │   ├── UI.jsx                 # Badge, KPI, FilterChip, ScoreBar
│   │   ├── Sidebar.jsx            # Filtros (7 dimensiones)
│   │   ├── CompanyTable.jsx       # Tabla ordenable y paginada
│   │   ├── DetailPanel.jsx        # Ficha detallada + enrichment IA
│   │   ├── EmployeeTabs.jsx       # Tabs por buzon
│   │   ├── CerebroSearch.jsx      # Cerebro AI: overlay de busqueda inteligente
│   │   ├── ProspectsView.jsx      # Kanban Prospects (5 columnas)
│   │   ├── ProspectPanel.jsx      # CRUD Prospects slide-in
│   │   ├── ProspectTasks.jsx      # Gestion tareas con asignacion
│   │   ├── KanbanView.jsx         # Kanban Pipeline (9 columnas)
│   │   └── OpportunityPanel.jsx   # CRUD Opportunities slide-in
│   ├── utils/
│   │   ├── constants.js           # Taxonomia, productos, scoring weights
│   │   ├── data.js                # Parsing, scoring, product matching, CSV export
│   │   ├── companyData.js         # localStorage management
│   │   ├── airtable.js            # REST client Airtable Opportunities
│   │   ├── airtableProspects.js   # REST client Airtable Prospects (sanitiza linked records)
│   │   ├── airtableTasks.js       # Sync tareas con Airtable
│   │   ├── airtableCerebro.js     # REST client Airtable Cerebro-Knowledge (base de conocimiento)
│   │   └── gemini.js              # Integracion Gemini AI + queryCerebro()
│   └── data/
│       ├── companies.json         # Datos compactos (~8MB, trackeado en git)
│       ├── companies_full.json    # Datos completos (~15MB, trackeado en git)
│       ├── employees.json         # Registro de empleados
│       └── opportunities.json     # Snapshot oportunidades Airtable
├── package.json
├── vite.config.js
├── vercel.json
├── requirements.txt               # Python: gspread, google-auth, google-generativeai
├── CLAUDE.md                      # Instrucciones para Claude Code
├── ESTADO_PROYECTO.md             # Este archivo
├── README.md
└── DEPLOY.md
```

---

## Formato de Datos Enriquecidos

### Enrichment en companies.json (detail index 5)
```json
{
  "st": "IPP",                                          // subtipo empresa
  "fc": "Negociacion",                                  // fase comercial
  "pp": [{"p": "Prestamo Construccion", "c": "alta"}],  // productos potenciales
  "sc": ["Term sheet enviado", "NDA firmado"],           // senales clave
  "mr": ["Borrower", "Debt Investor"]                   // market roles
}
```

### Market Roles (6 categorias)
| Role | Color | Descripcion |
|------|-------|-------------|
| Borrower | #F59E0B (amber) | Prestatario potencial |
| Seller (M&A) | #EF4444 (red) | Vendedor de activos/proyectos |
| Buyer Investor (M&A) | #8B5CF6 (purple) | Comprador de activos |
| Debt Investor | #3B82F6 (blue) | Inversor en deuda |
| Equity Investor | #10B981 (green) | Inversor en equity |
| Partner & Services | #6B7F94 (gray) | Proveedor/asesor/partner |

### Scoring de productos con IA
- Si la empresa tiene `productosIA` (clasificacion Gemini): alta=90, media=60, baja=30
- Si no tiene: fallback al keyword scoring existente (sin cambios)

---

## Comandos Principales

### Desarrollo
```bash
npm install
npm run dev           # Dev server -> localhost:5173
npm run build         # Build produccion -> dist/
npm run preview       # Preview del build (evita CSP issues)
```

### Importacion
```bash
# Buzon nuevo
python scripts/import_mailbox.py data_sources/analisis.xlsx "Nombre Apellido"

# Datos enriquecidos v2 (Gemini)
python scripts/import_enriched.py ~/Downloads/analisis_contactos_NAME_v2.xlsx

# Datos de campana
python scripts/import_campaign.py campaign_export.csv
```

### Pipeline Gmail (manual)
```bash
# Reprocesar emails ya marcados como done (backfill)
# Ir a GitHub Actions -> Process Gmail Emails -> Run workflow -> reprocess=true
```

### Deploy
```bash
git push origin main   # Vercel auto-deploy
```

---

## Sistema de Scoring (0-100)

| Dimension | Peso | Calculo | Que mide |
|-----------|------|---------|----------|
| **Volumen** | 35 pts | `min(35, log(emails+1) / log(max) * 35)` | Intensidad de comunicacion |
| **Recencia** | 30 pts | `30 - (meses * 1.5)` | Frescura de la relacion |
| **Red** | 15 pts | `min(15, contactos * 3)` | Amplitud de la red |
| **Tipo** | 20 pts | Segun TYPE_WEIGHTS | Relevancia estrategica |

---

## Historial de Versiones

### v1.7.0 (02/03/2026) - Cerebro AI: buscador inteligente + base de conocimiento
- **Cerebro AI**: nueva funcionalidad de busqueda en lenguaje natural sobre todas las empresas
- **Overlay modal**: accesible desde boton en nav bar, con input de texto + 6 ejemplos como chips
- **Busqueda en 4 fases**: keyword extraction -> knowledge retrieval -> Gemini analysis -> knowledge save
- **140+ stop words** en espanol para filtrar ruido de preguntas conversacionales
- **Stemming basico** para plurales: "sheets" matchea "sheet", "inversiones" matchea "inversion"
- **Busqueda exhaustiva**: recorre nombre, dominio, grupo, tipo, sector, contexto, senales, market roles, productos IA, subjects, dated_subjects, timeline
- **Todas las empresas como tarjetas**: devuelve TODAS las coincidencias, no solo las mencionadas por Gemini
- **Base de conocimiento organizacional** en Airtable (tabla `Cerebro-Knowledge`, ID: `tbliZ7zNci5TUCAhj`)
- **RAG sobre Q&A previos**: consultas anteriores se inyectan como contexto en el prompt de Gemini
- **Sistema de feedback**: thumbs up/down que mejora las respuestas futuras (Useful boost, NotUseful exclusion)
- **Cache en memoria** con TTL de 5 minutos para la knowledge base
- **Script `create_cerebro_table.py`**: creacion one-shot de la tabla en Airtable (ya ejecutado)
- **Nuevos archivos**: `CerebroSearch.jsx`, `airtableCerebro.js`, `create_cerebro_table.py`

### v1.6.0 (27/02/2026) - Fix pipeline Gmail + Tasks linked record
- **Pipeline Gmail corregido**: `companies_full.json` sacado del `.gitignore` y trackeado en git para que el GitHub Action tenga la base completa
- **Cron ajustado**: de 03:00 a 04:00 UTC (despues del GAS que corre a ~03:12)
- **Modo `--reprocess`**: nuevo flag para releer emails ya marcados como "done" en la Sheet
- **Dispatch manual con opcion reprocess** en GitHub Actions UI
- **162 emails recuperados**: 23 empresas nuevas + 54 actualizadas (total: 3,317 empresas)
- **Fix Tasks linked record**: campo `Tasks` en BETA-Prospects cambiado a linked record en Airtable; eliminado del payload PATCH/POST
- **Sanitizacion de linked records**: guard general en updateProspect/createProspect que filtra arrays de record IDs

### v1.5.1 (26/02/2026) - Multi-contactos Prospects
- Soporte multi-contactos por prospect (JSON array en campo Contacts)
- Contact Email mantiene primer email por backward compat
- Subproductos en Product (Corporate Debt, Project Finance, etc.)

### v1.5.0 (22/02/2026) - Market Roles
- Soporte completo para Market Roles (6 categorias)
- Nuevo filtro "Market Role" en sidebar con chips coloreados y contadores
- Badges de market roles en DetailPanel

### v1.4.0 (22/02/2026) - Datos enriquecidos v2 con IA
- Script `import_enriched.py` para importar analisis Gemini v2
- 1,882 empresas enriquecidas (1,503 Guillermo + 682 Leticia)
- Filtros de subtipo y fase comercial en sidebar

### v1.3.0 (22/02/2026) - Pipeline automatico Gmail -> Dashboard
- Google Apps Script + GitHub Actions + Gemini clasificacion
- Deploy automatico via Vercel

### v1.2.0 (20/02/2026) - Gestion avanzada de empresas y contactos
- Sistema de eliminacion, edicion de contactos, sector editable

### v1.1.0 (20/02/2026) - Sistema de edicion y cualificacion
- Campos editables, cualificacion automatica, localStorage

### v1.0.0 (20/02/2026) - Dashboard inicial
- Sistema de scoring, soporte multi-buzon, deploy Vercel

---

## Proximos Pasos

### Alta Prioridad — Cerebro AI
- [ ] **Probar Cerebro en produccion** (Vercel) — verificar que la API key de Gemini y el PAT de Airtable funcionan
- [ ] **Revocar el PAT de Airtable expuesto en la sesion** y crear uno nuevo (el token fue compartido en chat)
- [ ] **Actualizar `VITE_AIRTABLE_PAT`** en Vercel Environment Variables si se renueva el token
- [ ] Verificar que la tabla `Cerebro-Knowledge` se puebla correctamente con Q&A
- [ ] Iterar sobre la calidad de respuestas del Cerebro con queries reales del equipo

### Alta Prioridad — Datos
- [ ] Procesar Market Roles en Colab con Gemini y correr `import_enriched.py` con los Excel resultantes
- [ ] Analisis enriquecido v2 para Salvador (completar los 3 buzones)
- [ ] Commitear `api/fetch-gdoc.js` (serverless function activa pero sin trackear)
- [ ] Renovar token `AIRTABLE_PAT` en GitHub Secrets (expiro ~26-feb)

### Media Prioridad
- [ ] Adaptar lectura de Tasks en `normalizeProspect` al nuevo formato linked record
- [ ] Integrar historico_trimestral enriquecido en el timeline del detalle
- [ ] Exportar campos enriquecidos (incl. market roles) en el CSV
- [ ] Graficos de distribucion (sector, subtipo, fase)
- [ ] Cerebro: captura de metadatos de adjuntos en el pipeline Gmail (investigado, pendiente implementacion)

### Baja Prioridad
- [ ] Sistema de notificaciones para relaciones en riesgo
- [ ] Multi-idioma (i18n)
- [ ] Autenticacion (Auth0/Clerk) para privacidad

---

**Ultima actualizacion:** 2 de marzo de 2026
**Actualizado por:** Claude Code (Anthropic)
