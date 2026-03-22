# Sistema de Búsqueda de Nuevas Empresas Candidatas

> Este documento describe en detalle los dos sistemas del CRM Alter5 BI para encontrar nuevas empresas candidatas para campañas: (1) **Prospección Automática con IA** — que descubre empresas completamente nuevas, no presentes en la base de datos, y (2) **Búsqueda en CRM** — que filtra y revisa empresas ya existentes en la base de datos que todavía no han sido contactadas.

---

## Tabla de Contenidos

### Parte I — Negocio
1. [Dos sistemas, dos objetivos](#1-dos-sistemas-dos-objetivos)
2. [Prospección Automática con IA — descubrir empresas nuevas](#2-prospección-automática-con-ia--descubrir-empresas-nuevas)
   - 2.1 [Qué hace y cuándo se usa](#21-qué-hace-y-cuándo-se-usa)
   - 2.2 [Definición de criterios de búsqueda](#22-definición-de-criterios-de-búsqueda)
   - 2.3 [El agente IA en GitHub Actions](#23-el-agente-ia-en-github-actions)
   - 2.4 [Revisión de resultados](#24-revisión-de-resultados)
   - 2.5 [Datos de cada empresa encontrada](#25-datos-de-cada-empresa-encontrada)
   - 2.6 [Gestión de contactos en los resultados](#26-gestión-de-contactos-en-los-resultados)
   - 2.7 [Exportar a Candidatas para campaña](#27-exportar-a-candidatas-para-campaña)
3. [Búsqueda en CRM — revisar empresas existentes no contactadas](#3-búsqueda-en-crm--revisar-empresas-existentes-no-contactadas)
   - 3.1 [Qué hace y cuándo se usa](#31-qué-hace-y-cuándo-se-usa)
   - 3.2 [Cómo se puntúa cada empresa (Campaign Priority Score)](#32-cómo-se-puntúa-cada-empresa-campaign-priority-score)
   - 3.3 [Filtros disponibles y modo Proyectos Scraper](#33-filtros-disponibles-y-modo-proyectos-scraper)
   - 3.4 [Revisión empresa por empresa](#34-revisión-empresa-por-empresa)
   - 3.5 [Exportar a CSV o crear campaña](#35-exportar-a-csv-o-crear-campaña)
   - 3.6 [Bloqueo de seguridad anti-duplicados](#36-bloqueo-de-seguridad-anti-duplicados)

### Parte II — Técnica
4. [Arquitectura del sistema de Prospección](#4-arquitectura-del-sistema-de-prospección)
5. [Tabla Airtable ProspectingResults](#5-tabla-airtable-prospectingresults)
6. [Flujo técnico de creación de job](#6-flujo-técnico-de-creación-de-job)
7. [GitHub Actions — prospecting.yml](#7-github-actions--prospectingyml)
8. [airtableProspecting.ts — Referencia de funciones](#8-airtableprospecttingts--referencia-de-funciones)
9. [CandidateSearchView — Pipeline de filtrado](#9-candidatesearchview--pipeline-de-filtrado)
10. [campaignPriorityScore() — Fórmula de puntuación CRM](#10-campaignpriorityscore--fórmula-de-puntuación-crm)
11. [Referencia de llamadas externas](#11-referencia-de-llamadas-externas)

---

# Parte I — Negocio

## 1. Dos sistemas, dos objetivos

Existen dos herramientas de búsqueda de candidatas, con propósitos y fuentes de datos completamente diferentes:

| | Prospección Automática con IA | Búsqueda en CRM |
|---|---|---|
| **Componente** | `ProspectingView` | `CandidateSearchView` |
| **Fuente de datos** | Web (Gemini + búsqueda) — empresas nuevas | CRM existente (~5.261 empresas) |
| **Objetivo** | Descubrir empresas que NO están en la base de datos | Encontrar empresas ya conocidas que no se han contactado aún |
| **Proceso** | Lanza un agente IA en GitHub Actions (~10-15 min) | Filtrado y puntuación instantáneo |
| **Resultado** | Nuevas empresas con descripción, señales, contacto | Lista priorizada de candidatas con historial de emails |
| **Output final** | Exporta a `CampaignTargets` Airtable | Genera CSV o crea campaña directamente |
| **Tab en la app** | "Prospectar" | Dentro de la vista de Campañas / Candidatas |

```
¿La empresa ya está en nuestro CRM?
    │
    ├── SÍ → Búsqueda en CRM (CandidateSearchView)
    │          → Revisar empresas Originación sin contactar
    │          → Puntuar por Campaign Priority Score
    │          → Exportar CSV para campaña
    │
    └── NO → Prospección Automática con IA (ProspectingView)
              → Definir criterios (tipo empresa, sector, países)
              → Agente IA busca en la web
              → Revisar resultados (~10-15 min después)
              → Exportar las aprobadas a CampaignTargets
```

---

## 2. Prospección Automática con IA — descubrir empresas nuevas

### 2.1 Qué hace y cuándo se usa

La **Prospección Automática** (`ProspectingView`) permite lanzar búsquedas de empresas que no están en el CRM, usando un agente de IA que busca en internet. Se usa cuando:

- El equipo quiere explorar un sector o geografía nueva
- Se agotaron las candidatas del CRM para un tipo de empresa específico
- Se quiere prospectar empresas en países donde el CRM tiene poca cobertura
- Se busca un nicho concreto (ej: "promotores de data centers con necesidad de corporate debt en Francia")

El proceso es **asíncrono**: el equipo define los criterios, pulsa "Lanzar búsqueda", y ~10-15 minutos después aparecen los resultados en la misma pantalla.

**Vista principal** de ProspectingView:

```
┌─ Prospección Automática ─────────────────────────────────────────[+ Nueva búsqueda]─┐
│                                                                                      │
│  [Total jobs: 5]  [En curso: 1]  [Completados: 4]  [Empresas encontradas: 87]       │
│                                                                                      │
│  ┌─ Tabla de jobs ──────────────────────────────────────────────────────────────┐   │
│  │ Nombre        │ Criterios                │ Estado    │ Emp. │ Apr. │ Acciones│   │
│  ├───────────────┼──────────────────────────┼───────────┼──────┼──────┼─────────┤   │
│  │ Promotores    │ Promotor / Solar · ES,PT │ ✅ Comp.  │  23  │   8  │Revisar→ │   │
│  │ Solar Q1      │                          │           │      │      │         │   │
│  ├───────────────┼──────────────────────────┼───────────┼──────┼──────┼─────────┤   │
│  │ IPPs Italia   │ IPP / Eólica · IT        │ 🔄 Curso  │   —  │   —  │En prog. │   │
│  └───────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Los jobs se **actualizan automáticamente cada 30 segundos** si hay alguno en estado `running` o `pending`.

Si un job lleva más de **20 minutos** sin completarse, se marca automáticamente como "⚠️ Atascado" y aparecen botones de Reintentar y Cancelar.

### 2.2 Definición de criterios de búsqueda

Al pulsar "+ Nueva búsqueda" se abre un modal con 5 campos:

**1. Nombre de la búsqueda** (obligatorio)
- Campo de texto libre para identificar el job
- Ejemplo: `"Promotores Solar España Q1 2026"`, `"IPPs eólicos Italia"`, `"Corporate Debt data centers Francia"`

**2. ¿Qué buscan estas empresas?** (tipo de financiación)
- Radio buttons con 4 opciones:
  - `Deuda - Project Finance` — promotores con proyectos individuales a nivel SPV
  - `Deuda - Corporate Finance` — empresas que buscan deuda corporativa
  - `Equity / M&A` — empresas que buscan inversores o comprador
  - `Deuda + Equity` — ambas necesidades

**3. Tipo de empresa**
- Radio buttons con 5 opciones:
  - `Promotor / Developer` — construye activos renovables
  - `IPP / Operador` — opera activos ya construidos
  - `Corporate` — empresa con necesidad de financiación corporativa
  - `Fondo inversor` — fondo que busca activos para invertir
  - `Otro` → activa un input de texto libre

**4. Tipo de activo / sector** (obligatorio)
- Textarea libre: describe el tipo de activo o sector
- Ejemplos: `"parques solares utility-scale"`, `"data centers"`, `"centros logísticos de frío"`, `"hidrógeno verde"`
- El sistema infiere el sector automáticamente desde este campo:
  - Contiene "solar", "eólica" o "renovable" → sector `"Energía Renovable"`
  - Contiene "data center" → `"Data Centers"`
  - Contiene "logística" o "frío" → `"Logística"`
  - Contiene "inmobiliaria" o "real estate" → `"Real Estate"`
  - Resto → `"Multi-sector"`

**5. Países objetivo** (obligatorio, al menos uno)
- Chips multi-select con 11 países: 🇪🇸 ES · 🇵🇹 PT · 🇮🇹 IT · 🇫🇷 FR · 🇩🇪 DE · 🇬🇧 UK · 🇵🇱 PL · 🇳🇱 NL · 🇧🇪 BE · 🇨🇭 CH · 🇦🇹 AT

**6. Descripción adicional** (opcional)
- Textarea para dar contexto adicional al agente IA
- Ejemplo: `"Preferiblemente empresas con proyectos en estado RTB o ya construidos, tamaño entre 20-200MW"`

**Objeto de criterios generado** (enviado al agente):

```json
{
  "description": "Promotor / Developer · parques solares utility-scale",
  "target_market_role": "Debt / Project Finance",
  "asset_type": "parques solares utility-scale",
  "sector": "Energía Renovable",
  "focus_countries": ["ES", "PT"],
  "fei_eligible": false,
  "company_type": "developer",
  "financing_type": "debt_pf",
  "job_name": "Promotores Solar España Q1 2026",
  "created_by": "Salvador Carrillo",
  "job_id": "job_20260321T105423_a3b4c5d6"
}
```

### 2.3 El agente IA en GitHub Actions

Tras confirmar el formulario, ocurren dos cosas en secuencia:

1. **Se crea el job en Airtable** (`ProspectingResults`) con status `pending` y un registro placeholder `__JOB_PLACEHOLDER__`
2. **Se dispara un GitHub Action** (`repository_dispatch` tipo `run-prospecting`) que ejecuta el script Python `scripts/prospecting/runner.py`

El agente Python tiene acceso a:
- **Gemini API** — para buscar y clasificar empresas con Google Search grounding
- **Anthropic API** — modelo alternativo de clasificación
- **Apollo.io API** — para encontrar contactos (nombre, cargo, email) de las empresas halladas
- **Findymail API** — para encontrar emails a partir de URLs de LinkedIn

El agente recorre los criterios y busca empresas usando Gemini con búsquedas web. Para cada empresa encontrada genera:
- Nombre, URL, país, Tax ID (si encuentra)
- Descripción de la empresa
- Señales de financiación detectadas en la web (`financingSignals`)
- Clasificación: role, segmento, tipo, tecnologías, geografías, market roles
- Nivel de confianza del match: `high`, `medium`, `low`
- Fuentes web consultadas (`sourcesFound`)
- Datos de contacto si encuentra via Apollo o Findymail

Los resultados se escriben en Airtable `ProspectingResults` en tiempo real (la vista del frontend los va mostrando a medida que llegan via polling).

**Duración estimada**: 10-15 minutos para 20-40 empresas.

### 2.4 Revisión de resultados

Al hacer clic en "Revisar →" de un job completado, se abre `ProspectingResultsView`:

```
┌─ Promotores Solar España Q1 2026 ─────────────────────────────────────────[← Volver]─┐
│  23 encontradas · 8 aprobadas · 12 pendientes                                         │
│                                                                                        │
│  [Total: 23] [Alta conf.: 8] [Media: 11] [Baja: 4] [Aprobadas: 8] [Pend.: 12] [Con email: 6]│
│                                                                                        │
│  Filtros: [Confianza ▼] [País ▼] [Signals: Todas ▼] [Estado ▼]  🔍 buscar            │
│                                                                                        │
│  [Lista de cards por empresa]                                                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**KPIs de la vista de resultados**:

| KPI | Descripción |
|-----|-------------|
| Total | Empresas encontradas por el agente |
| Alta conf. | El agente tiene alta certeza de que es el perfil buscado |
| Media | Confianza moderada — revisar |
| Baja | Poca certeza — normalmente se rechaza |
| Aprobadas | Las que el equipo marcó como válidas |
| Pendientes | Sin revisar todavía |
| Con email | Las que tienen email de contacto identificado |

**Filtros disponibles**:
- Confianza: Todas / Alta / Media / Baja
- País: Todos / [lista de países de los resultados]
- Signals: Todas / Con signals de financiación / Sin signals
- Estado: Todos / Pendientes / Aprobadas / Saltadas / Rechazadas
- Búsqueda: por nombre de empresa, URL o descripción

### 2.5 Datos de cada empresa encontrada

Cada card de empresa muestra:

**Cabecera**:
- Dot de confianza: verde (alta) / ámbar (media) / rojo (baja)
- Nombre de la empresa + URL (enlace) + Flag del país
- Badge `Fit: Alta/Media/Baja`

**Clasificación** (badges):
- Role (Originación, Inversión, Services)
- Segmento (Project Finance, Corporate Finance)
- Tipo de empresa
- Tipo de activo

**Descripción**: texto libre generado por Gemini sobre la empresa

**Financing Signals**: señales de necesidad de financiación detectadas en la web
- Si hay → fondo ámbar con `⚡ Signals: [texto]`
- Si no → fondo gris "Sin financing signals detectadas"

**Sección de contacto**: ver sección 2.6

**Fuentes** (chips pequeños): URLs de las webs consultadas por el agente (hasta 3, resto truncado)

**Panel de detalle** (colapsable con "▼ Ver detalle"):
- Market roles, tecnologías, geografía (chips)
- Tax ID (si encontrado)
- Tamaño estimado
- Notas de clasificación del agente
- Notas adicionales

### 2.6 Gestión de contactos en los resultados

El estado de contacto de cada empresa puede ser uno de tres:

**A) Empresa con email** (el agente encontró el contacto completo):
```
👤 Carlos García (Director de Desarrollo)    carlos@empresa.es    ✅
```

**B) Empresa con nombre pero sin email** (el agente encontró el nombre pero no el email):
```
👤 Carlos García (Director de Desarrollo)    [Sin email]
```

**C) Empresa sin contacto** (el agente no encontró ningún contacto):
```
[🔗 Buscar en Sales Nav]  [input: Pegar LinkedIn URL...]  [→ Findymail]

[input: Nombre contacto]  [input: Cargo]  [Guardar]
```

Para el caso C, el equipo tiene dos opciones:

**Opción 1 — Findymail**: 
1. Pulsar "🔗 Buscar en Sales Nav" → abre LinkedIn Sales Navigator con búsqueda pre-formada (empresa + CFO)
2. Encontrar el perfil del decisor
3. Copiar la URL de LinkedIn y pegarla en el input
4. Pulsar "→ Findymail" → se guarda la URL en Airtable y el sistema la procesará para obtener el email

**Opción 2 — Manual**:
1. Escribir nombre y cargo del contacto en los inputs
2. Pulsar "Guardar" → se persiste en Airtable (sin email)
3. El equipo busca el email manualmente después

### 2.7 Exportar a Candidatas para campaña

Cuando el equipo ha revisado todos los resultados y aprobado las empresas válidas con email, aparece una barra sticky en la parte inferior:

```
8 aprobadas · 6 con email                          [📤 Exportar a Candidatas]
```

Al pulsar "Exportar a Candidatas":
- Se filtran solo las empresas con `reviewStatus === "approved"` Y `contactEmail` no vacío
- Se crean registros en Airtable `CampaignTargets` (tabla central de candidatas)
- Cada registro incluye: dominio, nombre empresa, status `pending`, segmento, tipo, contacto seleccionado (nombre, email, cargo), campaignRef = nombre del job

Desde `CampaignTargets` el equipo puede:
- Revisar las candidatas antes de enviar desde `BridgeExplorerView`
- Gestionar waves y estados (pendiente/aprobada/enviada/rechazada)

---

## 3. Búsqueda en CRM — revisar empresas existentes no contactadas

### 3.1 Qué hace y cuándo se usa

`CandidateSearchView` trabaja con el **CRM existente** (~5.261 empresas). Filtra todas las empresas de `Originación` que **no han recibido email de campaña todavía**, las puntúa por prioridad, y permite al equipo aprobarlas para una campaña.

Se usa cuando:
- El equipo quiere preparar una wave de Bridge o de otra campaña
- Se quiere revisar qué empresas del CRM son candidatas para un producto concreto
- Se quiere filtrar por sector, tecnología o MW de proyectos del scraper

**Vista principal**:
```
┌─ Buscar Empresas Candidatas ───────────────────────────────── [Generar CSV (47)]─┐
│  Empresas de Originación sin contactar · Campaña Bridge_Q1                       │
│                                                                                   │
│  [Disponibles: 342] [Ya contactadas: 89] [Aprobadas: 47] [Contactos sel.: 52]    │
│                                                                                   │
│  [Pendientes|Aprobadas|Saltadas|Rechazadas|Todas]                                 │
│  Segmento ▼  Tipo ▼  [Solar][Eólica][BESS]...  🔍 buscar   [⚡ Proyectos Scraper]│
│                                                                                   │
│  [Lista de cards]                                                                 │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Cómo se puntúa cada empresa (Campaign Priority Score)

Cada empresa del CRM recibe un **Campaign Priority Score (0-100)** que indica su idoneidad para una campaña outbound de Alter5. La fórmula tiene 4 componentes:

**Componente 1 — Mid-market fit (0-30 pts)**: ¿es del tamaño adecuado?

| Condición | Puntos |
|-----------|--------|
| Es una utility grande (Iberdrola, Endesa, Naturgy, Enel, etc.) | 3 |
| 20–500 empleados (sweet spot Alter5) | 30 |
| 500–1.000 empleados | 18 |
| 10–20 empleados | 15 |
| 1.001–5.000 empleados | 8 |
| > 5.000 empleados | 3 |
| < 10 empleados | 12 |
| Sin datos de empleados | 12 (default) |

**Componente 2 — Utility-scale fit (0-30 pts)**: ¿trabaja a escala utility?

| Condición | Puntos |
|-----------|--------|
| `projectScale = "Utility-scale"` | +15 |
| `projectScale = "Mixto"` | +10 |
| `projectScale = "Distribuido"` | +3 |
| MW totales (scraper + pipeline) ≥ 500 | +10 |
| MW totales ≥ 100 | +7 |
| MW totales ≥ 10 | +4 |
| MW totales > 0 | +2 |
| Tiene líneas de negocio Utility-scale/IPP | +8 |
| Tiene otras líneas de negocio | +3 |

**Componente 3 — Contact readiness (0-25 pts)**: ¿hay un decisor identificado?

| Contacto mejor identificado | Puntos |
|-----------------------------|--------|
| CEO / DG / Managing Director | +15 |
| CFO / Director Financiero | +12 |
| Financiación Estructurada | +10 |
| M&A | +8 |
| Otro cargo conocido | +5 |
| Bonus: 2+ decision makers | +7 |
| Bonus: 2+ contactos totales | +3 |

**Componente 4 — Data quality (0-15 pts)**:
- `qualityScore * 0.15` (el Quality Score de la empresa del CRM)

**Tier según score total**:
- `"Alta"` (≥70) → verde
- `"Media"` (≥45) → ámbar
- `"Baja"` (<45) → rojo

### 3.3 Filtros disponibles y modo Proyectos Scraper

**Tabs de estado** (parte superior):
| Tab | Qué muestra |
|-----|-------------|
| Pendientes | Sin decisión (por defecto) |
| Aprobadas | Aprobadas para esta campaña |
| Saltadas | Saltadas temporalmente |
| Rechazadas | Rechazadas permanentemente |
| Todas | Todo excepto las ya enviadas |

**Filtros de contenido**:

| Filtro | Tipo | Campo | Lógica |
|--------|------|-------|--------|
| Segmento | Select | `company.segment` | Project Finance / Corporate Finance |
| Tipo empresa | Select | `company.companyType` | Developer, IPP, etc. |
| Tecnologías | Chips multi | `company.technologies[]` | OR entre seleccionadas |
| Búsqueda | Input texto | `name` o `domain` | Contains |

**Modo "⚡ Proyectos Scraper"** (toggle especial):
Cuando se activa, muestra **todas las empresas con proyectos en el scraper** (no solo las de Originación). Esto incluye los 609 developers importados del scraper MITECO/CCAA que tienen dominio `.scraper.es`.

Al activarlo, aparecen dos filas adicionales de filtros:

**Filtros MW** (rango de MW totales de proyectos):

| Rango | Color |
|-------|-------|
| > 1 GW | Rojo |
| 500-1000 MW | Ámbar |
| 100-500 MW | Azul |
| 10-100 MW | Verde |
| < 10 MW | Gris |

**Filtros de permisos** (estado administrativo del proyecto):

| Permiso | Descripción |
|---------|-------------|
| AAC | Autorización Administrativa de Construcción |
| DIA | Declaración de Impacto Ambiental |
| AAP | Autorización Administrativa Previa |
| DUP | Declaración de Utilidad Pública |
| IIA | Informe de Impacto Ambiental |

La lógica de ambos filtros es **OR** — basta con que la empresa tenga alguno de los rangos/permisos seleccionados.

**Ordenación**: siempre por `Campaign Priority Score` descendente. No hay opción de cambiar el criterio de ordenación.

**Paginación**: 50 empresas por página.

### 3.4 Revisión empresa por empresa

Cada empresa aparece como una card con 3 vistas posibles:

**Card en estado "pendiente" (vista completa)**:
```
[Nombre empresa] [dominio] [85 Alta]
[Project Finance] [Developer] [Solar] [Eólica]    2 contactos
[Datos scraper si modo activo: 450 MW · 3 proy · Solar · AAC DUP]

                          [Aprobar] [Saltar] [Rechazar]
```

**Card aprobada (vista compacta)**:
```
[✓] ✓ Nombre empresa   · 2 contactos seleccionados · CFO
                                                            [Editar]
```
La checkbox permite marcarla para incluir en el próximo envío.

**Card rechazada** (vista muy compacta, opacidad reducida, tachado):
```
~~Nombre empresa~~                                          [Deshacer]
```

**Al expandir una card** (click en ella):
- Lista completa de contactos con:
  - Checkbox para seleccionar/deseleccionar
  - Nombre (normalizado a Title Case si estaba en MAYÚSCULAS)
  - Badge de cargo con color por jerarquía
  - Link LinkedIn si existe (botón "in" azul)
  - Badge "⭐ Recomendado" en el contacto de mayor prioridad
  - Email (a la derecha)

**Acciones**:
- **Aprobar**: guarda en Airtable con `status: "approved"` + contactos seleccionados
- **Saltar**: `status: "skipped"` — queda pendiente para revisión posterior
- **Rechazar**: `status: "rejected"` — excluida permanentemente
- **Deshacer** (en saltadas/rechazadas): vuelve a `status: "pending"`

### 3.5 Exportar a CSV o crear campaña

**Barra sticky inferior** (aparece cuando hay empresas aprobadas):

```
47 aprobadas · 3 seleccionadas (52 contactos)   [Seleccionar visibles] [Deseleccionar]
                                                 [Crear Campaña (52)] [Generar CSV]
```

**"Seleccionar visibles"**: selecciona todas las aprobadas que están en la página actual para incluirlas en el lote de exportación.

**Modal de exportación CSV** (al pulsar "Generar CSV"):

```
┌─ Exportar CSV ─────────────────────────┐
│  47 contactos de 23 empresas           │
│  ┌────────────────────────────────┐    │
│  │ Project Finance       31       │    │
│  │ Corporate Finance     16       │    │
│  └────────────────────────────────┘    │
│  Formato: 13 columnas compatibles con  │
│  el Gestor de Campañas                 │
│                                        │
│  [Cancelar]    [Descargar CSV (47)]    │
└────────────────────────────────────────┘
```

**Formato del CSV** (13 columnas):

| Columna | Contenido |
|---------|-----------|
| Email | Email del contacto |
| Nombre | Primer nombre |
| Apellido | Resto del nombre |
| Organizacion | Nombre de la empresa |
| Cargo | Rol del contacto |
| Etiqueta | Segmento de la empresa |
| LinkedIn | URL (si existe) |
| IA | Vacío (para uso futuro) |
| Tipo | companyType de la empresa |
| Desc | Vacío (para uso futuro) |
| Score | Vacío (para uso futuro) |
| Emails | Vacío (para uso futuro) |
| Pais | geography[0] de la empresa |

Los contactos se **ordenan por prioridad** en el CSV: CEO/CFO primero.

**Nombre del archivo**: `candidatas_{campaignRef}_{fecha}.csv`

**"Crear Campaña"**: llama `onCreateCampaign(recipients)` con el array de destinatarios formateados para el wizard de creación de campaña.

### 3.6 Bloqueo de seguridad anti-duplicados

Si el sistema **no puede cargar los dominios ya enviados** (fallo en la llamada a GAS), aparece un **banner rojo de advertencia**:

```
⚠ No se pudieron cargar los dominios ya enviados
La lista puede incluir empresas que ya recibieron la campaña.
Aprobar o exportar sin esta verificación puede causar envíos duplicados.

[Reintentar]  [Continuar bajo mi responsabilidad]
```

Mientras el banner está activo **y** el usuario no ha pulsado "Continuar bajo mi responsabilidad":
- Los botones Aprobar, Rechazar, Saltar están **deshabilitados** (opacidad 0.5, cursor not-allowed)
- Los botones "Crear Campaña" y "Generar CSV" están **bloqueados**
- Si el usuario pulsa "Continuar bajo mi responsabilidad", se activa el modo sin verificación con un mensaje ámbar de advertencia persistente

---

# Parte II — Técnica

## 4. Arquitectura del sistema de Prospección

```
React (ProspectingView)
    │
    ├── ProspectingCriteriaModal
    │       │
    │       ├── createProspectingJob() → Airtable ProspectingResults (POST placeholder)
    │       └── triggerGitHubAction() → POST /api/github-dispatch (Vercel proxy)
    │                                         └─→ GitHub API repository_dispatch
    │                                                  └─→ prospecting.yml
    │                                                           └─→ runner.py (Python)
    │                                                                └─→ Gemini/Apollo/Findymail
    │                                                                └─→ Airtable (writes results)
    │
    ├── ProspectingView (polling 30s para jobs activos)
    │       └── fetchProspectingJobs() → Airtable ProspectingResults (GET paginado)
    │
    └── ProspectingResultsView
            ├── fetchJobResults(jobId) → Airtable ProspectingResults filtrado por JobId
            ├── updateReviewStatus() → PATCH individual
            ├── updateContactData() → PATCH contacto/LinkedIn/Findymail
            └── exportToCampaignTargets() → POST bulk a CampaignTargets
```

## 5. Tabla Airtable ProspectingResults

**Base**: `appVu3TvSZ1E4tj0J` (misma que todo el sistema)
**Tabla**: `ProspectingResults`
**Concepto**: una tabla con dos tipos de registros — *registros de empresa* (uno por empresa encontrada) y *registros placeholder* (uno por job, para marcar el estado del job)

### Campos completos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `JobId` | singleLineText | ID único del job (`job_20260321T105423_a3b4c5d6`) |
| `JobName` | singleLineText | Nombre legible del job |
| `JobStatus` | singleSelect | `pending` \| `running` \| `completed` \| `failed` |
| `SearchCriteria` | longText | JSON con todos los criterios de búsqueda |
| `CreatedAt` | dateTime | Timestamp de creación |
| `CreatedBy` | singleLineText | Nombre del usuario que lanzó el job |
| `CompanyName` | singleLineText | Nombre de la empresa (o `__JOB_PLACEHOLDER__` / `__NO_RESULTS__`) |
| `CompanyUrl` | url | URL de la empresa |
| `Country` | singleLineText | Código de país (ES, IT, FR...) |
| `TaxId` | singleLineText | NIF/CIF si se encontró (`PENDING` si no) |
| `Description` | longText | Descripción generada por el agente IA |
| `FinancingSignals` | longText | Señales de necesidad de financiación detectadas |
| `AssetType` | singleLineText | Tipo de activo de la empresa |
| `EstimatedSize` | singleLineText | Tamaño estimado (empleados, MW, etc.) |
| `Role` | singleLineText | Clasificación: Originación \| Inversión \| Services |
| `Segment` | singleLineText | Project Finance \| Corporate Finance |
| `CompanyType` | singleLineText | Developer \| IPP \| etc. |
| `MarketRoles` | longText | JSON array de market roles |
| `Technologies` | longText | JSON array de tecnologías |
| `Geography` | longText | JSON array de países |
| `ClassificationNotes` | longText | Notas del agente sobre la clasificación |
| `Confidence` | singleSelect | `high` \| `medium` \| `low` |
| `SourcesFound` | longText | JSON array de URLs consultadas |
| `ReviewStatus` | singleSelect | `pending` \| `approved` \| `skipped` \| `rejected` |
| `ReviewedBy` | singleLineText | Nombre del revisor |
| `ReviewedAt` | dateTime | Timestamp de revisión |
| `Notes` | longText | Notas adicionales |
| `ContactName` | singleLineText | Nombre del contacto encontrado |
| `ContactRole` | singleLineText | Cargo del contacto |
| `ContactLinkedIn` | url | URL de LinkedIn del contacto |
| `ContactEmail` | email | Email del contacto |
| `FindymailStatus` | singleLineText | `pending` \| `found` \| `not_found` |
| `ApolloData` | longText | JSON con datos adicionales de Apollo.io |
| `CampaignRef` | singleLineText | Referencia a CampaignTargets si fue exportado |
| `ProspectId` | singleLineText | ID del Prospect de Airtable si se creó |

### Registros especiales

- `CompanyName = "__JOB_PLACEHOLDER__"` → marca el inicio del job, no cuenta como empresa
- `CompanyName = "__NO_RESULTS__"` → el agente terminó sin encontrar empresas

## 6. Flujo técnico de creación de job

```typescript
// 1. Generar Job ID único
const jobId = `job_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 15)}_${crypto.randomUUID().slice(0, 8)}`;

// 2. Crear placeholder en Airtable (aparece inmediatamente en ProspectingView)
await airtableProxy({
  table: "ProspectingResults",
  method: 'POST',
  records: [{
    fields: {
      JobId: jobId,
      JobName: jobName,
      SearchCriteria: JSON.stringify(criteria),
      JobStatus: "pending",
      CreatedAt: new Date().toISOString(),
      CreatedBy: createdBy,
      CompanyName: "__JOB_PLACEHOLDER__",
      ReviewStatus: "pending",
    }
  }]
});

// 3. Disparar GitHub Action via proxy Vercel
await fetch("/api/github-dispatch", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-proxy-secret": VITE_CAMPAIGN_PROXY_SECRET,
  },
  body: JSON.stringify({ criteria: JSON.stringify({...criteria, job_id: jobId}), jobId }),
});
```

**Proxy Vercel `/api/github-dispatch`**: inyecta el `GITHUB_TOKEN` server-side y hace POST a:
```
POST https://api.github.com/repos/salvac12/alter5-bi/dispatches
{
  "event_type": "run-prospecting",
  "client_payload": { "criteria": "{ ...json string... }", "jobId": "..." }
}
```

## 7. GitHub Actions — prospecting.yml

```yaml
name: Prospecting Agent

on:
  repository_dispatch:
    types: [run-prospecting]
  workflow_dispatch:
    inputs:
      criteria_json:
        description: 'JSON string with search criteria'
        required: true

jobs:
  prospect:
    runs-on: ubuntu-latest
    # Sin concurrency group → múltiples jobs en paralelo permitidos
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r scripts/prospecting/requirements.txt

      - name: Run Prospecting Agent
        env:
          AIRTABLE_PAT: ${{ secrets.AIRTABLE_PAT }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          APOLLO_API_KEY: ${{ secrets.APOLLO_API_KEY }}
          FINDYMAIL_API_KEY: ${{ secrets.FINDYMAIL_API_KEY }}
          PROSPECTING_CRITERIA: ${{ github.event.client_payload.criteria || inputs.criteria_json }}
        run: python scripts/prospecting/runner.py
```

**Características importantes**:
- **Sin `concurrency`**: múltiples jobs pueden correr en paralelo (uno por búsqueda)
- `runner.py` lee los criterios de `PROSPECTING_CRITERIA` (env var con el JSON)
- Escribe los resultados directamente en Airtable con `AIRTABLE_PAT`
- El frontend detecta los resultados via polling (30s) sobre `ProspectingResults`

**Variables de entorno requeridas en GitHub Secrets**:
- `AIRTABLE_PAT` — para escribir resultados en Airtable
- `GEMINI_API_KEY` — para búsqueda web con Google grounding
- `ANTHROPIC_API_KEY` — modelo alternativo de clasificación
- `APOLLO_API_KEY` — para encontrar contactos
- `FINDYMAIL_API_KEY` — para resolver emails desde LinkedIn

## 8. airtableProspecting.ts — Referencia de funciones

```typescript
// Fetch y agregación de jobs (con cache 30s)
fetchProspectingJobs() → Job[]
// Agrupa por JobId, calcula totalCompanies, approvedCount, pendingCount, highConfidenceCount

// Fetch resultados de un job concreto
fetchJobResults(jobId) → Company[]
// Filtra __JOB_PLACEHOLDER__ y __NO_RESULTS__, deserializa JSON fields

// Actualizar estado de revisión
updateReviewStatus(recordId, status: "approved"|"skipped"|"rejected"|"pending", reviewedBy) → record

// Actualizar datos de contacto
updateContactData(recordId, {contactName, contactRole, contactEmail, contactLinkedIn, findymailStatus, apolloData})

// Crear job nuevo (placeholder + JSON criteria)
createProspectingJob(criteria, jobName, createdBy) → { jobId, record }

// Disparar GitHub Action
triggerGitHubAction(criteria, jobId) → { success, jobId }
// POST /api/github-dispatch con x-proxy-secret

// Actualizar status de todos los records de un job
updateJobStatusByJobId(jobId, status, notes)
// Fetch todos los record IDs, PATCH en batches de 10

// Reintentar job fallido
retryProspectingJob(jobId, criteria)
// → updateJobStatusByJobId(jobId, "pending") + triggerGitHubAction()

// Exportar aprobadas a CampaignTargets
exportToCampaignTargets(companies, jobName) → count
// Filtra approved + contactEmail, POST bulk a CampaignTargets (batches de 10)
```

## 9. CandidateSearchView — Pipeline de filtrado

```typescript
const candidates = useMemo(() => {
  const filtered = originacionCompanies.filter(c => {
    const domain = c.domain?.toLowerCase();

    // Exclusión por dominios ya enviados (GAS Tracking)
    if (trackingDomains.has(domain)) return false;

    // Exclusión por Airtable (todas las waves de Bridge)
    if (allSentDomains.has(domain)) return false;

    // Filtros de UI
    if (segFilter !== 'todas' && c.segment !== segFilter) return false;
    if (typeFilter !== 'todos' && c.companyType !== typeFilter) return false;
    if (techFilter.length > 0 && !techFilter.some(t => c.technologies?.includes(t))) return false;
    if (searchQuery && !c.name.toLowerCase().includes(q) && !domain.includes(q)) return false;

    // Status filter (estado en CampaignTargets para esta campaignRef)
    const status = savedTargets[domain]?.status || 'pending';
    if (statusFilter !== 'all' && status !== statusFilter) return false;

    // Filtros scraper (solo en utilityScaleMode)
    if (mwFilter.length > 0 && !mwFilter.some(r => matchMwRange(scraperMw, r))) return false;
    if (permitFilter.length > 0 && !permitFilter.some(p => permits.includes(p))) return false;

    return true;
  });

  // Ordenación por Campaign Priority Score descendente
  filtered.sort((a, b) => campaignPriorityScore(b).score - campaignPriorityScore(a).score);
  return filtered;
}, [/* dependencias */]);
```

**Universo base** (`originacionCompanies`):
- Modo normal: `companies.filter(c => c.role === 'Originación' && c.detail?.contacts?.some(ct => ct.email))`
- Modo Scraper: `companies.filter(c => c.scraperProjects > 0)` — todas las empresas con proyectos del scraper

## 10. campaignPriorityScore() — Fórmula de puntuación CRM

```typescript
export function campaignPriorityScore(company) {
  const emp = company.employeeCount;
  
  // 1. Mid-market fit (0-30)
  let midMarket = 12; // default sin datos
  if (isLargeUtility(company)) midMarket = 3;
  else if (emp >= 20 && emp <= 500) midMarket = 30;
  else if (emp > 500 && emp <= 1000) midMarket = 18;
  else if (emp >= 10 && emp < 20) midMarket = 15;
  else if (emp > 1000 && emp <= 5000) midMarket = 8;
  else if (emp > 5000) midMarket = 3;

  // 2. Utility-scale fit (0-30)
  const scale = company.projectScale || '';
  let utilityScale = 0;
  if (scale === 'Utility-scale') utilityScale += 15;
  else if (scale === 'Mixto') utilityScale += 10;
  else if (scale === 'Distribuido') utilityScale += 3;

  const totalMw = (company.scraperMw || 0) + (company.knownPipelineMw || 0);
  if (totalMw >= 500) utilityScale += 10;
  else if (totalMw >= 100) utilityScale += 7;
  else if (totalMw >= 10) utilityScale += 4;
  else if (totalMw > 0) utilityScale += 2;

  const blines = company.businessLines || [];
  if (blines.some(bl => ['Utility-scale developer', 'IPP'].includes(bl))) utilityScale += 8;
  else if (blines.length > 0) utilityScale += 3;

  utilityScale = Math.min(30, utilityScale);

  // 3. Contact readiness (0-25)
  const contacts = company.detail?.contacts || [];
  let contactScore = 0;
  let bestRank = 99;
  let decisionMakers = 0;

  for (const ct of contacts) {
    const r = (ct.role || '').toLowerCase();
    let rank = 99;
    if (/\bceo\b|\bdg\b|director\s*general|managing\s*director/.test(r)) rank = 1;
    else if (/\bcfo\b|\bdf\b|director\s*financier|chief\s*financial|head\s*of\s*finance/.test(r)) rank = 2;
    else if (r.includes('financiaci') && r.includes('estructurada')) rank = 3;
    else if (/\bm&a\b/.test(r)) rank = 4;
    else if (r && r !== 'no identificado' && r !== 'nan') rank = 5;
    if (rank < bestRank) bestRank = rank;
    if (rank <= 2) decisionMakers++;
  }

  if (bestRank === 1) contactScore += 15;
  else if (bestRank === 2) contactScore += 12;
  else if (bestRank === 3) contactScore += 10;
  else if (bestRank === 4) contactScore += 8;
  else if (bestRank === 5) contactScore += 5;

  if (decisionMakers >= 2) contactScore += 7;
  else if (contacts.length >= 2) contactScore += 3;
  contactScore = Math.min(25, contactScore);

  // 4. Data quality (0-15)
  const dataQuality = Math.round((company.qualityScore || 0) * 0.15);

  const score = Math.min(100, midMarket + utilityScale + contactScore + dataQuality);
  const tier = score >= 70 ? 'Alta' : score >= 45 ? 'Media' : 'Baja';

  return { score, tier, breakdown: { midMarket, utilityScale, contact: contactScore, dataQuality } };
}
```

## 11. Referencia de llamadas externas

### ProspectingView

| Llamada | Destino | Cuándo |
|---------|---------|--------|
| `createProspectingJob()` | Airtable `ProspectingResults` (POST) | Al confirmar criterios |
| `triggerGitHubAction()` | `/api/github-dispatch` → GitHub API | Al confirmar criterios |
| `fetchProspectingJobs()` | Airtable `ProspectingResults` (GET paginado) | Al montar + polling 30s |
| `updateJobStatusByJobId()` | Airtable `ProspectingResults` (PATCH batch) | Al cancelar job |
| `retryProspectingJob()` | Airtable + GitHub | Al reintentar job |
| `fetchJobResults(jobId)` | Airtable `ProspectingResults` (GET filtrado) | Al abrir "Revisar →" |
| `updateReviewStatus()` | Airtable `ProspectingResults` (PATCH) | Al aprobar/saltar/rechazar |
| `updateContactData()` | Airtable `ProspectingResults` (PATCH) | Al guardar LinkedIn/contacto |
| `exportToCampaignTargets()` | Airtable `CampaignTargets` (POST bulk) | Al pulsar "Exportar a Candidatas" |

### CandidateSearchView

| Llamada | Destino | Cuándo |
|---------|---------|--------|
| `fetchSentDomains()` | GAS `?action=dashboard` | Al montar |
| `fetchCandidateTargets(campaignRef)` | Airtable `CampaignTargets` | Al montar — wave actual |
| `fetchAllBridgeTargets("Bridge_Q1")` | Airtable `CampaignTargets` | Al montar — todas las waves |
| `upsertCandidateTarget(record)` | Airtable `CampaignTargets` (POST o PATCH) | En cada acción aprobar/saltar/rechazar |
| Descarga CSV | URL blob local | Al confirmar exportación |
| `onCreateCampaign(recipients)` | Callback al componente padre | Al pulsar "Crear Campaña" |

---

## Apéndice — Variables de entorno requeridas

### Para ProspectingView (GitHub Actions)

| Variable | Scope | Descripción |
|----------|-------|-------------|
| `VITE_CAMPAIGN_PROXY_SECRET` | Vite cliente | Autenticar proxy `/api/github-dispatch` |
| `AIRTABLE_PAT` | Vercel servidor | Leer/escribir Airtable |
| `GITHUB_TOKEN` | GitHub Secrets (o fine-grained PAT) | Disparar `repository_dispatch` |
| `GEMINI_API_KEY` | GitHub Secrets | Agente Python de búsqueda |
| `ANTHROPIC_API_KEY` | GitHub Secrets | Clasificación alternativa |
| `APOLLO_API_KEY` | GitHub Secrets | Encontrar contactos |
| `FINDYMAIL_API_KEY` | GitHub Secrets | Resolver emails desde LinkedIn |

### Para CandidateSearchView

Los mismos que el Bridge Explorer (`VITE_CAMPAIGN_PROXY_SECRET`, `AIRTABLE_PAT`).

---

*Documento generado el 21 de marzo de 2026.*
