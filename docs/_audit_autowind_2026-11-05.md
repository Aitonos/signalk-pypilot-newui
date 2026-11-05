# AUTOWIND audit after the 2026-11-05 sea trial (Rev629 / 3.11.1)

For an external LLM review **before any code is changed**. Paste the
"Prompt" section, attach the files listed at the end, and ask for the
answer in Spanish if Carlos will read it directly.

Companion report of the whole trial: `docs/_sea_trial_2026-11-05.md`.

---

## Prompt

You are a senior reviewer of safety-relevant marine software. Below is
an audit of the AUTOWIND feature of a Signal K plugin that drives a
**pypilot autopilot on a sailing boat**. Check the analysis against the
attached code:

1. Is the root cause right and complete?
2. Is anything missed?
3. Are the proposed fixes correct, minimal and free of side effects?

Answer per finding: **agree / disagree / partly**, with the reason and
the exact lines. Then list any further real bug in the same code paths.
No style comments.

### System in one paragraph

- Raspberry Pi 5 runs Signal K and this plugin.
- The autopilot is a TinyPilot (pypilot on a Pi Zero W).
- pypilot modes: `compass`, `gps`, `wind` (apparent) and `true wind`.
  `ap.heading_command` is a compass heading in compass/gps, an AWA in
  `wind` and a TWA in `true wind`. When `ap.mode` changes, pypilot
  recomputes `heading_command` itself.
- The plugin has a browser UI (the "visor", `public/app.js`) and a
  backend (`src/index.ts` plus modules).
- The backend is the source of truth for critical state.

### What AUTOWIND is

AUTOWIND is a pseudo-mode that lives in the backend (Rev518). While it
is on, it picks `wind` when |TWA| < threshold and `true wind` when
|TWA| > threshold.

- Defaults: threshold 120° with ±5° hysteresis; the condition must hold
  10 s; at least 30 s between switches; TWS ≥ 3 kn.
- Each side can have its own pypilot profile.
- The decision is pure (`src/autowind.ts`, `AutowindDecider`). The
  backend runs it once per second from the historian tick
  (`_autowindTick`, `src/index.ts` ~5058).
- Selecting AUTOWIND in the visor POSTs `/autowind {enabled:true}`. That
  applies the side immediately through `initial()`, without the sustain
  and gap timers.

---

## 1. What the sailor saw

From Carlos's voice log, 2026-11-05, local time CET:

- **17:52.** AUTOWIND was on, in `true wind`. He steered into the
  apparent sector and the mode stayed `true wind`: *"ya no cambia a
  aparente"*.
- **17:53-17:55.** He re-selected AUTOWIND and it started in `wind`. He
  bore away towards the stern to force `true wind`, and it never
  switched. The boat bore away past dead downwind and gybed.

## 2. Evidence

Data sources:
- Signal K journal.
- Visor maneuver trace (JSONL, one event per visor action).
- Black box (1 Hz samples with mode, heading, AWA, TWA, TWS).
- Signal K access log.

### 2.1 The decision logic would have switched

The black-box samples from 17:51:25 to 17:53:33 were replayed through
the compiled `AutowindDecider`. The replay used the real thresholds,
`blocked:false`, and `noteSwitch` at the 17:51:24 selection.

The replay returns `wind` at **17:52:02**, 17:52:32 and 17:53:02. In that
period:
- |TWA| was 26-74°.
- TWS was ≥ 3 kn except two 1-2 s dips.
- The mode was `true wind`.

The journal has no `[autowind] ... -> wind` line and no `setMode`
re-anchor line, so nothing was attempted. The 1 Hz tick runs
unconditionally; two automatic switches the same afternoon (17:44:52
and 17:45:28) prove the path works. So the tick must have seen
`blocked === true`.

### 2.2 What `blocked` was

`src/index.ts` `_autowindTick`:

```ts
const blocked = apProvider.isVirtualTackActive()
  || !!(_tackStatePrev && _tackStatePrev !== "none")
  || _pseudoActive();
```

- **Virtual tack:** none between 17:20 and 17:55:59 (journal).
- **`_tackStatePrev`:** `tackCatchupDeg` is 0. `observeTackTransition`
  returns early without a `tackCatchup`, so `_tackStatePrev` stays
  `null`.
- **`_pseudoActive()`:** `_maneuverPseudoActive && Date.now() <
  _maneuverPseudoUntil`, with a TTL of 180 s
  (`MANEUVER_PSEUDO_TTL_MS`). The flag is set by
  `POST /maneuver-state {active}` from the visor.
  - The access log has **142** `POST /plugins/signalk-pypilot-newui/maneuver-state`
    between **17:49:28 and 18:37:11**: one every 20 s for 48 minutes.
  - The visor renews `active:true` every 20 s from `_setManeuverPseudo(true)`
    (`public/app.js` ~12194). Only `_setManeuverPseudo(false)` clears that
    interval.

Trace of the pseudo-mode use:

| Time | Visor event |
|---|---|
| 17:49:28 | `aproado_start` |
| 17:49:30 | `aproado_pick bow`, then `aproadoExecute`: `_setManeuverPseudo(true)` |
| 17:50:02 | mode `compass` + target = heading (this is `aproadoFinish` restoring; it calls `_setManeuverPseudo(false)`) |
| 17:50:10 | `empopado_start` |
| 17:50:12 | `empopado_pick stern`, then `empopadoExecute`: `_setManeuverPseudo(true)` |
| 17:51:17 | mode `compass` + target ≈ heading. This is `empopadoFinish` safe exit (Rev440): phase becomes `summary`, and `empopadoTearDown` is scheduled after `APROADO_SUMMARY_MS` = 15 s |
| 17:51:24 | AUTOWIND selected (7 s later, inside the 15 s summary) |
| — | **no `empopado_teardown` event ever logged** |
| 17:50:12 → 18:37 | `maneuver-state active:true` every 20 s |

## 3. Root cause (R1)

The empopado gate is cleared **only** by `empopadoTearDown()`.

- `empopadoFinish()` (`public/app.js` ~13121-13193) moves to phase
  `summary` and schedules `empopadoTearDown()` with a 15 s timer.
- When the sailor closes the summary card, `emExitHandler`
  (`public/app.js` ~14017-14025) runs:

```js
if (emp.phase === "summary") {
  if (emp._summaryTimer) { clearTimeout(emp._summaryTimer); emp._summaryTimer = null; }
  hideEmpopadoHud();
  state.empopado = null;          // <- no _setManeuverPseudo(false)
}
```

It cancels the timer that would have cleared the gate and drops the
state. Nothing else calls `_setManeuverPseudo(false)`, so the visor
renews `active:true` every 20 s **until the page is reloaded**. The
backend TTL (180 s) never expires, because the renewals keep coming.

Aproado does not have this bug: `aproadoFinish()` calls
`_setManeuverPseudo(false)` itself (~13248).

That is why AUTOWIND never switched automatically after 17:50:12. Every
switch after that came from the manual selection (`initial()` through
`POST /autowind`), which does not look at `blocked`.

### R1 consequences beyond AUTOWIND (safety)

`maneuverPseudoActive` also silences three alarms in `src/alarms.ts`:
- `heading-deviation` (~174)
- `cruise-drift` (~206)
- `unable-to-steer` (~226)

So from 17:50:12 until about 18:40 those three alarms were **off**
without any sign on screen. That included the gybe at 17:55, the
`PORT_OVERCURRENT_FAULT` turns and the virtual tacks.

## 4. Other findings in the AUTOWIND path

**A2. The sailor cannot see that AUTOWIND is blocked.**
`_autowindState()` publishes `enabled`, `subMode`, profiles, threshold,
`lastSwitchTs` and `lastReason`, but no "blocked" or reason. The visor
shows "AUTO · Viento real" while the backend cannot switch.

**A3. A failed switch is silent.**
- `_autowindApply` catches a `setMode` error and logs it only with
  `app.debug` (~5026).
- `AutowindDecider.tick()` sets `lastSwitchMs` *before* the apply, so a
  failed apply also waits 30 s.
- Blocks are not logged.

**A4. Selecting AUTOWIND does not end a running Aproado or Empopado.**
The mode-select handler (`public/app.js` ~13852-13859) returns right
after `_autowindPost({enabled:true})`. The teardown of a pseudo-mode in
`transit`/`active` sits *below* that return (~13886-13897), so AUTOWIND
and Aproado/Empopado can run at the same time and fight over the pilot.

**A5. The pseudo-mode gate is not tied to the manoeuvre being alive.**
The 20 s renewal posts `active:true` without checking
`state.aproado` / `state.empopado`. Any path that drops that state
without `_setManeuverPseudo(false)` leaves the gate on for as long as
the page stays open. The aproado summary branch of `exitHandler`
(~13992-13998) also clears state without calling it. It is harmless
today only because `aproadoFinish` already cleared the gate.

**A6. Light wind.**
- In the failed window TWS was 2-5 kn while the boat motored at
  3.3-3.9 kn.
- TWA jumped 40-80° within 2-3 s (e.g. 17:51:03-12: -177, 133, -169,
  105). AWA 45° with TWA 140° was common.
- The 3 kn TWS floor lets AUTOWIND (and the sailor) use wind modes
  where the true-wind angle is noise.
- Separately, in `wind` mode an AWA target of -134° was not reachable on
  that tack (AWA stayed ≈ -84° at TWA -161°), so the pilot bore away
  until it gybed.

**A7. No freshness check on the inputs.**
`_autowindTwaDeg()` and `_autowindTwsKn()` read `app.getSelfPath(...).value`
with no age limit.
- `environment.wind.speedTrue` on this boat comes from
  `polar-performance.XX`.
- If the wind sensor stops, AUTOWIND keeps deciding on the last value.

**A8. AUTOWIND state survives restarts and switches with the AP
disengaged.**
`_autowindSetEnabled` persists `autowindEnabled`, and Rev521 lets it
switch modes while disengaged. After a Signal K restart it can change
pypilot's mode on its own. Intended (Rev521), but worth confirming.

## 5. Proposed fixes (not implemented)

**F-R1.** In `emExitHandler` (summary branch) call
`_setManeuverPseudo(false)` before dropping the state. Do the same in
the aproado `exitHandler` summary branch for symmetry. Simplest form:
call the existing `empopadoTearDown()` / `aproadoTearDown()` there.

**F-A5 (belt and braces).** The 20 s renewal posts `active:true` only
while `state.aproado` or `state.empopado` is in `transit`/`active`.
Otherwise it posts `false` and stops the interval. A future path that
forgets the teardown then self-heals within 20 s.

**F-A4.** Selecting AUTOWIND (or any mode) first ends a running
Aproado/Empopado, as other modes already do. Move the teardown block
above the AUTOWIND early return.

**F-A2.** Add to `_autowindState()`:
- `blockedReason` (`"virtual-tack" | "pypilot-tack" | "manoeuvre" |
  "wind-too-light" | "no-wind-data" | null`);
- `lastError`.

The visor shows it next to the AUTOWIND label (ES/EN/DE/FR).

**F-A3.**
- Log every block start/end and every failed `setMode` at normal level
  (rate-limited).
- In `AutowindDecider`, set `lastSwitchMs` only after a successful apply
  (`noteSwitch`, which already exists).

**F-A6.**
- Raise the AUTOWIND TWS floor from 3 to about 6 kn, with hysteresis.
- Show a "viento demasiado flojo para modo viento" warning when
  TWS < SOG.

The numbers are to be agreed with Carlos.

**F-A7.** Ignore TWA/TWS older than about 5 s. Treat them like missing
data: block, and say so in `blockedReason`.

**Tests:**
- Replay the 2026-11-05 samples. They must switch at 17:52:02 with no
  manoeuvre, and must not switch while a manoeuvre is really active.
- Visor test: closing the empopado summary leaves no `maneuver-state
  active:true` renewal.

## 6. Questions for the reviewer

1. Is the pseudo-mode gate the right thing to block AUTOWIND with at
   all? Or should the backend check the pilot itself? Aproado means
   `wind` with target ≈ 0; Empopado means `true wind` with target ≈ 180.
2. Should the backend keep its own record of an active manoeuvre instead
   of trusting a browser heartbeat (two browsers, closed tab, reload)?
3. Any other path in `public/app.js` that sets `state.aproado` /
   `state.empopado` to `null` without clearing the gate (lines ~12708,
   12724, 13118, 13223, 13304, 13997, 14024)?
4. Is 6 kn a sensible floor for an automatic apparent/true choice on a
   ~10 m cruising yacht?

## Files to attach

| File | Why |
|---|---|
| `src/autowind.ts` | Decision logic (whole file, ~100 lines) |
| `src/index.ts` lines ~595-612, ~2855-2890, ~3440-3460, ~4980-5100 | Gate, HTTP API, `_autowindTick` / `_autowindApply` |
| `src/alarms.ts` lines ~160-235 | Alarms silenced by the gate |
| `public/app.js` lines ~11330-11480, ~12185-12210, ~12380-12730, ~12890-13310, ~13840-13900, ~13985-14030 | AUTOWIND UI, gate heartbeat, Aproado/Empopado lifecycle, mode select, exit handlers |
| `src/test/autowind.test.ts` | Existing tests |
