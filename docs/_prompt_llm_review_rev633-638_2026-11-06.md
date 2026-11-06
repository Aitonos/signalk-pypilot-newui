# External review before publishing 3.12.0: Rev633-638 (AUTOWIND and manoeuvres)

Everything is in this one file. Paste the whole file into the LLM; ask for
the answer in Spanish if Carlos will read it directly.

You (or another reviewer) already reviewed Rev630-632. That review found
10 problems (GPT, R01-R10) plus 4 (Gemini). Rev633 fixed them; Rev634-638
fixed what harbour tests found afterwards. **This review covers only
Rev633-638.**

---

## Task

You are a senior reviewer of safety-relevant marine software. The plugin
drives a **pypilot autopilot on a sailing boat**. This is the last review
before publishing.

1. For each change listed below, say whether it is correct and complete,
   citing lines.
2. Find regressions and new bugs in the changed code paths:
   - races between visors, the backend and pypilot;
   - an order sent to the pilot when it should not be, or not sent when
     it should be;
   - a safety alarm left silent;
   - state left behind after reloads, closed tabs or a second device.
3. Say what, if anything, must be fixed **before** publishing, and what
   can wait.

For each finding give severity (high / medium / low), the exact lines, a
concrete scenario and the smallest fix. Mark it **follows from the
code** or **hypothesis**. No style comments. Do not re-report the
accepted limits listed below unless you show they are worse than stated.

## System

- A Raspberry Pi 5 runs Signal K and this plugin.
- The autopilot is a TinyPilot (pypilot on a Pi Zero W), reached over
  TCP.
- pypilot modes: `compass`, `gps`, `wind` (AWA) and `true wind` (TWA).
- **Measured on the boat (2026-11-06):** when `ap.mode` changes, pypilot
  keeps the heading **error** it had. It does **not** re-centre the target
  on the current wind angle.
- The backend is `src/*.ts`. The browser UI is the "visor",
  `public/app.js`; several phones, tablets or laptops can be open at once.
- The visor runs two pseudo-modes:
  - **Aproado**: bow to the wind, in `wind` mode, target AWA 0.
  - **Empopado**: stern to the wind, in `true wind` mode, target TWA
    180. Empopado also raises some gains temporarily.
- While one runs, the visor tells the backend "manoeuvre running"
  (`POST /maneuver-state {active, id}`, renewed every 20 s, TTL 180 s).
  It blocks AUTOWIND and silences the heading-deviation, cruise-drift
  and unable-to-steer alarms.
- **AUTOWIND** runs in the backend and switches `wind` ↔ `true wind` by
  TWA.
- A **stuck-pilot recovery** in the backend can take the AP off and on in
  under a second.

## Changes to review

### Rev633: fixes for the review of Rev630-632

- **Provider:**
  - `setModeIfWanted(mode, stillWanted)`: no retry goes out once the
    caller no longer wants the mode (R01).
  - Virtual-tack writes are `internal` per call. The shared
    `_vtInternalWrite` flag, held across an `await`, is gone (R07).
- **AUTOWIND:**
  - A mode switch counts as done only when pypilot echoes the mode,
    within 3 s (R02).
  - Switching on during a tack or manoeuvre is refused with HTTP 409
    (R06). Without usable true wind it starts in apparent on purpose.
  - A profile pypilot did not take is retried every 10 s, up to 5 times,
    unless the sailor picked another profile (R09).
  - Switching on from the visor passes `fromTick = true`, so a failure
    feeds the retry wait.
- **Visor manoeuvres:**
  - Execute and Finish stop at every `await` once the manoeuvre was
    closed (R03).
  - Empopado records each original gain before raising it, stops raising
    once the manoeuvre ended or the profile changed, and checks the
    profile before every restore write (R04/R05).
  - Choosing Aproado ends Empopado and vice versa (R10).
  - After ending a manoeuvre, a wind mode or AUTOWIND starts on the
    current wind angle (Gemini 2.1).
  - An "off" for an id that no longer owns the heartbeat still reaches
    the backend (Gemini 2.3).
- **ManeuverGate:** an ended id is remembered for one TTL, so a late
  renewal cannot reopen it (R08).

### Rev634: manoeuvres across devices

- The backend publishes `steering.autopilot.maneuver` (`"aproado" |
  "empopado" | "manoeuvre" | null`), worked out from the id prefix. Every
  visor's mode button shows the manoeuvre's name.
- The visor that runs a manoeuvre ends it when pypilot, after reaching
  the manoeuvre's mode, reports another mode or the AP off. It does not
  touch mode or target, because whoever left chose them.
- AUTOWIND's waiting reason is shown on a small second line of the mode
  button.

### Rev635: a sub-second AP off is not "left"

- The AP off ends a manoeuvre only after 3 s off. A different mode still
  ends it at once.

### Rev636: AUTOWIND starts on the current wind angle

- On switch-on with the AP engaged, the backend sets the target to the
  current AWA or TWA of the mode it starts in, with or without a mode
  change (`_autowindHoldCurrentAngle`):
  - after a mode change, waits 400 ms;
  - writes;
  - checks at 1.2 s and rewrites once if pypilot overwrote it;
  - a newer AUTOWIND order or "off" stops it.
- The refusal message is a full sentence in ES/EN/DE/FR.

### Rev637

- Every `steering.autopilot.engaged` delta runs the "left from outside"
  check, not only a change. The visor's own AP button sets
  `state.engaged` before pypilot's echo.

### Rev638: orphaned manoeuvres

- `ManeuverGate.reconcile()`, run every second, ends an `apr-`/`emp-`
  entry when pypilot has been out of its mode (`wind` / `true wind`) or
  off for 3 s, after a 10 s start grace. An ended id cannot be reopened.
- The visor's 20 s heartbeat also ends a local manoeuvre pypilot left,
  as a second chance when the 3 s timer did not run (background tab).

## Evidence

- 490 tests pass (`npm test`, exit code 0).
- **Tests added for these changes:**
  - provider: retry cancelled with `setModeIfWanted`; an outside call
    during an internal retry is refused;
  - gate: late messages, `kind()`, `reconcile()`;
  - visor (real functions extracted from `app.js`, fake timers): hot
    gains, left-from-outside with the 3 s grace, the recovery cycle,
    the selector ending Aproado ↔ Empopado.
- `gain-watchdog.test` is a known intermittent test (timing) and is
  unrelated to these changes.
- **Harbour QA by Carlos on the boat's Pi (2026-11-06), wind ~1-4 kn,
  all passed and checked in the server journal and visor trace:**
  - Aproado → AUTOWIND;
  - Empopado → Aproado;
  - Empopado SALIR, then summary closed, then compass;
  - AUTOWIND refused from a second device during an Empopado;
  - Empopado ended from the tablet closes the laptop's window;
  - AP off from the same visor (3 s);
  - visor reloaded mid-Aproado → backend ended it after 10 s + 3 s;
  - AUTOWIND on with the target 60° off the wind → target moved to the
    current wind.
- Not yet tested under sail.

## Accepted limits (no need to report)

- If the sailor changes profile in the middle of Empopado's gain
  restore, the gains not yet restored stay raised in the profile the
  manoeuvre left. They are not written into the new one.
- AUTOWIND counts a profile as done when pypilot accepts the write; it
  does not wait for the profile's echo. The mode does wait for its echo.
- There are no integration tests against a simulated pypilot over TCP.
- Out of scope for 3.12.0:
  - the backend's own re-anchor after compass ↔ wind changes (it reads
    values the plugin does not subscribe to, so it never acts);
  - the gust D-boost persistence and its 3 s settle;
  - the ±10 button crossing ±180° in wind modes;
  - the minimum wind for wind modes.

## Diff since the reviewed Rev632 (src and public)

```diff
diff --git a/public/app.js b/public/app.js
index 3d1ee05..81db155 100644
--- a/public/app.js
+++ b/public/app.js
@@ -531,6 +531,9 @@
       "autowind.blocked.manoeuvre": "manoeuvre",
       "autowind.blocked.no-wind-data": "no wind data",
       "autowind.blocked.wind-too-light": "wind too light",
+      "autowind.refused": "AUTOWIND not started",
+      "autowind.refusedBody.manoeuvre": "A head-to-wind or dead-downwind manoeuvre is running, maybe on another screen. End it and choose AUTOWIND again.",
+      "autowind.refusedBody.tack": "A tack is in progress. When it is done, choose AUTOWIND again.",
       "mode.label.nav":       "NAV (ROUTE)",
       "mode.label.aproado":   "HEAD TO WIND",
       "mode.label.empopado":    "DEAD DOWNWIND",
@@ -1676,6 +1679,9 @@
       "autowind.blocked.manoeuvre": "maniobra",
       "autowind.blocked.no-wind-data": "sin datos de viento",
       "autowind.blocked.wind-too-light": "viento flojo",
+      "autowind.refused": "AUTOWIND no arrancado",
+      "autowind.refusedBody.manoeuvre": "Hay un Aproado o un Empopado en marcha, quizá en otra pantalla. Termínalo y vuelve a elegir AUTOWIND.",
+      "autowind.refusedBody.tack": "Hay una virada en curso. Cuando termine, vuelve a elegir AUTOWIND.",
       "mode.label.nav":       "NAV (RUTA)",
       "mode.label.aproado":   "APROADO",
       "mode.label.empopado":    "EMPOPADO",
@@ -2904,6 +2910,9 @@
       "autowind.blocked.manoeuvre": "Manöver",
       "autowind.blocked.no-wind-data": "keine Winddaten",
       "autowind.blocked.wind-too-light": "Wind zu schwach",
+      "autowind.refused": "AUTOWIND nicht gestartet",
+      "autowind.refusedBody.manoeuvre": "Ein Aufschießen oder Platt-vor-dem-Wind läuft, vielleicht auf einem anderen Bildschirm. Beende es und wähle AUTOWIND erneut.",
+      "autowind.refusedBody.tack": "Eine Wende läuft. Wenn sie fertig ist, wähle AUTOWIND erneut.",
       "mode.label.empopado": "PLATT VOR DEM WIND",
       "net.warn": "Netz unterbrochen",
       "net.ok": "Netz OK",
@@ -4024,6 +4033,9 @@
       "autowind.blocked.manoeuvre": "manœuvre",
       "autowind.blocked.no-wind-data": "pas de données de vent",
       "autowind.blocked.wind-too-light": "vent trop faible",
+      "autowind.refused": "AUTOWIND non démarré",
+      "autowind.refusedBody.manoeuvre": "Une manœuvre face au vent ou plein vent arrière est en cours, peut-être sur un autre écran. Terminez-la et choisissez de nouveau AUTOWIND.",
+      "autowind.refusedBody.tack": "Un virement est en cours. Quand il est terminé, choisissez de nouveau AUTOWIND.",
       "mode.label.empopado": "PLEIN VENT ARRIÈRE",
       "net.warn": "Réseau intermittent",
       "net.ok": "Réseau OK",
@@ -5144,6 +5156,7 @@
       // Rev518: AUTOWIND state (enabled, sub-mode, profile pair).
       "steering.autopilot.autowind",
       "steering.autopilot.route",   // Rev545
+      "steering.autopilot.maneuver", // Rev634: manoeuvre run by any visor
       "steering.autopilot.pypilot.ap.tack.state",
       "steering.autopilot.pypilot.ap.tack.direction",
       "steering.autopilot.pypilot.ap.mode",
@@ -5343,6 +5356,7 @@
         // Self-audit Rev541: the mode pypilot really reported (state.mode
         // can be set optimistically by the selector before the echo).
         state._confirmedMode = value;
+        _endLocalManeuverIfLeft();
         // Rev425: keep the visible mode-button in sync on external
         // mode deltas.
         try { _renderModeSelectBtn(); } catch { /* silent */ }
@@ -5381,6 +5395,11 @@
         try { _routeOnUpdate(); } catch { /* silent */ }
         break;
       }
+      case "steering.autopilot.maneuver": {
+        state.remoteManeuver = typeof value === "string" ? value : null;
+        try { _renderModeSelectBtn(); } catch { /* silent */ }
+        break;
+      }
       case "steering.autopilot.autowind": {
         state.autowind = (value && typeof value === "object") ? value : null;
         try { _renderModeSelectBtn(); } catch { /* silent */ }
@@ -5541,6 +5560,11 @@
         // trasluchada". Any active countdown must be aborted when the
         // AP flips to disengaged - the maneuver cannot continue
         // without pilot authority.
+        // Rev637 (Carlos QA 2026-11-06 17:27): on every engaged delta, not
+        // only on a change - the visor's own AP button sets state.engaged
+        // before pypilot's echo, so the echo was no change and the
+        // Empopado window stayed open. The check is idempotent.
+        _endLocalManeuverIfLeft();
         if (wasEngaged && !state.engaged) {
           try {
             const overlay = document.getElementById("tack-countdown-overlay");
@@ -11399,14 +11423,27 @@
         return;
       }
     }
+    // Rev634 (Carlos QA 2026-11-06): a manoeuvre run from another visor.
+    if (!state.empopado && !state.aproado && (state.remoteManeuver === "empopado" || state.remoteManeuver === "aproado")) {
+      btn.textContent = _modeLabel(state.remoteManeuver);
+      return;
+    }
     const m = state.mode || "";
     // Rev518: AUTOWIND -> "AUTO · REAL" / "AUTO · APARENTE".
     if (state.autowind && state.autowind.enabled && (m === "wind" || m === "true wind")) {
       // Rev630 (sea trial 2026-11-05: "AUTO · REAL" was on screen while the
       // backend could not switch): say why it is waiting, if it is.
+      // Rev634 (Carlos QA 2026-11-06: "no cabe en el botón"): the reason
+      // goes on a small second line.
       const why = state.autowind.blockedReason;
       const whyKey = `autowind.blocked.${why}`;
-      btn.textContent = `${t("autowind.short")} · ${_modeLabel(m)}${why ? ` (${t(whyKey)})` : ""}`;
+      btn.textContent = `${t("autowind.short")} · ${_modeLabel(m)}`;
+      if (why) {
+        const sub = document.createElement("span");
+        sub.className = "mode-btn-why";
+        sub.textContent = t(whyKey);
+        btn.appendChild(sub);
+      }
       btn.title = state.autowind.lastError || "";
       return;
     }
@@ -11485,6 +11522,16 @@
         state.autowind = await r.json();
         _renderModeSelectBtn();
         _rebuildModePopupProfiles();
+      } else if (r.status === 409) {
+        // Rev633: a tack or a manoeuvre is running - AUTOWIND did not start.
+        const j = await r.json().catch(() => ({}));
+        state.autowind = j && typeof j === "object" ? j : state.autowind;
+        setSelect("#mode-select", state.mode || "");
+        // Rev636 (Carlos QA 2026-11-06: "vaya mensaje más cutre"): a full
+        // sentence that says what is running and what to do.
+        const why = j && j.refused;
+        const bodyKey = why === "manoeuvre" ? "autowind.refusedBody.manoeuvre" : "autowind.refusedBody.tack";
+        _pmAlert(t("autowind.refused"), t(bodyKey));
       }
     } catch (e) { console.warn("[autowind] post", e); }
   }
@@ -12231,6 +12278,42 @@
   // the three steering alarms silenced for ~48 min.
   let _maneuverPseudoTimer = null;
   let _maneuverPseudoId = null;
+  // Rev634 (Carlos QA 2026-11-06, 01:14: Empopado ended from the tablet,
+  // this laptop kept its window open): a manoeuvre is left when pypilot,
+  // after reaching the manoeuvre's mode, reports another mode or the AP
+  // off - from a remote, KIP or another visor. It ends here too, without
+  // touching mode or target (whoever left chose them). Empopado still
+  // restores its temporary gains/profile if the profile is still its own.
+  // Rev635 (Carlos QA 2026-11-06 16:42): the AP off counts only when it
+  // lasts - the backend's own stuck-pilot recovery takes it off and on in
+  // under a second, and that ended an Empopado. Another mode counts at once.
+  const MANEUVER_AP_OFF_GRACE_MS = 3000;
+  function _endLocalManeuverIfLeft() {
+    const pairs = [[state.empopado, "true wind"], [state.aproado, "wind"]];
+    for (const [man, own] of pairs) {
+      if (!man || (man.phase !== "transit" && man.phase !== "active")) continue;
+      if (state.mode === own && state.engaged) { man._modeReached = true; continue; }
+      if (!man._modeReached) continue;   // still on its way in
+      if (state.mode === own && !state.engaged) {
+        if (!man._apOffTimer) {
+          man._apOffTimer = setTimeout(() => {
+            man._apOffTimer = null;
+            if (!state.engaged) _endManeuverHere(man, own);
+          }, MANEUVER_AP_OFF_GRACE_MS);
+        }
+        continue;
+      }
+      _endManeuverHere(man, own);
+    }
+  }
+  function _endManeuverHere(man, own) {
+    if (man !== state.empopado && man !== state.aproado) return;
+    if (man.phase !== "transit" && man.phase !== "active") return;
+    if (man._apOffTimer) { clearTimeout(man._apOffTimer); man._apOffTimer = null; }
+    console.info(`[${own === "wind" ? "aproado" : "empopado"}] left from outside (mode=${state.mode}, engaged=${state.engaged}): ending here`);
+    if (man === state.empopado) empopadoTearDown({ restoreAll: false });
+    else aproadoTearDown();
+  }
   function _pseudoManeuverRunning(id) {
     for (const m of [state.aproado, state.empopado]) {
       if (m && m.id === id && (m.phase === "transit" || m.phase === "active")) return true;
@@ -12238,11 +12321,18 @@
     return false;
   }
   function _setManeuverPseudo(active, id) {
-    if (!active && id && _maneuverPseudoId && id !== _maneuverPseudoId) return;   // not ours
+    // Not the manoeuvre the heartbeat renews: end its own backend entry
+    // only (Rev633, Gemini re-audit 2026-11-06).
+    if (!active && id && _maneuverPseudoId && id !== _maneuverPseudoId) { _postManeuverPseudo(false, id); return; }
     try { if (_maneuverPseudoTimer) { clearInterval(_maneuverPseudoTimer); _maneuverPseudoTimer = null; } } catch { /* silent */ }
     if (active) {
       _maneuverPseudoId = id;
       _maneuverPseudoTimer = setInterval(() => {
+        // Rev638: second chance for the "left from outside" check, in case
+        // its 3 s timer did not run (tab in the background).
+        for (const [man, own] of [[state.empopado, "true wind"], [state.aproado, "wind"]]) {
+          if (man && man.id === id && man._modeReached && (state.mode !== own || !state.engaged)) _endManeuverHere(man, own);
+        }
         if (_pseudoManeuverRunning(id)) _postManeuverPseudo(true, id);
         else _setManeuverPseudo(false, id);
       }, 20000);
@@ -12881,10 +12971,21 @@
       );
     }
   }
+  // Rev633 (GPT re-audit 2026-11-06 R05): the manoeuvre is still running
+  // and on the profile the gains were raised in.
+  function _empopadoHotGainsOwned(ap) {
+    return state.empopado === ap && (ap.phase === "transit" || ap.phase === "active")
+      && state.profile === ap._hotGainProfile;
+  }
   async function _empopadoApplyHotGains(ap) {
     if (!ap || ap._hotGainSnapshot) return;
     const pilot = state.pilot;
     if (!pilot) return;
+    // Rev633: the original of each gain is recorded BEFORE it is raised,
+    // so a manoeuvre ended half way restores what was already sent; and no
+    // further gain is raised once it ended or the profile changed.
+    ap._hotGainProfile = state.profile;
+    ap._hotGainSnapshot = {};
     const cat = state.catalog || {};
     const vals = state.pypilotValues || {};
     const targets = [
@@ -12901,6 +13002,8 @@
       const max = typeof entry?.max === "number" ? entry.max : Infinity;
       const next = Math.min(cur * t.mult, max);
       if (Math.abs(next - cur) < 1e-6) continue;
+      if (!_empopadoHotGainsOwned(ap)) { console.info("empopado: ended or profile changed - no more hot gains"); break; }
+      ap._hotGainSnapshot[t.path] = cur;
       try {
         const resp = await pluginRaw(t.path, next);
         if (resp && resp.ok === false) {
@@ -12915,7 +13018,6 @@
         console.warn(`empopado: hot gain ${t.path} apply failed`, e);
       }
     }
-    ap._hotGainSnapshot = applied;
     const appliedCount = Object.keys(applied).length;
     if (appliedCount === 0) {
       console.warn(`[empopado] hot gains NO aplicadas — pilot='${pilot}' valsKeys=${Object.keys(vals).length} anyFailed=${anyFailed}`);
@@ -12931,6 +13033,12 @@
       return;
     }
     for (const [path, val] of Object.entries(snap)) {
+      // Rev633 (GPT re-audit 2026-11-06 R04): checked before EVERY write -
+      // an old gain is never written into a profile chosen meanwhile.
+      if (ap._hotGainProfile !== undefined && state.profile !== ap._hotGainProfile) {
+        console.warn(`empopado: profile is now "${state.profile}", not "${ap._hotGainProfile}": ${path} and the rest left as they are`);
+        break;
+      }
       try {
         await pluginRaw(path, val);
         console.info(`empopado: hot gain ${path} restored → ${val.toFixed(3)}`);
@@ -13020,6 +13128,12 @@
         ap._profileSwapped = reactive;
         console.info(`empopado: profile swapped ${ap.snapshot.profile} → ${reactive} (reactive)`);
       } catch (e) { console.warn("empopado: profile swap failed", e); }
+      // Rev633 (GPT re-audit 2026-11-06 R03): ended while swapping: put the
+      // profile back and send nothing else.
+      if (state.empopado !== ap || ap.phase !== "transit") {
+        if (ap._profileSwapped && ap.snapshot.profile) { try { pluginRaw("profile", ap.snapshot.profile).catch(() => {}); } catch { /* silent */ } }
+        return;
+      }
     }
     try {
       // Rev367 (Carlos, 2026-09-30, sea-trial feedback): empopado
@@ -13215,10 +13329,14 @@
     // gains del perfil original y nuestro restore (con valores ya
     // sobrescritos por el profile) los pisaría con valores viejos.
     await _empopadoRestoreHotGains(ap);
+    // Rev633 (GPT re-audit 2026-11-06 R03): closed (or another mode chosen)
+    // while restoring: the sailor's choice stands, nothing more is sent.
+    if (state.empopado !== ap) return;
     // Perfil siempre restaura si lo swapeamos.
-    if (ap._profileSwapped && snap.profile && snap.profile !== ap._profileSwapped) {
+    if (ap._profileSwapped && snap.profile && snap.profile !== ap._profileSwapped && state.profile === ap._profileSwapped) {
       try { await pluginRaw("profile", snap.profile); console.info(`empopado: profile restored → ${snap.profile}`); }
       catch (e) { console.warn("empopado: profile restore failed", e); }
+      if (state.empopado !== ap) return;
     }
     if (restoreAll) {
       if (snap.mode) {
@@ -13243,6 +13361,7 @@
       if (curHdg != null) {
         try {
           await apSetModeAndWait("compass");
+          if (state.empopado !== ap) return;   // Rev633 R03
           await apSetTargetRad(curHdg);
           console.info(`empopado: safe-exit to compass @ ${(curHdg * RAD2DEG).toFixed(1)} deg (Rev440)`);
         } catch (e) {
@@ -13371,6 +13490,7 @@
       if (curHdg != null) {
         try {
           await apSetModeAndWait("compass");
+          if (state.aproado !== apr) return;   // Rev633 R03: closed meanwhile
           await apSetTargetRad(curHdg);
           console.info(`aproado: safe-exit to compass @ ${(curHdg * RAD2DEG).toFixed(1)} deg (Rev440)`);
         } catch (e) {
@@ -13941,16 +14061,32 @@
       // Rev630 (sea trial 2026-11-05): done first, so AUTOWIND and NAV
       // (which return early below) end it too, and a manoeuvre still
       // showing its summary is closed as well.
-      if (chosen !== "aproado" && chosen !== "empopado") {
+      // Rev633 (GPT R10 / Gemini 2.2, re-audit 2026-11-06): Aproado ends an
+      // Empopado and vice versa - only one manoeuvre at a time.
+      let endedManoeuvre = false;
+      if (chosen !== "empopado") {
         const emp = state.empopado;
-        if (emp && (emp.phase === "transit" || emp.phase === "active")) empopadoTearDown({ restoreAll: false });
-        else if (emp && emp.phase === "summary") empopadoClose();
+        if (emp && (emp.phase === "transit" || emp.phase === "active")) { empopadoTearDown({ restoreAll: false }); endedManoeuvre = true; }
+        else if (emp) empopadoClose();
+      }
+      if (chosen !== "aproado") {
         const apr = state.aproado;
-        if (apr && (apr.phase === "transit" || apr.phase === "active" || apr.phase === "summary")) aproadoTearDown();
+        if (apr && (apr.phase === "transit" || apr.phase === "active")) { aproadoTearDown(); endedManoeuvre = true; }
+        else if (apr) aproadoTearDown();
       }
+      // Rev633 (Gemini 2.1): the manoeuvre left pypilot on its extreme
+      // target (AWA 0 / TWA 180). Going on in a wind mode (AUTOWIND
+      // included) holds the wind angle the boat has NOW instead.
+      const endedOnWindTarget = endedManoeuvre && (state.mode === "wind" || state.mode === "true wind");
       // Rev518: pseudo-mode AUTOWIND lives in the backend.
       if (chosen === "autowind") {
-        _autowindPost({ enabled: true });
+        (async () => {
+          if (endedOnWindTarget) {
+            const now = state.mode === "true wind" ? state.windAngleTrue : state.windAngle;
+            if (typeof now === "number") { try { await apSetTargetRad(now); } catch (e) { console.warn("[mode-select] hold wind angle", e); } }
+          }
+          _autowindPost({ enabled: true });
+        })();
         return;
       }
       if (state.autowind && state.autowind.enabled) {
@@ -14009,7 +14145,10 @@
       // painted as a 49 deg compass heading). Reajustar SIEMPRE.
       const familyChanged = wasWindFam !== !isNewCompassFam;
       let newTargetRad = null;
-      if (familyChanged) {
+      // Rev633 (Gemini 2.1): after a manoeuvre, a wind mode also starts on
+      // the angle the boat has now, not on the manoeuvre's AWA 0 / TWA 180.
+      const reanchor = familyChanged || (endedOnWindTarget && !isNewCompassFam);
+      if (reanchor) {
         if (isNewTrueWind && state.windAngleTrue != null) newTargetRad = state.windAngleTrue;
         else if (isNewWind && state.windAngle != null)    newTargetRad = state.windAngle;
         else if (isNewCompassFam && state.heading != null) newTargetRad = state.heading;
@@ -14021,7 +14160,7 @@
       // for a short window (see applyValue mode handler).
       _modeChangePendingUntil = Date.now() + 1500;
       _modeChangeChosen = chosen;
-      if (familyChanged) {
+      if (reanchor) {
         // Snap the visor first so the diamond never renders the
         // stale value under the new mode. Then fire mode + target
         // together to pypilot.
diff --git a/public/index.html b/public/index.html
index 497a32c..627d2eb 100644
--- a/public/index.html
+++ b/public/index.html
@@ -27,7 +27,7 @@
        style.css never shows the rose unstyled on a white page. The rose
        is hidden until style.css (loaded below) makes it visible again. -->
   <style>html,body{background:#0a1220;color:#e6edf3}#wind-rose{visibility:hidden}</style>
-  <link rel="stylesheet" href="style.css?v=Rev632" />
+  <link rel="stylesheet" href="style.css?v=Rev638" />
 </head>
 <body class="theme-dark">
   <!-- Rev490 (GPU audit 2026-10-15): flag the Raspberry Pi's own screen
@@ -2813,6 +2813,6 @@
     </div>
   </div>
 
-  <script src="app.js?v=Rev632"></script>
+  <script src="app.js?v=Rev638"></script>
 </body>
 </html>
diff --git a/public/style.css b/public/style.css
index 1b9b9f4..9a3662b 100644
--- a/public/style.css
+++ b/public/style.css
@@ -1083,6 +1083,18 @@ body.nav-hidden .nav-toggle .tri { transform: rotate(180deg); }
   border-radius: 6px;
   cursor: pointer;
 }
+/* Rev634 (Carlos QA 2026-11-06): why AUTOWIND waits, small, under the mode. */
+.mode-select-btn .mode-btn-why {
+  display: block;
+  font-size: 0.6em;
+  font-weight: 500;
+  line-height: 1.1;
+  margin-top: 3px;
+  color: var(--warn);
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+}
 /* Rev427 (Carlos QA Rev426): "es mejor que se abra una ventana grande
    centrada". Backdrop fills the viewport; card is centered via flex.
    Works consistently at 80% zoom laptop + phone portrait + tablet
diff --git a/src/autopilot-provider.ts b/src/autopilot-provider.ts
index 2ca93f5..29cdefe 100644
--- a/src/autopilot-provider.ts
+++ b/src/autopilot-provider.ts
@@ -603,7 +603,18 @@ export class AutopilotProvider {
     try { (this._engagedReconcileTimer as any).unref?.(); } catch { /* silent */ }
   }
 
-  private async setMode(mode: string): Promise<void> {
+  /** Rev633 (GPT re-audit 2026-11-06 R01): a mode switch that only stands
+   *  while `stillWanted()` says so - checked before the write and before
+   *  every retry. AUTOWIND uses it, so turning AUTOWIND off stops a retry
+   *  that has not gone out yet. */
+  async setModeIfWanted(mode: string, stillWanted: () => boolean): Promise<void> {
+    return this.setMode(mode, false, stillWanted);
+  }
+
+  // Rev633 (GPT re-audit 2026-11-06 R07): `internal` marks the virtual
+  // tack's own writes, per call. It used to be a shared flag held across
+  // an await, and an outside call arriving during a retry inherited it.
+  private async setMode(mode: string, internal = false, stillWanted?: () => boolean): Promise<void> {
     // Rev547 (2026-10-25 22:14-22:16): pypilot accepts ap.mode="nav" even
     // without a route (no APB); the route follower then found NAV with no
     // route, went to compass and said "route lost" - twice. NAV only when
@@ -616,7 +627,7 @@ export class AutopilotProvider {
     // the maneuver, they tap TACK a second time or call /virtual-tack/
     // cancel, which flows through cancelVirtualTack and rolls back
     // cleanly.
-    if (this._virtualTack && !this._vtInternalWrite) {
+    if (this._virtualTack && !internal) {
       const active = this._virtualTack.phase !== "idle"
         && this._virtualTack.phase !== "completed"
         && this._virtualTack.phase !== "cancelled"
@@ -657,7 +668,10 @@ export class AutopilotProvider {
     const gen = ++this.modeGen;
     // Rev254 (Carlos audit): fail explicit when pypilot offline.
     // Rev255: retry with backoff.
-    if (!(await this._setWithRetry("ap.mode", mode, () => this.modeGen !== gen))) {
+    const unwanted = () => !!stillWanted && !stillWanted();
+    if (unwanted()) throw new Error("mode change no longer wanted");
+    if (!(await this._setWithRetry("ap.mode", mode, () => this.modeGen !== gen || unwanted()))) {
+      if (unwanted()) throw new Error("mode change no longer wanted");
       if (this.modeGen !== gen) {
         throw new Error("mode change superseded by newer order");
       }
@@ -672,7 +686,7 @@ export class AutopilotProvider {
     // wind-family crossings trigger the re-anchor).
     if (this.data.engaged) {
       try {
-        if (this._reAnchorTargetAfterModeChange(oldMode, newMode)) {
+        if (this._reAnchorTargetAfterModeChange(oldMode, newMode, internal)) {
           void this._verifyReAnchor(mode, oldMode, newMode);
         }
       } catch (e: any) {
@@ -718,7 +732,7 @@ export class AutopilotProvider {
     } catch { /* best-effort */ }
   }
 
-  private _reAnchorTargetAfterModeChange(oldMode: string, newMode: string): boolean {
+  private _reAnchorTargetAfterModeChange(oldMode: string, newMode: string, internal = false): boolean {
     // Rev407 (Carlos sea trial 2026-10-03, audit O): respect the virtual
     // tack's internal-write flag. If the FSM is driving the pilot, the
     // re-anchor would write ap.heading_command = currentHeading right
@@ -727,7 +741,7 @@ export class AutopilotProvider {
     // "doesn't move the first 1-2 s of the VT" because pypilot IS obeying
     // — just not us. Skip re-anchor during VT; the FSM manages the target
     // explicitly after every setMode.
-    if (this._vtInternalWrite) {
+    if (internal) {
       // eslint-disable-next-line no-console
       console.log(`[apProvider.setMode] skip re-anchor: FSM driving`);
       return false;
@@ -750,21 +764,18 @@ export class AutopilotProvider {
     return true;
   }
 
-  /** Rev390: internal flag set by _runVirtualTack around its own
-   *  setMode/setTarget calls, so the external-write guard below can
-   *  distinguish our FSM's writes from frontend writes (nudges,
-   *  adjust target, legacy countdown) that would compete with the
-   *  maneuver. */
-  private _vtInternalWrite = false;
-
-  private async setTarget(rad: number): Promise<void> {
+  /** Rev390: `internal` = a write of _runVirtualTack itself, so the
+   *  external-write guard below can tell our FSM's writes from frontend
+   *  writes (nudges, adjust target, legacy countdown) that would compete
+   *  with the maneuver. Rev633: per call, see setMode. */
+  private async setTarget(rad: number, internal = false): Promise<void> {
     // Rev390 (Carlos, 2026-10-01, QA Rev389): reject external target
     // writes while a virtual tack is driving the pilot. Rev389 QA
     // caught a mid-maneuver `setTarget rad=0.9250 deg=53.00` that
     // competed with the FSM's own intermediate (`rad=0.4498 deg=25.77`)
     // and ultimately corrupted the maneuver. We now swallow any
     // target write that didn't originate from _runVirtualTack itself.
-    if (this._virtualTack && !this._vtInternalWrite) {
+    if (this._virtualTack && !internal) {
       const active = this._virtualTack.phase !== "idle"
         && this._virtualTack.phase !== "completed"
         && this._virtualTack.phase !== "cancelled"
@@ -790,7 +801,7 @@ export class AutopilotProvider {
     // Self-audit Rev540: the virtual tack's own writes are already in the
     // right space (compass steps 0..2pi, final wind angle -pi..pi) and
     // data.mode can still be the old mode if pypilot's echo was late.
-    if (!this._vtInternalWrite) rad = this._normTargetRad(rad);
+    if (!internal) rad = this._normTargetRad(rad);
     const deg = rad * RAD_TO_DEG;
     // Rev199 (Carlos): trace the values so we can tell whether SK
     // Autopilot API normalises rad to [-pi, pi] BEFORE it reaches us
@@ -854,7 +865,7 @@ export class AutopilotProvider {
       // Rev532 (GPT audit #2): +-1 / +-10 from KIP, the SK autopilot API or
       // a PUT action during a virtual tack move its destination (same as
       // the visor), instead of writing a target that fights the FSM.
-      if (this.isVirtualTackActive() && !this._vtInternalWrite) {
+      if (this.isVirtualTackActive()) {
         if (this.adjustVirtualTack(rad)) return;
         throw new Error("target adjust refused: virtual tack is driving the pilot");
       }
@@ -1244,8 +1255,7 @@ export class AutopilotProvider {
           `delta=${(geometry.deltaHRad * RAD_TO_DEG).toFixed(1)}deg ` +
           `steps=${geometry.intermediatesRad.length}`,
       );
-      this._vtInternalWrite = true;
-      try { await this.setMode("compass"); } finally { this._vtInternalWrite = false; }
+      await this.setMode("compass", true);
       checkCancelled();
       const compassReady = await waitForPypilotEcho("ap.mode", "compass", 1500);
       if (!compassReady) {
@@ -1294,8 +1304,7 @@ export class AutopilotProvider {
         this._virtualTack!.stepIndex = stepCounter;
         this._virtualTack!.phase1StepStartedAtMs = Date.now();
         const stepTargetRad = remainingIntermediates[0];
-        this._vtInternalWrite = true;
-        try { await this.setTarget(stepTargetRad); } finally { this._vtInternalWrite = false; }
+        await this.setTarget(stepTargetRad, true);
         checkCancelled();
 
         // Poll heading until we reach the intermediate within tolerance,
@@ -1384,8 +1393,7 @@ export class AutopilotProvider {
       // ─── Phase handover → settling: back to wind mode, final target ───
       checkCancelled();
       setPhase("handover");
-      this._vtInternalWrite = true;
-      try { await this.setMode(windMode); } finally { this._vtInternalWrite = false; }
+      await this.setMode(windMode, true);
       checkCancelled();
       const windReady = await waitForPypilotEcho("ap.mode", windMode, 1500);
       if (!windReady) {
@@ -1400,8 +1408,7 @@ export class AutopilotProvider {
       await sleep(400);
       checkCancelled();
       for (let attempt = 0; attempt < 2; attempt++) {
-        this._vtInternalWrite = true;
-        try { await this.setTarget(finalWind()); } finally { this._vtInternalWrite = false; }
+        await this.setTarget(finalWind(), true);
         checkCancelled();
         await sleep(1200);
         checkCancelled();
@@ -1456,8 +1463,7 @@ export class AutopilotProvider {
         // Rev506: a nudge during settling re-aims the wind target.
         if (curAdjustVersion() !== seenAdjustVersion) {
           seenAdjustVersion = curAdjustVersion();
-          this._vtInternalWrite = true;
-          try { await this.setTarget(finalWind()); } finally { this._vtInternalWrite = false; }
+          await this.setTarget(finalWind(), true);
           checkCancelled();
           dwellStart = null;
         }
@@ -1533,8 +1539,7 @@ export class AutopilotProvider {
       try {
         // Make sure we are in the wind mode we started with. If we
         // were caught mid-step still in compass, bring the AP back.
-        this._vtInternalWrite = true;
-        try { await this.setMode(windMode); } catch { /* best-effort */ } finally { this._vtInternalWrite = false; }
+        try { await this.setMode(windMode, true); } catch { /* best-effort */ }
       } catch { /* swallow */ }
       try {
         const skPath = windMode === "wind"
@@ -1556,8 +1561,7 @@ export class AutopilotProvider {
           await this._waitValue("ap.mode", windMode, 1500);
           await sleep(400);
           for (let attempt = 0; attempt < 2; attempt++) {
-            this._vtInternalWrite = true;
-            try { await this.setTarget(awaRad); } catch { /* best-effort */ } finally { this._vtInternalWrite = false; }
+            try { await this.setTarget(awaRad, true); } catch { /* best-effort */ }
             await sleep(1200);
             const cmdDeg = Number(((this.client as any).getValues?.() || {})["ap.heading_command"]);
             if (!Number.isFinite(cmdDeg)) break;
diff --git a/src/index.ts b/src/index.ts
index f231328..3f9d966 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -83,7 +83,7 @@ import {
 
 // Rev counter bumped on every build so the user can distinguish deploys
 // from the webapp header (feedback_revision_bump_each_build).
-const PLUGIN_REVISION = "Rev632";
+const PLUGIN_REVISION = "Rev638";
 
 // Rev59: read package.json once at load time so /status can report the
 // npm package version alongside the internal Rev counter.
@@ -440,6 +440,12 @@ module.exports = function (app: any) {
   let _autowindInFlight = 0;                        // mode switches waiting on pypilot
   let _autowindBlockedReason: string | null = null;
   let _autowindLastError: string | null = null;
+  // Rev633 (GPT re-audit 2026-11-06): mode switch confirmed by pypilot's
+  // echo within this time; a profile it did not take is retried.
+  const AUTOWIND_CONFIRM_MS = 3000;
+  const AUTOWIND_PROFILE_RETRY_MS = 10_000;
+  const AUTOWIND_PROFILE_TRIES = 5;
+  let _autowindProfilePending: { sub: WindSubMode; op: number; was: string; tries: number; nextMs: number } | null = null;
   // Rev176 (Carlos): debounce the raw `engaged` flag so a rebound
   // caused by a competing client (pypilot_web on another device, a KIP
   // widget cycling, socket races) does not open+close a JSONL every 5 s.
@@ -612,6 +618,22 @@ module.exports = function (app: any) {
   // Rev630: one entry per manoeuvre id, see src/maneuver-gate.ts.
   const maneuverGate = new ManeuverGate();
   const _pseudoActive = (): boolean => maneuverGate.active(Date.now());
+  // Rev634: every visor shows the running manoeuvre (path
+  // steering.autopilot.maneuver: "aproado" | "empopado" | "manoeuvre" | null).
+  let _maneuverKindSent: string | null | undefined;
+  const _publishManeuverKind = (): void => {
+    const k = maneuverGate.kind(Date.now());
+    if (k === _maneuverKindSent) return;
+    _maneuverKindSent = k;
+    try {
+      app.handleMessage(PLUGIN_ID, {
+        context: "vessels." + app.selfId,
+        updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [
+          { path: "steering.autopilot.maneuver", value: k },
+        ] }],
+      });
+    } catch { /* silent */ }
+  };
   let lastNavState: string | null = null;
   let sessionSampleTimer: NodeJS.Timeout | null = null;
   let lastEngagedState = false;
@@ -1351,6 +1373,17 @@ module.exports = function (app: any) {
         try { _steerWatchTick(s); } catch (e: any) { app.debug?.(`[steer-watch] tick: ${e?.message || e}`); }
         // Rev525: black box feed + automatic triggers.
         try { _blackBoxTick(s); } catch (e: any) { app.debug?.(`[black-box] tick: ${e?.message || e}`); }
+        // Rev634: a manoeuvre that expired (visor gone) is shown as ended.
+        // Rev638: and one pypilot is no longer doing (visor reloaded).
+        try {
+          if (apProvider) {
+            for (const id of maneuverGate.reconcile(Date.now(), String(apProvider.data.mode || ""), !!apProvider.data.engaged)) {
+              // eslint-disable-next-line no-console
+              console.log(`[maneuver] ${id} ended: pypilot left its mode or the AP is off`);
+            }
+          }
+          _publishManeuverKind();
+        } catch { /* silent */ }
         // Rev518: AUTOWIND (apparent <-> true wind by TWA).
         try { _autowindTick(); } catch (e: any) { app.debug?.(`[autowind] tick: ${e?.message || e}`); }
         // Rev545: route follower (APB for pypilot's NAV mode).
@@ -2876,11 +2909,36 @@ module.exports = function (app: any) {
         if (changed) { try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ } }
         if (typeof b.enabled === "boolean") {
           const was = !!props.autowindEnabled;
+          // Rev633 (GPT re-audit 2026-11-06 R06): switching on goes through
+          // the same tack / manoeuvre guard as the 1 Hz tick. Refused, it
+          // stays off and says why.
+          if (b.enabled && !was) {
+            const busy = _autowindBusyReason();
+            if (busy) {
+              _autowindPublish();
+              return res.status(409).json({ ..._autowindState(), refused: busy });
+            }
+          }
           _autowindSetEnabled(b.enabled, b.enabled ? "selected" : "another mode selected");
           if (b.enabled && !was) {
-            // Pick the side now, no waiting.
-            const sub = autowind.initial(_autowindTwaDeg(), props.autowindThresholdDeg);
-            await _autowindApply(sub, "AUTOWIND on");
+            // Pick the side now, no waiting. Without fresh true wind data
+            // (or below the wind floor) the start is apparent wind, on
+            // purpose: pypilot steers it from the vane alone.
+            const twa = _autowindTwaDeg();
+            const tws = _autowindTwsKn();
+            const usable = twa != null && tws != null && tws >= AUTOWIND_MIN_TWS_KN;
+            const sub = usable ? autowind.initial(twa, props.autowindThresholdDeg) : "wind";
+            const modeBefore = apProvider ? String(apProvider.data.mode || "").toLowerCase() : "";
+            await _autowindApply(sub, usable ? "AUTOWIND on" : "AUTOWIND on (no usable true wind: apparent)", true);
+            // Rev635/636 (Carlos QA 2026-11-06 16:42 and 16:58): AUTOWIND
+            // starts on the wind angle the boat has NOW. Without this the
+            // target was whatever was there - an Empopado's TWA 180 ended from
+            // another visor, an Aproado's AWA 0 - and on a mode change pypilot
+            // keeps the heading ERROR it had (61 deg off stayed 61 deg off),
+            // it does not re-centre on the wind.
+            if (apProvider && apProvider.data.engaged && props.autowindEnabled) {
+              await _autowindHoldCurrentAngle(sub, modeBefore !== sub);
+            }
           }
         }
         // New profile for the side that is active right now: apply it.
@@ -3454,6 +3512,7 @@ module.exports = function (app: any) {
       router.post("/maneuver-state", (req: any, res: any) => {
         const body = req.body || {};
         maneuverGate.update(body.active, body.id, Date.now());
+        _publishManeuverKind();
         res.json({ ok: true, pseudoActive: _pseudoActive() });
       });
       const validKinds: ManeuverEventKind[] = [
@@ -5013,17 +5072,21 @@ module.exports = function (app: any) {
   function _autowindProfileFor(sub: WindSubMode): string {
     return (sub === "true wind" ? props.autowindProfileTrue : props.autowindProfileApparent) || "";
   }
-  function _autowindApplyProfile(sub: WindSubMode, reason: string): void {
+  /** false = pypilot did not take the profile write. */
+  function _autowindApplyProfile(sub: WindSubMode, reason: string): boolean {
     const want = _autowindProfileFor(sub);
-    if (!want || !client || !client.connected) return;
-    if (client.getValues()["profile"] === want) return;
+    if (!want) return true;
+    if (client && client.getValues()["profile"] === want) return true;
     let sent = false;
     try {
-      profileChangeLog.markPlannedWrite(want, "autowind", reason);
-      sent = client.set("profile", want) !== false;
+      if (client && client.connected) {
+        profileChangeLog.markPlannedWrite(want, "autowind", reason);
+        sent = client.set("profile", want) !== false;
+      }
     } catch { /* silent */ }
     // Rev630 (GPT audit 2026-11-05 F03): a refused write is a failure.
     if (!sent) _autowindFail(`profile ${want} not sent to pypilot`);
+    return sent;
   }
   function _autowindFail(msg: string): void {
     _autowindLastError = msg;
@@ -5035,24 +5098,77 @@ module.exports = function (app: any) {
   // (its outcome feeds the decider's gap / retry). An operation number:
   // turning AUTOWIND off, or a newer apply, makes an apply still waiting on
   // pypilot stop there - no profile, no "switched" afterwards.
+  // Rev636: target = the current wind angle in the mode AUTOWIND starts in.
+  // After a mode change pypilot rewrites heading_command in its own loop
+  // (same race as the tack cancel, Rev515): wait 400 ms, write, check at
+  // 1.2 s, rewrite once. A newer AUTOWIND order or "off" stops it.
+  async function _autowindHoldCurrentAngle(sub: WindSubMode, modeChanged: boolean): Promise<void> {
+    if (!apProvider) return;
+    const op = _autowindOp;
+    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
+    const iface = apProvider.toProviderInterface() as any;
+    if (modeChanged) await sleep(400);
+    let nowRad: number | null = null;
+    for (let attempt = 0; attempt < 2; attempt++) {
+      if (op !== _autowindOp || !props.autowindEnabled || !apProvider.data.engaged) return;
+      if (String(apProvider.data.mode || "").toLowerCase() !== sub) return;
+      if (attempt === 0) {
+        // SK angles are radians; TWA from the same fresh sources AUTOWIND decides on.
+        nowRad = sub === "true wind"
+          ? _autowindFresh(["environment.wind.angleTrueWater", "environment.wind.angleTrueGround"])
+          : _autowindFresh(["environment.wind.angleApparent"]);
+        if (nowRad == null) { _autowindFail("no fresh wind angle to hold: target left as it was"); return; }
+      } else {
+        // pypilot kept what we wrote: done. Else it overwrote it: once more.
+        const cur = apProvider.data.target;
+        if (typeof cur === "number" && Math.abs(Math.atan2(Math.sin(cur - nowRad!), Math.cos(cur - nowRad!))) < 5 * Math.PI / 180) return;
+      }
+      try { await iface.setTarget(nowRad, apProvider.deviceId); }
+      catch (e: any) { _autowindFail(`hold the current wind angle: ${e?.message || e}`); return; }
+      // eslint-disable-next-line no-console
+      console.log(`[autowind] target = current ${sub === "true wind" ? "TWA" : "AWA"} ${((nowRad as number) * 180 / Math.PI).toFixed(0)} deg`);
+      await sleep(1200);
+    }
+  }
+  // Rev633: why AUTOWIND must not switch now (tack or visor manoeuvre), or null.
+  function _autowindBusyReason(): string | null {
+    if (!apProvider) return null;
+    if (apProvider.isVirtualTackActive()) return "virtual-tack";
+    if (_tackStatePrev && _tackStatePrev !== "none") return "pypilot-tack";
+    if (_pseudoActive()) return "manoeuvre";
+    return null;
+  }
   async function _autowindApply(sub: WindSubMode, reason: string, fromTick = false): Promise<void> {
     if (!apProvider) return;
     const op = ++_autowindOp;
+    _autowindProfilePending = null;
     _autowindLastReason = reason;
+    const current = () => op === _autowindOp && !!props.autowindEnabled;
     const cur = String(apProvider.data.mode || "").toLowerCase();
     if (cur !== sub) {
       // wind <-> true wind share the angle space: pypilot keeps the
       // heading itself on the mode change, nothing else is written.
+      // Rev633 (GPT re-audit 2026-11-06 R01/R02): no retry goes out once
+      // AUTOWIND is off or overridden, and success = pypilot's own echo of
+      // the mode, not the write being accepted.
       _autowindInFlight++;
-      try { await (apProvider.toProviderInterface() as any).setMode(sub, apProvider.deviceId); }
-      catch (e: any) {
+      try {
+        await apProvider.setModeIfWanted(sub, current);
+        const t0 = Date.now();
+        while (String(apProvider.data.mode || "").toLowerCase() !== sub) {
+          if (!current()) break;
+          if (Date.now() - t0 > AUTOWIND_CONFIRM_MS) throw new Error(`not confirmed by pypilot in ${AUTOWIND_CONFIRM_MS / 1000} s`);
+          await new Promise<void>((r) => setTimeout(r, 100));
+        }
+      } catch (e: any) {
         _autowindInFlight--;
+        if (!current()) return;
         if (fromTick) autowind.noteFailure(Date.now());
         _autowindFail(`mode ${sub}: ${e?.message || e}`);
         return;
       }
       _autowindInFlight--;
-      if (op !== _autowindOp || !props.autowindEnabled) {
+      if (!current()) {
         // eslint-disable-next-line no-console
         console.log(`[autowind] ${sub} landed after AUTOWIND was turned off or overridden: profile left as is`);
         return;
@@ -5061,7 +5177,12 @@ module.exports = function (app: any) {
       autowind.noteSwitch(_autowindLastSwitchTs);
     }
     _autowindLastError = null;
-    _autowindApplyProfile(sub, reason);
+    if (!_autowindApplyProfile(sub, reason)) {
+      // Rev633 (GPT R09 / Gemini 3.1): the mode is right but pypilot did not
+      // take the profile - retry it from the tick, a few times.
+      const was = client ? String(client.getValues()["profile"] ?? "") : "";
+      _autowindProfilePending = { sub, op, was, tries: 1, nextMs: Date.now() + AUTOWIND_PROFILE_RETRY_MS };
+    }
     // eslint-disable-next-line no-console
     console.log(`[autowind] ${reason} -> ${sub}${_autowindProfileFor(sub) ? ` / profile ${_autowindProfileFor(sub)}` : ""}`);
     _autowindPublish();
@@ -5069,7 +5190,7 @@ module.exports = function (app: any) {
   function _autowindSetEnabled(on: boolean, why: string): void {
     if (!!props.autowindEnabled === on) return;
     props.autowindEnabled = on;
-    if (!on) { _autowindOp++; _autowindBlockedReason = null; }
+    if (!on) { _autowindOp++; _autowindBlockedReason = null; _autowindProfilePending = null; }
     try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ }
     // eslint-disable-next-line no-console
     console.log(`[autowind] ${on ? "on" : "off"} (${why})`);
@@ -5111,16 +5232,14 @@ module.exports = function (app: any) {
   function _autowindTick(): void {
     if (!props.autowindEnabled || !apProvider) return;
     const mode = String(apProvider.data.mode || "").toLowerCase();
-    const vtActive = apProvider.isVirtualTackActive();
-    const pypilotTack = !!(_tackStatePrev && _tackStatePrev !== "none");
-    const manoeuvre = _pseudoActive();
-    const blocked = vtActive || pypilotTack || manoeuvre;
+    const busy = _autowindBusyReason();
+    const vtActive = busy === "virtual-tack";
+    const pypilotTack = busy === "pypilot-tack";
+    const blocked = busy != null;
     const twaNow = _autowindTwaDeg();
     const twsNow = _autowindTwsKn();
     _autowindSetBlocked(
-      vtActive ? "virtual-tack"
-      : pypilotTack ? "pypilot-tack"
-      : manoeuvre ? "manoeuvre"
+      busy ? busy
       : twaNow == null || twsNow == null ? "no-wind-data"
       : twsNow < AUTOWIND_MIN_TWS_KN ? "wind-too-light"
       : null);
@@ -5142,6 +5261,17 @@ module.exports = function (app: any) {
     }
     _autowindOffFamilySince = null;
     if (_autowindInFlight > 0) return;   // a switch is still waiting on pypilot
+    // Rev633: a profile pypilot did not take, retried while the side holds.
+    const pend = _autowindProfilePending;
+    if (pend && Date.now() >= pend.nextMs) {
+      const nowProfile = client ? String(client.getValues()["profile"] ?? "") : "";
+      // The sailor picked another profile meanwhile: theirs wins.
+      const sailorChose = nowProfile !== pend.was && nowProfile !== _autowindProfileFor(pend.sub);
+      if (pend.op !== _autowindOp || mode !== pend.sub || blocked || sailorChose) _autowindProfilePending = null;
+      else if (_autowindApplyProfile(pend.sub, "profile retry")) { _autowindProfilePending = null; _autowindLastError = null; _autowindPublish(); }
+      else if (pend.tries >= AUTOWIND_PROFILE_TRIES) { _autowindProfilePending = null; _autowindFail(`profile ${_autowindProfileFor(pend.sub)} not taken after ${pend.tries} tries: set it by hand`); }
+      else { pend.tries++; pend.nextMs = Date.now() + AUTOWIND_PROFILE_RETRY_MS; }
+    }
     const want = autowind.tick({
       nowMs: Date.now(),
       twaDeg: twaNow,
diff --git a/src/maneuver-gate.ts b/src/maneuver-gate.ts
index e8c5835..e0a55ef 100644
--- a/src/maneuver-gate.ts
+++ b/src/maneuver-gate.ts
@@ -3,32 +3,95 @@
 // heading-deviation / cruise-drift / unable-to-steer alarms stay quiet.
 //
 // One entry per manoeuvre id, each with its own expiry: one visor ending
-// its manoeuvre does not end another visor's, and a renewal of a
-// manoeuvre that was cleared only revives that same id until it expires.
-// A visor older than Rev630 sends no id and shares the "legacy" entry.
+// its manoeuvre does not end another visor's. A visor older than Rev630
+// sends no id and shares the "legacy" entry.
+//
+// Rev633 (GPT re-audit 2026-11-06 R08): an id that ended is remembered for
+// one TTL, so a renewal of it that was still in flight cannot open it
+// again (and silence the alarms for another 3 minutes). Visor ids are
+// unique per manoeuvre; "legacy" is reused and keeps the old behaviour.
 
 export const MANEUVER_GATE_TTL_MS = 180_000;
 export const MANEUVER_GATE_MAX = 16;
+// Rev638 (Carlos QA 2026-11-06 17:36): a visor that is reloaded or closed
+// mid-manoeuvre never sends "off"; its entry lingered 3 min (button said
+// APROADO with pypilot in compass, AUTOWIND blocked, alarms quiet). An
+// Aproado / Empopado entry ends when pypilot has been out of its mode or
+// off for MISMATCH_MS, once START_GRACE_MS have passed since it began
+// (the visor changes mode and engages in the first seconds).
+export const MANEUVER_GATE_START_GRACE_MS = 10_000;
+export const MANEUVER_GATE_MISMATCH_MS = 3_000;
+const LEGACY = "legacy";
 
 export class ManeuverGate {
   private readonly until = new Map<string, number>();
+  private readonly ended = new Map<string, number>();   // id -> forget after
+  private readonly startedAt = new Map<string, number>();
+  private readonly mismatchSince = new Map<string, number>();
 
   constructor(private readonly ttlMs = MANEUVER_GATE_TTL_MS) {}
 
   /** Applies one visor message: {active: true|false, id?}. */
   update(active: unknown, id: unknown, nowMs: number): void {
-    const key = typeof id === "string" && id ? id.slice(0, 64) : "legacy";
+    const key = typeof id === "string" && id ? id.slice(0, 64) : LEGACY;
+    this.sweep(nowMs);
     if (active === true) {
+      if (this.ended.has(key)) return;
+      if (!this.until.has(key)) this.startedAt.set(key, nowMs);
       this.until.delete(key);
       this.until.set(key, nowMs + this.ttlMs);
       while (this.until.size > MANEUVER_GATE_MAX) this.until.delete(this.until.keys().next().value as string);
     } else if (active === false) {
-      this.until.delete(key);
+      this.end(key, nowMs);
     }
   }
 
+  /** Rev638: ends Aproado / Empopado entries pypilot is no longer doing.
+   *  Returns the ids it ended. */
+  reconcile(nowMs: number, mode: string, engaged: boolean): string[] {
+    this.sweep(nowMs);
+    const out: string[] = [];
+    for (const key of [...this.until.keys()]) {
+      const own = key.startsWith("emp-") ? "true wind" : key.startsWith("apr-") ? "wind" : null;
+      if (!own) continue;
+      if (nowMs - (this.startedAt.get(key) ?? nowMs) < MANEUVER_GATE_START_GRACE_MS) continue;
+      if (engaged && String(mode).toLowerCase() === own) { this.mismatchSince.delete(key); continue; }
+      const since = this.mismatchSince.get(key);
+      if (since == null) { this.mismatchSince.set(key, nowMs); continue; }
+      if (nowMs - since >= MANEUVER_GATE_MISMATCH_MS) { this.end(key, nowMs); out.push(key); }
+    }
+    return out;
+  }
+
+  private end(key: string, nowMs: number): void {
+    this.until.delete(key);
+    this.startedAt.delete(key);
+    this.mismatchSince.delete(key);
+    if (key !== LEGACY) {
+      this.ended.set(key, nowMs + this.ttlMs);
+      while (this.ended.size > MANEUVER_GATE_MAX * 4) this.ended.delete(this.ended.keys().next().value as string);
+    }
+  }
+
+  /** Rev634 (Carlos QA 2026-11-06: the other tablet said REAL during an
+   *  Empopado): which manoeuvre runs, from the visor's id prefix. */
+  kind(nowMs: number): "aproado" | "empopado" | "manoeuvre" | null {
+    if (!this.active(nowMs)) return null;
+    const ids = [...this.until.keys()];
+    if (ids.some((k) => k.startsWith("emp-"))) return "empopado";
+    if (ids.some((k) => k.startsWith("apr-"))) return "aproado";
+    return "manoeuvre";
+  }
+
   active(nowMs: number): boolean {
-    for (const [key, until] of this.until) if (until <= nowMs) this.until.delete(key);
+    this.sweep(nowMs);
     return this.until.size > 0;
   }
+
+  private sweep(nowMs: number): void {
+    for (const [key, until] of this.until) {
+      if (until <= nowMs) { this.until.delete(key); this.startedAt.delete(key); this.mismatchSince.delete(key); }
+    }
+    for (const [key, until] of this.ended) if (until <= nowMs) this.ended.delete(key);
+  }
 }
diff --git a/src/test/maneuver-gate.test.ts b/src/test/maneuver-gate.test.ts
index 41ab9aa..3b41a00 100644
--- a/src/test/maneuver-gate.test.ts
+++ b/src/test/maneuver-gate.test.ts
@@ -49,3 +49,68 @@ describe("ManeuverGate", () => {
     assert.equal(g.active(0), false);
   });
 });
+
+describe("ManeuverGate - late messages (Rev633)", () => {
+  it("a renewal that arrives after the end does not open the manoeuvre again", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, "emp-1", 0);
+    g.update(false, "emp-1", 1000);
+    g.update(true, "emp-1", 2000);       // renewal sent before the end, late
+    assert.equal(g.active(2000), false);
+    assert.equal(g.active(181_999), false);
+  });
+
+  it("a new manoeuvre (new id) still opens it", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, "emp-1", 0);
+    g.update(false, "emp-1", 1000);
+    g.update(true, "emp-2", 2000);
+    assert.equal(g.active(2000), true);
+  });
+});
+
+describe("ManeuverGate.kind (Rev634)", () => {
+  it("names the running manoeuvre for every visor", () => {
+    const g = new ManeuverGate(180_000);
+    assert.equal(g.kind(0), null);
+    g.update(true, "emp-1", 0);
+    assert.equal(g.kind(0), "empopado");
+    g.update(false, "emp-1", 0);
+    g.update(true, "apr-2", 0);
+    assert.equal(g.kind(0), "aproado");
+    g.update(false, "apr-2", 0);
+    g.update(true, undefined, 0);
+    assert.equal(g.kind(0), "manoeuvre");
+  });
+});
+
+describe("ManeuverGate.reconcile (Rev638)", () => {
+  it("ends an Aproado whose visor vanished once pypilot left wind mode for 3 s", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, "apr-1", 0);
+    assert.deepEqual(g.reconcile(5_000, "compass", false), [], "grace while starting");
+    assert.deepEqual(g.reconcile(10_000, "wind", true), []);
+    assert.deepEqual(g.reconcile(11_000, "compass", true), []);
+    assert.deepEqual(g.reconcile(13_999, "compass", true), []);
+    assert.deepEqual(g.reconcile(14_000, "compass", true), ["apr-1"]);
+    assert.equal(g.active(14_000), false);
+    g.update(true, "apr-1", 15_000);       // a late renewal cannot reopen it
+    assert.equal(g.active(15_000), false);
+  });
+
+  it("an AP off shorter than 3 s (stuck-pilot recovery) does not end it", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, "emp-1", 0);
+    g.reconcile(12_000, "true wind", false);
+    g.reconcile(13_000, "true wind", true);
+    g.reconcile(17_000, "true wind", true);
+    assert.equal(g.kind(17_000), "empopado");
+  });
+
+  it("leaves entries without a known manoeuvre (old visors) alone", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, undefined, 0);
+    assert.deepEqual(g.reconcile(60_000, "compass", false), []);
+    assert.equal(g.active(60_000), true);
+  });
+});
diff --git a/src/test/virtual-tack-sailor.test.ts b/src/test/virtual-tack-sailor.test.ts
index 35d01e3..ee638ed 100644
--- a/src/test/virtual-tack-sailor.test.ts
+++ b/src/test/virtual-tack-sailor.test.ts
@@ -519,4 +519,56 @@ describe("long-way gybe needs confirmation (Rev511)", () => {
       await waitFor(() => !p.isVirtualTackActive(), 3000);
     } finally { sim.stop(); }
   });
+
+  it("Rev633: an outside mode change while the tack's own write is retrying is still refused", async () => {
+    // GPT re-audit 2026-11-06 R07: the tack's permission was a shared flag
+    // held across the retry wait; an outside call inherited it.
+    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 1 });
+    const realSet = sim.client.set.bind(sim.client);
+    let compassTries = 0;
+    (sim.client as any).set = (name: string, value: unknown) => {
+      if (name === "ap.mode" && value === "compass" && compassTries++ === 0) return false;   // retry in 250 ms
+      return realSet(name, value);
+    };
+    const p = new AutopilotProvider(sim.client as any, sim.app);
+    sim.attach(p);
+    try {
+      const starting = p.startVirtualTack({ direction: "starboard" });
+      await sleep(60);
+      await assert.rejects(
+        (p.toProviderInterface() as any).setMode("wind", "_default"),
+        /refused: virtual tack is driving the pilot/,
+      );
+      await starting;
+      await p.cancelVirtualTack();
+      await waitFor(() => !p.isVirtualTackActive(), 3000);
+    } finally { sim.stop(); }
+  });
+});
+
+describe("setModeIfWanted (Rev633)", () => {
+  it("no retry goes out once the caller no longer wants the mode", async () => {
+    // GPT re-audit 2026-11-06 R01: AUTOWIND turned off while a failed mode
+    // write waits for its retry.
+    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
+    const realSet = sim.client.set.bind(sim.client);
+    const modeWrites: unknown[] = [];
+    let first = true;
+    (sim.client as any).set = (name: string, value: unknown) => {
+      if (name === "ap.mode") modeWrites.push(value);
+      if (name === "ap.mode" && first) { first = false; return false; }
+      return realSet(name, value);
+    };
+    const p = new AutopilotProvider(sim.client as any, sim.app);
+    sim.attach(p);
+    try {
+      let wanted = true;
+      const switching = p.setModeIfWanted("true wind", () => wanted);
+      await sleep(50);
+      wanted = false;
+      await assert.rejects(switching, /no longer wanted/);
+      await sleep(1200);
+      assert.deepEqual(modeWrites, ["true wind"], "only the first, failed write");
+    } finally { sim.stop(); }
+  });
 });
diff --git a/src/test/visor-maneuver-flag.test.ts b/src/test/visor-maneuver-flag.test.ts
index 4fc77ec..6c064e8 100644
--- a/src/test/visor-maneuver-flag.test.ts
+++ b/src/test/visor-maneuver-flag.test.ts
@@ -13,8 +13,9 @@ const APP = fs.readFileSync(path.join(__dirname, "..", "..", "public", "app.js")
 
 /** Source of `function name(...) {...}` from app.js, by brace matching. */
 function fnSource(name: string): string {
-  const start = APP.indexOf(`function ${name}(`);
+  let start = APP.indexOf(`function ${name}(`);
   assert.ok(start >= 0, `function ${name} not found in app.js`);
+  if (APP.slice(start - 6, start) === "async ") start -= 6;
   let i = APP.indexOf("{", start);
   let depth = 0;
   for (; i < APP.length; i++) {
@@ -99,13 +100,13 @@ describe("visor manoeuvre flag (Rev630)", () => {
     assert.deepEqual(v.posts.map((p) => p.active), [true, false]);
   });
 
-  it("ending one manoeuvre does not clear the flag of another", () => {
+  it("ending one manoeuvre does not clear the flag of another, but ends its own entry", () => {
     const v = loadVisor();
     v.ctx.state.aproado = { id: "apr-2", phase: "transit" };
     v.ctx._setManeuverPseudo(true, "apr-2");
     v.ctx._setManeuverPseudo(false, "emp-1");
     assert.equal(v.liveIntervals(), 1);
-    assert.deepEqual(v.posts.map((p) => p.active), [true]);
+    assert.deepEqual(v.posts.map((p) => [p.active, p.id]), [[true, "apr-2"], [false, "emp-1"]]);
   });
 
   it("the mode selector ends a running or summary manoeuvre before AUTOWIND", () => {
@@ -117,4 +118,143 @@ describe("visor manoeuvre flag (Rev630)", () => {
     assert.match(before, /empopadoClose\(\)/);
     assert.match(before, /aproadoTearDown\(\)/);
   });
+
+  it("Rev633: choosing Aproado ends an Empopado (and vice versa)", () => {
+    const handler = APP.slice(APP.indexOf('$("#mode-select").addEventListener("change"'));
+    const before = handler.slice(0, handler.indexOf('if (chosen === "autowind")'));
+    assert.match(before, /if \(chosen !== "empopado"\) \{[\s\S]*?empopadoTearDown/);
+    assert.match(before, /if \(chosen !== "aproado"\) \{[\s\S]*?aproadoTearDown/);
+  });
+});
+
+// Rev633 (GPT re-audit 2026-11-06 R04/R05): Empopado's temporary gains.
+interface Deferred { resolve: () => void }
+function loadHotGains() {
+  const writes: Array<{ path: string; val: number }> = [];
+  const pending: Deferred[] = [];
+  const ctx: any = {
+    state: {
+      empopado: null, profile: "HEAVY", pilot: "basic", catalog: {},
+      pypilotValues: { "ap.pilot.basic.P": 0.1, "ap.pilot.basic.D": 0.2, "servo.max_slew_speed": 10 },
+    },
+    EMPOPADO_HOT_GAIN_MULT: { P: 1.5, D: 1.7, SLEW: 1.3 },
+    pluginRaw: (path: string, val: number) => {
+      writes.push({ path, val });
+      return new Promise<any>((r) => pending.push({ resolve: () => r({ ok: true }) }));
+    },
+    _empopadoSetHotBadge: () => {},
+    console: { info: () => {}, warn: () => {} },
+  };
+  vm.createContext(ctx);
+  vm.runInContext([
+    fnSource("_empopadoHotGainsOwned"),
+    fnSource("_empopadoApplyHotGains"),
+    fnSource("_empopadoRestoreHotGains"),
+  ].join("\n"), ctx);
+  const flush = () => new Promise<void>((r) => setImmediate(r));
+  const answer = async () => { const d = pending.shift(); if (d) d.resolve(); await flush(); };
+  return { ctx, writes, answer, flush };
+}
+
+describe("Empopado temporary gains (Rev633)", () => {
+  it("no gain is raised after the manoeuvre ended; the one already sent is restored", async () => {
+    const h = loadHotGains();
+    const ap: any = { id: "emp-1", phase: "active" };
+    h.ctx.state.empopado = ap;
+    const applying = h.ctx._empopadoApplyHotGains(ap);
+    await h.flush();                        // P x1.5 sent, answer pending
+    h.ctx.state.empopado = null;            // the sailor leaves
+    const restoring = h.ctx._empopadoRestoreHotGains(ap);
+    await h.flush();                        // P restore sent
+    await h.answer();                       // the raise answers
+    await h.answer();                       // the restore answers
+    await applying; await restoring;
+    assert.deepEqual(h.writes.map((w) => [w.path, +w.val.toFixed(3)]),
+      [["ap.pilot.basic.P", 0.15], ["ap.pilot.basic.P", 0.1]]);
+  });
+
+  it("an old gain is never written into a profile chosen meanwhile", async () => {
+    const h = loadHotGains();
+    const ap: any = {
+      id: "emp-1", phase: "active", _hotGainProfile: "HEAVY",
+      _hotGainSnapshot: { "ap.pilot.basic.P": 0.1, "ap.pilot.basic.D": 0.2 },
+    };
+    const restoring = h.ctx._empopadoRestoreHotGains(ap);
+    await h.flush();                        // P restore sent
+    h.ctx.state.profile = "NEW";            // profile changed and known
+    await h.answer();
+    await restoring;
+    assert.deepEqual(h.writes.map((w) => w.path), ["ap.pilot.basic.P"]);
+  });
+});
+
+describe("manoeuvre left from another device (Rev634)", () => {
+  function load() {
+    const calls: string[] = [];
+    const timers: Array<() => void> = [];
+    const ctx: any = {
+      state: { empopado: null, aproado: null, mode: "compass", engaged: true },
+      empopadoTearDown: () => { calls.push("empopadoTearDown"); ctx.state.empopado = null; },
+      aproadoTearDown: () => { calls.push("aproadoTearDown"); ctx.state.aproado = null; },
+      setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
+      clearTimeout: () => {},
+      console: { info: () => {} },
+    };
+    vm.createContext(ctx);
+    vm.runInContext(["const MANEUVER_AP_OFF_GRACE_MS = 3000;", fnSource("_endLocalManeuverIfLeft"), fnSource("_endManeuverHere")].join("\n"), ctx);
+    const elapse = () => { for (const fn of timers.splice(0)) fn(); };   // = 3 s later
+    return { ctx, calls, elapse };
+  }
+
+  it("does not end an Empopado still on its way into true wind", () => {
+    const { ctx, calls } = load();
+    ctx.state.empopado = { id: "emp-1", phase: "transit" };
+    ctx.state.mode = "compass";
+    ctx._endLocalManeuverIfLeft();
+    assert.deepEqual(calls, []);
+  });
+
+  it("ends it here when another device takes pypilot out of true wind", () => {
+    const { ctx, calls } = load();
+    ctx.state.empopado = { id: "emp-1", phase: "active" };
+    ctx.state.mode = "true wind";
+    ctx._endLocalManeuverIfLeft();            // reached its mode
+    ctx.state.mode = "compass";               // the tablet chose compass
+    ctx._endLocalManeuverIfLeft();
+    assert.deepEqual(calls, ["empopadoTearDown"]);
+  });
+
+  it("ends an Aproado when the AP is taken off from outside and stays off 3 s", () => {
+    const { ctx, calls, elapse } = load();
+    ctx.state.aproado = { id: "apr-1", phase: "active" };
+    ctx.state.mode = "wind";
+    ctx._endLocalManeuverIfLeft();
+    ctx.state.engaged = false;
+    ctx._endLocalManeuverIfLeft();
+    assert.deepEqual(calls, [], "not at once");
+    elapse();
+    assert.deepEqual(calls, ["aproadoTearDown"]);
+  });
+
+  it("Rev635: the stuck-pilot recovery (AP off and on within a second) does not end it", () => {
+    const { ctx, calls, elapse } = load();
+    ctx.state.empopado = { id: "emp-1", phase: "transit" };
+    ctx.state.mode = "true wind";
+    ctx._endLocalManeuverIfLeft();
+    ctx.state.engaged = false;
+    ctx._endLocalManeuverIfLeft();
+    ctx.state.engaged = true;
+    ctx._endLocalManeuverIfLeft();
+    elapse();
+    assert.deepEqual(calls, []);
+  });
+});
+
+describe("AP off from the visor that runs the manoeuvre (Rev637)", () => {
+  it("every engaged delta checks the manoeuvre, even when the visor already set state.engaged", () => {
+    const start = APP.indexOf('case "steering.autopilot.engaged": {');
+    const body = APP.slice(start, APP.indexOf("break;", start));
+    assert.match(body, /\n\s*_endLocalManeuverIfLeft\(\);/);
+    assert.doesNotMatch(body, /if \(wasEngaged !== state\.engaged\) _endLocalManeuverIfLeft\(\)/);
+  });
 });
```

## Current code around the changes

Line numbers are the real ones in the repository at Rev638.

### src/maneuver-gate.ts lines 1-98 (manoeuvre flag, backend (whole file))

```ts
    1  // Rev630 (sea trial 2026-11-05): "a visor manoeuvre is running" flag
    2  // (Aproado / Empopado). While it is set, AUTOWIND does not switch and the
    3  // heading-deviation / cruise-drift / unable-to-steer alarms stay quiet.
    4  //
    5  // One entry per manoeuvre id, each with its own expiry: one visor ending
    6  // its manoeuvre does not end another visor's. A visor older than Rev630
    7  // sends no id and shares the "legacy" entry.
    8  //
    9  // Rev633 (GPT re-audit 2026-11-06 R08): an id that ended is remembered for
   10  // one TTL, so a renewal of it that was still in flight cannot open it
   11  // again (and silence the alarms for another 3 minutes). Visor ids are
   12  // unique per manoeuvre; "legacy" is reused and keeps the old behaviour.
   13  
   14  export const MANEUVER_GATE_TTL_MS = 180_000;
   15  export const MANEUVER_GATE_MAX = 16;
   16  // Rev638 (Carlos QA 2026-11-06 17:36): a visor that is reloaded or closed
   17  // mid-manoeuvre never sends "off"; its entry lingered 3 min (button said
   18  // APROADO with pypilot in compass, AUTOWIND blocked, alarms quiet). An
   19  // Aproado / Empopado entry ends when pypilot has been out of its mode or
   20  // off for MISMATCH_MS, once START_GRACE_MS have passed since it began
   21  // (the visor changes mode and engages in the first seconds).
   22  export const MANEUVER_GATE_START_GRACE_MS = 10_000;
   23  export const MANEUVER_GATE_MISMATCH_MS = 3_000;
   24  const LEGACY = "legacy";
   25  
   26  export class ManeuverGate {
   27    private readonly until = new Map<string, number>();
   28    private readonly ended = new Map<string, number>();   // id -> forget after
   29    private readonly startedAt = new Map<string, number>();
   30    private readonly mismatchSince = new Map<string, number>();
   31  
   32    constructor(private readonly ttlMs = MANEUVER_GATE_TTL_MS) {}
   33  
   34    /** Applies one visor message: {active: true|false, id?}. */
   35    update(active: unknown, id: unknown, nowMs: number): void {
   36      const key = typeof id === "string" && id ? id.slice(0, 64) : LEGACY;
   37      this.sweep(nowMs);
   38      if (active === true) {
   39        if (this.ended.has(key)) return;
   40        if (!this.until.has(key)) this.startedAt.set(key, nowMs);
   41        this.until.delete(key);
   42        this.until.set(key, nowMs + this.ttlMs);
   43        while (this.until.size > MANEUVER_GATE_MAX) this.until.delete(this.until.keys().next().value as string);
   44      } else if (active === false) {
   45        this.end(key, nowMs);
   46      }
   47    }
   48  
   49    /** Rev638: ends Aproado / Empopado entries pypilot is no longer doing.
   50     *  Returns the ids it ended. */
   51    reconcile(nowMs: number, mode: string, engaged: boolean): string[] {
   52      this.sweep(nowMs);
   53      const out: string[] = [];
   54      for (const key of [...this.until.keys()]) {
   55        const own = key.startsWith("emp-") ? "true wind" : key.startsWith("apr-") ? "wind" : null;
   56        if (!own) continue;
   57        if (nowMs - (this.startedAt.get(key) ?? nowMs) < MANEUVER_GATE_START_GRACE_MS) continue;
   58        if (engaged && String(mode).toLowerCase() === own) { this.mismatchSince.delete(key); continue; }
   59        const since = this.mismatchSince.get(key);
   60        if (since == null) { this.mismatchSince.set(key, nowMs); continue; }
   61        if (nowMs - since >= MANEUVER_GATE_MISMATCH_MS) { this.end(key, nowMs); out.push(key); }
   62      }
   63      return out;
   64    }
   65  
   66    private end(key: string, nowMs: number): void {
   67      this.until.delete(key);
   68      this.startedAt.delete(key);
   69      this.mismatchSince.delete(key);
   70      if (key !== LEGACY) {
   71        this.ended.set(key, nowMs + this.ttlMs);
   72        while (this.ended.size > MANEUVER_GATE_MAX * 4) this.ended.delete(this.ended.keys().next().value as string);
   73      }
   74    }
   75  
   76    /** Rev634 (Carlos QA 2026-11-06: the other tablet said REAL during an
   77     *  Empopado): which manoeuvre runs, from the visor's id prefix. */
   78    kind(nowMs: number): "aproado" | "empopado" | "manoeuvre" | null {
   79      if (!this.active(nowMs)) return null;
   80      const ids = [...this.until.keys()];
   81      if (ids.some((k) => k.startsWith("emp-"))) return "empopado";
   82      if (ids.some((k) => k.startsWith("apr-"))) return "aproado";
   83      return "manoeuvre";
   84    }
   85  
   86    active(nowMs: number): boolean {
   87      this.sweep(nowMs);
   88      return this.until.size > 0;
   89    }
   90  
   91    private sweep(nowMs: number): void {
   92      for (const [key, until] of this.until) {
   93        if (until <= nowMs) { this.until.delete(key); this.startedAt.delete(key); this.mismatchSince.delete(key); }
   94      }
   95      for (const [key, until] of this.ended) if (until <= nowMs) this.ended.delete(key);
   96    }
   97  }
   98  
```

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

### src/index.ts lines 612-636 (manoeuvre gate wiring + publish)

```ts
  612    // aunque el visor estÃ© pilotando la maniobra por otras vÃ­as.
  613    // Rev534 (GPT review 2 #1): the visor renews it every 20 s; a closed or
  614    // disconnected browser must not silence the heading alarms (and block
  615    // AUTO WIND) for ever.
  616    // Self-audit Rev540: 180 s - with the screen off Chrome runs the 20 s
  617    // renewal only about once a minute, and 60 s let it lapse mid-manoeuvre.
  618    // Rev630: one entry per manoeuvre id, see src/maneuver-gate.ts.
  619    const maneuverGate = new ManeuverGate();
  620    const _pseudoActive = (): boolean => maneuverGate.active(Date.now());
  621    // Rev634: every visor shows the running manoeuvre (path
  622    // steering.autopilot.maneuver: "aproado" | "empopado" | "manoeuvre" | null).
  623    let _maneuverKindSent: string | null | undefined;
  624    const _publishManeuverKind = (): void => {
  625      const k = maneuverGate.kind(Date.now());
  626      if (k === _maneuverKindSent) return;
  627      _maneuverKindSent = k;
  628      try {
  629        app.handleMessage(PLUGIN_ID, {
  630          context: "vessels." + app.selfId,
  631          updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [
  632            { path: "steering.autopilot.maneuver", value: k },
  633          ] }],
  634        });
  635      } catch { /* silent */ }
  636    };
```

### src/index.ts lines 1375-1388 (1 Hz tick: reconcile + AUTOWIND tick)

```ts
 1375          try { _blackBoxTick(s); } catch (e: any) { app.debug?.(`[black-box] tick: ${e?.message || e}`); }
 1376          // Rev634: a manoeuvre that expired (visor gone) is shown as ended.
 1377          // Rev638: and one pypilot is no longer doing (visor reloaded).
 1378          try {
 1379            if (apProvider) {
 1380              for (const id of maneuverGate.reconcile(Date.now(), String(apProvider.data.mode || ""), !!apProvider.data.engaged)) {
 1381                // eslint-disable-next-line no-console
 1382                console.log(`[maneuver] ${id} ended: pypilot left its mode or the AP is off`);
 1383              }
 1384            }
 1385            _publishManeuverKind();
 1386          } catch { /* silent */ }
 1387          // Rev518: AUTOWIND (apparent <-> true wind by TWA).
 1388          try { _autowindTick(); } catch (e: any) { app.debug?.(`[autowind] tick: ${e?.message || e}`); }
```

### src/index.ts lines 2895-2951 (HTTP /autowind (switch-on path))

```ts
 2895        // Rev518: AUTOWIND config + state.
 2896        router.get("/autowind", (_req: any, res: any) => {
 2897          res.json(_autowindState());
 2898        });
 2899        router.post("/autowind", async (req: any, res: any) => {
 2900          if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
 2901          const b = req.body || {};
 2902          let changed = false;
 2903          if (typeof b.profileApparent === "string") { props.autowindProfileApparent = b.profileApparent.trim(); changed = true; }
 2904          if (typeof b.profileTrue === "string") { props.autowindProfileTrue = b.profileTrue.trim(); changed = true; }
 2905          if (typeof b.thresholdDeg === "number") {
 2906            props.autowindThresholdDeg = clampNumber(b.thresholdDeg, 90, 150, AUTOWIND_DEFAULT_THRESHOLD_DEG);
 2907            changed = true;
 2908          }
 2909          if (changed) { try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ } }
 2910          if (typeof b.enabled === "boolean") {
 2911            const was = !!props.autowindEnabled;
 2912            // Rev633 (GPT re-audit 2026-11-06 R06): switching on goes through
 2913            // the same tack / manoeuvre guard as the 1 Hz tick. Refused, it
 2914            // stays off and says why.
 2915            if (b.enabled && !was) {
 2916              const busy = _autowindBusyReason();
 2917              if (busy) {
 2918                _autowindPublish();
 2919                return res.status(409).json({ ..._autowindState(), refused: busy });
 2920              }
 2921            }
 2922            _autowindSetEnabled(b.enabled, b.enabled ? "selected" : "another mode selected");
 2923            if (b.enabled && !was) {
 2924              // Pick the side now, no waiting. Without fresh true wind data
 2925              // (or below the wind floor) the start is apparent wind, on
 2926              // purpose: pypilot steers it from the vane alone.
 2927              const twa = _autowindTwaDeg();
 2928              const tws = _autowindTwsKn();
 2929              const usable = twa != null && tws != null && tws >= AUTOWIND_MIN_TWS_KN;
 2930              const sub = usable ? autowind.initial(twa, props.autowindThresholdDeg) : "wind";
 2931              const modeBefore = apProvider ? String(apProvider.data.mode || "").toLowerCase() : "";
 2932              await _autowindApply(sub, usable ? "AUTOWIND on" : "AUTOWIND on (no usable true wind: apparent)", true);
 2933              // Rev635/636 (Carlos QA 2026-11-06 16:42 and 16:58): AUTOWIND
 2934              // starts on the wind angle the boat has NOW. Without this the
 2935              // target was whatever was there - an Empopado's TWA 180 ended from
 2936              // another visor, an Aproado's AWA 0 - and on a mode change pypilot
 2937              // keeps the heading ERROR it had (61 deg off stayed 61 deg off),
 2938              // it does not re-centre on the wind.
 2939              if (apProvider && apProvider.data.engaged && props.autowindEnabled) {
 2940                await _autowindHoldCurrentAngle(sub, modeBefore !== sub);
 2941              }
 2942            }
 2943          }
 2944          // New profile for the side that is active right now: apply it.
 2945          if (props.autowindEnabled && changed && apProvider) {
 2946            const mode = String(apProvider.data.mode || "").toLowerCase();
 2947            if (mode === "wind" || mode === "true wind") _autowindApplyProfile(mode as WindSubMode, "profile chosen");
 2948          }
 2949          _autowindPublish();
 2950          res.json(_autowindState());
 2951        });
```

### src/index.ts lines 3508-3517 (HTTP /maneuver-state)

```ts
 3508        // {active:false} on their teardowns. Independent of trace log.
 3509        router.get("/maneuver-state", (_req: any, res: any) => {
 3510          res.json({ pseudoActive: _pseudoActive() });
 3511        });
 3512        router.post("/maneuver-state", (req: any, res: any) => {
 3513          const body = req.body || {};
 3514          maneuverGate.update(body.active, body.id, Date.now());
 3515          _publishManeuverKind();
 3516          res.json({ ok: true, pseudoActive: _pseudoActive() });
 3517        });
```

### src/index.ts lines 5043-5287 (AUTOWIND state, apply, hold angle, tick)

```ts
 5043    }
 5044    // Rev518 (Carlos 2026-10-19): AUTOWIND. See src/autowind.ts.
 5045    function _autowindState(): Record<string, unknown> {
 5046      const mode = apProvider ? String(apProvider.data.mode || "") : "";
 5047      return {
 5048        enabled: !!props.autowindEnabled,
 5049        subMode: mode === "wind" || mode === "true wind" ? mode : null,
 5050        profileApparent: props.autowindProfileApparent || "",
 5051        profileTrue: props.autowindProfileTrue || "",
 5052        thresholdDeg: props.autowindThresholdDeg ?? AUTOWIND_DEFAULT_THRESHOLD_DEG,
 5053        lastSwitchTs: _autowindLastSwitchTs,
 5054        lastReason: _autowindLastReason,
 5055        // Rev630 (sea trial 2026-11-05): why AUTOWIND cannot switch right now
 5056        // ("virtual-tack" | "pypilot-tack" | "manoeuvre" | "no-wind-data" |
 5057        // "wind-too-light" | null), and the last switch that failed.
 5058        blockedReason: props.autowindEnabled ? _autowindBlockedReason : null,
 5059        lastError: _autowindLastError,
 5060      };
 5061    }
 5062    function _autowindPublish(): void {
 5063      try {
 5064        app.handleMessage(PLUGIN_ID, {
 5065          context: "vessels." + app.selfId,
 5066          updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [
 5067            { path: "steering.autopilot.autowind", value: _autowindState() },
 5068          ] }],
 5069        });
 5070      } catch { /* silent */ }
 5071    }
 5072    function _autowindProfileFor(sub: WindSubMode): string {
 5073      return (sub === "true wind" ? props.autowindProfileTrue : props.autowindProfileApparent) || "";
 5074    }
 5075    /** false = pypilot did not take the profile write. */
 5076    function _autowindApplyProfile(sub: WindSubMode, reason: string): boolean {
 5077      const want = _autowindProfileFor(sub);
 5078      if (!want) return true;
 5079      if (client && client.getValues()["profile"] === want) return true;
 5080      let sent = false;
 5081      try {
 5082        if (client && client.connected) {
 5083          profileChangeLog.markPlannedWrite(want, "autowind", reason);
 5084          sent = client.set("profile", want) !== false;
 5085        }
 5086      } catch { /* silent */ }
 5087      // Rev630 (GPT audit 2026-11-05 F03): a refused write is a failure.
 5088      if (!sent) _autowindFail(`profile ${want} not sent to pypilot`);
 5089      return sent;
 5090    }
 5091    function _autowindFail(msg: string): void {
 5092      _autowindLastError = msg;
 5093      // eslint-disable-next-line no-console
 5094      console.log(`[autowind] failed: ${msg}`);
 5095      _autowindPublish();
 5096    }
 5097    // Rev630 (GPT audit 2026-11-05 F02/F03): `fromTick` = an automatic switch
 5098    // (its outcome feeds the decider's gap / retry). An operation number:
 5099    // turning AUTOWIND off, or a newer apply, makes an apply still waiting on
 5100    // pypilot stop there - no profile, no "switched" afterwards.
 5101    // Rev636: target = the current wind angle in the mode AUTOWIND starts in.
 5102    // After a mode change pypilot rewrites heading_command in its own loop
 5103    // (same race as the tack cancel, Rev515): wait 400 ms, write, check at
 5104    // 1.2 s, rewrite once. A newer AUTOWIND order or "off" stops it.
 5105    async function _autowindHoldCurrentAngle(sub: WindSubMode, modeChanged: boolean): Promise<void> {
 5106      if (!apProvider) return;
 5107      const op = _autowindOp;
 5108      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
 5109      const iface = apProvider.toProviderInterface() as any;
 5110      if (modeChanged) await sleep(400);
 5111      let nowRad: number | null = null;
 5112      for (let attempt = 0; attempt < 2; attempt++) {
 5113        if (op !== _autowindOp || !props.autowindEnabled || !apProvider.data.engaged) return;
 5114        if (String(apProvider.data.mode || "").toLowerCase() !== sub) return;
 5115        if (attempt === 0) {
 5116          // SK angles are radians; TWA from the same fresh sources AUTOWIND decides on.
 5117          nowRad = sub === "true wind"
 5118            ? _autowindFresh(["environment.wind.angleTrueWater", "environment.wind.angleTrueGround"])
 5119            : _autowindFresh(["environment.wind.angleApparent"]);
 5120          if (nowRad == null) { _autowindFail("no fresh wind angle to hold: target left as it was"); return; }
 5121        } else {
 5122          // pypilot kept what we wrote: done. Else it overwrote it: once more.
 5123          const cur = apProvider.data.target;
 5124          if (typeof cur === "number" && Math.abs(Math.atan2(Math.sin(cur - nowRad!), Math.cos(cur - nowRad!))) < 5 * Math.PI / 180) return;
 5125        }
 5126        try { await iface.setTarget(nowRad, apProvider.deviceId); }
 5127        catch (e: any) { _autowindFail(`hold the current wind angle: ${e?.message || e}`); return; }
 5128        // eslint-disable-next-line no-console
 5129        console.log(`[autowind] target = current ${sub === "true wind" ? "TWA" : "AWA"} ${((nowRad as number) * 180 / Math.PI).toFixed(0)} deg`);
 5130        await sleep(1200);
 5131      }
 5132    }
 5133    // Rev633: why AUTOWIND must not switch now (tack or visor manoeuvre), or null.
 5134    function _autowindBusyReason(): string | null {
 5135      if (!apProvider) return null;
 5136      if (apProvider.isVirtualTackActive()) return "virtual-tack";
 5137      if (_tackStatePrev && _tackStatePrev !== "none") return "pypilot-tack";
 5138      if (_pseudoActive()) return "manoeuvre";
 5139      return null;
 5140    }
 5141    async function _autowindApply(sub: WindSubMode, reason: string, fromTick = false): Promise<void> {
 5142      if (!apProvider) return;
 5143      const op = ++_autowindOp;
 5144      _autowindProfilePending = null;
 5145      _autowindLastReason = reason;
 5146      const current = () => op === _autowindOp && !!props.autowindEnabled;
 5147      const cur = String(apProvider.data.mode || "").toLowerCase();
 5148      if (cur !== sub) {
 5149        // wind <-> true wind share the angle space: pypilot keeps the
 5150        // heading itself on the mode change, nothing else is written.
 5151        // Rev633 (GPT re-audit 2026-11-06 R01/R02): no retry goes out once
 5152        // AUTOWIND is off or overridden, and success = pypilot's own echo of
 5153        // the mode, not the write being accepted.
 5154        _autowindInFlight++;
 5155        try {
 5156          await apProvider.setModeIfWanted(sub, current);
 5157          const t0 = Date.now();
 5158          while (String(apProvider.data.mode || "").toLowerCase() !== sub) {
 5159            if (!current()) break;
 5160            if (Date.now() - t0 > AUTOWIND_CONFIRM_MS) throw new Error(`not confirmed by pypilot in ${AUTOWIND_CONFIRM_MS / 1000} s`);
 5161            await new Promise<void>((r) => setTimeout(r, 100));
 5162          }
 5163        } catch (e: any) {
 5164          _autowindInFlight--;
 5165          if (!current()) return;
 5166          if (fromTick) autowind.noteFailure(Date.now());
 5167          _autowindFail(`mode ${sub}: ${e?.message || e}`);
 5168          return;
 5169        }
 5170        _autowindInFlight--;
 5171        if (!current()) {
 5172          // eslint-disable-next-line no-console
 5173          console.log(`[autowind] ${sub} landed after AUTOWIND was turned off or overridden: profile left as is`);
 5174          return;
 5175        }
 5176        _autowindLastSwitchTs = Date.now();
 5177        autowind.noteSwitch(_autowindLastSwitchTs);
 5178      }
 5179      _autowindLastError = null;
 5180      if (!_autowindApplyProfile(sub, reason)) {
 5181        // Rev633 (GPT R09 / Gemini 3.1): the mode is right but pypilot did not
 5182        // take the profile - retry it from the tick, a few times.
 5183        const was = client ? String(client.getValues()["profile"] ?? "") : "";
 5184        _autowindProfilePending = { sub, op, was, tries: 1, nextMs: Date.now() + AUTOWIND_PROFILE_RETRY_MS };
 5185      }
 5186      // eslint-disable-next-line no-console
 5187      console.log(`[autowind] ${reason} -> ${sub}${_autowindProfileFor(sub) ? ` / profile ${_autowindProfileFor(sub)}` : ""}`);
 5188      _autowindPublish();
 5189    }
 5190    function _autowindSetEnabled(on: boolean, why: string): void {
 5191      if (!!props.autowindEnabled === on) return;
 5192      props.autowindEnabled = on;
 5193      if (!on) { _autowindOp++; _autowindBlockedReason = null; _autowindProfilePending = null; }
 5194      try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ }
 5195      // eslint-disable-next-line no-console
 5196      console.log(`[autowind] ${on ? "on" : "off"} (${why})`);
 5197      _autowindLastReason = why;
 5198      _autowindPublish();
 5199    }
 5200    // Rev632 (AUTOWIND audit 2026-11-05, GPT F06): AUTOWIND only decides on
 5201    // wind data younger than AUTOWIND_MAX_DATA_AGE_MS. A path that stopped
 5202    // (sensor off, plugin that publishes only now and then, like
 5203    // polar-performance's speedTrue) is skipped for the next one; none fresh
 5204    // = "no-wind-data". The sampler / alarms keep using _readTwaRad as is.
 5205    function _autowindFresh(paths: string[]): number | null {
 5206      const now = Date.now();
 5207      for (const p of paths) {
 5208        try {
 5209          const v = freshNumber(app.getSelfPath ? app.getSelfPath(p) : null, now);
 5210          if (v != null) return v;
 5211        } catch { /* next path */ }
 5212      }
 5213      return null;
 5214    }
 5215    function _autowindTwaDeg(): number | null {
 5216      // Rev534: angleTrueGround as the sampler does when Water is missing.
 5217      const r = _autowindFresh(["environment.wind.angleTrueWater", "environment.wind.angleTrueGround"]);
 5218      return r == null ? null : r * 180 / Math.PI;
 5219    }
 5220    function _autowindTwsKn(): number | null {
 5221      // Rev534 (GPT review 2 #6): same sources as the sampler.
 5222      const v = _autowindFresh(["environment.wind.speedTrue", "environment.wind.speedOverGround"]);
 5223      return v == null ? null : v * 1.94384;
 5224    }
 5225    function _autowindSetBlocked(reason: string | null): void {
 5226      if (reason === _autowindBlockedReason) return;
 5227      _autowindBlockedReason = reason;
 5228      // eslint-disable-next-line no-console
 5229      console.log(`[autowind] ${reason ? `blocked: ${reason}` : "unblocked"}`);
 5230      _autowindPublish();
 5231    }
 5232    function _autowindTick(): void {
 5233      if (!props.autowindEnabled || !apProvider) return;
 5234      const mode = String(apProvider.data.mode || "").toLowerCase();
 5235      const busy = _autowindBusyReason();
 5236      const vtActive = busy === "virtual-tack";
 5237      const pypilotTack = busy === "pypilot-tack";
 5238      const blocked = busy != null;
 5239      const twaNow = _autowindTwaDeg();
 5240      const twsNow = _autowindTwsKn();
 5241      _autowindSetBlocked(
 5242        busy ? busy
 5243        : twaNow == null || twsNow == null ? "no-wind-data"
 5244        : twsNow < AUTOWIND_MIN_TWS_KN ? "wind-too-light"
 5245        : null);
 5246      // Sailor (remote, TinyPilot, KIP) moved to compass/gps: AUTOWIND
 5247      // ends, like picking another mode in the visor. 5 s so a transient
 5248      // write race never switches it off.
 5249      // pypilot drops to compass on its own when it loses GPS / true wind
 5250      // (and returns when it is back): that is not the sailor leaving.
 5251      // Rev630 (Gemini audit 2026-11-05): only a tack, which passes through
 5252      // compass, suspends this check - a visor manoeuvre flag no longer does.
 5253      const trueWindAvailable = ((apProvider as any).pypilotModes || []).includes("true wind");
 5254      if (!vtActive && !pypilotTack && trueWindAvailable && mode !== "wind" && mode !== "true wind" && mode !== "") {
 5255        if (_autowindOffFamilySince == null) _autowindOffFamilySince = Date.now();
 5256        else if (Date.now() - _autowindOffFamilySince > 5000) {
 5257          _autowindOffFamilySince = null;
 5258          _autowindSetEnabled(false, `mode changed to ${mode}`);
 5259        }
 5260        return;
 5261      }
 5262      _autowindOffFamilySince = null;
 5263      if (_autowindInFlight > 0) return;   // a switch is still waiting on pypilot
 5264      // Rev633: a profile pypilot did not take, retried while the side holds.
 5265      const pend = _autowindProfilePending;
 5266      if (pend && Date.now() >= pend.nextMs) {
 5267        const nowProfile = client ? String(client.getValues()["profile"] ?? "") : "";
 5268        // The sailor picked another profile meanwhile: theirs wins.
 5269        const sailorChose = nowProfile !== pend.was && nowProfile !== _autowindProfileFor(pend.sub);
 5270        if (pend.op !== _autowindOp || mode !== pend.sub || blocked || sailorChose) _autowindProfilePending = null;
 5271        else if (_autowindApplyProfile(pend.sub, "profile retry")) { _autowindProfilePending = null; _autowindLastError = null; _autowindPublish(); }
 5272        else if (pend.tries >= AUTOWIND_PROFILE_TRIES) { _autowindProfilePending = null; _autowindFail(`profile ${_autowindProfileFor(pend.sub)} not taken after ${pend.tries} tries: set it by hand`); }
 5273        else { pend.tries++; pend.nextMs = Date.now() + AUTOWIND_PROFILE_RETRY_MS; }
 5274      }
 5275      const want = autowind.tick({
 5276        nowMs: Date.now(),
 5277        twaDeg: twaNow,
 5278        mode,
 5279        engaged: !!apProvider.data.engaged,
 5280        blocked,
 5281        twsKn: twsNow,
 5282        thresholdDeg: props.autowindThresholdDeg,
 5283      });
 5284      if (want) {
 5285        void _autowindApply(want, `TWA ${twaNow == null ? "?" : Math.abs(twaNow).toFixed(0)} deg`, true);
 5286      }
 5287    }
```

### src/autopilot-provider.ts lines 480-496 (provider _setWithRetry)

```ts
  480    // reporting a false success.
  481    private async _setWithRetry(
  482      name: string,
  483      value: unknown,
  484      isStale?: () => boolean,
  485    ): Promise<boolean> {
  486      if (this.client.set(name, value)) return true;
  487      if (isStale && isStale()) return false;
  488      await new Promise((r) => setTimeout(r, 250));
  489      if (isStale && isStale()) return false;
  490      if (this.client.set(name, value)) return true;
  491      if (isStale && isStale()) return false;
  492      await new Promise((r) => setTimeout(r, 750));
  493      if (isStale && isStale()) return false;
  494      return this.client.set(name, value);
  495    }
  496  
```

### src/autopilot-provider.ts lines 605-682 (provider setModeIfWanted / setMode)

```ts
  605  
  606    /** Rev633 (GPT re-audit 2026-11-06 R01): a mode switch that only stands
  607     *  while `stillWanted()` says so - checked before the write and before
  608     *  every retry. AUTOWIND uses it, so turning AUTOWIND off stops a retry
  609     *  that has not gone out yet. */
  610    async setModeIfWanted(mode: string, stillWanted: () => boolean): Promise<void> {
  611      return this.setMode(mode, false, stillWanted);
  612    }
  613  
  614    // Rev633 (GPT re-audit 2026-11-06 R07): `internal` marks the virtual
  615    // tack's own writes, per call. It used to be a shared flag held across
  616    // an await, and an outside call arriving during a retry inherited it.
  617    private async setMode(mode: string, internal = false, stillWanted?: () => boolean): Promise<void> {
  618      // Rev547 (2026-10-25 22:14-22:16): pypilot accepts ap.mode="nav" even
  619      // without a route (no APB); the route follower then found NAV with no
  620      // route, went to compass and said "route lost" - twice. NAV only when
  621      // pypilot offers it (= an active route is feeding APB).
  622      if (String(mode).toLowerCase() === "nav" && !this.pypilotModes.includes("nav")) {
  623        throw new Error("NAV needs an active route (activate one in Freeboard first)");
  624      }
  625      // Rev390: same guard as setTarget — reject external mode changes
  626      // while the FSM is driving. If the sailor really wants to abort
  627      // the maneuver, they tap TACK a second time or call /virtual-tack/
  628      // cancel, which flows through cancelVirtualTack and rolls back
  629      // cleanly.
  630      if (this._virtualTack && !internal) {
  631        const active = this._virtualTack.phase !== "idle"
  632          && this._virtualTack.phase !== "completed"
  633          && this._virtualTack.phase !== "cancelled"
  634          && this._virtualTack.phase !== "failed";
  635        if (active) {
  636          // eslint-disable-next-line no-console
  637          console.log(`[virtual-tack] rejected external setMode '${mode}' (FSM is driving)`);
  638          // Rev630 (GPT audit 2026-11-05 F02): a refusal, not a silent return -
  639          // AUTOWIND took the return for success and changed the profile.
  640          // Same wording as setTarget's refusal.
  641          throw new Error("mode change refused: virtual tack is driving the pilot");
  642        }
  643      }
  644      if (
  645        this.data.options.modes.length > 0 &&
  646        !this.data.options.modes.includes(mode)
  647      ) {
  648        throw new Error(`Invalid mode: ${mode}`);
  649      }
  650      // Rev292 (Carlos, navigating - bug C "piloto girando loco"):
  651      // snapshot the OLD mode so we can decide whether the transition
  652      // needs a heading_command re-anchor. Pypilot's ap.heading_command
  653      // lives in different spaces depending on the mode:
  654      //   compass/gps/nav   -> compass heading in degrees 0..360
  655      //   wind              -> AWA in degrees -180..+180
  656      //   true wind         -> TWA in degrees -180..+180
  657      // A stale value from the previous mode (say a 90° heading) becomes
  658      // a 90° AWA when we cross into wind mode, and pypilot promptly
  659      // tries to swing the boat toward it — the "piloto se vuelve loco"
  660      // symptom Carlos reported on Rev280 sea trial. The fix: right
  661      // after ap.mode changes, force heading_command to the CURRENT
  662      // measurement in the destination space, so the pilot has a
  663      // sane target and never chases a value that meant something else.
  664      const oldMode = String(this.data.mode || "").toLowerCase();
  665      const newMode = String(mode || "").toLowerCase();
  666      // Rev279 (audit follow-up B): bump modeGen so a stale mode retry
  667      // aborts before overwriting a newer setMode / setState intent.
  668      const gen = ++this.modeGen;
  669      // Rev254 (Carlos audit): fail explicit when pypilot offline.
  670      // Rev255: retry with backoff.
  671      const unwanted = () => !!stillWanted && !stillWanted();
  672      if (unwanted()) throw new Error("mode change no longer wanted");
  673      if (!(await this._setWithRetry("ap.mode", mode, () => this.modeGen !== gen || unwanted()))) {
  674        if (unwanted()) throw new Error("mode change no longer wanted");
  675        if (this.modeGen !== gen) {
  676          throw new Error("mode change superseded by newer order");
  677        }
  678        throw new Error("pypilot offline: mode change not delivered");
  679      }
  680      if (this.modeGen !== gen) {
  681        throw new Error("mode change superseded after write");
  682      }
```

### src/autopilot-provider.ts lines 766-788 (provider setTarget guard)

```ts
  766  
  767    /** Rev390: `internal` = a write of _runVirtualTack itself, so the
  768     *  external-write guard below can tell our FSM's writes from frontend
  769     *  writes (nudges, adjust target, legacy countdown) that would compete
  770     *  with the maneuver. Rev633: per call, see setMode. */
  771    private async setTarget(rad: number, internal = false): Promise<void> {
  772      // Rev390 (Carlos, 2026-10-01, QA Rev389): reject external target
  773      // writes while a virtual tack is driving the pilot. Rev389 QA
  774      // caught a mid-maneuver `setTarget rad=0.9250 deg=53.00` that
  775      // competed with the FSM's own intermediate (`rad=0.4498 deg=25.77`)
  776      // and ultimately corrupted the maneuver. We now swallow any
  777      // target write that didn't originate from _runVirtualTack itself.
  778      if (this._virtualTack && !internal) {
  779        const active = this._virtualTack.phase !== "idle"
  780          && this._virtualTack.phase !== "completed"
  781          && this._virtualTack.phase !== "cancelled"
  782          && this._virtualTack.phase !== "failed";
  783        if (active) {
  784          // eslint-disable-next-line no-console
  785          console.log(`[virtual-tack] rejected external setTarget rad=${rad.toFixed(4)} (FSM is driving)`);
  786          return;
  787        }
  788      }
```

### public/app.js lines 11402-11457 (visor: mode button)

```js
11402    // label (white). This is what the sailor reads at a glance.
11403    function _renderModeSelectBtn() {
11404      const btn = document.getElementById("mode-select-btn");
11405      if (!btn) return;
11406      btn.title = "";
11407      // Rev510 (Carlos sea trial 2026-10-18, 18:07-18:12: "la tablet decia
11408      // un modo y el telefono decia otro"): during a virtual tack pypilot is
11409      // in compass on purpose. Every visor shows the wind mode of the tack,
11410      // from the backend snapshot (same on every screen). Rev515 (Carlos
11411      // 2026-10-19): no "TACKING ->" prefix, it read as a new mode.
11412      const vt = state.virtualTack;
11413      if (vt && vt.active) {
11414        const txt = _modeLabel(vt.windMode || state.mode || "wind");
11415        if (btn.textContent !== txt) btn.textContent = txt;
11416        return;
11417      }
11418      // Rev632 (Carlos QA 2026-11-05: "Empopado dice REAL"): a running
11419      // Aproado / Empopado shows its own name, not pypilot's wind mode.
11420      for (const [man, label] of [[state.empopado, "empopado"], [state.aproado, "aproado"]]) {
11421        if (man && (man.phase === "transit" || man.phase === "active")) {
11422          btn.textContent = _modeLabel(label);
11423          return;
11424        }
11425      }
11426      // Rev634 (Carlos QA 2026-11-06): a manoeuvre run from another visor.
11427      if (!state.empopado && !state.aproado && (state.remoteManeuver === "empopado" || state.remoteManeuver === "aproado")) {
11428        btn.textContent = _modeLabel(state.remoteManeuver);
11429        return;
11430      }
11431      const m = state.mode || "";
11432      // Rev518: AUTOWIND -> "AUTO · REAL" / "AUTO · APARENTE".
11433      if (state.autowind && state.autowind.enabled && (m === "wind" || m === "true wind")) {
11434        // Rev630 (sea trial 2026-11-05: "AUTO · REAL" was on screen while the
11435        // backend could not switch): say why it is waiting, if it is.
11436        // Rev634 (Carlos QA 2026-11-06: "no cabe en el botón"): the reason
11437        // goes on a small second line.
11438        const why = state.autowind.blockedReason;
11439        const whyKey = `autowind.blocked.${why}`;
11440        btn.textContent = `${t("autowind.short")} · ${_modeLabel(m)}`;
11441        if (why) {
11442          const sub = document.createElement("span");
11443          sub.className = "mode-btn-why";
11444          sub.textContent = t(whyKey);
11445          btn.appendChild(sub);
11446        }
11447        btn.title = state.autowind.lastError || "";
11448        return;
11449      }
11450      // Rev545: NAV -> "NAV · <waypoint> · 2.3 nm".
11451      if (m === "nav" && state.route && state.route.active) {
11452        const nm = typeof state.route.distanceM === "number" ? (state.route.distanceM / 1852).toFixed(1) : "?";
11453        btn.textContent = `${t("route.navShort")} · ${state.route.name || "WP"} · ${nm} nm`;
11454        return;
11455      }
11456      btn.textContent = m ? _modeLabel(m) : "—";
11457    }
```

### public/app.js lines 11513-11537 (visor: AUTOWIND POST (refusal))

```js
11513    }
11514    async function _autowindPost(body) {
11515      try {
11516        const r = await skFetch(`/plugins/${PLUGIN_ID}/autowind`, {
11517          method: "POST",
11518          headers: { "Content-Type": "application/json" },
11519          body: JSON.stringify(body),
11520        });
11521        if (r.ok) {
11522          state.autowind = await r.json();
11523          _renderModeSelectBtn();
11524          _rebuildModePopupProfiles();
11525        } else if (r.status === 409) {
11526          // Rev633: a tack or a manoeuvre is running - AUTOWIND did not start.
11527          const j = await r.json().catch(() => ({}));
11528          state.autowind = j && typeof j === "object" ? j : state.autowind;
11529          setSelect("#mode-select", state.mode || "");
11530          // Rev636 (Carlos QA 2026-11-06: "vaya mensaje más cutre"): a full
11531          // sentence that says what is running and what to do.
11532          const why = j && j.refused;
11533          const bodyKey = why === "manoeuvre" ? "autowind.refusedBody.manoeuvre" : "autowind.refusedBody.tack";
11534          _pmAlert(t("autowind.refused"), t(bodyKey));
11535        }
11536      } catch (e) { console.warn("[autowind] post", e); }
11537    }
```

### public/app.js lines 12265-12354 (visor: manoeuvre flag, heartbeat, left-from-outside)

```js
12265    } catch { /* silent */ }
12266    // Rev323 (Carlos, 2026-09-27): tell the backend a visor-side
12267    // pseudo-modo is active/inactive. Backend uses this to silence the
12268    // heading-deviation family of alarms during Aproado / Empopado. In
12269    // the sea trial 2026-09-27 alarms disparaban por doquier durante
12270    // esas maniobras porque `ap.tack.state` seguía en "none" y el gate
12271    // Rev311 no las cazaba.
12272    // Rev534: the backend forgets the flag after 60 s unless renewed, so a
12273    // closed browser cannot leave the alarms silenced. Renew every 20 s.
12274    // Rev630 (sea trial 2026-11-05): the flag belongs to one manoeuvre (its
12275    // id) and each renewal first checks that this manoeuvre is still in
12276    // transit / active. Closing the Empopado summary by hand used to leave
12277    // the renewal running for the rest of the session: AUTOWIND blocked and
12278    // the three steering alarms silenced for ~48 min.
12279    let _maneuverPseudoTimer = null;
12280    let _maneuverPseudoId = null;
12281    // Rev634 (Carlos QA 2026-11-06, 01:14: Empopado ended from the tablet,
12282    // this laptop kept its window open): a manoeuvre is left when pypilot,
12283    // after reaching the manoeuvre's mode, reports another mode or the AP
12284    // off - from a remote, KIP or another visor. It ends here too, without
12285    // touching mode or target (whoever left chose them). Empopado still
12286    // restores its temporary gains/profile if the profile is still its own.
12287    // Rev635 (Carlos QA 2026-11-06 16:42): the AP off counts only when it
12288    // lasts - the backend's own stuck-pilot recovery takes it off and on in
12289    // under a second, and that ended an Empopado. Another mode counts at once.
12290    const MANEUVER_AP_OFF_GRACE_MS = 3000;
12291    function _endLocalManeuverIfLeft() {
12292      const pairs = [[state.empopado, "true wind"], [state.aproado, "wind"]];
12293      for (const [man, own] of pairs) {
12294        if (!man || (man.phase !== "transit" && man.phase !== "active")) continue;
12295        if (state.mode === own && state.engaged) { man._modeReached = true; continue; }
12296        if (!man._modeReached) continue;   // still on its way in
12297        if (state.mode === own && !state.engaged) {
12298          if (!man._apOffTimer) {
12299            man._apOffTimer = setTimeout(() => {
12300              man._apOffTimer = null;
12301              if (!state.engaged) _endManeuverHere(man, own);
12302            }, MANEUVER_AP_OFF_GRACE_MS);
12303          }
12304          continue;
12305        }
12306        _endManeuverHere(man, own);
12307      }
12308    }
12309    function _endManeuverHere(man, own) {
12310      if (man !== state.empopado && man !== state.aproado) return;
12311      if (man.phase !== "transit" && man.phase !== "active") return;
12312      if (man._apOffTimer) { clearTimeout(man._apOffTimer); man._apOffTimer = null; }
12313      console.info(`[${own === "wind" ? "aproado" : "empopado"}] left from outside (mode=${state.mode}, engaged=${state.engaged}): ending here`);
12314      if (man === state.empopado) empopadoTearDown({ restoreAll: false });
12315      else aproadoTearDown();
12316    }
12317    function _pseudoManeuverRunning(id) {
12318      for (const m of [state.aproado, state.empopado]) {
12319        if (m && m.id === id && (m.phase === "transit" || m.phase === "active")) return true;
12320      }
12321      return false;
12322    }
12323    function _setManeuverPseudo(active, id) {
12324      // Not the manoeuvre the heartbeat renews: end its own backend entry
12325      // only (Rev633, Gemini re-audit 2026-11-06).
12326      if (!active && id && _maneuverPseudoId && id !== _maneuverPseudoId) { _postManeuverPseudo(false, id); return; }
12327      try { if (_maneuverPseudoTimer) { clearInterval(_maneuverPseudoTimer); _maneuverPseudoTimer = null; } } catch { /* silent */ }
12328      if (active) {
12329        _maneuverPseudoId = id;
12330        _maneuverPseudoTimer = setInterval(() => {
12331          // Rev638: second chance for the "left from outside" check, in case
12332          // its 3 s timer did not run (tab in the background).
12333          for (const [man, own] of [[state.empopado, "true wind"], [state.aproado, "wind"]]) {
12334            if (man && man.id === id && man._modeReached && (state.mode !== own || !state.engaged)) _endManeuverHere(man, own);
12335          }
12336          if (_pseudoManeuverRunning(id)) _postManeuverPseudo(true, id);
12337          else _setManeuverPseudo(false, id);
12338        }, 20000);
12339        _postManeuverPseudo(true, id);
12340      } else {
12341        const was = _maneuverPseudoId;
12342        _maneuverPseudoId = null;
12343        if (was) _postManeuverPseudo(false, was);
12344      }
12345    }
12346    function _postManeuverPseudo(active, id) {
12347      try {
12348        skFetch(`/plugins/${PLUGIN_ID}/maneuver-state`, {
12349          method: "POST",
12350          headers: { "Content-Type": "application/json" },
12351          body: JSON.stringify({ active: !!active, id }),
12352        }).catch(() => { /* silent - alarm gate is best-effort */ });
12353      } catch { /* silent */ }
12354    }
```

### public/app.js lines 12658-12726 (visor: aproadoExecute)

```js
12658  
12659    async function aproadoExecute() {
12660      const apr = state.aproado;
12661      if (!apr) return;
12662      // Rev323 (Carlos, 2026-09-27): flag pseudo-modo activo para
12663      // silenciar heading-deviation / cruise-drift / unable-to-steer
12664      // durante la maniobra.
12665      _setManeuverPseudo(true, apr.id);
12666      // Rev90: transit is a NEW phase between countdown and active. The
12667      // boat starts rotating toward head-to-wind; only when |AWA| falls
12668      // below APROADO_ACHIEVED_DEG do we consider it "aproada" and start
12669      // the elapsed timer. Distance tracking, however, begins here so it
12670      // covers the whole maneuver (transit + aproado).
12671      apr.phase = "transit";
12672      apr.executeTs = Date.now();
12673      apr.startTs = null;                      // elapsed clock arms later
12674      apr.startPos = state.position ? { ...state.position } : null;
12675      apr.startHeadingDeg = state.heading != null
12676        ? ((state.heading * RAD2DEG + 360) % 360)
12677        : null;
12678      setSelect("#mode-select", "aproado");
12679      _setPhase("transit");
12680      const hud = _aproadoHud();
12681      if (hud) { hud.classList.add("transit"); hud.classList.remove("summary"); }
12682      // Set the transit title now so it reflects the chosen direction.
12683      const transitTitle = document.getElementById("aproado-transit-title");
12684      if (transitTitle) {
12685        transitTitle.textContent = apr.direction === "bow"
12686          ? t("aproado.transit.title.bow")
12687          : t("aproado.transit.title.stern");
12688      }
12689      try {
12690        // Rev359: wait for state.mode="wind" echo before writing target,
12691        // otherwise pypilot interprets target=0 as compass heading 0
12692        // instead of AWA=0 (bug #1 Sprint K sea trial 2026-09-28).
12693        await apSetModeAndWait("wind");
12694        // Rev539 (GPT review 5 #2): cancelled while waiting -> write nothing.
12695        if (state.aproado !== apr || apr.phase !== "transit") return;
12696        if (apr.direction === "bow" || state.windAngle == null) {
12697          // PROA: shortest path (pypilot's default) is bow-through when
12698          // starting from close-hauled or reaching. Also fallback for POPA
12699          // when we have no wind sensor - we cannot force the swing side
12700          // without knowing which side the wind is on.
12701          apr._targetIsFinal = true;
12702          await apSetTargetRad(0);
12703        } else {
12704          // POR POPA (Rev92): pypilot has no jibe primitive - if we just
12705          // command target = 0 it picks the SHORTEST arc, which for a
12706          // close-hauled boat is the bow-through side. To force the swing
12707          // to go through the stern we walk a chain of intermediate
12708          // targets 60 deg apart around the LONG side of the circle. Each
12709          // step waits for the boat to catch up before advancing, so
12710          // pypilot never has an ambiguous or reversible shortest-path
12711          // decision. When the chain wraps past the far side we release
12712          // the final target = 0 and let _aproadoCheckAchieved latch into
12713          // the active phase.
12714          apr._targetIsFinal = false;
12715          aproadoForceStern(state.windAngle);   // fire-and-forget async
12716        }
12717        if (state.aproado !== apr || apr.phase !== "transit") return;
12718        if (!state.engaged) await apEngage();
12719      } catch (e) {
12720        console.warn("aproado: mode/target/engage failed", e);
12721        // Self-audit Rev540: the mode did not change (refused / not
12722        // confirmed): end the manoeuvre instead of a "transit" that does nothing.
12723        if (state.aproado === apr) { aproadoTearDown(); setSelect("#mode-select", state.mode || ""); }
12724        return;
12725      }
12726      updateAproadoHud();
```

### public/app.js lines 12860-12875 (visor: aproadoTearDown)

```js
12860    // (used when the user picks another mode from the dropdown while active).
12861    function aproadoTearDown() {
12862      const apr = state.aproado;
12863      if (!apr) return;
12864      _mtLog("aproado_teardown", { phase: apr.phase, direction: apr.direction });
12865      // Rev323: cerrar el gate pseudo-modo antes de nada; el backend
12866      // vuelve a evaluar heading-deviation con el umbral normal.
12867      _setManeuverPseudo(false, apr.id);
12868      if (apr._cdTimer) { clearInterval(apr._cdTimer); apr._cdTimer = null; }
12869      if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
12870      if (apr._summaryTimer) { clearTimeout(apr._summaryTimer); apr._summaryTimer = null; }
12871      hideAproadoHud();
12872      state.aproado = null;
12873      try { _renderModeSelectBtn(); } catch { /* silent */ }
12874    }
12875  
```

### public/app.js lines 12973-13049 (visor: Empopado temporary gains)

```js
12973    }
12974    // Rev633 (GPT re-audit 2026-11-06 R05): the manoeuvre is still running
12975    // and on the profile the gains were raised in.
12976    function _empopadoHotGainsOwned(ap) {
12977      return state.empopado === ap && (ap.phase === "transit" || ap.phase === "active")
12978        && state.profile === ap._hotGainProfile;
12979    }
12980    async function _empopadoApplyHotGains(ap) {
12981      if (!ap || ap._hotGainSnapshot) return;
12982      const pilot = state.pilot;
12983      if (!pilot) return;
12984      // Rev633: the original of each gain is recorded BEFORE it is raised,
12985      // so a manoeuvre ended half way restores what was already sent; and no
12986      // further gain is raised once it ended or the profile changed.
12987      ap._hotGainProfile = state.profile;
12988      ap._hotGainSnapshot = {};
12989      const cat = state.catalog || {};
12990      const vals = state.pypilotValues || {};
12991      const targets = [
12992        { path: `ap.pilot.${pilot}.P`,  mult: EMPOPADO_HOT_GAIN_MULT.P },
12993        { path: `ap.pilot.${pilot}.D`,  mult: EMPOPADO_HOT_GAIN_MULT.D },
12994        { path: `servo.max_slew_speed`, mult: EMPOPADO_HOT_GAIN_MULT.SLEW },
12995      ];
12996      const applied = {};
12997      let anyFailed = false;
12998      for (const t of targets) {
12999        const entry = cat[t.path];
13000        const cur = vals[t.path];
13001        if (typeof cur !== "number") continue;
13002        const max = typeof entry?.max === "number" ? entry.max : Infinity;
13003        const next = Math.min(cur * t.mult, max);
13004        if (Math.abs(next - cur) < 1e-6) continue;
13005        if (!_empopadoHotGainsOwned(ap)) { console.info("empopado: ended or profile changed - no more hot gains"); break; }
13006        ap._hotGainSnapshot[t.path] = cur;
13007        try {
13008          const resp = await pluginRaw(t.path, next);
13009          if (resp && resp.ok === false) {
13010            anyFailed = true;
13011            console.warn(`[empopado] hot gain ${t.path} refused by pypilot (status=${resp.status})`);
13012            continue;
13013          }
13014          applied[t.path] = cur;
13015          console.info(`empopado: hot gain ${t.path} ${cur.toFixed(3)} → ${next.toFixed(3)}`);
13016        } catch (e) {
13017          anyFailed = true;
13018          console.warn(`empopado: hot gain ${t.path} apply failed`, e);
13019        }
13020      }
13021      const appliedCount = Object.keys(applied).length;
13022      if (appliedCount === 0) {
13023        console.warn(`[empopado] hot gains NO aplicadas — pilot='${pilot}' valsKeys=${Object.keys(vals).length} anyFailed=${anyFailed}`);
13024        _empopadoSetHotBadge(anyFailed ? "failed" : "off");
13025      } else {
13026        _empopadoSetHotBadge(anyFailed ? "failed" : "on");
13027      }
13028    }
13029    async function _empopadoRestoreHotGains(ap) {
13030      const snap = ap && ap._hotGainSnapshot;
13031      if (!snap) {
13032        _empopadoSetHotBadge(null);
13033        return;
13034      }
13035      for (const [path, val] of Object.entries(snap)) {
13036        // Rev633 (GPT re-audit 2026-11-06 R04): checked before EVERY write -
13037        // an old gain is never written into a profile chosen meanwhile.
13038        if (ap._hotGainProfile !== undefined && state.profile !== ap._hotGainProfile) {
13039          console.warn(`empopado: profile is now "${state.profile}", not "${ap._hotGainProfile}": ${path} and the rest left as they are`);
13040          break;
13041        }
13042        try {
13043          await pluginRaw(path, val);
13044          console.info(`empopado: hot gain ${path} restored → ${val.toFixed(3)}`);
13045        } catch (e) { console.warn(`empopado: hot gain ${path} restore failed`, e); }
13046      }
13047      ap._hotGainSnapshot = null;
13048      _empopadoSetHotBadge(null);
13049    }
```

### public/app.js lines 13103-13167 (visor: empopadoExecute)

```js
13103    }
13104    async function empopadoExecute() {
13105      const ap = state.empopado;
13106      if (!ap) return;
13107      // Rev323 (Carlos, 2026-09-27): silenciar heading-deviation /
13108      // cruise-drift / unable-to-steer durante la maniobra.
13109      _setManeuverPseudo(true, ap.id);
13110      ap.phase = "transit";
13111      ap.executeTs = Date.now();
13112      ap.startTs = null;
13113      ap.startPos = state.position ? { ...state.position } : null;
13114      ap.startHeadingDeg = state.heading != null
13115        ? ((state.heading * RAD2DEG + 360) % 360)
13116        : null;
13117      setSelect("#mode-select", "empopado");
13118      _empopadoSetPhase("transit");
13119      const hud = _empopadoHud();
13120      if (hud) { hud.classList.add("transit"); hud.classList.remove("summary"); }
13121      const transitTitle = document.getElementById("empopado-transit-title");
13122      if (transitTitle) transitTitle.textContent = t("empopado.hud.title") || "EMPOPANDOSE";
13123      // Cambio de perfil a uno reactivo (seguridad en popa).
13124      const reactive = _empopadoPickReactiveProfile();
13125      if (reactive && reactive !== state.profile) {
13126        try {
13127          await pluginRaw("profile", reactive);
13128          ap._profileSwapped = reactive;
13129          console.info(`empopado: profile swapped ${ap.snapshot.profile} → ${reactive} (reactive)`);
13130        } catch (e) { console.warn("empopado: profile swap failed", e); }
13131        // Rev633 (GPT re-audit 2026-11-06 R03): ended while swapping: put the
13132        // profile back and send nothing else.
13133        if (state.empopado !== ap || ap.phase !== "transit") {
13134          if (ap._profileSwapped && ap.snapshot.profile) { try { pluginRaw("profile", ap.snapshot.profile).catch(() => {}); } catch { /* silent */ } }
13135          return;
13136        }
13137      }
13138      try {
13139        // Rev367 (Carlos, 2026-09-30, sea-trial feedback): empopado
13140        // use TRUE WIND mode (TWA control) instead of "wind" (AWA
13141        // control). En viento de popa el AWA es errático (viento
13142        // relativo casi = velocidad del barco) y pypilot no puede
13143        // fijarse. TWA es el ángulo respecto al viento real, estable
13144        // aunque el barco varíe de rumbo. Pypilot core soporta "true
13145        // wind" como mode string (con espacio; ver SW_MODE_MAP en
13146        // src/index.ts). Rev359 apSetModeAndWait espera el eco antes
13147        // del target write.
13148        await apSetModeAndWait("true wind");
13149        // Rev539 (GPT review 5 #2): cancelled while waiting -> write nothing.
13150        if (state.empopado !== ap || ap.phase !== "transit") return;
13151        // Target TWA = π - 0.001 (viento por popa). Usamos ligeramente
13152        // menos de π para evitar que pypilot normalice al opuesto.
13153        const targetRad = Math.PI - 0.001;
13154        await apSetTargetRad(targetRad);
13155        ap._targetIsFinal = true;
13156        if (state.empopado !== ap || ap.phase !== "transit") return;
13157        if (!state.engaged) await apEngage();
13158        console.info(`empopado: dir=${ap.direction} mode="true wind" target=${targetRad.toFixed(3)} engage sent`);
13159      } catch (e) {
13160        console.warn("empopado: mode/target/engage failed", e);
13161        // Self-audit Rev540: same as aproado.
13162        if (state.empopado === ap) { empopadoTearDown({}); setSelect("#mode-select", state.mode || ""); }
13163        return;
13164      }
13165      updateEmpopadoHud();
13166      ap._hudTimer = setInterval(updateEmpopadoHud, APROADO_HUD_TICK_MS);
13167    }
```

### public/app.js lines 13294-13426 (visor: empopadoFinish, empopadoTearDown, empopadoClose)

```js
13294    }
13295    async function empopadoFinish(opts) {
13296      const ap = state.empopado;
13297      if (!ap || (ap.phase !== "active" && ap.phase !== "transit")) return;
13298      // Rev407 (Carlos sea trial 2026-10-03): default = no restore. The
13299      // sailor stays on whatever heading the AP ended up at after the
13300      // manoeuvre. Previously the default was true, which triggered an
13301      // automatic mode+target+engage restore to the pre-empopado state.
13302      // Carlos: "el salir del modo y volver a rumbo me parece peligrosísimo,
13303      // es casi mejor quedarnos en el rumbo que estamos. [...] nos quedamos
13304      // en ese rumbo" (sea trial 2026-10-03). The sailor explicitly opts in
13305      // by passing { restoreAll: true } if they want the old behaviour.
13306      const restoreAll = !!(opts && opts.restoreAll === true);
13307      const silent = !!(opts && opts.silent);
13308      if (ap._hudTimer) { clearInterval(ap._hudTimer); ap._hudTimer = null; }
13309      ap.endTs = Date.now();
13310      if (ap.startPos && state.position) {
13311        ap.distanceNm = _distanceNm(ap.startPos, state.position);
13312      }
13313      if (ap.startTs == null) ap.startTs = ap.endTs;
13314      ap.phase = silent ? "summary" : "summary";
13315      // Rev630 (sea trial 2026-11-05): the manoeuvre is over - stop the
13316      // "manoeuvre active" flag now, as aproadoFinish does. It used to wait
13317      // for the summary timer, which closing the summary by hand cancelled.
13318      _setManeuverPseudo(false, ap.id);
13319      const hud = _empopadoHud();
13320      if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
13321      _empopadoSetPhase("summary");
13322      updateEmpopadoHud();
13323      const snap = ap.snapshot;
13324      if (snap.mode) setSelect("#mode-select", snap.mode);
13325      // Rev320: restaurar gains hot ANTES del profile swap.
13326      // El profile swap sobrescribe todos los gains — si hacemos primero
13327      // el restore de nuestros hot gains y luego el profile restore, es
13328      // idempotente. Si el orden fuera al revés, el profile pondría los
13329      // gains del perfil original y nuestro restore (con valores ya
13330      // sobrescritos por el profile) los pisaría con valores viejos.
13331      await _empopadoRestoreHotGains(ap);
13332      // Rev633 (GPT re-audit 2026-11-06 R03): closed (or another mode chosen)
13333      // while restoring: the sailor's choice stands, nothing more is sent.
13334      if (state.empopado !== ap) return;
13335      // Perfil siempre restaura si lo swapeamos.
13336      if (ap._profileSwapped && snap.profile && snap.profile !== ap._profileSwapped && state.profile === ap._profileSwapped) {
13337        try { await pluginRaw("profile", snap.profile); console.info(`empopado: profile restored → ${snap.profile}`); }
13338        catch (e) { console.warn("empopado: profile restore failed", e); }
13339        if (state.empopado !== ap) return;
13340      }
13341      if (restoreAll) {
13342        if (snap.mode) {
13343          try { await apSetMode(snap.mode); console.info(`empopado: mode restored → ${snap.mode}`); }
13344          catch (e) { console.warn("empopado: mode restore failed", e); }
13345        }
13346        if (typeof snap.targetRad === "number") {
13347          try { await apSetTargetRad(snap.targetRad); console.info(`empopado: target restored → ${snap.targetRad.toFixed(3)}`); }
13348          catch (e) { console.warn("empopado: target restore failed", e); }
13349        }
13350        if (snap.engaged === false && state.engaged) {
13351          try { await apDisengage(); console.info("empopado: AP disengaged (was OFF before empopado)"); }
13352          catch (e) { console.warn("empopado: disengage restore failed", e); }
13353        }
13354      } else {
13355        // Rev440 (Carlos 2026-10-10): salir dejando el pilot en "true wind"
13356        // es menos estable que compass para mantener el rumbo actual.
13357        // Conmutar a compass con target = heading actual: el barco se
13358        // queda EXACTAMENTE donde está pero bajo el modo seguro. Si no
13359        // hay sensor de heading, dejar como estaba.
13360        const curHdg = (typeof state.heading === "number") ? state.heading : null;
13361        if (curHdg != null) {
13362          try {
13363            await apSetModeAndWait("compass");
13364            if (state.empopado !== ap) return;   // Rev633 R03
13365            await apSetTargetRad(curHdg);
13366            console.info(`empopado: safe-exit to compass @ ${(curHdg * RAD2DEG).toFixed(1)} deg (Rev440)`);
13367          } catch (e) {
13368            console.warn("empopado: safe-exit to compass failed", e);
13369          }
13370        } else {
13371          console.info("empopado: finish without restore (Rev407 default) — no heading sensor, leaving pilot where it is");
13372        }
13373      }
13374      // Auto-hide del summary igual que aproado (usa APROADO_SUMMARY_MS).
13375      // Rev630: close only - gains and profile were restored above; a second
13376      // restore 15 s later overwrote what the sailor had chosen meanwhile.
13377      ap._summaryTimer = setTimeout(() => { if (state.empopado === ap) empopadoClose(); }, APROADO_SUMMARY_MS);
13378    }
13379    function empopadoTearDown(opts) {
13380      const ap = state.empopado;
13381      if (!ap) return;
13382      _mtLog("empopado_teardown", { phase: ap.phase, direction: ap.direction, restoreAll: !!(opts && opts.restoreAll) });
13383      // Rev316: restore adicional si tearDown fue directo (sin pasar por
13384      // finish, ej. mode-select change durante active).
13385      const restoreAll = opts && opts.restoreAll === true;
13386      const snap = ap.snapshot || {};
13387      // Rev320: restaurar hot gains ANTES del profile (mismo orden que
13388      // empopadoFinish; ver comentario allí para el racional).
13389      // Rev539 (GPT review 5 #9): wait for the gain restore before switching
13390      // profile, or the last gains land on the original profile.
13391      // Rev630 (GPT audit 2026-11-05 F04): this runs after the sailor's next
13392      // choice may have landed (AUTOWIND writes its own profile). Restore
13393      // only while the profile is still the one the manoeuvre left.
13394      const swapped = ap._profileSwapped;
13395      const left = swapped || snap.profile;
13396      if (state.profile === left) {
13397        _empopadoRestoreHotGains(ap).catch(() => {}).then(() => {
13398          if (swapped && snap.profile && snap.profile !== swapped && state.profile === swapped) {
13399            try { pluginRaw("profile", snap.profile).catch(() => {}); } catch { /* silent */ }
13400          }
13401        });
13402      } else {
13403        console.info(`empopado: profile is now "${state.profile}", not "${left}": gains/profile not restored`);
13404      }
13405      if (restoreAll) {
13406        if (snap.mode) { try { apSetMode(snap.mode).catch(() => {}); } catch {} }
13407        if (typeof snap.targetRad === "number") { try { apSetTargetRad(snap.targetRad).catch(() => {}); } catch {} }
13408        if (snap.engaged === false && state.engaged) { try { apDisengage().catch(() => {}); } catch {} }
13409      }
13410      empopadoClose();
13411    }
13412    // Rev630 (sea trial 2026-11-05): ends the manoeuvre without touching
13413    // gains, profile or mode - the "manoeuvre active" flag, timers, HUD and
13414    // state. Every way out goes through here: the end of the summary, the
13415    // summary closed by hand, another mode chosen, the teardown above.
13416    function empopadoClose() {
13417      const ap = state.empopado;
13418      if (!ap) return;
13419      _setManeuverPseudo(false, ap.id);
13420      if (ap._hudTimer)     { clearInterval(ap._hudTimer);   ap._hudTimer = null; }
13421      if (ap._summaryTimer) { clearTimeout(ap._summaryTimer); ap._summaryTimer = null; }
13422      hideEmpopadoHud();
13423      state.empopado = null;
13424      try { _renderModeSelectBtn(); } catch { /* silent */ }
13425    }
13426  
```

### public/app.js lines 13434-13510 (visor: aproadoFinish)

```js
13434    // before pypilot's echo lands.
13435    async function aproadoFinish(opts) {
13436      const apr = state.aproado;
13437      if (!apr || (apr.phase !== "active" && apr.phase !== "transit")) return;
13438      if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
13439      apr.endTs = Date.now();
13440      if (apr.startPos && state.position) {
13441        apr.distanceNm = _distanceNm(apr.startPos, state.position);
13442      }
13443      // If we never reached the achieved phase, stamp startTs so the
13444      // summary shows a meaningful "0:00" instead of NaN.
13445      if (apr.startTs == null) apr.startTs = apr.endTs;
13446      apr.phase = "summary";
13447      // Rev539 (GPT review 5 #1): the manoeuvre is over - stop renewing the
13448      // "manoeuvre active" flag that silences the heading alarms.
13449      _setManeuverPseudo(false, apr.id);
13450      const hud = _aproadoHud();
13451      if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
13452      _setPhase("summary");
13453      updateAproadoHud();
13454      // Rev415 (Carlos sea trial 2026-10-04, obs #11): "hay que anular el
13455      // restituir rumbo cuando salimos de aproado o empopado porque es
13456      // peligroso". Default `restoreAll=false` matches what empopadoFinish
13457      // did since Rev407 R. Keep the opt-in for the (rare) case where the
13458      // sailor really wants the pre-aproado state back.
13459      const restoreAll = !!(opts && opts.restoreAll === true);
13460      // Optimistic dropdown update so UI does not stay stuck on "aproado".
13461      const snap = apr.snapshot;
13462      if (restoreAll) {
13463        if (snap.mode) setSelect("#mode-select", snap.mode);
13464        // Rev90: guard each step separately so one failure does not skip
13465        // the others. Log successes for QA visibility.
13466        if (snap.mode) {
13467          try { await apSetMode(snap.mode); console.info("aproado: mode restored ->", snap.mode); }
13468          catch (e) { console.warn("aproado: mode restore failed", e); }
13469        }
13470        if (snap.targetRad != null) {
13471          try { await apSetTargetRad(snap.targetRad); console.info("aproado: target restored ->", snap.targetRad.toFixed(3), "rad"); }
13472          catch (e) { console.warn("aproado: target restore failed", e); }
13473        }
13474        // If the AP was NOT engaged before aproado, disengage now (Rev88 #10).
13475        if (!snap.engaged) {
13476          try { await apDisengage(); console.info("aproado: AP disengaged (was OFF before aproado)"); }
13477          catch (e) { console.warn("aproado: disengage failed", e); }
13478        }
13479      } else {
13480        // Rev440 (Carlos 2026-10-10): "al salir queda en wind, mejor
13481        // compass por estabilidad de rumbo". aproadoStart puso el pilot
13482        // en modo "wind" para controlar AWA. Si no restauramos, el
13483        // barco se queda en wind indefinidamente — menos estable que
13484        // compass para mantener el rumbo actual. Fix: conmutar a
13485        // compass con target = heading actual, de modo que el pilot
13486        // sostenga EXACTAMENTE el rumbo donde quedó la maniobra pero
13487        // en el modo seguro. Si falta sensor de heading, dejar como
13488        // estaba (sin sacar al pilot de wind a ciegas).
13489        const curHdg = (typeof state.heading === "number") ? state.heading : null;
13490        if (curHdg != null) {
13491          try {
13492            await apSetModeAndWait("compass");
13493            if (state.aproado !== apr) return;   // Rev633 R03: closed meanwhile
13494            await apSetTargetRad(curHdg);
13495            console.info(`aproado: safe-exit to compass @ ${(curHdg * RAD2DEG).toFixed(1)} deg (Rev440)`);
13496          } catch (e) {
13497            console.warn("aproado: safe-exit to compass failed", e);
13498          }
13499        } else {
13500          console.info("aproado: finish without restore (Rev415 default) — no heading sensor, leaving pilot where it is");
13501        }
13502      }
13503      apr._summaryTimer = setTimeout(() => {
13504        if (state.aproado === apr) {
13505          hideAproadoHud();
13506          state.aproado = null;
13507        }
13508      }, APROADO_SUMMARY_MS);
13509    }
13510  
```

### public/app.js lines 14053-14155 (visor: mode select handler)

```js
14053      // and never land on the mode-select's value).
14054      $("#mode-select").addEventListener("change", (e) => {
14055        _msCollapse();
14056        const chosen = e.target.value;
14057        // Picking another mode while a pseudo-mode is active ends the
14058        // maneuver WITHOUT restoring the pre-* mode (usuario ya
14059        // eligió qué quiere ahora). SÍ restaura el profile (Empopado).
14060        // Use the SALIR button on the HUD to return to the previous mode.
14061        // Rev630 (sea trial 2026-11-05): done first, so AUTOWIND and NAV
14062        // (which return early below) end it too, and a manoeuvre still
14063        // showing its summary is closed as well.
14064        // Rev633 (GPT R10 / Gemini 2.2, re-audit 2026-11-06): Aproado ends an
14065        // Empopado and vice versa - only one manoeuvre at a time.
14066        let endedManoeuvre = false;
14067        if (chosen !== "empopado") {
14068          const emp = state.empopado;
14069          if (emp && (emp.phase === "transit" || emp.phase === "active")) { empopadoTearDown({ restoreAll: false }); endedManoeuvre = true; }
14070          else if (emp) empopadoClose();
14071        }
14072        if (chosen !== "aproado") {
14073          const apr = state.aproado;
14074          if (apr && (apr.phase === "transit" || apr.phase === "active")) { aproadoTearDown(); endedManoeuvre = true; }
14075          else if (apr) aproadoTearDown();
14076        }
14077        // Rev633 (Gemini 2.1): the manoeuvre left pypilot on its extreme
14078        // target (AWA 0 / TWA 180). Going on in a wind mode (AUTOWIND
14079        // included) holds the wind angle the boat has NOW instead.
14080        const endedOnWindTarget = endedManoeuvre && (state.mode === "wind" || state.mode === "true wind");
14081        // Rev518: pseudo-mode AUTOWIND lives in the backend.
14082        if (chosen === "autowind") {
14083          (async () => {
14084            if (endedOnWindTarget) {
14085              const now = state.mode === "true wind" ? state.windAngleTrue : state.windAngle;
14086              if (typeof now === "number") { try { await apSetTargetRad(now); } catch (e) { console.warn("[mode-select] hold wind angle", e); } }
14087            }
14088            _autowindPost({ enabled: true });
14089          })();
14090          return;
14091        }
14092        if (state.autowind && state.autowind.enabled) {
14093          _autowindPost({ enabled: false });
14094        }
14095        // Rev545 (Carlos #4): NAV that would turn more than 60 deg asks first.
14096        if (chosen === "nav" && state.engaged && state.route && typeof state.route.legBearingDeg === "number" && typeof state.heading === "number") {
14097          const turn = Math.abs((((state.route.legBearingDeg - state.heading * RAD2DEG) % 360) + 540) % 360 - 180);
14098          if (turn > 60) {
14099            (async () => {
14100              const ok = await _pmConfirm(t("route.bigTurnQ").replace("{deg}", String(Math.round(turn))), t("route.bigTurnBody"));
14101              if (ok) apSetMode("nav");
14102              else setSelect("#mode-select", state.mode || "");
14103            })();
14104            return;
14105          }
14106        }
14107        // Rev88: pseudo-mode "aproado" is intercepted locally - opens the
14108        // choice modal (bow / stern) and starts the maneuver on confirmation.
14109        if (chosen === "aproado") {
14110          aproadoStart();
14111          return;
14112        }
14113        // Rev313 (Carlos sea trial 2026-09-25): pseudo-mode "empopado"
14114        // (viento por popa para bajar vela).
14115        if (chosen === "empopado") {
14116          empopadoStart();
14117          return;
14118        }
14119        // Rev170/171 (Carlos): fix target reference when switching
14120        // between compass-family and wind-family modes without the
14121        // brief "wrong then right" flash. Pypilot interprets
14122        // ap.heading_command differently per mode - a heading value in
14123        // compass/gps/nav, an APPARENT WIND ANGLE in wind, a TRUE WIND
14124        // ANGLE in "true wind". If we just change mode, the old value
14125        // is reinterpreted for one tick and the diamond leaps.
14126        //
14127        // Rev170 approach: apSetMode() then apSetTargetRad() 250 ms
14128        // later. That produced the "duda" Carlos reported.
14129        //
14130        // Rev171 approach: compute the right target FIRST, apply it
14131        // OPTIMISTICALLY to the visor, then send target + mode in
14132        // parallel (Promise.all). The visor never renders the stale
14133        // interpretation, and pypilot receives both PUTs at once so
14134        // the AutopilotProvider echo-cancellation absorbs the swap.
14135        const prevMode = String(state.mode || "").toLowerCase();
14136        const newMode = String(chosen).toLowerCase();
14137        const isNewTrueWind = newMode.includes("true") && newMode.includes("wind");
14138        const isNewWind     = newMode.includes("wind") && !isNewTrueWind;
14139        const isNewCompassFam = !newMode.includes("wind");
14140        const wasWindFam    = prevMode.includes("wind");
14141        // Rev249 (Carlos): family change is real regardless of engaged
14142        // state. Before, if the AP was disengaged the code left the old
14143        // target rad untouched and the diamond would reinterpret it
14144        // under the new mode (e.g. a wind AWA target of 0.85 rad ends up
14145        // painted as a 49 deg compass heading). Reajustar SIEMPRE.
14146        const familyChanged = wasWindFam !== !isNewCompassFam;
14147        let newTargetRad = null;
14148        // Rev633 (Gemini 2.1): after a manoeuvre, a wind mode also starts on
14149        // the angle the boat has now, not on the manoeuvre's AWA 0 / TWA 180.
14150        const reanchor = familyChanged || (endedOnWindTarget && !isNewCompassFam);
14151        if (reanchor) {
14152          if (isNewTrueWind && state.windAngleTrue != null) newTargetRad = state.windAngleTrue;
14153          else if (isNewWind && state.windAngle != null)    newTargetRad = state.windAngle;
14154          else if (isNewCompassFam && state.heading != null) newTargetRad = state.heading;
14155        }
```

### public/app.js lines 5307-5372 (visor: mode delta handler)

```js
 5307          break;
 5308        case "steering.autopilot.mode":
 5309          if (typeof _mtLog === "function") {
 5310            try { _mtLog("other", { stage: "visor", path: "steering.autopilot.mode", value, prev: state.mode, monoTs: performance.now() }); } catch { /* silent */ }
 5311          }
 5312          // Rev394 (Carlos, 2026-10-01, Gemini round 2): shield up until
 5313          // the backend explicitly nulls the virtualTack path. Rev392 only
 5314          // guarded while active=true, which left a ~5s window (terminal
 5315          // phase + linger) during which late pypilot echoes repainted
 5316          // the amber arrow. Now we swallow any mode delta while
 5317          // state.virtualTack exists (any phase, incl. terminal). The
 5318          // backend emits { virtualTack: null } once the 5s cleanup fires;
 5319          // at that point state.virtualTack becomes null and canonical
 5320          // deltas flow through normally.
 5321          if (state.virtualTack) {
 5322            break;
 5323          }
 5324          // Rev249 (Carlos): swallow a stale mode delta that arrives
 5325          // shortly after the user changed the selector locally. If the
 5326          // incoming value differs from the just-picked one, it is a
 5327          // pre-change echo; ignore. A delta matching the chosen mode
 5328          // (pypilot confirming) clears the guard.
 5329          if (Date.now() < _modeChangePendingUntil) {
 5330            if (value !== _modeChangeChosen) {
 5331              console.log(`[mode] swallow stale delta '${value}' (chose '${_modeChangeChosen}')`);
 5332              break;
 5333            }
 5334            _modeChangePendingUntil = 0;
 5335            _modeChangeChosen = null;
 5336          }
 5337          // Rev295 (Carlos, navigating - bug C reinforcement): when the
 5338          // mode crosses the compass ↔ wind boundary, the backend
 5339          // provider re-anchors ap.heading_command to the current
 5340          // measurement in the destination space. During the ~200-800 ms
 5341          // it takes for the new target delta to arrive, the visor would
 5342          // otherwise keep showing the OLD target diamond and the sailor
 5343          // sees a stale value. Invalidate the local target so the
 5344          // diamond hides during the anchor gap; the next fresh
 5345          // steering.autopilot.target delta will repopulate it.
 5346          try {
 5347            const oldWind = String(state.mode || "").toLowerCase().includes("wind");
 5348            const newWind = String(value || "").toLowerCase().includes("wind");
 5349            if (oldWind !== newWind) {
 5350              state.target = null;
 5351              state.localTargetRad = null;
 5352              if (typeof renderTargetArrow === "function") renderTargetArrow();
 5353            }
 5354          } catch { /* silent */ }
 5355          state.mode = value;
 5356          // Self-audit Rev541: the mode pypilot really reported (state.mode
 5357          // can be set optimistically by the selector before the echo).
 5358          state._confirmedMode = value;
 5359          _endLocalManeuverIfLeft();
 5360          // Rev425: keep the visible mode-button in sync on external
 5361          // mode deltas.
 5362          try { _renderModeSelectBtn(); } catch { /* silent */ }
 5363          if (state.aproado && (state.aproado.phase === "transit" || state.aproado.phase === "active")) {
 5364            setSelect("#mode-select", "aproado");
 5365          } else {
 5366            setSelect("#mode-select", value);
 5367          }
 5368          _syncWindCornerFromMode(value);
 5369          // Rev207 (Carlos): mode change updates the button labels
 5370          // (compass / GPS -> "-100 deg" / "+100 deg"; wind -> "TACK").
 5371          try { renderTackButton(state.pypilotValues?.["ap.tack.state"]); } catch { /* silent */ }
 5372          break;
```

### public/app.js lines 5545-5558 (visor: engaged delta handler (start))

```js
 5545        }
 5546        case "steering.autopilot.engaged": {
 5547          if (typeof _mtLog === "function") {
 5548            try { _mtLog("other", { stage: "visor", path: "steering.autopilot.engaged", value, prev: state.engaged, monoTs: performance.now() }); } catch { /* silent */ }
 5549          }
 5550          const wasEngaged = state.engaged;
 5551          state.engaged = !!value;
 5552          // Rev262 (Carlos): TGT / diamond hide on disengage handled by
 5553          // the render layer (formatter 'tgt' + renderTargetArrow both
 5554          // guard on !state.engaged). Do NOT null state.target here -
 5555          // SK keeps pushing target deltas after disengage and would
 5556          // just repopulate it, creating a visible flicker.
 5557          renderEngage();
 5558          renderTargetArrow();
```
