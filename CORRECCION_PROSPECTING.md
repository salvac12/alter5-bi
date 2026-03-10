# Corrección Prospecting — Problema y solución

Documento para aplicar la corrección desde el ordenador del trabajo.

---

## 1. Problema

### 1.1 El workflow nunca se ejecuta (0 runs en GitHub Actions)

- **Síntoma**: En GitHub → Actions → "Prospecting Agent" no hay ningún run. El `repository_dispatch` que lanza la UI desde el dashboard **nunca llega a GitHub**.
- **Causa**: El frontend llama a la API de GitHub (`POST /repos/salvac12/alter5-bi/dispatches`) desde el **navegador** usando `VITE_GITHUB_TOKEN`.
  - Si `VITE_GITHUB_TOKEN` **no está configurado en Vercel** (Settings → Environment Variables), la variable es vacía y la petición falla o no se envía.
  - Aunque esté configurado, **exponer un token con permisos `repo` en el cliente** es un riesgo de seguridad (cualquiera con acceso a la app puede verlo/usarlo).

### 1.2 Jobs que se quedan "Pendiente" y/o invisibles

- **Síntoma**: Al lanzar una prospección desde la UI, el job aparece como "Pendiente" y no pasa a "En curso" ni "Completado".
- **Causas** (ya corregidas en código en este repo):
  1. **UI**: `fetchProspectingJobs` ignoraba los registros con `CompanyName === "__JOB_PLACEHOLDER__"`, así que el job creado al pulsar "Nueva búsqueda" no aparecía en la lista hasta que el runner subía empresas.
  2. **Runner**: No actualizaba el registro que crea el frontend. Creaba un *segundo* placeholder con `JobStatus: "running"` y luego lo borraba; el registro original en Airtable seguía en "pending" para siempre.

---

## 2. Cambios ya hechos en el repo (revisar que estén en tu rama)

### 2.1 `src/utils/airtableProspecting.ts`

- **Incluir placeholders en la lista de jobs**: Ya no se hace `continue` cuando `CompanyName === "__JOB_PLACEHOLDER__"`. Los jobs aparecen desde que se crean (pending → running → completed).
- **Estado del job**: Se calcula como el "más avanzado" entre todos los registros del job: `failed` > `running` > `completed` > `pending`.

### 2.2 `scripts/prospecting/runner.py`

- **Nueva función `set_job_running(job_id)`**: Busca en Airtable el registro con ese `JobId` y `CompanyName = "__JOB_PLACEHOLDER__"` (el que crea el frontend) y lo actualiza a `JobStatus: "running"`.
- **Al arrancar**: Primero intenta actualizar ese registro; solo si no existe (p. ej. workflow lanzado a mano) crea su propio placeholder. Así el mismo registro que crea la UI pasa a "running" y luego a "completed"/"failed".

---

## 3. Solución pendiente: que el dispatch no dependa del token en el cliente

**Objetivo**: Que el trigger del workflow se haga desde el **servidor** (Vercel), con un token que no se exponga al navegador.

### 3.1 Crear API route en Vercel

- **Ruta sugerida**: `api/trigger-prospecting.ts` (o `.js` si el proyecto no usa TS en API routes).
- **Qué hace**:
  1. Recibe `POST` con body `{ criteria: object, jobId: string }` (los mismos que usa hoy el frontend).
  2. Opcional: comprobar autorización (header, cookie, o API key).
  3. En el servidor, leer `GITHUB_TOKEN` (o `PROSPECTING_GITHUB_TOKEN`) de `process.env` — **sin** prefijo `VITE_`.
  4. Llamar a `POST https://api.github.com/repos/salvac12/alter5-bi/dispatches` con:
     - `event_type: "run-prospecting"`
     - `client_payload: { criteria: JSON.stringify(criteria), jobId }`
  5. Devolver 200 + `{ success: true, jobId }` o el error de GitHub.

### 3.2 Configurar variable en Vercel

- En el proyecto → **Settings** → **Environment Variables**:
  - Añadir `GITHUB_TOKEN` (o el nombre que uses en la API route) con un Personal Access Token que tenga al menos permiso **repo** (o **Actions: write** si es fine-grained) sobre `salvac12/alter5-bi`.
  - No hace falta `VITE_GITHUB_TOKEN` en el cliente una vez migrado.

### 3.3 Cambiar el frontend

- En `src/utils/airtableProspecting.ts`, en la función `triggerGitHubAction`:
  - En vez de llamar a `https://api.github.com/repos/.../dispatches` con `getGithubToken()`, hacer `fetch('/api/trigger-prospecting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ criteria, jobId }) })`.
  - Mantener el mismo contrato (criteria + jobId); la API route se encarga de llamar a GitHub.

### 3.4 Comprobar

- Lanzar una prospección desde la UI y ver en GitHub → Actions que aparece un run de "Prospecting Agent".
- Ver que el job pasa a "En curso" y luego a "Completado" o "Fallido".

---

## 4. Checklist rápido (desde el trabajo)

- [ ] `git pull` y confirmar que en tu rama están los cambios de `airtableProspecting.ts` y `runner.py` (placeholders incluidos, `set_job_running`).
- [ ] Crear `api/trigger-prospecting.ts` (o .js) que reciba criteria + jobId y llame a GitHub con `process.env.GITHUB_TOKEN`.
- [ ] Añadir `GITHUB_TOKEN` en Vercel (Environment Variables).
- [ ] Cambiar `triggerGitHubAction` en `airtableProspecting.ts` para que llame a `/api/trigger-prospecting` en vez de a la API de GitHub.
- [ ] Deploy en Vercel y probar una prospección; verificar run en GitHub Actions y estado del job en la UI.

---

*Documento creado para aplicar la corrección Prospecting desde el ordenador del trabajo. Renombrar el archivo si se desea.*
