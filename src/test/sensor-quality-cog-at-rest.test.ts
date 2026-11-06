// Rev642 (Carlos 2026-11-06: "siempre me da COG missing"): at the berth the
// GPS sends an empty course every second; Signal K stores null with a fresh
// timestamp. That is a live sensor with no course, not a missing one.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SensorQualityMonitor, DEFAULT_QUALITY_WATCH } from "../sensor-quality";

const ts = (ms: number) => new Date(ms).toISOString();

describe("COG at rest (Rev642)", () => {
  it("null COG with a fresh timestamp is good, not missing", () => {
    const q = new SensorQualityMonitor({ cog: DEFAULT_QUALITY_WATCH["navigation.courseOverGroundTrue"] } as any);
    for (let t = 0; t < 10_000; t += 1000) q.observe("cog", { value: null, timestamp: ts(t) }, t);
    assert.equal(q.snapshot(9_500).items[0].level, "good");
  });

  it("a GPS that stops sending is still lost", () => {
    const q = new SensorQualityMonitor({ cog: DEFAULT_QUALITY_WATCH["navigation.courseOverGroundTrue"] } as any);
    for (let t = 0; t < 10_000; t += 1000) q.observe("cog", { value: null, timestamp: ts(t) }, t);
    for (let t = 10_000; t < 60_000; t += 1000) q.observe("cog", { value: null, timestamp: ts(9_000) }, t);
    assert.equal(q.snapshot(60_000).items[0].level, "lost");
  });

  it("other paths still ignore null", () => {
    const q = new SensorQualityMonitor({ x: { degradedAgeMs: 2000, lostAgeMs: 8000 } } as any);
    for (let t = 0; t < 10_000; t += 1000) q.observe("x", { value: null, timestamp: ts(t) }, t);
    assert.equal(q.snapshot(9_500).items[0].level, "missing");
  });
});
