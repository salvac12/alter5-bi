# Product Matching — Metodologia y Criterios

## 1. El problema

Alter5 tiene una base de datos de **3.257 empresas** extraida de los buzones de correo del equipo. Cada empresa tiene datos basicos (sector, tipo de relacion, contexto resumido, contactos con rol estimado, historico de interacciones), pero **no existe ninguna clasificacion que diga que producto concreto de Alter5 podria necesitar cada empresa**.

Saber que una empresa es "Renovables + Potencial Prestatario" no es suficiente: no distingue entre si necesita un prestamo de construccion, una refinanciacion, colocacion a inversores, o asesoramiento M&A.

## 2. Datos disponibles por empresa

Antes de disenar el scoring, hay que entender **que informacion tenemos realmente** para cada empresa:

| Campo | Que contiene | Ejemplo |
|---|---|---|
| `context` | Resumen de la relacion generado por IA (max 150 chars) | "Oferta de financiacion para parques fotovoltaicos y eolicos" |
| `subjects` | Asuntos de emails recibidos (hasta 20) | ["Re: Term Sheet Proyecto Aurora", "FW: Financiacion puente 50MW"] |
| `sectors` | Sector/es asignados por IA | "Renovables", "Energia" |
| `relType` | Tipo de relacion asignado por IA | "Potencial Prestatario" |
| `contacts` | Lista de contactos con rol estimado | [{name: "Lourdes Barea", role: "Chief Financial Officer"}] |
| `interactions` | Numero total de emails intercambiados | 1.224 |
| `monthsAgo` | Meses desde el ultimo contacto | 3 |
| `employees` | Buzones del equipo que tienen esta empresa | ["salvador_carrillo", "leticia_menendez"] |

**Lo que NO tenemos** (limitaciones actuales):
- El cuerpo completo de los emails (solo un snippet de 300 chars, no analizado)
- Los subjects no estaban almacenados en el JSON hasta ahora (se perdia esa informacion)
- No hay datos firmograficos externos (revenue, empleados, web scraping)

## 3. Los 4 productos definidos

Cada producto se define con una "ficha" que tiene criterios de busqueda multi-dimension:

### 3.1 Prestamo Construccion (construction_loan)
**Que es:** Project finance para construir proyectos utility-scale de renovables (solar FV, eolico, BESS).
**Cliente tipico:** Desarrollador de renovables que tiene proyectos RTB/greenfield y necesita deuda para construirlos.

### 3.2 Refinanciacion (refinancing)
**Que es:** Sustitucion de deuda existente en proyectos que ya estan operando, con mejores condiciones.
**Cliente tipico:** Propietario de parques en operacion que quiere mejorar las condiciones de su deuda o reestructurar.

### 3.3 Colocacion Inversores (investor_placement)
**Que es:** Distribucion de tramos de deuda o equity a inversores institucionales, fondos, family offices.
**Cliente tipico:** Fondo de inversion, gestora, family office buscando rentabilidad en activos renovables.

### 3.4 Advisory / M&A (advisory)
**Que es:** Asesoramiento en compraventa, valoracion y due diligence de activos renovables.
**Cliente tipico:** Empresa que quiere vender o comprar proyectos/parques, o un asesor financiero buscando mandatos.

## 4. Como funciona el scoring — paso a paso

Para **cada empresa**, se ejecuta el algoritmo contra **cada producto**. El resultado es una puntuacion de 0 a 100 que indica la probabilidad de que esa empresa necesite ese producto.

El score tiene **5 dimensiones**, cada una con un peso maximo distinto:

```
Score total (max 100) = Keywords (max 40) + RelType (max 20) + Sector (max 15) + Roles (max 15) + Actividad (max 10)
```

### 4.1 Busqueda por keywords (max 40 puntos)

Esta es la dimension mas importante. Busca palabras y frases clave en dos campos concatenados:
- El campo `context` (resumen de la relacion)
- Los `subjects` de los emails (asuntos)

Ambos se convierten a minusculas y se concatenan en un unico texto de busqueda. La busqueda usa `String.includes()` — es decir, **busqueda por substring**, no por palabra exacta. Esto es deliberado: "fotovoltaico" matchea con "fotovoltaic", y "financiacion de proyectos renovables" matchea con "financiacion de proyecto".

Las keywords estan organizadas en **3 niveles de confianza**:

| Nivel | Puntos por match | Que indica | Ejemplo para Prestamo Construccion |
|---|---|---|---|
| **High** (10 pts) | Senal directa e inequivoca del producto | "term sheet", "deuda senior", "EPC", "cierre financiero" |
| **Medium** (4 pts) | Senal fuerte pero no exclusiva | "fotovoltaic", "greenfield", "RTB", "BESS", "construccion" |
| **Low** (1 pt) | Senal generica, contexto de fondo | "renovable", "solar", "MW", "pipeline", "PPA" |

**Tope maximo: 40 puntos.** Asi, aunque una empresa tenga muchas keywords de bajo nivel, no puede superar 40 solo por keywords. Necesita senales en otras dimensiones.

**Deduplicacion:** Se usa un Set para que una keyword no sume dos veces aunque aparezca en context Y en subjects.

**Ejemplo concreto — EiDF Solar:**
- Context: "Oferta de financiacion para parques fotovoltaicos y eolicos..."
- Keywords encontradas:
  - High: "financiacion de proyecto" → +10
  - Medium: "fotovoltaic" → +4, "eolic" → +4
  - Low: "renovable" → +1
  - **Total keywords: 19 puntos**

### 4.2 Tipo de relacion (max 20 puntos)

Cada producto tiene una lista de `relTypes` afines. Si el tipo de relacion de la empresa coincide con alguno de la lista, suma 20 puntos.

| Producto | relTypes que suman | Por que |
|---|---|---|
| Prestamo Construccion | Potencial Prestatario | Son empresas identificadas como posibles tomadores de credito |
| Refinanciacion | Potencial Prestatario | Misma logica: ya tienen o tendran deuda |
| Colocacion Inversores | Inversor/Fondo, Banco | Son los que ponen el dinero |
| Advisory / M&A | Potencial Prestatario, Asesor Financiero, Partnership | Compradores, vendedores y asesores |

**Como se busca:** `relList.includes(r.toLowerCase())` — busqueda por substring en la cadena de tipos de relacion (pueden ser multiples, separados por coma).

**Este es el segundo criterio con mas peso (20 pts)** porque el tipo de relacion ya fue clasificado por Gemini y es una senal bastante confiable de intencion.

### 4.3 Sector (max 15 puntos)

Si el sector de la empresa coincide con los sectores afines del producto, suma 15 puntos.

| Producto | Sectores afines |
|---|---|
| Prestamo Construccion | Renovables, Energia |
| Refinanciacion | Renovables, Energia |
| Colocacion Inversores | Inversor/Fondo, Inversion, Banca |
| Advisory / M&A | Renovables, Energia, Asesor Financiero, Consultoria |

**Como se busca:** Igual que relType, busqueda por substring en la cadena de sectores.

**Peso menor que relType** porque el sector es mas generico. Una empresa de "Renovables" puede ser un medio de comunicacion (Renewables Now), una asociacion (UNEF), o un proveedor de tecnologia. El sector solo dice "de que va", no "que necesita".

### 4.4 Roles de contactos (max 15 puntos)

Analiza los cargos de los contactos de la empresa. Cada contacto cuyo rol coincida con la lista del producto suma 5 puntos (maximo 15, es decir 3 contactos).

| Producto | Roles que suman |
|---|---|
| Prestamo Construccion | structured finance, project finance, cfo, director financiero, tesorero |
| Refinanciacion | structured finance, project finance, cfo, director financiero, asset management |
| Colocacion Inversores | portfolio manager, fund manager, cio, director de inversiones, analyst |
| Advisory / M&A | m&a, corporate finance, business development, origination |

**Como se busca:** `role.includes(pRole)` — busqueda por substring en el cargo del contacto. Esto es importante porque los cargos vienen en formatos variados: "Head of Structured Finance", "Responsable de Financiacion Estructurada", "CFO / Director Financiero".

**La logica detras:** Si una empresa tiene un "Head of Structured Finance" entre sus contactos, es muy probable que tengan operaciones de project finance. Un "Fund Manager" indica que son un inversor. Un contacto de "Business Development" en una empresa de renovables podria estar buscando comprar/vender activos.

### 4.5 Bonus por actividad reciente (max 10 puntos)

Premia a empresas con las que hay relacion activa:

| Condicion | Puntos |
|---|---|
| Ultimo contacto < 6 meses **Y** > 100 emails totales | +10 |
| Ultimo contacto < 12 meses **Y** > 50 emails totales | +5 |
| Resto | +0 |

**Razonamiento:** Una empresa con mucha interaccion reciente es mas "caliente" y por tanto mas susceptible de necesitar un producto ahora mismo. Este bonus es pequeno (max 10) para no distorsionar la clasificacion, pero suficiente para desempatar entre empresas similares.

## 5. Ejemplo completo: RIC Energy

Veamos como se calcula el score para **RIC Energy** (ric.energy) contra "Prestamo Construccion":

```
Datos de la empresa:
  Sector: "Energia"
  relType: "Potencial Prestatario"
  Context: "Contacto inicial para presentar el programa de financiacion con el FEI.
            Coordinacion de una reunion para discutir posibles proyectos de financiacion..."
  Contactos: Lourdes Barea (CFO), Julian Molina (Head of Structured Finance)
  Interacciones: 1.224 | Ultimo: hace 3 meses

Calculo:
  Keywords:
    High: "financiacion de proyecto" → +10
    Medium: "FEI" → +4
    Low: "energia" → +1
    Subtotal keywords: 15 (cap 40) → 15

  Sector: "Energia" ∈ ["Renovables", "Energia"] → +15

  RelType: "Potencial Prestatario" ∈ ["Potencial Prestatario"] → +20

  Roles:
    "chief financial officer" matches "cfo" → +5
    "head of structured finance" matches "structured finance" → +5
    Subtotal roles: 10 (cap 15) → 10

  Actividad: 1.224 emails, 3 meses → +10

  TOTAL: 15 + 15 + 20 + 10 + 10 = 70/100
```

## 6. Filtrado en el dashboard

En la UI, el filtro de producto funciona asi:
- El sidebar muestra los 4 productos con un contador de empresas que matchean
- Al hacer click en un producto, se filtran **solo las empresas con score >= 15** para ese producto
- El umbral de 15 es deliberado: una empresa que solo tiene un sector afin (15 pts) aparece, pero una que solo tiene keywords genericas (ej: 3 keywords low = 3 pts) no

## 7. Jerarquia de confianza

Los niveles de confianza de mayor a menor son:

1. **Score > 50:** Alta confianza. La empresa tiene multiples senales fuertes (keywords directas + relType + roles). Ejemplo: empresa con "term sheet" en contexto, sector Renovables, tipo Potencial Prestatario, y un CFO como contacto.

2. **Score 30-50:** Confianza media. Tiene senales claras pero no el cuadro completo. Ejemplo: sector Renovables y Potencial Prestatario, pero sin keywords directas de un producto especifico.

3. **Score 15-29:** Baja confianza. Solo senales genericas (sector coincide, o unas pocas keywords generales). Necesita validacion manual.

4. **Score < 15:** No se muestra. No hay suficientes indicios.

## 8. Limitaciones conocidas

1. **El context esta truncado a 150 caracteres.** Mucha informacion util se pierde. Por eso se anadio el campo `subjects` — los asuntos de email son mas ricos y no estan truncados.

2. **Busqueda por substring, no semantica.** "solar" matchea dentro de "consolar" (falso positivo teorico). En la practica esto casi no ocurre porque las keywords estan bien elegidas, pero no es perfecto.

3. **Sin cuerpo de email.** Solo tenemos los asuntos y un snippet de 300 chars del cuerpo. El body completo tendria informacion decisiva (ej: "adjunto term sheet", "propuesta de refinanciacion").

4. **Clasificaciones de Gemini no siempre correctas.** Los sectores y relTypes fueron asignados por IA y hay errores. Ejemplo: "Renewables Now" (medio de comunicacion) clasificado como "Renovables", o hotmail.com clasificado como "Potencial Prestatario".

5. **Los roles son estimados.** Gemini estima el cargo a partir del nombre y email, lo cual es impreciso para muchos contactos marcados como "No identificado".

## 9. Proximo paso: reclasificacion con Gemini

Para mejorar significativamente la precision, se ha creado `scripts/reclassify_products.py` que:
1. Filtra empresas candidatas (sector energia/renovables o tipo financiero)
2. Envia a Gemini un prompt con TODA la informacion disponible (context + subjects + contactos + sector + relType)
3. Pide una clasificacion **por producto especifico**, no solo por sector
4. Almacena el resultado con una razon explicativa

Esto reemplazaria el scoring por keywords con una clasificacion semantica real, aunque manteniendo el scoring como fallback para empresas nuevas que entren por el pipeline automatico.
