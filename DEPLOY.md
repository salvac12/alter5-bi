# Guía de Deploy a Vercel — Alter5 BI

Documentación completa del proceso de deployment de Alter5 Business Intelligence en Vercel.

---

## Índice

1. [Resumen](#resumen)
2. [Requisitos previos](#requisitos-previos)
3. [Opción 1: Script automático](#opción-1-script-automático-recomendado)
4. [Opción 2: Deploy manual con Vercel CLI](#opción-2-deploy-manual-con-vercel-cli)
5. [Archivos de configuración](#archivos-de-configuración)
6. [Proyecto enlazado y primer deploy](#proyecto-enlazado-y-primer-deploy)
7. [Deploys posteriores](#deploys-posteriores)
8. [Verificación post-deploy](#verificación-post-deploy)
9. [Deploy automático vía GitHub](#deploy-automático-vía-github-opcional)
10. [Dominio personalizado](#configurar-dominio-personalizado-opcional)
11. [Troubleshooting](#troubleshooting)
12. [Notas de seguridad y datos](#notas-importantes)

---

## Resumen

| Aspecto | Detalle |
|--------|---------|
| **Plataforma** | Vercel |
| **Tipo** | Static site (SPA con Vite) |
| **Build** | `npm run build` → salida en `dist/` |
| **Framework detectado** | Vite |
| **Node** | >= 18.0.0 (definido en `package.json` → `engines.node`) |

La app se despliega como sitio estático. Vercel ejecuta el build en cada deploy y sirve los archivos desde `dist/`.

---

## Requisitos previos

- **Node.js** >= 18 (recomendado LTS)
- **npm** (incluido con Node)
- **Cuenta en Vercel** (gratuita): [vercel.com](https://vercel.com)
- **Datos en el repo**: `src/data/companies.json` (y opcionalmente `companies_full.json`, `employees.json`) deben existir y estar **no** ignorados por git
- **Variable de entorno Airtable** (opcional): `VITE_AIRTABLE_PAT` — necesaria para la vista Pipeline/Kanban

Comprobación rápida:

```bash
node --version   # v18.x o superior
npm --version
ls -la src/data/companies.json
```

---

## Opción 1: Script automático (Recomendado)

El script `deploy-vercel.sh` ejecuta todos los pasos y hace las comprobaciones necesarias.

```bash
# 1. Permisos de ejecución (solo la primera vez)
chmod +x deploy-vercel.sh

# 2. Ejecutar deploy
./deploy-vercel.sh
```

**Qué hace el script:**

| Paso | Acción |
|------|--------|
| 1/6 | Comprueba Node.js y npm |
| 2/6 | Instala dependencias si no existe `node_modules` |
| 3/6 | Ejecuta `npm run build` y comprueba que no falle |
| 4/6 | Inicializa Git si no hay `.git`; opcionalmente sugiere commit de cambios |
| 5/6 | Instala Vercel CLI globalmente si no está instalado |
| 6/6 | Ejecuta `vercel --prod` |

**Durante el proceso:**

- **Primera vez**: Vercel puede pedir login (se abre el navegador).
- Confirma el nombre del proyecto (por ejemplo `alter5-bi`).
- Acepta las configuraciones detectadas (Vite, `dist`, etc.).

El script hace una pausa antes del deploy (`Presiona Enter para continuar`); en entornos no interactivos usa la [opción manual](#opción-2-deploy-manual-con-vercel-cli) con `vercel --prod --yes`.

---

## Opción 2: Deploy manual con Vercel CLI

Útil si prefieres control total o si ejecutas el deploy desde CI/terminal sin interacción.

### 1. Instalar dependencias y comprobar build

```bash
npm install
npm run build
```

Debe generarse la carpeta `dist/` sin errores.

### 2. Instalar y autenticar Vercel CLI

```bash
# Instalación global
npm install -g vercel

# Login (primera vez o tras caducar sesión)
vercel login
```

Se abrirá el navegador para autenticarte.

### 3. Deploy a producción

**Primera vez** (crea y enlaza el proyecto):

```bash
vercel --prod
```

Responde según el asistente:

- **Set up and deploy?** → Yes  
- **Which scope?** → Tu cuenta o equipo  
- **Link to existing project?** → No (primera vez)  
- **What's your project's name?** → `alter5-bi` (o el que prefieras)  
- **In which directory is your code located?** → `./`  
- **Want to override settings?** → No (usa `vercel.json` y detección automática)

**Deploys siguientes** (proyecto ya enlazado):

```bash
vercel --prod
```

Para evitar preguntas interactivas (CI, scripts):

```bash
vercel --prod --yes
```

`--yes` acepta valores por defecto y el proyecto enlazado en `.vercel/`.

### 4. Salida típica

Tras un deploy correcto verás algo como:

```
Linked to salvas-workspaces-projects/alter5-bi
Deploying salvas-workspaces-projects/alter5-bi
...
Production: https://alter5-xxxxx.vercel.app
Inspect: https://vercel.com/.../...
```

- **Production**: URL del deployment de producción.
- **Inspect**: Dashboard del deploy (logs, detalles, rollback).

---

## Archivos de configuración

### `vercel.json`

Configuración en la raíz del proyecto:

| Campo | Valor | Descripción |
|-------|--------|-------------|
| `buildCommand` | `npm run build` | Comando de build |
| `outputDirectory` | `dist` | Carpeta que Vercel sirve |
| `framework` | `vite` | Framework detectado |
| `git.deploymentEnabled` | `true` | Habilita deploys desde Git si conectas el repo |
| `headers` | Ver abajo | Cabeceras de seguridad y caché |

**Cabeceras:**

- Para todas las rutas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`
- Para `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`

No es necesario modificar `vercel.json` para un deploy básico; la detección de Vite ya asigna build y output.

### `.vercelignore`

Excluye del upload a Vercel (no del build):

- `node_modules/`
- `.DS_Store`, `*.local`
- `data_sources/`
- `scripts/`
- `.git`, `.gitignore`
- `README.md`, `.claude.md`

El build se ejecuta en el servidor de Vercel, por lo que `node_modules` se instala allí; ignorarlo en el upload solo acelera el envío.

### `.vercel/` (generado por CLI)

Tras el primer `vercel` o `vercel --prod`, la CLI crea:

- `.vercel/project.json`: ID y nombre del proyecto enlazado
- `.vercel/README`: nota de que la carpeta es generada

Suele estar en `.gitignore`. Para que otro desarrollador o CI despliegue el mismo proyecto, puede enlazar con `vercel link` o usar el mismo `.vercel/` (con cuidado si hay varios proyectos).

---

## Proyecto enlazado y primer deploy

1. **Primer deploy**  
   Al ejecutar `vercel --prod` (o `vercel`) por primera vez en el repo, la CLI:
   - Te pide scope (cuenta/equipo), nombre del proyecto y directorio.
   - Crea el proyecto en Vercel si no existe.
   - Escribe `.vercel/` y enlaza este directorio al proyecto.

2. **Deploys siguientes**  
   Desde el mismo directorio, `vercel --prod` usará el proyecto enlazado y no volverá a preguntar (salvo que borres `.vercel/` o uses `vercel link` para cambiar de proyecto).

3. **URLs**  
   - Cada deploy puede tener una URL única (por ejemplo `alter5-xxxxx.vercel.app`).
   - El proyecto suele tener además un dominio de producción (ej. `alter5-bi.vercel.app`). Ambas apuntan al último deploy de producción.

---

## Deploys posteriores

Tras el setup inicial:

```bash
# Opción A: Solo deploy (asumiendo dependencias y build OK en Vercel)
vercel --prod

# Opción B: Sin preguntas (scripts/CI)
vercel --prod --yes

# Opción C: Script completo (incluye npm install, build, comprobaciones)
./deploy-vercel.sh
```

Recomendación: hacer commit de los cambios antes de `vercel --prod` para que el historial y los deploys por Git (si los usas) coincidan.

---

## Verificación post-deploy

1. **Abrir la URL de producción** que muestra la CLI o el Dashboard.
2. **Comprobar:**
   - Carga la tabla de empresas.
   - Filtros (buzón, sector, tipo, estado) funcionan.
   - Búsqueda responde.
   - Panel de detalle se abre al pulsar una empresa.
   - Exportación CSV descarga correctamente.
3. **Revisar datos:** que aparezcan las empresas y buzones esperados (p. ej. filtro "Buzón" con los empleados importados).

Si algo falla, revisa **Inspect** (enlace del último deploy) → **Building** / **Logs** para ver errores de build o runtime.

---

## Deploy automático vía GitHub (Opcional)

Para que cada push a `main` dispare un deploy en Vercel:

1. **Subir el código a GitHub**
   ```bash
   git remote add origin https://github.com/TU_USUARIO/alter5-bi.git
   git branch -M main
   git push -u origin main
   ```

2. **Conectar el repo en Vercel**
   - [vercel.com/dashboard](https://vercel.com/dashboard) → **Add New Project**
   - Importar el repositorio de GitHub y autorizar si es necesario.
   - Vercel usará `vercel.json` y la detección de Vite (build, output `dist`).

3. **Comportamiento**
   - Push a `main` → deploy a producción (si así está configurado en el proyecto).
   - Otras ramas → preview deployments con URL propia.

Los deploys por Git no requieren Vercel CLI en tu máquina; la CLI sigue siendo útil para deploys manuales o con `vercel --prod --yes`.

---

## Configurar dominio personalizado (Opcional)

1. Vercel Dashboard → tu proyecto → **Settings** → **Domains**.
2. Añadir dominio (ej. `bi.alter5.com`).
3. Seguir las instrucciones de DNS (registros CNAME o A según indique Vercel).

---

## Troubleshooting

### Error: "Command failed: npm run build"

- Ejecuta `npm run build` en local y corrige errores de código o dependencias.
- Asegúrate de que `src/data/companies.json` existe y es JSON válido.
- Revisa la pestaña **Building** del deploy en Vercel para el log completo.

### Error: "No such file or directory: dist"

- En `vercel.json` debe figurar `"outputDirectory": "dist"` (ya está).
- El fallo suele ser que el build falla antes de generar `dist`. Revisa los logs de build en Vercel.

### Build OK en local, falla en Vercel

- Comprueba `package.json` → `engines.node` (ej. `">=18.0.0"`). Vercel usará esa versión.
- Revisa que no dependas de variables de entorno o archivos que no existan en el entorno de Vercel.
- Comprueba que no haya rutas o imports que asuman Windows (rutas absolutas, etc.).

### Los datos no aparecen en producción

- Confirma que `src/data/companies.json` (y los que use la app) están en el repo y **no** en `.gitignore` ni `.vercelignore` de forma que los excluya del código que se sube.
- Ejecuta `git status` y `git check-ignore -v src/data/companies.json` para asegurarte de que se incluyen en el commit.

### "vercel: command not found"

- Instalar CLI: `npm install -g vercel`
- O usar sin instalar: `npx vercel --prod`

### Proyecto enlazado a otra cuenta/equipo

- Borra `.vercel/` y ejecuta de nuevo `vercel --prod` para elegir otro scope/proyecto.
- O usa `vercel link` y selecciona el proyecto correcto.

---

## Variables de entorno en Vercel

Para que la vista **Pipeline (Kanban)** funcione en produccion, hay que configurar la variable de entorno de Airtable:

1. Vercel Dashboard > tu proyecto > **Settings** > **Environment Variables**
2. Anadir:
   - **Name**: `VITE_AIRTABLE_PAT`
   - **Value**: tu Personal Access Token de Airtable
   - **Environments**: Production, Preview, Development
3. **Redeploy** para que tome efecto (Deployments > ultimo deploy > Redeploy)

> Nota: Las variables `VITE_*` se inyectan en build time por Vite, no en runtime. Por eso es necesario el redeploy tras configurarlas.

---

## Notas importantes

- **Seguridad:** No subas secretos (`.env` con API keys, etc.). Usa **Environment Variables** en Vercel Dashboard para produccion.
- **Datos:**
  - `data_sources/` (Excels) no se suben (estan en `.gitignore`).
  - `src/data/companies.json` (y similares) **si** deben estar en el repo para que el build y la app en produccion tengan datos.
- **Build:** Vercel ejecuta el build en cada deploy; no hace falta subir la carpeta `dist/` local.
- **Documentacion:** Para mas contexto del proyecto y convenciones, ver `README.md`.

---

## Referencias

- [Vercel Docs](https://vercel.com/docs)
- [Vercel CLI](https://vercel.com/docs/cli)
- [Vite deployment](https://vitejs.dev/guide/static-deploy.html)
