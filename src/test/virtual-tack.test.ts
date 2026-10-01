import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeTackGeometry,
  fractionateRotation,
  normalizeSignedPi,
  normalizeTwoPi,
  signedAngleDelta,
  isAtTarget,
  isWindConverged,
  DEG,
  RAD2DEG,
  DEFAULT_MAX_STEP_DEG,
} from "../virtual-tack";

const EPS = 1e-6;

function deg(d: number) {
  return d * DEG;
}

describe("virtual-tack / angle normalization", () => {
  it("normalizeTwoPi maps negatives into [0, 2pi)", () => {
    assert.ok(Math.abs(normalizeTwoPi(-Math.PI / 2) - (3 * Math.PI) / 2) < EPS);
    assert.ok(Math.abs(normalizeTwoPi(2 * Math.PI) - 0) < EPS);
    assert.ok(Math.abs(normalizeTwoPi(5 * Math.PI) - Math.PI) < EPS);
  });

  it("normalizeSignedPi keeps 0 at 0 and flips 3pi/2 into -pi/2", () => {
    assert.ok(Math.abs(normalizeSignedPi(0)) < EPS);
    assert.ok(Math.abs(normalizeSignedPi((3 * Math.PI) / 2) + Math.PI / 2) < EPS);
    assert.ok(Math.abs(normalizeSignedPi(-3 * Math.PI) - Math.PI) < EPS);
  });

  it("signedAngleDelta picks the short arc with correct sign", () => {
    // From 350deg to 10deg should be +20deg (CW short), not -340.
    const d = signedAngleDelta(deg(350), deg(10));
    assert.ok(Math.abs(d - deg(20)) < EPS, `got ${d * RAD2DEG}`);
    // From 10deg to 350deg should be -20deg (CCW short).
    const d2 = signedAngleDelta(deg(10), deg(350));
    assert.ok(Math.abs(d2 + deg(20)) < EPS, `got ${d2 * RAD2DEG}`);
  });
});

describe("virtual-tack / computeTackGeometry — close-hauled quadrant", () => {
  it("port tack from AWA=+30deg (wind on starboard, close-hauled stbd) gives delta_H = +60deg CW", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(30),
      hStartRad: deg(0),
      direction: "starboard",
    });
    assert.ok(
      Math.abs(g.deltaHRad - deg(60)) < EPS,
      `deltaH expected +60, got ${g.deltaHRad * RAD2DEG}`,
    );
    assert.ok(
      Math.abs(g.angleNewRad + deg(30)) < EPS,
      `angleNew expected -30, got ${g.angleNewRad * RAD2DEG}`,
    );
    assert.ok(
      Math.abs(g.hTargetRad - deg(60)) < EPS,
      `hTarget expected 60, got ${g.hTargetRad * RAD2DEG}`,
    );
    assert.equal(g.intermediatesRad.length, 1);
  });

  it("starboard tack from AWA=-45deg (close-hauled port) gives delta_H = -90deg CCW", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(-45),
      hStartRad: deg(100),
      direction: "port",
    });
    assert.ok(
      Math.abs(g.deltaHRad + deg(90)) < EPS,
      `deltaH expected -90, got ${g.deltaHRad * RAD2DEG}`,
    );
    assert.ok(Math.abs(g.angleNewRad - deg(45)) < EPS);
    // 100 - 90 = 10
    assert.ok(Math.abs(g.hTargetRad - deg(10)) < EPS);
    assert.equal(g.intermediatesRad.length, 1);
  });
});

describe("virtual-tack / computeTackGeometry — downwind quadrant (fractionation)", () => {
  it("gybe-ish tack from TWA=+135deg to starboard produces +270deg rotation split into 2 steps", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(135),
      hStartRad: deg(0),
      direction: "starboard",
    });
    assert.ok(
      Math.abs(g.deltaHRad - deg(270)) < EPS,
      `deltaH expected +270, got ${g.deltaHRad * RAD2DEG}`,
    );
    assert.ok(Math.abs(g.angleNewRad + deg(135)) < EPS);
    // 0 + 270 = 270 — but normalized the final absolute heading is 270.
    assert.ok(Math.abs(g.hTargetRad - deg(270)) < EPS);
    // Fractionation: 270 / 170 = 1.58 → ceil 2 → steps at 170 and 270.
    assert.equal(g.intermediatesRad.length, 2);
    assert.ok(Math.abs(g.intermediatesRad[0] - deg(170)) < EPS);
    assert.ok(Math.abs(g.intermediatesRad[1] - deg(270)) < EPS);
  });

  it("gybe-ish tack from TWA=-150deg to port produces -300deg rotation split into 2 steps", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(-150),
      hStartRad: deg(180),
      direction: "port",
    });
    assert.ok(
      Math.abs(g.deltaHRad + deg(300)) < EPS,
      `deltaH expected -300, got ${g.deltaHRad * RAD2DEG}`,
    );
    // 180 + (-300) = -120 → normalize to 240.
    assert.ok(Math.abs(g.hTargetRad - deg(240)) < EPS);
    assert.equal(g.intermediatesRad.length, 2);
    // Step 1: 180 - 170 = 10. Step 2: 180 - 300 = -120 → 240.
    assert.ok(Math.abs(g.intermediatesRad[0] - deg(10)) < EPS);
    assert.ok(Math.abs(g.intermediatesRad[1] - deg(240)) < EPS);
  });
});

describe("virtual-tack / computeTackGeometry — degenerate / edge cases", () => {
  it("near head-to-wind (AWA ~0) clamps magnitude to 30deg so we rotate out of irons", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(1),
      hStartRad: deg(0),
      direction: "starboard",
    });
    // angleNew should be -30deg (because the dir=starboard sign dominates).
    assert.ok(Math.abs(g.angleNewRad + deg(30)) < EPS);
    // deltaH = angleStart - angleNew; angleStart is 1deg, angleNew is -30deg,
    // so deltaH = 1 - (-30) = 31deg.
    assert.ok(
      Math.abs(g.deltaHRad - deg(31)) < EPS,
      `deltaH expected +31, got ${g.deltaHRad * RAD2DEG}`,
    );
  });

  it("direction and magnitude both honored when AWA sign matches request", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(60),
      hStartRad: deg(45),
      direction: "starboard",
    });
    // delta = 2 * 60 = 120deg CW, fits single step.
    assert.ok(Math.abs(g.deltaHRad - deg(120)) < EPS);
    assert.equal(g.intermediatesRad.length, 1);
    // hTarget = 45 + 120 = 165.
    assert.ok(Math.abs(g.intermediatesRad[0] - deg(165)) < EPS);
  });
});

describe("virtual-tack / fractionateRotation", () => {
  it("|delta| <= maxStep → 1 step at the final target", () => {
    const r = fractionateRotation({
      hStartRad: deg(0),
      deltaHRad: deg(60),
      maxStepRad: deg(170),
    });
    assert.equal(r.length, 1);
    assert.ok(Math.abs(r[0] - deg(60)) < EPS);
  });

  it("empty when delta is effectively zero", () => {
    const r = fractionateRotation({
      hStartRad: deg(0),
      deltaHRad: 1e-9,
      maxStepRad: deg(170),
    });
    assert.equal(r.length, 0);
  });

  it("|delta| = 180 → 2 steps because maxStep=170", () => {
    const r = fractionateRotation({
      hStartRad: deg(10),
      deltaHRad: deg(180),
      maxStepRad: deg(170),
    });
    assert.equal(r.length, 2);
    assert.ok(Math.abs(r[0] - deg(180)) < EPS); // 10 + 170 = 180
    assert.ok(Math.abs(r[1] - deg(190)) < EPS); // 10 + 180 = 190
  });

  it("negative delta rotates CCW; final intermediate wraps correctly", () => {
    const r = fractionateRotation({
      hStartRad: deg(10),
      deltaHRad: deg(-200),
      maxStepRad: deg(170),
    });
    assert.equal(r.length, 2);
    // Step 1: 10 - 170 = -160 → normalize 200.
    assert.ok(
      Math.abs(r[0] - deg(200)) < EPS,
      `step1 expected 200, got ${r[0] * RAD2DEG}`,
    );
    // Step 2: 10 - 200 = -190 → normalize 170.
    assert.ok(
      Math.abs(r[1] - deg(170)) < EPS,
      `step2 expected 170, got ${r[1] * RAD2DEG}`,
    );
  });

  it("rejects non-positive maxStepRad", () => {
    assert.throws(() =>
      fractionateRotation({
        hStartRad: 0,
        deltaHRad: deg(60),
        maxStepRad: 0,
      }),
    );
  });
});

describe("virtual-tack / arrival predicates", () => {
  it("isAtTarget handles 0/360 wrap-around within tolerance", () => {
    // h_now = 358deg, h_target = 2deg, tolerance 20deg → delta=4deg → true.
    const ok = isAtTarget({
      hNowRad: deg(358),
      hTargetRad: deg(2),
      toleranceDeg: 20,
    });
    assert.equal(ok, true);
    // Outside tolerance.
    const bad = isAtTarget({
      hNowRad: deg(100),
      hTargetRad: deg(200),
      toleranceDeg: 20,
    });
    assert.equal(bad, false);
  });

  it("isWindConverged handles negative-to-positive crossing within tolerance", () => {
    // angle_now = -175deg, angle_target = 175deg → shortest = -10deg → within 20deg.
    const ok = isWindConverged({
      angleNowRad: deg(-175),
      angleTargetRad: deg(175),
      toleranceDeg: 20,
    });
    assert.equal(ok, true);
    // Clearly out of tolerance.
    const bad = isWindConverged({
      angleNowRad: deg(0),
      angleTargetRad: deg(90),
      toleranceDeg: 20,
    });
    assert.equal(bad, false);
  });
});

describe("virtual-tack / default thresholds unchanged", () => {
  it("DEFAULT_MAX_STEP_DEG is 170 so no single step can pin pypilot's short-arc to the opposite side", () => {
    assert.equal(DEFAULT_MAX_STEP_DEG, 170);
  });
});
