// Rev518: AUTOWIND decision logic.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AutowindDecider, desiredSubMode, AutowindInput } from "../autowind";

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
      if (r) { switches.push(s); mode = r; }
    }
    assert.deepEqual(switches, [10, 40]);
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
