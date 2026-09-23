import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RollFeedForward } from "../roll-ff";

const DEG = Math.PI / 180;

/** Base sample with sensible defaults; overrides fill in test-specific fields. */
function s(overrides: {
  ts: number;
  heel?: number | null;
  twa?: number | null;
  engaged?: boolean;
}) {
  return {
    ts: overrides.ts,
    heel: overrides.heel ?? null,
    twa: overrides.twa ?? null,
    engaged: overrides.engaged ?? true,
  };
}

describe("RollFeedForward — envelope", () => {
  it("returns 0 when gain <= 0 regardless of input", () => {
    const ff = new RollFeedForward({ gain: 0 });
    for (let i = 0; i < 10; i += 1) {
      const out = ff.compute(s({ ts: i * 1000, heel: 5 * DEG * Math.sin(i), twa: 150 * DEG }));
      assert.equal(out, 0);
    }
  });

  it("returns 0 when the AP is not engaged", () => {
    const ff = new RollFeedForward({ gain: 0.3 });
    const out = ff.compute(s({ ts: 0, heel: 10 * DEG, twa: 150 * DEG, engaged: false }));
    assert.equal(out, 0);
  });

  it("returns 0 when |TWA| ≤ twaGateDeg", () => {
    const ff = new RollFeedForward({ gain: 0.3, twaGateDeg: 90 });
    for (let i = 0; i < 5; i += 1) {
      ff.compute(s({ ts: i * 1000, heel: 5 * DEG, twa: 60 * DEG }));
    }
    // Now feed a big roll on beam reach and still expect 0.
    const out = ff.compute(s({ ts: 6000, heel: 15 * DEG, twa: 60 * DEG }));
    assert.equal(out, 0);
  });

  it("returns 0 when TWA is missing (safety)", () => {
    const ff = new RollFeedForward({ gain: 0.3 });
    const out = ff.compute(s({ ts: 0, heel: 10 * DEG, twa: null }));
    assert.equal(out, 0);
  });

  it("returns 0 on the first sample (seed only)", () => {
    const ff = new RollFeedForward({ gain: 0.5 });
    const out = ff.compute(s({ ts: 0, heel: 5 * DEG, twa: 150 * DEG }));
    assert.equal(out, 0);
  });
});

describe("RollFeedForward — steady-state behaviour", () => {
  it("converges to ~0 output for a constant heel (HPF removes the mean)", () => {
    const ff = new RollFeedForward({ gain: 0.5, tauSec: 3 });
    // Feed a constant 12° heel for 60 s at 1 Hz.
    let out = 0;
    for (let i = 0; i < 60; i += 1) {
      out = ff.compute(s({ ts: i * 1000, heel: 12 * DEG, twa: 150 * DEG }));
    }
    assert.ok(Math.abs(out) < 0.001,
      `steady-state output=${out} should be ~0`);
  });

  it("produces opposite-sign delta from a positive roll bump", () => {
    const ff = new RollFeedForward({ gain: 0.5, tauSec: 3 });
    // Bootstrap with zero heel.
    for (let i = 0; i < 5; i += 1) {
      ff.compute(s({ ts: i * 1000, heel: 0, twa: 150 * DEG }));
    }
    // Then a sudden +15° heel bump.
    const out = ff.compute(s({ ts: 5000, heel: 15 * DEG, twa: 150 * DEG }));
    assert.ok(out < 0, `roll +15° should produce negative delta; got ${out}`);
    // And a symmetric −15° bump produces positive delta.
    const ff2 = new RollFeedForward({ gain: 0.5, tauSec: 3 });
    for (let i = 0; i < 5; i += 1) ff2.compute(s({ ts: i * 1000, heel: 0, twa: 150 * DEG }));
    const out2 = ff2.compute(s({ ts: 5000, heel: -15 * DEG, twa: 150 * DEG }));
    assert.ok(out2 > 0, `roll −15° should produce positive delta; got ${out2}`);
  });

  it("clamps the output to ±maxDeltaRad", () => {
    const ff = new RollFeedForward({ gain: 10, tauSec: 5, maxDeltaRad: 5 * DEG });
    ff.compute(s({ ts: 0, heel: 0, twa: 150 * DEG }));
    // Big heel bump so an unclamped output would exceed the limit.
    const out = ff.compute(s({ ts: 1000, heel: 30 * DEG, twa: 150 * DEG }));
    assert.ok(Math.abs(out) <= 5 * DEG + 1e-9, `clamp violated: out=${out}`);
  });
});

describe("RollFeedForward — reset & update", () => {
  it("reset() drops HP state so a re-enable starts fresh", () => {
    const ff = new RollFeedForward({ gain: 0.5, tauSec: 3 });
    ff.compute(s({ ts: 0, heel: 0, twa: 150 * DEG }));
    const out1 = ff.compute(s({ ts: 1000, heel: 20 * DEG, twa: 150 * DEG }));
    assert.notEqual(out1, 0);
    ff.reset();
    // After reset, feeding the same bump again should give first-sample=0.
    const out2 = ff.compute(s({ ts: 5000, heel: 20 * DEG, twa: 150 * DEG }));
    assert.equal(out2, 0);
  });

  it("update({gain: 0}) turns the FF off and resets", () => {
    const ff = new RollFeedForward({ gain: 0.5, tauSec: 3 });
    ff.compute(s({ ts: 0, heel: 0, twa: 150 * DEG }));
    ff.compute(s({ ts: 1000, heel: 20 * DEG, twa: 150 * DEG }));
    ff.update({ gain: 0 });
    const out = ff.compute(s({ ts: 2000, heel: 25 * DEG, twa: 150 * DEG }));
    assert.equal(out, 0);
  });
});
