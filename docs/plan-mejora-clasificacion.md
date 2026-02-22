# Plan de Mejora: Clasificacion de Empresas por Producto

**Fecha:** 21 febrero 2026
**Autor:** Asistente IA (para revision de Salvador Carrillo)
**Estado:** BORRADOR — pendiente de validacion

---

## 1. Objetivo

Conseguir que el dashboard de Alter5 BI responda a la pregunta:
**"Cuales de mis 3.257 empresas son susceptibles de necesitar cada producto concreto de Alter5?"**

Hoy el sistema clasifica empresas por sector (Renovables, Energia, Banca...) y tipo de relacion (Potencial Prestatario, Inversor/Fondo...), pero eso no dice si necesitan un prestamo de construccion, una refinanciacion, colocacion a inversores o asesoramiento M&A.

---

## 2. Diagnostico: que tenemos y que falla

### 2.1 El flujo actual

```
Gmail (3 buzones) 
  → Google Colab (Gemini 2.0 Flash clasifica por lotes)
    → Output: empresa, contacto, cargo, sector, tipo, contexto, historico_trimestral
      → Pipeline Python (import_mailbox.py / process_sheet_emails.py)
        → companies.json (dashboard React)
```

### 2.2 Tres problemas concretos

**Problema 1: Gemini tiene la info pero no se le pregunta lo correcto.**
El prompt actual le pide a Gemini sector y tipo de relacion (generico), pero nunca le pregunta: "esta empresa necesita un prestamo de construccion?", "les mandamos un term sheet?", "son un desarrollador o un IPP?". Gemini LEE los emails donde se envian term sheets, pero como no se le pide que lo reporte, esa informacion no sale en el output.

**Problema 2: La informacion rica que Gemini genera se pierde en el pipeline.**
- El campo `historico_trimestral` pasa de texto descriptivo ("Q2 2024: Envio de term sheet para proyecto de 50MW") a solo un numero ("Q2 2024: 47 emails"). Se destruye la inteligencia de negocio.
- El campo `contexto` se trunca a 150 caracteres, perdiendo la mitad del resumen.

**Problema 3: No se distinguen tipos de empresa renovable.**
Un desarrollador greenfield, un IPP con parques operativos y un fondo que compra proyectos RTB son todos "Renovables + Potencial Prestatario", pero necesitan productos completamente distintos.

---

## 3. Solucion propuesta

### 3.1 Vision general

```
Gmail (3 buzones)
  → Google Colab (Gemini 2.0 Flash CON PROMPT MEJORADO + web grounding)
    → Output ENRIQUECIDO:
        - Todo lo que ya genera (empresa, contacto, cargo, sector, tipo, contexto, historico)
        - NUEVO: subtipo_empresa (Desarrollador, IPP, Fondo, etc.)
        - NUEVO: productos_potenciales (con confianza y razon)
        - NUEVO: senales_clave (term sheet enviado, NDA, MW mencionados, etc.)
        - NUEVO: fase_comercial (Primer contacto, Exploracion, Negociacion, etc.)
        - NUEVO: info_web (lo que Gemini encuentra en la web de la empresa)
      → Pipeline Python MODIFICADO (preserva toda la info)
        → companies.json ENRIQUECIDO
          → Dashboard React CON FILTROS POR PRODUCTO
```

### 3.2 Modificacion 1: Prompt de Gemini (en los 3 Colabs)

**Que cambia:** Se anade contexto sobre los productos de Alter5 al inicio del prompt, y se piden 5 campos nuevos en el output.

**Prompt actual (inicio):**
```
Eres un analista de relaciones comerciales de Alter5, una fintech espanola 
especializada en financiacion de proyectos de energia renovable y transicion 
energetica.
Analiza estos emails agrupados por dominio...
```

**Prompt propuesto (inicio — se anade bloque de productos y busqueda web):**
```
Eres un analista de relaciones comerciales de Alter5, una fintech espanola
especializada en financiacion de proyectos de energia renovable.

Alter5 ofrece estos productos:
- Prestamo Construccion: deuda para construir proyectos utility-scale 
  (solar FV, eolico, BESS). Cliente tipico: desarrollador, IPP o fondo 
  con proyectos greenfield o RTB (ready to build).
- Refinanciacion: sustitucion de deuda existente en proyectos ya operativos 
  por mejores condiciones.
- Colocacion Inversores: distribucion de tramos de deuda o equity a inversores 
  institucionales, fondos y family offices.
- Advisory / M&A: asesoramiento en compraventa, valoracion y due diligence 
  de proyectos y activos renovables.

Para cada dominio, busca informacion publica de la empresa en su web y en 
noticias recientes. Usa esa informacion junto con los emails para hacer una 
clasificacion mas precisa.

Analiza estos emails agrupados por dominio...
```

**Campos nuevos a pedir en el output (se anaden a los existentes, no se quita nada):**

| Campo nuevo | Tipo | Valores posibles | Para que sirve |
|---|---|---|---|
| `subtipo_empresa` | String | Desarrollador, IPP, Fondo Renovable, Utility, EPC/Proveedor, Asesor, Inversor Institucional, Otro | Distinguir que tipo de empresa renovable es |
| `productos_potenciales` | Array | Objetos con {producto, confianza, razon} | Saber que producto de Alter5 aplica y por que |
| `senales_clave` | Array | Strings libres | Hechos concretos: "Term sheet enviado Q3 2024", "NDA firmado", "Pipeline 200MW" |
| `fase_comercial` | String | Primer contacto, Exploracion, Negociacion, Cliente activo, Dormido, Descartado | En que punto esta la relacion comercial |
| `info_web` | String | Texto libre (1-2 frases) | Lo que Gemini encuentra en la web de la empresa: pipeline, tipo, noticias |

**Ejemplo de output enriquecido para una empresa:**
```json
{
  "empresa": "RIC Energy",
  "contacto": "Lourdes Barea",
  "email": "lourdes.barea@ric.energy",
  "cargo": "Chief Financial Officer",
  "sector": "Energia",
  "tipo": "Potencial Prestatario",
  "contexto": "Contacto para presentar programa de financiacion FEI. Reunion 
    para discutir proyectos. Se envio term sheet para 3 proyectos FV en Q3 2024.",
  "historico_trimestral": {
    "Q1 2024": "Primer contacto: presentacion del programa FEI.",
    "Q2 2024": "Reunion para evaluar pipeline de proyectos.",
    "Q3 2024": "Envio de term sheet para 3 proyectos FV (120MW total).",
    "Q4 2024": "Seguimiento pendiente de respuesta al term sheet."
  },
  "dominio": "ric.energy",
  "subtipo_empresa": "IPP",
  "productos_potenciales": [
    {
      "producto": "Prestamo Construccion",
      "confianza": "alta",
      "razon": "IPP con proyectos FV en fase RTB, se envio term sheet"
    }
  ],
  "senales_clave": [
    "Term sheet enviado Q3 2024",
    "CFO como contacto directo",
    "Pipeline de 120MW en proyectos FV",
    "Programa FEI mencionado"
  ],
  "fase_comercial": "Negociacion",
  "info_web": "IPP espanol con 500MW operativos y 1.2GW en pipeline. 
    Proyectos en Espana y Portugal."
}
```

**Parametros de Gemini a ajustar:**
- Modelo: gemini-2.0-flash (sin cambio)
- Temperature: 0.15 (sin cambio)
- Max tokens: 16.000 → **subir a 24.000** (los campos nuevos generan mas texto)
- Lotes: 6 dominios → **bajar a 4 dominios** por llamada (mas info por dominio = mas tokens)
- Activar **grounding con Google Search** para que busque info de la web

### 3.3 Modificacion 2: Pipeline Python (en el repo alter5-bi)

**Archivos afectados:**

| Archivo | Cambio |
|---|---|
| `scripts/import_mailbox.py` | Ampliar context de 150 a 500 chars. Cambiar formato de timeline para incluir texto. Anadir campos nuevos al export compacto. |
| `scripts/process_sheet_emails.py` | Mismos cambios + leer los campos nuevos del output de Gemini. |
| `src/utils/data.js` | Parsear los campos nuevos del JSON compacto. Si hay `productos_potenciales` de Gemini, usarlos en vez del scoring por keywords. |

**Cambios concretos en `export_to_compact` (import_mailbox.py):**

Formato actual del detail:
```
[contacts, timeline, context(150chars), source_breakdown]
```

Formato propuesto:
```
[contacts, timeline, context(500chars), source_breakdown, subjects, enrichment]
```

Donde `enrichment` es:
```json
{
  "st": "IPP",
  "pp": [{"p": "Prestamo Construccion", "c": "alta", "r": "IPP con RTB..."}],
  "sc": ["Term sheet enviado Q3 2024", "CFO contacto"],
  "fc": "Negociacion",
  "iw": "IPP espanol con 500MW operativos..."
}
```
(Claves abreviadas para reducir tamano del JSON.)

### 3.4 Modificacion 3: Dashboard React (en el repo alter5-bi)

**Archivos afectados:**

| Archivo | Cambio |
|---|---|
| `src/utils/constants.js` | Ya tiene los PRODUCTS definidos. Anadir SUBTIPOS y FASES. |
| `src/utils/data.js` | Si empresa tiene `productos_potenciales` de Gemini → score directo (alta=90, media=60, baja=30). Si no, fallback a keyword scoring. |
| `src/components/Sidebar.jsx` | Anadir filtro por subtipo_empresa y fase_comercial. |
| `src/components/DetailPanel.jsx` | Mostrar senales_clave como chips. Mostrar info_web. Mostrar historico trimestral con texto. |
| `src/components/CompanyTable.jsx` | Ya tiene columna Producto (sin cambios). |

---

## 4. Plan de ejecucion

### Paso 1: Yo preparo (en el repo)
- Genero el texto completo del prompt mejorado listo para copiar-pegar
- Modifico los scripts Python del pipeline
- Actualizo el dashboard React

### Paso 2: Tu ejecutas (en Google Colab)
- Abres los 3 Colabs (Salvador, Guillermo, Leticia)
- Sustituyes el prompt viejo por el nuevo
- Re-ejecutas para reclasificar todas las empresas

### Paso 3: Los datos fluyen
- El output enriquecido de Gemini entra en el pipeline modificado
- El dashboard muestra los nuevos campos y filtros

---

## 5. Preguntas pendientes antes de ejecutar

1. **Donde se guarda el output del Colab?** En Google Sheet, en JSON, en Excel? Necesito saber para adaptar el pipeline.

2. **Vas a re-ejecutar los 3 Colabs completos** para reclasificar las 3.257 empresas? O solo quieres que aplique a emails nuevos?

3. **El grounding web de Gemini** tiene coste adicional en tu plan de Google AI Studio? Hay que verificar que este habilitado.

---

## 6. Estimacion de impacto

| Metrica | Antes | Despues |
|---|---|---|
| Campos por empresa | 9 (sector, tipo, context...) | 14 (+subtipo, productos, senales, fase, info_web) |
| Precision de context | 150 chars, truncado | 500 chars, completo |
| Historico trimestral | Solo counts de emails | Texto descriptivo por trimestre |
| Matching por producto | Keywords (substring matching) | Clasificacion semantica directa de Gemini + fallback keywords |
| Deteccion de term sheets | No existia | Gemini lo detecta y lo reporta en senales_clave |
| Tipo de empresa renovable | Todos iguales ("Renovables") | Distingue Desarrollador, IPP, Fondo, Utility, EPC |
| Info publica de la empresa | No existia | Gemini busca web y resume pipeline, tipo, noticias |
