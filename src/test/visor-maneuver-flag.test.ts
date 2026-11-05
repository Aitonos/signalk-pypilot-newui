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
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in app.js`);
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

  it("ending one manoeuvre does not clear the flag of another", () => {
    const v = loadVisor();
    v.ctx.state.aproado = { id: "apr-2", phase: "transit" };
    v.ctx._setManeuverPseudo(true, "apr-2");
    v.ctx._setManeuverPseudo(false, "emp-1");
    assert.equal(v.liveIntervals(), 1);
    assert.deepEqual(v.posts.map((p) => p.active), [true]);
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
});
