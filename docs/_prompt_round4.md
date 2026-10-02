# Prompt Round-4 para GPT-Codex y Gemini — Virtual tack chained maneuvers bug

## Resumen ejecutivo

Rev395 corrigió los 2 bugs confirmados de Round-3 (clasificador `maneuverKind` + wiring visor del snapshot). QA en agua con viento real (AWS 1.6-3.3 kn, AWA entre -19° y -96°) revela:

1. **Confirmado funcionando**: la clasificación `tack/jibe` del backend coincide con la geometría en todos los 5 tacks QA.
2. **BUG NUEVO descubierto**: cuando se encadenan tacks sin esperar el cleanup de 5s del VT previo, el `_targetBeforeVt` del nuevo VT captura el valor stale del restore del VT anterior en vez del valor correcto pre-tack-actual. El restore del nuevo tack vuelve a un "sitio equívoco".
3. **Pregunta UX**: Carlos no está contento con que el amber arrow salte al destino al pulsar TACK y permanezca ahí durante toda la maniobra. Pregunta de diseño abierta.

## Qué cambió en Rev395 (commit 1c7c547)

**Backend `src/virtual-tack.ts`** — fix clasificador:
```ts
let maneuverKind: "tack" | "jibe";
if (absStart < 15 * DEG) {
  maneuverKind = "tack";   // out of irons
} else {
  const sgnAWA = angleStartSigned === 0 ? dirSign : Math.sign(angleStartSigned);
  const crossesBow = sgnAWA === dirSign;
  maneuverKind = crossesBow ? "tack" : "jibe";
}
```
8 unit tests nuevos cubriendo la tabla de la ronda 3. 241/241 tests pass.

**Visor `public/app.js`**:
- `_openExternalTackOverlay(vt = null)` acepta snapshot y usa `vt.maneuverKind`, `vt.finalWindTargetRad`, `vt.windMode`, `vt.direction`. Fallback a heurísticas locales si vt=null.
- `_tackTargetBeforeStart = state._targetBeforeVt ?? state.target` (fix contaminación por orden de líneas 2571 → 4046).
- Instrumentación `[vt-target-render]` en `renderTargetArrow`.
- Shield mode/target: `if (state.virtualTack) break;` (shield-until-null, Gemini R2).

## Setup del QA (Carlos, 2026-10-02 15:53-15:57 UTC)

Barco en muelle con brisa ligera (AWS 0-3.3 kn, SOG=0). pypilot nunca llega a rotar → todos los tacks hacen timeout a 20s. Esto NO es bug del VT; limita QA a lo que podamos verificar sin rotación real.

5 tacks ejecutados:

| # | Hora | dir | AWA_0 | delta rotación | Classify | Carlos reporta |
|---|---|---|---|---|---|---|
| 1 | 15:53:31 | port | -96°  | -192° CCW long | **tack**  | "target bloqueado en destino, luego vuelve a origen" |
| 2 | 15:54:24 | stbd | -23°  | +314° CW long  | **jibe**  | "dice trasluchando pero orientación mal + al autocancelarse vuelve a sitio equívoco" |
| 3 | 15:55:36 | stbd | -83°  | +194° CW long  | **jibe**  | "correcto" |
| 4 | 15:56:22 | port | -74°  | -148° CCW nat  | **tack**  | "correcto, dejé autocancel" |
| 5 | 15:57:26 | stbd | -19.3°| +321° CW long  | **jibe**  | "mal posición de target" |

## Logs — 3 fuentes

### 1) journal (`sudo journalctl -u signalk`)

```
15:53:05 [apProvider.setTarget] rad=-1.6755 deg=-96.00         ← Carlos set wind target
15:53:31 [virtual-tack vt-T1] turning dir=port fromMode=wind angle=-96.0deg delta=-192.0deg steps=2
15:53:31 [apProvider.setMode] re-anchor: no measurement for ap.heading
15:53:32 [apProvider.setTarget] rad=2.1277 deg=121.91          ← compass intermediate step 0
15:53:40 [virtual-tack] rejected external setTarget rad=-1.5708 (FSM is driving)  ← pypilot echo
15:53:52 [virtual-tack vt-T1] turning step 0 timeout (no rotation in 20s)
15:53:52 [apProvider.setMode] re-anchor: no measurement for wind.direction
15:53:52 [apProvider.setTarget] rad=-1.6755 deg=-96.00         ← restore
15:53:52 [startVirtualTack] driver threw: turning step 0 timeout...

15:54:24 [virtual-tack vt-T2] turning dir=starboard fromMode=wind angle=-23.0deg delta=314.0deg steps=2
15:54:24 [apProvider.setTarget] rad=1.7676 deg=101.28
15:54:44 [virtual-tack vt-T2] turning step 0 timeout (no rotation in 20s)
15:54:44 [apProvider.setTarget] rad=-0.4014 deg=-23.00         ← restore

15:55:36 [virtual-tack vt-T3] turning dir=starboard fromMode=wind angle=-83.0deg delta=194.0deg steps=2
15:55:36 [apProvider.setTarget] rad=1.7717 deg=101.51
15:55:56 [virtual-tack vt-T3] turning step 0 timeout
15:55:56 [apProvider.setTarget] rad=-1.4486 deg=-83.00         ← restore

15:56:22 [virtual-tack vt-T4] turning dir=port fromMode=wind angle=-74.0deg delta=-148.0deg steps=1
15:56:22 [apProvider.setTarget] rad=2.5095 deg=143.79
15:56:42 [virtual-tack vt-T4] turning step 0 timeout
15:56:42 [apProvider.setTarget] rad=-1.2915 deg=-74.00         ← restore

15:57:26 [virtual-tack vt-T5] turning dir=starboard fromMode=wind angle=-19.3deg delta=321.4deg steps=2
15:57:26 [apProvider.setTarget] rad=1.7743 deg=101.66
15:57:47 [virtual-tack vt-T5] turning step 0 timeout
15:57:47 [apProvider.setTarget] rad=-0.3368 deg=-19.30         ← restore
```

**Backend restore funciona siempre**. Vuelve al wind target original pre-tack para cada VT.

### 2) maneuver-trace JSONL (canonical publishes del backend al bus SK)

Formato: `{ts (ms desde T1 start), fields, [path, value]}`. Target en degrees (wind mode) o compass heading (compass mode intermediates).

**T1 (port, AWA=-96°)**:
```
ts=1738   all        target=-96    mode=wind     VT={preparing, maneuverKind:"tack", finalWindTargetRad:96}
ts=2113   all        target=-96    mode=compass  VT={preparing, kind:"tack", final:96}
ts=2114   target     target=289.3  (compass intermediate step 1 at 289.3°)
ts=2146   all        target=289.3  mode=compass  VT={turning, ...}
ts=2147   target     target=121.9  (compass intermediate step 0 — reversed)
                                   ← pypilot's response/echo on heading_command
ts=22156  all        target=121.9  mode=compass  VT={cancelling, outcomeReason:"timeout"}
ts=22159  target     target=-96    (backend restore wind target)
ts=22160  all        target=-96    mode=compass  VT={failed, active:false}
ts=22531  all        target=-96    mode=wind     VT={failed, active:false}  ← mode revert OK
ts=23046  target     target=-23    ← ¡pypilot externo! heading_command cambia espontáneamente
                     ... (23046 - 22531 = 515ms post wind revert)
```

**T2 (starboard, AWA=-23°)** — llega sin VT=null previo:
```
ts=54082  all   target=-23  mode=wind     VT={preparing, kind:"jibe", final:23}
                                           ← nota: target=-23° correcto, pero visor tenía state.target=-23° 
                                             ya (del restore T1 propagado via linger). SHIELD UP del VT linger T1.
ts=54547  all   target=-23  mode=compass  VT={preparing, kind:"jibe", final:23}
ts=54549  target target=231.4  (compass intermediate)
ts=54590  all   target=231.4 mode=compass  VT={turning, kind:"jibe", final:23}
ts=54591  target target=101.3  (next intermediate)
ts=74605  all   target=101.3 mode=compass  VT={cancelling, outcomeReason:"timeout"}
ts=74607  target target=-23   (backend restore wind)
ts=74608  all   target=-23   mode=compass  VT={failed, active:false, kind:"jibe"}
ts=74960  all   target=-23   mode=wind     VT={failed, active:false}
ts=75465  target target=-141.2  ← pypilot externo durante linger
```

**T3 (starboard, AWA=-83°)** — llega sin VT=null previo:
```
ts=126205 all   target=-83   mode=wind     VT={preparing, kind:"jibe", final:83}
                                           ← target=-83° correcto. PERO shield del T2 failed sigue up 
                                             (state.virtualTack = T2 failed snapshot, no null).
                                             El target delta queda bloqueado.
ts=126619 all   target=-83   mode=compass  VT={preparing}
ts=126621 target target=294.2  (intermediate)
ts=126662 all   target=294.2 mode=compass  VT={turning}
ts=126664 target target=101.5
ts=146673 all   target=101.5 mode=compass  VT={cancelling, timeout}
ts=146675 target target=-83  (restore)
ts=146677 all   target=-83   mode=compass  VT={failed, active:false}
ts=147030 all   target=-83   mode=wind     VT={failed, active:false}
ts=147536 target target=-139.7  ← pypilot externo
```

**T4 (port, AWA=-74°)**:
```
ts=172110 all   target=-74   mode=wind     VT={preparing, kind:"tack", final:74}
ts=172496 all   target=-74   mode=compass  VT={preparing}
ts=172496 target target=279.7
ts=172513 all   target=279.7 mode=compass  VT={turning}
ts=172514 target target=143.8
ts=192520 all   target=143.8 mode=compass  VT={cancelling}
ts=192523 target target=-74
ts=192525 all   target=-74   mode=compass  VT={failed, active:false}
ts=192917 all   target=-74   mode=wind     VT={failed, active:false}
ts=193421 target target=-19.3  ← pypilot externo
ts=197527 virtualTack  value=null   ← ¡¡5s cleanup fires!! VT=null por fin
```

**T5 (starboard, AWA=-19.3°)** — llega CON VT=null previo (único):
```
ts=236944 all   target=-19.3 mode=wind     VT={preparing, kind:"jibe", final:19.3}
ts=237290 all   target=-19.3 mode=compass  VT={preparing}
ts=237291 target target=236.3
ts=237297 all   target=236.3 mode=compass  VT={turning}
ts=237298 target target=101.7
ts=257315 all   target=101.7 mode=compass  VT={cancelling, timeout}
ts=257317 target target=-19.3
ts=257319 all   target=-19.3 mode=compass  VT={failed}
ts=257707 all   target=-19.3 mode=wind     VT={failed}
ts=258209 target target=-142.0  ← pypilot externo
```

**Observación clave**: el VT=null cleanup solo fire UNA vez (entre T4 failed y T5 start, ts=197527). Entre T1→T2, T2→T3, T3→T4 el VT=null nunca llega porque un nuevo VT se dispara dentro de los 5s... **espera, no**. T1 failed ts=22160, T2 start ts=54082 → 31s de hueco. Debería haber habido VT=null a los 5s. Pero NO lo hay en el trace.

Mira el backend `_virtualTack` cleanup timer (del commit 0877edf):
```ts
const settledId = this._virtualTack?.id;
setTimeout(() => {
  if (this._virtualTack && this._virtualTack.id === settledId &&
      ["completed","cancelled","failed"].includes(this._virtualTack.phase)) {
    this._virtualTack = null;
    try { this.notifyChanged("virtualTack"); } catch { /* noop */ }
  }
}, 5000);
```

¿Por qué no se dispara? Posibilidades:
- El timer se setea en `_runVirtualTack` catch block pero el `.phase` no se guarda como `"failed"` sino como `"cancelled"`? El journal muestra `[startVirtualTack] driver threw`. En `catch` el código quizás setea `.phase = "cancelled"` y luego fuerza `.phase = "failed"` solo para la publish? Hay que mirar el código. Si el `settledId` o el `.phase` check falla, el cleanup nunca limpia.
- O el timer está en otro branch del FSM que no se alcanza en `driver threw`.

### 3) browser console (devtools)

```
GET http://100.127.222.27:3000/signalk-pypilot-newui/app.js?v=Rev395  ← confirma Rev395 cargado

[gust] 13:53:04 { awsKn: 0, awaDeg: -97, ... }
[gust] 13:53:21 { awsKn: 1.6, awaDeg: -105, bigShift: true, willFire: true }

XHR POST .../virtual-tack/start 200 OK 79ms
[vt-target-render] {
  vtId: "vt-1790949211736-3va13a",
  vtPhase: "preparing", vtActive: true,
  stateTargetDeg: 96,         ← pinned al destino (finalWindTargetRad=+96°)
  plannedDeg: null,            ← _countdownPlannedTargetRad never set (visor fast path)
  legacyBeforeStartDeg: null,  ← _tackTargetBeforeStart stayed null (overlay not opened via this path?)
  targetBeforeVtDeg: -96,      ← CORRECT: state._targetBeforeVt captured origen
  overlayActive: false,        ← overlay NO abierto (sorprendente)
  selectedDeg: 96
}
[vt] start ok (dir=port requestId=vt-visor-1790949210801-dmxa)

... (20s de nada en el visor hasta timeout) ...

[vt-target-render] {
  vtId: "vt-1790949211736-3va13a",
  vtPhase: "failed", vtActive: false,
  stateTargetDeg: -96,         ← restored to _targetBeforeVt
  plannedDeg: null,
  legacyBeforeStartDeg: null,
  targetBeforeVtDeg: null,     ← ya deleted por terminal restore
  overlayActive: false,
  selectedDeg: -96             ← correcta posición de origen
}

[gust] 13:53:51 { skip: "cooldown", untilMs: 5955 }
[gust] 13:54:07 { skip: "cooldown", untilMs: 27 }
[gust] 13:54:22 { skip: "cooldown", untilMs: 5999 }

XHR POST .../virtual-tack/start 200 OK 75ms  ← T2 start
[vt-target-render] {
  vtId: "vt-1790949264081-aa4wtn",
  vtPhase: "preparing", vtActive: true,
  stateTargetDeg: 23,          ← finalWindTargetRad=+23° (pinned)
  plannedDeg: null,
  legacyBeforeStartDeg: null,
  targetBeforeVtDeg: -23,      ← CORRECT: pre-T2 wind target
  overlayActive: false,
  selectedDeg: 23
}
[vt] start ok (dir=starboard requestId=vt-visor-1790949263142-109e)

... (20s de nada) ...

[vt-target-render] {
  vtId: "vt-1790949264081-aa4wtn",
  vtPhase: "failed", vtActive: false,
  stateTargetDeg: -23,         ← restored
  plannedDeg: null,
  legacyBeforeStartDeg: null,
  targetBeforeVtDeg: null,
  overlayActive: false,
  selectedDeg: -23
}
```

Browser log se corta aquí (truncado por tamaño). No tengo renders de T3, T4, T5.

Pero las instrumentaciones del T1 y T2 **confirman que el visor hace lo diseñado**: pin a destino durante VT, restore a origen pre-tack en terminal.

## Análisis — por qué Carlos reporta bugs

### Bug 1 reportado — "target bloqueado en destino durante T1, luego vuelve al origen"

**Comportamiento real**: pulsa TACK → `_tackStartFresh` setea `state.target = planned`. Snapshot preparing llega: handler setea `state.target = finalWindTargetRad = +96°`. Durante 20s el visor pinta el diamante en +96° (destino wind). Al failed terminal → restore a `_targetBeforeVt = -96°` (origen).

**Lo que Carlos ve**: diamante salta al destino, se queda ahí, luego al cancelarse vuelve.

**¿Es bug?** Técnicamente NO (es lo diseñado). Semánticamente SÍ para Carlos.

**Pregunta UX**: ¿cómo debe comportarse el diamante durante una maniobra activa?
- Opción A (actual): pin al destino durante VT. Muestra "a dónde va".
- Opción B: pin al origen durante VT. Muestra "de dónde viene".
- Opción C: track la rotación real de la proa. Muestra el intermediate target (compass heading intermedio). Esto es "qué pypilot está ordenando AHORA".
- Opción D: ocultar el diamante durante VT. Mostrar solo el HUD overlay.

### Bug 2 reportado — T2 "dice trasluchando cuando era virada + al autocancel vuelve a sitio equívoco"

**Classify "jibe"**: Carlos pulsó TACK STARBOARD con AWA_0=-23° (close-hauled port). Natural tack a port (CCW) sería `delta=-46°`. Pero pulsó starboard → forzado long arc `delta=+314°` → cruza popa en θ=+157° → es técnicamente trasluchada.

Carlos probablemente quería virada (= tackear a port natural). Hizo click en el lado equivocado. El sistema correctamente clasifica el gesture como lo que REALMENTE pidió (long arc = trasluchada).

**¿Es bug?** NO. El label es correcto. Es error del usuario. Pero el UX podría advertir: "estás pidiendo el lado largo, ¿seguro?" o similar.

**"Sitio equivoco al autocancel"**: según el trace, el restore es a -23° (origen pre-T2 wind). Según el browser `[vt-target-render]`, state.target queda en -23° al terminal. Diamante en -23°. **Correcto**.

¿Por qué Carlos dice "equívoco"? Hipótesis:
- Durante el VT, el diamante estaba en +23° (destino wind). Al cancelar, salta a -23° (origen).
- Carlos puede confundir el origen con otra posición si ha pasado tiempo y la rosa ha rotado por heading change ambient.

### Bug 3 reportado — T5 "mal posición de target"

Trace T5: restore a -19.3° (origen pre-T5 wind). Carlos reporta "mal". Igual al Bug 2.

### Bug REAL encontrado — tacks encadenados corrompen `_targetBeforeVt`

Mira el trace del T3 (comparado con T4 que Carlos reporta OK):
- T3 arranca después de T2 failed (sin VT=null entre medias en el trace).
- Shield del visor sigue up (state.virtualTack = T2 failed snapshot).
- Primer T3 delta `target=-83°` → **shield UP → bloqueado** → state.target NO cambia, sigue en `-23°` (restore T2).
- Siguiente VT delta T3 preparing → `_targetBeforeVt = state.target = -23°` ← **captura stale value del T2**.
- Terminal T3 → `state.target = _targetBeforeVt = -23°`. **Pero el valor correcto es `-83°`**.

T4 arranca después de T3 failed, también sin VT=null. Igual contaminación: `_targetBeforeVt` captura -23° (del T2 original). Pero Carlos reporta T4 OK.

T5 arranca después de T4, con **VT=null entre medias** (ts=197527). Shield baja. T5 preparing llega: target=-19.3° se procesa SIN shield → state.target=-19.3° → `_targetBeforeVt = -19.3°`. Terminal restore a -19.3° correcto. Carlos reporta "mal posición" aun así.

Hmm. **El bug "tacks encadenados contaminan _targetBeforeVt" explica T3 pero no T5**.

Para T5, Carlos quizás confunde "mal posición" por el motivo UX del Bug 1 (pin al destino durante VT activo).

**Fix propuesto para el bug encadenamiento (independientemente del UX)**: backend debe incluir en el VT snapshot un nuevo campo `originalWindTargetRad` = ap.heading_command del momento ANTES de iniciar el VT. El visor usa ese campo en vez de `state.target` para capturar `_targetBeforeVt`.

## Hallazgo adicional — VT=null cleanup rarísimamente dispara

Entre 5 tacks seguidos en 4 minutos, el delta `virtualTack=null` solo aparece 1 vez (ts=197527 entre T4 y T5). Esto significa que el shield del visor queda up permanentemente entre tacks consecutivos.

Posibles causas:
- El cleanup `setTimeout(..., 5000)` del backend se cancela cuando un nuevo VT nace. Entonces el "linger" solo expira cuando pasan 5s SIN otro tack. OK, pero en T2→T3 pasaron 51s, debería haber lingered al menos una vez.
- El timer no se guarda correctamente — `settledId` check falla porque `_virtualTack` ya cambió a nueva id antes del timer.
- O el phase check falla: el VT previo entra en `catch` → `.phase = "cancelled"` o algo distinto a `"failed"`.

**Pregunta al LLM**: analizar el flow `_runVirtualTack` catch + 5s cleanup y determinar por qué el delta `virtualTack=null` no se emite entre tacks dentro de 5s.

## Preguntas al LLM

1. **Confirma el bug de encadenamiento**: ¿captura `_targetBeforeVt` el valor stale cuando VT previo sigue en linger? Si sí, ¿preferís fix backend (nuevo campo `originalWindTargetRad` en snapshot) o fix visor (bypass shield solo para el primer target delta de un nuevo VT id)?

2. **Explica por qué VT=null no aparece entre T1→T2, T2→T3, T3→T4** aunque pasaron >5s. ¿Dónde se cancela el timer? ¿Hay condición no cumplida?

3. **UX diseño del diamante durante VT**: Carlos encuentra confuso que el diamante salte al destino. ¿Preferís opción A/B/C/D (ver arriba)? Argumentar.

4. **Bug T2 label**: para dir=starboard con AWA_0=-23° (close-hauled port), el sistema correctamente clasifica como "jibe" (long arc +314° cruza popa). Pero Carlos esperaba virada. ¿Añadir warning UX "estás pidiendo el lado largo, seguro?"? ¿O permitir y confiar que el label HUD basta?

5. **Riesgo oculto**: el restore backend hace `setMode(wind)` + `setTarget(originalWindTarget)` **sin esperar echo**. En T1 vemos `target=-96°` publicado a ts=22531 y después pypilot acepta `target=-23°` externamente a ts=23046 (515ms más tarde). ¿Prescribís `await waitForPypilotEcho` en el cancelling branch?

## Formato de respuesta

Para cada bug confirmado/refutado:
1. Causa raíz exacta (líneas de código).
2. Fix propuesto (diff).
3. Riesgo.

Para preguntas UX: recomendación + justificación en 3-5 líneas máx.
