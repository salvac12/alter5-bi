# Guía Técnica Completa — Sección Prospects y Campañas (Alter5 BI)

> **Propósito de este documento**: Describir con suficiente detalle técnico el funcionamiento de la sección *Prospects* y su integración con el sistema de *Campañas* (Bridge Campaign) del CRM Alter5 BI, para que otro equipo pueda replicar la misma infraestructura sobre una base tecnológica diferente.
>
> Este documento es el segundo de la serie. El primero cubre la sección Empresas: `docs/EMPRESAS_TECHNICAL_GUIDE.md`.

---

## Tabla de Contenidos

1. [Visión General y Relación entre Módulos](#1-visión-general-y-relación-entre-módulos)
2. [Modelo de Datos — Tabla BETA-Prospects (Airtable)](#2-modelo-de-datos--tabla-beta-prospects-airtable)
3. [Kanban de Prospects — ProspectsView](#3-kanban-de-prospects--prospectsview)
4. [Panel CRUD de Prospect — ProspectPanel](#4-panel-crud-de-prospect--prospectpanel)
5. [Sistema de Tareas — ProspectTasks y airtableTasks](#5-sistema-de-tareas--prospecttasks-y-airtabletasks)
6. [Cómo se alimenta Prospects desde el CRM de Empresas](#6-cómo-se-alimenta-prospects-desde-el-crm-de-empresas)
7. [Conversión Prospect → Oportunidad Airtable](#7-conversión-prospect--oportunidad-airtable)
8. [Sistema de Campañas — Arquitectura General](#8-sistema-de-campañas--arquitectura-general)
9. [Modelo de Datos — Google Sheets del GAS Backend](#9-modelo-de-datos--google-sheets-del-gas-backend)
10. [API de Campañas — Referencia Completa de Acciones GAS](#10-api-de-campañas--referencia-completa-de-acciones-gas)
11. [Vista Bridge Campaign — BridgeCampaignView](#11-vista-bridge-campaign--bridgecampaignview)
12. [Panel de Conversación — BridgeSlideOverPanel](#12-panel-de-conversación--bridgeslideover-panel)
13. [Sincronización Bridge → Prospects](#13-sincronización-bridge--prospects)
14. [Tabla CampaignTargets (Airtable)](#14-tabla-campaigntargets-airtable)
15. [Referencia Completa de Llamadas — Airtable y GAS](#15-referencia-completa-de-llamadas--airtable-y-gas)
16. [Bridge Energy Debt — Detalle Completo de la Campaña](#16-bridge-energy-debt--detalle-completo-de-la-campaña)

---

## 1. Visión General y Relación entre Módulos

### 1.1 Diagrama de flujo global

```
CRM Empresas (5,261 empresas)
    │
    │  Selección manual o URL params ?view=prospects&stage=Lead
    ▼
BETA-Prospects (Airtable)          ◄──────────────────────┐
  Kanban 5 stages                                         │
  Lead → Interesado → Reunion → Doc. Pendiente → Term-Sheet│
    │                                                      │
    │  convertToOpportunity()                              │
    ▼                                                      │
Opportunities (Airtable)                                   │
  Stage: "Origination - Termsheet"                        │
  → Pipeline Kanban (9 stages)                            │
                                                          │ bridgeProspectSync.ts
                                                          │ sugiere avances de stage
Campañas (Bridge Campaign)                                │
    │                                                      │
    │  GAS Web App (Google Apps Script)                    │
    │  Gmail API (GmailApp)                                │
    │  Gemini 2.0 Flash                                    │
    │                                                      │
    ├── Google Sheets (Campaigns/Recipients/FollowUps/Pipeline)
    │
    │  Leticia envía emails → contactos responden
    │  GAS detecta respuesta → clasifica con Gemini
    │  Respuesta positiva → moveStage(reunion/subida_docs/doc_completada)
    │
    └──► BridgePipeline (4 etapas: nurturing/reunion/subida_docs/doc_completada)
              │
              └──► bridgeProspectSync.ts compara con Prospects
                        → SyncSuggestion[] mostradas como banners en ProspectsView
```

### 1.2 Principio de diseño de la integración

El sistema sigue el principio de **pipeline progresivo**:

1. **Campañas** generan el primer contacto (emails outbound via GAS + Gmail)
2. Si el contacto responde positivamente, se mueve en el **Bridge Pipeline** (Google Sheets)
3. El módulo `bridgeProspectSync.ts` detecta avances en el Bridge Pipeline y los compara con los stages de **Prospects** (Airtable)
4. Se generan *sugerencias* (banners en el Kanban) que el usuario puede aplicar o ignorar
5. El usuario convierte manualmente el Prospect a **Opportunity** cuando llega a Term-Sheet
6. La oportunidad entra en el **Pipeline Kanban** (9 stages, Airtable Opportunities)

### 1.3 Separación de responsabilidades

| Componente | Tecnología | Responsabilidad |
|-----------|-----------|-----------------|
| BETA-Prospects | Airtable REST | CRM pre-pipeline (5 stages), datos persistentes |
| Bridge Pipeline | Google Sheets (GAS) | Estado de comunicación de campaña (4 etapas) |
| CampaignTargets | Airtable REST | Revisión humana de candidatos para campaña |
| GAS Backend | Google Apps Script | Lógica de email: envío, drafts, clasificación IA |
| bridgeProspectSync | TypeScript (frontend) | Correlación entre Bridge Pipeline y Prospects |

---

## 2. Modelo de Datos — Tabla BETA-Prospects (Airtable)

### 2.1 Configuración

| Parámetro | Valor |
|-----------|-------|
| Base ID | `appVu3TvSZ1E4tj0J` |
| Tabla | `BETA-Prospects` |
| Table ID | `tblAAc8XXwo8rNHR1` |
| Proxy Vercel | `/api/airtable-proxy` |
| Auth | `AIRTABLE_PAT` (server-side en Vercel) |

### 2.2 Campos completos de la tabla

| Campo Airtable | Tipo | Obligatorio | Descripción |
|---------------|------|------------|-------------|
| `Prospect Name` | singleLineText | Sí | Nombre de la empresa/oportunidad |
| `Stage` | singleSelect | Sí | Uno de los 5 stages del funnel |
| `Amount` | number | No | Importe estimado del deal |
| `Currency` | singleSelect | No | `EUR` \| `USD` \| `GBP` |
| `Product` | singleSelect | No | Ver valores abajo |
| `Origin` | singleSelect | No | Ver valores abajo |
| `Context` | multilineText | No | Notas, resúmenes de reunión, contexto de la relación |
| `Next Steps` | multilineText | No | Próximos pasos acordados |
| `Assigned To` | singleLineText | No | Nombre del responsable del deal |
| `Assigned Email` | email | No | Email del responsable |
| `Contact Email` | email | No | Email del primer contacto (backward compat) |
| `Contacts` | multilineText | No | JSON.stringify de `[{name, email, role}]` |
| `Deal Manager` | singleSelect | No | Uno de los 7 miembros del equipo |
| `Converted` | checkbox | No | `true` si ya se convirtió a Opportunity |
| `Opportunity ID` | singleLineText | No | Airtable record ID de la Opportunity creada |
| `Record Status` | singleSelect | No | `"Active"` \| `"Deleted"` (soft delete) |
| `Tasks` | multipleRecordLinks | No | Linked records a tabla `Internal - Tasks` |
| `AI Summary` | longText | No | Resumen generado por Gemini del prospect |
| `AI Suggested Stage` | singleLineText | No | Stage sugerido por IA |
| `AI Generated At` | dateTime | No | Timestamp del resumen IA |

> **Nota crítica sobre Tasks**: El campo `Tasks` es un `multipleRecordLinks` (linked records). **NO** se debe enviar como JSON string ni como array de valores directos. Se sincroniza por separado via `syncTasksToAirtable()` que escribe en la tabla `Internal - Tasks`.

> **Nota sobre singleSelect vacíos**: Cuando un singleSelect no tiene valor, se debe **omitir el campo completamente** del payload (no enviar `""` o `null`). Airtable devuelve 422 si se envía string vacío en un singleSelect.

### 2.3 Valores de los campos singleSelect

**Stage** (orden del funnel):
```
Lead → Interesado → Reunion → Documentacion Pendiente → Listo para Term-Sheet
```

**Product** (con optgroups en UI):
- Debt: `Corporate Debt`, `Project Finance`, `Development Debt`, `Project Finance Guaranteed`
- Equity: `Investment`, `Co-Development`, `M&A`

**Origin**:
```
Referral | Evento | Campana | Cold Outreach | Web-Inbound | Pipeline | Otro
```

**Currency**: `EUR`, `USD`, `GBP`

### 2.4 Estructura del objeto normalizado (normalizeProspect)

```typescript
{
  id: string,           // Airtable record ID: "recXXXXXXXXXXXX"
  name: string,         // "Prospect Name"
  stage: string,        // uno de los 5 stages
  amount: number,       // "Amount" || 0
  currency: string,     // "Currency" || "EUR"
  product: string,      // "Product"
  origin: string,       // "Origin"
  context: string,      // "Context"
  nextSteps: string,    // "Next Steps"
  assignedTo: string,   // "Assigned To"
  assignedEmail: string, // "Assigned Email"
  contactEmail: string, // "Contact Email" (primer email)
  contacts: [{          // JSON.parse("Contacts")
    name: string,
    email: string,
    role: string,
  }],
  dealManager: string,  // "Deal Manager"
  converted: boolean,   // "Converted"
  opportunityId: string, // "Opportunity ID"
  recordStatus: string, // "Record Status"
  tasks: any,           // "Tasks" (linked records array, no editar directamente)
  aiSummary: string,    // "AI Summary"
  aiSuggestedStage: string, // "AI Suggested Stage"
  aiGeneratedAt: string, // "AI Generated At"
  _raw: object,         // todos los fields Airtable sin procesar
}
```

### 2.5 Colores por stage

| Stage | Fondo | Texto | Borde | Color Kanban |
|-------|-------|-------|-------|-------------|
| Lead | `#F5F3FF` | `#6B21A8` | `#DDD6FE` | `#6366F1` |
| Interesado | `#ECFDF5` | `#047857` | `#A7F3D0` | `#3B82F6` |
| Reunion | `#FFFBEB` | `#D97706` | `#FDE68A` | `#8B5CF6` |
| Documentacion Pendiente | `#FFF7ED` | `#C2410C` | `#FED7AA` | `#F59E0B` |
| Listo para Term-Sheet | `#ECFDF5` | `#059669` | `#A7F3D0` | `#10B981` |

---

## 3. Kanban de Prospects — ProspectsView

### 3.1 Estructura del board

```
┌─ Kanban Board (overflow-x: auto, display: flex, gap: 16px) ────────────────────────────────────────┐
│                                                                                                      │
│  ┌─ Lead (290px) ─┐  ┌─ Interesado (290px) ─┐  ┌─ Reunion (290px) ─┐  ┌─ Doc. Pendiente ─┐  ┌─ Term-Sheet ─┐│
│  │  Header: count │  │  Header: count €sum   │  │  ...              │  │  ...             │  │  ...         ││
│  │  + Añadir      │  │                       │  │                   │  │                  │  │              ││
│  │  [Card]        │  │  [Card]               │  │  [Card]           │  │  [Card]          │  │  [Card]      ││
│  │  [Card]        │  │                       │  │                   │  │                  │  │              ││
│  └────────────────┘  └───────────────────────┘  └───────────────────┘  └──────────────────┘  └──────────────┘│
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Carga de datos

```typescript
async function loadProspects() {
  const all = await fetchAllProspects();
  // fetchAllProspects():
  //   GET paginado con filter: {Record Status}="Active"
  //   itera hasta que no haya offset
  //   normaliza cada record con normalizeProspect()

  // Deduplicación agresiva en cliente:
  // 1. Agrupa por nombre normalizado (sin acentos, lowercase, sin espacios extra)
  // 2. Agrupa por dominio del primer email de contacto
  // Para duplicados: gana el que tenga mayor "score" de completitud
  //   (stage avanzado + amount > 0 + product + contacts + context.length)
  
  setProspects(all.filter(p => !p.converted));
}
```

La carga se ejecuta en `useEffect` al montar `ProspectsView` y también al recuperar el foco de la ventana (`visibilitychange`).

### 3.3 Filtros disponibles

| Filtro | Tipo | Campo | Lógica |
|--------|------|-------|--------|
| Búsqueda texto | Input libre | `name`, `origin`, `product` | `toLowerCase().includes(query)` |
| Origen | Multi-pill | `origin` | Opciones: All / Referral / Evento / Campana / Cold Outreach / Web-Inbound / Pipeline / Otro |

### 3.4 KPI header

```
[N activos]  Pipeline total: €X.XM
```
- `N activos` = count de prospects filtrados (no necesariamente todos los del Kanban)
- Pipeline total = suma de `amount` de todos los prospects activos filtrados

### 3.5 Drag & Drop

Implementado con HTML5 nativo (`draggable`, `onDragStart`, `onDragEnd`, `onDragOver`, `onDragEnter`, `onDrop`).

**Al soltar en una columna diferente**:

```
Si targetStage === "Listo para Term-Sheet":
  → Abre diálogo de confirmación showConvertDialog

    Opción A: "Convertir a Oportunidad"
      → convertToOpportunity(prospect)
      → prospect desaparece del board (filtered by !p.converted)

    Opción B: "Solo mover sin convertir"
      → updateProspect(id, { Stage: "Listo para Term-Sheet" })
      → prospect permanece en la última columna

Si targetStage !== "Listo para Term-Sheet":
  → updateProspect(id, { Stage: targetStage })
  → (background) regenerateAiIntelligence(prospect) → Gemini genera nuevo AI Summary
```

### 3.6 Banner de Bridge Sync

Si `pendingSuggestions.length > 0` (calculado por `computeSyncSuggestions()`), aparece un banner amarillo/naranja encima del board:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ⚡ 2 sugerencias de avance de etapa detectadas (Bridge / CRM)                       │
│                                                                                      │
│ Empresa ABC → Reunion  (Bridge: etapa 'reunion' (abc@empresa.es))  [Aplicar] [✕]   │
│ Empresa XYZ → Documentacion Pendiente  (Bridge: etapa 'subida_docs')  [Aplicar] [✕] │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **"Aplicar"** → `updateProspect(id, { Stage: suggested })` + elimina la sugerencia del array
- **"✕" (Ignorar)** → añade `prospectId` al Set local `syncDismissed` (persiste en sesión, no en localStorage)

### 3.7 Card de Prospect en el Kanban

Cada card muestra:
- Nombre del prospect (negrita)
- Importe si `amount > 0`: formateado como `€XM` o `€XK`
- Producto (badge pequeño con gradiente morado-azul)
- Origen (badge pequeño gris)
- Contactos: número y avatar del primero (iniciales)
- Deal Manager (iniciales)
- Icono de tarea si hay tareas pendientes
- Click → abre `ProspectPanel` en modo edición

### 3.8 Botón "+ Añadir" en cabecera de columna

Al hacer clic en el `+` de cualquier columna:
- Abre `ProspectPanel` en modo creación (`isCreating=true`)
- Pre-establece `initialStage` con el stage de esa columna

---

## 4. Panel CRUD de Prospect — ProspectPanel

### 4.1 Diseño visual

- Slide-in desde la derecha con `transform: translateX`
- Ancho: `460px`
- Tema: dark (`background: '#0A1628'`)
- Backdrop con `backdrop-filter: blur(8px)`

### 4.2 Campos del formulario (en orden de aparición)

**1. AI Intelligence** (solo en edición si hay `aiSummary` o `matchedCompany`)
- Sección superior colapsable
- Muestra resumen IA y stage sugerido
- Botón "Regenerar" → llama Gemini con contexto de la empresa + emails CRM

**2. Nombre de la empresa** (required)
- `text input`
- Campo Airtable: `"Prospect Name"`

**3. Contactos** (multi-entrada dinámica)
- Por cada contacto: 4 inputs en línea: Nombre / Apellido / Email / Cargo
- Botón "×" para eliminar contacto
- Botón "+ Añadir contacto" para agregar fila
- Serialización: `JSON.stringify([{name: "Nombre Apellido", email, role}])`
- Campo Airtable `"Contacts"` = el JSON stringify anterior
- Campo Airtable `"Contact Email"` = email del primer contacto válido (backward compat)

**4. Stage** (required)
- `<select>` con los 5 valores
- Badge visual con color del stage

**5. Deal Manager**
- `<select>` con `TEAM_MEMBERS` (7 personas del equipo con su email)
- Campo Airtable: `"Deal Manager"`

**6. Importe + Moneda**
- Input numérico (solo dígitos, formateado en blur como `€1.500.000`)
- Select de moneda: EUR / USD / GBP
- Campos Airtable: `"Amount"` (number), `"Currency"` (singleSelect)

**7. Producto**
- `<select>` con optgroups:
  - Deuda: Corporate Debt, Project Finance, Development Debt, Project Finance Guaranteed
  - Equity: Investment, Co-Development, M&A
- Campo Airtable: `"Product"` (singleSelect)

**8. Origen**
- `<select>`: Referral, Evento, Campana, Cold Outreach, Web-Inbound, Pipeline, Otro
- Campo Airtable: `"Origin"` (singleSelect)

**9. Contexto / Notas de reunión**
- `<textarea>` (5 rows)
- Campo libre para notas, extractos de reunión, contexto histórico
- La IA puede prepender resúmenes con timestamp: `[2026-03-21 10:00] Resumen: ...`
- Campo Airtable: `"Context"`

**10. Próximos pasos** (collapsible ▶)
- `<textarea>` para next steps acordados
- Campo Airtable: `"Next Steps"`

**11. Actividad CRM** (collapsible, solo si `matchedCompany`)
- Muestra emails totales por empleado con barras de proporción
- Timeline por cuatrimestre con número de emails
- Últimos 5 emails: fecha + asunto

**12. Notas de reunión IA**
- `<textarea>` para pegar transcripción de reunión
- Botón "Generar resumen y tareas" → llama Gemini en paralelo:
  - `summarizeMeetingNotes(transcripción)` → prepende al campo Context
  - `extractTasksFromNotes(transcripción)` → crea tareas en el componente ProspectTasks

**13. Tareas** (componente `ProspectTasks`)
- Ver sección 5

### 4.3 Footer y acciones

| Botón | Visible | Acción |
|-------|---------|--------|
| Eliminar | Solo en edición | Muestra modal de confirmación → `deleteProspect(id)` |
| Convertir a Oportunidad | Solo en edición, no convertido | `convertToOpportunity(prospect)` |
| Crear prospect / Guardar cambios | Siempre | `handleSave()` |

### 4.4 handleSave() — Flujo de guardado

```typescript
async function handleSave() {
  // 1. Validar nombre (required)
  
  // 2. Construir fields del prospect
  const fields = {
    'Prospect Name': formData.name.trim(),
    'Stage': formData.stage,
    // singleSelects: omitir si vacíos (no enviar "" a Airtable)
    ...(formData.dealManager ? { 'Deal Manager': formData.dealManager } : {}),
    'Amount': parseAmount(formData.amount),  // número o undefined
    ...(formData.currency ? { 'Currency': formData.currency } : {}),
    ...(formData.product ? { 'Product': formData.product } : {}),
    ...(formData.origin ? { 'Origin': formData.origin } : {}),
    'Context': formData.context.trim(),
    'Next Steps': formData.nextSteps.trim(),
    ...(formData.assignedTo ? { 'Assigned To': formData.assignedTo } : {}),
    'Contact Email': validContacts[0]?.email || undefined,
    ...(formData.assignedEmail.trim() ? { 'Assigned Email': formData.assignedEmail.trim() } : {}),
    'Contacts': JSON.stringify(validContacts),  // siempre string JSON
    ...(isCreating ? { 'Record Status': 'Active' } : {}),
    // NOTA: NO incluir 'Tasks' en este payload (es linked record, se sincroniza aparte)
  };
  
  // 3. Crear o actualizar prospect
  if (isCreating) {
    await createProspect(fields);
  } else {
    await updateProspect(prospect.id, fields);
  }
  
  // 4. Sincronizar tasks (no bloquea el guardado si falla)
  if (tasks.length > 0) {
    await syncTasksToAirtable(tasks, prospect.opportunityId);
  }
  
  // 5. Callback de recarga
  onSave();
}
```

### 4.5 Matching con empresa del CRM

Al abrir el panel (tanto en creación como edición), el componente busca `matchedCompany` en el array `companies` (del CRM) usando esta lógica:

```typescript
function findMatchedCompany(prospect, companies) {
  const domains = prospect.contacts
    .map(c => c.email?.split('@')[1])
    .filter(Boolean);

  // Excluye dominios internos
  const INTERNAL_DOMAINS = ['gmail.com', 'atlassian.com', 'slack.com',
    'google.com', 'microsoft.com', 'dropbox.com', 'hubspot.com', ...];

  // 1. Match por dominio de email
  const domainMatch = companies.find(c => domains.includes(c.domain));
  if (domainMatch) return domainMatch;

  // 2. Match por nombre exacto (case-insensitive, sin acentos)
  const nameMatch = companies.find(c =>
    normalize(c.name) === normalize(prospect.name));
  if (nameMatch) return nameMatch;

  // 3. Match por nombre contains (mínimo 4 chars)
  return companies.find(c =>
    normalize(c.name).includes(normalize(prospect.name).slice(0, 4)));
}
```

---

## 5. Sistema de Tareas — ProspectTasks y airtableTasks

### 5.1 Modelo de una tarea (objeto frontend local)

```typescript
{
  id: string,             // "task_" + Date.now().toString(36) + random(3 chars)
  text: string,           // título de la tarea (editable inline)
  description: string,    // descripción adicional
  status: "pendiente" | "en_curso" | "hecho",
  assignedTo: string,     // nombre de un TEAM_MEMBER
  dueDate: string,        // ISO date string "YYYY-MM-DD"
  createdAt: string,      // ISO datetime
  notifiedAt: string,     // ISO datetime de cuándo se envió notificación
  airtableId?: string,    // ID del record en "Internal - Tasks" tras sync
}
```

### 5.2 Tabla Airtable — Internal - Tasks

Tabla separada en la misma base (`appVu3TvSZ1E4tj0J`).

**Campos enviados al crear/actualizar**:

| Campo Airtable | Tipo | Fuente |
|----------------|------|--------|
| `Name` | singleLineText | `task.text` |
| `Status` | singleSelect | `STATUS_MAP[task.status]`: `pendiente→"To do"`, `en_curso→"Doing"`, `hecho→"Done"` |
| `Description` | longText | `task.description` |
| `Deadline` | date | `task.dueDate` |
| `Owner` | multipleRecordLinks | `[resolveOwner(task.assignedTo)]` — record ID de `Config - Users` |
| `Opportunity` | multipleRecordLinks | `[opportunityId]` — si el prospect ya fue convertido |

### 5.3 Tabla auxiliar — Config - Users

Tabla `Config - Users` (ID: `tblb3kyXSnXS0GPjy`) que mapea nombre de persona → Airtable record ID.

`resolveOwner(name)`:
1. `fetchAllUsers()` → GET paginado de `Config - Users`
2. Busca la fila donde `fields.Name` coincide con `assignedTo` (case-insensitive)
3. Retorna el record ID (`recXXX`) para usar como linked record en `Owner`

### 5.4 syncTasksToAirtable()

```typescript
async function syncTasksToAirtable(tasks, opportunityId?) {
  const results = [];
  for (const task of tasks) {
    if (!task.airtableId) {
      // POST: crear nueva tarea
      const rec = await createAirtableTask(task, opportunityId);
      results.push({ ...task, airtableId: rec.id });
    } else {
      // PATCH: actualizar tarea existente
      await updateAirtableTask(task.airtableId, task, opportunityId);
      results.push(task);
    }
  }
  return { tasks: results, synced: results.length, errors: 0 };
}
```

Se llama en `handleSave()` **después** de guardar el prospect. Si falla no impide el guardado del prospect.

### 5.5 UI de tareas en el ProspectPanel

- Agrupadas en 3 secciones: Pendiente / En curso / Hecho
- "Hecho" colapsado por defecto (expandible con click)
- Cada tarea:
  - Dot de status clickable → cicla: `pendiente → en_curso → hecho → pendiente`
  - Input de título editable inline
  - Textarea de descripción (expandible)
  - Dropdown de asignación (TEAM_MEMBERS)
  - Date picker para fecha límite
  - Indicador "✉ Notificado" si `notifiedAt` está set

**Templates rápidos** (botón "+ Nueva tarea" → desplegable):
- "Convocar reunion"
- "Reclamar informacion"
- "Preparar Term-Sheet"
- "+ Otra" (tarea en blanco)

---

## 6. Cómo se alimenta Prospects desde el CRM de Empresas

### 6.1 Mecanismo via URL params

No hay un botón directo "Añadir a Prospects" en la ficha de empresa ni en la tabla. El flujo es via parámetros URL:

```
/?view=prospects&add=NombreEmpresa&stage=Lead
```

`App.tsx` intercepta estos params al montar:

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "prospects") {
    setActiveView("prospects");
    const addName = params.get("add");
    const stage = params.get("stage") || "Lead";
    if (addName) {
      setNewProspectStage(stage);
      setIsCreatingProspect(true);
      // Nota: addName NO se pre-rellena en el formulario automáticamente.
      // El usuario debe escribir el nombre manualmente.
      // El stage sí se pre-rellena con el valor del param.
    }
  }
}, []);
```

### 6.2 Flujo cuando un contacto de campaña responde positivamente

Cuando Leticia (agente de campaña) recibe una respuesta interesante:

1. Ve la empresa en `BridgeCampaignView` con `bestStatus: "Respondido"`
2. Abre `BridgeSlideOverPanel` para ver la conversación
3. Navega manualmente a Prospects (tab en la navegación principal)
4. Crea un nuevo prospect con el nombre de la empresa
5. Al escribir el email del contacto, el panel detecta `matchedCompany` automáticamente y muestra la actividad CRM

O bien, si `bridgeProspectSync.ts` ya ha sugerido el avance:
1. La sugerencia aparece en el banner del Kanban de Prospects
2. Si el prospect ya existe → botón "Aplicar" mueve el stage
3. Si no existe → el equipo lo crea manualmente

### 6.3 Datos que se pre-cargan desde el CRM

Una vez el `ProspectPanel` detecta `matchedCompany` (por dominio de email o nombre), muestra en la sección "Actividad CRM":
- Emails totales por empleado
- Timeline por cuatrimestre
- Últimos 5 emails: fecha + asunto

Esta información es **solo lectura** en el panel. El usuario puede copiar y pegar en el campo Context si considera relevante.

---

## 7. Conversión Prospect → Oportunidad Airtable

### 7.1 Cuándo se activa

1. **Drag & Drop** de la card a la columna "Listo para Term-Sheet" → diálogo con opción "Convertir a Oportunidad"
2. **Botón "Convertir a Oportunidad"** en el footer del `ProspectPanel` (solo visible si no convertido)

### 7.2 Función convertToOpportunity()

```typescript
async function convertToOpportunity(prospect) {
  // Paso 1: Crear en tabla Opportunities de Airtable
  const oppFields = {
    "Opportunity Name": prospect.name,
    "Global Status": "Origination - Termsheet",  // stage inicial del Pipeline
    "Targeted Ticket Size": prospect.amount || 0,
    "Currency": prospect.currency || "EUR",
    "Notes": [
      "Convertido desde Prospect.",
      "",
      "Contexto:",
      prospect.context || "",
      "",
      "Próximos pasos:",
      prospect.nextSteps || "",
    ].join("\n"),
    "Record Status": "Active",
  };

  const newOpp = await createOpportunity(oppFields);
  // createOpportunity usa la misma tabla "Opportunities" que el Pipeline Kanban

  // Paso 2: Marcar el prospect como convertido
  await updateProspect(prospect.id, {
    "Converted": true,
    "Opportunity ID": newOpp.id,
    "Stage": "Listo para Term-Sheet",
  });

  return { opportunity: newOpp, prospect: updatedProspect };
}
```

### 7.3 Resultado post-conversión

- El prospect con `converted: true` es filtrado del Kanban de Prospects (no aparece)
- La nueva Opportunity aparece en el **Pipeline Kanban** en el stage `"Origination - Termsheet"`
- El `opportunityId` se guarda en el prospect por si se necesita enlazar tareas

### 7.4 Flujo de stages completo

```
PROSPECTS (Airtable BETA-Prospects)
─────────────────────────────────────────────────────────
Lead → Interesado → Reunion → Documentacion Pendiente → Listo para Term-Sheet
                                                                │
                                                    convertToOpportunity()
                                                                │
                                                                ▼
PIPELINE (Airtable Opportunities)
─────────────────────────────────────────────────────────────────────────────
Origination-Termsheet → Mandate → Due Diligence → Credit → Legal → Closed-Won
                                                                   (o Closed-Lost)
```

---

## 8. Sistema de Campañas — Arquitectura General

### 8.1 Componentes del sistema

```
React (frontend)
├── CampaignsView.tsx          — lista de campañas con KPIs
├── CampaignCreationPanel.tsx  — wizard 6 pasos para crear campaña
├── CampaignDetailView.tsx     — detalle: métricas, contactos, respuestas, follow-ups
├── BridgeCampaignView.jsx     — dashboard Bridge: tabla empresas + Pipeline kanban
└── BridgeSlideOverPanel.tsx   — panel conversación Gmail + editor de borrador

src/utils/
├── campaignApi.ts             — todas las llamadas al GAS backend
└── airtableCandidates.ts      — tabla CampaignTargets (candidatos revisados)

api/
├── campaign-proxy.js          — proxy Vercel hacia GAS Web App
└── airtable-proxy.js          — proxy Vercel hacia Airtable

scripts/gas/
└── campaignBackend.gs         — GAS: lógica de email, Gemini, Google Sheets
```

### 8.2 Diagrama de flujo de una campaña

```
1. PREPARACIÓN
   ┌─ BridgeExplorerView ─────────────────────────────────────────────┐
   │  Busca empresas del CRM que cumplen criterios (Originación,       │
   │  >10 interacciones, contacto CFO/CEO, etc.)                       │
   │  Permite previsualizar email personalizado con IA                 │
   │  Botón "Añadir a wave" → upsertCandidateTarget() en Airtable      │
   └──────────────────────────────────────────────────────────────────┘
                      │
                      ▼ Revisión humana en CampaignTargets
                      │  (approve/reject por empresa)
                      ▼
2. CREACIÓN (CampaignCreationPanel — 6 pasos)
   Paso 1: Nombre + tipo (mass | continuada)
   Paso 2: Remitente (senderEmail, senderName)
   Paso 3: Email A (subjectA, bodyA en HTML)
   Paso 4: Email B — A/B Test opcional (subjectB, bodyB)
   Paso 5: % A/B (abTestPercent) + destinatarios (contacts[])
   Paso 6: Confirmación → createCampaign() → GAS crea sheets
                      │
                      ▼
3. ENVÍO
   startCampaign(campaignId) → GAS itera Recipients sheet
   → GmailApp.sendEmail() por cada destinatario
   → tracking: status=sent, sentTime
                      │
                      ▼
4. TRACKING (automático via Gmail triggers en GAS)
   Aperturas: GAS detecta via pixel tracking o Gmail API
   Clics: redirect tracking URL
   Respuestas: GAS escanea replies → classifyReply() con Gemini
                      │
                      ▼
5. RESPUESTAS (CampaignDetailView → Tab "Respuestas")
   Para cada respuesta:
   getConversation(email) → hilo Gmail completo
   composeFromInstructions(instructions) → Gemini genera respuesta HTML
   saveDraft() → guarda borrador en Gmail
   sendDraft() → envía el email
                      │
                      ▼
6. FOLLOW-UPS (Tab "Seguimiento")
   Elegibles: abrieron o hicieron clic pero no respondieron
   generateFollowUpBatch(contacts, instructions) → Gemini genera borradores
   sendFollowUpBatch() → envía follow-ups
                      │
                      ▼
7. PIPELINE (BridgeCampaignView → Tab "Pipeline")
   Contactos interesados se mueven manualmente o via IA:
   moveStage(email, newStage) → GAS actualiza Pipeline sheet
   
   Stages: nurturing → reunion → subida_docs → doc_completada | descartado
                      │
                      ▼
8. SINCRONIZACIÓN CON PROSPECTS
   bridgeProspectSync.ts detecta avances en Pipeline
   → genera SyncSuggestion[]
   → ProspectsView muestra banners
   → usuario aplica o ignora sugerencias
```

---

## 9. Modelo de Datos — Google Sheets del GAS Backend

El GAS backend gestiona su propio estado en 4 tabs de un Google Spreadsheet.

### 9.1 Sheet: Campaigns

**Headers**:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | string | UUID v4 generado al crear |
| `name` | string | Nombre de la campaña |
| `type` | string | `mass` \| `continuada` |
| `status` | string | `draft` \| `active` \| `paused` \| `completed` \| `cancelled` |
| `senderEmail` | email | Email del remitente |
| `senderName` | string | Nombre del remitente |
| `subjectA` | string | Asunto variante A |
| `bodyA` | HTML | Cuerpo HTML variante A |
| `subjectB` | string | Asunto variante B (A/B test) |
| `bodyB` | HTML | Cuerpo HTML variante B |
| `abTestPercent` | number | % de recipients que reciben variante A |
| `abWinnerCriteria` | string | `opens` \| `clicks` \| `replies` |
| `abWinner` | string | `A` \| `B` \| `""` |
| `totalRecipients` | number | Total de destinatarios |
| `totalSent` | number | Emails enviados |
| `totalOpened` | number | Emails abiertos |
| `totalClicked` | number | Emails con clic |
| `totalReplied` | number | Emails con respuesta |
| `createdTime` | ISO datetime | Fecha creación |
| `startedTime` | ISO datetime | Fecha primer envío |
| `completedTime` | ISO datetime | Fecha finalización |
| `notes` | string | Notas internas |
| `knowledgeBase` | string | Contexto de conocimiento para IA |

### 9.2 Sheet: Recipients

**Headers**:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | string | UUID v4 |
| `campaignId` | string | FK → Campaigns.id |
| `email` | email | Email del destinatario |
| `name` | string | Nombre |
| `lastName` | string | Apellido |
| `organization` | string | Empresa |
| `status` | string | `pending` \| `sent` \| `opened` \| `clicked` \| `replied` \| `error` |
| `variant` | string | `A` \| `B` |
| `openCount` | number | Número de aperturas |
| `clickCount` | number | Número de clics |
| `messageId` | string | Gmail messageId para tracking de hilo |
| `sentTime` | ISO datetime | Fecha de envío |
| `openedTime` | ISO datetime | Primera apertura |
| `clickedTime` | ISO datetime | Primer clic |

### 9.3 Sheet: FollowUps

**Headers**:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | string | UUID v4 |
| `email` | email | Email del destinatario |
| `name` | string | Nombre |
| `organization` | string | Empresa |
| `status` | string | `scheduled` \| `generating` \| `draft_ready` \| `sent` \| `cancelled` |
| `instructions` | string | Instrucciones en lenguaje natural para Gemini |
| `scheduledAt` | ISO datetime | Fecha programada de envío |
| `senderEmail` | email | Email del remitente |
| `senderName` | string | Nombre del remitente |
| `draftHtml` | HTML | Cuerpo HTML generado por Gemini |
| `sentTime` | ISO datetime | Fecha real de envío |
| `createdTime` | ISO datetime | Fecha creación |
| `cancelledTime` | ISO datetime | Fecha cancelación |

### 9.4 Sheet: Pipeline

**Headers**:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `email` | email | PK (email del contacto) |
| `etapa` | string | `nurturing` \| `reunion` \| `subida_docs` \| `doc_completada` \| `descartado` |
| `etapaAnterior` | string | Stage anterior (para historial) |
| `fechaCambio` | ISO datetime | Última vez que cambió de stage |
| `fechaCreacion` | ISO datetime | Fecha de incorporación al pipeline |
| `notas` | JSON string | Array de `{texto, fecha, autor}` |
| `historial` | JSON string | Array de `{etapa, fecha}` con todos los cambios |

---

## 10. API de Campañas — Referencia Completa de Acciones GAS

### 10.1 Infraestructura del proxy

Todas las llamadas desde el frontend pasan por:

```
Browser → POST /api/campaign-proxy {action, ...params} [x-proxy-secret]
    → Vercel campaign-proxy.js
         ├── GET_ACTIONS → GET {GAS_URL}?action=...&params (sin token)
         └── POST_ACTIONS → POST {GAS_URL} {action, token: GAS_API_TOKEN, ...params}
              → campaignBackend.gs doGet/doPost
```

**Variables de entorno en Vercel** (server-side):
- `GAS_WEB_APP_URL` — URL del Web App desplegado del GAS
- `GAS_API_TOKEN` — token de autorización para acciones POST
- `CAMPAIGN_PROXY_SECRET` — validación del header `x-proxy-secret`

**Script Properties en GAS** (configuradas en el editor de Apps Script):
- `API_TOKEN` — mismo valor que `GAS_API_TOKEN`
- `GEMINI_API_KEY` — clave de Gemini API
- `LEGACY_SHEET_ID` — ID del Google Sheet del tracking Bridge original
- `CAMPAIGN_SHEET_ID` — ID del Google Sheet del backend de campañas
- `SENDER_EMAIL` / `SENDER_NAME` — remitente por defecto (Leticia)

### 10.2 Tabla completa de acciones

#### Acciones GET (sin token, params en query string)

| Acción GAS | Función TS | Parámetros | Respuesta |
|-----------|-----------|-----------|---------|
| `dashboard` | `fetchSentDomains()` | — | `{ contactos[], metricas{Global, A, B, Final} }` |
| `pipeline` | `fetchBridgePipelineCards()` | — | `{ pipeline: [{email, etapa, notas, historial, nombre, organizacion}] }` |
| `getConversation` | `getConversation(email, campaignId)` | `email`, `campaignId` | `{ respuesta, borrador{draftId, cuerpo, asunto, existe}, historial[] }` |
| `getConversacionCompleta` | — | `email` | Hilo Gmail completo sin truncar |
| `getFollowUpCandidates` | `getFollowUpCandidates(id)` | `campaignId` | Lista contactos elegibles para follow-up |
| `getConversaciones` | — | `campaignId` | Todas las conversaciones de una campaña |
| `getCampaigns` | `getCampaigns()` | `status?` | Lista campañas (fallback a Airtable si falla) |
| `getCampaign` | `getCampaign(id)` | `id` | Una campaña concreta (fallback a Airtable) |

#### Acciones POST (con token en body)

| Acción GAS | Función TS | Parámetros clave | Qué hace |
|-----------|-----------|-----------------|---------|
| `createCampaign` | `createCampaign(data)` | `name, type, senderEmail, senderName, subjectA, bodyA, subjectB?, bodyB?, abTestPercent?, recipients[]` | Crea campaña y recipients en Google Sheets |
| `startCampaign` | `startCampaign(id)` | `campaignId` | GmailApp envía emails a todos los recipients `pending`, actualiza `status=sent` |
| `updateCampaignStatus` | `updateCampaignStatus(id, status)` | `campaignId, status` | Cambia estado: `active/paused/completed/cancelled` |
| `addRecipients` | `addRecipients(id, recipients)` | `campaignId, recipients[]` | Añade nuevos recipients a campaña existente |
| `getCampaignRecipients` | `getCampaignRecipients(id)` | `campaignId` | Lista todos los recipients de una campaña |
| `updateCampaign` | `updateCampaign(id, fields)` | `campaignId, fields{}` | Actualiza campos de campaña (name, status, notes...) |
| `getCampaignDashboard` | `getCampaignDashboard(id)` | `campaignId` | Dashboard específico de campaña |
| `getFollowUps` | `getFollowUps(filters)` | `campaignId?, status?` | Lista follow-ups filtrados |
| `scheduleFollowUp` | `scheduleFollowUp(data)` | `email, name, organization, instructions, scheduledAt, senderEmail, senderName` | Crea registro en FollowUps sheet con `status=scheduled` |
| `cancelFollowUp` | `cancelFollowUp(id)` | `followUpId` | Cambia status a `cancelled` (solo si `scheduled` o `draft_ready`) |
| `generateFollowUp` | (interno) | `email, instructions?` | Gemini genera HTML de follow-up para 1 contacto |
| `generateFollowUpBatch` | `generateFollowUpBatch({campaignId, contacts, instructions})` | `contacts: [{email}], instructions` | Gemini genera HTML para hasta 15 contactos en paralelo |
| `sendFollowUpBatch` | `sendFollowUpBatch({campaignId, contacts})` | `contacts: [{email, followUpId}]` | Envía borradores listos via GmailApp |
| `getConversation` | `getConversation(email, id)` | `email, campaignId` | Hilo Gmail + borrador (mismo que GET pero con POST) |
| `sendDraft` | `sendDraft({email, campaignId, draftId?, editedBody?})` | `email, draftId?, cuerpoEditado?` | Envía borrador. Si editedBody: borra draft viejo, crea nuevo, envía |
| `saveDraft` | `saveDraft({email, campaignId, body})` | `email, borradorCuerpo` | Guarda/actualiza borrador Gmail |
| `composeFromInstructions` | `composeFromInstructions({email, campaignId, instructions})` | `email, instructions` | Gemini genera email HTML desde instrucciones en lenguaje natural |
| `classifyReply` | `classifyReply({email, campaignId, replyText})` | `email, replyText` | Gemini clasifica respuesta: `interesado/reunion/no_interesado/informacion/fuera_oficina/otro` + sentiment |
| `moveStage` | — | `email, newStage` | Actualiza Pipeline sheet: `etapa, etapaAnterior, fechaCambio, historial` |
| `addNote` | — | `email, texto, autor` | Append a `notas[]` del registro en Pipeline sheet |
| `sendTestEmail` | `sendTestEmail(id, testEmail)` | `campaignId, testEmail` | Envía copia con asunto `[TEST] ...` |
| `uploadMeetingNotes` | — | `prospectId, notes, driveFolder` | Sube notas a Google Drive |

### 10.3 Estructura de métricas del dashboard GAS

```typescript
// Respuesta de proxyFetch('dashboard')
{
  contactos: [{
    email: string,
    nombre: string,
    apellido: string,
    organizacion: string,
    estado: "Respondido" | "Clic" | "Abierto" | "Enviado" | "Error" | "",
    numAperturas: number,
    numClics: number,
    respondido: boolean,
    fechaEnvio: string,
    primeraApertura: string,
    primerClic: string,
    respuestaEnviada: "Si" | "",
    seguimientosEnviados: number,
  }],
  metricas: {
    Global: {
      enviados: number, abiertos: number, clics: number, respondidos: number,
      tasaApertura: number, tasaClics: number, tasaRespuesta: number
    },
    A: { ... mismo esquema ... },
    B: { ... mismo esquema ... },
    Final: { ... mismo esquema ... },
  }
}
```

### 10.4 Estructura de la respuesta de getConversation

```typescript
{
  success: boolean,
  respuesta: {         // última respuesta recibida de contacto externo, o null
    fecha: string,
    cuerpo: string,
    estado: "recibido",
  } | null,
  borrador: {          // borrador Gmail en preparación, o vacío
    draftId: string,
    cuerpo: string,     // HTML del borrador
    asunto: string,
    existe: boolean,
    estado: "listo" | "preparando" | "",
  },
  historial: [{        // todos los mensajes del hilo, cronológico
    fecha: string,
    remitente: string,
    esLeticia: boolean,  // true si el email es @alter-5.com o @alter5.com
    cuerpo: string,      // max 2000 chars del body
    asunto: string,
  }],
}
```

---

## 11. Vista Bridge Campaign — BridgeCampaignView

### 11.1 Estructura de la vista

Dos tabs principales:

```
┌─ Tab "Empresas" ────────────────────────────────────────────────────────────────────┐
│                                                                                      │
│  KPI boxes: [Total contactos] [Respondidos] [En Pipeline] [Tasa apertura]           │
│  Funnel A/B: variante A vs B (tasas aperturas/clics/respuestas)                     │
│                                                                                      │
│  Filtros: [Todos] [Respondido] [Clic] [Abierto] [Enviado]  🔍 buscar               │
│                                                                                      │
│  Tabla de empresas:                                                                  │
│  ┌─ Empresa ──────┬── Estado ──┬── Contactos ─┬── Aperturas ─┬── Clics ─┬── Resp.─┐│
│  │ Empresa ABC    │ Respondido │ 2            │ 3            │ 1        │ 1       ││
│  │ Empresa XYZ    │ Abierto    │ 1            │ 2            │ 0        │ 0       ││
│  └────────────────┴────────────┴──────────────┴──────────────┴──────────┴─────────┘│
│                                                                                      │
│  Click en empresa → abre BridgeSlideOverPanel                                        │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌─ Tab "Pipeline" ────────────────────────────────────────────────────────────────────┐
│                                                                                      │
│  Kanban Bridge (4 columnas + descartados):                                           │
│  ┌─ Nurturing ─┐  ┌─ Reunión ──┐  ┌─ Subida docs ─┐  ┌─ Doc completada ─┐         │
│  │ [Card email]│  │ [Card]    │  │ [Card]        │  │ [Card]          │         │
│  │ [Card email]│  │           │  │               │  │                 │         │
│  └─────────────┘  └───────────┘  └───────────────┘  └─────────────────┘         │
│                                                                                      │
│  Descartados: collapsible                                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Agrupación de contactos por empresa

```javascript
function buildCompanyData(contactos) {
  const byOrg = {};
  for (const c of contactos) {
    const org = c.organizacion || "Sin empresa";
    if (!byOrg[org]) {
      byOrg[org] = {
        org,
        contactos: [],
        total: 0, enviados: 0, abiertos: 0, clics: 0, respondidos: 0, errores: 0,
        bestStatus: "",  // "Respondido" > "Clic" > "Abierto" > "Enviado" > ""
        bestRank: 0,     // para ordenación
      };
    }
    byOrg[org].contactos.push(c);
    byOrg[org].total++;
    if (c.estado === "Respondido") byOrg[org].respondidos++;
    else if (c.estado === "Clic") byOrg[org].clics++;
    else if (c.estado === "Abierto") byOrg[org].abiertos++;
    else if (c.estado === "Enviado") byOrg[org].enviados++;
    // bestStatus = el de mayor rango entre todos los contactos de la empresa
  }
  return Object.values(byOrg).sort((a, b) => b.bestRank - a.bestRank);
}
```

Al hacer clic en una empresa de la tabla, se abre `BridgeSlideOverPanel` con el contacto de mayor engagement.

### 11.3 Kanban Bridge Pipeline (Tab "Pipeline")

Etapas del Pipeline Bridge (de `fetchBridgePipelineCards()`):

| ID GAS | Label UI | Color | Relación con Prospects |
|--------|----------|-------|----------------------|
| `nurturing` | Nurturing | — | No mapea a stage de Prospect |
| `reunion` | Reunión | `#8B5CF6` | → `"Reunion"` |
| `subida_docs` | Subida docs | `#F59E0B` | → `"Documentacion Pendiente"` |
| `doc_completada` | Doc completada | `#10B981` | → `"Listo para Term-Sheet"` |
| `descartado` | Descartado | `#EF4444` | No genera sugerencia |

**Sugerencias automáticas en el Pipeline** (`getSuggestions(card)`):
- Si `etapa === 'nurturing'` Y `numAperturas + numClics >= 4` → sugerir mover a `reunion`
- Si `notas[]` contienen palabras `reunion/meeting/llamada/agenda` → sugerir `reunion`
- Si `notas[]` contienen `no interesa/unsubscribe/baja` → sugerir `descartado`

Cada card del Kanban tiene un botón con las sugerencias y permite moverla manualmente via `moveStage(email, newStage)`.

---

## 12. Panel de Conversación — BridgeSlideOverPanel

### 12.1 Layout

Panel de ancho completo o 2 columnas (responsive):

```
┌─ Columna izquierda (480px fija) ──┬─ Columna derecha (flexible) ──────────────────┐
│                                   │                                                │
│  Header: info del contacto        │  Header: "Respuesta de Leticia"                │
│  (nombre, empresa, etapa)         │                                                │
│                                   │  Estado del borrador:                          │
│  Hilo de conversación:            │    [preparando...] spinner                     │
│    ┌─ Avatar + nombre ──────────┐  │    [borrador listo] tabs: Vista previa / Editar│
│    │ Último mensaje de Leticia  │  │    [sin borrador] mensaje informativo          │
│    └────────────────────────────┘  │                                                │
│    ┌─ Avatar + nombre ──────────┐  │  Vista previa: HTML renderizado (DOMPurify)   │
│    │ Respuesta del contacto     │  │  Editar: textarea con HTML raw (JetBrains Mono│
│    │ [Pendiente de respuesta]   │  │                                                │
│    └────────────────────────────┘  │  [Banner "Borrador modificado" si isDraftModified]│
│                                   │                                                │
│  (auto-scroll al último)          │  Footer: [Guardar borrador] [Enviar respuesta] │
│                                   │                                                │
└───────────────────────────────────┴────────────────────────────────────────────────┘
```

### 12.2 Carga de datos

Al abrir el panel:
```typescript
const data = await proxyFetch('getConversation', {
  email: contacto.email,
  campaignId: campaignId,
});
// Carga: historial[], respuesta (si hay), borrador (si preparado)
```

### 12.3 Rendering del historial

Cada `MensajeHilo` en la columna izquierda:
- **Avatar**: "LM" azul si `esLeticia=true`; iniciales del contacto en verde si es externo
- **Badge "Leticia (IA)"**: si `esLeticia=true`
- **Badge "Pendiente de respuesta"**: si es el último mensaje externo (sin respuesta de Leticia aún)
- **Cuerpo**: si detecta HTML (`/<[a-z][\s\S]*>/i`) → `DOMPurify.sanitize(cuerpo)` como `innerHTML`; si es texto plano → `stripMarkdown(cuerpo)` como texto
- **Truncado**: a 400 chars con botón "Ver más / Ver menos"

### 12.4 Editor de borrador

**Detección de modificación**: `isDraftModified = draftText !== originalDraft`

Si el borrador fue modificado → banner ámbar:
```
⚠ Borrador modificado — recuerda guardar antes de enviar
```

**Guardar borrador**:
```typescript
await proxyFetch('saveDraft', {
  email: contacto.email,
  borradorCuerpo: draftText,
});
// GAS: busca draft existente en Gmail, lo borra, crea nuevo con el cuerpo actualizado
```

**Enviar respuesta**:
```typescript
// Primero muestra modal de confirmación con preview de 150 chars
await proxyFetch('sendDraft', {
  email: contacto.email,
  draftId: conversacion.borrador.draftId,
  cuerpoEditado: isDraftModified ? draftText : undefined,
});
// GAS:
//   SI cuerpoEditado: borra draft viejo → crea nuevo con cuerpo editado → envía
//   SI NO cuerpoEditado: envía el draft directamente sin modificar
```

### 12.5 Generación de respuesta con IA

Botón "Generar con instrucciones":
```typescript
await proxyFetch('composeFromInstructions', {
  email: contacto.email,
  campaignId: campaignId,
  instructions: instruccionesInput,
});
// GAS: Gemini genera HTML email usando:
//   - instrucciones del usuario
//   - contexto de conversación Gmail (últimos 5 mensajes)
//   - nombre y empresa del contacto
// Resultado: cuerpoHtml → se rellena en el textarea del editor
```

---

## 13. Sincronización Bridge → Prospects

### 13.1 Mapa de etapas Bridge → Prospects

```typescript
const BRIDGE_TO_PROSPECT: Record<string, string> = {
  reunion:        'Reunion',
  subida_docs:    'Documentacion Pendiente',
  doc_completada: 'Listo para Term-Sheet',
  // 'nurturing' y 'descartado' NO generan sugerencia de avance
};
```

### 13.2 Función computeSyncSuggestions()

```typescript
function computeSyncSuggestions(
  prospects: Prospect[],
  bridgeCards: BridgeCard[],
  companies: Company[],
  companyByName: Map<string, Company>
): SyncSuggestion[]
```

**Por cada prospect** (que no tenga su `prospectId` en `syncDismissed`):

1. **Señal Bridge**: `matchProspectToBridge(prospect, bridgeCards)`
   - Extrae dominios de `prospect.contactEmail` + todos los `prospect.contacts[].email`
   - Filtra `bridgeCards` cuyo `card.email.split('@')[1]` coincida con algún dominio
   - Excluye cards con `etapa === 'descartado'`
   - Elige la card con etapa más avanzada (orden: nurturing < reunion < subida_docs < doc_completada)
   - Mapea etapa → Prospect stage vía `BRIDGE_TO_PROSPECT`

2. **Señal CRM**: `detectMeetingFromCRM(prospect, company)`
   - Busca `company` por dominio del email del contacto
   - Analiza `company.detail.datedSubjects[]` y `company.detail.subjects[]`
   - Keywords: `reunion`, `reunión`, `llamada`, `meeting`, `call`, `agenda`, `convocatoria`, `videollamada`, `teams`, `zoom`
   - Si encuentra ≥1 keyword → sugiere stage `'Reunion'`

3. **Decide sugerencia final**:
   - Si ambas señales → toma la más avanzada
   - Solo genera `SyncSuggestion` si el stage sugerido es **más avanzado** que el actual

**Función `stageIsMoreAdvanced(a, b)`**:
```typescript
const STAGE_ORDER = ['Lead', 'Interesado', 'Reunion', 'Documentacion Pendiente', 'Listo para Term-Sheet'];
return STAGE_ORDER.indexOf(a) > STAGE_ORDER.indexOf(b);
```

### 13.3 Objeto SyncSuggestion

```typescript
{
  prospectId: string,       // Airtable record ID del prospect
  prospectName: string,     // nombre para mostrar en el banner
  currentStage: string,     // stage actual del prospect
  suggestedStage: string,   // stage sugerido (más avanzado)
  source: 'bridge' | 'crm-meeting',  // fuente de la señal
  evidence: string[],       // explicación: ["Bridge: etapa 'reunion' (abc@empresa.es)"]
}
```

### 13.4 Ejecución en ProspectsView

```typescript
// En processProspects() (llamado al cargar la vista):
fetchBridgePipelineCards()
  .then(cards => {
    const suggestions = computeSyncSuggestions(
      prospects, cards, companies, companyByNameMap
    );
    setPendingSuggestions(suggestions.filter(s => !syncDismissed.has(s.prospectId)));
  })
  .catch(() => {}); // no bloquea la carga
```

La llamada a `fetchBridgePipelineCards()` es **asíncrona y en background** — no bloquea el render del Kanban.

---

## 14. Tabla CampaignTargets (Airtable)

### 14.1 Propósito

`CampaignTargets` es una tabla de Airtable usada para la **revisión humana** de candidatos para campañas outbound. Permite:
1. Añadir empresas del CRM como candidatas para una wave de campaña
2. Revisar y aprobar/rechazar cada candidata
3. Gestionar múltiples waves (oleadas) de la misma campaña

### 14.2 Configuración

| Parámetro | Valor |
|-----------|-------|
| Tabla | `CampaignTargets` |
| Base | `appVu3TvSZ1E4tj0J` |
| Cliente | `src/utils/airtableCandidates.ts` |
| Proxy | `/api/airtable-proxy` |

### 14.3 Campos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `Domain` | singleLineText | PK: dominio de la empresa |
| `CompanyName` | singleLineText | Nombre de la empresa |
| `Status` | singleSelect | `pending` \| `approved` \| `rejected` |
| `SelectedContacts` | multilineText | JSON.stringify de `[{name, email, role}]` |
| `CampaignRef` | singleLineText | ID de wave: `Bridge_Q1`, `Bridge_Q1_W2`, etc. |
| `Segment` | singleLineText | Segmento de la empresa |
| `CompanyType` | singleLineText | Tipo de empresa |
| `Technologies` | multilineText | JSON.stringify de array de tecnologías |
| `ReviewedBy` | singleLineText | ID del empleado revisor |
| `ReviewedAt` | date | Fecha de revisión |
| `Notes` | longText | Notas manuales del revisor |

### 14.4 Sistema de Waves

El campo `CampaignRef` codifica la wave:
```
Bridge_Q1       → Wave 1 (original)
Bridge_Q1_W2    → Wave 2
Bridge_Q1_W3    → Wave 3
```

**`fetchAllBridgeTargets(refPrefix = "Bridge_Q1")`**:
```typescript
// Fórmula Airtable: FIND("Bridge_Q1", {CampaignRef}) = 1
// Itera paginando hasta traer todos los records
// Para duplicados (mismo dominio en varias waves):
//   extrae wave number con /_W(\d+)$/
//   gana el de wave más reciente (mayor número)
// Retorna: { allTargets: Map<domain, record>, maxWave: number }
```

### 14.5 Funciones del cliente

```typescript
// Lee targets de UNA wave concreta
fetchCandidateTargets(campaignRef: string): Promise<Map<domain, record>>

// UPSERT: si record.id → PATCH, si no → POST
upsertCandidateTarget(record: {
  id?: string,
  domain: string,
  companyName: string,
  status: "pending" | "approved" | "rejected",
  selectedContacts?: Contact[],
  campaignRef: string,
  segment?: string,
  companyType?: string,
  technologies?: string[],
  reviewedBy?: string,
  reviewedAt?: string,
  notes?: string,
})

// Lee todas las waves del prefijo
fetchAllBridgeTargets(refPrefix: string): Promise<{allTargets: Map, maxWave: number}>

// Elimina un registro
deleteCandidateTarget(recordId: string)
```

---

## 15. Referencia Completa de Llamadas — Airtable y GAS

### 15.1 Tabla de llamadas Airtable desde el módulo Prospects

| Operación | Tabla | Método | Cuándo | Campos |
|-----------|-------|--------|--------|--------|
| Listar prospects activos | `BETA-Prospects` | GET paginado + filtro `{Record Status}="Active"` | Al cargar ProspectsView | Todos los campos |
| Obtener un prospect | `BETA-Prospects` | GET por ID | Al abrir ProspectPanel en edición | Todos los campos |
| Crear prospect | `BETA-Prospects` | POST | handleSave() en modo creación | Ver sección 4.4 |
| Actualizar prospect | `BETA-Prospects` | PATCH | handleSave(), drag&drop, bridge sync | Stage + campos modificados |
| Eliminar prospect | `BETA-Prospects` | DELETE | Botón "Eliminar" + confirmación | solo record ID |
| Convertir a Opportunity | `BETA-Prospects` + `Opportunities` | PATCH + POST | convertToOpportunity() | Ver sección 7.2 |
| Listar users para Tasks | `Config - Users` | GET paginado | resolveOwner() en syncTasksToAirtable | Name, record ID |
| Crear tarea | `Internal - Tasks` | POST | syncTasksToAirtable() (tarea sin airtableId) | Name, Status, Description, Deadline, Owner[], Opportunity[] |
| Actualizar tarea | `Internal - Tasks` | PATCH | syncTasksToAirtable() (tarea con airtableId) | Mismos campos que POST |
| Listar targets campaña | `CampaignTargets` | GET paginado + filtro | fetchCandidateTargets() | Todos los campos |
| Upsert target | `CampaignTargets` | POST o PATCH | upsertCandidateTarget() | Domain, CompanyName, Status, SelectedContacts, CampaignRef, ... |
| Eliminar target | `CampaignTargets` | DELETE | deleteCandidateTarget() | solo record ID |

### 15.2 Sanitización de linked records antes de enviar a Airtable

**Problema**: cuando se lee un registro que tiene un campo linked record, Airtable devuelve un array de record IDs como `["recXXXXXXXXXX"]`. Si se envía de vuelta ese mismo campo en un PATCH, Airtable devuelve 422.

**Solución en `createProspect()` y `updateProspect()`**:
```typescript
function sanitizeLinkedRecords(fields) {
  const cleaned = { ...fields };
  for (const [key, value] of Object.entries(cleaned)) {
    if (Array.isArray(value) && value.length > 0 &&
        typeof value[0] === 'string' && value[0].startsWith('rec')) {
      delete cleaned[key];  // eliminar campo linked record del payload
    }
  }
  return cleaned;
}
```

### 15.3 Tabla de llamadas al GAS desde el módulo Campañas

| Función TS | Acción GAS | Método Proxy | Parámetros |
|-----------|-----------|-------------|-----------|
| `getCampaigns()` | `getCampaigns` | GET (fallback POST) | `status?` |
| `createCampaign(data)` | `createCampaign` | POST | Ver sección 10.2 |
| `startCampaign(id)` | `startCampaign` | POST | `campaignId` |
| `getConversation(email, id)` | `getConversation` | GET | `email, campaignId` |
| `sendDraft({...})` | `sendDraft` | POST | `email, draftId?, cuerpoEditado?` |
| `saveDraft({...})` | `saveDraft` | POST | `email, borradorCuerpo` |
| `composeFromInstructions({...})` | `composeFromInstructions` | POST | `email, instructions` |
| `classifyReply({...})` | `classifyReply` | POST | `email, replyText` |
| `generateFollowUpBatch({...})` | `generateFollowUpBatch` | POST | `contacts[], instructions` |
| `sendFollowUpBatch({...})` | `sendFollowUpBatch` | POST | `contacts[]` |
| `fetchBridgePipelineCards()` | `pipeline` | GET | — |
| `fetchSentDomains()` | `dashboard` | GET | — |

### 15.4 Resumen de tablas Airtable involucradas

| Tabla | Table ID | Módulo | Operaciones |
|-------|----------|--------|-------------|
| `BETA-Prospects` | `tblAAc8XXwo8rNHR1` | Prospects | CRUD completo |
| `Opportunities` | — | Prospects (conversión) | POST (crear) |
| `Internal - Tasks` | — | Prospects (tasks) | POST, PATCH |
| `Config - Users` | `tblb3kyXSnXS0GPjy` | Prospects (tasks) | GET (lookup) |
| `CampaignTargets` | — | Campañas (candidatos) | GET, POST, PATCH, DELETE |
| `Verified-Companies` | `tbl1Zdil8FeljzpBa` | Empresas (verificación) | GET, POST, PATCH |

---

## 16. Bridge Energy Debt — Detalle Completo de la Campaña

Esta sección describe en detalle el producto Bridge Energy Debt, cómo se visualizan sus resultados en el dashboard, cómo se mapean los contactos en el pipeline y el estado actual del sistema a Q1 2026.

### 16.1 El Producto Bridge Energy Debt

**Bridge Debt Energy Program** es el producto de financiación principal de Alter5 en Q1 2026. Surge como respuesta a tres problemas estructurales del mercado de renovables español:

| Problema de mercado | Impacto en promotores |
|--------------------|-----------------------|
| Precios del pool en mínimos históricos | Los proyectos sin PPA no justifican deuda tradicional |
| Niveles de PPA que comprometen rentabilidad | Los PPAs disponibles son a precios deprimidos |
| Restricción en financiación merchant | Los bancos no financian sin cobertura de precio |

**Términos exactos del instrumento** (tal como aparecen en el email de campaña):

| Parámetro | Valor |
|-----------|-------|
| Instrumento | Préstamo tipo bullet |
| Plazo | 5 años |
| Coste | Desde Euribor + 3,00% |
| Apalancamiento | Hasta el 100% del Capex/Inversión |
| Garantía | Corporativa limitada, solo activable en default (cura del préstamo) |
| Estructura | A nivel SPV |
| Respaldo | Fondo Europeo de Inversiones (FEI) |
| Instrumentación | Deuda tradicional o Bono garantizado parcialmente por FEI |
| Activos elegibles | Solar FV, Eólica, BESS, Biomasa, Hidrógeno verde |

**Target principal**: promotores con proyectos **RTB (Ready-to-Build) o ya construidos con equity** que no tienen estructura de deuda por la coyuntura de mercado.

**URL de referencia**: `https://alto.alter-5.com/bridge`

**Remitente fijo de la campaña**: `Leticia Menéndez <leticia.menendez@alter-5.com>`

---

### 16.2 Template del Email (Variante A — único template en uso)

El template está hardcodeado en `BridgeExplorerView.tsx` y se usa en todas las waves:

**Asunto**: `Financiación Merchant para proyectos renovables`

**Cuerpo HTML** (con placeholders):

```html
<p>Hola {{nombre}},</p>

<p>Ante la coyuntura actual del mercado —caracterizada por precios del pool en mínimos
históricos, niveles de PPA que comprometen la rentabilidad y una restricción severa en la
financiación merchant tradicional— hemos diseñado una alternativa estratégica para
desbloquear el valor de proyectos renovables.</p>

<p>En colaboración con diversas instituciones financieras y el respaldo del Fondo Europeo
de Inversiones (FEI), hemos lanzado el <strong>Bridge Debt Energy Program</strong>.
Este programa está específicamente dirigido a promotores con proyectos Ready-to-Build o
ya construidos con equity que, debido a la volatilidad del mercado, carecen hoy de una
estructura de deuda.</p>

<p>El programa permite ejecutar la construcción de forma inmediata, evitando la necesidad
de desinvertir en un mercado a la baja o de comprometer el activo con un PPA a precios
deprimidos. Se resume en los siguientes términos clave:</p>
<ul>
  <li><strong>Instrumento:</strong> Préstamo tipo bullet a 5 años.</li>
  <li><strong>Coste:</strong> Desde Euribor + 3,00%.</li>
  <li><strong>Apalancamiento:</strong> Hasta el 100% del Capex/Inversión.</li>
  <li><strong>Estructura:</strong> A nivel SPV con garantía corporativa limitada
    (activable únicamente en escenarios de default para cura del préstamo).</li>
  <li><strong>Instrumentación:</strong> Tradicional o Bono garantizado parcialmente
    por el FEI según perfil del activo.</li>
  <li><strong>Tipos de activos:</strong> Solar fotovoltaico, eólico, BESS, biomasa
    e hidrógeno verde.</li>
</ul>
<p>Si considera que este programa puede resultar de interés para {{empresa}}, puede
consultar los detalles completos y solicitar un term sheet indicativo de forma 100%
online en:</p>
<p><a href="https://alto.alter-5.com/bridge">Bridge Debt Energy Program</a></p>
<p>Quedamos a su disposición para cualquier aclaración.<br/>
Un cordial saludo,<br/>Leticia<br/>Structured Finance — Alter5</p>
```

**Placeholders disponibles** (GAS los sustituye antes del envío):
- `{{nombre}}` / `{{name}}` → primer nombre del contacto
- `{{empresa}}` / `{{organization}}` / `{{company}}` → nombre de la organización

**Sin variante B**: `abTestPercent: 0`, `subjectB: ""`, `bodyB: ""` — no hay A/B test activo en Bridge.

---

### 16.3 Scoring de Candidatas (BridgeExplorerView)

Cada empresa del CRM recibe un **Bridge Score (0–100)** calculado con la función `bridgeScore()`:

```typescript
function bridgeScore(company) {
  let score = 0;

  // Factor 1: Tipo de empresa (40 pts máx — factor dominante)
  const tp = (company.companyType || '').toLowerCase();
  if (tp.includes('developer') && tp.includes('ipp')) score += 40;  // Developer+IPP ideal
  else if (tp.includes('developer'))                  score += 35;  // Developer puro
  else if (tp === 'ipp')                              score += 30;  // IPP puro

  // Factor 2: Segmento (25 pts máx)
  if (company.segment === 'Project Finance')          score += 25;
  else if (company.segment === 'Corporate Finance')   score +=  5;

  // Factor 3: Fase del activo (25 pts máx — RTB/Construcción necesitan bridge AHORA)
  const phase = (company.assetPhase || '').toLowerCase();
  if (phase === 'rtb' || phase.includes('construc'))  score += 25;
  else if (phase === 'desarrollo')                    score += 18;
  else if (phase === 'operativo')                     score +=  3;

  // Factor 4: Tecnologías utility-scale (10 pts máx)
  const techs = company.technologies || [];
  if (techs.includes('Solar') || techs.includes('Eólica')) score += 7;
  if (techs.includes('BESS'))                              score += 3;

  return Math.min(100, score);
}
```

**Score máximo**: Developer+IPP (40) + Project Finance (25) + RTB (25) + Solar+BESS (10) = **100 pts**

**Colores visuales en la UI**:
- ≥ 70 → círculo verde (candidata óptima)
- ≥ 40 → círculo ámbar (candidata válida)
- < 40 → círculo gris (candidata marginal)

### 16.4 Prioridad de Contacto dentro de cada empresa

Cuando hay varios contactos, se selecciona el de mayor prioridad:

| Rango | Roles que clasifica | Color UI |
|-------|--------------------|----|
| 1 — CEO/DG | CEO, Director General, Managing Director, MD | Verde `#059669` |
| 2 — CFO/DF | CFO, Director Financiero, Head of Finance, Chief Financial | Ámbar `#D97706` |
| 3 — Fin. Estructurada | "financiación estructurada" en el cargo | Azul `#2563EB` |
| 4 — M&A | "m&a" en el cargo | Morado |
| 5 — Otros directivos | Director, Head, Jefe... | Índigo `#6366F1` |
| 6 — Sin rol | "No identificado", "nan", vacío | Gris |

---

### 16.5 Los 7 Escudos Anti-Duplicado

`BridgeExplorerView` aplica 7 capas de filtrado para **nunca enviar dos veces a la misma empresa**:

```
Shield 1: bridgeContactDomains   — dominio ya presente en contactos del GAS (tracking live)
Shield 2: trackingDomains        — dominio ya enviado (fetchSentDomains de GAS)
Shield 3: allSentDomains         — dominio aprobado/enviado en CUALQUIER wave Bridge (Airtable)
Shield 4: leticiaDomains         — Leticia ya contactó esta empresa en el CRM (cualquier buzón)
Shield 5: previousTargets        — ya aprobados/enviados en waves anteriores (prop externa)
Shield 6a: companyEmails vs sentEmails/bridgeContactEmails/atTargetEmails
           — email exacto ya enviado (cubre dominios genéricos como gmail.com)
Shield 7: sentCompanyNames/atTargetNames
           — nombre de empresa ya enviado (fallback cuando dominio no coincide)
```

**Filtros obligatorios adicionales** (no son shields, son requisitos):
- `company.role === 'Originación'` — solo empresas que buscan financiación
- Al menos un contacto con email válido en `company.detail.contacts`

**Filtros de UI** (el usuario puede activar/desactivar):

| Filtro UI | Tipo | Campo |
|-----------|------|-------|
| Segmento | Pills multi | `company.segment` |
| Tipo empresa | Pills multi | `company.companyType` |
| Tecnologías | Pills multi | `company.technologies[]` |
| Geografía | Pills multi | `company.geography[]` |
| Target priority | Pills multi | prioridad del mejor contacto |
| Status | Radio | `pending` / `skipped` / todos |
| Score mínimo | Slider | `bridgeScore >= minScore` |
| Búsqueda | Input | nombre o dominio |

---

### 16.6 Ordenación con IA (LLM Ordering)

El explorer incluye un panel colapsable que usa **Gemini para reordenar candidatas** según instrucciones en lenguaje natural:

```
Ejemplo de instrucción del usuario:
"Prioriza empresas con CEO o Director Financiero identificado,
 que trabajen en solar utility-scale y estén en España o Portugal,
 con más de 100MW de pipeline scraper"
```

**Implementación técnica**:
- Procesa batches de 150 empresas
- Temperatura: 0.2 (conservador, determinista)
- Respuesta: array JSON `[{domain, score: 0-100, reason: "frase corta"}]`
- El `reason` se muestra como tooltip en cursiva violeta bajo cada empresa
- Cuando activo: ordena primero por `llmScore`, desempate por `bridgeScore`
- La instrucción se puede guardar en localStorage para reutilizar

---

### 16.7 Flujo de Envío (Send Wizard — 2 pasos)

**Acceso**: desde `BridgeCampaignView` → botón "Preparar nueva wave" → abre `BridgeExplorerView`

**Detección automática del próximo wave ID**:
```typescript
const { allTargets, maxWave } = await fetchAllBridgeTargets("Bridge_Q1");
const nextWave = maxWave + 1;
// Si maxWave = 2, nextWaveRef = "Bridge_Q1_W3"
```

**Paso 1 — Revisión de candidatos**:
- Lista de empresas seleccionadas con sus contactos elegidos
- Posibilidad de eliminar destinatarios individuales antes de enviar
- Muestra Bridge Score, contacto seleccionado y su cargo

**Paso 2 — Confirmar y Enviar**:

```
A. "Enviar prueba" 
   → sendTestEmail(campaignId, "salvador.carrillo@alter-5.com")
   → GAS envía copia con asunto "[TEST] Financiación Merchant..."

B. "Crear N borradores en Gmail"
   → addRecipients(campaignId, recipients[])
   → GAS crea drafts en Gmail de Leticia para revisión manual previa al envío
   → Todos los dominios marcados como 'sent' en Airtable CampaignTargets

C. Revisión manual en Gmail de Leticia (fuera del dashboard)

D. "Ejecutar envío de borradores"
   → sendDrafts → GAS envía todos los borradores
   → status: 'sent' en Recipients sheet
```

**Parámetros fijos de campaña** en el GAS:
```typescript
{
  name: "Bridge_Q1_W3",              // o el wave correspondiente
  type: 'mass',
  senderEmail: 'leticia.menendez@alter-5.com',
  senderName: 'Leticia Menéndez',
  subjectA: 'Financiación Merchant para proyectos renovables',
  bodyA: BRIDGE_EMAIL_TEMPLATE,      // con {{nombre}} y {{empresa}}
  subjectB: '',
  bodyB: '',
  abTestPercent: 0,                  // sin A/B test
  recipients: [],                    // se añaden después
}
```

**Rate limit**: 1 email/segundo (`Utilities.sleep(1000)` entre envíos en GAS).

---

### 16.8 Sistema de Waves (Oleadas)

```
Bridge_Q1       → Wave 1 (primera oleada, referencia base)
Bridge_Q1_W2    → Wave 2 (segunda oleada)
Bridge_Q1_W3    → Wave 3
Bridge_Q1_WN    → Wave N
```

**Regla de exclusión entre waves**: las empresas de waves anteriores se excluyen automáticamente de waves nuevas via los 7 shields. Cada empresa solo puede recibir el email una vez.

**Estado por empresa en CampaignTargets** (evolución posible):

```
pending → selected → approved → sent
         ↘ skipped   ↘ rejected
```

| Status | Descripción |
|--------|-------------|
| `pending` | Sin revisar en el explorer |
| `skipped` | Saltada por ahora (puede recuperarse) |
| `selected` | Seleccionada para la wave actual |
| `approved` | Aprobada por el revisor |
| `sent` | Email enviado — excluida de waves futuras |
| `rejected` | Descartada permanentemente |

---

### 16.9 Dashboard BridgeCampaignView — Estructura y Métricas

El dashboard es la pantalla principal para ver el estado de la campaña. Se alimenta de dos fuentes combinadas:

**Fuente 1: GAS `dashboard` action** (GET, sin token)
```
proxyFetch('dashboard') → GAS handleDashboard()
→ fusiona Legacy Tracking sheet + Recipients sheet nuevo
→ retorna { contactos[], metricas{Global, A, B, Final} }
```

**Fuente 2: Airtable CampaignTargets** (via `fetchAllBridgeTargets`)
```
→ si GAS devuelve < 10 contactos pero Airtable tiene más
→ construye "contactos sintéticos" desde targets aprobados/enviados
→ campo _augmentedFromAirtable = true
```

#### KPIs calculados en tiempo real

```javascript
// Todos calculados sobre el array contacts[] del GAS
Total contactos   = contacts.length
Enviados          = contacts.filter(c => c.estado && !c.estado.startsWith("Error")).length
Errores           = contacts.filter(c => c.estado?.startsWith("Error")).length
Abiertos (≥1 ap.) = contacts.filter(c => c.numAperturas > 0).length
Clics             = contacts.filter(c => c.numClics > 0).length
Respondidos       = contacts.filter(c => c.respondido === "Si" || c.respondido === "Sí"
                                      || c.estado === "Respondido").length
```

#### Funnel visual

```
Total contactos → [████████████████████] 100%
Enviados        → [████████████████░░░░]  X%  (sin errores)
Abiertos        → [████████░░░░░░░░░░░░]  X%  (tasa apertura)
Clics           → [█████░░░░░░░░░░░░░░░]  X%  (tasa clic)
Respondidos     → [███░░░░░░░░░░░░░░░░░]  X%  (tasa respuesta)
```

Colores de la barra de apertura: verde ≥40%, naranja ≥25%, rojo <25%.

#### Métricas por variante (A/B — aunque Bridge solo usa variante A)

```typescript
metricas.A = {
  enviados: number,
  abiertos: number,
  clics: number,
  respondidos: number,
  tasaApertura: number,   // 0.0–1.0
  tasaClics: number,
  tasaRespuesta: number,
}
metricas.B = { ... }      // igual, para variante B si existe
metricas.Global = { ... } // suma de A + B
metricas.Final = {
  total: number,          // emails del "grupo final" (sin asignación A/B)
  pendientes: number,
}
```

El badge **"● MEJOR"** aparece junto a la variante ganadora cuando ambas tienen ≥5 enviados.

#### Estructura de datos por contacto

Cada objeto en `contacts[]`:

```typescript
{
  email: string,
  nombre: string,
  apellido: string,
  organizacion: string,
  estado: "Respondido" | "Clic" | "Abierto" | "Enviado" | "Error" | "",
  numAperturas: number,
  numClics: number,
  respondido: "Si" | "Sí" | "" | boolean,
  fechaEnvio: string,        // ISO datetime
  primeraApertura: string,   // ISO datetime o ""
  primerClic: string,        // ISO datetime o ""
  respuestaEnviada: "Si" | "",
  seguimientosEnviados: number,
}
```

---

### 16.10 Tabla de Empresas (Tab "Empresas")

Empresas agrupadas por `organizacion` con `buildCompanyData()`:

```javascript
// Por empresa, el estado mostrado es el del contacto con mayor engagement
// Orden de prioridad: Respondido > Clic > Abierto > Enviado > (vacío) > Error
const STATUS_RANK = {
  'Respondido': 5, 'Clic': 4, 'Abierto': 3, 'Enviado': 2, '': 1, 'Error': 0
};
```

**Columnas de la tabla**:

| Columna | Fuente | Descripción |
|---------|--------|-------------|
| Empresa | `organizacion` | Nombre de la empresa |
| Estado | `bestStatus` del grupo | Estado del contacto más activo |
| Contactos | count | Número de contactos de esa empresa en la campaña |
| Aperturas | suma `numAperturas` | Total de aperturas de todos los contactos |
| Clics | suma `numClics` | Total de clics |
| Respuestas | suma respondidos | Número de respondidos |
| Wave | `CampaignRef` (Airtable) | `Bridge_Q1`, `Bridge_Q1_W2`, etc. |

**Filtros disponibles**:
- Pills de estado: Todos / Respondido / Clic / Abierto / Enviado
- Búsqueda: nombre empresa o email

**Click en empresa** → abre `BridgeSlideOverPanel` con el contacto de mayor engagement de esa empresa.

---

### 16.11 Pipeline Bridge (Tab "Pipeline")

El Pipeline Bridge es un **Kanban paralelo e independiente** de Prospects Airtable. Vive en Google Sheets (tabla `Pipeline`) y representa el estado de comunicación/avance comercial de cada contacto de la campaña.

#### Etapas del Pipeline Bridge

```
nurturing → reunion → subida_docs → doc_completada | descartado
```

| Etapa GAS | Label UI | Color | Relación con Prospects Airtable |
|-----------|----------|-------|--------------------------------|
| `nurturing` | Nurturing | Azul `#3B82F6` | No mapea (aún no hay señal de avance) |
| `reunion` | Reunión | Ámbar `#F59E0B` | → `"Reunion"` en BETA-Prospects |
| `subida_docs` | Subida docs | Naranja `#F97316` | → `"Documentacion Pendiente"` |
| `doc_completada` | Doc completada | Verde `#10B981` | → `"Listo para Term-Sheet"` |
| `descartado` | Descartado | Gris `#6B7280` | No genera sugerencia de avance |

#### Estructura de una card de Pipeline

```javascript
{
  email: "contacto@empresa.es",     // PK en Pipeline sheet
  etapa: "nurturing",               // etapa actual
  etapaAnterior: "",                // para tracking de movimientos
  fechaCambio: "2026-03-10T...",    // timestamp del último cambio
  fechaCreacion: "2026-02-15T...",  // cuando entró al pipeline
  notas: [                          // array de notas añadidas manualmente
    { texto: "Reunión el 20 marzo", fecha: "2026-03-15T...", autor: "Leticia" }
  ],
  historial: [                      // todos los movimientos de etapa
    { etapa: "nurturing", fecha: "2026-02-15T..." },
    { etapa: "reunion", fecha: "2026-03-10T..." }
  ],
  // Datos enriquecidos desde Recipients sheet:
  nombre: "Carlos",
  apellido: "Ruiz",
  organizacion: "SolarEn",
  numAperturas: 3,
  numClics: 1,
  respondido: "Si",
}
```

#### Sugerencias automáticas de avance en el Pipeline

```javascript
function getSuggestions(card, contactData) {
  // Señal de engagement alto: ≥4 interacciones en nurturing → sugerir reunion
  if (card.etapa === 'nurturing') {
    const interactions = (contactData?.numAperturas || 0) + (contactData?.numClics || 0);
    if (interactions >= 4) return { stage: 'reunion', label: 'Sugerir → Reunión' };
  }

  // Señal en notas: palabras de reunión detectadas
  const notesStr = JSON.stringify(card.notas || []).toLowerCase();
  const meetingKw = ['reunion', 'reunión', 'llamada', 'meeting', 'call', 'agenda'];
  if (meetingKw.some(k => notesStr.includes(k))) {
    return { stage: 'reunion', label: 'Sugerir → Reunión' };
  }

  // Señal negativa: palabras de rechazo
  const rejectKw = ['no interesa', 'no estamos interesados', 'unsubscribe', 'baja'];
  if (rejectKw.some(k => notesStr.includes(k))) {
    return { stage: 'descartado', label: 'Sugerir → Descartado' };
  }

  return null;
}
```

#### moveStage() — Mover contacto entre etapas

```typescript
// Llamada desde el botón de la card del Kanban Bridge
await proxyFetch('moveStage', { email: card.email, newStage: targetStage });

// GAS handleMoveStage():
// 1. getOrCreatePipelineRow(email) → crea fila si no existe
// 2. etapaAnterior = etapa actual
// 3. etapa = newStage
// 4. fechaCambio = now()
// 5. historial.push({ etapa: newStage, fecha: now() })
```

---

### 16.12 Sincronización Bridge Pipeline → Prospects Airtable

Este es el mecanismo que conecta ambos sistemas de forma automática (no-bloquente):

#### Flujo de detección

```
ProspectsView.tsx (al cargar)
  → fetchBridgePipelineCards() [GET /pipeline desde GAS]
  → computeSyncSuggestions(prospects, bridgeCards, companies)
       ↓
  Para cada Prospect en BETA-Prospects:
    1. matchProspectToBridge(prospect, bridgeCards)
       → extrae dominios de todos los emails del prospect
       → busca cards de Pipeline cuyo email tenga ese dominio
       → excluye 'descartado'
       → elige la etapa más avanzada (BRIDGE_ORDER: nurturing < reunion < subida_docs < doc_completada)
       → si etapa mapeada existe y es más avanzada que el stage actual → sugiere avance

    2. detectMeetingFromCRM(prospect, matchedCRMCompany)
       → busca en company.detail.datedSubjects[].subject + extract
       → busca en company.detail.subjects[]
       → keywords: 'reunion','reunión','llamada','meeting','call','agenda','convocatoria','videollamada','teams','zoom'
       → si detecta → sugiere 'Reunion' (si más avanzado que el actual)

    3. Toma la más avanzada entre ambas señales
       → genera SyncSuggestion[] solo si suggestedStage > currentStage
```

#### Mapa de etapas Bridge → Prospects

```
Bridge Pipeline (GAS Sheets)   →   Prospects Kanban (Airtable)
────────────────────────────────────────────────────────
nurturing                       →   [sin sugerencia]
reunion                         →   Reunion
subida_docs                     →   Documentacion Pendiente
doc_completada                  →   Listo para Term-Sheet
descartado                      →   [sin sugerencia]
```

#### Resultado visual: banner de sugerencias

Cuando hay sugerencias activas, aparece un banner en la parte superior del Kanban de Prospects:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ⚡ N sugerencias de avance detectadas (Bridge / CRM)                                │
│                                                                                      │
│ "SolarEn SA"  Lead → Reunion                                                        │
│  Bridge: etapa 'reunion' (carlos@solaren.es)              [Aplicar]  [✕ Ignorar]   │
│                                                                                      │
│ "GreenfieldPV"  Interesado → Documentacion Pendiente                                │
│  Bridge: etapa 'subida_docs' (jorge@greenfieldpv.eu)      [Aplicar]  [✕ Ignorar]   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **"Aplicar"** → `updateProspect(id, { Stage: suggestedStage })` + elimina la sugerencia
- **"✕ Ignorar"** → añade `prospectId` a Set `syncDismissed` (solo en sesión, no persiste)

---

### 16.13 Respuestas y Follow-ups con IA

#### Clasificación automática de respuestas (Gemini)

Cuando Leticia recibe una respuesta, el GAS la clasifica automáticamente:

```
Categorías: interesado | reunion | no_interesado | informacion | fuera_oficina | otro
Sentimiento: positivo | neutro | negativo
```

Esta clasificación se usa para:
- Colorear el badge de estado en la tabla de empresas
- Priorizar la cola de follow-up

#### Cola de follow-up prioritizada

En la sección "Resumen" del dashboard, los contactos se priorizan para follow-up así:

```
Prioridad 1 (urgente): Respondidos donde Leticia NO ha contestado aún
Prioridad 2 (cálido):  Clickers (clic en enlace Bridge pero sin respuesta)
Prioridad 3 (tibio):   Warm opens (≥3 aperturas, sin clics ni respuesta)

Límite: máximo 1 contacto por empresa (el de mayor prioridad)
Máximo total: 15 en la vista
```

#### Generación de respuestas con Gemini

**Instrucción al agente** (en `BridgeSlideOverPanel`):
```
[Textarea de instrucciones libres]
Ejemplo: "Responde que estamos disponibles para reunión esta semana,
          propón martes 25 o miércoles 26 por la mañana, 
          y adjunta el one-pager de Bridge"
```

El GAS construye el prompt completo:
```
Eres un asesor de inversión de Alter5 Capital (financiación energías renovables).
Genera un email de seguimiento profesional en español.
Destinatario: {nombre} de {organización}
Instrucciones del usuario: {instrucciones}
Conversación previa: [últimos 5 mensajes del thread Gmail]
Responde SOLO con el cuerpo del email en HTML.
Tono profesional pero cercano. Call-to-action claro.
```

**Temperatura Gemini**: 0.7 (más creativo para respuestas personalizadas).

---

### 16.14 Estado Actual a Q1 2026

#### Waves ejecutadas

El sistema de waves está operativo con las siguientes referencias en Airtable `CampaignTargets`:

| Wave | `CampaignRef` | Estado |
|------|--------------|--------|
| Wave 1 | `Bridge_Q1` | Completada |
| Wave 2 | `Bridge_Q1_W2` | Completada |
| Wave N | `Bridge_Q1_WN` | Se detecta automáticamente al abrir el explorer |

El número exacto de waves activas se obtiene con `fetchAllBridgeTargets("Bridge_Q1")` que devuelve `{ maxWave }`. La próxima wave siempre es `maxWave + 1`.

#### Referencia de datos de benchmark (mock data del sistema)

El sistema incluye mock data que refleja el benchmark de referencia para evaluar el rendimiento real:

```
Total contactos:   156 (referencia de tamaño batch)
Variante A (test batch de 16):
  - Tasa apertura:  68,75% (11/16)
  - Tasa clics:     31,25% (5/16)
  - Tasa respuesta: 18,75% (3/16)

Variante B (test batch de 16):
  - Tasa apertura:  56,25% (9/16)
  - Tasa clics:     43,75% (7/16)
  - Tasa respuesta: 25,00% (4/16)
```

> **Nota**: Estos datos son el mock de referencia del sistema, no los datos reales de la campaña. Los datos reales están en el Google Sheet de Leticia y se consultan via `proxyFetch('dashboard')`.

#### Empresas en el Pipeline Bridge (ejemplos del mock)

```
carlos.ruiz@solaren.es       → nurturing    (50MW en Extremadura)
jorge.vidal@greenfield.eu    → reunion      (reunión 25 feb)
marcos.diaz@solardev.es      → nurturing    (30MW RTB)
carmen.navarro@ibervolt.com  → subida_docs  (balance+proyecciones enviados, falta PPA)
```

#### Límites técnicos actuales

| Límite | Valor | Razón |
|--------|-------|-------|
| Emails/día GAS (Workspace) | ~2.000 | Cuota Google Workspace |
| Emails/día GAS (cuenta gratuita) | ~100 | Cuota Gmail gratuita |
| Rate de envío | 1 email/segundo | `Utilities.sleep(1000)` entre envíos |
| Empresas en CRM elegibles | ~1.087 Originación con contactos | Estado a 18-mar-2026 |
| Batch de LLM ordering | 150 empresas | Límite del prompt de Gemini |
| Batch de follow-up IA | 15 contactos | Límite por coste y tiempo de respuesta |

#### Próximos pasos identificados en la arquitectura

1. **Apollo.io enriquecimiento** — ~1.087 empresas de Originación pendientes de enriquecer contactos (CEO/CFO) para mejorar el targeting
2. **Nuevas waves** — se pueden lanzar desde el botón "Preparar nueva wave" → el sistema auto-detecta el siguiente wave ID
3. **Follow-up batch** — empresas con aperturas ≥3 sin respuesta son candidatas a follow-up automático via Gemini

---

### 16.15 Configuración Completa del Sistema Bridge

#### Remitente y test

```typescript
// Hardcodeado en BridgeExplorerView.tsx openWizard()
senderEmail = "leticia.menendez@alter-5.com"
senderName  = "Leticia Menéndez"
testEmail   = "salvador.carrillo@alter-5.com"  // siempre recibe el test
```

#### GAS Script Properties requeridas

```
API_TOKEN          → token de auth para doPost (= GAS_API_TOKEN de Vercel)
GEMINI_API_KEY     → clave Gemini 2.0 Flash
LEGACY_SHEET_ID    → ID del Google Sheet de tracking Bridge original (datos históricos)
CAMPAIGN_SHEET_ID  → auto-guardado en primera ejecución (si no existe, se crea)
SENDER_EMAIL       → leticia.menendez@alter-5.com
SENDER_NAME        → Leticia Menéndez
NOTES_FOLDER_ID    → carpeta Drive para meeting notes
```

#### Vercel Environment Variables

```
GAS_WEB_APP_URL         → URL del GAS Web App desplegado
GAS_API_TOKEN           → token compartido con GAS
CAMPAIGN_PROXY_SECRET   → secret para validar header x-proxy-secret
ALLOWED_ORIGIN          → https://alter5-bi.vercel.app (CORS)
```

#### Vite (frontend, no sensibles)

```
VITE_CAMPAIGN_PROXY_SECRET  → mismo valor que CAMPAIGN_PROXY_SECRET
```

---

## Apéndice A — Variables de Entorno Adicionales

Además de las variables documentadas en la guía de Empresas:

| Variable | Ámbito | Descripción |
|----------|--------|-------------|
| `GAS_WEB_APP_URL` | Vercel servidor | URL del Google Apps Script Web App desplegado |
| `GAS_API_TOKEN` | Vercel servidor | Token de autorización para acciones POST del GAS |
| `ALLOWED_ORIGIN` | Vercel servidor | CORS origin (default: `https://alter5-bi.vercel.app`) |

**Script Properties en Google Apps Script** (configuradas en el editor de Apps Script, pestaña Propiedades del proyecto):

| Propiedad | Descripción |
|-----------|-------------|
| `API_TOKEN` | Mismo valor que `GAS_API_TOKEN` de Vercel |
| `GEMINI_API_KEY` | Clave de Gemini API para respuestas IA |
| `LEGACY_SHEET_ID` | ID del Google Sheet de tracking Bridge original |
| `CAMPAIGN_SHEET_ID` | ID del Google Sheet del backend de campañas nuevo (auto-guardado en primera ejecución) |
| `SENDER_EMAIL` | Email de Leticia (remitente por defecto) |
| `SENDER_NAME` | Nombre del remitente por defecto |
| `NOTES_FOLDER_ID` | ID de carpeta de Google Drive para notas de reunión |

---

## Apéndice B — Archivos Clave del Proyecto

| Archivo | Descripción |
|---------|-------------|
| `src/utils/airtableProspects.ts` | CRUD de BETA-Prospects: fetchAllProspects, createProspect, updateProspect, deleteProspect, convertToOpportunity, normalizeProspect |
| `src/utils/airtableTasks.ts` | CRUD de Internal-Tasks: createAirtableTask, updateAirtableTask, syncTasksToAirtable, resolveOwner |
| `src/utils/airtableCandidates.ts` | CRUD de CampaignTargets: fetchCandidateTargets, upsertCandidateTarget, fetchAllBridgeTargets |
| `src/utils/campaignApi.ts` | Todas las acciones GAS: createCampaign, startCampaign, getConversation, sendDraft, generateFollowUpBatch, etc. |
| `src/utils/bridgeProspectSync.ts` | Sincronización Bridge→Prospects: computeSyncSuggestions, matchProspectToBridge, detectMeetingFromCRM |
| `src/components/ProspectsView.tsx` | Kanban de Prospects: drag&drop, filtros, KPIs, bridge sync banner |
| `src/components/ProspectPanel.tsx` | Panel CRUD de Prospect: formulario, tareas, AI intelligence, matching CRM |
| `src/components/ProspectTasks.tsx` | Componente de tareas: ciclo de estados, templates, sincronización Airtable |
| `src/components/CampaignsView.tsx` | Lista de campañas: KPIs globales, filtros por estado, búsqueda |
| `src/components/CampaignCreationPanel.tsx` | Wizard 6 pasos para crear campaña |
| `src/components/CampaignDetailView.tsx` | Detalle de campaña: 4 tabs (Resumen, Contactos, Respuestas, Seguimiento) |
| `src/components/BridgeCampaignView.jsx` | Dashboard Bridge: tabla empresas + Kanban Pipeline |
| `src/components/BridgeSlideOverPanel.tsx` | Panel de conversación Gmail + editor de borrador |
| `scripts/gas/campaignBackend.gs` | GAS Backend: 30+ handlers, Gemini, GmailApp, Google Sheets |
| `api/campaign-proxy.js` | Proxy Vercel para GAS: routing GET/POST, inyección token |
| `docs/BRIDGE_CAMPAIGN_SYSTEM.md` | Documentación exhaustiva del sistema Bridge Campaign |

---

*Documento generado el 21 de marzo de 2026. Refleja el estado técnico actual del sistema.*
