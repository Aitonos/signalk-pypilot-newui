// PyPilot New-UI - webapp logic. Vanilla JS, no framework.
//
// Data model:
//   - Reads live SK values via a WebSocket stream subscribed to the paths we
//     need. Path list is the union of Autopilot API (owned by
//     pypilot-autopilot-provider) plus steering.autopilot.pypilot.* (owned by
//     this plugin) plus environment.wind.*.
//   - Writes go through the SK REST API. Autopilot API v1 endpoints for
//     engage/mode/target/tack; our plugin's /raw endpoint for gains and
//     calibration.
//
// SK versions handled:
//   - No hard dependency on Autopilot API v2 (user's server 404s on it).
//     We use v1: /signalk/v1/api/vessels/self/steering/autopilot with
//     targeted PUT to specific leaves.

(function () {
  "use strict";

  const PLUGIN_ID = "signalk-pypilot-newui";

  // ---- state ----
  const state = {
    values: {},          // path -> value cache
    mode: null,
    modeList: [],
    engaged: false,
    apState: "unknown",
    heading: null,       // rad from SK; converted to deg for display
    target: null,        // rad
    windAngle: null,     // rad
    windSpeed: null,     // m/s
    pilot: null,
    pilots: [],
    profile: null,
    profiles: [],
    gains: {},           // { pilot: { P: {min,max,value}, I: {...}, ... } }
    catalog: {},         // last known pypilot catalog
    availableActions: [],
    lastNudgeTs: 0,
    localTargetRad: null,
    autopilotId: "pypilot-sk", // will be discovered on boot from /autopilots
    authFailed: false,
    nudgeSmall: 1,             // populated from plugin config
    nudgeBig: 10,
    windAngleTrue: null,
    windSpeedTrue: null,
    sog: null,                 // m/s
  };

  const RAD2DEG = 180 / Math.PI;
  const DEG2RAD = Math.PI / 180;

  // ---- helpers ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmtDeg = (rad) =>
    (rad == null || isNaN(rad)) ? "---" : (rad * RAD2DEG).toFixed(0);
  const fmtDeg1 = (rad) =>
    (rad == null || isNaN(rad)) ? "---" : (rad * RAD2DEG).toFixed(1);
  const wrapDeg = (d) => {
    let x = d % 360;
    if (x < 0) x += 360;
    return x;
  };

  // ---- WebSocket stream to SK ----
  let ws = null;
  function connectSK() {
    const loc = window.location;
    const wsProto = loc.protocol === "https:" ? "wss" : "ws";
    const url = `${wsProto}://${loc.host}/signalk/v1/stream?subscribe=none`;
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      subscribeAll();
    });
    ws.addEventListener("message", (evt) => {
      try { handleDelta(JSON.parse(evt.data)); } catch { /* ignore */ }
    });
    ws.addEventListener("close", () => {
      setTimeout(connectSK, 2500);
    });
    ws.addEventListener("error", () => { try { ws.close(); } catch {} });
  }

  // Throttle renderControl. Even without user input, the pypilot_web can burst
  // ~30 deltas at reconnect and each render triggers SVG reflow. 50 ms window
  // keeps the UI snappy and cuts main-thread work by 10x on cheap phones.
  let _renderScheduled = false;
  function scheduleRenderControl() {
    if (_renderScheduled) return;
    _renderScheduled = true;
    setTimeout(() => { _renderScheduled = false; renderControl(); }, 50);
  }

  function subscribeAll() {
    const paths = [
      // Core autopilot API v1 (published by pypilot-autopilot-provider)
      "steering.autopilot.state",
      "steering.autopilot.mode",
      "steering.autopilot.target",
      "steering.autopilot.engaged",
      "steering.autopilot.availableActions",
      // Ours - a single wildcard on the pypilot subtree catches everything
      // including gains, servo, calibration, tack detail, errors, warnings,
      // availableModes, availablePilots, profile, pilot, runtime, version.
      "steering.autopilot.pypilot.*",
      // Heading (from pypilot plugin) + rudder + wind + SOG for dashboard tiles
      "navigation.headingMagnetic",
      "navigation.speedOverGround",
      "steering.rudderAngle",
      "environment.wind.angleApparent",
      "environment.wind.speedApparent",
      "environment.wind.angleTrueWater",
      "environment.wind.angleTrueGround",
      "environment.wind.speedTrue",
    ];
    const sub = {
      context: "vessels.self",
      subscribe: paths.map((p) => ({
        path: p,
        // Rev11: ease off from 500 ms/200 ms. The dashboard tiles do not
        // need to update faster than 1 Hz, and when several devices are
        // subscribed this halves the total delta traffic.
        period: 1000,
        format: "delta",
        policy: "instant",
        minPeriod: 500,
      })),
    };
    ws.send(JSON.stringify(sub));
  }

  function handleDelta(msg) {
    if (!msg || !Array.isArray(msg.updates)) return;
    let touchedGain = false;
    for (const u of msg.updates) {
      const values = u.values || [];
      for (const v of values) {
        state.values[v.path] = v.value;
        applyValue(v.path, v.value);
        if (v.path.startsWith("steering.autopilot.pypilot.gains.")) {
          touchedGain = true;
          const row = document.querySelector(`.gain-row[data-sk="${v.path}"]`);
          if (row) {
            const rng = row.querySelector("input[type=range]");
            const lbl = row.querySelector(".value");
            if (rng && !row.classList.contains("active")) rng.value = String(v.value);
            if (lbl) lbl.textContent = Number(v.value).toFixed(4);
          }
        }
      }
    }
    renderHeader();
    scheduleRenderControl();
    if (touchedGain && state.pilot && !document.querySelector(".gain-row")) {
      // First gain arrived before renderGains had been called (pilot came in
      // slightly later). Trigger a render now so the row appears.
      renderGains();
    }
  }

  function applyValue(path, value) {
    switch (path) {
      case "steering.autopilot.state":            state.apState = value; break;
      case "steering.autopilot.mode":             state.mode = value; setSelect("#mode-select", value); break;
      case "steering.autopilot.target":           state.target = numericOrNull(value); break;
      case "steering.autopilot.engaged":          state.engaged = !!value; renderEngage(); break;
      case "steering.autopilot.availableActions": state.availableActions = value || []; break;
      case "steering.autopilot.pypilot.availableModes":
        if (Array.isArray(value)) { state.modeList = value; fillSelect("#mode-select", value); }
        break;
      case "steering.autopilot.pypilot.pilot":
        state.pilot = value; setSelect("#pilot-select", value); renderGains();
        break;
      case "steering.autopilot.pypilot.availablePilots":
        if (Array.isArray(value)) { state.pilots = value; fillSelect("#pilot-select", value); setSelect("#pilot-select", state.pilot); }
        break;
      case "steering.autopilot.pypilot.profile":  state.profile = value; setSelect("#profile-select", value); break;
      case "steering.autopilot.pypilot.profiles":
        if (Array.isArray(value)) { state.profiles = value; fillSelect("#profile-select", value); }
        break;
      case "steering.autopilot.pypilot.tack.state":
        renderTackButton(value); break;
      case "navigation.headingMagnetic":
        state.heading = numericOrNull(value); break;
      case "steering.rudderAngle":
        renderRudder(numericOrNull(value)); break;
      case "environment.wind.angleApparent":
        state.windAngle = numericOrNull(value); break;
      case "environment.wind.speedApparent":
        state.windSpeed = numericOrNull(value); break;
      case "environment.wind.angleTrueWater":
      case "environment.wind.angleTrueGround":
        state.windAngleTrue = numericOrNull(value); break;
      case "environment.wind.speedTrue":
        state.windSpeedTrue = numericOrNull(value); break;
      case "navigation.speedOverGround":
        state.sog = numericOrNull(value); break;
    }
  }

  function numericOrNull(v) {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  // ---- Renderers ----
  function renderHeader() {
    // Header pills were removed in Rev10. Kept as no-op so the delta pipeline
    // can call renderHeader() without gating.
  }

  function renderControl() {
    $("#heading-value").textContent = fmtDeg(state.heading);
    $("#target-value").textContent  = fmtDeg(state.target);
    renderWindTile();
    renderSogTile();
    renderWindRose();
  }

  function renderWindTile() {
    // Show TWA/TWS when the AP is in a "true wind" mode; AWA/AWS otherwise.
    // Real B&G convention: negative angle = port side. We show absolute
    // value + a small direction glyph so the tile stays compact.
    const useTrue = String(state.mode || "").includes("true");
    const label = useTrue ? "TWA / TWS" : "AWA / AWS";
    const angleRad = useTrue ? state.windAngleTrue : state.windAngle;
    const speedMs  = useTrue ? state.windSpeedTrue : state.windSpeed;
    $("#wind-label").textContent = label;
    if (angleRad == null) {
      $("#wind-angle").textContent = "---";
    } else {
      const deg = angleRad * RAD2DEG;
      const abs = Math.abs(deg).toFixed(0);
      const side = deg < 0 ? "P " : (deg > 0 ? "S " : "");
      $("#wind-angle").textContent = side + abs;
    }
    $("#wind-speed").textContent = speedMs == null ? "--- kn" : (speedMs * 1.94384).toFixed(1) + " kn";
  }

  function renderSogTile() {
    if (state.sog == null) { $("#sog-value").textContent = "---"; return; }
    $("#sog-value").textContent = (state.sog * 1.94384).toFixed(1);
  }

  // SVG compass rose. The card (cardinals + ticks) rotates so N points to
  // magnetic north regardless of boat heading; the boat is fixed pointing up;
  // the wind arrow rotates independently to show relative wind angle; two
  // colored arcs mark the "sailing zones" at ~30-60 deg off wind on each side.
  function renderWindRose() {
    const useTrue = String(state.mode || "").includes("true");
    const windRad = useTrue ? state.windAngleTrue : state.windAngle;
    const windSpeed = useTrue ? state.windSpeedTrue : state.windSpeed;

    const card = document.getElementById("rose-card");
    if (card && state.heading != null) {
      card.setAttribute("transform", `rotate(${-state.heading * RAD2DEG})`);
    }

    const arrow = document.getElementById("rose-wind-arrow");
    if (arrow) {
      if (windRad != null) {
        arrow.setAttribute("transform", `rotate(${windRad * RAD2DEG})`);
        arrow.style.display = "";
      } else {
        arrow.style.display = "none";
      }
    }

    const star = document.getElementById("rose-star-sector");
    const port = document.getElementById("rose-port-sector");
    if (star && port) {
      if (windRad != null) {
        const wDeg = windRad * RAD2DEG;
        star.setAttribute("d", arcPath(wDeg + 30, wDeg + 60, 90));
        port.setAttribute("d", arcPath(wDeg - 60, wDeg - 30, 90));
        star.style.display = "";
        port.style.display = "";
      } else {
        star.style.display = "none";
        port.style.display = "none";
      }
    }

    const speedText = document.getElementById("rose-speed");
    if (speedText) {
      speedText.textContent = windSpeed == null ? "--- kn" : (windSpeed * 1.94384).toFixed(1) + " kn";
    }
  }

  // Build an SVG arc path from compass angle a1 to a2 (degrees). r is radius.
  function arcPath(a1, a2, r) {
    const t1 = a1 * Math.PI / 180;
    const t2 = a2 * Math.PI / 180;
    const x1 = r * Math.sin(t1);
    const y1 = -r * Math.cos(t1);
    const x2 = r * Math.sin(t2);
    const y2 = -r * Math.cos(t2);
    const delta = a2 - a1;
    const largeArc = Math.abs(delta) > 180 ? 1 : 0;
    const sweep = delta > 0 ? 1 : 0;
    return `M ${x1.toFixed(2)},${y1.toFixed(2)} A ${r},${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)},${y2.toFixed(2)}`;
  }

  function renderEngage() {
    const el = $("#engage-toggle");
    if (!el) return;
    if (state.engaged) el.classList.add("engaged");
    else el.classList.remove("engaged");
    el.setAttribute("aria-pressed", state.engaged ? "true" : "false");
    // The center button is only meaningful with a rudder sensor and disengaged.
    // Show it just when we KNOW there is a rudder source and we are disengaged.
    // For now default to hidden; it will be revealed later when we track
    // rudder.source properly.
  }

  function renderNudgeLabels() {
    const s = state.nudgeSmall;
    const b = state.nudgeBig;
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set("lbl-big-port",   "-" + b);
    set("lbl-small-port", "-" + s);
    set("lbl-small-star", "+" + s);
    set("lbl-big-star",   "+" + b);
  }

  function renderTackButton(tackState) {
    // Two per-side buttons now. If tack in progress, mark both as Cancel.
    const p = $("#tack-port-btn");
    const s = $("#tack-star-btn");
    if (!p || !s) return;
    const inProgress = tackState && tackState !== "none";
    for (const b of [p, s]) {
      if (inProgress) {
        b.classList.add("tack-active");
        b.querySelector(".lbl").textContent = "CANCEL";
        b.dataset.state = "cancel";
      } else {
        b.classList.remove("tack-active");
        b.querySelector(".lbl").textContent = "TACK";
        b.dataset.state = "tack";
      }
    }
  }

  function renderRudder(rad) {
    if (rad == null) { $("#rudder-widget").setAttribute("hidden", ""); return; }
    $("#rudder-widget").removeAttribute("hidden");
    const deg = rad * RAD2DEG;
    const pct = Math.max(-1, Math.min(1, deg / 45));
    const fill = $("#rudder-fill");
    fill.style.width = Math.abs(pct * 50) + "%";
    fill.style.transform = pct < 0 ? "translateX(-100%)" : "translateX(0%)";
    $("#rudder-value").textContent = deg.toFixed(1) + " deg";
  }

  function renderGains() {
    const cont = $("#gains-container");
    cont.textContent = "";
    const cat = state.catalog;
    const pilot = state.pilot;
    if (!pilot) return;
    // pypilot exposes gains as ap.pilot.<pilot>.<gain> (singular).
    const gains = Object.keys(cat).filter((k) =>
      k.startsWith(`ap.pilot.${pilot}.`) && cat[k].AutopilotGain
    );
    for (const g of gains) {
      const meta = cat[g];
      const shortName = g.split(".").slice(3).join(".");
      const skPath = `steering.autopilot.pypilot.gains.${pilot}.${shortName}`;
      const cur = state.values[skPath];
      const row = document.createElement("div");
      row.className = "gain-row";
      row.dataset.pypilot = g;
      row.dataset.sk = skPath;
      row.innerHTML =
        `<div class="name">${shortName}</div>` +
        `<input type="range" min="${meta.min}" max="${meta.max}" step="0.0001" value="${cur ?? 0}">` +
        `<div class="value">${cur == null ? "--" : Number(cur).toFixed(4)}</div>`;
      const rng = row.querySelector("input[type=range]");
      const val = row.querySelector(".value");
      rng.addEventListener("pointerdown", () => {
        document.body.classList.add("adjusting");
        row.classList.add("active");
      });
      rng.addEventListener("pointerup", () => {
        document.body.classList.remove("adjusting");
        row.classList.remove("active");
      });
      rng.addEventListener("input", () => {
        val.textContent = Number(rng.value).toFixed(4);
      });
      rng.addEventListener("change", () => {
        pluginRaw(g, Number(rng.value));
      });
      cont.appendChild(row);
      // If cache is empty (stream started after gain deltas were emitted),
      // fetch the current value via REST so the slider position reflects
      // reality on first paint.
      if (cur == null) {
        fetch(`/signalk/v1/api/vessels/self/${skPath.replace(/\./g, "/")}`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (!j) return;
            const v = j.value ?? (j.values && j.values.value);
            if (typeof v === "number") {
              state.values[skPath] = v;
              if (!row.classList.contains("active")) rng.value = String(v);
              val.textContent = v.toFixed(4);
            }
          })
          .catch(() => {});
      }
    }
  }

  function fillSelect(sel, list) {
    const el = $(sel);
    if (!el) return;
    const prev = el.value;
    el.textContent = "";
    for (const v of list) {
      const o = document.createElement("option");
      o.value = String(v); o.textContent = String(v);
      el.appendChild(o);
    }
    if (list.includes(prev)) el.value = prev;
  }

  function setSelect(sel, value) {
    const el = $(sel);
    if (el) el.value = String(value == null ? "" : value);
  }

  // ---- SK writes via Autopilot API v2 (registered by pypilot-autopilot-provider) ----
  //   GET  /signalk/v2/api/vessels/self/autopilots                     list + default
  //   POST /signalk/v2/api/vessels/self/autopilots/<id>/engage
  //   POST /signalk/v2/api/vessels/self/autopilots/<id>/disengage
  //   PUT  /signalk/v2/api/vessels/self/autopilots/<id>/mode           {"value":"compass"}
  //   PUT  /signalk/v2/api/vessels/self/autopilots/<id>/target         {"value":<rad>}
  //   POST /signalk/v2/api/vessels/self/autopilots/<id>/tack/{port|starboard}
  // All require SK auth (session cookie or token). If 401, show login banner.

  async function discoverAutopilot() {
    try {
      const res = await fetch("/signalk/v2/api/vessels/self/autopilots", { credentials: "include" });
      if (!res.ok) return;
      const j = await res.json();
      for (const [id, info] of Object.entries(j || {})) {
        if (info && info.isDefault) { state.autopilotId = id; break; }
      }
      // Fallback: first entry
      if (!state.autopilotId && j && Object.keys(j).length) {
        state.autopilotId = Object.keys(j)[0];
      }
    } catch (e) { console.warn("discoverAutopilot failed", e); }
  }

  // Banner policy (Rev12):
  //   - X dismiss remembered in sessionStorage for the tab lifetime.
  //   - Auto-hide 20 s after the LAST 401 if no new failure came in.
  //   - Any 2xx write hides it immediately.
  //   - Reads never show it; they can only hide it.
  //   - Console logs the failing URL so users can diagnose which endpoint.
  const DISMISS_KEY = "pypilot-newui.auth-dismissed";
  let _authHideTimer = null;
  function bannerDismissed() {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  }
  function scheduleBannerAutoHide() {
    if (_authHideTimer) clearTimeout(_authHideTimer);
    _authHideTimer = setTimeout(() => {
      const b = $("#auth-banner");
      if (b) b.setAttribute("hidden", "");
    }, 20000);
  }
  function showBanner(url) {
    if (bannerDismissed()) return;
    const b = $("#auth-banner");
    if (!b) return;
    b.removeAttribute("hidden");
    scheduleBannerAutoHide();
    if (url) console.warn("[pypilot-newui] auth 401 on:", url);
  }
  function hideBanner() {
    const b = $("#auth-banner");
    if (b) b.setAttribute("hidden", "");
    if (_authHideTimer) { clearTimeout(_authHideTimer); _authHideTimer = null; }
  }
  function handleAuthWrite(res) {
    if (!res) return res;
    if (res.status === 401) {
      state.authFailed = true;
      showBanner(res.url);
    } else if (res.status < 400) {
      state.authFailed = false;
      hideBanner();
    }
    return res;
  }
  function handleAuthRead(res) {
    if (!res) return res;
    if (res.status < 400) {
      state.authFailed = false;
      hideBanner();
    }
    return res;
  }
  const handleAuth = handleAuthWrite;

  async function apEngage() {
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/engage`;
    return handleAuth(await fetch(url, { method: "POST", credentials: "include" }));
  }
  async function apDisengage() {
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/disengage`;
    return handleAuth(await fetch(url, { method: "POST", credentials: "include" }));
  }
  async function apSetMode(mode) {
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/mode`;
    return handleAuth(await fetch(url, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: mode }),
    }));
  }
  async function apSetTargetRad(rad) {
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/target`;
    return handleAuth(await fetch(url, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: rad }),
    }));
  }
  async function apTack(direction) {
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/tack/${direction}`;
    return handleAuth(await fetch(url, { method: "POST", credentials: "include" }));
  }

  // For pypilot-specific paths that the Autopilot API does NOT cover (gains,
  // profiles, calibration, tack detail), route through our own /raw endpoint.
  async function pluginRaw(name, value) {
    const url = `/plugins/${PLUGIN_ID}/raw`;
    const res = await fetch(url, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value }),
    });
    handleAuth(res);
    if (!res.ok) console.warn("raw PUT failed", name, res.status, await res.text());
    return res;
  }

  // ---- Control tab wiring ----
  function wireControl() {
    // Nudges. Use a local accumulator like the pypilot upstream JS so quick
    // successive presses don't rubber-band against the server value.
    // Kinds: big-port (-nudgeBig), small-port (-nudgeSmall), small-star (+nudgeSmall), big-star (+nudgeBig).
    const kindToDelta = () => ({
      "big-port":   -state.nudgeBig,
      "small-port": -state.nudgeSmall,
      "small-star":  state.nudgeSmall,
      "big-star":    state.nudgeBig,
    });
    $$(".steer-btn[data-nudge-kind]").forEach((b) => {
      b.addEventListener("click", () => {
        const nudge = kindToDelta()[b.dataset.nudgeKind];
        if (nudge == null) return;
        const now = Date.now();
        if (!state.engaged) {
          b.animate([{ transform: "scale(1)" }, { transform: "scale(0.94)" }, { transform: "scale(1)" }], { duration: 180 });
          return;
        }
        if (now - state.lastNudgeTs > 1000 || state.localTargetRad == null) {
          state.localTargetRad = state.target ?? state.heading;
        }
        state.lastNudgeTs = now;
        const sign = String(state.mode || "").includes("wind") ? -1 : 1;
        const newTargetRad = (state.localTargetRad ?? 0) + sign * nudge * DEG2RAD;
        state.localTargetRad = newTargetRad;
        apSetTargetRad(newTargetRad);
      });
    });

    // Engage / disengage via Autopilot API v2.
    const eng = $("#engage-toggle");
    const doEngage = async () => {
      if (state.engaged) {
        await apDisengage();
      } else {
        // Snap target to current heading first so we don't spin the boat.
        if (state.heading != null) await apSetTargetRad(state.heading);
        await apEngage();
      }
    };
    eng.addEventListener("click", doEngage);
    eng.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doEngage(); }
    });

    // Mode change
    $("#mode-select").addEventListener("change", (e) => {
      apSetMode(e.target.value);
    });

    // Tack per side. If tack in progress, both act as Cancel.
    const tackHandler = (dir) => async () => {
      const st = $("#tack-port-btn").dataset.state;
      if (st === "cancel") {
        pluginRaw("ap.tack.state", "none");
      } else {
        apTack(dir);
      }
    };
    $("#tack-port-btn").addEventListener("click", tackHandler("port"));
    $("#tack-star-btn").addEventListener("click", tackHandler("starboard"));

    // Center rudder (disengaged only, hidden until we detect rudder.source)
    const centerBtn = $("#center-btn");
    if (centerBtn) centerBtn.addEventListener("click", () => pluginRaw("servo.position", 0));
  }

  // ---- Tune tab wiring ----
  function wireTune() {
    $("#pilot-select").addEventListener("change", (e) => {
      pluginRaw("ap.pilot", e.target.value);
    });
    $("#profile-select").addEventListener("change", (e) => {
      pluginRaw("profile", e.target.value);
    });
    $("#profile-add").addEventListener("click", async () => {
      const name = prompt("Profile name");
      if (!name) return;
      if (state.profiles.includes(name)) return alert("Already exists");
      await pluginRaw("profile", name);
    });
    $("#profile-remove").addEventListener("click", async () => {
      if (!confirm("Remove current profile?")) return;
      const remaining = state.profiles.filter((p) => p !== state.profile);
      await pluginRaw("profiles", remaining);
    });
    $("#cal-level").addEventListener("click", () => {
      pluginRaw("imu.alignmentCounter", 100);
    });
    $("#cal-heading-offset").addEventListener("change", (e) => {
      pluginRaw("imu.heading_offset", Number(e.target.value));
    });
    $("#cal-rud-centered").addEventListener("click", () => pluginRaw("rudder.calibration_state", "centered"));
    $("#cal-rud-port")    .addEventListener("click", () => pluginRaw("rudder.calibration_state", "port range"));
    $("#cal-rud-star")    .addEventListener("click", () => pluginRaw("rudder.calibration_state", "starboard range"));
    $("#cal-rud-reset")   .addEventListener("click", () => pluginRaw("rudder.calibration_state", "reset"));
    $("#cal-rud-range")   .addEventListener("change", (e) => pluginRaw("rudder.range", Number(e.target.value)));
  }

  // ---- Paths tab ----
  async function refreshPaths() {
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/paths`, { credentials: "include" });
      const j = await res.json();
      const tb = $("#paths-table tbody");
      tb.textContent = "";
      for (const it of (j.items || [])) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td class="path">${it.skPath}</td>` +
          `<td>${it.units || ""}</td>` +
          `<td class="put">${it.put ? "yes" : ""}</td>` +
          `<td><button class="copy" data-copy="${it.skPath}">Copy</button></td>`;
        tb.appendChild(tr);
      }
      tb.querySelectorAll("button.copy").forEach((b) => {
        b.addEventListener("click", () => {
          navigator.clipboard.writeText(b.dataset.copy);
          b.textContent = "Copied";
          setTimeout(() => (b.textContent = "Copy"), 800);
        });
      });
    } catch (e) {
      console.warn("paths fetch failed", e);
    }
  }

  // ---- Setup tab ----
  async function loadStatus() {
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/status`, { credentials: "include" });
      handleAuthRead(res);
      if (!res.ok) throw new Error("status " + res.status);
      const j = await res.json();
      $("#setup-status").textContent = JSON.stringify(j, null, 2);
      $("#rev-tag").textContent = `PyPilot New-UI ${j.revision || ""}`;
      if (typeof j.nudgeSmall === "number") state.nudgeSmall = j.nudgeSmall;
      if (typeof j.nudgeBig === "number")   state.nudgeBig   = j.nudgeBig;
      renderNudgeLabels();
      // Prefill the Setup tab nudge inputs
      const ns = $("#cfg-nudge-small"); if (ns) ns.value = String(state.nudgeSmall);
      const nb = $("#cfg-nudge-big");   if (nb) nb.value = String(state.nudgeBig);
      // Prefill host/port too
      if (typeof j.host === "string") { const h = $("#cfg-host"); if (h) h.value = j.host; }
      if (typeof j.port === "number") { const p = $("#cfg-port"); if (p) p.value = String(j.port); }
      // Prefill absorbProvider toggle
      const ab = $("#cfg-absorb"); if (ab) ab.checked = !!j.absorbProvider;
      if (j.host) {
        const a = $("#link-oldui-a");
        a.href = `http://${j.host}:${j.port}/`;
        a.textContent = `Classic pypilot UI ${j.host}:${j.port}`;
      }
    } catch (e) {
      $("#setup-status").textContent = "status endpoint unreachable";
    }
    try {
      const res2 = await fetch(`/plugins/${PLUGIN_ID}/catalog`, { credentials: "include" });
      handleAuthRead(res2);
      if (res2.ok) {
        state.catalog = await res2.json();
        renderGains();
      }
    } catch { /* ignore */ }
  }

  async function applyNudgeCfg() {
    const s = Number($("#cfg-nudge-small").value) || 1;
    const b = Number($("#cfg-nudge-big").value) || 10;
    // Pull the current full status so we preserve host/port/allowWrites etc.
    let cur = null;
    try {
      const r = await fetch(`/plugins/${PLUGIN_ID}/status`, { credentials: "include" });
      if (r.ok) cur = await r.json();
    } catch { /* fall through */ }
    const configuration = {
      host: cur?.host ?? "",
      port: cur?.port ?? 80,
      reconnectDelayMs: 3000,
      allowWrites: cur?.allowWrites ?? true,
      allowDirectServo: cur?.allowDirectServo ?? false,
      publishUnmapped: false,
      nudgeSmall: s,
      nudgeBig: b,
    };
    try {
      const res = await fetch(`/skServer/plugins/${PLUGIN_ID}/config`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, configuration }),
      });
      if (!res.ok) throw new Error(await res.text());
      state.nudgeSmall = s; state.nudgeBig = b;
      renderNudgeLabels();
      alert("Saved. Nudge values updated.");
    } catch (e) {
      alert("Save failed. Are you logged in to Signal K admin?\n" + e);
    }
  }

  async function scan() {
    $("#scan-results").textContent = "scanning...";
    const subnet = $("#scan-subnet").value.trim();
    const q = subnet ? `?subnet=${encodeURIComponent(subnet)}` : "";
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/scan${q}`, { credentials: "include" });
      const j = await res.json();
      const el = $("#scan-results");
      el.textContent = "";
      const hits = j.hits || [];
      if (!hits.length) { el.textContent = "no pypilot_web found"; return; }
      for (const h of hits) {
        const d = document.createElement("div");
        d.className = "scan-hit";
        d.innerHTML = `<span>${h.ip}:${h.port} (${h.hint})</span><button data-ip="${h.ip}" data-port="${h.port}">Use</button>`;
        d.querySelector("button").addEventListener("click", () => {
          $("#cfg-host").value = h.ip;
          $("#cfg-port").value = String(h.port);
        });
        el.appendChild(d);
      }
    } catch (e) {
      $("#scan-results").textContent = "scan failed";
    }
  }

  async function applyCfg() {
    const host = $("#cfg-host").value.trim();
    const port = Number($("#cfg-port").value) || 80;
    if (!host) return alert("Host required");
    try {
      const res = await fetch(`/skServer/plugins/${PLUGIN_ID}/config`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          configuration: {
            host,
            port,
            reconnectDelayMs: 3000,
            allowWrites: true,
            allowDirectServo: false,
            publishUnmapped: false,
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      alert("Config saved. Plugin restarting.");
      setTimeout(loadStatus, 3500);
    } catch (e) {
      alert("Config failed. Sign in to Signal K admin first.\n" + e);
    }
  }

  function wireSetup() {
    $("#scan-btn").addEventListener("click", scan);
    $("#cfg-apply").addEventListener("click", applyCfg);
    $("#paths-refresh").addEventListener("click", refreshPaths);
    const nb = $("#cfg-nudge-apply"); if (nb) nb.addEventListener("click", applyNudgeCfg);
    const p = $("#cli-pause"); if (p) p.addEventListener("click", async () => {
      const res = await fetch(`/plugins/${PLUGIN_ID}/pause`, { method: "POST", credentials: "include" });
      if (res.ok) alert("Paused. TinyPilot socket disconnected. Press Resume when ready.");
      else alert("Pause failed: " + res.status);
    });
    const r = $("#cli-resume"); if (r) r.addEventListener("click", async () => {
      const res = await fetch(`/plugins/${PLUGIN_ID}/resume`, { method: "POST", credentials: "include" });
      if (res.ok) alert("Resuming.");
      else alert("Resume failed: " + res.status);
    });
    const ab = $("#cfg-absorb-apply"); if (ab) ab.addEventListener("click", applyAbsorbCfg);
  }

  async function applyAbsorbCfg() {
    const absorbProvider = !!$("#cfg-absorb").checked;
    let cur = null;
    try {
      const r = await fetch(`/plugins/${PLUGIN_ID}/status`, { credentials: "include" });
      if (r.ok) cur = await r.json();
    } catch { /* fall through */ }
    const configuration = {
      host: cur?.host ?? "",
      port: cur?.port ?? 80,
      reconnectDelayMs: 3000,
      allowWrites: cur?.allowWrites ?? true,
      allowDirectServo: cur?.allowDirectServo ?? false,
      publishUnmapped: false,
      nudgeSmall: cur?.nudgeSmall ?? 1,
      nudgeBig: cur?.nudgeBig ?? 10,
      absorbProvider,
    };
    try {
      const res = await fetch(`/skServer/plugins/${PLUGIN_ID}/config`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, configuration }),
      });
      if (!res.ok) throw new Error(await res.text());
      alert(
        absorbProvider
          ? "Enabled AutopilotProvider. IMPORTANT: go to SK Admin and DISABLE the 'pypilot-autopilot-provider' plugin so they do not fight."
          : "Disabled AutopilotProvider. Re-enable 'pypilot-autopilot-provider' in SK Admin if you want WilhelmSK/freeboard to keep working."
      );
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      alert("Save failed. Are you logged in to Signal K admin?\n" + e);
    }
  }

  // ---- Tabs ----
  function wireTabs() {
    $$(".tab-btn").forEach((b) => {
      b.addEventListener("click", () => {
        $$(".tab-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        const id = b.dataset.tab;
        $$(".tab-panel").forEach((p) => p.classList.remove("active"));
        $(`#tab-${id}`).classList.add("active");
        if (id === "paths") refreshPaths();
        if (id === "setup") loadStatus();
      });
    });
  }

  // ---- Boot ----
  document.addEventListener("DOMContentLoaded", async () => {
    wireTabs();
    wireControl();
    wireTune();
    wireSetup();
    renderEngage();
    renderNudgeLabels();

    // Auth banner wiring (Rev12):
    //   - X remembers dismiss for the tab lifetime (sessionStorage)
    //   - "Ping" probes /plugins/<id>/status and hides on success
    const dismiss = $("#auth-banner-dismiss");
    if (dismiss) dismiss.addEventListener("click", () => {
      hideBanner();
      try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
    });
    const ping = $("#auth-banner-ping");
    if (ping) ping.addEventListener("click", async () => {
      const btn = ping;
      const orig = btn.textContent;
      btn.textContent = "...";
      try {
        const r = await fetch(`/plugins/${PLUGIN_ID}/status`, { credentials: "include" });
        if (r.ok) {
          try { sessionStorage.removeItem(DISMISS_KEY); } catch {}
          hideBanner();
          alert("Logged in - banner cleared.");
        } else {
          alert(`Still ${r.status}. Log in via the SK admin link.`);
        }
      } catch (e) {
        alert("Ping error: " + e);
      } finally {
        btn.textContent = orig;
      }
    });

    await discoverAutopilot();
    loadStatus();
    connectSK();
  });
})();
