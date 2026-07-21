# Changelog

## 0.1.0 — 2026-07-21

Initial scaffold.

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
