# PyPilot New-UI for Signal K

**A modern, touch-first autopilot screen for [pypilot](https://github.com/pypilot/pypilot) and TinyPilot — that also tunes your pilot for you.**

`signalk-pypilot-newui` enhances Sean D'Epagnier's open-source autopilot with **43 new functions**: a tablet- and phone-friendly visor, a built-in tuning assistant, smart wind-aware profiles, a 17-rule alarm engine, trip logging, and first-class **Signal K integration** so any Signal K client can drive and monitor the autopilot out of the box.

Spend more time sailing and less time guessing which slider to move.

![Control - compass rose with an AIS collision target on the compass ring](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/01-control-rose.jpg)

---

## Why PyPilot New-UI

- **Tunes itself** — *Pypilot Doctor* records a real session, explains in plain language what is off (bias, oscillation, weak authority, noise) and proposes P / I / D changes you accept with one tap. Your original profile stays one tap away.
- **Adapts to the wind** — *Smart Pilot* picks the Light / Medium / Heavy profile for the wind you're in and reacts to gusts on its own.
- **Safer at sea** — pre-departure READY / CAVEATS / DO-NOT-ENGAGE check, 17 alarm rules, auto-disengage on lost authority, stuck-pilot recovery and a reconnect-restore banner.
- **Your whole boat on one screen** — chartplotter, AIS collision targets, tides, anchor watch and polar performance, right inside the compass rose.
- **Follows your Freeboard routes** — pypilot's NAV mode with no extra plugins: auto-advance with a spoken message, compass on the current heading at the destination or on data loss.
- **Manoeuvres pypilot doesn't have** — *AUTO WIND* (apparent wind upwind, true wind downwind, switched for you), *Head to wind* to hoist sail, *Downwind* to strike it, synthetic tack with countdown.
- **Logs every outing** — automatic trip recorder with 17 KPIs, coloured track, tack history and a shareable report card.
- **Plays well with Signal K** — Autopilot API v2 provider, the full pypilot catalog as Signal K paths, KIP-ready switches and canonical notifications.
- **Light on the Raspberry Pi** — on the Pi's own screen it drops animations, blur and glow so the GPU stays free for other apps.
- **Multi-language** — EN / ES / DE / FR, auto-detected.

---

## Screenshots

| Chartplotter embedded | AnchorWatch Pro inside the rose |
|---|---|
| ![Freeboard-SK embedded in the rose box](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/02-chartplotter-embedded.jpg) | ![Anchor-watch visor of AnchorWatch Pro inside the rose](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/03-anchorwatch-in-rose.jpg) |

| Tide at a glance | Modes · head to wind / downwind |
|---|---|
| ![Tide popup with the tide curve](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/04-tide-popup.jpg) | ![Mode picker with AUTO WIND, Head to wind and Dead downwind](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/05-modes-autowind.jpg) |

| Tune · gain sliders | Logbook · trip detail |
|---|---|
| ![Tune tab - PID gain sliders](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/06-tune-sliders.jpg) | ![Logbook trip detail - track and SOG vs AWS chart](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/07-logbook-trip-detail.jpg) |

![Tack history - per-tack speed retention and recovery](https://raw.githubusercontent.com/Aitonos/signalk-pypilot-newui/main/public/screenshots/08-tack-history.jpg)

---

## Quick start

1. Signal K Server → **App Store** → search **PyPilot New-UI** → install.
2. Server → **Plugin Config** → **PyPilot New-UI + SK Paths**.
3. Enter the `pypilot_web` host (IP or hostname) and port — `80` on TinyPilot, `8000` on a classic pypilot install. Don't know the IP? The **Scan LAN** button in the webapp finds `pypilot_web` hosts on ports 80 / 8000 of your subnet.
4. Enable the plugin.
5. Open **`http://localhost:3000/signalk-pypilot-newui/`** (replace `localhost` with your Signal K server address on a tablet or phone).

That's it — the autopilot visor works with just pypilot. Add the [companion plugins](#unlock-more-with-companion-plugins) to light up charts, AIS, tides and polars.

---

## Unlock more with companion plugins

PyPilot New-UI is a well-behaved citizen of the Signal K ecosystem: it builds on mature plugins and standard APIs instead of reinventing them. All install from the Signal K App Store and are picked up automatically — no configuration inside PyPilot New-UI.

| Plugin | Status | What it unlocks |
|---|---|---|
| [pypilot](https://github.com/pypilot/pypilot) / TinyPilot (`pypilot_web`) | **Required** | The autopilot itself. |
| [`signalk-mareas-ihm`](https://www.npmjs.com/package/signalk-mareas-ihm) — **AnchorWatch Pro: Smart Anchoring, AIS & Tides** | **Recommended** | **Tide button on the rose** (tide curve, current height, rising / falling, next HW / LW, coefficient) and the **anchor-watch visor inside the rose**. Also fills AIS vessel names into Signal K from its persistent AIS database, so targets show names instead of raw MMSIs right after a server restart. |
| [`@signalk/freeboard-sk`](https://www.npmjs.com/package/@signalk/freeboard-sk) | **Recommended** | **Integrated chartplotter**: double-tap the rose and the chart opens inside it with every AIS target, your route and all overlays — the autopilot buttons stay reachable. |
| A chart provider: [`signalk-charts-provider-simple`](https://github.com/dirkwa/signalk-charts-provider-simple) or [`@signalk/charts-plugin`](https://www.npmjs.com/package/@signalk/charts-plugin) | **Required for the chartplotter** | Serves the chart tiles Freeboard-SK draws. [See note below](#chart-provider-note). |
| [`signalk-collision-alerts`](https://www.npmjs.com/package/signalk-collision-alerts) | **Recommended** | **AIS collision targets on the rose** — real bearing, distance label, course line, infobox with vessel name and ACK. |
| [`signalk-polar-performance-plugin`](https://www.npmjs.com/package/signalk-polar-performance-plugin) + [`signalk-polar-management`](https://www.npmjs.com/package/signalk-polar-management) | Optional | **Polar performance on the corner tiles**: polar speed, % of polar, target speed, beat / gybe angle and VMG from your boat's polar table. |
| [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider) | Optional | Shares the pypilot connection with other Signal K autopilot clients. [How the two coexist](#working-alongside-pypilot-autopilot-provider). |

<details>
<summary><strong>Details per plugin</strong></summary>

- **AnchorWatch Pro** (`signalk-mareas-ihm`) — the tide button sits just above the bottom-right corner tile. From the tide popup, one tap opens the anchor-watch visor full-screen inside the rose, like the chart. Without the plugin, the button explains what it does and links straight to its App Store page.
- **Freeboard-SK** — opens embedded in the rose box; side panels stay visible and usable. Drop from the autopilot view to the full chart in one tap without leaving the session. It's kept loaded in the background so it opens instantly (a per-device switch in the *Chart in the background* card enables lazy loading on weak tablets).
- **signalk-collision-alerts** by @dirkwa — provides the CPA/TCPA engine. PyPilot New-UI subscribes to `notifications.navigation.closestApproach.*` and draws each target oriented by its heading / course, with a projected track when moving. ACK goes through the Signal K v2 Notifications API, so an ACK here is also seen by Freeboard-SK and every other client. [Feature notes](https://github.com/Aitonos/signalk-pypilot-newui/blob/main/docs/_feature_ais_overlay.md).
- **Polar plugins** — `signalk-polar-management` (Aswin Bouwmeester) stores your polar table (import ORC / CSV / text) and selects the active polar; `signalk-polar-performance-plugin` (hanstool) turns it into live `performance.*` values, each one opt-in on the corner selectors.

</details>

<a id="chart-provider-note"></a>
> **Chartplotter needs a chart provider.** Freeboard-SK is only a renderer — without a provider the embedded map stays empty.
> - [`signalk-charts-provider-simple`](https://github.com/dirkwa/signalk-charts-provider-simple) by @dirkwa — serves local chart tilesets. **Recommended** for the embedded plotter.
> - [`@signalk/charts-plugin`](https://www.npmjs.com/package/@signalk/charts-plugin) — the official provider; local **MBTiles** / **TMS** from `~/.signalk/charts/`, plus online WMS, WMTS and tilejson sources.
>
> Install one, add your chart sources, and the chartplotter lights up automatically.

---

## All features — 43 new functions on top of pypilot

### Smart autopilot (15)

1. **Pypilot Doctor** — records an engaged AP session, detects bias / oscillation / low authority / noise, and proposes P/I/D adjustments with plain-language rationale. Applying forks the current profile into `doctor-YYYYMMDD-HHMM`, so the original stays one tap away.
2. **Smart Pilot — auto profile by wind** — switches between Light / Medium / Heavy profiles by averaged TWS. **AUTO WIND pseudo-mode**: apparent wind below 120° TWA, true wind above (with hysteresis), one profile per side so the true-wind side can be more reactive. Needs GPS (pypilot only offers true wind with it).
3. **Smart Pilot — gust strategy** — boost D +20% for 20 s, switch to Heavy for 30 s, or just warn.
4. **Head-to-wind and Downwind pseudo-modes** — two sail-handling manoeuvres not in pypilot, each with a *by bow* / *by stern* swing; on exit, previous mode, target, engage state and profile are restored.
   - **Head to wind (hoist sail)** — bow into the wind and held there (done when the wind stays within 10° of the bow for 3 s). Above 10 kn TWS it recommends swinging by the bow, since gybing is risky.
   - **Dead downwind (strike sail)** — wind dead astern so the sail comes down without flogging (done when |TWA| > 175° for 3 s). While holding, a sharper PID (P ×1.5, D ×1.7, rudder slew ×1.3) guards against an accidental gybe; voice warning if |TWA| < 160°, auto-cancel below 140° for 2.5 s.
5. **Synthetic tack** and **tack countdown UI** with planned final target and single-tap cancel.
6. **Pre-departure Autopilot Check** — a single READY / CAVEATS / DO-NOT-ENGAGE verdict across every sensor, servo, voltage and link signal.
7. **Alarm engine — 17 rules** — heading deviation, cruise drift, unable-to-steer, pilot stuck, pilot cannot recover, AP disengaged from the remote / TinyPilot, servo overcurrent, servo current near trip, rudder near end stop, servo controller temperature, motor temperature, high AP load, low voltage, sensor lost, pypilot disconnected, extreme heel, extreme pitch — all published as canonical `notifications.autopilot.*`.
8. **Auto-disengage on lost authority** — RMS heading error > 30° with servo duty > 90% sustained 10 s. **Stuck pilot recovery** (opt-in): without a rudder sensor, pypilot treats overcurrent as end of rudder travel; when it reports that fault and the error keeps growing, the plugin cycles the AP (same mode and target) to clear it, max 3 times per minute, never during pypilot's own tack.
9. **Sensor Quality** — freshness, update rate, jitter and source per AP-critical Signal K path, with per-row Ignore / Restore.
10. **Servo Health** — learns a baseline for typical servo duty at sea and flags recent, peak, temperature or voltage deviations.
11. **Watchdog with core-alive detection** — tells a live `pypilot_web` from a dead pypilot core, so writes never vanish while the visor claims success.
12. **Reconnect Restore banner** — snapshots target and mode on outage and offers to re-engage the same target when pypilot is back.
13. **Route following (NAV) from Freeboard, no extra plugins** — reads the active route from Signal K's Course API, computes leg bearing, cross-track error and arrival itself and feeds pypilot an APB sentence every second over Signal K's NMEA output (the one the TinyPilot already reads), so pypilot offers NAV. Cross-track error capped both ways. Waypoints advance on their own with a spoken message; at the destination or if the route / GPS is lost for 5 s the pilot goes to compass on the current heading. Engage from Freeboard / KIP goes straight to NAV; the visor asks before a turn over 60°; ±1 / ±10 take over in compass.
14. **Black box** — keeps the last minute of autopilot data and saves one minute before and after an incident (AP taken off from outside, stuck pilot, overcurrent, slow or failed tack, alarm) or a Mark press. Chart with every field and a touch cursor, View / Download as JSON, and a note per incident dictated with the phone keyboard.
15. **Shadow-mode tuning (preview)** — every 90 s with the pilot engaged the plugin stores a navigation-database row (conditions, setup, heading error, servo work, what each pypilot term contributed) and works out which single gain step an automatic tuner would try and why (oscillation, overshoot, nervous servo, sustained offset, slow response), and whether a fair before / after comparison would be possible. Nothing is applied: the verdicts show in each session's Summary. The gain watchdog (see Safety) is in place for the later automatic stage.

### Touch visor (14)

16. **Compass rose** with colour-coded cardinals, hull-fixed sailing wedges and 4 corner tiles configurable by long-press.
17. **Concentric Target + Wind arrows** — target diamond tinted by mode (red compass, amber apparent, teal true), amber `A` and teal `T` arrows. They interlock into a droplet when aligned and open into V-notches with a colour tick when they drift.
18. **Gust marker overlay** — a notable gust or wind shift leaves a ghost `A` / `T` at the angle it hit, with its speed, fading over 15 s. Per-device on / off with a test button.
19. **COG line + Current vector** overlays.
20. **Custom Signal K path** bindable to any corner tile.
21. **Polar performance on corner tiles** *(with the polar plugins)*.
22. **Switchable bottom bar** — rudder angle or boat heel.
23. **Integrated chartplotter** *(with Freeboard-SK)* — double-tap the rose.
24. **AIS collision targets on the rose** *(with signalk-collision-alerts)*.
25. **Tide at a glance** *(with AnchorWatch Pro)* — interactive tide curve and anchor-watch visor in the rose. A helm button on the other side opens the logbook (the live trip while sailing).
26. **Race timer T1/T2** with beeps, screen flash and spoken countdown, persistent across tabs.
27. **Swipe navigation** between tabs with vertical-axis lock, so scrolling never flips a tab by accident.
28. **Multi-language** EN / ES / DE / FR, auto-detected from the browser.
29. **Profile history** — the profile manager shows under each profile its version, when it was made, which profile it was copied from and how (Tune, New, Doctor, import); a rename keeps the history, and look-alike names (extra spaces, capitals) are flagged.

### Logbook & performance data (6)

30. **Trip Recorder** — auto-records every outing via `navigation.state` (opens when under way, closes back in port; dock tests under 0.1 nm are discarded). 17 KPIs (distance, duration, SOG / TWS / AWS averages and peaks, heel, tacks, points-of-sail split, min voltage, AP-engaged %), OpenSeaMap track coloured by SOG with markers on peak gust, peak SOG, min voltage and every tack. Share as a portrait PNG report card or plain text. The trip in progress can be opened live while sailing.
31. **Chart tab** — 9 live Trip Stats cards, history with 30 s / 2 min / 10 min windows and hover-freeze, plus a Servo Health card.
32. **Persistent tack history** — pre / post TWS, AWA, SOG and recovery time to 95% of pre-tack speed, filterable by day range.
33. **Post-tack HUD stats** — before / after values and SOG-loss verdict.
34. **Navigation session recorder** — every engaged AP session stored as JSONL with tags (wind, sea state, propulsion, point of sail, crew), shareable for advice. Each session keeps a **Summary** (heading error, servo work, wind, speed, time per mode) and every profile or gain change with who made it (you, Doctor, auto profile, gust, another app) and why.
35. **Signal K path catalog viewer** with copy-to-clipboard for downstream widgets.

### Signal K integration (8)

36. **Full pypilot catalog as Signal K paths** under `steering.autopilot.pypilot.*`, opt-in per path so you never flood the bus.
37. **Autopilot API v2 provider** (absorbable) — any Signal K autopilot client talks to this plugin as the canonical autopilot.
38. **Simple Switch action paths** — engage, nudge, tack, mode selector, profile selector.
39. **8 momentary switches** — nudge ±10 / ±1, tack port / starboard / cancel, engage — as KIP boolean paths.
40. **Radio switches** — mode and profile groups as KIP radio switch sets.
41. **Publish-only-essentials toggle** — keeps the bus light on modest servers.
42. **Config export / import** — Web Share API or plain `.json`.
43. **Live status endpoint** — connection state, core-alive flag and catalog counters for external monitoring.

**Plus — remote recovery without SSH:** one-tap *Restart pypilot* and *Reboot Pi* buttons, and a whitelisted debug console. [Details](#remote-restart-reboot-and-consoles).

See [`CHANGELOG.md`](./CHANGELOG.md) for the release-by-release history.

---

## Safety

- This plugin is an **aid** to navigation and steering. It does not replace the skipper's vigilance, correct manoeuvring, direct observation of the surroundings, or official charts and notices. Verify in safe waters before relying on the autopilot for demanding manoeuvres.
- `allowDirectServo` defaults to **off** — pypilot's direct `servo.command` back-door for manual steering is not exposed until you enable it.
- `allowWrites` gates every write to pypilot (including the route follower's APB sentences and the gain watchdog) and the free-form SSH console.
- All PUT handlers validate ranges from the pypilot catalog before sending.
- On plugin stop the socket closes cleanly; the visor auto-reconnects on Signal K restart.
- **Gain watchdog (separate process).** Before the plugin tries a gain change on its own, it starts a small watchdog process that ships with the plugin (`dist/gain-watchdog.js`, plain Node, no extra install). It runs outside Signal K, so if Signal K freezes during the trial it switches pypilot back to the profile you had within 15 s, over pypilot's own port. If Signal K crashes or is restarted, systemd stops the watchdog too; the plugin then restores the profile itself as soon as it starts again. It only ever writes `profile`, only while the trial profile is still active (a profile you picked yourself meanwhile is left alone), never creates a missing one, respects `allowWrites`, keeps retrying if the link to pypilot drops, logs what it does to `gain-watchdog/watchdog.log` in the plugin's data folder, and exits after 10 idle minutes. With automatic tuning off it never runs.

---

## Advanced setup

### Working alongside `pypilot-autopilot-provider`

We build on the excellent [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider) by Panaaj, which gives Signal K the standard **Autopilot API v2** (`/signalk/v2/api/vessels/self/autopilots/*`) and opens its own socket.io connection to `pypilot_web`.

This plugin adds the rest of the pypilot catalog (gains, servo telemetry, calibration, warnings, profiles, tack detail…) and the touch webapp, and can optionally register the Autopilot API v2 itself via **absorbProvider**, so a single socket hits `pypilot_web` instead of two — handy when pypilot runs on a Pi Zero W.

Signal K allows only one provider per pilot ID, so if you enable absorb mode, disable Panaaj's plugin.

| Panaaj `pypilot-autopilot-provider` | New-UI absorb | Result |
|---|---|---|
| Enabled | Off (default) | Both run side by side. Panaaj owns the AP v2 API; this plugin adds the extra paths + UI. **2 sockets.** |
| Disabled | **On** | Only this plugin: same AP v2 API + all the extras. **1 socket.** Ideal on Pi Zero W. |
| Enabled | On | Both register the same AP ID — leave one off. |
| Disabled | Off | No other Signal K client sees the AP. Only useful if you use this plugin's webapp exclusively. |

Absorb mode lives in **Setup → Autopilot Provider (one-socket mode)**.

### Remote restart, reboot and consoles

When the autopilot process on the TinyPilot gets wedged, no manual SSH session is needed. Save the TinyPilot's SSH user + password once in **Setup → Emergency** and you get two big buttons, each behind a confirmation that asks whether someone is at the helm:

1. **RESTART pypilot** (~10-15 s) — `sv restart` of pypilot core + web (runit under piCore). The AP drops the heading briefly and re-engages when back.
2. **Reboot Pi** (~35-60 s) — full `sudo reboot`. No autopilot for almost a minute; last resort.

**Debug console** — a closed whitelist of preset commands over the same SSH session: `restart pypilot_web` (web server only, steering unaffected), `logs pypilot`, `logs pypilot_web`, `dmesg`, `top`, `uptime`, `df`, `pypilot --version`. Scrollable output, a *Follow logs* toggle (polls `journalctl --since '30 s ago'` every 3 s), and Copy / Share buttons for GitHub issues. The endpoint refuses anything outside the whitelist.

**Remote Control Console** — a free-form SSH shell on the TinyPilot. It runs **any** command, so it is only available with **`allowWrites`** on, and anyone with a write-enabled Signal K token can use it. Keep `allowWrites` off unless you need it.

> Signal K stores plugin configs — including the SSH password — in plain text under `~/.signalk/plugin-config-data/`. Use credentials valid only for that isolated TinyPilot.

---

## Troubleshooting

**Firefox on a Raspberry Pi is slow (Pi 5 tested) — visor, chart and videos stutter, the whole desktop feels sluggish.**
Firefox's GPU renderer (WebRender on the Pi's V3D chip) costs far more there than software rendering: with the visor open, the GPU sat at ~90% and a 1080p video dropped 64% of its frames; with software rendering the GPU falls to ~3% at the same CPU load. Fix it once:

1. Open `about:config` and accept the warning.
2. Set `gfx.webrender.software` to `true`.
3. Restart Firefox.

Chromium doesn't need this. The visor detects Firefox on the Pi's own screen and shows these steps in its **Info** tab with an **Apply now** button that writes the setting into that Firefox's profiles (`user.js`) for you — then close and reopen Firefox.

---

## Reference for integrators

### Signal K paths

The **pypilot catalog** is published under `steering.autopilot.pypilot.*` (opt-in per path; the count depends on your pypilot version and what you enable), for example:

- Gains per pilot (`P`, `I`, `D`, `DD`, `PR`, `FF`).
- Servo telemetry (voltage, current, controller / motor temperatures, flags, amp-hours, clutch engaged, controller error).
- Rudder calibration (offset, scale, non-linearity, range, calibration state).
- IMU heading offset, errors, warnings.
- Active pilot, active profile, available pilots / profiles / modes.
- Tack state, tack direction, tack timeout.
- Runtime, version.

Route following publishes `steering.autopilot.route` (active, waypoint name, index / total, distance, XTE, leg bearing, bearing to waypoint, last event).

### KIP-ready switches

Under `electrical.switches.pypilot.*`:

- `ap.state` — momentary boolean, engage / disengage.
- `nudge.{bigPort,smallPort,smallStar,bigStar}` — momentary, auto-reset.
- `tack.{port,starboard,cancel}` — momentary.
- `mode.{compass,gps,wind,trueWind}` — radio (mutually exclusive).
- `profile.<name>` — radio, dynamic per pilot profile.

### HTTP endpoints

<details>
<summary><strong>Show the main plugin endpoints</strong></summary>

The plugin exposes more (trips, AIS, watch, supervisor, recorders…) — see `src/index.ts` for the full router.

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
| `POST` | `/plugins/signalk-pypilot-newui/route/next` | Advance the active route to the next waypoint (requires `allowWrites`). |
| `GET`  | `/plugins/signalk-pypilot-newui/black-box/list` | Saved black-box incidents (summary, seen flag, note). |
| `GET`  | `/plugins/signalk-pypilot-newui/black-box/incident/:id` | One incident as JSON (samples, events, note). |
| `POST` | `/plugins/signalk-pypilot-newui/black-box/mark` | Mark now: open an incident (1 min before + 1 min after). |
| `POST` | `/plugins/signalk-pypilot-newui/black-box/note/:id` | Set the incident note. Body: `{ "note": "...", "append": false }`. |
| `POST` | `/plugins/signalk-pypilot-newui/restart-pypilot` | SSH `sv restart` of pypilot core+web on the TinyPilot. |
| `POST` | `/plugins/signalk-pypilot-newui/debug-cmd`     | Run one of a closed whitelist of preset diagnostic / restart commands over SSH. Body: `{ "preset": "<name>" }`. |
| `POST` | `/plugins/signalk-pypilot-newui/ssh-exec`      | **Free-form** SSH command (Remote Control Console). Body: `{ "cmd": "<any shell>" }`. Requires `allowWrites`. |
| `POST` | `/plugins/signalk-pypilot-newui/pause`         | Disconnect local socket (for scripts). |
| `POST` | `/plugins/signalk-pypilot-newui/resume`        | Reconnect local socket (for scripts). |

</details>

---

## Support & feedback

Found a bug or have an idea? Open an issue on [GitHub](https://github.com/Aitonos/signalk-pypilot-newui/issues). Please include the Rev (in the app under **Info** → top header, or via `GET /plugins/signalk-pypilot-newui/status`), what you expected, what happened, and a screenshot if possible.

## Development

```
git clone https://github.com/Aitonos/signalk-pypilot-newui
cd signalk-pypilot-newui
npm install
npm run build
npm test
```

To try it on a Signal K server, link the folder into `~/.signalk/node_modules/signalk-pypilot-newui` and restart Signal K.

## Acknowledgements

- **Sean D'Epagnier** — creator of [pypilot](https://github.com/pypilot/pypilot), the open-source autopilot that makes this plugin possible.
- **Jean-Marc** at [Navitop](https://www.navitop.fr/) — for the TinyPilot hardware and marine integrations, and for making pypilot accessible to European sailors.
- **Panaaj** — for [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider), the reference AP v2 provider this plugin builds on.
- **@dirkwa** — for [`signalk-collision-alerts`](https://www.npmjs.com/package/signalk-collision-alerts), the CPA/TCPA engine behind the AIS overlay.
- The [Signal K](https://signalk.org/) community and OpenPlotter for the open ecosystem this plugin runs on.

## License

AGPL-3.0-or-later, Aitonos. See `LICENSE` and `NOTICE` for third-party attributions.
