# signalk-pypilot-newui

**PyPilot New-UI + SK Paths** — a modern, touch-first control panel for the
open-source [pypilot](https://github.com/pypilot/pypilot) autopilot, plus every
pypilot value exposed as a first-class Signal K path so tools like
[KIP](https://kip.signalk.org), WilhelmSK and freeboard can build custom gauges
and switches out of the box.

Runs alongside [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider)
by Panaaj — see [Working alongside pypilot-autopilot-provider](#working-alongside-pypilot-autopilot-provider).

## What it does

**Touch webapp** (mobile / tablet / chart-plotter, dark theme):

- Compass rose with heading readout, cardinals + degree ticks, hull-fixed
  green/red sailing wedges, AWA + TWA arrows (independent, toggleable), cyan
  target diamond, and 4 configurable corner tiles (long-press to reconfigure).
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

## Remote `RESTART pypilot`

When the autopilot process on the TinyPilot gets wedged you don't need to open
an SSH session by hand. In **Setup → Emergency**, save the TinyPilot's SSH user
+ password once; the **RESTART pypilot** button then runs
`sudo systemctl restart pypilot pypilot_web` over SSH and reconnects the local
socket. Signal K stores plugin configs in plain text under
`~/.signalk/plugin-config-data/` so use credentials that are only valid for
that isolated TinyPilot.

## HTTP endpoints (plugin router)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/plugins/signalk-pypilot-newui/status`        | Connection + last-seen catalog summary + Rev + version |
| `GET`  | `/plugins/signalk-pypilot-newui/scan`          | Scan LAN for `pypilot_web` hosts |
| `GET`  | `/plugins/signalk-pypilot-newui/paths`         | Live list of published SK paths with GET / PUT URLs and units |
| `GET`  | `/plugins/signalk-pypilot-newui/catalog`       | Raw pypilot catalog (all values + metadata) |
| `PUT`  | `/plugins/signalk-pypilot-newui/raw`           | Send raw `name=value` to pypilot (protected by `allowWrites`) |
| `POST` | `/plugins/signalk-pypilot-newui/restart-pypilot` | SSH remote restart, uses `sshUser` + `sshPassword` from plugin config |
| `POST` | `/plugins/signalk-pypilot-newui/pause`         | Disconnect local socket (for scripts) |
| `POST` | `/plugins/signalk-pypilot-newui/resume`        | Reconnect local socket (for scripts) |

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
