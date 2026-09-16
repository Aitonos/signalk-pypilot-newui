import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ProfileAdvisor,
  DEFAULT_ADVISOR_OPTIONS,
  type KpiWindow,
} from "../profile-advisor";

const DEG = Math.PI / 180;

/** Build a KpiWindow with sensible defaults. */
function w(over: Partial<KpiWindow> = {}): KpiWindow {
  return {
    rmsErrorRad: 5 * DEG,
    servoDutyPct: 0.30,
    engagedSamples: 60,
    ...over,
  };
}

describe("ProfileAdvisor — bootstrap gate", () => {
  it("does not emit until minEngagedSamples is met", () => {
    const a = new ProfileAdvisor();
    for (let t = 0; t < 200_000; t += 1000) {
      const ev = a.onTick(t, w({ rmsErrorRad: 15 * DEG, engagedSamples: 10 }));
      assert.equal(ev, null);
    }
  });

  it("does not emit while rmsErrorRad is null", () => {
    const a = new ProfileAdvisor();
    for (let t = 0; t < 200_000; t += 1000) {
      assert.equal(a.onTick(t, w({ rmsErrorRad: null })), null);
    }
  });
});

describe("ProfileAdvisor — high-RMS branch", () => {
  it("does not emit before sustain window elapses", () => {
    const a = new ProfileAdvisor();
    // 60 s sustain default. Feed 59 s of high RMS.
    let ev = null;
    for (let t = 0; t <= 59_000; t += 1000) {
      ev = a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    }
    assert.equal(ev, null);
  });

  it("emits `consider-more-aggressive` exactly when the sustain elapses", () => {
    const a = new ProfileAdvisor();
    let ev = null;
    for (let t = 0; t < 60_000; t += 1000) {
      ev = a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
      assert.equal(ev, null, `unexpected emit at t=${t}`);
    }
    ev = a.onTick(60_000, w({ rmsErrorRad: 15 * DEG }));
    assert.ok(ev, "expected event at sustain end");
    assert.equal(ev!.kind, "consider-more-aggressive");
    assert.ok(ev!.metric.includes("rms="));
    assert.equal(ev!.messageKey, "advisor.moreAggressive");
    assert.equal(ev!.messageArgs.rms, "15.0");
  });

  it("intermittent good tracking resets the sustain timer", () => {
    const a = new ProfileAdvisor();
    // 30 s bad, 5 s good, 30 s bad → should NOT fire (60s cumulative but not continuous).
    for (let t = 0; t < 30_000; t += 1000) a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    for (let t = 30_000; t < 35_000; t += 1000) a.onTick(t, w({ rmsErrorRad: 5 * DEG }));
    let ev = null;
    for (let t = 35_000; t <= 64_000; t += 1000) {
      ev = a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    }
    assert.equal(ev, null);
  });

  it("respects cooldown after emitting", () => {
    const a = new ProfileAdvisor();
    for (let t = 0; t <= 60_000; t += 1000) a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    // Immediately after emission, another 60 s of bad RMS must not emit.
    let ev = null;
    for (let t = 61_000; t <= 121_000; t += 1000) {
      ev = a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    }
    assert.equal(ev, null, "cooldown breached");
  });

  it("emits again after cooldown expires", () => {
    const a = new ProfileAdvisor();
    for (let t = 0; t <= 60_000; t += 1000) a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    // Advance past cooldown (300 s) with still-bad RMS.
    let ev = null;
    for (let t = 61_000; t <= 420_000; t += 1000) {
      const got = a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
      if (got) { ev = got; break; }
    }
    assert.ok(ev, "expected fresh event after cooldown");
    assert.equal(ev!.kind, "consider-more-aggressive");
  });
});

describe("ProfileAdvisor — low-RMS / high-duty branch", () => {
  it("does not emit for low RMS alone (idle servo)", () => {
    const a = new ProfileAdvisor();
    let ev = null;
    for (let t = 0; t <= 120_000; t += 1000) {
      ev = a.onTick(t, w({ rmsErrorRad: 0.5 * DEG, servoDutyPct: 0.10 }));
    }
    assert.equal(ev, null);
  });

  it("emits `consider-less-aggressive` after sustain of low-RMS + high-duty", () => {
    const a = new ProfileAdvisor();
    let ev = null;
    for (let t = 0; t <= 60_000; t += 1000) {
      const got = a.onTick(t, w({ rmsErrorRad: 0.5 * DEG, servoDutyPct: 0.80 }));
      if (got) { ev = got; break; }
    }
    assert.ok(ev);
    assert.equal(ev!.kind, "consider-less-aggressive");
    assert.equal(ev!.messageArgs.duty, "80");
  });
});

describe("ProfileAdvisor — mutual exclusion", () => {
  it("high branch and low branch reset each other", () => {
    const a = new ProfileAdvisor();
    // 30s of high RMS.
    for (let t = 0; t < 30_000; t += 1000) a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    // Then 30s of low-and-active — high sustain should have been zeroed.
    // Even after that, the LOW branch has not sustained 60s yet.
    let ev: any = null;
    for (let t = 30_000; t < 60_000; t += 1000) {
      ev = a.onTick(t, w({ rmsErrorRad: 0.5 * DEG, servoDutyPct: 0.80 }));
    }
    assert.equal(ev, null, "should not emit yet");
    // Only from t=30_000 the low sustain starts; needs t≥90_000 to fire.
    for (let t = 60_000; t < 89_000; t += 1000) {
      ev = a.onTick(t, w({ rmsErrorRad: 0.5 * DEG, servoDutyPct: 0.80 }));
      assert.equal(ev, null);
    }
    ev = a.onTick(90_000, w({ rmsErrorRad: 0.5 * DEG, servoDutyPct: 0.80 }));
    assert.ok(ev);
    assert.equal(ev!.kind, "consider-less-aggressive");
  });
});

describe("ProfileAdvisor — status()", () => {
  it("cooldownRemainingMs is 0 before any emission and >0 immediately after", () => {
    const a = new ProfileAdvisor();
    assert.equal(a.status(0).cooldownRemainingMs, 0);
    for (let t = 0; t <= 60_000; t += 1000) a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    const s = a.status(60_000);
    assert.ok(s.cooldownRemainingMs > 0);
    assert.ok(s.lastEvent);
    assert.equal(s.lastEvent!.kind, "consider-more-aggressive");
  });

  it("reset() clears everything", () => {
    const a = new ProfileAdvisor();
    for (let t = 0; t <= 60_000; t += 1000) a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    a.reset();
    const s = a.status(60_000);
    assert.equal(s.cooldownRemainingMs, 0);
    assert.equal(s.lastEvent, null);
    assert.equal(s.highSinceMs, null);
    assert.equal(s.lowSinceMs, null);
  });
});

describe("ProfileAdvisor — options + update()", () => {
  it("update() takes effect on the next tick", () => {
    const a = new ProfileAdvisor({ sustainSec: 60 });
    // 30 s of bad — nothing yet.
    for (let t = 0; t < 30_000; t += 1000) a.onTick(t, w({ rmsErrorRad: 15 * DEG }));
    // Tighten sustain to 10 s. Since highSinceMs is 0 already, the
    // very next tick (t=30_000, which is 30_000 - 0 = 30_000 ms ≥ 10_000 ms)
    // should now qualify to emit.
    a.update({ sustainSec: 10 });
    const ev = a.onTick(30_000, w({ rmsErrorRad: 15 * DEG }));
    assert.ok(ev, "expected emission after tightening sustainSec");
  });

  it("defaults expose the documented values", () => {
    assert.equal(DEFAULT_ADVISOR_OPTIONS.rmsHighDeg, 10);
    assert.equal(DEFAULT_ADVISOR_OPTIONS.rmsLowDeg, 1);
    assert.equal(DEFAULT_ADVISOR_OPTIONS.dutyHighPct, 50);
    assert.equal(DEFAULT_ADVISOR_OPTIONS.sustainSec, 60);
    assert.equal(DEFAULT_ADVISOR_OPTIONS.cooldownSec, 300);
    assert.equal(DEFAULT_ADVISOR_OPTIONS.minEngagedSamples, 30);
  });
});
