# Changelog

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
