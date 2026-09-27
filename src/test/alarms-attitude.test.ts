import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AlarmEngine, EvalContext } from "../alarms";
import type { Sample } from "../historian";

const DEG = Math.PI / 180;

function mkSample(over: Partial<Sample> = {}): Sample {
  return {
    ts: Date.now(),
    headingCmd: 0, headingActual: 0, rudder: null,
    servoCurrent: null, servoTemp: null, servoMotorTemp: null, servoVoltage: null,
    awa: null, aws: null, twa: null, tws: null,
    sog: null, heel: null, pitch: null,
    engaged: true, mode: null,
    ...over,
  };
}

function mkCtx(sample: Sample | null, over: Partial<EvalContext> = {}): EvalContext {
  return {
    sample,
    kpis: null,
    quality: null,
    servoHealth: null,
    connected: true,
    disconnectedSinceMs: null,
    nowMs: Date.now(),
    ...over,
  };
}

describe("attitude-heel-extreme rule", () => {
  it("is disabled by default (opt-in envelope)", () => {
    const engine = new AlarmEngine();
    const rule = engine.describe().find(r => r.id === "attitude-heel-extreme");
    assert.ok(rule);
    assert.equal(rule!.enabled, false);
  });

  it("fires when heel exceeds default threshold sustained", () => {
    const engine = new AlarmEngine();
    engine.setEnabled("attitude-heel-extreme", true);
    const t0 = 10_000;
    // 46° stbd heel — above the 45° default. Sustain is 5s.
    for (let t = t0; t <= t0 + 6000; t += 1000) {
      engine.tick(mkCtx(mkSample({ heel: 46 * DEG }), { nowMs: t }));
    }
    const snap = engine.snapshot(t0 + 6000);
    const active = snap.active.find(a => a.ruleId === "attitude-heel-extreme");
    assert.ok(active, "attitude-heel-extreme should be active after sustain");
  });

  it("does not fire below threshold", () => {
    const engine = new AlarmEngine();
    engine.setEnabled("attitude-heel-extreme", true);
    const t0 = 10_000;
    for (let t = t0; t <= t0 + 6000; t += 1000) {
      engine.tick(mkCtx(mkSample({ heel: 30 * DEG }), { nowMs: t }));
    }
    const snap = engine.snapshot(t0 + 6000);
    assert.equal(snap.active.find(a => a.ruleId === "attitude-heel-extreme"), undefined);
  });

  it("respects per-install threshold override", () => {
    const engine = new AlarmEngine();
    engine.setEnabled("attitude-heel-extreme", true);
    const t0 = 10_000;
    // 32° heel with a 30° override → fires.
    for (let t = t0; t <= t0 + 6000; t += 1000) {
      engine.tick(mkCtx(mkSample({ heel: 32 * DEG }), {
        nowMs: t,
        thresholds: { attitudeHeelDeg: 30 },
      }));
    }
    assert.ok(engine.snapshot(t0 + 6000).active.find(a => a.ruleId === "attitude-heel-extreme"));
  });

  it("symmetric: port heel triggers just like stbd", () => {
    const engine = new AlarmEngine();
    engine.setEnabled("attitude-heel-extreme", true);
    const t0 = 10_000;
    for (let t = t0; t <= t0 + 6000; t += 1000) {
      engine.tick(mkCtx(mkSample({ heel: -46 * DEG }), { nowMs: t }));
    }
    assert.ok(engine.snapshot(t0 + 6000).active.find(a => a.ruleId === "attitude-heel-extreme"));
  });
});

describe("attitude-pitch-extreme rule", () => {
  it("is disabled by default", () => {
    const engine = new AlarmEngine();
    const rule = engine.describe().find(r => r.id === "attitude-pitch-extreme");
    assert.ok(rule);
    assert.equal(rule!.enabled, false);
  });

  it("fires when pitch exceeds default threshold sustained", () => {
    const engine = new AlarmEngine();
    engine.setEnabled("attitude-pitch-extreme", true);
    const t0 = 10_000;
    for (let t = t0; t <= t0 + 4000; t += 1000) {
      engine.tick(mkCtx(mkSample({ pitch: 26 * DEG }), { nowMs: t }));
    }
    assert.ok(engine.snapshot(t0 + 4000).active.find(a => a.ruleId === "attitude-pitch-extreme"));
  });

  it("does not fire when pitch is null (no IMU pitch stream)", () => {
    const engine = new AlarmEngine();
    engine.setEnabled("attitude-pitch-extreme", true);
    const t0 = 10_000;
    for (let t = t0; t <= t0 + 4000; t += 1000) {
      engine.tick(mkCtx(mkSample({ pitch: null }), { nowMs: t }));
    }
    assert.equal(engine.snapshot(t0 + 4000).active.find(a => a.ruleId === "attitude-pitch-extreme"), undefined);
  });
});
