# Alter5 BI — Figma Make UX/UI Design Plan

> Documento completo para disenar todas las pantallas de Alter5 BI usando Figma Make (AI).
> Incluye: sistema de diseno, mejores practicas, y prompts listos para cada pantalla/componente.

---

## ARQUITECTURA DE NAVEGACION

```
LOGIN (Google OAuth — solo @alter5.com)
  |
  v
APP SHELL — 5 bloques en navegacion principal
  |
  |-- 1. EMPRESAS          Base de datos de empresas + busqueda nuevas
  |-- 2. PROSPECTS          Proceso comercial pre-term-sheet
  |-- 3. CAMPANAS           Campanas email (continuadas + puntuales)
  |-- 4. ESTRUCTURACION     Proyectos subiendo docs / term-sheet (pendiente)
  |-- 5. DISTRIBUCION       Proyectos en distribucion a inversores (pendiente)
  |
  +-- CEREBRO AI            Overlay busqueda inteligente (accesible desde cualquier vista)
```

**Bloques activos ahora:** Login, Empresas, Prospects, Campanas
**Bloques pendientes:** Estructuracion, Distribucion (se disenaran mas adelante)

---

## PARTE 1: MEJORES PRACTICAS DE FIGMA MAKE

### 1.1 Que es Figma Make

Figma Make es la herramienta de diseno AI de Figma (usa Claude Sonnet 4.5). Genera prototipos interactivos con UI real a partir de prompts de texto natural. No genera wireframes — genera disenos completos con componentes reales.

### 1.2 Frameworks de Prompting

#### Framework TC-EBC (Oficial de Figma)

El framework recomendado por Figma tiene 5 dimensiones:

| Dimension | Que incluir | Ejemplo |
|-----------|------------|---------|
| **Task** | Que quieres que haga | "Disena una tabla de empresas con filtros laterales" |
| **Context** | Proposito, usuario, industria | "Para un equipo de deal origination en fintech de renovables" |
| **Elements** | Componentes concretos | "Sidebar con checkboxes, tabla con columnas sortables, badges de estado" |
| **Behavior** | Interacciones y estados | "Los filtros actualizan la tabla en tiempo real, filas con hover highlight" |
| **Constraints** | Limites y reglas | "Max 280px sidebar, font DM Sans, colores azul #3B82F6 y verde #10B981" |

#### Framework Five Areas (Alternativo)

| Area | Detalle |
|------|---------|
| **Context** | Quien lo usa, para que sirve |
| **Description** | Que es la pantalla/componente |
| **Platform** | Web desktop 1440px, responsive |
| **Visual Style** | Tokens de diseno, tipografia, paleta |
| **UI Components** | Lista especifica de elementos |

### 1.3 Los 8 Tips de Figma Make

1. **Front-load el detalle** — Pon la informacion mas importante al inicio del prompt. Figma Make prioriza las primeras lineas.

2. **Divide en prompts pequenos** — No intentes generar una app completa en un prompt. Hazlo pantalla por pantalla, o incluso componente por componente.

3. **Asigna un rol/persona** — Empieza con "Eres un disenador senior de dashboards B2B SaaS" para anclar el nivel de calidad.

4. **Prepara el archivo Figma** — Ten frames, grids y componentes base antes de usar Make. Funciona mejor sobre estructura existente.

5. **Entiende el modelo** — Figma Make genera UI funcional, no wireframes. Pide niveles de fidelidad altos.

6. **Se claro, intencional e iterativo** — Un prompt imperfecto + iteracion > un prompt "perfecto". Usa follow-ups para refinar.

7. **Ajusta sizing con follow-ups** — Si algo sale muy grande/pequeno, usa "Reduce el padding a 8px" o "Haz la sidebar 260px".

8. **Pega referencias visuales** — Puedes pegar screenshots como contexto. Usa capturas del dashboard actual como referencia.

### 1.4 Estrategia de Trabajo Recomendada

```
Paso 1: Crear frame 1440x900 en Figma
Paso 2: Pegar screenshot actual como referencia (si existe)
Paso 3: Usar prompt de "Contexto Global" (seccion 2.6)
Paso 4: Usar prompt especifico de pantalla (seccion 3.x)
Paso 5: Iterar con follow-ups de ajuste (tipografia, spacing, colores)
Paso 6: Exportar componentes a libreria compartida
```

---

## PARTE 2: SISTEMA DE DISENO ALTER5

### 2.1 Design Tokens

#### Colores Primarios

| Token | Hex | Uso |
|-------|-----|-----|
| `blue` | `#3B82F6` | Accion principal, Debt, links, sorting activo, Empresas |
| `blue-light` | `#60A5FA` | Hover azul, acentos secundarios |
| `blue-bg` | `#EFF6FF` | Background seleccion azul |
| `emerald` | `#10B981` | Exito, Equity, energia, status activo |
| `emerald-light` | `#34D399` | Hover verde |
| `emerald-bg` | `#ECFDF5` | Background seleccion verde |
| `amber` | `#F59E0B` | Warning, status dormant, Originacion |
| `amber-bg` | `#FFFBEB` | Background warning |
| `red` | `#EF4444` | Error, danger, status lost |
| `red-bg` | `#FEF2F2` | Background error |
| `purple` | `#8B5CF6` | Prospects, identidad morada |
| `orange` | `#F97316` | Campanas, identidad naranja |

#### Colores de Superficie

| Token | Hex | Uso |
|-------|-----|-----|
| `light-bg` | `#F7F9FC` | Background general de la app |
| `white` | `#FFFFFF` | Cards, paneles, inputs |
| `border` | `#E2E8F0` | Bordes generales |
| `border-light` | `#F1F5F9` | Separadores sutiles entre filas |

#### Colores Navy (Dark UI — Paneles de detalle)

| Token | Hex | Uso |
|-------|-----|-----|
| `navy-dark` | `#0A1628` | Background panel oscuro |
| `navy-mid` | `#132238` | Secciones dentro de panel oscuro |
| `navy-primary` | `#1B3A5C` | Bordes en modo oscuro |

#### Colores de Texto

| Token | Hex | Uso |
|-------|-----|-----|
| `title` | `#1A2B3D` | Titulos, texto principal |
| `text` | `#334155` | Texto cuerpo |
| `muted` | `#6B7F94` | Texto secundario, placeholders |
| `dim` | `#94A3B8` | Texto muy sutil, deshabilitado |
| `disabled` | `#CBD5E1` | Iconos inactivos |

#### Gradientes

| Nombre | CSS | Uso |
|--------|-----|-----|
| `primary` | `linear-gradient(135deg, #3B82F6, #10B981)` | Botones principales genericos |
| `prospects` | `linear-gradient(135deg, #8B5CF6, #3B82F6)` | Identidad Prospects |
| `campaigns` | `linear-gradient(135deg, #F97316, #F59E0B)` | Identidad Campanas |
| `score-high` | `linear-gradient(90deg, #3B82F6, #10B981)` | Quality score alto (>65) |
| `row-hover` | `linear-gradient(90deg, #F8FAFC, #F1F5F9)` | Hover en filas de tabla |

#### Identidad Visual por Bloque

| Bloque | Color primario | Gradiente | Icono sugerido |
|--------|---------------|-----------|----------------|
| Empresas | `#3B82F6` (azul) | — | Building/Database |
| Prospects | `#8B5CF6` (morado) | `#8B5CF6 -> #3B82F6` | UserPlus/Handshake |
| Campanas | `#F97316` (naranja) | `#F97316 -> #F59E0B` | Send/Megaphone |
| Estructuracion | `#10B981` (verde) | `#10B981 -> #3B82F6` | FileText/Calculator |
| Distribucion | `#06B6D4` (cyan) | `#06B6D4 -> #3B82F6` | Share/Users |

#### Colores por Rol de Empresa

| Rol | Color | Background |
|-----|-------|------------|
| Originacion | `#F59E0B` | `#F59E0B15` |
| Inversion | `#3B82F6` | `#3B82F615` |
| Ecosistema | `#6B7F94` | `#6B7F9415` |
| No relevante | `#94A3B8` | `#94A3B815` |

### 2.2 Tipografia

| Rol | Font | Size | Weight | Extras |
|-----|------|------|--------|--------|
| H1 (titulo dashboard) | DM Sans | 26px | 800 | letter-spacing -1px |
| H2 (titulo seccion) | DM Sans | 20px | 800 | letter-spacing -0.5px |
| H3 (subtitulo) | DM Sans | 16px | 700 | — |
| Body | DM Sans | 14px | 400 | line-height 1.6 |
| Body bold | DM Sans | 14px | 600 | — |
| Label (filtros) | DM Sans | 10px | 700 | uppercase, letter-spacing 2.5px |
| Table header | DM Sans | 13px | 600-700 | uppercase, letter-spacing 0.5px |
| Table cell | DM Sans | 11-13px | 400-600 | — |
| Badge | DM Sans | 9-11px | 500-700 | — |
| Button | DM Sans | 12-13px | 600-700 | — |
| Caption | DM Sans | 11px | 400 | color muted |

**Font family completa:** `'DM Sans', system-ui, -apple-system, sans-serif`

### 2.3 Espaciado y Sizing

| Escala | Valores |
|--------|---------|
| xs | 2-3px |
| sm | 4-6px |
| md | 8-12px |
| lg | 14-16px |
| xl | 20-24px |
| 2xl | 28-32px |

**Border Radius:**

| Uso | Valor |
|-----|-------|
| Badges, chips | 4px |
| Buttons, inputs | 6-8px |
| Cards, paneles | 8-10px |
| Modales | 12px |
| Pills, tags | 20px o 999px |

**Shadows:**

| Nivel | Valor |
|-------|-------|
| Light | `0 2px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)` |
| Medium | `0 8px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(59,130,246,0.3)` |
| Panel | `-12px 0 40px rgba(10,22,40,0.4)` |
| Modal | `0 20px 60px rgba(0,0,0,0.6)` |
| Toast | `0 8px 24px rgba(0,0,0,0.2)` |

**Anchos fijos:**

| Componente | Ancho |
|------------|-------|
| Sidebar filtros | 280px |
| Detail Panel | 720px |
| Kanban column | 280px (min y max) |
| Search input | 260px |
| Modal dialog | max 480px (90% mobile) |
| Toast | max 400px |

### 2.4 Animaciones

| Nombre | Uso | Duracion |
|--------|-----|----------|
| fadeIn | Entrada general (Y +6px) | 0.25s ease |
| slideIn | Entrada lateral (X +16px) | 0.2s ease |
| slideInUp | Toast desde abajo (Y +20px) | 0.3s ease-out |
| dialogFadeIn | Modal centrado (Y -48% -> -50%) | 0.2s ease-out |

**Transiciones:**
- Rapida: `0.12s ease` (hover, colores)
- Normal: `0.15s ease` (focus, borders)
- Suave: `0.2s ease` (transforms, paneles)
- Lenta: `0.25s ease` (entradas complejas)

### 2.5 Iconografia

- **Libreria**: SVG inline personalizados (estilo Lucide React)
- **Tamanos**: 12px (micro), 14px (small), 16px (standard), 20px (large)
- **Stroke width**: 2-2.5
- **Color**: heredado del padre o especificado directamente
- **Iconos principales**: Search, ChevronDown/Up/Right, User, MessageSquare, Check, X, Filter, Plus, Trash, Edit, ExternalLink, Mail, Phone, Calendar, Star, Eye, EyeOff, Send, Megaphone, Building, FileText, Share

### 2.6 Contexto Global (prefijo para todos los prompts)

> **Copia este bloque al inicio de cada prompt de Figma Make:**

```
CONTEXTO GLOBAL — ALTER5 BI

Eres un disenador senior especializado en dashboards B2B SaaS para fintech.
Estas disenando Alter5 BI, un dashboard de inteligencia comercial para una empresa
espanola de financiacion de proyectos de energias renovables.

USUARIOS: Equipo de deal origination (6-8 personas), perfil financiero-comercial.
PLATAFORMA: Web desktop, 1440x900 viewport minimo. No mobile.
IDIOMA UI: Espanol.

NAVEGACION: 5 bloques principales — Empresas (azul), Prospects (morado),
Campanas (naranja), Estructuracion (verde), Distribucion (cyan).
Mas un overlay global: Cerebro AI (busqueda inteligente).

DESIGN SYSTEM:
- Font: DM Sans (weights 400, 500, 600, 700, 800)
- Background general: #F7F9FC
- Cards/paneles: #FFFFFF con border #E2E8F0, border-radius 8-10px
- Azul primario: #3B82F6 (acciones, links, Empresas)
- Verde: #10B981 (exito, Equity, energia)
- Morado: #8B5CF6 (Prospects)
- Naranja: #F97316 (Campanas)
- Amber: #F59E0B (warnings, dormant)
- Rojo: #EF4444 (errores, danger)
- Texto principal: #1A2B3D
- Texto secundario: #6B7F94
- Border radius: 4px badges, 6-8px botones/inputs, 10px cards, 12px modales
- Shadows: sutiles (0 2px 4px rgba(0,0,0,0.06))
- Gradiente prospects: linear-gradient(135deg, #8B5CF6, #3B82F6)
- Gradiente campanas: linear-gradient(135deg, #F97316, #F59E0B)
- Transiciones: 0.15s ease
- Scrollbar: 5px, thumb #E2E8F0, thumb:hover #6B7F94
- Estilo: limpio, profesional, data-dense. Sin ornamentos innecesarios.
```

---

## PARTE 3: PROMPTS POR PANTALLA

Cada prompt esta en formato TC-EBC. Copia el **Contexto Global** (seccion 2.6) antes de cada uno.

---

### 3.0 Login — Google OAuth

```
TASK: Disena la pantalla de login de Alter5 BI. Solo se permite acceso via Google
OAuth para usuarios con dominio @alter5.com.

CONTEXT: Es la primera pantalla que ve cualquier usuario. Debe transmitir profesionalidad,
confianza y la identidad de marca de Alter5. La autenticacion es exclusivamente via Google
(no hay formulario de email/password). Solo empleados de Alter5 pueden entrar.

ELEMENTS:

LAYOUT:
- Pantalla completa 1440x900, dividida en 2 mitades:
  - MITAD IZQUIERDA (60%): area visual / branding
  - MITAD DERECHA (40%): area de login

MITAD IZQUIERDA — BRANDING:
- Background: gradiente diagonal desde #0A1628 (top-left) a #1B3A5C (bottom-right)
- Logo "Alter5" grande: font DM Sans, 48px, weight 800, color #FFFFFF
  - Posicionado en el tercio superior
- Subtitulo: "Business Intelligence" en 20px, weight 400, color #94A3B8
  - Debajo del logo con margin-top 8px
- Elemento decorativo sutil: lineas o formas geometricas abstractas en #1B3A5C
  con opacidad baja (0.15) — representando energia renovable (sol, viento)
- Frase inspiracional en la mitad inferior:
  "Inteligencia comercial para financiacion de renovables"
  - Font: 16px, weight 500, color #60A5FA, max-width 400px, line-height 1.6
- 3 metricas sutiles en la parte inferior (en fila):
  - "3,943 empresas" | "114 deals activos" | "7 buzones monitorizados"
  - Font: 11px, color #6B7F94, letter-spacing 0.5px

MITAD DERECHA — LOGIN:
- Background: #FFFFFF
- Centrado vertical y horizontal
- Contenido con max-width 360px:
  - Icono o mini-logo: circulo 56px, bg #F7F9FC, border 1px solid #E2E8F0
    con icono de candado o escudo en #3B82F6, 24px
  - Titulo: "Accede a tu cuenta" — 24px, weight 800, color #1A2B3D, margin-top 24px
  - Subtitulo: "Solo para el equipo Alter5" — 14px, color #6B7F94, margin-top 8px

  - BOTON GOOGLE (el unico CTA):
    - Margin-top: 32px
    - Width: 100%
    - Padding: 12px 20px
    - Background: #FFFFFF
    - Border: 1px solid #E2E8F0
    - Border-radius: 8px
    - Shadow: 0 1px 3px rgba(0,0,0,0.08)
    - Display: flex, align-items center, justify-content center, gap 12px
    - Icono Google "G" multicolor: 20px (el SVG oficial de Google)
    - Texto: "Continuar con Google" — 14px, weight 600, color #334155
    - Hover: shadow 0 4px 8px rgba(0,0,0,0.12), border-color #94A3B8
    - Active: bg #F7F9FC
    - Transition: all 0.15s ease

  - Nota de seguridad debajo del boton:
    - Margin-top: 16px
    - Icono candado 12px + texto
    - "Solo cuentas @alter5.com autorizadas"
    - Font: 12px, color #94A3B8
    - Display: flex, align-items center, gap 6px

  - Footer mini:
    - Position: absolute bottom 24px (del area derecha)
    - "Alter5 Capital S.L. · 2026"
    - Font: 11px, color #CBD5E1

BEHAVIOR:
- Click en boton Google: inicia flujo OAuth
- Si el dominio del email no es @alter5.com: mostrar error inline
  - Mensaje: "Solo cuentas @alter5.com pueden acceder"
  - Color: #EF4444, font 13px, con icono warning
  - Aparece debajo del boton con fadeIn 0.25s
- Mientras carga la autenticacion: boton muestra spinner (sustituye icono Google)
  - Texto cambia a "Conectando..."
  - Opacity del boton: 0.7
  - Cursor: not-allowed
- Al autenticarse correctamente: redirige al App Shell (vista Empresas por defecto)

CONSTRAINTS:
- Viewport: 1440x900
- Font: DM Sans
- Sin formulario de email/password — SOLO boton Google OAuth
- Sin opcion de registro — solo login
- Sin link de "olvidaste tu contrasena"
- El boton de Google debe seguir las guidelines de branding de Google
  (fondo blanco, icono multicolor, texto neutro)
- Responsive: en pantallas < 1024px, la mitad izquierda se oculta y
  el login ocupa toda la pantalla sobre fondo #F7F9FC
```

---

### 3.1 Layout Principal (App Shell)

```
TASK: Disena el layout principal de la aplicacion Alter5 BI con navegacion de 5 bloques.

CONTEXT: Es un dashboard de inteligencia comercial con 5 bloques principales.
El usuario navega entre bloques con tabs/pestanas en la cabecera superior.
Dos de los bloques (Estructuracion y Distribucion) estan en estado "Coming Soon".

ELEMENTS:
- Header bar fijo en la parte superior:
  - Logo "Alter5" a la izquierda (texto, font-weight 800, 18px, color #1A2B3D)
  - Subtitulo "BI" en #6B7F94 al lado del logo
  - 5 tabs de navegacion centrados con iconos + texto:
    1. Icono Building + "Empresas" — acento azul #3B82F6
    2. Icono UserPlus + "Prospects" — acento morado #8B5CF6
    3. Icono Send + "Campanas" — acento naranja #F97316
    4. Icono FileText + "Estructuracion" — acento verde #10B981 + badge "Soon"
    5. Icono Share + "Distribucion" — acento cyan #06B6D4 + badge "Soon"
  - Tab activo: color del acento, border-bottom 3px solid acento, font-weight 700
  - Tab inactivo: color #6B7F94, font-weight 500
  - Tabs "Soon": opacity 0.5, cursor default, badge "Pronto" en 8px, bg #F1F5F9
  - A la derecha del header:
    - Boton Cerebro AI: icono sparkle/brain 16px, color #8B5CF6, circulo 36px,
      bg #F7F9FC, border 1px solid #E2E8F0, hover bg #8B5CF610
    - Avatar usuario: 32px circulo con foto de Google o iniciales
    - Nombre corto: 12px, color #6B7F94
    - Dropdown al click: "Cerrar sesion"
- Debajo del header: contenido de la vista activa (ocupa todo el viewport restante)
- Fondo general: #F7F9FC
- Header: background #FFFFFF, border-bottom 1px solid #E2E8F0, height 56px
- Padding horizontal header: 24px

BEHAVIOR:
- Click en tab activo recarga la vista
- Click en tab "Soon" no hace nada (disabled)
- Click en tab normal cambia la vista con transicion fadeIn 0.25s
- Click en boton Cerebro AI abre overlay de busqueda inteligente
- Click en avatar abre dropdown minimal con "Cerrar sesion"
- Tab "Prospects" tiene badge morado con contador de leads activos
- Tab "Campanas" tiene badge naranja con contador de campanas activas

CONSTRAINTS:
- Viewport: 1440x900
- Font: DM Sans
- Sin hamburger menu — siempre visible
- Z-index header: 50
- Los 5 tabs deben caber en el header sin scroll
  (iconos 14px + texto 12px, espaciado compacto)
```

---

### 3.2 Bloque 1: Empresas — Tabla + Sidebar

```
TASK: Disena la vista "Empresas" — una tabla CRM con sidebar de filtros a la izquierda.

CONTEXT: Esta vista muestra ~3,943 empresas del sector renovable. El equipo de
origination la usa para buscar, filtrar y analizar empresas potenciales. Es la
vista principal y mas usada de la aplicacion. Identidad azul (#3B82F6).

ELEMENTS:

SIDEBAR (izquierda, 280px):
- Background: #FFFFFF, border-right 1px solid #E2E8F0
- Padding: 16px
- Seccion "BUSCAR": input de texto con icono lupa, placeholder "Buscar empresa..."
  - Input: border 1px solid #E2E8F0, border-radius 8px, padding 8px 14px, font 13px
  - Icono lupa: 14px, color #94A3B8, posicion absoluta izquierda
- Seccion "ESTADO" (label 10px uppercase #6B7F94, letter-spacing 2.5px):
  - 3 chips filtro: "Activo" (verde), "Dormant" (amber), "Lost" (rojo)
  - Chip activo: background color+10%, border 1px solid color, font-weight 600
  - Chip inactivo: background transparent, color #6B7F94
- Seccion "ROL":
  - 4 chips: "Originacion", "Inversion", "Ecosistema", "No relevante"
  - Misma logica de chips activos/inactivos
- Seccion "TIPO DE EMPRESA":
  - Lista con checkboxes: Desarrollador, IPP, Utility, Fondo infra, Fondo deuda,
    Banco, EPC, Asesor tecnico, Asesor financiero, Fabricante, Trading, Oil & Gas
  - Checkbox: accent-color #3B82F6, 15px
  - Label: 13px, color #334155
- Seccion "EMPLEADO" (tabs por persona):
  - 8 tabs horizontales scrollables: Salvador, Leticia, Javier, Miguel, Carlos,
    Gonzalo, Rafael, Todos
  - Tab activo: background #3B82F6, color white, border-radius 4px
  - Tab inactivo: color #6B7F94
- Boton "Limpiar filtros": ghost button, font 12px, color #6B7F94

TABLA (derecha, ocupa resto del ancho):
- Header: background #FFFFFF, padding 16px 12px
- Columnas: Empresa (principal), Grupo, Tipo, Rol, Interacciones, Ultima fecha,
  Score, Estado
- Header text: 13px uppercase, letter-spacing 0.5px, color #6B7F94, weight 600
- Header sortable: cursor pointer, click alterna ASC/DESC
- Header activo: color #3B82F6, border-bottom 3px solid #3B82F6, font-weight 700
  background linear-gradient(180deg, rgba(59,130,246,0.05), rgba(59,130,246,0.02))
- Iconos sort: triangulo arriba/abajo, 12px, color #CBD5E1 inactivo / #3B82F6 activo
- Filas de datos:
  - Padding: 10px
  - Border-bottom: 1px solid #F1F5F9
  - Border-left: 4px solid transparent
  - Background: #FFFFFF
  - Hover: background gradient(90deg, #F8FAFC, #F1F5F9), border-left 3px solid #3B82F6,
    transform translateX(2px), shadow 0 2px 4px rgba(0,0,0,0.04)
  - Seleccionada: background rgba(59,130,246,0.08), border-left 4px solid #3B82F6
- Columna "Empresa": font-weight 600, 13px, color #1A2B3D, con dot de quality a la izq
  - Quality dot: 8px circulo, verde(>65)/amber(35-65)/rojo(<35)
- Columna "Rol": badge con color del rol + dot 5px
  - Padding 2px 8px, border-radius 4px, font 11px weight 600
- Columna "Score": chip cuadrado 34x34px, border-radius 8px
  - Score >65: background gradient azul-verde, color blanco, weight 800
  - Score 35-65: background #3B82F6, color blanco
  - Score <35: background #F1F5F9, color #6B7F94
- Columna "Estado": badge con dot + texto
  - Activo: dot verde, texto "Activo", bg #ECFDF5
  - Dormant: dot amber, bg #FFFBEB
  - Lost: dot rojo, bg #FEF2F2

AREA SUPERIOR (entre header y tabla):
- Fila de KPI cards (4 cards horizontales):
  - Card: bg #FFFFFF, border-radius 10px, padding 16px 18px, border 1px solid #E2E8F0
  - Card activa (seleccionada como filtro): border 2px solid accent, bg accent+10%
  - Label: 10px uppercase, letter-spacing 2.5px, color #6B7F94, weight 700
  - Valor: 28px weight 800, letter-spacing -1.5px, color #1A2B3D
  - Sub-texto: 11px, color #6B7F94
  - KPIs: "Total empresas", "Originacion", "Inversion", "Score medio"
- Barra de busqueda global + contador de resultados
  - "Mostrando 1,247 de 3,943 empresas" — font 13px, color #6B7F94

BEHAVIOR:
- Click en fila abre DetailPanel (slide-in derecho)
- Filtros de sidebar actualizan tabla en tiempo real
- Sort por cualquier columna con indicador visual
- Scroll vertical infinito en tabla
- KPI cards clickeables como filtros rapidos
- Seleccion masiva con checkboxes para acciones bulk (ocultar, exportar)

CONSTRAINTS:
- Sidebar: exactamente 280px, no colapsable
- Tabla: scroll vertical, header sticky
- Rows: altura consistente, sin variacion
- Densidad: data-dense, optimizada para escaneo rapido
- Max visible sin scroll: ~15-20 filas
```

---

### 3.3 Detail Panel — Panel de Detalle de Empresa

```
TASK: Disena un slide-in panel de detalle de empresa que aparece desde la derecha.

CONTEXT: Cuando el usuario hace click en una fila de la tabla de Empresas, este panel se
desliza desde la derecha mostrando toda la informacion de la empresa. Usa tema
oscuro (navy) para diferenciar del fondo claro. Tiene tabs internas.

ELEMENTS:

OVERLAY:
- Backdrop: rgba(10,22,40,0.35), click cierra el panel
- Panel: posicion fixed, right 0, top 0, bottom 0
- Ancho: 720px, max-width 100vw
- Background: #0A1628 (navy oscuro)
- Box-shadow: -12px 0 40px rgba(10,22,40,0.4)
- Animacion: slideIn desde derecha 0.2s ease
- Z-index: 100

HEADER DEL PANEL:
- Padding: 24px 28px
- Nombre empresa: 20px, weight 800, color #FFFFFF
- Dominio: 13px, color #60A5FA, con icono external-link
- Fila de badges debajo: Tipo empresa, Rol, Estado
  - Badge oscuro: bg #132238, border 1px solid #1B3A5C, color #94A3B8
  - Dot de color correspondiente dentro del badge
- Boton cerrar (X): posicion absoluta top-right, 24x24px, color #94A3B8
  hover color #FFFFFF

TABS (debajo del header):
- 4 tabs: "Resumen", "Contactos", "Timeline", "Verificacion"
- Tab activo: color #FFFFFF, border-bottom 2px solid #3B82F6
- Tab inactivo: color #6B7F94
- Font: 13px, weight 600
- Padding tab: 10px 16px
- Border-bottom de la barra de tabs: 1px solid #1B3A5C

TAB "RESUMEN":
- Seccion "Clasificacion AI":
  - Card oscura: bg #132238, border 1px solid #1B3A5C, border-radius 8px, padding 16px
  - Labels: 10px uppercase #6B7F94
  - Valores: 13px, color #FFFFFF
  - Campos: Grupo, Tipo, Fase, Subtipo
  - Indicador de confianza: barra de progreso lineal (gradiente azul-verde)
- Seccion "Productos detectados":
  - Lista de pills/tags: bg #132238, border 1px solid #1B3A5C, border-radius 20px
  - Texto: 11px, color #94A3B8
- Seccion "Senales":
  - Lista de items con bullet dots de colores
  - Texto: 13px, color #94A3B8
- Seccion "Contexto":
  - Bloque de texto: 13px, color #94A3B8, line-height 1.6
  - Background: #132238, padding 12px, border-radius 6px
- Seccion "Market Roles":
  - Tags: similar a productos pero con colores por rol

TAB "CONTACTOS":
- Lista de contactos, cada uno con:
  - Nombre: 14px, weight 600, color #FFFFFF
  - Email: 13px, color #60A5FA
  - Rol inferido: badge con color (CEO, CTO, Director, etc.)
  - Icono telefono/email para acciones rapidas
- Card por contacto: bg #132238, border 1px solid #1B3A5C, padding 12px, border-radius 8px
- Separacion entre cards: 8px

TAB "TIMELINE":
- Lista cronologica de interacciones (emails)
- Cada entrada:
  - Fecha: 11px, color #6B7F94, weight 600
  - Subject del email: 13px, color #FFFFFF
  - Snippet: 12px, color #94A3B8, max 2 lineas, overflow ellipsis
  - Badge de buzon (remitente): font 9px, bg color del empleado
- Linea temporal vertical: 2px solid #1B3A5C, con dots en cada nodo
- Nodo: 8px circulo, border 2px solid #3B82F6, bg #0A1628

TAB "VERIFICACION":
- Estado verificacion: badge grande
  - Verified: verde #10B981, icono check
  - Pending Review: amber #F59E0B
  - Edited: morado #8B5CF6
  - No verificado: gris
- Campos de clasificacion comparados:
  - Izquierda: "Clasificacion actual" (del email pipeline)
  - Derecha: "Verificacion web" (del agente AI)
  - Highlight rojo si hay mismatch
- Descripcion web: bloque texto #94A3B8
- Fuentes web: lista de URLs clicables
- Boton "Aplicar verificacion": gradiente primario

BEHAVIOR:
- Click en tab cambia contenido con fade 0.15s
- Scroll interno dentro del panel
- Click fuera del panel (en backdrop) lo cierra
- ESC key cierra el panel
- Datos editables inline en tab Resumen (tipo, rol, etc.)

CONSTRAINTS:
- Ancho fijo 720px
- Toda la tipografia DM Sans
- Tema navy oscuro para todo el panel
- Contraste minimo WCAG AA para textos sobre fondo oscuro
- Scroll: customizado (5px, thumb #1B3A5C)
```

---

### 3.4 Bloque 2: Prospects — Kanban Board

```
TASK: Disena un tablero Kanban de 5 columnas para gestionar prospects comerciales.

CONTEXT: Los Prospects son empresas con las que Alter5 esta iniciando conversaciones
comerciales para conseguir que firmen un term sheet de financiacion o equity. Se
mueven por 5 etapas. Esta vista tiene identidad morada (#8B5CF6).

ELEMENTS:

HEADER DE VISTA:
- Titulo: "Prospects" con icono UserPlus y badge gradiente morado (#8B5CF6 -> #3B82F6)
- Subtitulo: "Seguimiento de conversaciones comerciales" en #6B7F94
- Boton "+ Nuevo Prospect": gradiente morado-azul, color blanco, border-radius 8px,
  padding 8px 16px, font 13px weight 700
- Barra de busqueda: input con lupa, 260px
- Contador: "12 prospects activos"
- Filtros rapidos: chips por producto (Corporate Debt, Project Finance, etc.)

KANBAN BOARD:
- 5 columnas con scroll horizontal si no caben
- Gap entre columnas: 12px
- Background del board: #F7F9FC

COLUMNAS (cada una):
- Ancho: 280px min y max
- Background: #FFFFFF
- Border-radius: 10px
- Border-top: 3px solid color_de_etapa
- Nombres de etapas con sus colores:
  1. "Lead" — azul claro (#60A5FA) — primer contacto, interes inicial
  2. "Interesado" — azul (#3B82F6) — la empresa ha respondido con interes
  3. "Reunion" — morado (#8B5CF6) — reunion programada o realizada
  4. "Doc. Pendiente" — amber (#F59E0B) — esperando documentacion
  5. "Term-Sheet" — verde (#10B981) — listo para enviar/recibir term sheet
- Header columna:
  - Padding: 14px 16px
  - Border-bottom: 1px solid #E2E8F0
  - Titulo: 12px uppercase, letter-spacing 0.5px, color #334155, weight 600
  - Badge contador: min-width 22px, height 22px, bg #F1F5F9, border-radius 11px,
    font 11px weight 700, color #475569

PROSPECT CARDS (dentro de cada columna):
- Padding: 12px
- Background: #FFFFFF
- Border-radius: 8px
- Border-left: 3px solid color_de_etapa
- Margin: 8px 12px
- Cursor: grab (drag)
- Transition: all 0.2s ease
- Hover: translateY(-2px), shadow 0 8px 16px rgba(0,0,0,0.12)
- Contenido de la card:
  - Nombre empresa: 13px, weight 600, color #1A2B3D
  - Tipo de producto: badge 9px, bg morado claro, color morado
    (Corporate Debt, Project Finance, Development Debt, Investment, etc.)
  - Tamano estimado: "€12M" en 12px weight 700 color #1A2B3D (si disponible)
  - Contacto principal: 12px, color #6B7F94, con icono persona 12px
  - Fecha ultima actualizacion: 11px, color #94A3B8
  - Si tiene notas: icono mensaje 12px, color #94A3B8
  - Si tiene tareas pendientes: badge con conteo, bg #FEF2F2 color #EF4444

BEHAVIOR:
- Drag & drop de cards entre columnas
- Columna destino se ilumina al hacer hover con card arrastrada:
  - Background: linear-gradient(to bottom, color_bg, #FFFFFF)
  - Border-top: 3px -> 4px
  - Shadow: 0 0 0 2px color40%, 0 8px 16px rgba(0,0,0,0.08)
- Click en card abre ProspectPanel (slide-in derecho)
- Etapa 5 "Term-Sheet": cards con boton "Convertir a Estructuracion" verde
  (de momento disabled con tooltip "Proximamente")

CONSTRAINTS:
- Las 5 columnas deben ser visibles simultaneamente en 1440px
- Cards con altura variable segun contenido
- Scroll vertical dentro de cada columna si hay muchas cards
- Identidad visual morada — NO usar naranja ni azul-verde aqui
```

---

### 3.5 Prospect Panel — CRUD Slide-in

```
TASK: Disena un panel slide-in para crear/editar un Prospect individual.

CONTEXT: Se abre al crear un nuevo prospect o al hacer click en una card del
Kanban. Permite editar todos los campos del prospect. Tema claro (blanco).

ELEMENTS:

PANEL:
- Posicion: fixed, right 0, top 0, bottom 0
- Ancho: 640px
- Background: #FFFFFF
- Border-left: 1px solid #E2E8F0
- Box-shadow: -8px 0 30px rgba(0,0,0,0.12)
- Z-index: 100
- Animacion: slideIn 0.2s ease

HEADER:
- Padding: 20px 24px
- Border-bottom: 1px solid #E2E8F0
- Titulo: "Nuevo Prospect" o nombre empresa (18px, weight 700, #1A2B3D)
- Boton cerrar X: 24x24, color #94A3B8, hover #1A2B3D
- Badge de etapa actual: con color correspondiente

FORMULARIO (scrollable):
- Padding: 24px
- Cada campo:
  - Label: 10px uppercase, letter-spacing 2.5px, color #6B7F94, weight 700, margin-bottom 6px
  - Input: width 100%, padding 8px 14px, border 1px solid #E2E8F0, border-radius 8px,
    font 13px, transition all 0.15s, focus: border-color #8B5CF6, shadow 0 0 0 3px #8B5CF615
  - Spacing entre campos: 16px

CAMPOS:
- "Empresa" — text input (requerido)
- "Dominio" — text input con validacion URL
- "Producto" — select dropdown con opciones:
  Corporate Debt, Project Finance, Development Debt, PF Guaranteed,
  Investment, Co-Development, M&A
- "Etapa" — select con 5 etapas del kanban
- "Tamano estimado" — text input con sufijo "M EUR"
- "Contactos" — seccion multi-contacto:
  - Cada contacto: 3 inputs en fila (Nombre, Email, Rol)
  - Boton "+ Anadir contacto": ghost button, icono plus
  - Boton "x" para eliminar contacto
- "Notas" — textarea, min-height 100px, resize vertical
- "Tareas" — lista de checkboxes con texto editable
  - Checkbox: accent-color #8B5CF6
  - Tarea completada: line-through, color #94A3B8
  - Boton "+ Nueva tarea": ghost button

SECCION AI (si hay notas de reunion):
- Separador con label "Herramientas AI" y icono sparkle #8B5CF6
- Boton "Resumir notas": gradiente morado, icono sparkle
- Boton "Extraer tareas": outline morado
- Resultado AI aparece en card con bg #F7F9FC, border 1px solid #E2E8F0

FOOTER (fijo abajo):
- Padding: 16px 24px
- Border-top: 1px solid #E2E8F0
- Background: #FFFFFF
- Botones:
  - "Guardar": gradiente morado-azul, color blanco, padding 8px 20px, weight 700
  - "Cancelar": ghost button, color #6B7F94
  - Si es edit: "Eliminar" a la izquierda, color #EF4444, weight 600

BEHAVIOR:
- Campos con validacion en blur (borde rojo si invalido)
- Cambios sin guardar: mostrar dot indicador en boton Guardar
- Selects con dropdown nativo del navegador
- Contactos: minimo 1, maximo 10

CONSTRAINTS:
- Tema CLARO (blanco) — no navy oscuro
- Identidad morada para botones principales y focus states
- Scroll interno en el formulario, footer siempre visible
```

---

### 3.6 Bloque 3: Campanas — Dashboard + Gestion

```
TASK: Disena la vista "Campanas" — un dashboard para gestionar campanas de email
marketing, tanto continuadas como puntuales.

CONTEXT: Alter5 ejecuta campanas de outbound para captar empresas del sector
renovable. Hay dos tipos:
- CONTINUADAS: campanas siempre activas con triggers automaticos (ej: nueva empresa
  detectada con perfil de Bridge Debt, se anade automaticamente)
- PUNTUALES: campanas de una sola vez (ej: Bridge Debt Energy Q1 Wave 2)
Identidad naranja (#F97316).

ELEMENTS:

HEADER DE VISTA:
- Titulo: "Campanas" con icono Send y gradiente naranja (#F97316 -> #F59E0B)
- Subtitulo: "Outbound y comunicaciones comerciales" en #6B7F94
- Boton "+ Nueva Campana": gradiente naranja, color blanco, border-radius 8px
- Filtros: chips "Todas", "Activas", "Pausadas", "Finalizadas"

AREA KPI (4 cards):
- Card 1: "CAMPANAS ACTIVAS" — valor "3" — accent naranja
- Card 2: "EMAILS ENVIADOS" — valor "1,247" — subtexto "este mes"
- Card 3: "TASA APERTURA" — valor "34%" — accent verde si >25%, rojo si <15%
- Card 4: "RESPUESTAS" — valor "89" — subtexto "este mes"
- Mismo estilo KPI cards que Empresas (10px label, 28px valor, etc.)

LISTA DE CAMPANAS (tabla/cards hibrida):
- Cada campana es una card grande (full-width):
  - Padding: 20px
  - Background: #FFFFFF
  - Border-radius: 10px
  - Border: 1px solid #E2E8F0
  - Border-left: 4px solid color_de_estado
  - Margin-bottom: 12px

  Layout interno de la card (2 filas):
  FILA 1 — Info principal:
  - Nombre campana: 16px weight 700, color #1A2B3D
    Ej: "Bridge Debt Energy — Q1 2026"
  - Badge tipo: "Continuada" (bg #F9731615, color #F97316) o
    "Puntual" (bg #3B82F615, color #3B82F6)
  - Badge estado: "Activa" (verde), "Pausada" (amber), "Finalizada" (gris),
    "Borrador" (azul claro)
  - Fecha creacion: 11px, color #94A3B8

  FILA 2 — Metricas inline:
  - "245 empresas target" | "1,200 emails enviados" | "34% apertura" |
    "12% respuesta" | "Wave 2 activa"
  - Font: 12px, color #6B7F94
  - Cada metrica con icono sutil 12px
  - Metrica destacada si es buena (color verde) o mala (color rojo)

  ACCIONES (derecha de la card):
  - Boton "Ver detalle" → abre vista de detalle de campana
  - Boton "Pausar/Reanudar" → toggle
  - Icono "..." menu contextual (editar, duplicar, eliminar)

TIPO "CONTINUADA" (indicador visual diferenciado):
- Icono de loop/refresh junto al badge "Continuada"
- Ultima ejecucion: "Hace 2h" en #6B7F94
- Triggers activos: lista de pills "Nuevo desarrollador", "Email recibido >3",
  "Score >70"

ESTADO VACIO:
- Si no hay campanas: ilustracion sutil (megafono gris)
- "No tienes campanas activas"
- Boton "Crear primera campana" gradiente naranja

BEHAVIOR:
- Click en card abre el detalle de la campana (CampaignDetailView)
- Filtros de estado filtran la lista en tiempo real
- Ordenacion por fecha, nombre, o tasa de apertura
- Drag para reordenar prioridad (opcional)

CONSTRAINTS:
- Identidad naranja (#F97316)
- Sin sidebar — layout de lista vertical full-width con padding lateral 24px
- Max 10 campanas visibles sin scroll en 900px height
- Cards con hover: shadow medium, translateY(-1px)
```

---

### 3.7 Detalle de Campana + Explorer

```
TASK: Disena la vista de detalle de una campana individual con el Explorer
integrado para seleccionar empresas candidatas.

CONTEXT: Al hacer click en una campana desde la lista, se abre esta vista
fullscreen. Tiene 3 tabs: Dashboard de metricas, Explorer de candidatos,
y Historial de envios. Identidad naranja.

ELEMENTS:

HEADER:
- Background: #FFFFFF, border-bottom 1px solid #E2E8F0
- Boton "← Volver a Campanas" con flecha izquierda, color #6B7F94
- Nombre campana: 20px weight 800, color #1A2B3D
  Ej: "Bridge Debt Energy — Q1 2026 — Wave 2"
- Badges: tipo (Puntual/Continuada) + estado (Activa/Pausada) + wave actual
- Boton "Pausar campana": outline amber si activa
- Boton "Configurar triggers": ghost, icono settings (solo si Continuada)

TABS (3):
- "Dashboard" — metricas y rendimiento
- "Explorer" — seleccion de candidatos
- "Historial" — log de envios
- Tab activo: color #F97316, border-bottom 3px solid #F97316
- Tab inactivo: color #6B7F94

--- TAB "DASHBOARD" ---
- Grid 2x2 de KPI cards grandes:
  - Emails enviados, Tasa apertura, Tasa respuesta, Tasa conversion
- Grafico de barras: envios por semana (ultimas 8 semanas)
  - Barras color #F97316 con hover tooltip
- Lista "Top respondedores":
  - Top 10 empresas que respondieron, con nombre + badge status
- Lista "Pendientes de seguimiento":
  - Empresas que abrieron pero no respondieron
  - Boton "Enviar follow-up" para cada una

--- TAB "EXPLORER" (el mas complejo) ---
Panel 2 columnas como el Bridge Explorer:

COLUMNA IZQUIERDA (lista candidatas, 400px):
- Filtros: tabs "Todos", "Pendientes", "Aprobados", "Rechazados", "Enviados"
  - Tab activo: bg #F97316, color white
- Barra de busqueda
- Lista scrollable de empresa-cards:
  - Card: bg #FFFFFF, border-radius 8px, padding 12px, margin-bottom 8px
  - Border-left: 4px solid status_color
    Pendiente: #94A3B8, Aprobada: #10B981, Rechazada: #EF4444,
    Enviada: #3B82F6, Skipped: #F59E0B
  - Nombre: 13px weight 600, #1A2B3D
  - Badges: tipo + segmento
  - Score AI: circulo 28px con numero coloreado
  - Click: muestra detalle en columna derecha

COLUMNA DERECHA (detalle candidata):
- Card grande empresa seleccionada:
  - Nombre: 18px weight 700
  - Descripcion web
  - Clasificacion: badges tipo, segmento, tecnologias
  - Score AI con breakdown:
    "Relevancia: 85" | "Tamano: 70" | "Fit: 90"
  - Contactos seleccionables: checkbox + nombre + email + rol
  - Botones decision: "Aprobar" (verde), "Rechazar" (rojo outline), "Saltar" (gris)

FOOTER BAR del Explorer:
- Izquierda: "12 aprobadas, 34 contactos seleccionados"
- Derecha: "Revisar y enviar" boton gradiente naranja grande

--- TAB "HISTORIAL" ---
- Tabla de envios:
  - Columnas: Fecha, Empresa, Contacto, Email, Estado (enviado/abierto/respondido/rebotado)
  - Badge de estado coloreado
  - Paginacion: 50 por pagina
  - Filtros: por estado, por fecha

BEHAVIOR:
- Tab "Explorer": navegacion con flechas, A/R/S shortcuts
- Tab "Dashboard": graficos con hover tooltips
- Preview de email antes de envio masivo

CONSTRAINTS:
- Identidad naranja (#F97316) para tabs activos y botones principales
- Explorer: fullscreen 2 columnas, scroll virtual en lista izquierda
- Dashboard: metricas con datos reales
```

---

### 3.8 Bloques 4 y 5: Placeholder "Coming Soon"

```
TASK: Disena una pantalla placeholder "Coming Soon" para los bloques
Estructuracion y Distribucion.

CONTEXT: Estos dos bloques aun no estan desarrollados. Cuando el usuario
navega a ellos, ve una pantalla informativa con diseno de marca.

ELEMENTS:
- Centrado vertical y horizontal en el area de contenido
- Icono grande (64px): FileText para Estructuracion, Share para Distribucion
  - Color: acento del bloque (verde #10B981 o cyan #06B6D4)
  - Background: acento+05%, circulo 120px
- Titulo: "Estructuracion" o "Distribucion" — 24px weight 800, #1A2B3D
- Subtitulo descriptivo:
  - Estructuracion: "Gestion de documentacion, modelos financieros y term sheets"
  - Distribucion: "Seguimiento de distribucion a inversores y feedback"
  - Font: 14px, color #6B7F94, max-width 400px, text-align center, line-height 1.6
- Badge "PROXIMAMENTE" — 10px uppercase, letter-spacing 2px,
  bg acento+10%, color acento, padding 4px 12px, border-radius 4px, margin-top 16px
- Texto inferior: "Estamos trabajando en este modulo. Pronto estara disponible."
  - Font: 13px, color #94A3B8, margin-top 24px

CONSTRAINTS:
- Limpio y minimalista
- Sin botones de accion (no hay nada que hacer)
- Respetar la paleta de colores del bloque correspondiente
```

---

### 3.9 Cerebro AI — Search Overlay

```
TASK: Disena el overlay de busqueda inteligente "Cerebro AI" — un buscador
tipo Spotlight/Command-K que aparece centrado en pantalla.

CONTEXT: Accesible desde cualquier vista via boton en header o shortcut.
El usuario escribe una pregunta en lenguaje natural ("Que fondos de deuda
han interactuado este mes?") y el AI responde con texto + empresas relevantes.

ELEMENTS:

BACKDROP:
- Background: rgba(10,22,40,0.5)
- Blur: backdrop-filter blur(4px)
- Z-index: 200

MODAL DE BUSQUEDA:
- Posicion: centrado vertical (top 20%), centrado horizontal
- Ancho: 640px
- Max-height: 70vh
- Background: #0A1628 (navy oscuro)
- Border: 1px solid #1B3A5C
- Border-radius: 12px
- Box-shadow: 0 20px 60px rgba(0,0,0,0.6)

INPUT DE BUSQUEDA:
- Padding: 16px 20px
- Background: #132238
- Border: none
- Border-bottom: 1px solid #1B3A5C
- Border-radius: 12px 12px 0 0
- Font: 16px, weight 500, color #FFFFFF
- Placeholder: "Pregunta al Cerebro..." en #6B7F94
- Icono: sparkle/brain a la izquierda, 20px, color #8B5CF6
- Boton enviar: flecha derecha, 20px, color #3B82F6

AREA DE RESPUESTA (debajo del input):
- Padding: 20px
- Scroll vertical si es larga

ESTADO "PENSANDO":
- 3 dots animados (shimmer) en morado
- Texto: "Analizando 3,943 empresas..." en 13px #6B7F94

ESTADO "RESPUESTA":
- Texto de respuesta: 14px, color #94A3B8, line-height 1.7
- Parrafos separados con margin-bottom 12px
- Nombres de empresas mencionados en bold, color #FFFFFF

CARDS DE EMPRESAS ENCONTRADAS (debajo de la respuesta):
- Titulo seccion: "Empresas relevantes (24)" — 12px uppercase #6B7F94
- Grid de mini-cards (2 columnas):
  - Cada card: bg #132238, border 1px solid #1B3A5C, border-radius 8px, padding 10px
  - Nombre: 12px weight 600, #FFFFFF
  - Tipo: badge 9px
  - Score: mini circulo
  - Click: cierra Cerebro y abre DetailPanel de esa empresa

FOOTER:
- Barra de feedback: "Fue util?" + boton thumbs up/down
- Font: 11px, color #6B7F94
- Thumbs: 14px, hover color #FFFFFF

BEHAVIOR:
- Aparece con animacion dialogFadeIn 0.2s
- ESC o click backdrop cierra
- Enter envia pregunta
- Respuesta aparece con typing effect o fade progresivo
- Empresas aparecen despues de la respuesta con stagger animation
- Click en empresa cierra Cerebro y navega a ella

CONSTRAINTS:
- Tema oscuro navy (consistente con DetailPanel)
- Animacion suave, sin lag perceptible
- Accesible con teclado (Tab entre cards de empresas)
- Respuesta se auto-scrollea si es larga
```

---

## PARTE 4: PROMPTS PARA COMPONENTES COMUNES

### 4.1 Botones

```
TASK: Disena el sistema de botones de Alter5 BI con todas sus variantes.

CONTEXT: Dashboard B2B SaaS profesional. Los botones deben ser compactos,
claros en su jerarquia, y consistentes.

ELEMENTS — 7 variantes de boton:

1. PRIMARY (gradiente azul-verde):
   - Background: linear-gradient(135deg, #3B82F6, #10B981)
   - Color: #FFFFFF
   - Padding: 8px 16px
   - Border-radius: 8px
   - Font: 13px weight 700
   - Hover: opacity 0.9, translateY(-1px)

2. PROSPECTS (gradiente morado):
   - Background: linear-gradient(135deg, #8B5CF6, #3B82F6)
   - Color: #FFFFFF

3. CAMPAIGNS (gradiente naranja):
   - Background: linear-gradient(135deg, #F97316, #F59E0B)
   - Color: #FFFFFF

4. SECONDARY (oscuro):
   - Background: #132238
   - Color: #94A3B8
   - Border: 1px solid #2A4A6C
   - Hover: bg #1B3A5C, color #FFFFFF

5. GHOST (transparente):
   - Background: transparent
   - Border: 1px solid #E2E8F0
   - Color: #6B7F94
   - Hover: bg #F8FAFC, border #94A3B8, color #475569

6. DANGER:
   - Background: #EF4444
   - Color: #FFFFFF
   - Hover: bg #DC2626

7. ICON BUTTON (cuadrado):
   - Width/Height: 32px
   - Border-radius: 6px
   - Display: flex center
   - Background: transparent
   - Hover: bg #F1F5F9

Mostrar cada variante en 3 estados: default, hover, disabled.
Disabled: opacity 0.5, cursor not-allowed.

CONSTRAINTS:
- Todos: font DM Sans, transition all 0.15s ease, cursor pointer
- Minimo 44px touch target (padding incluido)
- Texto centrado, no wrap
```

---

### 4.2 Badges y Tags

```
TASK: Disena el sistema de badges y tags de Alter5 BI.

ELEMENTS — 6 tipos:

1. STATUS BADGE (estado empresa):
   - Activo: dot #10B981 + texto "Activo" + bg #ECFDF5
   - Dormant: dot #F59E0B + texto "Dormant" + bg #FFFBEB
   - Lost: dot #EF4444 + texto "Lost" + bg #FEF2F2
   - Formato: inline-flex, gap 4px, padding 2px 8px, border-radius 4px, font 9px weight 600
   - Dot: 5px circulo

2. ROLE BADGE (rol empresa):
   - Originacion: color #F59E0B, bg #F59E0B15, border #F59E0B25
   - Inversion: color #3B82F6, bg #3B82F615, border #3B82F625
   - Ecosistema: color #6B7F94, bg #6B7F9415
   - Formato: padding 2px 8px, border-radius 4px, font 11px weight 600, con dot

3. TYPE BADGE (tipo empresa):
   - Todos: color #3B82F6, bg #EFF6FF
   - Formato: padding 2px 8px, border-radius 4px, font 9px weight 500

4. CAMPAIGN BADGE (tipo campana):
   - Continuada: color #F97316, bg #F9731615
   - Puntual: color #3B82F6, bg #3B82F615
   - Formato: padding 2px 8px, border-radius 4px, font 9px weight 600

5. SCORE CHIP:
   - Alto (>65): bg gradient(135deg, #3B82F6, #10B981), color white
   - Medio (35-65): bg #3B82F6, color white
   - Bajo (<35): bg #F1F5F9, color #6B7F94
   - Formato: 34x34px, border-radius 8px, font 12px weight 800

6. QUALITY DOT:
   - Alta: #10B981, shadow 0 0 0 2px #10B98133
   - Media: #F59E0B, shadow 0 0 0 2px #F59E0B33
   - Baja: #EF4444, shadow 0 0 0 2px #EF444433
   - Formato: 8px circulo

Mostrar todos en fila, agrupados por tipo.

CONSTRAINTS:
- Font DM Sans en todos
- Colores exactos como especificados
- Badges deben verse bien tanto sobre fondo blanco como sobre fondo #F7F9FC
```

---

### 4.3 KPI Cards

```
TASK: Disena KPI cards reutilizables con variantes por bloque.

ELEMENTS:
- Cards en fila horizontal con gap 12px
- Cada card:
  - Background: #FFFFFF (inactiva) o accent+10% (activa como filtro)
  - Border: 1px solid #E2E8F0 (inactiva) o 2px solid accent (activa)
  - Border-radius: 10px
  - Padding: 16px 18px
  - Cursor: pointer
  - Transition: all 0.2s ease
  - Hover: shadow 0 4px 8px rgba(0,0,0,0.08), translateY(-2px)
- Layout interno:
  - Label: 10px uppercase, letter-spacing 2.5px, color #6B7F94, weight 700
  - Valor: 28px weight 800, letter-spacing -1.5px, color #1A2B3D
  - Subtexto: 11px color #6B7F94

Mostrar 3 variantes:
1. EMPRESAS (accent azul): "Total 3,943", "Originacion 1,247", "Inversion 892", "Score 47"
2. PROSPECTS (accent morado): "Activos 12", "En reunion 4", "Term-Sheet 2", "Conversion 28%"
3. CAMPANAS (accent naranja): "Activas 3", "Enviados 1,247", "Apertura 34%", "Respuestas 89"

CONSTRAINTS:
- Cards ocupan ancho completo del area de contenido
- Altura consistente entre cards
```

---

### 4.4 Toast / Notificaciones

```
TASK: Disena el sistema de toast notifications de Alter5 BI.

ELEMENTS:
- Posicion: fixed, bottom 24px, right 24px
- Max width: 400px
- Border-radius: 10px
- Padding: 14px 20px
- Font: 14px weight 600, color #FFFFFF
- Display: flex, align-items center, gap 10px
- Shadow: 0 8px 24px rgba(0,0,0,0.2)
- Z-index: 200
- Animacion entrada: slideInUp 0.3s ease-out

3 variantes:
1. SUCCESS: bg #10B981, icono check-circle
2. ERROR: bg #EF4444, icono x-circle
3. INFO: bg #3B82F6, icono info

Cada toast tiene:
- Icono izquierda (16px)
- Texto mensaje
- Boton cerrar X (14px, color rgba(255,255,255,0.7), hover color white)

Mostrar los 3 stacked (con offset 8px entre ellos).

BEHAVIOR:
- Auto-dismiss: 4 segundos
- Click X: cierra inmediatamente
- Salida: fadeOut + translateY(10px) 0.2s

CONSTRAINTS:
- No bloquear interaccion con la app
- Multiples toasts stackeables (max 3 visibles)
```

---

### 4.5 Modal de Confirmacion

```
TASK: Disena un modal de confirmacion para acciones destructivas.

ELEMENTS:

BACKDROP:
- Background: rgba(10,22,40,0.35)
- Z-index: 150

DIALOG:
- Posicion: centrado en pantalla
- Background: #FFFFFF
- Border-radius: 12px
- Padding: 28px
- Max-width: 480px
- Width: 90%
- Border: 1px solid #E2E8F0
- Shadow: 0 20px 60px rgba(26,43,61,0.3)
- Animacion: dialogFadeIn 0.2s ease-out

CONTENIDO:
- Icono de warning: circulo 48px, bg #FEF2F2, icono exclamacion #EF4444
- Titulo: 20px weight 800, color #1A2B3D, margin-top 16px
  Ejemplo: "Eliminar prospect?"
- Descripcion: 14px, color #475569, line-height 1.6
  Ejemplo: "Esta accion no se puede deshacer. Se eliminara el prospect
  y todos sus datos asociados."
- Botones (derecha-alineados, gap 8px):
  - "Cancelar": ghost button
  - "Eliminar": danger button (bg #EF4444, color white)

BEHAVIOR:
- ESC o click backdrop cierra (equivale a cancelar)
- Focus trap dentro del modal
- Boton peligroso a la derecha (convencion)

CONSTRAINTS:
- No scroll dentro del modal — contenido corto
- Responsive: max-width 480px, width 90%
- Font DM Sans
```

---

### 4.6 Tabla de Datos (Componente Reutilizable)

```
TASK: Disena el componente de tabla de datos reutilizable con todos sus estados.

ELEMENTS:

HEADER ROW:
- Background: #FFFFFF
- Padding: 16px 12px por celda
- Border-bottom: 2px solid #E2E8F0
- Texto: 13px uppercase, letter-spacing 0.5px, color #6B7F94, weight 600

HEADER ACTIVO (columna con sort):
- Color: #3B82F6
- Weight: 700
- Border-bottom: 3px solid #3B82F6
- Background: linear-gradient(180deg, rgba(59,130,246,0.05), rgba(59,130,246,0.02))
- Icono sort: 14px, color #3B82F6 (triangulo arriba o abajo)

DATA ROW — 5 estados:
1. DEFAULT: bg #FFFFFF, border-bottom 1px solid #F1F5F9, border-left 4px transparent
2. HOVER: bg gradient(90deg, #F8FAFC, #F1F5F9), border-left 3px #3B82F6,
   transform translateX(2px), shadow 0 2px 4px rgba(0,0,0,0.04)
3. SELECTED: bg rgba(59,130,246,0.08), border-left 4px #3B82F6
4. BULK SELECTED: bg rgba(59,130,246,0.06), border-left 4px #3B82F6, checkbox checked
5. DISABLED/HIDDEN: opacity 0.4, background striped

EMPTY STATE:
- Centrado en area de tabla
- Icono grande (48px) gris claro
- Texto: "No hay resultados"
- Font: 14px, color #94A3B8
- Boton: "Limpiar filtros" ghost

LOADING STATE:
- Skeleton rows: 8 filas con shimmer animation

CONSTRAINTS:
- Header sticky en scroll
- Columnas con ancho flexible
- Filas: altura consistente ~44px
- Font DM Sans
- Transiciones: 0.15s ease
```

---

### 4.7 Sidebar de Filtros

```
TASK: Disena el sidebar de filtros reutilizable.

ELEMENTS:

CONTAINER:
- Ancho: 280px
- Background: #FFFFFF
- Border-right: 1px solid #E2E8F0
- Padding: 16px
- Height: 100vh - header (calc)
- Overflow-y: auto con scrollbar custom 5px

SECCIONES (cada una con margin-bottom 20px):

SECCION BUSQUEDA:
- Input con icono lupa, full width
- Padding: 8px 14px 8px 36px
- Border: 1px solid #E2E8F0, border-radius 8px
- Placeholder: "Buscar..." en #6B7F94

SECCION FILTRO (patron repetible):
- Label: 10px uppercase, letter-spacing 2.5px, color #6B7F94, weight 700
- Separador: 1px solid #F1F5F9

TIPO: CHIPS:
- Flex wrap, gap 6px
- Inactivo: bg transparent, color #6B7F94, 12px weight 500, padding 4px 10px
- Activo: bg color_bg, border 1px solid color, color color, weight 600

TIPO: CHECKBOXES:
- Lista vertical, gap 4px
- Checkbox 15px, accent-color #3B82F6
- Label: 13px, color #334155

TIPO: TABS HORIZONTALES:
- Flex nowrap, overflow-x auto
- Tab activo: bg acento, color white
- Tab inactivo: color #6B7F94

FOOTER:
- "Limpiar filtros": full width, ghost button

CONSTRAINTS:
- Ancho exacto 280px
- Scroll vertical con scrollbar custom
```

---

## PARTE 5: FLUJO DE TRABAJO RECOMENDADO

### 5.1 Orden de Diseno

Disenar en este orden para construir progresivamente:

```
FASE 1 — Fundamentos:
1. Componentes atomicos (botones, badges, inputs, chips) — 4.1-4.2
2. KPI Cards — 4.3
3. Toast & Modal — 4.4-4.5
4. Tabla de datos — 4.6
5. Sidebar filtros — 4.7

FASE 2 — Login y Shell:
6. Login Google OAuth — 3.0
7. Layout principal (App Shell con 5 tabs) — 3.1

FASE 3 — Bloque 1 (Empresas):
8. Vista Empresas (tabla + sidebar) — 3.2
9. Detail Panel (slide-in oscuro) — 3.3

FASE 4 — Bloque 2 (Prospects):
10. Vista Prospects Kanban — 3.4
11. Prospect Panel (slide-in claro) — 3.5

FASE 5 — Bloque 3 (Campanas):
12. Vista Campanas dashboard — 3.6
13. Detalle Campana + Explorer — 3.7

FASE 6 — Globales:
14. Cerebro AI overlay — 3.9
15. Placeholders Estructuracion/Distribucion — 3.8
```

### 5.2 Tips de Iteracion

Despues del primer prompt, usa estos follow-ups tipicos:

**Ajustes de spacing:**
- "Reduce el padding de las cards a 12px"
- "Aumenta el gap entre columnas a 16px"
- "Haz la sidebar 260px en vez de 280px"

**Ajustes de tipografia:**
- "Cambia todos los labels a DM Sans 10px uppercase letter-spacing 2.5px"
- "El titulo debe ser 20px weight 800, no 24px"

**Ajustes de color:**
- "Usa exactamente #F7F9FC para el background, no blanco puro"
- "Los badges de Originacion deben ser amber #F59E0B, no naranja"

**Ajustes de estado:**
- "Anade el estado hover a todas las filas de la tabla"
- "Muestra el estado seleccionado con border-left azul"

**Ajustes de contenido:**
- "Usa datos realistas de empresas renovables espanolas"
- "Los nombres deben ser: Grenergy, Solarpack, Ignis, X-Elio, Opdenergy"

### 5.3 Datos de Ejemplo para Prompts

Usa estos datos realistas en los disenos:

**Empresas:**
- Grenergy Renovables — Desarrollador — Solar/Eolica — Activo — Score 78
- Solarpack — IPP — Solar — Activo — Score 72
- X-Elio Energy — Desarrollador — Solar — Dormant — Score 65
- Ignis Energia — Desarrollador — Solar/BESS — Activo — Score 81
- Opdenergy — Desarrollador — Solar/Eolica — Activo — Score 69
- Bruc Energy — IPP — Solar — Activo — Score 74
- Naturgy — Utility — Multi — Activo — Score 85
- Acciona Energia — IPP — Multi — Activo — Score 88

**Prospects:**
- Ecoener — Lead — Development Debt — contacto: Juan Lopez
- Capital Energy — Interesado — Project Finance — contacto: Maria Garcia
- Elawan Energy — Reunion — Corporate Debt — contacto: Carlos Martinez
- Solaria — Doc. Pendiente — PF Guaranteed — contacto: Ana Rodriguez
- Audax Renovables — Term-Sheet — Corporate Debt — contacto: Pedro Sanchez

**Campanas:**
- Bridge Debt Energy Q1 2026 — Puntual — Wave 2 — 245 targets — 34% apertura
- Nuevos Desarrolladores — Continuada — trigger: score >70 — 89 enviados
- Follow-up IPPs — Continuada — trigger: 3+ emails sin respuesta — 42 enviados

**Empleados:** Salvador, Leticia, Javier, Miguel, Carlos, Gonzalo, Rafael

---

## PARTE 6: CHECKLIST DE CONSISTENCIA

Antes de finalizar cada diseno, verificar:

- [ ] Font DM Sans en toda la pantalla
- [ ] Background general #F7F9FC (no blanco puro, no gris oscuro)
- [ ] Cards sobre fondo blanco #FFFFFF con border #E2E8F0
- [ ] Border-radius consistente (4/6-8/10/12px segun componente)
- [ ] Colores de texto: titulos #1A2B3D, cuerpo #334155, secundario #6B7F94
- [ ] Azul primario #3B82F6 (no otro azul)
- [ ] Verde #10B981 (no otro verde)
- [ ] Identidad de color correcta por bloque:
  - [ ] Empresas: azul #3B82F6
  - [ ] Prospects: morado #8B5CF6 (gradiente #8B5CF6 -> #3B82F6)
  - [ ] Campanas: naranja #F97316 (gradiente #F97316 -> #F59E0B)
  - [ ] Estructuracion: verde #10B981
  - [ ] Distribucion: cyan #06B6D4
- [ ] Shadows sutiles (no heavy drop shadows)
- [ ] Transiciones en hover/focus (0.15s ease)
- [ ] Spacing consistente (4/8/12/16/20/24px)
- [ ] Labels uppercase con letter-spacing 2.5px
- [ ] Datos en espanol
- [ ] Panel oscuro usa navy palette (#0A1628, #132238, #1B3A5C)
- [ ] Scrollbar custom (5px, thumb #E2E8F0)
- [ ] Login: solo boton Google, sin formulario email/password
- [ ] Tabs "Soon" deshabilitados para Estructuracion y Distribucion
