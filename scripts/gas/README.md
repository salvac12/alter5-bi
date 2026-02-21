# Setup: Google Apps Script + Google Sheet

## 1. Crear la Google Sheet

1. Crear una nueva Google Sheet llamada **alter5-bi-pipeline**
2. Crear 3 tabs:

### Tab `raw_emails`
Añadir estos headers en la fila 1:
```
processed | employee_id | thread_date | from_email | from_name | from_domain | subject | body_snippet | thread_id
```

### Tab `config`
Añadir estos valores iniciales:
```
key                      | value
lastScanDate_salvador    | 2026-02-18T00:00:00Z
lastScanDate_leticia     | 2026-02-18T00:00:00Z
```

### Tab `ai_classifications`
Añadir estos headers en la fila 1:
```
timestamp | domain | sector | relType | source
```

## 2. Service Account (para GitHub Actions)

1. Ir a [Google Cloud Console](https://console.cloud.google.com)
2. Crear un proyecto (o usar uno existente)
3. Habilitar la **Google Sheets API**
4. Crear una **Service Account** en IAM & Admin > Service Accounts
5. Descargar la clave JSON
6. Compartir la Google Sheet con el email de la service account (permisos de **Editor**)

## 3. Gemini API Key

1. Ir a [Google AI Studio](https://aistudio.google.com/apikey)
2. Crear una API key
3. El tier gratuito permite 15 requests/minuto (suficiente)

## 4. GitHub Secrets

En el repo de GitHub, ir a Settings > Secrets and variables > Actions y crear:

| Secret | Valor |
|--------|-------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Contenido completo del JSON de la service account |
| `GEMINI_API_KEY` | La API key de Google AI Studio |
| `GOOGLE_SHEET_ID` | El ID de la Sheet (parte de la URL entre `/d/` y `/edit`) |

## 5. Google Apps Script

1. Ir a [script.google.com](https://script.google.com)
2. Crear un nuevo proyecto
3. Copiar el contenido de `scanMailboxes.gs` en el editor
4. En **Project Settings > Script Properties**, configurar:
   - `GITHUB_PAT`: Un Personal Access Token de GitHub con scope `workflow`
   - `GITHUB_REPO`: `usuario/alter5-bi` (reemplazar con el repo real)
5. En **Triggers** (reloj en la barra lateral):
   - Crear trigger: `scanMailboxes`, time-based, diario, 03:00-04:00

## 6. Gmail de Leticia (opcional)

Para acceder al Gmail de Leticia desde GAS hay dos opciones:

### Opcion A: Delegacion de dominio (recomendada)
1. En Google Workspace Admin > Security > API Controls > Domain-wide Delegation
2. Autorizar la service account con scope `https://www.googleapis.com/auth/gmail.readonly`
3. En el GAS, usar `GmailApp` impersonando a Leticia via la Gmail API

### Opcion B: OAuth2 Library en GAS
1. Instalar la libreria OAuth2 en el proyecto GAS
2. Configurar credenciales OAuth2 para la cuenta de Leticia
3. Almacenar el refresh token en Script Properties

## Verificacion

1. Ejecutar `scanMailboxes` manualmente en el editor de GAS
2. Verificar que aparecen filas "pending" en el tab `raw_emails`
3. Ejecutar `workflow_dispatch` en GitHub Actions
4. Verificar que el dashboard se actualiza tras el deploy de Vercel
