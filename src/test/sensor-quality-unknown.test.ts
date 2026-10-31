import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SensorQualityMonitor } from "../sensor-quality";

describe("SensorQualityMonitor without timestamps (Rev582, GPT re-audit A06)", () => {
  const thr = { x: { degradedAgeMs: 2000, lostAgeMs: 8000 } };

  it("a constant value without timestamp is 'unknown', not good forever", () => {
    const q = new SensorQualityMonitor(thr as any);
    for (let t = 0; t < 100_000; t += 1000) q.observe("x", { value: 1 }, t);
    assert.equal(q.snapshot(99_000).items[0].level, "unknown");
  });

  it("a value that keeps changing without timestamp is good", () => {
    const q = new SensorQualityMonitor(thr as any);
    for (let t = 0; t < 100_000; t += 1000) q.observe("x", { value: t }, t);
    assert.equal(q.snapshot(99_000).items[0].level, "good");
  });

  it("timestamped data is graded as before", () => {
    const q = new SensorQualityMonitor(thr as any);
    for (let t = 0; t < 10_000; t += 1000) q.observe("x", { value: 1, timestamp: new Date(t).toISOString() }, t);
    assert.equal(q.snapshot(9_500).items[0].level, "good");
    assert.equal(q.snapshot(30_000).items[0].level, "lost");
  });
});
