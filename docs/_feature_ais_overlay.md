# AIS collision overlay (3.0.0)

The AIS collision overlay is the headline feature of the 3.0.0 bump.
It paints threats on the compass rose, speaks a Spanish warning,
exposes an ACK button and lets the sailor jump into Freeboard-SK
embedded in the rose box for the full chart.

Pypilot-newui is a **consumer**, not an engine. The CPA/TCPA
calculation, threshold logic and lifecycle (silence / acknowledge /
clear via the Signal K v2 Notifications API) live in the external
plugin [`signalk-collision-alerts`](https://github.com/dirkwa/signalk-collision-alerts)
by [@dirkwa](https://github.com/dirkwa), who also maintains the SK
server admin UI. We subscribe to its deltas and render them.

See the memory `feedback_signalk_ecosystem_first.md` for the reasoning:
Signal K is a cooperative ecosystem, not a monolith — reinventing an
AIS collision engine when a well-maintained plugin exists would waste
work and lock pypilot-newui into a divergent copy.

---

## Install (one-time)

1. Open the SK admin UI: `http://<your-sk-host>:3000/admin/`.
2. Appstore → search `signalk-collision-alerts` → Install.
3. Server → Restart.
4. Verify the plugin is active:
   `/admin/#/serverConfiguration/plugins/signalk-collision-alerts`
   should read **Status: Watching AIS, radar and other targets**.

> **Known upstream issue** (as of 2026-10-10):
> [`dirkwa/signalk-collision-alerts#17`](https://github.com/dirkwa/signalk-collision-alerts/issues/17)
> — the admin UI does not render the `Alert sensitivity` or `Level`
> dropdowns because the plugin's typebox schema emits `anyOf` + `const`
> instead of `enum`. Until it's merged you either:
>  - hand-edit `~/.signalk/plugin-config-data/signalk-collision-alerts.json`
>    (see the "Harbour config" snippet below), or
>  - patch `~/.signalk/node_modules/signalk-collision-alerts/plugin/config.js`
>    (both `preset` and `customZones[].level` swap `Type.Union([Type.Literal(...)])`
>    → `Type.String({ enum: [...] })`).

## Configure the plugin

The plugin defines four presets:

| Preset     | Warn  (CPA / TCPA)  | Alarm (CPA / TCPA) |
|------------|----------------------|---------------------|
| `harbour`  | 100 m / 5 min        | 50 m / 2 min        |
| `coastal`  | 0.5 NM / 12 min      | 0.25 NM / 6 min     |
| `offshore` | 1 NM / 20 min        | 0.5 NM / 10 min     |
| `custom`   | configurable zones   | configurable zones  |

Plus:

- `maxRange` (NM): ignore targets farther than this radius. Default 12.
- `maxAge` (s): drop a target whose last report is older than this.
  Default 360 (rides out two missed 3-min reports from a Class A
  anchored vessel).
- `interval` (s): evaluation period. Default 2.
- `publishClosestApproach`: toggle whether the plugin publishes
  `vessels.<mmsi>.navigation.closestApproach` per target (we don't
  consume it; useful for Freeboard overlays).

### Recommended starting point for a mid-size sailing yacht in a Ría

```json
{
  "enabled": true,
  "configuration": {
    "preset": "harbour",
    "customZones": [
      { "level": "warn",  "cpa": 100, "tcpa": 300 },
      { "level": "alarm", "cpa": 50,  "tcpa": 120 }
    ],
    "maxRange": 3,
    "maxAge": 360,
    "interval": 2,
    "publishClosestApproach": true
  }
}
```

Why: harbour thresholds + a 3 NM range filter keep the stream manageable
in a dense Ría (dozens of vessels anchored and moored); the Rev436
"ignore stationary targets" filter in pypilot-newui handles the rest.
Switch to `coastal` when you leave the Ría; `offshore` for open-water
passages where you want earlier VHF/CPA negotiation time.

## Using the overlay (visor)

### Enable / disable + voice toggle
Long-press any corner tile → **Configurar las esquinas de la rosa** →
scroll to **ROSE OVERLAYS** → **Alarma de colisión AIS** card:

- **Checkbox** on/off (master). Default ON. Off → every AIS triangle +
  infobox cleared, voice silenced.
- **Aviso de voz** sub-toggle (default ON) — mutes the voice without
  losing the visual.
- **Abrir ajustes del plugin** → opens the plugin configuration page in
  a new tab.
- **Silenciadas…** → opens a modal with every MMSI silenced locally
  (10-minute TTL) and a per-row **Reactivar** button + **Reactivar
  todas**.

### On an active alarm

- A **red / orange triangle** paints on the compass circle at the
  bearing from the self vessel to the target *as of now* (not the
  CPA future projection). Red = `alarm` + blink; orange = `warn`.
- An **infobox** stays on top of the self boat with:
  - Level badge (`ALARM` / `WARN`).
  - Target name (or "objetivo" when the AIS target has no name yet
    — we never speak or display the MMSI itself).
  - **Multi-target navigator** `1/N` with `‹` / `›` buttons when more
    than one target is active (sorted by level then TCPA).
  - CPA (NM) · TCPA (min).
  - **Closing speed** (kn) when TCPA > 0.
  - **ACK** button.
- Voice: a short Spanish sentence built from the raw data (not the
  plugin's English message), e.g.
  *"Alarma A I S, PIRATA DE ONS, a 47 metros, ya"*
  or
  *"Aviso A I S, objetivo, a 1.2 millas, en 8 minutos"*.

### ACK semantics

- Tap **ACK** → the sailor's acknowledgement is sent to the Signal K
  v2 Notifications API endpoint
  `POST /signalk/v2/api/notifications/<id>/acknowledge` so Freeboard
  and every other SK consumer sees the acked state.
- Locally pypilot-newui silences **that MMSI for 10 minutes**, even if
  the plugin keeps republishing the notification (which it does
  while the threat persists). Different MMSI → fresh alarm.
- The **Silenciadas…** modal lets you un-silence a target before its
  TTL expires if you change your mind.

### Freeboard-SK embedded

- **Double-tap the compass rose** → Freeboard-SK opens embedded
  inside the rose box (side panels — mode, nudges, AP — stay visible
  and usable).
- Chrome row (top-right of the embed) has:
  - **⤢** Maximize → full-viewport.
  - **⤡** Restore → back to embedded.
  - **×** Close → hides the embed + releases the Freeboard websocket.
- Double-tap again toggles open / close.

## Signal K paths we read

Subscribe (as part of the `vessels.self` subscription):

```
notifications.navigation.closestApproach.<mmsi>
```

Per delta we also fetch the target's current position + SOG from the
Signal K v1 REST API with a 30 s cache:

```
GET /signalk/v1/api/vessels/urn:mrn:imo:mmsi:<mmsi>/navigation/position/value
GET /signalk/v1/api/vessels/urn:mrn:imo:mmsi:<mmsi>/navigation/speedOverGround/value
```

Used for:
- **Bearing render** (where the threat IS now, not where the CPA
  projects a future meeting).
- **Stationary filter**: SOG < 0.08 m/s (~0.15 kn) → treated as
  moored / anchored and dropped from the UI even if the plugin
  keeps publishing it in alarm.

## Signal K paths we write

Only the ACK:

```
POST /signalk/v2/api/notifications/<notificationId>/acknowledge
```

## Local toggles stored in localStorage

| Key                                      | Purpose |
|------------------------------------------|---------|
| `pypilotnewui.aisAlarm`                  | Master on/off |
| `pypilotnewui.aisAlarmVoice`             | Voice sub-toggle |

Both default `true`. The silenced-MMSI map lives in memory only
(session scope); a page reload clears it.

## Not reinvented, by design

What this plugin does **not** try to do:

- Compute CPA / TCPA. The upstream plugin does, with per-preset
  threshold logic and release factors.
- Track the lifecycle of an alarm. Signal K v2 Notifications API does.
- Render the chart. Freeboard-SK does.

If any of those become features we want tuned to the pypilot-newui
workflow, the right path is a PR to the respective upstream repo, not
a divergent copy here.
