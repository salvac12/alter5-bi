# BRIDGE_EXPLORER_DESIGN.md
## Diseño funcional y técnico — "Continuar con más candidatos"
### Campaña Bridge Energy Debt — Wave 2+

---

> **Instrucciones para el modelo que implemente esto:**
> Lee este documento completo antes de ejecutar cualquier tarea.
> Cuando lo hayas leído, haz todas las preguntas que tengas sobre backend, frontend,
> integración con GAS, Airtable, remitentes y cualquier ambigüedad.
> No empieces a codificar hasta que el usuario haya respondido todas las dudas.

---

## 0. Contexto del sistema existente

### Stack
- **Frontend**: React + Vite, desplegado en Vercel
- **Base de datos de empresas**: `src/data/companies_full.json` — JSON estático generado por scripts Python, reconstruido con cada deploy
- **Airtable** (base `appVu3TvSZ1E4tj0J`): fuente de verdad para datos persistentes en tiempo real
  - `Campaigns` — campañas creadas
  - `CampaignTargets` — empresas candidatas por campaña (aprobadas, rechazadas, saltadas)
  - `BETA-Prospects` — pipeline comercial
  - `Opportunities` — deals activos
  - `Internal - Tasks` — tareas del equipo
  - `Cerebro-Knowledge` — base de conocimiento IA
- **Google Apps Script (GAS)**: backend de envío de emails, accesible via `/api/campaign-proxy` (Vercel serverless)
  - Hoja `Campaigns` — metadatos de campaña
  - Hoja `Recipients` — destinatarios con estado de envío
  - Hoja `Tracking` (legacy) — hoja original de la campaña Bridge con todos los enviados
  - Hoja `FollowUps` — seguimientos programados
- **Remitentes configurados** (en `localStorage` via `senderConfig.js`):
  - Leticia Menendez — `leticia@alter-5.com` (remitente principal Bridge)
  - Salvador Carrillo — `salvador.carrillo@alter-5.com`
  - Javier Ruiz — `javier.ruiz@alter-5.com`
  - Otros miembros del equipo en `TEAM_MEMBERS` (airtableProspects.js)
- **Proxy de campaña**: `/api/campaign-proxy.js` (Vercel serverless) → GAS Web App
  - Autenticado con `VITE_CAMPAIGN_PROXY_SECRET`
  - Acciones disponibles: `getCampaigns`, `getCampaign`, `createCampaign`, `startCampaign`, `addRecipients`, `dashboard`, `pipeline`, `moveStage`, `addNote`, `generateFollowUp`, `generateFollowUpBatch`, `sendFollowUpBatch`

### Cómo sabe el sistema qué dominios ya han recibido el email Bridge
`fetchSentDomains()` en `campaignApi.js` llama a la acción `dashboard` del GAS, que consolida:
1. Hoja `Tracking` legacy (la hoja original de Bridge con todos los enviados del test A/B)
2. Hoja `Recipients` del nuevo sistema (todos con `status != 'pending'`)

El resultado es un `Set<domain>` con todos los dominios ya contactados. Este es el **escudo principal** contra el reenvío — toda empresa cuyo dominio esté en este Set queda excluida absolutamente.

### Componentes relevantes
- `src/components/BridgeCampaignView.jsx` — dashboard principal de la campaña Bridge
- `src/components/CandidateSearchView.jsx` — vista de revisión de candidatas (embebida en wizard de creación de campaña)
- `src/components/CampaignCreationPanel.jsx` — wizard 6 pasos para crear campaña
- `src/utils/campaignApi.js` — todas las llamadas al GAS proxy + fetchSentDomains
- `src/utils/airtableCandidates.js` — CRUD de CampaignTargets en Airtable
- `src/utils/senderConfig.js` — gestión de remitentes (localStorage)

### PR ya mergeada (o pendiente de merge) antes de implementar esto
**PR #2**: `feat: preseleccionar solo el contacto top-1 por defecto en CandidateSearchView`
- Cambia `contactPriority` a 6 rangos (CEO/DG > CFO/DF > Fin.Estructurada > M&A > Otros > Sin cargo)
- Preselecciona automáticamente solo el top-1 al revisar empresas
- Añade badge "⭐ Recomendado" al contacto preseleccionado
**Verificar que esta PR esté mergeada antes de implementar el Explorer.**

---

## 1. Descripción funcional

### ¿Qué es?
Un módulo dentro de `BridgeCampaignView` que permite buscar y seleccionar nuevas empresas candidatas para enviarles el email de la campaña Bridge, en waves sucesivas, sin repetir ningún dominio ya contactado.

### Flujo completo paso a paso

```
1. Usuario está en BridgeCampaignView (cualquier tab)
2. Pulsa botón "＋ Continuar con más candidatos" (esquina superior derecha, junto a "Actualizar")
3. Se abre BridgeExplorerView (pantalla completa dentro de Bridge, con "← Volver")
4. [Opcional] Usuario escribe instrucciones para el LLM → la lista se reordena por relevancia
5. Usuario aplica filtros rápidos (segmento, tipo, tech, geo, targets prioritarios)
6. Ve lista de empresas ordenadas, una a una:
   - Pincha en una empresa → se expande mostrando contactos preseleccionados
   - Puede marcar/desmarcar contactos manualmente
   - Pulsa "✓ Seleccionar" o "→ Saltar por ahora"
7. En cualquier momento pulsa "Preparar envío" en la barra flotante inferior
8. Wizard de 3 pasos:
   - Paso 1: Elegir mensaje (usar el mismo A/B de Bridge / editar / crear nuevo)
   - Paso 2: Revisar destinatarios (lista editable)
   - Paso 3: Confirmar remitente y preparar paquete de envío
9. El paquete se registra en GAS (nueva campaña o nuevos recipients en campaña existente)
10. Estado guardado en Airtable CampaignTargets para continuar otro día
```

---

## 2. Punto de entrada en BridgeCampaignView

### Ubicación del botón
En la barra de cabecera de `BridgeCampaignView`, a la derecha de los controles actuales ("Datos de ejemplo", fecha, botón "Actualizar"):

```
[Bridge Debt Energy Program]  [Datos de ejemplo]  [fecha]  [Actualizar ↺]  [+ Continuar con más candidatos]
```

El botón "＋ Continuar con más candidatos" tiene estilo diferenciado (fondo ámbar o verde, no azul) para distinguirlo del botón de actualizar.

Al pulsarlo, en vez de navegar a otra ruta, renderiza `BridgeExplorerView` en lugar del contenido actual de `BridgeCampaignView` (sustitución de vista, no modal).

### Estado en BridgeCampaignView
```javascript
const [showExplorer, setShowExplorer] = useState(false);

// En el render:
if (showExplorer) {
  return (
    <BridgeExplorerView
      allCompanies={allCompanies}        // companies_full.json parseado
      campaignRef="Bridge_Q1"            // o el ref de la wave actual
      onBack={() => setShowExplorer(false)}
    />
  );
}
// ... render normal de BridgeCampaignView
```

**IMPORTANTE**: `allCompanies` viene de `App.jsx` que lo pasa como prop a `BridgeCampaignView`. Verificar que la prop exista y esté disponible. Si no existe actualmente, hay que añadirla.

---

## 3. BridgeExplorerView — nuevo componente

**Archivo**: `src/components/BridgeExplorerView.jsx`

**Props**:
```javascript
{
  allCompanies: Array,      // array de companies parseadas (de data.js parseCompanies())
  campaignRef: String,      // 'Bridge_Q1' — ref para CampaignTargets en Airtable
  onBack: Function,         // callback para volver a BridgeCampaignView
}
```

### 3.1 Estado del componente

```javascript
// Datos
const [trackingDomains, setTrackingDomains] = useState(new Set());
const [savedTargets, setSavedTargets] = useState({});       // domain → CampaignTarget record
const [loadingData, setLoadingData] = useState(true);
const [trackingError, setTrackingError] = useState(false);

// Ordenación LLM
const [llmOpen, setLlmOpen] = useState(false);
const [llmInstructions, setLlmInstructions] = useState('');
const [llmOrdering, setLlmOrdering] = useState(null);      // array de {domain, score, reason} del LLM
const [llmLoading, setLlmLoading] = useState(false);
const [llmLastRun, setLlmLastRun] = useState(null);         // timestamp

// Filtros
const [segFilter, setSegFilter] = useState('todas');
const [typeFilter, setTypeFilter] = useState('todos');
const [techFilter, setTechFilter] = useState([]);
const [geoFilter, setGeoFilter] = useState([]);
const [targetFilter, setTargetFilter] = useState('todos'); // 'todos' | 'ceo_dg' | 'cfo_df' | 'fin_estructurada'
const [statusFilter, setStatusFilter] = useState('pending'); // 'pending' | 'skipped' | 'all'
const [searchQuery, setSearchQuery] = useState('');
const [minScore, setMinScore] = useState(0);

// Selección y UI
const [selectedContacts, setSelectedContacts] = useState({});  // domain → Set<email>
const [expandedCompany, setExpandedCompany] = useState(null);
const [selectedForSend, setSelectedForSend] = useState(new Set()); // domains seleccionados para envío
const [page, setPage] = useState(0);
const [saving, setSaving] = useState(null);
const [toast, setToast] = useState(null);

// Wizard de envío
const [showSendWizard, setShowSendWizard] = useState(false);
```

### 3.2 Carga de datos al montar

```javascript
useEffect(() => {
  loadData();
}, []);

async function loadData() {
  setLoadingData(true);
  try {
    // 1. Dominios ya enviados (GAS Tracking + Recipients)
    let domains = new Set();
    try {
      domains = await fetchSentDomains();
    } catch {
      setTrackingError(true);
      // NO bloquear — mostrar banner de advertencia pero continuar
    }
    setTrackingDomains(domains);

    // 2. Targets ya guardados en Airtable para esta campaña
    const targets = await fetchCandidateTargets(campaignRef).catch(() => ({}));
    setSavedTargets(targets || {});
  } finally {
    setLoadingData(false);
  }
}
```

### 3.3 Derivar la lista de candidatos (memoizado)

```javascript
const explorerCandidates = useMemo(() => {
  // Dominios de empresas Originación (ya aparecen en CandidateSearchView normal)
  // Las incluimos aquí también si no han sido contactadas — son el pool principal
  
  return allCompanies
    .filter(c => {
      const domain = c.domain?.toLowerCase();
      if (!domain) return false;
      
      // REGLA 1 (ABSOLUTA): dominio ya enviado → excluir siempre
      if (trackingDomains.has(domain)) return false;
      
      // Solo Originación (Project Finance + Corporate Finance)
      if (c.role !== 'Originación') return false;
      
      // Necesita al menos un contacto con email
      if (!c.detail?.contacts?.some(ct => ct.email)) return false;
      
      // Filtro de estado (pending/skipped/all)
      const savedStatus = savedTargets[domain]?.status;
      if (statusFilter === 'pending') {
        // pending = no revisada O saltada
        if (savedStatus && savedStatus !== 'pending' && savedStatus !== 'skipped') return false;
      } else if (statusFilter === 'skipped') {
        if (savedStatus !== 'skipped') return false;
      }
      // 'all' = mostrar todo excepto las ya enviadas (rejected también)
      if (savedStatus === 'sent') return false;
      
      // Filtros de usuario
      if (segFilter !== 'todas' && c.segment !== segFilter) return false;
      if (typeFilter !== 'todos' && c.companyType !== typeFilter) return false;
      if (techFilter.length > 0 && !techFilter.every(t => c.technologies?.includes(t))) return false;
      if (geoFilter.length > 0 && !geoFilter.some(g => c.geography?.includes(g))) return false;
      
      // Filtro por target prioritario
      if (targetFilter !== 'todos') {
        const contacts = c.detail?.contacts || [];
        const hasPriority = contacts.some(ct => {
          const rank = contactPriority(ct.role);
          if (targetFilter === 'ceo_dg') return rank === 1;
          if (targetFilter === 'cfo_df') return rank === 2;
          if (targetFilter === 'fin_estructurada') return rank === 3;
          return false;
        });
        if (!hasPriority) return false;
      }
      
      // Búsqueda de texto
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !domain.includes(q)) return false;
      }
      
      return true;
    })
    .map(c => {
      // Scoring de calidad + relación (0-100)
      let score = 0;
      const enrichment = c.detail?.enrichment || {};
      
      // Calidad del enrichment
      if ((enrichment._tv || 0) >= 2 && c.role !== 'No relevante') score += 25;
      else if ((enrichment._tv || 0) >= 2) score += 10;
      
      // Calidad de contactos
      const identified = (c.detail?.contacts || []).filter(
        ct => ct.role && ct.role !== 'No identificado' && ct.role !== '' && ct.email
      );
      if (identified.length >= 2) score += 20;
      else if (identified.length === 1) score += 10;
      
      // Contacto prioritario identificado (CEO/DG o CFO/DF)
      const hasTopContact = identified.some(ct => contactPriority(ct.role) <= 2);
      if (hasTopContact) score += 10;
      
      // Volumen de interacciones
      if (c.interactions > 100) score += 20;
      else if (c.interactions > 50) score += 12;
      else if (c.interactions > 20) score += 6;
      else if (c.interactions > 5) score += 2;
      
      // Recencia
      if (c.monthsAgo <= 6) score += 15;
      else if (c.monthsAgo <= 18) score += 8;
      else if (c.monthsAgo <= 36) score += 3;
      
      // Contexto disponible
      if ((c.detail?.context || '').length > 200) score += 5;
      
      // Si el LLM ha dado un scoring, usarlo como override del orden (no del score base)
      const llmEntry = llmOrdering?.find(l => l.domain === c.domain?.toLowerCase());
      
      return {
        ...c,
        explorerScore: Math.min(100, score),
        llmScore: llmEntry?.score || null,
        llmReason: llmEntry?.reason || null,
      };
    })
    .filter(c => c.explorerScore >= minScore)
    .sort((a, b) => {
      // Si hay ordering del LLM, ese tiene prioridad
      if (llmOrdering) {
        const aScore = a.llmScore ?? -1;
        const bScore = b.llmScore ?? -1;
        if (aScore !== bScore) return bScore - aScore;
      }
      // Fallback: scoring estático
      return b.explorerScore - a.explorerScore;
    });
}, [allCompanies, trackingDomains, savedTargets, segFilter, typeFilter,
    techFilter, geoFilter, targetFilter, statusFilter, searchQuery, minScore, llmOrdering]);
```

### 3.4 Integración LLM para ordenación

El LLM recibe un prompt con las empresas candidatas (después de aplicar filtros) y las instrucciones del usuario. Devuelve un ranking.

```javascript
async function runLlmOrdering() {
  if (!llmInstructions.trim() || explorerCandidates.length === 0) return;
  setLlmLoading(true);
  
  try {
    // Preparar input compacto para el LLM (máximo 150 empresas para no saturar el contexto)
    const sample = explorerCandidates.slice(0, 150).map(c => ({
      domain: c.domain,
      name: c.name,
      segment: c.segment || '',
      type: c.companyType || '',
      tech: c.technologies || [],
      geo: c.geography || [],
      interactions: c.interactions,
      monthsAgo: c.monthsAgo,
      topContactRole: (() => {
        const contacts = (c.detail?.contacts || []).filter(ct => ct.email && ct.role);
        if (!contacts.length) return 'Sin contacto identificado';
        const sorted = [...contacts].sort((a, b) => contactPriority(a.role) - contactPriority(b.role));
        return sorted[0].role;
      })(),
      senales: c.senales || [],
      contextSnippet: (c.detail?.context || '').slice(0, 200),
    }));
    
    const prompt = `Eres un asistente de Alter5, consultora de financiación de energías renovables.
    
El usuario quiere priorizar empresas candidatas para recibir un email sobre el programa Bridge Debt Energy 
(financiación puente para proyectos renovables utility-scale, 18-24 meses, sin garantía corporativa, desde 2M EUR).

INSTRUCCIONES DEL USUARIO:
${llmInstructions}

LISTA DE EMPRESAS CANDIDATAS (${sample.length}):
${JSON.stringify(sample, null, 2)}

Responde SOLO con un JSON válido, array ordenado de mayor a menor prioridad:
[
  { "domain": "empresa.com", "score": 95, "reason": "frase corta de justificación" },
  ...
]
Incluye todas las empresas de la lista. Score de 0 a 100.`;

    // Llamar al LLM configurado (Gemini via VITE_GEMINI_API_KEY)
    // Usar la función existente en src/utils/gemini.js
    const { callGemini } = await import('../utils/gemini.js');
    const result = await callGemini(prompt);
    
    // Parsear respuesta
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const ordering = JSON.parse(jsonMatch[0]);
      setLlmOrdering(ordering);
      setLlmLastRun(new Date());
    }
  } catch (err) {
    console.error('LLM ordering failed:', err);
    // Fallar silenciosamente — la lista sigue con el orden estático
  } finally {
    setLlmLoading(false);
  }
}
```

**IMPORTANTE**: Verificar que `src/utils/gemini.js` tenga una función exportada `callGemini(prompt)` o similar. Si no existe con ese nombre exacto, usar la función correcta que sí exista.

### 3.5 Guardar estado en Airtable

Las acciones del usuario se persisten en `CampaignTargets` (tabla ya existente, misma que usa `CandidateSearchView`):

```javascript
async function handleAction(company, status) {
  // status puede ser: 'selected' | 'skipped' | 'rejected' | 'pending'
  const domain = company.domain?.toLowerCase();
  if (!domain) return;
  setSaving(domain);
  
  const existing = savedTargets[domain];
  const contacts = status === 'selected'
    ? getSelectedContactsForCompany(company)
    : (existing?.selectedContacts || []);
  
  try {
    const result = await upsertCandidateTarget({
      id: existing?.id || null,
      domain,
      companyName: company.name,
      status,               // 'selected' es nuevo — añadir al enum del campo Status en Airtable
      selectedContacts: contacts,
      campaignRef,
      segment: company.segment || '',
      companyType: company.companyType || '',
      technologies: company.technologies || [],
      reviewedBy: getCurrentUser()?.name || '',
      reviewedAt: new Date().toISOString().split('T')[0],
    });
    
    setSavedTargets(prev => ({
      ...prev,
      [domain]: {
        ...prev[domain],
        id: result.id,
        domain,
        companyName: company.name,
        status,
        selectedContacts: contacts,
        campaignRef,
      },
    }));
    
    // Si seleccionada, añadir al set de envío
    if (status === 'selected') {
      setSelectedForSend(prev => new Set([...prev, domain]));
    } else {
      setSelectedForSend(prev => {
        const next = new Set(prev);
        next.delete(domain);
        return next;
      });
    }
    
    showToast(status === 'selected' ? `✓ ${company.name} añadida` : `→ ${company.name} saltada`);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    setSaving(null);
  }
}
```

**NOTA SOBRE AIRTABLE**: El campo `Status` en `CampaignTargets` actualmente acepta: `pending`, `approved`, `skipped`, `rejected`. 
Hay que añadir `selected` y `sent` al enum. Verificar si el campo es un `singleSelect` en Airtable (en cuyo caso habría que actualizar el schema via Meta API o manualmente) o un `singleLineText` (en cuyo caso acepta cualquier valor sin cambios).

---

## 4. Estructura visual de BridgeExplorerView

### 4.1 Cabecera
```
[← Volver a la campaña]   Bridge Energy Debt — Nuevos candidatos
                           312 empresas por revisar · 8 seleccionadas
```

### 4.2 Panel LLM (colapsable)
```
🤖 Ordenar con IA  [▼]
(expandido)
[textarea: instrucciones del usuario]
[✨ Reordenar lista]  Última ordenación: hace 5 min
```

### 4.3 Filtros
Fila de selects/chips:
- Segmento: Todos / Project Finance / Corporate Finance
- Tipo de empresa: select con valores únicos de `companyType`
- Tecnología: chips multi-selección (Solar, Eólica, BESS, Hidro...)
- Geografía: chips multi-selección (España, Portugal, Italia, Francia...)
- Target prioritario: Todos / Con CEO o DG / Con Dir. Financiero / Con Fin. Estructurada
- Estado: Sin revisar / Saltadas / Todas
- Score mínimo: slider o input numérico (default 0)
- Búsqueda texto: input libre

### 4.4 Contador y acciones globales
```
Mostrando 87 de 312 candidatas  [Seleccionar todas visibles]  [Deseleccionar todas]
```

### 4.5 Tarjeta de empresa (en lista)

**Estado compacto** (no expandida):
```
● [score 85] Solarpack Iberia          Developer · PF · España · 34 emails · hace 3m
  ⭐ "RTB mencionado, Dir. Financiero identificado"  ← razón del LLM (si disponible)
  [✓ Seleccionar]  [→ Saltar]
```

**Estado expandido** (al pinchar en la tarjeta):
```
▼ Solarpack Iberia                     Developer · PF · España
  
  Contactos para este envío:
    ☑  ⭐ Carlos Martínez  — Director Financiero    [RECOMENDADO]
    ☐     Ana López        — Responsable de Compras
    ☐     info@solarpack   — (sin cargo)
  
  Últimas señales: "RTB, financiación puente, PPA largo plazo"
  Contexto: "Empresa desarrolladora con 450MW en portfolio..."
  
  [✓ Seleccionar con estos contactos]     [→ Saltar por ahora]     [✕ Descartar]
```

**Estado seleccionada** (tras pulsar Seleccionar):
```
✓ Solarpack Iberia  · 1 contacto seleccionado · Carlos Martínez  [Editar]  [Quitar]
```

**Estado saltada**:
```
→ Solarpack Iberia  (saltada)  [Recuperar]
```

### 4.6 Barra flotante inferior (aparece cuando hay ≥1 seleccionada)
```
┌─────────────────────────────────────────────────────────────────────┐
│  ✓ 8 empresas seleccionadas  ·  11 contactos                        │
│                              [Preparar envío para seleccionadas →]  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Wizard "Preparar envío" — 3 pasos

Se abre como modal o vista superpuesta sobre el Explorer.

### Paso 1 — Elegir mensaje base
```
¿Qué email vas a enviar?

  ◉ El mismo email de la campaña Bridge (variante ganadora del A/B)
      Asunto: [asunto de la variante ganadora]
      [Vista previa del cuerpo]

  ○ Editar el email antes de enviar
      (carga el texto de la variante ganadora en un editor, editable)

  ○ Crear un mensaje nuevo desde cero
      Asunto: [input]
      Cuerpo: [textarea con variables disponibles: {nombre}, {empresa}, {cargo}]
```

**Cómo obtener el email de Bridge**: La campaña Bridge tiene `id` conocido en Airtable (`Campaigns`). Llamar a `getCampaign(bridgeCampaignId)` para obtener `subjectA`, `bodyA`, `subjectB`, `bodyB`, `abWinner`. La variante ganadora se infiere de `abWinner` (que puede ser `'A'`, `'B'`, o `null` si no hay ganadora clara).

**DUDA PENDIENTE**: ¿Cuál es el `campaignId` de la campaña Bridge en Airtable? 
El sistema debe detectarlo automáticamente buscando en la lista de campañas la que tenga `name.includes('bridge')` (igual que hace `App.jsx` para mostrar `BridgeCampaignView`).

### Paso 2 — Revisar destinatarios
```
11 contactos en 8 empresas

  Email                      Nombre            Empresa           Cargo
  carlos@solarpack.com       Carlos Martínez   Solarpack Iberia  Director Financiero  [✕]
  cfo@endesa.com             Laura Pérez       Endesa Renov.     CFO                  [✕]
  ...

[+ Añadir email manual]
```
Cada fila tiene botón [✕] para quitar ese contacto antes de enviar.

### Paso 3 — Confirmar remitente y preparar
```
Remitente:
  [select con los remitentes de senderConfig.js]
  ◉ Leticia Menendez (leticia@alter-5.com)
  ○ Salvador Carrillo (salvador.carrillo@alter-5.com)
  ○ Javier Ruiz (javier.ruiz@alter-5.com)

Resumen:
  · 11 contactos en 8 empresas
  · Asunto: [el elegido]
  · Remitente: Leticia Menendez

[← Volver]          [✓ Preparar envío]
```

### Acción "Preparar envío"

**NO envía los emails directamente.** Hace lo siguiente:

1. **Crea una nueva campaña en GAS** via `createCampaign({name, type:'mass', senderEmail, senderName, subjectA, bodyA, ...})` — o reutiliza la campaña Bridge existente si el usuario eligió el mismo mensaje (en ese caso, usar `addRecipients` a la campaña Bridge).

2. **Añade los recipients** via `addRecipients({ campaignId, recipients: [{email, name, lastName, organization, role}] })`.

3. **Marca los dominios como `status: 'sent'`** en `CampaignTargets` de Airtable (o `status: 'approved'` si se quiere mantener compatibilidad con el flujo anterior — **DUDA PENDIENTE**).

4. Cierra el wizard y muestra confirmación: *"Listo. 11 emails preparados para envío desde el dashboard de campaña."*

5. **No llama a `startCampaign`** — el usuario lanzará el envío manualmente desde el dashboard de campaña cuando quiera.

---

## 6. Modelo de datos — CampaignTargets en Airtable

### Campos actuales de la tabla `CampaignTargets`
| Campo | Tipo | Valores |
|---|---|---|
| `Domain` | singleLineText | dominio de la empresa |
| `CompanyName` | singleLineText | nombre |
| `Status` | singleLineText o singleSelect | `pending`, `approved`, `skipped`, `rejected` |
| `SelectedContacts` | multilineText (JSON) | `[{email, name, role}]` |
| `CampaignRef` | singleLineText | `'Bridge_Q1'` |
| `Segment` | singleLineText | `'Project Finance'`, `'Corporate Finance'` |
| `CompanyType` | singleLineText | tipo de empresa |
| `Technologies` | multilineText (JSON) | `['Solar', 'Eólica']` |
| `ReviewedBy` | singleLineText | nombre del usuario |
| `ReviewedAt` | date | fecha de revisión |
| `Notes` | multilineText | notas libres |

### Nuevos valores de Status para este módulo
| Valor | Significado |
|---|---|
| `pending` | No revisada todavía (estado inicial) |
| `skipped` | Saltada — vuelve a aparecer en próxima sesión |
| `selected` | Seleccionada para envío en este lote |
| `sent` | Email ya enviado (se setea después de preparar envío) |
| `rejected` | Descartada permanentemente — no vuelve a aparecer |
| `approved` | Compatible con flujo anterior de CandidateSearchView |

**DUDA CLAVE**: ¿El campo `Status` en Airtable es `singleSelect` o `singleLineText`?
- Si es `singleSelect`: hay que añadir las opciones `selected` y `sent` via Meta API o manualmente en Airtable antes de hacer PATCH. Si se envía un valor no listado, Airtable devuelve error 422.
- Si es `singleLineText`: acepta cualquier valor sin cambios en el schema.
**Verificar esto antes de implementar.**

### CampaignRef para waves sucesivas
La campaña Bridge original usa `CampaignRef = 'Bridge_Q1'`. Para la wave 2, se puede usar `'Bridge_Q1_W2'` o simplemente seguir usando `'Bridge_Q1'` (ya que los dominios ya enviados se filtran por `fetchSentDomains()`, no por `CampaignRef`).
**Decisión pendiente del usuario.**

---

## 7. Integración del remitente — cómo funciona el envío real

### Sistema actual
Los emails los envía GAS (`campaignBackend.gs`) actuando como el remitente configurado. En GAS, el remitente se especifica en la campaña (`senderEmail`, `senderName`). Gmail envía el email desde la cuenta que tiene el script autorizado (típicamente la cuenta de Google del propietario del script — actualmente la de Leticia o Salvador).

### Limitación importante
GAS solo puede enviar emails **desde la cuenta de Google que autorizó el script**. Si el script está autorizado por Leticia, solo puede enviar desde `leticia@alter-5.com`, aunque el campo `senderEmail` diga otra cosa (en ese caso, aparece como "en nombre de"). Para enviar desde otra cuenta de Alter-5, habría que:
1. Crear un segundo deployment del script GAS autorizado por esa cuenta, ó
2. Usar la API de Gmail con OAuth2 delegation, ó
3. Usar Google Workspace "Send As" (si está configurado en la cuenta del propietario del script)

**ACCIÓN REQUERIDA**: El wizard de "Preparar envío" debe mostrar un aviso claro de que el remitente real del envío depende de la cuenta que tiene el GAS autorizado, y que seleccionar otro remitente puede requerir configuración adicional.

### senderConfig.js
Los remitentes disponibles están en `localStorage` con valores por defecto:
- `Leticia Menendez` — `leticia@alter-5.com`
- `Salvador Carrillo` — `salvador.carrillo@alter-5.com`
- `Javier Ruiz` — `javier.ruiz@alter-5.com`

El usuario puede añadir o quitar remitentes desde la UI. El wizard debe usar `getSenders()` para cargar la lista.

---

## 8. Archivos a crear o modificar

### Nuevos archivos
| Archivo | Descripción |
|---|---|
| `src/components/BridgeExplorerView.jsx` | Componente principal del Explorer |

### Archivos a modificar
| Archivo | Cambio |
|---|---|
| `src/components/BridgeCampaignView.jsx` | Añadir botón "Continuar con más candidatos" + lógica de `showExplorer` + pasar `allCompanies` prop |
| `src/App.jsx` | Verificar que `allCompanies` se pasa como prop a `BridgeCampaignView` |
| `src/utils/campaignApi.js` | Posiblemente añadir acción `addRecipients` si no existe |
| `scripts/gas/campaignBackend.gs` | Posiblemente añadir handler `addRecipients` si no existe |

### Archivos que NO hay que tocar
- `src/utils/airtableCandidates.js` — ya tiene `fetchCandidateTargets` y `upsertCandidateTarget`, se reutilizan tal cual
- `src/utils/campaignApi.js` — `fetchSentDomains` ya funciona, no modificar su lógica
- `src/utils/senderConfig.js` — reutilizar `getSenders()` directamente

---

## 9. Dudas abiertas que el implementador debe resolver antes de codificar

1. **¿El campo `Status` de `CampaignTargets` en Airtable es `singleSelect` o `singleLineText`?** Si es singleSelect, hay que añadir `selected` y `sent` manualmente en Airtable o via Meta API antes de hacer cualquier PATCH.

2. **¿Existe la acción `addRecipients` en `campaignBackend.gs`?** Buscar en el GAS si existe un handler para `addRecipients`. Si no existe, hay que añadirlo.

3. **¿`allCompanies` se pasa actualmente como prop a `BridgeCampaignView` desde `App.jsx`?** Si no, hay que añadir esa prop. Verificar en `App.jsx` cómo se renderiza `BridgeCampaignView`.

4. **¿Existe `callGemini()` o similar en `src/utils/gemini.js`?** Verificar el nombre exacto de la función exportada para el LLM. Puede llamarse `generateWithGemini`, `askGemini`, etc.

5. **¿Cuál es el `campaignId` de la campaña Bridge en Airtable?** Hay que detectarlo automáticamente buscando en `getCampaigns()` la campaña cuyo nombre contiene "bridge" (case-insensitive). Guardar ese ID en estado para usarlo en el wizard.

6. **CampaignRef para Wave 2**: ¿Usar `'Bridge_Q1'` (misma ref que la wave 1) o `'Bridge_Q1_W2'`? Impacta cómo se filtran los targets en Airtable.

7. **¿Qué pasa con las empresas ya en `CandidateSearchView` con `status: 'approved'`?** ¿Las debe mostrar el Explorer (para poder seleccionarlas en el envío) o debe excluirlas?

---

## 10. Lo que este módulo NO hace (límites claros)

- ❌ No envía emails directamente — solo prepara el paquete en GAS
- ❌ No toca empresas ya enviadas (`trackingDomains`) — exclusión absoluta
- ❌ No modifica el pipeline de Bridge ni el estado de respuestas existentes
- ❌ No genera el contenido del email con IA (el contenido viene del A/B ya lanzado o lo escribe el usuario)
- ❌ No modifica `CandidateSearchView` — son dos vistas independientes con el mismo backend (Airtable CampaignTargets)
- ❌ No gestiona la lógica de seguimiento (eso está en el tab "Seguimiento" de BridgeCampaignView)