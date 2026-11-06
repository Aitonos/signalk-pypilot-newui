# Final check before publishing 3.12.0: Rev641

Everything is in this one file. Paste the whole file into the LLM; ask for
the answer in Spanish if Carlos will read it directly.

Your review of Rev639-640 found six problems (#1-#6) plus one robustness
note on the Rev640 alarm, and recommended holding the release. **Rev641
fixes them. This check covers only Rev641.** If it is clean, 3.12.0 is
published.

---

## Task

You are a senior reviewer of safety-relevant marine software driving a
**pypilot autopilot on a sailing boat**.

1. For each of #1-#6 and the alarm note, say whether Rev641 closes it,
   citing lines, and which of your acceptance checks would now pass.
2. Find regressions or new bugs **introduced by Rev641**.
3. Give a clear verdict:
   - **publish**;
   - **publish with a noted limit**; or
   - **hold**, with the exact blocking defect.

For each finding give severity, the exact lines, a concrete scenario and
the smallest fix. Mark it **follows from the code** or **hypothesis**.
No style comments. Do not re-report the accepted limits below unless you
show they are worse than stated.

## System (unchanged)

- A Raspberry Pi 5 runs Signal K and this plugin.
- The autopilot is a TinyPilot (pypilot on a Pi Zero W).
- pypilot modes: `compass`, `gps`, `wind` (AWA) and `true wind` (TWA).
- On a mode change, pypilot keeps the heading error it had.
- The backend is `src/*.ts`; the visor is `public/app.js`, on several
  screens at once.
- Visor pseudo-modes: Aproado (`wind`, AWA 0) and Empopado (`true wind`,
  TWA 180, temporary gain raise).
- Their "manoeuvre running" flag (`POST /maneuver-state`, 20 s renewal,
  TTL 180 s) blocks AUTOWIND and silences three steering alarms.

## What Rev641 changed

- **#1 / #2, AUTOWIND start target** (`_autowindHoldCurrentAngle`,
  `src/index.ts`):
  - the target intent is taken when AUTOWIND is switched on
    (`targetGenAtStart`, the provider's target generation, read just
    before the mode switch). Any target order after that, even during
    the mode wait and the 400 ms, wins, and nothing is written;
  - there is no automatic rewrite any more: one write, then at 1.2 s a
    check against pypilot's reported `ap.heading_command` (2°);
  - a different value is left as it is and reported in `lastError`,
    because we cannot tell a sailor's order from pypilot's own;
  - a missing or non-numeric report counts as "not confirmed", never 0.
- **#3 / #4, hand-over between screens:**
  - the backend publishes `steering.autopilot.maneuverIds`;
  - a screen that chooses a mode posts `{active:false, ids:[...]}` with
    the ids it saw (`ManeuverGate.endIds`), so a late hand-over never
    ends a newer manoeuvre;
  - a renewal of an ended id is refused and refreshes its tombstone, so
    it never comes back while its owner keeps renewing;
  - the response carries `ended:true`, and the owner visor ends its
    manoeuvre on it;
  - `"*"` is gone.
- **#5:** with NAV and a turn over 60°, the hand-over is sent only after
  the confirm dialog is accepted, and only if that choice is still the
  latest (`selGen`).
- **#6:** Empopado gains whose restore failed are kept in a separate
  record (`_empopadoKeepPendingGains`). They are retried every 15 s while
  the profile is still theirs, 4 times; then the sailor gets a dialog
  listing them (ES/EN/DE/FR).
- **Alarm note:** `pypilot-sk-access` matches the request key
  (`pypilot-<n>`, how Signal K files it) first, and the message text as
  a fallback.

## Evidence

- 499 tests pass (`npm test`, exit code 0). New or changed tests:
  - gate: hand-over by ids; an ended id renewed for 400 s stays ended;
    a late hand-over does not end a later manoeuvre;
  - visor: a refused restore is kept in the separate record.
- The AUTOWIND start-target routine still has no unit test (it lives
  inside `index.ts`).
- **Harbour QA on the boat (Rev641, 2026-11-06, server journal and
  visor trace):**
  - AUTOWIND on, then +10 at once: the sailor's target stayed (81 → 91);
  - AUTOWIND on alone: target = current wind (63), no error;
  - Aproado on the laptop, then compass on the tablet: ended and did not
    come back;
  - Empopado on the laptop, then NAV on the tablet: ended at once. NAV
    later fell back to compass without a valid route, by design.

## Accepted limits (no need to report)

- If the profile is changed mid-restore, the gains not yet restored stay
  raised in the profile the manoeuvre left. The sailor is now told at
  the end.
- AUTOWIND's profile counts as done when pypilot accepts the write.
- A target set on pypilot directly (not through the provider) right
  after AUTOWIND's write is left as it is and reported, not overwritten.
- There is no TCP pypilot simulator in our own test suite.
- Out of scope for 3.12.0:
  - the backend re-anchor after compass ↔ wind;
  - the gust D-boost persistence;
  - the ±10 button crossing ±180°;
  - the minimum wind for wind modes.

## Diff since the code you reviewed (Rev640), src and public

```diff
diff --git a/public/app.js b/public/app.js
index 6c2d324..7226150 100644
--- a/public/app.js
+++ b/public/app.js
@@ -534,6 +534,8 @@
       "autowind.blocked.no-wind-data": "no wind data",
       "autowind.blocked.wind-too-light": "wind too light",
       "autowind.refused": "AUTOWIND not started",
+      "empopado.gainsNotRestored.title": "Gains not restored",
+      "empopado.gainsNotRestored.body": "Empopado could not put back these gains in profile {profile}: {list}. Check them in Tune.",
       "autowind.refusedBody.manoeuvre": "A head-to-wind or dead-downwind manoeuvre is running, maybe on another screen. End it and choose AUTOWIND again.",
       "autowind.refusedBody.tack": "A tack is in progress. When it is done, choose AUTOWIND again.",
       "mode.label.nav":       "NAV (ROUTE)",
@@ -1684,6 +1686,8 @@
       "autowind.blocked.no-wind-data": "sin datos de viento",
       "autowind.blocked.wind-too-light": "viento flojo",
       "autowind.refused": "AUTOWIND no arrancado",
+      "empopado.gainsNotRestored.title": "Ganancias sin restaurar",
+      "empopado.gainsNotRestored.body": "El Empopado no pudo devolver estas ganancias del perfil {profile}: {list}. Revísalas en Ajustes.",
       "autowind.refusedBody.manoeuvre": "Hay un Aproado o un Empopado en marcha, quizá en otra pantalla. Termínalo y vuelve a elegir AUTOWIND.",
       "autowind.refusedBody.tack": "Hay una virada en curso. Cuando termine, vuelve a elegir AUTOWIND.",
       "mode.label.nav":       "NAV (RUTA)",
@@ -2917,6 +2921,8 @@
       "autowind.blocked.no-wind-data": "keine Winddaten",
       "autowind.blocked.wind-too-light": "Wind zu schwach",
       "autowind.refused": "AUTOWIND nicht gestartet",
+      "empopado.gainsNotRestored.title": "Verstärkungen nicht zurückgesetzt",
+      "empopado.gainsNotRestored.body": "Platt vor dem Wind konnte diese Werte im Profil {profile} nicht zurücksetzen: {list}. Bitte unter Einstellungen prüfen.",
       "autowind.refusedBody.manoeuvre": "Ein Aufschießen oder Platt-vor-dem-Wind läuft, vielleicht auf einem anderen Bildschirm. Beende es und wähle AUTOWIND erneut.",
       "autowind.refusedBody.tack": "Eine Wende läuft. Wenn sie fertig ist, wähle AUTOWIND erneut.",
       "mode.label.empopado": "PLATT VOR DEM WIND",
@@ -4042,6 +4048,8 @@
       "autowind.blocked.no-wind-data": "pas de données de vent",
       "autowind.blocked.wind-too-light": "vent trop faible",
       "autowind.refused": "AUTOWIND non démarré",
+      "empopado.gainsNotRestored.title": "Gains non restaurés",
+      "empopado.gainsNotRestored.body": "Plein vent arrière n'a pas pu rétablir ces gains du profil {profile} : {list}. Vérifiez-les dans Réglages.",
       "autowind.refusedBody.manoeuvre": "Une manœuvre face au vent ou plein vent arrière est en cours, peut-être sur un autre écran. Terminez-la et choisissez de nouveau AUTOWIND.",
       "autowind.refusedBody.tack": "Un virement est en cours. Quand il est terminé, choisissez de nouveau AUTOWIND.",
       "mode.label.empopado": "PLEIN VENT ARRIÈRE",
@@ -5165,6 +5173,7 @@
       "steering.autopilot.autowind",
       "steering.autopilot.route",   // Rev545
       "steering.autopilot.maneuver", // Rev634: manoeuvre run by any visor
+      "steering.autopilot.maneuverIds", // Rev641: their ids, for a hand-over
       "steering.autopilot.pypilot.ap.tack.state",
       "steering.autopilot.pypilot.ap.tack.direction",
       "steering.autopilot.pypilot.ap.mode",
@@ -5403,6 +5412,10 @@
         try { _routeOnUpdate(); } catch { /* silent */ }
         break;
       }
+      case "steering.autopilot.maneuverIds": {
+        state.remoteManeuverIds = Array.isArray(value) ? value.filter((x) => typeof x === "string") : [];
+        break;
+      }
       case "steering.autopilot.maneuver": {
         state.remoteManeuver = typeof value === "string" ? value : null;
         // Rev639 (C7): the backend says no manoeuvre runs (taken over from
@@ -12373,9 +12386,28 @@
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ active: !!active, id }),
+      }).then(async (r) => {
+        // Rev641 (GPT re-audit of Rev640 #3): the backend says this
+        // manoeuvre was ended (hand-over from another screen, or pypilot
+        // left it): end it here too.
+        if (!active || !r || !r.ok) return;
+        const j = await r.json().catch(() => null);
+        if (!j || j.ended !== true) return;
+        for (const [man, own] of [[state.empopado, "true wind"], [state.aproado, "wind"]]) {
+          if (man && man.id === id) _endManeuverHere(man, own);
+        }
       }).catch(() => { /* silent - alarm gate is best-effort */ });
     } catch { /* silent */ }
   }
+  function _postManeuverHandOver(ids) {
+    try {
+      skFetch(`/plugins/${PLUGIN_ID}/maneuver-state`, {
+        method: "POST",
+        headers: { "Content-Type": "application/json" },
+        body: JSON.stringify({ active: false, ids }),
+      }).catch(() => { /* silent */ });
+    } catch { /* silent */ }
+  }
   // Rev465 → Rev466 (Carlos safety audit 2026-10-12): belt-and-suspenders
   // gate for every write that reaches pypilot. Reasons to block:
   //   1. pypilot core reported offline by the plugin backend.
@@ -13050,6 +13082,41 @@
       _empopadoSetHotBadge(anyFailed ? "failed" : "on");
     }
   }
+  // Rev641 (GPT re-audit of Rev640 #6): gains Empopado raised and could not
+  // put back. Retried every 15 s while the profile is still the one they
+  // belong to, 4 times; then the sailor is told which ones to check.
+  let _empopadoPendingGains = null;   // { profile, gains: {path: value}, tries, timer }
+  function _empopadoKeepPendingGains(profile, gains) {
+    if (_empopadoPendingGains && _empopadoPendingGains.timer) clearInterval(_empopadoPendingGains.timer);
+    const p = { profile, gains: { ...gains }, tries: 0, timer: null };
+    p.timer = setInterval(() => { _empopadoRetryPendingGains(p).catch(() => { /* silent */ }); }, 15000);
+    _empopadoPendingGains = p;
+  }
+  async function _empopadoRetryPendingGains(p) {
+    if (_empopadoPendingGains !== p || p.busy) return;
+    p.busy = true;
+    try {
+      if (p.profile === undefined || state.profile === p.profile) {
+        for (const [path, val] of Object.entries(p.gains)) {
+          if (p.profile !== undefined && state.profile !== p.profile) break;
+          try {
+            const resp = await pluginRaw(path, val);
+            if (!(resp && resp.ok === false)) { delete p.gains[path]; console.info(`empopado: pending gain ${path} restored → ${val.toFixed(3)}`); }
+          } catch { /* next try */ }
+        }
+      }
+      p.tries++;
+      const left = Object.keys(p.gains);
+      if (!left.length || p.tries >= 4) {
+        clearInterval(p.timer);
+        _empopadoPendingGains = null;
+        if (left.length) {
+          const list = left.map((k) => `${k} = ${Number(p.gains[k]).toFixed(3)}`).join(", ");
+          _pmAlert(t("empopado.gainsNotRestored.title"), t("empopado.gainsNotRestored.body").replace("{profile}", String(p.profile || "")).replace("{list}", list));
+        }
+      }
+    } finally { p.busy = false; }
+  }
   async function _empopadoRestoreHotGains(ap) {
     const snap = ap && ap._hotGainSnapshot;
     if (!snap) {
@@ -13077,6 +13144,9 @@
     const left = Object.keys(snap).length;
     ap._hotGainSnapshot = left ? snap : null;
     _empopadoSetHotBadge(left ? "failed" : null);
+    // Rev641 (GPT re-audit of Rev640 #6): what failed outlives the
+    // manoeuvre's window - kept here and retried on the same profile.
+    if (left) _empopadoKeepPendingGains(ap._hotGainProfile, snap);
   }
   function _empopadoPickReactiveProfile() {
     const list = Array.isArray(state.profiles) ? state.profiles : [];
@@ -14118,7 +14188,16 @@
       // Rev639 (GPT re-audit of Rev638 C7): a manoeuvre run from ANOTHER
       // screen ends too - choosing a mode here is taking over, even when
       // the new choice keeps pypilot in the same wind mode.
-      if (!state.empopado && !state.aproado && state.remoteManeuver) _postManeuverPseudo(false, "*");
+      // Rev641 (GPT re-audit of Rev640 #3/#4/#5): it ends exactly the ids
+      // this screen saw (a late hand-over never ends a newer manoeuvre),
+      // and only once the choice is really made (NAV asks first).
+      const seenIds = Array.isArray(state.remoteManeuverIds) ? state.remoteManeuverIds.slice() : [];
+      const handOver = () => {
+        if (!state.empopado && !state.aproado && seenIds.length) _postManeuverHandOver(seenIds);
+      };
+      const navAsks = chosen === "nav" && state.engaged && state.route && typeof state.route.legBearingDeg === "number" && typeof state.heading === "number"
+        && Math.abs((((state.route.legBearingDeg - state.heading * RAD2DEG) % 360) + 540) % 360 - 180) > 60;
+      if (!navAsks) handOver();
       // Rev633 (Gemini 2.1): the manoeuvre left pypilot on its extreme
       // target (AWA 0 / TWA 180). Going on in a wind mode (AUTOWIND
       // included) holds the wind angle the boat has NOW instead.
@@ -14144,7 +14223,7 @@
         if (turn > 60) {
           (async () => {
             const ok = await _pmConfirm(t("route.bigTurnQ").replace("{deg}", String(Math.round(turn))), t("route.bigTurnBody"));
-            if (ok) apSetMode("nav");
+            if (ok && selGen === _modeSelectGen) { handOver(); apSetMode("nav"); }
             else setSelect("#mode-select", state.mode || "");
           })();
           return;
diff --git a/public/index.html b/public/index.html
index e63db31..4b0d28b 100644
--- a/public/index.html
+++ b/public/index.html
@@ -27,7 +27,7 @@
        style.css never shows the rose unstyled on a white page. The rose
        is hidden until style.css (loaded below) makes it visible again. -->
   <style>html,body{background:#0a1220;color:#e6edf3}#wind-rose{visibility:hidden}</style>
-  <link rel="stylesheet" href="style.css?v=Rev640" />
+  <link rel="stylesheet" href="style.css?v=Rev641" />
 </head>
 <body class="theme-dark">
   <!-- Rev490 (GPU audit 2026-10-15): flag the Raspberry Pi's own screen
@@ -2813,6 +2813,6 @@
     </div>
   </div>
 
-  <script src="app.js?v=Rev640"></script>
+  <script src="app.js?v=Rev641"></script>
 </body>
 </html>
diff --git a/src/index.ts b/src/index.ts
index 6c4eeaf..a0bd5eb 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -83,7 +83,7 @@ import {
 
 // Rev counter bumped on every build so the user can distinguish deploys
 // from the webapp header (feedback_revision_bump_each_build).
-const PLUGIN_REVISION = "Rev640";
+const PLUGIN_REVISION = "Rev641";
 
 // Rev59: read package.json once at load time so /status can report the
 // npm package version alongside the internal Rev counter.
@@ -622,14 +622,20 @@ module.exports = function (app: any) {
   // steering.autopilot.maneuver: "aproado" | "empopado" | "manoeuvre" | null).
   let _maneuverKindSent: string | null | undefined;
   const _publishManeuverKind = (): void => {
-    const k = maneuverGate.kind(Date.now());
-    if (k === _maneuverKindSent) return;
-    _maneuverKindSent = k;
+    const now = Date.now();
+    const k = maneuverGate.kind(now);
+    // Rev641: the ids too, so a hand-over from another screen ends exactly
+    // those (GPT re-audit of Rev640 #3/#4).
+    const ids = maneuverGate.ids(now);
+    const sig = `${k}|${ids.join(",")}`;
+    if (sig === _maneuverKindSent) return;
+    _maneuverKindSent = sig;
     try {
       app.handleMessage(PLUGIN_ID, {
         context: "vessels." + app.selfId,
         updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [
           { path: "steering.autopilot.maneuver", value: k },
+          { path: "steering.autopilot.maneuverIds", value: ids },
         ] }],
       });
     } catch { /* silent */ }
@@ -2929,6 +2935,8 @@ module.exports = function (app: any) {
             const usable = twa != null && tws != null && tws >= AUTOWIND_MIN_TWS_KN;
             const sub = usable ? autowind.initial(twa, props.autowindThresholdDeg) : "wind";
             const modeBefore = apProvider ? String(apProvider.data.mode || "").toLowerCase() : "";
+            // Rev641: the target intent at switch-on; any later order wins.
+            const targetGenAtStart = apProvider ? apProvider.targetGeneration() : -1;
             await _autowindApply(sub, usable ? "AUTOWIND on" : "AUTOWIND on (no usable true wind: apparent)", true);
             // Rev635/636 (Carlos QA 2026-11-06 16:42 and 16:58): AUTOWIND
             // starts on the wind angle the boat has NOW. Without this the
@@ -2937,7 +2945,7 @@ module.exports = function (app: any) {
             // keeps the heading ERROR it had (61 deg off stayed 61 deg off),
             // it does not re-centre on the wind.
             if (apProvider && apProvider.data.engaged && props.autowindEnabled) {
-              await _autowindHoldCurrentAngle(sub, modeBefore !== sub);
+              await _autowindHoldCurrentAngle(sub, modeBefore !== sub, targetGenAtStart);
             }
           }
         }
@@ -3511,9 +3519,11 @@ module.exports = function (app: any) {
       });
       router.post("/maneuver-state", (req: any, res: any) => {
         const body = req.body || {};
-        maneuverGate.update(body.active, body.id, Date.now());
+        let ended = false;
+        if (body.active === false && Array.isArray(body.ids)) maneuverGate.endIds(body.ids, Date.now());
+        else ended = maneuverGate.update(body.active, body.id, Date.now()) === "ended";
         _publishManeuverKind();
-        res.json({ ok: true, pseudoActive: _pseudoActive() });
+        res.json({ ok: true, pseudoActive: _pseudoActive(), ended });
       });
       const validKinds: ManeuverEventKind[] = [
         "aproado_start", "aproado_pick", "aproado_teardown",
@@ -5106,40 +5116,43 @@ module.exports = function (app: any) {
     try {
       const tree = app.getSelfPath ? app.getSelfPath("notifications.security.accessRequest") : null;
       let pending = false;
-      const walk = (o: any, depth: number): void => {
+      // Rev641 (GPT re-audit of Rev640): the request's own key first (Signal
+      // K files it under the client id, "pypilot-<n>"), the text as a
+      // fallback.
+      const walk = (o: any, key: string, depth: number): void => {
         if (!o || typeof o !== "object" || depth > 4 || pending) return;
         const v = o.value;
         if (v && typeof v === "object" && typeof v.state === "string") {
-          if (v.state !== "normal" && /"pypilot"/i.test(String(v.message || ""))) pending = true;
+          const fromPypilot = /^pypilot-/i.test(key) || /"pypilot"/i.test(String(v.message || ""));
+          if (v.state !== "normal" && fromPypilot) pending = true;
           return;
         }
-        for (const k of Object.keys(o)) walk(o[k], depth + 1);
+        for (const k of Object.keys(o)) walk(o[k], k, depth + 1);
       };
-      walk(tree, 0);
+      walk(tree, "", 0);
       return pending;
     } catch { return false; }
   }
   // Rev636: target = the current wind angle in the mode AUTOWIND starts in.
-  // After a mode change pypilot rewrites heading_command in its own loop
-  // (same race as the tack cancel, Rev515): wait 400 ms, write, check at
-  // 1.2 s, rewrite once.
-  // Rev639 (GPT re-audit of Rev638, C1-C3):
-  //  - every write and retry stops once AUTOWIND is off or overridden (C2);
-  //  - the check reads what pypilot REPORTS (client cache), not the
-  //    provider's optimistic target (C3);
-  //  - a target ordered by anyone else meanwhile wins: the rewrite happens
-  //    only when pypilot put back the value it had before ours (C1).
-  async function _autowindHoldCurrentAngle(sub: WindSubMode, modeChanged: boolean): Promise<void> {
+  // Rev639 (GPT re-audit of Rev638, C1-C3): writes stop once AUTOWIND is off
+  // or overridden; the check reads what pypilot REPORTS.
+  // Rev641 (GPT re-audit of Rev640 #1/#2): the intent is taken when AUTOWIND
+  // is switched on (`targetGenAtStart`): any target order after that, even
+  // during the mode wait, wins and nothing is written. One write only - when
+  // pypilot then reports another value we cannot tell a sailor's order from
+  // pypilot's own, so it is left as it is and said (lastError), never
+  // rewritten. A missing report is "not confirmed", never 0.
+  async function _autowindHoldCurrentAngle(sub: WindSubMode, modeChanged: boolean, targetGenAtStart: number): Promise<void> {
     if (!apProvider || !client) return;
     const op = _autowindOp;
     const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
+    const noNewerOrder = () => !!apProvider && apProvider.targetGeneration() === targetGenAtStart;
     const wanted = () => op === _autowindOp && !!props.autowindEnabled && !!apProvider && !!apProvider.data.engaged
-      && String(apProvider.data.mode || "").toLowerCase() === sub;
+      && String(apProvider.data.mode || "").toLowerCase() === sub && noNewerOrder();
     const reportedDeg = (): number | null => {
-      const v = Number(client ? client.getValues()["ap.heading_command"] : NaN);
-      return Number.isFinite(v) ? v : null;
+      const v = client ? client.getValues()["ap.heading_command"] : undefined;
+      return typeof v === "number" && Number.isFinite(v) ? v : null;
     };
-    const near = (a: number | null, b: number) => a != null && Math.abs(((a - b) % 360 + 540) % 360 - 180) < 5;
     if (modeChanged) await sleep(400);
     if (!wanted()) return;
     // SK angles are radians; TWA from the same fresh sources AUTOWIND decides on.
@@ -5148,27 +5161,19 @@ module.exports = function (app: any) {
       : _autowindFresh(["environment.wind.angleApparent"]);
     if (nowRad == null) { _autowindFail("no fresh wind angle to hold: target left as it was"); return; }
     const wantDeg = nowRad * 180 / Math.PI;
-    const before = reportedDeg();
-    for (let attempt = 0; attempt < 2; attempt++) {
-      try { await apProvider.setTargetIfWanted(nowRad, wanted); }
-      catch (e: any) { if (wanted()) _autowindFail(`hold the current wind angle: ${e?.message || e}`); return; }
-      const gen = apProvider.targetGeneration();
-      // eslint-disable-next-line no-console
-      console.log(`[autowind] target = current ${sub === "true wind" ? "TWA" : "AWA"} ${wantDeg.toFixed(0)} deg`);
-      await sleep(1200);
-      if (!wanted()) return;
-      if (apProvider.targetGeneration() !== gen) return;      // a newer target order: it wins
-      const now = reportedDeg();
-      if (near(now, wantDeg)) return;                        // pypilot reports ours: done
-      if (!(before != null && near(now, before))) {
-        // Neither ours nor what was there: someone set it on pypilot directly.
-        // eslint-disable-next-line no-console
-        console.log(`[autowind] target now ${now == null ? "?" : now.toFixed(0)} deg, set elsewhere: left as is`);
-        return;
-      }
-      // pypilot put its own value back over ours: once more.
-    }
-    _autowindFail(`target ${wantDeg.toFixed(0)} deg not confirmed by pypilot`);
+    try { await apProvider.setTargetIfWanted(nowRad, wanted); }
+    catch (e: any) { if (op === _autowindOp && props.autowindEnabled) _autowindFail(`hold the current wind angle: ${e?.message || e}`); return; }
+    const ourGen = apProvider.targetGeneration();
+    // eslint-disable-next-line no-console
+    console.log(`[autowind] target = current ${sub === "true wind" ? "TWA" : "AWA"} ${wantDeg.toFixed(0)} deg`);
+    await sleep(1200);
+    if (op !== _autowindOp || !props.autowindEnabled) return;
+    if (apProvider.targetGeneration() !== ourGen) return;      // a newer target order: it wins
+    const now = reportedDeg();
+    if (now != null && Math.abs(((now - wantDeg) % 360 + 540) % 360 - 180) < 2) return;   // confirmed
+    _autowindFail(now == null
+      ? `target ${wantDeg.toFixed(0)} deg not confirmed by pypilot`
+      : `target ${wantDeg.toFixed(0)} deg not kept: pypilot reports ${now.toFixed(0)} deg - left as it is`);
   }
   // Rev633: why AUTOWIND must not switch now (tack or visor manoeuvre), or null.
   function _autowindBusyReason(): string | null {
diff --git a/src/maneuver-gate.ts b/src/maneuver-gate.ts
index d2a24b1..19e9b67 100644
--- a/src/maneuver-gate.ts
+++ b/src/maneuver-gate.ts
@@ -31,19 +31,20 @@ export class ManeuverGate {
 
   constructor(private readonly ttlMs = MANEUVER_GATE_TTL_MS) {}
 
-  /** Applies one visor message: {active: true|false, id?}. */
-  update(active: unknown, id: unknown, nowMs: number): void {
+  /** Applies one visor message: {active: true|false, id?}. Returns
+   *  "ended" when a renewal names a manoeuvre that was ended (by its
+   *  visor, a hand-over from another screen or reconcile): that visor must
+   *  end it too. */
+  update(active: unknown, id: unknown, nowMs: number): "ok" | "ended" {
     this.sweep(nowMs);
-    // Rev639 (GPT re-audit of Rev638 C7): {active:false, id:"*"} = a sailor
-    // chose a mode on any screen: every running manoeuvre ends (explicit
-    // hand-over, even when the new choice keeps the same wind mode).
-    if (active === false && id === "*") {
-      for (const key of [...this.until.keys()]) this.end(key, nowMs);
-      return;
-    }
     const key = typeof id === "string" && id ? id.slice(0, 64) : LEGACY;
     if (active === true) {
-      if (this.ended.has(key)) return;
+      if (this.ended.has(key)) {
+        // Rev641 (GPT re-audit of Rev640 #3): while its visor keeps renewing
+        // an ended id, it stays ended - the TTL no longer lets it back in.
+        this.ended.set(key, nowMs + this.ttlMs);
+        return "ended";
+      }
       if (!this.until.has(key)) this.startedAt.set(key, nowMs);
       this.until.delete(key);
       this.until.set(key, nowMs + this.ttlMs);
@@ -52,6 +53,24 @@ export class ManeuverGate {
     } else if (active === false) {
       this.end(key, nowMs);
     }
+    return "ok";
+  }
+
+  /** Rev641 (GPT re-audit of Rev640 #3/#4): a hand-over ends exactly the
+   *  manoeuvres the other screen saw, by id - a late hand-over never ends
+   *  one that started after it. */
+  endIds(ids: unknown, nowMs: number): void {
+    this.sweep(nowMs);
+    if (!Array.isArray(ids)) return;
+    for (const id of ids.slice(0, MANEUVER_GATE_MAX)) {
+      if (typeof id === "string" && id && id !== LEGACY) this.end(id.slice(0, 64), nowMs);
+    }
+  }
+
+  /** The running manoeuvre ids (for the visors' hand-over). */
+  ids(nowMs: number): string[] {
+    this.sweep(nowMs);
+    return [...this.until.keys()].filter((k) => k !== LEGACY);
   }
 
   /** Rev638: ends Aproado / Empopado entries pypilot is no longer doing.
diff --git a/src/test/maneuver-gate.test.ts b/src/test/maneuver-gate.test.ts
index 095de44..e078495 100644
--- a/src/test/maneuver-gate.test.ts
+++ b/src/test/maneuver-gate.test.ts
@@ -116,16 +116,34 @@ describe("ManeuverGate.reconcile (Rev638)", () => {
 });
 
 describe("ManeuverGate hand-over and memory (Rev639)", () => {
-  it("'*' ends every running manoeuvre (a mode chosen on another screen)", () => {
+  it("a hand-over ends the ids the other screen saw (Rev641)", () => {
     const g = new ManeuverGate(180_000);
     g.update(true, "apr-1", 0);
     g.update(true, "emp-2", 0);
-    g.update(false, "*", 1000);
+    assert.deepEqual(g.ids(0).sort(), ["apr-1", "emp-2"]);
+    g.endIds(["apr-1", "emp-2"], 1000);
     assert.equal(g.active(1000), false);
-    g.update(true, "apr-1", 2000);       // its late renewal cannot reopen it
+    assert.equal(g.update(true, "apr-1", 2000), "ended", "its owner learns it was ended");
     assert.equal(g.active(2000), false);
   });
 
+  it("Rev641 (GPT #3): an owner that keeps renewing an ended id never brings it back", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, "apr-1", 0);
+    g.endIds(["apr-1"], 1000);
+    for (let t = 20_000; t <= 400_000; t += 20_000) g.update(true, "apr-1", t);
+    assert.equal(g.active(400_000), false);
+  });
+
+  it("Rev641 (GPT #4): a late hand-over does not end a manoeuvre started after it", () => {
+    const g = new ManeuverGate(180_000);
+    g.update(true, "apr-1", 0);
+    g.update(false, "apr-1", 1000);       // A closed by its own visor
+    g.update(true, "emp-2", 2000);        // B starts
+    g.endIds(["apr-1"], 3000);            // the old hand-over arrives late
+    assert.equal(g.kind(3000), "empopado");
+  });
+
   it("evicted and expired entries leave nothing behind", () => {
     const g = new ManeuverGate(1000);
     for (let i = 0; i < 80; i++) g.update(true, `apr-${i}`, 0);
diff --git a/src/test/visor-maneuver-flag.test.ts b/src/test/visor-maneuver-flag.test.ts
index b87e1c6..66c7218 100644
--- a/src/test/visor-maneuver-flag.test.ts
+++ b/src/test/visor-maneuver-flag.test.ts
@@ -144,6 +144,7 @@ function loadHotGains() {
       return new Promise<any>((r) => pending.push({ resolve: () => r({ ok: true }) }));
     },
     _empopadoSetHotBadge: () => {},
+    _empopadoKeepPendingGains: (profile: any, gains: any) => { ctx.kept = { profile, gains: { ...gains } }; },
     console: { info: () => {}, warn: () => {} },
   };
   vm.createContext(ctx);
@@ -184,6 +185,8 @@ describe("Empopado temporary gains (Rev633)", () => {
     await h.ctx._empopadoRestoreHotGains(ap);
     assert.deepEqual({ ...ap._hotGainSnapshot }, { "ap.pilot.basic.D": 0.2 });
     assert.equal(badge, "failed");
+    // Rev641: and it outlives the manoeuvre's window
+    assert.deepEqual(h.ctx.kept, { profile: "HEAVY", gains: { "ap.pilot.basic.D": 0.2 } });
   });
 
   it("an old gain is never written into a profile chosen meanwhile", async () => {
```

## Current code around the changes

Line numbers are the real ones in the repository at Rev641.

### src/maneuver-gate.ts lines 1-129 (manoeuvre flag, backend (whole file))

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
   34    /** Applies one visor message: {active: true|false, id?}. Returns
   35     *  "ended" when a renewal names a manoeuvre that was ended (by its
   36     *  visor, a hand-over from another screen or reconcile): that visor must
   37     *  end it too. */
   38    update(active: unknown, id: unknown, nowMs: number): "ok" | "ended" {
   39      this.sweep(nowMs);
   40      const key = typeof id === "string" && id ? id.slice(0, 64) : LEGACY;
   41      if (active === true) {
   42        if (this.ended.has(key)) {
   43          // Rev641 (GPT re-audit of Rev640 #3): while its visor keeps renewing
   44          // an ended id, it stays ended - the TTL no longer lets it back in.
   45          this.ended.set(key, nowMs + this.ttlMs);
   46          return "ended";
   47        }
   48        if (!this.until.has(key)) this.startedAt.set(key, nowMs);
   49        this.until.delete(key);
   50        this.until.set(key, nowMs + this.ttlMs);
   51        // Rev639 (C9): evicting an entry clears its side maps too.
   52        while (this.until.size > MANEUVER_GATE_MAX) this.forget(this.until.keys().next().value as string);
   53      } else if (active === false) {
   54        this.end(key, nowMs);
   55      }
   56      return "ok";
   57    }
   58  
   59    /** Rev641 (GPT re-audit of Rev640 #3/#4): a hand-over ends exactly the
   60     *  manoeuvres the other screen saw, by id - a late hand-over never ends
   61     *  one that started after it. */
   62    endIds(ids: unknown, nowMs: number): void {
   63      this.sweep(nowMs);
   64      if (!Array.isArray(ids)) return;
   65      for (const id of ids.slice(0, MANEUVER_GATE_MAX)) {
   66        if (typeof id === "string" && id && id !== LEGACY) this.end(id.slice(0, 64), nowMs);
   67      }
   68    }
   69  
   70    /** The running manoeuvre ids (for the visors' hand-over). */
   71    ids(nowMs: number): string[] {
   72      this.sweep(nowMs);
   73      return [...this.until.keys()].filter((k) => k !== LEGACY);
   74    }
   75  
   76    /** Rev638: ends Aproado / Empopado entries pypilot is no longer doing.
   77     *  Returns the ids it ended. */
   78    reconcile(nowMs: number, mode: string, engaged: boolean): string[] {
   79      this.sweep(nowMs);
   80      const out: string[] = [];
   81      for (const key of [...this.until.keys()]) {
   82        const own = key.startsWith("emp-") ? "true wind" : key.startsWith("apr-") ? "wind" : null;
   83        if (!own) continue;
   84        if (nowMs - (this.startedAt.get(key) ?? nowMs) < MANEUVER_GATE_START_GRACE_MS) continue;
   85        if (engaged && String(mode).toLowerCase() === own) { this.mismatchSince.delete(key); continue; }
   86        const since = this.mismatchSince.get(key);
   87        if (since == null) { this.mismatchSince.set(key, nowMs); continue; }
   88        if (nowMs - since >= MANEUVER_GATE_MISMATCH_MS) { this.end(key, nowMs); out.push(key); }
   89      }
   90      return out;
   91    }
   92  
   93    private forget(key: string): void {
   94      this.until.delete(key);
   95      this.startedAt.delete(key);
   96      this.mismatchSince.delete(key);
   97    }
   98  
   99    private end(key: string, nowMs: number): void {
  100      this.forget(key);
  101      if (key !== LEGACY) {
  102        this.ended.set(key, nowMs + this.ttlMs);
  103        while (this.ended.size > MANEUVER_GATE_MAX * 4) this.ended.delete(this.ended.keys().next().value as string);
  104      }
  105    }
  106  
  107    /** Rev634 (Carlos QA 2026-11-06: the other tablet said REAL during an
  108     *  Empopado): which manoeuvre runs, from the visor's id prefix. */
  109    kind(nowMs: number): "aproado" | "empopado" | "manoeuvre" | null {
  110      if (!this.active(nowMs)) return null;
  111      const ids = [...this.until.keys()];
  112      if (ids.some((k) => k.startsWith("emp-"))) return "empopado";
  113      if (ids.some((k) => k.startsWith("apr-"))) return "aproado";
  114      return "manoeuvre";
  115    }
  116  
  117    active(nowMs: number): boolean {
  118      this.sweep(nowMs);
  119      return this.until.size > 0;
  120    }
  121  
  122    private sweep(nowMs: number): void {
  123      for (const [key, until] of this.until) {
  124        if (until <= nowMs) this.forget(key);
  125      }
  126      for (const [key, until] of this.ended) if (until <= nowMs) this.ended.delete(key);
  127    }
  128  }
  129  
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

### src/alarms.ts lines 476-490 (new alarm rule pypilot-sk-access)

```ts
  476    },
  477    // Rev640 (Carlos 2026-11-06): pypilot drops its Signal K token when a
  478    // Signal K restart answers its handshake with 503, and asks for access
  479    // again; until someone approves it in the Signal K admin, pypilot gets
  480    // nothing from Signal K. Nobody noticed for 40 min on 2026-11-06.
  481    {
  482      id: "pypilot-sk-access",
  483      label: "pypilot pide acceso a Signal K",
  484      severity: "warn",
  485      defaultEnabled: true,
  486      sustainSec: 30,
  487      description: "pypilot (the TinyPilot) has a Signal K access request waiting for approval.",
  488      evaluate: (c) => c.pypilotAccessPending === true,
  489      message: () => "pypilot pide acceso a Signal K: apruébalo en Seguridad, Solicitudes de acceso",
  490    },
```

### src/index.ts lines 5110-5135 (pypilot access-request check)

```ts
 5110    // pypilot stop there - no profile, no "switched" afterwards.
 5111    // Rev640: a Signal K access request from the device "pypilot" not yet
 5112    // approved. Signal K publishes each request under
 5113    // notifications.security.accessRequest.<permission>.<clientId> and sets
 5114    // it back to "normal" once approved or denied.
 5115    function _pypilotAccessPending(): boolean {
 5116      try {
 5117        const tree = app.getSelfPath ? app.getSelfPath("notifications.security.accessRequest") : null;
 5118        let pending = false;
 5119        // Rev641 (GPT re-audit of Rev640): the request's own key first (Signal
 5120        // K files it under the client id, "pypilot-<n>"), the text as a
 5121        // fallback.
 5122        const walk = (o: any, key: string, depth: number): void => {
 5123          if (!o || typeof o !== "object" || depth > 4 || pending) return;
 5124          const v = o.value;
 5125          if (v && typeof v === "object" && typeof v.state === "string") {
 5126            const fromPypilot = /^pypilot-/i.test(key) || /"pypilot"/i.test(String(v.message || ""));
 5127            if (v.state !== "normal" && fromPypilot) pending = true;
 5128            return;
 5129          }
 5130          for (const k of Object.keys(o)) walk(o[k], k, depth + 1);
 5131        };
 5132        walk(tree, "", 0);
 5133        return pending;
 5134      } catch { return false; }
 5135    }
```

### src/index.ts lines 612-642 (manoeuvre gate wiring + publish)

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
  625      const now = Date.now();
  626      const k = maneuverGate.kind(now);
  627      // Rev641: the ids too, so a hand-over from another screen ends exactly
  628      // those (GPT re-audit of Rev640 #3/#4).
  629      const ids = maneuverGate.ids(now);
  630      const sig = `${k}|${ids.join(",")}`;
  631      if (sig === _maneuverKindSent) return;
  632      _maneuverKindSent = sig;
  633      try {
  634        app.handleMessage(PLUGIN_ID, {
  635          context: "vessels." + app.selfId,
  636          updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [
  637            { path: "steering.autopilot.maneuver", value: k },
  638            { path: "steering.autopilot.maneuverIds", value: ids },
  639          ] }],
  640        });
  641      } catch { /* silent */ }
  642    };
```

### src/index.ts lines 1381-1394 (1 Hz tick: reconcile + AUTOWIND tick)

```ts
 1381          try { _blackBoxTick(s); } catch (e: any) { app.debug?.(`[black-box] tick: ${e?.message || e}`); }
 1382          // Rev634: a manoeuvre that expired (visor gone) is shown as ended.
 1383          // Rev638: and one pypilot is no longer doing (visor reloaded).
 1384          try {
 1385            if (apProvider) {
 1386              for (const id of maneuverGate.reconcile(Date.now(), String(apProvider.data.mode || ""), !!apProvider.data.engaged)) {
 1387                // eslint-disable-next-line no-console
 1388                console.log(`[maneuver] ${id} ended: pypilot left its mode or the AP is off`);
 1389              }
 1390            }
 1391            _publishManeuverKind();
 1392          } catch { /* silent */ }
 1393          // Rev518: AUTOWIND (apparent <-> true wind by TWA).
 1394          try { _autowindTick(); } catch (e: any) { app.debug?.(`[autowind] tick: ${e?.message || e}`); }
```

### src/index.ts lines 2901-2959 (HTTP /autowind (switch-on path))

```ts
 2901        // Rev518: AUTOWIND config + state.
 2902        router.get("/autowind", (_req: any, res: any) => {
 2903          res.json(_autowindState());
 2904        });
 2905        router.post("/autowind", async (req: any, res: any) => {
 2906          if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
 2907          const b = req.body || {};
 2908          let changed = false;
 2909          if (typeof b.profileApparent === "string") { props.autowindProfileApparent = b.profileApparent.trim(); changed = true; }
 2910          if (typeof b.profileTrue === "string") { props.autowindProfileTrue = b.profileTrue.trim(); changed = true; }
 2911          if (typeof b.thresholdDeg === "number") {
 2912            props.autowindThresholdDeg = clampNumber(b.thresholdDeg, 90, 150, AUTOWIND_DEFAULT_THRESHOLD_DEG);
 2913            changed = true;
 2914          }
 2915          if (changed) { try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ } }
 2916          if (typeof b.enabled === "boolean") {
 2917            const was = !!props.autowindEnabled;
 2918            // Rev633 (GPT re-audit 2026-11-06 R06): switching on goes through
 2919            // the same tack / manoeuvre guard as the 1 Hz tick. Refused, it
 2920            // stays off and says why.
 2921            if (b.enabled && !was) {
 2922              const busy = _autowindBusyReason();
 2923              if (busy) {
 2924                _autowindPublish();
 2925                return res.status(409).json({ ..._autowindState(), refused: busy });
 2926              }
 2927            }
 2928            _autowindSetEnabled(b.enabled, b.enabled ? "selected" : "another mode selected");
 2929            if (b.enabled && !was) {
 2930              // Pick the side now, no waiting. Without fresh true wind data
 2931              // (or below the wind floor) the start is apparent wind, on
 2932              // purpose: pypilot steers it from the vane alone.
 2933              const twa = _autowindTwaDeg();
 2934              const tws = _autowindTwsKn();
 2935              const usable = twa != null && tws != null && tws >= AUTOWIND_MIN_TWS_KN;
 2936              const sub = usable ? autowind.initial(twa, props.autowindThresholdDeg) : "wind";
 2937              const modeBefore = apProvider ? String(apProvider.data.mode || "").toLowerCase() : "";
 2938              // Rev641: the target intent at switch-on; any later order wins.
 2939              const targetGenAtStart = apProvider ? apProvider.targetGeneration() : -1;
 2940              await _autowindApply(sub, usable ? "AUTOWIND on" : "AUTOWIND on (no usable true wind: apparent)", true);
 2941              // Rev635/636 (Carlos QA 2026-11-06 16:42 and 16:58): AUTOWIND
 2942              // starts on the wind angle the boat has NOW. Without this the
 2943              // target was whatever was there - an Empopado's TWA 180 ended from
 2944              // another visor, an Aproado's AWA 0 - and on a mode change pypilot
 2945              // keeps the heading ERROR it had (61 deg off stayed 61 deg off),
 2946              // it does not re-centre on the wind.
 2947              if (apProvider && apProvider.data.engaged && props.autowindEnabled) {
 2948                await _autowindHoldCurrentAngle(sub, modeBefore !== sub, targetGenAtStart);
 2949              }
 2950            }
 2951          }
 2952          // New profile for the side that is active right now: apply it.
 2953          if (props.autowindEnabled && changed && apProvider) {
 2954            const mode = String(apProvider.data.mode || "").toLowerCase();
 2955            if (mode === "wind" || mode === "true wind") _autowindApplyProfile(mode as WindSubMode, "profile chosen");
 2956          }
 2957          _autowindPublish();
 2958          res.json(_autowindState());
 2959        });
```

### src/index.ts lines 3516-3527 (HTTP /maneuver-state)

```ts
 3516        // {active:false} on their teardowns. Independent of trace log.
 3517        router.get("/maneuver-state", (_req: any, res: any) => {
 3518          res.json({ pseudoActive: _pseudoActive() });
 3519        });
 3520        router.post("/maneuver-state", (req: any, res: any) => {
 3521          const body = req.body || {};
 3522          let ended = false;
 3523          if (body.active === false && Array.isArray(body.ids)) maneuverGate.endIds(body.ids, Date.now());
 3524          else ended = maneuverGate.update(body.active, body.id, Date.now()) === "ended";
 3525          _publishManeuverKind();
 3526          res.json({ ok: true, pseudoActive: _pseudoActive(), ended });
 3527        });
```

### src/index.ts lines 5053-5313 (AUTOWIND state, apply, hold angle, tick)

```ts
 5053    }
 5054    // Rev518 (Carlos 2026-10-19): AUTOWIND. See src/autowind.ts.
 5055    function _autowindState(): Record<string, unknown> {
 5056      const mode = apProvider ? String(apProvider.data.mode || "") : "";
 5057      return {
 5058        enabled: !!props.autowindEnabled,
 5059        subMode: mode === "wind" || mode === "true wind" ? mode : null,
 5060        profileApparent: props.autowindProfileApparent || "",
 5061        profileTrue: props.autowindProfileTrue || "",
 5062        thresholdDeg: props.autowindThresholdDeg ?? AUTOWIND_DEFAULT_THRESHOLD_DEG,
 5063        lastSwitchTs: _autowindLastSwitchTs,
 5064        lastReason: _autowindLastReason,
 5065        // Rev630 (sea trial 2026-11-05): why AUTOWIND cannot switch right now
 5066        // ("virtual-tack" | "pypilot-tack" | "manoeuvre" | "no-wind-data" |
 5067        // "wind-too-light" | null), and the last switch that failed.
 5068        blockedReason: props.autowindEnabled ? _autowindBlockedReason : null,
 5069        lastError: _autowindLastError,
 5070      };
 5071    }
 5072    function _autowindPublish(): void {
 5073      try {
 5074        app.handleMessage(PLUGIN_ID, {
 5075          context: "vessels." + app.selfId,
 5076          updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [
 5077            { path: "steering.autopilot.autowind", value: _autowindState() },
 5078          ] }],
 5079        });
 5080      } catch { /* silent */ }
 5081    }
 5082    function _autowindProfileFor(sub: WindSubMode): string {
 5083      return (sub === "true wind" ? props.autowindProfileTrue : props.autowindProfileApparent) || "";
 5084    }
 5085    /** false = pypilot did not take the profile write. */
 5086    function _autowindApplyProfile(sub: WindSubMode, reason: string): boolean {
 5087      const want = _autowindProfileFor(sub);
 5088      if (!want) return true;
 5089      if (client && client.getValues()["profile"] === want) return true;
 5090      let sent = false;
 5091      try {
 5092        if (client && client.connected) {
 5093          profileChangeLog.markPlannedWrite(want, "autowind", reason);
 5094          sent = client.set("profile", want) !== false;
 5095        }
 5096      } catch { /* silent */ }
 5097      // Rev630 (GPT audit 2026-11-05 F03): a refused write is a failure.
 5098      if (!sent) _autowindFail(`profile ${want} not sent to pypilot`);
 5099      return sent;
 5100    }
 5101    function _autowindFail(msg: string): void {
 5102      _autowindLastError = msg;
 5103      // eslint-disable-next-line no-console
 5104      console.log(`[autowind] failed: ${msg}`);
 5105      _autowindPublish();
 5106    }
 5107    // Rev630 (GPT audit 2026-11-05 F02/F03): `fromTick` = an automatic switch
 5108    // (its outcome feeds the decider's gap / retry). An operation number:
 5109    // turning AUTOWIND off, or a newer apply, makes an apply still waiting on
 5110    // pypilot stop there - no profile, no "switched" afterwards.
 5111    // Rev640: a Signal K access request from the device "pypilot" not yet
 5112    // approved. Signal K publishes each request under
 5113    // notifications.security.accessRequest.<permission>.<clientId> and sets
 5114    // it back to "normal" once approved or denied.
 5115    function _pypilotAccessPending(): boolean {
 5116      try {
 5117        const tree = app.getSelfPath ? app.getSelfPath("notifications.security.accessRequest") : null;
 5118        let pending = false;
 5119        // Rev641 (GPT re-audit of Rev640): the request's own key first (Signal
 5120        // K files it under the client id, "pypilot-<n>"), the text as a
 5121        // fallback.
 5122        const walk = (o: any, key: string, depth: number): void => {
 5123          if (!o || typeof o !== "object" || depth > 4 || pending) return;
 5124          const v = o.value;
 5125          if (v && typeof v === "object" && typeof v.state === "string") {
 5126            const fromPypilot = /^pypilot-/i.test(key) || /"pypilot"/i.test(String(v.message || ""));
 5127            if (v.state !== "normal" && fromPypilot) pending = true;
 5128            return;
 5129          }
 5130          for (const k of Object.keys(o)) walk(o[k], k, depth + 1);
 5131        };
 5132        walk(tree, "", 0);
 5133        return pending;
 5134      } catch { return false; }
 5135    }
 5136    // Rev636: target = the current wind angle in the mode AUTOWIND starts in.
 5137    // Rev639 (GPT re-audit of Rev638, C1-C3): writes stop once AUTOWIND is off
 5138    // or overridden; the check reads what pypilot REPORTS.
 5139    // Rev641 (GPT re-audit of Rev640 #1/#2): the intent is taken when AUTOWIND
 5140    // is switched on (`targetGenAtStart`): any target order after that, even
 5141    // during the mode wait, wins and nothing is written. One write only - when
 5142    // pypilot then reports another value we cannot tell a sailor's order from
 5143    // pypilot's own, so it is left as it is and said (lastError), never
 5144    // rewritten. A missing report is "not confirmed", never 0.
 5145    async function _autowindHoldCurrentAngle(sub: WindSubMode, modeChanged: boolean, targetGenAtStart: number): Promise<void> {
 5146      if (!apProvider || !client) return;
 5147      const op = _autowindOp;
 5148      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
 5149      const noNewerOrder = () => !!apProvider && apProvider.targetGeneration() === targetGenAtStart;
 5150      const wanted = () => op === _autowindOp && !!props.autowindEnabled && !!apProvider && !!apProvider.data.engaged
 5151        && String(apProvider.data.mode || "").toLowerCase() === sub && noNewerOrder();
 5152      const reportedDeg = (): number | null => {
 5153        const v = client ? client.getValues()["ap.heading_command"] : undefined;
 5154        return typeof v === "number" && Number.isFinite(v) ? v : null;
 5155      };
 5156      if (modeChanged) await sleep(400);
 5157      if (!wanted()) return;
 5158      // SK angles are radians; TWA from the same fresh sources AUTOWIND decides on.
 5159      const nowRad = sub === "true wind"
 5160        ? _autowindFresh(["environment.wind.angleTrueWater", "environment.wind.angleTrueGround"])
 5161        : _autowindFresh(["environment.wind.angleApparent"]);
 5162      if (nowRad == null) { _autowindFail("no fresh wind angle to hold: target left as it was"); return; }
 5163      const wantDeg = nowRad * 180 / Math.PI;
 5164      try { await apProvider.setTargetIfWanted(nowRad, wanted); }
 5165      catch (e: any) { if (op === _autowindOp && props.autowindEnabled) _autowindFail(`hold the current wind angle: ${e?.message || e}`); return; }
 5166      const ourGen = apProvider.targetGeneration();
 5167      // eslint-disable-next-line no-console
 5168      console.log(`[autowind] target = current ${sub === "true wind" ? "TWA" : "AWA"} ${wantDeg.toFixed(0)} deg`);
 5169      await sleep(1200);
 5170      if (op !== _autowindOp || !props.autowindEnabled) return;
 5171      if (apProvider.targetGeneration() !== ourGen) return;      // a newer target order: it wins
 5172      const now = reportedDeg();
 5173      if (now != null && Math.abs(((now - wantDeg) % 360 + 540) % 360 - 180) < 2) return;   // confirmed
 5174      _autowindFail(now == null
 5175        ? `target ${wantDeg.toFixed(0)} deg not confirmed by pypilot`
 5176        : `target ${wantDeg.toFixed(0)} deg not kept: pypilot reports ${now.toFixed(0)} deg - left as it is`);
 5177    }
 5178    // Rev633: why AUTOWIND must not switch now (tack or visor manoeuvre), or null.
 5179    function _autowindBusyReason(): string | null {
 5180      if (!apProvider) return null;
 5181      if (apProvider.isVirtualTackActive()) return "virtual-tack";
 5182      if (_tackStatePrev && _tackStatePrev !== "none") return "pypilot-tack";
 5183      if (_pseudoActive()) return "manoeuvre";
 5184      return null;
 5185    }
 5186    async function _autowindApply(sub: WindSubMode, reason: string, fromTick = false): Promise<void> {
 5187      if (!apProvider) return;
 5188      const op = ++_autowindOp;
 5189      _autowindProfilePending = null;
 5190      _autowindLastReason = reason;
 5191      const current = () => op === _autowindOp && !!props.autowindEnabled;
 5192      const cur = String(apProvider.data.mode || "").toLowerCase();
 5193      if (cur !== sub) {
 5194        // wind <-> true wind share the angle space: pypilot keeps the
 5195        // heading itself on the mode change, nothing else is written.
 5196        // Rev633 (GPT re-audit 2026-11-06 R01/R02): no retry goes out once
 5197        // AUTOWIND is off or overridden, and success = pypilot's own echo of
 5198        // the mode, not the write being accepted.
 5199        _autowindInFlight++;
 5200        try {
 5201          await apProvider.setModeIfWanted(sub, current);
 5202          const t0 = Date.now();
 5203          while (String(apProvider.data.mode || "").toLowerCase() !== sub) {
 5204            if (!current()) break;
 5205            if (Date.now() - t0 > AUTOWIND_CONFIRM_MS) throw new Error(`not confirmed by pypilot in ${AUTOWIND_CONFIRM_MS / 1000} s`);
 5206            await new Promise<void>((r) => setTimeout(r, 100));
 5207          }
 5208        } catch (e: any) {
 5209          _autowindInFlight--;
 5210          if (!current()) return;
 5211          if (fromTick) autowind.noteFailure(Date.now());
 5212          _autowindFail(`mode ${sub}: ${e?.message || e}`);
 5213          return;
 5214        }
 5215        _autowindInFlight--;
 5216        if (!current()) {
 5217          // eslint-disable-next-line no-console
 5218          console.log(`[autowind] ${sub} landed after AUTOWIND was turned off or overridden: profile left as is`);
 5219          return;
 5220        }
 5221        _autowindLastSwitchTs = Date.now();
 5222        autowind.noteSwitch(_autowindLastSwitchTs);
 5223      }
 5224      _autowindLastError = null;
 5225      if (!_autowindApplyProfile(sub, reason)) {
 5226        // Rev633 (GPT R09 / Gemini 3.1): the mode is right but pypilot did not
 5227        // take the profile - retry it from the tick, a few times.
 5228        const was = client ? String(client.getValues()["profile"] ?? "") : "";
 5229        _autowindProfilePending = { sub, op, was, tries: 1, nextMs: Date.now() + AUTOWIND_PROFILE_RETRY_MS };
 5230      }
 5231      // eslint-disable-next-line no-console
 5232      console.log(`[autowind] ${reason} -> ${sub}${_autowindProfileFor(sub) ? ` / profile ${_autowindProfileFor(sub)}` : ""}`);
 5233      _autowindPublish();
 5234    }
 5235    function _autowindSetEnabled(on: boolean, why: string): void {
 5236      if (!!props.autowindEnabled === on) return;
 5237      props.autowindEnabled = on;
 5238      if (!on) { _autowindOp++; _autowindBlockedReason = null; _autowindProfilePending = null; }
 5239      try { app.savePluginOptions?.(props, () => { /* noop */ }); } catch { /* silent */ }
 5240      // eslint-disable-next-line no-console
 5241      console.log(`[autowind] ${on ? "on" : "off"} (${why})`);
 5242      _autowindLastReason = why;
 5243      _autowindPublish();
 5244    }
 5245    // Rev632 (AUTOWIND audit 2026-11-05, GPT F06): AUTOWIND only decides on
 5246    // wind data younger than AUTOWIND_MAX_DATA_AGE_MS. A path that stopped
 5247    // (sensor off, plugin that publishes only now and then, like
 5248    // polar-performance's speedTrue) is skipped for the next one; none fresh
 5249    // = "no-wind-data". The sampler / alarms keep using _readTwaRad as is.
 5250    function _autowindFresh(paths: string[]): number | null {
 5251      const now = Date.now();
 5252      for (const p of paths) {
 5253        try {
 5254          const v = freshNumber(app.getSelfPath ? app.getSelfPath(p) : null, now);
 5255          if (v != null) return v;
 5256        } catch { /* next path */ }
 5257      }
 5258      return null;
 5259    }
 5260    function _autowindTwaDeg(): number | null {
 5261      // Rev534: angleTrueGround as the sampler does when Water is missing.
 5262      const r = _autowindFresh(["environment.wind.angleTrueWater", "environment.wind.angleTrueGround"]);
 5263      return r == null ? null : r * 180 / Math.PI;
 5264    }
 5265    function _autowindTwsKn(): number | null {
 5266      // Rev534 (GPT review 2 #6): same sources as the sampler.
 5267      const v = _autowindFresh(["environment.wind.speedTrue", "environment.wind.speedOverGround"]);
 5268      return v == null ? null : v * 1.94384;
 5269    }
 5270    function _autowindSetBlocked(reason: string | null): void {
 5271      if (reason === _autowindBlockedReason) return;
 5272      _autowindBlockedReason = reason;
 5273      // eslint-disable-next-line no-console
 5274      console.log(`[autowind] ${reason ? `blocked: ${reason}` : "unblocked"}`);
 5275      _autowindPublish();
 5276    }
 5277    function _autowindTick(): void {
 5278      if (!props.autowindEnabled || !apProvider) return;
 5279      const mode = String(apProvider.data.mode || "").toLowerCase();
 5280      const busy = _autowindBusyReason();
 5281      const vtActive = busy === "virtual-tack";
 5282      const pypilotTack = busy === "pypilot-tack";
 5283      const blocked = busy != null;
 5284      const twaNow = _autowindTwaDeg();
 5285      const twsNow = _autowindTwsKn();
 5286      _autowindSetBlocked(
 5287        busy ? busy
 5288        : twaNow == null || twsNow == null ? "no-wind-data"
 5289        : twsNow < AUTOWIND_MIN_TWS_KN ? "wind-too-light"
 5290        : null);
 5291      // Sailor (remote, TinyPilot, KIP) moved to compass/gps: AUTOWIND
 5292      // ends, like picking another mode in the visor. 5 s so a transient
 5293      // write race never switches it off.
 5294      // pypilot drops to compass on its own when it loses GPS / true wind
 5295      // (and returns when it is back): that is not the sailor leaving.
 5296      // Rev630 (Gemini audit 2026-11-05): only a tack, which passes through
 5297      // compass, suspends this check - a visor manoeuvre flag no longer does.
 5298      const trueWindAvailable = ((apProvider as any).pypilotModes || []).includes("true wind");
 5299      if (!vtActive && !pypilotTack && trueWindAvailable && mode !== "wind" && mode !== "true wind" && mode !== "") {
 5300        if (_autowindOffFamilySince == null) _autowindOffFamilySince = Date.now();
 5301        else if (Date.now() - _autowindOffFamilySince > 5000) {
 5302          _autowindOffFamilySince = null;
 5303          _autowindSetEnabled(false, `mode changed to ${mode}`);
 5304        }
 5305        return;
 5306      }
 5307      _autowindOffFamilySince = null;
 5308      if (_autowindInFlight > 0) return;   // a switch is still waiting on pypilot
 5309      // Rev633: a profile pypilot did not take, retried while the side holds.
 5310      const pend = _autowindProfilePending;
 5311      if (pend && Date.now() >= pend.nextMs) {
 5312        const nowProfile = client ? String(client.getValues()["profile"] ?? "") : "";
 5313        // The sailor picked another profile meanwhile: theirs wins.
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

### src/autopilot-provider.ts lines 766-799 (provider setTarget guard)

```ts
  766  
  767    /** Rev390: `internal` = a write of _runVirtualTack itself, so the
  768     *  external-write guard below can tell our FSM's writes from frontend
  769     *  writes (nudges, adjust target, legacy countdown) that would compete
  770     *  with the maneuver. Rev633: per call, see setMode. */
  771    /** Rev639 (GPT re-audit Rev638 C2): a target that only stands while
  772     *  `stillWanted()` says so - checked before the write and before every
  773     *  retry, like setModeIfWanted. */
  774    async setTargetIfWanted(rad: number, stillWanted: () => boolean): Promise<void> {
  775      return this.setTarget(rad, false, stillWanted);
  776    }
  777  
  778    /** Rev639 (C1): bumped by every target order that goes through here, so a
  779     *  caller can tell whether anyone ordered another target since its own. */
  780    targetGeneration(): number { return this.targetGen; }
  781  
  782    private async setTarget(rad: number, internal = false, stillWanted?: () => boolean): Promise<void> {
  783      // Rev390 (Carlos, 2026-10-01, QA Rev389): reject external target
  784      // writes while a virtual tack is driving the pilot. Rev389 QA
  785      // caught a mid-maneuver `setTarget rad=0.9250 deg=53.00` that
  786      // competed with the FSM's own intermediate (`rad=0.4498 deg=25.77`)
  787      // and ultimately corrupted the maneuver. We now swallow any
  788      // target write that didn't originate from _runVirtualTack itself.
  789      if (this._virtualTack && !internal) {
  790        const active = this._virtualTack.phase !== "idle"
  791          && this._virtualTack.phase !== "completed"
  792          && this._virtualTack.phase !== "cancelled"
  793          && this._virtualTack.phase !== "failed";
  794        if (active) {
  795          // eslint-disable-next-line no-console
  796          console.log(`[virtual-tack] rejected external setTarget rad=${rad.toFixed(4)} (FSM is driving)`);
  797          return;
  798        }
  799      }
```

### public/app.js lines 11431-11486 (visor: mode button)

```js
11431    // label (white). This is what the sailor reads at a glance.
11432    function _renderModeSelectBtn() {
11433      const btn = document.getElementById("mode-select-btn");
11434      if (!btn) return;
11435      btn.title = "";
11436      // Rev510 (Carlos sea trial 2026-10-18, 18:07-18:12: "la tablet decia
11437      // un modo y el telefono decia otro"): during a virtual tack pypilot is
11438      // in compass on purpose. Every visor shows the wind mode of the tack,
11439      // from the backend snapshot (same on every screen). Rev515 (Carlos
11440      // 2026-10-19): no "TACKING ->" prefix, it read as a new mode.
11441      const vt = state.virtualTack;
11442      if (vt && vt.active) {
11443        const txt = _modeLabel(vt.windMode || state.mode || "wind");
11444        if (btn.textContent !== txt) btn.textContent = txt;
11445        return;
11446      }
11447      // Rev632 (Carlos QA 2026-11-05: "Empopado dice REAL"): a running
11448      // Aproado / Empopado shows its own name, not pypilot's wind mode.
11449      for (const [man, label] of [[state.empopado, "empopado"], [state.aproado, "aproado"]]) {
11450        if (man && (man.phase === "transit" || man.phase === "active")) {
11451          btn.textContent = _modeLabel(label);
11452          return;
11453        }
11454      }
11455      // Rev634 (Carlos QA 2026-11-06): a manoeuvre run from another visor.
11456      if (!state.empopado && !state.aproado && (state.remoteManeuver === "empopado" || state.remoteManeuver === "aproado")) {
11457        btn.textContent = _modeLabel(state.remoteManeuver);
11458        return;
11459      }
11460      const m = state.mode || "";
11461      // Rev518: AUTOWIND -> "AUTO · REAL" / "AUTO · APARENTE".
11462      if (state.autowind && state.autowind.enabled && (m === "wind" || m === "true wind")) {
11463        // Rev630 (sea trial 2026-11-05: "AUTO · REAL" was on screen while the
11464        // backend could not switch): say why it is waiting, if it is.
11465        // Rev634 (Carlos QA 2026-11-06: "no cabe en el botón"): the reason
11466        // goes on a small second line.
11467        const why = state.autowind.blockedReason;
11468        const whyKey = `autowind.blocked.${why}`;
11469        btn.textContent = `${t("autowind.short")} · ${_modeLabel(m)}`;
11470        if (why) {
11471          const sub = document.createElement("span");
11472          sub.className = "mode-btn-why";
11473          sub.textContent = t(whyKey);
11474          btn.appendChild(sub);
11475        }
11476        btn.title = state.autowind.lastError || "";
11477        return;
11478      }
11479      // Rev545: NAV -> "NAV · <waypoint> · 2.3 nm".
11480      if (m === "nav" && state.route && state.route.active) {
11481        const nm = typeof state.route.distanceM === "number" ? (state.route.distanceM / 1852).toFixed(1) : "?";
11482        btn.textContent = `${t("route.navShort")} · ${state.route.name || "WP"} · ${nm} nm`;
11483        return;
11484      }
11485      btn.textContent = m ? _modeLabel(m) : "—";
11486    }
```

### public/app.js lines 11542-11566 (visor: AUTOWIND POST (refusal))

```js
11542    }
11543    async function _autowindPost(body) {
11544      try {
11545        const r = await skFetch(`/plugins/${PLUGIN_ID}/autowind`, {
11546          method: "POST",
11547          headers: { "Content-Type": "application/json" },
11548          body: JSON.stringify(body),
11549        });
11550        if (r.ok) {
11551          state.autowind = await r.json();
11552          _renderModeSelectBtn();
11553          _rebuildModePopupProfiles();
11554        } else if (r.status === 409) {
11555          // Rev633: a tack or a manoeuvre is running - AUTOWIND did not start.
11556          const j = await r.json().catch(() => ({}));
11557          state.autowind = j && typeof j === "object" ? j : state.autowind;
11558          setSelect("#mode-select", state.mode || "");
11559          // Rev636 (Carlos QA 2026-11-06: "vaya mensaje más cutre"): a full
11560          // sentence that says what is running and what to do.
11561          const why = j && j.refused;
11562          const bodyKey = why === "manoeuvre" ? "autowind.refusedBody.manoeuvre" : "autowind.refusedBody.tack";
11563          _pmAlert(t("autowind.refused"), t(bodyKey));
11564        }
11565      } catch (e) { console.warn("[autowind] post", e); }
11566    }
```

### public/app.js lines 12294-12410 (visor: manoeuvre flag, heartbeat, left-from-outside)

```js
12294    } catch { /* silent */ }
12295    // Rev323 (Carlos, 2026-09-27): tell the backend a visor-side
12296    // pseudo-modo is active/inactive. Backend uses this to silence the
12297    // heading-deviation family of alarms during Aproado / Empopado. In
12298    // the sea trial 2026-09-27 alarms disparaban por doquier durante
12299    // esas maniobras porque `ap.tack.state` seguía en "none" y el gate
12300    // Rev311 no las cazaba.
12301    // Rev534: the backend forgets the flag after 60 s unless renewed, so a
12302    // closed browser cannot leave the alarms silenced. Renew every 20 s.
12303    // Rev630 (sea trial 2026-11-05): the flag belongs to one manoeuvre (its
12304    // id) and each renewal first checks that this manoeuvre is still in
12305    // transit / active. Closing the Empopado summary by hand used to leave
12306    // the renewal running for the rest of the session: AUTOWIND blocked and
12307    // the three steering alarms silenced for ~48 min.
12308    let _maneuverPseudoTimer = null;
12309    let _maneuverPseudoId = null;
12310    // Rev634 (Carlos QA 2026-11-06, 01:14: Empopado ended from the tablet,
12311    // this laptop kept its window open): a manoeuvre is left when pypilot,
12312    // after reaching the manoeuvre's mode, reports another mode or the AP
12313    // off - from a remote, KIP or another visor. It ends here too, without
12314    // touching mode or target (whoever left chose them). Empopado still
12315    // restores its temporary gains/profile if the profile is still its own.
12316    // Rev635 (Carlos QA 2026-11-06 16:42): the AP off counts only when it
12317    // lasts - the backend's own stuck-pilot recovery takes it off and on in
12318    // under a second, and that ended an Empopado. Another mode counts at once.
12319    const MANEUVER_AP_OFF_GRACE_MS = 3000;
12320    let _modeSelectGen = 0;   // Rev639: bumped by every mode choice
12321    function _endLocalManeuverIfLeft() {
12322      const pairs = [[state.empopado, "true wind"], [state.aproado, "wind"]];
12323      for (const [man, own] of pairs) {
12324        if (!man || (man.phase !== "transit" && man.phase !== "active")) continue;
12325        if (state.mode === own && state.engaged) {
12326          man._modeReached = true;
12327          man._apOffSince = null;          // Rev639 (C6): the AP is back - the count restarts
12328          continue;
12329        }
12330        if (!man._modeReached) continue;   // still on its way in
12331        if (state.mode === own && !state.engaged) {
12332          // Rev639 (GPT re-audit of Rev638 C6): one measure of CONTINUOUS
12333          // AP-off time; the timer only re-checks it. An off-on-off no longer
12334          // ends the manoeuvre 3 s after the FIRST off.
12335          if (man._apOffSince == null) man._apOffSince = Date.now();
12336          if (Date.now() - man._apOffSince >= MANEUVER_AP_OFF_GRACE_MS) { _endManeuverHere(man, own); continue; }
12337          if (man._apOffTimer) clearTimeout(man._apOffTimer);
12338          man._apOffTimer = setTimeout(() => {
12339            man._apOffTimer = null;
12340            _endLocalManeuverIfLeft();
12341          }, MANEUVER_AP_OFF_GRACE_MS - (Date.now() - man._apOffSince) + 50);
12342          continue;
12343        }
12344        _endManeuverHere(man, own);
12345      }
12346    }
12347    function _endManeuverHere(man, own) {
12348      if (man !== state.empopado && man !== state.aproado) return;
12349      if (man.phase !== "transit" && man.phase !== "active") return;
12350      if (man._apOffTimer) { clearTimeout(man._apOffTimer); man._apOffTimer = null; }
12351      console.info(`[${own === "wind" ? "aproado" : "empopado"}] left from outside (mode=${state.mode}, engaged=${state.engaged}): ending here`);
12352      if (man === state.empopado) empopadoTearDown({ restoreAll: false });
12353      else aproadoTearDown();
12354    }
12355    function _pseudoManeuverRunning(id) {
12356      for (const m of [state.aproado, state.empopado]) {
12357        if (m && m.id === id && (m.phase === "transit" || m.phase === "active")) return true;
12358      }
12359      return false;
12360    }
12361    function _setManeuverPseudo(active, id) {
12362      // Not the manoeuvre the heartbeat renews: end its own backend entry
12363      // only (Rev633, Gemini re-audit 2026-11-06).
12364      if (!active && id && _maneuverPseudoId && id !== _maneuverPseudoId) { _postManeuverPseudo(false, id); return; }
12365      try { if (_maneuverPseudoTimer) { clearInterval(_maneuverPseudoTimer); _maneuverPseudoTimer = null; } } catch { /* silent */ }
12366      if (active) {
12367        _maneuverPseudoId = id;
12368        _maneuverPseudoTimer = setInterval(() => {
12369          // Rev638: second chance for the "left from outside" check, in case
12370          // its 3 s timer did not run (tab in the background).
12371          // Rev639 (C6): the same rule as the deltas (3 s of continuous AP off).
12372          _endLocalManeuverIfLeft();
12373          if (_pseudoManeuverRunning(id)) _postManeuverPseudo(true, id);
12374          else _setManeuverPseudo(false, id);
12375        }, 20000);
12376        _postManeuverPseudo(true, id);
12377      } else {
12378        const was = _maneuverPseudoId;
12379        _maneuverPseudoId = null;
12380        if (was) _postManeuverPseudo(false, was);
12381      }
12382    }
12383    function _postManeuverPseudo(active, id) {
12384      try {
12385        skFetch(`/plugins/${PLUGIN_ID}/maneuver-state`, {
12386          method: "POST",
12387          headers: { "Content-Type": "application/json" },
12388          body: JSON.stringify({ active: !!active, id }),
12389        }).then(async (r) => {
12390          // Rev641 (GPT re-audit of Rev640 #3): the backend says this
12391          // manoeuvre was ended (hand-over from another screen, or pypilot
12392          // left it): end it here too.
12393          if (!active || !r || !r.ok) return;
12394          const j = await r.json().catch(() => null);
12395          if (!j || j.ended !== true) return;
12396          for (const [man, own] of [[state.empopado, "true wind"], [state.aproado, "wind"]]) {
12397            if (man && man.id === id) _endManeuverHere(man, own);
12398          }
12399        }).catch(() => { /* silent - alarm gate is best-effort */ });
12400      } catch { /* silent */ }
12401    }
12402    function _postManeuverHandOver(ids) {
12403      try {
12404        skFetch(`/plugins/${PLUGIN_ID}/maneuver-state`, {
12405          method: "POST",
12406          headers: { "Content-Type": "application/json" },
12407          body: JSON.stringify({ active: false, ids }),
12408        }).catch(() => { /* silent */ });
12409      } catch { /* silent */ }
12410    }
```

### public/app.js lines 12714-12782 (visor: aproadoExecute)

```js
12714  
12715    async function aproadoExecute() {
12716      const apr = state.aproado;
12717      if (!apr) return;
12718      // Rev323 (Carlos, 2026-09-27): flag pseudo-modo activo para
12719      // silenciar heading-deviation / cruise-drift / unable-to-steer
12720      // durante la maniobra.
12721      _setManeuverPseudo(true, apr.id);
12722      // Rev90: transit is a NEW phase between countdown and active. The
12723      // boat starts rotating toward head-to-wind; only when |AWA| falls
12724      // below APROADO_ACHIEVED_DEG do we consider it "aproada" and start
12725      // the elapsed timer. Distance tracking, however, begins here so it
12726      // covers the whole maneuver (transit + aproado).
12727      apr.phase = "transit";
12728      apr.executeTs = Date.now();
12729      apr.startTs = null;                      // elapsed clock arms later
12730      apr.startPos = state.position ? { ...state.position } : null;
12731      apr.startHeadingDeg = state.heading != null
12732        ? ((state.heading * RAD2DEG + 360) % 360)
12733        : null;
12734      setSelect("#mode-select", "aproado");
12735      _setPhase("transit");
12736      const hud = _aproadoHud();
12737      if (hud) { hud.classList.add("transit"); hud.classList.remove("summary"); }
12738      // Set the transit title now so it reflects the chosen direction.
12739      const transitTitle = document.getElementById("aproado-transit-title");
12740      if (transitTitle) {
12741        transitTitle.textContent = apr.direction === "bow"
12742          ? t("aproado.transit.title.bow")
12743          : t("aproado.transit.title.stern");
12744      }
12745      try {
12746        // Rev359: wait for state.mode="wind" echo before writing target,
12747        // otherwise pypilot interprets target=0 as compass heading 0
12748        // instead of AWA=0 (bug #1 Sprint K sea trial 2026-09-28).
12749        await apSetModeAndWait("wind");
12750        // Rev539 (GPT review 5 #2): cancelled while waiting -> write nothing.
12751        if (state.aproado !== apr || apr.phase !== "transit") return;
12752        if (apr.direction === "bow" || state.windAngle == null) {
12753          // PROA: shortest path (pypilot's default) is bow-through when
12754          // starting from close-hauled or reaching. Also fallback for POPA
12755          // when we have no wind sensor - we cannot force the swing side
12756          // without knowing which side the wind is on.
12757          apr._targetIsFinal = true;
12758          await apSetTargetRad(0);
12759        } else {
12760          // POR POPA (Rev92): pypilot has no jibe primitive - if we just
12761          // command target = 0 it picks the SHORTEST arc, which for a
12762          // close-hauled boat is the bow-through side. To force the swing
12763          // to go through the stern we walk a chain of intermediate
12764          // targets 60 deg apart around the LONG side of the circle. Each
12765          // step waits for the boat to catch up before advancing, so
12766          // pypilot never has an ambiguous or reversible shortest-path
12767          // decision. When the chain wraps past the far side we release
12768          // the final target = 0 and let _aproadoCheckAchieved latch into
12769          // the active phase.
12770          apr._targetIsFinal = false;
12771          aproadoForceStern(state.windAngle);   // fire-and-forget async
12772        }
12773        if (state.aproado !== apr || apr.phase !== "transit") return;
12774        if (!state.engaged) await apEngage();
12775      } catch (e) {
12776        console.warn("aproado: mode/target/engage failed", e);
12777        // Self-audit Rev540: the mode did not change (refused / not
12778        // confirmed): end the manoeuvre instead of a "transit" that does nothing.
12779        if (state.aproado === apr) { aproadoTearDown(); setSelect("#mode-select", state.mode || ""); }
12780        return;
12781      }
12782      updateAproadoHud();
```

### public/app.js lines 12916-12931 (visor: aproadoTearDown)

```js
12916    // (used when the user picks another mode from the dropdown while active).
12917    function aproadoTearDown() {
12918      const apr = state.aproado;
12919      if (!apr) return;
12920      _mtLog("aproado_teardown", { phase: apr.phase, direction: apr.direction });
12921      // Rev323: cerrar el gate pseudo-modo antes de nada; el backend
12922      // vuelve a evaluar heading-deviation con el umbral normal.
12923      _setManeuverPseudo(false, apr.id);
12924      if (apr._cdTimer) { clearInterval(apr._cdTimer); apr._cdTimer = null; }
12925      if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
12926      if (apr._summaryTimer) { clearTimeout(apr._summaryTimer); apr._summaryTimer = null; }
12927      hideAproadoHud();
12928      state.aproado = null;
12929      try { _renderModeSelectBtn(); } catch { /* silent */ }
12930    }
12931  
```

### public/app.js lines 13029-13150 (visor: Empopado temporary gains)

```js
13029    }
13030    // Rev633 (GPT re-audit 2026-11-06 R05): the manoeuvre is still running
13031    // and on the profile the gains were raised in.
13032    function _empopadoHotGainsOwned(ap) {
13033      return state.empopado === ap && (ap.phase === "transit" || ap.phase === "active")
13034        && state.profile === ap._hotGainProfile;
13035    }
13036    async function _empopadoApplyHotGains(ap) {
13037      if (!ap || ap._hotGainSnapshot) return;
13038      const pilot = state.pilot;
13039      if (!pilot) return;
13040      // Rev633: the original of each gain is recorded BEFORE it is raised,
13041      // so a manoeuvre ended half way restores what was already sent; and no
13042      // further gain is raised once it ended or the profile changed.
13043      ap._hotGainProfile = state.profile;
13044      ap._hotGainSnapshot = {};
13045      const cat = state.catalog || {};
13046      const vals = state.pypilotValues || {};
13047      const targets = [
13048        { path: `ap.pilot.${pilot}.P`,  mult: EMPOPADO_HOT_GAIN_MULT.P },
13049        { path: `ap.pilot.${pilot}.D`,  mult: EMPOPADO_HOT_GAIN_MULT.D },
13050        { path: `servo.max_slew_speed`, mult: EMPOPADO_HOT_GAIN_MULT.SLEW },
13051      ];
13052      const applied = {};
13053      let anyFailed = false;
13054      for (const t of targets) {
13055        const entry = cat[t.path];
13056        const cur = vals[t.path];
13057        if (typeof cur !== "number") continue;
13058        const max = typeof entry?.max === "number" ? entry.max : Infinity;
13059        const next = Math.min(cur * t.mult, max);
13060        if (Math.abs(next - cur) < 1e-6) continue;
13061        if (!_empopadoHotGainsOwned(ap)) { console.info("empopado: ended or profile changed - no more hot gains"); break; }
13062        ap._hotGainSnapshot[t.path] = cur;
13063        try {
13064          const resp = await pluginRaw(t.path, next);
13065          if (resp && resp.ok === false) {
13066            anyFailed = true;
13067            console.warn(`[empopado] hot gain ${t.path} refused by pypilot (status=${resp.status})`);
13068            continue;
13069          }
13070          applied[t.path] = cur;
13071          console.info(`empopado: hot gain ${t.path} ${cur.toFixed(3)} → ${next.toFixed(3)}`);
13072        } catch (e) {
13073          anyFailed = true;
13074          console.warn(`empopado: hot gain ${t.path} apply failed`, e);
13075        }
13076      }
13077      const appliedCount = Object.keys(applied).length;
13078      if (appliedCount === 0) {
13079        console.warn(`[empopado] hot gains NO aplicadas — pilot='${pilot}' valsKeys=${Object.keys(vals).length} anyFailed=${anyFailed}`);
13080        _empopadoSetHotBadge(anyFailed ? "failed" : "off");
13081      } else {
13082        _empopadoSetHotBadge(anyFailed ? "failed" : "on");
13083      }
13084    }
13085    // Rev641 (GPT re-audit of Rev640 #6): gains Empopado raised and could not
13086    // put back. Retried every 15 s while the profile is still the one they
13087    // belong to, 4 times; then the sailor is told which ones to check.
13088    let _empopadoPendingGains = null;   // { profile, gains: {path: value}, tries, timer }
13089    function _empopadoKeepPendingGains(profile, gains) {
13090      if (_empopadoPendingGains && _empopadoPendingGains.timer) clearInterval(_empopadoPendingGains.timer);
13091      const p = { profile, gains: { ...gains }, tries: 0, timer: null };
13092      p.timer = setInterval(() => { _empopadoRetryPendingGains(p).catch(() => { /* silent */ }); }, 15000);
13093      _empopadoPendingGains = p;
13094    }
13095    async function _empopadoRetryPendingGains(p) {
13096      if (_empopadoPendingGains !== p || p.busy) return;
13097      p.busy = true;
13098      try {
13099        if (p.profile === undefined || state.profile === p.profile) {
13100          for (const [path, val] of Object.entries(p.gains)) {
13101            if (p.profile !== undefined && state.profile !== p.profile) break;
13102            try {
13103              const resp = await pluginRaw(path, val);
13104              if (!(resp && resp.ok === false)) { delete p.gains[path]; console.info(`empopado: pending gain ${path} restored → ${val.toFixed(3)}`); }
13105            } catch { /* next try */ }
13106          }
13107        }
13108        p.tries++;
13109        const left = Object.keys(p.gains);
13110        if (!left.length || p.tries >= 4) {
13111          clearInterval(p.timer);
13112          _empopadoPendingGains = null;
13113          if (left.length) {
13114            const list = left.map((k) => `${k} = ${Number(p.gains[k]).toFixed(3)}`).join(", ");
13115            _pmAlert(t("empopado.gainsNotRestored.title"), t("empopado.gainsNotRestored.body").replace("{profile}", String(p.profile || "")).replace("{list}", list));
13116          }
13117        }
13118      } finally { p.busy = false; }
13119    }
13120    async function _empopadoRestoreHotGains(ap) {
13121      const snap = ap && ap._hotGainSnapshot;
13122      if (!snap) {
13123        _empopadoSetHotBadge(null);
13124        return;
13125      }
13126      for (const [path, val] of Object.entries(snap)) {
13127        // Rev633 (GPT re-audit 2026-11-06 R04): checked before EVERY write -
13128        // an old gain is never written into a profile chosen meanwhile.
13129        if (ap._hotGainProfile !== undefined && state.profile !== ap._hotGainProfile) {
13130          console.warn(`empopado: profile is now "${state.profile}", not "${ap._hotGainProfile}": ${path} and the rest left as they are`);
13131          break;
13132        }
13133        // Rev639 (GPT re-audit of Rev638 C5): a refused or failed restore is
13134        // not "restored": it stays in the snapshot and the badge says so.
13135        let ok = false;
13136        try {
13137          const resp = await pluginRaw(path, val);
13138          ok = !(resp && resp.ok === false);
13139          if (ok) console.info(`empopado: hot gain ${path} restored → ${val.toFixed(3)}`);
13140          else console.warn(`empopado: hot gain ${path} restore refused (status=${resp.status})`);
13141        } catch (e) { console.warn(`empopado: hot gain ${path} restore failed`, e); }
13142        if (ok) delete snap[path];
13143      }
13144      const left = Object.keys(snap).length;
13145      ap._hotGainSnapshot = left ? snap : null;
13146      _empopadoSetHotBadge(left ? "failed" : null);
13147      // Rev641 (GPT re-audit of Rev640 #6): what failed outlives the
13148      // manoeuvre's window - kept here and retried on the same profile.
13149      if (left) _empopadoKeepPendingGains(ap._hotGainProfile, snap);
13150    }
```

### public/app.js lines 13204-13275 (visor: empopadoExecute)

```js
13204    }
13205    async function empopadoExecute() {
13206      const ap = state.empopado;
13207      if (!ap) return;
13208      // Rev323 (Carlos, 2026-09-27): silenciar heading-deviation /
13209      // cruise-drift / unable-to-steer durante la maniobra.
13210      _setManeuverPseudo(true, ap.id);
13211      ap.phase = "transit";
13212      ap.executeTs = Date.now();
13213      ap.startTs = null;
13214      ap.startPos = state.position ? { ...state.position } : null;
13215      ap.startHeadingDeg = state.heading != null
13216        ? ((state.heading * RAD2DEG + 360) % 360)
13217        : null;
13218      setSelect("#mode-select", "empopado");
13219      _empopadoSetPhase("transit");
13220      const hud = _empopadoHud();
13221      if (hud) { hud.classList.add("transit"); hud.classList.remove("summary"); }
13222      const transitTitle = document.getElementById("empopado-transit-title");
13223      if (transitTitle) transitTitle.textContent = t("empopado.hud.title") || "EMPOPANDOSE";
13224      // Cambio de perfil a uno reactivo (seguridad en popa).
13225      const reactive = _empopadoPickReactiveProfile();
13226      if (reactive && reactive !== state.profile) {
13227        try {
13228          const resp = await pluginRaw("profile", reactive);
13229          // Rev639 (GPT re-audit of Rev638 C4): a refused swap (HTTP error,
13230          // pypilot offline) is not a swap - nothing to restore later.
13231          if (resp && resp.ok === false) console.warn(`empopado: profile swap to ${reactive} refused (status=${resp.status})`);
13232          else {
13233            ap._profileSwapped = reactive;
13234            console.info(`empopado: profile swapped ${ap.snapshot.profile} → ${reactive} (reactive)`);
13235          }
13236        } catch (e) { console.warn("empopado: profile swap failed", e); }
13237        // Rev633 (GPT re-audit 2026-11-06 R03): ended while swapping: put the
13238        // profile back and send nothing else. Rev639 (C4): only over our own
13239        // swap - a profile the sailor chose meanwhile stays.
13240        if (state.empopado !== ap || ap.phase !== "transit") {
13241          const ours = state.profile === ap._profileSwapped || state.profile === ap.snapshot.profile;
13242          if (ap._profileSwapped && ap.snapshot.profile && ours) { try { pluginRaw("profile", ap.snapshot.profile).catch(() => {}); } catch { /* silent */ } }
13243          return;
13244        }
13245      }
13246      try {
13247        // Rev367 (Carlos, 2026-09-30, sea-trial feedback): empopado
13248        // use TRUE WIND mode (TWA control) instead of "wind" (AWA
13249        // control). En viento de popa el AWA es errático (viento
13250        // relativo casi = velocidad del barco) y pypilot no puede
13251        // fijarse. TWA es el ángulo respecto al viento real, estable
13252        // aunque el barco varíe de rumbo. Pypilot core soporta "true
13253        // wind" como mode string (con espacio; ver SW_MODE_MAP en
13254        // src/index.ts). Rev359 apSetModeAndWait espera el eco antes
13255        // del target write.
13256        await apSetModeAndWait("true wind");
13257        // Rev539 (GPT review 5 #2): cancelled while waiting -> write nothing.
13258        if (state.empopado !== ap || ap.phase !== "transit") return;
13259        // Target TWA = π - 0.001 (viento por popa). Usamos ligeramente
13260        // menos de π para evitar que pypilot normalice al opuesto.
13261        const targetRad = Math.PI - 0.001;
13262        await apSetTargetRad(targetRad);
13263        ap._targetIsFinal = true;
13264        if (state.empopado !== ap || ap.phase !== "transit") return;
13265        if (!state.engaged) await apEngage();
13266        console.info(`empopado: dir=${ap.direction} mode="true wind" target=${targetRad.toFixed(3)} engage sent`);
13267      } catch (e) {
13268        console.warn("empopado: mode/target/engage failed", e);
13269        // Self-audit Rev540: same as aproado.
13270        if (state.empopado === ap) { empopadoTearDown({}); setSelect("#mode-select", state.mode || ""); }
13271        return;
13272      }
13273      updateEmpopadoHud();
13274      ap._hudTimer = setInterval(updateEmpopadoHud, APROADO_HUD_TICK_MS);
13275    }
```

### public/app.js lines 13402-13534 (visor: empopadoFinish, empopadoTearDown, empopadoClose)

```js
13402    }
13403    async function empopadoFinish(opts) {
13404      const ap = state.empopado;
13405      if (!ap || (ap.phase !== "active" && ap.phase !== "transit")) return;
13406      // Rev407 (Carlos sea trial 2026-10-03): default = no restore. The
13407      // sailor stays on whatever heading the AP ended up at after the
13408      // manoeuvre. Previously the default was true, which triggered an
13409      // automatic mode+target+engage restore to the pre-empopado state.
13410      // Carlos: "el salir del modo y volver a rumbo me parece peligrosísimo,
13411      // es casi mejor quedarnos en el rumbo que estamos. [...] nos quedamos
13412      // en ese rumbo" (sea trial 2026-10-03). The sailor explicitly opts in
13413      // by passing { restoreAll: true } if they want the old behaviour.
13414      const restoreAll = !!(opts && opts.restoreAll === true);
13415      const silent = !!(opts && opts.silent);
13416      if (ap._hudTimer) { clearInterval(ap._hudTimer); ap._hudTimer = null; }
13417      ap.endTs = Date.now();
13418      if (ap.startPos && state.position) {
13419        ap.distanceNm = _distanceNm(ap.startPos, state.position);
13420      }
13421      if (ap.startTs == null) ap.startTs = ap.endTs;
13422      ap.phase = silent ? "summary" : "summary";
13423      // Rev630 (sea trial 2026-11-05): the manoeuvre is over - stop the
13424      // "manoeuvre active" flag now, as aproadoFinish does. It used to wait
13425      // for the summary timer, which closing the summary by hand cancelled.
13426      _setManeuverPseudo(false, ap.id);
13427      const hud = _empopadoHud();
13428      if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
13429      _empopadoSetPhase("summary");
13430      updateEmpopadoHud();
13431      const snap = ap.snapshot;
13432      if (snap.mode) setSelect("#mode-select", snap.mode);
13433      // Rev320: restaurar gains hot ANTES del profile swap.
13434      // El profile swap sobrescribe todos los gains — si hacemos primero
13435      // el restore de nuestros hot gains y luego el profile restore, es
13436      // idempotente. Si el orden fuera al revés, el profile pondría los
13437      // gains del perfil original y nuestro restore (con valores ya
13438      // sobrescritos por el profile) los pisaría con valores viejos.
13439      await _empopadoRestoreHotGains(ap);
13440      // Rev633 (GPT re-audit 2026-11-06 R03): closed (or another mode chosen)
13441      // while restoring: the sailor's choice stands, nothing more is sent.
13442      if (state.empopado !== ap) return;
13443      // Perfil siempre restaura si lo swapeamos.
13444      if (ap._profileSwapped && snap.profile && snap.profile !== ap._profileSwapped && state.profile === ap._profileSwapped) {
13445        try { await pluginRaw("profile", snap.profile); console.info(`empopado: profile restored → ${snap.profile}`); }
13446        catch (e) { console.warn("empopado: profile restore failed", e); }
13447        if (state.empopado !== ap) return;
13448      }
13449      if (restoreAll) {
13450        if (snap.mode) {
13451          try { await apSetMode(snap.mode); console.info(`empopado: mode restored → ${snap.mode}`); }
13452          catch (e) { console.warn("empopado: mode restore failed", e); }
13453        }
13454        if (typeof snap.targetRad === "number") {
13455          try { await apSetTargetRad(snap.targetRad); console.info(`empopado: target restored → ${snap.targetRad.toFixed(3)}`); }
13456          catch (e) { console.warn("empopado: target restore failed", e); }
13457        }
13458        if (snap.engaged === false && state.engaged) {
13459          try { await apDisengage(); console.info("empopado: AP disengaged (was OFF before empopado)"); }
13460          catch (e) { console.warn("empopado: disengage restore failed", e); }
13461        }
13462      } else {
13463        // Rev440 (Carlos 2026-10-10): salir dejando el pilot en "true wind"
13464        // es menos estable que compass para mantener el rumbo actual.
13465        // Conmutar a compass con target = heading actual: el barco se
13466        // queda EXACTAMENTE donde está pero bajo el modo seguro. Si no
13467        // hay sensor de heading, dejar como estaba.
13468        const curHdg = (typeof state.heading === "number") ? state.heading : null;
13469        if (curHdg != null) {
13470          try {
13471            await apSetModeAndWait("compass");
13472            if (state.empopado !== ap) return;   // Rev633 R03
13473            await apSetTargetRad(curHdg);
13474            console.info(`empopado: safe-exit to compass @ ${(curHdg * RAD2DEG).toFixed(1)} deg (Rev440)`);
13475          } catch (e) {
13476            console.warn("empopado: safe-exit to compass failed", e);
13477          }
13478        } else {
13479          console.info("empopado: finish without restore (Rev407 default) — no heading sensor, leaving pilot where it is");
13480        }
13481      }
13482      // Auto-hide del summary igual que aproado (usa APROADO_SUMMARY_MS).
13483      // Rev630: close only - gains and profile were restored above; a second
13484      // restore 15 s later overwrote what the sailor had chosen meanwhile.
13485      ap._summaryTimer = setTimeout(() => { if (state.empopado === ap) empopadoClose(); }, APROADO_SUMMARY_MS);
13486    }
13487    function empopadoTearDown(opts) {
13488      const ap = state.empopado;
13489      if (!ap) return;
13490      _mtLog("empopado_teardown", { phase: ap.phase, direction: ap.direction, restoreAll: !!(opts && opts.restoreAll) });
13491      // Rev316: restore adicional si tearDown fue directo (sin pasar por
13492      // finish, ej. mode-select change durante active).
13493      const restoreAll = opts && opts.restoreAll === true;
13494      const snap = ap.snapshot || {};
13495      // Rev320: restaurar hot gains ANTES del profile (mismo orden que
13496      // empopadoFinish; ver comentario allí para el racional).
13497      // Rev539 (GPT review 5 #9): wait for the gain restore before switching
13498      // profile, or the last gains land on the original profile.
13499      // Rev630 (GPT audit 2026-11-05 F04): this runs after the sailor's next
13500      // choice may have landed (AUTOWIND writes its own profile). Restore
13501      // only while the profile is still the one the manoeuvre left.
13502      const swapped = ap._profileSwapped;
13503      const left = swapped || snap.profile;
13504      if (state.profile === left) {
13505        _empopadoRestoreHotGains(ap).catch(() => {}).then(() => {
13506          if (swapped && snap.profile && snap.profile !== swapped && state.profile === swapped) {
13507            try { pluginRaw("profile", snap.profile).catch(() => {}); } catch { /* silent */ }
13508          }
13509        });
13510      } else {
13511        console.info(`empopado: profile is now "${state.profile}", not "${left}": gains/profile not restored`);
13512      }
13513      if (restoreAll) {
13514        if (snap.mode) { try { apSetMode(snap.mode).catch(() => {}); } catch {} }
13515        if (typeof snap.targetRad === "number") { try { apSetTargetRad(snap.targetRad).catch(() => {}); } catch {} }
13516        if (snap.engaged === false && state.engaged) { try { apDisengage().catch(() => {}); } catch {} }
13517      }
13518      empopadoClose();
13519    }
13520    // Rev630 (sea trial 2026-11-05): ends the manoeuvre without touching
13521    // gains, profile or mode - the "manoeuvre active" flag, timers, HUD and
13522    // state. Every way out goes through here: the end of the summary, the
13523    // summary closed by hand, another mode chosen, the teardown above.
13524    function empopadoClose() {
13525      const ap = state.empopado;
13526      if (!ap) return;
13527      _setManeuverPseudo(false, ap.id);
13528      if (ap._hudTimer)     { clearInterval(ap._hudTimer);   ap._hudTimer = null; }
13529      if (ap._summaryTimer) { clearTimeout(ap._summaryTimer); ap._summaryTimer = null; }
13530      hideEmpopadoHud();
13531      state.empopado = null;
13532      try { _renderModeSelectBtn(); } catch { /* silent */ }
13533    }
13534  
```

### public/app.js lines 13542-13618 (visor: aproadoFinish)

```js
13542    // before pypilot's echo lands.
13543    async function aproadoFinish(opts) {
13544      const apr = state.aproado;
13545      if (!apr || (apr.phase !== "active" && apr.phase !== "transit")) return;
13546      if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
13547      apr.endTs = Date.now();
13548      if (apr.startPos && state.position) {
13549        apr.distanceNm = _distanceNm(apr.startPos, state.position);
13550      }
13551      // If we never reached the achieved phase, stamp startTs so the
13552      // summary shows a meaningful "0:00" instead of NaN.
13553      if (apr.startTs == null) apr.startTs = apr.endTs;
13554      apr.phase = "summary";
13555      // Rev539 (GPT review 5 #1): the manoeuvre is over - stop renewing the
13556      // "manoeuvre active" flag that silences the heading alarms.
13557      _setManeuverPseudo(false, apr.id);
13558      const hud = _aproadoHud();
13559      if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
13560      _setPhase("summary");
13561      updateAproadoHud();
13562      // Rev415 (Carlos sea trial 2026-10-04, obs #11): "hay que anular el
13563      // restituir rumbo cuando salimos de aproado o empopado porque es
13564      // peligroso". Default `restoreAll=false` matches what empopadoFinish
13565      // did since Rev407 R. Keep the opt-in for the (rare) case where the
13566      // sailor really wants the pre-aproado state back.
13567      const restoreAll = !!(opts && opts.restoreAll === true);
13568      // Optimistic dropdown update so UI does not stay stuck on "aproado".
13569      const snap = apr.snapshot;
13570      if (restoreAll) {
13571        if (snap.mode) setSelect("#mode-select", snap.mode);
13572        // Rev90: guard each step separately so one failure does not skip
13573        // the others. Log successes for QA visibility.
13574        if (snap.mode) {
13575          try { await apSetMode(snap.mode); console.info("aproado: mode restored ->", snap.mode); }
13576          catch (e) { console.warn("aproado: mode restore failed", e); }
13577        }
13578        if (snap.targetRad != null) {
13579          try { await apSetTargetRad(snap.targetRad); console.info("aproado: target restored ->", snap.targetRad.toFixed(3), "rad"); }
13580          catch (e) { console.warn("aproado: target restore failed", e); }
13581        }
13582        // If the AP was NOT engaged before aproado, disengage now (Rev88 #10).
13583        if (!snap.engaged) {
13584          try { await apDisengage(); console.info("aproado: AP disengaged (was OFF before aproado)"); }
13585          catch (e) { console.warn("aproado: disengage failed", e); }
13586        }
13587      } else {
13588        // Rev440 (Carlos 2026-10-10): "al salir queda en wind, mejor
13589        // compass por estabilidad de rumbo". aproadoStart puso el pilot
13590        // en modo "wind" para controlar AWA. Si no restauramos, el
13591        // barco se queda en wind indefinidamente — menos estable que
13592        // compass para mantener el rumbo actual. Fix: conmutar a
13593        // compass con target = heading actual, de modo que el pilot
13594        // sostenga EXACTAMENTE el rumbo donde quedó la maniobra pero
13595        // en el modo seguro. Si falta sensor de heading, dejar como
13596        // estaba (sin sacar al pilot de wind a ciegas).
13597        const curHdg = (typeof state.heading === "number") ? state.heading : null;
13598        if (curHdg != null) {
13599          try {
13600            await apSetModeAndWait("compass");
13601            if (state.aproado !== apr) return;   // Rev633 R03: closed meanwhile
13602            await apSetTargetRad(curHdg);
13603            console.info(`aproado: safe-exit to compass @ ${(curHdg * RAD2DEG).toFixed(1)} deg (Rev440)`);
13604          } catch (e) {
13605            console.warn("aproado: safe-exit to compass failed", e);
13606          }
13607        } else {
13608          console.info("aproado: finish without restore (Rev415 default) — no heading sensor, leaving pilot where it is");
13609        }
13610      }
13611      apr._summaryTimer = setTimeout(() => {
13612        if (state.aproado === apr) {
13613          hideAproadoHud();
13614          state.aproado = null;
13615        }
13616      }, APROADO_SUMMARY_MS);
13617    }
13618  
```

### public/app.js lines 14161-14280 (visor: mode select handler)

```js
14161      // and never land on the mode-select's value).
14162      $("#mode-select").addEventListener("change", (e) => {
14163        _msCollapse();
14164        const chosen = e.target.value;
14165        // Rev639 (GPT re-audit of Rev638 C8): a choice still waiting (AUTOWIND
14166        // holding the wind angle) must not act after a newer choice.
14167        const selGen = ++_modeSelectGen;
14168        // Picking another mode while a pseudo-mode is active ends the
14169        // maneuver WITHOUT restoring the pre-* mode (usuario ya
14170        // eligió qué quiere ahora). SÍ restaura el profile (Empopado).
14171        // Use the SALIR button on the HUD to return to the previous mode.
14172        // Rev630 (sea trial 2026-11-05): done first, so AUTOWIND and NAV
14173        // (which return early below) end it too, and a manoeuvre still
14174        // showing its summary is closed as well.
14175        // Rev633 (GPT R10 / Gemini 2.2, re-audit 2026-11-06): Aproado ends an
14176        // Empopado and vice versa - only one manoeuvre at a time.
14177        let endedManoeuvre = false;
14178        if (chosen !== "empopado") {
14179          const emp = state.empopado;
14180          if (emp && (emp.phase === "transit" || emp.phase === "active")) { empopadoTearDown({ restoreAll: false }); endedManoeuvre = true; }
14181          else if (emp) empopadoClose();
14182        }
14183        if (chosen !== "aproado") {
14184          const apr = state.aproado;
14185          if (apr && (apr.phase === "transit" || apr.phase === "active")) { aproadoTearDown(); endedManoeuvre = true; }
14186          else if (apr) aproadoTearDown();
14187        }
14188        // Rev639 (GPT re-audit of Rev638 C7): a manoeuvre run from ANOTHER
14189        // screen ends too - choosing a mode here is taking over, even when
14190        // the new choice keeps pypilot in the same wind mode.
14191        // Rev641 (GPT re-audit of Rev640 #3/#4/#5): it ends exactly the ids
14192        // this screen saw (a late hand-over never ends a newer manoeuvre),
14193        // and only once the choice is really made (NAV asks first).
14194        const seenIds = Array.isArray(state.remoteManeuverIds) ? state.remoteManeuverIds.slice() : [];
14195        const handOver = () => {
14196          if (!state.empopado && !state.aproado && seenIds.length) _postManeuverHandOver(seenIds);
14197        };
14198        const navAsks = chosen === "nav" && state.engaged && state.route && typeof state.route.legBearingDeg === "number" && typeof state.heading === "number"
14199          && Math.abs((((state.route.legBearingDeg - state.heading * RAD2DEG) % 360) + 540) % 360 - 180) > 60;
14200        if (!navAsks) handOver();
14201        // Rev633 (Gemini 2.1): the manoeuvre left pypilot on its extreme
14202        // target (AWA 0 / TWA 180). Going on in a wind mode (AUTOWIND
14203        // included) holds the wind angle the boat has NOW instead.
14204        const endedOnWindTarget = endedManoeuvre && (state.mode === "wind" || state.mode === "true wind");
14205        // Rev518: pseudo-mode AUTOWIND lives in the backend.
14206        if (chosen === "autowind") {
14207          (async () => {
14208            if (endedOnWindTarget) {
14209              const now = state.mode === "true wind" ? state.windAngleTrue : state.windAngle;
14210              if (typeof now === "number") { try { await apSetTargetRad(now); } catch (e) { console.warn("[mode-select] hold wind angle", e); } }
14211            }
14212            if (selGen !== _modeSelectGen) return;   // another mode chosen meanwhile
14213            _autowindPost({ enabled: true });
14214          })();
14215          return;
14216        }
14217        if (state.autowind && state.autowind.enabled) {
14218          _autowindPost({ enabled: false });
14219        }
14220        // Rev545 (Carlos #4): NAV that would turn more than 60 deg asks first.
14221        if (chosen === "nav" && state.engaged && state.route && typeof state.route.legBearingDeg === "number" && typeof state.heading === "number") {
14222          const turn = Math.abs((((state.route.legBearingDeg - state.heading * RAD2DEG) % 360) + 540) % 360 - 180);
14223          if (turn > 60) {
14224            (async () => {
14225              const ok = await _pmConfirm(t("route.bigTurnQ").replace("{deg}", String(Math.round(turn))), t("route.bigTurnBody"));
14226              if (ok && selGen === _modeSelectGen) { handOver(); apSetMode("nav"); }
14227              else setSelect("#mode-select", state.mode || "");
14228            })();
14229            return;
14230          }
14231        }
14232        // Rev88: pseudo-mode "aproado" is intercepted locally - opens the
14233        // choice modal (bow / stern) and starts the maneuver on confirmation.
14234        if (chosen === "aproado") {
14235          aproadoStart();
14236          return;
14237        }
14238        // Rev313 (Carlos sea trial 2026-09-25): pseudo-mode "empopado"
14239        // (viento por popa para bajar vela).
14240        if (chosen === "empopado") {
14241          empopadoStart();
14242          return;
14243        }
14244        // Rev170/171 (Carlos): fix target reference when switching
14245        // between compass-family and wind-family modes without the
14246        // brief "wrong then right" flash. Pypilot interprets
14247        // ap.heading_command differently per mode - a heading value in
14248        // compass/gps/nav, an APPARENT WIND ANGLE in wind, a TRUE WIND
14249        // ANGLE in "true wind". If we just change mode, the old value
14250        // is reinterpreted for one tick and the diamond leaps.
14251        //
14252        // Rev170 approach: apSetMode() then apSetTargetRad() 250 ms
14253        // later. That produced the "duda" Carlos reported.
14254        //
14255        // Rev171 approach: compute the right target FIRST, apply it
14256        // OPTIMISTICALLY to the visor, then send target + mode in
14257        // parallel (Promise.all). The visor never renders the stale
14258        // interpretation, and pypilot receives both PUTs at once so
14259        // the AutopilotProvider echo-cancellation absorbs the swap.
14260        const prevMode = String(state.mode || "").toLowerCase();
14261        const newMode = String(chosen).toLowerCase();
14262        const isNewTrueWind = newMode.includes("true") && newMode.includes("wind");
14263        const isNewWind     = newMode.includes("wind") && !isNewTrueWind;
14264        const isNewCompassFam = !newMode.includes("wind");
14265        const wasWindFam    = prevMode.includes("wind");
14266        // Rev249 (Carlos): family change is real regardless of engaged
14267        // state. Before, if the AP was disengaged the code left the old
14268        // target rad untouched and the diamond would reinterpret it
14269        // under the new mode (e.g. a wind AWA target of 0.85 rad ends up
14270        // painted as a 49 deg compass heading). Reajustar SIEMPRE.
14271        const familyChanged = wasWindFam !== !isNewCompassFam;
14272        let newTargetRad = null;
14273        // Rev633 (Gemini 2.1): after a manoeuvre, a wind mode also starts on
14274        // the angle the boat has now, not on the manoeuvre's AWA 0 / TWA 180.
14275        const reanchor = familyChanged || (endedOnWindTarget && !isNewCompassFam);
14276        if (reanchor) {
14277          if (isNewTrueWind && state.windAngleTrue != null) newTargetRad = state.windAngleTrue;
14278          else if (isNewWind && state.windAngle != null)    newTargetRad = state.windAngle;
14279          else if (isNewCompassFam && state.heading != null) newTargetRad = state.heading;
14280        }
```

### public/app.js lines 5324-5389 (visor: mode delta handler)

```js
 5324          break;
 5325        case "steering.autopilot.mode":
 5326          if (typeof _mtLog === "function") {
 5327            try { _mtLog("other", { stage: "visor", path: "steering.autopilot.mode", value, prev: state.mode, monoTs: performance.now() }); } catch { /* silent */ }
 5328          }
 5329          // Rev394 (Carlos, 2026-10-01, Gemini round 2): shield up until
 5330          // the backend explicitly nulls the virtualTack path. Rev392 only
 5331          // guarded while active=true, which left a ~5s window (terminal
 5332          // phase + linger) during which late pypilot echoes repainted
 5333          // the amber arrow. Now we swallow any mode delta while
 5334          // state.virtualTack exists (any phase, incl. terminal). The
 5335          // backend emits { virtualTack: null } once the 5s cleanup fires;
 5336          // at that point state.virtualTack becomes null and canonical
 5337          // deltas flow through normally.
 5338          if (state.virtualTack) {
 5339            break;
 5340          }
 5341          // Rev249 (Carlos): swallow a stale mode delta that arrives
 5342          // shortly after the user changed the selector locally. If the
 5343          // incoming value differs from the just-picked one, it is a
 5344          // pre-change echo; ignore. A delta matching the chosen mode
 5345          // (pypilot confirming) clears the guard.
 5346          if (Date.now() < _modeChangePendingUntil) {
 5347            if (value !== _modeChangeChosen) {
 5348              console.log(`[mode] swallow stale delta '${value}' (chose '${_modeChangeChosen}')`);
 5349              break;
 5350            }
 5351            _modeChangePendingUntil = 0;
 5352            _modeChangeChosen = null;
 5353          }
 5354          // Rev295 (Carlos, navigating - bug C reinforcement): when the
 5355          // mode crosses the compass ↔ wind boundary, the backend
 5356          // provider re-anchors ap.heading_command to the current
 5357          // measurement in the destination space. During the ~200-800 ms
 5358          // it takes for the new target delta to arrive, the visor would
 5359          // otherwise keep showing the OLD target diamond and the sailor
 5360          // sees a stale value. Invalidate the local target so the
 5361          // diamond hides during the anchor gap; the next fresh
 5362          // steering.autopilot.target delta will repopulate it.
 5363          try {
 5364            const oldWind = String(state.mode || "").toLowerCase().includes("wind");
 5365            const newWind = String(value || "").toLowerCase().includes("wind");
 5366            if (oldWind !== newWind) {
 5367              state.target = null;
 5368              state.localTargetRad = null;
 5369              if (typeof renderTargetArrow === "function") renderTargetArrow();
 5370            }
 5371          } catch { /* silent */ }
 5372          state.mode = value;
 5373          // Self-audit Rev541: the mode pypilot really reported (state.mode
 5374          // can be set optimistically by the selector before the echo).
 5375          state._confirmedMode = value;
 5376          _endLocalManeuverIfLeft();
 5377          // Rev425: keep the visible mode-button in sync on external
 5378          // mode deltas.
 5379          try { _renderModeSelectBtn(); } catch { /* silent */ }
 5380          if (state.aproado && (state.aproado.phase === "transit" || state.aproado.phase === "active")) {
 5381            setSelect("#mode-select", "aproado");
 5382          } else {
 5383            setSelect("#mode-select", value);
 5384          }
 5385          _syncWindCornerFromMode(value);
 5386          // Rev207 (Carlos): mode change updates the button labels
 5387          // (compass / GPS -> "-100 deg" / "+100 deg"; wind -> "TACK").
 5388          try { renderTackButton(state.pypilotValues?.["ap.tack.state"]); } catch { /* silent */ }
 5389          break;
```

### public/app.js lines 5574-5587 (visor: engaged delta handler (start))

```js
 5574        }
 5575        case "steering.autopilot.engaged": {
 5576          if (typeof _mtLog === "function") {
 5577            try { _mtLog("other", { stage: "visor", path: "steering.autopilot.engaged", value, prev: state.engaged, monoTs: performance.now() }); } catch { /* silent */ }
 5578          }
 5579          const wasEngaged = state.engaged;
 5580          state.engaged = !!value;
 5581          // Rev262 (Carlos): TGT / diamond hide on disengage handled by
 5582          // the render layer (formatter 'tgt' + renderTargetArrow both
 5583          // guard on !state.engaged). Do NOT null state.target here -
 5584          // SK keeps pushing target deltas after disengage and would
 5585          // just repopulate it, creating a visible flicker.
 5586          renderEngage();
 5587          renderTargetArrow();
```
