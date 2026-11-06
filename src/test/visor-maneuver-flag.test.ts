// Rev630 (sea trial 2026-11-05): closing the Empopado summary by hand left
// the visor renewing "manoeuvre active" every 20 s for the rest of the
// session (AUTOWIND blocked, three steering alarms silenced). These tests
// run the visor's own functions, taken from public/app.js, with fake
// timers and a fake fetch.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const APP = fs.readFileSync(path.join(__dirname, "..", "..", "public", "app.js"), "utf8");

/** Source of `function name(...) {...}` from app.js, by brace matching. */
function fnSource(name: string): string {
  let start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in app.js`);
  if (APP.slice(start - 6, start) === "async ") start -= 6;
  let i = APP.indexOf("{", start);
  let depth = 0;
  for (; i < APP.length; i++) {
    if (APP[i] === "{") depth++;
    else if (APP[i] === "}" && --depth === 0) break;
  }
  return APP.slice(start, i + 1);
}

interface Visor {
  ctx: any;
  posts: Array<{ active: boolean; id?: string }>;
  tick: () => void;   // runs every live interval once (= 20 s later)
  liveIntervals: () => number;
}

function loadVisor(): Visor {
  const posts: Array<{ active: boolean; id?: string }> = [];
  const intervals = new Map<number, () => void>();
  let next = 1;
  const ctx: any = {
    state: { aproado: null, empopado: null },
    PLUGIN_ID: "signalk-pypilot-newui",
    skFetch: (_url: string, opts: any) => { posts.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true }); },
    setInterval: (fn: () => void) => { const h = next++; intervals.set(h, fn); return h; },
    clearInterval: (h: number) => { intervals.delete(h); },
    setTimeout: () => 0,
    clearTimeout: () => {},
    hideEmpopadoHud: () => {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext([
    "let _maneuverPseudoTimer = null;",
    "let _maneuverPseudoId = null;",
    fnSource("_pseudoManeuverRunning"),
    fnSource("_setManeuverPseudo"),
    fnSource("_postManeuverPseudo"),
    fnSource("empopadoClose"),
  ].join("\n"), ctx);
  return {
    ctx, posts,
    tick: () => { for (const fn of [...intervals.values()]) fn(); },
    liveIntervals: () => intervals.size,
  };
}

describe("visor manoeuvre flag (Rev630)", () => {
  it("closing the Empopado summary by hand stops the renewal", () => {
    const v = loadVisor();
    const ap = { id: "emp-1", phase: "transit" };
    v.ctx.state.empopado = ap;
    v.ctx._setManeuverPseudo(true, ap.id);
    v.tick();
    assert.deepEqual(v.posts.map((p) => p.active), [true, true]);
    ap.phase = "summary";             // empopadoFinish
    v.ctx.empopadoClose();            // the summary's close button
    assert.equal(v.ctx.state.empopado, null);
    assert.equal(v.liveIntervals(), 0);
    v.tick();
    assert.deepEqual(v.posts.map((p) => p.active), [true, true, false]);
    assert.equal(v.posts[2].id, "emp-1");
  });

  it("a renewal whose manoeuvre is gone switches the flag off by itself", () => {
    const v = loadVisor();
    v.ctx.state.empopado = { id: "emp-1", phase: "active" };
    v.ctx._setManeuverPseudo(true, "emp-1");
    v.ctx.state.empopado = null;      // any path that forgets the close
    v.tick();
    assert.deepEqual(v.posts.map((p) => p.active), [true, false]);
    assert.equal(v.liveIntervals(), 0);
  });

  it("a renewal stops once the manoeuvre is in its summary", () => {
    const v = loadVisor();
    const ap = { id: "emp-1", phase: "active" };
    v.ctx.state.empopado = ap;
    v.ctx._setManeuverPseudo(true, ap.id);
    ap.phase = "summary";
    v.tick();
    assert.deepEqual(v.posts.map((p) => p.active), [true, false]);
  });

  it("ending one manoeuvre does not clear the flag of another, but ends its own entry", () => {
    const v = loadVisor();
    v.ctx.state.aproado = { id: "apr-2", phase: "transit" };
    v.ctx._setManeuverPseudo(true, "apr-2");
    v.ctx._setManeuverPseudo(false, "emp-1");
    assert.equal(v.liveIntervals(), 1);
    assert.deepEqual(v.posts.map((p) => [p.active, p.id]), [[true, "apr-2"], [false, "emp-1"]]);
  });

  it("the mode selector ends a running or summary manoeuvre before AUTOWIND", () => {
    const handler = APP.slice(APP.indexOf('$("#mode-select").addEventListener("change"'));
    const end = handler.indexOf('if (chosen === "autowind")');
    assert.ok(end > 0);
    const before = handler.slice(0, end);
    assert.match(before, /empopadoTearDown\(\{ restoreAll: false \}\)/);
    assert.match(before, /empopadoClose\(\)/);
    assert.match(before, /aproadoTearDown\(\)/);
  });

  it("Rev633: choosing Aproado ends an Empopado (and vice versa)", () => {
    const handler = APP.slice(APP.indexOf('$("#mode-select").addEventListener("change"'));
    const before = handler.slice(0, handler.indexOf('if (chosen === "autowind")'));
    assert.match(before, /if \(chosen !== "empopado"\) \{[\s\S]*?empopadoTearDown/);
    assert.match(before, /if \(chosen !== "aproado"\) \{[\s\S]*?aproadoTearDown/);
  });
});

// Rev633 (GPT re-audit 2026-11-06 R04/R05): Empopado's temporary gains.
interface Deferred { resolve: () => void }
function loadHotGains() {
  const writes: Array<{ path: string; val: number }> = [];
  const pending: Deferred[] = [];
  const ctx: any = {
    state: {
      empopado: null, profile: "HEAVY", pilot: "basic", catalog: {},
      pypilotValues: { "ap.pilot.basic.P": 0.1, "ap.pilot.basic.D": 0.2, "servo.max_slew_speed": 10 },
    },
    EMPOPADO_HOT_GAIN_MULT: { P: 1.5, D: 1.7, SLEW: 1.3 },
    pluginRaw: (path: string, val: number) => {
      writes.push({ path, val });
      return new Promise<any>((r) => pending.push({ resolve: () => r({ ok: true }) }));
    },
    _empopadoSetHotBadge: () => {},
    console: { info: () => {}, warn: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext([
    fnSource("_empopadoHotGainsOwned"),
    fnSource("_empopadoApplyHotGains"),
    fnSource("_empopadoRestoreHotGains"),
  ].join("\n"), ctx);
  const flush = () => new Promise<void>((r) => setImmediate(r));
  const answer = async () => { const d = pending.shift(); if (d) d.resolve(); await flush(); };
  return { ctx, writes, answer, flush };
}

describe("Empopado temporary gains (Rev633)", () => {
  it("no gain is raised after the manoeuvre ended; the one already sent is restored", async () => {
    const h = loadHotGains();
    const ap: any = { id: "emp-1", phase: "active" };
    h.ctx.state.empopado = ap;
    const applying = h.ctx._empopadoApplyHotGains(ap);
    await h.flush();                        // P x1.5 sent, answer pending
    h.ctx.state.empopado = null;            // the sailor leaves
    const restoring = h.ctx._empopadoRestoreHotGains(ap);
    await h.flush();                        // P restore sent
    await h.answer();                       // the raise answers
    await h.answer();                       // the restore answers
    await applying; await restoring;
    assert.deepEqual(h.writes.map((w) => [w.path, +w.val.toFixed(3)]),
      [["ap.pilot.basic.P", 0.15], ["ap.pilot.basic.P", 0.1]]);
  });

  it("an old gain is never written into a profile chosen meanwhile", async () => {
    const h = loadHotGains();
    const ap: any = {
      id: "emp-1", phase: "active", _hotGainProfile: "HEAVY",
      _hotGainSnapshot: { "ap.pilot.basic.P": 0.1, "ap.pilot.basic.D": 0.2 },
    };
    const restoring = h.ctx._empopadoRestoreHotGains(ap);
    await h.flush();                        // P restore sent
    h.ctx.state.profile = "NEW";            // profile changed and known
    await h.answer();
    await restoring;
    assert.deepEqual(h.writes.map((w) => w.path), ["ap.pilot.basic.P"]);
  });
});

describe("manoeuvre left from another device (Rev634)", () => {
  function load() {
    const calls: string[] = [];
    const timers: Array<() => void> = [];
    const ctx: any = {
      state: { empopado: null, aproado: null, mode: "compass", engaged: true },
      empopadoTearDown: () => { calls.push("empopadoTearDown"); ctx.state.empopado = null; },
      aproadoTearDown: () => { calls.push("aproadoTearDown"); ctx.state.aproado = null; },
      setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
      clearTimeout: () => {},
      console: { info: () => {} },
    };
    vm.createContext(ctx);
    vm.runInContext(["const MANEUVER_AP_OFF_GRACE_MS = 3000;", fnSource("_endLocalManeuverIfLeft"), fnSource("_endManeuverHere")].join("\n"), ctx);
    const elapse = () => { for (const fn of timers.splice(0)) fn(); };   // = 3 s later
    return { ctx, calls, elapse };
  }

  it("does not end an Empopado still on its way into true wind", () => {
    const { ctx, calls } = load();
    ctx.state.empopado = { id: "emp-1", phase: "transit" };
    ctx.state.mode = "compass";
    ctx._endLocalManeuverIfLeft();
    assert.deepEqual(calls, []);
  });

  it("ends it here when another device takes pypilot out of true wind", () => {
    const { ctx, calls } = load();
    ctx.state.empopado = { id: "emp-1", phase: "active" };
    ctx.state.mode = "true wind";
    ctx._endLocalManeuverIfLeft();            // reached its mode
    ctx.state.mode = "compass";               // the tablet chose compass
    ctx._endLocalManeuverIfLeft();
    assert.deepEqual(calls, ["empopadoTearDown"]);
  });

  it("ends an Aproado when the AP is taken off from outside and stays off 3 s", () => {
    const { ctx, calls, elapse } = load();
    ctx.state.aproado = { id: "apr-1", phase: "active" };
    ctx.state.mode = "wind";
    ctx._endLocalManeuverIfLeft();
    ctx.state.engaged = false;
    ctx._endLocalManeuverIfLeft();
    assert.deepEqual(calls, [], "not at once");
    elapse();
    assert.deepEqual(calls, ["aproadoTearDown"]);
  });

  it("Rev635: the stuck-pilot recovery (AP off and on within a second) does not end it", () => {
    const { ctx, calls, elapse } = load();
    ctx.state.empopado = { id: "emp-1", phase: "transit" };
    ctx.state.mode = "true wind";
    ctx._endLocalManeuverIfLeft();
    ctx.state.engaged = false;
    ctx._endLocalManeuverIfLeft();
    ctx.state.engaged = true;
    ctx._endLocalManeuverIfLeft();
    elapse();
    assert.deepEqual(calls, []);
  });
});
