# Changelog

## 2.2.0 — 2026-08-31 — Rev88..Rev127

Forty in-session Revs of navigation-oriented features on top of the
2.1.0 visual foundation. Themes: turn the plugin into an intelligence
layer over pypilot (historian → KPIs → alarms → Doctor → pre-departure
check), give sail-raising its own AP mode ("Aproado"), and rebuild the
Setup tab as an app-launcher grid of fullscreen tiles.

### English

**Added**

- **Aproado pseudo-mode** (Rev87-92) — a new "raise the sails"
  autopilot mode not in pypilot upstream. Pick BY BOW / BY STERN
  via a 5 s modal, the plugin switches pypilot to wind mode with
  target 0° (head to wind), and a floating HUD over the boat shows
  elapsed time, straight-line distance from the start and the
  compass heading captured at activation. SALIR restores the
  previous mode + target + engaged state. The BY STERN branch
  forces a stern-through swing by walking a chain of intermediate
  targets 60° apart so pypilot cannot shortcut through the bow.
- **Telemetry historian + Chart tab** (Rev93-96) — RAM ring buffer
  at 1 Hz for the last 30 min (backend, Pi 5 friendly). New Chart
  tab shows nine Trip Stats cards (AP engaged time, distance,
  energy, mean/RMS/p95 heading error, servo runtime, tacks/gybes,
  peak servo A) all fed live via SK paths, plus a canvas history
  with 30 s / 2 min / 10 min windows and per-path chips.
- **Sensor Quality panel** (Rev97-98) — age / observed Hz / jitter /
  source for every critical SK path the AP depends on, with a
  green / amber / red pill. Endpoint `/quality` and a poll while
  Setup is visible.
- **Servo Health card** (Rev99) — baseline current learned from
  the first ~10 min of engaged navigation, then a live deviation
  ratio flags "elevated" (>1.20×) or "high" (>1.65×) — early
  warning for a hard rudder, fouling, or a stiffened linkage. Six
  new SK paths under `steering.autopilot.pypilot.servo.health.*`.
- **Alarm engine** (Rev100-101) — seven built-in rules (heading
  deviation, unable to steer, servo overcurrent / temp, low
  voltage, sensor lost, pypilot disconnected) publishing
  canonical SK notifications `notifications.autopilot.*`. Sticky
  banner in the visor with ACK + close, WebAudio beeps +
  speech-synthesis of the message, and a full config panel in
  Setup (enable / mute / status per rule).
- **Pre-departure check** (Rev102) — a single verdict card
  (READY / READY-WITH-CAVEATS / DO-NOT-ENGAGE) that aggregates
  connectivity, sensor quality, servo health and voltage into one
  answer before you leave the dock.
- **Pypilot Doctor** (Rev103-104, Rev120-121) — press DIAGNOSE,
  the plugin records 2-3 min with the AP engaged, runs heuristic
  rules on the heading error stream (bias / oscillation / low
  authority) and proposes P / I / D adjustments with a plain
  explanation of why and what to expect. Nothing is applied
  automatically — each suggestion has Apply and Discard buttons.
  Rev120: the first Apply of a session forks the current pypilot
  profile into a new `doctor-YYYYMMDD-HHMM` profile so the
  previous gains stay one profile-select away.
- **Setup as a launcher grid** (Rev105-119, 124) — every setup
  block is now a square tile in a 2 / 3 / 4-column grid. Tap
  opens fullscreen with a small X to close and ESC support.
  Body scroll is locked while a tile is fullscreen. Live summary
  pill on every tile so the state reads at a glance without
  expanding. Connection consolidated (status + LAN scan + manual
  host + Autopilot Provider in one card). "Emergency" renamed to
  "Remote Control Console".
- **Interactive SSH console** (Rev113-115) — free-form command
  input with on-screen arrow buttons for mobile history
  navigation, accumulative output textarea, clipboard fallback
  for HTTP LAN, and 14 preset buttons with plain human labels
  (Memory / IP table / WiFi / Temperature / Who is connected /
  ...). BusyBox / piCore-safe fallbacks for every command.
- **Full RangeSetting sliders in Calibration** (Rev116-119) —
  every pypilot `RangeSetting` grouped by category (rudder /
  servo / imu / ap / other) with the same look as the Tune tab,
  a lock checkbox with the padlock emoji, a frozen "before:"
  baseline that never moves as you drag, and a per-slider ↺
  restore button that snaps back to the baseline.
- **Nudge steps moved inside Calibration** (Rev124) — one card
  less in the launcher grid; heading trim buttons live where
  they belong conceptually.

**Changed**

- **Gota Chain shapes SWAP** (Rev122-126) — after several iterations
  with Carlos on Tunatunes: the AMBER "A" arrow (apparent wind) is
  now the LARGE piece (its tip reaches deep into the rose), and
  the TEAL "T" arrow (true wind) is the SMALL outer one. Colors
  and letters kept their canonical meaning; only the SVG paths
  moved so the amber piece is visually the dominant one.
- **Alarm summary semantics** (Rev107-108) — "activa" (fired) was
  ambiguous with "activada" (enabled). New wording separates
  `firing / sonando` (fired now) from `watching / vigilando`
  (enabled and healthy). Summary always shows both counts.
- **i18n audit** (Rev105, Rev112, Rev121) — every hard-coded
  English string in the ES bundle purged ("engagear" → "activar",
  KIP paths table fully translated, alarm messages), backend
  suggestion reason / effect exposed as i18n keys + args so the
  frontend renders in the user's language.
- **Sensor Quality thresholds** (Rev98) — dropped `minHz` from the
  defaults; the 1 Hz sampler capped observed Hz, so the threshold
  produced spurious "degraded" flags. Freshness (`age`) is now
  the only signal that penalises status.

**Fixed**

- **Fullscreen tile portal** (Rev110-111) — Setup fullscreen tiles
  are now portaled to `<body>` so the `.tab-panel` transform
  (used by the tab animation) cannot break `position: fixed`.
  Fullscreen always covers the viewport now, no matter which
  card was scrolled into.
- **Copy button on HTTP** (Rev114) — `navigator.clipboard` is a
  secure-context API; on plain http://192.168.x.y it silently
  no-ops. Compat helper falls back to `document.execCommand("copy")`.
- **Doctor `elapsedSec`** (Rev104) — was counting past the target
  duration once the session completed. Now freezes at the target.
- **Sliders baseline eaten by refresh** (Rev117-118) — the
  Calibration "before:" value used to reset to the just-edited
  number on every `/values` poll. Now captured once per name and
  kept frozen across renders.
- **Aproado restore** (Rev90) — mode / target / engaged restore on
  SALIR was skipping steps after one failure. Now each step is
  guarded independently and logged in the console.
- **Sensor Quality parsing** (Rev94) — `navigation.attitude` is a
  composite `{pitch, roll, yaw}` object, not a scalar path.
  Custom subfield reader added for heel.
- Cosmetic Firefox warnings (`::-moz-focus-inner`, comment-nested
  `*/`) purged (Rev95-106).

### Español

**Nuevo**

- **Modo Aproado** (Rev87-92): pseudo-modo AP para subir velas.
  Elige POR PROA / POR POPA en un modal de 5 s, el plugin pasa
  pypilot a modo viento con objetivo 0° (proa al viento), y un
  HUD flotante sobre el barco muestra tiempo transcurrido,
  distancia lineal desde el arranque y el rumbo compás capturado
  al activar. SALIR restaura modo + objetivo + engaged previos.
  POR POPA fuerza el swing por popa con una cadena de objetivos
  intermedios cada 60° para que pypilot no atajaje por proa.
- **Historian de telemetría + pestaña Gráfica** (Rev93-96):
  buffer circular en RAM a 1 Hz durante 30 min (backend, Pi 5).
  Nueva pestaña Gráfica con 9 tarjetas de estadísticas de sesión
  (tiempo activo, distancia, energía, error medio / RMS / p95,
  servo activo, viradas / trasluchadas, pico servo A) y canvas
  con ventanas 30 s / 2 min / 10 min.
- **Panel Calidad de sensores** (Rev97-98): edad / Hz / jitter /
  fuente por cada ruta SK crítica con semáforo verde / ámbar /
  rojo.
- **Tarjeta Salud del servo** (Rev99): baseline aprendido de los
  primeros ~10 min de navegación activa, luego ratio de
  desviación marca "elevated" (>1.20×) o "high" (>1.65×) —
  alerta temprana de timón duro, incrustaciones o rozamientos.
- **Motor de alarmas** (Rev100-101): 7 reglas built-in
  (desviación de rumbo, incapaz de gobernar, sobrecorriente
  servo, temperatura servo, batería baja, sensor perdido,
  pypilot desconectado) publicando notifications SK canónicas.
  Banner sticky en el visor con ACK y cierre X, beeps WebAudio
  + speechSynthesis del mensaje, panel de configuración en
  Setup (enable / mute / estado por regla).
- **Comprobación del piloto** (Rev102): tarjeta única con
  veredicto (LISTO / LISTO CON RESERVAS / NO ACTIVAR) que
  agrega conectividad, calidad de sensores, salud del servo y
  voltaje.
- **Asesoramiento y diagnóstico** (Rev103-104, Rev120-121):
  botón DIAGNOSTICAR, el plugin graba 2-3 min con el AP activo,
  aplica reglas heurísticas (sesgo / oscilación / autoridad) y
  propone ajustes P / I / D con explicación clara del porqué y
  del efecto esperado. Nada se aplica automáticamente — cada
  sugerencia tiene botones Aplicar y Descartar. Rev120: el
  primer Aplicar de la sesión duplica el perfil actual en uno
  nuevo `doctor-AAAAMMDD-HHMM` para que el original quede
  intacto a un toque en Ajustes → Perfil.
- **Setup como launcher grid** (Rev105-119, 124): cada bloque
  de Setup es un tile cuadrado en un grid 2 / 3 / 4 columnas.
  Tap abre pantalla completa con X para cerrar, header sticky
  y bloqueo de scroll de fondo. Etiqueta resumen en vivo en
  cada tile. Conexión pypilot une 4 secciones. "Emergencia"
  renombrada a "Consola control remoto".
- **Consola SSH interactiva** (Rev113-115): input libre con
  botones ↑▲ ↓▼ para navegar el historial en móvil, textarea
  acumulativo, fallback de portapapeles para LAN HTTP y 14
  presets con etiquetas humanas (Memoria RAM / Tabla IP / WiFi
  / Temperatura / Quien está conectado / ...). Todos los
  comandos con fallbacks BusyBox / piCore.
- **Sliders completos de calibración** (Rev116-119): todos los
  `RangeSetting` de pypilot agrupados por categoría (timón /
  servo / imu / piloto / otros) con la misma apariencia que
  Ajustes, candado azul con emoji, valor "antes:" congelado
  que NUNCA se mueve al arrastrar, y un botón ↺ por slider
  para restaurar el valor original.
- **Botones corrección rumbo dentro de Calibración** (Rev124):
  una tarjeta menos en el grid; los pasos ±1 / ±10 quedan
  donde corresponde conceptualmente.

**Cambiado**

- **Swap de formas en la Gota Chain** (Rev122-126): tras varias
  iteraciones con Carlos en Tunatunes, la flecha AMARILLA "A"
  (viento aparente) es ahora la GRANDE (su punta llega hasta
  el centro de la rosa) y la flecha VERDE "T" (viento real)
  es la PEQUEÑA externa. Colores y letras mantienen su
  significado canónico; solo se movieron los paths SVG para
  que la amarilla domine visualmente.
- **Semántica de alarmas** (Rev107-108): "activa" era ambiguo.
  Nueva jerga separa `sonando` (disparada ahora) de `vigilando`
  (habilitada y OK). El resumen muestra siempre ambos contadores.
- **Auditoría i18n** (Rev105, Rev112, Rev121): purga de cadenas
  inglesas hardcoded en el bundle ES ("engagear" → "activar",
  tabla de KIP totalmente traducida, mensajes de alarma).
  Reason / effect de las sugerencias del Doctor expuestos como
  claves i18n para render en el idioma del visor.
- **Umbrales Calidad de sensores** (Rev98): quitado `minHz` de
  los defaults; el sampler a 1 Hz capaba la Hz observada y
  generaba "degraded" falsos.

**Corregido**

- **Portal de tile fullscreen** (Rev110-111): tiles fullscreen
  ahora se mueven al `<body>` para que el `transform` de
  `.tab-panel` (animación entre pestañas) no rompa `position:
  fixed`.
- **Botón Copiar en HTTP** (Rev114): `navigator.clipboard`
  requiere secure context. Fallback a `document.execCommand("copy")`.
- **Doctor `elapsedSec`** (Rev104): contaba pasado el objetivo.
  Ahora congela al final.
- **Baseline de sliders comido por refresh** (Rev117-118): el
  valor "antes" se reseteaba a lo recién editado en cada poll.
  Ahora se captura una vez y no se toca.
- **Restore de Aproado** (Rev90): SALIR saltaba pasos tras un
  fallo. Ahora cada paso protegido por su try/catch.
- **Parsing Calidad de sensores** (Rev94): `navigation.attitude`
  es objeto compuesto, no path escalar. Fix del subfield heel.
- Warnings cosméticos Firefox (`::-moz-focus-inner`, `*/` en
  comentarios) purgados (Rev95-106).

### Français

**Ajouté**

- **Mode Aproado** (Rev87-92) : pseudo-mode AP pour hisser les
  voiles. PAR AVANT / PAR ARRIÈRE, l'AP passe en mode vent avec
  cible 0° (nez au vent), HUD flottant avec temps, distance et
  cap boussole capturé. SORTIR restaure mode / cible / engagé
  précédents. PAR ARRIÈRE force le virage par l'arrière avec
  une chaîne d'objectifs intermédiaires de 60°.
- **Historian de télémétrie + onglet Graphique** (Rev93-96) :
  buffer 30 min en RAM à 1 Hz, canvas d'historique et 9 cartes
  Trip Stats.
- **Panneau Qualité des capteurs** (Rev97-98) : âge / Hz /
  jitter / source par chaque chemin SK critique.
- **Carte Santé du servo** (Rev99) : baseline appris + ratio de
  déviation avec alertes "elevated" et "high".
- **Moteur d'alarmes** (Rev100-101) : 7 règles built-in,
  notifications SK canoniques, banner avec ACK et fermeture,
  audio WebAudio + parole synthétique, config par règle.
- **Vérification pré-départ** (Rev102) : verdict READY / avec
  caveats / NE PAS ENGAGER.
- **Docteur pypilot** (Rev103-104, Rev120-121) : 2-3 min
  d'enregistrement, règles heuristiques, propositions P / I / D
  avec Appliquer et Rejeter. Le premier Appliquer crée un
  nouveau profil `doctor-AAAAMMJJ-HHMM`.
- **Setup en grille launcher** (Rev105-119, 124) : tiles carrés,
  fullscreen par tap, résumé en direct, connexion consolidée,
  "Consola contrôle remote" (renommé).
- **Console SSH interactive** (Rev113-115) : entrée libre,
  historique navigable au mobile, 14 presets aux noms humains,
  fallbacks BusyBox / piCore.
- **Sliders complets de calibration** (Rev116-119) : chaque
  RangeSetting groupé, cadenas, baseline gelée, bouton restaurer.
- **Boutons correction cap dans Calibration** (Rev124).

**Modifié**

- **Swap des formes Gota Chain** (Rev122-126) : la flèche AMBRE
  "A" (vent apparent) est maintenant la GRANDE, la TEAL "T"
  (vent réel) la petite. Couleurs et lettres conservent leur
  sens canonique.
- **Sémantique alarmes** (Rev107-108) : `sonando` vs
  `vigilando`, résumé affiche les deux compteurs.
- **Audit i18n** (Rev105, Rev112, Rev121) : purge de l'anglais
  dans les bundles ES / FR / DE.
- **Seuils Qualité capteurs** (Rev98) : `minHz` supprimé.

**Corrigé**

- Portal du tile fullscreen (Rev110-111).
- Bouton Copier en HTTP (Rev114).
- Doctor `elapsedSec` gelé au final (Rev104).
- Baseline des sliders congelée (Rev117-118).
- Restore Aproado protégé par try/catch (Rev90).
- Lecture composite de `navigation.attitude` (Rev94).
- Warnings cosmétiques Firefox purgés (Rev95-106).

### Deutsch

**Neu**

- **Aproado-Pseudomodus** (Rev87-92) — AP-Modus zum Segelhissen.
  ÜBER BUG / ÜBER HECK, AP schaltet in Wind-Modus mit Ziel 0°,
  HUD über dem Boot mit Zeit / Distanz / Kompass-Kurs. AUS
  stellt Modus / Ziel / Engaged wieder her. ÜBER HECK erzwingt
  den langen Schwenk mit Zwischen-Zielen alle 60°.
- **Telemetrie-Historian + Chart-Tab** (Rev93-96) — Ringpuffer
  30 min RAM bei 1 Hz, 9 Trip-Stats-Karten, Canvas mit Fenstern
  30 s / 2 min / 10 min.
- **Sensor-Qualität-Panel** (Rev97-98).
- **Servo-Health-Karte** (Rev99) — gelernter Baseline mit
  Alarmen "elevated" / "high".
- **Alarm-Engine** (Rev100-101) — 7 built-in Regeln, SK
  Notifications, Banner mit ACK und X, WebAudio + Sprache,
  Config-Panel.
- **Pre-Departure-Check** (Rev102).
- **Pypilot Doctor** (Rev103-104, Rev120-121) — Diagnose-
  Sitzung, Heuristik-Regeln, P/I/D-Vorschläge mit Anwenden /
  Verwerfen. Erstes Anwenden erzeugt neues Profil.
- **Setup als Launcher-Grid** (Rev105-119, 124) — quadratische
  Tiles, Vollbild-Tap, Live-Zusammenfassung.
- **Interaktive SSH-Konsole** (Rev113-115) — freie Eingabe,
  Pfeil-Buttons mobil, 14 Presets mit menschlichen Labels.
- **Vollständige RangeSetting-Slider in Kalibrierung**
  (Rev116-119) — Schloss, eingefrorene Baseline,
  Wiederherstellen-Knopf pro Slider.
- **Nudge-Buttons in Kalibrierung** (Rev124).

**Geändert**

- **Gota-Chain-Form-SWAP** (Rev122-126).
- **Alarm-Semantik** (Rev107-108) — `sonando` / `vigilando`.
- **i18n-Audit** (Rev105, Rev112, Rev121).
- **Sensor-Qualität-Schwellen** (Rev98) — `minHz` entfernt.

**Behoben**

- Fullscreen-Tile-Portal (Rev110-111).
- Copy-Button auf HTTP (Rev114).
- Doctor `elapsedSec` (Rev104).
- Slider-Baseline eingefroren (Rev117-118).
- Aproado-Restore geschützt (Rev90).
- `navigation.attitude`-Zusammensetzung (Rev94).
- Kosmetische Firefox-Warnungen (Rev95-106).

## 2.1.0 — 2026-08-25 — Rev68..Rev87

Twenty in-session Revs of iterative visual + reliability work rolled up
into a proper minor release. Themes: a full redesign of the compass-rose
autopilot overlays ("Gota Chain"), a hard-earned fix for AP mutations
racing each other across the SignalK bus, and a permanent seamless-auth
story so a Signal K restart never again silently disables the visor's
mutation buttons.

### Added

- **Gota Chain overlay** — the target diamond and the AWA/TWA wind
  arrows are now three concentric SVG pieces that interlock into one
  clean droplet when `target ≡ AWA ≡ TWA`. Each piece carries its own
  letter (A / T) and its own color ring-tick that marks the exact
  angle on the compass. When any of the three drifts, its V-hembra
  opens as a visible hollow. Iterated over 12 Revs (Rev68..Rev82)
  with Carlos on Tunatunes.
- **COG line** — chain of yellow chevrons from the bow toward the
  course-over-ground direction. Visible only when `SOG > 0.15 kn`.
- **Current vector** — two parallel wavy blue lines with three
  triangles pointing at the boat. Computed as `SOG − SOW` (added
  new `navigation.speedThroughWater` subscription). Visible when
  `|current| > 0.2 kn`.
- **4-card overlay selector** — long-press any rose corner OR the
  boat sprite to open the popup with the four toggle cards (AWA,
  TWA, COG, Current), each with a large preview and a data-
  requirement line ("Needs a wind sensor", "Only shows when SOG >
  0.15 kn", etc). Toggles persist in `localStorage`.
- **Rose cardinals colour-coded**: N orange, E green, S blue, W red.
  All at the same radius `r = 70`. Thin black stroke around each
  letter for legibility on any background.
- **Seamless auth via SK Access Request** — the visor now uses a
  device-scoped, permanent SK token instead of a short-lived JWT.
  On first install the user approves once from `SK admin → Security
  → Access Requests`; from then on the token survives every SK
  server restart, every plugin redeploy, and every browser reload,
  so mutations (engage / mode / target) NEVER silently 401 again.
- **`.\deploy.ps1 -FrontOnly`** — new script flag that syncs
  `public/` only (no build, no npm install, no `systemctl restart
  signalk`). Use it when the diff is HTML / CSS / JS only —
  `Ctrl+F5` in the browser picks it up. Avoids the plugin-socket
  reconnect to `pypilot_web` on the Pi Zero W that pushed the
  TinyPilot to hang after a big batch of deploys.

### Fixed

- **AP mutation race (`DIA jumps to a stale target for a beat`).**
  Frontend used to `Promise.all([engage, target])` and the backend's
  `pushAutopilotUpdate` published ALL SK autopilot fields on every
  notify — so whichever POST landed first emitted a delta that
  carried the OTHER field's STALE value (typically an old target
  from the previous session, e.g. `115°` when the intent was `75°`).
  Fixed by refactoring `AutopilotProvider.notifyChanged(fields)` to
  accept `"engaged" | "target" | "all"` and `pushAutopilotUpdate` to
  only emit the paths that actually changed. Parallel POSTs no
  longer clobber each other with stale copies.
- **Wind-mode target capture on engage.** `doEngage` always sent
  `state.heading` as the target regardless of mode; pypilot in wind
  mode interpreted that compass value as a wind angle and steered
  the boat toward nonsense. Now captures `state.windAngle` (apparent)
  or `state.windAngleTrue` (true wind) when the active mode contains
  "wind"; falls back to heading only for compass / gps / nav.
- **AP button "click missed" and engage / disengage bounce**
  hardened: switched from `click` to `pointerdown` (fires once per
  press on both touch and mouse without waiting for the
  browser-synthesised `click`), swallow the trailing `click` with
  `preventDefault + stopPropagation`, `touch-action: manipulation`
  on the button, plus an 800 ms cooldown gate that survives the
  ~200 ms POST round-trip. Ghost taps from `touchend` no longer
  produce a phantom second engage.
- **Wind speed chip tap regressions.** Chip was picked up by the
  corner-selector `forEach` (auto-attached its 500 ms long-press
  timer → opened the wrong popup) AND the `<main>` tab-swipe
  handler treated any tap-with-drift on it as a horizontal swipe
  → the chip appeared to slide right. Renamed the chip class to
  `.wind-chip` so the forEach ignores it and replaced the shared
  handler with a bespoke `pointerdown/up` short-tap detector that
  stops touch propagation.
- **HDG chip / compass labels covered by DIA** on engage: reordered
  the SVG stack so the compass card and HDG chip render AFTER the
  gota pieces, never behind them.
- **DIA arc rendering asymmetry** ("bump on one side") when
  rotated: `stroke-linejoin` switched from `round` to `miter`,
  raya `stroke-linecap` switched from `round` to `butt` to remove
  the semi-circle that overshot the ring line.

### Changed

- **Wind speed chip moved from an SVG group to a positioned HTML
  `.wind-chip` div** overlaid on the rose bottom-center. Text
  baseline now aligns with the two bottom corner cells so all
  three values (BL / BC / BR) read as one row.
- **SVG stacking order** finalised (bottom → top): ring · wind
  sectors · boat sprite · TWA · AWA · DIA · raya · AWA / TWA
  colour ring-ticks · COG line · current vector · compass card ·
  HDG chip. Wind chip is a separate HTML overlay above the SVG.
- **Restart engine** already switched to `sv restart` (piCore
  runit) in 2.0.4; the docs, i18n text and Info-tab quick-start
  now match — the earlier "three escalated restarts" wording was
  outdated (Emergency section has been 2 buttons since Rev66:
  `RESTART pypilot` + `reboot Pi`; the safe `restart pypilot_web`
  lives in the Debug console).
- **Info-tab quick-start** rewritten in EN + ES to describe the
  Gota Chain, the 4-card overlay selector, the new cardinal
  colors, and boat-long-press as an alternative selector opener.
- **README** overview and "Remote restart / reboot" section
  rewritten to match the current 2-button + Debug-console layout,
  and to describe the Gota Chain + optional overlays.

## 2.0.4 — 2026-08-21 — Rev67

Reintroduces (with proper QA) the UI polish + reliability work that was
withdrawn in 2.0.3 when 2.0.2 hit regressions. Every item below was
tested on Carlos's Tunatunes Pi Zero W setup before publish.

### Fixed

- **Restart engine now uses `sv` (runit), not `systemctl`.** piCore does
  not ship systemd; the previous `sudo systemctl restart pypilot pypilot_web`
  was silently falling through to `|| true` on every install. Only the
  `pkill -9` had any effect, and runit's `runsv` was auto-relaunching
  the killed processes into a slightly inconsistent state that
  accumulated zombies + I2C contention until the Pi Zero locked up.
  Fixed to `sudo sv restart /etc/sv/pypilot /etc/sv/pypilot_web /etc/sv/pypilot_hat`
  with a selective `pkill -9 -f 'python.*pypilot --version'` safety net.
- **`pypilot --version` preset in Debug console wrapped in `timeout 3`.**
  On piCore that command starts the full pypilot process and never
  exits cleanly; each click was leaving a zombie holding I2C and TCP
  resources. Falls back to reading the packaged version file.
- **Target diamond drifted after tapping AP on laggy links.** The
  optimistic-target assign now happens INSTANTLY on click (same tick),
  not after the parallel promise resolves - so the diamond snaps to
  the captured heading immediately, without a jump to the stale value
  then back. Nudge also updates `state.target` optimistically so the
  diamond moves in the same tick as the button press.
- **socket.io auto-reconnect no longer gives up.** `reconnectionAttempts`
  changed from 30 (which could exhaust on a long outage) to Infinity;
  backoff capped at 30 s. Restarts done via `/debug-cmd` (`restart.web`
  / `reboot.pi`) now schedule an explicit `pause+resume` after the
  operation.
- **Reconnection watchdog** (every 60 s, was 30 s): if the socket has
  been disconnected > 90 s, force a pause+resume once. Max 3 forced
  reconnects in a rolling 15-min window so a permanently-dead
  pypilot_web is not turned into a local DDoS. Watchdog interval
  loosened per Carlos: "con la Pi Zero debemos ser suuuuuper ratas".

### Changed - Emergency section simplified

The 3-level escalated restart triad shipped in 2.0.2 has been trimmed
to 2 levels in Setup -> Emergency: **RESTART pypilot** (level 2, ~10-15 s
outage) + **reboot Pi** (level 3, ~35-60 s). The old level 1
(`restart pypilot_web`) rarely helps in practice - when the Pi Zero is
saturated a full reboot is what actually helps - so it moved to the
Debug console below as an advanced preset for the ~5 % edge cases.

### Compass rose

- HDG in a small dark chip that straddles the top of the ring, narrowed
  from 48 to 40 units wide so the enlarged target diamond can peek out
  on all four sides even when target is dead ahead.
- Target diamond enlarged (28 wide, 30 tall) so its top point asoma
  above the HDG chip and its bottom point below it.
- Wind arrows both solid (no dashed shaft on TWA), amber AWA (big head)
  + sea-green (#5ce8c0) TWA (small head), each with its own rotating
  text label placed at very different radii so they never overlap even
  when both arrows point in the same direction.
- Wind speed at the bottom of the rose now inside a small dark chip
  (same look as the HDG chip on top). Short-tap on the chip OR on a
  corner mapped to "wind" flips AWS/TWS. Long-press opens the popup.
- Corner options `AWA` and `TWA` now show angle AND matching wind speed
  (AWA/AWS and TWA/TWS) as a combined 2-line cell, consistent with the
  `wind` combo.

### Rudder angle indicator in the swipe-hint bar

- Default range **±70°** (was ±45°), matching typical TinyPilot configs.
- Explicit numeric labels at both ends showing the actual range from
  the pypilot catalog.
- Intermediate tick marks every 10° plus numeric mid-labels at 20°, 40°
  and 60° each side, so the operator reads the rudder angle at a glance.

### Internal

- Debug console preset `pypilot.version` now `timeout 3 python3 -c
  'import pypilot; print(pypilot.__version__)'` with fallback.
- Merge-based `_pluginConfigMerge()` helper preserved.
- Per-cell state for the long-press / short-tap handler on the corner
  dashboard (Rev65's shared timer flags were race-flipping and killing
  the tap toggle intermittently).

## 2.0.3 — 2026-08-20 — Rev66 - rollback of 2.0.2

Codebase is functionally identical to 2.0.1. Version 2.0.2 introduced
regressions in the socket auto-reconnect and the new "escalated restart"
triad that could leave the plugin showing `connected: false` against a
pypilot_web that is in fact alive and serving other consumers. Rolling
back to the 2.0.1 behaviour and reintroducing the 2.0.2 UI polish
(target diamond snapshot, redesigned AWA/TWA arrows, HDG chip, wind
speed chip, tap wind toggle, rudder bar, debug console, escalated
restarts) in a later 2.0.4+ release, one item at a time with proper QA
before publish. 2.0.2 has been deprecated on npm.

## 2.0.1 — 2026-08-20 — Rev64

Patch release to validate the GitHub Actions publish pipeline with
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC-based, no NPM_TOKEN secret in the repo). No functional changes
versus 2.0.0. Look for the "verified provenance" badge on the npm page.

## 2.0.0 — 2026-08-20 — Rev63

**Breaking release addressing feedback from Sean D'Epagnier (pypilot author,
[#1](https://github.com/Aitonos/signalk-pypilot-newui/issues/1) and
[#2](https://github.com/Aitonos/signalk-pypilot-newui/issues/2)).**

### Breaking - path standardisation (issue #1)

Every pypilot key now maps 1:1 to `steering.autopilot.pypilot.<key>`
verbatim. The old `FIXED_MAPPINGS` table with hand-picked renames and
C -> K / deg -> rad conversions is gone. Signal K infers units cleanly
enough from the path type, consumers pick their display unit, and we
surface pypilot's own `meta.units` verbatim.

**If you have KIP widgets or WilhelmSK dashboards wired to 1.0.0 paths,
rewire them per the table below**:

| Old (1.0.0)                                                       | New (2.0.0)                                              |
|-------------------------------------------------------------------|----------------------------------------------------------|
| `steering.autopilot.pypilot.availableModes`                       | `steering.autopilot.pypilot.ap.modes`                    |
| `steering.autopilot.pypilot.pilot`                                | `steering.autopilot.pypilot.ap.pilot`                    |
| `steering.autopilot.pypilot.gains.<pilot>.<gain>`                 | `steering.autopilot.pypilot.ap.pilot.<pilot>.<gain>`     |
| `steering.autopilot.pypilot.servo.controllerTemperature` (K)      | `steering.autopilot.pypilot.servo.controller_temp` (C)   |
| `steering.autopilot.pypilot.servo.motorTemperature` (K)           | `steering.autopilot.pypilot.servo.motor_temp` (C)        |
| `steering.autopilot.pypilot.servo.ampHours`                       | `steering.autopilot.pypilot.servo.amp_hours`             |
| `steering.autopilot.pypilot.calibration.imuHeadingOffset` (rad)   | `steering.autopilot.pypilot.imu.heading_offset` (deg)    |
| `steering.autopilot.pypilot.calibration.rudderRange` (rad)        | `steering.autopilot.pypilot.rudder.range` (deg)          |
| `steering.autopilot.pypilot.calibration.rudderOffset`             | `steering.autopilot.pypilot.rudder.offset`               |
| `steering.autopilot.pypilot.calibration.rudderScale`              | `steering.autopilot.pypilot.rudder.scale`                |
| `steering.autopilot.pypilot.calibration.rudderNonlinearity`       | `steering.autopilot.pypilot.rudder.nonlinearity`         |
| `steering.autopilot.pypilot.calibration.state`                    | `steering.autopilot.pypilot.rudder.calibration_state`    |
| `steering.autopilot.pypilot.tack.state`                           | `steering.autopilot.pypilot.ap.tack.state`               |
| `steering.autopilot.pypilot.tack.direction`                       | `steering.autopilot.pypilot.ap.tack.direction`           |
| `steering.autopilot.pypilot.tack.timeout`                         | `steering.autopilot.pypilot.ap.tack.timeout`             |
| `steering.autopilot.pypilot.errors.imu`                           | `steering.autopilot.pypilot.imu.error`                   |
| `steering.autopilot.pypilot.warnings.imu`                         | `steering.autopilot.pypilot.imu.warning`                 |
| `steering.autopilot.pypilot.errors.controller`                    | `steering.autopilot.pypilot.servo.controller`            |

`steering.autopilot.pypilot.profile`, `.profiles`, `.availablePilots`,
`.version`, `.runtime`, `.servo.voltage`, `.servo.current`,
`.servo.engaged`, `.servo.flags`, `.servo.controller` are unchanged
(their pypilot keys already matched the SK-side name).

### Fixed (issue #2) - `pypilot_values` is not one-shot

Sean noted that `pypilot_values` can arrive multiple times, and on
subsequent deliveries it carries only the newly-appeared keys (typically
during boot while calibration is still loading). Our code assumed
one-shot AND replaced `this.catalog` wholesale on each delivery.

- Comment in `pypilot-client.ts` fixed.
- Catalog is now MERGED, not replaced.
- `catalog` event carries `{ isDelta, newKeys }` so downstream handlers
  can register put-handlers only for the new keys and avoid re-emitting
  meta for paths already published.

### Added - Debug console in Setup

New closed-whitelist SSH endpoint `POST /plugins/*/debug-cmd` accepting
one of the following presets (nothing arbitrary):

- `logs.pypilot` - last 200 lines of `journalctl -u pypilot`
- `logs.pypilot_web` - last 200 lines of the web unit
- `logs.follow` - last 30 s (polled every 3 s from the UI when
  "Follow logs" is on)
- `dmesg.tail` - last 100 lines of `dmesg`
- `top.snapshot` - one-shot `top -bn1`
- `uptime`, `df`, `pypilot.version`
- `restart.web` - restart only `pypilot_web` (level 1 of the triad)
- `reboot.pi` - full `sudo reboot` (level 3 of the triad)

UI in Setup: preset buttons, scrollable output textarea, follow-logs
toggle (3 s polling), copy-to-clipboard, share-to-anywhere (Web Share
API), clear.

### Changed - three escalated restart levels in Setup / Emergency

The old single "RESTART pypilot" button becomes a triad, colour-coded
from green (safest) to red (loudest):

- **1. restart pypilot_web** (~3-5 s) - AP keeps steering.
- **2. RESTART pypilot** (~10-15 s) - the previous behaviour: AP drops
  the heading briefly and re-engages after reconnect.
- **3. reboot Pi** (~35-60 s) - full Raspberry Pi reboot, no AP for
  almost a minute.

All three go through a shared **helm-manned confirmation modal** that
states the outage duration and scope in the current UI language and
asks the operator to confirm someone is at the helm before executing.
Cancel button, click outside and Escape all decline safely.

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
