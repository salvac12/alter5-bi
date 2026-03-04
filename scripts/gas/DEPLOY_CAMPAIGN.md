# Deploy: Campaign Backend (Google Apps Script)

## Prerequisitos
- Cuenta Google con acceso a Google Apps Script
- Acceso al proyecto Vercel de alter5-bi

## Pasos

### 1. Crear Google Sheet
1. Ir a [sheets.google.com](https://sheets.google.com) → nuevo spreadsheet
2. Renombrar a **"Alter5 Campaign Backend"**
3. Anotar la URL (no necesitas el ID manualmente, el script lo detecta automáticamente)

### 2. Crear el script GAS
1. En la hoja, ir a **Extensiones → Apps Script**
2. Borrar el contenido de `Code.gs`
3. Copiar todo el contenido de `scripts/gas/campaignBackend.gs` y pegarlo
4. Guardar (Ctrl+S)

### 3. Configurar autenticación
1. En Apps Script, ir a **Configuración del proyecto** (icono engranaje izquierda)
2. Scroll hasta **Propiedades del script** → **Añadir propiedad del script**
3. Crear:
   - **Propiedad:** `API_TOKEN`
   - **Valor:** un string aleatorio seguro (ej: `openssl rand -hex 32` en terminal)
4. Guardar — este valor será `GAS_API_TOKEN` en Vercel

### 4. Deploy como Web App
1. Clic en **Implementar** → **Nueva implementación**
2. Tipo: **App web**
3. Configurar:
   - **Descripción:** Campaign Backend v1
   - **Ejecutar como:** Yo (tu cuenta)
   - **Quién tiene acceso:** Cualquier persona
4. Clic **Implementar**
5. **Autorizar** los permisos (Gmail + Sheets)
6. **Copiar la URL** del deploy (formato: `https://script.google.com/macros/s/XXXX/exec`)

### 5. Configurar env vars en Vercel
Ir a [Vercel Dashboard](https://vercel.com) → alter5-bi → Settings → Environment Variables.

Añadir estas 3 variables (scope: Production + Preview):

| Variable | Valor |
|----------|-------|
| `GAS_WEB_APP_URL` | La URL del deploy del paso 4 |
| `GAS_API_TOKEN` | El mismo valor del `API_TOKEN` del paso 3 |
| `CAMPAIGN_PROXY_SECRET` | Otro string aleatorio (ej: `openssl rand -hex 16`) |

### 6. Configurar env var en cliente
En tu `.env` local (o en Vercel como env var con prefijo VITE_):

| Variable | Valor |
|----------|-------|
| `VITE_CAMPAIGN_PROXY_SECRET` | El mismo valor de `CAMPAIGN_PROXY_SECRET` del paso 5 |

### 7. Redeploy
- Si añadiste las env vars en Vercel, haz un redeploy:
  ```bash
  vercel --prod
  # o simplemente push a main para trigger automático
  ```

## Verificación

### Test rápido desde terminal
```bash
# Reemplazar con tus valores reales
GAS_URL="https://script.google.com/macros/s/XXXX/exec"
TOKEN="tu-api-token"

# Test dashboard (debe devolver { contactos: [] })
curl -L -X POST "$GAS_URL" \
  -H "Content-Type: text/plain;charset=UTF-8" \
  -d "{\"action\":\"dashboard\",\"token\":\"$TOKEN\"}"

# Test getCampaigns (debe devolver { campaigns: [] })
curl -L -X POST "$GAS_URL" \
  -H "Content-Type: text/plain;charset=UTF-8" \
  -d "{\"action\":\"getCampaigns\",\"token\":\"$TOKEN\"}"
```

### Test desde la app
1. Abrir la app en Vercel (o `npm run preview`)
2. Ir al tab **Candidatas** → debe cargar sin error
3. Ir al tab **Campañas** → debe mostrar lista vacía
4. Aprobar empresas en Candidatas → Crear campaña → verificar que aparece en Google Sheets

## Troubleshooting

### "GAS_WEB_APP_URL not configured"
Falta la env var en Vercel. Añádela y redeploy.

### "Unauthorized" desde GAS
El `GAS_API_TOKEN` en Vercel no coincide con `API_TOKEN` en Script Properties.

### "Invalid proxy secret"
El `VITE_CAMPAIGN_PROXY_SECRET` en el cliente no coincide con `CAMPAIGN_PROXY_SECRET` en Vercel.

### Los sheets no se crean
La primera vez que se llama a cualquier acción, los tabs se crean automáticamente. Si no aparecen, verifica que el script tiene permisos sobre la hoja.

### Errores de Gmail al enviar
- Verifica que la cuenta tiene acceso a Gmail API
- Cuota Gmail: ~100 emails/día para cuentas gratuitas, ~2000 para Workspace
- El campo `from` en `GmailApp.sendEmail` debe ser un alias configurado en Gmail

### Actualizar el script
Después de editar `campaignBackend.gs`:
1. Copiar el nuevo código a Apps Script
2. Ir a **Implementar** → **Gestionar implementaciones**
3. Editar la implementación activa → **Nueva versión**
4. **Implementar**
