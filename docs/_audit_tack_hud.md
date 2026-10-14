# Audit — HUD tack_stats no sale (Carlos QA 2026-10-10, post Rev452)

Autor: Claude Opus 4.7
Fecha: 2026-10-10
Trigger: Carlos reporta "creo que no salen los infobox de tack".

## Contexto

El HUD `#tack-stats-hud` resume la virada: valores PRE (30s antes) vs POST (10s a partir de 5s después del completed). Rev371 lo mostramos inmediatamente con `post="—"` y luego el sampler lo actualiza con los valores reales de post.

## Caminos que disparan el HUD

Son **tres** entradas distintas que terminan llamando a `_tackStatsOnTackCompleted()` o `_tackStatsOnTackCancelled()`:

1. **Delta `ap.tack.state` → "none"** (línea 3046 → `_tackStatsOnStateChange(value)`).
   Detecta la transición `activo → none`. Si `_tackStats.lastTackState !== "none" && newState === "none"` → `_tackStatsOnTackCompleted()`.

2. **Virtual Tack (backend)** (líneas 2861, 2863): el delta del VT fase=completed/cancelled dispara el HUD.

3. **Countdown del visor en compass legacy**:
   - `arrived` (línea 5471) → `_tackStatsOnTackCompleted()`.
   - `pypilotSilent` (línea 5495) → `_tackStatsOnTackCancelled()`.

## Por qué pudo no salir en el bordo de las 17:37

El trace `trace-20261010-164336.jsonl` muestra que entre 17:37-17:45 CEST:
- Pypilot **nunca publicó** `ap.tack.state="begin"` ni `"waiting"` ni `"tacking"` (bug upstream de pypilot core en modo compass: no gestiona el `tack.state` cuando el tack se materializa como cambio de target vía la UI).
- Solo apareció `ap.tack.state="none"` (que era el valor global) + un cambio de `ap.tack.direction`.
- El visor escribió `tack.state="none"` como cancelación a los 15 s (watchdog, Rev452 lo fija).

### Vía #1 (delta "none"): NO dispara

`_tackStatsOnStateChange(newState="none")` requiere `_tackStats.lastTackState !== "none"`. Como pypilot nunca publicó un state activo, `lastTackState` se quedó en "none" todo el rato → **no detecta transición → no dispara**.

### Vía #2 (VT backend): NO aplica

El bordo fue un tack legacy (botón TACK en compass), no un VT.

### Vía #3 (countdown arrived/silent)

- **Pre-Rev452**: `pypilotSilent` disparaba a los 15 s de elapsed (porque `_lastTackStateSeenTs` estaba vencido) → **sí llamaba** `_tackStatsOnTackCancelled` → **HUD sí aparecía**, pero marcado "CANCELADO". Carlos probablemente vio este HUD en bordos previos.
- **Post-Rev452**: `_lastTackStateSeenTs` se resetea al inicio del countdown. Durante los 40 s de ventana el watchdog no dispara. Si `_tackRotationDoneDeg` no alcanza `max(20, totalDeg*0.4)` → tampoco `arrived`. Si pasan los 120 s de timeout general sin arrived/silent, se dispara `timedOut` que ocurre en línea 5500-5510 y NO llama a `_tackStatsOnTackCompleted/Cancelled` (solo oculta HUD).

**Consecuencia directa de Rev452**: el camino `cancelled` ya no se dispara en bordos legacy donde pypilot no publica state. Si tampoco se dispara `arrived` ni `completed`, **el HUD jamás aparece**. Rev452 arregló un síntoma (toast falso) pero destapó este bug latente.

## Caminos adicionales inseguros

- Línea 5500-5510 (`timedOut`): escribe `tack.state=none` a pypilot pero NO dispara el HUD stats. Es un gap.
- `arrived` (línea 5470-5475): dispara `_tackStatsOnTackCompleted` + `_tackCountdownHide`. OK.

## Fix propuesto Rev453

**En `_tackCountdownHide`** (que es el funnel único donde cualquier cierre del countdown pasa), si no se ha disparado ni completed ni cancelled durante este countdown, llamar a `_tackStatsOnTackCompleted()` por defecto como fallback. Pre + post="—" + sampler se encarga del resto. Sencillo, idempotente, cubre todos los caminos (arrived, silent, timed-out, user-cancel, external completion sin state transition).

Implementación:
- Añadir flag `_tackStats.fireScheduledForThisCountdown = false` al arrancar countdown.
- `arrived`/`silent`/`cancelled` lo marcan a `true` antes de llamar su respectivo trigger.
- `_tackCountdownHide`: si `fireScheduledForThisCountdown === false`, dispara `_tackStatsOnTackCompleted()`.

## Pendiente

Validar con un bordo en agua tras Rev453. Si Carlos sigue sin ver el HUD, confirmar en la Console `[stats show]` o `[stats completed]`.
