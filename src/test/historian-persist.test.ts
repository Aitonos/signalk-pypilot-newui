import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Historian, Sample } from "../historian";

function sample(ts: number, sog: number): Sample {
  return {
    ts, headingCmd: null, headingActual: null, rudder: null,
    servoCurrent: null, servoTemp: null, servoMotorTemp: null, servoVoltage: null,
    awa: null, aws: null, twa: null, tws: null, sog, heel: null, pitch: null,
    engaged: false, mode: null,
  };
}

describe("historian across a restart (Rev618)", () => {
  it("what was dumped comes back in order and slices like before", () => {
    const now = Date.now();
    const a = new Historian({ capacitySamples: 120, samplePeriodMs: 1000 });
    for (let i = 60; i >= 1; i--) a.push(sample(now - i * 1000, i));
    const saved = JSON.parse(JSON.stringify(a.dump(now)));
    const b = new Historian({ capacitySamples: 120, samplePeriodMs: 1000 });
    assert.equal(b.restore(saved, now), 60);
    const rows = b.slice(120_000) as Sample[];
    assert.equal(rows.length, 60);
    assert.ok(rows.every((r, i) => i === 0 || r.ts > rows[i - 1].ts));
    assert.equal(rows[rows.length - 1].sog, 1);
  });

  it("drops samples older than one buffer span, from the future or malformed", () => {
    const now = Date.now();
    const h = new Historian({ capacitySamples: 60, samplePeriodMs: 1000 });
    const n = h.restore([
      sample(now - 120_000, 1),          // older than 60 s span
      sample(now + 60_000, 2),           // future (clock step)
      { ts: "x" }, null, 42,             // malformed
      sample(now - 10_000, 3),
    ], now);
    assert.equal(n, 1);
    assert.equal((h.slice(60_000) as Sample[])[0].sog, 3);
  });

  it("accepts a missing or broken file as empty", () => {
    const h = new Historian();
    assert.equal(h.restore(undefined), 0);
    assert.equal(h.restore({ not: "an array" }), 0);
  });
});
