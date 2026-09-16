import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeGains,
  roundGains,
  validateKnobs,
  validateBaseline,
  NEUTRAL_KNOBS,
  MIN_FACTOR,
  MAX_FACTOR,
  type GainSet,
  type TuningKnobs,
} from "../tuning-knobs";

/** Reference boat baseline pulled from a real pypilot install. */
const BASELINE: GainSet = { P: 0.003, I: 0.02, D: 0.09, DD: 0.02 };

function approx(actual: number, expected: number, tol = 1e-9, msg = ""): void {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${msg} expected ${expected}, got ${actual} (|Δ|=${Math.abs(actual - expected)})`);
}

describe("tuning-knobs — identity invariant", () => {
  it("neutral knobs (50,0,0) return the baseline exactly", () => {
    const g = computeGains(BASELINE, NEUTRAL_KNOBS);
    approx(g.P,  BASELINE.P,  1e-12, "P");
    approx(g.I,  BASELINE.I,  1e-12, "I");
    approx(g.D,  BASELINE.D,  1e-12, "D");
    approx(g.DD, BASELINE.DD, 1e-12, "DD");
  });

  it("zero baseline stays zero regardless of knobs", () => {
    const zero = { P: 0, I: 0, D: 0, DD: 0 };
    for (const knobs of [
      NEUTRAL_KNOBS,
      { aggressivity: 100, understeerOversteer:  100, balanceHeadingRate:  100 },
      { aggressivity:   0, understeerOversteer: -100, balanceHeadingRate: -100 },
      { aggressivity:  73, understeerOversteer:  -42, balanceHeadingRate:   19 },
    ]) {
      const g = computeGains(zero, knobs);
      approx(g.P, 0, 1e-15, "P");
      approx(g.I, 0, 1e-15, "I");
      approx(g.D, 0, 1e-15, "D");
      approx(g.DD, 0, 1e-15, "DD");
    }
  });
});

describe("tuning-knobs — aggressivity axis", () => {
  it("aggressivity=0 gives P and D at 0.5×baseline (others unchanged)", () => {
    const g = computeGains(BASELINE, { aggressivity: 0, understeerOversteer: 0, balanceHeadingRate: 0 });
    approx(g.P, BASELINE.P * 0.5, 1e-9, "P");
    approx(g.D, BASELINE.D * 0.5, 1e-9, "D");
    approx(g.I, BASELINE.I, 1e-12, "I unchanged");
    approx(g.DD, BASELINE.DD, 1e-12, "DD unchanged");
  });

  it("aggressivity=100 gives P and D at 1.5×baseline", () => {
    const g = computeGains(BASELINE, { aggressivity: 100, understeerOversteer: 0, balanceHeadingRate: 0 });
    approx(g.P, BASELINE.P * 1.5, 1e-9, "P");
    approx(g.D, BASELINE.D * 1.5, 1e-9, "D");
    approx(g.I, BASELINE.I, 1e-12, "I unchanged");
    approx(g.DD, BASELINE.DD, 1e-12, "DD unchanged");
  });

  it("P and D are strictly monotonic in aggressivity", () => {
    let prevP = -Infinity, prevD = -Infinity;
    for (let a = 0; a <= 100; a += 5) {
      const g = computeGains(BASELINE, { aggressivity: a, understeerOversteer: 0, balanceHeadingRate: 0 });
      assert.ok(g.P > prevP, `P not monotonic at a=${a}: ${g.P} <= ${prevP}`);
      assert.ok(g.D > prevD, `D not monotonic at a=${a}: ${g.D} <= ${prevD}`);
      prevP = g.P; prevD = g.D;
    }
  });

  it("I and DD do not depend on aggressivity", () => {
    const g0   = computeGains(BASELINE, { aggressivity:   0, understeerOversteer: 0, balanceHeadingRate: 0 });
    const g100 = computeGains(BASELINE, { aggressivity: 100, understeerOversteer: 0, balanceHeadingRate: 0 });
    approx(g0.I,  g100.I,  1e-12);
    approx(g0.DD, g100.DD, 1e-12);
  });
});

describe("tuning-knobs — understeer / oversteer axis", () => {
  it("full understeer (u=-100) boosts P by 40% and cuts D by 15%", () => {
    const g = computeGains(BASELINE, { aggressivity: 50, understeerOversteer: -100, balanceHeadingRate: 0 });
    approx(g.P, BASELINE.P * 1.40, 1e-9, "P +40%");
    approx(g.D, BASELINE.D * 0.85, 1e-9, "D −15%");
  });

  it("full oversteer (u=+100) boosts D by 40% and cuts P by 15%", () => {
    const g = computeGains(BASELINE, { aggressivity: 50, understeerOversteer: 100, balanceHeadingRate: 0 });
    approx(g.D, BASELINE.D * 1.40, 1e-9, "D +40%");
    approx(g.P, BASELINE.P * 0.85, 1e-9, "P −15%");
  });

  it("u axis does not touch I or DD", () => {
    for (const u of [-100, -50, -10, 10, 50, 100]) {
      const g = computeGains(BASELINE, { aggressivity: 50, understeerOversteer: u, balanceHeadingRate: 0 });
      approx(g.I, BASELINE.I, 1e-12, `I at u=${u}`);
      approx(g.DD, BASELINE.DD, 1e-12, `DD at u=${u}`);
    }
  });

  it("P is strictly decreasing as u sweeps from -100 to +100", () => {
    let prev = Infinity;
    for (let u = -100; u <= 100; u += 10) {
      const g = computeGains(BASELINE, { aggressivity: 50, understeerOversteer: u, balanceHeadingRate: 0 });
      assert.ok(g.P < prev + 1e-12, `P not monotonic at u=${u}`);
      prev = g.P;
    }
  });

  it("D is strictly increasing as u sweeps from -100 to +100", () => {
    let prev = -Infinity;
    for (let u = -100; u <= 100; u += 10) {
      const g = computeGains(BASELINE, { aggressivity: 50, understeerOversteer: u, balanceHeadingRate: 0 });
      assert.ok(g.D > prev - 1e-12, `D not monotonic at u=${u}`);
      prev = g.D;
    }
  });
});

describe("tuning-knobs — balance heading/rate axis", () => {
  it("full heading focus (b=-100) boosts I by 60%, cuts DD by 20%", () => {
    const g = computeGains(BASELINE, { aggressivity: 50, understeerOversteer: 0, balanceHeadingRate: -100 });
    approx(g.I,  BASELINE.I  * 1.60, 1e-9, "I +60%");
    approx(g.DD, BASELINE.DD * 0.80, 1e-9, "DD −20%");
  });

  it("full rate focus (b=+100) boosts DD by 60%, cuts I by 20%", () => {
    const g = computeGains(BASELINE, { aggressivity: 50, understeerOversteer: 0, balanceHeadingRate: 100 });
    approx(g.DD, BASELINE.DD * 1.60, 1e-9, "DD +60%");
    approx(g.I,  BASELINE.I  * 0.80, 1e-9, "I −20%");
  });

  it("b axis does not touch P or D", () => {
    for (const b of [-100, -50, -10, 10, 50, 100]) {
      const g = computeGains(BASELINE, { aggressivity: 50, understeerOversteer: 0, balanceHeadingRate: b });
      approx(g.P, BASELINE.P, 1e-12, `P at b=${b}`);
      approx(g.D, BASELINE.D, 1e-12, `D at b=${b}`);
    }
  });
});

describe("tuning-knobs — clamps and safety", () => {
  it("cannot push any gain below MIN_FACTOR × baseline", () => {
    // Try the most extreme combo that lowers P.
    const g = computeGains(BASELINE, { aggressivity: 0, understeerOversteer: 100, balanceHeadingRate: 100 });
    assert.ok(g.P >= BASELINE.P * MIN_FACTOR - 1e-12);
    assert.ok(g.I >= BASELINE.I * MIN_FACTOR - 1e-12);
    assert.ok(g.D >= BASELINE.D * MIN_FACTOR - 1e-12);
    assert.ok(g.DD >= BASELINE.DD * MIN_FACTOR - 1e-12);
  });

  it("cannot push any gain above MAX_FACTOR × baseline", () => {
    const g = computeGains(BASELINE, { aggressivity: 100, understeerOversteer: -100, balanceHeadingRate: -100 });
    assert.ok(g.P  <= BASELINE.P  * MAX_FACTOR + 1e-12);
    assert.ok(g.I  <= BASELINE.I  * MAX_FACTOR + 1e-12);
    assert.ok(g.D  <= BASELINE.D  * MAX_FACTOR + 1e-12);
    assert.ok(g.DD <= BASELINE.DD * MAX_FACTOR + 1e-12);
  });

  it("out-of-range knobs are clamped, not rejected", () => {
    const g1 = computeGains(BASELINE, { aggressivity: -50,  understeerOversteer: -500, balanceHeadingRate: -500 });
    const g2 = computeGains(BASELINE, { aggressivity:   0,  understeerOversteer: -100, balanceHeadingRate: -100 });
    approx(g1.P, g2.P, 1e-9);
    approx(g1.I, g2.I, 1e-9);
    approx(g1.D, g2.D, 1e-9);
    approx(g1.DD, g2.DD, 1e-9);
  });

  it("NaN/Infinity in knobs is coerced to safe defaults", () => {
    const g = computeGains(BASELINE, { aggressivity: NaN, understeerOversteer: Infinity, balanceHeadingRate: -Infinity });
    // Aggressivity NaN → 0 → aggScale=0.5. So P should be 0.5*baseline*(pShift with u=+1, b=-1 does nothing to P).
    // With u=+1: pShift = 1 - 1*0.15 = 0.85 → P = baseline.P * 0.5 * 0.85 = baseline.P * 0.425
    approx(g.P, BASELINE.P * 0.425, 1e-9, "P coerced");
    // At least: no NaN in outputs.
    assert.ok(isFinite(g.P) && isFinite(g.I) && isFinite(g.D) && isFinite(g.DD));
  });
});

describe("tuning-knobs — rounding", () => {
  it("roundGains keeps 4 significant digits", () => {
    const r = roundGains({ P: 0.0030000000004, I: 0.021999999, D: 0.09876543, DD: 0 });
    assert.equal(r.P, 0.003);
    assert.equal(r.I, 0.022);
    assert.equal(r.D, 0.09877);
    assert.equal(r.DD, 0);
  });
});

describe("tuning-knobs — validation", () => {
  it("validateKnobs accepts a well-formed body", () => {
    assert.equal(validateKnobs({ aggressivity: 50, understeerOversteer: 0, balanceHeadingRate: 0 }), null);
  });
  it("validateKnobs rejects out-of-range values", () => {
    const err = validateKnobs({ aggressivity: 150, understeerOversteer: 0, balanceHeadingRate: 0 });
    assert.ok(err && err.includes("aggressivity"));
  });
  it("validateKnobs rejects non-number", () => {
    const err = validateKnobs({ aggressivity: "50", understeerOversteer: 0, balanceHeadingRate: 0 });
    assert.ok(err && err.includes("aggressivity"));
  });
  it("validateBaseline rejects negative gain", () => {
    const err = validateBaseline({ P: -1, I: 0, D: 0, DD: 0 });
    assert.ok(err && err.includes("P"));
  });
  it("validateBaseline requires all four keys", () => {
    const err = validateBaseline({ P: 0.003, I: 0.02, D: 0.09 });
    assert.ok(err && err.includes("DD"));
  });
});

describe("tuning-knobs — realistic scenarios", () => {
  it("sailor asks for 'a bit more bite' (agg 70, u 0, b 0)", () => {
    const knobs: TuningKnobs = { aggressivity: 70, understeerOversteer: 0, balanceHeadingRate: 0 };
    const g = computeGains(BASELINE, knobs);
    approx(g.P, BASELINE.P * 1.2, 1e-9);
    approx(g.D, BASELINE.D * 1.2, 1e-9);
    approx(g.I, BASELINE.I, 1e-12);
    approx(g.DD, BASELINE.DD, 1e-12);
  });

  it("Doctor says 'oversteering' (u=+40)", () => {
    const knobs: TuningKnobs = { aggressivity: 50, understeerOversteer: 40, balanceHeadingRate: 0 };
    const g = computeGains(BASELINE, knobs);
    // u=+40 → posU=0.4, negU=0
    // pShift = 1 - 0.4*0.15 = 0.94
    // dShift = 1 + 0.4*0.40 = 1.16
    approx(g.P, BASELINE.P * 0.94, 1e-9);
    approx(g.D, BASELINE.D * 1.16, 1e-9);
  });
});
