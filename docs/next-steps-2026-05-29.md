# Punto de situación — scan_mailboxes + clasificación (2026-05-29)

## Estado actual

### scan_mailboxes (workflow `scan-mailboxes.yml`)

| Item | Estado |
|---|---|
| Cron diario | ✅ NO crashea (PR #21 + #22 mergeados) |
| Buzón Leticia | ❌ Sigue saltado con `::error::` tras 2 pasadas |
| `save_scan_state` en finally | ✅ Avance parcial preservado |
| Callback de batch ya no traga 429 | ✅ |

**Bug pendiente confirmado en log del run `26621100683` (29-may 06:04 UTC):**

```
[retry 1/3] list:leticia.menendez@alter-5.com: status=429, sleep 2.1s
[retry 2/3] list:leticia.menendez@alter-5.com: status=429, sleep 4.4s
[pasada 1] fallo: ... Retry after 2026-05-29T06:19:54.044Z ...
```

Los sleeps de 2.1s y 4.4s son **backoff exponencial**, no los 900s del Retry-After. Significa que `_parse_retry_after()` (`scripts/scan_mailboxes.py:62-84`) está fallando y cayendo al fallback exponencial.

**Causa raíz**: la regex `rb"Retry after (\S+)"` con `\S+` greedy captura caracteres no-whitespace adyacentes al ISO timestamp. El error body real es:

```
User-rate limit exceeded.  Retry after 2026-05-29T06:19:54.044Z". Details:
```

`\S+` captura `2026-05-29T06:19:54.044Z".` (con la comilla y el punto). `datetime.fromisoformat` falla → `_parse_retry_after` devuelve `None` → fallback exponencial → raise tras 3 attempts.

### Clasificación (`classify_and_enrich` paso 7/9)

| Item | Estado |
|---|---|
| Solo clasifica **dominios nuevos** | ✅ funciona |
| **No reclasifica** empresas existentes con más actividad | ❌ |
| Contexto Gemini: solo subjects + snippets cortos | ⚠️ pobre vs pipeline antiguo de Sheet |
| Sin retry/backoff en llamadas Gemini | ⚠️ fallo de batch → default `Other` para todo el batch |
| Sin audit trail de clasificaciones | ❌ (pipeline Sheet sí lo tiene) |

---

## Issue 1 — Fix Retry-After parsing (PRIORIDAD ALTA)

### 1.1. Arreglar `_parse_retry_after` regex

**Archivo**: `scripts/scan_mailboxes.py:48-84`.

Cambiar la regex del body de:
```python
match = re.search(rb"Retry after (\S+)", content)
```
a un patrón que capture solo caracteres válidos de ISO 8601:
```python
match = re.search(
    rb"Retry after\s+[\"']?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z?)",
    content,
)
```

Tras `decode()`:
- Reemplazar `Z` final por `+00:00` (no añadir `+00:00` ciegamente — si ya tiene offset, romperíamos el parseo).
- Loguear el valor parseado cuando se entre al sleep (visibilidad operativa).

### 1.2. Estrategia anti-timeout: defer dinámico

`max_wait=900s` y `max_attempts=3` worst-case son `3 × 900s = 45min` por mailbox. Si fallan los 7 mailboxes con waits largos en dos pasadas, supera el `timeout-minutes: 60` del workflow.

**Recomendación**: si el Retry-After parseado es > 120-180s, **NO dormir inline**. Marcar el mailbox como diferido y procesarlo al final del loop. Solo dormir si:
- Todos los demás ya están procesados, y
- El tiempo restante hasta el Retry-After cabe en el budget del job.

Implementación esquemática (no escrita aún, pendiente de aprobación):

```python
def scan_with_defer(mailbox, ...):
    try:
        return scan_mailbox(...)
    except HttpError as e:
        if e.resp.status == 429:
            parsed = _parse_retry_after(e)
            if parsed and parsed > 180:
                raise DeferUntil(parsed, mailbox)  # custom exception
        raise

# En main():
# Pasada 1: cualquier DeferUntil → diferido[mailbox] = parsed_retry_after
# Tras pasada 1: ordenar diferidos por tiempo, dormir hasta el primero, procesar uno a uno
```

### 1.3. Decisión adicional: cambiar el cron

Si tras arreglar la regex, Leticia sigue recibiendo Retry-After largos, ese mailbox compite con otro automatismo en la misma ventana. Hipótesis: Mastra Email Agent en producción (Pub/Sub watch + `history.list` post-notificación) sobre la misma cuenta delegada.

Acciones:
- Mover cron de `0 2 * * *` a `0 5 * * *` (07:00 Madrid) y verificar si desaparece el 429.
- Si persiste, separar SA / proyecto GCP entre Mastra y el scanner.

---

## Issue 2 — Clasificación: análisis y próximos pasos

### 2.1. Cómo funciona hoy

`classify_domains_with_gemini` en `scripts/process_sheet_emails.py:455-697`:

- **Cascada**: Airtable `Verified-Companies` → `config/known_companies.json` → Gemini.
- **Modelo**: `gemini-2.5-flash` por defecto, batch size 6, 4.5s entre llamadas.
- **Prompt** pide: role, segment, type, activities, tech, geography, market roles, productos potenciales, key signals, fase comercial.
- **Output**: enrichment con campos compactos `_tv`, `role`, `seg`, `tp2`, `act`, `tech`, `geo`, `mr`, `grp`, `tp`, `pp`, `sc`, `fc`.
- **Audit trail**: en pipeline Sheet hay `ai_classifications` (línea 352-369), pero `scan_mailboxes` NO lo escribe.

`scan_mailboxes` solo clasifica **dominios nuevos** detectados en el run (`new_domain_keys` de `apply_to_companies`). Empresas ya conocidas que reciben emails nuevos NO se reclasifican aunque cambien de fase.

### 2.2. Propuestas concretas (CEO Alter5 — boutique M&A / Project Finance)

**Pri 1 — Reclasificar existentes que cambian fase**

Port de la heurística que ya existe en `process_sheet_emails.py:1088-1101`:
- Si `enrichment` falta o `role == "No relevante"` o `tp == "Other"`.
- Si el delta de emails desde la última clasificación supera un umbral (ej. +5 emails o +30%).
- Si han pasado >90 días desde la última clasificación.

→ Llamar `classify_and_enrich` también con esos dominios en step 7/9.

**Pri 2 — Mejorar la señal del prompt**

El prompt actual mezcla "qué es la empresa" con "qué hablan con Alter5". Separar en dos pasadas:

1. **What they are**: identificar empresa (sector, geo, tamaño, market role default).
2. **What's happening with Alter5**: usando `dated_subjects` recientes + dirección de email, inferir fase comercial (`fc`), producto encajable (`pp`), señales clave (`sc`).

Para dominios re-clasificados, pasar los últimos 10-20 `dated_subjects` y una sample de snippets recientes. Para top-N clientes/inversores, considerar fetch de bodies completos (`format="full"` en Gmail) solo para esos dominios.

**Pri 3 — Reliability de Gemini**

Hoy un batch fallido en `classify_domains_with_gemini` mete `Other` a los 6 dominios del batch (`process_sheet_emails.py:700-703`). Cambios:
- Retry/backoff con `Retry-After` similar al de `execute_with_retry` de Gmail.
- JSON extraction más robusta (regex `\{.*\}` + retry de parseo si truncado).
- Audit log en `data/ai_classifications.json` (o equivalente) con timestamp, modelo, prompt version y resultado — permite re-procesar histórico.

**Pri 4 — Verificación humana con grounding**

`scripts/verify_classifications.py` usa Gemini con Google Search grounding y escribe a Airtable `Verified-Companies`. Estos sobrescriben Gemini en clasificación normal.

→ Ejecutar `verify_classifications.py --top 200` mensualmente sobre los dominios con más interacciones. Coste: ~$0.035 × query × 200 = ~$7/mes.

### 2.3. Decisiones que necesito de Salva

Antes de implementar issue 2, preguntar:
1. ¿Vale la pena reclasificar empresas existentes en cada cron? (Coste Gemini ~$0.001/dominio × N dominios reclasificados).
2. ¿Empezamos por top-N (ej. top 50 clientes/inversores) o batch grande (~500)?
3. ¿Quieres separar "qué es" vs "qué hablan" en dos llamadas Gemini, o lo dejamos junto?
4. ¿Audit trail en JSON file vs DynamoDB / RDS?

---

## Verification tasks pendientes

Una vez aplicados los fixes:

- [ ] Test unitario sobre `_parse_retry_after` con: header integer, header HTTP-date, body con quote+period adyacente, body sin Z, body unparseable, timestamp pasado.
- [ ] Simular `HttpError` con body real del log y verificar que `execute_with_retry` toma path de Retry-After parseado.
- [ ] `gh workflow run scan-mailboxes.yml -R salvac12/alter5-bi -f days=1`: verificar log de Leticia muestra `sleep 900.0s` o `[deferred]`, NO `sleep 2.xs`.
- [ ] `config/scan_state.json`: confirmar que mailboxes saltados no avanzan timestamp.
- [ ] Sample 20 empresas top-interaction antes/después: verificar `pp`, `sc`, `fc` accionables.

## Follow-ups opcionales

- Split scan-mailboxes, scan-calendars, sync-airtable en workflows separados (evitar que un wait de Gmail mate todo).
- Añadir `concurrency:` al workflow para evitar runs solapados.
- Crear `docs/classification-playbook.md` con definiciones de negocio de cada campo (`role`, `mr`, `pp`, `sc`, `fc`) y ejemplos.
- `scripts/backfill_classifications.py --top N` para reclasificación controlada tras cambios de prompt.

## Cómo continuar

Desde otro ordenador:
```bash
cd <path>/alter5-bi
git pull origin main
cat docs/next-steps-2026-05-29.md
```

Empezar por Issue 1 (fix regex) — bloquea el scan completo de Leticia y es trivial. Issue 2 (clasificación) requiere las decisiones de la sección 2.3.

PRs previos: #21 (https://github.com/salvac12/alter5-bi/pull/21) y #22 (https://github.com/salvac12/alter5-bi/pull/22) ya mergeados.
