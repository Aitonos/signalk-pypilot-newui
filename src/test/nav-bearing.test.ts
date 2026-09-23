import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeApbTarget,
  apbDivergence,
  isApbSource,
  type CourseData,
} from "../nav-bearing";

const DEG = Math.PI / 180;

function course(over: Partial<CourseData["nextPoint"]> & { xte?: number | null } = {}): CourseData {
  return {
    nextPoint: {
      bearingTrue: over.bearingTrue,
      steerTo: over.steerTo,
      distance: over.distance,
    },
    crossTrackError: over.xte ?? null,
  };
}

describe("computeApbTarget — no waypoint", () => {
  it("returns source='none' when course is null", () => {
    const r = computeApbTarget(null, "auto");
    assert.equal(r.source, "none");
    assert.equal(r.targetRad, null);
  });

  it("returns source='none' when nextPoint is missing", () => {
    const r = computeApbTarget({}, "auto");
    assert.equal(r.source, "none");
    assert.equal(r.targetRad, null);
  });
});

describe("computeApbTarget — auto preference", () => {
  it("prefers steerTo when both are present", () => {
    const r = computeApbTarget(
      course({ bearingTrue: 45 * DEG, steerTo: 50 * DEG }),
      "auto",
    );
    assert.equal(r.source, "steerTo");
    assert.equal(r.targetRad, 50 * DEG);
    assert.equal(r.fallback, false);
  });

  it("falls back to bearingTrue when steerTo is missing (no flag)", () => {
    const r = computeApbTarget(
      course({ bearingTrue: 45 * DEG }),
      "auto",
    );
    assert.equal(r.source, "bearing");
    assert.equal(r.targetRad, 45 * DEG);
    assert.equal(r.fallback, false,
      "auto mode should not flag fallback — a bare install is fine");
  });

  it("uses steerTo when only steerTo is present", () => {
    const r = computeApbTarget(
      course({ steerTo: 45 * DEG }),
      "auto",
    );
    assert.equal(r.source, "steerTo");
  });
});

describe("computeApbTarget — steerTo preference", () => {
  it("uses steerTo when available", () => {
    const r = computeApbTarget(
      course({ bearingTrue: 45 * DEG, steerTo: 50 * DEG }),
      "steerTo",
    );
    assert.equal(r.source, "steerTo");
  });

  it("falls back to bearingTrue with fallback=true", () => {
    const r = computeApbTarget(
      course({ bearingTrue: 45 * DEG }),
      "steerTo",
    );
    assert.equal(r.source, "bearing");
    assert.equal(r.fallback, true,
      "steerTo preference should flag fallback so the visor can nudge the sailor");
  });
});

describe("computeApbTarget — bearing preference", () => {
  it("uses bearing even when steerTo is available", () => {
    const r = computeApbTarget(
      course({ bearingTrue: 45 * DEG, steerTo: 50 * DEG }),
      "bearing",
    );
    assert.equal(r.source, "bearing");
    assert.equal(r.targetRad, 45 * DEG);
  });

  it("falls back to steerTo with fallback=true when bearing missing", () => {
    const r = computeApbTarget(
      course({ steerTo: 50 * DEG }),
      "bearing",
    );
    assert.equal(r.source, "steerTo");
    assert.equal(r.fallback, true);
  });
});

describe("computeApbTarget — meta fields", () => {
  it("propagates xte and distance", () => {
    const r = computeApbTarget(
      course({ bearingTrue: 45 * DEG, distance: 1234, xte: 20 }),
      "auto",
    );
    assert.equal(r.distanceM, 1234);
    assert.equal(r.xteM, 20);
  });

  it("ignores NaN / Infinity values", () => {
    const r = computeApbTarget(
      course({ bearingTrue: NaN as any, steerTo: Infinity as any }),
      "auto",
    );
    assert.equal(r.source, "none");
    assert.equal(r.targetRad, null);
  });
});

describe("apbDivergence", () => {
  it("returns null when either is missing", () => {
    assert.deepEqual(apbDivergence(course({ bearingTrue: 45 * DEG })),
      { bothPresent: false, divergenceRad: null });
  });

  it("computes signed difference wrapped to [-π, +π]", () => {
    const r = apbDivergence(course({ bearingTrue: 350 * DEG, steerTo: 10 * DEG }));
    assert.equal(r.bothPresent, true);
    // 10° − 350° wrapped = 20°
    assert.ok(Math.abs(r.divergenceRad! - 20 * DEG) < 1e-9);
  });
});

describe("isApbSource type guard", () => {
  it("accepts the three valid values", () => {
    assert.equal(isApbSource("auto"), true);
    assert.equal(isApbSource("steerTo"), true);
    assert.equal(isApbSource("bearing"), true);
  });

  it("rejects anything else", () => {
    assert.equal(isApbSource("nav"), false);
    assert.equal(isApbSource(42), false);
    assert.equal(isApbSource(null), false);
    assert.equal(isApbSource(""), false);
  });
});
