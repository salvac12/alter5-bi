# Prospects — Guía Completa de Funcionamiento

> Este documento describe en detalle cómo funciona el módulo de Prospects del CRM Alter5 BI: su lógica de negocio, los distintos caminos por los que llega una empresa al pipeline, cómo se trabaja el deal desde dentro del panel, y la implementación técnica completa de cada funcionalidad.

---

## Tabla de Contenidos

### Parte I — Negocio y Flujo de Trabajo
1. [¿Qué es un Prospect?](#1-qué-es-un-prospect)
2. [El Funnel de Prospects — 5 Stages](#2-el-funnel-de-prospects--5-stages)
3. [Cómo entra una empresa al pipeline](#3-cómo-entra-una-empresa-al-pipeline)
   - 3.1 [Creación automática desde campañas (Bridge)](#31-creación-automática-desde-campañas-bridge)
   - 3.2 [Creación manual desde el front](#32-creación-manual-desde-el-front)
   - 3.3 [Sugerencias automáticas de avance de stage](#33-sugerencias-automáticas-de-avance-de-stage)
4. [El Panel de un Prospect — Cómo se trabaja](#4-el-panel-de-un-prospect--cómo-se-trabaja)
   - 4.1 [Resumen de inteligencia IA](#41-resumen-de-inteligencia-ia)
   - 4.2 [Contactos](#42-contactos)
   - 4.3 [Contexto y notas de reunión](#43-contexto-y-notas-de-reunión)
   - 4.4 [Actividad CRM (historial del equipo)](#44-actividad-crm-historial-del-equipo)
   - 4.5 [Procesamiento de notas con IA](#45-procesamiento-de-notas-con-ia)
   - 4.6 [Próximos pasos](#46-próximos-pasos)
   - 4.7 [Sistema de tareas](#47-sistema-de-tareas)
   - 4.8 [Campos de clasificación del deal](#48-campos-de-clasificación-del-deal)
5. [Conversión a Oportunidad](#5-conversión-a-oportunidad)
6. [Kanban y Gestión Visual](#6-kanban-y-gestión-visual)

### Parte II — Implementación Técnica
7. [Arquitectura y fuentes de datos](#7-arquitectura-y-fuentes-de-datos)
8. [Tabla Airtable BETA-Prospects](#8-tabla-airtable-beta-prospects)
9. [Capa de datos — airtableProspects.ts](#9-capa-de-datos--airtableprospecsts)
10. [Flujo técnico de creación desde campaña](#10-flujo-técnico-de-creación-desde-campaña)
11. [Flujo técnico de creación manual](#11-flujo-técnico-de-creación-manual)
12. [Sistema de IA — gemini.ts](#12-sistema-de-ia--geminits)
13. [Sistema de tareas — ProspectTasks y airtableTasks](#13-sistema-de-tareas--prospecttasks-y-airtabletasks)
14. [Notificaciones por email de tareas](#14-notificaciones-por-email-de-tareas)
15. [Sincronización Bridge → Prospects](#15-sincronización-bridge--prospects)
16. [Referencia de llamadas a Airtable](#16-referencia-de-llamadas-a-airtable)

---

# Parte I — Negocio y Flujo de Trabajo

## 1. ¿Qué es un Prospect?

Un **Prospect** es una empresa que ha mostrado interés suficiente en los productos de Alter5 (o que el equipo considera lo suficientemente relevante) para iniciar un proceso activo de deal origination. No es una empresa del CRM general, sino una oportunidad concreta que el equipo quiere convertir en un mandato de financiación.

La diferencia entre una empresa en el CRM y un Prospect:

| CRM Empresas | Prospects |
|-------------|-----------|
| Todas las empresas con las que el equipo ha interactuado | Solo las empresas con oportunidad comercial activa |
| Actualizado automáticamente vía emails | Gestionado manualmente por el equipo |
| Clasificación IA (Gemini) basada en emails | Datos comerciales específicos (importe, producto, stage) |
| Sin acciones comerciales concretas | Con tareas, contactos, próximos pasos |
| 5.261 empresas | Decenas de deals activos |

Los Prospects viven en la tabla `BETA-Prospects` de Airtable y se visualizan como un **Kanban de 5 columnas** accesible desde el tab "Prospects" del dashboard.

---

## 2. El Funnel de Prospects — 5 Stages

El proceso de captación sigue 5 etapas lineales que representan el avance en la relación comercial:

```
┌──────────┐   ┌────────────┐   ┌─────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│   LEAD   │ → │ INTERESADO │ → │ REUNION │ → │ DOCUMENTACION        │ → │ LISTO PARA TERM-SHEET│
│          │   │            │   │         │   │ PENDIENTE            │   │                      │
│ #6366F1  │   │  #3B82F6   │   │ #8B5CF6 │   │ #F59E0B              │   │ #10B981              │
└──────────┘   └────────────┘   └─────────┘   └──────────────────────┘   └──────────────────────┘
```

### Qué significa cada stage

**Lead**: La empresa ha sido identificada como potencial candidata. Puede venir de una campaña outbound, de una referencia, de un evento o de búsqueda proactiva. Aún no ha habido contacto bidireccional confirmado.

**Interesado**: El contacto ha respondido positivamente, ha pedido más información o ha mostrado disposición a continuar la conversación. Hay interés declarado, aunque todavía superficial.

**Reunion**: Se ha celebrado o agendado una reunión concreta. En este stage el equipo tiene información cualitativa del proyecto del cliente: MW, estado de permisos, necesidad de financiación, calendarios.

**Documentacion Pendiente**: El proceso está en fase de due diligence. El cliente está enviando documentación financiera, proyecciones, títulos de propiedad, permisos, etc. El equipo está analizando la viabilidad del deal.

**Listo para Term-Sheet**: El análisis está completo y el equipo tiene información suficiente para preparar un term sheet indicativo. Es el último paso antes de convertir el Prospect en una Oportunidad formal en el Pipeline.

### Regla de progresión

El movimiento entre stages es manual (drag & drop en el Kanban, o cambio de stage en el panel). No hay progresión automática, pero sí hay **sugerencias automáticas** basadas en señales del sistema de campañas y del CRM (ver sección 3.3).

Cuando un Prospect llega al último stage ("Listo para Term-Sheet"), el sistema ofrece dos opciones:
- **Convertir a Oportunidad**: crea un registro en la tabla `Opportunities` de Airtable y el deal pasa al Pipeline Kanban en el stage `"Origination - Termsheet"`.
- **Solo mover sin convertir**: el prospect permanece en el Kanban de Prospects para seguir gestionándolo sin formalizar la oportunidad todavía.

---

## 3. Cómo entra una empresa al pipeline

Hay tres formas en que una empresa puede entrar como Prospect:

### 3.1 Creación automática desde campañas (Bridge)

El flujo más común en el contexto actual (Bridge Energy Debt Q1 2026):

**Paso 1 — La empresa recibe el email de campaña**
El equipo selecciona candidatas desde `BridgeExplorerView`, las revisa y lanza la wave. Leticia envía el email de Bridge via Gmail (GAS backend).

**Paso 2 — La empresa responde o muestra interés**
El GAS detecta respuestas y las clasifica con Gemini: `interesado`, `reunion`, `no_interesado`, etc. Si hay interés, la empresa se mueve en el **Bridge Pipeline** (tabla Google Sheets) de la etapa `nurturing` a `reunion`, `subida_docs` o `doc_completada`.

**Paso 3 — El sistema sugiere crear o avanzar el Prospect**
El módulo `bridgeProspectSync.ts` compara el estado del Bridge Pipeline con los Prospects actuales de Airtable:
- Si hay un Prospect existente para esa empresa → sugiere **avanzar su stage**
- Si no hay Prospect → el equipo crea uno manualmente (ver 3.2)

**Paso 4 — El equipo crea el Prospect**
Navega a la vista Prospects, pulsa "+ Añadir" en la columna correspondiente al stage del Bridge Pipeline, y rellena el formulario. El sistema detecta automáticamente la empresa del CRM por el dominio del email y muestra el historial de interacciones.

**¿Por qué no es completamente automático?**
La creación del Prospect es siempre un acto consciente del equipo. Un email interesado no implica automáticamente una oportunidad; requiere que alguien del equipo valide que merece ser trabajada activamente.

### 3.2 Creación manual desde el front

Cualquier miembro del equipo puede crear un Prospect en cualquier momento desde el Kanban. No necesita venir de una campaña. Los casos de uso habituales:

- **Referido**: alguien del sector recomienda una empresa que busca financiación
- **Evento**: el equipo conoce a un promotor en una conferencia o feria
- **Cold outreach del equipo**: algún miembro contacta directamente a una empresa
- **Inbound**: la empresa llega por la web o pide información directamente
- **Pipeline existente**: una empresa del CRM pasa de relación de contacto a oportunidad activa

**Pasos para crear un Prospect manualmente:**

1. Ir a la vista "Prospects" en el dashboard
2. Pulsar "+ Añadir" en la cabecera de la columna del stage inicial (normalmente "Lead")
3. Rellenar el formulario del panel (ver sección 4)
4. Guardar → el prospect aparece en el Kanban

**Matching automático con el CRM:**
Al abrir el panel, el sistema busca en el CRM de Empresas si hay una empresa que coincida por:
1. Dominio del email del contacto introducido
2. Nombre exacto de la empresa
3. Nombre parcial (substring match de mínimo 4 caracteres)

Si hay coincidencia, aparece automáticamente la sección "Actividad CRM" con el historial completo de interacciones del equipo con esa empresa (emails por buzón, timeline trimestral, asuntos recientes).

### 3.3 Sugerencias automáticas de avance de stage

Una vez creado el Prospect, el sistema detecta automáticamente señales para sugerir avances de stage. Estas sugerencias aparecen como **banners en la parte superior del Kanban**:

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ⚡ 2 sugerencias de avance detectadas                                              │
│                                                                                     │
│ "SolarEn SA"  Lead → Reunión                                                       │
│  Señal: Bridge pipeline — etapa 'reunion' (carlos@solaren.es)   [Aplicar] [Ignorar]│
│                                                                                     │
│ "GreenDev"    Interesado → Documentacion Pendiente                                 │
│  Señal: Bridge pipeline — etapa 'subida_docs' (ana@greendev.eu) [Aplicar] [Ignorar]│
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Fuentes de las sugerencias:**

| Fuente | Condición | Stage sugerido |
|--------|-----------|----------------|
| Bridge Pipeline (GAS) | Empresa en etapa `reunion` del Bridge | `Reunion` |
| Bridge Pipeline (GAS) | Empresa en etapa `subida_docs` | `Documentacion Pendiente` |
| Bridge Pipeline (GAS) | Empresa en etapa `doc_completada` | `Listo para Term-Sheet` |
| CRM emails | Asuntos contienen: reunion/llamada/meeting/zoom/teams | `Reunion` |

Las sugerencias solo se generan si el stage sugerido es **más avanzado** que el actual del Prospect. No retroceden.

---

## 4. El Panel de un Prospect — Cómo se trabaja

Al hacer clic en una card del Kanban (o al crear uno nuevo), se abre un **panel lateral** que desliza desde la derecha. Es el espacio principal de trabajo del deal.

### 4.1 Resumen de inteligencia IA

Si el Prospect tiene un `AI Summary` guardado en Airtable (o si hay una empresa del CRM asociada), aparece en la parte superior del panel una sección de **"Resumen de la relación"**.

**Qué contiene el resumen IA:**
- Naturaleza de la relación y tipo de oportunidad detectada
- Historial de comunicaciones y nivel de engagement del equipo
- Posición estimada en el funnel de origination
- Riesgos o alertas detectadas (p.ej. si el contacto es un broker/intermediario y no el promotor final)
- Si es un **falso positivo** (proveedor de servicios, herramienta SaaS, intermediario sin proyecto propio) se marca claramente con badge rojo "FALSO POSITIVO"

**Badges de confianza:**
- Badge rojo "FALSO POSITIVO" → la IA detectó que este contacto no es un promotor real
- Badge ámbar "REVISAR" → la IA tiene poca confianza en el análisis

**Cómo se genera:**
El botón "Generar Inteligencia IA" (o "Regenerar") lanza un análisis Gemini con:
- Todos los emails intercambiados (últimos 30 asuntos con extractos)
- El contexto histórico de la relación del CRM
- La clasificación de la empresa (tipo, segmento, market roles)
- Las notas del equipo en el campo "Contexto" del prospect

El resultado se guarda en el campo `AI Summary` de Airtable para que persista entre sesiones.

### 4.2 Contactos

El panel gestiona una lista de contactos específica del Prospect (distinta de los contactos del CRM). Permite múltiples contactos por prospect, cada uno con:

- Nombre + Apellido
- Email (se usa para el matching con el CRM y con el Bridge Pipeline)
- Cargo/Rol

**El primer email** se guarda también en el campo `Contact Email` por compatibilidad con implementaciones anteriores.

**Todos los contactos** se guardan como `JSON.stringify([{name, email, role}])` en el campo `Contacts` de Airtable.

El equipo puede añadir o eliminar contactos en cualquier momento. Los cambios se persisten al guardar el prospect.

### 4.3 Contexto y notas de reunión

El campo **"Contexto / Notas de reunión"** es un textarea de texto libre donde el equipo documenta todo lo relevante de la relación:

- Resumen de reuniones celebradas
- Descripción del proyecto del cliente (MW, tecnología, estado de permisos, ubicación)
- Notas estratégicas sobre la oportunidad
- Historial de comunicaciones relevantes

Este campo **acumula información**: cuando la IA procesa notas de reunión, prepend un bloque nuevo con timestamp al contenido existente, sin borrar lo anterior.

Formato de un bloque generado por IA:
```
[Resumen IA 21/03/2026, 10:30]
Empresa solar developer con proyecto de 50MW en Extremadura en estado RTB.
El promotor busca financiación bridge para ejecutar la construcción sin necesidad
de PPA. Deal de ~18M EUR. Interés alto, pendiente de envío de documentación.
Próxima reunión: semana del 25 de marzo.

[Resumen IA 28/03/2026, 15:15]
Segunda reunión celebrada. El promotor confirma que no tiene PPA firmado.
Capex final: 42M EUR. Equity aportado: 8M EUR. Financiación solicitada: 34M EUR.
```

### 4.4 Actividad CRM (historial del equipo)

Cuando el panel detecta que el Prospect corresponde a una empresa del CRM de Empresas (por dominio de email o nombre), muestra automáticamente una sección colapsable **"Actividad CRM"** con:

**Actividad por buzón**: barras horizontales proporcionales mostrando cuántos emails ha intercambiado cada miembro del equipo con esta empresa. Colores fijos por empleado:
- Salvador → azul `#3B82F6`
- Leticia → morado `#8B5CF6`
- Javier → ámbar `#F59E0B`
- Miguel → verde `#10B981`
- Carlos → rojo `#EF4444`
- Gonzalo → cian `#06B6D4`
- Rafael → naranja `#F97316`
- Guillermo → gris `#6B7280` (histórico)

**Timeline de interacciones**: chips por trimestre (ej: "Q1 2024 | 45") que muestran la intensidad de la relación a lo largo del tiempo. Los trimestres con más actividad aparecen en azul más intenso.

**Emails recientes**: listado cronológico de los últimos 6-20 asuntos de email con fecha, para entender de qué se ha hablado recientemente.

**Clasificación de la empresa**: badges con el rol (Originación, Inversión...), segmento (Project Finance, Corporate Finance) y tipo de empresa (Developer, IPP...) según la clasificación del CRM.

Esta sección es **solo lectura** — el equipo puede ver el historial pero no modificarlo desde aquí. Para actualizaciones del CRM hay que usar la vista de Empresas.

### 4.5 Procesamiento de notas con IA

La sección **"Notas de reunión IA"** permite pegar texto libre (notas tomadas durante una reunión, transcripción de llamada, resumen dictado por voz) y procesarlo con Gemini de forma automática.

**Flujo de uso:**

1. El equipo celebra una reunión con el promotor
2. Alguien toma notas (en papel, en Notion, en email a sí mismo, grabación transcrita)
3. Abre el Prospect en el dashboard y pega las notas en el textarea de "Notas de reunión IA"
4. Pulsa "Generar resumen y tareas"
5. Gemini ejecuta **dos llamadas en paralelo**:
   - `summarizeMeetingNotes()`: genera un resumen ejecutivo de máximo 5 líneas
   - `extractTasksFromNotes()`: extrae las tareas accionables con responsable y fecha
6. El resumen se **prepende** al campo Contexto con timestamp
7. Las tareas extraídas se **añaden** al sistema de tareas del prospect
8. Los próximos pasos se **prependen** al campo "Sugerencias de avance"

**Resultado práctico**: en menos de 30 segundos, el equipo tiene documentada la reunión, las tareas asignadas y los próximos pasos, sin tener que estructurar nada manualmente.

### 4.6 Próximos pasos

El campo **"Sugerencias de avance"** (campo `Next Steps` en Airtable) es un textarea libre colapsable. Se usa para:

- Acordar los siguientes pasos con el cliente
- Registrar compromisos del equipo
- Anotar condiciones previas al avance de stage

Aparece colapsado por defecto con un indicador del número de líneas: `(3 items)`. Al hacer clic en la flecha, se expande el textarea.

Cuando la IA extrae tareas de las notas de reunión, también genera texto para este campo:
```
[Próximos pasos IA 21/03/2026, 10:30]
1. Enviar NDA → Salvador (2026-03-25)
2. Preparar cuestionario de información → Javier
3. Convocar segunda reunión para la semana del 1 de abril → Carlos (2026-03-28)
```

### 4.7 Sistema de tareas

La sección de **Tareas** es un mini-gestor de tareas integrado en el prospect. Cada tarea tiene:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| Título | Texto libre | Qué hay que hacer (imperativo: "Enviar NDA", "Llamar a Carlos") |
| Descripción | Textarea | Contexto adicional, instrucciones, notas |
| Estado | 3 valores | `Pendiente`, `En curso`, `Hecho` |
| Asignado a | Select | Cualquier miembro del equipo (7 personas) |
| Fecha límite | Date picker | Fecha de vencimiento (se muestra en rojo si vencida) |
| Notificado | Indicador | ✉ Notificado — si se ha enviado email al responsable |

**Ciclo de estado**: click en el dot circular → cicla `pendiente → en_curso → hecho → pendiente`

**Agrupación visual**:
- **Pendiente** (ámbar): tareas sin empezar
- **En curso** (azul): tareas en progreso
- **Hecho** (verde): completadas, colapsadas por defecto

**Templates disponibles** (al pulsar "+ Añadir tarea" aparecen chips):
- "Convocar reunion" → genera tarea tipo cita/agenda
- "Reclamar informacion" → para documentación pendiente del cliente
- "Preparar Term-Sheet" → tarea estándar de cierre
- "+ Otra" → tarea en blanco

**Notificaciones por email**: cuando se asigna una tarea a alguien del equipo, al guardar el prospect el sistema envía automáticamente un email de notificación a esa persona con:
- El nombre de la tarea
- La descripción
- El prospect al que pertenece
- El contexto del deal
- La fecha límite
- Un link directo al prospect en el dashboard

El email de notificación **solo se envía una vez**: la primera vez que se asigna. El indicador "✉ Notificado" confirma que el email fue enviado.

### 4.8 Campos de clasificación del deal

Además de las tareas y notas, el panel recoge la información estructurada del deal:

| Campo | Valores | Propósito |
|-------|---------|-----------|
| Stage | 5 opciones (ver sección 2) | Posición en el funnel |
| Deal Manager | 7 miembros del equipo | Responsable principal del deal |
| Importe | Número + moneda | Ticket size estimado del deal |
| Moneda | EUR / USD / GBP | Divisa del deal |
| Producto | Ver tabla abajo | Tipo de producto financiero |
| Origen | Ver tabla abajo | Cómo llegó el lead |

**Valores de Producto** (con optgroups Debt / Equity):
- Debt: `Corporate Debt`, `Project Finance`, `Development Debt`, `Project Finance (Guaranteed)`
- Equity: `Investment`, `Co-Development`, `M&A`

**Valores de Origen**:
`Referral` | `Evento` | `Campana` | `Cold Outreach` | `Web/Inbound` | `Pipeline` | `Otro`

---

## 5. Conversión a Oportunidad

Cuando el equipo decide que un Prospect está listo para formalizar el mandato, lo convierte en una **Oportunidad** en Airtable.

**Cuándo convertir**: normalmente cuando:
- El cliente ha enviado suficiente documentación
- El equipo ha analizado la viabilidad
- El cliente ha confirmado intención de proceder
- Se va a preparar o enviar un term sheet

**Cómo se hace**: hay dos formas equivalentes:
1. Arrastrar la card del Kanban a la columna "Listo para Term-Sheet" → aparece diálogo de confirmación con opción "Convertir a Oportunidad"
2. Abrir el panel del prospect → botón "Convertir a Oportunidad" en el footer

**Lo que ocurre tras la conversión**:
1. Se crea un registro en la tabla `Opportunities` de Airtable con:
   - Nombre: igual al `Prospect Name`
   - Stage inicial: `"Origination - Termsheet"` (primer stage del Pipeline Kanban)
   - Importe: `Targeted Ticket Size` del prospect
   - Moneda del prospect
   - Notas: contexto + próximos pasos del prospect
2. El prospect se marca como `Converted: true` y guarda el `Opportunity ID`
3. El prospect **desaparece del Kanban de Prospects** (filtrado por `!converted`)
4. La oportunidad aparece en el **Pipeline Kanban** con 9 stages (vista separada)

Esta es la transición formal: el lead sale del pre-pipeline y entra en el proceso de deal management completo.

---

## 6. Kanban y Gestión Visual

El Kanban de Prospects es la vista principal del módulo. Se compone de:

**Header**: título + KPIs (`N activos | Pipeline total: €XM`)

**Filtros** (colapsables):
- Búsqueda por nombre, origen o producto
- Filtro por origen: All / Referral / Evento / Campana / Cold Outreach / Web-Inbound / Pipeline / Otro

**Banner de sugerencias** (aparece si hay señales del Bridge/CRM): ver sección 3.3

**Columnas** (5, de 290px de ancho fijo, scroll horizontal):
- Cabecera: nombre del stage + count + importe total + botón "+"
- Cards: empresa, importe, producto, origen, avatares de contactos, deal manager, icono de tareas pendientes

**Acciones sobre una card**:
- Click → abre el panel de edición
- Drag & drop → mueve entre stages

**Deduplicación**: al cargar, el sistema elimina prospects duplicados (mismo nombre o mismo dominio de email), conservando siempre el de datos más completos.

---

# Parte II — Implementación Técnica

## 7. Arquitectura y fuentes de datos

```
Airtable BETA-Prospects (fuente de verdad)
    ↑↓ airtableProspects.ts
    
ProspectsView.tsx         — Kanban, filtros, bridge sync banner
    │
    ├── ProspectPanel.tsx — Formulario CRUD, tareas, AI
    │       │
    │       ├── ProspectTasks.tsx          — Componente de tareas
    │       └── CompanyActivitySection     — Historial CRM (inline)
    │
    └── bridgeProspectSync.ts             — Señales de avance de stage

Airtable Internal-Tasks (tareas persistentes)
    ↑ airtableTasks.ts

Airtable Config-Users (lookup nombre → recordId)
    ↑ airtableTasks.ts

/api/gemini-proxy (Vercel) → Gemini 2.0 Flash
    ↑ gemini.ts

/api/notify-task (Vercel) → Resend/SMTP
    ↑ ProspectPanel.tsx handleSave()

GAS pipeline endpoint (Google Sheets)
    ↑ bridgeProspectSync.ts fetchBridgePipelineCards()
```

**Flujo de lectura al cargar la vista:**
```
ProspectsView.tsx mounts
    1. fetchAllProspects()          → GET BETA-Prospects (paginado, filter Active)
    2. normalizeProspect() por cada record
    3. deduplicación en cliente
    4. setProspects(filtered)       → renderiza el Kanban
    5. (background) fetchBridgePipelineCards() → GAS ?action=pipeline
    6. computeSyncSuggestions()     → calcula banners de sugerencia
    7. setPendingSuggestions()
```

## 8. Tabla Airtable BETA-Prospects

| Campo | Tipo Airtable | Obligatorio | Descripción |
|-------|--------------|-------------|-------------|
| `Prospect Name` | singleLineText | Sí | Nombre del deal |
| `Stage` | singleSelect | Sí | Uno de los 5 stages |
| `Amount` | number | No | Importe en número puro |
| `Currency` | singleSelect | No | `EUR` \| `USD` \| `GBP` |
| `Product` | singleSelect | No | Tipo de producto financiero |
| `Origin` | singleSelect | No | Origen del lead |
| `Context` | multilineText | No | Notas libres, resúmenes IA |
| `Next Steps` | multilineText | No | Próximos pasos acordados |
| `Assigned To` | singleLineText | No | Nombre del responsable |
| `Assigned Email` | email | No | Email del responsable |
| `Contact Email` | email | No | Primer email de contacto (backward compat) |
| `Contacts` | multilineText | No | `JSON.stringify([{name, email, role}])` |
| `Deal Manager` | singleSelect | No | Deal manager del equipo |
| `Converted` | checkbox | No | `true` si ya es Opportunity |
| `Opportunity ID` | singleLineText | No | Record ID de la Opportunity creada |
| `Record Status` | singleSelect | No | `"Active"` \| `"Deleted"` (soft delete) |
| `Tasks` | multipleRecordLinks | No | Links a `Internal - Tasks` |
| `AI Summary` | longText | No | Resumen IA generado por Gemini |
| `AI Suggested Stage` | singleLineText | No | Stage sugerido por IA |
| `AI Generated At` | dateTime | No | Timestamp del resumen |

> **Regla crítica**: Los campos `singleSelect` nunca se envían como string vacío. Si no tienen valor, se elimina el campo del payload antes de enviarlo a Airtable (previene error 422).

> **Regla crítica**: El campo `Tasks` es un `multipleRecordLinks`. No se envía directamente al guardar el prospect. Las tasks se sincronizan por separado mediante `syncTasksToAirtable()`.

## 9. Capa de datos — airtableProspects.ts

### Constantes exportadas

```typescript
PROSPECT_STAGES = [
  "Lead", "Interesado", "Reunion",
  "Documentacion Pendiente", "Listo para Term-Sheet"
]

PROSPECT_STAGE_COLORS = {
  "Lead":                    { bg: "#F5F3FF", color: "#6B21A8", border: "#DDD6FE" },
  "Interesado":              { bg: "#ECFDF5", color: "#047857", border: "#A7F3D0" },
  "Reunion":                 { bg: "#FFFBEB", color: "#D97706", border: "#FDE68A" },
  "Documentacion Pendiente": { bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA" },
  "Listo para Term-Sheet":   { bg: "#ECFDF5", color: "#059669", border: "#A7F3D0" },
}

ORIGIN_OPTIONS = ["Referral", "Evento", "Campana", "Cold Outreach", "Web/Inbound", "Pipeline", "Otro"]

TEAM_MEMBERS = [
  { name: "Carlos Almodovar",  email: "carlos.almodovar@alter-5.com" },
  { name: "Gonzalo de Gracia", email: "gonzalo.degracia@alter-5.com" },
  { name: "Miguel Solana",     email: "miguel.solana@alter-5.com" },
  { name: "Salvador Carrillo", email: "salvador.carrillo@alter-5.com" },
  { name: "Rafael Nevado",     email: "rafael.nevado@alter-5.com" },
  { name: "Javier Ruiz",       email: "javier.ruiz@alter-5.com" },
  { name: "Leticia Menendez",  email: "leticia.menendez@alter-5.com" },
]

TASK_TEMPLATES = ["Convocar reunion", "Reclamar informacion", "Preparar Term-Sheet"]
```

### Funciones CRUD

```typescript
// READ — paginado con filtro Active
fetchAllProspects() → GET BETA-Prospects, filter: {Record Status}="Active"
fetchProspect(recordId) → GET BETA-Prospects/{recordId}

// CREATE
createProspect(fields)
// → sanitiza linked records (elimina arrays de recXXX)
// → POST BETA-Prospects con { fields: {...} }

// UPDATE
updateProspect(recordId, fields)
// → sanitiza linked records
// → PATCH BETA-Prospects/{recordId} con { fields: {...} }

// DELETE (hard delete — no soft delete)
deleteProspect(recordId)
// → DELETE BETA-Prospects/{recordId}

// CONVERSIÓN
convertToOpportunity(prospect)
// → POST Opportunities (createOpportunity de airtable.ts)
// → PATCH BETA-Prospects/{id} con {Converted: true, Opportunity ID, Stage}
```

### normalizeProspect(record)

Transforma el formato raw de Airtable en un objeto limpio:

```typescript
{
  id: record.id,                    // "recXXXXXXXXXXXX"
  name: f["Prospect Name"].trim(),
  stage: f["Stage"] || "Lead",
  amount: parseFloat(f["Amount"]) || 0,
  currency: f["Currency"] || "EUR",
  product: f["Product"] || "",
  origin: f["Origin"] || "",
  context: f["Context"] || "",
  nextSteps: f["Next Steps"] || "",
  assignedTo: f["Assigned To"] || "",
  assignedEmail: f["Assigned Email"] || "",
  contactEmail: f["Contact Email"] || "",
  contacts: JSON.parse(f["Contacts"] || "[]"),  // array de {name, email, role}
  dealManager: f["Deal Manager"] || "",
  converted: !!f["Converted"],
  opportunityId: f["Opportunity ID"] || "",
  recordStatus: f["Record Status"] || "Active",
  tasks: JSON.parse(f["Tasks"] || "[]"),  // legacy: tasks en JSON; nuevo: linked records
  aiSummary: f["AI Summary"] || "",
  aiSuggestedStage: f["AI Suggested Stage"] || "",
  aiGeneratedAt: f["AI Generated At"] || "",
  _raw: f,                          // todos los campos originales
}
```

## 10. Flujo técnico de creación desde campaña

```
1. BridgeCampaignView.jsx
   → fetchBridgePipelineCards() [GET /api/campaign-proxy?action=pipeline]
   → Pipeline card: { email: "carlos@solaren.es", etapa: "reunion", notas: [...] }

2. computeSyncSuggestions(prospects, bridgeCards, companies)
   → matchProspectToBridge(prospect, bridgeCards)
       → extractDomain("carlos@solaren.es") = "solaren.es"
       → busca cards cuyo email.split('@')[1] === "solaren.es"
       → si etapa mapeable → BRIDGE_TO_PROSPECT["reunion"] = "Reunion"
       → stageIsMoreAdvanced("Reunion", prospect.currentStage) = true
   → genera SyncSuggestion { prospectId, suggestedStage: "Reunion", source: "bridge", evidence: [...] }

3. ProspectsView muestra banner con botones [Aplicar] [Ignorar]

4. Usuario pulsa [Aplicar]
   → updateProspect(prospect.id, { Stage: "Reunion" })
   → PATCH /api/airtable-proxy → PATCH Airtable BETA-Prospects/{id}
   → ProspectsView recarga → card se mueve a columna "Reunion"

--- Si el Prospect no existía: ---

4b. Usuario pulsa "+ Añadir" en columna "Lead" (o "Reunion")
   → abre ProspectPanel (isNew=true, initialStage="Lead")

5. Usuario escribe nombre "SolarEn SA"
   → matchedCompany() calcula:
       → contacts = [] (aún vacío)
       → sin dominio todavía → null

6. Usuario añade contacto: carlos@solaren.es
   → matchedCompany() recalcula:
       → extractDomain("carlos@solaren.es") = "solaren.es"
       → companies.find(c => c.domain === "solaren.es") → match!
   → Renderiza CompanyActivitySection con historial CRM

7. Usuario selecciona Stage, Deal Manager, Importe, Producto, Origen
8. Usuario rellena Contexto con notas de la reunión
9. Usuario pulsa "Generar resumen y tareas" (ver sección 12)
10. Usuario pulsa "Crear prospect"
    → handleSave()
    → createProspect({ fields }) → POST BETA-Prospects
    → syncTasksToAirtable(tasks) → POST Internal-Tasks
    → notificaciones por email si hay tareas asignadas
    → onSaved() → ProspectsView recarga
```

## 11. Flujo técnico de creación manual

```
1. Usuario en ProspectsView → clic en "+" de cualquier columna
   → setIsCreatingProspect(true)
   → setNewProspectStage("Lead")  // o el stage de esa columna

2. ProspectPanel renderiza (isNew=true)
   → formData inicial: { name: "", stage: "Lead", ... }
   → contacts: []
   → tasks: []

3. Usuario completa el formulario

4. handleSave():
   a. validateForm() → name y stage obligatorios
   
   b. Construye fields:
      {
        "Prospect Name": "EmpresaXYZ",
        "Stage": "Lead",
        "Deal Manager": "Salvador Carrillo",  // o undefined si vacío
        "Amount": 15000000,
        "Currency": "EUR",
        "Product": "Project Finance",          // o undefined si vacío
        "Origin": "Referral",                  // o undefined si vacío
        "Context": "Empresa developer...",
        "Next Steps": "1. Enviar NDA...",
        "Assigned To": "Javier Ruiz",          // o undefined
        "Contact Email": "ana@empresaxyz.es",  // primer email válido
        "Contacts": '[{"name":"Ana García","email":"ana@empresaxyz.es","role":"CFO"}]',
        "Record Status": "Active"              // solo en create
        // "Tasks" NO se incluye — se sincroniza aparte
      }
   
   c. Elimina campos undefined y vacíos (previene 422 en singleSelect)
   
   d. createProspect(fields)
      → sanitiza linked records
      → POST /api/airtable-proxy → POST Airtable BETA-Prospects
      → { id: "recXXXXXXXXXXXX", fields: {...} }
   
   e. syncTasksToAirtable(tasks, opportunityId)
      → por cada task sin airtableId: createAirtableTask()
      → por cada task con airtableId: updateAirtableTask()
      → actualiza tasks con airtableIds recibidos
   
   f. Notificaciones (ver sección 14)
   
   g. showFeedback("success", "Prospect creado correctamente")
   
   h. setTimeout → onClose() → ProspectsView recarga
```

## 12. Sistema de IA — gemini.ts

Hay tres funciones de IA que puede llamar el ProspectPanel, todas via `/api/gemini-proxy`:

### summarizeMeetingNotes(notes, prospectName)

**Prompt**:
```
Eres un analista de deal origination en Alter5 (financiacion energias renovables).
Genera un RESUMEN EJECUTIVO breve (max 5 lineas) de las notas de reunion con "{prospectName}".
Enfócate en: tipo de proyecto, tamaño del deal, intereses del prospect, urgencia, puntos clave.
Responde SOLO con el resumen, sin encabezados ni markdown.
```

**Temperatura**: 0.3 (determinista)
**Resultado**: string de texto libre, máximo ~5 líneas

### extractTasksFromNotes(notes, prospectName)

**Prompt**:
```
De las notas de reunion con "{prospectName}", extrae los PROXIMOS PASOS como tareas.
Para cada tarea: "text" (imperativo), "assignedTo" (si se menciona), "dueDate" (YYYY-MM-DD si se menciona).
Responde UNICAMENTE con JSON array. Si no hay proximos pasos: []
```

**Temperatura**: 0.2 (muy determinista — parsea JSON)
**Resultado**: array de tasks listo para `setTasks(prev => [...prev, ...newTasks])`

**Formato de cada task extraída**:
```typescript
{
  id: "task_" + Date.now().toString(36) + random,
  text: "Enviar NDA a legal",
  status: "pendiente",
  assignedTo: "Salvador",     // o "" si no se menciona
  dueDate: "2026-03-25",      // o "" si no se menciona
  createdAt: ISO datetime,
}
```

### generateProspectIntelligence(prospectName, company, existingContext)

La función más sofisticada. Analiza toda la información disponible del prospect y la empresa del CRM para generar un análisis ejecutivo completo.

**Input que proporciona al prompt**:
- Nombre, dominio, tipo, segmento, fase comercial, tecnologías, geografía, market roles
- Todos los datos del prospect (producto, stage, importe, origen, contactos, notas)
- Últimos 30 asuntos de email con extractos de fecha
- Desglose por empleado (cuántos emails, qué asuntos)
- Contexto histórico de la empresa

**Instrucciones al modelo**:
1. Analizar si es un prospect real o un falso positivo (intermediario, SaaS, broker)
2. Si hay intermediario, identificar al beneficiario final real
3. Generar resumen ejecutivo estructurado:
   - Naturaleza de la relación y tipo de oportunidad
   - Historial de comunicaciones y engagement
   - Posición en el funnel de origination
   - Riesgos o alertas
4. Sugerir próximos pasos concretos

**Temperatura**: 0.2 (análisis riguroso)
**Formato de respuesta**: JSON estricto:
```json
{
  "is_prospect": true,
  "summary": "Texto del resumen ejecutivo...",
  "suggested_next_steps": ["Paso 1", "Paso 2", "Paso 3"]
}
```

**Persistencia**: el campo `summary` se guarda en Airtable `AI Summary` y permanece entre sesiones. Se puede regenerar manualmente con el botón "Regenerar".

## 13. Sistema de tareas — ProspectTasks y airtableTasks

### Modelo local de una tarea

```typescript
{
  id: "task_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  text: string,              // título de la tarea
  description: string,       // descripción adicional
  status: "pendiente" | "en_curso" | "hecho",
  assignedTo: string,        // nombre del TEAM_MEMBER
  dueDate: string,           // "YYYY-MM-DD" o ""
  createdAt: string,         // ISO datetime
  notifiedAt: string,        // ISO datetime de cuándo se notificó, o ""
  airtableId?: string,       // record ID en Internal-Tasks (después de sync)
}
```

### Ciclo de vida completo

```
CREACIÓN (en el ProspectPanel):
  1. Usuario pulsa "+ Añadir tarea" → selecciona template o "Otra"
  2. addTaskFromTemplate(text) → genera objeto local con id único
  3. setTasks(prev => [...prev, newTask])
  4. Task aparece en UI (en grupo "Pendiente")
  5. Usuario edita título, descripción, assignedTo, dueDate
  6. Al guardar el prospect → syncTasksToAirtable(tasks)
  7. createAirtableTask(task) → POST Internal-Tasks con:
       { Name, Status: "To do", Description, Deadline, Owner: [recID], Opportunity: [recID] }
  8. Recibe airtableId → task.airtableId = recID

ACTUALIZACIÓN:
  1. Usuario cambia estado (click en dot) o edita campos
  2. updateTask(taskId, changes) → setTasks(updated)
  3. Al guardar: syncTasksToAirtable → PATCH Internal-Tasks/{airtableId}

ELIMINACIÓN:
  1. Usuario pulsa ✕ en la tarea
  2. removeTask(taskId) → setTasks(tasks.filter(...))
  3. Al guardar: la tarea desaparece del local state
  4. En Airtable permanece (sin soft delete de tasks)
```

### Tabla Internal - Tasks (Airtable)

| Campo | Tipo | Fuente |
|-------|------|--------|
| `Name` | singleLineText | `task.text` |
| `Status` | singleSelect | `STATUS_MAP[task.status]`: `pendiente→"To do"`, `en_curso→"Doing"`, `hecho→"Done"` |
| `Description` | longText | `task.description` |
| `Deadline` | date | `task.dueDate` |
| `Owner` | multipleRecordLinks | `[resolveOwner(task.assignedTo)]` |
| `Opportunity` | multipleRecordLinks | `[prospect.opportunityId]` si el prospect ya fue convertido |

### resolveOwner(assignedToName)

Para obtener el record ID de un miembro del equipo en la tabla `Config - Users`:

```typescript
async function resolveOwner(assignedToName: string): Promise<string | null> {
  // 1. Busca el email del miembro en TEAM_MEMBERS
  const member = TEAM_MEMBERS.find(m => m.name === assignedToName);
  if (!member) return null;
  
  // 2. Busca en cache (Map<email, recordId>)
  if (userCache.has(member.email)) return userCache.get(member.email);
  
  // 3. GET Config-Users con filter {Email}="email"
  const formula = `{Email}="${member.email}"`;
  const data = await airtableProxy({
    table: "tblb3kyXSnXS0GPjy",  // Config - Users table ID
    method: 'GET',
    formula,
    pageSize: 1,
  });
  
  const recordId = data.records?.[0]?.id || null;
  if (recordId) userCache.set(member.email, recordId);
  return recordId;
}
```

## 14. Notificaciones por email de tareas

Al guardar un prospect, si alguna tarea tiene `assignedTo` y `!notifiedAt` (no notificada aún), el sistema envía un email de notificación.

**Endpoint**: `POST /api/notify-task` (Vercel serverless)

**Payload enviado**:
```typescript
{
  to: "javier.ruiz@alter-5.com",
  toName: "Javier Ruiz",
  taskText: "Enviar NDA",
  taskDescription: "Coordinarlo con legal antes del viernes",
  prospectName: "SolarEn SA",
  assignedBy: "Salvador Carrillo",  // o el Deal Manager del prospect
  dueDate: "2026-03-25",
  prospectContext: "Empresa developer 50MW en Extremadura...",
  dashboardUrl: "https://alter5-bi.vercel.app/?tab=prospects",
}
```

**Lógica de envío**:
```typescript
// En handleSave():
const tasksToNotify = tasks.filter(t =>
  t.assignedTo && !t.notifiedAt && t.status !== 'hecho'
);

// Envía en paralelo con Promise.allSettled
const notifyPromises = tasksToNotify.map(async (task) => {
  const resp = await fetch('/api/notify-task', { method: 'POST', body: JSON.stringify({...}) });
  if (resp.ok) {
    task.notifiedAt = new Date().toISOString();  // marca como notificado
  }
});

await Promise.allSettled(notifyPromises);

// Si se notificó a alguien: actualiza el prospect en Airtable con tasks actualizado
// para persistir el notifiedAt
if (notifiedNames.length > 0) {
  await updateProspect(result.id, { 'Tasks': JSON.stringify(tasks) });
}
```

**Mensaje de feedback**: "Guardado. Notificación enviada a Javier, Carlos."

**Garantía de una sola notificación**: una vez que `notifiedAt` tiene valor, esa tarea no vuelve a notificar en guardados posteriores, aunque el responsable cambie. Para re-notificar habría que borrar el `notifiedAt` (no hay UI para esto).

## 15. Sincronización Bridge → Prospects

### Cuándo se ejecuta

Al cargar `ProspectsView`, en background (no bloquea el render del Kanban):

```typescript
// En ProspectsView.tsx processProspects():
fetchBridgePipelineCards()
  .then(bridgeCards => {
    const suggestions = computeSyncSuggestions(
      prospects,           // array de BETA-Prospects normalizados
      bridgeCards,         // pipeline del GAS
      allCompanies,        // CRM completo
      companyByNameMap,    // Map<name/domain, company>
    );
    setPendingSuggestions(
      suggestions.filter(s => !syncDismissed.has(s.prospectId))
    );
  })
  .catch(() => {});  // falla silenciosamente
```

### computeSyncSuggestions() — Lógica completa

```typescript
for (const prospect of prospects) {
  let suggestedStage = null;
  let source = 'bridge';
  let evidence = [];

  // === Señal 1: Bridge Pipeline (GAS Sheets) ===
  const bridgeCard = matchProspectToBridge(prospect, bridgeCards);
  if (bridgeCard) {
    const mappedStage = BRIDGE_TO_PROSPECT[bridgeCard.etapa];
    // BRIDGE_TO_PROSPECT = {
    //   reunion: 'Reunion',
    //   subida_docs: 'Documentacion Pendiente',
    //   doc_completada: 'Listo para Term-Sheet',
    // }
    if (mappedStage && stageIsMoreAdvanced(mappedStage, prospect.stage)) {
      suggestedStage = mappedStage;
      evidence = [`Bridge: etapa "${bridgeCard.etapa}" (${bridgeCard.email})`];
    }
  }

  // === Señal 2: Keywords de reunión en CRM ===
  const company = findCompany(prospect);  // busca en CRM por nombre/dominio
  if (company) {
    const { hasMeeting, evidence: ev } = detectMeetingFromCRM(company);
    // detectMeetingFromCRM busca en:
    //   company.detail.datedSubjects[].subject + extract
    //   company.detail.subjects[]
    // Keywords: reunion, reunión, llamada, meeting, call, agenda,
    //           convocatoria, videollamada, teams, zoom
    
    if (hasMeeting && stageIsMoreAdvanced('Reunion', prospect.stage)) {
      if (!suggestedStage || !stageIsMoreAdvanced(suggestedStage, 'Reunion')) {
        suggestedStage = 'Reunion';
        source = 'crm-meeting';
        evidence = ev.map(e => `CRM: "${e}"`);
      }
    }
  }

  // Emite sugerencia solo si hay algo que avanzar
  if (suggestedStage && stageIsMoreAdvanced(suggestedStage, prospect.stage)) {
    suggestions.push({
      prospectId: prospect.id,
      prospectName: prospect.name,
      currentStage: prospect.stage,
      suggestedStage,
      source,
      evidence,
    });
  }
}
```

### matchProspectToBridge(prospect, bridgeCards)

```typescript
// 1. Extrae todos los dominios del prospect
const domains = new Set<string>();
[prospect.contactEmail, ...prospect.contacts.map(c => c.email)]
  .filter(Boolean)
  .forEach(email => domains.add(email.split('@')[1]?.toLowerCase()));

// 2. Filtra cards cuyo email.split('@')[1] esté en domains
// 3. Excluye etapa 'descartado'
// 4. Toma la etapa más avanzada (orden: nurturing < reunion < subida_docs < doc_completada)
```

### stageIsMoreAdvanced(a, b)

```typescript
const STAGE_INDEX = { Lead: 0, Interesado: 1, Reunion: 2, "Documentacion Pendiente": 3, "Listo para Term-Sheet": 4 };
return STAGE_INDEX[a] > STAGE_INDEX[b];
```

## 16. Referencia de llamadas a Airtable

### Desde ProspectsView / ProspectPanel

| Operación | Tabla | Método HTTP | Cuándo |
|-----------|-------|------------|--------|
| Listar prospects | `BETA-Prospects` | GET paginado + filtro `{Record Status}="Active"` | Al montar `ProspectsView` |
| Crear prospect | `BETA-Prospects` | POST | `handleSave()` en `isNew=true` |
| Actualizar prospect | `BETA-Prospects` | PATCH | `handleSave()`, drag&drop, bridge sync "Aplicar" |
| Eliminar prospect | `BETA-Prospects` | DELETE | Botón "Eliminar" + confirmación |
| Convertir a Opportunity | `Opportunities` | POST | `convertToOpportunity()` — paso 1 |
| Marcar como convertido | `BETA-Prospects` | PATCH | `convertToOpportunity()` — paso 2 |
| Lookup usuario | `Config-Users` (tblb3kyXSnXS0GPjy) | GET + filtro email | `resolveOwner()` en `syncTasksToAirtable` |
| Crear tarea | `Internal - Tasks` | POST | `createAirtableTask()` si task sin airtableId |
| Actualizar tarea | `Internal - Tasks` | PATCH | `updateAirtableTask()` si task con airtableId |

### Sanitización obligatoria antes de enviar

```typescript
// En createProspect() y updateProspect():
function sanitizeLinkedRecords(fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v) && v.length > 0 &&
        typeof v[0] === 'string' && v[0].startsWith('rec')) {
      delete fields[k];  // elimina campos linked record del payload
    }
  }
}
// Airtable devuelve 422 si se envían arrays de recXXX en campos linked record
```

### Eliminación de campos vacíos en singleSelect

```typescript
// Antes de enviar:
Object.keys(fields).forEach(k => {
  if (fields[k] === undefined || fields[k] === '') delete fields[k];
});
// Airtable devuelve 422 si se envía "" en un campo singleSelect
```

---

*Documento generado el 21 de marzo de 2026.*
