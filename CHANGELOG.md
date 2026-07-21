# Changelog

## 0.1.0 — 2026-07-21

### Rev1..Rev6 first-boot iteration on the Tunatunes Pi

- Rev1 scaffold.
- Rev2 fix: factory function forgot to `return plugin` -> SK crashed with
  `Cannot read properties of undefined (reading 'id')`.
- Rev3 fix: `publishMeta` sent `updates:[{meta:[...]}]` without `values`,
  triggering `update.values is not iterable` in the SK delta iterator.
- Rev4 refactor: attach `meta` INLINE on the first `publishValue` of each
  path so no delta ever carries an empty `values` array. Dropped the
  separate `publishMeta` call.
- Rev5 diagnostic: catalog counts in `setPluginStatus`.
- Rev6 fix: pypilot exposes gains as `ap.pilot.<pilot>.<gain>` (SINGULAR),
  not `ap.pilots.*` as the initial brief assumed. Confirmed by inspecting
  `pypilot_values` on the socket.io wire. Corrected in publisher.ts,
  index.ts (setupWatches + status), and public/app.js (renderGains).

### Known limitation

`signalk-pushover-plugin@0.0.6` emits two `Unhandled rejection: TypeError:
update.values is not iterable` at every SK restart, even before our plugin
publishes anything. The stack is pushover's own (`index.js:193:71`) and
does not reference our plugin. Ignore, or file upstream against
pushover-plugin.

### Backend
- src/pypilot-client.ts: socket.io client to `pypilot_web`, reconnect,
  `pypilot_values` catalog discovery, watch/set primitives, ping/pong.
- src/publisher.ts: fixed + dynamic mapping table pypilot names to
  `steering.autopilot.pypilot.*` (gains, servo, calibration, tack,
  errors, warnings, runtime, version). Deg->rad and C->K conversions.
- src/scanner.ts: /24 LAN scan, TCP probe on ports 80 and 8000, HTTP
  fingerprint on `<title>pypilot control</title>`.
- src/index.ts: plugin lifecycle + JSON schema + PUT handlers (with
  reverse rad->deg on angle paths) + HTTP router (`/status`, `/paths`,
  `/catalog`, `/scan`, `/raw`).

### Reserved for pypilot-autopilot-provider (never republished)
`ap.enabled`, `ap.heading`, `ap.heading_command`, `ap.mode`. Both plugins
coexist.

- Backend: socket.io client to `pypilot_web`, catalog discovery via
  `pypilot_values`, watch subscriptions, delta publisher with
  configurable per-path enable/disable.
- Paths: full `steering.autopilot.pypilot.*` tree (gains, servo,
  calibration, tack, errors, warnings, runtime, version).
- HTTP: `/scan` LAN discovery, `/status`, `/paths` KIP-friendly catalog,
  `/raw` protected write.
- Webapp: mobile-first dark, four tabs (Control, Ajustes, Paths & API,
  Setup). Control tab fully wired against the Autopilot API v1 of
  Signal K (engage / disengage / mode / target / tack / heading nudges);
  Ajustes tab with translucent-while-adjusting sliders for gains and
  calibration; Paths & API tab with live path list + copy-for-KIP;
  Setup tab with LAN scan.
- Coexists with the official `pypilot-autopilot-provider` — this plugin
  never publishes `steering.autopilot.state / mode / target / engaged`
  (those stay with the provider).
