# Audit Commit 2 (pre-Rev410) — fixes S / T / U

Fecha: 2026-10-04
Autor: Claude Opus 4.7
Contexto: continuación del plan de auditoría post-sea-trial 2026-10-03.
Carlos confirmó Rev409 OK y la secuencia aprobada ("a, b y c
confirmo") era: Commit 2 = fixes S + T + U.

Este MD es el audit previo a cualquier edición de código (regla
`feedback_audit_before_fix`).

---

## Fix S — Instrumentación `ap.tack.direction` del mando

### Qué se quiere
Que cuando el sailor mueva la rueda / mando físico y pypilot escupa
una delta `steering.autopilot.pypilot.ap.tack.direction`, el evento
quede en `maneuver-trace.ndjson` con la metadata suficiente para que
el próximo sea-trial sea diagnosticable sin pedir vídeo adicional.

### Qué hay HOY
`public/app.js:2791-2801`:
```js
case "steering.autopilot.pypilot.ap.tack.direction": {
  const prev = _lastTackDirSeen;
  const now = Date.now();
  const external = !_lastVisorTackWriteTs || (now - _lastVisorTackWriteTs) > 2000;
  if (prev !== value && typeof _mtLog === "function") {
    _mtLog("other", { stage: "visor", via: "delta", name: "ap.tack.direction", from: prev, to: value, external, monoTs: performance.now() });
  }
  _lastTackDirSeen = value;
  break;
}
```

Lo que **ya loguea**:
- `from` → prev direction
- `to` → nueva direction
- `external` → sí/no (basado en 2 s desde último write local)
- `monoTs`

Lo que **le FALTA** para que la traza sirva en sea-trial:
1. **Heading actual** en el instante del delta (necesario para que
   Carlos pueda cruzar "mando → virada por babor" con lo que marca el
   compás a la vez).
2. **AWA actual** (igual, cruce con viento aparente).
3. **Mode activo** (`compass` vs `wind` vs `true wind`). El mando
   escupe direction en todos los modos.
4. **Si hay VT en curso** (`state.virtualTack?.phase ?? "idle"`). Si
   el mando llega a mitad de un VT nuestro, es un conflicto que hay
   que ver sin ambigüedad.

### Alcance del fix S
- Enriquecer el `_mtLog` del case `ap.tack.direction` con los 4
  campos de arriba.
- Idem para `ap.tack.state` (ya loguea pero sin los 4 contextos).
- No tocar backend.

### Riesgo
Mínimo. Es sólo añadir campos al log NDJSON. No cambia FSM ni UI.

---

## Fix T — HUD mando: `remainingDeg` del backend si hay VT, "no data" en legacy

### Qué se quiere
En el overlay espejo (`_openExternalTackOverlay`) la bola grande
central muestra hoy segundos elapsed (`${elapsedSec}s`) porque es
"solo observador". Carlos quiere ver **grados restantes de rotación**
cuando el VT lo está driveando (es nuestro backend el que lo sabe) y
"no data" cuando viene del mando físico (pypilot no publica
remaining).

### Qué hay HOY
Backend (`src/autopilot-provider.ts`):
- `this._virtualTack` tiene `phase`, `id`, `direction`, `windMode`,
  `finalWindTargetRad`, `originalWindTargetRad`, `outcomeReason`,
  `requestId`, `active`, `cancellable`, `maneuverKind`.
- **NO publica `remainingDeg`** ni ningún delta similar. La única
  magnitud "rotación pendiente" vive en memoria dentro de
  `_runVirtualTack` (array `intermediates` recomputado por
  `recomputeRemainingIntermediates`).

Visor (`public/app.js:4161-4176`):
```js
_externalManeuverTimer = setInterval(() => {
  ...
  const el = document.getElementById("tack-countdown-num");
  if (el) {
    const elapsedSec = Math.floor((Date.now() - _tackCountdownExecuteStartTs) / 1000);
    el.textContent = `${elapsedSec}s`;
  }
  ...
}, 500);
```

### Alcance del fix T
Dos cambios en tándem:

#### T.1 — Backend publica `remainingDeg`
Cada vez que `_runVirtualTack` recompute `intermediates` o avance un
step, actualiza `this._virtualTack.remainingDeg` con el valor
`distanciaCorta(hNow, finalCompassTargetRad) * RAD2DEG` (ignorando
signo). La delta `state.virtualTack` ya se publica en cada setPhase →
basta con llamar `publishState()` tras actualizar remainingDeg (o
hacerlo dentro del tick del watchdog pypilot-stuck que ya corre a
intervalos de 250–500 ms).

**Opción A (mínima)**: añadir campo al snapshot, publicar en cada
step reached (ya se publica allí). Granularidad = cada step (grueso).

**Opción B (fluida)**: tick a 500 ms que republica el snapshot con
`remainingDeg` actualizado leyendo `_readHeadingRad()`. Más fluido
para la UI pero mete 2 Hz de deltas extra sobre el bus SK.

**Mi recomendación: A** para el MVP de Commit 2. Si Carlos quiere
tiempo real, lo subimos a B en un Commit 2.5 aislado.

#### T.2 — Visor consume `remainingDeg`
En `_externalManeuverTimer`:
```js
if (_externalManeuver) {
  const vt = state.virtualTack;
  const el = document.getElementById("tack-countdown-num");
  if (el) {
    if (vt && typeof vt.remainingDeg === "number") {
      el.textContent = `${Math.round(vt.remainingDeg)}°`;
    } else {
      // Legacy external (mando físico, pypilot no publica remaining).
      el.textContent = "— —";
    }
  }
}
```

### Riesgo
Medio. Toca FSM backend (publicar nuevo campo). El riesgo es publicar
un `remainingDeg` que diverja del `finalWindTargetRad` → sailor ve
"50°" y pypilot sigue girando después del cero. Mitigación: usar
`shortArcDeltaDeg(hNow, finalCompass)` consistente con lo que decide
`recomputeRemainingIntermediates`.

---

## Fix U — "pypilot silent" criterion change

### Qué se quiere
Hoy el visor cancela el HUD + grita "Pypilot no responde: virada
cancelada" si pasan 40 s sin ver una delta `ap.tack.state`. Esto es
una heurística frágil:
- Falsea positivos: en modo compass con poca rotación, pypilot puede
  no republicar `tack.state` por minPeriod del subscribe + agrupación
  (ver memoria `project_sk_subscribe_minperiod_groups_transitions`).
- Falsea negativos: si el socket pypilot muere pero `ap.tack.state`
  quedó cacheado como `tacking` en el handler, nunca cambia y el
  40 s dispara aunque la causa real sea otra (red SK, no socket
  pypilot).

### Qué hay HOY
`public/app.js:4408-4440`:
```js
const pypilotSilent = _lastTackStateSeenTs > 0
  && (now - _lastTackStateSeenTs) > PYPILOT_TACK_SILENCE_MS
  && elapsed >= 15;
// ...
} else if (pypilotSilent) {
  console.warn(`[tack] pypilot silent for ${...} s while executing — cancelling and warning sailor`);
  // toast + alSpeak + state=none + hide
}
```

Vive dentro de `_tackCountdownTick`, que corre **solo en path
LEGACY** (tack nativo pypilot sin VT). En VT, `_externalManeuverTimer`
NO tiene esta lógica — el watchdog de 60 s cierra el overlay si no
llega `ap.tack.state=none`, pero no genera toast ni declara "pypilot
silent".

### Alcance del fix U
Cambiar el criterio en los dos sitios:

#### U.1 — Legacy path (`_tackCountdownTick`)
Reemplazar "40 s sin delta de ap.tack.state" por:
- **Si hay `state.virtualTack.active && phase in {turning, handover, settling}`**: NO declarar pypilot silent (el backend es authoritative, su propio watchdog pypilot-stuck de 60 s decidirá).
- **Si NO hay VT activo** (tack nativo pypilot vía `pluginRaw`):
  mantener la heurística 40 s **pero añadir un check de que
  `state.pypilotValues["ap.tack.state"]` todavía es `tacking` o
  `waiting`** (confirma que pypilot cree que está tacking) **Y
  `state.heading` no ha cambiado > `STUCK_HEADING_TOL_DEG` en ese
  mismo intervalo** (confirma que el barco tampoco rota).

#### U.2 — VT path (`_externalManeuverTimer`)
Hoy no hay "pypilot silent" en VT. Correcto: lo cubre el watchdog
backend. Mantener como está. El watchdog visual de 60 s puede subir a
120 s para dar más margen al backend.

#### U.3 — Añadir evento explícito en backend
Cuando `_runVirtualTack` entre a `phase="failed"` por `outcomeReason`
que contenga "stuck" o "pypilot", publicar un delta explícito en el
snapshot (`state.virtualTack.outcomeReason`) → el visor ya tiene el
case `steering.autopilot.pypilot.virtualTack` donde se ve
`terminalPhase === "failed"` → ahí mostrar el toast con el motivo
real:
```js
if (terminalPhase === "failed") {
  const reason = state.virtualTack?.outcomeReason || "unknown";
  _showPypilotSilentToast(`VT fallida: ${reason}`);
}
```

Esto reemplaza la detección por tiempo con un **evento explícito del
backend**.

### Riesgo
Medio-alto. Es la lógica safety-critical del "virada cancelada"
toast. Si lo rompemos, Carlos puede quedarse sin aviso ante un pypilot
muerto. Mitigación: NO quitar el toast legacy hasta validar en agua
que el nuevo criterio basado en VT snapshot cubre los mismos casos.

---

## Scope de Commit 2 (resumen ejecutivo)

| Fix | Backend | Visor | Riesgo | Deps |
|-----|---------|-------|--------|------|
| S   | —       | enriquecer `_mtLog` en 2 cases | mínimo | — |
| T.1 | publicar `remainingDeg` en snapshot | — | medio | — |
| T.2 | —       | consumir `remainingDeg` en overlay espejo | mínimo | T.1 |
| U.1 | —       | criterio nuevo en `_tackCountdownTick` | medio | — |
| U.2 | —       | watchdog 60→120 s en `_externalManeuverTimer` | bajo | — |
| U.3 | —       | toast "VT fallida" en case virtualTack terminal | bajo | reutiliza `outcomeReason` ya publicado |

Rev target: Rev410. Build + deploy al Pi + QA Rev410 numerado.

## Preguntas abiertas para Carlos antes de codear

1. ¿Opción T.1-A (publicar remainingDeg solo en setPhase/step) o
   T.1-B (tick 500 ms re-publish)? Yo voto A para empezar.
2. ¿Mantenemos el toast legacy de 40 s en U.1 o lo quitamos del todo
   y confiamos sólo en el backend watchdog + eventos VT? Yo voto
   **mantenerlo pero sólo en path legacy sin VT activo** (es
   defensa en profundidad para tacks nativos pypilot).
3. ¿Watchdog visual VT 60→120 s acordado? (Rev407 lo puso en 60; el
   backend tarda hasta 60 s en declarar "stuck" por `PYPILOT_STUCK_MS`,
   así que 60 s empatarían — mejor subirlo).
