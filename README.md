# Alter5 Business Intelligence

Herramienta de inteligencia comercial para analizar y clasificar la red de contactos empresariales de Alter5.

## Inicio rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Arrancar en desarrollo
npm run dev

# 3. Abrir en el navegador
# → http://localhost:5173
```

## Añadir un nuevo buzón de correo

```bash
# 1. Copia el Excel a la carpeta data_sources/
cp ~/Downloads/analisis_contactos_NOMBRE.xlsx data_sources/

# 2. Ejecuta el importador (requiere: pip install pandas openpyxl)
python scripts/import_mailbox.py data_sources/analisis_contactos_NOMBRE.xlsx "Nombre Apellido"

# 3. Reinicia el servidor
# Ctrl+C en el terminal + npm run dev
```

El script fusiona automáticamente los datos: si una empresa aparece en varios buzones,
combina las interacciones, contactos y timelines. En la app verás un filtro de "Buzón"
en la barra lateral y un desglose por empleado en la ficha de cada empresa.

## Estructura del proyecto

```
alter5-bi/
├── data_sources/              # Archivos Excel originales (no se suben a git)
├── scripts/
│   └── import_mailbox.py      # Importador de buzones → regenera companies.json
├── src/
│   ├── App.jsx                # Componente principal
│   ├── main.jsx               # Entry point
│   ├── index.css              # Estilos globales
│   ├── components/
│   │   ├── UI.jsx             # Badge, KPI, FilterChip, ScoreBar
│   │   ├── Sidebar.jsx        # Filtros (buzón, estado, sector, tipo)
│   │   ├── CompanyTable.jsx   # Tabla ordenable con paginación
│   │   └── DetailPanel.jsx    # Ficha detallada con desglose por buzón
│   ├── utils/
│   │   ├── constants.js       # Sectores, tipos, pesos de scoring
│   │   └── data.js            # Parsing de datos y exportación CSV
│   └── data/
│       ├── companies.json     # Datos compactos para la app (auto-generado)
│       ├── companies_full.json # Datos completos con sources (auto-generado)
│       └── employees.json     # Registro de empleados importados
├── package.json
├── vite.config.js
├── index.html
├── vercel.json                # Configuración de deploy (Vercel)
├── deploy-vercel.sh           # Script de deploy automático
└── DEPLOY.md                  # Guía completa de deploy
```

## Sistema de scoring (0-100)

| Dimensión | Máx | Qué mide |
|-----------|-----|----------|
| Volumen   | 35  | Nº total de interacciones (logarítmico) |
| Recencia  | 30  | Meses desde último contacto |
| Red       | 15  | Nº de contactos en la empresa |
| Tipo      | 20  | Relevancia estratégica del tipo de relación |

## Estado de relación

- **Activa**: último contacto < 6 meses
- **Dormida**: entre 6 y 18 meses
- **Perdida**: > 18 meses

## Funcionalidades

- Búsqueda libre por nombre, dominio, sector o tipo
- Filtros combinables por estado, sector y tipo de relación
- Tabla ordenable por score, nombre, emails o contactos
- Ficha detallada con desglose de score, contactos clave y timeline
- Exportación CSV compatible con Airtable
- Campos preparados para enriquecimiento manual

## Próximos pasos sugeridos

- [x] ~~Escalar a múltiples buzones de empleados~~ ✅ Implementado
- [ ] Hacer editables los campos manuales (facturación, empleados, notas)
- [ ] Persistir datos editados (localStorage o backend)
- [ ] Conectar exportación con API de Airtable
- [ ] Añadir filtro por rango de fechas
- [ ] Añadir gráficos de distribución por sector/tipo

## Build y deploy a producción

### Build local

```bash
npm run build    # Genera carpeta dist/
npm run preview  # Preview del build local
```

### Deploy en Vercel

El proyecto está configurado para desplegarse en **Vercel** (static site con Vite).

**Forma rápida (script):**

```bash
chmod +x deploy-vercel.sh
./deploy-vercel.sh
```

**Forma manual (Vercel CLI):**

```bash
npm install -g vercel
vercel login     # Solo la primera vez
vercel --prod    # Deploy a producción
```

Para despliegues sin preguntas (scripts/CI): `vercel --prod --yes`.

**Documentación completa:** [DEPLOY.md](./DEPLOY.md) — requisitos, configuración (`vercel.json`, `.vercelignore`), primer deploy, deploys posteriores, GitHub, dominio propio y troubleshooting.
