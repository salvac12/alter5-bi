# Estado del Proyecto - Alter5 BI
**Fecha actualización:** 22 de febrero de 2026
**Ultima modificacion:** Datos enriquecidos v2 (Guillermo + Leticia) con scoring IA

---

## Resumen Ejecutivo

Dashboard de Business Intelligence para analisis y clasificacion de la red de contactos empresariales de Alter5, con sistema de scoring multi-dimensional, gestion multi-buzon y enriquecimiento de datos con Gemini.

---

## Estado Actual

### Completado

1. **Configuracion del proyecto**
   - React 18.3.1 + Vite 5.4
   - Lodash para utilidades de datos
   - Node >= 18.0.0

2. **Datos importados**
   - Salvador Carrillo: 2,202 empresas (18/02/2026)
   - Guillermo Souto: 1,511 empresas (18/02/2026)
   - Leticia Menendez: 681 empresas (18/02/2026)
   - **Total tras fusion:** 3,272 empresas unicas
   - **Con datos enriquecidos IA:** 1,882 empresas (Guillermo + Leticia v2)

3. **Enriquecimiento IA v2 (NUEVO)**
   - Analisis con Gemini de los buzones de Guillermo (1,503 empresas) y Leticia (682 empresas)
   - Campos nuevos por empresa: subtipo empresa, fase comercial, productos potenciales IA, senales clave
   - Contexto ampliado de 150 a 500 caracteres
   - Script `import_enriched.py` para merge sin sobreescribir datos de otros buzones
   - Scoring de productos usa clasificacion IA directa cuando existe (alta=90, media=60, baja=30), fallback a keyword scoring

4. **Funcionalidades core**
   - Sistema de scoring 0-100 (Volumen 35% + Recencia 30% + Red 15% + Tipo 20%)
   - Estados de relacion: Activa (<6m), Dormida (6-18m), Perdida (>18m)
   - Sistema de tabs por empleado (Todos/Salvador/Guillermo/Leticia)
   - **Ordenamiento por score descendente por defecto** (empresas mas relevantes primero)
   - Busqueda libre por nombre/dominio/sector/tipo/subtipo/fase
   - Filtros combinables: estado, sector, tipo relacion, **subtipo empresa**, **fase comercial**, producto Alter5
   - Filtros preparados para futuro (Tamano Empresa y Pais) con estado disabled
   - Badge contador de filtros activos en sidebar
   - Tabla ordenable y paginada
   - Exportacion CSV (compatible Airtable)

   **Ficha de empresa detallada:**
   - Badges de subtipo empresa (morado) y fase comercial (coloreado por estado)
   - Productos potenciales IA con nivel de confianza (alta/media/baja)
   - Senales clave como chips
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

5. **Sistema de importacion**
   - `scripts/import_mailbox.py` — Importacion manual de buzones Excel
   - `scripts/import_enriched.py` — Importacion de analisis enriquecido v2 (Gemini)
   - `scripts/import_campaign.py` — Importacion de datos de campana
   - Todos los exportadores preservan campo enrichment (indice 5 en details)
   - Fusion automatica de empresas duplicadas entre buzones

6. **Pipeline automatico Gmail → Dashboard (v1.3.0)**
   - Google Apps Script escanea buzones de Salvador y Leticia diariamente (trigger 03:00-04:00)
   - Autenticacion via Service Account + OAuth2 + delegacion de dominio
   - Emails nuevos en Google Sheet (tab `raw_emails`) con status `pending`
   - GitHub Actions se dispara automaticamente
   - Filtro de relevancia con IA: Gemini descarta emails no comerciales
   - Clasificacion automatica y fusion incremental
   - Vercel auto-despliega al detectar cambios en `main`

   **Infraestructura configurada:**
   - Google Cloud project: `alter5-ai-crm`
   - Service Account con delegacion de dominio (scopes: gmail.readonly + spreadsheets)
   - Google Sheet con 3 tabs: `raw_emails`, `config`, `ai_classifications`
   - GitHub Secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GEMINI_API_KEY`, `GOOGLE_SHEET_ID`, `GH_PAT_WORKFLOW`

7. **Deploy y versioning**
   - Git repository: `https://github.com/salvac12/alter5-bi.git`
   - Branch: `main`
   - Deploy en Vercel (auto-deploy on push)
   - Panel Vercel: `https://vercel.com/salvas-workspaces-projects/alter5-bi`

---

## Estructura del Proyecto

```
alter5-bi/
├── .github/
│   └── workflows/
│       └── process-emails.yml    # Pipeline automatico Gmail
├── data_sources/                  # Excel originales (.gitignore)
├── docs/
│   ├── plan-mejora-clasificacion.md
│   └── product-matching-methodology.md
├── scripts/
│   ├── import_mailbox.py          # Importador manual de buzones
│   ├── import_enriched.py         # Importador de datos enriquecidos v2 (Gemini)
│   ├── import_campaign.py         # Importador de datos de campana
│   ├── process_sheet_emails.py    # Pipeline automatico (Sheet → JSON)
│   ├── reclassify_products.py     # Reclasificacion de productos
│   └── gas/
│       ├── scanMailboxes.gs       # Google Apps Script
│       └── README.md
├── src/
│   ├── App.jsx                    # Estado global, filtros, layout
│   ├── main.jsx
│   ├── index.css
│   ├── components/
│   │   ├── UI.jsx                 # Badge, KPI, FilterChip, ScoreBar
│   │   ├── Sidebar.jsx            # Filtros (sector, tipo, subtipo, fase, producto)
│   │   ├── CompanyTable.jsx       # Tabla ordenable y paginada
│   │   ├── DetailPanel.jsx        # Ficha detallada + enrichment IA
│   │   └── EmployeeTabs.jsx       # Tabs por buzon
│   ├── utils/
│   │   ├── constants.js           # SECTORS, TIPOS, SUBTIPOS_EMPRESA, FASES_COMERCIALES, PRODUCTS
│   │   ├── data.js                # parseCompanies(), calculateProductMatches() con IA
│   │   └── companyData.js         # localStorage management
│   └── data/
│       ├── companies.json         # Datos compactos con enrichment (auto-generado)
│       ├── companies_full.json    # Datos completos con sources (auto-generado)
│       └── employees.json         # Registro de empleados
├── package.json
├── vite.config.js
├── vercel.json
└── ESTADO_PROYECTO.md
```

---

## Formato de Datos Enriquecidos

### Enrichment en companies.json (detail index 5)
```json
{
  "st": "IPP",                                          // subtipo empresa
  "fc": "Negociacion",                                  // fase comercial
  "pp": [{"p": "Prestamo Construccion", "c": "alta"}],  // productos potenciales
  "sc": ["Term sheet enviado", "NDA firmado"]            // senales clave
}
```

### Scoring de productos con IA
- Si la empresa tiene `productosIA` (clasificacion Gemini): alta=90, media=60, baja=30
- Si no tiene: fallback al keyword scoring existente (sin cambios)

---

## Comandos Principales

### Desarrollo
```bash
npm install
npm run dev           # Dev server → localhost:5173
npm run build         # Build produccion → dist/
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

### v1.4.0 (22/02/2026) - Datos enriquecidos v2 con IA
- Script `import_enriched.py` para importar analisis Gemini v2
- 1,882 empresas enriquecidas (1,503 Guillermo + 682 Leticia, con solapamiento)
- Campos nuevos: subtipo empresa, fase comercial, productos potenciales IA, senales clave
- Filtros de subtipo y fase comercial en sidebar
- Badges de subtipo (morado) y fase (coloreado) en panel de detalle
- Productos IA con nivel de confianza y senales clave como chips
- Scoring de productos usa clasificacion IA directa (alta=90, media=60, baja=30)
- Contexto ampliado de 150 a 500 caracteres
- Ordenamiento por score descendente por defecto
- Busqueda incluye subtipo y fase
- Todos los exportadores (mailbox, campaign, enriched) preservan enrichment

### v1.3.0 (22/02/2026) - Pipeline automatico Gmail → Dashboard
- Google Apps Script escanea buzones via Gmail API + OAuth2
- Service Account con delegacion de dominio
- Google Sheet como intermediario
- GitHub Actions workflow con filtro de relevancia IA (Gemini)
- Clasificacion automatica y fusion incremental
- Deploy automatico via Vercel

### v1.2.0 (20/02/2026) - Gestion avanzada de empresas y contactos
- Sistema de eliminacion de empresas con modal de confirmacion
- Edicion completa de contactos
- Sector editable con desplegable
- Website clickable

### v1.1.0 (20/02/2026) - Sistema de edicion y cualificacion
- Campos editables manuales
- Cualificacion automatica de pais y tamano
- Almacenamiento persistente en localStorage

### v1.0.0 (20/02/2026) - Dashboard inicial
- Sistema de scoring multi-dimensional
- Soporte multi-buzon (3 buzones)
- Filtros, tabla ordenable, panel de detalle
- Deploy en Vercel

---

## Proximos Pasos

### Alta Prioridad
- [ ] Analisis enriquecido v2 para Salvador (completar los 3 buzones)
- [ ] Integrar historico_trimestral enriquecido en el timeline del detalle
- [ ] Exportar campos enriquecidos en el CSV

### Media Prioridad
- [ ] Graficos de distribucion (sector, subtipo, fase)
- [ ] Filtro por rango de fechas
- [ ] Integracion con LinkedIn para cualificacion de tamano
- [ ] Sincronizacion bidireccional con Airtable

### Baja Prioridad
- [ ] Sistema de notificaciones para relaciones en riesgo
- [ ] Multi-idioma (i18n)
- [ ] Autenticacion (Auth0/Clerk) para privacidad

---

**Ultima actualizacion:** 22 de febrero de 2026
**Actualizado por:** Claude Code (Anthropic)
