import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DoctorEngine, DoctorResult } from "../doctor";
import { Historian } from "../historian";
import type { Sample } from "../historian";

const DEG = Math.PI / 180;

function mkSample(overrides: Partial<Sample>): Sample {
  return {
    ts: 0,
    headingCmd: 0,
    headingActual: 0,
    rudder: null,
    servoCurrent: 1.0,
    servoTemp: null,
    servoMotorTemp: null,
    servoVoltage: null,
    awa: null,
    aws: null,
    twa: null,
    tws: null,
    sog: null,
    heel: null,
    pitch: null,
    engaged: true,
    mode: "compass",
    ...overrides,
  };
}

/** Fill a historian with `n` samples ending now, 1 Hz, built by `f(i)`. */
function fill(n: number, f: (i: number) => Partial<Sample>): Historian {
  const h = new Historian({ capacitySamples: 600 });
  const now = Date.now();
  for (let i = 0; i < n; i += 1) {
    h.push(mkSample({ ts: now - (n - i) * 1000, ...f(i) }));
  }
  return h;
}

function analyze(h: Historian, plugin: { rollFfGain: number } | null = null): DoctorResult {
  const doc = new DoctorEngine(h, null, null, plugin ? () => plugin : null);
  const session = {
    id: "t", startedTs: Date.now() - 180_000, targetDurationSec: 180,
    pilotId: "basic", initialGains: { P: 0.003, I: 0.001, D: 0.09 }, originalProfile: "default",
  };
  return (doc as any).analyze(session) as DoctorResult;
}

describe("DoctorEngine servo duty (Rev564)", () => {
  it("counts duty over samples that carry a current reading only", () => {
    // 120 samples: half without current, the other half all drawing.
    // A 5° bias would normally suggest +I; duty is 100% of the known
    // half, so with RMS > 5° this is a hardware ceiling, no suggestion.
    const h = fill(120, (i) => ({
      headingActual: -6 * DEG,
      servoCurrent: i % 2 === 0 ? 2.0 : null,
    }));
    const r = analyze(h);
    assert.ok(r.findings.some((f) => f.category === "hardware-ceiling"), "duty must be 100% of the known samples");
    assert.equal(r.suggestions.length, 0);
  });

  it("suggests nothing when servo current is missing for most of the session", () => {
    const h = fill(120, (i) => ({
      headingActual: -6 * DEG,
      servoCurrent: i % 4 === 0 ? 0.0 : null,   // 25% coverage
    }));
    const r = analyze(h);
    assert.ok(r.findings.some((f) => f.category === "servo-unknown"));
    assert.equal(r.suggestions.length, 0);
  });

  it("still suggests +I for a bias when the servo has headroom", () => {
    const h = fill(120, () => ({ headingActual: -5 * DEG, servoCurrent: 0.0 }));
    const r = analyze(h);
    assert.ok(r.suggestions.some((s) => s.gainKey === "I"));
  });
});

describe("DoctorEngine downwind roll (Rev564)", () => {
  it("a steady heel without rolling is not reported as roll", () => {
    const h = fill(120, () => ({ twa: 150 * DEG, heel: 10 * DEG, servoCurrent: 0.0 }));
    const r = analyze(h, { rollFfGain: 0 });
    assert.ok(!r.findings.some((f) => f.category === "downwind-roll"));
  });

  it("a real roll around the mean is reported", () => {
    const h = fill(120, (i) => ({
      twa: 150 * DEG,
      heel: (5 + 10 * Math.sin(i * 2 * Math.PI / 6)) * DEG,
      servoCurrent: 0.0,
    }));
    const r = analyze(h, { rollFfGain: 0 });
    assert.ok(r.findings.some((f) => f.category === "downwind-roll"));
  });
});
