// Rev518: AUTOWIND decision logic.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";
import { AutowindDecider, desiredSubMode, AutowindInput, freshNumber } from "../autowind";

const inp = (o: Partial<AutowindInput>): AutowindInput => ({
  nowMs: 0, twaDeg: 90, mode: "wind", engaged: true, blocked: false, twsKn: 10, ...o,
});

function feed(d: AutowindDecider, t0: number, secs: number, o: (s: number) => Partial<AutowindInput>) {
  const out: Array<{ s: number; m: string }> = [];
  for (let s = 0; s < secs; s++) {
    const r = d.tick(inp({ nowMs: t0 + s * 1000, ...o(s) }));
    if (r) out.push({ s, m: r });
  }
  return out;
}

describe("Rev532: TWA from a 0..360 source", () => {
  it("330 (30 to port) is close-hauled, 200 (160 to port) is downwind", () => {
    assert.equal(desiredSubMode(330), "wind");
    assert.equal(desiredSubMode(200), "true wind");
  });
});

describe("autowind (Rev518)", () => {
  it("120 deg threshold with +-5 hysteresis, signed TWA", () => {
    assert.equal(desiredSubMode(130), "true wind");
    assert.equal(desiredSubMode(-140), "true wind");
    assert.equal(desiredSubMode(110), "wind");
    assert.equal(desiredSubMode(-60), "wind");
    assert.equal(desiredSubMode(120), null);
    assert.equal(desiredSubMode(124), null);
  });

  it("bears away past 125: switches to true wind after 10 s", () => {
    const d = new AutowindDecider();
    const out = feed(d, 0, 15, () => ({ twaDeg: 140 }));
    assert.deepEqual(out, [{ s: 10, m: "true wind" }]);
  });

  it("a short excursion (gust, wave) does not switch", () => {
    const d = new AutowindDecider();
    const out = feed(d, 0, 30, (s) => ({ twaDeg: s % 8 < 6 ? 140 : 100 }));
    assert.equal(out.length, 0);
  });

  it("no flapping: at most one switch per 30 s", () => {
    const d = new AutowindDecider();
    let mode = "wind";
    const switches: number[] = [];
    for (let s = 0; s < 60; s++) {
      const twa = s < 12 ? 140 : 100;   // bears away, then heads up again
      const r = d.tick(inp({ nowMs: s * 1000, twaDeg: twa, mode }));
      if (r) { switches.push(s); mode = r; d.noteSwitch(s * 1000); }
    }
    assert.deepEqual(switches, [10, 40]);
  });

  it("Rev630: a failed switch does not use up the 30 s gap; it retries 10 s later", () => {
    const d = new AutowindDecider();
    const asks: number[] = [];
    for (let s = 0; s < 40; s++) {
      const r = d.tick(inp({ nowMs: s * 1000, twaDeg: 150, mode: "wind" }));
      if (r) { asks.push(s); d.noteFailure(s * 1000); }
    }
    // sustain 10 s, then one ask per (10 s sustain >= 10 s retry) - never 30 s apart
    assert.deepEqual(asks, [10, 21, 32]);
  });

  it("Rev630: a switch that succeeds after a failure starts the normal 30 s gap", () => {
    const d = new AutowindDecider();
    let mode = "wind";
    const asks: number[] = [];
    for (let s = 0; s < 60; s++) {
      const twa = s < 25 ? 150 : 100;
      const r = d.tick(inp({ nowMs: s * 1000, twaDeg: twa, mode }));
      if (!r) continue;
      asks.push(s);
      if (asks.length === 1) d.noteFailure(s * 1000);
      else { mode = r; d.noteSwitch(s * 1000); }
    }
    assert.deepEqual(asks, [10, 21, 51]);
  });

  it("never while blocked (tack, aproado)", () => {
    const d = new AutowindDecider();
    assert.equal(feed(d, 0, 20, () => ({ twaDeg: 150, blocked: true })).length, 0);
  });

  it("Rev521: switches with the AP off too, so engaging lands in the right mode", () => {
    const d = new AutowindDecider();
    assert.deepEqual(feed(d, 0, 15, () => ({ twaDeg: 150, engaged: false })), [{ s: 10, m: "true wind" }]);
  });

  it("Rev521: never below 3 kn TWS or with TWS unknown (berth noise)", () => {
    const d = new AutowindDecider();
    assert.equal(feed(d, 0, 20, () => ({ twaDeg: 150, twsKn: 0.3 })).length, 0);
    assert.equal(feed(d, 20_000, 20, () => ({ twaDeg: 150, twsKn: null })).length, 0);
  });

  it("already in the right mode: nothing to do", () => {
    const d = new AutowindDecider();
    assert.equal(feed(d, 0, 20, () => ({ twaDeg: 150, mode: "true wind" })).length, 0);
  });

  it("initial(): picks the side without waiting", () => {
    const d = new AutowindDecider();
    assert.equal(d.initial(150), "true wind");
    assert.equal(d.initial(-60), "wind");
    assert.equal(d.initial(null), "wind");
  });
});

describe("Rev632: data age and gaps", () => {
  it("two readings 60 s apart are not 10 s sustained", () => {
    const d = new AutowindDecider();
    assert.equal(d.tick(inp({ nowMs: 0, twaDeg: 150 })), null);
    assert.equal(d.tick(inp({ nowMs: 60_000, twaDeg: 150 })), null);
    // the count restarted at 60 s: 10 s of 1 Hz input from there
    const out = feed(d, 61_000, 12, () => ({ twaDeg: 150 }));
    assert.deepEqual(out, [{ s: 9, m: "true wind" }]);
  });

  it("freshNumber: young value yes; old, undated, future or non-numeric no", () => {
    const now = Date.parse("2026-11-05T16:52:00Z");
    const at = (ms: number) => new Date(now - ms).toISOString();
    assert.equal(freshNumber({ value: 1.2, timestamp: at(2000) }, now), 1.2);
    assert.equal(freshNumber({ value: 1.2, timestamp: at(11_000) }, now), null);
    assert.equal(freshNumber({ value: 1.2 }, now), null);
    assert.equal(freshNumber({ value: 1.2, timestamp: at(-20_000) }, now), null);
    assert.equal(freshNumber({ value: null, timestamp: at(0) }, now), null);
    assert.equal(freshNumber(undefined, now), null);
  });
});

describe("Rev632: replay of the 2026-11-05 sea trial (17:51:25-17:53:33)", () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "src", "test", "fixtures-autowind-2026-11-05.json"), "utf8"));
  const toMs = (hms: string) => { const [h, m, s] = hms.split(":").map(Number); return ((h * 60 + m) * 60 + s) * 1000; };
  const run = (blocked: boolean) => {
    const d = new AutowindDecider();
    d.noteSwitch(toMs("17:51:24"));          // AUTOWIND selected -> true wind
    let mode = "true wind";
    for (const [t, , twa, tws] of fx.rows as Array<[string, string, number, number]>) {
      const r = d.tick(inp({ nowMs: toMs(t), twaDeg: twa, twsKn: tws, mode, blocked }));
      if (r) { d.noteSwitch(toMs(t)); mode = r; return { t, r }; }
    }
    return null;
  };

  it("with no manoeuvre running it switches to apparent at 17:52:02", () => {
    assert.deepEqual(run(false), { t: "17:52:02", r: "wind" });
  });

  it("with a manoeuvre really running it does not switch", () => {
    assert.equal(run(true), null);
  });
});
