# Audit Commit 3 (pre-Rev411) — Writes propagate rejection (audit #2 / fix J)

Fecha: 2026-10-04
Autor: Claude Opus 4.7
Contexto: continuación del plan post-sea-trial 2026-10-03. Carlos
confirmó Commit 2 (Rev410) con "todo OK; creo" + items U.2/U.3
pendientes de agua. Toca Commit 3 — fix J del audit Rev407.

Este MD es el audit previo a cualquier edición de código (regla
`feedback_audit_before_fix`).

---

## Qué dice el audit original

De `docs/_audit_vt_pre_rev407.md`:

> **J. `/raw` endpoint devuelve 200 OK sin confirmar pypilot [CONFIRMADO
> audit externa]**
> - `src/index.ts:1717` — ignora el booleano de `client.set()`.
> - Si pypilot core no está procesando órdenes pero el socket sigue
>   vivo, `/raw` responde ok y el visor cree que llegó.
> - Impacto: nudges del visor pueden silently fallar. También setTarget
>   del visor via SK v2 API (ver línea 4998).
> - **Fix:** propagar false→500 o payload de error claro.

---

## Mapa del problema HOY

### 1. `client.set(name, value): boolean` ([src/pypilot-client.ts:328](src/pypilot-client.ts#L328-L368))

Devuelve `false` (ya está bien diseñado) en:
- `allowWrites` disabled por config (Rev271 R05).
- `coreOffline` (pypilot core reportó offline, Rev271 R03).
- socket desconectado (Rev254).
- último pong > 5 s (Rev257/Rev277 — zombie detection).
- excepción al emitir.

Y `true` sólo cuando el `socket.emit` salió sin tirar.

### 2. Call-sites que SÍ propagan (ya correctos)

- `_setWithRetry` ([src/autopilot-provider.ts:392-406](src/autopilot-provider.ts#L392-L406)): 3 intentos con backoff, devuelve boolean final.
- `setMode` ([src/autopilot-provider.ts:535-540](src/autopilot-provider.ts#L535-L540)): si `_setWithRetry` falla, lanza `"pypilot offline: mode change not delivered"`.
- `setTarget` ([src/autopilot-provider.ts:644-649](src/autopilot-provider.ts#L644-L649)): idem con `"pypilot offline: target not delivered"`.
- `adjustTarget` ([src/autopilot-provider.ts:686-691](src/autopilot-provider.ts#L686-L691)): idem.
- `setState` (engage/disengage, Rev351 revierte optimist).

→ El camino **VT** está cubierto: cualquier `setMode`/`setTarget` que
falle dentro de `_runVirtualTack` lanza y entra en el catch
→ `setPhase("failed")` con `outcomeReason` descriptivo (ya aprovechado
por el toast U.3 de Rev410).

### 3. Call-sites que NO propagan (bug J real)

#### 3.1 — PRIORIDAD 1 (safety-critical, endpoints HTTP)

- **`PUT /raw`** ([src/index.ts:1717](src/index.ts#L1717)):
  ```ts
  client.set(name, value);
  res.json({ ok: true, name, value });
  ```
  Impacto: el visor usa `/raw` para nudges (ap.heading_command delta),
  profile switch, gain writes, dodge, tack-begin (interceptado por VT
  si procede). Si pypilot está offline, el visor cree que llegaron.

- **PUT handler SK v2 API** ([src/index.ts:5006](src/index.ts#L5006)):
  ```ts
  client.set(name, value);
  return { state: "COMPLETED", statusCode: 200 };
  ```
  Impacto: KIP y cualquier cliente SK v2 escriben por aquí (nudge
  target, mode changes, etc.). Mismo problema.

#### 3.2 — PRIORIDAD 2 (fallbacks /ap/* sin apProvider)

Cuando `absorbProvider` está OFF, los endpoints `/ap/engage`,
`/ap/disengage`, `/ap/mode`, `/ap/target` caen a:

- Línea [1741](src/index.ts#L1741): `client.set("ap.enabled", true)`
- Línea [1754](src/index.ts#L1754): `client.set("ap.enabled", false)`
- Línea [1769](src/index.ts#L1769): `client.set("ap.mode", value)`
- Línea [1784](src/index.ts#L1784): `client.set("ap.heading_command", rad * 180 / Math.PI)`

Todos ignoran el boolean y responden `{ ok: true }`.

Impacto: ruta rara (sólo cuando absorbProvider=false, que no es el
default en Tunatunes), pero coherencia manda.

#### 3.3 — PRIORIDAD 3 (fire-and-forget conscientes, DEJAR como están)

- Línea [4016](src/index.ts#L4016): `ap.heading_command` del gust-FF re-anchor. Hoy ya en try/catch silent.
- Línea [4030](src/index.ts#L4030): hot-gain write. Silent intencional.
- Línea [4071-4077](src/index.ts#L4071-L4077): gust FF freeze. Silent intencional.
- Línea [4103](src/index.ts#L4103): gust heavy restore. Silent intencional.
- Línea [2682](src/index.ts#L2682), [3973](src/index.ts#L3973): profile change (ya en try/catch, los errores se logean).

Estos son "best-effort" por diseño — una gust-FF que no llega no
debería colgar la UI; el gust-FF se vuelve a intentar al próximo tick.

#### 3.4 — PRIORIDAD 4 (handlers legacy duplicados — fuera de scope)

Líneas [5073](src/index.ts#L5073), [5095](src/index.ts#L5095),
[5109](src/index.ts#L5109), [5117-5118](src/index.ts#L5117),
[5178](src/index.ts#L5178), [5192](src/index.ts#L5192),
[5201-5202](src/index.ts#L5201), [5248](src/index.ts#L5248),
[5346](src/index.ts#L5346), [5361-5362](src/index.ts#L5361),
[5367](src/index.ts#L5367): múltiples handlers legacy (pre-apProvider
y pre-SK-v2). Son writes directos sin confirmar.

→ Fuera de scope de Commit 3. Si Carlos los usa (dudoso), los
cubriría un Commit 3.5 posterior después de confirmar que no son
código muerto.

### 4. Caso aparte — `dodge` ([src/autopilot-provider.ts:1351](src/autopilot-provider.ts#L1351))

`this.client.set("servo.command", -sign)` sin boolean check. El
`dodge` lo llama la provider API cuando el sailor toca "dodge port /
starboard" en KIP. Hoy devuelve el Promise<void> sin feedback.

→ Lo meto en PRIORIDAD 1.5 por safety: un dodge que no llega durante
una maniobra evasiva es grave.

---

## Scope de Commit 3

| Call-site | Prio | Cambio | Riesgo |
|-----------|------|--------|--------|
| `/raw` 1717 | 1 | `if (!client.set(...)) return 503 { error, name, value }` | bajo |
| SK v2 PUT 5006 | 1 | `if (!client.set(...)) return { state: "COMPLETED", statusCode: 503, message }` | bajo |
| `/ap/engage` 1741 | 2 | `if (!client.set(...)) return 503` | bajo |
| `/ap/disengage` 1754 | 2 | idem | bajo |
| `/ap/mode` 1769 | 2 | idem | bajo |
| `/ap/target` 1784 | 2 | idem | bajo |
| dodge 1351 | 1.5 | si `!client.set(...)` lanza para que caller lo vea | medio |

Fuera de scope en este commit:
- Handlers 5073+ (código legacy no auditado — Commit 3.5 si Carlos los
  usa).
- Gust FF / hot-gains / profile writes "best-effort" (dejar silent).

Rev target: Rev411. Build + deploy al Pi + QA Rev411 numerado.

### Formato de respuesta HTTP uniforme

Para los endpoints HTTP, cuando `client.set` devuelve false:

```json
{
  "ok": false,
  "error": "pypilot write refused",
  "name": "<path>",
  "value": <value>,
  "reason": "offline | no-pong | writes-disabled"
}
```

No tenemos el motivo exacto desde el boolean (sólo `client.set` lo
sabe). Opciones:
- **A — Genérico**: devolver `"pypilot write refused"` sin motivo.
- **B — Exponer motivo**: añadir `client.getLastSetFailureReason()`
  que retorne el último `log("warn", ...)` de set.

Yo voto **A** por simplicidad. Si Carlos quiere diagnosticar en el
visor, se mira `/status` que ya expone `coreOffline`, `connected` y
`lastPongMs`.

---

## Preguntas abiertas para Carlos

1. ¿Scope "Prio 1 + 1.5 + 2" o solo "Prio 1" (dejar `/ap/*` fallbacks
   para después)? Yo voto **Prio 1 + 1.5 + 2** — es coherente y no
   añade complejidad.
2. ¿Payload de error "A genérico" o "B con reason"? Yo voto **A**.
3. En `/raw` el visor tiene call-sites `.catch(e => ...)` o
   `fetch(...)` sin check de `response.ok`? Si el visor consume 503
   como "falló", funciona ya. Si ignora, hay que mirar los
   call-sites antes de romper comportamiento. **Hay que grep para
   confirmar que el visor usa `response.ok` antes de celebrar éxito**.
