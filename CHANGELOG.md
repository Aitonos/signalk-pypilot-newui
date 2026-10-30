# Changelog

## 3.7.3 — 2026-10-30 — Reconnects on a weak link

Rolls up Rev561 → Rev563 on top of 3.7.2. Patch: fixes only, found on a
flaky 4G link between laptop and boat.

### Fixed
- **Network banner**: it no longer shows "Network OK" while no data is
  arriving. A reconnect used to count as fresh data, and the health
  ping had no timeout, so a dead link was never reported and the
  banner flickered between warning and OK.
- **Reconnect after a failure**: the visor no longer aborts a connection
  that is still opening. Firefox delays new WebSockets to a server after
  a failure, and each early abort counted as one more failure, so after
  a laptop sleep the visor could stay disconnected while plain requests
  worked.
- **Signal K approval asked again**: the visor no longer discards its
  permanent device token when it cannot reach the server at start-up.
  A network error was taken as a revoked token, so opening the visor on
  a weak link asked for a new approval. Only an explicit "unauthorized"
  from Signal K does now; otherwise it keeps the token and checks again.

### Docs
- README: AUTO WIND listed among the manoeuvres pypilot doesn't have.

## 3.7.2 — 2026-10-28 — Faithful wind arrows, reconnect after sleep

Rolls up Rev558 → Rev560 on top of 3.7.1. Patch: fixes only.

### Fixed
- **Wind arrows on the rose**: the apparent-wind (A) arrow lagged the
  true-wind (T) arrow by seconds - it went through a render smoothing
  filter while T was drawn raw, and 3.7.1 also dropped wind to 1 Hz so
  A moved in jerks. Both arrows are now drawn with the raw sensor value,
  and apparent wind, true wind and heading arrive at 2 Hz, so with the
  boat stopped A and T move together.
- **Hidden-tab stream (3.7.1)**: a frozen background tab could deliver
  the old socket's close after returning, marking pypilot offline and
  opening a second stream. Only the current socket counts now.
- **Reconnect after the laptop sleeps**: the browser could keep a dead
  connection "open" for minutes, or hang while connecting, and the
  visor never reconnected. A watchdog reopens the stream after 15 s of
  silence, a 10 s hung connect, or at once when the machine wakes up.

## 3.7.1 — 2026-10-28 — Less data to the visor, logbook fixes, registry score

Rolls up Rev553 → Rev557 on top of 3.7.0. Patch: no new features, no
breaking changes.

### Changed
- **About two thirds less data from the Pi to each open visor** (measured
  moored: 693 → 237 KB/min, ~41 → ~14 MB/h per tab; see
  `docs/_audit_data_flow_2026-10-27.md`). Matters on a 4G link.
  - The plugin's diagnostic paths (session stats, servo health, roll FF,
    tack catch-up, leeway) are published only when they change, plus a
    30 s heartbeat. Before, 34 paths went out every second unchanged, to
    every Signal K client.
  - The visor's dashboard subscription now runs at 1 Hz (wind, depth and
    attitude were arriving at 2 Hz). Pilot commands and state keep
    their instant subscription.
  - A visor tab hidden for 2 minutes closes its stream and reopens it on
    return - never while the pilot is engaged, so voice alarms keep
    working while steering. Also frees one of Signal K's 30 WebSockets
    per client IP: above that limit Signal K refuses new ones (HTTP 429)
    and the visor showed "Intermittent network" while Freeboard would
    not load.
- **Logbook**: "anchored" alone no longer opens a trip - an anchor watch
  set in the marina recorded a 21 h "trip" at the dock. A trip opens
  when the boat gets under way and closes back in port; trips under
  0.1 nm are discarded.

### Fixed
- App Store screenshots: listed as plain paths; the Signal K App Store
  and plugin registry ignored the previous `{src, title}` entries, so
  none of the 8 showed.
- Plugin registry "test suite failing": the suite passes, but it takes
  ~80 s and the registry stopped it at 60 s. The repo now declares the
  Signal K `plugin-ci` workflow, which also tests the plugin on Linux,
  macOS and Windows with Node 22 and 24.

## 3.7.0 — 2026-10-26 — Route following (NAV), black box, external review fixes

Rolls up Rev521 → Rev551 on top of 3.6.0. Minor bump: new NAV route
following and black box. No breaking changes. The steering fixes come
from a full code review by two external LLMs plus four self-audits; not
yet tested at sea (see `docs/QA_Rev526-540.md`, rollback tag
`pre-audit-rev530`).

### Added
- **Follow Freeboard routes with pypilot's NAV mode, no extra plugins**:
  the plugin reads the active route from Signal K's Course API, computes
  leg bearing, cross-track error and arrival itself and sends an APB
  sentence every second on Signal K's NMEA output, which pypilot already
  reads - NAV then appears in pypilot. Cross-track error capped both
  ways (pypilot caps it only on one side). Waypoints advance on their
  own (arrival circle or perpendicular passed) with a spoken message:
  "Waypoint X reached. Next, Y. New course N degrees. D miles." At the
  destination, or if the route or the GPS position is lost for 5 s, the
  pilot goes to compass on the current heading and says so (also with
  the AP disengaged, where pypilot would otherwise pick GPS). Engage
  from Freeboard / KIP with a route goes straight to NAV; in the visor
  NAV is chosen in the mode list ("NAV (ROUTE)"), with a confirmation
  when it would turn more than 60°. ±1 / ±10 in NAV take over in
  compass with the new heading; tacking in NAV is refused. "Next
  waypoint" in the mode list and through the Autopilot API. Mode button
  shows "NAV · waypoint · nm". Status on `steering.autopilot.route`.
- **Black box** - chart with every recorded field (one band each, touch
  cursor with all values), View / Download of each incident, Setup tile
  amber until the incident has been opened, and a **note** per incident
  dictated with the phone keyboard (Mark asks for it right away; a
  second Mark in the same incident adds to it).
- **Black box** (Setup card): keeps the last minute of autopilot data
  and saves one minute before and one after when something happens - AP
  taken off from outside the app, stuck pilot or recovery cycle, servo
  overcurrent fault, a tack slower than usual (40 s, gybe 75 s) or that
  failed, an alarm with the AP engaged - or when you press Mark (also a
  long-press on the helm button of the rose). Each incident shows heading
  error, apparent wind and servo current with the fault marked, its
  events, and can be downloaded. The newest 50 are kept.
- **Saved displays**: name the rose layout (corners, arrows, overlays,
  bottom bar) and keep it on this device or on the server for every
  device; apply it in one tap from the rose configuration window.
- **Tap sound** (rose configuration, off by default): a short, bright
  sound on every button tap so you know it registered in wind and noise.
  Five lower sounds to choose from (wood, drop, soft thud, low bell, low
  click) with a test button; soft thud by default.

### Changed
- Rose ring, ticks and the heading / wind box frames in grey (#8e9bab);
  degree labels and card / corner titles in white.
- Gust strategy **"freeze target" removed**: it rewrote the target every
  second for 12 s, undoing the sailor's nudges, tacks and mode changes.
  Saved configs with it behave as "warn".
- App Store: recommended companion plugins, PNG app icon, reorganised
  README and screenshots.
- An ACK on an alarm banner also closes it.
- **More contrast for sunlight**: white text, brighter secondary text,
  borders and separators.
- **AUTO WIND** also switches with the AP disengaged (engaging lands in
  the right mode), but only with at least 3 kn of true wind - in port
  the true wind angle is noise.
- English label of the downwind pseudo-mode: **DEAD DOWNWIND** (was
  "head downwind").

### Fixed
- **Pilot core** (external review): targets kept in the mode's own
  range; a target retry is dropped on a mode change; mode change then
  target in sequence, waiting for pypilot's echo (reverts if refused);
  late echoes of a burst of nudges no longer pull the target back, and
  the target is reconciled to pypilot's last command; handover to a wind
  mode waits and verifies; API tacks go through the virtual tack, API
  nudges re-aim a running tack, KIP cancel stops it; a small overshoot is
  arrival, not a 360.
- **Alarms**: a muted alarm still clears; ACK, mute and severity are
  republished; "AP dropped" uses STW without GPS; unable-to-steer
  ignores missing RMS; the black box opens an alarm incident only when
  the alarm fires.
- **Doctor**: clamps to pypilot's gain range, waits for its forked
  profile, one change per session, apply-all locks only after success.
- **Recording / storage**: trip ids validated before building paths;
  atomic writes (display presets, black-box incidents); recorders keep
  lines on a failed write; the active session cannot be deleted; KPI
  integration on real time steps; restore never sends orders.
- Head-to-wind / downwind: the manoeuvre flag expires (180 s), a failed
  mode change ends it, cancelled manoeuvres write nothing.
- App dialogs above popups (the black-box Delete confirm was hidden).
- Tack buttons: the arrow is centred when there is no number under it
  (wind modes).
- **Screen kept on over plain http** (tablet at http://<ip>:3000): the
  Wake Lock API only exists on https / localhost; a tiny silent looping
  video now keeps the screen on there, and the lock is re-taken after
  the browser releases it.
- **"AP disengaged from outside the app" fired in port** on every
  Signal K restart (the first ap.enabled=false is the initial sync) and
  with no GPS (unknown speed counted as underway).

## 3.6.0 — 2026-10-19 — AUTO WIND and a logbook button on the rose

Rolls up Rev517 → Rev520 on top of 3.5.0. Minor bump: new AUTO WIND
pseudo-mode. No breaking changes; AUTO WIND is off until chosen.

### Added
- **AUTO WIND pseudo-mode**: apparent wind below 120° TWA, true wind
  above (hysteresis ±5°, 10 s sustained, at most one switch per 30 s;
  never during a tack, head-to-wind, head-downwind or with the AP off).
  Each side has its own pypilot profile, chosen in the mode window, so
  the true-wind side can be the more reactive one. Runs in the backend
  (works with the visor closed); picking any other mode, or compass from
  the remote, turns it off. Mode button shows "AUTO · REAL / APPARENT".
  Without GPS pypilot offers no true wind: the entry is shown greyed out
  ("needs GPS for true wind"), and pypilot's own drop to compass on a
  GPS loss does not turn AUTO WIND off.
  Listed right below compass / GPS in the mode window.
- **Logbook button**: while a trip is being recorded it opens that trip;
  in port it opens the logbook list.
- **Logbook button on the rose**: a helm icon on the left, mirroring the
  tide button on the right, opens the Logbook full screen; its x goes
  back to the rose.

## 3.5.0 — 2026-10-19 — Fixes from two sea trials, logbook while sailing

Rolls up Rev509 → Rev516 on top of 3.4.0. Minor bump: live logbook,
heading in the compass tack summary, trace pruning. No breaking changes.

Rev515 comes from the sail of 2026-10-19: it reverts two changes that
made things worse (Rev510 compass-until-6°, Rev512 head-to-wind in
compass) and fixes what the sail showed. Audit:
`docs/_audit_sail_2026-10-19.md`.

### Changed
- **Maneuver traces keep the newest 60 files** (pruned when a new trace
  opens). 201 files / 888 MB had piled up on the Tunatunes.
- **Stuck pilot recovery only on a real false end stop**: it now needs
  pypilot's directional overcurrent fault. 0 A is not evidence (the
  TinyPilot reads 0 A while driving, `DRIVER_TIMEOUT`), it never acts
  during pypilot's own tack or for 20 s after, and a target change of
  more than 10° restarts its clock. On 2026-10-19 it cycled the AP three
  times by mistake, twice in the middle of a tack from the remote.
- **Gybe confirmation only right after a cancel**: the long-way gybe
  question (> 180°) now appears only within 20 s of cancelling a tack -
  the 2026-10-18 accident - not on deliberate gybes. Yes / No buttons
  are translated.

### Added
- **Logbook while sailing**: the trip being recorded appears in the
  logbook with an "IN PROGRESS" badge, live statistics (distance, time,
  speeds, wind, tacks, energy...) and the track on the chart up to now.
- **Tack summary in compass mode** shows the mean heading before / after
  instead of the apparent wind angle.
- **Confirmation before a gybe the long way** (see above).

### Fixed
- **Cancelling a virtual tack left a "ghost" target**: pypilot processes
  the mode change in its own loop and overwrote our "stay here" target
  with one recomputed from the compass error (2026-10-19: 56° -> 3.9°,
  bow into the wind). The cancel now waits for the mode change, writes
  the target, checks it and rewrites it if pypilot moved it.
- **Remote tack HUD turning the wrong way**: pypilot overwrites
  `ap.tack.direction` with the wind side ~0.5 s after the remote starts a
  tack; the HUD now keeps the direction it had at the start. It also stays
  open until the boat is within 10° of the new target (max 15 s), not only
  until pypilot's 50 % threshold.
- **Tack countdown**: shows the distance from the wind arrow to the target
  diamond along the turn (what the rose shows), no "ajustando" text.
- **Two screens showing different modes after a tack**: the mode now
  comes from the backend (plain mode label, no "TACKING ->" prefix).
- **Previous manoeuvre's summary popping up during the next one**.
- **Settings tab**: dragging a slider no longer darkens the whole tab
  (only the other rows), and the darkening clears if the touch is
  interrupted. A value the sailor writes stays on screen until the
  backend confirms it (or reports a different one).
- **`ap.tack.direction` noise in standby**: published as `none` once
  while the AP is off (pypilot flips it ~40 times a minute there).
- **Gust ghost arrow almost never visible**: the fade started in the
  same frame the ghost was created, so the browser skipped it.

### Reverted
- Rev510 "virtual tack holds compass until 6° of the final heading": the
  apparent wind at the final heading is not the mirror, so wind mode then
  swung back 40-50° (S-turn); handover is at 20° again.
- Rev512 "head to wind holds in compass": head to wind is always in
  apparent wind, as before.

## 3.4.0 — 2026-10-18 — The sailor always wins, and the pilot gets unstuck

Rolls up Rev506 → Rev508 on top of 3.3.0, from the strong-wind sea
trial of 2026-10-18 (26 kn TWS, 48° heel). Minor bump: new opt-in
recovery and alarms. No breaking changes; everything new is off until
enabled.

### Added
- **Stuck pilot recovery** (Smart Pilot card, opt-in). With no rudder
  sensor, pypilot treats an overcurrent as the end of rudder travel and
  stops driving that way. If the AP is engaged, the heading error is
  over 25° and growing and the servo is not pushing for 4 s, the plugin
  turns the AP off and on (0.7 s, same mode and target), which clears
  that fault in pypilot. At most 3 tries per minute. An order from the
  sailor during the cycle wins, and a running virtual tack is kept.
- **New alarms** (opt-in, Setup > Alarms): `steer-stuck`,
  `steer-gave-up` ("steer by hand") and `steer-dropped` (AP disengaged
  from the remote or the TinyPilot keys while underway).
- **+-1 / +-10 during a virtual tack** move the tack's final heading
  instead of being rejected.
- `servo.flags` is watched and saved in every session sample.

### Fixed
- **Taking the AP off now cancels a virtual tack**, whatever the source
  (visor, KIP, remote, TinyPilot). Before, the tack kept running and
  rejected the sailor's own headings until it finished. After a cancel
  the boat holds its current wind angle.
- Repeated taps on the tack button within 1.5 s no longer chain
  start / cancel / start (wind modes).
- `unable-to-steer` can fire again: it required servo duty, which the
  TinyPilot never reports. It now also fires on a large error while the
  servo is stopped by an overcurrent fault.
- Settings tab: unlocking a group no longer asks about the profile; the
  question appears only for PROFILE settings. Open or unlocked groups
  are no longer folded, relocked and reset to old values by the 10 s
  background refresh.

## 3.3.0 — 2026-10-19 — Light on the Pi, AIS on the ring, settings shared by every device

Rolls up Rev483 → Rev505 on top of 3.2.0. Minor bump: new shared
visor settings in the backend, Raspberry Pi performance work, AIS rose
fixes from port and sea QA in Moaña, tide popup polish. No breaking
changes; the first visor that connects uploads its old per-device
settings, so nothing is lost.

### Added

- **Settings shared by every device.** AIS mode (harbour / at anchor /
  sailing), AIS voice, harbour auto-silencer, gust ghost and the list
  of silenced AIS targets now live in the plugin (`/visor-prefs`), not
  in each browser. Silencing a target on the tablet silences it on the
  phone and the laptop too; the harbour auto-silencer is decided once,
  from the boat's SOG, instead of separately by each screen. (Rev498,
  Rev499)
- **Light mode on the Raspberry Pi's own screen.** The visor detects
  the Pi's browser and drops animations, blur and glow, and only
  touches the page when a value really changes (291 → ~9 DOM writes
  per second). Pi GPU with the visor open: Chromium 15 % → 3 %.
  (Rev490 → Rev492)
- **Firefox on the Pi: one-tap fix.** Firefox's GPU renderer overloads
  the Pi's graphics chip (GPU ~90 %, 64 % of video frames dropped). The
  Info tab explains it and an **Apply now** button writes
  `gfx.webrender.software` into that Firefox's profiles; a one-time
  notice points there. Also in the README (Troubleshooting).
  (Rev500 → Rev502)
- **Interactive tide curve** in the tide popup: hover / drag cursor
  with time, height and trend, big trend arrow, collision-free labels;
  tide button always shown, with an install prompt and App Store link
  when AnchorWatch Pro is missing. (Rev483 → Rev489)
- **Info tab: companion plugins** with live installed / missing status
  and App Store links. (Rev485)

### Fixed — AIS

- **Targets sit on the compass ring** at their real bearing, with a
  distance label, instead of being parked on top of our own hull in a
  marina (the log distance scale put every target under 50 m there).
  (Rev494)
- **Moored boats no longer "move".** Class B boats report 0.3-1.6 kn of
  GPS noise when tied up; a target counts as stopped when its AIS nav
  status says moored / anchored / aground, or when two minutes of its
  positions stay inside 30 m. No course line, no "moving" alarms.
  (Rev503)
- **"Closing" speed in the infobox** was distance / TCPA (a moored boat
  at 48 m showed 37 kn); now the real range rate. (Rev495)
- **Autopilot alarm banner always visible.** It was drawn below the
  maximised chart, popups, the regatta HUD and the network banners:
  the alarm beeped and spoke but could not be seen. (Rev497)

### Fixed — other

- **Recorded sessions / session tags / received advice dialogs could
  trap you.** The only way out was the Close button at the end of the
  content; with many sessions (224 on the test boat) it was pushed
  off-screen. Now an X is always visible, the list scrolls inside the
  dialog with title and Close fixed, and tapping outside or Escape
  closes it. (Rev504)
- **Recorded sessions capped at the newest 50** (one is recorded per
  engage; 224 had piled up). On top of the existing 200 MB budget.
  (Rev505)

### Docs / package

- README rewritten against the code: license (AGPL-3.0-or-later), the
  free-form SSH console described honestly, 14 alarm rules, polar
  plugins named, Head-to-wind **and** Downwind pseudo-modes, every
  integration (AnchorWatch Pro, chartplotter, AIS, polars) in the intro,
  no invented plugins or path counts.
- New App Store / README screenshots (8): rose with AIS, embedded chart,
  AnchorWatch Pro inside the rose, tide popup, head to wind / downwind
  modes, tune, logbook trip, tack history. JPEG under 500 KB each; test
  files no longer shipped (package 3.4 MB → 1.4 MB).

## 3.2.0 — 2026-10-15 — AIS rose rebuilt on real positions, tide popup, chart kept warm

Rolls up Rev470 → Rev482 on top of 3.1.4. Minor bump: new UI (tide
button + popup, "Chart in the background" card, anchor-watch visor
embedded in the rose) plus a set of AIS rose fixes found in port QA in
Moaña. No breaking changes.

### Fixed — AIS targets on the rose (root cause)

- **The target position/SOG/COG cache never filled.** The REST calls
  used `encodeURIComponent` on the vessel URN
  (`urn%3Amrn%3Aimo%3Ammsi%3A…`) and Signal K answers 404 to that; the
  raw URN answers 200. With an empty cache the hull fell back to
  `cpaPositions.target` — the target's FUTURE position at CPA — so a
  boat coming from 7 o'clock was drawn at 11 o'clock and "0 m" away.
  The fallback is removed: no current position → no hull on the rose
  (the infobox still shows the alarm). Cache refresh 30 s → 5 s.
  (Rev474)
- **Hull and projected track were drawn 180° off.** The sprite has its
  bow at +x, so a direction needs `rotate(angle − 90)`; Rev457 used
  `+ 90`. (Rev470)
- **Moored boats.** A stopped target's COG is GPS noise: the hull is
  oriented by `headingTrue` when available, by COG only when moving
  (≥ 0.5 kn), otherwise it points at us; the dashed track is drawn only
  for moving targets and always along COG. The "stationary" filter
  (now 0.5 kn) is re-evaluated when the REST cache lands, not only on
  the alarm delta. (Rev470, Rev471)
- **Targets drawn on top of our own hull.** Radial position is now a
  log scale (50 m → 2 NM) over the free ring between our hull outline
  and the compass ring, with a distance label ("40 m", "0.4 NM") under
  each target. (Rev472)
- **Target name in the infobox** comes from the Signal K vessel `name`
  first, then from the alarm text; "MMSI 123456789" is no longer shown
  as a name. (Rev481)
- **AIS card:** the Harbour / At anchor / Sailing selector showed raw
  i18n keys; all texts rewritten in plain language (EN/ES). (Rev473)
- **Unstyled flash on reload:** critical inline CSS in `<head>` and
  `style.css?v=RevNNN` cache-busting from `deploy.ps1`. (Rev476)

### Added

- **Tide button** above the bottom-right corner tile of the rose (shown
  only when `signalk-mareas-ihm` is installed). Opens a popup with the
  station, current height, rising/falling, coefficient, next HW/LW and
  a −6 h → +12 h tide curve. "Open full Tides" opens the
  signalk-mareas-ihm anchor-watch visor inside the rose, same chrome as
  Freeboard (maximize / close). Data from `/signalk-mareas-ihm/api/extremes`
  and `environment.tide.*`, fetched only when the popup opens.
  (Rev478 → Rev480, Rev482)
- **Freeboard-SK kept loaded in the background** so a double-tap on the
  rose opens it instantly with AIS names already in place. Own card
  "Chart in the background" with a per-device switch and a "?" that
  explains when to turn it off (lag / battery). (Rev475 → Rev477)

## 3.1.4 — 2026-10-14 — iOS "Add to Home Screen" PWA basics (issue #5)

Rev469. Patch bump: no code changes, just the HTML shell. Thanks to
[@eric-fitzsimon](https://github.com/eric-fitzsimon) for the detailed
report in [#5](https://github.com/Aitonos/signalk-pypilot-newui/issues/5):
on iOS, adding the webapp to the home screen worked the first launch,
then subsequent launches loaded the page but Tune gain sliders stayed
empty and Chart did not populate.

### Added — PWA meta tags in the shell

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="PyPilot" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="theme-color" content="#0a1220" />
<link rel="apple-touch-icon" href="icon.svg" />
```

Previously the shell had none of these, so iOS treated the home-screen
bookmark as a half-baked WebView bookmark with a storage context
distinct from Safari and no explicit standalone contract.

### Fixed — stale `app.js` cached indefinitely by iOS WebView

Added `Cache-Control: no-cache, no-store, must-revalidate` + legacy
`Pragma` / `Expires` HTTP-equiv metas to the shell. iOS Safari (both
browser and standalone WebView) was caching the first successful load
of `app.js` and ignoring the `?v=RevNNN` query bump that `deploy.ps1`
writes on every deploy. Result: user's bookmark served a stale JS
bundle for days, mismatching the backend API and leaving features
unpopulated. These metas force the WebView to re-fetch the shell on
every launch; the actual `app.js?v=RevNNN` request then matches the
current backend.

See `docs/_audit_ios_pwa_issue_5.md` for the full forensics.

### Known limitations

- `apple-touch-icon` points to `icon.svg`. iOS prefers PNG for the
  home-screen icon; with SVG only, iOS may use a page-screenshot
  fallback. A proper PNG set is TODO for a future release.
- No Service Worker. Rev-A path only — if the Cache-Control metas do
  not fully fix the issue on Eric's device, Rev-B/C/D will add a
  `visibilitychange` reconnect handler, a standalone-mode banner with
  "Reset app data" button, and eventually a proper SW. Not shipped
  yet because they are not confirmed necessary.

## 3.1.3 — 2026-10-14 — Safety: offline-aware write gating + batched trace + AIS polish

Rolls up Rev464 → Rev468 (5 revs) on top of 3.1.2. Patch bump: no
breaking changes; set of safety-oriented fixes triggered by the
2026-10-12 sea trial where the sailor "pasó miedo" when the 4G link
dropped repeatedly and the visor's controls were still clickable while
pypilot_web was silent.

### Added

- **Auto-OFF harbor-mode toggle in the AIS overlay card** (Rev464).
  The 2-min SOG≈0 auto-silencer can now be flipped off from the
  overlay-card without opening the plugin config, so sailors can keep
  testing AIS behaviour while moored.
- **AIS MMSI normalisation — root-cause fix for "no sale en posición
  relativa"** (Rev463). `signalk-collision-alerts` publishes the full
  URN as the path tail (`notifications.navigation.closestApproach.urn:mrn:imo:mmsi:XXXXX`);
  our extractor used to return the URN verbatim, which was then
  concatenated again when fetching the target's REST position → double
  URN → 404. The hull fell back to `cpaPositions.target` (future CPA
  position) instead of the real current position. Fixed by extracting
  only the trailing numeric MMSI (`/(\d{6,})$/`). Hulls now paint at
  the real bearing with the real COG, and the dashed track line
  reflects reality.
- **Pypilot-offline bloqueante banner + write gate across the board**
  (Rev465). When the plugin backend reports pypilot core offline, a
  centred red banner blinks over everything and every write-side
  control is simultaneously:
  1. Visually dimmed + `pointer-events: none` (CSS).
  2. Gated in JS: `pluginRaw()`, `apEngage()`, `apDisengage()`,
     `apSetMode()`, `apSetTargetRad()`, `apTack()` all return
     `{ok:false, blocked:true}` before firing any HTTP write.
  No stale commands can be queued while the pilot is unreachable.
  See `docs/_audit_sea_trial_2026-10-12_network.md`.
- **Batched maneuver-trace** (Rev468). New backend endpoint
  `POST /plugins/signalk-pypilot-newui/maneuver-trace/events` accepts
  `{events: [...]}`. The visor now queues events locally and flushes
  every 2 s (or on 50-event cap, visibilitychange hidden, beforeunload)
  instead of one POST per event. Active navigation went from
  ~5-10 POST/s to ~0.5 POST/s on `maneuver-trace`; the sailor's 4G
  link survives a lot longer under load.

### Fixed

- **WS close → pypilot marked offline immediately** (Rev466). The
  visor's SK WebSocket drop used to leave `pypilotHealthy` stale
  until the next `/status` poll — the controls stayed enabled during
  the gap. The `ws.addEventListener('close')` now flips the state and
  activates the banner within milliseconds. `_pypilotWriteBlocked()`
  also checks `ws.readyState !== OPEN` so a write cannot slip through
  on a dead socket.
- **Setup-tab slider values no longer "tardan"** (Rev460). The
  callback that applied the plugin's `/values` response to the Tune
  sliders was missing after Rev459; sliders stayed on `---` until the
  next render cycle. Now the response updates the slider in place.
- **Freeboard-SK embed stays mounted** (Rev461). Closing the embed
  no longer blanks the `<iframe src>`; reopens are instant without a
  full chart + tile reload.
- **Background refresh of plugin values every 10 s** (Rev461). The
  initial boot loop stopped as soon as one AutopilotGain landed, so
  the rest of the catalog filled in only when Setup was opened. A
  low-rate background tick now keeps the cache warm, so Setup opens
  pre-populated regardless of how long the sailor stayed on Control.

### Changed

- **README — chart provider recommendation** now puts
  [`signalk-charts-provider-simple`](https://github.com/dirkwa/signalk-charts-provider-simple)
  (by @dirkwa, same maintainer as `signalk-collision-alerts`) as the
  **recommended** pairing for the embedded Freeboard-SK, with
  `@signalk/charts-plugin` kept as an alternative. Pointed by Carlos
  as the simpler path for sailors new to Signal K charts.

### Upstream coordination

- `hkapanen/ais-forwarder#14` — added impact comment: 11+ days without
  MarineTraffic / VesselFinder presence on Tunatunes while the plugin
  stays disabled to prevent the uncaughtException cascade. Posted a
  concrete minimal fix (`socket.on('error', ...)` + send callback) and
  offered a PR.
- `dirkwa/signalk-collision-alerts#17` — closed by maintainer with a
  fix. Opened `#24` with proposal to suppress alerts when either
  vessel is effectively stationary (SOG-aware threat check).

## 3.1.2 — 2026-10-10 — Compatibility with pypilot 0.71 (issue #3)

Patch: swap socket.io transport order from
`["websocket", "polling"]` to `["polling", "websocket"]` so the
plugin keeps working with the stricter Flask-SocketIO +
Python-Engine.IO combo shipped with pypilot 0.71. Thanks to
[@altarceyhun](https://github.com/altarceyhun) for the detailed
reproduction + verified workaround in
[#3](https://github.com/Aitonos/signalk-pypilot-newui/issues/3).

### Fixed

- **pypilot 0.71 — bare WebSocket handshake fails** (Rev450,
  issue #3). pypilot <= 0.56 accepts a direct WebSocket upgrade;
  pypilot 0.71 rejects it and only lets the client in via the
  canonical polling handshake with a later WS upgrade. Swapping the
  transport order to polling-first keeps both pypilot versions
  working without any behavioural change for the user (socket.io
  still upgrades to WebSocket after the handshake when the server
  allows it).

## 3.1.1 — 2026-10-10 — Refreshed screenshots

Patch: swaps in four up-to-date screenshots (captured on sea trial
2026-10-10, Rev449) so the SK App Store listing shows the 3.1.0
feature set — Control rose with heading-precision gauge + AIS hull
top-view, Freeboard-SK chartplotter embedded in the rose, Logbook
trip detail with OpenSeaMap trace + SOG/AWS chart, and the refreshed
Tune sliders. No code changes.

## 3.1.0 — 2026-10-10 — Fullscreen auto, configurable bottom chip, heading precision, AIS polish

Rolls up Rev439 → Rev449 (11 revs) on top of 3.0.0. Minor bump: a
family of UX refinements + a couple of safety-oriented fixes;
backward-compatible with 3.0.0 plugin config and SK paths. The theme
of the release is **"glance information at a distance"** — the sailor
mounts the tablet across the cockpit and reads the visor as a true
instrument, so chip sizes, legibility, precision indicators, and
fullscreen-by-default all got tightened in this bump.

### Added

- **Fullscreen + Screen Wake Lock auto-on by default** (Rev446/Rev448).
  On the very first user tap, the visor requests browser fullscreen
  on `<html>` and takes a `navigator.wakeLock("screen")` so the
  display never dims nor locks — same UX as YouTube's player. A
  floating ⛶ button top-right toggles both and persists the sailor's
  choice (`localStorage[pypilot-newui.fullscreenAuto]`), so later
  reloads honour "I opted out".
- **Configurable bottom chip on the rose — up to 4 datapoints
  cycled** (Rev439 → Rev445). Short-tap on the chip under the compass
  cycles through the user-picked set (default: SOG → Depth → %Polar);
  long-press opens a modal where the sailor picks up to 4 datapoints
  from the same catalog as the four configurable corners (base paths +
  performance extras + any custom SK path registered in a corner).
  Persisted in `localStorage[pypilot-newui.roseBottomChipPaths]`.
  Replaces the old "always AWS/TWS mirror" behaviour.
- **Heading-precision gauge under the compass readout** (Rev443/Rev444).
  Second line inside the `#rose-hdg-chip` shows how far off the pilot
  still is from its own target — the sailor's "glance accuracy
  reading", not the target value itself. Signed `target - current`:
  negative = pilot must correct to port (babor), positive = to
  starboard (estribor). Colour: `|err|<3°` green, `<10°` orange, else
  red. In compass / gps / nav uses heading − target; in wind / aproado
  uses AWA − target; in true wind / empopado uses TWA − target.
  Shows `--` when the AP is OFF (`state.engaged === false`) so a
  stale `state.target` can never mislead the sailor.
- **Safe-exit to compass after APROADO / EMPOPADO** (Rev440). When
  the user finishes an aproado or empopado without opting in to full
  `restoreAll`, the visor now auto-switches the pilot back to COMPASS
  with the current heading as target. Rationale: leaving the pilot in
  WIND / TRUE WIND after the manoeuvre is less stable for "hold what
  I have now" than COMPASS. Carlos sea-trial 2026-10-10. Falls back
  to no-op if the heading sensor is absent.
- **AIS target as a tinted top-view hull sprite** (Rev442 → Rev443,
  Rev447 → Rev449). Replaces the plain red triangle with the
  `boat-cenital.svg` sprite (same asset as the own-vessel sprite in
  the rose centre), tinted via SVG `feColorMatrix` filters per state:
  red (alarm, blinking, 150 % scale) · orange (warn, fixed, 100 %) ·
  blue-grey (acked, no blink, 100 %). Bow always points toward the
  self vessel (rotation now `rotate(relDeg + 90)` to match the
  horizontal asset). Alarm sprite blinks; acked stays fully visible
  but muted. Paints as the LAST element inside the rose SVG so it
  stays on top of wind arrows, sectors and HUDs.
- **Only the 3 most urgent AIS targets painted** (Rev441). When more
  than 3 collision alarms are active, only the 3 lowest-TCPA ones
  render on the rose. The infobox navigator still walks ALL alarms so
  the sailor can scroll through the hidden ones.
- **Tap on an AIS target opens its data popup** (Rev441). Click
  delegation on `#ais-alarm-layer`: tapping a hull sets
  `_aisInfoboxIdx` to that MMSI and forces the popup open — works for
  both pending and silenced targets. Auto-resets to the newest threat
  after 20 s if no further interaction.
- **ACK keeps the AIS target arrow on the rose** (Rev441 → Rev442).
  ACK no longer deletes the MMSI from `state.aisAlarms`; the hull
  stays visible (silenced style) until the plugin declares the
  threat gone. Button toggles ACK ↔ ACKED (ES: SILENCIAR ↔
  SILENCIADO), with `disabled` + `.is-acked` styling when the MMSI is
  already acknowledged.
- **X close button on the AIS infobox** (Rev442). When the sailor
  opened the popup by tapping a hull, the X dismisses it and clears
  the user-pick flag so new threats can take over.
- **Long "Viento Aparente" / "Viento Real" labels in the mode-selector
  modal** (Rev441). The modal shows the long names so wind modes are
  explicit on first open; the bbar button keeps the short labels
  (APARENTE / REAL) to fit the narrow chip.
- **Landscape tabbar made compact** (Rev446). `.tab-btn` padding
  `12→4 px`, font-size `14→12 px` inside
  `@media (orientation: landscape)`. Saves ~20 vertical pixels for
  tablets mounted horizontally.

### Changed

- **Heading chip grows UPWARD** (Rev444). The chip rect height
  expands toward `-y` (bottom edge still at `-84`), so the new
  precision line never covers the target diamond that sits just
  below the top of the compass ring.
- **AWS / TWS sub-line font-size bumped three steps** (Rev443 →
  Rev445). From `clamp(11, 2vw, 16px)` to `clamp(20, 3.8vw, 32px)`
  so the kn number sits halfway between the dim corner label and
  the big angle value when read from the helm.
- **AIS voice is a short safety nudge, not a report** (Rev441,
  Rev449). The voice line used to spell CPA / TCPA / MMSI, which TTS
  mangled on long numbers. Now it just says *"Alarma AIS, target en
  rumbo de colisión"* / *"AIS alarm, target on collision course"*;
  the data stays visible in the infobox. ES says "AIS" as a word
  (Rev449 — was "A I S" letter-by-letter).

### Fixed

- **AIS target bearing was 180° off in some geometries** (Rev448 —
  found during 2026-10-10 sea trial). `renderAisAlarms` checked
  `state.position.latitude` but `state.position` carries short keys
  `{lat, lon}` — the test always failed and the code fell back to
  `cpaPositions.self` (= *projected* self position at CPA future
  time). Bearing was then computed between two **future** positions,
  which can be nowhere near the current geometry. The adapter now
  converts `{lat, lon}` → `{latitude, longitude}` once at render
  time, so the hull always paints at the real bearing to the target
  as-of-now.
- **Signal K server token kept being asked "every once in a while"**
  (Rev446). `handleAuthWrite` wiped the permanent device token on
  the FIRST `401` and kicked off an access-request modal — a single
  transient 401 (SK restart in flight, proxy hiccup, DNS blip) was
  enough to invalidate a perfectly good token. Now requires THREE
  consecutive 401 writes before wiping; one successful write resets
  the counter.
- **Precision gauge sign convention** (Rev444). First pass used
  `heading − target`; Carlos's convention is "the correction the
  pilot still has to apply" → `target − heading`. Negative therefore
  means *pilot must go to port* and positive *pilot must go to
  starboard*.

## 3.0.0 — 2026-10-10 — AIS collision overlay + Freeboard-SK embedded

Rolls up Rev431 through Rev438 (8 revs). The headline feature of 3.0.0
is an AIS collision overlay on the compass rose and a Freeboard-SK
chart embedded in the rose box on double-tap. Pypilot-newui is a pure
CONSUMER of the external
[`signalk-collision-alerts`](https://github.com/dirkwa/signalk-collision-alerts)
plugin (by @dirkwa, the maintainer of @signalk/app-dock and
server-admin-ui) and of the Signal K v2 Notifications API — no
CPA/TCPA engine lives here. The decision rationale is captured in the
new memory `feedback_signalk_ecosystem_first.md`: Signal K is a
cooperative ecosystem; reinventing a well-maintained plugin is
anti-pattern. See `docs/_feature_ais_overlay.md` for the full
operator guide + install.

Carlos classified this bump as **major (3.0.0)** at the start of the
sprint: it adds a new optional external-plugin dependency, changes
double-tap-on-rose behaviour (was no-op; now opens Freeboard) and
introduces a user-facing concept — AIS alarms with ACK — that was
not present in the 2.x line.

### Added

- **AIS collision overlay (Rev431 → Rev438)**. Subscribes to
  `notifications.navigation.closestApproach.<mmsi>` emitted by
  `signalk-collision-alerts`. For each active `warn` / `alarm`:
  - **Red / orange triangle** painted on the compass circle at the
    bearing from the self vessel to the target *as of now* (not the
    CPA future projection — Rev436 fetches the target's current
    position + SOG via `/signalk/v1/api/vessels/<ctx>/...` on each
    delta with a 30 s cache).
  - **Infobox** on top of the self boat with level badge
    (`ALARM` / `WARN`), target name (or "objetivo" when the target
    has no name yet — MMSI never shown or spoken), CPA · TCPA,
    closing speed, ACK button, and when > 1 target is active a
    `N/M` navigator with `‹` / `›`.
  - **Voice**: short Spanish sentence built from the raw data, not
    the plugin's English string (which TTS garbled into "ce-pe-a cero
    coma cero cuatro ene eme"). Example: *"Alarma A I S, PIRATA DE
    ONS, a 47 metros, ya"*.
  - **ACK** button sends `POST /signalk/v2/api/notifications/<id>/acknowledge`
    (so Freeboard + every SK consumer sees it) AND silences the MMSI
    locally for 10 min — survives the plugin re-publishing the same
    threat with a fresh UUID.
  - **"Silenciadas…" modal** (Rev438) lists every locally-silenced
    MMSI with remaining minutes + per-row *Reactivar* + bulk *Reactivar
    todas*.
  - **Stationary filter** (Rev436): targets whose cached SOG < 0.15 kn
    are dropped from the UI even if the plugin keeps emitting the
    alarm. Mandatory in a Ría with dozens of moored vessels.
  - **Overlay-card in Setup → ROSE OVERLAYS**: master on/off, voice
    sub-toggle, link to the plugin's config page, access to the
    silenced modal.
- **Freeboard-SK embedded in the rose box** (Rev432 → Rev433). Double-
  tap `#wind-rose` opens `/@signalk/freeboard-sk/` as an iframe
  positioned inside the compass square so the side panels (mode,
  nudges, AP) stay visible. Chrome row has ⤢ Maximize (full
  viewport) / ⤡ Restore / × Close. Iframe `src` cleared on close so
  Freeboard releases its websocket.

### Changed

- No breaking API changes to the pypilot-newui plugin itself —
  everything existing in 2.12.0 still works identically. The 3.0.0
  bump reflects the new user-facing concepts (AIS alarms, Freeboard
  entry point) and the optional external-plugin dependency.

### Fixed

Bugs found and fixed during the AIS sprint, each informed by Carlos's
QA notes and the real SK bus on Tunatunes:
- **ACK button did not close the infobox** (Rev436). Was keyed by
  notification UUID (Rev434); plugin cycles the id while the threat
  persists → infobox resurrected on the next delta. Now keyed by
  MMSI with a 10-minute TTL.
- **Triangle 180° off** (Rev436). Rev431 pointed at
  `data.cpaPositions.target` which is the *projected* position at the
  CPA future instant — hence "me avisa babor cuando el target me
  viene por aleta estribor". Now uses the current self + target
  positions fetched from the SK REST API.
- **Multiple alarms, including moored vessels** (Rev436). Added the
  stationary SOG < 0.15 kn drop filter so a Ría with 30 moored boats
  doesn't fire false alarms through the plugin's own thresholds.
- **TTS garble on Freeboard open** (Rev436). Removed the
  `_alSpeak("abriendo carta")` that the English TTS read as "ICE
  open chat".
- **Overlay-card nested checkbox hidden under the master** (Rev437).
  CSS `.overlay-card input[type=checkbox]` matched every checkbox and
  stacked them at top-right. Scoped to direct child so the AIS
  card's "Voice alert" sub-toggle renders in-flow.

### Known limitations / upstream work

- **Upstream `signalk-collision-alerts` issue #17** —
  https://github.com/dirkwa/signalk-collision-alerts/issues/17 — the
  admin UI does not render the `Alert sensitivity` / `Level`
  dropdowns because the plugin's typebox schema emits `anyOf+const`
  instead of `enum`. We filed the issue with a fix proposal; the
  workaround is to hand-edit the plugin JSON config or patch the
  built `config.js` locally. See `docs/_feature_ais_overlay.md`.
- **Needs sea-trial QA** on real moving traffic with mixed `warn` /
  `alarm` targets. Default sensible config documented
  (preset: `harbour`, `maxRange`: 3 NM) for a Ría-style navigation
  env; switch to `coastal` / `offshore` as needed.

---

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
