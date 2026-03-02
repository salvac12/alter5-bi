# Proximos Pasos — Alter5 BI
**Sesion:** 2 de marzo de 2026
**Contexto:** Se ha implementado el Cerebro AI (v1.7.0) y necesita testing en produccion.

---

## 1. Probar el Cerebro AI en produccion

Una vez desplegado en Vercel (el push de este commit activa auto-deploy):

### Requisitos
- `VITE_GEMINI_API_KEY` configurada en Vercel (ya deberia estar)
- `VITE_AIRTABLE_PAT` configurada en Vercel (necesaria para la knowledge base)

### Tests sugeridos
1. Abrir el dashboard en Vercel
2. Pulsar el boton "Cerebro" en la barra de navegacion (vista Empresas)
3. Probar queries como:
   - "Term sheets enviados" (deberia devolver 100+ empresas)
   - "Developers sin contacto 1 ano"
   - "Empresas con proyectos BESS"
   - "IPPs mas activos"
   - "Fondos interesados en deuda"
4. Verificar que:
   - Las tarjetas de empresas aparecen correctamente
   - Click en una tarjeta abre su ficha detallada
   - La respuesta de Gemini es coherente y en espanol
   - Los botones de feedback (thumbs up/down) funcionan
5. Ir a Airtable -> tabla `Cerebro-Knowledge` y verificar que las consultas se han guardado

### Si algo falla
- **"API key de Gemini no configurada"**: falta `VITE_GEMINI_API_KEY` en Vercel env vars
- **No se guardan en Airtable**: falta `VITE_AIRTABLE_PAT` o el token no tiene scope `data.records:write`
- **0 resultados**: revisar que el query tiene palabras significativas (no solo stop words)
- **Error de Gemini**: verificar que el modelo `gemini-2.5-flash` esta disponible con tu API key

---

## 2. Lo que se hizo en esta sesion (resumen)

### Cerebro AI — Busqueda inteligente (NUEVO)
- **`src/components/CerebroSearch.jsx`** — Overlay modal completo con:
  - Input de texto + boton buscar + Enter para enviar
  - 6 ejemplos clickables como chips
  - Spinner de carga con contador de empresas
  - Grid de tarjetas de empresas clickables (nombre, subtipo, estado, emails, fase)
  - Botones de feedback (thumbs up/down) con estado visual
  - Escape para cerrar

- **`src/utils/gemini.js`** — Funcion `queryCerebro()` con 4 fases:
  1. Keyword extraction: normaliza acentos, filtra 140+ stop words, stemming de plurales
  2. Knowledge retrieval: busca Q&A relevantes en Airtable
  3. Gemini analysis: envia top 50 empresas + contexto previo a Gemini 2.5 Flash
  4. Knowledge save: guarda pregunta + respuesta en Airtable (asincrono)

- **`src/utils/airtableCerebro.js`** — Cliente REST para tabla `Cerebro-Knowledge`:
  - `fetchAllKnowledge()` con cache en memoria (TTL 5 min)
  - `fetchRelevantKnowledge(keywords)` con scoring por overlap de keywords
  - `saveKnowledge()` fire-and-forget
  - `updateFeedback()` para thumbs up/down

- **`scripts/create_cerebro_table.py`** — Script one-shot para crear tabla en Airtable (YA EJECUTADO)
  - Tabla creada: `Cerebro-Knowledge` (ID: `tbliZ7zNci5TUCAhj`)
  - 8 campos: Question, Answer, Keywords, MatchedDomains, MatchCount, Useful, NotUseful, CreatedAt

- **`src/App.jsx`** — Boton "Cerebro" en nav bar + estado + modal

### Problemas resueltos durante la sesion
1. **Solo 1 resultado** para "term sheets": stop words insuficientes, "dame", "lista", "empresas" contaminaban la busqueda
2. **Solo 3 resultados**: el pipeline solo devolvia empresas mencionadas por Gemini. Corregido: devuelve TODAS las coincidencias de keyword search
3. **Airtable 403**: PAT sin scope `schema.bases:write`. Resuelto creando nuevo token

---

## 3. Mejoras futuras del Cerebro

### Corto plazo
- [ ] Mejorar stemming espanol (actualmente solo maneja plurales con -s/-es)
- [ ] Anadir busqueda fuzzy (tolerancia a typos)
- [ ] Permitir busqueda desde cualquier vista (no solo Empresas)
- [ ] Atajo de teclado global (Cmd+K) para abrir el Cerebro

### Medio plazo
- [ ] Captura de metadatos de adjuntos en el pipeline Gmail (attachments filename, MIME type)
- [ ] Busqueda semantica con embeddings (en vez de keyword matching puro)
- [ ] Dashboard de analytics de uso del Cerebro (queries mas frecuentes, satisfaction rate)

### Largo plazo
- [ ] Lectura de contenido de adjuntos (PDFs, Excel) via Document AI
- [ ] Integracion con Prospects/Pipeline (buscar tambien en deals activos)
- [ ] Asistente conversacional (multi-turn, refinamiento de queries)

---

## 4. Otros pendientes (pre-existentes)

- [ ] Procesar Market Roles en Colab con Gemini
- [ ] Analisis enriquecido v2 para Salvador
- [ ] Commitear `api/fetch-gdoc.js`
- [ ] Renovar `AIRTABLE_PAT` en GitHub Secrets
- [ ] Adaptar lectura de Tasks en `normalizeProspect`
- [ ] Graficos de distribucion (sector, subtipo, fase)

---

**Para continuar la sesion:** abre este archivo y sigue los pasos en orden. El Cerebro ya esta implementado y commiteado, solo falta probar en produccion.
