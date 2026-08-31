# signalk-pypilot-newui

**PyPilot New-UI + SK Paths** — a modern, touch-first control panel for the
open-source [pypilot](https://github.com/pypilot/pypilot) autopilot, plus every
pypilot value exposed as a first-class Signal K path so tools like
[KIP](https://kip.signalk.org), WilhelmSK and freeboard can build custom gauges
and switches out of the box.

Runs alongside [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider)
by Panaaj — see [Working alongside pypilot-autopilot-provider](#working-alongside-pypilot-autopilot-provider).

## Screenshots

| Control | Chart |
|---|---|
| ![Control tab](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/01-control-rose.jpg) | ![Chart tab](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/02-chart-trip-stats.jpg) |

| Tune | Setup |
|---|---|
| ![Tune tab](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/03-tune-gains.jpg) | ![Setup tab](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/04-setup-launcher.jpg) |

| Race | Info |
|---|---|
| ![Race tab](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/05-race-timer.jpg) | ![Info tab](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/06-info.jpg) |

## What's new in 2.2.0

2.2.0 turns the plugin into an **intelligence layer over pypilot**. Forty
in-session Revs on top of the 2.1.0 visual foundation. Highlights:

- **Aproado pseudo-mode** — a new "raise the sails" AP mode not in
  pypilot upstream. Pick BY BOW / BY STERN via a 5 s modal, the
  plugin switches pypilot to wind mode with target 0° (head to
  wind), and a floating HUD over the boat shows elapsed time,
  straight-line distance from the start and the compass heading
  captured at activation. SALIR restores the previous mode + target
  + engaged state. BY STERN forces a stern-through swing by walking
  a chain of intermediate targets 60° apart so pypilot cannot
  shortcut through the bow.
- **Telemetry historian + Chart tab** — RAM ring buffer at 1 Hz for
  the last 30 min (backend, Pi 5 friendly). Nine Trip Stats cards
  (AP engaged time, distance, energy, mean / RMS / p95 heading
  error, servo runtime, tacks / gybes, peak servo A) fed live via
  SK paths, plus a canvas with 30 s / 2 min / 10 min windows.
- **Sensor Quality + Servo Health + Alarm engine + Pre-departure
  check** — new backend modules that grade every SK path the AP
  depends on, learn a baseline servo current and flag anomalies,
  evaluate seven alarm rules that publish canonical
  `notifications.autopilot.*`, and roll everything into a single
  READY / READY-WITH-CAVEATS / DO-NOT-ENGAGE verdict.
- **Pypilot Doctor** — press DIAGNOSE, the plugin records 2-3 min
  with the AP engaged, runs heuristic rules on the heading error
  stream (bias / oscillation / low authority) and proposes P / I /
  D adjustments with a plain explanation. Nothing is applied
  automatically. The first Apply of a session **forks the current
  pypilot profile** into a new `doctor-YYYYMMDD-HHMM` profile so
  the previous gains stay one profile-select away.
- **Setup as a launcher grid** — every setup block is now a square
  tile in a 2 / 3 / 4-column grid. Tap opens fullscreen with a
  small X to close and ESC support. Live summary pill on every
  tile. Connection consolidated (status + LAN scan + manual host +
  Autopilot Provider in one card). "Emergency" renamed to "Remote
  Control Console".
- **Interactive SSH console** — free-form command input with
  on-screen arrow buttons for mobile history navigation,
  accumulative output textarea, clipboard fallback for HTTP LAN,
  and 14 preset buttons with plain human labels (Memory / IP
  table / WiFi / Temperature / Who is connected / ...). BusyBox /
  piCore-safe fallbacks for every command.
- **Full RangeSetting sliders in Calibration** — every pypilot
  `RangeSetting` grouped by category (rudder / servo / imu / ap /
  other) with the same look as the Tune tab, a lock checkbox with
  the padlock emoji, a frozen "before:" baseline that never moves
  as you drag, and a per-slider ↺ restore button.
- **Gota Chain shape swap** — after iterations with skippers using
  the plugin: the AMBER "A" arrow (apparent wind) is now the LARGE
  piece and the TEAL "T" arrow (true wind) the SMALL outer one.
  Colors and letters kept their canonical meaning; only the SVG
  paths moved so the amber piece is visually the dominant one.
- **Full i18n audit** across EN / ES / FR / DE — every hard-coded
  English string in the non-EN bundles purged, alarm messages and
  Doctor suggestion reason / effect exposed as i18n keys + args so
  the frontend renders in the user's language.

See [`CHANGELOG.md`](./CHANGELOG.md) for the full detailed list in
four languages.

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
- **Gota Chain** overlay: three concentric arrow pieces on the rose — cyan
  target diamond, amber `A` (AWA), sea-green `T` (TWA). Interlock into one
  clean droplet when all three angles coincide; the V-hembra of any piece
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
