import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { processGustRestores, GustRestore, GustIo } from "../gust-restore";

const D = "ap.pilot.basic.D";

function io(refuse = false) {
  const writes: Array<[string, unknown]> = [];
  const notes: string[] = [];
  const x: GustIo = {
    set: (p, v) => { writes.push([p, v]); return !refuse; },
    markGain() { /* */ }, markProfile() { /* */ },
    notify: (_id, m) => notes.push(m),
    debug() { /* */ },
  };
  return { x, writes, notes };
}

const pend = (): GustRestore => ({ pilot: "basic", profile: "A", path: D, value: 0.10, boosted: 0.12, lastSendTs: 0, awayNotified: false });

describe("gust restore (Rev577, GPT audit A01/A02)", () => {
  it("A01: profile switched to B whose D equals the boosted value: nothing written to B", () => {
    const t = io();
    const out = processGustRestores([pend()], null, { "ap.pilot": "basic", profile: "B", [D]: 0.12 }, 10_000, t.x);
    assert.deepEqual(t.writes, []);
    assert.equal(out.pending.length, 1, "kept for when A is active again");
    assert.match(t.notes[0], /restored when it is active again/);
  });

  it("restores A's D when A is active again", () => {
    const t = io();
    const p = [pend()];
    let out = processGustRestores(p, null, { "ap.pilot": "basic", profile: "B", [D]: 0.2 }, 10_000, t.x);
    out = processGustRestores(out.pending, null, { "ap.pilot": "basic", profile: "A", [D]: 0.12 }, 20_000, t.x);
    assert.deepEqual(t.writes, [[D, 0.10]]);
    assert.equal(out.pending.length, 1, "waits for the confirmation");
    out = processGustRestores(out.pending, null, { "ap.pilot": "basic", profile: "A", [D]: 0.10 }, 21_000, t.x);
    assert.equal(out.pending.length, 0);
    assert.match(t.notes[t.notes.length - 1], /D restored/);
  });

  it("A02: a refused write is not reported as restored and is retried after 5 s", () => {
    const t = io(true);
    const vals = { "ap.pilot": "basic", profile: "A", [D]: 0.12 };
    let out = processGustRestores([pend()], null, vals, 10_000, t.x);
    assert.equal(t.writes.length, 1);
    assert.ok(!t.notes.some((n) => /restored to pre-gust/.test(n)));
    out = processGustRestores(out.pending, null, vals, 12_000, t.x);
    assert.equal(t.writes.length, 1, "not before 5 s");
    out = processGustRestores(out.pending, null, vals, 15_100, t.x);
    assert.equal(t.writes.length, 2, "retried");
    assert.equal(out.pending.length, 1);
  });

  it("a manual change of D during the window wins", () => {
    const t = io();
    const out = processGustRestores([pend()], null, { "ap.pilot": "basic", profile: "A", [D]: 0.15 }, 10_000, t.x);
    assert.deepEqual(t.writes, []);
    assert.equal(out.pending.length, 0);
  });

  it("temp-heavy: switches back, retries, and respects a third choice", () => {
    const t = io(true);
    let out = processGustRestores([], { restore: "A", heavy: "H", lastSendTs: 0 }, { profile: "H" }, 10_000, t.x);
    assert.deepEqual(t.writes, [["profile", "A"]]);
    assert.ok(out.heavy, "kept after a refused write");
    out = processGustRestores([], out.heavy, { profile: "C" }, 20_000, t.x);
    assert.equal(out.heavy, null);
    assert.equal(t.writes.length, 1);
  });
});
