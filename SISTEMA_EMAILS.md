# Descriptivo del Sistema de Incorporacion de Empresas via Email

> Documento de referencia que describe en detalle como funciona el pipeline automatico
> que lee buzones de correo del equipo Alter5 y alimenta la base de datos de empresas del CRM.

---

## 1. VISION GENERAL

El sistema convierte **emails recibidos por el equipo comercial** en **registros de empresas estructurados y clasificados** en el dashboard de BI. Opera de forma completamente automatica, sin intervencion manual, y se ejecuta diariamente.

```
Gmail (8 buzones)
    → Google Apps Script (escaneo)
    → Google Sheet (almacen intermedio)
    → GitHub Actions (orquestacion)
    → Python + Gemini AI (procesamiento + clasificacion)
    → JSON files (base de datos)
    → Vercel (deploy automatico)
```

---

## 2. LOS 4 COMPONENTES DEL SISTEMA

### 2.1 — Google Apps Script: El Escaner de Buzones

**Archivo**: `scripts/gas/scanMailboxes.gs`
**Donde corre**: Google Apps Script (cloud de Google)
**Trigger**: Cron diario configurado entre 03:00-04:00 UTC

#### Que hace:
Lee los emails nuevos de **8 buzones del equipo** desde la ultima ejecucion y los escribe en una Google Sheet.

#### Buzones escaneados:
Los buzones se configuran en una pestana `employees` de la Google Sheet (o en fallback hardcodeado):
- Salvador Carrillo, Leticia Menendez, Javier Ruiz, Miguel Solana, Carlos Almodovar, Gonzalo de Gracia, Rafael Nevado
- Historico de Guillermo Souto (ya no esta en la empresa, su buzon no se escanea pero sus datos permanecen)

#### Autenticacion:
- Usa una **Service Account de Google** con delegacion de dominio (Google Workspace)
- La service account se autentica via OAuth2 (libreria `apps-script-oauth2`) e **impersona cada usuario** para leer su Gmail
- Script Properties necesarias: `SA_EMAIL`, `SA_PRIVATE_KEY`, `SHEET_ID`, `GITHUB_PAT`, `GITHUB_REPO`

#### Proceso de escaneo (por cada empleado):

1. **Calcula fecha desde**: Lee `lastScanDate_{empleado}` de la pestana `config` de la Sheet. Si nunca se ha escaneado, parte desde `2020/01/01`
2. **Omite empleados recientes**: Si se escaneo hace menos de 1 hora, lo salta
3. **Lista todos los message IDs**: Consulta Gmail API con query `after:{fecha} -from:me` y pagina con `maxResults=500` recogiendo TODOS los IDs
4. **Fetch en 2 pases por lotes de 50 mensajes**:
   - **Paso 1 (metadata)**: Usa Gmail Batch API con `format=metadata` (rapido, ligero). Extrae headers (From, Date, Subject). Filtra:
     - Descarta threads ya existentes en la Sheet (deduplicacion por `thread_id`)
     - Descarta emails de dominios personales (gmail.com, hotmail.com, etc.)
     - Descarta emails del propio dominio del empleado (alter-5.com)
     - Descarta emails sin campo From
   - **Paso 2 (body)**: Solo para los emails aceptados, hace GET individual con `format=full`. Extrae el cuerpo del email:
     - Busca primero `text/plain` (recursivo en multipart)
     - Si no hay, usa `text/html` y le quita tags HTML
     - Limpia firmas, disclaimers, "Sent from my iPhone", etc.
     - Trunca a **2000 caracteres**
     - Si falla la extraccion del body, usa el `snippet` (300 chars) como fallback
5. **Escribe en Google Sheet**: Cada email aceptado se escribe como una fila en la pestana `raw_emails` con status `pending`

#### Columnas de la fila escrita:
| Col | Campo | Ejemplo |
|-----|-------|---------|
| A | status | `pending` |
| B | employee_id | `salvador_carrillo` |
| C | date | `2026-03-17` |
| D | from_email | `juan.perez@acciona.com` |
| E | from_name | `Juan Perez` |
| F | from_domain | `acciona.com` |
| G | subject | `Re: Term Sheet Proyecto Solar 50MW` |
| H | body_snippet | `Hola Salvador, adjunto el term sheet...` (300 chars) |
| I | thread_id | `18e2a3b4c5d6e7f8` |
| J | body_text | `Hola Salvador, adjunto el term sheet revisado...` (2000 chars) |

#### Gestion del tiempo:
- Limite de 25 minutos (GAS permite 30 max)
- Si se agota el tiempo a mitad de un empleado, **no actualiza su `lastScanDate`** y programa una continuacion automatica en 2 minutos via trigger
- La deduplicacion por `thread_id` evita duplicados en continuaciones

#### Trigger de GitHub Actions:
- Al terminar TODOS los empleados, si hay emails nuevos, dispara el workflow de GitHub Actions via API (`workflow_dispatch`)

---

### 2.2 — Google Sheet: El Almacen Intermedio

**ID**: Configurado en `GOOGLE_SHEET_ID`
**Nombre**: `alter5-bi-pipeline`

#### Pestanas:
| Pestana | Funcion |
|---------|---------|
| `raw_emails` | Almacen de todos los emails escaneados. Cada fila es un email con status |
| `config` | Key-value store. Guarda `lastScanDate_{empleado}` para saber desde cuando escanear |
| `employees` | Lista de empleados activos (employee_id, email, configKey, active) |
| `ai_classifications` | Log historico de las clasificaciones hechas por Gemini (fecha, dominio, grupo, tipo, fuente) |

#### Ciclo de vida de una fila en `raw_emails`:
```
pending  →  done      (procesado con exito, incorporado al JSON)
pending  →  ignored   (filtrado como no relevante por Gemini)
done     →  [se puede re-leer con --reprocess]
```

---

### 2.3 — GitHub Actions: El Orquestador

**Archivo**: `.github/workflows/process-emails.yml`
**Trigger**: `workflow_dispatch` (disparado por el Apps Script cuando hay emails nuevos)

#### Que hace:
1. Checkout del repo (necesita `companies_full.json` existente para merge incremental)
2. Setup Python 3.11 + instala dependencias
3. Ejecuta `process_sheet_emails.py` (opcionalmente con `--reprocess`)
4. Ejecuta `sync_airtable_opportunities.py` (sincroniza pipeline de Airtable)
5. Hace `git add` de los 4 archivos de datos + `git commit` + `git push`
6. Vercel despliega automaticamente desde main

#### Secrets necesarios:
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Service account para acceder a la Sheet
- `GEMINI_API_KEY` — Para clasificacion con IA
- `GOOGLE_SHEET_ID` — ID de la Google Sheet
- `AIRTABLE_PAT` — Para sincronizar oportunidades

---

### 2.4 — Python Script: El Cerebro del Pipeline

**Archivo**: `scripts/process_sheet_emails.py`
**Modulo auxiliar**: `scripts/import_mailbox.py` (funciones `merge_company`, `export_to_compact`, `get_data_paths`)

#### Pipeline en 7 pasos:

**Paso 1 — Conectar con Google Sheet**
- Autentica con la service account
- Abre la Sheet por ID

**Paso 2 — Leer emails pendientes**
- Lee todas las filas de `raw_emails` con status `pending`
- En modo `--reprocess`, tambien lee las filas con status `done`
- Retorna lista de dicts con todos los campos + `_sheet_row` (indice para marcar despues)

**Paso 2b — Filtro de relevancia con IA**
- Envia los emails a Gemini en **lotes de 20**
- Prompt describe que es Alter5 y que es relevante vs no relevante
- Cada email se presenta como: `from | subject | content (body o snippet)`
- Gemini devuelve `{"relevant": [indices], "ignored": [indices]}`
- Los emails ignorados se marcan como `ignored` en la Sheet
- **Se salta en modo reprocess** (ya fueron filtrados antes)

**Paso 3 — Agrupar por empresa**
- Agrupa los emails relevantes por **dominio del remitente** (`from_domain`)
- Descarta dominios personales (gmail, hotmail, etc.)
- Para cada dominio acumula:
  - `employees`: dict de employee_id → stats (interactions count, firstDate, lastDate)
  - `contacts`: dict de email → info de contacto (name, email, domain, nombre, apellido)
  - `subjects`: lista de hasta 20 asuntos de email
  - `dated_subjects`: lista de hasta 30 tripletas [fecha, asunto, extracto] para contexto cronologico
  - `snippets`: lista de hasta 10 snippets (200 chars cada uno)
  - `bodies`: lista de hasta 10 cuerpos de email (1000 chars cada uno) para clasificacion enriquecida
  - `contact_subjects`: dict de email_contacto → lista de sus asuntos (para inferir rol)

**Paso 4 — Cargar datos existentes**
- Lee `companies_full.json` (dict de dominio → empresa con todos sus datos)
- Lee la blocklist (`src/data/blocklist.json`) para saltar dominios bloqueados

**Paso 5 — Clasificacion con IA (Gemini 2.5 Flash)**

Hay **3 fuentes de clasificacion con prioridad descendente**:

| Prioridad | Fuente | Descripcion |
|-----------|--------|-------------|
| 1 (max) | **Verified-Companies** (Airtable) | Clasificaciones verificadas manualmente o por agente AI vs web real |
| 2 | **known_companies.json** (fichero local) | Overrides manuales (29 dominios, mayoria asesores legales) |
| 3 | **Gemini AI** | Clasificacion automatica basada en contenido de emails |

Se clasifican dos grupos de dominios:
- **Nuevos**: dominios que no existen en `companies_full.json`
- **Re-clasificar**: dominios existentes que cumplen alguna condicion:
  - Sin enrichment o sin `_tv: 2` (version de taxonomia)
  - Clasificados como "No relevante" pero recibiendo emails nuevos
  - Numero de emails duplicado desde la ultima clasificacion (minimo 5 nuevos)

El prompt de clasificacion le da a Gemini un **arbol de decision**:

```
Paso 1: ROLE → Originacion | Inversion | Ecosistema | No relevante
Paso 2: SEGMENT → Solo si Originacion: Project Finance | Corporate Finance
Paso 3: TYPE → Segun role+segment: Developer, IPP, Banco, Fondo, Asesor legal, etc.
Paso 4: ACTIVITIES → Solo si Corporate Finance
Paso 5: ATRIBUTOS → technologies, geography, market_roles, productos_potenciales, senales_clave, fase_comercial
```

Input por empresa: dominio, nombre, hasta 15 subjects, y hasta 5 bodies (2000 chars total) o 8 snippets (1000 chars).
Se procesan en **lotes de 6 dominios** con 4.5s de delay entre llamadas.

Tambien se clasifican los **roles de los contactos** (CEO, CFO, Director Desarrollo, etc.) en lotes de 6, usando nombre + email + dominio + asuntos + primer body (para detectar firma).

**Paso 6 — Merge de datos**

Para cada dominio agrupado, por cada empleado:
1. Construye un registro de empresa con los datos nuevos del email
2. Llama a `merge_company(existing, new_data, employee_id)` que:
   - Crea/actualiza la entrada del empleado en `sources[employee_id]`
   - **Agrega contactos** (deduplicados por email)
   - **Suma interacciones** (total across all employees)
   - **Expande timeline** (suma emails por trimestre)
   - **Calcula min/max dates** (firstDate, lastDate globales)
   - **Preserva el nombre existente** (no lo sobreescribe con el derivado del dominio)
3. Asigna enrichment de la clasificacion (para nuevos siempre, para existentes solo si fueron re-clasificados)
4. **Preserva campos de otros scripts** que Gemini no genera (emp_count, revenue_eur, sentiment, inv_phase, etc.)
5. Anade metadata de tracking: `_classified_at` (ISO datetime), `_email_count` (emails al momento de clasificar)

Tambien actualiza el **registro de empleados** (`employees.json`): si aparece un employee_id nuevo, lo anade.

**Paso 6b — Resumenes trimestrales**
- Para empresas con timeline pero sin `summary` en algun trimestre
- Gemini genera resumenes de ~20 palabras por trimestre basado en contexto y asuntos
- Lotes de 5 empresas

**Paso 7 — Escritura de archivos**

Genera 3 archivos JSON (escritura atomica via tempfile + os.replace):

| Archivo | Formato | Tamano | Contenido |
|---------|---------|--------|-----------|
| `companies_full.json` | Dict by domain, indent=2 | ~15MB | Todos los datos: sources, contacts, timeline, enrichment, subjects, snippets, dated_subjects |
| `companies.json` | Array compacto, sin espacios | ~8MB | Version reducida para React: max 5 contactos, max 8 timeline, sin subjects/snippets |
| `employees.json` | Array, indent=2 | ~1KB | Lista de 8 empleados con contadores |

Despues marca las filas procesadas como `done` en la Sheet (excepto en modo reprocess).

---

## 3. ESTRUCTURA DE DATOS RESULTANTE

### Empresa en `companies_full.json`:
```json
{
  "acciona.com": {
    "name": "Acciona",
    "domain": "acciona.com",
    "sectors": "",
    "nContacts": 3,
    "interactions": 45,
    "relType": "",
    "firstDate": "2022-01-15",
    "lastDate": "2026-03-10",
    "context": "Emails sobre: PF Solar 50MW, NDA, Term Sheet revisado",
    "contacts": [
      {
        "name": "Juan Perez",
        "email": "juan.perez@acciona.com",
        "role": "Director de Desarrollo",
        "nombre": "Juan",
        "apellido": "Perez"
      }
    ],
    "timeline": [
      {"quarter": "Q1 2022", "emails": 5, "summary": "Inicio conversaciones PF solar"},
      {"quarter": "Q2 2022", "emails": 12, "summary": "Due diligence y NDA"}
    ],
    "sources": {
      "salvador_carrillo": {
        "interactions": 30,
        "firstDate": "2022-01-15",
        "lastDate": "2026-03-10",
        "contacts": ["..."],
        "timeline": ["..."]
      },
      "leticia_menéndez": {
        "interactions": 15,
        "firstDate": "2023-06-01",
        "lastDate": "2025-12-15",
        "contacts": ["..."],
        "timeline": ["..."]
      }
    },
    "subjects": ["Re: PF Solar 50MW", "NDA Acciona-Alter5"],
    "dated_subjects": [["2022-01-15", "PF Solar 50MW", "extracto..."]],
    "snippets": ["Hola Salvador, respecto al proyecto..."],
    "enrichment": {
      "_tv": 2,
      "role": "Originacion",
      "seg": "Project Finance",
      "tp2": "Developer + IPP",
      "act": [],
      "tech": ["Solar", "Eolica"],
      "geo": ["Espana", "Portugal"],
      "mr": ["Borrower"],
      "grp": "Capital Seeker",
      "tp": "Developer + IPP",
      "pp": [{"p": "Prestamo Construccion", "c": "alta"}],
      "sc": ["Pipeline 200MW", "NDA firmado"],
      "fc": "Negociacion",
      "_classified_at": "2026-03-17T04:15:00Z",
      "_email_count": 45
    }
  }
}
```

### Empresa en `companies.json` (formato compacto para React):
```json
[
  ["acciona.com", "Acciona", "", 3, 45, "", "2022-01-15", "2026-03-10",
   "Emails sobre: PF Solar 50MW...",
   [["Juan Perez", "juan.perez@acciona.com", "Director de Desarrollo", "Juan", "Perez", ""]],
   [["Q1 2022", 5, "Inicio conversaciones PF solar"], ["Q2 2022", 12, "Due diligence"]],
   {"salvador_carrillo": [30, "2022-01-15", "2026-03-10"],
    "leticia_menéndez": [15, "2023-06-01", "2025-12-15"]},
   {"_tv": 2, "role": "Originacion"}
  ]
]
```

---

## 4. MECANISMOS DE PROTECCION

| Mecanismo | Donde | Que protege |
|-----------|-------|-------------|
| Deduplicacion por thread_id | Apps Script | No escribe el mismo thread dos veces en la Sheet |
| Skip empleados recientes (<1h) | Apps Script | Evita re-escanear si se ejecuta multiples veces |
| Time limit 25min + continuacion | Apps Script | No excede limite de GAS; retoma donde quedo |
| Filtro dominios personales | Apps Script + Python | gmail.com, hotmail.com, etc. nunca entran |
| Filtro propio dominio | Apps Script | alter-5.com no se procesa |
| Blocklist | Python | Dominios bloqueados manualmente se saltan |
| Verified > known > Gemini | Python | Clasificaciones verificadas no se sobreescriben |
| Preservacion de enrichment keys | Python | Campos de otros scripts no se pierden al re-clasificar |
| Escritura atomica | Python | tempfile + os.replace evita corrupcion de JSON |
| Merge incremental | Python | Nunca parte de cero, siempre fusiona con datos existentes |

---

## 5. TAXONOMIA DE CLASIFICACION

```
ROLE (obligatorio):
├── Originacion (buscan financiacion)
│   ├── Segment: Project Finance
│   │   └── Type: Developer | IPP | Developer + IPP
│   └── Segment: Corporate Finance
│       └── Activities: Autoconsumo, EV, EPC, BESS, Biogas, H2, etc.
├── Inversion (aportan capital)
│   ├── Deuda: Fondo de deuda | Banco | Bonista / Institucional
│   └── Equity: Fondo de infraestructura | Private equity | Fondo renovable | IPP comprador | Utility compradora
├── Ecosistema (servicios)
│   └── Type: Asesor legal | Asesor tecnico | Consultor precios | Asset manager | Ingenieria | Asesor financiero | Asociacion
└── No relevante (newsletters, SaaS, spam)

ATRIBUTOS transversales:
├── Technologies: Solar | Eolica | BESS | Biogas | Hidrogeno | Otra
├── Geography: Espana | Portugal | Italia | Francia | Alemania | UK | Otro
├── Market Roles: Borrower | Seller M&A | Buyer Investor M&A | Debt Investor | Equity Investor | Partner & Services
├── Fase comercial: Sin contactar | Primer contacto | Exploracion | Negociacion | Cliente activo | Dormido
└── Productos potenciales: Prestamo Construccion | Refinanciacion | Colocacion Inversores | Advisory / M&A
```

---

## 6. FLUJO TEMPORAL (DIA TIPICO)

```
03:00 UTC  — Trigger GAS: scanMailboxes()
             Lee emails nuevos de 8 buzones
             Escribe filas "pending" en Google Sheet
             Si hay emails nuevos → dispara GitHub Actions

~03:15 UTC — GitHub Actions: process-emails.yml
             Checkout repo (con companies_full.json existente)
             python process_sheet_emails.py:
               [1] Conecta con Sheet
               [2] Lee emails pending
               [2b] Filtra relevancia con Gemini (~20 emails por llamada)
               [3] Agrupa por dominio
               [4] Carga companies_full.json existente
               [5] Clasifica nuevos/re-clasifica existentes con Gemini (~6 por llamada)
               [6] Merge incremental: fusiona con datos existentes
               [6b] Genera resumenes trimestrales
               [7] Escribe 3 JSONs (full, compact, employees)
             python sync_airtable_opportunities.py
             git commit + push

~03:30 UTC — Vercel detecta push a main
             Despliega automaticamente el dashboard actualizado

~03:35 UTC — Dashboard disponible con datos frescos
```

---

## 7. MODOS DE OPERACION ESPECIALES

| Modo | Comando | Uso |
|------|---------|-----|
| Normal (diario) | `python scripts/process_sheet_emails.py` | Procesa solo emails `pending` |
| Reprocess | `python scripts/process_sheet_emails.py --reprocess` | Re-lee emails `done` para re-merge (backfill tras fix) |
| Backfill clasificaciones | `python scripts/backfill_classifications.py --top N` | Re-clasifica N empresas existentes con pipeline mejorado |
| Manual dispatch | GitHub UI → workflow_dispatch | Trigger manual sin esperar al cron |

---

## 8. DEPENDENCIAS EXTERNAS

| Servicio | Uso | Credencial |
|----------|-----|------------|
| Gmail API | Lectura de buzones via delegacion | Service Account + private key |
| Google Sheets API | Almacen intermedio de emails | Service Account |
| Google AI (Gemini 2.5 Flash) | Filtro relevancia + clasificacion + roles + resumenes | `GEMINI_API_KEY` |
| GitHub Actions | Orquestacion del pipeline | `GITHUB_PAT` |
| Airtable | Verified-Companies (override clasificaciones) | `AIRTABLE_PAT` |
| Vercel | Deploy automatico desde main | Configurado en proyecto |
