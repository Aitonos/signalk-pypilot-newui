// Rev696 (GitHub #6): heading / attitude fallback when pypilot cannot write to Signal K.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { otherSourceFresh, imuFallbackValues, newFallbackPathState, stepFallbackPath } from "../imu-fallback";

const now = Date.parse("2026-11-11T12:00:10Z");
const ago = (s: number) => new Date(now - s * 1000).toISOString();

describe("IMU fallback (Rev696)", () => {
  it("sees another fresh source, ignores its own and stale ones", () => {
    assert.equal(otherSourceFresh({ $source: "pypilot", timestamp: ago(1) }, "pypilot-newui", now, 5000), true);
    assert.equal(otherSourceFresh({ $source: "pypilot", timestamp: ago(30) }, "pypilot-newui", now, 5000), false);
    assert.equal(otherSourceFresh({ $source: "pypilot-newui", timestamp: ago(1) }, "pypilot-newui", now, 5000), false);
    assert.equal(otherSourceFresh(undefined, "pypilot-newui", now, 5000), false);
    // several sources: ours fresh, the other stale -> nobody else
    assert.equal(otherSourceFresh({ $source: "pypilot-newui", timestamp: ago(0),
      values: { "pypilot-newui": { timestamp: ago(0) }, "pypilot": { timestamp: ago(40) } } }, "pypilot-newui", now, 5000), false);
    assert.equal(otherSourceFresh({ $source: "pypilot-newui", timestamp: ago(0),
      values: { "pypilot-newui": { timestamp: ago(0) }, "can0.115": { timestamp: ago(2) } } }, "pypilot-newui", now, 5000), true);
  });

  it("converts pypilot's degrees like pypilot's own Signal K output", () => {
    const out = imuFallbackValues({ "imu.heading_lowpass": 180, "imu.pitch": 2, "imu.roll": -10, "imu.headingrate_lowpass": 3 });
    const by = Object.fromEntries(out.map((x) => [x.path, x.value]));
    assert.ok(Math.abs((by["navigation.headingMagnetic"] as number) - Math.PI) < 1e-9);
    const att = by["navigation.attitude"] as { pitch: number; roll: number; yaw: number };
    assert.ok(Math.abs(att.roll + 10 * Math.PI / 180) < 1e-9);
    assert.ok(Math.abs(att.yaw - Math.PI) < 1e-9);
    assert.ok(Math.abs((by["navigation.rateOfTurn"] as number) - 3 * Math.PI / 180) < 1e-9);
    assert.ok(Math.abs((imuFallbackValues({ "imu.heading_lowpass": -90 })[0].value as number) - 1.5 * Math.PI) < 1e-9);
    assert.deepEqual(imuFallbackValues({ "imu.pitch": 1 }), [], "nothing without a heading");
  });
});

describe("IMU fallback per path (Rev698)", () => {
  it("publishes only the paths asked for", () => {
    const v = { "imu.heading_lowpass": 90, "imu.pitch": 1, "imu.roll": 2, "imu.headingrate_lowpass": 0.5 };
    assert.deepEqual(imuFallbackValues(v, new Set(["navigation.attitude"])).map((x) => x.path), ["navigation.attitude"]);
    assert.equal(imuFallbackValues(v).length, 3);
  });
  it("comes on after 2 quiet passes, steps back at once", () => {
    const st = newFallbackPathState();
    assert.equal(stepFallbackPath(st, false, true, true), null);
    assert.equal(stepFallbackPath(st, false, true, true), "on");
    assert.equal(stepFallbackPath(st, false, true, true), null);
    assert.equal(stepFallbackPath(st, true, true, true), "off");
  });
  it("waits 6 passes (30 s) once another source has been seen - no flapping", () => {
    const st = newFallbackPathState();
    stepFallbackPath(st, true, true, true);   // a slow compass, seen once
    for (let i = 0; i < 5; i++) assert.equal(stepFallbackPath(st, false, true, true), null, `pass ${i}`);
    assert.equal(stepFallbackPath(st, false, true, true), "on");
  });
  it("never on without a pypilot heading or when switched off; switching off steps back", () => {
    const a = newFallbackPathState();
    for (let i = 0; i < 10; i++) assert.equal(stepFallbackPath(a, false, false, true), null);
    const b = newFallbackPathState();
    for (let i = 0; i < 10; i++) assert.equal(stepFallbackPath(b, false, true, false), null);
    const c = newFallbackPathState();
    stepFallbackPath(c, false, true, true); stepFallbackPath(c, false, true, true);
    assert.equal(c.active, true);
    assert.equal(stepFallbackPath(c, false, true, false), "off");
    assert.equal(c.offs, 0, "switching off is not another source");
  });
});
