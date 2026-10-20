// Rev535: fixes from the third external review (servo baseline, sensor
// freshness, alarm mute / severity republish).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ServoHealthMonitor } from "../servo-health";
import { SensorQualityMonitor } from "../sensor-quality";
import { AlarmEngine } from "../alarms";

describe("Rev535: servo baseline does not learn an overload", () => {
  it("1 A baseline, 3 A for three minutes stays 'high'", () => {
    const m = new ServoHealthMonitor({ baselineSamples: 30 });
    const t0 = Date.now() - 400_000;
    let t = t0;
    const feed = (a: number, n: number) => { for (let i = 0; i < n; i++) { m.onSample({ ts: t, engaged: true, servoCurrent: a } as any); t += 1000; } };
    feed(1, 30);                // learn 1 A
    feed(3, 180);               // sustained overload
    // snapshot purges on Date.now(); move the samples so the window ends now
    const shift = Date.now() - t;
    (m as any).recent = (m as any).recent.map((e: any) => ({ ...e, ts: e.ts + shift }));
    const snap = m.snapshot();
    assert.equal(snap.status, "high", `status ${snap.status}, baseline ${(m as any).baselineA}`);
  });
});

describe("Rev535: sensor quality", () => {
  const watch = { "navigation.headingMagnetic": { label: "Heading", degradedAgeMs: 2000, lostAgeMs: 8000 } };
  it("a value with an hour-old timestamp is not fresh", () => {
    const q = new SensorQualityMonitor(watch as any);
    const now = Date.now();
    q.observe("navigation.headingMagnetic", { value: 1, timestamp: new Date(now - 3_600_000).toISOString() }, now);
    assert.equal(q.snapshot(now).items[0].level, "missing");
  });
  it("value null is not a reading", () => {
    const q = new SensorQualityMonitor(watch as any);
    const now = Date.now();
    q.observe("navigation.headingMagnetic", { value: null, timestamp: new Date(now).toISOString() }, now);
    assert.equal(q.snapshot(now).items[0].level, "missing");
  });
});

describe("Rev535: alarm mute and severity are published", () => {
  const rule = { id: "x", label: "X", severity: "alarm" as const, defaultEnabled: true, sustainSec: 0,
    description: "", evaluate: () => true, message: () => "same" };
  it("mute of a sounding alarm republishes it silenced", () => {
    const eng = new AlarmEngine([rule as any]);
    eng.tick({ nowMs: 1000 } as any);
    assert.ok(eng.mute("x", 60_000, 1500));
    assert.deepEqual(eng.tick({ nowMs: 2000 } as any), ["x"]);
    assert.notEqual(eng.ruleState("x")!.ackedAtMs, null, "sound dropped");
  });
  it("severity change of an active alarm republishes it", () => {
    const eng = new AlarmEngine([{ ...rule }] as any);
    eng.tick({ nowMs: 1000 } as any);
    eng.tick({ nowMs: 2000 } as any);
    assert.ok(eng.setRuleSeverity("x", "info"));
    assert.deepEqual(eng.tick({ nowMs: 3000 } as any), ["x"]);
  });
});
