# Guía Técnica Completa — Sección Empresas (Alter5 BI)

> **Propósito de este documento**: Describir con suficiente detalle técnico el funcionamiento de la sección *Empresas* del CRM Alter5 BI para que otro equipo pueda replicar la misma infraestructura sobre una base tecnológica diferente, manteniendo los mismos criterios de alimentación de datos, filtrado, detalle de empresa y conexiones con Airtable.

---

## Tabla de Contenidos

1. [Visión General y Arquitectura](#1-visión-general-y-arquitectura)
2. [Origen y Alimentación de la Base de Datos](#2-origen-y-alimentación-de-la-base-de-datos)
3. [Pipeline de Procesamiento de Emails](#3-pipeline-de-procesamiento-de-emails)
4. [Taxonomía de Clasificación Gemini](#4-taxonomía-de-clasificación-gemini)
5. [Formato de los Datos](#5-formato-de-los-datos)
6. [Parsing en el Frontend (data.ts)](#6-parsing-en-el-frontend-datats)
7. [Sistema de Overrides y Empresas Ocultas](#7-sistema-de-overrides-y-empresas-ocultas)
8. [Sistema de Filtros](#8-sistema-de-filtros)
9. [Tabla de Empresas (CompanyTable)](#9-tabla-de-empresas-companytable)
10. [Ficha de Empresa (DetailPanel)](#10-ficha-de-empresa-detailpanel)
11. [Sistema de Verificación — Airtable Verified-Companies](#11-sistema-de-verificación--airtable-verified-companies)
12. [Referencia Completa de Llamadas a Airtable](#12-referencia-completa-de-llamadas-a-airtable)

---

## 1. Visión General y Arquitectura

### 1.1 Diagrama de flujo completo

```
Gmail (8 buzones)
  │  format=full: subject + snippet + body_text (≤2000 chars)
  ▼
Google Apps Script — scanMailboxes.gs
  │  escribe en Google Sheet "alter5-bi-pipeline" > tab "raw_emails"
  │  trigger: cada ~3 horas (03:12 UTC aprox.)
  ▼
Google Sheet (10 columnas: processed, from_email, from_name, from_domain,
              employee_id, subject, body_snippet, thread_date, body_text, ...)
  │  status="pending" en filas sin procesar
  ▼
GitHub Actions — process-emails.yml
  │  trigger: diario 04:00 UTC + dispatch manual (con opción --reprocess)
  ▼
Python — scripts/process_sheet_emails.py
  │  1. Lee emails pending de la Sheet (gspread + OAuth)
  │  2. Filtra relevantes con Gemini (batches 20)
  │  3. Agrupa emails por dominio de empresa
  │  4. Carga companies_full.json existente
  │  5. Clasifica nuevas empresas + re-clasifica existentes (Gemini)
  │  6. Merge incremental en companies_full.json
  │  7. Genera resúmenes trimestrales
  │  8. Escribe companies_full.json + companies.json (compacto) + employees.json
  ▼
Git commit + push → main
  │
  ▼
Vercel — auto-deploy desde main
  │  sirve /companies.json como asset estático
  ▼
React (Vite) — src/App.tsx
  │  fetch('/companies.json') → parseCompanies() → array de objetos Company
  │
  ├── Airtable Verified-Companies (GET paginado, cache 5 min)
  │     → auto-aplica overrides de clasificación verificada
  │
  ├── localStorage (overrides manuales, empresas ocultas)
  │
  └── Vista Empresas: CompanyTable + Sidebar filtros + DetailPanel
```

### 1.2 Dos formatos de datos

| Aspecto | `companies_full.json` | `companies.json` |
|---------|----------------------|-----------------|
| Uso | Scripts Python (merge incremental) | Frontend React (cargado vía fetch) |
| Tamaño | ~15 MB | ~8 MB |
| Formato raíz | `{ "companies": { "domain": {...} } }` | `{ "r": [...], "d": {...} }` |
| Indexación | Dict por dominio | Array `r[]` + dict `d{}` por posición |
| Contactos | Array de dicts `{name, email, role}` | Array posicional `[name, role, email, ...]` |
| Timeline | Array de dicts `{quarter, emails}` | Array posicional `[quarter, emails, summary]` |
| Seguimiento en git | Sí (obligatorio para CI/CD) | Sí |

> **Importante**: `companies_full.json` DEBE estar en git (no en `.gitignore`) para que el GitHub Action disponga de la base completa al hacer el merge incremental. Sin este fichero el pipeline parte de cero.

### 1.3 Fuentes de datos adicionales

Además del pipeline de emails, las empresas reciben datos de:

- **Airtable Verified-Companies**: clasificaciones verificadas manualmente o por agente IA que toman precedencia sobre Gemini.
- **localStorage (navegador)**: overrides de clasificación que el usuario edita directamente desde el panel de detalle, y lista de empresas ocultas.
- **Scraper España** (`scraper_projects.json`): 5.652 proyectos renovables con datos de MW, tecnología y permisos, cruzados con el CRM.
- **Blocklist estática** (`src/data/blocklist.json`): dominios excluidos permanentemente de la vista.

---

## 2. Origen y Alimentación de la Base de Datos

### 2.1 Fuente primaria — Buzones Gmail

La base de datos se alimentó históricamente y se sigue actualizando a diario a partir de los correos electrónicos corporativos de 8 personas del equipo:

| ID empleado | Nombre | Estado |
|-------------|--------|--------|
| `salvador_carrillo` | Salvador Carrillo | Activo |
| `leticia_*` | Leticia | Activa |
| `javier_ruiz` | Javier Ruiz | Activo |
| `miguel_solana` | Miguel Solana | Activo |
| `carlos_*` | Carlos | Activo |
| `gonzalo_*` | Gonzalo | Activo |
| `rafael_nevado` | Rafael Nevado | Activo |
| `guillermo_souto` | Guillermo Souto | Histórico (ya no en la empresa) |

Cada correo intercambiado con una empresa externa contribuye a:
- Contabilizar interacciones (volume score)
- Identificar contactos (email, nombre, apellido)
- Clasificar el tipo de empresa (Gemini analiza subject + body)
- Construir la línea temporal trimestral

### 2.2 Google Apps Script — scanMailboxes.gs

El script `scripts/gas/scanMailboxes.gs` se ejecuta con un trigger periódico (aprox. cada 3 horas) y:

1. Conecta con el Gmail de cada empleado usando OAuth delegado de Google Workspace.
2. Lee threads nuevos (no procesados) en formato `format=full` para capturar el body completo.
3. Extrae por cada email: `from_email`, `from_name`, `from_domain` (parte después de `@`), `subject`, `body_snippet` (primeros 200 chars del Gmail snippet), `body_text` (hasta 2.000 chars del body completo extraído del payload MIME), `thread_date`.
4. Escribe una fila por email en el tab `raw_emails` de la Google Sheet `alter5-bi-pipeline` con `status = "pending"`.

**Columnas del tab `raw_emails`** (10 columnas):

| Columna | Descripción |
|---------|-------------|
| `processed` | `"pending"` / `"done"` / `"ignored"` |
| `from_email` | Email del remitente externo |
| `from_name` | Nombre display del remitente |
| `from_domain` | Dominio extraído del email (`bestinver.es`) |
| `employee_id` | ID del empleado cuyo buzón recibió el email |
| `subject` | Asunto del email |
| `body_snippet` | Extracto del snippet de Gmail (≤200 chars) |
| `thread_date` | Fecha del email (YYYY-MM-DD) |
| `body_text` | Texto completo del body (≤2.000 chars, extraído del MIME payload) |
| *(extra)* | Campos adicionales de metadatos |

### 2.3 Fuente secundaria — Scraper España

El scraper de proyectos renovables de España (`scripts/enrich_from_scraper.py` e `import_scraper_companies.py`) aporta:

- **609 empresas nuevas** importadas con dominio pseudo `.scraper.es` (p.ej. `aboenergy.scraper.es`)
- **129 empresas enriquecidas** del CRM existente con datos de proyectos del MITECO/CCAA
- Datos por empresa: número de proyectos, MW totales, MWp, capex, tecnologías, estados de permisos, SPVs

### 2.4 Enriquecimiento adicional

| Script | Herramienta | Qué aporta |
|--------|-------------|-----------|
| `enrich_contacts.py --backend perplexity` | Perplexity Sonar | Roles de contactos (los roles son fiables; las URLs LinkedIn NO) |
| `enrich_contacts.py --backend apollo` | Apollo.io People Match | LinkedIn URLs reales + cargo verificado + foto |
| `verify_classifications.py` | Gemini 2.5 Flash + Google Search | Verifica clasificación actual vs información real de la web |
| `backfill_classifications.py` | Gemini | Re-clasifica todas las empresas sin v2 enrichment |

---

## 3. Pipeline de Procesamiento de Emails

### 3.1 Flujo de 8 pasos (process_sheet_emails.py)

```python
# Paso 1: Conectar con Google Sheet
gc = gspread.service_account(filename="service_account.json")
sheet = gc.open("alter5-bi-pipeline")

# Paso 2: Leer emails pending
ws, pending_emails = read_pending_emails(sheet, reprocess=args.reprocess)

# Paso 2b: Filtrar relevantes con Gemini
relevant_emails = filter_relevant_emails(pending_emails)

# Paso 3: Agrupar por dominio
domains_data = group_emails_by_company(relevant_emails)

# Paso 4: Cargar JSON existente
with open("src/data/companies_full.json") as f:
    all_companies = json.load(f)["companies"]

# Paso 5: Clasificar con Gemini (priorizando Verified-Companies y known_companies)
classifications = classify_domains_with_gemini(domains_data, verified=verified_map)

# Paso 6: Merge incremental
for domain, new_data in domains_data.items():
    if domain in all_companies:
        merge_company(all_companies[domain], new_data, emp_id)
    else:
        all_companies[domain] = build_new_company(domain, new_data, classifications[domain])

# Paso 7: Generar resúmenes trimestrales
generate_quarterly_summaries(all_companies)

# Paso 8: Escritura atómica
_atomic_json_write("src/data/companies_full.json", {"companies": all_companies})
_atomic_json_write("src/data/companies.json", build_compact(all_companies))
_atomic_json_write("src/data/employees.json", build_employees(all_companies))
```

### 3.2 Filtrado de relevancia (filter_relevant_emails)

Llama a Gemini en batches de 20 emails. El prompt evalúa si el email es **relevante** (relación comercial con cliente, inversor, asesor, oportunidad de financiación, reunión, NDA, due diligence, M&A, renovables) o **no relevante** (newsletters, notificaciones SaaS, facturas genéricas, marketing masivo, spam).

Por cada email proporciona: `from_email`, `subject`, y `body_text[:500]` (o `body_snippet[:200]` si no hay body).

Respuesta Gemini:
```json
{"relevant": [0, 2, 5], "ignored": [1, 3, 4]}
```

Los emails `ignored` se marcan como `"processed": "ignored"` en la Sheet sin ser procesados.

### 3.3 Agrupación por empresa (group_emails_by_company)

Agrupa por `from_domain`. Para cada dominio construye:

```python
{
  "employees": {
    "salvador_carrillo": {
      "interactions": 47,
      "firstDate": "2022-03-15",
      "lastDate": "2026-02-10"
    }
  },
  "contacts": {
    "john.smith@bestinver.es": {
      "name": "john.smith",
      "email": "john.smith@bestinver.es",
      "domain": "bestinver.es",
      "nombre": "John",   # extraído si el display_name contiene "John Smith"
      "apellido": "Smith"
    }
  },
  "subjects": ["RE: Proyecto Sol", "FW: Term Sheet Q3", ...],  # max 20
  "dated_subjects": [                                            # max 30
    ["2026-02-10", "RE: Proyecto Sol", "Hola Salva, adjunto el..."]
  ],
  "snippets": ["Hola Salvador, te adjunto...", ...],            # max 10
  "bodies": ["Texto completo del body hasta 1000 chars", ...],  # max 10
  "contact_subjects": {
    "john.smith@bestinver.es": ["RE: Proyecto Sol", "Follow-up reunión"]
  }
}
```

La extracción de nombre/apellido sigue esta lógica:
1. Si `display_name` tiene al menos 2 tokens: primer token = nombre, resto = apellido.
2. Si no, intenta regex sobre la parte local del email: `^([a-z]+)[._-]([a-z]+)$` → nombre/apellido.

### 3.4 Clasificación con Gemini (classify_domains_with_gemini)

**Prioridad de resolución** (de mayor a menor):

1. **Verified-Companies (Airtable)** — status `Verified` o `Edited`: se usa tal cual, no se llama a Gemini.
2. **known_companies.json** (`config/known_companies.json`): diccionario estático de empresas conocidas con clasificación manual.
3. **Gemini** (para el resto): batch de 6 empresas por llamada.

**Input por empresa** para Gemini:
```
dominio.es (Nombre Empresa):
  subjects=["RE: Term Sheet Proyecto Sol", "FW: Reunión financiación Q3"]
  email_content=["Hola Salva, adjunto el term sheet para el proyecto... [hasta 2000 chars]"]
```

**Árbol de decisión en el prompt**:

```
Paso 1 → ROLE
  "Originación"    - empresa que busca financiación (developer, constructor, IPP...)
  "Inversión"      - entidad que invierte/financia (fondo, banco, family office...)
  "Services"       - presta servicios (asesor legal, técnico, financiero, EPC...)
  "No relevante"   - sin relación comercial clara con energías renovables

Paso 2 → SEGMENT (solo si role = "Originación")
  "Project Finance"   - proyectos utility-scale, parques solares/eólicos
  "Corporate Finance" - empresas (autoconsumo, EPC, BESS distribuido, H2...)

Paso 3 → TYPE (según role + segment)
  Originación > Project Finance: Developer | IPP | Developer + IPP
  Originación > Corporate Finance: (sin tipos fijos, usa activities)
  Inversión > Deuda: Fondo de deuda | Banco | Bonista / Institucional
  Inversión > Equity: Fondo de infraestructura | Private equity |
                      Fondo renovable | IPP comprador | Utility compradora
  Services: Asesor legal | Asesor técnico | Consultor de precios |
            Asset manager | Ingeniería | Asesor financiero | Asociación / Institución

Paso 4 → ACTIVITIES (solo si role=Originación, segment=Corporate Finance)
  Autoconsumo industrial/comercial | Movilidad / Cargadores EV |
  EPC / Construcción renovable | Almacenamiento / BESS distribuido |
  Data centers | Electrointensivo | Biogás / Biometano |
  Hidrógeno verde | Eficiencia energética | Calor renovable / Biomasa |
  Redes / Infraestructura eléctrica | Agritech / Agrovoltaica

Paso 5 → ATRIBUTOS EXTRA
  technologies[]:   Solar | Eólica | BESS | Biogás | Hidrógeno | Otra
  geography[]:      España | Portugal | Italia | Francia | Alemania | UK | Otro
  market_roles[]:   Borrower | Seller (M&A) | Buyer Investor (M&A) |
                    Debt Investor | Equity Investor | Partner & Services
  productos_potenciales[]: [{"p": "nombre_producto", "c": "alta|media|baja"}]
  senales_clave[]:  array de bullets con señales comerciales detectadas
  fase_comercial:   Sin contactar | Primer contacto | Exploración |
                    Negociación | Cliente activo | Dormido
```

**Respuesta JSON de Gemini** (por empresa):
```json
{
  "bestinver.es": {
    "role": "Inversión",
    "segment": "",
    "type": "Fondo de infraestructura",
    "activities": [],
    "technologies": ["Solar", "Eólica"],
    "geography": ["España", "Portugal"],
    "market_roles": ["Equity Investor"],
    "productos_potenciales": [{"p": "Equity", "c": "alta"}],
    "senales_clave": ["Inversor activo en renovables", "Deal mencionado: Proyecto Sol"],
    "fase_comercial": "Exploración"
  }
}
```

**Validaciones aplicadas** antes de guardar:
- `role` debe estar en `COMPANY_ROLES`; si no → `"No relevante"`
- `segment` vacío si `role != "Originación"`; validado contra `ORIGINACION_SEGMENTS`
- `type` validado contra la lista del role+segment correspondiente
- `activities` sólo si `segment == "Corporate Finance"`; validadas contra `CORPORATE_ACTIVITIES`
- `technologies` filtradas contra `TECHNOLOGIES`
- `geography` filtrada contra `GEOGRAPHIES`
- `market_roles` filtrados contra `MARKET_ROLES_LIST`

**Objeto enrichment generado**:
```python
enrichment = {
  "_tv": 2,                        # versión de taxonomía
  "role": role,                    # "Originación" | "Inversión" | "Services" | "No relevante"
  "seg": segment,                  # "Project Finance" | "Corporate Finance" | ""
  "tp2": comp_type,                # tipo v2
  "act": activities,               # [] o lista de actividades
  "tech": technologies,            # [] o lista de tecnologías
  "geo": geography,                # [] o lista de geografías
  "mr": valid_market_roles,        # [] o lista de market roles
  "grp": legacy_group,             # backward compat: "Capital Seeker" | "Investor" | ...
  "tp": legacy_type,               # backward compat (= tp2)
  "pp": productos_potenciales,     # [] o [{"p": str, "c": "alta|media|baja"}]
  "sc": senales_clave,             # [] o lista de bullets
  "fc": fase_comercial,            # fase comercial estimada
  "_classified_at": "ISO datetime",
  "_email_count": N,               # interacciones en el momento de clasificar
}
```

### 3.5 Re-clasificación automática

El pipeline re-clasifica empresas **ya existentes** si se cumple alguna de estas condiciones:

| Condición | Descripción |
|-----------|-------------|
| `enrichment._tv != 2` | No tiene taxonomía v2 (enrichment legacy) |
| `role in ("No relevante", "Other")` | Clasificada como irrelevante, puede haber cambiado |
| `interactions >= prev_count * 2 AND delta >= 5` | Se han duplicado los emails desde la última clasificación |

### 3.6 Merge incremental (merge_company)

Para empresas ya existentes, el merge hace lo siguiente:

- **Interacciones**: suma las nuevas interacciones por empleado
- **Fechas**: actualiza `firstDate` y `lastDate`
- **Contactos**: dedup por email, añade nuevos, conserva datos existentes (nombre, rol)
- **Subjects**: append de nuevos subjects (sin duplicados), truncado a 20
- **Dated subjects**: append, truncado a 30, ordenado cronológico
- **Snippets y bodies**: append de nuevos, truncado a 10
- **Enrichment**: no se sobreescribe si ya existe y es v2, salvo que se active re-clasificación

### 3.7 Escritura atómica

Para evitar ficheros corruptos en caso de fallo:

```python
def _atomic_json_write(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)  # rename atómico en Unix
```

### 3.8 GitHub Actions CI/CD

El workflow `.github/workflows/process-emails.yml` se ejecuta:
- **Automáticamente**: diario a las 04:00 UTC
- **Manualmente** (workflow dispatch): con opción `reprocess=true` para releer emails ya procesados

Variables de entorno necesarias en los Secrets de GitHub:
- `GOOGLE_SERVICE_ACCOUNT_JSON` — credenciales OAuth para Google Sheets
- `GEMINI_API_KEY` — clave API de Google Gemini
- `AIRTABLE_PAT` — token de Airtable para leer Verified-Companies
- `GITHUB_TOKEN` — para hacer git push del JSON actualizado

---

## 4. Taxonomía de Clasificación Gemini

### 4.1 Roles principales

| ID | Label | Color UI | Descripción |
|----|-------|----------|-------------|
| `Originación` | Originación | `#F59E0B` | Empresa que busca financiación: developers, IPPs, empresas con activos renovables |
| `Inversión` | Inversión | `#3B82F6` | Entidad que financia o invierte: fondos, bancos, family offices |
| `Services` | Services | `#6B7F94` | Prestadores de servicios: asesores, ingeniería, consultores |
| `No relevante` | No relevante | `#94A3B8` | Sin relación comercial con el negocio de Alter5 |

**Score de rol** (contribuye al score compuesto de la empresa):
```
Originación  → +20 pts
Inversión    → +18 pts
Services     → +8 pts
No relevante → +0 pts
```

### 4.2 Segmentos (solo Originación)

| ID | Descripción |
|----|-------------|
| `Project Finance` | Parques solares, eólicos, utility-scale; cada activo tiene su propia deuda |
| `Corporate Finance` | Financiación corporativa: autoconsumo, EPC, distribuidores, H2, BESS |

### 4.3 Tipos por combinación role/segment

| Combinación | Tipos válidos |
|-------------|--------------|
| Originación > Project Finance | `Developer`, `IPP`, `Developer + IPP` |
| Originación > Corporate Finance | *(sin tipos fijos, usa activities)* |
| Inversión > Deuda | `Fondo de deuda`, `Banco`, `Bonista / Institucional` |
| Inversión > Equity | `Fondo de infraestructura`, `Private equity`, `Fondo renovable`, `IPP comprador`, `Utility compradora` |
| Services | `Asesor legal`, `Asesor técnico`, `Consultor de precios`, `Asset manager`, `Ingeniería`, `Asesor financiero`, `Asociación / Institución` |

### 4.4 Actividades Corporate Finance (multi-select)

Solo para empresas con `role=Originación, segment=Corporate Finance`:

```
Autoconsumo industrial/comercial  | Movilidad / Cargadores EV
EPC / Construcción renovable      | Almacenamiento / BESS distribuido
Data centers                      | Electrointensivo
Biogás / Biometano                | Hidrógeno verde
Eficiencia energética             | Calor renovable / Biomasa
Redes / Infraestructura eléctrica | Agritech / Agrovoltaica
```

### 4.5 Tecnologías (multi-select)

`Solar` | `Eólica` | `BESS` | `Biogás` | `Hidrógeno` | `Otra`

### 4.6 Geografías (multi-select)

`España` | `Portugal` | `Italia` | `Francia` | `Alemania` | `UK` | `Otro`

### 4.7 Market Roles

| ID | Descripción |
|----|-------------|
| `Borrower` | Empresa que pide deuda (originación Project Finance) |
| `Seller (M&A)` | Empresa que vende activos o equity |
| `Buyer Investor (M&A)` | Empresa que compra activos |
| `Debt Investor` | Presta dinero (banco, fondo de deuda) |
| `Equity Investor` | Invierte en equity (fondo, IPP comprador) |
| `Partner & Services` | Presta servicios o es socio de negocio |

### 4.8 Fases comerciales

`Sin contactar` | `Primer contacto` | `Exploración` | `Negociación` | `Cliente activo` | `Dormido`

---

## 5. Formato de los Datos

### 5.1 companies_full.json — Estructura completa

**Raíz**:
```json
{
  "companies": {
    "bestinver.es": { ... },
    "empresa.com": { ... }
  }
}
```

**Campos de primer nivel por empresa**:

| Campo | Tipo | Ejemplo |
|-------|------|---------|
| `name` | string | `"Bestinver"` |
| `domain` | string | `"bestinver.es"` |
| `sectors` | string | `"Inversion / Financiero"` (legacy) |
| `nContacts` | int | `11` |
| `interactions` | int | `8224` (total emails) |
| `relType` | string | `"Inversión"` (legacy) |
| `firstDate` | string ISO | `"2021-01-11"` |
| `lastDate` | string ISO | `"2026-01-12"` |
| `context` | string | Resumen IA de la relación |
| `subjects` | array[string] | Últimos 20 asuntos de email |
| `dated_subjects` | array[[date, subject, extract]] | Últimos 30 emails con fecha + asunto + extracto |
| `snippets` | array[string] | Últimos 10 body snippets crudos |
| `contacts` | array[dict] | `[{"name": "john.smith", "email": "...", "role": "CFO"}]` |
| `timeline` | array[dict] | `[{"quarter": "Q1 2024", "emails": 45}]` |
| `sources` | dict | `{"javier_ruiz": 54, "miguel_solana": 5222}` |
| `enrichment` | dict | Ver sección 5.2 |

**Objeto `contacts` en full**:
```json
{
  "name": "john.smith",
  "email": "john.smith@bestinver.es",
  "role": "Director de Inversiones",
  "nombre": "John",
  "apellido": "Smith",
  "linkedinUrl": "https://linkedin.com/in/john-smith",
  "photoUrl": "https://...",
  "_role_source": "apollo",
  "_role_confidence": "high",
  "_role_verified_at": "2026-03-18T10:00:00Z"
}
```

### 5.2 Objeto enrichment — Todos los campos

#### Campos de taxonomía (generados por Gemini)

```json
{
  "_tv": 2,
  "role": "Originación",
  "seg": "Project Finance",
  "tp2": "Developer + IPP",
  "act": [],
  "tech": ["Solar", "Eólica"],
  "geo": ["España", "Portugal"],
  "mr": ["Borrower", "Seller (M&A)"],
  "grp": "Capital Seeker",
  "tp": "Developer + IPP",
  "pp": [{"p": "Debt", "c": "alta"}, {"p": "Equity", "c": "media"}],
  "sc": ["Pipeline 200MW RTB", "NDA firmado en Q2 2024"],
  "fc": "Exploración",
  "_classified_at": "2026-03-17T10:30:00Z",
  "_email_count": 47,
  "_backfill": true
}
```

#### Campos de enriquecimiento de Originación

```json
{
  "business_lines": ["Utility-scale developer", "IPP", "BESS"],
  "project_scale": "Utility-scale",
  "known_pipeline_mw": 850,
  "website_url": "https://empresa.com",
  "website_description": "Developer de energías renovables con pipeline de 850 MW...",
  "_web_enriched_at": "2026-03-10T08:00:00Z",
  "_web_source": "perplexity",
  "emp_count": 120,
  "revenue_eur": 15000000
}
```

#### Campos de enriquecimiento de Inversión

```json
{
  "sentiment": "muy_interesado",
  "inv_phase": "RTB",
  "ticket_size": "10-50M€",
  "asset_types": ["Solar utility", "Eólica"],
  "inv_criteria": "Proyectos >50MW en España con AAC",
  "next_action": "Enviar teaser Proyecto Sol",
  "deals_mentioned": ["Proyecto Sol", "Eolica Norte"],
  "inv_subtipo": "Fondo de deuda",
  "investor_type_web": "Fondo de infraestructura",
  "investor_focus": ["Project Finance", "Brownfield / Operativo"],
  "aum_range": "500M-2B€",
  "renewable_experience": "Especialista renovables",
  "investor_geo_focus": ["España", "Portugal", "Italia"],
  "notable_renewable_deals": ["500MW solar España 2023"],
  "_inv_updated_at": "2026-03-15T09:00:00Z"
}
```

#### Campos sincronizados desde Airtable (sync_investor_feedback.py)

```json
{
  "at_notes": "Muy activos en deuda. Buscan deals >50MW.",
  "at_trust_level": 4,
  "at_ticket_min": 10000000,
  "at_ticket_max": 50000000,
  "at_workstreams": [
    {
      "deal": "Proyecto Sol 250MW",
      "status": "Declined Consideration",
      "notes": "Revisado julio 2024",
      "rejection": "Ticket muy bajo para su fondo"
    }
  ],
  "at_target": true
}
```

#### Campos del scraper España

```json
{
  "scraper": {
    "n_projects": 12,
    "mw_total": 456.5,
    "mwp_total": 380.0,
    "capex_eur": 350000000,
    "technologies": ["fotovoltaica", "eólica"],
    "statuses": ["AAP", "DUP", "AAC"],
    "n_spvs": 8,
    "spv_names": ["Solar Norte SPV SL"],
    "projects": [
      {"name": "Planta Solar Norte", "mw": 50, "tech": "fotovoltaica", "status": "AAC", "spv": "Solar Norte SPV SL"}
    ],
    "matched_parent": "Empresa Matriz SA",
    "match_source": "partial"
  }
}
```

#### Campos de tracking

```json
{
  "_classified_at": "2026-03-17T10:30:00Z",
  "_email_count": 47,
  "_backfill": true,
  "_merged_from": ["dominio-duplicado.com"],
  "aliases": ["nombre-viejo.com"]
}
```

### 5.3 companies.json — Formato compacto

**Raíz**:
```json
{ "r": [...], "d": {...} }
```

**Array `r[]`** — Un elemento por empresa, cada elemento es un array posicional de 9 valores:

| Posición | Nombre lógico | Tipo | Ejemplo |
|----------|--------------|------|---------|
| `r[i][0]` | `name` | string | `"Bestinver"` |
| `r[i][1]` | `domain` | string | `"bestinver.es"` |
| `r[i][2]` | `sectors` | string | `"Inversion / Financiero"` |
| `r[i][3]` | `nContacts` | int | `11` |
| `r[i][4]` | `interactions` | int | `8224` |
| `r[i][5]` | `relType` | string | `"Inversión"` |
| `r[i][6]` | `firstDate` | string ISO | `"2021-01-11"` |
| `r[i][7]` | `lastDate` | string ISO | `"2026-01-12"` |
| `r[i][8]` | `employeeSources` | string CSV | `"javier_ruiz,miguel_solana"` |

**Dict `d{}`** — Indexado por posición como string (`"0"`, `"1"`, ...):

```
d["i"] = [
  det[0],  // contacts (array de arrays de 7 posiciones)
  det[1],  // timeline (array de arrays de 3 posiciones)
  det[2],  // context (string)
  det[3],  // sources (array de arrays [empId, count])
  det[4],  // subjects (array de strings)
  det[5],  // enrichment (objeto)
  det[6],  // datedSubjects (array de arrays [date, subject, extract])
]
```

**Contactos compactos** `det[0]` — cada contacto es array de 7 posiciones:

| Pos | Campo | Ejemplo |
|-----|-------|---------|
| `[0]` | `name` (local email) | `"john.smith"` |
| `[1]` | `role` | `"Director de Inversiones"` |
| `[2]` | `email` | `"john.smith@bestinver.es"` |
| `[3]` | `nombre` | `"John"` |
| `[4]` | `apellido` | `"Smith"` |
| `[5]` | `linkedinUrl` | `""` o URL |
| `[6]` | `photoUrl` | `""` o URL |

**Timeline compacto** `det[1]` — cada entrada es array de 3 posiciones:

| Pos | Campo | Ejemplo |
|-----|-------|---------|
| `[0]` | `quarter` | `"Q1 2024"` |
| `[1]` | `emails` | `45` |
| `[2]` | `summary` | `"Discusión sobre refinanciación..."` |

**Sources compacto** `det[3]` — array de arrays `[empId, count]`:
```json
[["javier_ruiz", 54], ["miguel_solana", 5222]]
```

**DatedSubjects compacto** `det[6]` — array de arrays `[date, subject, extract]`:
```json
[["2026-02-10", "RE: Proyecto Sol", "Hola Salva, adjunto..."]]
```

### 5.4 Tabla comparativa de diferencias

| Aspecto | companies_full.json | companies.json |
|---------|---------------------|---------------|
| Raíz | `{companies: {domain: {...}}}` | `{r: [...], d: {}}` |
| Indexación | Por dominio (string key) | Por posición numérica |
| Contactos | Array de dicts con claves | Array posicional de 7 valores |
| Timeline | `[{quarter, emails}]` sin summary | `[quarter, emails, summary]` con summary |
| Sources | Dict `{empId: count}` | Array `[[empId, count], ...]` |
| Snippets body | Presentes | Ausentes (no necesarios en frontend) |
| Enrichment | Completo | Completo (idéntico) |
| Lectura por | Scripts Python | Frontend React (fetch) |

---

## 6. Parsing en el Frontend (data.ts)

### 6.1 loadCompaniesData()

```typescript
let cachedRawData: any = null;

export async function loadCompaniesData(): Promise<any> {
  if (cachedRawData) return cachedRawData;  // singleton
  const res = await fetch('/companies.json');
  if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
  cachedRawData = await res.json();
  return cachedRawData;
}
```

Se llama en `App.tsx` dentro de `useEffect`:
```typescript
useEffect(() => {
  loadCompaniesData().then(rawData => {
    setAllCompanies(parseCompanies(rawData));
    setIsLoadingCompanies(false);
  });
}, []);
```

### 6.2 parseCompanies(rawData) — Transformación principal

Itera el array `rawData.r` y para cada empresa:

**1. Status temporal** (basado en `lastDate`):
```typescript
const monthsAgo = Math.max(0, (REF_DATE - new Date(r[7])) / (1000 * 60 * 60 * 24 * 30));
const status = monthsAgo <= 6 ? "active" : monthsAgo <= 18 ? "dormant" : "lost";
```

**2. Score compuesto** (0–80 aprox.):
```typescript
volScore  = Math.min(35, Math.round(Math.log(interactions + 1) / Math.log(maxInteractions) * 35));
recScore  = Math.max(0, Math.round(30 - monthsAgo * 1.5));
netScore  = Math.min(15, nContacts * 3);
groupScore = GROUP_WEIGHTS[role] ?? 2;  // Originación=20, Inversión=18, Services=8, otros=2
score = volScore + recScore + netScore + groupScore;
```

**3. Taxonomía v2 vs legacy**:
```typescript
if (enrichment._tv >= 2) {
  // v2: usa los campos modernos directamente
  role = enrichment.role || "No relevante";
  segment = enrichment.seg || "";
  companyType = enrichment.tp2 || "";
  activities = enrichment.act || [];
  technologies = enrichment.tech || [];
  geography = enrichment.geo || [];
} else {
  // legacy: mapea grp/tp al sistema nuevo
  role = mapLegacyGroup(enrichment.grp || "Other");
  segment = inferSegment(enrichment.grp, enrichment.tp);
  companyType = enrichment.tp || "";
}
```

**4. Opportunity match** (cruce con Airtable pipeline):
```typescript
// Normaliza nombre: sin acentos, lowercase, trim
// Busca en oppByName (Map cargado desde opportunities.json)
// Coincidencia exacta primero, luego parcial (contains)
const opportunity = findOpportunity(r[0]);
```

### 6.3 qualityScore (0–100) — Fórmula completa

Mide la completitud y fiabilidad de los datos de una empresa:

| Condición | Puntos |
|-----------|--------|
| `enrichment._tv >= 2` Y `role != "No relevante"` | +25 |
| `enrichment._tv >= 2` Y `role == "No relevante"` | +15 |
| 2 o más contactos con rol identificado (≠ `"No identificado"`) | +20 |
| Exactamente 1 contacto con rol identificado | +10 |
| 3 o más trimestres con summary (longitud > 5 chars) | +15 |
| 1–2 trimestres con summary | +8 |
| `context.length >= 100` chars | +15 |
| `context.length >= 30` chars | +8 |
| 5 o más subjects | +10 |
| 2–4 subjects | +5 |
| `scraper.n_projects > 0` | +10 |
| `marketRoles.length > 0` | +10 |
| 3 o más contactos totales | +5 |
| 2 contactos totales | +3 |

**Etiquetas**: `"alta"` (≥75), `"media"` (≥45), `"baja"` (<45)

### 6.4 Objeto Company resultante — Todos los campos

```typescript
{
  // Identidad
  idx: number,               // posición en array (usado como key de productMatches)
  name: string,              // nombre empresa
  domain: string,            // dominio (PK)

  // Métricas de actividad
  nContacts: number,
  interactions: number,      // total emails históricos
  firstDate: string,         // ISO date
  lastDate: string,          // ISO date
  monthsAgo: number,         // meses desde última interacción
  status: "active"|"dormant"|"lost",
  employees: string[],       // IDs de empleados que interactuaron

  // Scoring
  score: number,             // score compuesto (0–80 aprox.)
  volScore: number,          // componente volumen (0–35)
  recScore: number,          // componente recencia (0–30)
  netScore: number,          // componente red/contactos (0–15)
  groupScore: number,        // componente por rol (0–20)
  qualityScore: number,      // calidad de datos (0–100)
  qualityLabel: "alta"|"media"|"baja",

  // Datos de detalle (del dict d[i])
  detail: {
    contacts: [{name, role, email, nombre, apellido, linkedinUrl, photoUrl}],
    timeline: [{quarter, emails, summary}],
    context: string,
    sources: [{employee, interactions}],
    subjects: string[],
    enrichment: object|null,
    datedSubjects: [{date, subject, extract}],
  } | null,

  // Taxonomía v2
  role: string,              // "Originación"|"Inversión"|"Services"|"No relevante"
  group: string,             // alias de role (backward compat)
  segment: string,           // "Project Finance"|"Corporate Finance"|""
  companyType: string,       // tp2
  activities: string[],      // act[]
  technologies: string[],    // tech[]
  geography: string[],       // geo[]
  assetPhase: string,        // fase_activo
  commercialPhase: string,   // fc
  marketRoles: string[],     // mr[]
  productosIA: [{p, c}],     // pp[] (productos potenciales con confianza)
  senales: string[],         // sc[] (señales clave)

  // Enriquecimiento de Originación
  employeeCount: number|null,
  estimatedRevenue: number|null,
  businessLines: string[],
  projectScale: string|null,
  knownPipelineMw: number|null,
  websiteUrl: string|null,
  websiteDescription: string|null,

  // Enriquecimiento de Inversión
  investorTypeWeb: string|null,
  investorFocus: string[],
  aumRange: string|null,
  renewableExperience: string|null,
  investorGeoFocus: string[],
  notableRenewableDeals: string[],
  sentiment: string|null,    // "muy_interesado"|"interesado"|"tibio"|"solo_info"|"no_interesado"
  investorPhase: string|null,
  ticketSize: string|null,
  assetTypes: string[],
  investmentCriteria: string|null,
  nextAction: string|null,
  dealsMentioned: string[],
  investorSubtype: string|null,

  // Datos de Airtable (sync_investor_feedback.py)
  atStrategicNotes: string|null,
  atTrustLevel: number|null,
  atTicketMin: number|null,
  atTicketMax: number|null,
  atWorkstreams: object[],
  atTarget: boolean,

  // Datos del scraper España
  scraperProjects: number,
  scraperMw: number,
  scraperMwp: number,
  scraperCapex: number,
  scraperTechs: string[],
  scraperStatuses: string[],
  scraperSpvCount: number,
  scraperProjectList: object[],
  scraperMatchedParent: string|null,
  scraperSpvNames: string[],

  // Pipeline Airtable
  opportunity: { stage, amount, currency, owner } | null,

  // Legacy (mantenidos para compatibilidad CSV)
  sectors: string,
  relType: string,
}
```

### 6.5 calculateProductMatches() — Algoritmo de scoring Debt/Equity

Para cada empresa, calcula un score por cada producto (`Debt`, `Equity`):

**Si la empresa tiene `productosIA` (clasificación Gemini)**:
- `"alta"` → score 90
- `"media"` → score 60
- `"baja"` → score 30
- Se mapean nombres: `"prestamo construccion"/"refinanciacion"` → `Debt`, `"colocacion inversores"/"advisory / m&a"` → `Equity`

**Si no tiene `productosIA`** (scoring por reglas):

| Componente | Máx | Criterio |
|-----------|-----|---------|
| Keywords alta en context+subjects | 10/kw | Hasta 40 pts máx |
| Keywords media | 4/kw | Incluido en 40 máx |
| Keywords baja | 1/kw | Incluido en 40 máx |
| Market role match (`dealRoles`) | +25 | Coincide con `Borrower`/`Debt Investor` o `Equity Investor`/`Seller (M&A)` |
| Role/group bonus | +10 | `role="Originación"` para Debt, `role="Inversión"` para Equity |
| Contact role match | +5/contacto | Hasta 15 pts máx |
| Business line bonus | +5/línea | Hasta 15 pts máx |
| Pipeline MW bonus | +3/+7/+10 | `>0`/`≥100`/`≥500` MW |
| Actividad reciente | +5/+10 | `monthsAgo≤12 & interactions>50` / `monthsAgo≤6 & interactions>100` |

Score final = suma de componentes, máximo 100. Solo se considera un match si `score >= 15`.

### 6.6 campaignPriorityScore() — Score de prioridad para campañas

Score 0–100 para priorizar empresas en campañas outbound:

| Componente | Máx | Criterio |
|-----------|-----|---------|
| `midMarket` | 30 | Empresas 20–500 empleados → 30 pts; utilities grandes → 3 pts |
| `utilityScale` | 30 | Escala `Utility-scale` (15) + MW totales (hasta 10) + business lines (hasta 8) |
| `contact` | 25 | CEO/DG (15) o CFO/DF (12) + bonus por múltiples decision-makers |
| `dataQuality` | 15 | `qualityScore * 0.15` |

Tier: `"Alta"` (≥70), `"Media"` (≥45), `"Baja"` (<45)

---

## 7. Sistema de Overrides y Empresas Ocultas

### 7.1 Claves de localStorage

| Clave | Tipo | Descripción |
|-------|------|-------------|
| `alter5_enrichment_overrides` | `{domain: override}` | Overrides de taxonomía editados manualmente |
| `alter5_hidden_companies` | `string[]` | Dominios ocultos por el usuario |
| `alter5_company_data` | `{domain: data}` | Datos manuales (contactos, notas, país, empleados) |

### 7.2 Enrichment overrides — saveEnrichmentOverride()

```typescript
function saveEnrichmentOverride(domain: string, overrides: {
  role?: string,   // "Originación" | "Inversión" | "Services" | "No relevante"
  seg?: string,    // "Project Finance" | "Corporate Finance"
  tp2?: string,    // tipo v2
  act?: string[],  // actividades
  tech?: string[], // tecnologías
  geo?: string[],  // geografías
  mr?: string[],   // market roles
  grp?: string,    // legacy group (backward compat)
  tp?: string,     // legacy type (backward compat)
}) {
  const all = getAllEnrichmentOverrides();
  all[domain] = { ...all[domain], ...overrides, updatedAt: new Date().toISOString() };
  localStorage.setItem('alter5_enrichment_overrides', JSON.stringify(all));
}
```

### 7.3 Cómo se aplican los overrides en App.tsx

En el `useMemo` de `companies`, tras filtrar ocultas y bloqueadas, se aplican overrides con esta **precedencia** (de mayor a menor prioridad):

1. **Override manual del usuario** (localStorage)
2. **Auto-aplicado desde Airtable Verified-Companies** (si status=`Verified`/`Edited`, o `Pending Review` + `mismatch=true`)
3. **Datos parseados de companies.json** (resultado de Gemini)

```typescript
const companies = useMemo(() => {
  return allCompanies
    .filter(c => !hiddenCompanies.includes(c.domain))   // excluye ocultas
    .filter(c => !blockedDomains.has(c.domain))          // excluye blocklist
    .map(c => {
      const ov = enrichmentOverrides[c.domain];
      if (!ov) return c;
      const role = (ov.role ?? ov.grp ?? c.role) || "No relevante";
      return {
        ...c,
        role,
        group: role,
        segment: ov.seg ?? c.segment,
        marketRoles: ov.mr ?? c.marketRoles,
        companyType: ov.tp2 ?? ov.tp ?? c.companyType,
        activities: ov.act ?? c.activities,
        technologies: ov.tech ?? c.technologies,
        geography: ov.geo ?? c.geography,
      };
    });
}, [allCompanies, hiddenCompanies, blockedDomains, enrichmentOverrides]);
```

### 7.4 Auto-aplicación desde Verified-Companies

Al arrancar la app (`useEffect` inicial), se descarga Verified-Companies y se auto-aplican como localStorage overrides si:
- El registro tiene `role` asignado, Y
- `status === "Verified" || status === "Edited"` (dominan siempre), O
- `status === "Pending Review" && mismatch === true` (sugerencia de cambio)

Se respeta el override manual: si el usuario ya tiene un override guardado (`updatedAt` presente), no se sobreescribe.

### 7.5 Blocklist estática

`src/data/blocklist.json` contiene dominios excluidos permanentemente (p.ej. dominios de email personal como `gmail.com`, dominios internos, etc.) y se aplica antes que los overrides.

### 7.6 Empresas ocultas

```typescript
hideCompany(domain)    // → añade a 'alter5_hidden_companies'
unhideCompany(domain)  // → elimina de la lista
isCompanyHidden(domain)
getHiddenCompanies()   // → string[]
```

Permiso para ocultar: admins pueden ocultar cualquier empresa; usuarios normales solo las que tienen en sus `employees`.

### 7.7 Datos manuales (alter5_company_data)

Estructura guardada por dominio:
```typescript
{
  [domain]: {
    contacts?: Contact[],          // contactos editados manualmente
    contactsUpdatedAt?: string,
    country?: string,              // "es" | "fr" | "uk" | ...
    employeesCount?: number,
    updatedAt: string,
  }
}
```

---

## 8. Sistema de Filtros

### 8.1 Estado en App.tsx

```typescript
// Filtros básicos (Sidebar)
const [search, setSearch] = useState("");                   // texto libre
const [activeEmployeeTab, setActiveEmployeeTab] = useState("all");  // tab de empleado
const [selEmployees, setSelEmployees] = useState([]);       // empleados sidebar
const [selGroups, setSelGroups] = useState([]);             // roles
const [selSegments, setSelSegments] = useState([]);         // segmentos
const [selTypes, setSelTypes] = useState([]);               // tipos empresa
const [selActivities, setSelActivities] = useState([]);     // actividades CF
const [selTech, setSelTech] = useState([]);                 // tecnologías
const [selStatus, setSelStatus] = useState([]);             // estado temporal
const [selProduct, setSelProduct] = useState("");           // producto (single-select)
const [selMarketRoles, setSelMarketRoles] = useState([]);   // market roles

// Filtros avanzados (panel inline)
const [selPipeline, setSelPipeline] = useState("");         // "" | "_any" | stageName
const [selSentiment, setSelSentiment] = useState([]);       // sentimiento inversor
const [selTicket, setSelTicket] = useState([]);             // rango ticket size
const [selBusinessLines, setSelBusinessLines] = useState([]);  // líneas de negocio
const [selScale, setSelScale] = useState([]);               // escala de proyecto
const [selInvestorType, setSelInvestorType] = useState([]); // tipo inversor web
const [selInvestorFocus, setSelInvestorFocus] = useState([]); // foco inversor
const [selScraperMw, setSelScraperMw] = useState([]);       // rango MW scraper
const [selScraperTech, setSelScraperTech] = useState([]);   // tech scraper

// Ordenamiento y paginación
const [sortBy, setSortBy] = useState("score");
const [sortDir, setSortDir] = useState("desc");
const [page, setPage] = useState(0);
```

### 8.2 Pipeline de filtrado — Tabla completa

**Regla global: AND entre filtros diferentes, OR dentro de cada filtro multi-select.**

| # | Filtro | Estado | Campo Company | Lógica |
|---|--------|--------|---------------|--------|
| 1 | Tab empleado | `activeEmployeeTab` | `c.employees[]` | `c.employees.includes(tab)` — solo si tab ≠ "all" |
| 2 | Búsqueda texto | `search` | `name`, `domain`, `role`, `segment`, `companyType`, `marketRoles[]` | OR entre campos; `toLowerCase().includes(query)` |
| 3 | Empleados | `selEmployees[]` | `c.employees[]` | `selEmployees.some(e => c.employees.includes(e))` — OR |
| 4 | Rol | `selGroups[]` | `c.role` | `selGroups.includes(c.role)` — OR |
| 5 | Segmento | `selSegments[]` | `c.segment` | `selSegments.includes(c.segment)` — OR |
| 6 | Tipo empresa | `selTypes[]` | `c.companyType` | `selTypes.includes(c.companyType)` — OR |
| 7 | Actividades | `selActivities[]` | `c.activities[]` | `selActivities.some(a => c.activities?.includes(a))` — OR |
| 8 | Tecnología | `selTech[]` | `c.technologies[]` | `selTech.some(t => c.technologies?.includes(t))` — OR |
| 9 | Estado temporal | `selStatus[]` | `c.status` | `selStatus.includes(c.status)` — OR |
| 10 | Market Roles | `selMarketRoles[]` | `c.marketRoles[]` | `selMarketRoles.some(mr => c.marketRoles.includes(mr))` — OR |
| 11 | Pipeline | `selPipeline` | `c.opportunity` | `"_any"` → `!!c.opportunity`; `stageName` → `c.opportunity?.stage === sel` |
| 12 | Producto | `selProduct` | via `productMatches` | `productMatches.get(c.idx).some(m => m.id === sel && m.score >= 15)` |
| 13 | Sentimiento | `selSentiment[]` | `c.sentiment` | `selSentiment.includes(c.sentiment)` — OR |
| 14 | Ticket Size | `selTicket[]` | `c.ticketSize` | Parsing numérico: `<10M`, `10-50M`, `50-100M`, `>100M` — OR |
| 15 | Línea negocio | `selBusinessLines[]` | `c.businessLines[]` | `selBusinessLines.some(bl => c.businessLines?.includes(bl))` — OR |
| 16 | Escala proyecto | `selScale[]` | `c.projectScale` | `selScale.includes(c.projectScale)` — OR |
| 17 | Tipo inversor | `selInvestorType[]` | `c.investorTypeWeb` | `selInvestorType.includes(c.investorTypeWeb)` — OR |
| 18 | Foco inversor | `selInvestorFocus[]` | `c.investorFocus[]` | `selInvestorFocus.some(f => c.investorFocus?.includes(f))` — OR |
| 19 | Escala MW | `selScraperMw[]` | `c.scraperMw` | Rangos: `>1000`, `500-1000`, `100-500`, `10-100`, `<10`, `sin_datos` — OR |
| 20 | Tech scraper | `selScraperTech[]` | `c.scraperTechs[]` | `"mixta"` si `techs.length > 1` o contiene `-`; resto por `includes` — OR |
| 21 | Cleanup sospechosas | `cleanupFilter='suspicious'` | via `isSuspiciousCompany()` | Solo en cleanup mode |
| 22 | Cleanup selección | `cleanupFilter='selected'` | `cleanupSelection` (Set) | Solo en cleanup mode |

### 8.3 Filtros de la Sidebar (visibles siempre)

**Búsqueda de texto**
- Input libre
- Busca en: `name`, `domain`, `role`, `segment`, `companyType`, `marketRoles` (join)
- Case-insensitive

**Empleado**
- Pill "Todos" + una pill por cada empleado de `employees.json`
- Multi-select: al seleccionar varios, filtra empresas donde cualquiera de ellos interactuó
- **Campo**: `c.employees.includes(empId)`

**Rol**
- Pills: Originación (ámbar), Inversión (azul), Services (gris), No relevante (rojo)
- Multi-select con conteo en tiempo real
- **Campo**: `c.role`

**Tecnología**
- Pills: Solar, Eólica, BESS, Biogás, Hidrógeno, Otra
- Multi-select
- **Campo**: `c.technologies` (array, OR)

**Estado temporal**
- Opciones: Activa (verde), Dormida (ámbar), Perdida (roja)
- Calculado de `monthsAgo`: ≤6 = activa, ≤18 = dormida, >18 = perdida
- **Campo**: `c.status`

**Producto**
- Opciones: Debt (azul), Equity (verde)
- **Single-select** — al tocar el activo lo deselecciona
- **Campo**: via `productMatches.get(c.idx)`, score mínimo 15

### 8.4 Filtros avanzados (panel inline, accesibles por botón "Filtros")

Solo se muestran si hay al menos una empresa con ese dato. Son los mismos filtros de la tabla del punto 8.2, filas 11–20.

**Ticket Size** — parsing especial:
```typescript
// Extrae números del string "10-50M€", "100M+", "<5M"
const raw = c.ticketSize.replace(/[€M\s]/g, "").toLowerCase();
const nums = raw.match(/[\d.]+/g)?.map(Number) || [];
const maxVal = Math.max(...nums);
// Rangos: <10M, 10-50M, 50-100M, >100M
```

**Escala MW scraper** — rangos:
```typescript
">1000"   → mw > 1000
"500-1000" → mw >= 500 && mw <= 1000
"100-500"  → mw >= 100 && mw < 500
"10-100"   → mw >= 10 && mw < 100
"<10"      → mw > 0 && mw < 10
"sin_datos" → mw === 0
```

**Tech scraper** — lógica especial para "mixta":
```typescript
"mixta" → scraperTechs.length > 1 || scraperTechs.some(t => t.includes("-"))
"fotovoltaica" | "eólica" → scraperTechs.some(ct => ct.includes(techId))
```

### 8.5 Ordenamiento

| Columna sort | Lógica |
|-------------|--------|
| `score` (default) | Numérico por `c.score` |
| `name` | `localeCompare` |
| `lastDate` | String ISO comparison |
| `interactions` | Numérico |
| `nContacts` | Numérico |
| `scraperMw` | Numérico por `c.scraperMw` |
| `productScore` | Numérico por `getBestProductMatch(productMatches, c.idx)?.score` |
| `monthsAgo` | Numérico (inverso = más reciente primero) |

Dirección: `"desc"` (default) o `"asc"`. Se aplica después de todos los filtros.

### 8.6 Paginación

```typescript
const PER_PAGE = 50;  // de constants.ts
const paginated = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
const totalPages = Math.ceil(filtered.length / PER_PAGE);
```

Se resetea la página a 0 cada vez que cambia cualquier filtro.

---

## 9. Tabla de Empresas (CompanyTable)

### 9.1 Columnas — Modo normal

| # | Key sort | Label | Fuente del dato | Notas |
|---|---------|-------|-----------------|-------|
| — | — | checkbox | selección masiva | — |
| — | — | quality dot | `c.qualityScore` | Verde ≥65, ámbar ≥45, rojo <45 |
| `name` | `name` | Empresa | `c.name`, `c.domain` | Con logo Clearbit, verified badge |
| — | — | Rol | `c.role` | Badge coloreado |
| — | — | Seg / Tipo | `c.segment`, `c.companyType` | Dos líneas |
| — | — | Market Role | `c.marketRoles[]` | Hasta 2 chips, truncados a 14 chars |
| `productScore` | `productScore` | Producto | via `productMatches` | Badge Debt/Equity/M&A |
| — | — | Estado | `c.status` | Dot de color |
| `interactions` | `interactions` | Emails | `c.interactions` | Número formateado |
| `nContacts` | `nContacts` | Cont. | `c.nContacts` | — |
| `employeeCount` | `employeeCount` | Empl. | `max(verified.employeeCount, c.employeeCount)` | — |
| `scraperMw` | `scraperMw` | MW | `c.scraperMw` | Naranja; `Xk` si ≥ 1000 |
| `monthsAgo` | `monthsAgo` | Ultimo | `c.lastDate` | Fecha ISO |
| `score` | `score` | Score | `c.qualityScore` | Chip con gradiente |

### 9.2 Columnas — Modo inversor

Activado cuando `role === "Inversión"` y el usuario activa la vista inversor. Columnas: Inversor, Sentiment, Fase, Subtipo, Ticket, Deals, Notas, Rechazos, Emails, Ultimo, Score.

### 9.3 Colores y estilos por valor

**Quality dot** (7×7 px):
- `qualityScore >= 65` → `#10B981` (verde)
- `qualityScore >= 45` → `#F59E0B` (ámbar)
- `qualityScore < 45` → `#EF4444` (rojo)

**Verified badge** (dot 8 px junto al nombre):
- `status="Verified"` → `#10B981` (verde)
- `status="Edited"` → `#8B5CF6` (morado)
- `status="Pending Review"` → `#F59E0B` (ámbar)

**Badge de rol**:
- `Originación` → fondo `rgba(245,158,11,0.1)`, texto `#B45309`
- `Inversión` → fondo `rgba(59,130,246,0.1)`, texto `#1D4ED8`
- `Services` → fondo `rgba(100,116,139,0.1)`, texto `#475569`
- `No relevante` → fondo `rgba(239,68,68,0.08)`, texto `#DC2626`

**Status dot** (c.status):
- `active` → `#10B981`
- `dormant` → `#F59E0B`
- `lost` → `#EF4444`

**Score chip** (34×34 px):
- `>= 80` → gradiente verde `#10B981→#059669`
- `>= 65` → gradiente azul `#3B82F6→#6366F1`
- `>= 50` → gradiente ámbar `#F59E0B→#D97706`
- `< 50` → fondo `#F1F5F9`, texto `#64748B`

### 9.4 Selección masiva y acciones

Al seleccionar empresas con el checkbox aparece una barra flotante con:
- Contador de seleccionadas
- Botón "Deseleccionar todo"
- Botón "Ocultar seleccionadas" (rojo) — llama `hideCompany(domain)` por cada una
- Botón "Nueva campaña" (morado) — abre `CampaignCreationPanel` con las empresas pre-cargadas
- Botón "Añadir a campaña" (azul) — abre `AddToCampaignModal`

### 9.5 Logo de empresa

```
https://logo.clearbit.com/{domain}
```

Si el logo falla (404), muestra un avatar con las 2 primeras letras del nombre de la empresa.

---

## 10. Ficha de Empresa (DetailPanel)

### 10.1 Hero Header

Siempre visible al abrir la ficha:

- **Logo**: `https://logo.clearbit.com/{c.domain}` (44×44 px)
- **Nombre**: `c.name` (26px, font-weight 800)
- **Enlace web**: `https://{c.domain}` ↗
- **Badges de clasificación**: `c.role`, `c.segment`, `c.companyType`, `c.projectScale`
- **Quality bar**: barra de progreso de 50px con `c.qualityScore%`
- **Activity bar**: dot de estado + label (ACTIVA/RECIENTE/DORMIDA/SIN ACTIVIDAD) + días desde última interacción + total emails + market role chips + badge scraper (`N proy | X MW`)
- **Métricas de inversión** (solo si `role=Inversión`): `c.aumRange`, `c.ticketSize`, `c.renewableExperience`, `c.sentiment`
- **Descripción truncada** (2 líneas): `c.websiteDescription || verifiedRecord?.webDescription || det.context.slice(0, 180)`

### 10.2 Tabs disponibles

| Tab ID | Label | Visible si |
|--------|-------|-----------|
| `resumen` | Resumen | Siempre |
| `timeline` | Timeline | Siempre |
| `contactos` | Contactos | Siempre |
| `proyectos` | Proyectos (N) | `c.scraperProjects > 0` |
| `feedback` | Feedback (N) | `c.role === "Inversión"` Y tiene workstreams/notas |
| `detalles` | Datos | Siempre |

### 10.3 Tab: Resumen

Secciones condicionales en este orden:

**Notas Estratégicas** (solo Inversión, si hay notas):
- `investorNotes.get(c.name)` — notas de Airtable InvestorNotes
- `c.investmentCriteria`, `c.nextAction`, `c.dealsMentioned[]`

**Perfil Inversor** (solo Inversión, si tiene datos):
- `c.investorFocus[]` — áreas de focus
- `c.investorPhase` + `c.investorSubtype`
- `c.assetTypes[]`, `c.investorGeoFocus[]`
- `c.notableRenewableDeals[]`

**Perfil de negocio** (Originación):
- `c.businessLines[]`, `c.knownPipelineMw`

**Pipeline Airtable** (si existe `c.opportunity`):
- `c.opportunity.stage`, `.amount`, `.currency`, `.owner`

**Señales comerciales IA**:
- `c.productosIA[{p, c}]` — chips con color por confianza (`alta`=verde, `media`=ámbar, `baja`=gris)
- `c.senales[]` — bullets con señales detectadas en emails

**Tecnologías**: `c.technologies[]` filtradas contra `TECHNOLOGIES`

**Contactos clave** (top 2 por prioridad):
- Ordenados por `contactPriority()`: CEO/CFO → rank 1, Financiación Estructurada → 2, M&A → 3, otros → 4, "No identificado" → 5
- Muestra: avatar/foto, nombre completo, link LinkedIn, cargo, label de prioridad

**Historial de la relación**:
- Si hay `datedSubjects`: lista cronológica (hasta 8, desc), cada uno con fecha, asunto y extracto expandible
- Si no: `det.context` como texto plano

### 10.4 Tab: Timeline

**Tabla trimestral**: columnas "Trimestre" | "Emails" | "Resumen"
- Datos: `det.timeline[]` — `{quarter, emails, summary}`

**Gráfico de barras horizontal**:
- Barra proporcional al máximo de emails del trimestre
- Últimos 3 trimestres: gradiente verde `#10B981→#059669`
- Anteriores: gradiente azul `#3B82F6→#2563EB`

**Estadísticas resumen**: total histórico + promedio trimestral

**Por buzón**: si `det.sources.length > 1`, barra por empleado con nombre y conteo de interacciones

### 10.5 Tab: Contactos

Grid de 2 columnas. Por cada contacto:
- Avatar (foto `ct.photoUrl` o inicial del nombre), 36×36 px
- Nombre completo (`ct.nombre ct.apellido` o `ct.name`)
- Link LinkedIn (`ct.linkedinUrl`) — botón "in" azul
- Cargo (`ct.role` o "Cargo desconocido")
- Label de prioridad coloreado (CEO/CFO=ámbar, Financiación Estructurada=azul, M&A=verde)
- Email (`ct.email`)

**Modo edición inline** (botón "Editar"):
- Inputs: nombre, apellido, cargo, email
- Botón "×" por contacto para eliminar
- Formulario "Añadir contacto": nombre, cargo, email
- Al guardar: `saveCompanyContacts(c.domain, editedContacts)` → localStorage

### 10.6 Tab: Proyectos

Visible solo si `c.scraperProjects > 0`.

**KPI Row** (5 celdas):
| KPI | Campo |
|-----|-------|
| Proyectos | `c.scraperProjects` |
| MW | `c.scraperMw` |
| MWp | `c.scraperMwp` |
| SPVs | `c.scraperSpvCount` |
| Capex | `c.scraperCapex / 1e6`M€ |

**Breakdown tecnologías**: barras horizontales agrupando `c.scraperProjectList` por `p.tech`:
- `fotovoltaica` → naranja `#F59E0B`
- `eólica` → azul `#3B82F6`
- combinado → morado `#8B5CF6`

**Estados de permisos**: chips con conteo de `c.scraperStatuses[]`:
- `AAP` → ámbar `#F59E0B`
- `DUP` → azul `#3B82F6`
- `AAC` → verde `#10B981`
- `DIA` → amarillo `#EAB308`

**Empresa matriz**: `c.scraperMatchedParent`

**Tabla de proyectos**: columnas Proyecto | MW | Tecnología | Estado | SPV (max 100 filas, scrollable)

**SPVs**: collapsible `<details>` con chips de `c.scraperSpvNames[]`

### 10.7 Tab: Feedback (solo Inversión)

**Notas Estratégicas**: `c.atStrategicNotes` + `investorNotes.get(c.name)`

**Workstreams** (`c.atWorkstreams[]`): tabla con columnas Deal | Status | Notas | Rechazo:
- Si hay rechazos: sección "Feedback de Rechazo" resaltada en rojo

**Perfil de Inversión**:
- Trust Level (`c.atTrustLevel/5` barra de progreso)
- Ticket: `€{c.atTicketMin/1e6}M – €{c.atTicketMax/1e6}M`
- Sentiment, Fase, Subtipo

**Criterios + Siguiente acción + Deals**: `c.investmentCriteria`, `c.nextAction`, `c.dealsMentioned[]`

### 10.8 Tab: Datos

**Sección Clasificación** (editable):

| Campo | Control | Fuente/Destino |
|-------|---------|----------------|
| Role | `<select>` | `COMPANY_ROLES` → `saveEnrichmentOverride(domain, {role})` |
| Segmento | `<select>` | `ORIGINACION_SEGMENTS` (solo si role=Originación) |
| Tipo | `<select>` | `COMPANY_TYPES_V2` según role+segment |
| Actividades | Multi-select chips | `CORPORATE_ACTIVITIES` (solo CF) |
| Tecnología | Multi-select chips | `TECHNOLOGIES` |
| Geografía | Multi-select chips | `GEOGRAPHIES` |
| Market Roles | Multi-select chips | `MARKET_ROLES` |

Al guardar llama `onEnrichmentSave(domain, {role, seg, tp2, act, tech, geo, mr})` que internamente llama `saveEnrichmentOverride()`.

**Sección Verificación**:
- Badge de estado de Verified-Companies: verde=Verified, morado=Edited, ámbar=Pending Review
- Botón "Verificar ahora":
  1. Construye prompt con clasificación actual + 15 subjects + 5 extractos de email (hasta 2000 chars)
  2. Llama `geminiProxy(prompt, 0.2, "gemini-2.5-flash", [{googleSearch:{}}])`
  3. Gemini con Google Search grounding busca la empresa en web
  4. Retorna: `webDescription`, `webSources`, clasificación sugerida, `confidence`, `mismatch`
  5. Muestra comparativa lado a lado: Actual vs Sugerido
  6. Cooldown de 30 segundos entre verificaciones
- Botones: "Aceptar sugerencia" → `saveVerification()` + `saveEnrichmentOverride()` | "Descartar"

**Product Matches**: sección con scores Debt/Equity y señales detectadas

**Datos manuales** (localStorage `alter5_company_data`):
| Campo | Control |
|-------|---------|
| Facturación anual | Texto libre |
| Número de empleados | Número |
| País | Select de `COUNTRIES` |
| Importancia | Radio: high/medium/low |
| Sitio web | Link |
| Notas | Textarea multiline |

**Botón "Ocultar empresa"**: visible solo si `canHideCompany(c, currentUser)` → llama `hideCompany(domain)`

---

## 11. Sistema de Verificación — Airtable Verified-Companies

### 11.1 Configuración de la tabla

| Parámetro | Valor |
|-----------|-------|
| Base ID | `appVu3TvSZ1E4tj0J` |
| Tabla | `Verified-Companies` |
| Table ID | `tbl1Zdil8FeljzpBa` |
| Proxy Vercel | `/api/airtable-proxy` |
| Cache TTL | 5 minutos (en memoria) |
| Auth | `VITE_AIRTABLE_PAT` (env var) |

### 11.2 Campos de la tabla Airtable

| Campo | Tipo Airtable | Descripción |
|-------|--------------|-------------|
| `Domain` | singleLineText (PK) | Dominio de la empresa |
| `Company Name` | singleLineText | Nombre |
| `Previous Classification` | singleLineText | Clasificación antes de verificar |
| `Role` | singleSelect | Sin acentos: `Originacion`, `Inversion`, `Services`, `No relevante` |
| `Segment` | singleSelect | `Project Finance`, `Corporate Finance` |
| `Type` | singleSelect | Tipo empresa (sin acentos) |
| `Activities` | multipleSelect | Actividades CF |
| `Technologies` | multipleSelect | Sin acentos: `Eolica`, `Biogas`, `Hidrogeno`, `Solar`... |
| `Geography` | multipleSelect | Sin acentos: `Espana`, `Portugal`... |
| `Market Roles` | multipleSelect | `Borrower`, `Debt Investor`... |
| `Web Description` | longText | Descripción de la web real (Gemini + Google Search) |
| `Web Sources` | longText | URLs de fuentes encontradas |
| `Status` | singleSelect | `Pending Review`, `Verified`, `Edited`, `Rejected` |
| `Verified By` | singleLineText | `"agent"` (automático) o `"manual"` |
| `Verified At` | dateTime | ISO timestamp |
| `Notes` | longText | Notas adicionales |
| `Website` | url | URL de la web oficial |
| `Mismatch` | checkbox | Si hay discrepancia con la clasificación actual |
| `Confidence` | singleSelect | `alta`, `media`, `baja` |
| `Employee Count` | number | Número de empleados encontrado en web |
| `Employee Count Source` | singleLineText | Fuente del dato de empleados |
| `Estimated Revenue EUR` | currency | Revenue estimado |
| `Revenue Source` | singleLineText | Fuente del dato de revenue |

### 11.3 fetchAllVerified() — Llamada GET

```typescript
// GET paginado (pageSize=100) hasta que no haya offset
do {
  const data = await airtableProxy({
    table: "Verified-Companies",
    method: 'GET',
    pageSize: 100,
    ...(offset ? { offset } : {}),
  });
  allRecords.push(...data.records);
  offset = data.offset || "";
} while (offset);

// Construye Map<domain, VerifiedRecord>
const map = new Map();
for (const r of allRecords) {
  const domain = r.fields.Domain;
  if (!domain) continue;
  map.set(domain, { id: r.id, domain, role: r.fields.Role, ... });
}
```

**URL Airtable real** (via proxy):
```
GET https://api.airtable.com/v0/appVu3TvSZ1E4tj0J/Verified-Companies
    ?pageSize=100
    &offset={offset}        // si hay paginación
Authorization: Bearer {AIRTABLE_PAT}
```

### 11.4 saveVerification() — Llamadas POST y PATCH

```typescript
// Comprueba si ya existe
const existing = await getVerification(domain);

if (existing) {
  // PATCH: actualizar registro existente
  await airtableProxy({
    table: "Verified-Companies",
    method: 'PATCH',
    recordId: existing.id,   // "recXXXXXXXXXX"
    fields: { Domain, "Company Name", Role, Segment, Type, ... }
  });
} else {
  // POST: crear nuevo registro
  await airtableProxy({
    table: "Verified-Companies",
    method: 'POST',
    fields: { Domain, "Company Name", Role, Segment, Type, ... }
  });
}

// Invalida cache
verifiedCache = null;
```

**URL Airtable real PATCH**:
```
PATCH https://api.airtable.com/v0/appVu3TvSZ1E4tj0J/Verified-Companies/{recordId}
Content-Type: application/json
Authorization: Bearer {AIRTABLE_PAT}

{ "fields": { "Role": "Originacion", "Status": "Verified", "Verified At": "2026-03-21T..." } }
```

**URL Airtable real POST**:
```
POST https://api.airtable.com/v0/appVu3TvSZ1E4tj0J/Verified-Companies
Content-Type: application/json
Authorization: Bearer {AIRTABLE_PAT}

{ "fields": { "Domain": "empresa.com", "Role": "Originacion", ... } }
```

### 11.5 Problema de acentos en singleSelect

Airtable singleSelect no permite acentos en las opciones. Los mapas de conversión:

```typescript
// Airtable (sin acentos) → Frontend (con acentos)
ROLE_ACCENT_MAP:  { "Originacion" → "Originación", "Inversion" → "Inversión" }
TYPE_ACCENT_MAP:  { "Asesor tecnico" → "Asesor técnico", "Ingenieria" → "Ingeniería",
                    "Asociacion / Institucion" → "Asociación / Institución" }
TECH_ACCENT_MAP:  { "Eolica" → "Eólica", "Biogas" → "Biogás", "Hidrogeno" → "Hidrógeno" }
GEO_ACCENT_MAP:   { "Espana" → "España" }
```

Al **leer** de Airtable → aplicar mapas para restaurar acentos.
Al **escribir** a Airtable → no aplicar mapas (guardar sin acentos).

### 11.6 verifiedToEnrichmentOverride()

Convierte un registro de Verified-Companies al formato de `saveEnrichmentOverride()`:

```typescript
function verifiedToEnrichmentOverride(verified) {
  return {
    role: mapAccent(verified.role, ROLE_ACCENT_MAP),    // "Originacion" → "Originación"
    seg: verified.segment,                               // ya no tiene acentos
    tp2: mapAccent(verified.type, TYPE_ACCENT_MAP),
    tech: mapAccentArray(verified.technologies, TECH_ACCENT_MAP),
    geo: mapAccentArray(verified.geography, GEO_ACCENT_MAP),
    mr: verified.marketRoles,
  };
}
```

### 11.7 Flujo completo de verificación manual (desde la UI)

1. Usuario abre la ficha de una empresa, tab "Datos", sección "Verificación".
2. Pulsa "Verificar ahora".
3. App construye el prompt:
   ```
   Empresa: {name} ({domain})
   Clasificación actual: role={role}, segment={segment}, type={companyType}
   Contexto emails: {subjects[:15]} + {extractos[:5]}

   Busca en Google información sobre esta empresa y determina:
   1. Descripción real de su actividad
   2. Si la clasificación actual es correcta
   3. Role/Segment/Type correcto según datos reales
   4. Confianza: alta/media/baja
   ```
4. Llama a Gemini 2.5 Flash con `tools=[{google_search:{}}]` (Google Search grounding activado).
5. Gemini busca la empresa en Google y retorna JSON con `webDescription`, `webSources`, clasificación sugerida, `mismatch` (boolean), `confidence`.
6. UI muestra comparativa. Si el usuario acepta:
   - `saveVerification(domain, {...})` → POST/PATCH a Airtable
   - `saveEnrichmentOverride(domain, {...})` → localStorage
   - `onVerifiedUpdate()` → refresca `verifiedCompanies` en App.tsx

---

## 12. Referencia Completa de Llamadas a Airtable

### 12.1 Configuración global

El sistema usa **doble capa de seguridad** para las llamadas a Airtable:

1. El **frontend** (React) nunca habla directamente con Airtable. Hace POST a `/api/airtable-proxy` con un shared secret no-sensible (`VITE_CAMPAIGN_PROXY_SECRET`).
2. El **proxy Vercel** (`api/airtable-proxy.js`) valida el shared secret y reenvía la petición a `api.airtable.com` inyectando el PAT real que solo existe en el servidor.

```typescript
// src/utils/proxyClient.ts — lado cliente
const PROXY_SECRET = import.meta.env.VITE_CAMPAIGN_PROXY_SECRET; // shared key no-sensible

await fetch('/api/airtable-proxy', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-proxy-secret': PROXY_SECRET,
  },
  body: JSON.stringify({ table, method, fields, ... }),
});

// api/airtable-proxy.js — lado servidor (Vercel)
const token = process.env.AIRTABLE_PAT;   // PAT real, nunca expuesto al cliente
const BASE_ID = 'appVu3TvSZ1E4tj0J';
// Valida x-proxy-secret === process.env.CAMPAIGN_PROXY_SECRET
// Construye URL: https://api.airtable.com/v0/{BASE_ID}/{table}
// Añade: Authorization: Bearer {token}
```

**Variables de entorno en Vercel** (servidor):
- `AIRTABLE_PAT` — Personal Access Token de Airtable
- `CAMPAIGN_PROXY_SECRET` — shared secret para validar el proxy

**Variable de entorno en Vite** (cliente, no sensible):
- `VITE_CAMPAIGN_PROXY_SECRET` — la misma clave compartida

**Scopes necesarios del token PAT**:
- `data.records:read`
- `data.records:write`
- `schema.bases:read`

### 12.2 Tabla: Verified-Companies

| Operación | Método | Cuándo | Campos |
|-----------|--------|--------|--------|
| Listar todas | GET paginado | Al arrancar la app; cada 5 min (cache) | Todos los campos |
| Crear verificación | POST | Usuario confirma verificación manual | Domain, Company Name, Role, Segment, Type, Activities, Technologies, Geography, Market Roles, Web Description, Web Sources, Status, Verified By, Notes, Mismatch, Verified At |
| Actualizar verificación | PATCH | Usuario modifica verificación existente | Mismos campos que POST + record ID |

### 12.3 Tabla: Opportunities

Usada para cruzar empresas del CRM con deals del pipeline.

```typescript
// src/utils/airtable.ts
// GET con filtro de fórmula para traer solo deals activos de tipo Transaction
GET https://api.airtable.com/v0/{BASE_ID}/Opportunities
  ?filterByFormula=AND({Type}="Transaction",{Active}=TRUE())
  &pageSize=100
```

Campos leídos: `Company`, `Stage`, `Amount`, `Currency`, `Owner`, `Close Date`

El resultado se normaliza en `opportunities.json` (snapshot estático) para evitar hacer la llamada en cada render. Se actualiza con `python scripts/sync_airtable_opportunities.py`.

### 12.4 Tabla: BETA-Prospects

Usada en la vista de Prospects (Kanban). Desde la vista Empresas:
- Al hacer clic en "Mover a Prospects" desde el detail panel se hace POST a `BETA-Prospects`
- Los campos se documentan en la guía técnica de Prospects

### 12.5 Tabla: CampaignTargets

Usada cuando el usuario añade empresas a una campaña desde la selección masiva.

```typescript
// POST bulk desde AddToCampaignModal
POST https://api.airtable.com/v0/{BASE_ID}/CampaignTargets
{
  "records": [
    {
      "fields": {
        "Domain": "empresa.com",
        "CompanyName": "Empresa SA",
        "Status": "pending",
        "CampaignRef": "Bridge_Q1_W2",
        "Segment": "Project Finance",
        "CompanyType": "Developer",
        "Technologies": "Solar",
        "ReviewedBy": "salvador_carrillo",
        "ReviewedAt": "2026-03-21T10:00:00Z"
      }
    }
  ]
}
```

### 12.6 Tabla: Cerebro-Knowledge

Usada por el componente `CerebroSearch` (búsqueda AI interna). No está directamente relacionada con la vista Empresas pero usa la misma base.

```typescript
// GET para buscar en el conocimiento del Cerebro
GET https://api.airtable.com/v0/{BASE_ID}/Cerebro-Knowledge
  ?filterByFormula=SEARCH("{query}", {Keywords})
  &pageSize=20
```

### 12.7 Resumen de tablas Airtable

| Tabla | Table ID | Uso en Empresas |
|-------|----------|-----------------|
| `Verified-Companies` | `tbl1Zdil8FeljzpBa` | Clasificaciones verificadas (lectura + escritura) |
| `Opportunities` | — | Cruce con pipeline (lectura, vía snapshot JSON) |
| `BETA-Prospects` | `tblAAc8XXwo8rNHR1` | Mover empresa a prospects (escritura) |
| `CampaignTargets` | — | Añadir empresas a campaña (escritura) |
| `Cerebro-Knowledge` | `tbliZ7zNci5TUCAhj` | Base de conocimiento AI (lectura + escritura) |

---

## Apéndice A — Variables de Entorno Necesarias

### Frontend / Vercel (cliente + servidor)

| Variable | Ámbito | Descripción |
|----------|--------|-------------|
| `VITE_CAMPAIGN_PROXY_SECRET` | Vite (cliente) | Shared secret no-sensible para autenticar con el proxy. Se expone al bundle. |
| `AIRTABLE_PAT` | Vercel servidor | Personal Access Token de Airtable. **Nunca** se expone al cliente. |
| `CAMPAIGN_PROXY_SECRET` | Vercel servidor | Misma clave que `VITE_CAMPAIGN_PROXY_SECRET`, validada en el proxy. |
| `GEMINI_API_KEY` | Vercel servidor | Clave API de Google Gemini (usada por `/api/gemini-proxy`). |
| `ALLOWED_ORIGIN` | Vercel servidor | CORS origin permitido (default: `https://alter5-bi.vercel.app`). |

### Scripts Python / GitHub Actions

| Variable | Descripción |
|----------|-------------|
| `GEMINI_API_KEY` | Clave API de Google Gemini para clasificación y verificación |
| `PERPLEXITY_API_KEY` | Clave API de Perplexity Sonar para enriquecimiento de contactos |
| `APOLLO_API_KEY` | Clave API de Apollo.io para LinkedIn y cargos de contactos |
| `AIRTABLE_PAT` | Token de Airtable para leer Verified-Companies y escribir resultados |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON de credenciales OAuth para acceder a Google Sheets (GitHub Secret) |

## Apéndice B — Archivos Clave del Proyecto

| Archivo | Descripción |
|---------|-------------|
| `src/data/companies.json` | Datos compactos para React (8MB, trackeado en git) |
| `src/data/companies_full.json` | Datos completos para scripts Python (15MB, trackeado en git) |
| `src/data/employees.json` | 8 empleados con contadores de interacciones |
| `src/data/opportunities.json` | Snapshot estático de Airtable Opportunities |
| `src/data/scraper_projects.json` | 5.652 proyectos renovables España |
| `src/data/spv_parent_mapping.json` | 2.531 mapeos SPV→empresa matriz |
| `src/data/blocklist.json` | Dominios excluidos permanentemente |
| `src/utils/data.ts` | Parsers, qualityScore, productMatches, campaignScore |
| `src/utils/constants.ts` | Toda la taxonomía (roles, tipos, techs, geos, productos...) |
| `src/utils/companyData.ts` | localStorage (overrides, ocultas, datos manuales) |
| `src/utils/airtableVerified.ts` | Cliente Airtable Verified-Companies |
| `src/App.tsx` | Estado global, filtros, pipeline de filtrado |
| `src/components/CompanyTable.tsx` | Tabla de empresas |
| `src/components/DetailPanel.tsx` | Ficha de empresa (6 tabs) |
| `src/components/Sidebar.jsx` | Filtros laterales básicos |
| `scripts/process_sheet_emails.py` | Pipeline Gmail→JSON (ejecutado por CI diario) |
| `scripts/backfill_classifications.py` | Re-clasificación masiva sin emails nuevos |
| `scripts/verify_classifications.py` | Verificación por agente Gemini+Google Search |
| `scripts/gas/scanMailboxes.gs` | Google Apps Script para escanear Gmail |
| `.github/workflows/process-emails.yml` | CI/CD diario + dispatch manual |
| `api/campaign-proxy.js` | Proxy Vercel para llamadas a Airtable |

## Apéndice C — Deduplicación de Empresas

El CRM tiene un sistema de deduplicación manual mediante `scripts/merge_duplicates.py`. Define en `MERGE_RULES` una lista de tuplas `(target_domain, [dominios_a_absorber])`.

El merge:
1. Combina `sources`, `contacts` (dedup por email), `timeline`, `subjects`, `enrichment`
2. Añade campos de tracking: `enrichment._merged_from[]`, `enrichment.aliases[]`
3. Elimina los registros absorbidos del dict

A marzo 2026 se han eliminado 131 duplicados, reduciendo el CRM de 5.392 a 5.261 empresas.

---

*Documento generado el 21 de marzo de 2026. Refleja el estado técnico actual del sistema.*
