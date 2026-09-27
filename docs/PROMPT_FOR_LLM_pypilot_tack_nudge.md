# Prompt para LLM externo (Gemini Pro / GPT-5)

Contexto: plugin SignalK para autopilot pypilot, con visor web propio. Iterando
sobre virada/trasluchada/nudge fallando en repeticiones rápidas. Necesito
análisis independiente + propuesta de fix.

Fecha: 2026-09-10. Rev vigente: Rev196. Node backend + vanilla JS frontend + SSE.

---

## 1. Arquitectura relevante

**Cadena de un tack:**
```
Visor (app.js)
   |  apSetTargetRad(newRad)   -> PUT /signalk/v2/api/vessels/self/autopilots/pypilot-newui/target
   v
SignalK Server (Autopilot API v2)
   |  invokes provider.toProviderInterface().setTarget(rad, id)
   v
AutopilotProvider (src/autopilot-provider.ts) -- our own, registered via absorbProvider
   |  data.target = rad; pendingTarget = { value: rad, until: now+2500ms }
   |  client.set("ap.heading_command", rad * 180/PI)
   |  notifyChanged("target") -> pushAutopilotUpdate("target") -> handleMessage()
   v
PypilotClient (src/pypilot-client.ts) -- socket.io TCP to pypilot_web on Pi Zero
   |  emit "pypilot" `${name}=${JSON.stringify(value)}`
   v
Pi Zero W (TinyPilot, 438MB RAM, ARMv6)  <-- physical rate limits unknown
   |  applies command, echoes ap.heading_command back through watchdog (~2 Hz)
   v
PypilotClient 'value' event -> apProvider.receiveValue(name, value)
   v (receiveValue applies echo cancellation vs pendingTarget)
data.target updated (or not) -> publishes canonical delta -> SSE to visor
   v
Visor state.target updated -> renderTargetArrow() moves the diamond
```

**Echo cancellation (relevante para el bug):**
```typescript
// src/autopilot-provider.ts:127-145
case "ap.heading_command":
  if (typeof value === "number") {
    const rad = value * DEG_TO_RAD;
    if (this.pendingTarget && Date.now() < this.pendingTarget.until) {
      const diff = Math.abs(shortestArcRad(rad, this.pendingTarget.value));
      if (diff <= TARGET_ECHO_TOL_RAD) {
        // Real echo landed - clear pending, keep our value
        this.pendingTarget = null;
      }
      // Whether match or stale, DO NOT overwrite data.target inside pending window
      break;
    }
    if (rad !== this.data.target) { this.data.target = rad; changed = true; }
  }
```

Constantes:
```typescript
const TARGET_PENDING_MS = 2500;
const TARGET_ECHO_TOL_RAD = 2 * DEG_TO_RAD;  // 2°
```

**setTarget (backend):**
```typescript
private async setTarget(rad: number): Promise<void> {
  const deg = rad * RAD_TO_DEG;
  this.data.target = rad;
  this.pendingTarget = { value: rad, until: Date.now() + TARGET_PENDING_MS };
  this.client.set("ap.heading_command", deg);
  this.notifyChanged("target");
}
```

**Nudge (frontend, app.js:4842-4884):**
```javascript
$$(".steer-btn[data-nudge-kind]").forEach((b) => {
  b.addEventListener("click", () => {
    const nudge = kindToDelta()[b.dataset.nudgeKind];
    if (nudge == null) return;
    const now = Date.now();
    if (!state.engaged) return;
    if (now - state.lastNudgeTs > 1000 || state.localTargetRad == null) {
      state.localTargetRad = state.target ?? state.heading;
    }
    state.lastNudgeTs = now;
    const sign = String(state.mode || "").includes("wind") ? -1 : 1;
    const newTargetRad = (state.localTargetRad ?? 0) + sign * nudge * DEG2RAD;
    state.localTargetRad = newTargetRad;
    state.target = newTargetRad;
    // Rev196: add to countdown accumulator if overlay is open
    try {
      const overlay = document.getElementById("tack-countdown-overlay");
      if (overlay && overlay.style.display !== "none") {
        _tackAccumulatedRotationDeg += Math.abs(nudge);
      }
    } catch {}
    renderTargetArrow();
    apSetTargetRad(newTargetRad);
  });
});
```

**Tack handler triple-tap (Rev195, app.js):**
```javascript
const _tapTrack = { port: [], starboard: [] };
const TRIPLE_TAP_WINDOW_MS = 1200;   // counting window
const TAP_FIRE_DELAY_MS = 500;       // fire delay after last tap
let _tapFireTimer = null;

const tackHandler = (dir) => async () => {
  if (!state.engaged) { /* flash failed */ return; }
  const now = Date.now();
  const trail = _tapTrack[dir];
  while (trail.length && now - trail[0] > TRIPLE_TAP_WINDOW_MS) trail.shift();
  trail.push(now);
  if (trail.length >= 3) {
    if (_tapFireTimer) { clearTimeout(_tapFireTimer); _tapFireTimer = null; }
    _tapTrack.port = [];
    _tapTrack.starboard = [];
    jibeStart(dir);
    return;
  }
  if (_tapFireTimer) clearTimeout(_tapFireTimer);
  _tapFireTimer = setTimeout(() => {
    _tapFireTimer = null;
    const overlay = document.getElementById("tack-countdown-overlay");
    const countdownActive = overlay && overlay.style.display !== "none";
    if (countdownActive) _tackExtend(dir);
    else _tackStartFresh(dir);
    _tapTrack.port = [];
    _tapTrack.starboard = [];
  }, TAP_FIRE_DELAY_MS);
};
```

**Extend / StartFresh / jibeStart:**
```javascript
let _tackAccumulatedRotationDeg = 0;
let _tackTargetBeforeStart = null;

function _tackAngleDeg() {
  const v = state.pypilotValues?.["ap.tack.angle"];
  return (typeof v === "number" && v > 10 && v < 180) ? v : 100;
}
async function _tackExtend(dir) {
  const modeStr = String(state.mode || "").toLowerCase();
  if (modeStr.includes("wind")) return;
  if (_tackCountdownDir !== dir) return;
  const angleDeg = _tackAngleDeg();
  _tackAccumulatedRotationDeg += angleDeg;
  const sign = dir === "port" ? -1 : 1;
  const totalRad = _tackAccumulatedRotationDeg * Math.PI / 180 * sign;
  let newTarget = (_tackCountdownReferenceAtStart ?? 0) + totalRad;
  while (newTarget >  Math.PI) newTarget -= 2 * Math.PI;
  while (newTarget < -Math.PI) newTarget += 2 * Math.PI;
  try { await apSetTargetRad(newTarget); } catch {}
}
async function _tackStartFresh(dir) {
  _tackCountdownStart("tack");
  const modeStr = String(state.mode || "").toLowerCase();
  const isWind = modeStr.includes("wind");
  const angleDeg = _tackAngleDeg();
  _tackAccumulatedRotationDeg = angleDeg;
  if (isWind) { /* ... windAngle refs ... */ }
  else _tackCountdownReferenceAtStart = state.heading;
  _tackTargetBeforeStart = state.target;
  _tackCountdownTargetAtStart = state.target;
  _tackCountdownDir = dir;
  if (!isWind && typeof state.heading === "number") {
    const sign = dir === "port" ? -1 : 1;
    const totalRad = angleDeg * Math.PI / 180 * sign;
    let newTarget = state.heading + totalRad;
    while (newTarget >  Math.PI) newTarget -= 2 * Math.PI;
    while (newTarget < -Math.PI) newTarget += 2 * Math.PI;
    try { await apSetTargetRad(newTarget); } catch {}
  } else { apTack(dir); }
}
async function jibeStart(dir) {
  if (!state.engaged) return;
  const modeStr = String(state.mode || "").toLowerCase();
  const isWind = modeStr.includes("wind");
  _tackCountdownStart("jibe");
  _tackCountdownDir = dir;
  const angleDeg = _tackAngleDeg();
  _tackAccumulatedRotationDeg = angleDeg;
  if (isWind) { /* wind mode fallback to apTack */ return; }
  if (typeof state.heading !== "number") return;
  _tackCountdownReferenceAtStart = state.heading;
  _tackCountdownTargetAtStart = state.target;
  _tackTargetBeforeStart = state.target;
  const deltaRad = angleDeg * Math.PI / 180 * (dir === "port" ? -1 : 1);
  let newTarget = state.heading + deltaRad;
  while (newTarget >  Math.PI) newTarget -= 2 * Math.PI;
  while (newTarget < -Math.PI) newTarget += 2 * Math.PI;
  try { await apSetTargetRad(newTarget); } catch {}
}
```

**Countdown tick:**
```javascript
function _tackCountdownDegTotal() {
  if (_tackAccumulatedRotationDeg > 0) return Math.round(_tackAccumulatedRotationDeg);
  if (_tackCountdownKind === "jibe") return JIBE_ROTATION_DEG;
  const raw = state.pypilotValues?.["ap.tack.angle"];
  if (typeof raw === "number" && raw > 10 && raw < 180) return Math.round(raw);
  return 100;
}
function _tackCountdownDegRemaining() {
  if (_tackCountdownTargetAtStart == null) return null;
  ...
  const tgt = state.target != null ? state.target : _tackCountdownTargetAtStart;
  let d = (tgt - currentRad) * RAD2DEG;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.round(Math.abs(d));
}
```

---

## 2. Bugs reportados hoy (Rev196)

### Bug 1 - "El nudge solo lo permite 1 vez"

Escenario: AP compass engaged, target=X°. Usuario está en fase arming del
countdown de una virada. Pulsa +10° (nudge estribor):
- 1er nudge: target salta a X+10°, label "110° total". OK.
- 2º nudge (0.5-2s después): target queda en X+10° (NO llega a X+20°),
  aunque el label del countdown sí muestra "120° total".

Cita textual del sailor: "en virada Estribor, esta cambiada la logica en el
target pero luego no en el recuento; en virada a babor peor aun; la segunda
dice 120 (en countdown) pero el target rebota siempre a 110".

### Bug 2 - "Bounce durante virada al hacer nudge en executing"

Durante la fase VIRANDO (executing), un nudge hace que el diamante rebote
visualmente. El label del "remaining" sí se actualiza, pero el diamante da un
salto y vuelve. Sin repro exacto todavía.

### Bug 3 - Trasluchada dice "10 grados"

Sailor hace triple-tap para trasluchar. El label del countdown lee "10° total"
en vez de esperados 100°. Repro parcial (1 de 3 intentos).

Notas relevantes:
- `ap.tack.angle` NO se publica al SK v1 tree (Pi consulta y devuelve 404),
  aunque está en el watch subscribe. Pypilot Zero probablemente no lo emite
  hasta que cambie.
- `_tackAngleDeg()` cae al fallback 100° cuando `state.pypilotValues["ap.tack.angle"]` es undefined.

### Bug 4 - Cancel restaura target pero heading actual no visible

Cancel funciona (arming → target original; executing → heading actual), pero
la UI no muestra el heading numérico, sailor no puede verificar. UX
principalmente, no lógica.

### Bug 5 - Sliders NUNCA cargan los valores a la primera

Cita del sailor: "sigue sin cargar los datos a la primera (sliders, etc)".
Repro: recargar visor, ir a Ajustes/Tune tab. Los sliders (gains, config
values, calibración) aparecen VACÍOS o en su default. Hace falta
recargar la página varias veces hasta que aparezcan los valores reales de
pypilot.

Flujo actual:
```
1. DOMContentLoaded fires (app.js:10057).
   - wireControl(), wireTune(), wireSetup(), etc.
   - Boot delays scheduled to call refreshPypilotValues() at 0, 500, 1000,
     2000, 4000, 8000, 15000 ms (Rev188 backoff).
2. refreshPypilotValues() (app.js:3779):
   - GET /plugins/signalk-pypilot-newui/values
   - If 401: retry, after 3x open login modal.
   - If OK: state.pypilotValues = j; render sliders from j + state.catalog.
3. state.catalog arrives separately, fetched inside the Setup tab load
   (app.js:5493). Rev177 added a refreshPypilotValues() call AFTER catalog
   lands so sliders can re-render with the real values.
4. On the pypilot socket 'catalog' event, backend calls publishCatalogDerived
   and setupWatches; setupWatches sends `watch` commands to pypilot for the
   subscribed keys, and pypilot then starts emitting values via socket.io.
5. Every value pypilot emits fires 'value' event -> publishValue publishes an
   SK delta -> visor SSE handler in app.js updates state.pypilotValues for
   the specific key.
```

Symptoms:
- On first page load, the initial /values GET returns either empty ({}), or
  a partial snapshot that lacks the RangeSetting keys the sliders need.
- After ~15 s of the backoff cycle, all sliders are populated fine.
- Reload the page a second time (from an already-warm plugin) - usually
  loads first time.

Hypotheses on why /values is empty at boot:
- Timing: SK server serves the plugin route BEFORE pypilot socket is
  connected + catalog has arrived + values event has fired. `values` field
  in the plugin only contains what has been pushed via 'value' events so
  far. On a cold plugin, it's ~empty for many seconds.
- Auth: 401 streak. Debunked in most cases because the login modal doesn't
  fire in this repro.
- SSE deltas: even after values arrive, if the visor missed some delta
  events during the SSE connect handshake, that slider stays default. But
  the /values fetch retries should cover this... unless the retry only
  fetches keys already in state.pypilotValues, discarding late-arriving.
  (Not the current behavior - it replaces the full object.)

Actual current logic at Rev188 backoff (app.js ~10130):
```
(async () => {
  const delays = [0, 500, 1000, 2000, 4000, 8000, 15000];
  for (const d of delays) {
    if (d) await new Promise((r) => setTimeout(r, d));
    try { await refreshPypilotValues(); } catch {}
    const gotVals = state.pypilotValues && Object.keys(state.pypilotValues).length > 5;
    const gotCatalog = state.catalog && Object.keys(state.catalog).length > 5;
    if (gotVals && gotCatalog) break;
  }
})();
```

Ask the LLM:
- Why does /values still return empty at boot despite the 7-step backoff?
- Is there a more reliable pattern (server-push snapshot? SK subscribe-all
  in the visor? server-side buffered "first-values" endpoint?) that the
  Rev188 code didn't try?
- What's the minimal change to guarantee sliders show real values on first
  page load, WITHOUT hammering the Pi Zero?

---

## 3. Hipótesis principales del asistente actual (que no han cerrado)

### Sobre Bug 1 (nudge 1 vez, rebote a 110):

Sospecha 1: pypilot Zero tiene rate-limit interno de `ap.heading_command` a ~1 Hz.
El segundo set() se descarta silenciosamente. Solo aplica el primero (+10°).
Meanwhile, pypilot echa por su watchdog 2 Hz el valor viejo (+10°). Cuando la
ventana `pendingTarget` (2500 ms) expira, receiveValue procesa el echo stale
como "cambio real" y publica delta con target=+10°. Visor lo aplica: bounce.

Sospecha 2: colisión entre setTarget y echo. Segundo nudge sobreescribe
`pendingTarget.value` con +20°, pero pypilot nunca aplica ese valor (razón
desconocida). Después de 2500 ms el eco de +10° "gana" porque pendingTarget
está vencido.

Sospecha 3: algo en `state.localTargetRad` no se re-inicializa correctamente
entre nudges rápidos (< 1000 ms).

### Sobre Bug 3 (trasluchada 10°):

Sospecha: race entre timer del tap simple (fire delay 500 ms) y triple-tap
(cancel timer + jibeStart). Un tap 1 dispara timer 500ms → 500ms sin más taps
→ dispararía `_tackStartFresh` que setea `_tackAccumulatedRotationDeg = 100°`.
Si un tap 2 llega a 400ms, cancela timer, arma nuevo. Si tap 3 a 800ms:
`trail.length===3` → jibeStart. Todos los caminos reset acumulator a 100°. NO
debería salir 10°.

Sospecha alt: sailor tocó +10 nudge JUSTO antes del triple-tap. Nudge dentro
de countdown no activo → `_tackAccumulatedRotationDeg` no se afecta (el hook
del nudge requiere overlay abierto). Pero si el countdown de una virada
previa aún estaba cerrando, acumulator= algo raro. Difícil de reproducir.

---

## 4. Restricciones y contexto

- Backend Node 18. Puede editarse libremente.
- Frontend vanilla JS (public/app.js). Puede editarse libremente.
- Pypilot Zero corre en TinyPilot Pi Zero W, ARMv6 con ~438 MB RAM.
  **Está frágil**: minimizar carga (polling, sockets, writes). Fuente:
  memoria `project_tinypilot_pi_zero_frugal`.
- No hay acceso a modificar pypilot_web/pypilot Python. Es opaque.
- Tenemos 1 socket.io TCP a pypilot_web. `client.set(name, JSON.stringify(value))`
  es el único write API disponible.
- Modo compass es el más importante (Tunatunes es velero, casi siempre en
  compass o wind).

---

## 5. Pregunta al LLM

**Analiza los 3 bugs desde primeros principios.** Da diagnóstico probable +
propuesta de fix para cada uno, priorizando SIMPLICIDAD y MENOR CARGA en el
Pi Zero.

En particular:
1. **¿Cómo debería un cliente robusto manejar el race set → echo con un
   servidor rate-limited (pypilot Zero)?** ¿Es correcta la lógica actual
   de `pendingTarget` con tolerancia 2° / TTL 2500 ms? ¿Hay un patrón
   mejor (ACK explícito? retry si echo no llega en N ms? window por-write
   independiente en lugar de un solo pendingTarget?).
2. **¿Cómo debería acumularse el target durante nudges rápidos** para que
   incrementos consecutivos SÍ apliquen aunque pypilot Zero descarte
   escrituras dentro de una ventana de N ms? ¿Debounce el envío al pypilot?
   ¿Retry con el valor acumulado final?
3. **¿Es sensato el mecanismo de triple-tap actual (cancel-and-rearm por
   tap)** o hay un patrón más limpio que garantice que trail.length >= 3
   siempre dispara jibe antes que el timer del tap simple?
4. Sobre "10 grados" en la trasluchada — ¿ves algún camino en el código
   pegado arriba que pueda dejar `_tackAccumulatedRotationDeg` en 10 tras
   un jibeStart? Si no, sugiere qué logging pondrías para diagnosticar.
5. Sobre "sliders no cargan a la primera" — ¿ves un anti-pattern en el
   flujo `/values` snapshot + SSE deltas + catalog late-arrival? ¿La
   solución correcta es un endpoint atómico "waitForReady" del backend,
   o mejorar la resiliencia del visor a snapshots parciales?

**No pidas más código.** Contesta desde lo que ya tienes. Si necesitas asumir
algo (versión pypilot, timing del Pi, etc), decláralo explícitamente. Sé
específico con los cambios: número de línea o snippet reescrito.
