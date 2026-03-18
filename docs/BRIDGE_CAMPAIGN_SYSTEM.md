# Bridge Energy Debt Campaign System — Documentacion Exhaustiva

> Documento para replicar el sistema de campanas de Bridge Energy Debt en otra infraestructura.
> Generado: 2026-03-18

---

## 1. Vision General

El sistema es una **plataforma de outreach comercial automatizado** donde **Leticia Menendez** actua como agente principal que:

1. **Selecciona candidatas** (empresas target) del CRM de Alter5 BI
2. **Envia emails masivos** con A/B testing y tracking
3. **Lee y clasifica respuestas** automaticamente con IA (Gemini)
4. **Genera borradores de follow-up** personalizados con IA
5. **Gestiona un pipeline de ventas** por contacto (nurturing → reunion → docs → completado)
6. **Aprende del contexto** via knowledge base + historial de conversacion

---

## 2. Arquitectura del Sistema

```
┌──────────────────────────────────────────────────────────────────────┐
│                         React Dashboard (Vercel)                     │
│  BridgeCampaignView · CampaignsView · CampaignDetailView           │
│  CampaignCreationPanel · BridgeExplorerView · BridgeSlideOverPanel  │
│  AddToCampaignModal · CandidateSearchView                           │
└────────────────────┬─────────────────────────────────────────────────┘
                     │ POST /api/campaign-proxy
                     │ (x-proxy-secret header)
┌────────────────────▼─────────────────────────────────────────────────┐
│               Vercel Serverless Proxy (api/campaign-proxy.js)        │
│  - Valida proxy secret (CAMPAIGN_PROXY_SECRET)                       │
│  - Inyecta GAS_API_TOKEN en requests POST                            │
│  - Rutas GET: dashboard, pipeline, getConversation, etc.             │
│  - Rutas POST: createCampaign, startCampaign, sendDraft, etc.        │
│  - Fallback: GET → POST si GET devuelve vacio                        │
└────────────────────┬─────────────────────────────────────────────────┘
                     │ fetch(GAS_WEB_APP_URL)
                     │ POST con token / GET con query params
┌────────────────────▼─────────────────────────────────────────────────┐
│              Google Apps Script Web App (campaignBackend.gs)          │
│  ~1,900 lineas. 30+ acciones.                                       │
│  Ejecuta como cuenta Google de Leticia → acceso Gmail + Drive        │
│                                                                      │
│  Google Sheets DB:                                                    │
│    - Campaigns (metadata: nombre, A/B, sender, knowledgeBase)        │
│    - Recipients (tracking por contacto: status, opens, clicks)       │
│    - FollowUps (follow-ups programados, status lifecycle)            │
│    - Pipeline (etapa por contacto, notas, historial)                 │
│                                                                      │
│  Integraciones:                                                       │
│    - GmailApp (envio, drafts, lectura threads)                       │
│    - Gemini 2.0 Flash API (generacion IA, clasificacion)             │
│    - DriveApp (upload meeting notes)                                 │
│    - Legacy Tracking sheet (datos campaña anterior)                  │
└──────────────────────────────────────────────────────────────────────┘

Airtable (Base appVu3TvSZ1E4tj0J):
  - CampaignTargets: empresas revisadas/aprobadas por ola (waves)
  - Campaigns (Airtable fallback para lectura)
```

---

## 3. Google Apps Script — campaignBackend.gs (Nucleo del Sistema)

### 3.1 Configuracion

| Script Property     | Uso                                          |
|---------------------|----------------------------------------------|
| `API_TOKEN`         | Autenticacion POST desde proxy Vercel        |
| `GEMINI_API_KEY`    | Clave Gemini 2.0 Flash para generacion IA    |
| `SENDER_EMAIL`      | Email remitente por defecto (Leticia)         |
| `SENDER_NAME`       | Nombre remitente por defecto                  |
| `LEGACY_SHEET_ID`   | ID del sheet de campaña legacy (Tracking)     |
| `NOTES_FOLDER_ID`   | Folder Drive para meeting notes (opcional)    |
| `SPREADSHEET_ID`    | ID del sheet de datos (auto-creado si falta)  |

### 3.2 Sheets (Base de Datos)

#### Campaigns Sheet
```
id | name | type | status | senderEmail | senderName |
subjectA | bodyA | subjectB | bodyB |
abTestPercent | abWinnerCriteria | abWinner |
totalRecipients | totalSent | totalOpened | totalClicked | totalReplied |
createdTime | startedTime | completedTime | notes | knowledgeBase
```

#### Recipients Sheet
```
id | campaignId | email | name | lastName | organization |
status | variant | openCount | clickCount | messageId |
sentTime | openedTime | clickedTime
```

**Status lifecycle:** `pending` → `draft_ready` → `sent` → `replied` / `error`

#### FollowUps Sheet
```
id | email | name | organization | status |
instructions | scheduledAt | senderEmail | senderName |
draftHtml | sentTime | createdTime | cancelledTime
```

**Status lifecycle:** `scheduled` → `draft_ready` → `sent` / `cancelled`

#### Pipeline Sheet
```
email | etapa | etapaAnterior | fechaCambio | fechaCreacion | notas | historial
```

**Etapas pipeline:** `nuevo` → `nurturing` → `reunion` → `subida_docs` → `doc_completada` → `descartado`

### 3.3 Entry Points

#### doPost (autenticado con token)
Todas las mutaciones y consultas sensibles:

| Action | Funcion | Descripcion |
|--------|---------|-------------|
| `createCampaign` | `handleCreateCampaign` | Crea campana + inserta recipients bulk |
| `startCampaign` | `handleStartCampaign` | Envia emails via GmailApp, A/B assign |
| `createDrafts` | `handleCreateDrafts` | Crea Gmail drafts sin enviar |
| `sendDrafts` | `handleSendDrafts` | Envia drafts previamente creados |
| `sendTestEmail` | `handleSendTestEmail` | Envia copia test con `[TEST]` prefix |
| `updateCampaign` | `handleUpdateCampaign` | Actualiza campos de campana |
| `updateCampaignStatus` | `handleUpdateCampaignStatus` | Cambia status (pause/complete/cancel) |
| `addRecipients` | `handleAddRecipients` | Anade recipients a campana existente |
| `getCampaignRecipients` | `handleGetCampaignRecipients` | Lista recipients de campana |
| `getCampaignDashboard` | `handleCampaignDashboard` | Metricas por campana |
| `scheduleFollowUp` | `handleScheduleFollowUp` | Programa follow-up para fecha futura |
| `cancelFollowUp` | `handleCancelFollowUp` | Cancela follow-up scheduled/draft_ready |
| `sendDraft` | `handleSendDraft` | Envia draft individual o reply a thread |
| `saveDraft` | `handleSaveDraft` | Guarda/actualiza draft Gmail |
| `composeAndSaveDraft` | `handleComposeAndSaveDraft` | Crea draft con subject+body dados |
| `composeFromInstructions` | `handleComposeFromInstructions` | **IA**: Genera email desde instrucciones naturales |
| `generateFollowUp` | `handleGenerateFollowUp` | **IA**: Genera follow-up basado en conversacion |
| `improveMessage` | `handleImproveMessage` | **IA**: Mejora texto de email existente |
| `classifyReply` | `handleClassifyReply` | **IA**: Clasifica respuesta (interesado/reunion/no_interesado/etc) |
| `generateFollowUpBatch` | `handleGenerateFollowUpBatch` | **IA**: Genera drafts para N contactos (max 15) |
| `sendFollowUpBatch` | `handleSendFollowUpBatch` | Envia batch de follow-ups |
| `moveStage` | `handleMoveStage` | Mueve contacto de etapa en pipeline |
| `addNote` | `handleAddNote` | Agrega nota a contacto en pipeline |
| `uploadMeetingNotes` | `handleUploadMeetingNotes` | Sube archivo a Drive + nota pipeline |

#### doGet (publico, solo lectura)

| Action | Funcion | Descripcion |
|--------|---------|-------------|
| `dashboard` | `handleDashboard` | Dashboard completo: contactos + metricas A/B |
| `pipeline` | `handlePipeline` | Pipeline cards con datos recipient |
| `getConversation` | `handleGetConversation` | Thread Gmail + draft existente |
| `getConversacionCompleta` | `handleGetConversacionCompleta` | Thread completo + **resumen IA** |
| `getFollowUpCandidates` | `handleGetFollowUpCandidates` | Contactos con opens/clicks sin follow-up |
| `getConversaciones` | `handleGetConversaciones` | Batch summaries (stub) |

#### Time-Based Trigger

| Funcion | Frecuencia | Descripcion |
|---------|------------|-------------|
| `generateScheduledDrafts` | Cada hora | Busca follow-ups `scheduled` cuya fecha llego, genera draft con Gemini, guarda en Gmail, actualiza a `draft_ready` |

---

## 4. Funcionalidades IA (Gemini 2.0 Flash)

### 4.1 Generacion de Follow-Ups (`handleGenerateFollowUp`)

**Input:**
- Email del contacto
- Instrucciones opcionales del usuario

**Proceso:**
1. Lee los ultimos 5 mensajes del thread Gmail (`from:X OR to:X`)
2. Identifica si cada mensaje es de Alter5 o del contacto (`alter-5.com` / `alter5.com` en `from`)
3. Obtiene info del recipient (nombre, organizacion)
4. Construye prompt:

```
Eres un asesor de inversion de Alter5 Capital (financiacion energias renovables).
Genera un email de seguimiento profesional en espanol.

Destinatario: {nombre} de {organizacion}
Instrucciones: {instrucciones_usuario}

Conversacion previa:
Alter5: {mensaje1}
---
Contacto: {mensaje2}
...

Genera un seguimiento natural basado en la conversacion.
Responde SOLO con el cuerpo del email en HTML (sin subject, sin metadata).
Usa un tono profesional pero cercano. Incluye un call-to-action claro.
```

**Output:** HTML del borrador de email

### 4.2 Composicion desde Instrucciones (`handleComposeFromInstructions`)

Mismo flujo que follow-up pero con instrucciones explicitas del usuario. Ejemplo: "Recuerdale que tenemos reunion el jueves y necesitamos el NDA firmado".

### 4.3 Mejora de Mensajes (`handleImproveMessage`)

```
Eres un experto en comunicacion comercial de Alter5 Capital (financiacion energias renovables).
Mejora el siguiente email manteniendo el mensaje original pero haciendolo mas profesional,
claro y persuasivo. Manten el mismo idioma. Responde SOLO con el texto mejorado en HTML:

{texto_original}
```

### 4.4 Clasificacion de Respuestas (`handleClassifyReply`)

**Categorias:**
- `interesado`: muestra interes en continuar
- `reunion`: propone o acepta reunion
- `no_interesado`: rechaza
- `informacion`: pide mas info
- `fuera_oficina`: auto-reply
- `otro`: no encaja

**Sentimiento:** `positivo` / `neutro` / `negativo`

**Output:** `{"classification": "...", "sentiment": "..."}`

### 4.5 Resumen de Conversacion (`handleGetConversacionCompleta`)

```
Resume esta conversacion de email en 2-3 frases en espanol.
Indica los puntos clave y el estado actual:

Alter5 (2026-02-14): {mensaje}
---
Contacto (2026-02-15): {mensaje}
```

### 4.6 Generacion Batch (`handleGenerateFollowUpBatch`)

- Maximo 15 contactos por batch
- Para cada uno llama a `handleGenerateFollowUp`
- Rate limit: 500ms entre llamadas Gemini
- Devuelve array de `{email, asunto, cuerpoHtml}`

---

## 5. Sistema de Envio de Emails

### 5.1 Envio Directo (`handleStartCampaign`)

1. Lee todos los recipients con status `pending`
2. Asigna variante A/B aleatoriamente segun `abTestPercent`
3. Reemplaza placeholders: `{{nombre}}`, `{{empresa}}`, `{{company}}`
4. Envia via `GmailApp.sendEmail()` con alias `from` del sender
5. Fallback: si el alias falla, envia sin `from` (usa cuenta del script)
6. Rate limit: 1 email/segundo
7. Actualiza status a `sent` o `error`
8. Si todos enviados → status campana = `completed`

### 5.2 Flujo Draft → Send (`handleCreateDrafts` + `handleSendDrafts`)

1. **createDrafts:** Crea Gmail drafts para cada recipient pending, status → `draft_ready`
2. **Revision manual:** El usuario puede revisar/editar cada draft
3. **sendDrafts:** Envia todos los drafts `draft_ready`, status → `sent`

### 5.3 Follow-up Individual (`handleSendDraft`)

- Si hay `draftId`: envia ese draft (con cuerpo editado opcional)
- Si no hay draft: busca thread existente (`from:X OR to:X`) y hace reply
- Si no hay thread: envia email nuevo

### 5.4 Template del Email Bridge Debt

El template real incluido en `BridgeExplorerView`:

```html
<p>Hola {{nombre}},</p>
<p>Ante la coyuntura actual del mercado - caracterizada por precios del pool
en minimos historicos, niveles de PPA que comprometen la rentabilidad y una
restriccion severa en la financiacion merchant tradicional - hemos disenado
una alternativa estrategica para desbloquear el valor de proyectos renovables.</p>
<p>En colaboracion con diversas instituciones financieras y el respaldo del
Fondo Europeo de Inversiones (FEI), hemos lanzado el <strong>Bridge Debt
Energy Program</strong>...</p>
```

**Placeholders soportados:**
- `{{nombre}}` / `{{name}}` → primer nombre del contacto
- `{{empresa}}` / `{{organization}}` / `{{company}}` → nombre organizacion

---

## 6. Knowledge Base (Base de Conocimiento)

### 6.1 Donde se almacena

- Campo `knowledgeBase` en la tabla Campaigns (Google Sheets)
- Se introduce en el **Step 2 (Configuracion)** al crear la campana
- Texto libre que describe el producto, propuesta de valor, proximos pasos

### 6.2 Como se usa

La knowledge base se inyecta en los prompts de Gemini cuando:
- Se genera un follow-up (`handleGenerateFollowUp`)
- Se compone desde instrucciones (`handleComposeFromInstructions`)
- El campo `knowledgeBase` se pasa como parte del contexto del prompt

### 6.3 Cerebro AI (sistema separado)

Existe tambien un sistema Cerebro (`CerebroSearch.tsx`, `airtableCerebro.ts`) con tabla Airtable `Cerebro-Knowledge` (`tbliZ7zNci5TUCAhj`) que almacena pares pregunta-respuesta. Esto es un sistema de busqueda diferente al knowledge base de campana.

---

## 7. Pipeline de Ventas (Post-Campana)

### 7.1 Etapas

```
nuevo → nurturing → reunion → subida_docs → doc_completada
                                                     ↓
                                               descartado
```

### 7.2 Movimiento Automatico

- Al enviar follow-up batch → si etapa es `nuevo`, mueve a `seguimiento`
- Sugerencias automaticas en UI:
  - Si contacto tiene ≥4 interacciones (opens+clicks) → sugiere "Reunion"
  - Si notas contienen keywords reunion/llamada/meeting → sugiere "Reunion"
  - Si notas contienen "no interesa"/"unsubscribe" → sugiere "Descartado"

### 7.3 Sincronizacion Bridge → Prospects

`bridgeProspectSync.ts` detecta:
- Cards del pipeline Bridge que avanzan → sugiere mover el Prospect
- Keywords de reunion en subjects del CRM → sugiere mover a "Reunion"

Mapping: `reunion` → Reunion, `subida_docs` → Documentacion Pendiente, `doc_completada` → Listo para Term-Sheet

---

## 8. Seleccion de Candidatas

### 8.1 CandidateSearchView (CRM)

Filtra empresas del CRM (`companies.json`) segun:
- Clasificacion (Originacion, Developer, etc.)
- Tecnologias (Solar, Eolica, etc.)
- Contactos con email valido
- Excluye dominios ya contactados (via `fetchSentDomains`)
- Prioriza contactos por rol: CEO (1) > CFO (2) > Financiacion Estructurada (3) > M&A (4) > Otros (5)

### 8.2 BridgeExplorerView (Explorer avanzado)

- Mismo filtrado + vista previa del email personalizado
- Template Bridge Debt integrado con preview por contacto
- Tracking de waves (`Bridge_Q1`, `Bridge_Q1_W2`, etc.)

### 8.3 Airtable CampaignTargets

Persiste en Airtable que empresas han sido revisadas:
- `Domain`, `CompanyName`, `Status` (pending/approved/rejected)
- `SelectedContacts` (JSON array)
- `CampaignRef` (wave identifier)
- `Segment`, `CompanyType`, `Technologies`

---

## 9. Tracking y Metricas

### 9.1 Dashboard (`handleDashboard`)

Devuelve:
```json
{
  "contactos": [{ "email", "nombre", "apellido", "organizacion", "grupo",
                  "variante", "estado", "fechaEnvio", "primeraApertura",
                  "numAperturas", "primerClic", "numClics", "respondido" }],
  "metricas": {
    "total": N,
    "errores": N,
    "A": { "enviados", "abiertos", "clics", "respondidos", "tasaApertura", "tasaClics", "tasaRespuesta" },
    "B": { ... },
    "Final": { "total", "enviados", "pendientes", "abiertos", "clics", "respondidos" }
  },
  "contactosRastreados": N,
  "actualizado": "ISO"
}
```

### 9.2 Metricas A/B Test

- Variante A y B se asignan aleatoriamente segun `abTestPercent`
- Tasas calculadas: apertura, clics, respuesta (por variante)
- Criterio ganador configurable: aperturas / clics / respuestas

### 9.3 Estados por Contacto

| Estado | Significado |
|--------|-------------|
| `pending` | En cola, no enviado |
| `draft_ready` | Draft creado en Gmail, pendiente envio |
| `sent` / `Enviado` | Email enviado |
| `Abierto` | Al menos 1 apertura |
| `Clic` | Al menos 1 clic |
| `Respondido` | Ha respondido |
| `Error` | Error al enviar |

---

## 10. Configuracion de Remitentes

### 10.1 senderConfig.ts (Frontend)

```typescript
DEFAULT_SENDERS = [
  { name: 'Leticia Menendez', email: 'leticia@alter-5.com' },
  { name: 'Salvador Carrillo', email: 'salvador.carrillo@alter-5.com' },
  { name: 'Javier Ruiz', email: 'javier.ruiz@alter-5.com' },
];
```

- CRUD en localStorage (`alter5_campaign_senders`)
- Step 5 del wizard permite seleccionar/gestionar remitentes

### 10.2 Sender en GAS

- `getSenderConfig()`: lee `SENDER_EMAIL` de Script Properties, fallback a primer campana
- `emailOptions()`: construye `{htmlBody, name, from}` para GmailApp
- Si el alias `from` falla → fallback sin alias (envia como cuenta del script)

---

## 11. Seguridad

### 11.1 Autenticacion en 3 Capas

```
Browser → Proxy (VITE_CAMPAIGN_PROXY_SECRET) → GAS (GAS_API_TOKEN)
```

1. **Browser → Proxy:** Header `x-proxy-secret` con `VITE_CAMPAIGN_PROXY_SECRET`
2. **Proxy → GAS POST:** Campo `token` en body con `GAS_API_TOKEN`
3. **GAS GET:** Sin token (datos read-only)

### 11.2 Variables de Entorno

| Variable | Scope | Donde |
|----------|-------|-------|
| `GAS_WEB_APP_URL` | Server | Vercel env |
| `GAS_API_TOKEN` | Server | Vercel env + GAS Script Properties |
| `CAMPAIGN_PROXY_SECRET` | Server | Vercel env |
| `VITE_CAMPAIGN_PROXY_SECRET` | Client | .env / Vercel env |
| `GEMINI_API_KEY` | GAS | GAS Script Properties |

---

## 12. Flujo Completo de una Campana

### Paso 1: Crear Campana (UI → GAS)
1. Usuario abre CampaignsView → click "Nueva Campana"
2. CampaignCreationPanel (wizard 6 pasos):
   - **Tipo:** Mass campaign o Follow-up 1-a-1
   - **Config:** Nombre, fecha programada, **knowledge base**
   - **Email:** Subject A, Body A (HTML), opcionalmente Subject B + Body B para A/B test
   - **Candidatas:** Seleccion desde CRM (CandidateSearchView) + emails manuales
   - **Remitente:** Seleccionar de lista configurable
   - **Revisar:** Resumen antes de crear
3. `createCampaign` → GAS inserta en Campaigns + Recipients sheets

### Paso 2: Enviar (UI → GAS)
1. Opcion A — **Envio directo:** `startCampaign` → envia todos los pending
2. Opcion B — **Draft + review:** `createDrafts` → revisa en Gmail → `sendDrafts`
3. Rate limit: 1 email/segundo. Cuota Gmail: ~100/dia gratis, ~2000 Workspace

### Paso 3: Monitorear (GAS → UI)
1. Dashboard muestra metricas en tiempo real (opens, clicks, replies por variante)
2. Pipeline muestra cards por etapa
3. Conversation view muestra thread Gmail + draft existente

### Paso 4: Clasificar Respuestas (GAS + Gemini)
1. Cuando hay reply → `classifyReply` con Gemini
2. Clasifica: interesado/reunion/no_interesado/informacion/fuera_oficina
3. Sentimiento: positivo/neutro/negativo
4. Puede mover automaticamente en el pipeline

### Paso 5: Follow-Up (GAS + Gemini)
1. `getFollowUpCandidates` → contactos con opens/clicks sin follow-up
2. **Batch:** `generateFollowUpBatch` → Gemini genera N borradores
3. Revision humana de borradores
4. `sendFollowUpBatch` → envia y mueve en pipeline

### Paso 6: Seguimiento Continuo
1. `generateScheduledDrafts` (trigger cada hora) → busca follow-ups programados
2. Si la fecha scheduledAt llego → genera draft con Gemini → guarda en Gmail
3. Status pasa a `draft_ready` → el usuario revisa y envia

---

## 13. Archivos del Sistema

### Google Apps Script
| Archivo | Descripcion |
|---------|-------------|
| `scripts/gas/campaignBackend.gs` | **Core:** ~1,900 lineas, 30+ handlers, IA + Gmail + Sheets |
| `scripts/gas/DEPLOY_CAMPAIGN.md` | Guia de deploy del GAS Web App |

### Vercel Proxy
| Archivo | Descripcion |
|---------|-------------|
| `api/campaign-proxy.js` | Proxy serverless: rutas GET/POST, inyeccion token |

### Frontend API Layer
| Archivo | Descripcion |
|---------|-------------|
| `src/utils/campaignApi.ts` | Funciones TS para todas las acciones del proxy |
| `src/utils/senderConfig.ts` | CRUD remitentes (localStorage) |
| `src/utils/airtableCandidates.ts` | CRUD CampaignTargets (Airtable) |
| `src/utils/bridgeProspectSync.ts` | Sync Bridge pipeline → Prospects stages |

### Frontend Components
| Componente | Descripcion |
|------------|-------------|
| `CampaignsView.tsx` | Lista de campanas con KPIs, filtros, busqueda |
| `CampaignCreationPanel.tsx` | Wizard 6 pasos para crear campana |
| `CampaignDetailView.tsx` | Detalle campana: metricas, conversaciones, follow-ups |
| `BridgeCampaignView.jsx` | Dashboard legacy: tabla contactos, pipeline Kanban |
| `BridgeExplorerView.tsx` | Explorer: seleccion candidatas + preview email |
| `BridgeSlideOverPanel.tsx` | Panel lateral: conversacion, draft editor, IA |
| `AddToCampaignModal.tsx` | Modal para anadir empresas a campana existente |
| `CandidateSearchView.tsx` | Busqueda/filtrado de candidatas del CRM |

### Scripts Python
| Script | Descripcion |
|--------|-------------|
| `scripts/import_campaign.py` | Importa CSV de campana → merge con companies_full.json |

---

## 14. Para Replicar en Otra Infraestructura

### Lo que necesitas recrear:

#### A) Backend de campanas (reemplaza GAS)
1. **Base de datos** con 4 tablas: Campaigns, Recipients, FollowUps, Pipeline
2. **Email sending** capaz de:
   - Enviar desde alias (multiple senders)
   - Rate limiting (~1/segundo)
   - Crear y enviar drafts
   - Leer threads por email address
   - Reply en thread existente
3. **API IA** (Gemini o equivalente) para:
   - Generar follow-ups contextuales
   - Clasificar respuestas
   - Mejorar textos
   - Resumir conversaciones
4. **Storage** para archivos (meeting notes)
5. **Trigger periodico** (cada hora) para generar drafts programados

#### B) Proxy/API Gateway
- Autenticacion 2 capas (client secret + server token)
- Routing GET (lectura) vs POST (mutaciones)
- CORS configurado

#### C) Frontend
- Wizard de creacion (tipo, config+KB, email+A/B, candidatas, sender, review)
- Dashboard con metricas por variante A/B
- Pipeline Kanban con drag-and-drop
- Conversation viewer con thread Gmail
- Draft editor con preview HTML
- Generacion IA inline (componer, mejorar, clasificar)

#### D) Datos
- CRM de empresas con contactos (nombre, email, rol, organizacion)
- Knowledge base por campana (texto libre)
- Tracking de empresas ya contactadas (dedup por dominio)
- CampaignTargets por wave (persistencia de seleccion)

### Alternativas de infraestructura:

| Componente actual | Alternativas |
|-------------------|-------------|
| Google Apps Script | Node.js/Python API (Railway, Fly.io, AWS Lambda) |
| Google Sheets DB | PostgreSQL, Supabase, Airtable, MongoDB |
| GmailApp | SendGrid, Resend, Amazon SES, Mailgun + IMAP |
| Gemini 2.0 Flash | Claude API, OpenAI GPT-4, Gemini via REST |
| Google Drive | S3, Cloudflare R2, Supabase Storage |
| Vercel Proxy | Cualquier API Gateway (Cloudflare Workers, etc.) |
| Airtable CampaignTargets | PostgreSQL table, Supabase |
