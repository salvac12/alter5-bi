# Bridge Energy Debt — Búsqueda y Selección de Candidatos

> Este documento describe en detalle cómo funciona el módulo **BridgeExplorerView**: la herramienta que el equipo usa para descubrir nuevas empresas candidatas para la campaña Bridge Energy Debt, revisarlas una a una, seleccionar los contactos adecuados y preparar el envío de emails.

---

## Tabla de Contenidos

### Parte I — Negocio
1. [¿Qué es el Explorer y cuándo se usa?](#1-qué-es-el-explorer-y-cuándo-se-usa)
2. [De dónde vienen los candidatos](#2-de-dónde-vienen-los-candidatos)
3. [Por qué una empresa es excluida automáticamente](#3-por-qué-una-empresa-es-excluida-automáticamente)
4. [El Bridge Score — cómo se puntúa cada empresa](#4-el-bridge-score--cómo-se-puntúa-cada-empresa)
5. [Prioridad de contacto — a quién se le manda el email](#5-prioridad-de-contacto--a-quién-se-le-manda-el-email)
6. [Filtros disponibles para acotar la búsqueda](#6-filtros-disponibles-para-acotar-la-búsqueda)
7. [Ordenación con IA — Gemini sobre instrucciones libres](#7-ordenación-con-ia--gemini-sobre-instrucciones-libres)
8. [Revisión una a una — acciones sobre cada empresa](#8-revisión-una-a-una--acciones-sobre-cada-empresa)
9. [El wizard de envío — de seleccionadas a borradores en Gmail](#9-el-wizard-de-envío--de-seleccionadas-a-borradores-en-gmail)
10. [Persistencia y waves — cómo se gestiona la memoria](#10-persistencia-y-waves--cómo-se-gestiona-la-memoria)

### Parte II — Técnica
11. [Arquitectura del componente](#11-arquitectura-del-componente)
12. [Carga de datos al arrancar](#12-carga-de-datos-al-arrancar)
13. [Pipeline de filtrado — código completo](#13-pipeline-de-filtrado--código-completo)
14. [bridgeScore() — función de puntuación](#14-bridgescore--función-de-puntuación)
15. [contactPriority() — selección del destinatario](#15-contactpriority--selección-del-destinatario)
16. [LLM Ordering — llamada a Gemini](#16-llm-ordering--llamada-a-gemini)
17. [handleAction() — persistir decisiones en Airtable](#17-handleaction--persistir-decisiones-en-airtable)
18. [El wizard técnico — openWizard y flujo de envío](#18-el-wizard-técnico--openwizard-y-flujo-de-envío)
19. [Referencia de llamadas externas](#19-referencia-de-llamadas-externas)

---

# Parte I — Negocio

## 1. ¿Qué es el Explorer y cuándo se usa?

El **Bridge Explorer** (`BridgeExplorerView`) es la herramienta de prospección que permite al equipo preparar cada nueva "wave" (oleada) de la campaña Bridge Energy Debt.

**Cuándo se activa**: al pulsar el botón "Preparar nueva wave" desde el dashboard principal de Bridge (`BridgeCampaignView`). El sistema detecta automáticamente cuántas waves ya se han enviado y propone el siguiente ID (por ejemplo, si van dos waves — `Bridge_Q1` y `Bridge_Q1_W2` — la siguiente es `Bridge_Q1_W3`).

**Qué hace**: muestra todas las empresas del CRM que son candidatas legítimas para recibir el email de Bridge, las puntúa automáticamente, y permite al equipo revisarlas, filtrarlas, seleccionarlas y lanzar el envío de forma controlada.

**Flujo completo de una wave**:

```
1. Equipo pulsa "Preparar nueva wave"
        ↓
2. Explorer carga candidatas (CRM filtrado por exclusiones + score)
        ↓
3. Equipo revisa empresa por empresa:
   - Seleccionar (✓)   → se añade a la lista de envío
   - Saltar (→)        → se queda para waves futuras
   - Descartar (✕)     → se excluye permanentemente
        ↓
4. Opcionalmente, se usa IA (Gemini) para reordenar la lista
        ↓
5. Equipo pulsa "Preparar envío"
        ↓
6. Wizard de 2 pasos:
   Paso 1: Revisar lista final de destinatarios, eliminar si procede
   Paso 2: Crear borradores en Gmail de Leticia → revisar → Enviar
```

---

## 2. De dónde vienen los candidatos

El universo de candidatos es el **CRM completo de Empresas** (~5.261 empresas en `companies.json`). Sin embargo, antes de mostrar cualquier empresa, el sistema aplica una serie de filtros obligatorios que no se pueden desactivar.

**Requisito base** (hardcodeado, siempre activo):

- La empresa debe tener `role === "Originación"` — solo promotores, developers e IPPs que buscan financiación. Fondos, bancos, asesores y empresas irrelevantes quedan excluidos.
- Debe tener al menos un contacto con email válido en el CRM.

Esto reduce el universo a ~1.000–1.300 empresas que cumplen el perfil básico del programa Bridge.

---

## 3. Por qué una empresa es excluida automáticamente

El sistema tiene **7 escudos de exclusión** que se aplican secuencialmente para garantizar que **ninguna empresa recibe el email dos veces**. Los escudos se construyen al arrancar el Explorer a partir de cuatro fuentes de datos:

```
Fuente 1: GAS Tracking sheet (Google Sheets)
  → fetchSentDomains() → Set de dominios ya enviados
  → fetchSentEmails() → Set de emails concretos ya enviados

Fuente 2: Airtable CampaignTargets (todas las waves)
  → fetchAllBridgeTargets("Bridge_Q1")
  → Dominios con status approved/sent/selected en cualquier wave

Fuente 3: CRM de Empresas (companies.json)
  → Empresas donde Leticia Menéndez tiene interacciones registradas

Fuente 4: Props del componente padre (BridgeCampaignView)
  → bridgeContacts: contactos activos de la campaña actual (GAS dashboard)
  → previousTargets: targets de waves anteriores ya aprobados/enviados
```

**Los 7 escudos en detalle**:

| # | Nombre | Fuente | Qué comprueba |
|---|--------|--------|----------------|
| 1 | Bridge contacts | GAS dashboard | El dominio del email de la empresa aparece entre los destinatarios actuales de la campaña |
| 2 | GAS Tracking | Google Sheets | El dominio aparece en la hoja de tracking de enviados del GAS |
| 3 | Airtable all waves | CampaignTargets | El dominio tiene status `approved`, `sent` o `selected` en **cualquier** wave Bridge anterior |
| 4 | Leticia CRM | companies.json | Leticia (`leticia_menéndez`) tiene interacciones registradas con esta empresa en el CRM |
| 5 | Previous targets | Props padre | El dominio fue aprobado/enviado en waves anteriores pasadas como prop |
| 6a | Email exacto vs GAS | fetchSentEmails() | El email concreto de algún contacto de la empresa ya fue enviado (cubre dominios genéricos como gmail.com) |
| 6b | Email exacto vs Bridge | bridgeContactEmails | El email concreto aparece en los contactos activos de Bridge |
| 6c | Email exacto vs Airtable | atTargetEmails | El email aparece en `selectedContacts` de algún target aprobado en Airtable |
| 7a | Nombre empresa vs GAS | sentCompanyNames | El nombre de la empresa (lowercase) coincide con el de un contacto ya enviado |
| 7b | Nombre empresa vs Airtable | atTargetNames | El nombre coincide con el de un target aprobado en Airtable |

> **¿Por qué tantas capas?** Cada fuente cubre un caso que las otras no cubren. GAS tracking puede estar desconfigurado → Airtable es el fallback autoritativo. Dominios genéricos (gmail.com) no sirven como identificador → se comprueba el email exacto. Empresas que cambiaron de dominio → se comprueba el nombre.

**Estados adicionales** que excluyen una empresa del Explorer:

- `status === "sent"` en la wave actual → ya fue enviada en esta wave
- `status === "rejected"` → descartada permanentemente, nunca se muestra

---

## 4. El Bridge Score — cómo se puntúa cada empresa

Cada empresa que pasa los escudos recibe automáticamente un **Bridge Score de 0 a 100** que mide su idoneidad para el programa Bridge Energy Debt.

**Fórmula**:

```
Bridge Score = tipo_empresa + segmento + fase_activo + tecnologías
              (máx 40)       (máx 25)    (máx 25)      (máx 10)
                                                            = máx 100
```

**Detalle de cada componente**:

### Tipo de empresa (0–40 pts) — factor dominante

| Tipo (`companyType`) | Puntos | Razonamiento |
|---------------------|--------|--------------|
| Developer + IPP | 40 | Perfil óptimo: construye Y opera. Tiene los proyectos Y el incentivo de financiarlos |
| Developer | 35 | Construye proyectos, necesita deuda para ejecutar |
| IPP | 30 | Opera activos, puede necesitar refinanciación |
| Cualquier otro | 0 | No encaja con el producto Bridge |

### Segmento (0–25 pts)

| Segmento | Puntos | Razonamiento |
|----------|--------|--------------|
| Project Finance | 25 | Exactamente el tipo de deal que hace Bridge: financiación de proyectos individuales a nivel SPV |
| Corporate Finance | 5 | Posible pero no el objetivo principal del programa |
| Sin segmento / otro | 0 | — |

### Fase del activo (0–25 pts) — urgencia de financiación

| Fase (`assetPhase`) | Puntos | Razonamiento |
|--------------------|--------|--------------|
| RTB (Ready-to-Build) | 25 | Máxima prioridad: proyecto listo para construir pero sin deuda. Necesita Bridge AHORA |
| Construcción | 25 | En obra pero sin financiación. Urgencia máxima |
| Desarrollo | 18 | Aún en fase de permisos. Puede necesitar deuda en 6-12 meses |
| Operativo | 3 | Ya construido. Bridge menos relevante, aunque puede haber refinanciación |
| Sin datos | 0 | — |

### Tecnologías (0–10 pts)

| Condición | Puntos | Razonamiento |
|-----------|--------|--------------|
| Tiene Solar o Eólica | +7 | Tecnologías core del programa Bridge |
| Tiene BESS | +3 | Elegible para Bridge según términos del programa |

**Ejemplos de puntuación**:

```
Developer + IPP + Project Finance + RTB + Solar + BESS = 40+25+25+7+3 = 100 pts ← Score perfecto
Developer + Project Finance + Desarrollo + Solar       = 35+25+18+7   =  85 pts ← Candidata óptima
IPP + Project Finance + Operativo + Eólica            = 30+25+3+7    =  65 pts ← Válida
Developer + Corporate Finance + Desarrollo            = 35+5+18      =  58 pts ← Marginal
Corporate + sin segmento                              =  0+0+0       =   0 pts ← Excluida por score
```

**Visualización en la UI**:

| Score | Color del círculo | Significado |
|-------|------------------|-------------|
| ≥ 70 | Verde `#ECFDF5` | Candidata óptima — incluir en la wave |
| ≥ 40 | Ámbar `#FFFBEB` | Candidata válida — revisar con cuidado |
| < 40 | Gris `#F1F5F9` | Candidata marginal — saltar o descartar |

---

## 5. Prioridad de contacto — a quién se le manda el email

Para cada empresa, el Explorer selecciona automáticamente el contacto más adecuado para recibir el email. Si hay varios contactos, se elige el de mayor jerarquía según esta tabla:

| Rango | Roles que clasifica | Badge color |
|-------|--------------------|----|
| 1 — CEO / DG | CEO, Director General, DG, Managing Director, MD | Verde `#059669` |
| 2 — CFO / DF | CFO, Director Financiero, Head of Finance, Responsable Financiero, Chief Financial | Ámbar `#D97706` |
| 3 — Fin. Estructurada | Cargo que contiene "financiaci" + "estructurada" | Azul `#2563EB` |
| 4 — M&A | Cargo que contiene "m&a" | Índigo |
| 5 — Otros directivos | Director, Head, Jefe, Jefa | Índigo `#6366F1` |
| 6 — Sin identificar | "No identificado", "nan", vacío | Gris |

**Emails excluidos automáticamente**:
- Emails genéricos: `info@`, `admin@`, `contact@`, `noreply@`, `hola@`, `hello@`
- Emails con formato inválido
- Emails duplicados (mismo email en varios contactos de la misma empresa)

**En la card expandida**, se muestra la lista completa de contactos de la empresa con:
- ⭐ y badge "RECOMENDADO" en el contacto de mayor prioridad (pre-seleccionado)
- Checkbox para cambiar manualmente qué contactos reciben el email
- Badge de cargo con color por jerarquía

El equipo puede **añadir más de un contacto** de la misma empresa al envío si hay varios decisores relevantes.

---

## 6. Filtros disponibles para acotar la búsqueda

Una vez aplicados los escudos y el score, el equipo puede usar una barra de filtros para acotar la lista:

| Filtro | Tipo | Campo | Descripción |
|--------|------|-------|-------------|
| Segmento | Select | `company.segment` | Project Finance / Corporate Finance / Todos |
| Tipo empresa | Select | `company.companyType` | Developer, IPP, Developer+IPP, etc. |
| Target priority | Select | mejor contacto | Solo empresas con CEO/DG, o CFO/DF, o Fin. Estructurada |
| Estado | Select | `savedTargets[domain].status` | Sin revisar / Saltadas / Todas |
| Score mínimo | Input número | `bridgeScoreVal >= minScore` | Filtro numérico 0–100 |
| Búsqueda | Input texto | `name` o `domain` | Busca por nombre o dominio |
| Tecnologías | Pills multi | `company.technologies[]` | Solar, Eólica, BESS, Hidrógeno, etc. — AND entre seleccionadas |
| Geografía | Pills multi | `company.geography[]` | España, Portugal, Italia, etc. — OR entre seleccionadas |

**Lógica de combinación**:
- Tecnologías: **AND** — la empresa debe tener TODAS las tecnologías seleccionadas
- Geografía: **OR** — basta con que tenga alguna de las geografías seleccionadas
- El resto: **AND** — todos los filtros activos deben cumplirse

**Botón "✕ Resetear filtros"**: aparece automáticamente cuando cualquier filtro difiere de su valor por defecto. Restablece todos a los valores iniciales.

**Comportamiento del filtro "Estado"**:
- **"Sin revisar"** (por defecto): muestra solo empresas sin decisión (`pending`) o saltadas (`skipped`). Excluye las ya aprobadas — así el equipo empieza siempre por las que aún no han revisado.
- **"Saltadas"**: muestra solo las que se saltaron en sesiones anteriores.
- **"Todas"**: muestra todas excepto las enviadas y descartadas permanentemente.

---

## 7. Ordenación con IA — Gemini sobre instrucciones libres

El panel **"🤖 Ordenar con IA"** (colapsable) permite reordenar la lista de candidatas con Gemini usando instrucciones en lenguaje natural.

**Cómo funciona**:

1. El equipo escribe una instrucción libre en el textarea:
   ```
   Prioriza empresas con CEO o Director Financiero identificado,
   que trabajen en solar utility-scale y estén en España o Portugal.
   Baja en la lista las que tienen menos de 5 emails en el CRM.
   ```

2. Se pulsa "✨ Reordenar lista"

3. Gemini recibe la lista de candidatas en batches de 150 empresas, con esta información de cada una:
   - Nombre, dominio
   - Segmento, tipo de empresa
   - Tecnologías, geografía
   - Número de interacciones históricas en el CRM
   - Meses desde la última interacción
   - Mejor cargo de contacto identificado
   - Señales comerciales detectadas
   - Extracto del contexto (primeros 200 chars)

4. Gemini devuelve un array JSON ordenado de mayor a menor prioridad con un score (0–100) y una **frase de justificación** para cada empresa.

5. El listado se reordena: primero por `llmScore`, luego por `bridgeScore` como desempate.

6. Debajo del nombre de cada empresa aparece en cursiva violeta la razón IA:
   ```
   ⭐ "Developer solar RTB con CFO identificado — alta prioridad"
   ```

**Indicadores de estado**:
- `✓ Activa` en verde → hay ordenación IA activa
- Timestamp de la última ordenación
- Botón "✕ Quitar ordenación IA" → vuelve al orden por bridge score

**La IA no filtra**: siempre devuelve todas las empresas de la lista, solo cambia su orden. El equipo sigue viendo todas las candidatas que pasan los filtros.

---

## 8. Revisión una a una — acciones sobre cada empresa

Cada empresa aparece como una **card** con la información esencial y botones de acción. Al pulsar en la card, se expande para mostrar el detalle completo.

**Vista compacta** (sin expandir):
```
[Score] [Nombre empresa] [badge: Pendiente/Seleccionada/Saltada] [✓ si seleccionada]
        Tipo · Segmento · Geografía · N emails
        ⭐ "Razón IA si está activa"
                                          [✓ Seleccionar] [→ Saltar] [▼]
```

**Vista expandida** (al hacer clic en la card):
```
[Lista de contactos con checkboxes:]
  ⭐ [✓] Nombre contacto  email@empresa.es  [badge: CEO]  RECOMENDADO
     [✓] Otro contacto   otro@empresa.es   [badge: Director]

[Contexto CRM (primeros 300 chars)]

[✓ Seleccionar con N contactos] [→ Saltar por ahora] [✕ Descartar]
```

**Las 4 acciones disponibles**:

| Acción | Botón | Status Airtable | Efecto |
|--------|-------|-----------------|--------|
| **Seleccionar** | `✓ Seleccionar` (verde) | `selected` | Añade a la lista de envío. Se guarda en Airtable. Aparece `✓` en la card. Borde verde. |
| **Saltar** | `→ Saltar` (gris) | `skipped` | La empresa queda pendiente para waves futuras. Se guarda en Airtable. Borde ámbar. |
| **Descartar** | `✕ Descartar` (rojo) | `rejected` | Excluida permanentemente de Bridge. No volverá a aparecer. Borde rojo. |
| **Recuperar** | `↩ Recuperar` | `pending` | Solo aparece en saltadas. Vuelve al estado "sin revisar". |
| **Quitar** | `Quitar` | `pending` | Solo aparece en seleccionadas. Retira de la lista de envío sin descartar. |

Cada acción se **persiste inmediatamente** en Airtable `CampaignTargets` (upsert por dominio). Si el equipo cierra el Explorer y lo vuelve a abrir, las decisiones están guardadas.

**Selección de contactos**: al expandir una empresa, el equipo puede marcar/desmarcar qué contactos específicos reciben el email. Por defecto, solo el primero (máxima prioridad) está seleccionado.

**Barra flotante en la parte inferior**:
```
✓ N empresa(s) seleccionada(s) · M contacto(s)        [Preparar envío para N empresa(s) →]
```
Aparece tan pronto como hay alguna empresa seleccionada y permite pasar directamente al wizard.

---

## 9. El wizard de envío — de seleccionadas a borradores en Gmail

Al pulsar "Preparar envío", se abre un modal de 2 pasos.

### Paso 1 — Revisar candidatos

Lista final con todas las empresas seleccionadas y sus contactos específicos:

```
┌─ Empresa Solar SA ─────────────────────────────────────────────────┐
│  carlos.garcia@solar-sa.es  — Director de Desarrollo              [✕]│
└────────────────────────────────────────────────────────────────────┘
┌─ GreenDev SL ──────────────────────────────────────────────────────┐
│  ana.fernandez@greendev.com — CFO                                  [✕]│
│  pedro.leal@greendev.com   — Director Financiero                  [✕]│
└────────────────────────────────────────────────────────────────────┘
```

El botón `[✕]` de cada contacto permite eliminarlo de esta wave sin descartar la empresa.

### Paso 2 — Confirmar y enviar

**Resumen**:
```
Candidatos:  N contactos en M empresa(s)
Remitente:   Leticia Menéndez (leticia.menendez@alter-5.com)
```

**Badge de tracking**:
```
● Tracking activo — las aperturas y clics se registrarán automáticamente en el dashboard
```

**Botones en orden de uso**:

**1. Enviar prueba** → `sendTestEmail`
- Envía una copia del email Bridge a `salvador.carrillo@alter-5.com` con el asunto `[TEST] Financiación Merchant para proyectos renovables`
- Permite verificar que el email se ve bien antes del envío masivo
- Confirmación visual: el botón cambia a "✅ Prueba enviada"

**2. Crear N borradores en Gmail** → `addRecipients` + `createDrafts`
- Añade los destinatarios a la campaña en GAS
- Crea un borrador individual en el Gmail de Leticia por cada destinatario, con el nombre y empresa del contacto ya reemplazados en el template
- Marca todos los dominios como `sent` en Airtable CampaignTargets (ya no aparecerán en waves futuras)
- Requiere confirmación antes de ejecutar

**3. Revisar borradores en Gmail** (paso manual, fuera del dashboard)
- El equipo abre Gmail de Leticia y revisa los borradores creados
- Puede editarlos, ajustar asuntos, personalizar textos

**4. Ejecutar envío de borradores** → `sendDrafts`
- Envía todos los borradores desde Gmail de Leticia
- Requiere doble confirmación (diálogo rojo de advertencia irreversible)
- Resultado: "✅ N emails enviados correctamente" o "⚠ N enviados, M errores"

---

## 10. Persistencia y waves — cómo se gestiona la memoria

La tabla `CampaignTargets` de Airtable es la **memoria persistente** del Explorer. Cada decisión del equipo se guarda allí con:
- Dominio de la empresa
- Status actual (`pending`, `skipped`, `selected`, `approved`, `sent`, `rejected`)
- Contactos seleccionados (email + nombre + cargo)
- Reference de la wave (`Bridge_Q1_W3`)
- Quién revisó y cuándo

**Entre sesiones**: si el equipo cierra el Explorer y lo reabre, el sistema carga de nuevo Airtable y restaura todos los estados. Las empresas saltadas siguen como `skipped`, las seleccionadas siguen con `✓`.

**Entre waves**: al abrir el Explorer para una nueva wave, se cargan los targets de **todas las waves anteriores** con `fetchAllBridgeTargets()`. Cualquier empresa con status `approved`, `sent` o `selected` en cualquier wave queda bloqueada por el Escudo 3, garantizando cero duplicados entre oleadas.

**Deduplicación por wave**: si una empresa aparece en dos waves distintas, gana la entrada de la wave más reciente (número de wave más alto).

---

# Parte II — Técnica

## 11. Arquitectura del componente

```
BridgeExplorerView.tsx
  Props:
    allCompanies[]       — CRM completo (parseado por parseCompanies)
    campaignRef          — "Bridge_Q1_W3" (ID de la wave actual)
    previousTargets      — { domain: { status, ... } } (targets de waves anteriores)
    bridgeContacts[]     — contactos activos del GAS dashboard
    campaignMetrics      — métricas GAS (unused en Explorer actualmente)
    currentUser          — ID del usuario logueado
    onBack               — callback para volver al BridgeCampaignView

  State local:
    trackingDomains      → Set<domain> (GAS Tracking sheet)
    sentEmails           → Set<email> (GAS full emails)
    allSentDomains       → Set<domain> (Airtable, todas las waves)
    atTargetEmails       → Set<email> (Airtable SelectedContacts)
    atTargetNames        → Set<name> (Airtable CompanyName)
    savedTargets         → { domain: AirtableRecord } (wave actual)
    llmOrdering          → [{domain, score, reason}] | null
    selectedContacts     → { domain: Set<email> }
    selectedForSend      → Set<domain>
    [filtros...]
    [wizard state...]
```

## 12. Carga de datos al arrancar

```typescript
async function loadData() {
  // 1. GAS Tracking — anti-dup shield primario
  const domains = await fetchSentDomains().catch(() => new Set());
  setTrackingDomains(domains);

  // 1b. Emails exactos — cubre dominios genéricos
  const emails = await fetchSentEmails().catch(() => new Set());
  setSentEmails(emails);

  // 2. CampaignTargets de la wave ACTUAL
  const targets = await fetchCandidateTargets(campaignRef).catch(() => ({}));
  setSavedTargets(targets);

  // 3. CampaignTargets de TODAS las waves anteriores (fuente autoritativa)
  const { allTargets } = await fetchAllBridgeTargets("Bridge_Q1");
  // Extrae dominios, emails y nombres de targets approved/sent/selected
  for (const [domain, t] of Object.entries(allTargets)) {
    if (t.status === 'approved' || t.status === 'sent' || t.status === 'selected') {
      sentSet.add(domain);
      for (const ct of t.selectedContacts || []) emailSet.add(ct.email.toLowerCase());
      nameSet.add(t.companyName?.toLowerCase() || '');
    }
  }
  setAllSentDomains(sentSet);
  setAtTargetEmails(emailSet);
  setAtTargetNames(nameSet);
}
```

## 13. Pipeline de filtrado — código completo

```typescript
const candidates = useMemo(() => {
  return allCompanies
    .filter(c => {
      const domain = c.domain?.toLowerCase();

      // === 7 ESCUDOS (en orden, AND implícito) ===
      if (bridgeContactDomains.has(domain)) return false;        // Shield 1
      if (trackingDomains.has(domain)) return false;             // Shield 2
      if (allSentDomains.has(domain)) return false;              // Shield 3
      if (leticiaDomains.has(domain)) return false;              // Shield 4
      const prevStatus = previousTargets[domain]?.status;
      if (prevStatus === 'approved' || prevStatus === 'sent' ||
          prevStatus === 'selected') return false;               // Shield 5

      const companyEmails = contacts.map(ct => ct.email.toLowerCase());
      if (companyEmails.some(e => sentEmails.has(e))) return false;         // Shield 6a
      if (companyEmails.some(e => bridgeContactEmails.has(e))) return false; // Shield 6b
      if (companyEmails.some(e => atTargetEmails.has(e))) return false;      // Shield 6c

      const nameLower = c.name.toLowerCase().trim();
      if (sentCompanyNames.has(nameLower)) return false;  // Shield 7a
      if (atTargetNames.has(nameLower)) return false;     // Shield 7b

      // === REQUISITOS BASE ===
      if (c.role !== 'Originación') return false;
      if (!c.detail?.contacts?.some(ct => ct.email)) return false;

      // === ESTADO EN WAVE ACTUAL ===
      const savedStatus = savedTargets[domain]?.status;
      if (savedStatus === 'sent') return false;
      if (savedStatus === 'rejected') return false;
      if (statusFilter === 'pending') {
        // Solo pending + skipped (no approved ni selected)
        if (savedStatus && !['pending', 'skipped'].includes(savedStatus)) return false;
      } else if (statusFilter === 'skipped') {
        if (savedStatus !== 'skipped') return false;
      }
      // 'all' → muestra todo (excepto sent y rejected ya filtrados)

      // === FILTROS DE UI ===
      if (segFilter !== 'todas' && c.segment !== segFilter) return false;
      if (typeFilter !== 'todos' && c.companyType !== typeFilter) return false;
      if (techFilter.length > 0 && !techFilter.every(t => c.technologies?.includes(t))) return false;
      if (geoFilter.length > 0 && !geoFilter.some(g => c.geography?.includes(g))) return false;
      if (targetFilter !== 'todos') {
        const hasTarget = contacts.some(ct => {
          const rank = contactPriority(ct.role);
          return (targetFilter === 'ceo_dg' && rank === 1) ||
                 (targetFilter === 'cfo_df' && rank === 2) ||
                 (targetFilter === 'fin_estructurada' && rank === 3);
        });
        if (!hasTarget) return false;
      }
      if (searchQuery && !c.name.toLowerCase().includes(q) && !domain.includes(q)) return false;

      return true;
    })
    .map(c => ({
      ...c,
      bridgeScoreVal: bridgeScore(c),
      llmScore: llmOrdering?.find(l => l.domain === c.domain)?.score ?? null,
      llmReason: llmOrdering?.find(l => l.domain === c.domain)?.reason ?? null,
    }))
    .filter(c => c.bridgeScoreVal >= minScore)
    .sort((a, b) => {
      if (llmOrdering) {
        const aS = a.llmScore ?? -1, bS = b.llmScore ?? -1;
        if (aS !== bS) return bS - aS;
      }
      return b.bridgeScoreVal - a.bridgeScoreVal;
    });
}, [/* 17 dependencias */]);
```

## 14. bridgeScore() — función de puntuación

```typescript
function bridgeScore(c: Company): number {
  let score = 0;

  // Tipo empresa: 0-40 pts
  const tp = (c.companyType || '').toLowerCase();
  if (tp.includes('developer') && tp.includes('ipp')) score += 40;
  else if (tp.includes('developer'))                  score += 35;
  else if (tp === 'ipp')                              score += 30;

  // Segmento: 0-25 pts
  if (c.segment === 'Project Finance')      score += 25;
  else if (c.segment === 'Corporate Finance') score +=  5;

  // Fase activo: 0-25 pts
  const phase = (c.assetPhase || '').toLowerCase();
  if (phase === 'rtb' || phase === 'construcción' || phase === 'construccion') score += 25;
  else if (phase === 'desarrollo')  score += 18;
  else if (phase === 'operativo')   score +=  3;

  // Tecnologías: 0-10 pts
  const techs = c.technologies || [];
  if (techs.includes('Solar') || techs.includes('Eólica')) score += 7;
  if (techs.includes('BESS'))                              score += 3;

  return Math.min(100, score);
}
```

## 15. contactPriority() — selección del destinatario

```typescript
function contactPriority(role: string): number {
  const r = (role || '').toLowerCase().trim();
  // Rango 1: CEO / Director General
  if (/\bceo\b/.test(r) || /director\s*general/.test(r) || /\bdg\b/.test(r) ||
      /managing\s*director/.test(r) || /\bmd\b/.test(r)) return 1;
  // Rango 2: CFO / Director Financiero
  if (/\bcfo\b/.test(r) || /director\s*financier/.test(r) ||
      /head\s*of\s*finance/.test(r) || /responsable\s*financier/.test(r) ||
      /chief\s*financial/.test(r)) return 2;
  // Rango 3: Financiación Estructurada
  if (r.includes('financiaci') && r.includes('estructurada')) return 3;
  // Rango 4: M&A
  if (/\bm&a\b|\bm\s*&\s*a\b/.test(r)) return 4;
  // Rango 6: Sin rol
  if (!r || r === 'no identificado' || r === 'nan') return 6;
  // Rango 5: Otros directivos con cargo
  return 5;
}
```

**Aplicación**: `contacts.sort((a, b) => contactPriority(a.role) - contactPriority(b.role))`. El primero (rank más bajo = mayor prioridad) es el "RECOMENDADO".

**Limpieza de contactos** antes de mostrarlos:
1. Elimina emails con formato inválido
2. Elimina emails genéricos (info@, admin@...)
3. Deduplica por email (case-insensitive)
4. Normaliza nombres (MAYÚSCULAS → Title Case)

## 16. LLM Ordering — llamada a Gemini

```typescript
async function runLlmOrdering() {
  const BATCH = 150;

  for (const batch of batches) {
    const sample = batch.map(c => ({
      domain: c.domain,
      name: c.name,
      segment: c.segment,
      type: c.companyType,
      tech: c.technologies,
      geo: c.geography,
      interactions: c.interactions,
      monthsAgo: c.monthsAgo,
      topContactRole: bestContact(c),  // mejor cargo identificado
      senales: c.senales,              // señales comerciales del CRM
      contextSnippet: c.detail?.context?.slice(0, 200),
    }));

    const prompt = `Eres asistente de Alter5 (financiación energías renovables).
    Prioriza empresas para el programa Bridge Debt Energy
    (financiación puente utility-scale, 18-24 meses, sin garantía corporativa, desde 2M EUR).

    INSTRUCCIONES DEL USUARIO:
    ${llmInstructions}

    EMPRESAS CANDIDATAS (${sample.length}):
    ${JSON.stringify(sample, null, 2)}

    Responde SOLO con JSON array ordenado de mayor a menor prioridad:
    [{ "domain": "empresa.com", "score": 95, "reason": "justificación breve" }]
    Incluye TODAS las empresas. Score 0-100.`;

    const result = await callGemini(prompt, 0.2);  // temperatura 0.2 = determinista
    const parsed = JSON.parse(result.match(/\[[\s\S]*\]/)[0]);
    allResults = [...allResults, ...parsed];
  }

  setLlmOrdering(allResults);
}
```

## 17. handleAction() — persistir decisiones en Airtable

```typescript
async function handleAction(company, status: 'selected' | 'skipped' | 'rejected' | 'pending') {
  const domain = company.domain?.toLowerCase();
  setSaving(domain);  // muestra spinner en la card

  await upsertCandidateTarget({
    id: savedTargets[domain]?.id || null,  // si existe → PATCH, si no → POST
    domain,
    companyName: company.name,
    status,
    selectedContacts: status === 'selected'
      ? getContactsForCompany(company).map(email => ({
          email,
          name: contacts.find(ct => ct.email === email)?.name || '',
          role: contacts.find(ct => ct.email === email)?.role || '',
        }))
      : (savedTargets[domain]?.selectedContacts || []),
    campaignRef,     // "Bridge_Q1_W3"
    segment: company.segment || '',
    companyType: company.companyType || '',
    technologies: company.technologies || [],
    reviewedBy: currentUser || 'Salvador Carrillo',
    reviewedAt: new Date().toISOString().split('T')[0],  // "YYYY-MM-DD"
  });

  // Actualiza estado local (sin recargar Airtable)
  setSavedTargets(prev => ({ ...prev, [domain]: { ...prev[domain], status } }));

  // Actualiza selectedForSend según la acción
  if (status === 'selected') setSelectedForSend(prev => new Set([...prev, domain]));
  else setSelectedForSend(prev => { const n = new Set(prev); n.delete(domain); return n; });

  setSaving(null);
}
```

## 18. El wizard técnico — openWizard y flujo de envío

```typescript
// Al abrir el wizard:
async function openWizard() {
  // 1. Construir lista de destinatarios
  const recipients = buildWizardRecipients();
  // Por cada domain en selectedForSend:
  //   obtiene emails seleccionados (o top-1 por defecto)
  //   construye { email, name, lastName, organization, role, domain }

  // 2. Crear campaña en GAS backend (necesaria para sendTestEmail/createDrafts)
  const result = await bridgeGasCall('createCampaign', {
    name: campaignRef,
    type: 'mass',
    senderEmail: 'leticia.menendez@alter-5.com',
    senderName: 'Leticia Menéndez',
    subjectA: 'Financiación Merchant para proyectos renovables',
    bodyA: BRIDGE_EMAIL_TEMPLATE,
    subjectB: '', bodyB: '', abTestPercent: 0,
    recipients: [],  // se añaden después
  });
  setGasCampaignId(result.id);
}

// Paso "Crear borradores":
async function handlePrepare() {
  // 1. Añadir recipients a la campaña GAS
  await bridgeGasCall('addRecipients', { campaignId: gasCampaignId, recipients });

  // 2. GAS crea borradores en Gmail de Leticia (un draft por destinatario)
  const draftResult = await bridgeGasCall('createDrafts', { campaignId: gasCampaignId });

  // 3. Marcar todas las empresas como 'sent' en Airtable (EXCLUSIÓN PERMANENTE)
  await Promise.all([...selectedForSend].map(domain =>
    upsertCandidateTarget({ domain, status: 'sent', ... })
  ));

  setPreparedOk(true);
  setLaunchResult({ drafts: draftResult.drafts, errors: draftResult.errors });
}

// Paso "Enviar borradores":
async function handleSendDrafts() {
  // GAS itera los borradores de la campaña y los envía desde Gmail de Leticia
  const result = await bridgeGasCall('sendDrafts', { campaignId: gasCampaignId });
  setSentOk(true);
  setSendResult({ sent: result.sent, errors: result.errors });
}
```

## 19. Referencia de llamadas externas

| Llamada | Destino | Cuándo |
|---------|---------|--------|
| `fetchSentDomains()` | GAS `?action=dashboard` | Al montar el Explorer |
| `fetchSentEmails()` | GAS `?action=dashboard` | Al montar el Explorer |
| `fetchCandidateTargets(campaignRef)` | Airtable `CampaignTargets` | Al montar — carga wave actual |
| `fetchAllBridgeTargets("Bridge_Q1")` | Airtable `CampaignTargets` | Al montar — carga todas las waves |
| `callGemini(prompt, 0.2)` | `/api/gemini-proxy` | Al ejecutar LLM ordering |
| `upsertCandidateTarget(...)` | Airtable `CampaignTargets` | En cada acción (select/skip/reject) |
| `bridgeGasCall('createCampaign', ...)` | `/api/campaign-proxy` → GAS | Al abrir el wizard |
| `bridgeGasCall('sendTestEmail', ...)` | `/api/campaign-proxy` → GAS | Botón "Enviar prueba" |
| `bridgeGasCall('addRecipients', ...)` | `/api/campaign-proxy` → GAS | Botón "Crear borradores" |
| `bridgeGasCall('createDrafts', ...)` | `/api/campaign-proxy` → GAS | Botón "Crear borradores" |
| `bridgeGasCall('sendDrafts', ...)` | `/api/campaign-proxy` → GAS | Botón "Ejecutar envío" |

---

*Documento generado el 21 de marzo de 2026.*
