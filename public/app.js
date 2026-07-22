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
      // Heading (from pypilot plugin) + rudder + wind
      "navigation.headingMagnetic",
      "steering.rudderAngle",
      "environment.wind.angleApparent",
      "environment.wind.speedApparent",
    ];
    const sub = {
      context: "vessels.self",
      subscribe: paths.map((p) => ({
        path: p,
        period: 500,
        format: "delta",
        policy: "instant",
        minPeriod: 200,
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
    renderControl();
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
    }
  }

  function numericOrNull(v) {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  // ---- Renderers ----
  function renderHeader() {
    const pill = $("#state-pill");
    pill.dataset.state = state.apState || "unknown";
    $("#state-text").textContent = String(state.apState || "--").toUpperCase();
    $("#mode-text").textContent  = state.mode || "--";
    $("#wind-angle").textContent = state.windAngle == null ? "--" : fmtDeg(state.windAngle) + " deg";
    $("#wind-speed").textContent = state.windSpeed == null ? "" : (state.windSpeed * 1.94384).toFixed(1) + " kn";
  }

  function renderControl() {
    $("#heading-value").textContent = fmtDeg(state.heading);
    $("#target-value").textContent  = fmtDeg(state.target);
  }

  function renderEngage() {
    const el = $("#engage-toggle");
    if (state.engaged) el.classList.add("engaged");
    else el.classList.remove("engaged");
    el.setAttribute("aria-pressed", state.engaged ? "true" : "false");
    // Steer button labels in engaged vs disengaged mode
    if (state.engaged) {
      $$(".steer-btn.center")[0]?.setAttribute("hidden", "");
      const l = { "-10": "10", "-1": "1", "1": "1", "10": "10" };
      $$(".steer-btn[data-nudge]").forEach((b) => {
        const n = b.dataset.nudge;
        b.querySelector(".lbl").textContent = (n < 0 ? "-" : "+") + l[n];
      });
    } else {
      $$(".steer-btn.center")[0]?.removeAttribute("hidden");
      const l = { "-10": "<<", "-1": "<", "1": ">", "10": ">>" };
      $$(".steer-btn[data-nudge]").forEach((b) => {
        b.querySelector(".lbl").textContent = l[b.dataset.nudge];
      });
    }
  }

  function renderTackButton(tackState) {
    const btn = $("#tack-btn");
    if (tackState && tackState !== "none") {
      btn.classList.add("tack-active");
      btn.textContent = "Cancel";
      btn.dataset.state = "cancel";
    } else {
      btn.classList.remove("tack-active");
      btn.textContent = "Tack";
      btn.dataset.state = "tack";
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

  function handleAuth(res) {
    if (res && res.status === 401) {
      state.authFailed = true;
      const b = $("#auth-banner");
      if (b) b.removeAttribute("hidden");
    }
    return res;
  }

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
    $$(".steer-btn[data-nudge]").forEach((b) => {
      b.addEventListener("click", () => {
        const nudge = Number(b.dataset.nudge);
        const now = Date.now();
        // Nudges only make sense when engaged (they change target). We still
        // allow the click and just no-op with a subtle visual to teach the user.
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

    // Tack via Autopilot API v2 (POST /autopilots/<id>/tack/{port|starboard})
    $("#tack-btn").addEventListener("click", async () => {
      const st = $("#tack-btn").dataset.state;
      if (st === "cancel") {
        pluginRaw("ap.tack.state", "none");
      } else {
        // Default starboard; UI to pick side comes in a later rev.
        apTack("starboard");
      }
    });
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
      const j = await res.json();
      state.catalog = j; // used by header rev tag; catalog is fetched below
      $("#setup-status").textContent = JSON.stringify(j, null, 2);
      $("#rev-tag").textContent = `PyPilot New-UI ${j.revision || ""}`;
      // link to classic UI (still available)
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
      state.catalog = await res2.json();
      renderGains();
    } catch { /* ignore */ }
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

    // Dismiss for the auth banner.
    const dismiss = $("#auth-banner-dismiss");
    if (dismiss) dismiss.addEventListener("click", () => $("#auth-banner").setAttribute("hidden", ""));

    await discoverAutopilot();
    loadStatus();
    connectSK();
  });
})();
