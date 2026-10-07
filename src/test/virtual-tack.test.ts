import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  awaEmaStep,
  computeTackGeometry,
  fractionateRotation,
  normalizeSignedPi,
  normalizeTwoPi,
  signedAngleDelta,
  isAtTarget,
  isWindConverged,
  recomputeRemainingIntermediates,
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
  it("near head-to-wind (AWA ~0): bow swings the requested side 30deg", () => {
    // Rev383: in irons, direction dictates sign (bow goes stbd = +30 CW).
    const g = computeTackGeometry({
      angleStartRad: deg(1),
      hStartRad: deg(0),
      direction: "starboard",
    });
    assert.ok(
      Math.abs(g.deltaHRad - deg(30)) < EPS,
      `deltaH expected +30, got ${g.deltaHRad * RAD2DEG}`,
    );
    // angleNew = angleStart - deltaH = 1 - 30 = -29
    assert.ok(
      Math.abs(g.angleNewRad - deg(-29)) < EPS,
      `angleNew expected -29, got ${g.angleNewRad * RAD2DEG}`,
    );
  });

  it("Rev383 Carlos QA: TACK PORT from port tack (AWA=+52) → long-way jibe CCW", () => {
    // Carlos pressed TACK PORT while already on port tack (AWA=+52).
    // Direction=port means bow swings CCW. Natural short tack would be
    // +104 CW (crossing the wind). The CCW route around the stern is
    // 104 - 360 = -256 CCW.
    const g = computeTackGeometry({
      angleStartRad: deg(52),
      hStartRad: deg(0),
      direction: "port",
    });
    assert.ok(
      Math.abs(g.deltaHRad - deg(-256)) < EPS,
      `deltaH expected -256, got ${g.deltaHRad * RAD2DEG}`,
    );
    // angleNew = -angleStart = -52 (final amura is wind-by-port either way).
    assert.ok(Math.abs(g.angleNewRad - deg(-52)) < EPS);
    // |256| / 170 = 1.5 → 2 steps.
    assert.equal(g.intermediatesRad.length, 2);
  });

  it("Rev383 Carlos QA: TACK STARBOARD from port tack (AWA=+52) → natural short-arc tack CW", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(52),
      hStartRad: deg(0),
      direction: "starboard",
    });
    assert.ok(
      Math.abs(g.deltaHRad - deg(104)) < EPS,
      `deltaH expected +104, got ${g.deltaHRad * RAD2DEG}`,
    );
    assert.ok(Math.abs(g.angleNewRad - deg(-52)) < EPS);
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

describe("virtual-tack / maneuverKind classification (Rev395 Round-3 fix)", () => {
  // Rev394 shipped a broken classifier that returned "jibe" for the
  // T2 case below (AWA=-174°, port). The fix is: sign(AWA_0) === dirSign
  // means the AWA sweep passes through 0 (bow) → tack; otherwise jibe.
  it("AWA=-174°, port → tack (long arc CCW crosses bow)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(-174),
      hStartRad: deg(0),
      direction: "port",
    });
    assert.equal(g.maneuverKind, "tack");
  });
  it("AWA=-174°, starboard → jibe (short arc CW crosses stern)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(-174),
      hStartRad: deg(0),
      direction: "starboard",
    });
    assert.equal(g.maneuverKind, "jibe");
  });
  it("AWA=+120°, starboard → tack (long arc CW crosses bow)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(120),
      hStartRad: deg(0),
      direction: "starboard",
    });
    assert.equal(g.maneuverKind, "tack");
  });
  it("AWA=+120°, port → jibe (short arc CCW crosses stern)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(120),
      hStartRad: deg(0),
      direction: "port",
    });
    assert.equal(g.maneuverKind, "jibe");
  });
  it("AWA=+30°, starboard → tack (close-hauled classic)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(30),
      hStartRad: deg(0),
      direction: "starboard",
    });
    assert.equal(g.maneuverKind, "tack");
  });
  it("AWA=+30°, port → jibe (long way round via stern)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(30),
      hStartRad: deg(0),
      direction: "port",
    });
    assert.equal(g.maneuverKind, "jibe");
  });
  it("AWA=0° (head-to-wind), port → tack (exiting irons)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(0),
      hStartRad: deg(0),
      direction: "port",
    });
    assert.equal(g.maneuverKind, "tack");
  });
  it("AWA=+5° (near head-to-wind), port → tack (exiting irons)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(5),
      hStartRad: deg(0),
      direction: "port",
    });
    assert.equal(g.maneuverKind, "tack");
  });
});

describe("virtual-tack / recomputeRemainingIntermediates (Rev407 audit H)", () => {
  // Context: after each step reached (±20° tolerance), we recompute the
  // chain from the ACTUAL heading, so the next step can never land at
  // >180° real distance (which would make pypilot go the wrong way).

  it("empty when the boat has already reached the final heading", () => {
    const out = recomputeRemainingIntermediates({
      hNowRad: deg(90),
      finalCompassTargetRad: deg(90),
      originalDeltaSign: 1,
    });
    assert.deepEqual(out, []);
  });

  it("single step when remaining arc < DEFAULT_MAX_STEP_DEG", () => {
    const out = recomputeRemainingIntermediates({
      hNowRad: deg(0),
      finalCompassTargetRad: deg(60),
      originalDeltaSign: 1,
    });
    assert.equal(out.length, 1);
    assert.ok(Math.abs(out[0] - deg(60)) < EPS, `got ${out[0] * RAD2DEG}`);
  });

  it("fractionates into equal steps when arc > DEFAULT_MAX_STEP_DEG", () => {
    const out = recomputeRemainingIntermediates({
      hNowRad: deg(0),
      finalCompassTargetRad: deg(340),
      originalDeltaSign: 1,
    });
    assert.equal(out.length, 2);
    assert.ok(Math.abs(out[0] - deg(170)) < EPS);
    assert.ok(Math.abs(out[1] - deg(340)) < EPS);
  });

  it("respects originalDeltaSign — forces long arc when short arc would go the WRONG way", () => {
    // Starting at 10°, wanting to reach 350° via the LONG arc (CCW,
    // negative). Short arc would be +340° (CW), which has sign +1 ≠
    // originalDeltaSign (-1). So we must take -20° (long way through
    // 0, 350) in CCW direction.
    const out = recomputeRemainingIntermediates({
      hNowRad: deg(10),
      finalCompassTargetRad: deg(350),
      originalDeltaSign: -1,
    });
    // Should produce a single-step CCW arc of -20° → 350°.
    assert.equal(out.length, 1);
    assert.ok(Math.abs(out[0] - deg(350)) < EPS, `got ${out[0] * RAD2DEG}`);
  });

  it("audit H bug — barco a 20° antes del step, siguiente step no cae a 190°", () => {
    // Original plan was: step N at 170°. Boat reached 150° (20° short,
    // acceptable by DEFAULT_PHASE_TOLERANCE_DEG). Original step N+1
    // was planned at 340°. If we had NOT recomputed, step N+1 would be
    // at 340 - 150 = 190° of real heading → pypilot picks short arc
    // (170° in the OPPOSITE direction). With recompute, we rebuild
    // from 150° toward final 340°, giving step at 320° (170° away in
    // the SAME direction as the original rotation).
    const out = recomputeRemainingIntermediates({
      hNowRad: deg(150),
      finalCompassTargetRad: deg(340),
      originalDeltaSign: 1,
    });
    assert.equal(out.length, 2);
    // First recomputed step is at 150 + 95 = 245° (half of remaining 190°).
    // Both steps are CW from 150°, same direction as originalDelta.
    assert.ok(out[0] > deg(150) && out[0] < deg(340),
      `first step should be between 150 and 340, got ${out[0] * RAD2DEG}`);
    assert.ok(Math.abs(out[1] - deg(340)) < EPS,
      `final step should be 340, got ${out[1] * RAD2DEG}`);
  });

  it("wrap-around: hNow near 2π, target just past 0", () => {
    // Boat at 350°, final target at 10°, CW rotation (short arc +20°).
    const out = recomputeRemainingIntermediates({
      hNowRad: deg(350),
      finalCompassTargetRad: deg(10),
      originalDeltaSign: 1,
    });
    assert.equal(out.length, 1);
    assert.ok(Math.abs(out[0] - deg(10)) < EPS, `got ${out[0] * RAD2DEG}`);
  });
});

describe("virtual-tack / awaEmaStep (Rev414/Rev415 settling EMA)", () => {
  const ALPHA = 0.13;

  it("seeds the EMA directly on the first sample", () => {
    const out = awaEmaStep(null, deg(45), ALPHA);
    assert.ok(Math.abs(out - deg(45)) < EPS,
      `first sample seeds EMA, got ${out * RAD2DEG}`);
  });

  it("converges toward a constant input after enough ticks", () => {
    let ema: number | null = null;
    for (let i = 0; i < 200; i++) ema = awaEmaStep(ema, deg(45), ALPHA);
    assert.ok(ema !== null && Math.abs(ema - deg(45)) < 1e-3,
      `EMA converged, got ${ema! * RAD2DEG}`);
  });

  it("does NOT diverge when the sample crosses ±π (wrap-around)", () => {
    // Steady wind at +179°. The next sample flips to -179° (angle
    // wrapped). Without signed-pi normalisation the delta would be
    // -358° and the EMA would snap backwards by ~46° toward +133°.
    // With the normalisation it should barely move.
    const prev = deg(179);
    const sample = deg(-179);
    const out = awaEmaStep(prev, sample, ALPHA);
    // Shortest arc is +2° (CW from +179 to -179 = +2°), so the EMA
    // steps by 0.13 * +2° = +0.26° past +180° → wraps to ~-179.7°.
    const outDeg = out * RAD2DEG;
    assert.ok(outDeg < -179 || outDeg > 179,
      `EMA stayed near ±180° (should wrap), got ${outDeg.toFixed(3)}°`);
  });

  it("rejects garbage: alpha=0 returns previous unchanged (apart from wrap)", () => {
    const prev = deg(30);
    const out = awaEmaStep(prev, deg(90), 0);
    assert.ok(Math.abs(out - prev) < EPS,
      `alpha=0 is identity, got ${out * RAD2DEG}`);
  });
});

describe("virtual-tack / computeTackGeometry — angleNewRadOverride (Rev416 fix #12)", () => {
  it("uses the override as the final AWA, ignoring the mirror", () => {
    // AWA start +45° (close-hauled stbd). Mirror would land at -45°.
    // Override to -40° (closer-hauled on the new tack).
    const g = computeTackGeometry({
      angleStartRad: deg(45),
      hStartRad: deg(0),
      direction: "port",
      angleNewRadOverride: deg(-40),
    });
    assert.ok(Math.abs(g.angleNewRad - deg(-40)) < 1e-6,
      `override honoured, got ${g.angleNewRad * RAD2DEG}`);
    // deltaH = angleStart - angleNew = 45 - (-40) = 85°, matches dir=port
    // which is CCW (negative)? port dirSign=-1, naturalDelta=85>0, so
    // deltaH = 85 - 360 = -275° (long way CCW). Just assert sign is CCW.
    assert.ok(g.deltaHRad < 0, `port should rotate CCW, deltaH=${g.deltaHRad * RAD2DEG}`);
  });

  it("ignores a non-finite override and falls back to the mirror", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(30),
      hStartRad: deg(0),
      direction: "port",
      angleNewRadOverride: Number.NaN,
    });
    // Mirror of +30° is -30°.
    assert.ok(Math.abs(g.angleNewRad - deg(-30)) < 1e-6,
      `NaN override ignored, got ${g.angleNewRad * RAD2DEG}`);
  });

  it("ignores an out-of-range override (|rad| > π)", () => {
    const g = computeTackGeometry({
      angleStartRad: deg(30),
      hStartRad: deg(0),
      direction: "port",
      angleNewRadOverride: 10,  // > π
    });
    assert.ok(Math.abs(g.angleNewRad - deg(-30)) < 1e-6,
      `out-of-range override ignored, got ${g.angleNewRad * RAD2DEG}`);
  });
});
