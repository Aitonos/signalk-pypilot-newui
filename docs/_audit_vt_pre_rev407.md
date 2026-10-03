# Auditoría Virtual Tack + Aproado/Empopado — pre-Rev407

**Fuente:** lectura completa de `src/autopilot-provider.ts` y flows adyacentes del visor. Cruzado con los hallazgos de Gemini, Codex (vespertino + matutino) y el sea trial 2026-10-03. Mi lista aspira a ser más completa que la de ellos.

---

## Backend — `_runVirtualTack` (`src/autopilot-provider.ts:789-1120`)

### A. Timeout 20s por step mata maniobras que progresan [CONFIRMADO sea trial]
- `src/virtual-tack.ts:100` → `DEFAULT_PHASE1_STEP_TIMEOUT_MS = 20_000`
- `src/autopilot-provider.ts:957` → `if (Date.now() - stepStart > DEFAULT_PHASE1_STEP_TIMEOUT_MS) throw`
- Sea trial: todas las viradas abortaron aunque `remain` bajaba de 170° a 20°-66° (barco rotando correctamente, lo iba a conseguir).
- **Decisión Carlos:** quitar el timeout de rotación. Reemplazarlo por watchdog de "pypilot colgado" (sin cambio de `ap.heading` en N segundos) + cancel manual explícito.

### B. Fuente de heading inconsistente al iniciar vs durante [CONFIRMADO audit externa, Codex]
- Al arrancar (líneas 802-825): cascade `navigation.headingTrue` → `navigation.headingMagnetic` → `ap.heading` → `imu.heading`.
- Durante el loop de rotación (línea 945): **solo** `v["ap.heading"]`.
- Si al iniciar escoge SK bus (porque `ap.heading` no está disponible), al entrar al loop no detecta rotación porque pregunta por `ap.heading` que no existe. Timeout garantizado.
- **Fix:** encapsular la cascade en un helper `readHeadingRad()` y usarlo también dentro del loop.

### C. Settling declara "completed" por tiempo sin convergencia [CONFIRMADO audit externa]
- Líneas 1024-1028:
  ```ts
  if (Date.now() - settleStart > SETTLE_TIMEOUT_MS) {
    console.log(`[virtual-tack ${vtId}] settling timeout; declaring completed anyway`);
    break;
  }
  ```
- Si no hay `environment.wind.angleApparent`/`angleTrueWater` o si el AWA es ruidoso y nunca cae dentro de SETTLE_TOLERANCE_DEG (10°), tras 15s declara completed/ok.
- **Fix:** separar outcome en `completed` (dwell confirmado) vs `settling-timeout` (sin confirmar). O al menos marcarlo como `completed-timeout` con outcomeReason explícito.

### D. Cancelling restaura al ángulo original ciegamente [CONFIRMADO sea trial — "va donde le da la gana"]
- Línea 1067: `await this.setTarget(originalAngleRad)` desde dentro del catch.
- `originalAngleRad` = AWA/TWA target que había ANTES de la virada (ej. +78.4° wind target).
- Si el barco ya rotó 150° de los 200° que se le pidieron, está en un rumbo distinto. pypilot interpreta `setTarget` como "ve a este AWA" y elige el arco corto desde la posición actual. **El arco corto puede ser el camino inverso al que estaba girando, el camino que lleva a vuelta completa, o cruzar la zona de peligro**.
- **Decisión Carlos:** no restaurar. Dejar al barco en el rumbo actual. El sailor decide después.
- **Fix:** en el catch branch, hacer `setMode(compass)` + `setTarget(currentHeading)` → fija el rumbo actual como objetivo. Nada más.

### E. Falso success por heading faltante (startVirtualTack devuelve `{id:""}`) [CONFIRMADO audit externa]
- `_runVirtualTack` lanza `throw new Error("virtual-tack: heading not available ...")` en línea 824 **ANTES** de que se cree `this._virtualTack` (línea 841).
- `startVirtualTack` (línea 730) hace `this._runVirtualTack(...).catch(e => console.log(e))` → el error se traga.
- Línea 739-740: `id = this._virtualTack?.id ?? ""` → devuelve `{id:"", alreadyRunning:false, windMode}`.
- HTTP 200 OK con id vacío. El visor cree que arrancó, pero no hay FSM.
- **Fix:** validar heading + mode + engaged ANTES del fire-and-forget, dentro de `startVirtualTack`. Devolver 400 si falta precondición.

### F. `cancelVirtualTack()` puede ser sobrescrito por `setPhase()` [CONFIRMADO audit externa]
- `cancelVirtualTack` (línea 1126-1135) solo hace `this._virtualTack.phase = "cancelling"`.
- `setPhase` (línea 854-859) hace `this._virtualTack.phase = p` sin verificar la phase previa.
- Secuencia posible:
  1. Loop está en `await setMode(windMode)` fase handover.
  2. Carlos tap cancel → cancelVirtualTack → phase="cancelling".
  3. setMode termina.
  4. Línea 988: `setPhase("settling")` → **pisa "cancelling"**.
  5. Loop continúa como si no hubiera cancel.
- **Fix:** `setPhase` debe hacer `if (this._virtualTack.phase === "cancelling") return;` antes de escribir. O usar flag separada `_cancelRequested` + chequeo tras cada await.

### G. Falta lock de sesión por vtId tras awaits
- Después de cada `await`, no se comprueba que `this._virtualTack?.id === vtId`.
- Escenario: VT1 corriendo → cleanup del VT1 anterior tarda → otro `startVirtualTack` llega → se crea VT2 con nuevo id → el runner de VT1 sigue y escribe en VT2.
- Riesgo real: con los retries del visor (Rev399 mantuvo 10 reintentos), pueden llegar dos POST /start en 500ms. El primero crea VT2, el segundo lo detecta en línea 713-717 porque `terminal` no incluye phases activas. OK normalmente.
- Pero si el `_cleanup setTimeout` de otro VT previo compite con el nuevo runner, el `this._virtualTack = null` del cleanup podría disparar justo tras un await del runner nuevo. El `if (!this._virtualTack)` check lo captura solo si está presente.
- **Fix:** capturar `vtId` en una const al inicio y chequear `this._virtualTack?.id === vtId` tras cada await (además del null check).

### H. Tolerancia 20° con step 170° — step N+1 puede quedar a 190° (= arco corto va al CONTRARIO) [CONFIRMADO Codex]
- `DEFAULT_PHASE_TOLERANCE_DEG = 20` + `DEFAULT_MAX_STEP_DEG = 170`.
- Línea 952: considera step reached cuando `|hNow - stepTarget| < 20°`.
- Los intermediates se calculan ANTES del loop (línea 833, dentro de `computeTackGeometry`) desde el `hStart` inicial. Nunca se recomputan desde el heading REAL.
- Si barco está a 20° antes del step 0 (170°), pasa al step 1 (= hStart + 340°). Pero barco está a hStart + 150° real. Distancia a step 1 = 190°.
- pypilot elige arco corto = 170° **en dirección contraria** a la pedida.
- **Esto podría explicar "va al contrario" que Carlos reportó**.
- **Fix:** recomputar intermediates desde heading REAL cada vez que se completa un step. O verificar que el siguiente step está a menos de 180° y en la dirección correcta antes de aceptarlo.

### I. Restore target puede ser interpretado por pypilot como "ir por el lado contrario" [EFECTO del D]
- Caso real sea trial (T2, port, delta=-203°): barco rotó ~150°, al cancel está a +78° - 150° = -72° de AWA (approx).
- `setTarget(originalAngleRad)` escribe `+78.4°` como AWA target.
- pypilot ve AWA actual -72° → target +78° → delta +150° CW o -210° CCW → elige CW (arco corto).
- Barco rota CW otra vez (= mismo sentido que iba). Resultado: **rota 150° más** y acaba en el mismo rumbo original, pero rota 300° en total = casi vuelta completa.
- Carlos: "me acaba de hacer 360° de mirada".
- **Fix:** mismo que D — no restaurar, dejar en heading actual.

### J. `/raw` endpoint devuelve 200 OK sin confirmar pypilot [CONFIRMADO audit externa]
- `src/index.ts:1717` — ignora el booleano de `client.set()`.
- Si pypilot core no está procesando órdenes pero el socket sigue vivo, `/raw` responde ok y el visor cree que llegó.
- Impacto: nudges del visor pueden silently fallar. También setTarget del visor via SK v2 API (ver línea 4998).
- **Fix:** propagar false→500 o payload de error claro.

### K. `_vtInternalWrite` es shared mutable sin lock
- Línea 590: `private _vtInternalWrite = false;`
- Usado en setMode/setTarget guards (líneas 498, 599) y en el runner (líneas 915, 939, 974, 981, 1043, 1066).
- Si dos escrituras del runner solapan (ej. setMode disparado desde el catch mientras un setTarget del happy path aún no terminó), el `finally { this._vtInternalWrite = false }` del segundo puede desactivar el flag mientras el primero aún necesita el guard.
- En la práctica el flow es secuencial (await), así que probablemente no se solapa. Pero no está probado.
- **Fix de bajo riesgo:** contador (int) en vez de boolean.

### L. `waitForPypilotEcho` + `waitForPypilotNumericEcho` divergen en semántica
- `waitForPypilotEcho` (línea 870-883) **lanza** "virtual-tack cancelled" si `_virtualTack` es null.
- `waitForPypilotNumericEcho` (línea 888-904) **no lanza** por diseño (uso en cancel branch).
- Si el cleanup setTimeout nullea `_virtualTack` DURANTE el wait del happy path (improbable pero posible), el throw rompe el flow en un sitio raro.
- **Fix:** unificar semántica. Ambos helpers deberían comportarse igual.

---

## Backend — `startVirtualTack` (línea 706-741)

### M. Preconditions se comprueban PARCIALMENTE
- Línea 721: valida mode está en wind/true wind. OK.
- Línea 724: valida engaged. OK.
- **No** valida heading disponible (lo hace _runVirtualTack después → bug E).
- **No** valida `this.data.target != null` (lo hace _runVirtualTack después, línea 827).
- **Fix:** mover TODAS las precondiciones aquí. Devolver 400 si falta algo, no 200 con id vacío.

---

## Backend — `tack()` legacy (línea 743-775)

### N. Si pypilot está offline, legacy tack falla sin feedback claro
- Línea 774: `await this.setTarget(newRad)` — si pypilot rechaza, lanza desde setTarget.
- Llamador debe hacer catch. En `/raw` route (índice de origen) no se propaga (bug J).

---

## Backend — `setMode`, `setTarget`, `_reAnchorTargetAfterModeChange`

### O. Re-anchor fuerza target al heading ACTUAL en cambios compass↔wind [MOTIVO del "se vuelve loco"]
- Línea 568-583: en cambio de mode, llama `decideReAnchor` que devuelve el valor en el espacio nuevo.
- Al entrar a compass desde wind, re-anchor pone target=heading actual.
- Al salir de compass a wind, re-anchor pone target=AWA actual.
- **Problema**: en el flow VT, nosotros YA llamamos setMode(compass) para preparar + setTarget(intermediate). El re-anchor pisa nuestro intermediate con el heading actual ANTES de que escribamos.
- Secuencia:
  1. setMode(compass) → pypilot cambia modo.
  2. `_reAnchorTargetAfterModeChange(wind, compass)` → escribe heading_command = heading actual.
  3. Nuestro código espera echo con waitForPypilotEcho + luego setTarget(intermediate).
  4. **El echo del re-anchor es un setTarget en flight**. Compite con nuestro intermediate.
- Mira líneas 549-558 — el re-anchor se dispara DENTRO de `setMode`, antes del return.
- `_runVirtualTack` llama `setMode` con `this._vtInternalWrite = true` (línea 915). Pero `_reAnchorTargetAfterModeChange` escribe directamente `this.client.set("ap.heading_command", ...)` (línea 578), bypassing setTarget. Entonces el guard de FSM no lo bloquea.
- **Fix:** `_reAnchorTargetAfterModeChange` debe respetar el flag `_vtInternalWrite`. Si el VT está rotando, NO re-anchor.

---

## Backend — `cancelVirtualTack` (línea 1126-1135)

### P. Está solo. OK conceptualmente, pero vulnerable a F (setPhase pisa cancelling).

---

## Visor — flows aproado/empopado

**Pendiente leer** `empopadoFinish()` (línea ~7271 según audit externa) y `_empopadoApplyHotGains()` (línea 7183).

### Q. `_empopadoApplyHotGains` lee `catalog[path].value` en vez del cache [CONFIRMADO audit externa]
- Catalog contiene metadatos (min/max/type), no valores actuales.
- Resultado: aplica 0 ganancias. El modo empopado NO ajusta los PID como se esperaba.
- **Fix:** leer de `state.pypilotValues[path]` o similar cache de valores actuales.
- **Precaución Codex:** este fix activa ajustes de ganancia que hasta ahora no se aplicaban. Hay que validar que las ganancias calculadas tienen sentido. **Commit separado**.

### R. `empopadoFinish()` restaura automáticamente al target original [DECISIÓN Carlos: cambiar]
- Carlos: "nos quedamos en ese rumbo tras cualquier maniobra".
- **Fix:** eliminar la restauración automática del `empopadoFinish()`. Dejar al barco en el nuevo rumbo.
- Lo mismo para aproado si tiene lógica similar.

---

## Visor — handler `ap.tack.direction` del mando [BUG Carlos "va al revés"]

**Pendiente leer** el handler específico.

### S. Hipótesis: convención de dirección entre mando y FSM
- Rev383 estableció que `direction` en VT = **dirección a la que gira la proa** (no amura final).
- Mando físico puede estar enviando con la OTRA convención (= amura final).
- Si llega "port" entendido como "amura final a port" (= girar a starboard), el visor + FSM lo interpretan como "girar a port" → ejecución al revés.
- **Fix pendiente:** leer el handler del mando y los deltas que publica pypilot.

---

## Visor — HUD mando no muestra remainingDeg [CONFIRMADO audit externa, Codex]

### T. Mirror HUD para tacks externos (vía mando) solo muestra tiempo
- `app.js` línea ~4146 según Codex.
- No consume `remainingDeg` del snapshot VT. Pero los tacks via mando NO son VTs (son tacks nativos de pypilot en compass mode) — por eso no hay snapshot con remainingDeg.
- **Fix:** calcular remainingDeg desde `ap.heading` + `_tackPendingFinalTargetRad` capturado al inicio. O marcar explícitamente "sin datos" en lugar de solo tiempo.

---

## Visor — "pypilot silent" en modo compass [CONFIRMADO Codex]

### U. Watchdog usa "tiempo desde último cambio de `ap.tack.state`"
- `app.js` línea ~4408.
- Si `ap.tack.state` se queda en "tacking" sin cambios (porque pypilot sigue tackeando y no publica más deltas de un valor constante), el visor interpreta "silent" y cancela.
- Carlos: "aparentemente no hay ninguna caída de red ni nada" → pypilot está vivo, solo no publica deltas redundantes.
- **Fix:** cambiar el criterio. Usar health check real: ¿pypilot responde a /status? ¿llegan deltas de `ap.heading` (siempre cambia)? Si sí → pypilot está vivo aunque `ap.tack.state` no cambie.

---

## AWA dampened — pregunta Carlos

### V. ¿Qué path consume el visor para AWA?
- **Pendiente leer** `renderWindRose` y los paths de wind.
- Hipótesis: visor usa `environment.wind.angleApparent` (SK estándar, raw del sensor).
- Pypilot core expone también `wind.direction` (dampened?) y `wind.compass_direction` (TWD).
- **Investigar:** qué paths de pypilot están dampened. Posiblemente cambiar el visor a usar el valor dampened para el render Y para el calculo del final target del VT (`angleNewRad` en `computeTackGeometry`) para evitar que un salto AWA en el instante del TACK produzca un destino mal.

---

## Resumen de bugs CONFIRMADOS

| ID | Dónde | Severidad | Decisión Carlos | Fix propuesto |
|---|---|---|---|---|
| A | VT turning timeout 20s | 🔴 crítico | **Quitar timeout** | watchdog pypilot colgado + cancel manual |
| B | Heading source inconsistente | 🔴 crítico | fix | helper readHeadingRad() unificado |
| C | Settling declara completed por tiempo | 🟡 alto | fix | separar completed vs settling-timeout |
| D | Cancel restaura al original ciego | 🔴 crítico | **Dejar en rumbo actual** | setMode(compass)+setTarget(hNow) |
| E | startVirtualTack devuelve id="" sin heading | 🔴 crítico | fix | validar precond antes del fire-and-forget |
| F | cancelVirtualTack sobrescrito por setPhase | 🔴 crítico | fix | setPhase respeta "cancelling" |
| G | Falta lock por vtId tras awaits | 🟡 alto | fix | capturar vtId local + check tras await |
| H | Tolerancia 20° con step 170° → siguiente step a 190° (va al CONTRARIO) | 🔴 crítico | fix | recomputar intermediates desde heading real |
| I | Efecto D combinado con geometría = 360° de giro | 🔴 crítico | **cubierto por D** | - |
| J | /raw y PUT ignoran rechazo client.set() | 🟡 alto | fix | propagar false→500 |
| K | _vtInternalWrite bool compartido sin lock | 🟢 bajo | fix opcional | contador en vez de bool |
| L | waitForPypilotEcho/Numeric semánticas distintas | 🟢 bajo | fix opcional | unificar |
| M | startVirtualTack preconds parciales | 🟡 alto | **cubierto por E** | - |
| N | tack() legacy sin feedback de error | 🟢 bajo | fix opcional | propagar |
| O | re-anchor pisa el intermediate del VT | 🔴 crítico | fix | re-anchor respeta _vtInternalWrite |
| P | cancelVirtualTack vulnerable a F | - | cubierto por F | - |
| Q | _empopadoApplyHotGains lee catalog.value (metadatos) | 🟡 alto | fix (commit separado) | leer del cache de valores actuales |
| R | empopadoFinish restaura target automático | 🟡 alto | **Quitar restore** | nada, dejar en nuevo rumbo |
| S | Mando puede estar invirtiendo direction | 🔴 crítico | fix tras diagnóstico | instrumentar + fix |
| T | HUD mando sin remainingDeg | 🟢 bajo | fix | calcular desde heading + target captured |
| U | "pypilot silent" criterio malo | 🟡 alto | fix | health check real |
| V | AWA raw vs dampened | 🟡 alto | investigar + fix | usar dampened en visor + VT geometry |

---

## Hallazgos nuevos míos (no en Codex ni Gemini)

- **O (re-anchor pisa intermediate del VT)** — ni Codex ni Gemini lo marcaron. Es el bug que explica por qué pypilot "no se mueve en los primeros 1-2s del VT": el re-anchor escribe heading_command = heading actual (= no gira), y nuestro intermediate llega 1.5s después (tras waitForPypilotEcho ap.mode=compass). La ventana de 1.5s el barco está "quieto" en el heading actual porque el re-anchor acaba de pedírselo.
- **G (lock vtId)** — ni Codex ni Gemini lo marcaron explícitamente. Codex habla de "cancelación persistente" (= F) pero no de id-match.
- **K, L** — detalles finos.

## Hallazgos que Codex marcó y confirmo

- Audit matutina 1-6 todos reales (F, J, B, C, Q, E en mi tabla).

## Hallazgos que Gemini afirmó pero sin evidencia

- "Inversión lógica de signos" en handler mando (S) → Gemini especula sin leer el código. Yo marco S como pendiente de leer el handler.
- "AWA ruidoso → deadband + EMA" en aproado → Gemini aplica fix sin instrumentar. Codex lo pide, yo coincido con Codex.

---

## Plan Rev407 propuesto (orden)

### Commit 1 — Seguridad crítica (TODO en uno, no parches)
- Fix A: quitar timeout rotación. Añadir watchdog pypilot colgado (`ap.heading` sin cambio en 60s → abort con outcome="pypilot stuck").
- Fix B: helper `readHeadingRad()` unificado para iniciar + loop.
- Fix D: cancel branch deja al barco en heading actual (setMode compass + setTarget hNow). Sin restore wind original.
- Fix E: validar precond en startVirtualTack, devolver 400 si falla.
- Fix F: setPhase respeta "cancelling" (no pisa).
- Fix G: lock vtId tras cada await.
- Fix H: recomputar intermediates desde heading real tras cada step reached.
- Fix O: re-anchor respeta `_vtInternalWrite`.
- Fix R: empopadoFinish no restaura (visor).
- Tests nuevos para F, G, H.

### Commit 2 — Diagnóstico mando + HUD
- Fix S (instrumentación): log `ap.tack.direction` recibido vs ejecutado para el próximo trial.
- Fix T: HUD mando con remainingDeg calculado.
- Fix U: "pypilot silent" cambia criterio.

### Commit 3 — Writes propagar rechazo (audit #2)
- Fix J.

### Commit 4 — AWA dampened
- Fix V: investigar paths disponibles, cambiar visor + VT geometry para usar dampened.

### Commit 5 — Ganancias empopado (audit #5)
- Fix Q (separado por riesgo de activar ajustes no probados).

### Commit 6 — Settling / completed semántica
- Fix C: separar outcomes.

### Pendiente de investigar (no en commits aún)
- Aproado oscila: Codex pide instrumentar antes. Añadir logging de AWA target, AWA actual, salida servo, dwell timer.

---

## Lecturas pendientes — hecho

### `empopadoFinish()` (línea 7443-7489) [CONFIRMA R]
- Línea 7446: `restoreAll = !opts || opts.restoreAll !== false;` → default **true**.
- Líneas 7473-7486: si `restoreAll`, restaura mode + target + engaged del snapshot.
- Línea 7482: incluso restaura `apDisengage()` si estaba off antes.
- Decisión Carlos: default a **false** o eliminar bloque restore. El sailor decide.
- `empopadoTearDown()` (línea 7490+) tiene restoreAll default `false`, OK.

### `_empopadoApplyHotGains()` (línea 7179-7206) [CONFIRMA Q]
- Línea 7191-7192: `const entry = cat[t.path]; const cur = entry?.value;` → `cat` es `state.catalog` (metadatos del endpoint `/catalog`). `.value` **no existe** en el catálogo; el valor actual está en `state.pypilotValues[path]`.
- Línea 7193: `if (typeof cur !== "number") continue;` → todo entra en continue → **nunca aplica ganancias**.
- Línea 7205: `ap._hotGainSnapshot = applied = {};` → al terminar, snapshot vacío → `_empopadoRestoreHotGains` tampoco restaura nada (no hay nada que restaurar).
- Resultado: todo el flujo de "hot gains agresivos empopado" es un no-op desde que se escribió. **Nunca ha funcionado**.
- Fix: `const cur = state.pypilotValues?.[t.path];` + mantener uso de `cat` solo para `max`.

### Handler `ap.tack.direction` (línea 2791-2801) [S no es bug visor]
- Solo guarda en `_lastTackDirSeen` y emite trace. No pinta HUD aquí.
- `_lastTackDirSeen` se usa en el fallback cuando NO hay VT snapshot (línea 4078-4079).
- Si pypilot publica `ap.tack.direction = "port"` pero el barco gira a starboard, el visor pinta fielmente "port" aunque el barco va al revés.
- **El bug está upstream (pypilot core) o en la convención del mando físico**, no en el visor.
- Fix S actualizado: **solo instrumentación**. Añadir log al delta handler (ya existe `_mtLog`) + log al momento del tap del mando para capturar la secuencia completa en el próximo trial. No tocar lógica visor.

### `renderWindRose()` + paths AWA (línea 3352+) [V: visor usa raw del bus]
- Línea 2816-2817: `environment.wind.angleApparent` → `state.windAngle` (raw del sensor).
- Línea 2821-2822: `environment.wind.angleTrueWater` → `state.windAngleTrue`.
- Visor consume `state.windAngle` para todo (render, VT geometry fallback, aproado/empopado).
- **Pypilot core puede tener valores suavizados** (`wind.direction` tras filtro). No sabemos si SK los expone como path separado. Investigar en próxima sesión preguntando a Carlos qué keys ve en `/plugins/signalk-pypilot-newui/values` relacionadas con wind.
- Fix V actualizado: en Commit 4, (a) añadir dampening local al visor con EMA (τ≈2s) para `state.windAngle` → `state.windAngleDampened`, (b) usar `windAngleDampened` en renderWindRose y en el cálculo del `angleStartRad` que pasamos a `computeTackGeometry` al pulsar TACK. Mantener `state.windAngle` raw para quien lo necesite.

### Bug NUEVO — W

`_empopadoApplyHotGains` tiene flujo "fire-and-forget" con `.catch(() => {})` en línea 7358. Si el bug Q está activo (= siempre), los `applied` quedan `{}` pero el flow sigue como si todo bien. Al restaurar luego, `_empopadoRestoreHotGains` ve snap={} y no hace nada. **El sailor no recibe ningún feedback de que no se aplicaron las ganancias agresivas**. En un empopado con viento fuerte, esto es **peligroso** porque el sailor cree que tiene el pilot en modo "nervioso" pero sigue con PID normal.

- Fix W: ligado al Fix Q. Añadir warning si `applied` queda vacío + exponer en el HUD empopado si hot-gains están activos o no (badge visible).

---

## Resumen final — Rev407 Commit 1 (bloque grande)

Confirmado en el MD. Procedo a implementar con los bugs:

**Backend (`src/autopilot-provider.ts` + `src/virtual-tack.ts`)**:
- A: quitar timeout rotación, añadir watchdog pypilot (sin cambio heading en 60s)
- B: helper `readHeadingRad()` unificado
- D: cancel branch deja al barco en heading actual (setMode compass + setTarget hNow)
- E: validar heading + target null en `startVirtualTack` (devolver throw antes del fire-and-forget)
- F: `setPhase()` respeta "cancelling" (no pisa)
- G: lock vtId tras cada await
- H: recomputar intermediates desde heading real tras cada step reached
- O: `_reAnchorTargetAfterModeChange` respeta `_vtInternalWrite`

**Visor (`public/app.js`)**:
- R: `empopadoFinish()` default `restoreAll = false` (dejar en nuevo rumbo)
- También para el VT: cuando se complete, no restaurar (D ya cubre esto en cancel/failed)

**Tests nuevos**:
- F: cancelVirtualTack durante setMode no debe ser sobrescrito por setPhase posterior
- G: dos startVirtualTack rápidos — el segundo no debe heredar state del primero
- H: step N+1 recomputado desde heading real, no desde planeado

**Nota de seguridad para el QA del commit**:
Después del commit 1, el VT ya no restaura al wind target original. Si Carlos cancela, el barco se queda en el rumbo donde esté (compass fijo). Esto cambia radicalmente el flujo. **Carlos debe probar primero en muelle** con AP engaged + sin motor para ver el comportamiento, antes de llevar el commit a mar.
