# Changelog

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
