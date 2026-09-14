# signalk-pypilot-newui

**This plugin enhances and extends the magic of [pypilot](https://github.com/pypilot/pypilot)**,
Sean D'Epagnier's open-source autopilot, with more functions, a modern
touch-first user experience on tablets and phones, first-class
**Signal K integration** so tools like [KIP](https://kip.signalk.org),
WilhelmSK and freeboard can drive and monitor the autopilot out of the
box, and a strong focus on **reliability, ease of use and ease of
tuning**: the plugin itself watches how your autopilot is behaving and
quietly suggests how to sharpen its settings, so you spend more time
sailing and less time guessing which slider to move.

Runs alongside [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider)
by Panaaj — see [Working alongside pypilot-autopilot-provider](#working-alongside-pypilot-autopilot-provider).

## Screenshots

![Control - compass rose with concentric target + wind arrows](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/01-control-rose.jpg)

| Chart · Trip Stats | Tune · gain sliders |
|---|---|
| ![Chart tab - Trip Stats + Servo Health](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/02-chart-trip-stats.jpg) | ![Tune tab - PID gain sliders](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/03-tune-gains.jpg) |

| Setup · Trips | Chart · hover freeze |
|---|---|
| ![Setup - Trips card](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/04-setup-launcher.jpg) | ![Chart - hover freeze](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/05-race-timer.jpg) |

![Tack history - persistent per-tack log](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/06-info.jpg)

## What this plugin adds on top of pypilot

### Visor (touch UI) — 10 new added functions

1. **Compass rose** with colour-coded cardinals, hull-fixed sailing
   wedges, and 4 corner tiles configurable via long-press.
2. **Concentric Target + Wind arrows** — cyan target diamond, amber
   `A` (apparent wind), teal `T` (true wind). Interlock into a
   droplet when the three align; open into V-notches with a colour
   tick when they drift.
3. **Gust marker overlay** — leaves a ghost `A` at the peak wind for
   10 s.
4. **COG line + Current vector** overlays, toggled from the same
   long-press menu.
5. **Custom Signal K path** bindable to any corner tile.
6. **Signal K polar-performance** integration on corner tiles.
7. **Bottom bar switcheable** rudder angle or boat heel, from the
   corner-config popup.
8. **Race timer T1/T2** with beeps, screen flash and spoken
   countdown, background-persistent across tabs.
9. **Swipe navigation** between tabs with vertical-axis lock so
   scrolling never triggers a stray tab flip.
10. **Multi-language** EN / ES / DE / FR, auto-detected from the
    browser.

### Autopilot enhancements — 12 new added functions

11. **Pypilot Doctor** — records an engaged AP session, detects
    bias / oscillation / low authority / noise, and proposes P/I/D
    adjustments with plain-language rationale. Applying forks the
    current pypilot profile into `doctor-YYYYMMDD-HHMM` so the
    original stays one tap away.
12. **Smart Pilot — auto profile by wind** — switches the pypilot
    profile between Light / Medium / Heavy according to the averaged
    TWS.
13. **Smart Pilot — gust strategy** — freeze target, boost D +20%
    for 20 s, temporarily switch to the Heavy profile for 30 s, or
    just warn.
14. **Auto-disengage on lost authority** — RMS heading error > 30°
    with servo duty > 90% sustained 10 s.
15. **Pre-departure Autopilot Check** — a single READY / CAVEATS /
    DO-NOT-ENGAGE verdict aggregating every sensor, servo, voltage
    and link signal.
16. **Sensor Quality** — freshness, update rate, jitter and source
    per AP-critical Signal K path, with per-row Ignore / Restore.
17. **Servo Health** — learns a baseline for typical servo duty at
    sea and flags recent, peak, temperature or voltage deviations
    from that baseline.
18. **Alarm engine — 9 rules** — heading deviation, cruise drift,
    unable-to-steer, servo overcurrent, servo temp, motor temp, high
    AP load, low voltage, sensor lost, pypilot disconnected — all
    published as canonical `notifications.autopilot.*` for KIP /
    WilhelmSK.
19. **Head-to-wind pseudo-mode** — a "raise the sails" mode not
    present in pypilot, with countdown and bow / stern swing
    selection.
20. **Synthetic tack** and **tack countdown UI** with planned final
    target and single-tap cancel on the circle.
21. **Watchdog with core-alive detection** — distinguishes a live
    `pypilot_web` with a dead pypilot core, so writes never leave to
    the void while the visor claims success.
22. **Reconnect Restore banner** — snapshot of target and mode on
    outage, Yes / No offer to re-engage the same target when pypilot
    is back within 20 s to 5 min.

### Data & reporting — 6 new added functions

23. **Trip Recorder** — auto-records every outing via
    `navigation.state`. Summary of 17 KPIs (distance, duration,
    SOG / TWS / AWS averages and peaks, heel, tacks, points-of-sail
    split, min voltage, AP-engaged %), OpenSeaMap trace coloured by
    SOG with markers on peak gust, peak SOG, min voltage and every
    detected tack. Share as portrait PNG report card or as WhatsApp
    text.
24. **Chart tab** — 9 live Trip Stats cards, history with
    30 s / 2 min / 10 min windows and hover-freeze, plus a Servo
    Health card.
25. **Persistent tack history** with pre / post TWS, AWA, SOG and
    recovery time to 95% of pre-tack speed, filterable by day range.
26. **Post-tack HUD stats** — before / after values plus SOG-loss
    verdict.
27. **Navigation session recorder** — every engaged AP session
    stored as JSONL with tags (wind, sea state, propulsion, point of
    sail, crew), shareable for advice.
28. **Full Signal K path catalog viewer** in the visor with
    copy-to-clipboard for KIP.

### Signal K integration — 8 new added functions

29. **~110 Signal K paths** under `steering.autopilot.pypilot.*`,
    opt-in per path so you never flood the bus.
30. **Autopilot API v2 provider** (absorbable) — WilhelmSK,
    freeboard and KIP talk to this plugin as the canonical
    autopilot.
31. **KIP action paths** — Simple Switch for engage, nudge, tack,
    mode selector, profile selector.
32. **9 momentary switches** — nudge ±10 / ±1, tack port / starboard
    / cancel — as KIP boolean paths.
33. **Radio switches** — mode and profile groups as KIP radio switch
    sets.
34. **Publish-only-essentials toggle** — keeps the SK bus light on
    modest servers.
35. **Config export / import** — Web Share API (email / WhatsApp /
    AirDrop) or plain `.json`.
36. **Live status endpoint** — connection state, core-alive flag,
    catalog counters for external monitoring.

**36 concrete new functions** layered on top of pypilot: a full touch
UI + intelligence + observability + Signal K bridge.

> **Reliable by design, easy to tune** — the built-in **Pypilot
> Doctor** records a real session, tells you in plain language what
> is off (bias / oscillation / weak authority / noise) and proposes
> P / I / D changes you can accept with one tap. **Smart Pilot** goes
> one step further: it picks the right pilot profile for the wind
> you're in and reacts to gusts on its own.

See [`CHANGELOG.md`](./CHANGELOG.md) for the release-by-release
history.

## Upgrading from 1.0.0 to 2.0.0

2.0.0 is a **breaking release** addressing feedback from Sean D'Epagnier
(pypilot author). Every pypilot key now maps 1:1 to
`steering.autopilot.pypilot.<key>` verbatim - no more hand-picked renames
or C -> K / deg -> rad conversions. If you have KIP widgets or WilhelmSK
dashboards wired to 1.0.0 paths, see the full migration table in
[`CHANGELOG.md`](./CHANGELOG.md) - most notable examples:

- `.servo.controllerTemperature` (K) -> `.servo.controller_temp` (C)
- `.calibration.rudderRange` (rad) -> `.rudder.range` (deg)
- `.gains.<pilot>.<gain>` -> `.ap.pilot.<pilot>.<gain>`

Setup -> Emergency ships **two remote restart buttons** (`RESTART pypilot`
and `reboot Pi`), both guarded by a helm-manned confirmation modal.
`restart pypilot_web` (the safe web-only restart that does not interrupt
steering) lives as a preset in the **Debug console** — an SSH-based
whitelist of preset diagnostic commands (logs, dmesg, top, uptime, df,
pypilot version, restart pypilot_web).

## What it does

**Touch webapp** (mobile / tablet / chart-plotter, dark theme):

- Compass rose with HDG readout, colour-coded cardinals (N orange, E green,
  S blue, W red) + degree ticks, hull-fixed green/red sailing wedges, and 4
  configurable corner tiles (long-press to reconfigure).
- **Concentric target & wind arrows**: three arrow pieces on the rose — cyan
  target diamond, amber `A` (AWA), sea-green `T` (TWA). Interlock into one
  clean droplet when all three angles coincide; the V-notch of any piece
  that drifts opens up as a visible hollow, and a colour ring-tick marks
  the exact angle on the compass. Optional **COG line** from the bow
  (yellow chevrons) and **current vector** (SOG − SOW, blue wavy arrow)
  can be toggled from a 4-card selector opened by long-press on any
  corner or on the boat sprite.
- Big-touch AP engage / disengage with optimistic UI + auto-retry over
  flaky links (Tailscale-safe).
- Tack port / starboard, mode selector (compass / GPS / wind / true wind / nav),
  nudge ±1 / ±10 with configurable step size, current heading snap on engage.
- **Tune** tab with locked-by-default gain sliders (auto-relock on tab exit),
  ±10 / ±1 buttons flanking each slider, orange "previous value" reference.
- **Race** timer T1/T2 with beeps, screen flash, spoken seconds countdown
  ("10, 5, 4, 3, 2, 1, Start"). Runs in the background across tabs.
- **Setup** with LAN scan, manual host+port, KIP absorb-provider toggle,
  SSH-based remote `RESTART pypilot` button (credentials stored in plugin
  config), nudge step size, language, IMU / rudder calibration.
- **Paths & API** tab with live catalog of published paths, per-path publish
  toggles, KIP copy-to-clipboard helpers.
- **Info** tab with quick-start, coexistence rules, credits, license, GitHub
  link, config export / import (Web Share API → email / WhatsApp / Signal /
  AirDrop, `.json` download, clipboard).
- Full i18n: **English / Español / Deutsch / Français** (auto-detected from
  browser, override in Setup → Language).
- Regatta-safe swipe navigation between tabs with vertical-axis-lock so
  scrolling never triggers a stray tab flip.
- Signal K polar-performance and any custom SK path bindable to a corner tile.

**~60 Signal K paths** under `steering.autopilot.pypilot.*` (opt-in per path):

- Gains per pilot (`P`, `I`, `D`, `DD`, `PR`, `FF`).
- Servo telemetry (voltage, current, controller / motor temperatures, flags,
  amp-hours, clutch engaged, controller error).
- Rudder calibration (offset, scale, non-linearity, range, calibration state).
- IMU heading offset, errors, warnings.
- Active pilot, active profile, available pilots / profiles / modes.
- Tack state, tack direction, tack timeout.
- Runtime, version.

**KIP-ready Simple Switches** under `electrical.switches.pypilot.*`:

- `ap.state` — momentary boolean, engage / disengage.
- `nudge.{bigPort,smallPort,smallStar,bigStar}` — momentary, auto-reset.
- `tack.{port,starboard,cancel}` — momentary.
- `mode.{compass,gps,wind,trueWind,nav}` — radio (mutually exclusive).
- `profile.<name>` — radio, dynamic per pilot profile.

## Installation

1. Signal K Server → **App Store** → search **PyPilot New-UI**.
2. Server → **Plugin Config** → **PyPilot New-UI + SK Paths**.
3. Enter the `pypilot_web` host (IP or hostname) and port. On TinyPilot the
   default is port `80`; on a classic pypilot install it is `8000`.
4. The **Scan LAN** button in the webapp auto-detects hosts running
   `pypilot_web` on ports 80 / 8000 of your subnet if you don't know the IP.
5. Enable the plugin.

**Webapp URL**: `http://<sk-host>:3000/signalk-pypilot-newui/`

## Working alongside `pypilot-autopilot-provider`

We build on top of the excellent
[`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider)
by Panaaj — the plugin that gives Signal K the standard
**Autopilot API v2** surface (`/signalk/v2/api/vessels/self/autopilots/*`) so
WilhelmSK, freeboard and other clients can drive pypilot through the canonical
interface. Panaaj focuses tightly on that API and opens its own socket.io
connection to `pypilot_web`.

This plugin adds ~60 additional pypilot values on top (gains, servo telemetry,
calibration, warnings, profiles, tack detail, etc.), ships the touch webapp,
and can optionally register the Autopilot API v2 itself via the
**absorbProvider** option in Setup, so a single socket hits `pypilot_web`
instead of two — useful when pypilot runs on a Pi Zero W.

Signal K only allows one provider per pilot ID, so if you turn on
**absorbProvider** here you should disable Panaaj's plugin (otherwise both
register the same ID and behaviour is undefined). Valid setups:

| Panaaj `pypilot-autopilot-provider` | `signalk-pypilot-newui` absorb | Result |
|---|---|---|
| Enabled | Off (default) | Both run happily side by side. Panaaj owns the AP v2 API; this plugin adds the extra paths + UI. **2 sockets** to `pypilot_web`. |
| Disabled | **On** | Only this plugin. Same AP v2 API + all the extras. **1 socket**. Handy on Pi Zero W. |
| Enabled | On | Both try to register the same AP ID — leave one off. |
| Disabled | Off | WilhelmSK / freeboard / KIP won't see the AP. Only useful if you exclusively use this plugin's own webapp. |

Absorb mode lives in **Setup → Autopilot Provider (one-socket mode)**.

## Remote restart / reboot + Debug console

When the autopilot process on the TinyPilot gets wedged you don't need to
open an SSH session by hand. In **Setup → Emergency**, save the TinyPilot's
SSH user + password once. From then on you get **two big restart buttons**,
each guarded by a helm-manned confirmation modal that asks whether someone
is at the helm before executing:

1. **RESTART pypilot** (~10-15 s) — `sv restart` of the pypilot core + web
   (runit under piCore). The AP drops the heading briefly and re-engages
   when it comes back up.
2. **reboot Pi** (~35-60 s) — full `sudo reboot` of the Raspberry Pi. No
   autopilot for almost a minute. Last-resort when the box is in a bad
   state.

The safe **restart pypilot_web** (web server only, does not interrupt
steering) lives as a preset button in the **Debug console** below,
alongside a closed whitelist of preset diagnostic commands over the same
SSH session: `logs pypilot`, `logs pypilot_web`, `dmesg`, `top`, `uptime`,
`df`, `pypilot --version`. Output goes into a scrollable textarea, a
"Follow logs" toggle polls `journalctl --since '30 s ago'` every 3
seconds, and Copy / Share buttons let you paste the dump straight into a
GitHub issue or a WhatsApp / email conversation with your friendly rigger.

The endpoint (`POST /plugins/*/debug-cmd`) refuses any command that is
not in the whitelist, so a leaked JWT cannot be used to run arbitrary
shell on the TinyPilot.

Signal K stores plugin configs in plain text under
`~/.signalk/plugin-config-data/` so use credentials that are only valid for
that isolated TinyPilot.

## HTTP endpoints (plugin router)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/plugins/signalk-pypilot-newui/status`        | Connection + last-seen catalog summary + Rev + version + historian header + KPI computedTs |
| `GET`  | `/plugins/signalk-pypilot-newui/scan`          | Scan LAN for `pypilot_web` hosts |
| `GET`  | `/plugins/signalk-pypilot-newui/paths`         | Live list of published SK paths with GET / PUT URLs and units |
| `GET`  | `/plugins/signalk-pypilot-newui/catalog`       | Raw pypilot catalog (all values + metadata) |
| `GET`  | `/plugins/signalk-pypilot-newui/values`        | Current pypilot value cache |
| `PUT`  | `/plugins/signalk-pypilot-newui/raw`           | Send raw `name=value` to pypilot (protected by `allowWrites`) |
| `GET`  | `/plugins/signalk-pypilot-newui/history`       | Historian slice. Query `?window=30s\|2m\|10m` and `?paths=headingCmd,rudder,...`. RAM ring buffer at 1 Hz. |
| `GET`  | `/plugins/signalk-pypilot-newui/stats`         | KPI snapshot: session (engaged time, distance, energy, tacks, gybes, max servo A) + window1m (mean / RMS / p95 heading error, servo duty). |
| `POST` | `/plugins/signalk-pypilot-newui/session/reset` | Reset the KPI session counters. History buffer is kept. |
| `GET`  | `/plugins/signalk-pypilot-newui/quality`       | Sensor Quality snapshot: age / observed Hz / jitter / source / status per watched SK path. |
| `GET`  | `/plugins/signalk-pypilot-newui/servo-health`  | Servo Health snapshot: learned baseline current, deviation ratio, peak A, samples in the learn window. |
| `GET`  | `/plugins/signalk-pypilot-newui/alarms/state`  | Active alarms + short resolved history. |
| `GET`  | `/plugins/signalk-pypilot-newui/alarms/rules`  | Rule metadata (id / label / severity / enabled / muted / active). |
| `POST` | `/plugins/signalk-pypilot-newui/alarms/ack/:id`     | Acknowledge one active alarm (silences the sound, banner stays visible). |
| `POST` | `/plugins/signalk-pypilot-newui/alarms/mute/:id`    | Mute the RULE for N minutes (query `?min=15`). |
| `POST` | `/plugins/signalk-pypilot-newui/alarms/enable/:id`  | Enable / disable a rule (query `?on=1\|0`). |
| `GET`  | `/plugins/signalk-pypilot-newui/prechecks`     | Pre-departure autopilot check verdict: `ready` / `ready-with-caveats` / `do-not-engage` + per-item detail. |
| `POST` | `/plugins/signalk-pypilot-newui/doctor/start`  | Start a diagnostic session (query `?duration=180`). Requires AP engaged. |
| `POST` | `/plugins/signalk-pypilot-newui/doctor/cancel` | Cancel the current session. |
| `GET`  | `/plugins/signalk-pypilot-newui/doctor/status` | Session state + progress + result (when completed). |
| `POST` | `/plugins/signalk-pypilot-newui/doctor/apply/:id`   | Apply one gain suggestion. The FIRST apply of the session forks the profile into `doctor-YYYYMMDD-HHMM`. |
| `POST` | `/plugins/signalk-pypilot-newui/doctor/apply-all`   | Apply every non-dismissed suggestion (all land in the same forked profile). |
| `POST` | `/plugins/signalk-pypilot-newui/doctor/dismiss/:id` | Mark a suggestion as dismissed (user rejects it). |
| `POST` | `/plugins/signalk-pypilot-newui/doctor/reset`  | Clear result, back to idle. |
| `POST` | `/plugins/signalk-pypilot-newui/restart-pypilot` | SSH `sv restart` of pypilot core+web on the TinyPilot. |
| `POST` | `/plugins/signalk-pypilot-newui/debug-cmd`     | Run one of a closed whitelist of preset diagnostic / restart commands over SSH. Body: `{ "preset": "<name>" }`. |
| `POST` | `/plugins/signalk-pypilot-newui/ssh-exec`      | Free-form SSH command (Remote Control Console). Body: `{ "cmd": "<any shell>" }`. Requires `allowWrites`. |
| `POST` | `/plugins/signalk-pypilot-newui/pause`         | Disconnect local socket (for scripts). |
| `POST` | `/plugins/signalk-pypilot-newui/resume`        | Reconnect local socket (for scripts). |

## Safety

- `allowDirectServo` defaults to **off** — the direct `servo.command` back-door
  used by pypilot's own UI for manual steering is not exposed until you enable
  it explicitly in the plugin config.
- All PUT handlers validate ranges from the pypilot catalog before sending.
- On plugin stop the socket closes cleanly; the visor auto-reconnects on
  Signal K restart.
- This plugin is an aid to navigation and steering. It does not replace the
  vigilance of the skipper, correct manoeuvring, direct observation of the
  surroundings, or official charts and notices. Verify in safe waters before
  relying on the autopilot for demanding manoeuvres.

## Acknowledgements

- **Sean D'Epagnier** — creator of [pypilot](https://github.com/pypilot/pypilot),
  the open-source autopilot that makes this plugin possible.
- **Jean-Marc** at [Navitop](https://www.navitop.fr/) — for the TinyPilot
  hardware and marine integrations, and for making pypilot accessible to
  European sailors.
- The [Signal K](https://signalk.org/) community and OpenPlotter for the open
  ecosystem this plugin runs on.
- Panaaj — for
  [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider),
  the reference AP v2 provider this plugin builds on top of.

## Reporting issues / feature requests

Open an issue on GitHub —
[github.com/Aitonos/signalk-pypilot-newui/issues](https://github.com/Aitonos/signalk-pypilot-newui/issues).
Include the Rev (visible in the app under **Info** → top header, or via
`GET /plugins/signalk-pypilot-newui/status`), what you expected, what happened,
and a screenshot if possible.

## Development

```
git clone https://github.com/Aitonos/signalk-pypilot-newui
cd signalk-pypilot-newui
npm install
npm run build
```

Deploy from a Windows laptop to a Raspberry Pi: `.\deploy.ps1 -Restart`.

## License

Apache-2.0, Aitonos. See `NOTICE` for third-party attributions.
