# Próximos Pasos — Campaign Backend GAS
**Sesión:** 11 de marzo de 2026
**Contexto:** Se han implementado TODAS las acciones GAS que faltaban en `campaignBackend.gs` para que BridgeCampaignView y BridgeSlideOverPanel funcionen completamente.

---

## 1. Qué hemos hecho

### Pipeline Sheet + Persistencia
- **Nueva sheet "Pipeline"** con headers: `email, etapa, etapaAnterior, fechaCambio, fechaCreacion, notas, historial`
- **`handleMoveStage`** — Mueve contacto a nueva etapa, guarda historial como JSON
- **`handleAddNote`** — Añade notas con timestamp al pipeline
- **`handlePipeline`** upgrade — Ya no es stub vacío, lee de la sheet Pipeline con notas/historial parseados y datos del recipient

### Lectura Gmail (3 handlers GET)
- **`handleGetConversation`** — Busca threads en Gmail (`from:EMAIL OR to:EMAIL`), devuelve último reply del contacto + borrador existente + historial completo
- **`handleGetConversacionCompleta`** — Thread completo + resumen AI con Gemini
- **`handleGetFollowUpCandidates`** — Cruza Recipients (opens/clicks) con FollowUps para contar seguimientos enviados

### Escritura Gmail (4 handlers POST)
- **`handleSendDraft`** — Envía draft existente (con edición opcional) o reply a thread existente
- **`handleSaveDraft`** — Guarda/actualiza borrador Gmail para un email
- **`handleComposeAndSaveDraft`** — Crea draft nuevo con asunto y cuerpo dados
- **`handleUploadMeetingNotes`** — Sube archivo a Drive (base64) + añade nota al Pipeline

### AI con Gemini (5 funciones)
- **`callGemini(prompt, maxTokens)`** — Helper Gemini 2.0 Flash via REST, usa Script Property `GEMINI_API_KEY`
- **`getConversationContext(email, maxMessages)`** — Lee threads Gmail, identifica `esLeticia` por dominio alter-5.com/alter5.com
- **`handleGenerateFollowUp`** — Genera borrador de seguimiento personalizado con contexto de conversación
- **`handleImproveMessage`** — Mejora texto de email con Gemini
- **`handleComposeFromInstructions`** — Compone email desde instrucciones + contexto conversación
- **`handleClassifyReply`** — Clasifica respuesta (interesado/reunion/no_interesado/informacion/fuera_oficina/otro) + sentimiento

### Batch (2 handlers POST)
- **`handleGenerateFollowUpBatch`** — Genera borradores para múltiples contactos (max 15), rate limit 500ms entre Gemini calls
- **`handleSendFollowUpBatch`** — Envía emails en batch con rate limit 1s, mueve a etapa "seguimiento" en Pipeline

### Gestión de campañas extras (2 handlers POST)
- **`handleUpdateCampaign`** — Actualiza campos específicos de campaña (name, sender, subjects, bodies, notes, knowledgeBase)
- **`handleCampaignDashboard`** — Dashboard de métricas para una campaña específica

### Datos + Fixes
- **`clickedTime`** añadido a RECIPIENT_HEADERS
- **`knowledgeBase`** añadido a CAMPAIGN_HEADERS
- **`primerClic`** en handleDashboard ahora mapea `r.clickedTime` correctamente (antes era `null`)
- **`findDraftForEmail`** helper — Busca drafts existentes en Gmail por email destinatario
- **`findRecipientByEmail`** helper — Busca datos de recipient para enriquecer pipeline cards
- **`getSenderConfig`** helper — Lee sender de Script Properties con fallback a campaña activa

### Routing actualizado
- **doGet**: 4 nuevos cases (getConversation, getConversacionCompleta, getFollowUpCandidates, getConversaciones)
- **doPost**: 16 handlers nuevos en el mapa de routing
- **Proxy** (`api/campaign-proxy.js`): añadidos `getConversacionCompleta`, `composeAndSaveDraft`, `uploadMeetingNotes`, `updateCampaign`, `getCampaignDashboard`

### Archivos
- `campaignBackend.gs` copiado a `~/Desktop/campaignBackend.gs` para pegar en GAS
- Build OK (`npm run build` sin errores)

---

## 2. Pre-requisitos antes de verificar

### En Google Apps Script
1. **Pegar** `~/Desktop/campaignBackend.gs` en el proyecto GAS (reemplazar todo el código)
2. **Nueva implementación** (Deploy > New deployment > Web App > Execute as Me > Anyone can access)
3. **Actualizar URL** en Vercel env var `GAS_WEB_APP_URL` si cambió el deployment ID

### Script Properties necesarias
| Property | Requerida | Para qué |
|----------|-----------|----------|
| `API_TOKEN` | Sí | Auth de POST requests (ya debería existir) |
| `LEGACY_SHEET_ID` | Sí | Dashboard legacy (ya debería existir) |
| `GEMINI_API_KEY` | Para AI | generateFollowUp, improveMessage, composeFromInstructions, classifyReply, getConversacionCompleta |
| `SENDER_EMAIL` | Opcional | Email remitente para envíos (fallback: campaña activa) |
| `SENDER_NAME` | Opcional | Nombre remitente |
| `NOTES_FOLDER_ID` | Opcional | Carpeta Drive para notas de reunión |

### Permisos GAS
- GmailApp (leer/enviar/drafts) — ya debería tener
- DriveApp — necesario si se usa `uploadMeetingNotes`

---

## 3. Verificaciones funcionales

| # | Qué verificar | Cómo | Resultado esperado |
|---|---------------|------|-------------------|
| 1 | Dashboard carga | Abrir tab Campañas | Métricas + contactos aparecen ✅ (ya funcionaba) |
| 2 | primerClic | Ver columna "Primer Clic" en dashboard | Fecha aparece si hay clickedTime en Recipients |
| 3 | Pipeline persiste | Tab Pipeline > mover card de etapa | Al recargar, la card sigue en la etapa nueva |
| 4 | Notas pipeline | Tab Pipeline > añadir nota a contacto | La nota aparece al recargar |
| 5 | Conversación | SlideOverPanel > abrir contacto | Historial de emails carga, borrador existente se detecta |
| 6 | Conversación completa | Ver hilo completo | Todos los mensajes + resumen AI (req GEMINI_API_KEY) |
| 7 | Guardar borrador | Editar borrador en panel > guardar | Se crea/actualiza draft en Gmail |
| 8 | Enviar draft | Botón enviar en panel | El email se envía (draft o reply) |
| 9 | Candidatos seguimiento | Tab Seguimiento | Lista de contactos que abrieron/clicaron con conteo |
| 10 | Generar seguimiento AI | Botón "Generar seguimiento" | Gemini genera borrador personalizado (req GEMINI_API_KEY) |
| 11 | Mejorar mensaje | Botón "Mejorar" en editor | Gemini mejora el texto (req GEMINI_API_KEY) |
| 12 | Componer desde instrucciones | Instrucciones > generar | Email compuesto con contexto (req GEMINI_API_KEY) |
| 13 | Clasificar respuesta | Reply recibido > clasificar | Categoría + sentimiento (req GEMINI_API_KEY) |
| 14 | Batch generar | Seleccionar múltiples > generar | Borradores para cada contacto, max 15 (req GEMINI_API_KEY) |
| 15 | Batch enviar | Seleccionar múltiples > enviar | Emails enviados, pipeline actualizado |
| 16 | Subir notas reunión | Panel > subir archivo | Archivo en Drive + nota en Pipeline |
| 17 | Actualizar campaña | Editar nombre/subject de campaña | Cambios persisten al recargar |
| 18 | Dashboard campaña | Ver métricas de campaña específica | Contactos + métricas filtrados por campaignId |

---

## 4. Notas importantes

- **Tests seguros (no envían nada)**: 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 17, 18
- **Tests que envían emails reales**: 8, 14, 15 — probar con emails de test primero
- **Tests que crean drafts**: 7 — seguro, crea borrador en Gmail sin enviar
- **Tests que requieren GEMINI_API_KEY**: 6, 10, 11, 12, 13, 14
- La sheet "Pipeline" se auto-crea en el primer `moveStage` o `addNote`
- Los handlers de AI fallan gracefully si no hay `GEMINI_API_KEY` (devuelven error descriptivo)

---

**Para continuar:** Pegar el GAS, nueva implementación, y verificar los 18 puntos en orden.
