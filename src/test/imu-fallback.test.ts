// Rev696 (GitHub #6): heading / attitude fallback when pypilot cannot write to Signal K.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { otherSourceFresh, imuFallbackValues } from "../imu-fallback";

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
