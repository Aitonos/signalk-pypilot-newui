# signalk-pypilot-newui

**This plugin enhances and extends the magic of [pypilot](https://github.com/pypilot/pypilot)**,
Sean D'Epagnier's open-source autopilot, with more functions, a modern
touch-first user experience on tablets and phones, first-class
**Signal K integration** so any downstream Signal K client can drive
and monitor the autopilot out of the box, and a strong focus on
**reliability, ease of use and ease of tuning**: the plugin itself
watches how your autopilot is behaving and quietly suggests how to
sharpen its settings, so you spend more time sailing and less time
guessing which slider to move.

The visor also brings the rest of your boat into the same screen,
through other Signal K plugins (all optional, see the table below):

- **Tides and anchor watch** — with
  [**AnchorWatch Pro**](https://www.npmjs.com/package/signalk-mareas-ihm)
  (`signalk-mareas-ihm`): a tide button on the rose with the tide curve
  of your nearest station, next HW / LW and coefficient, and its
  anchor-watch visor opened inside the rose.
- **Integrated chartplotter** — double-tap the rose and
  [Freeboard-SK](https://www.npmjs.com/package/@signalk/freeboard-sk)
  opens inside it with every AIS target, your route and all overlays;
  the autopilot buttons stay reachable. Charts need a Signal K chart
  provider.
- **AIS collision targets on the rose** — with
  [`signalk-collision-alerts`](https://www.npmjs.com/package/signalk-collision-alerts).
- **Polar performance on the corner tiles** — polar speed, % of polar,
  target angles and VMG from your boat's polar table, with
  [`signalk-polar-performance-plugin`](https://www.npmjs.com/package/signalk-polar-performance-plugin)
  and [`signalk-polar-management`](https://www.npmjs.com/package/signalk-polar-management).

Runs alongside [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider)
by Panaaj — see [Working alongside pypilot-autopilot-provider](#working-alongside-pypilot-autopilot-provider).

## Required and recommended plugins

The autopilot visor works on its own with just pypilot. The plugins
below unlock the rest of the features; all of them install from the
Signal K App Store and are picked up automatically (no configuration
inside pypilot-newui).

| Plugin | Status | What it unlocks in pypilot-newui |
|---|---|---|
| [pypilot](https://github.com/pypilot/pypilot) / TinyPilot (`pypilot_web`) | **Required** | The autopilot itself. Set its host and port in the plugin config. |
| [`signalk-mareas-ihm`](https://www.npmjs.com/package/signalk-mareas-ihm) — **AnchorWatch Pro: Smart Anchoring, AIS & Tides** | **Recommended** | **Tide button on the rose** (just above the bottom-right corner tile): popup with the tide curve, current height, rising / falling, next HW / LW and coefficient, and a one-tap jump to the **anchor-watch visor inside the rose** (full-screen like the chart). Also fills AIS vessel names into Signal K, so AIS targets show names instead of raw MMSIs right after a server restart. Without the plugin, the button explains what it does and links straight to its App Store page. |
| [`@signalk/freeboard-sk`](https://www.npmjs.com/package/@signalk/freeboard-sk) | **Recommended** | **Integrated chartplotter**: double-tap the rose to open the chart inside it, kept loaded in the background so it opens instantly. |
| [`signalk-charts-provider-simple`](https://github.com/dirkwa/signalk-charts-provider-simple) | **Required for the chartplotter** | Serves the chart tiles Freeboard-SK draws. **Without a chart provider the embedded chart stays empty.** The official provider works too (see [below](#chart-provider-is-required-for-the-embedded-plotter)). |
| [`signalk-collision-alerts`](https://www.npmjs.com/package/signalk-collision-alerts) | **Recommended** | **AIS collision targets on the rose** — real bearing, distance label, course line, infobox with the vessel name and ACK. |
| [`signalk-polar-performance-plugin`](https://www.npmjs.com/package/signalk-polar-performance-plugin) | Optional | **Polar performance on the corner tiles**: polar speed, % of polar, target speed, beat / gybe angle and VMG, computed live from your active polar. |
| [`signalk-polar-management`](https://www.npmjs.com/package/signalk-polar-management) | Needed by the polar plugin | Stores your boat's **polar table** (import ORC / CSV / text) and selects the active polar that `signalk-polar-performance-plugin` reads. |
| [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider) | Optional | Shares the pypilot connection with other Signal K autopilot clients. |

Details for each one in [Works well with](#works-well-with).

## Chart provider is required for the embedded plotter

The chartplotter embedded in the rose uses Freeboard-SK, which itself
is only a renderer — it needs a Signal K **chart provider** plugin to
know where to fetch tiles from:

- **[`signalk-charts-provider-simple`](https://github.com/dirkwa/signalk-charts-provider-simple)**
  by @dirkwa — a simple provider that serves local chart tilesets.
  **Recommended** for Freeboard-SK embedded inside pypilot-newui.
- **[`@signalk/charts-plugin`](https://www.npmjs.com/package/@signalk/charts-plugin)**
  — the official Signal K provider; serves local **MBTiles** and **TMS**
  tile sets from `~/.signalk/charts/`, plus online sources (WMS, WMTS,
  tilejson) that you enter in its configuration.

Without a provider, Freeboard-SK will open embedded in the rose but
the map area will stay empty. Install one from the SK App Store, add
your chart sources, and the chartplotter inside pypilot-newui lights
up automatically.

## Screenshots

![Control - compass rose with precision gauge + AIS collision target as a tinted top-view hull](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/01-control-rose.jpg)

| Chartplotter embedded | Logbook · trip detail |
|---|---|
| ![Chartplotter integrated - Freeboard-SK embedded in the rose box](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/02-chartplotter-embedded.jpg) | ![Logbook trip detail - OpenSeaMap trace + SOG vs AWS chart](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/03-logbook-trip-detail.jpg) |

| Tune · gain sliders | Chart · hover freeze |
|---|---|
| ![Tune tab - PID gain sliders](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/04-tune-sliders.jpg) | ![Chart - history window with hover freeze](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/05-chart-history.jpg) |

![Tack history - persistent per-tack log](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/06-tack-history.jpg)

## What this plugin adds on top of pypilot

### Visor (touch UI) — 13 new added functions

1. **Compass rose** with colour-coded cardinals, hull-fixed sailing
   wedges, and 4 corner tiles configurable via long-press.
2. **Concentric Target + Wind arrows** — target diamond tinted by mode
   (red compass, amber apparent wind, teal true wind), amber `A`
   (apparent wind), teal `T` (true wind). Interlock into a droplet
   when the three align; open into V-notches with a colour tick when
   they drift.
3. **Gust marker overlay** — a remarkable gust or wind shift leaves a
   ghost `A` (or `T` in true-wind mode) at the angle where it hit,
   with the wind speed beside it, fading out over 15 s. On / off per
   device, with a test button.
4. **COG line + Current vector** overlays, toggled from the same
   long-press menu.
5. **Custom Signal K path** bindable to any corner tile.
6. **Polar performance on corner tiles** (with
   `signalk-polar-performance-plugin` + `signalk-polar-management`) —
   polar speed, % of polar, target speed, beat / gybe angle and VMG
   from your boat's polar table, each one opt-in for the corner
   selectors.
7. **Bottom bar switcheable** rudder angle or boat heel, from the
   corner-config popup.
8. **Race timer T1/T2** with beeps, screen flash and spoken
   countdown, background-persistent across tabs.
9. **Swipe navigation** between tabs with vertical-axis lock so
   scrolling never triggers a stray tab flip.
10. **Multi-language** EN / ES / DE / FR, auto-detected from the
    browser.
11. **AIS collision targets on the rose** (with `signalk-collision-alerts`)
    — each threat drawn on the compass ring at its real bearing with a
    distance label, oriented by its heading / course with a projected
    track when moving, plus an infobox with the vessel name and ACK.
12. **Integrated chartplotter** — double-tap the rose to open
    Freeboard-SK inside the rose box; kept loaded in the background so
    it opens instantly (per-device switch).
13. **Tide at a glance** (with `signalk-mareas-ihm`) — button on the
    rose opens a popup with an interactive tide curve, current height,
    trend, next HW/LW and coefficient, and can open the anchor-watch
    visor inside the rose.

### Autopilot enhancements — 12 new added functions

14. **Pypilot Doctor** — records an engaged AP session, detects
    bias / oscillation / low authority / noise, and proposes P/I/D
    adjustments with plain-language rationale. Applying forks the
    current pypilot profile into `doctor-YYYYMMDD-HHMM` so the
    original stays one tap away.
15. **Smart Pilot — auto profile by wind** — switches the pypilot
    profile between Light / Medium / Heavy according to the averaged
    TWS.
16. **Smart Pilot — gust strategy** — freeze target, boost D +20%
    for 20 s, temporarily switch to the Heavy profile for 30 s, or
    just warn.
17. **Auto-disengage on lost authority** — RMS heading error > 30°
    with servo duty > 90% sustained 10 s.
18. **Pre-departure Autopilot Check** — a single READY / CAVEATS /
    DO-NOT-ENGAGE verdict aggregating every sensor, servo, voltage
    and link signal.
19. **Sensor Quality** — freshness, update rate, jitter and source
    per AP-critical Signal K path, with per-row Ignore / Restore.
20. **Servo Health** — learns a baseline for typical servo duty at
    sea and flags recent, peak, temperature or voltage deviations
    from that baseline.
21. **Alarm engine — 14 rules** — heading deviation, cruise drift,
    unable-to-steer, servo overcurrent, servo current near trip,
    rudder near its end stop, servo controller temperature, motor
    temperature, high AP load, low voltage, sensor lost, pypilot
    disconnected, extreme heel, extreme pitch — all published as
    canonical `notifications.autopilot.*` for any downstream Signal K
    client.
22. **Head-to-wind and Downwind pseudo-modes** — two sail-handling
    manoeuvres not present in pypilot, each with a *by bow* / *by
    stern* swing choice; on exit the previous mode, target, engage
    state and profile are restored.
    - **Head to wind (hoist sail)** — turns the bow into the wind and
      holds it there (done when the wind stays within 10° of the bow
      for 3 s). Above 10 kn of true wind it recommends swinging by
      the bow, since gybing is risky.
    - **Downwind (strike sail)** — puts the wind dead astern so the
      sail comes down without flogging (done when |TWA| > 175° for
      3 s). While it holds, the pilot runs a sharper PID (P ×1.5,
      D ×1.7, rudder slew ×1.3) against an accidental gybe, warns by
      voice if |TWA| drops below 160°, and cancels on its own below
      140° for 2.5 s.
23. **Synthetic tack** and **tack countdown UI** with planned final
    target and single-tap cancel on the circle.
24. **Watchdog with core-alive detection** — distinguishes a live
    `pypilot_web` with a dead pypilot core, so writes never leave to
    the void while the visor claims success.
25. **Reconnect Restore banner** — snapshot of target and mode on
    outage, Yes / No offer to re-engage the same target when pypilot
    is back.

### Data & reporting — 6 new added functions

26. **Trip Recorder** — auto-records every outing via
    `navigation.state`. Summary of 17 KPIs (distance, duration,
    SOG / TWS / AWS averages and peaks, heel, tacks, points-of-sail
    split, min voltage, AP-engaged %), OpenSeaMap trace coloured by
    SOG with markers on peak gust, peak SOG, min voltage and every
    detected tack. Share as portrait PNG report card or as plain text.
27. **Chart tab** — 9 live Trip Stats cards, history with
    30 s / 2 min / 10 min windows and hover-freeze, plus a Servo
    Health card.
28. **Persistent tack history** with pre / post TWS, AWA, SOG and
    recovery time to 95% of pre-tack speed, filterable by day range.
29. **Post-tack HUD stats** — before / after values plus SOG-loss
    verdict.
30. **Navigation session recorder** — every engaged AP session
    stored as JSONL with tags (wind, sea state, propulsion, point of
    sail, crew), shareable for advice.
31. **Full Signal K path catalog viewer** in the visor with
    copy-to-clipboard for downstream widgets.

### Signal K integration — 8 new added functions

32. **The pypilot catalog as Signal K paths** under
    `steering.autopilot.pypilot.*`, opt-in per path so you never flood
    the bus.
33. **Autopilot API v2 provider** (absorbable) — any downstream
    Signal K autopilot client talks to this plugin as the canonical
    autopilot.
34. **Simple Switch action paths** — engage, nudge, tack,
    mode selector, profile selector.
35. **8 momentary switches** — nudge ±10 / ±1, tack port / starboard
    / cancel, engage — as KIP boolean paths.
36. **Radio switches** — mode and profile groups as KIP radio switch
    sets.
37. **Publish-only-essentials toggle** — keeps the SK bus light on
    modest servers.
38. **Config export / import** — Web Share API or plain `.json`.
39. **Live status endpoint** — connection state, core-alive flag,
    catalog counters for external monitoring.

**39 concrete new functions** layered on top of pypilot: a full touch
UI + intelligence + observability + Signal K bridge.

> **Reliable by design, easy to tune** — the built-in **Pypilot
> Doctor** records a real session, tells you in plain language what
> is off (bias / oscillation / weak authority / noise) and proposes
> P / I / D changes you can accept with one tap. **Smart Pilot** goes
> one step further: it picks the right pilot profile for the wind
> you're in and reacts to gusts on its own.

**Light on the Raspberry Pi's own screen** — when the visor runs in a
browser on the Pi itself, it detects it and drops animations, blur and
glow effects so the Pi's GPU stays free for other apps.

See [`CHANGELOG.md`](./CHANGELOG.md) for the release-by-release
history.

## Signal K paths and switches

The touch visor is described above. Under the hood the plugin publishes
the **pypilot catalog** under `steering.autopilot.pypilot.*` (opt-in per
path; how many depends on your pypilot version and what you enable),
for example:

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
- `mode.{compass,gps,wind,trueWind}` — radio (mutually exclusive).
- `profile.<name>` — radio, dynamic per pilot profile.

## Installation

1. Signal K Server → **App Store** → search **PyPilot New-UI**.
2. Server → **Plugin Config** → **PyPilot New-UI + SK Paths**.
3. Enter the `pypilot_web` host (IP or hostname) and port. On TinyPilot the
   default is port `80`; on a classic pypilot install it is `8000`.
4. The **Scan LAN** button in the webapp auto-detects hosts running
   `pypilot_web` on ports 80 / 8000 of your subnet if you don't know the IP.
5. Enable the plugin.

**Webapp URL**: `http://localhost:3000/signalk-pypilot-newui/` (replace
`localhost` with your Signal K server address from another device).

## Works well with

Pypilot-newui is built as a well-behaved citizen of the Signal K
ecosystem — it consumes other mature plugins and standard APIs instead
of reinventing them. None are hard dependencies (the autopilot visor
works on its own), but installing them unlocks the features listed.

- **[`@signalk/freeboard-sk`](https://www.npmjs.com/package/@signalk/freeboard-sk)**
  — Double-tap the compass rose to open Freeboard-SK embedded inside
  the rose box (side panels stay visible and usable). Lets you drop
  from the autopilot view to the full chart with every AIS target in
  one tap, without leaving the pypilot-newui session. Freeboard is kept
  loaded in the background so it opens instantly (per-device switch in
  the "Chart in the background" card if a weak tablet prefers lazy
  loading). **Pair with a Signal K chart provider or the chart area
  will stay empty** — see
  [Chart provider is required](#chart-provider-is-required-for-the-embedded-plotter).

- **[`signalk-collision-alerts`](https://www.npmjs.com/package/signalk-collision-alerts)**
  by @dirkwa — Provides the CPA/TCPA engine behind our AIS collision
  overlay. Pypilot-newui subscribes to
  `notifications.navigation.closestApproach.*` and draws each target
  on the compass ring at its real bearing with a distance label,
  oriented by its heading / course with a projected track line when it
  is moving, plus an infobox with ACK that routes through the Signal K
  v2 Notifications API, so an ACK from pypilot-newui is also seen by
  Freeboard-SK and every other SK client.
  [Feature notes](https://github.com/Aitonos/signalk-pypilot-newui/blob/main/docs/_feature_ais_overlay.md).

- **[`signalk-mareas-ihm`](https://www.npmjs.com/package/signalk-mareas-ihm)**
  ("AnchorWatch Pro: Smart Anchoring, AIS & Tides" in the App Store) —
  **Recommended.** Unlocks the tide button on the rose (popup with the
  tide curve, next HW/LW and coefficient) and opens its anchor-watch
  visor inside the rose. It also fills AIS vessel names into the Signal
  K tree from its own persistent AIS database, so pypilot-newui,
  Freeboard-SK and collision-alerts show names instead of raw MMSIs
  right after a server restart.

- **[`signalk-polar-performance-plugin`](https://www.npmjs.com/package/signalk-polar-performance-plugin)**
  by hanstool, with
  **[`signalk-polar-management`](https://www.npmjs.com/package/signalk-polar-management)**
  by Aswin Bouwmeester — polar-management keeps your boat's polar
  table and selects the active polar; polar-performance turns it into
  live `performance.*` values (polar speed, % of polar, target speed,
  beat / gybe angle and VMG) that pypilot-newui offers on the corner
  tiles.

- **[`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider)**
  by Panaaj — the reference Autopilot API v2 provider for pypilot. See
  the next section for how the two plugins share the pilot.

## Working alongside `pypilot-autopilot-provider`

We build on top of the excellent
[`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider)
by Panaaj — the plugin that gives Signal K the standard
**Autopilot API v2** surface (`/signalk/v2/api/vessels/self/autopilots/*`) so
any downstream Signal K autopilot client can drive pypilot through the canonical
interface. Panaaj focuses tightly on that API and opens its own socket.io
connection to `pypilot_web`.

This plugin adds the rest of the pypilot catalog on top (gains, servo
telemetry, calibration, warnings, profiles, tack detail, etc.), ships the
touch webapp, and can optionally register the Autopilot API v2 itself via
the **absorbProvider** option in Setup, so a single socket hits
`pypilot_web` instead of two — useful when pypilot runs on a Pi Zero W.

Signal K only allows one provider per pilot ID, so if you turn on
**absorbProvider** here you should disable Panaaj's plugin (otherwise both
register the same ID and behaviour is undefined). Valid setups:

| Panaaj `pypilot-autopilot-provider` | `signalk-pypilot-newui` absorb | Result |
|---|---|---|
| Enabled | Off (default) | Both run happily side by side. Panaaj owns the AP v2 API; this plugin adds the extra paths + UI. **2 sockets** to `pypilot_web`. |
| Disabled | **On** | Only this plugin. Same AP v2 API + all the extras. **1 socket**. Handy on Pi Zero W. |
| Enabled | On | Both try to register the same AP ID — leave one off. |
| Disabled | Off | No downstream Signal K client will see the AP. Only useful if you exclusively use this plugin's own webapp. |

Absorb mode lives in **Setup → Autopilot Provider (one-socket mode)**.

## Remote restart / reboot + consoles

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

**Debug console** — a closed whitelist of preset commands over the same
SSH session: `restart pypilot_web` (web server only, does not interrupt
steering), `logs pypilot`, `logs pypilot_web`, `dmesg`, `top`, `uptime`,
`df`, `pypilot --version`. Output goes into a scrollable textarea, a
"Follow logs" toggle polls `journalctl --since '30 s ago'` every 3
seconds, and Copy / Share buttons let you paste the dump into a GitHub
issue. Its endpoint (`POST /plugins/*/debug-cmd`) refuses anything that
is not in the whitelist.

**Remote Control Console** — a free-form SSH shell on the TinyPilot
(`POST /plugins/*/ssh-exec`). It runs **any** command, so it is only
available when **`allowWrites`** is on. Anyone holding a Signal K token
with write access can use it: keep `allowWrites` off unless you need it.

Signal K stores plugin configs (including the SSH password) in plain text
under `~/.signalk/plugin-config-data/`, so use credentials that are only
valid for that isolated TinyPilot.

## HTTP endpoints (plugin router)

The main endpoints are listed below; the plugin exposes more (trips,
AIS, watch, supervisor, recorders…) — see `src/index.ts` for the full
router.

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
| `POST` | `/plugins/signalk-pypilot-newui/alarms/severity/:id` | Override the severity of one rule. Body: `{ "severity": "info\|warn\|alarm" }`. Persists via `props.alarmSeverityOverrides` so it survives restart. |
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
| `POST` | `/plugins/signalk-pypilot-newui/ssh-exec`      | **Free-form** SSH command (Remote Control Console). Body: `{ "cmd": "<any shell>" }`. Requires `allowWrites`. |
| `POST` | `/plugins/signalk-pypilot-newui/pause`         | Disconnect local socket (for scripts). |
| `POST` | `/plugins/signalk-pypilot-newui/resume`        | Reconnect local socket (for scripts). |

## Safety

- `allowDirectServo` defaults to **off** — the direct `servo.command` back-door
  used by pypilot's own UI for manual steering is not exposed until you enable
  it explicitly in the plugin config.
- `allowWrites` gates every write to pypilot and the free-form SSH console.
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
- @dirkwa — for
  [`signalk-collision-alerts`](https://www.npmjs.com/package/signalk-collision-alerts),
  the CPA/TCPA engine behind the AIS overlay.

## Troubleshooting

**Firefox on a Raspberry Pi (Pi 5 tested) is slow — the visor, the
chart and videos stutter, the whole desktop feels sluggish.** Firefox's
GPU renderer (WebRender on the Pi's V3D graphics chip) is far more
expensive there than software rendering: measured with the visor open,
the GPU sat at ~90 % and a 1080p video dropped 64 % of its frames; with
software rendering the GPU drops to ~3 % at the same CPU load. Fix it
once in that Firefox:

1. Type `about:config` in the address bar and accept the warning.
2. Search `gfx.webrender.software` and set it to `true`.
3. Restart Firefox.

Chromium does not need this. The visor detects Firefox on the Pi's own
screen and shows the same steps in its **Info** tab, with an **Apply
now** button: the plugin runs on that same Pi, so it writes the setting
into that Firefox's profiles (`user.js`) for you — then close and reopen
Firefox.

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
npm test
```

To try it on a Signal K server, link the folder into
`~/.signalk/node_modules/signalk-pypilot-newui` and restart Signal K.

## License

AGPL-3.0-or-later, Aitonos. See `LICENSE` and `NOTICE` for third-party
attributions.
