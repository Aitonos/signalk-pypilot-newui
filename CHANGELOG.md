# Changelog

## 1.0.0 — 2026-08-18 — Rev32..Rev62 first public release

The webapp went from a minimum viable control panel to a full-blown touch
visor + first-class Signal K bridge in this batch. Highlights:

### UI - Control tab

- **Compass rose** (Rev47..Rev58): cardinals + 30° tick labels, boat-fixed
  green/red sailing wedges reaching under the hull, AWA (amber) + TWA
  (magenta dashed) arrows, cyan target diamond outside the ring, HDG at
  the top rim, wind speed at the bottom.
- **4 configurable corner tiles** (Rev48): long-press to pick datum (HDG,
  AWA/TWA/TWS/TWD, SOG, COG, TGT, depth, mode, polar-performance keys,
  custom SK path).
- **Wind arrow independent toggles** (Rev58): AWA and TWA on/off separately,
  persisted in localStorage.
- **Custom SK path** (Rev58): add any published Signal K path as a corner
  tile with label + unit. Datalist auto-suggests paths seen on the bus.
- **Polar-performance opt-in** (Rev58): checkboxes for the 10 keys of
  `signalk-polar-performance-plugin` + water temperature.
- **Optimistic AP engage** (Rev56): visual state flips instantly on click,
  auto-retries on Tailscale flakes, rolls back with red-border flash on
  hard failure. Guard blocks double-taps from firing opposite POSTs.
- **KIP-friendly Simple Switches** (Rev33..Rev38): `electrical.switches.pypilot.*`
  for ap.state (momentary boolean), nudge (4 momentary), tack (3 momentary),
  mode (radio), dynamic profile (radio).

### UI - Tune tab

- **Locked-by-default gain sliders** (Rev42): unlock checkbox, auto-relocks
  on tab exit.
- **±10 / ±1 fine-tune buttons** (Rev43) flanking each slider.
- **Orange "was" reference** shown when unlocked so the operator sees what
  they are moving from.
- All `RangeSetting` config sliders from the pypilot catalog appear here
  automatically (Rev45).

### UI - Race tab (new, Rev35)

- T1/T2 countdown timer with audible beeps, screen flash, spoken seconds
  ("10, 5, 4, 3, 2, 1, Start"). Runs in the background across tabs.
- SYNC rounds to the nearest minute mid-countdown; RESET returns to idle.

### UI - Setup tab

- **Remote `RESTART pypilot`** (Rev55): SSH into the TinyPilot using the
  user + password stored in plugin config (via `ssh2` npm), runs
  `sudo systemctl restart pypilot pypilot_web`, reconnects local socket.
  Falls back to reconnect-only if SSH fails or password not set.
- **`_pluginConfigMerge` helper** (Rev55): GETs the full plugin config from
  `/skServer/plugins/<id>/config`, overlays only the patched fields, POSTs
  back - so saving Nudge or Absorb no longer wipes the SSH credentials
  (or vice versa) via full-replace.
- Pause/Resume buttons removed from the UI (backend endpoints kept).
- Absorb-provider hint reworded, security note added for the plain-text
  plugin config storage.

### UI - Paths & API tab

- KIP mini-table trimmed to the current recommended surface (Simple Switch
  + Autopilot API v2 Put). Legacy `.actions.engage/nudge/tack/*Int` paths
  hidden from the UI (backend handlers still registered for backwards
  compatibility).
- Horizontal-scroll wrapper on both tables so long SK paths remain readable
  on portrait phones.

### UI - Info tab (new, Rev58..Rev59)

- Safety notice, quick-start (10 steps), About, Acknowledgements
  (Sean D'Epagnier, Jean-Marc at Navitop, Signal K community, Panaaj),
  Apache 2.0 license attribution, GitHub issue links, coexistence rules
  with `pypilot-autopilot-provider`.
- **Config export/import** (Rev59): Web Share API to email / WhatsApp /
  Signal / AirDrop, `.json` download, clipboard copy, file / text import,
  reset. Payload includes corners, wind-arrow flags, polar toggles, custom
  paths. Never includes SSH credentials.
- Version + Rev header, link to the classic pypilot_web UI on the TinyPilot.

### i18n (Rev61)

- Full **English / Español / Deutsch / Français** with browser auto-detect
  on first visit, override in Setup → Language.
- ~90 keys covering tabs, Setup, popup, Paths, Regatta, alerts, prompts,
  confirms. EN + ES complete; DE + FR cover tabs + core Setup + calibration
  and fall back to EN for the rest.
- Info tab uses `data-lang` sibling blocks (EN + ES fully written).
- `<html lang="…">` reflects the active language.

### Layout / responsiveness (Rev49..Rev57)

- Landscape: rose stretches to fill the left column; control column becomes
  a `1fr 1fr auto` grid so tack + AP rows fill the height instead of
  clustering at the top. Text auto-shrinks via `clamp(min, min(vw, vh), max)`.
- Portrait: nav bar and swipe hint always visible; corner tiles inside the
  rose square; long paths get horizontal scroll wrappers.
- **Swipe navigation** (Rev43..Rev57) between tabs: 80px threshold, 2.2×
  H/V ratio, first-move axis lock so scrolling never triggers a stray
  tab flip. Excluded over unlocked sliders and `.paths-scroll` wrappers.
- Nav-bar auto-hide toggle via yellow triangle in the swipe-hint strip.

### Backend (src/index.ts)

- `PLUGIN_REVISION` bumped Rev32 → Rev61 (11 packaged Revs since 0.1.0).
- New `sshUser` + `sshPassword` plugin config fields (Rev55).
- New `POST /plugins/*/restart-pypilot` router using `ssh2` (Rev55).
- `/status` exposes `sshUser`, `sshPasswordSet` (never the password itself),
  and the package `version` from `package.json` (Rev59).
- Wildcard subscription to `performance.*` for polar-performance keys +
  `environment.water.temperature` (Rev58).
- Optimistic UI + retry helper in the frontend (Rev56); no backend change.

### Screenshots + logo (Rev61)

- App Store screenshots in `public/screenshots/` (JPEG < 500 KB each,
  4 shots: Control / Tune / Info / Setup).
- Vector logo `public/Pypilot_New_UI.svg` (33 KB) wired as
  `signalk.appIcon`.
- `signalk.screenshots[]` populated for the App Store card.

### Docs

- README rewritten: full feature list, coexistence table, remote restart,
  updated endpoint table, acknowledgements, safety, reporting.
- App Store `description` in `package.json` replaced with a
  user-facing one-paragraph blurb.

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
