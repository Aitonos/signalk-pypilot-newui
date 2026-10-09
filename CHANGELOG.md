# Changelog

## 2.12.0 — 2026-10-08 — Virtual-tack audit cycle + Profile UX overhaul + safety aproado/empopado

Rolls up Rev410 through Rev430 (21 revs). Driven by two sea trials
(2026-10-03 and 2026-10-04) that exposed critical virtual-tack bugs
and a batch of UX problems around profiles and the mode selector.
Six audit MDs accompany the fixes (`docs/_audit_commit[2-6]_pre_rev*.md`
+ `docs/_sea_trial_2026-10-04.md`) following the "audit before fix"
rule that paid for itself after three failed attempts at the drag/drop
bug.

### Added

- **Virtual-tack audit cycle (Commits 2–6 of the Rev407 plan)**.
  - *Commit 2 (Rev410)* — Mando trace enrichment (`ap.tack.state` and
    `ap.tack.direction` deltas now log heading + AWA + mode + vtPhase),
    VT `remainingDeg` on the mirror HUD (shows "N°" while turning,
    "settling" during the handover phase), explicit "VT fallida: X"
    toast when the backend publishes a terminal `failed` snapshot.
  - *Commit 3 (Rev411)* — Writes propagate pypilot refusal through
    `PUT /raw`, the SignalK v2 PUT handler and the `/ap/*` fallbacks
    (503 instead of a false 200), and `dodge()` throws so KIP sees
    the failure.
  - *Commit 5 (Rev412)* — Empopado hot-gains that **actually apply**
    (silent no-op since Rev320: the code read `catalog[path].value`
    which never existed). Reads from `state.pypilotValues[path]`
    now. New `data-hot={on|off|failed}` badge inside the active HUD
    makes the PID state visible.
  - *Commit 6 (Rev413)* — Yellow (warn) toast when settling times out
    but the compass rotation finished: "Virada completada, viento sin
    converger". Target is still applied; sailor sees it did not fully
    confirm.
  - *Commit 4 (Rev414)* — AWA settling EMA with τ ≈ 2 s applied to the
    noisy raw apparent-wind sample. Fixes the "settling-timeout" seen
    on light-wind sea trials. 4 unit tests cover seed / convergence /
    ±π wrap-around / α = 0 identity.
- **Virtual-tack final-angle override** (Rev416, fix #12). Backend
  accepts optional `finalAngleRad` on `/virtual-tack/start`; the visor
  forwards whatever is set in `localStorage.pypilotnewui.tackFinalAngleDeg`.
  Sailor can trim the destination AWA ±170° without having to nudge
  after the tack. Backend validates (`|rad| ≤ π`) and falls back to
  the AWA mirror on any invalid value.
- **EMA staleness guard** (Rev415). The settling loop now reads
  `p.timestamp` from the SK path; samples older than
  `STALE_SAMPLE_MS = 3000` are ignored, the dwell counter resets, and
  the EMA state is cleared so a frozen value (e.g. after a WiFi
  dropout) cannot sneak into the "ok" window.
- **Nudge target trace** (Rev415, fix #1 instrumentation).
  `apSetTargetRad` logs the current target / heading / AWA / TWA /
  mode / engaged BEFORE each PUT and the status / ok AFTER, so a
  stale-UI vs. real-refusal diagnosis is trivial on the next sea trial.
- **Mode selector custom modal** (Rev425 → Rev430, fix #13 iterated).
  Replaces the native `<select>` with a centered modal built lazily
  under `<body>` (`.mode-select-modal-backdrop`). Contents:
  - "MODO" label + list; the active mode highlighted in accent blue.
  - "PERFIL" label + autowrapping button (1–2 lines so long names
    like "Ceñida fondo medio viento" fit).
  - Nested list opens **upward** (position: absolute; bottom: 100%)
    so expanding profiles does not force the modal to scroll.
  - Idempotent repaint — SK deltas never flash the open modal.
- **Doctor suggestions sorted + numbered** (Rev417, fix #8). Visor
  pre-sorts by the same priority map the backend `applyAll` uses
  (`bias < authority < oscillation < noise`), stamps a 1-based
  ordinal prefix ("1.", "2.", "3.") on each card and gives the first
  pending suggestion a `.top-priority` accent border so the sailor
  can see which card the "Apply top priority" button will target.
- **Unlock prompt** (Rev421, fix #7). Flipping a group's unlock
  checkbox opens a 3-choice modal ("Editar en perfil actual" /
  "Cambiar a 'basic' primero" / "Cancelar") so the sailor explicitly
  chooses the edit scope before touching sliders. Modal body answers
  the second half of Carlos's question: "Los cambios se aplican en el
  acto, no hace falta cerrar la pantalla."

### Changed

- **Safety: aproado/empopado restoreAll default = false** (Rev415,
  fix #11). Carlos: "hay que anular el restituir rumbo cuando salimos
  de aproado o empopado porque es peligroso". Pre-Rev415 the finish
  path unconditionally restored mode + target + disengage; now it
  leaves the pilot where it is unless the caller opts in. The
  "lost stern" auto-cancel in empopado passes `restoreAll:false` too.
- **Fork modal wording** (Rev418, fix #6). The "Keep in '{pilot}'"
  button was filling `{pilot}` with `state.pilot` (always "basic"),
  misleading when the active profile was called something else. Now
  reads "Guardar en el perfil activo" + an info line showing the
  actual profile + pilot pair. Cancel label clarified to
  "Cancelar (deshacer último cambio)".
- **VT mirror watchdog raised 60 s → 120 s** (Rev410, fix U.2) so it
  does not race the backend's own `PYPILOT_STUCK_MS = 60 s`.
- **Pypilot-silent watchdog gated on VT state** (Rev410, fix U.1).
  During a VT the backend owns the authoritative stuck detection;
  the legacy 40 s time-since-delta heuristic only fires on native
  tack paths (no VT active) to avoid false "virada cancelada" toasts.
- **Fork modal strings fully translated** (Rev419, fix #6 follow-up).
  Modal title, body and name label were English fallbacks because
  `data-i18n` is not walked on dynamic `innerHTML`; now set
  explicitly from `t()` after creation.

### Fixed

- **Profile Manager drag/drop ping-pong flicker** (Rev420 after Rev418
  and Rev419 attempts). The live-reorder approach was intrinsically
  unstable — after each `insertBefore` the next `pointermove`
  re-triggered a swap. Rewritten with the deferred-commit pattern:
  only `translateY` the dragged item during the gesture, mark the
  nearest drop-target with a visual line, commit one `insertBefore`
  at the end. Also moved listeners to `window` + pointerId filter
  (was on the handle, failed silently on tablet browsers) and gave
  `.pm-item.dragging { touch-action: none }` so the gesture is not
  interpreted as a scroll. Flash animation `.just-moved` on commit
  confirms the move landed.
- **Tack stats HUD "dejaron de salir" + z-index + X not clickable**
  (Rev416, fix #10). The HUD was only wired to the native pypilot
  tack path (`_tackCountdownTick` arrived); VT (wind mode) never
  triggered it. Terminal `virtualTack` snapshots now call
  `_tackStatsOnTackCompleted` (completed) or
  `_tackStatsOnTackCancelled` (cancelled/failed). Corner tiles had
  `z-index:3` and the SVG wind-rose had no stacking context, so the
  HUD painted behind corners; added a `stats-hud-up` class on
  `.dash-rose` that raises `.rose-wrap` to `z-index:5` while the HUD
  is open and drops corners to `z-index:1` with
  `pointer-events:none`. Close × hit area widened to 34 × 34 so
  off-centre taps still land.
- **Mode modal "se carga dos veces"** (Rev428). `refreshPypilotValues`
  called `_rebuildModeSelect()` twice back-to-back (once when
  `profiles` landed, once when `profile` landed) and each call
  wiped-and-repopulated the modal's sub-select, producing a visible
  double flash. Consolidated into a single `needsModeRebuild` flag
  + made `_rebuildModePopupProfiles` idempotent (diffs the current
  option list and skips the repaint when it matches).
- **Mode popup viewport cropping** (Rev426 before the Rev427 full
  redesign). Pre-Rev427 the anchored popup overflowed the viewport
  bottom on 80 %-zoom laptops and phone portrait; added
  viewport-aware placement + internal scroll before deciding to
  switch to a centered modal anyway.
- **Doctor "Apply top priority" button targets the right card**
  (Rev417 side-effect of #8). The visor now mirrors the backend's
  priority sort so the highlighted card is always the one the button
  will apply.

### Known limitations / pending real-water verification

- Rev410 U.2 / U.3 — 120 s watchdog + "VT fallida" toast on backend
  `outcomeReason` need a real pypilot-dead moment to confirm.
- Rev411 J.1 / J.2 / J-1.5 — 503 propagation on `PUT /raw`, SK v2 PUT
  handler and `dodge()` need pypilot genuinely offline to exercise.
- Rev412 — "aggressive PID" on empopado now ACTUALLY writes gains to
  pypilot (dormant since Rev320). Validate in water that the new
  P × 1.5 / D × 1.7 / servo-slew × 1.3 does not cause oscillation.
- Rev414 — AWA EMA τ = 2 s needs confirmation in light wind that the
  dampened sample reaches the ±10° / 2 s dwell to produce
  `completed:ok` instead of `settling-timeout`.
- Rev416 — final-angle override is exposed via `localStorage` only; a
  slider UI will come in a later rev.
- Observation #2 from the 2026-10-04 sea trial (pilot behaves as if
  tracking true wind in `wind` mode) is still open and awaits the
  next sea trial's nav-session data with the Rev415 instrumentation
  to confirm it as a real bug vs. a PID-tuning symptom.
- Observation #9 — AIS collision overlay on the rose — is planned for
  the next **major (3.0.0)** bump; the design is drafted in
  `docs/_audit_feature9_ais_overlay.md` but not implemented yet.

---

## 2.11.0 — 2026-09-30 — Sea-trial Sprint K fixes + severity override + portrait layout

Rolls up Rev324 through Rev376. Between 2.10.0 (Rev323) and 2.11.0 the
plugin went through a second sea trial (2026-09-28, 27 min on Tunatunes)
that surfaced 13 bugs. The ones not requiring open water are fixed in
this release; the remainder (aproado/empopado true-wind, mando-físico
HUD mirror) are implemented and awaiting sea-trial QA.

### Added

- **Per-rule alarm severity override** (Rev342 backend + Rev374 frontend).
  Each rule in Setup > Alarms now has an inline `🔴 Alarma / 🟡 Aviso /
  🔵 Info` dropdown. Changes are persisted via `props.alarmSeverityOverrides`
  so they survive restarts. The shipped default is marked with `★` so the
  sailor can see which option is the factory setting before changing it.
  Endpoint: `POST /alarms/severity/:id {severity}`.
- **Mute countdown mm:ss** (Rev375). The muted-rule status pill now shows
  real-time `MM:SS` (updated every second) instead of coarse `N minutes`.
- **Maneuver HUD mirror for external tacks** (Rev348 → Rev355). When a
  tack is triggered from the pypilot native UI or physical remote, the
  visor opens the overlay, animates the orange buttons, and emits the
  post-tack stats panel — the same experience as a visor-initiated tack.
- **Tack cancellation stats** (Rev355). Cancelling mid-tack shows the HUD
  immediately with `pre` + "CANCELADO" and no post window.
- **Pypilot-silence watchdog** (Rev367). If pypilot stops sending `ap.tack.state`
  deltas for more than 60 s during a maneuver, the visor closes the mirror
  overlay itself so the UI doesn't hang indefinitely on a lost connection.
- **Observability instrumentation** (Rev346). `maneuver-trace` now logs
  stage events (`wallTs + monoTs`) for frontier debugging, plus `mtLog`
  calls in `pluginRaw` and the `ap.tack.state/direction` handleDelta
  branch tag the event source as `external` vs visor-local.
- **Heap diagnostics** sidecar (preserved from Rev885-equivalent work):
  internal structure sizes under `/api/diagnostic.heapAudit` for
  long-term RSS tracking.

### Changed

- **Tack stats post window shortened** 60 s → 15 s (Rev371). Was 30 s
  wait + 30 s measurement; now 5 s wait + 10 s measurement. 10 samples at
  1 Hz still yield a stable TWS/AWA/SOG average.
- **Rate-of-turn fallback more conservative** (Rev345). Minimum completion
  threshold raised to `max(20°, total × 0.4)` so brief rotations don't
  trigger a premature "tack completed" verdict.
- **Portrait tablet layout** (Rev370). `font-size` media queries at
  900 / 1200 / 1600 / 2000 px heights cascade through `em` units to
  scale both the rose and the surrounding buttons on tall tablets.
  Confirmed working on Opera Mobile (where `zoom` had no effect).
- **Button labels in wind mode** (Rev343). `±100°` becomes `VIRAR ← / →`
  when the pilot is in `wind` or `truewind`, matching the actual
  semantics.
- **Cancel labels during active maneuver** (Rev343). The orange buttons
  show `CANCELAR VIRADA` or `CANCELAR TRASLUCHADA` instead of their
  normal text so the sailor knows what tapping them will do.

### Fixed

- **Diamond target stuck on external tacks** (Rev347). The
  `_countdownPlannedTargetRad` variable now only masks `state.target`
  when the countdown overlay is actually visible; stale values from
  previously aborted visor tacks are cleared belt-and-suspenders.
- **Severity dropdown reverted to default on every poll** (Rev375,
  `alarms.ts` `describe()`). Was returning `rule.severity` (the factory
  default) instead of `s.severity` (the runtime value with override
  applied). Fixed to return `s.severity`.
- **Visor countdown mask over authoritative state** (Rev347 lesson,
  documented pattern). Any JS variable that fronts an authoritative
  bus value must be gated by a visible UI signal, not by a cleanup
  that may not fire on every abort path.

### Known limitations

- Aproado / empopado true-wind flow (`apSetMode("wind")` with
  `await state.mode = "wind"` before `apSetTargetRad`) is implemented
  but awaits sea-trial QA.
- Physical-remote tack → HUD mirror hook (bug #7 from the 2026-09-28
  trial) is implemented via `observeTackTransition` + `external` flag
  but awaits sea-trial validation.
- The pypilot-core direction rewrite for short-arc wind tacks is
  upstream (not our plugin) and remains open; a GitHub issue is drafted
  but not yet posted to Sean D'Epagnier.

---

## 2.10.0 — 2026-09-27 — Sea-trial wind-mode fixes + maneuver forensics

Rolls up Rev309 through Rev323. Between 2.9.0 (Rev280) and 2.10.0 the
plugin absorbed a sea trial (2026-09-25) that surfaced several critical
gaps in the wind-mode workflow, plus a new forensics module so future
sea trials can be audited offline.

### Added

- **Maneuver Trace Log** (Rev322, opt-in). Every user-driven action from
  the visor — aproado / empopado pick, tack tap, mode change, target PUT,
  engage / disengage — is recorded together with pypilot state right
  before the command AND 300 ms after. Pair pre/post makes it trivial
  to answer "did the pilot actually obey?". Files land as JSONL under
  `<plugin data dir>/maneuver-trace/`. New endpoints:
  `GET|POST /maneuver-trace/{status,start,stop,event}` +
  `GET /maneuver-trace/tail?n=N`. Setup card "Maneuver trace
  (sea-trial forensics)" toggles it on the fly, off by default.
- **Empopado pseudo-mode** (Rev313 → Rev320) — mirror of Aproado for the
  other extreme: bring the boat to TWA ≈ 180° so the mainsail flogs the
  least while striking sail. Full HUD (choosing → transit → active),
  hot gains at latch (P × 1.5, D × 1.7, servo slew × 1.3), audible
  warning when `|TWA| < 160°` sustained 1 s ("empopado inestable"),
  auto-cancel when `|TWA| < 140°` sustained 2.5 s. Restore in order
  hot gains → profile → mode → target → engaged on SALIR / cancel.
- **Attitude safety alarms** (Rev299 / I1) — `attitude-heel-extreme` and
  `attitude-pitch-extreme` rules with configurable thresholds
  (`alarmAttitudeHeelDeg`, `alarmAttitudePitchDeg`), off by default so
  a fresh install never disarms on the dock.
- **Roll feed-forward** (Rev282+) and **Post-tack catch-up** (Rev299)
  publish diagnostic paths under
  `steering.autopilot.pypilot.tuning.rollFf.*` and `.tackCatchup.*`.
  Both are currently `appliedToAp: false` — computed and observable
  but not yet fed to the pilot; a later release flips the switch after
  sea trial validation.
- **Leeway estimator** (Rev298 / H4) publishing
  `steering.autopilot.pypilot.derived.leewayRad` from the classical
  `drift_deg = adj * heel_deg / bsp_kn²` formula. Opt-in via
  `leewayAdjustment > 0`, kept off the canonical `performance.leeway`
  path so it never overwrites `signalk-derived-data`.
- **Failsafe boat speed** (Rev299 / H2) — when both BSP and SOG go
  missing, the plugin injects a configurable knots value so downstream
  wind / leeway calculations keep producing plausible numbers.
- **Profile default persistence fix** (Rev310) — opening the visor from
  a second device no longer silently overwrites the pypilot profile with
  `default`; the select is now primed from the HTTP snapshot before the
  WebSocket delta arrives.

### Fixed (critical — from the 2026-09-25 sea trial)

- **Tack in wind mode** (Rev309) — pressing VIRAR to a specific side now
  reliably rotates the bow to that side, even when the "short arc" would
  go the other way. Root cause: `planned = -refRad` in the countdown
  path was ignoring the sign; now `_tackCountdownToExecuting` delegates
  to `ap.tack.direction` + `ap.tack.state=begin` so pypilot honours the
  band the sailor chose.
- **Aproado without countdown** (Rev311) — pressing POR PROA / POR POPA
  starts the maneuver on the same tap (previously 5 s delay). Sustain
  3 s for the "achieved" latch avoids false positives on brief AWA
  oscillations.
- **Alarm silence during maneuvers** (Rev311 → Rev312 → Rev323) — the
  `heading-deviation`, `cruise-drift` and `unable-to-steer` rules now
  respect both pypilot's own `ap.tack.state != "none"` AND a visor-side
  pseudo-mode flag posted to `POST /maneuver-state` when Aproado /
  Empopado are running. Independent flag needed because pypilot does
  not always update `ap.tack.state` when the sailor uses one of the
  pseudo-modes.
- **Heading-deviation false positives in wind mode** (Rev323) —
  threshold raised to 35° and sustain to 30 s when the pilot mode is
  `wind` / `true wind`. In waves and gusts the AWA target legitimately
  oscillates ±20-30° while the AP is still correcting; the 20°/15 s
  default of compass mode was disarming the alarm several times per
  hour on Tunatunes.
- **Tack countdown stability close-out** (Rev312) — if the tack overshoots
  the plan but the boat is clearly settled (rate-of-turn < 3°/s for 2 s),
  the overlay closes on its own instead of counting up to the 120 s
  timeout.

### Changed

- **Alarms OFF by default** (Rev317) — a fresh install no longer arms
  every rule; the sailor opts in via Setup → Alarms. Pre-Rev299 installs
  keep legacy behaviour (undefined = all-on) so nothing changes silently
  under an existing boat.
- **Terminology cleanup** (Rev321) — all references to third-party
  autopilot brands / dashboards in code, comments, docs, UI hints and
  package metadata have been rewritten as neutral descriptions of the
  mechanism ("downstream Signal K clients", "wind-response damping
  bands", "classical heel-over-speed² formula"). No behavioural change.
- **Tablet vertical crop hardening** (Rev314) — `100vh` → `100dvh` in
  every fullscreen modal, `-webkit-overflow-scrolling: touch`, safe-area
  padding. Fixes bottom-of-card clipping on Android tablets in portrait.

### Removed

- `docs/PROMPT_FOR_LLM_maneuver_catalog.md` — obsolete Rev209 audit
  prompt, superseded by the current tack design.

## 2.9.0 — 2026-09-23 — Relicensed to AGPL-3.0-or-later

### License change (see NOTICE for details)

Starting with this release the plugin is distributed under the
**GNU Affero General Public License 3.0 or later** instead of Apache
2.0. The move is intended to keep downstream forks open under the
same license — including forks offered as a network service — while
still allowing personal and commercial USE without any fee, permission
or contract.

What this means in practice:

- **Personal or commercial use is unchanged.** A cruiser, charter
  fleet, sailing school or workshop can install and use the plugin
  without paying anything or asking anyone.
- **Fork for your own use or to contribute back — same as before.**
  Anyone can clone the repo, modify the code, test it on their boat,
  or open a pull request. The AGPL only kicks in the moment you
  *distribute* your modified version (as a package or as a network
  service).
- **Distributing a modified version obliges you to publish the source
  code under AGPL-3.0-or-later too.** Closing a fork behind a
  commercial product without releasing the source is no longer
  permitted.

Previous releases (up to 2.8.0) remain available under the Apache 2.0
terms that were granted at the time — those rights are perpetual for
those specific versions.

### Also in this release

- Ship the `LICENSE` file that was declared in `package.json` but
  missing from the tarball in all prior releases. The file now
  carries the full AGPL-3.0 text (previously an implicit Apache-2.0
  reference in `NOTICE`).
- `NOTICE` updated with licensing history + reaffirmation that
  Panaaj's Apache-2.0 code fragment (autopilot-provider adapter)
  is compatible with an AGPL-3.0 combined work.

## 2.8.0 — 2026-09-23 — Sea-trial critical fixes + intelligence layer

### Fixed (critical, from real sea trial)

- **pypilot-disconnected alarm no longer panics on a 1 s hiccup.**
  The banner used to fire after just 1 second of socket silence at
  "alarm" severity (audio channel forced). In a marine environment
  where a 4G router routinely blips for a few seconds on the SIM,
  this generated constant false positives with unavoidable sound.
  New default: **15 s sustain, "warn" severity** (silent banner). The
  window is now runtime-configurable via
  `POST /supervisor/config` field `alarmPypilotDiscSec` (range
  3..300 s). Applies to `notifications.autopilot.pypilot-disconnected`.

- **Wind-mode nudge buttons now steer the bow to the labelled side,
  independent of AWA sign.** Before, `modeSign = -Math.sign(AWA)`
  meant a `+10` on port-side ceñida (AWA=-45°) inverted the sign and
  moved the target the wrong way, so the bow swung to the opposite
  side of the button label. Fixed to `modeSign = -1` always in wind
  mode; the four cases (AWA±45 × button±10) now all match the
  physical expectation of "swing the bow to the labelled side".

- **Mode change compass↔wind no longer strands `heading_command` in
  the previous space.** pypilot's `ap.heading_command` lives in
  different value spaces per mode (compass=heading, wind=AWA,
  true wind=TWA). Before, changing modes left the target number
  unchanged, so a `heading_command=90°` in compass became a 90° AWA
  target in wind mode and the pilot swung hard to reach it. The
  provider now **re-anchors** `heading_command` to the current
  measurement in the destination space (`wind.direction` /
  `wind.true_direction` / `ap.heading`) right after the mode delta
  is confirmed. Same-space transitions (compass↔gps↔nav,
  wind↔true wind) skip the re-anchor. Decision extracted to
  `src/mode-reanchor.ts` with 24 unit tests.

- **Profile selection cannot be overwritten to "default" when opening
  the visor on a fresh device.** The `<select id="profile-select">`
  starts with the DOM-default first option ("default") until the
  authoritative delta lands. A stray change event fired during that
  gap could write "default" to pypilot, overriding the sailor's
  active profile. The visor now refuses to send profile changes
  until it has received at least one authoritative `profile` delta
  from the backend, and skips identity writes.

- **Gust temp-heavy strategy respects manual profile changes.** If
  the sailor picks a different profile during the 30 s temp-heavy
  window, the automatic restore no longer overwrites that choice.
  It fires an advisory notification instead.

- **Runaway pilot defence.** `adjustTarget` clamp tightened from
  573° to 90°. A single adjustTarget above 90° is either a caller
  bug or a corrupt payload; refused at the boundary before it
  becomes an untraceable pypilot sweep. Nudges (max 100° per press)
  and tacks (go through `setTarget` absolute) are unaffected.

### New — Doctor rule set

- **Rule 5: step-response episode analysis.** When ≥3 correction
  episodes closed during the Doctor session's window, high average
  overshoot suggests raising D (+15% or +25% if overshoot > 35%),
  and repeated timeouts flag "AP cannot reach the target — hardware
  authority".
- **Rule 6: downwind roll advisory.** With Roll FF disabled and a
  heel RMS > 5° on downwind engaged samples, Doctor suggests
  activating the Roll feed-forward slider.

### New — Tuning & profiles

- **Three-slider tuning panel (backend).** New endpoints
  `GET/POST /tuning/knobs` map Aggressivity + Understeer/Oversteer +
  Balance-Heading/Rate onto raw P/I/D/DD via `src/tuning-knobs.ts`.
  Identity at (50, 0, 0); all factors clamped to [0.3×, 3.0×]
  baseline. 26 unit tests.
- **Profile metadata.** `GET /profiles/metadata` + `PUT/DELETE
  /profiles/metadata/:name` for tagging each pypilot profile with a
  condition (light/medium/heavy/motor/custom) and free-text notes.
  Persisted via `savePluginOptions`.
- **Profile advisor.** Watches the 1 min KPI window and notifies
  when the boat has been tracking sustainedly badly ("consider a
  more aggressive profile") or over-tightly with high servo duty
  ("consider a less aggressive profile"). Never applies anything;
  emits a `notifications.autopilot.pypilot.profileAdvisor` visual
  banner with 5 min cooldown.
- **Profile change audit log.** New endpoint
  `GET /profile-change-log` shows the last 50 profile transitions
  with attributed source (user / auto-profile / gust-heavy /
  gust-heavy-restore / doctor / external). Answers "who changed my
  profile?" for surprise switches.

### New — Correction episodes + config backup

- **Correction episode metrics.** `src/episodes.ts` detects each
  target-step correction and records step-response metrics
  (rise time, overshoot %, settling time, steady-state error).
  Exposed at `GET /episodes` with a good/acceptable/poor quality
  band. Feeds Rule 5 of the Doctor.
- **Config backup / restore.** `GET /config/export` downloads a
  JSON bundle of plugin options + persistent pypilot settings
  (P/I/D/DD, tack params, servo max_current, etc.). `POST
  /config/import` accepts a bundle and applies it, filtering runtime
  telemetry keys defensively.

### New — Physical control terms

- **Roll feed-forward (off by default).** `src/roll-ff.ts` filters
  the dynamic component of `navigation.attitude.roll` and computes a
  small pre-emptive shift of the commanded heading, gated to
  |TWA|>90°. Currently PUBLISHED at
  `steering.autopilot.pypilot.tuning.rollFf.*` for observation; not
  applied to the pilot yet — a later Rev flips that switch after sea
  trial validates the term. Slider lives at `POST
  /supervisor/config` field `rollFfGain` (0..2).
- **Gust heel-confirmation gate.** The Rev167 gust supervisor now
  cross-checks the AWS jump against a >2° heel change during the
  same 5 s window. A sensor spike that did not physically load the
  boat is suppressed. Falls open when heel data is absent.

### New — Alarms & telemetry

- **Persistent servo error log.** JSONL under the plugin dataDir
  records every servo-* alarm transition with a 30 s peak summary
  of pre-fault telemetry (max A, max °C, min V, max heading error).
  Exposed at `GET /servo-error-log`.
- **Pre-fault trim warnings.** New "info"-severity rules
  `servo-current-trim` (>75% of overcurrent limit) and
  `rudder-range-trim` (>40° absolute) fire *before* the fault-severity
  rules to give the sailor time to trim.
- **Configurable alarm thresholds.** `alarmLowVoltageV` (8..14 V),
  `alarmServoTempC` (40..85 °C), `alarmServoMotorTempC` (40..90 °C)
  now exposed via `/supervisor/config` and threaded through the
  alarm rules per install.

### New — NAV mode observability

- **APB source preview.** `GET /nav/apb-preview` shows the current
  active-waypoint bearing computed both ways — direct `bearingTrue`
  and plotter-provided `steerTo` — plus their divergence. Read-only
  for now; a later Rev may switch to plugin-side NAV mode after sea
  trial validates the preference.

### Under the hood

- 8 new source modules with 177 unit tests (up from 5). All
  additive — no existing endpoint or SK path changed contract.
- Rev sequence 281..297 on branch `feat/blind-batch-sep16`.

## 2.7.5 — 2026-09-15 — Hotfix on 2.7.4 (visor did not load)

**Deprecates 2.7.4.** The restore verdict fix that landed in 2.7.4
declared `const wantMode` twice in the same block scope
(`SyntaxError: redeclaration of const wantMode`) which prevented
`app.js` from loading. This release removes the duplicate and keeps
everything else in 2.7.4 unchanged. If you installed 2.7.4, please
update to 2.7.5.

## 2.7.4 — 2026-09-15 — Async control tightening + uppercase accents

Closes three findings from the external Rev277 review and finishes
the Spanish accent pass across UPPERCASE headers and badges.

### Async control

- **NAV activation can no longer survive a disengage.** `setNavMode`
  now snapshots the engage generation BEFORE `getCourse()` and
  `setMode("nav")`, and bails silently if a disengage arrives during
  either await. A superseded NAV attempt no longer arms the 500 ms
  timer that could have turned a cancelled request into a fresh
  engage. `engage()` also filters "superseded" errors so its own
  fallback into `setState("enabled")` cannot resurrect the cancelled
  intent.
- **Stale target and mode retries can no longer overwrite newer
  ones.** `setTarget` / `setMode` / `adjustTarget` now each bump a
  dedicated generation counter and pass an `isStale()` callback into
  `_setWithRetry`. If a first `setTarget(1 rad)` was still in retry
  when a second `setTarget(2 rad)` succeeded, the first no longer
  wakes up and pushes 1 rad. Same class of guard R01 already applied
  to `ap.enabled`; now it covers all three write paths.
- **Restore verdict actually verifies mode and target.** The 10 s
  poll used to only check `pypilotHealthy` and `engaged`; that let a
  pypilot ignoring the mode / target orders still be announced as
  "restored". Now the verdict also compares `state.mode` against
  the snapshot and `state.target` against it (with a 3° tolerance
  for pypilot's own rounding on the wire) before speaking success.
  A mismatch fires the failure banner with a specific reason
  ("mode did not switch" / "target did not match").

### i18n

- Second Spanish accent pass covering UPPERCASE tokens the previous
  pass missed: `ESTADÍSTICAS`, `HISTÓRICO`, `SESIÓN`, `CONEXIÓN`,
  `CONFIGURACIÓN`, `CATÁLOGO`, `GRÁFICA`, `MÁS RÁPIDA`, `TIMÓN`,
  `ÁNGULO`, `MÁXIMA`, and so on.

## 2.7.3 — 2026-09-14 — Spanish accents restored

The Spanish translation now carries the accents it always should have
had. About 140 previously plain-ASCII words in the ES dictionary and
a handful of hard-coded strings in the Info modal placeholders now
render as `Configuración`, `Conexión`, `Timón`, `Ángulo`, `Sesión`,
`Grabador de sesiones de navegación`, `Versión pypilot` and so on.
No functional change.

## 2.7.2 — 2026-09-14 — Registry score bump

No code change vs 2.7.1. Adds a smoke test suite (Node built-in test
runner, no extra devDependencies) so `npm test` passes for the Signal K
Plugin Registry, and clears a `high` `npm audit` finding in a
transitive dependency. Together these lift the plugin's registry
score by ~45 points.

## 2.7.1 — 2026-09-14

Sea-trial release. Big reliability upgrade after intensive on-water
testing on Tunatunes.

### New features

- **Trip Recorder** — every outing is auto-recorded via
  `navigation.state`. Setup → Trips shows 17 KPIs, an OpenSeaMap
  trace coloured by SOG with markers on peak gust, peak SOG, min
  voltage and every detected tack, and lets you share the outing as
  a portrait PNG report card or as WhatsApp text.
- **Reconnect Restore banner** — when the link with pypilot dies
  while the AP is engaged, the visor takes a snapshot of your target
  and mode. If the link is back between 20 s and 5 min later, a
  Yes / No banner offers to re-engage the same target. Success is
  announced only after pypilot actually confirms.
- **Watchdog with core-alive detection** — the visor now
  distinguishes a live `pypilot_web` with a dead pypilot core. AP
  controls grey out, the "pypilot disconnected for N seconds" voice
  alert fires, and the green "pypilot operational" toast greets you
  when the core is really back.
- **Faster offline / online detection** — dead-pypilot detection
  improved from ~10-14 s to ~5-6 s; reconnect detection improved
  from ~4-8 s to ~1-3 s.
- **Persistent Tack history** — every tack stored on the device
  with pre / post TWS, AWA, SOG and recovery time to 95% of pre-tack
  speed. Filter by day range with best retention and fastest
  recovery highlighted.
- **Gust marker overlay** — leaves a ghost `A` arrow at the peak
  wind speed for 10 s.
- **Bottom bar rudder-or-heel switch** — the big-number bar on the
  Control tab can show rudder angle or boat heel.
- **Concentric Target + Wind arrows** — three arrow pieces on the
  rose interlock into a droplet when target ≡ AWA ≡ TWA; open into
  V-notches with a colour tick when they drift. (Feature previously
  called "Gota Chain", renamed for clarity.)
- **Full instructions inside the Info modal** — new section that
  walks through every tab and gesture, in English and Spanish.
- **Global `allowWrites` gate** — the plugin's HTTP routes, the
  Autopilot API v2 provider and the KIP action / switch handlers
  all honour the same toggle. A read-only install is really
  read-only from every angle.

### Critical bug fixes

- **Silent success on offline writes** — writes to a dead pypilot
  socket used to silently report success, so the visor could claim
  the AP was engaged while the boat drifted. Writes now confirm
  end-to-end before the UI accepts them.
- **Phantom AP re-enable after reconnect** — a stale engage retry
  could re-enable the AP after you had explicitly disengaged. Fixed
  with a generation counter that cancels superseded orders.
- **False "healthy" with a dead pypilot core** — a live
  `pypilot_web` pong used to keep the "healthy" flag on even when
  pypilot itself was dead. A sticky core-offline flag now blocks
  writes and greys the UI until real evidence from the core arrives.
- **Restore banner announced "restored" before pypilot confirmed**
  — the visor used to speak success on the HTTP 200 alone, seconds
  before spotting that pypilot never actually engaged.
- **Spanish leaking into English mode** — several dynamic strings
  (Trip card, Tack log, menus, WhatsApp caption) rendered in Spanish
  regardless of the active language.

Many small bugs also fixed across the visor, autopilot provider and
Signal K integration.

## 2.7.0 — 2026-09-14 — Superseded by 2.7.1

Same feature set and code as 2.7.1. Release notes were rewritten in
2.7.1 in user-facing language.

## 2.6.0 — 2026-09-10 — Trip Report first cut

First cut of the Trip Recorder (auto-record via `navigation.state`,
17-KPI grid, OpenSeaMap trace, PNG report card, WhatsApp share).
Gust marker and gust strategy tuning. Reload-race fix so gain and
calibration sliders always reflect real pypilot values.

## 2.5.2 — 2026-09-10 — Session-recorder containment

Contains a rebound bug that opened one JSONL file per engage
flicker: 8 s engaged-debounce, short-session discard on close, plus
bounce diagnostics exposed on `/session-recorder/status`.

## 2.5.1 — 2026-09-09 — README bilingual

Bilingual README update. No code change.

## 2.5.0 — 2026-09-09 — Race helpers

Tack countdown, post-tack stats, persistent tack log, Smart Pilot
"auto-brain" (auto profile by wind + gust strategy + auto-disengage
on lost authority). Info modal safety notice.

## 2.4.1 — 2026-09-08 — TWS alt paths, watch focus cut, popup polish

Support for alternative TWS paths, watch-focus reduction on the
Pi Zero W, redesigned rose colour palette, popup header + close
button consistency.

## 2.4.0 — 2026-09-07 — Dynamic watches, session recorder, log capture, plain-language gain help

Dynamic watch focus (per Sean D'Epagnier's advice), navigation
session recorder + shared-advice loop, Pi Zero log capture over
SSH, plain-language help on every gain slider, alarm engine and
Doctor now speak the user's language.

## 2.3.0 — 2026-08-31 — Chart hover, Tune fork, Setup chips

Chart hover-freeze, per-slider ↺ restore, first-change profile-fork
prompt, live status chips on every Setup tile, Doctor Hide / Discard
buttons that stay visible.

## 2.2.1 — 2026-08-24 — Screenshots on the NPM page

Docs-only: embed screenshots in the README so they render on the NPM
website.

## 2.2.0 — 2026-08-24 — Intelligence layer over pypilot

The release that turned the plugin from a UI into a **layer of
intelligence over pypilot**: Head-to-wind ("Aproado") pseudo-mode,
telemetry historian + Chart tab, Sensor Quality, Servo Health, Alarm
engine, Pre-departure Autopilot Check, Pypilot Doctor with profile
fork, Setup as a launcher grid, interactive SSH console, full
RangeSetting sliders in Calibration, first swap of Target + Wind
arrow shapes, full i18n audit across EN / ES / DE / FR.

## 2.1.0 — 2026-08-10 — Race + Info + config export

Race timer tab, Info tab with quick-start, config export / import
via Web Share, minor UI polish.

## 2.0.4 — 2026-07-30 — Infinite reconnect

Socket reconnection attempts uncapped so long outages recover
without a plugin restart.

## 2.0.3 — 2026-07-28 — Access request flow

Signal K access-request flow reworked so admins approve the visor
once and it just works.

## 2.0.2 — 2026-07-25 — Wind corner display

Preference for AWA / TWA corner display; auto-follows AP mode when
unset.

## 2.0.1 — 2026-07-23 — Rose colours

Rose colour palette refined. Minor visual fixes.

## 2.0.0 — 2026-07-20 — Signal K path rewrite (breaking)

**Breaking release addressing feedback from Sean D'Epagnier**. Every
pypilot key now maps 1:1 to `steering.autopilot.pypilot.<key>`
verbatim — no more hand-picked renames or unit conversions.
Setup → Emergency ships the restart triad (`restart pypilot_web` /
`RESTART pypilot` / `reboot Pi`), each guarded by a helm-manned
confirmation modal. Debug console with SSH-based preset diagnostics.

## 1.0.0 — 2026-06-12 — Initial release

First public release. Touch webapp, compass rose, Tune tab with
gain sliders, Setup with LAN scan and manual host, initial Signal K
path publisher.
