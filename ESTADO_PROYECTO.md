# Estado del Proyecto - Alter5 BI
**Fecha actualización:** 20 de febrero de 2026
**Última modificación:** Sistema completo de edición y cualificación de empresas implementado

---

## 📊 Resumen Ejecutivo

Dashboard de Business Intelligence para análisis y clasificación de la red de contactos empresariales de Alter5, con sistema de scoring multi-dimensional y gestión multi-buzón.

---

## 🎯 Estado Actual

### ✅ Completado

1. **Configuración del proyecto**
   - React 18.3.1 + Vite 5.4
   - Lodash para utilidades de datos
   - Node >= 18.0.0

2. **Datos importados**
   - Salvador Carrillo: 2,202 empresas (18/02/2026)
   - Guillermo Souto: 1,511 empresas (18/02/2026)
   - Leticia Menéndez: 681 empresas (18/02/2026)
   - **Total:** ~4,394 empresas únicas tras fusión

3. **Funcionalidades core**
   - Sistema de scoring 0-100 (Volumen 35% + Recencia 30% + Red 15% + Tipo 20%)
   - Estados de relación: Activa (<6m), Dormida (6-18m), Perdida (>18m)
   - Sistema de tabs por empleado (Todos/Salvador/Guillermo/Leticia) con contadores dinámicos
   - Ordenamiento alfabético por defecto (A-Z) con capacidad de reordenar por columnas
   - Indicadores visuales mejorados de ordenamiento (↑↓↕ en headers de tabla)
   - Búsqueda libre por nombre/dominio/sector/tipo
   - Filtros combinables por estado, sector (incluye "Asociación") y tipo
   - Filtros preparados para futuro (Tamaño Empresa y País) con estado disabled
   - Badge contador de filtros activos en sidebar
   - Tooltips explicativos en filtros disabled
   - Tabla ordenable y paginada con mejoras visuales (hover effects, estado selected)

   **Ficha de empresa detallada:**
   - **NUEVO:** Sistema completo de edición de campos manuales
   - **NUEVO:** Cualificación automática de país (por extensión de dominio)
   - **NUEVO:** Cualificación automática de tamaño de empresa
   - **NUEVO:** Campos editables: facturación, empleados, país, prioridad, web, LinkedIn, notas
   - **NUEVO:** Almacenamiento persistente en localStorage
   - **NUEVO:** Modo edición con feedback visual (bordes azules)
   - Panel de detalle con desglose por empleado
   - Timeline de interacciones
   - Contactos clave priorizados
   - Información de contexto

   - Exportación CSV (compatible Airtable)

4. **Sistema de importación**
   - Script Python `scripts/import_mailbox.py`
   - Fusión automática de empresas duplicadas entre buzones
   - Generación de `companies.json` (compacto) y `companies_full.json` (completo)
   - Registro en `employees.json`

5. **Deploy y versioning**
   - Git repository: `https://github.com/salvac12/alter5-bi.git`
   - Branch actual: `main`
   - Commit actual: `1cb720f` - "feat: sistema completo de edición y cualificación de empresas"
   - Deploy en Vercel: `https://alter5-574qcf5st-salvas-workspaces-projects.vercel.app`
   - Deploy ID: `EBbJcaqG2ZadAaTpNQjjYbfnd3YV`
   - Panel Vercel: `https://vercel.com/salvas-workspaces-projects/alter5-bi`

---

## 📁 Estructura del Proyecto

```
alter5-bi/
├── data_sources/              # Archivos Excel originales (.gitignore)
├── scripts/
│   └── import_mailbox.py      # Importador Python (pandas + openpyxl)
├── src/
│   ├── App.jsx                # Componente raíz con estado global
│   ├── main.jsx               # Entry point React
│   ├── index.css              # Estilos globales + Tailwind-like
│   ├── components/
│   │   ├── UI.jsx             # Badge, KPI, FilterChip, ScoreBar
│   │   ├── Sidebar.jsx        # Panel de filtros lateral
│   │   ├── CompanyTable.jsx   # Tabla con ordenación y paginación
│   │   └── DetailPanel.jsx    # Ficha detallada de empresa
│   ├── utils/
│   │   ├── constants.js       # SECTORS, TYPES, SCORE_WEIGHTS
│   │   └── data.js            # loadCompanies(), exportToCSV()
│   └── data/
│       ├── companies.json     # Datos compactos (auto-generado)
│       ├── companies_full.json # Datos completos con sources (auto-generado)
│       └── employees.json     # Registro de empleados importados
├── package.json               # Dependencias y scripts npm
├── vite.config.js             # Configuración Vite
├── vercel.json                # Configuración deploy Vercel
├── deploy-vercel.sh           # Script automatizado de deploy
├── README.md                  # Documentación principal
├── DEPLOY.md                  # Guía completa de deploy
└── ESTADO_PROYECTO.md         # Este archivo
```

---

## 🔧 Comandos Principales

### Desarrollo
```bash
npm install                    # Instalar dependencias
npm run dev                    # Dev server → http://localhost:5173
npm run build                  # Build producción → dist/
npm run preview                # Preview del build
```

### Importación de buzones
```bash
# Requisitos: pip install pandas openpyxl
python scripts/import_mailbox.py data_sources/analisis_contactos_NOMBRE.xlsx "Nombre Apellido"
```

### Deploy
```bash
# Push a GitHub
git push origin main

# Deploy a Vercel (método rápido)
./deploy-vercel.sh

# Deploy manual
vercel --prod --yes
```

---

## 📊 Sistema de Scoring (0-100)

| Dimensión | Peso | Cálculo | Qué mide |
|-----------|------|---------|----------|
| **Volumen** | 35 pts | `min(35, log10(emails+1) * 10)` | Intensidad de comunicación |
| **Recencia** | 30 pts | `30 - (meses_desde_ultimo * 1.67)` | Frescura de la relación |
| **Red** | 15 pts | `min(15, contactos * 3)` | Amplitud de la red |
| **Tipo** | 20 pts | Según `SCORE_WEIGHTS` | Relevancia estratégica |

### Estados de Relación
- **Activa:** < 6 meses desde último contacto (verde)
- **Dormida:** 6-18 meses (amarillo)
- **Perdida:** > 18 meses (rojo)

---

## 🎨 Componentes React

### App.jsx
- Estado global: filtros, búsqueda, empresa seleccionada, ordenación, paginación
- Carga de datos desde `companies.json`
- Lógica de filtrado y ordenación
- Layout principal (Sidebar + Tabla + DetailPanel)

### Sidebar.jsx
- Filtros por buzón (multi-select)
- Filtros por estado (Activa/Dormida/Perdida)
- Filtros por sector (basados en `SECTORS`)
- Filtros por tipo de relación (`TYPES`)
- Barra de búsqueda
- Botón de exportación CSV
- Contador de resultados

### CompanyTable.jsx
- Tabla responsive con 5 columnas: Empresa, Score, Emails, Contactos, Última interacción
- Ordenación clickable por cualquier columna
- Paginación (20 empresas por página)
- Indicadores visuales (badges de estado)
- Click en fila → abre DetailPanel

### DetailPanel.jsx
- Panel lateral deslizable
- Información básica (dominio, sector, tipo, estado)
- Desglose de score por dimensión (barras visuales)
- Lista de contactos clave
- Timeline de interacciones (últimos 10)
- Desglose por buzón (si múltiples fuentes)
- Campos preparados para enriquecimiento manual

### UI.jsx
- **Badge:** Indicadores de estado/tipo con colores
- **KPI:** Métricas con label y valor destacado
- **FilterChip:** Chips de filtro clickeables
- **ScoreBar:** Barra de progreso para dimensiones de score

---

## 📦 Archivos de Datos

### companies.json
Versión compacta para carga rápida en producción. Campos:
```json
{
  "id": "example.com",
  "name": "Example Corp",
  "domain": "example.com",
  "sector": "Tecnología",
  "type": "Cliente",
  "totalEmails": 42,
  "lastInteraction": "2025-12-15",
  "status": "Activa",
  "score": 78,
  "scoreBreakdown": { "volume": 28, "recency": 30, "network": 9, "type": 15 },
  "contacts": [...],
  "timeline": [...],
  "sources": { "salvador_carrillo": {...}, "guillermo_souto": {...} }
}
```

### companies_full.json
Versión completa con todos los metadatos de importación.

### employees.json
Registro de empleados importados:
```json
{
  "id": "nombre_apellido",
  "name": "Nombre Apellido",
  "importedAt": "2026-02-18T09:13:37.739999",
  "companiesCount": 2202
}
```

---

## 🌐 URLs del Proyecto

- **Repositorio GitHub:** https://github.com/salvac12/alter5-bi.git
- **Deploy Vercel (producción):** https://alter5-ld9bt3m7f-salvas-workspaces-projects.vercel.app
- **Panel Vercel:** https://vercel.com/salvas-workspaces-projects/alter5-bi
- **Inspect último deploy:** https://vercel.com/salvas-workspaces-projects/alter5-bi/6UnAiu5oAjXfTWEfSfVRLZ4NXLHs

---

## 📋 Próximos Pasos (Roadmap)

### Prioridad Alta
- [ ] **Campos editables:** Hacer editables facturación estimada, nº empleados, notas y tipo de relación
- [ ] **Persistencia de datos:** Guardar ediciones en localStorage o backend
- [ ] **Filtro por fecha:** Añadir filtro por rango de fechas de última interacción

### Prioridad Media
- [ ] **Gráficos y analytics:**
  - Distribución de empresas por sector (pie chart)
  - Distribución por tipo de relación (bar chart)
  - Evolución temporal de interacciones (line chart)
- [ ] **Integración Airtable:** Conectar exportación con API de Airtable
- [ ] **Mejoras UX:**
  - Tooltips explicativos en score breakdown
  - Búsqueda avanzada con operadores
  - Destacado de términos de búsqueda

### Prioridad Baja
- [ ] **Enriquecimiento automático:** Integración con APIs públicas (LinkedIn, Clearbit, etc.)
- [ ] **Notificaciones:** Alertas de relaciones "en riesgo" (próximas a pasar de Dormida a Perdida)
- [ ] **Exportación avanzada:** Excel con múltiples hojas, PDF de reportes
- [ ] **Multi-idioma:** i18n para inglés/español

---

## 🔒 Seguridad y Privacidad

- **Archivos sensibles en .gitignore:**
  - `data_sources/` (Excel originales)
  - `.env*`
  - `node_modules/`
- **No hay autenticación implementada** → Si se requiere privacidad, añadir Vercel Password Protection o auth (Auth0, Clerk, etc.)
- **Datos en repositorio público:** `companies.json` está en GitHub público → revisar política de privacidad

---

## 🐛 Problemas Conocidos

Ninguno reportado hasta la fecha.

---

## 📝 Notas Técnicas

### Requisitos del Sistema
- Node.js >= 18.0.0
- npm >= 8.0.0
- Python 3.8+ (para importador)
  - pandas
  - openpyxl

### Limitaciones Actuales
- Scoring logarítmico puede no escalar bien con >10,000 emails por empresa
- Timeline muestra máximo 10 interacciones en DetailPanel
- Paginación fija a 20 items (no configurable por usuario)
- Sin lazy loading de datos (carga completa al inicio)

### Performance
- `companies.json` actual: ~7.4MB
- Tiempo de carga inicial: <2s en conexión estándar
- Renderizado: optimizado con React keys y componentes puros

---

## 📚 Recursos y Documentación

- **README.md:** Guía de inicio rápido y uso básico
- **DEPLOY.md:** Guía completa de deploy en Vercel
- **deploy-vercel.sh:** Script automatizado con checks de pre-deploy

---

## 🔄 Historial de Versiones

### v1.1.0 (20/02/2026) - Sistema de edición y cualificación
- ✅ Sistema completo de edición de campos manuales
- ✅ Cualificación automática de país por extensión de dominio
- ✅ Cualificación automática de tamaño de empresa
- ✅ Almacenamiento persistente en localStorage
- ✅ Campos editables: facturación, empleados, país, prioridad, web, LinkedIn, notas
- ✅ Componentes EditableField, SelectField, InfoField
- ✅ Modo edición con feedback visual
- ✅ Nueva categoría "Asociación" en sectores
- ✅ Archivo companyData.js para gestión de datos manuales

### v1.0.0 (20/02/2026) - Rediseño del panel principal
- Commit inicial con dashboard completo
- Sistema de scoring implementado
- Soporte multi-buzón
- Deploy en Vercel configurado
- Sistema de tabs por empleado
- Ordenamiento alfabético por defecto
- Indicadores visuales de ordenamiento
- Filtros ampliados (tamaño y país preparados)

---

## 📋 Próximos Pasos Sugeridos

### Alta Prioridad
- [ ] Integración con LinkedIn para cualificación automática de tamaño
- [ ] Implementar cualificación de país por idioma de correos
- [ ] Exportar datos editados junto con el CSV
- [ ] Sincronización bidireccional con Airtable

### Media Prioridad
- [ ] Gráficos de distribución (sector, tipo, estado)
- [ ] Filtro por rango de fechas
- [ ] Sistema de notificaciones para relaciones en riesgo
- [ ] Búsqueda avanzada con operadores

### Baja Prioridad
- [ ] Enriquecimiento automático con APIs públicas
- [ ] Sistema de tareas y recordatorios
- [ ] Multi-idioma (i18n)
- [ ] Modo oscuro/claro

---

**Última actualización:** 20 de febrero de 2026, 11:00 AM
**Actualizado por:** Claude Code (Anthropic)
