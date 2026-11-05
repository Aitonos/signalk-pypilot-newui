# External review: AUTOWIND and manoeuvre fixes, Rev630-632 (before publishing 3.12.0)

Everything is in this one file: what went wrong at sea, what was changed,
the full diff against the published 3.11.1 and the current code around
it, with line numbers. Paste the whole file into the LLM. Ask for the
answer in Spanish if Carlos will read it directly.

---

## Task

You are a senior reviewer of safety-relevant marine software. The plugin
drives a **pypilot autopilot on a sailing boat**. Review the changes
below **before they are published**.

1. For each change, say whether it fixes what it claims, completely, and
   cite the lines.
2. List every regression or new bug the changes introduce: race
   conditions, lost cleanups, broken callers, wrong state left behind, a
   pilot command sent when it should not be, or a safety alarm left
   silent.
3. List what is still missing to close the original problems, in the
   changed code paths only.

For each finding give severity (high / medium / low), the exact lines, a
concrete scenario, and the smallest fix. Mark it **follows from the
code** or **hypothesis**. No style comments.

## System

- A Raspberry Pi 5 runs Signal K and this plugin.
- The autopilot is a TinyPilot (pypilot on a Pi Zero W), reached over
  TCP.
- pypilot modes: `compass`, `gps`, `wind` (AWA) and `true wind` (TWA).
- When `ap.mode` changes, pypilot recomputes `ap.heading_command`
  itself.
- The backend is `src/*.ts`. The browser UI is the "visor",
  `public/app.js`, run on phones and tablets.
- The visor runs two pseudo-modes:
  - **Aproado**: bow into the wind, in `wind` mode.
  - **Empopado**: stern to the wind, in `true wind` mode.
- While one runs, the visor tells the backend "manoeuvre running"
  (`POST /maneuver-state`, renewed every 20 s; the backend forgets it
  after 180 s). That flag:
  - blocks AUTOWIND;
  - silences the heading-deviation, cruise-drift and unable-to-steer
    alarms.
- **AUTOWIND** runs in the backend. It switches between `wind` and
  `true wind` by TWA:
  - threshold 120° with ±5° hysteresis;
  - 10 s sustain;
  - 30 s between switches;
  - TWS ≥ 3 kn;
  - never during a tack or manoeuvre.
  Each side has its own pypilot profile.

## What went wrong (sea trial 2026-11-05, version 3.11.1 / Rev629)

1. Closing the Empopado summary card by hand (`emExitHandler`, summary
   branch) cleared the state but never called `_setManeuverPseudo(false)`.
   The visor kept renewing "manoeuvre running" every 20 s for ~48 min.
   AUTOWIND never switched (a replay of the recorded data shows it should
   have switched to apparent at 17:52:02), and the three steering alarms
   were silent the whole time.
2. Other problems found by three reviews (two external), confirmed in the
   code:
   - selecting AUTOWIND returned before ending a running
     Aproado/Empopado;
   - `setMode` returned silently when refused during a virtual tack,
     and AUTOWIND took that for success and changed the profile;
   - an AUTOWIND apply waiting on pypilot could write its profile after
     AUTOWIND was turned off;
   - the Empopado teardown restored gains/profile without waiting and
     without checking ownership (it could overwrite the sailor's next
     profile);
   - the backend flag was one global boolean for all visors;
   - AUTOWIND decided on wind data of any age; two readings 60 s apart
     counted as "10 s sustained";
   - the sailor could not see that AUTOWIND was blocked, and failures
     were only debug-logged.

## What was changed

### Rev630: the manoeuvre lifecycle (visor + backend)

- Each Aproado/Empopado has an `id`. `_setManeuverPseudo(active, id)`
  renews only while that manoeuvre is in `transit`/`active`, and
  otherwise switches the flag off by itself. An "off" for another id is
  ignored.
- `empopadoFinish` switches the flag off at once, as `aproadoFinish`
  already did.
- New `empopadoClose()` is a close with no restore: flag, timers, HUD,
  state. Every way out uses it:
  - the summary timer;
  - the summary button;
  - the end of `empopadoTearDown`;
  - the mode selector.
  The summary timer no longer re-restores gains/profile 15 s later.
- `empopadoTearDown` restores gains/profile only while
  `state.profile` is still the profile the manoeuvre left.
- The mode selector ends a running or summary Aproado/Empopado **before**
  the AUTOWIND and NAV early returns.
- Backend: `ManeuverGate` (`src/maneuver-gate.ts`), one expiry per
  manoeuvre id. A visor without an id shares a "legacy" entry.

### Rev631: AUTOWIND orders

- `AutopilotProvider.setMode` **throws** when refused during a virtual
  tack.
- `_autowindApply` carries an operation number. Turning AUTOWIND off,
  or a newer apply, stops an apply still waiting on pypilot: no profile
  write and no "switched" afterwards. While a mode switch is in flight
  (`_autowindInFlight`), the 1 Hz tick does nothing.
- The decider's 30 s gap counts only successful switches
  (`noteSwitch`); a failure waits 10 s (`noteFailure`).
- A refused profile write is reported.
- State publishes `blockedReason` (`virtual-tack`, `pypilot-tack`,
  `manoeuvre`, `no-wind-data`, `wind-too-light`) and `lastError`. The
  visor mode button shows e.g. "AUTO · REAL (viento flojo)".
- "Sailor left for compass from outside → AUTOWIND off" is suspended
  only by a tack, no longer by the visor manoeuvre flag.

### Rev632: AUTOWIND data

- TWA/TWS older than 10 s do not count (`freshNumber`). The next
  source is tried; if none is fresh, the reason is `no-wind-data`.
- A gap of more than 3 s between decider inputs restarts the 10 s count.
- The mode button shows APROADO / EMPOPADO while one runs. Before, it
  showed pypilot's wind mode.

### Tests

474 tests pass (`npm test`, exit code 0). New tests:
- `ManeuverGate`;
- the visor's own flag functions, extracted from `app.js` and run with
  fake timers;
- decider failure/retry, gap and freshness;
- refusal during a virtual tack;
- a replay of the 2026-11-05 black box (switches at 17:52:02 with no
  manoeuvre, never with one).

### Harbour QA by Carlos (2026-11-05, on the boat's Pi, wind ~1 kn)

All correct:
- Empopado, then summary closed by hand;
- Empopado running, then AUTOWIND selected;
- Aproado, then compass;
- Empopado, then SALIR with the summary left to close itself;
- AUTOWIND blocked as "wind too light";
- compass from outside turns AUTOWIND off;
- the mode button names the manoeuvre.

Verified in the server journal and the visor trace: the flag goes on and
off with each manoeuvre and no renewal is left behind. Not yet tested
under sail.

## Known limits (already accepted, no need to report)

- If AUTOWIND is selected in the very moment an Empopado is torn down,
  the Empopado's gain/profile restore may still land before AUTOWIND's
  profile. The ownership check reads `state.profile`, which follows
  pypilot's echo.
- The backend's own re-anchor after compass ↔ wind changes still reads
  values the plugin does not subscribe to, so it never acts. Whether to
  remove it or fix it is a separate decision.
- The ±10 button crossing ±180° in wind modes and the minimum wind for
  wind modes are separate operational topics.

## Diff against the published 3.11.1 (src and public)

```diff
diff --git a/public/app.js b/public/app.js
index 26ae87d..3d1ee05 100644
--- a/public/app.js
+++ b/public/app.js
@@ -526,6 +526,11 @@
       "autowind.needsGps":    "needs GPS for true wind",
       "autowind.prof.apparent": "Apparent wind",
       "autowind.prof.true":   "True wind",
+      "autowind.blocked.virtual-tack": "tacking",
+      "autowind.blocked.pypilot-tack": "tacking",
+      "autowind.blocked.manoeuvre": "manoeuvre",
+      "autowind.blocked.no-wind-data": "no wind data",
+      "autowind.blocked.wind-too-light": "wind too light",
       "mode.label.nav":       "NAV (ROUTE)",
       "mode.label.aproado":   "HEAD TO WIND",
       "mode.label.empopado":    "DEAD DOWNWIND",
@@ -1666,6 +1671,11 @@
       "autowind.needsGps":    "necesita GPS para el viento real",
       "autowind.prof.apparent": "Viento aparente",
       "autowind.prof.true":   "Viento real",
+      "autowind.blocked.virtual-tack": "virando",
+      "autowind.blocked.pypilot-tack": "virando",
+      "autowind.blocked.manoeuvre": "maniobra",
+      "autowind.blocked.no-wind-data": "sin datos de viento",
+      "autowind.blocked.wind-too-light": "viento flojo",
       "mode.label.nav":       "NAV (RUTA)",
       "mode.label.aproado":   "APROADO",
       "mode.label.empopado":    "EMPOPADO",
@@ -2889,6 +2899,11 @@
       "autowind.needsGps": "braucht GPS für wahren Wind",
       "autowind.prof.apparent": "Scheinbarer Wind",
       "autowind.prof.true": "Wahrer Wind",
+      "autowind.blocked.virtual-tack": "Wende",
+      "autowind.blocked.pypilot-tack": "Wende",
+      "autowind.blocked.manoeuvre": "Manöver",
+      "autowind.blocked.no-wind-data": "keine Winddaten",
+      "autowind.blocked.wind-too-light": "Wind zu schwach",
       "mode.label.empopado": "PLATT VOR DEM WIND",
       "net.warn": "Netz unterbrochen",
       "net.ok": "Netz OK",
@@ -4004,6 +4019,11 @@
       "autowind.needsGps": "nécessite le GPS pour le vent réel",
       "autowind.prof.apparent": "Vent apparent",
       "autowind.prof.true": "Vent réel",
+      "autowind.blocked.virtual-tack": "virement",
+      "autowind.blocked.pypilot-tack": "virement",
+      "autowind.blocked.manoeuvre": "manœuvre",
+      "autowind.blocked.no-wind-data": "pas de données de vent",
+      "autowind.blocked.wind-too-light": "vent trop faible",
       "mode.label.empopado": "PLEIN VENT ARRIÈRE",
       "net.warn": "Réseau intermittent",
       "net.ok": "Réseau OK",
@@ -11359,6 +11379,7 @@
   function _renderModeSelectBtn() {
     const btn = document.getElementById("mode-select-btn");
     if (!btn) return;
+    btn.title = "";
     // Rev510 (Carlos sea trial 2026-10-18, 18:07-18:12: "la tablet decia
     // un modo y el telefono decia otro"): during a virtual tack pypilot is
     // in compass on purpose. Every visor shows the wind mode of the tack,
@@ -11370,10 +11391,23 @@
       if (btn.textContent !== txt) btn.textContent = txt;
       return;
     }
+    // Rev632 (Carlos QA 2026-11-05: "Empopado dice REAL"): a running
+    // Aproado / Empopado shows its own name, not pypilot's wind mode.
+    for (const [man, label] of [[state.empopado, "empopado"], [state.aproado, "aproado"]]) {
+      if (man && (man.phase === "transit" || man.phase === "active")) {
+        btn.textContent = _modeLabel(label);
+        return;
+      }
+    }
     const m = state.mode || "";
     // Rev518: AUTOWIND -> "AUTO · REAL" / "AUTO · APARENTE".
     if (state.autowind && state.autowind.enabled && (m === "wind" || m === "true wind")) {
-      btn.textContent = `${t("autowind.short")} · ${_modeLabel(m)}`;
+      // Rev630 (sea trial 2026-11-05: "AUTO · REAL" was on screen while the
+      // backend could not switch): say why it is waiting, if it is.
+      const why = state.autowind.blockedReason;
+      const whyKey = `autowind.blocked.${why}`;
+      btn.textContent = `${t("autowind.short")} · ${_modeLabel(m)}${why ? ` (${t(whyKey)})` : ""}`;
+      btn.title = state.autowind.lastError || "";
       return;
     }
     // Rev545: NAV -> "NAV · <waypoint> · 2.3 nm".
@@ -12190,18 +12224,41 @@
   // Rev311 no las cazaba.
   // Rev534: the backend forgets the flag after 60 s unless renewed, so a
   // closed browser cannot leave the alarms silenced. Renew every 20 s.
+  // Rev630 (sea trial 2026-11-05): the flag belongs to one manoeuvre (its
+  // id) and each renewal first checks that this manoeuvre is still in
+  // transit / active. Closing the Empopado summary by hand used to leave
+  // the renewal running for the rest of the session: AUTOWIND blocked and
+  // the three steering alarms silenced for ~48 min.
   let _maneuverPseudoTimer = null;
-  function _setManeuverPseudo(active) {
+  let _maneuverPseudoId = null;
+  function _pseudoManeuverRunning(id) {
+    for (const m of [state.aproado, state.empopado]) {
+      if (m && m.id === id && (m.phase === "transit" || m.phase === "active")) return true;
+    }
+    return false;
+  }
+  function _setManeuverPseudo(active, id) {
+    if (!active && id && _maneuverPseudoId && id !== _maneuverPseudoId) return;   // not ours
     try { if (_maneuverPseudoTimer) { clearInterval(_maneuverPseudoTimer); _maneuverPseudoTimer = null; } } catch { /* silent */ }
-    if (active) _maneuverPseudoTimer = setInterval(() => _postManeuverPseudo(true), 20000);
-    _postManeuverPseudo(active);
+    if (active) {
+      _maneuverPseudoId = id;
+      _maneuverPseudoTimer = setInterval(() => {
+        if (_pseudoManeuverRunning(id)) _postManeuverPseudo(true, id);
+        else _setManeuverPseudo(false, id);
+      }, 20000);
+      _postManeuverPseudo(true, id);
+    } else {
+      const was = _maneuverPseudoId;
+      _maneuverPseudoId = null;
+      if (was) _postManeuverPseudo(false, was);
+    }
   }
-  function _postManeuverPseudo(active) {
+  function _postManeuverPseudo(active, id) {
     try {
       skFetch(`/plugins/${PLUGIN_ID}/maneuver-state`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
-        body: JSON.stringify({ active: !!active }),
+        body: JSON.stringify({ active: !!active, id }),
       }).catch(() => { /* silent - alarm gate is best-effort */ });
     } catch { /* silent */ }
   }
@@ -12446,6 +12503,7 @@
       ts: Date.now(),
     };
     state.aproado = {
+      id: `apr-${Date.now()}`,
       phase: "choosing",
       direction: null,
       snapshot,
@@ -12514,7 +12572,7 @@
     // Rev323 (Carlos, 2026-09-27): flag pseudo-modo activo para
     // silenciar heading-deviation / cruise-drift / unable-to-steer
     // durante la maniobra.
-    _setManeuverPseudo(true);
+    _setManeuverPseudo(true, apr.id);
     // Rev90: transit is a NEW phase between countdown and active. The
     // boat starts rotating toward head-to-wind; only when |AWA| falls
     // below APROADO_ACHIEVED_DEG do we consider it "aproada" and start
@@ -12716,12 +12774,13 @@
     _mtLog("aproado_teardown", { phase: apr.phase, direction: apr.direction });
     // Rev323: cerrar el gate pseudo-modo antes de nada; el backend
     // vuelve a evaluar heading-deviation con el umbral normal.
-    _setManeuverPseudo(false);
+    _setManeuverPseudo(false, apr.id);
     if (apr._cdTimer) { clearInterval(apr._cdTimer); apr._cdTimer = null; }
     if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
     if (apr._summaryTimer) { clearTimeout(apr._summaryTimer); apr._summaryTimer = null; }
     hideAproadoHud();
     state.aproado = null;
+    try { _renderModeSelectBtn(); } catch { /* silent */ }
   }
 
   // Rev313 (Carlos sea trial 2026-09-25): pseudo-mode EMPOPADO — mirror
@@ -12899,6 +12958,7 @@
       ts: Date.now(),
     };
     state.empopado = {
+      id: `emp-${Date.now()}`,
       phase: "choosing",
       direction: null,
       snapshot,
@@ -12938,7 +12998,7 @@
     if (!ap) return;
     // Rev323 (Carlos, 2026-09-27): silenciar heading-deviation /
     // cruise-drift / unable-to-steer durante la maniobra.
-    _setManeuverPseudo(true);
+    _setManeuverPseudo(true, ap.id);
     ap.phase = "transit";
     ap.executeTs = Date.now();
     ap.startTs = null;
@@ -13138,6 +13198,10 @@
     }
     if (ap.startTs == null) ap.startTs = ap.endTs;
     ap.phase = silent ? "summary" : "summary";
+    // Rev630 (sea trial 2026-11-05): the manoeuvre is over - stop the
+    // "manoeuvre active" flag now, as aproadoFinish does. It used to wait
+    // for the summary timer, which closing the summary by hand cancelled.
+    _setManeuverPseudo(false, ap.id);
     const hud = _empopadoHud();
     if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
     _empopadoSetPhase("summary");
@@ -13189,17 +13253,14 @@
       }
     }
     // Auto-hide del summary igual que aproado (usa APROADO_SUMMARY_MS).
-    ap._summaryTimer = setTimeout(() => { empopadoTearDown(); }, APROADO_SUMMARY_MS);
+    // Rev630: close only - gains and profile were restored above; a second
+    // restore 15 s later overwrote what the sailor had chosen meanwhile.
+    ap._summaryTimer = setTimeout(() => { if (state.empopado === ap) empopadoClose(); }, APROADO_SUMMARY_MS);
   }
   function empopadoTearDown(opts) {
     const ap = state.empopado;
     if (!ap) return;
     _mtLog("empopado_teardown", { phase: ap.phase, direction: ap.direction, restoreAll: !!(opts && opts.restoreAll) });
-    // Rev323: cerrar el gate pseudo-modo — el heading-deviation
-    // vuelve al umbral normal.
-    _setManeuverPseudo(false);
-    if (ap._hudTimer)     { clearInterval(ap._hudTimer);   ap._hudTimer = null; }
-    if (ap._summaryTimer) { clearTimeout(ap._summaryTimer); ap._summaryTimer = null; }
     // Rev316: restore adicional si tearDown fue directo (sin pasar por
     // finish, ej. mode-select change durante active).
     const restoreAll = opts && opts.restoreAll === true;
@@ -13208,19 +13269,40 @@
     // empopadoFinish; ver comentario allí para el racional).
     // Rev539 (GPT review 5 #9): wait for the gain restore before switching
     // profile, or the last gains land on the original profile.
+    // Rev630 (GPT audit 2026-11-05 F04): this runs after the sailor's next
+    // choice may have landed (AUTOWIND writes its own profile). Restore
+    // only while the profile is still the one the manoeuvre left.
     const swapped = ap._profileSwapped;
-    _empopadoRestoreHotGains(ap).catch(() => {}).then(() => {
-      if (swapped && snap.profile && snap.profile !== swapped) {
-        try { pluginRaw("profile", snap.profile).catch(() => {}); } catch { /* silent */ }
-      }
-    });
+    const left = swapped || snap.profile;
+    if (state.profile === left) {
+      _empopadoRestoreHotGains(ap).catch(() => {}).then(() => {
+        if (swapped && snap.profile && snap.profile !== swapped && state.profile === swapped) {
+          try { pluginRaw("profile", snap.profile).catch(() => {}); } catch { /* silent */ }
+        }
+      });
+    } else {
+      console.info(`empopado: profile is now "${state.profile}", not "${left}": gains/profile not restored`);
+    }
     if (restoreAll) {
       if (snap.mode) { try { apSetMode(snap.mode).catch(() => {}); } catch {} }
       if (typeof snap.targetRad === "number") { try { apSetTargetRad(snap.targetRad).catch(() => {}); } catch {} }
       if (snap.engaged === false && state.engaged) { try { apDisengage().catch(() => {}); } catch {} }
     }
+    empopadoClose();
+  }
+  // Rev630 (sea trial 2026-11-05): ends the manoeuvre without touching
+  // gains, profile or mode - the "manoeuvre active" flag, timers, HUD and
+  // state. Every way out goes through here: the end of the summary, the
+  // summary closed by hand, another mode chosen, the teardown above.
+  function empopadoClose() {
+    const ap = state.empopado;
+    if (!ap) return;
+    _setManeuverPseudo(false, ap.id);
+    if (ap._hudTimer)     { clearInterval(ap._hudTimer);   ap._hudTimer = null; }
+    if (ap._summaryTimer) { clearTimeout(ap._summaryTimer); ap._summaryTimer = null; }
     hideEmpopadoHud();
     state.empopado = null;
+    try { _renderModeSelectBtn(); } catch { /* silent */ }
   }
 
   // SALIR from the transit or active HUD: freeze counters, show the
@@ -13245,7 +13327,7 @@
     apr.phase = "summary";
     // Rev539 (GPT review 5 #1): the manoeuvre is over - stop renewing the
     // "manoeuvre active" flag that silences the heading alarms.
-    _setManeuverPseudo(false);
+    _setManeuverPseudo(false, apr.id);
     const hud = _aproadoHud();
     if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
     _setPhase("summary");
@@ -13852,6 +13934,20 @@
     $("#mode-select").addEventListener("change", (e) => {
       _msCollapse();
       const chosen = e.target.value;
+      // Picking another mode while a pseudo-mode is active ends the
+      // maneuver WITHOUT restoring the pre-* mode (usuario ya
+      // eligió qué quiere ahora). SÍ restaura el profile (Empopado).
+      // Use the SALIR button on the HUD to return to the previous mode.
+      // Rev630 (sea trial 2026-11-05): done first, so AUTOWIND and NAV
+      // (which return early below) end it too, and a manoeuvre still
+      // showing its summary is closed as well.
+      if (chosen !== "aproado" && chosen !== "empopado") {
+        const emp = state.empopado;
+        if (emp && (emp.phase === "transit" || emp.phase === "active")) empopadoTearDown({ restoreAll: false });
+        else if (emp && emp.phase === "summary") empopadoClose();
+        const apr = state.aproado;
+        if (apr && (apr.phase === "transit" || apr.phase === "active" || apr.phase === "summary")) aproadoTearDown();
+      }
       // Rev518: pseudo-mode AUTOWIND lives in the backend.
       if (chosen === "autowind") {
         _autowindPost({ enabled: true });
@@ -13884,18 +13980,6 @@
         empopadoStart();
         return;
       }
-      // Picking another mode while a pseudo-mode is active ends the
-      // maneuver WITHOUT restoring the pre-* mode (usuario ya
-      // eligió qué quiere ahora). SÍ restaura el profile.
-      if (state.empopado && (state.empopado.phase === "transit" || state.empopado.phase === "active")) {
-        empopadoTearDown({ restoreAll: false });
-      }
-      // Picking another mode while aproado is active ends the maneuver
-      // WITHOUT restoring the pre-aproado mode - honor the user's new
-      // choice. (Use the SALIR button on the HUD to return to previous.)
-      if (state.aproado && (state.aproado.phase === "transit" || state.aproado.phase === "active")) {
-        aproadoTearDown();
-      }
       // Rev170/171 (Carlos): fix target reference when switching
       // between compass-family and wind-family modes without the
       // brief "wrong then right" flash. Pypilot interprets
@@ -13992,9 +14076,8 @@
         const apr = state.aproado;
         if (!apr) return;
         if (apr.phase === "summary") {
-          if (apr._summaryTimer) { clearTimeout(apr._summaryTimer); apr._summaryTimer = null; }
-          hideAproadoHud();
-          state.aproado = null;
+          // Rev630: same close as every other way out (flag, timers, HUD).
+          aproadoTearDown();
         } else if (apr.phase === "active" || apr.phase === "transit") {
           aproadoFinish();
         }
@@ -14019,9 +14102,9 @@
         const emp = state.empopado;
         if (!emp) return;
         if (emp.phase === "summary") {
-          if (emp._summaryTimer) { clearTimeout(emp._summaryTimer); emp._summaryTimer = null; }
-          hideEmpopadoHud();
-          state.empopado = null;
+          // Rev630 (sea trial 2026-11-05): this branch cleared the state but
+          // left the "manoeuvre active" renewal running.
+          empopadoClose();
         } else if (emp.phase === "active" || emp.phase === "transit") {
           empopadoFinish();
         }
diff --git a/public/index.html b/public/index.html
index 488f37e..497a32c 100644
--- a/public/index.html
+++ b/public/index.html
@@ -27,7 +27,7 @@
        style.css never shows the rose unstyled on a white page. The rose
        is hidden until style.css (loaded below) makes it visible again. -->
   <style>html,body{background:#0a1220;color:#e6edf3}#wind-rose{visibility:hidden}</style>
-  <link rel="stylesheet" href="style.css?v=Rev629" />
+  <link rel="stylesheet" href="style.css?v=Rev632" />
 </head>
 <body class="theme-dark">
   <!-- Rev490 (GPU audit 2026-10-15): flag the Raspberry Pi's own screen
@@ -2813,6 +2813,6 @@
     </div>
   </div>
 
-  <script src="app.js?v=Rev629"></script>
+  <script src="app.js?v=Rev632"></script>
 </body>
 </html>
diff --git a/src/autopilot-provider.ts b/src/autopilot-provider.ts
index b35fe68..2ca93f5 100644
--- a/src/autopilot-provider.ts
+++ b/src/autopilot-provider.ts
@@ -624,7 +624,10 @@ export class AutopilotProvider {
       if (active) {
         // eslint-disable-next-line no-console
         console.log(`[virtual-tack] rejected external setMode '${mode}' (FSM is driving)`);
-        return;
+        // Rev630 (GPT audit 2026-11-05 F02): a refusal, not a silent return -
+        // AUTOWIND took the return for success and changed the profile.
+        // Same wording as setTarget's refusal.
+        throw new Error("mode change refused: virtual tack is driving the pilot");
       }
     }
     if (
diff --git a/src/autowind.ts b/src/autowind.ts
index 862c264..22319e3 100644
--- a/src/autowind.ts
+++ b/src/autowind.ts
@@ -13,6 +13,27 @@ export const AUTOWIND_DEFAULT_THRESHOLD_DEG = 120;
 export const AUTOWIND_HYSTERESIS_DEG = 5;      // +-5 around the threshold
 export const AUTOWIND_SUSTAIN_MS = 10_000;     // condition held this long
 export const AUTOWIND_MIN_GAP_MS = 30_000;     // between two switches
+// Rev630 (GPT audit 2026-11-05 F07): after a switch that failed, wait this
+// long before asking again (the 30 s gap counts only real switches).
+export const AUTOWIND_RETRY_MS = 10_000;
+// Rev632 (AUTOWIND audit 2026-11-05, GPT F06): wind data older than this
+// counts as missing (on Tunatunes derived-data and the vane update every
+// 1-4 s). And a gap longer than AUTOWIND_MAX_TICK_GAP_MS between two
+// inputs restarts the 10 s count: two readings 60 s apart are not "10 s
+// sustained".
+export const AUTOWIND_MAX_DATA_AGE_MS = 10_000;
+export const AUTOWIND_MAX_TICK_GAP_MS = 3_000;
+
+/** The number in a Signal K node ({value, timestamp}) if it is younger
+ *  than maxAgeMs, else null. No timestamp = not fresh; a timestamp in
+ *  the future by more than maxAgeMs (clock step) = not fresh either. */
+export function freshNumber(node: unknown, nowMs: number, maxAgeMs = AUTOWIND_MAX_DATA_AGE_MS): number | null {
+  if (!node || typeof node !== "object") return null;
+  const v = (node as any).value;
+  const ts = Date.parse(String((node as any).timestamp));
+  if (typeof v !== "number" || !isFinite(v) || !isFinite(ts)) return null;
+  return Math.abs(nowMs - ts) <= maxAgeMs ? v : null;
+}
 // Rev521 (Carlos 2026-10-20, in port with the AP off: "no cambió de
 // modo"): it now also switches with the AP disengaged, so engaging lands
 // in the right mode, but only with a meaningful wind - below 3 kn TWS the
@@ -48,9 +69,16 @@ export class AutowindDecider {
   private pending: WindSubMode | null = null;
   private pendingSince: number | null = null;
   private lastSwitchMs: number | null = null;
+  private lastFailMs: number | null = null;
+  private lastTickMs: number | null = null;
 
-  /** Returns the mode to switch to now, or null. */
+  /** Returns the mode to switch to now, or null. The caller reports the
+   *  outcome with noteSwitch() or noteFailure(). */
   tick(i: AutowindInput): WindSubMode | null {
+    // Rev632: a hole in the inputs (plugin busy, clock step) restarts the count.
+    const gap = this.lastTickMs == null ? 0 : i.nowMs - this.lastTickMs;
+    this.lastTickMs = i.nowMs;
+    if (gap < 0 || gap > AUTOWIND_MAX_TICK_GAP_MS) { this.pending = null; this.pendingSince = null; }
     const cur = String(i.mode || "").toLowerCase();
     const curSub: WindSubMode | null = cur === "true wind" ? "true wind" : cur === "wind" ? "wind" : null;
     const windOk = typeof i.twsKn === "number" && isFinite(i.twsKn) && i.twsKn >= AUTOWIND_MIN_TWS_KN;
@@ -69,8 +97,8 @@ export class AutowindDecider {
     }
     if (this.pendingSince != null && i.nowMs - this.pendingSince < AUTOWIND_SUSTAIN_MS) return null;
     if (this.lastSwitchMs != null && i.nowMs - this.lastSwitchMs < AUTOWIND_MIN_GAP_MS) return null;
+    if (this.lastFailMs != null && i.nowMs - this.lastFailMs < AUTOWIND_RETRY_MS) return null;
     this.pending = null; this.pendingSince = null;
-    this.lastSwitchMs = i.nowMs;
     return want;
   }
 
@@ -82,5 +110,7 @@ export class AutowindDecider {
     return a >= (thresholdDeg ?? AUTOWIND_DEFAULT_THRESHOLD_DEG) ? "true wind" : "wind";
   }
 
-  noteSwitch(nowMs: number): void { this.lastSwitchMs = nowMs; }
+  noteSwitch(nowMs: number): void { this.lastSwitchMs = nowMs; this.lastFailMs = null; }
+
+  noteFailure(nowMs: number): void { this.lastFailMs = nowMs; }
 }
diff --git a/src/index.ts b/src/index.ts
index b3cf674..f231328 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -72,7 +72,8 @@ import {
 } from "./nav-bearing";
 import { SessionRecorder, SessionSample, SessionTags } from "./session-recorder";
 import { SteerWatch } from "./steer-watch";
-import { AutowindDecider, WindSubMode, AUTOWIND_DEFAULT_THRESHOLD_DEG } from "./autowind";
+import { AutowindDecider, WindSubMode, AUTOWIND_DEFAULT_THRESHOLD_DEG, AUTOWIND_MIN_TWS_KN, freshNumber } from "./autowind";
+import { ManeuverGate } from "./maneuver-gate";
 import { TripRecorder, TripSample } from "./trip-recorder";
 import {
   ManeuverTraceLog,
@@ -82,7 +83,7 @@ import {
 
 // Rev counter bumped on every build so the user can distinguish deploys
 // from the webapp header (feedback_revision_bump_each_build).
-const PLUGIN_REVISION = "Rev629";
+const PLUGIN_REVISION = "Rev632";
 
 // Rev59: read package.json once at load time so /status can report the
 // npm package version alongside the internal Rev counter.
@@ -434,6 +435,11 @@ module.exports = function (app: any) {
   let _autowindLastSwitchTs: number | null = null;
   let _autowindLastReason: string | null = null;
   let _autowindOffFamilySince: number | null = null;
+  // Rev630 (AUTOWIND audit 2026-11-05).
+  let _autowindOp = 0;                              // bumped by every apply and by "off"
+  let _autowindInFlight = 0;                        // mode switches waiting on pypilot
+  let _autowindBlockedReason: string | null = null;
+  let _autowindLastError: string | null = null;
   // Rev176 (Carlos): debounce the raw `engaged` flag so a rebound
   // caused by a competing client (pypilot_web on another device, a KIP
   // widget cycling, socket races) does not open+close a JSONL every 5 s.
@@ -598,15 +604,14 @@ module.exports = function (app: any) {
   // to-steer durante la maniobra, INDEPENDIENTE de `ap.tack.state` â€”
   // en modo wind pypilot NO obedece y ap.tack.state se queda en "none"
   // aunque el visor estÃ© pilotando la maniobra por otras vÃ­as.
-  let _maneuverPseudoActive = false;
   // Rev534 (GPT review 2 #1): the visor renews it every 20 s; a closed or
   // disconnected browser must not silence the heading alarms (and block
   // AUTO WIND) for ever.
   // Self-audit Rev540: 180 s - with the screen off Chrome runs the 20 s
   // renewal only about once a minute, and 60 s let it lapse mid-manoeuvre.
-  const MANEUVER_PSEUDO_TTL_MS = 180_000;
-  let _maneuverPseudoUntil = 0;
-  const _pseudoActive = (): boolean => _maneuverPseudoActive && Date.now() < _maneuverPseudoUntil;
+  // Rev630: one entry per manoeuvre id, see src/maneuver-gate.ts.
+  const maneuverGate = new ManeuverGate();
+  const _pseudoActive = (): boolean => maneuverGate.active(Date.now());
   let lastNavState: string | null = null;
   let sessionSampleTimer: NodeJS.Timeout | null = null;
   let lastEngagedState = false;
@@ -3448,10 +3453,7 @@ module.exports = function (app: any) {
       });
       router.post("/maneuver-state", (req: any, res: any) => {
         const body = req.body || {};
-        if (typeof body.active === "boolean") {
-          _maneuverPseudoActive = body.active;
-          _maneuverPseudoUntil = body.active ? Date.now() + MANEUVER_PSEUDO_TTL_MS : 0;
-        }
+        maneuverGate.update(body.active, body.id, Date.now());
         res.json({ ok: true, pseudoActive: _pseudoActive() });
       });
       const validKinds: ManeuverEventKind[] = [
@@ -4991,6 +4993,11 @@ module.exports = function (app: any) {
       thresholdDeg: props.autowindThresholdDeg ?? AUTOWIND_DEFAULT_THRESHOLD_DEG,
       lastSwitchTs: _autowindLastSwitchTs,
       lastReason: _autowindLastReason,
+      // Rev630 (sea trial 2026-11-05): why AUTOWIND cannot switch right now
+      // ("virtual-tack" | "pypilot-tack" | "manoeuvre" | "no-wind-data" |
+      // "wind-too-light" | null), and the last switch that failed.
+      blockedReason: props.autowindEnabled ? _autowindBlockedReason : null,
+      lastError: _autowindLastError,
     };
   }
   function _autowindPublish(): void {
@@ -5010,23 +5017,50 @@ module.exports = function (app: any) {
     const want = _autowindProfileFor(sub);
     if (!want || !client || !client.connected) return;
     if (client.getValues()["profile"] === want) return;
+    let sent = false;
     try {
       profileChangeLog.markPlannedWrite(want, "autowind", reason);
-      client.set("profile", want);
+      sent = client.set("profile", want) !== false;
     } catch { /* silent */ }
+    // Rev630 (GPT audit 2026-11-05 F03): a refused write is a failure.
+    if (!sent) _autowindFail(`profile ${want} not sent to pypilot`);
+  }
+  function _autowindFail(msg: string): void {
+    _autowindLastError = msg;
+    // eslint-disable-next-line no-console
+    console.log(`[autowind] failed: ${msg}`);
+    _autowindPublish();
   }
-  async function _autowindApply(sub: WindSubMode, reason: string): Promise<void> {
+  // Rev630 (GPT audit 2026-11-05 F02/F03): `fromTick` = an automatic switch
+  // (its outcome feeds the decider's gap / retry). An operation number:
+  // turning AUTOWIND off, or a newer apply, makes an apply still waiting on
+  // pypilot stop there - no profile, no "switched" afterwards.
+  async function _autowindApply(sub: WindSubMode, reason: string, fromTick = false): Promise<void> {
     if (!apProvider) return;
+    const op = ++_autowindOp;
     _autowindLastReason = reason;
     const cur = String(apProvider.data.mode || "").toLowerCase();
     if (cur !== sub) {
       // wind <-> true wind share the angle space: pypilot keeps the
       // heading itself on the mode change, nothing else is written.
+      _autowindInFlight++;
       try { await (apProvider.toProviderInterface() as any).setMode(sub, apProvider.deviceId); }
-      catch (e: any) { app.debug?.(`[autowind] setMode ${sub}: ${e?.message || e}`); return; }
+      catch (e: any) {
+        _autowindInFlight--;
+        if (fromTick) autowind.noteFailure(Date.now());
+        _autowindFail(`mode ${sub}: ${e?.message || e}`);
+        return;
+      }
+      _autowindInFlight--;
+      if (op !== _autowindOp || !props.autowindEnabled) {
+        // eslint-disable-next-line no-console
+        console.log(`[autowind] ${sub} landed after AUTOWIND was turned off or overridden: profile left as is`);
+        return;
+      }
       _autowindLastSwitchTs = Date.now();
       autowind.noteSwitch(_autowindLastSwitchTs);
     }
+    _autowindLastError = null;
     _autowindApplyProfile(sub, reason);
     // eslint-disable-next-line no-console
     console.log(`[autowind] ${reason} -> ${sub}${_autowindProfileFor(sub) ? ` / profile ${_autowindProfileFor(sub)}` : ""}`);
@@ -5035,39 +5069,70 @@ module.exports = function (app: any) {
   function _autowindSetEnabled(on: boolean, why: string): void {
     if (!!props.autowindEnabled === on) return;
     props.autowindEnabled = on;
+    if (!on) { _autowindOp++; _autowindBlockedReason = null; }
     try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ }
     // eslint-disable-next-line no-console
     console.log(`[autowind] ${on ? "on" : "off"} (${why})`);
     _autowindLastReason = why;
     _autowindPublish();
   }
+  // Rev632 (AUTOWIND audit 2026-11-05, GPT F06): AUTOWIND only decides on
+  // wind data younger than AUTOWIND_MAX_DATA_AGE_MS. A path that stopped
+  // (sensor off, plugin that publishes only now and then, like
+  // polar-performance's speedTrue) is skipped for the next one; none fresh
+  // = "no-wind-data". The sampler / alarms keep using _readTwaRad as is.
+  function _autowindFresh(paths: string[]): number | null {
+    const now = Date.now();
+    for (const p of paths) {
+      try {
+        const v = freshNumber(app.getSelfPath ? app.getSelfPath(p) : null, now);
+        if (v != null) return v;
+      } catch { /* next path */ }
+    }
+    return null;
+  }
   function _autowindTwaDeg(): number | null {
-    const r = _readTwaRad();
+    // Rev534: angleTrueGround as the sampler does when Water is missing.
+    const r = _autowindFresh(["environment.wind.angleTrueWater", "environment.wind.angleTrueGround"]);
     return r == null ? null : r * 180 / Math.PI;
   }
   function _autowindTwsKn(): number | null {
-    try {
-      // Rev534 (GPT review 2 #6): same sources as the sampler.
-      for (const p of ["environment.wind.speedTrue.value", "environment.wind.speedOverGround.value"]) {
-        const v = app.getSelfPath ? app.getSelfPath(p) : null;
-        if (typeof v === "number" && isFinite(v)) return v * 1.94384;
-      }
-      return null;
-    } catch { return null; }
+    // Rev534 (GPT review 2 #6): same sources as the sampler.
+    const v = _autowindFresh(["environment.wind.speedTrue", "environment.wind.speedOverGround"]);
+    return v == null ? null : v * 1.94384;
+  }
+  function _autowindSetBlocked(reason: string | null): void {
+    if (reason === _autowindBlockedReason) return;
+    _autowindBlockedReason = reason;
+    // eslint-disable-next-line no-console
+    console.log(`[autowind] ${reason ? `blocked: ${reason}` : "unblocked"}`);
+    _autowindPublish();
   }
   function _autowindTick(): void {
     if (!props.autowindEnabled || !apProvider) return;
     const mode = String(apProvider.data.mode || "").toLowerCase();
-    const blocked = apProvider.isVirtualTackActive()
-      || !!(_tackStatePrev && _tackStatePrev !== "none")
-      || _pseudoActive();
+    const vtActive = apProvider.isVirtualTackActive();
+    const pypilotTack = !!(_tackStatePrev && _tackStatePrev !== "none");
+    const manoeuvre = _pseudoActive();
+    const blocked = vtActive || pypilotTack || manoeuvre;
+    const twaNow = _autowindTwaDeg();
+    const twsNow = _autowindTwsKn();
+    _autowindSetBlocked(
+      vtActive ? "virtual-tack"
+      : pypilotTack ? "pypilot-tack"
+      : manoeuvre ? "manoeuvre"
+      : twaNow == null || twsNow == null ? "no-wind-data"
+      : twsNow < AUTOWIND_MIN_TWS_KN ? "wind-too-light"
+      : null);
     // Sailor (remote, TinyPilot, KIP) moved to compass/gps: AUTOWIND
     // ends, like picking another mode in the visor. 5 s so a transient
     // write race never switches it off.
     // pypilot drops to compass on its own when it loses GPS / true wind
     // (and returns when it is back): that is not the sailor leaving.
+    // Rev630 (Gemini audit 2026-11-05): only a tack, which passes through
+    // compass, suspends this check - a visor manoeuvre flag no longer does.
     const trueWindAvailable = ((apProvider as any).pypilotModes || []).includes("true wind");
-    if (!blocked && trueWindAvailable && mode !== "wind" && mode !== "true wind" && mode !== "") {
+    if (!vtActive && !pypilotTack && trueWindAvailable && mode !== "wind" && mode !== "true wind" && mode !== "") {
       if (_autowindOffFamilySince == null) _autowindOffFamilySince = Date.now();
       else if (Date.now() - _autowindOffFamilySince > 5000) {
         _autowindOffFamilySince = null;
@@ -5076,18 +5141,18 @@ module.exports = function (app: any) {
       return;
     }
     _autowindOffFamilySince = null;
+    if (_autowindInFlight > 0) return;   // a switch is still waiting on pypilot
     const want = autowind.tick({
       nowMs: Date.now(),
-      twaDeg: _autowindTwaDeg(),
+      twaDeg: twaNow,
       mode,
       engaged: !!apProvider.data.engaged,
       blocked,
-      twsKn: _autowindTwsKn(),
+      twsKn: twsNow,
       thresholdDeg: props.autowindThresholdDeg,
     });
     if (want) {
-      const twa = _autowindTwaDeg();
-      void _autowindApply(want, `TWA ${twa == null ? "?" : Math.abs(twa).toFixed(0)} deg`);
+      void _autowindApply(want, `TWA ${twaNow == null ? "?" : Math.abs(twaNow).toFixed(0)} deg`, true);
     }
   }
   // Rev164/165/166: supervisor layer. Runs on every historian tick.
diff --git a/src/maneuver-gate.ts b/src/maneuver-gate.ts
new file mode 100644
index 0000000..e8c5835
--- /dev/null
+++ b/src/maneuver-gate.ts
@@ -0,0 +1,34 @@
+// Rev630 (sea trial 2026-11-05): "a visor manoeuvre is running" flag
+// (Aproado / Empopado). While it is set, AUTOWIND does not switch and the
+// heading-deviation / cruise-drift / unable-to-steer alarms stay quiet.
+//
+// One entry per manoeuvre id, each with its own expiry: one visor ending
+// its manoeuvre does not end another visor's, and a renewal of a
+// manoeuvre that was cleared only revives that same id until it expires.
+// A visor older than Rev630 sends no id and shares the "legacy" entry.
+
+export const MANEUVER_GATE_TTL_MS = 180_000;
+export const MANEUVER_GATE_MAX = 16;
+
+export class ManeuverGate {
+  private readonly until = new Map<string, number>();
+
+  constructor(private readonly ttlMs = MANEUVER_GATE_TTL_MS) {}
+
+  /** Applies one visor message: {active: true|false, id?}. */
+  update(active: unknown, id: unknown, nowMs: number): void {
+    const key = typeof id === "string" && id ? id.slice(0, 64) : "legacy";
+    if (active === true) {
+      this.until.delete(key);
+      this.until.set(key, nowMs + this.ttlMs);
+      while (this.until.size > MANEUVER_GATE_MAX) this.until.delete(this.until.keys().next().value as string);
+    } else if (active === false) {
+      this.until.delete(key);
+    }
+  }
+
+  active(nowMs: number): boolean {
+    for (const [key, until] of this.until) if (until <= nowMs) this.until.delete(key);
+    return this.until.size > 0;
+  }
+}
diff --git a/src/test/autowind.test.ts b/src/test/autowind.test.ts
index 1a1071e..56c2c10 100644
--- a/src/test/autowind.test.ts
+++ b/src/test/autowind.test.ts
@@ -2,7 +2,9 @@
 import { describe, it } from "node:test";
 import assert from "node:assert/strict";
 
-import { AutowindDecider, desiredSubMode, AutowindInput } from "../autowind";
+import fs from "node:fs";
+import path from "node:path";
+import { AutowindDecider, desiredSubMode, AutowindInput, freshNumber } from "../autowind";
 
 const inp = (o: Partial<AutowindInput>): AutowindInput => ({
   nowMs: 0, twaDeg: 90, mode: "wind", engaged: true, blocked: false, twsKn: 10, ...o,
@@ -53,11 +55,37 @@ describe("autowind (Rev518)", () => {
     for (let s = 0; s < 60; s++) {
       const twa = s < 12 ? 140 : 100;   // bears away, then heads up again
       const r = d.tick(inp({ nowMs: s * 1000, twaDeg: twa, mode }));
-      if (r) { switches.push(s); mode = r; }
+      if (r) { switches.push(s); mode = r; d.noteSwitch(s * 1000); }
     }
     assert.deepEqual(switches, [10, 40]);
   });
 
+  it("Rev630: a failed switch does not use up the 30 s gap; it retries 10 s later", () => {
+    const d = new AutowindDecider();
+    const asks: number[] = [];
+    for (let s = 0; s < 40; s++) {
+      const r = d.tick(inp({ nowMs: s * 1000, twaDeg: 150, mode: "wind" }));
+      if (r) { asks.push(s); d.noteFailure(s * 1000); }
+    }
+    // sustain 10 s, then one ask per (10 s sustain >= 10 s retry) - never 30 s apart
+    assert.deepEqual(asks, [10, 21, 32]);
+  });
+
+  it("Rev630: a switch that succeeds after a failure starts the normal 30 s gap", () => {
+    const d = new AutowindDecider();
+    let mode = "wind";
+    const asks: number[] = [];
+    for (let s = 0; s < 60; s++) {
+      const twa = s < 25 ? 150 : 100;
+      const r = d.tick(inp({ nowMs: s * 1000, twaDeg: twa, mode }));
+      if (!r) continue;
+      asks.push(s);
+      if (asks.length === 1) d.noteFailure(s * 1000);
+      else { mode = r; d.noteSwitch(s * 1000); }
+    }
+    assert.deepEqual(asks, [10, 21, 51]);
+  });
+
   it("never while blocked (tack, aproado)", () => {
     const d = new AutowindDecider();
     assert.equal(feed(d, 0, 20, () => ({ twaDeg: 150, blocked: true })).length, 0);
@@ -86,3 +114,48 @@ describe("autowind (Rev518)", () => {
     assert.equal(d.initial(null), "wind");
   });
 });
+
+describe("Rev632: data age and gaps", () => {
+  it("two readings 60 s apart are not 10 s sustained", () => {
+    const d = new AutowindDecider();
+    assert.equal(d.tick(inp({ nowMs: 0, twaDeg: 150 })), null);
+    assert.equal(d.tick(inp({ nowMs: 60_000, twaDeg: 150 })), null);
+    // the count restarted at 60 s: 10 s of 1 Hz input from there
+    const out = feed(d, 61_000, 12, () => ({ twaDeg: 150 }));
+    assert.deepEqual(out, [{ s: 9, m: "true wind" }]);
+  });
+
+  it("freshNumber: young value yes; old, undated, future or non-numeric no", () => {
+    const now = Date.parse("2026-11-05T16:52:00Z");
+    const at = (ms: number) => new Date(now - ms).toISOString();
+    assert.equal(freshNumber({ value: 1.2, timestamp: at(2000) }, now), 1.2);
+    assert.equal(freshNumber({ value: 1.2, timestamp: at(11_000) }, now), null);
+    assert.equal(freshNumber({ value: 1.2 }, now), null);
+    assert.equal(freshNumber({ value: 1.2, timestamp: at(-20_000) }, now), null);
+    assert.equal(freshNumber({ value: null, timestamp: at(0) }, now), null);
+    assert.equal(freshNumber(undefined, now), null);
+  });
+});
+
+describe("Rev632: replay of the 2026-11-05 sea trial (17:51:25-17:53:33)", () => {
+  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "src", "test", "fixtures-autowind-2026-11-05.json"), "utf8"));
+  const toMs = (hms: string) => { const [h, m, s] = hms.split(":").map(Number); return ((h * 60 + m) * 60 + s) * 1000; };
+  const run = (blocked: boolean) => {
+    const d = new AutowindDecider();
+    d.noteSwitch(toMs("17:51:24"));          // AUTOWIND selected -> true wind
+    let mode = "true wind";
+    for (const [t, , twa, tws] of fx.rows as Array<[string, string, number, number]>) {
+      const r = d.tick(inp({ nowMs: toMs(t), twaDeg: twa, twsKn: tws, mode, blocked }));
+      if (r) { d.noteSwitch(toMs(t)); mode = r; return { t, r }; }
+    }
+    return null;
+  };
+
+  it("with no manoeuvre running it switches to apparent at 17:52:02", () => {
+    assert.deepEqual(run(false), { t: "17:52:02", r: "wind" });
+  });
+
+  it("with a manoeuvre really running it does not switch", () => {
+    assert.equal(run(true), null);
+  });
+});
diff --git a/src/test/maneuver-gate.test.ts b/src/test/maneuver-gate.test.ts
new file mode 100644
index 0000000..41ab9aa
--- /dev/null
+++ b/src/test/maneuver-gate.test.ts
@@ -0,0 +1,51 @@
+// Rev630 (sea trial 2026-11-05): the "visor manoeuvre running" flag, per
+// manoeuvre id. See src/maneuver-gate.ts.
+import { describe, it } from "node:test";
+import assert from "node:assert/strict";
+import { ManeuverGate, MANEUVER_GATE_MAX } from "../maneuver-gate";
+
+describe("ManeuverGate", () => {
+  it("is off until a manoeuvre starts and off again when it ends", () => {
+    const g = new ManeuverGate(180_000);
+    assert.equal(g.active(0), false);
+    g.update(true, "emp-1", 0);
+    assert.equal(g.active(1000), true);
+    g.update(false, "emp-1", 2000);
+    assert.equal(g.active(2000), false);
+  });
+
+  it("expires when the visor stops renewing", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, "emp-1", 0);
+    assert.equal(g.active(179_999), true);
+    assert.equal(g.active(180_000), false);
+  });
+
+  it("one visor ending its manoeuvre does not end another visor's", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, "emp-1", 0);
+    g.update(true, "apr-2", 0);
+    g.update(false, "emp-1", 1000);
+    assert.equal(g.active(1000), true);
+    g.update(false, "apr-2", 1000);
+    assert.equal(g.active(1000), false);
+  });
+
+  it("a visor without id (before Rev630) still works on its own entry", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, undefined, 0);
+    assert.equal(g.active(0), true);
+    g.update(true, "emp-1", 0);
+    g.update(false, undefined, 0);
+    assert.equal(g.active(0), true, "the id'd manoeuvre is untouched");
+  });
+
+  it("ignores messages that are not true/false and keeps a bounded size", () => {
+    const g = new ManeuverGate(180_000);
+    g.update("yes", "x", 0);
+    assert.equal(g.active(0), false);
+    for (let i = 0; i < MANEUVER_GATE_MAX + 10; i++) g.update(true, `m-${i}`, 0);
+    for (let i = 0; i < MANEUVER_GATE_MAX + 10; i++) g.update(false, `m-${i}`, 0);
+    assert.equal(g.active(0), false);
+  });
+});
diff --git a/src/test/virtual-tack-sailor.test.ts b/src/test/virtual-tack-sailor.test.ts
index 2a6fc0d..35d01e3 100644
--- a/src/test/virtual-tack-sailor.test.ts
+++ b/src/test/virtual-tack-sailor.test.ts
@@ -498,4 +498,25 @@ describe("long-way gybe needs confirmation (Rev511)", () => {
       await waitFor(() => !p2.isVirtualTackActive(), 3000);
     } finally { sim2.stop(); }
   });
+
+  it("Rev630: an outside mode change during the tack is refused with an error, not ignored", async () => {
+    // AUTOWIND took the old silent return for success and changed the
+    // profile (GPT audit 2026-11-05 F02).
+    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 1 });
+    const p = new AutopilotProvider(sim.client as any, sim.app);
+    sim.attach(p);
+    try {
+      await p.startVirtualTack({ direction: "starboard" });
+      await waitFor(() => p.getVirtualTackState()?.phase === "turning", 2000);
+      const before = sim.writes.filter((w) => w.name === "ap.mode").length;
+      await assert.rejects(
+        (p.toProviderInterface() as any).setMode("true wind", "_default"),
+        /refused: virtual tack is driving the pilot/,
+      );
+      assert.equal(sim.writes.filter((w) => w.name === "ap.mode" && w.value === "true wind").length, 0);
+      assert.ok(sim.writes.filter((w) => w.name === "ap.mode").length >= before);
+      await p.cancelVirtualTack();
+      await waitFor(() => !p.isVirtualTackActive(), 3000);
+    } finally { sim.stop(); }
+  });
 });
diff --git a/src/test/visor-maneuver-flag.test.ts b/src/test/visor-maneuver-flag.test.ts
new file mode 100644
index 0000000..4fc77ec
--- /dev/null
+++ b/src/test/visor-maneuver-flag.test.ts
@@ -0,0 +1,120 @@
+// Rev630 (sea trial 2026-11-05): closing the Empopado summary by hand left
+// the visor renewing "manoeuvre active" every 20 s for the rest of the
+// session (AUTOWIND blocked, three steering alarms silenced). These tests
+// run the visor's own functions, taken from public/app.js, with fake
+// timers and a fake fetch.
+import { describe, it } from "node:test";
+import assert from "node:assert/strict";
+import fs from "node:fs";
+import path from "node:path";
+import vm from "node:vm";
+
+const APP = fs.readFileSync(path.join(__dirname, "..", "..", "public", "app.js"), "utf8");
+
+/** Source of `function name(...) {...}` from app.js, by brace matching. */
+function fnSource(name: string): string {
+  const start = APP.indexOf(`function ${name}(`);
+  assert.ok(start >= 0, `function ${name} not found in app.js`);
+  let i = APP.indexOf("{", start);
+  let depth = 0;
+  for (; i < APP.length; i++) {
+    if (APP[i] === "{") depth++;
+    else if (APP[i] === "}" && --depth === 0) break;
+  }
+  return APP.slice(start, i + 1);
+}
+
+interface Visor {
+  ctx: any;
+  posts: Array<{ active: boolean; id?: string }>;
+  tick: () => void;   // runs every live interval once (= 20 s later)
+  liveIntervals: () => number;
+}
+
+function loadVisor(): Visor {
+  const posts: Array<{ active: boolean; id?: string }> = [];
+  const intervals = new Map<number, () => void>();
+  let next = 1;
+  const ctx: any = {
+    state: { aproado: null, empopado: null },
+    PLUGIN_ID: "signalk-pypilot-newui",
+    skFetch: (_url: string, opts: any) => { posts.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true }); },
+    setInterval: (fn: () => void) => { const h = next++; intervals.set(h, fn); return h; },
+    clearInterval: (h: number) => { intervals.delete(h); },
+    setTimeout: () => 0,
+    clearTimeout: () => {},
+    hideEmpopadoHud: () => {},
+    console,
+  };
+  vm.createContext(ctx);
+  vm.runInContext([
+    "let _maneuverPseudoTimer = null;",
+    "let _maneuverPseudoId = null;",
+    fnSource("_pseudoManeuverRunning"),
+    fnSource("_setManeuverPseudo"),
+    fnSource("_postManeuverPseudo"),
+    fnSource("empopadoClose"),
+  ].join("\n"), ctx);
+  return {
+    ctx, posts,
+    tick: () => { for (const fn of [...intervals.values()]) fn(); },
+    liveIntervals: () => intervals.size,
+  };
+}
+
+describe("visor manoeuvre flag (Rev630)", () => {
+  it("closing the Empopado summary by hand stops the renewal", () => {
+    const v = loadVisor();
+    const ap = { id: "emp-1", phase: "transit" };
+    v.ctx.state.empopado = ap;
+    v.ctx._setManeuverPseudo(true, ap.id);
+    v.tick();
+    assert.deepEqual(v.posts.map((p) => p.active), [true, true]);
+    ap.phase = "summary";             // empopadoFinish
+    v.ctx.empopadoClose();            // the summary's close button
+    assert.equal(v.ctx.state.empopado, null);
+    assert.equal(v.liveIntervals(), 0);
+    v.tick();
+    assert.deepEqual(v.posts.map((p) => p.active), [true, true, false]);
+    assert.equal(v.posts[2].id, "emp-1");
+  });
+
+  it("a renewal whose manoeuvre is gone switches the flag off by itself", () => {
+    const v = loadVisor();
+    v.ctx.state.empopado = { id: "emp-1", phase: "active" };
+    v.ctx._setManeuverPseudo(true, "emp-1");
+    v.ctx.state.empopado = null;      // any path that forgets the close
+    v.tick();
+    assert.deepEqual(v.posts.map((p) => p.active), [true, false]);
+    assert.equal(v.liveIntervals(), 0);
+  });
+
+  it("a renewal stops once the manoeuvre is in its summary", () => {
+    const v = loadVisor();
+    const ap = { id: "emp-1", phase: "active" };
+    v.ctx.state.empopado = ap;
+    v.ctx._setManeuverPseudo(true, ap.id);
+    ap.phase = "summary";
+    v.tick();
+    assert.deepEqual(v.posts.map((p) => p.active), [true, false]);
+  });
+
+  it("ending one manoeuvre does not clear the flag of another", () => {
+    const v = loadVisor();
+    v.ctx.state.aproado = { id: "apr-2", phase: "transit" };
+    v.ctx._setManeuverPseudo(true, "apr-2");
+    v.ctx._setManeuverPseudo(false, "emp-1");
+    assert.equal(v.liveIntervals(), 1);
+    assert.deepEqual(v.posts.map((p) => p.active), [true]);
+  });
+
+  it("the mode selector ends a running or summary manoeuvre before AUTOWIND", () => {
+    const handler = APP.slice(APP.indexOf('$("#mode-select").addEventListener("change"'));
+    const end = handler.indexOf('if (chosen === "autowind")');
+    assert.ok(end > 0);
+    const before = handler.slice(0, end);
+    assert.match(before, /empopadoTearDown\(\{ restoreAll: false \}\)/);
+    assert.match(before, /empopadoClose\(\)/);
+    assert.match(before, /aproadoTearDown\(\)/);
+  });
+});
```

## Current code around the changes

Line numbers are the real ones in the repository at Rev632.

### src/autowind.ts lines 1-117 (AUTOWIND decision logic (whole file))

```ts
    1  // Rev518 (Carlos 2026-10-19): pseudo-mode AUTOWIND. Apparent wind
    2  // (pypilot "wind") when |TWA| < threshold, true wind ("true wind") when
    3  // above: downwind the apparent angle swings with boat speed and the
    4  // pilot chases it (2026-10-19 18:48: +-40 deg in apparent at TWA ~140,
    5  // steady in true wind). Each side has its own pypilot profile, so the
    6  // true-wind side can be the more reactive one.
    7  //
    8  // Pure decision logic: fed once per second, no I/O.
    9  
   10  export type WindSubMode = "wind" | "true wind";
   11  
   12  export const AUTOWIND_DEFAULT_THRESHOLD_DEG = 120;
   13  export const AUTOWIND_HYSTERESIS_DEG = 5;      // +-5 around the threshold
   14  export const AUTOWIND_SUSTAIN_MS = 10_000;     // condition held this long
   15  export const AUTOWIND_MIN_GAP_MS = 30_000;     // between two switches
   16  // Rev630 (GPT audit 2026-11-05 F07): after a switch that failed, wait this
   17  // long before asking again (the 30 s gap counts only real switches).
   18  export const AUTOWIND_RETRY_MS = 10_000;
   19  // Rev632 (AUTOWIND audit 2026-11-05, GPT F06): wind data older than this
   20  // counts as missing (on Tunatunes derived-data and the vane update every
   21  // 1-4 s). And a gap longer than AUTOWIND_MAX_TICK_GAP_MS between two
   22  // inputs restarts the 10 s count: two readings 60 s apart are not "10 s
   23  // sustained".
   24  export const AUTOWIND_MAX_DATA_AGE_MS = 10_000;
   25  export const AUTOWIND_MAX_TICK_GAP_MS = 3_000;
   26  
   27  /** The number in a Signal K node ({value, timestamp}) if it is younger
   28   *  than maxAgeMs, else null. No timestamp = not fresh; a timestamp in
   29   *  the future by more than maxAgeMs (clock step) = not fresh either. */
   30  export function freshNumber(node: unknown, nowMs: number, maxAgeMs = AUTOWIND_MAX_DATA_AGE_MS): number | null {
   31    if (!node || typeof node !== "object") return null;
   32    const v = (node as any).value;
   33    const ts = Date.parse(String((node as any).timestamp));
   34    if (typeof v !== "number" || !isFinite(v) || !isFinite(ts)) return null;
   35    return Math.abs(nowMs - ts) <= maxAgeMs ? v : null;
   36  }
   37  // Rev521 (Carlos 2026-10-20, in port with the AP off: "no cambió de
   38  // modo"): it now also switches with the AP disengaged, so engaging lands
   39  // in the right mode, but only with a meaningful wind - below 3 kn TWS the
   40  // true wind angle is noise (0.3 kn at the berth flips it side to side).
   41  export const AUTOWIND_MIN_TWS_KN = 3;
   42  
   43  export interface AutowindInput {
   44    nowMs: number;
   45    /** True wind angle in degrees (signed or not), null if unknown. */
   46    twaDeg: number | null;
   47    /** pypilot's current mode. */
   48    mode: string | null;
   49    /** Kept for callers; no longer gates the decision (Rev521). */
   50    engaged: boolean;
   51    /** True wind speed in knots; null = unknown (no switch). */
   52    twsKn?: number | null;
   53    /** Virtual tack, pypilot tack, aproado / empopado: never switch then. */
   54    blocked: boolean;
   55    thresholdDeg?: number;
   56  }
   57  
   58  /** Side of the threshold the wind is on, with hysteresis; null in the band. */
   59  export function desiredSubMode(twaDeg: number, thresholdDeg = AUTOWIND_DEFAULT_THRESHOLD_DEG): WindSubMode | null {
   60    // Rev532 (Gemini audit #11): a 0..360 source (330 = 30 to port) must
   61    // not read as downwind.
   62    const a = Math.abs((((twaDeg % 360) + 540) % 360) - 180);
   63    if (a >= thresholdDeg + AUTOWIND_HYSTERESIS_DEG) return "true wind";
   64    if (a <= thresholdDeg - AUTOWIND_HYSTERESIS_DEG) return "wind";
   65    return null;
   66  }
   67  
   68  export class AutowindDecider {
   69    private pending: WindSubMode | null = null;
   70    private pendingSince: number | null = null;
   71    private lastSwitchMs: number | null = null;
   72    private lastFailMs: number | null = null;
   73    private lastTickMs: number | null = null;
   74  
   75    /** Returns the mode to switch to now, or null. The caller reports the
   76     *  outcome with noteSwitch() or noteFailure(). */
   77    tick(i: AutowindInput): WindSubMode | null {
   78      // Rev632: a hole in the inputs (plugin busy, clock step) restarts the count.
   79      const gap = this.lastTickMs == null ? 0 : i.nowMs - this.lastTickMs;
   80      this.lastTickMs = i.nowMs;
   81      if (gap < 0 || gap > AUTOWIND_MAX_TICK_GAP_MS) { this.pending = null; this.pendingSince = null; }
   82      const cur = String(i.mode || "").toLowerCase();
   83      const curSub: WindSubMode | null = cur === "true wind" ? "true wind" : cur === "wind" ? "wind" : null;
   84      const windOk = typeof i.twsKn === "number" && isFinite(i.twsKn) && i.twsKn >= AUTOWIND_MIN_TWS_KN;
   85      if (i.blocked || !windOk || typeof i.twaDeg !== "number" || !isFinite(i.twaDeg)) {
   86        this.pending = null; this.pendingSince = null;
   87        return null;
   88      }
   89      const want = desiredSubMode(i.twaDeg, i.thresholdDeg);
   90      if (want == null || want === curSub) {
   91        this.pending = null; this.pendingSince = null;
   92        return null;
   93      }
   94      if (this.pending !== want) {
   95        this.pending = want; this.pendingSince = i.nowMs;
   96        return null;
   97      }
   98      if (this.pendingSince != null && i.nowMs - this.pendingSince < AUTOWIND_SUSTAIN_MS) return null;
   99      if (this.lastSwitchMs != null && i.nowMs - this.lastSwitchMs < AUTOWIND_MIN_GAP_MS) return null;
  100      if (this.lastFailMs != null && i.nowMs - this.lastFailMs < AUTOWIND_RETRY_MS) return null;
  101      this.pending = null; this.pendingSince = null;
  102      return want;
  103    }
  104  
  105    /** Called when Autowind is switched on: no sustain, no gap. */
  106    initial(twaDeg: number | null, thresholdDeg?: number): WindSubMode {
  107      this.pending = null; this.pendingSince = null;
  108      if (typeof twaDeg !== "number" || !isFinite(twaDeg)) return "wind";
  109      const a = Math.abs((((twaDeg % 360) + 540) % 360) - 180);
  110      return a >= (thresholdDeg ?? AUTOWIND_DEFAULT_THRESHOLD_DEG) ? "true wind" : "wind";
  111    }
  112  
  113    noteSwitch(nowMs: number): void { this.lastSwitchMs = nowMs; this.lastFailMs = null; }
  114  
  115    noteFailure(nowMs: number): void { this.lastFailMs = nowMs; }
  116  }
  117  
```

### src/maneuver-gate.ts lines 1-35 (visor manoeuvre flag, backend (whole file))

```ts
    1  // Rev630 (sea trial 2026-11-05): "a visor manoeuvre is running" flag
    2  // (Aproado / Empopado). While it is set, AUTOWIND does not switch and the
    3  // heading-deviation / cruise-drift / unable-to-steer alarms stay quiet.
    4  //
    5  // One entry per manoeuvre id, each with its own expiry: one visor ending
    6  // its manoeuvre does not end another visor's, and a renewal of a
    7  // manoeuvre that was cleared only revives that same id until it expires.
    8  // A visor older than Rev630 sends no id and shares the "legacy" entry.
    9  
   10  export const MANEUVER_GATE_TTL_MS = 180_000;
   11  export const MANEUVER_GATE_MAX = 16;
   12  
   13  export class ManeuverGate {
   14    private readonly until = new Map<string, number>();
   15  
   16    constructor(private readonly ttlMs = MANEUVER_GATE_TTL_MS) {}
   17  
   18    /** Applies one visor message: {active: true|false, id?}. */
   19    update(active: unknown, id: unknown, nowMs: number): void {
   20      const key = typeof id === "string" && id ? id.slice(0, 64) : "legacy";
   21      if (active === true) {
   22        this.until.delete(key);
   23        this.until.set(key, nowMs + this.ttlMs);
   24        while (this.until.size > MANEUVER_GATE_MAX) this.until.delete(this.until.keys().next().value as string);
   25      } else if (active === false) {
   26        this.until.delete(key);
   27      }
   28    }
   29  
   30    active(nowMs: number): boolean {
   31      for (const [key, until] of this.until) if (until <= nowMs) this.until.delete(key);
   32      return this.until.size > 0;
   33    }
   34  }
   35  
```

### src/index.ts lines 285-442 (options + AUTOWIND runtime state)

```ts
  285    steerRecoveryEnabled?: boolean;
  286    // Rev518 (Carlos 2026-10-19): pseudo-mode AUTOWIND - apparent below
  287    // the threshold, true wind above, one profile for each side.
  288    autowindEnabled?: boolean;
  289    autowindProfileApparent?: string;
  290    autowindProfileTrue?: string;
  291    autowindThresholdDeg?: number;
  292  }
  293  
  294  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  295  module.exports = function (app: any) {
  296    let client: PypilotClient | null = null;
  297    let apProvider: AutopilotProvider | null = null;
  298    let props: PluginProps = { host: "", port: 80 };
  299    let lastCatalog: PypilotCatalog = {};
  300    let lastPingLatencyMs: number | null = null;
  301    let publishedSkPaths: Set<string> = new Set();
  302    let metaSent: Set<string> = new Set();
  303    let putHandlersRegistered: Set<string> = new Set();
  304    let lastConnectAt: number | null = null;
  305    let lastDisconnectReason: string | null = null;
  306    let deltaSentCount = 0;
  307    // Rev93: telemetry historian for the Chart tab + Rev95 KPIs.
  308    let historian: Historian | null = null;
  309    // Rev95: KPI computer + its SK-paths publisher interval.
  310    let kpis: KPIComputer | null = null;
  311    let kpiPublishTimer: NodeJS.Timeout | null = null;
  312    let kpiMetaSent = false;
  313    // Rev554: diagnostic paths (KPIs, servo health, roll FF, tack
  314    // catch-up, leeway) go out only when changed, plus a 30 s heartbeat.
  315    const diagFilter = new ChangeFilter();
  316    // Rev97: Sensor Quality monitor. Reads freshness / Hz / jitter per
  317    // watched SK path from the same sampler tick as the historian.
  318    let sensorQuality: SensorQualityMonitor | null = null;
  319    // Rev99: Servo Health monitor. Learns a baseline current from the
  320    // first ~5-10 min of engaged navigation and grades subsequent draws.
  321    let servoHealth: ServoHealthMonitor | null = null;
  322    let servoHealthMetaSent = false;
  323    // Rev158: periodic snapshot of the baseline learn state.
  324    let servoHealthPersistTimer: NodeJS.Timeout | null = null;
  325    // Rev498: shared visor prefs (AIS mode / voice / harbour auto / gust
  326    // ghost / AIS silenced MMSIs) — backend is the single source of truth
  327    // so every device agrees. Created lazily: the router can be hit
  328    // before start(). The 1 Hz timer feeds own SOG to the harbour machine.
  329    let visorPrefs: VisorPrefs | null = null;
  330    let visorPrefsTimer: NodeJS.Timeout | null = null;
  331    // Rev618: historian on disk across restarts.
  332    let historianSaveTimer: NodeJS.Timeout | null = null;
  333    const historianFile = (): string => {
  334      // eslint-disable-next-line @typescript-eslint/no-require-imports
  335      const p = require("path");
  336      return p.join(app.getDataDirPath ? app.getDataDirPath() : ".", "historian.json");
  337    };
  338    const saveHistorian = (): void => {
  339      if (!historian) return;
  340      try {
  341        // eslint-disable-next-line @typescript-eslint/no-require-imports
  342        const fs = require("fs");
  343        const file = historianFile();
  344        // 5 decimals is plenty for radians, m/s, A and V; keeps the file small.
  345        const json = JSON.stringify(historian.dump(), (_k, v) =>
  346          (typeof v === "number" && !Number.isInteger(v)) ? Math.round(v * 1e5) / 1e5 : v);
  347        fs.writeFileSync(file + ".tmp", json);
  348        fs.renameSync(file + ".tmp", file);
  349      } catch (e: any) { app.debug?.(`[historian] save failed: ${e?.message || e}`); }
  350    };
  351    // Rev612: harbour zones (regions with zoneType "harbour"), re-read every minute.
  352    let harbourZonesTimer: NodeJS.Timeout | null = null;
  353    let harbourPolygons: Polygon[] = [];
  354    let harbourZonesGen = 0;
  355    const getVisorPrefs = (): VisorPrefs => {
  356      if (!visorPrefs) {
  357        // eslint-disable-next-line @typescript-eslint/no-require-imports
  358        const p = require("path");
  359        visorPrefs = new VisorPrefs(p.join(app.getDataDirPath ? app.getDataDirPath() : ".", "visor-prefs.json"));
  360      }
  361      return visorPrefs;
  362    };
  363    // Rev522: named rose display presets (lazy, same data dir).
  364    let displayPresets: DisplayPresets | null = null;
  365    const getDisplayPresets = (): DisplayPresets => {
  366      if (!displayPresets) {
  367        // eslint-disable-next-line @typescript-eslint/no-require-imports
  368        const p = require("path");
  369        displayPresets = new DisplayPresets(p.join(app.getDataDirPath ? app.getDataDirPath() : ".", "display-presets.json"));
  370      }
  371      return displayPresets;
  372    };
  373    // Rev164 (Carlos): supervisor state that watches TWS averaged over the
  374    // last 60 s and switches the pypilot profile when the wind band has
  375    // been stable for BAND_STABLE_MS. Kept off the historian tick to
  376    // avoid entangling the KPI loop.
  377    const AUTO_PROFILE_BAND_STABLE_MS = 90 * 1000;
  378    const AUTO_PROFILE_WIND_AVG_MS    = 60 * 1000;
  379    const AUTO_PROFILE_TWS_MED_KN     = 8;    // < 8 kn = light
  380    const AUTO_PROFILE_TWS_HEAVY_KN   = 16;   // > 16 kn = heavy
  381    type AutoProfileBand = "light" | "medium" | "heavy" | null;
  382    let _autoProfileCurrentBand: AutoProfileBand = null;
  383    let _autoProfilePendingBand: AutoProfileBand = null;
  384    let _autoProfilePendingSince: number | null = null;
  385    let _autoProfileLastSwitchTs: number | null = null;
  386    let _autoProfileLastReason: string | null = null;
  387    // Rev167: gust supervisor. Rolling ring of AWS samples with timestamps.
  388    const GUST_WINDOW_MS    = 5000;     // look-back for rate-of-change
  389    const GUST_MIN_JUMP_KN  = 5;        // AWS jump >= 5 kn = "gust"
  390    // Rev283: second signal to confirm a real gust vs a sensor spike.
  391    // If heel data is available on both the min-AWS and max-AWS ends of
  392    // the window, require the heel to have changed at least this many
  393    // degrees during the same interval. Without heel data the check
  394    // fails open (legacy Rev167 behaviour).
  395    const GUST_HEEL_CONFIRM_DEG = 2;
  396    const GUST_COOLDOWN_MS  = 60_000;   // do not re-alert / re-strategy for 60 s
  397    const GUST_BOOST_SEC    = 20;       // damp D for 20 s after detection
  398    const GUST_HEAVY_SEC    = 30;       // temp heavy profile for 30 s
  399    const _gustAwsBuffer: Array<{ ts: number; ktts: number; heelRad: number | null }> = [];
  400    let _gustLastAlertTs = 0;
  401    // Rev283: last suppressed-by-heel event for observability.
  402    let _gustLastSuppressedTs: number | null = null;
  403    let _gustLastSuppressReason: string | null = null;
  404    // "boost-D" bookkeeping: original D per pilot so we can restore.
  405    let _gustBoostUntilMs: number | null = null;
  406    let _gustBoostRestoreGain: { pilot: string; key: "D"; value: number; boosted?: number; profile?: string | null } | null = null;
  407    // Rev577 (GPT audit A01/A02): D restorations after a boost-D gust,
  408    // done only on the profile that was boosted and only reported once
  409    // pypilot shows the restored value. Kept while that profile is not
  410    // active (it is restored when it comes back) and retried every 5 s if a
  411    // write is refused.
  412    let _gustPendingRestores: GustRestore[] = [];
  413    // Same for the temp-heavy profile switch-back.
  414    let _gustHeavyPending: HeavyRestore | null = null;
  415    // "temp-heavy" bookkeeping: original profile so we can restore.
  416    let _gustHeavyUntilMs: number | null = null;
  417    let _gustHeavyRestoreProfile: string | null = null;
  418    // Rev166: authority-lost auto-disengage. Track how long we have been
  419    // in the "cannot steer" condition so the disengage fires exactly at
  420    // 10 s of sustained loss, not on a single spike.
  421    const AUTHORITY_LOST_SUSTAIN_MS   = 10_000;
  422    const AUTHORITY_LOST_RMS_DEG      = 30;
  423    const AUTHORITY_LOST_DUTY_MIN     = 0.90;
  424    const AUTHORITY_LOST_COOLDOWN_MS  = 60_000;   // after auto-disengage, block re-arm 60 s
  425    let _authorityLostSinceMs: number | null = null;
  426    let _authorityLastAutoDisengageTs: number | null = null;
  427    // Rev508: stuck-pilot watch + recovery cycle bookkeeping.
  428    let steerWatch = new SteerWatch();
  429    let _steerRecoveryInFlight = false;
  430    let _steerRecoveryTotal = 0;
  431    let _steerRecoveryLastTs: number | null = null;
  432    let _steerRecoveryLastResult: string | null = null;
  433    // Rev518: AUTOWIND state.
  434    let autowind = new AutowindDecider();
  435    let _autowindLastSwitchTs: number | null = null;
  436    let _autowindLastReason: string | null = null;
  437    let _autowindOffFamilySince: number | null = null;
  438    // Rev630 (AUTOWIND audit 2026-11-05).
  439    let _autowindOp = 0;                              // bumped by every apply and by "off"
  440    let _autowindInFlight = 0;                        // mode switches waiting on pypilot
  441    let _autowindBlockedReason: string | null = null;
  442    let _autowindLastError: string | null = null;
```

### src/index.ts lines 600-614 (manoeuvre gate wiring)

```ts
  600    let maneuverTrace: ManeuverTraceLog | null = null;
  601    // Rev323 (Carlos, 2026-09-27): pseudo-modo visor-side. El visor lo
  602    // posta a `/maneuver-state` al arrancar / cerrar Aproado o Empopado.
  603    // Se usa para silenciar heading-deviation / cruise-drift / unable-
  604    // to-steer durante la maniobra, INDEPENDIENTE de `ap.tack.state` â€”
  605    // en modo wind pypilot NO obedece y ap.tack.state se queda en "none"
  606    // aunque el visor estÃ© pilotando la maniobra por otras vÃ­as.
  607    // Rev534 (GPT review 2 #1): the visor renews it every 20 s; a closed or
  608    // disconnected browser must not silence the heading alarms (and block
  609    // AUTO WIND) for ever.
  610    // Self-audit Rev540: 180 s - with the screen off Chrome runs the 20 s
  611    // renewal only about once a minute, and 60 s let it lapse mid-manoeuvre.
  612    // Rev630: one entry per manoeuvre id, see src/maneuver-gate.ts.
  613    const maneuverGate = new ManeuverGate();
  614    const _pseudoActive = (): boolean => maneuverGate.active(Date.now());
```

### src/index.ts lines 2862-2893 (HTTP /autowind)

```ts
 2862        // Rev518: AUTOWIND config + state.
 2863        router.get("/autowind", (_req: any, res: any) => {
 2864          res.json(_autowindState());
 2865        });
 2866        router.post("/autowind", async (req: any, res: any) => {
 2867          if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
 2868          const b = req.body || {};
 2869          let changed = false;
 2870          if (typeof b.profileApparent === "string") { props.autowindProfileApparent = b.profileApparent.trim(); changed = true; }
 2871          if (typeof b.profileTrue === "string") { props.autowindProfileTrue = b.profileTrue.trim(); changed = true; }
 2872          if (typeof b.thresholdDeg === "number") {
 2873            props.autowindThresholdDeg = clampNumber(b.thresholdDeg, 90, 150, AUTOWIND_DEFAULT_THRESHOLD_DEG);
 2874            changed = true;
 2875          }
 2876          if (changed) { try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ } }
 2877          if (typeof b.enabled === "boolean") {
 2878            const was = !!props.autowindEnabled;
 2879            _autowindSetEnabled(b.enabled, b.enabled ? "selected" : "another mode selected");
 2880            if (b.enabled && !was) {
 2881              // Pick the side now, no waiting.
 2882              const sub = autowind.initial(_autowindTwaDeg(), props.autowindThresholdDeg);
 2883              await _autowindApply(sub, "AUTOWIND on");
 2884            }
 2885          }
 2886          // New profile for the side that is active right now: apply it.
 2887          if (props.autowindEnabled && changed && apProvider) {
 2888            const mode = String(apProvider.data.mode || "").toLowerCase();
 2889            if (mode === "wind" || mode === "true wind") _autowindApplyProfile(mode as WindSubMode, "profile chosen");
 2890          }
 2891          _autowindPublish();
 2892          res.json(_autowindState());
 2893        });
```

### src/index.ts lines 3450-3458 (HTTP /maneuver-state)

```ts
 3450        // {active:false} on their teardowns. Independent of trace log.
 3451        router.get("/maneuver-state", (_req: any, res: any) => {
 3452          res.json({ pseudoActive: _pseudoActive() });
 3453        });
 3454        router.post("/maneuver-state", (req: any, res: any) => {
 3455          const body = req.body || {};
 3456          maneuverGate.update(body.active, body.id, Date.now());
 3457          res.json({ ok: true, pseudoActive: _pseudoActive() });
 3458        });
```

### src/index.ts lines 4984-5157 (AUTOWIND state, apply, tick)

```ts
 4984    }
 4985    // Rev518 (Carlos 2026-10-19): AUTOWIND. See src/autowind.ts.
 4986    function _autowindState(): Record<string, unknown> {
 4987      const mode = apProvider ? String(apProvider.data.mode || "") : "";
 4988      return {
 4989        enabled: !!props.autowindEnabled,
 4990        subMode: mode === "wind" || mode === "true wind" ? mode : null,
 4991        profileApparent: props.autowindProfileApparent || "",
 4992        profileTrue: props.autowindProfileTrue || "",
 4993        thresholdDeg: props.autowindThresholdDeg ?? AUTOWIND_DEFAULT_THRESHOLD_DEG,
 4994        lastSwitchTs: _autowindLastSwitchTs,
 4995        lastReason: _autowindLastReason,
 4996        // Rev630 (sea trial 2026-11-05): why AUTOWIND cannot switch right now
 4997        // ("virtual-tack" | "pypilot-tack" | "manoeuvre" | "no-wind-data" |
 4998        // "wind-too-light" | null), and the last switch that failed.
 4999        blockedReason: props.autowindEnabled ? _autowindBlockedReason : null,
 5000        lastError: _autowindLastError,
 5001      };
 5002    }
 5003    function _autowindPublish(): void {
 5004      try {
 5005        app.handleMessage(PLUGIN_ID, {
 5006          context: "vessels." + app.selfId,
 5007          updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [
 5008            { path: "steering.autopilot.autowind", value: _autowindState() },
 5009          ] }],
 5010        });
 5011      } catch { /* silent */ }
 5012    }
 5013    function _autowindProfileFor(sub: WindSubMode): string {
 5014      return (sub === "true wind" ? props.autowindProfileTrue : props.autowindProfileApparent) || "";
 5015    }
 5016    function _autowindApplyProfile(sub: WindSubMode, reason: string): void {
 5017      const want = _autowindProfileFor(sub);
 5018      if (!want || !client || !client.connected) return;
 5019      if (client.getValues()["profile"] === want) return;
 5020      let sent = false;
 5021      try {
 5022        profileChangeLog.markPlannedWrite(want, "autowind", reason);
 5023        sent = client.set("profile", want) !== false;
 5024      } catch { /* silent */ }
 5025      // Rev630 (GPT audit 2026-11-05 F03): a refused write is a failure.
 5026      if (!sent) _autowindFail(`profile ${want} not sent to pypilot`);
 5027    }
 5028    function _autowindFail(msg: string): void {
 5029      _autowindLastError = msg;
 5030      // eslint-disable-next-line no-console
 5031      console.log(`[autowind] failed: ${msg}`);
 5032      _autowindPublish();
 5033    }
 5034    // Rev630 (GPT audit 2026-11-05 F02/F03): `fromTick` = an automatic switch
 5035    // (its outcome feeds the decider's gap / retry). An operation number:
 5036    // turning AUTOWIND off, or a newer apply, makes an apply still waiting on
 5037    // pypilot stop there - no profile, no "switched" afterwards.
 5038    async function _autowindApply(sub: WindSubMode, reason: string, fromTick = false): Promise<void> {
 5039      if (!apProvider) return;
 5040      const op = ++_autowindOp;
 5041      _autowindLastReason = reason;
 5042      const cur = String(apProvider.data.mode || "").toLowerCase();
 5043      if (cur !== sub) {
 5044        // wind <-> true wind share the angle space: pypilot keeps the
 5045        // heading itself on the mode change, nothing else is written.
 5046        _autowindInFlight++;
 5047        try { await (apProvider.toProviderInterface() as any).setMode(sub, apProvider.deviceId); }
 5048        catch (e: any) {
 5049          _autowindInFlight--;
 5050          if (fromTick) autowind.noteFailure(Date.now());
 5051          _autowindFail(`mode ${sub}: ${e?.message || e}`);
 5052          return;
 5053        }
 5054        _autowindInFlight--;
 5055        if (op !== _autowindOp || !props.autowindEnabled) {
 5056          // eslint-disable-next-line no-console
 5057          console.log(`[autowind] ${sub} landed after AUTOWIND was turned off or overridden: profile left as is`);
 5058          return;
 5059        }
 5060        _autowindLastSwitchTs = Date.now();
 5061        autowind.noteSwitch(_autowindLastSwitchTs);
 5062      }
 5063      _autowindLastError = null;
 5064      _autowindApplyProfile(sub, reason);
 5065      // eslint-disable-next-line no-console
 5066      console.log(`[autowind] ${reason} -> ${sub}${_autowindProfileFor(sub) ? ` / profile ${_autowindProfileFor(sub)}` : ""}`);
 5067      _autowindPublish();
 5068    }
 5069    function _autowindSetEnabled(on: boolean, why: string): void {
 5070      if (!!props.autowindEnabled === on) return;
 5071      props.autowindEnabled = on;
 5072      if (!on) { _autowindOp++; _autowindBlockedReason = null; }
 5073      try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ }
 5074      // eslint-disable-next-line no-console
 5075      console.log(`[autowind] ${on ? "on" : "off"} (${why})`);
 5076      _autowindLastReason = why;
 5077      _autowindPublish();
 5078    }
 5079    // Rev632 (AUTOWIND audit 2026-11-05, GPT F06): AUTOWIND only decides on
 5080    // wind data younger than AUTOWIND_MAX_DATA_AGE_MS. A path that stopped
 5081    // (sensor off, plugin that publishes only now and then, like
 5082    // polar-performance's speedTrue) is skipped for the next one; none fresh
 5083    // = "no-wind-data". The sampler / alarms keep using _readTwaRad as is.
 5084    function _autowindFresh(paths: string[]): number | null {
 5085      const now = Date.now();
 5086      for (const p of paths) {
 5087        try {
 5088          const v = freshNumber(app.getSelfPath ? app.getSelfPath(p) : null, now);
 5089          if (v != null) return v;
 5090        } catch { /* next path */ }
 5091      }
 5092      return null;
 5093    }
 5094    function _autowindTwaDeg(): number | null {
 5095      // Rev534: angleTrueGround as the sampler does when Water is missing.
 5096      const r = _autowindFresh(["environment.wind.angleTrueWater", "environment.wind.angleTrueGround"]);
 5097      return r == null ? null : r * 180 / Math.PI;
 5098    }
 5099    function _autowindTwsKn(): number | null {
 5100      // Rev534 (GPT review 2 #6): same sources as the sampler.
 5101      const v = _autowindFresh(["environment.wind.speedTrue", "environment.wind.speedOverGround"]);
 5102      return v == null ? null : v * 1.94384;
 5103    }
 5104    function _autowindSetBlocked(reason: string | null): void {
 5105      if (reason === _autowindBlockedReason) return;
 5106      _autowindBlockedReason = reason;
 5107      // eslint-disable-next-line no-console
 5108      console.log(`[autowind] ${reason ? `blocked: ${reason}` : "unblocked"}`);
 5109      _autowindPublish();
 5110    }
 5111    function _autowindTick(): void {
 5112      if (!props.autowindEnabled || !apProvider) return;
 5113      const mode = String(apProvider.data.mode || "").toLowerCase();
 5114      const vtActive = apProvider.isVirtualTackActive();
 5115      const pypilotTack = !!(_tackStatePrev && _tackStatePrev !== "none");
 5116      const manoeuvre = _pseudoActive();
 5117      const blocked = vtActive || pypilotTack || manoeuvre;
 5118      const twaNow = _autowindTwaDeg();
 5119      const twsNow = _autowindTwsKn();
 5120      _autowindSetBlocked(
 5121        vtActive ? "virtual-tack"
 5122        : pypilotTack ? "pypilot-tack"
 5123        : manoeuvre ? "manoeuvre"
 5124        : twaNow == null || twsNow == null ? "no-wind-data"
 5125        : twsNow < AUTOWIND_MIN_TWS_KN ? "wind-too-light"
 5126        : null);
 5127      // Sailor (remote, TinyPilot, KIP) moved to compass/gps: AUTOWIND
 5128      // ends, like picking another mode in the visor. 5 s so a transient
 5129      // write race never switches it off.
 5130      // pypilot drops to compass on its own when it loses GPS / true wind
 5131      // (and returns when it is back): that is not the sailor leaving.
 5132      // Rev630 (Gemini audit 2026-11-05): only a tack, which passes through
 5133      // compass, suspends this check - a visor manoeuvre flag no longer does.
 5134      const trueWindAvailable = ((apProvider as any).pypilotModes || []).includes("true wind");
 5135      if (!vtActive && !pypilotTack && trueWindAvailable && mode !== "wind" && mode !== "true wind" && mode !== "") {
 5136        if (_autowindOffFamilySince == null) _autowindOffFamilySince = Date.now();
 5137        else if (Date.now() - _autowindOffFamilySince > 5000) {
 5138          _autowindOffFamilySince = null;
 5139          _autowindSetEnabled(false, `mode changed to ${mode}`);
 5140        }
 5141        return;
 5142      }
 5143      _autowindOffFamilySince = null;
 5144      if (_autowindInFlight > 0) return;   // a switch is still waiting on pypilot
 5145      const want = autowind.tick({
 5146        nowMs: Date.now(),
 5147        twaDeg: twaNow,
 5148        mode,
 5149        engaged: !!apProvider.data.engaged,
 5150        blocked,
 5151        twsKn: twsNow,
 5152        thresholdDeg: props.autowindThresholdDeg,
 5153      });
 5154      if (want) {
 5155        void _autowindApply(want, `TWA ${twaNow == null ? "?" : Math.abs(twaNow).toFixed(0)} deg`, true);
 5156      }
 5157    }
```

### src/autopilot-provider.ts lines 605-638 (provider setMode (start))

```ts
  605  
  606    private async setMode(mode: string): Promise<void> {
  607      // Rev547 (2026-10-25 22:14-22:16): pypilot accepts ap.mode="nav" even
  608      // without a route (no APB); the route follower then found NAV with no
  609      // route, went to compass and said "route lost" - twice. NAV only when
  610      // pypilot offers it (= an active route is feeding APB).
  611      if (String(mode).toLowerCase() === "nav" && !this.pypilotModes.includes("nav")) {
  612        throw new Error("NAV needs an active route (activate one in Freeboard first)");
  613      }
  614      // Rev390: same guard as setTarget — reject external mode changes
  615      // while the FSM is driving. If the sailor really wants to abort
  616      // the maneuver, they tap TACK a second time or call /virtual-tack/
  617      // cancel, which flows through cancelVirtualTack and rolls back
  618      // cleanly.
  619      if (this._virtualTack && !this._vtInternalWrite) {
  620        const active = this._virtualTack.phase !== "idle"
  621          && this._virtualTack.phase !== "completed"
  622          && this._virtualTack.phase !== "cancelled"
  623          && this._virtualTack.phase !== "failed";
  624        if (active) {
  625          // eslint-disable-next-line no-console
  626          console.log(`[virtual-tack] rejected external setMode '${mode}' (FSM is driving)`);
  627          // Rev630 (GPT audit 2026-11-05 F02): a refusal, not a silent return -
  628          // AUTOWIND took the return for success and changed the profile.
  629          // Same wording as setTarget's refusal.
  630          throw new Error("mode change refused: virtual tack is driving the pilot");
  631        }
  632      }
  633      if (
  634        this.data.options.modes.length > 0 &&
  635        !this.data.options.modes.includes(mode)
  636      ) {
  637        throw new Error(`Invalid mode: ${mode}`);
  638      }
```

### public/app.js lines 11378-11420 (visor: mode button)

```js
11378    // label (white). This is what the sailor reads at a glance.
11379    function _renderModeSelectBtn() {
11380      const btn = document.getElementById("mode-select-btn");
11381      if (!btn) return;
11382      btn.title = "";
11383      // Rev510 (Carlos sea trial 2026-10-18, 18:07-18:12: "la tablet decia
11384      // un modo y el telefono decia otro"): during a virtual tack pypilot is
11385      // in compass on purpose. Every visor shows the wind mode of the tack,
11386      // from the backend snapshot (same on every screen). Rev515 (Carlos
11387      // 2026-10-19): no "TACKING ->" prefix, it read as a new mode.
11388      const vt = state.virtualTack;
11389      if (vt && vt.active) {
11390        const txt = _modeLabel(vt.windMode || state.mode || "wind");
11391        if (btn.textContent !== txt) btn.textContent = txt;
11392        return;
11393      }
11394      // Rev632 (Carlos QA 2026-11-05: "Empopado dice REAL"): a running
11395      // Aproado / Empopado shows its own name, not pypilot's wind mode.
11396      for (const [man, label] of [[state.empopado, "empopado"], [state.aproado, "aproado"]]) {
11397        if (man && (man.phase === "transit" || man.phase === "active")) {
11398          btn.textContent = _modeLabel(label);
11399          return;
11400        }
11401      }
11402      const m = state.mode || "";
11403      // Rev518: AUTOWIND -> "AUTO · REAL" / "AUTO · APARENTE".
11404      if (state.autowind && state.autowind.enabled && (m === "wind" || m === "true wind")) {
11405        // Rev630 (sea trial 2026-11-05: "AUTO · REAL" was on screen while the
11406        // backend could not switch): say why it is waiting, if it is.
11407        const why = state.autowind.blockedReason;
11408        const whyKey = `autowind.blocked.${why}`;
11409        btn.textContent = `${t("autowind.short")} · ${_modeLabel(m)}${why ? ` (${t(whyKey)})` : ""}`;
11410        btn.title = state.autowind.lastError || "";
11411        return;
11412      }
11413      // Rev545: NAV -> "NAV · <waypoint> · 2.3 nm".
11414      if (m === "nav" && state.route && state.route.active) {
11415        const nm = typeof state.route.distanceM === "number" ? (state.route.distanceM / 1852).toFixed(1) : "?";
11416        btn.textContent = `${t("route.navShort")} · ${state.route.name || "WP"} · ${nm} nm`;
11417        return;
11418      }
11419      btn.textContent = m ? _modeLabel(m) : "—";
11420    }
```

### public/app.js lines 12218-12264 (visor: manoeuvre flag heartbeat)

```js
12218    } catch { /* silent */ }
12219    // Rev323 (Carlos, 2026-09-27): tell the backend a visor-side
12220    // pseudo-modo is active/inactive. Backend uses this to silence the
12221    // heading-deviation family of alarms during Aproado / Empopado. In
12222    // the sea trial 2026-09-27 alarms disparaban por doquier durante
12223    // esas maniobras porque `ap.tack.state` seguía en "none" y el gate
12224    // Rev311 no las cazaba.
12225    // Rev534: the backend forgets the flag after 60 s unless renewed, so a
12226    // closed browser cannot leave the alarms silenced. Renew every 20 s.
12227    // Rev630 (sea trial 2026-11-05): the flag belongs to one manoeuvre (its
12228    // id) and each renewal first checks that this manoeuvre is still in
12229    // transit / active. Closing the Empopado summary by hand used to leave
12230    // the renewal running for the rest of the session: AUTOWIND blocked and
12231    // the three steering alarms silenced for ~48 min.
12232    let _maneuverPseudoTimer = null;
12233    let _maneuverPseudoId = null;
12234    function _pseudoManeuverRunning(id) {
12235      for (const m of [state.aproado, state.empopado]) {
12236        if (m && m.id === id && (m.phase === "transit" || m.phase === "active")) return true;
12237      }
12238      return false;
12239    }
12240    function _setManeuverPseudo(active, id) {
12241      if (!active && id && _maneuverPseudoId && id !== _maneuverPseudoId) return;   // not ours
12242      try { if (_maneuverPseudoTimer) { clearInterval(_maneuverPseudoTimer); _maneuverPseudoTimer = null; } } catch { /* silent */ }
12243      if (active) {
12244        _maneuverPseudoId = id;
12245        _maneuverPseudoTimer = setInterval(() => {
12246          if (_pseudoManeuverRunning(id)) _postManeuverPseudo(true, id);
12247          else _setManeuverPseudo(false, id);
12248        }, 20000);
12249        _postManeuverPseudo(true, id);
12250      } else {
12251        const was = _maneuverPseudoId;
12252        _maneuverPseudoId = null;
12253        if (was) _postManeuverPseudo(false, was);
12254      }
12255    }
12256    function _postManeuverPseudo(active, id) {
12257      try {
12258        skFetch(`/plugins/${PLUGIN_ID}/maneuver-state`, {
12259          method: "POST",
12260          headers: { "Content-Type": "application/json" },
12261          body: JSON.stringify({ active: !!active, id }),
12262        }).catch(() => { /* silent - alarm gate is best-effort */ });
12263      } catch { /* silent */ }
12264    }
```

### public/app.js lines 12568-12575 (visor: aproadoExecute (start))

```js
12568  
12569    async function aproadoExecute() {
12570      const apr = state.aproado;
12571      if (!apr) return;
12572      // Rev323 (Carlos, 2026-09-27): flag pseudo-modo activo para
12573      // silenciar heading-deviation / cruise-drift / unable-to-steer
12574      // durante la maniobra.
12575      _setManeuverPseudo(true, apr.id);
```

### public/app.js lines 12770-12785 (visor: aproadoTearDown)

```js
12770    // (used when the user picks another mode from the dropdown while active).
12771    function aproadoTearDown() {
12772      const apr = state.aproado;
12773      if (!apr) return;
12774      _mtLog("aproado_teardown", { phase: apr.phase, direction: apr.direction });
12775      // Rev323: cerrar el gate pseudo-modo antes de nada; el backend
12776      // vuelve a evaluar heading-deviation con el umbral normal.
12777      _setManeuverPseudo(false, apr.id);
12778      if (apr._cdTimer) { clearInterval(apr._cdTimer); apr._cdTimer = null; }
12779      if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
12780      if (apr._summaryTimer) { clearTimeout(apr._summaryTimer); apr._summaryTimer = null; }
12781      hideAproadoHud();
12782      state.aproado = null;
12783      try { _renderModeSelectBtn(); } catch { /* silent */ }
12784    }
12785  
```

### public/app.js lines 12995-13004 (visor: empopadoExecute (start))

```js
12995    }
12996    async function empopadoExecute() {
12997      const ap = state.empopado;
12998      if (!ap) return;
12999      // Rev323 (Carlos, 2026-09-27): silenciar heading-deviation /
13000      // cruise-drift / unable-to-steer durante la maniobra.
13001      _setManeuverPseudo(true, ap.id);
13002      ap.phase = "transit";
13003      ap.executeTs = Date.now();
13004      ap.startTs = null;
```

### public/app.js lines 13180-13307 (visor: empopadoFinish, empopadoTearDown, empopadoClose)

```js
13180    }
13181    async function empopadoFinish(opts) {
13182      const ap = state.empopado;
13183      if (!ap || (ap.phase !== "active" && ap.phase !== "transit")) return;
13184      // Rev407 (Carlos sea trial 2026-10-03): default = no restore. The
13185      // sailor stays on whatever heading the AP ended up at after the
13186      // manoeuvre. Previously the default was true, which triggered an
13187      // automatic mode+target+engage restore to the pre-empopado state.
13188      // Carlos: "el salir del modo y volver a rumbo me parece peligrosísimo,
13189      // es casi mejor quedarnos en el rumbo que estamos. [...] nos quedamos
13190      // en ese rumbo" (sea trial 2026-10-03). The sailor explicitly opts in
13191      // by passing { restoreAll: true } if they want the old behaviour.
13192      const restoreAll = !!(opts && opts.restoreAll === true);
13193      const silent = !!(opts && opts.silent);
13194      if (ap._hudTimer) { clearInterval(ap._hudTimer); ap._hudTimer = null; }
13195      ap.endTs = Date.now();
13196      if (ap.startPos && state.position) {
13197        ap.distanceNm = _distanceNm(ap.startPos, state.position);
13198      }
13199      if (ap.startTs == null) ap.startTs = ap.endTs;
13200      ap.phase = silent ? "summary" : "summary";
13201      // Rev630 (sea trial 2026-11-05): the manoeuvre is over - stop the
13202      // "manoeuvre active" flag now, as aproadoFinish does. It used to wait
13203      // for the summary timer, which closing the summary by hand cancelled.
13204      _setManeuverPseudo(false, ap.id);
13205      const hud = _empopadoHud();
13206      if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
13207      _empopadoSetPhase("summary");
13208      updateEmpopadoHud();
13209      const snap = ap.snapshot;
13210      if (snap.mode) setSelect("#mode-select", snap.mode);
13211      // Rev320: restaurar gains hot ANTES del profile swap.
13212      // El profile swap sobrescribe todos los gains — si hacemos primero
13213      // el restore de nuestros hot gains y luego el profile restore, es
13214      // idempotente. Si el orden fuera al revés, el profile pondría los
13215      // gains del perfil original y nuestro restore (con valores ya
13216      // sobrescritos por el profile) los pisaría con valores viejos.
13217      await _empopadoRestoreHotGains(ap);
13218      // Perfil siempre restaura si lo swapeamos.
13219      if (ap._profileSwapped && snap.profile && snap.profile !== ap._profileSwapped) {
13220        try { await pluginRaw("profile", snap.profile); console.info(`empopado: profile restored → ${snap.profile}`); }
13221        catch (e) { console.warn("empopado: profile restore failed", e); }
13222      }
13223      if (restoreAll) {
13224        if (snap.mode) {
13225          try { await apSetMode(snap.mode); console.info(`empopado: mode restored → ${snap.mode}`); }
13226          catch (e) { console.warn("empopado: mode restore failed", e); }
13227        }
13228        if (typeof snap.targetRad === "number") {
13229          try { await apSetTargetRad(snap.targetRad); console.info(`empopado: target restored → ${snap.targetRad.toFixed(3)}`); }
13230          catch (e) { console.warn("empopado: target restore failed", e); }
13231        }
13232        if (snap.engaged === false && state.engaged) {
13233          try { await apDisengage(); console.info("empopado: AP disengaged (was OFF before empopado)"); }
13234          catch (e) { console.warn("empopado: disengage restore failed", e); }
13235        }
13236      } else {
13237        // Rev440 (Carlos 2026-10-10): salir dejando el pilot en "true wind"
13238        // es menos estable que compass para mantener el rumbo actual.
13239        // Conmutar a compass con target = heading actual: el barco se
13240        // queda EXACTAMENTE donde está pero bajo el modo seguro. Si no
13241        // hay sensor de heading, dejar como estaba.
13242        const curHdg = (typeof state.heading === "number") ? state.heading : null;
13243        if (curHdg != null) {
13244          try {
13245            await apSetModeAndWait("compass");
13246            await apSetTargetRad(curHdg);
13247            console.info(`empopado: safe-exit to compass @ ${(curHdg * RAD2DEG).toFixed(1)} deg (Rev440)`);
13248          } catch (e) {
13249            console.warn("empopado: safe-exit to compass failed", e);
13250          }
13251        } else {
13252          console.info("empopado: finish without restore (Rev407 default) — no heading sensor, leaving pilot where it is");
13253        }
13254      }
13255      // Auto-hide del summary igual que aproado (usa APROADO_SUMMARY_MS).
13256      // Rev630: close only - gains and profile were restored above; a second
13257      // restore 15 s later overwrote what the sailor had chosen meanwhile.
13258      ap._summaryTimer = setTimeout(() => { if (state.empopado === ap) empopadoClose(); }, APROADO_SUMMARY_MS);
13259    }
13260    function empopadoTearDown(opts) {
13261      const ap = state.empopado;
13262      if (!ap) return;
13263      _mtLog("empopado_teardown", { phase: ap.phase, direction: ap.direction, restoreAll: !!(opts && opts.restoreAll) });
13264      // Rev316: restore adicional si tearDown fue directo (sin pasar por
13265      // finish, ej. mode-select change durante active).
13266      const restoreAll = opts && opts.restoreAll === true;
13267      const snap = ap.snapshot || {};
13268      // Rev320: restaurar hot gains ANTES del profile (mismo orden que
13269      // empopadoFinish; ver comentario allí para el racional).
13270      // Rev539 (GPT review 5 #9): wait for the gain restore before switching
13271      // profile, or the last gains land on the original profile.
13272      // Rev630 (GPT audit 2026-11-05 F04): this runs after the sailor's next
13273      // choice may have landed (AUTOWIND writes its own profile). Restore
13274      // only while the profile is still the one the manoeuvre left.
13275      const swapped = ap._profileSwapped;
13276      const left = swapped || snap.profile;
13277      if (state.profile === left) {
13278        _empopadoRestoreHotGains(ap).catch(() => {}).then(() => {
13279          if (swapped && snap.profile && snap.profile !== swapped && state.profile === swapped) {
13280            try { pluginRaw("profile", snap.profile).catch(() => {}); } catch { /* silent */ }
13281          }
13282        });
13283      } else {
13284        console.info(`empopado: profile is now "${state.profile}", not "${left}": gains/profile not restored`);
13285      }
13286      if (restoreAll) {
13287        if (snap.mode) { try { apSetMode(snap.mode).catch(() => {}); } catch {} }
13288        if (typeof snap.targetRad === "number") { try { apSetTargetRad(snap.targetRad).catch(() => {}); } catch {} }
13289        if (snap.engaged === false && state.engaged) { try { apDisengage().catch(() => {}); } catch {} }
13290      }
13291      empopadoClose();
13292    }
13293    // Rev630 (sea trial 2026-11-05): ends the manoeuvre without touching
13294    // gains, profile or mode - the "manoeuvre active" flag, timers, HUD and
13295    // state. Every way out goes through here: the end of the summary, the
13296    // summary closed by hand, another mode chosen, the teardown above.
13297    function empopadoClose() {
13298      const ap = state.empopado;
13299      if (!ap) return;
13300      _setManeuverPseudo(false, ap.id);
13301      if (ap._hudTimer)     { clearInterval(ap._hudTimer);   ap._hudTimer = null; }
13302      if (ap._summaryTimer) { clearTimeout(ap._summaryTimer); ap._summaryTimer = null; }
13303      hideEmpopadoHud();
13304      state.empopado = null;
13305      try { _renderModeSelectBtn(); } catch { /* silent */ }
13306    }
13307  
```

### public/app.js lines 13315-13390 (visor: aproadoFinish)

```js
13315    // before pypilot's echo lands.
13316    async function aproadoFinish(opts) {
13317      const apr = state.aproado;
13318      if (!apr || (apr.phase !== "active" && apr.phase !== "transit")) return;
13319      if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
13320      apr.endTs = Date.now();
13321      if (apr.startPos && state.position) {
13322        apr.distanceNm = _distanceNm(apr.startPos, state.position);
13323      }
13324      // If we never reached the achieved phase, stamp startTs so the
13325      // summary shows a meaningful "0:00" instead of NaN.
13326      if (apr.startTs == null) apr.startTs = apr.endTs;
13327      apr.phase = "summary";
13328      // Rev539 (GPT review 5 #1): the manoeuvre is over - stop renewing the
13329      // "manoeuvre active" flag that silences the heading alarms.
13330      _setManeuverPseudo(false, apr.id);
13331      const hud = _aproadoHud();
13332      if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
13333      _setPhase("summary");
13334      updateAproadoHud();
13335      // Rev415 (Carlos sea trial 2026-10-04, obs #11): "hay que anular el
13336      // restituir rumbo cuando salimos de aproado o empopado porque es
13337      // peligroso". Default `restoreAll=false` matches what empopadoFinish
13338      // did since Rev407 R. Keep the opt-in for the (rare) case where the
13339      // sailor really wants the pre-aproado state back.
13340      const restoreAll = !!(opts && opts.restoreAll === true);
13341      // Optimistic dropdown update so UI does not stay stuck on "aproado".
13342      const snap = apr.snapshot;
13343      if (restoreAll) {
13344        if (snap.mode) setSelect("#mode-select", snap.mode);
13345        // Rev90: guard each step separately so one failure does not skip
13346        // the others. Log successes for QA visibility.
13347        if (snap.mode) {
13348          try { await apSetMode(snap.mode); console.info("aproado: mode restored ->", snap.mode); }
13349          catch (e) { console.warn("aproado: mode restore failed", e); }
13350        }
13351        if (snap.targetRad != null) {
13352          try { await apSetTargetRad(snap.targetRad); console.info("aproado: target restored ->", snap.targetRad.toFixed(3), "rad"); }
13353          catch (e) { console.warn("aproado: target restore failed", e); }
13354        }
13355        // If the AP was NOT engaged before aproado, disengage now (Rev88 #10).
13356        if (!snap.engaged) {
13357          try { await apDisengage(); console.info("aproado: AP disengaged (was OFF before aproado)"); }
13358          catch (e) { console.warn("aproado: disengage failed", e); }
13359        }
13360      } else {
13361        // Rev440 (Carlos 2026-10-10): "al salir queda en wind, mejor
13362        // compass por estabilidad de rumbo". aproadoStart puso el pilot
13363        // en modo "wind" para controlar AWA. Si no restauramos, el
13364        // barco se queda en wind indefinidamente — menos estable que
13365        // compass para mantener el rumbo actual. Fix: conmutar a
13366        // compass con target = heading actual, de modo que el pilot
13367        // sostenga EXACTAMENTE el rumbo donde quedó la maniobra pero
13368        // en el modo seguro. Si falta sensor de heading, dejar como
13369        // estaba (sin sacar al pilot de wind a ciegas).
13370        const curHdg = (typeof state.heading === "number") ? state.heading : null;
13371        if (curHdg != null) {
13372          try {
13373            await apSetModeAndWait("compass");
13374            await apSetTargetRad(curHdg);
13375            console.info(`aproado: safe-exit to compass @ ${(curHdg * RAD2DEG).toFixed(1)} deg (Rev440)`);
13376          } catch (e) {
13377            console.warn("aproado: safe-exit to compass failed", e);
13378          }
13379        } else {
13380          console.info("aproado: finish without restore (Rev415 default) — no heading sensor, leaving pilot where it is");
13381        }
13382      }
13383      apr._summaryTimer = setTimeout(() => {
13384        if (state.aproado === apr) {
13385          hideAproadoHud();
13386          state.aproado = null;
13387        }
13388      }, APROADO_SUMMARY_MS);
13389    }
13390  
```

### public/app.js lines 13933-13982 (visor: mode select handler (start))

```js
13933      // and never land on the mode-select's value).
13934      $("#mode-select").addEventListener("change", (e) => {
13935        _msCollapse();
13936        const chosen = e.target.value;
13937        // Picking another mode while a pseudo-mode is active ends the
13938        // maneuver WITHOUT restoring the pre-* mode (usuario ya
13939        // eligió qué quiere ahora). SÍ restaura el profile (Empopado).
13940        // Use the SALIR button on the HUD to return to the previous mode.
13941        // Rev630 (sea trial 2026-11-05): done first, so AUTOWIND and NAV
13942        // (which return early below) end it too, and a manoeuvre still
13943        // showing its summary is closed as well.
13944        if (chosen !== "aproado" && chosen !== "empopado") {
13945          const emp = state.empopado;
13946          if (emp && (emp.phase === "transit" || emp.phase === "active")) empopadoTearDown({ restoreAll: false });
13947          else if (emp && emp.phase === "summary") empopadoClose();
13948          const apr = state.aproado;
13949          if (apr && (apr.phase === "transit" || apr.phase === "active" || apr.phase === "summary")) aproadoTearDown();
13950        }
13951        // Rev518: pseudo-mode AUTOWIND lives in the backend.
13952        if (chosen === "autowind") {
13953          _autowindPost({ enabled: true });
13954          return;
13955        }
13956        if (state.autowind && state.autowind.enabled) {
13957          _autowindPost({ enabled: false });
13958        }
13959        // Rev545 (Carlos #4): NAV that would turn more than 60 deg asks first.
13960        if (chosen === "nav" && state.engaged && state.route && typeof state.route.legBearingDeg === "number" && typeof state.heading === "number") {
13961          const turn = Math.abs((((state.route.legBearingDeg - state.heading * RAD2DEG) % 360) + 540) % 360 - 180);
13962          if (turn > 60) {
13963            (async () => {
13964              const ok = await _pmConfirm(t("route.bigTurnQ").replace("{deg}", String(Math.round(turn))), t("route.bigTurnBody"));
13965              if (ok) apSetMode("nav");
13966              else setSelect("#mode-select", state.mode || "");
13967            })();
13968            return;
13969          }
13970        }
13971        // Rev88: pseudo-mode "aproado" is intercepted locally - opens the
13972        // choice modal (bow / stern) and starts the maneuver on confirmation.
13973        if (chosen === "aproado") {
13974          aproadoStart();
13975          return;
13976        }
13977        // Rev313 (Carlos sea trial 2026-09-25): pseudo-mode "empopado"
13978        // (viento por popa para bajar vela).
13979        if (chosen === "empopado") {
13980          empopadoStart();
13981          return;
13982        }
```

### public/app.js lines 14074-14113 (visor: HUD exit buttons)

```js
14074        if (cancelCd) cancelCd.addEventListener("click", () => aproadoCancel());
14075        const exitHandler = () => {
14076          const apr = state.aproado;
14077          if (!apr) return;
14078          if (apr.phase === "summary") {
14079            // Rev630: same close as every other way out (flag, timers, HUD).
14080            aproadoTearDown();
14081          } else if (apr.phase === "active" || apr.phase === "transit") {
14082            aproadoFinish();
14083          }
14084        };
14085        const exitBtn = document.getElementById("aproado-hud-end");
14086        if (exitBtn) exitBtn.addEventListener("click", exitHandler);
14087        const transitCancelBtn = document.getElementById("aproado-transit-cancel");
14088        if (transitCancelBtn) transitCancelBtn.addEventListener("click", exitHandler);
14089      }
14090  
14091      // Rev318: Empopado HUD wiring. Espejo del aproado (mismo CSS,
14092      // IDs propios, data-empopado-* atributos). Todo va a las funciones
14093      // empopado* correspondientes.
14094      const empopadoHud = document.getElementById("empopado-hud");
14095      if (empopadoHud) {
14096        empopadoHud.querySelectorAll('.aproado-choice[data-empopado-dir]').forEach((btn) => {
14097          btn.addEventListener("click", () => empopadoPick(btn.getAttribute("data-empopado-dir")));
14098        });
14099        const cancelChoose = document.getElementById("empopado-cancel-btn");
14100        if (cancelChoose) cancelChoose.addEventListener("click", () => empopadoCancel());
14101        const emExitHandler = () => {
14102          const emp = state.empopado;
14103          if (!emp) return;
14104          if (emp.phase === "summary") {
14105            // Rev630 (sea trial 2026-11-05): this branch cleared the state but
14106            // left the "manoeuvre active" renewal running.
14107            empopadoClose();
14108          } else if (emp.phase === "active" || emp.phase === "transit") {
14109            empopadoFinish();
14110          }
14111        };
14112        const emExitBtn = document.getElementById("empopado-hud-end");
14113        if (emExitBtn) emExitBtn.addEventListener("click", emExitHandler);
```
