// Rev748: heading deviation after big target changes, and light wind.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CourseChangeWatch, DEFAULT_RULES, LIGHT_WIND_SWITCH_NOTICE_MS } from "../alarms";

const D = Math.PI / 180;
const rule = (id: string) => DEFAULT_RULES.find((r) => r.id === id)!;

describe("course change grace (Rev748, sea trial 2026-11-23 16:27)", () => {
  it("a +90 target change turned at 3 deg/s: settling until the RMS minute is clean", () => {
    const w = new CourseChangeWatch();
    let t = 0;
    // steady on 17
    for (let i = 0; i < 5; i += 1, t += 1000) assert.equal(w.update(t, 17 * D, "compass", 0, true), false);
    // target 107, boat turns 3 deg/s
    let hdg = 17;
    const seen: boolean[] = [];
    for (let i = 0; i < 100; i += 1, t += 1000) {
      hdg = Math.min(107, hdg + 3);
      seen.push(w.update(t, 107 * D, "compass", (107 - hdg) * D, true));
    }
    assert.ok(seen.slice(0, 95).every(Boolean), "settling while turning and for the RMS minute");
  });

  it("a boat that does not turn gets no grace", () => {
    const w = new CourseChangeWatch();
    w.update(0, 17 * D, "compass", 0, true);
    let last = true;
    for (let i = 1; i <= 30; i += 1) last = w.update(i * 1000, 107 * D, "compass", 90 * D, true);
    assert.equal(last, false);
  });

  it("small corrections are not a course change; disengaged resets", () => {
    const w = new CourseChangeWatch();
    w.update(0, 100 * D, "compass", 0, true);
    assert.equal(w.update(1000, 105 * D, "compass", 5 * D, true), false);
    assert.equal(w.update(2000, 200 * D, "compass", 95 * D, false), false);
  });

  it("heading deviation and drift stay quiet while settling", () => {
    const ctx: any = {
      sample: { engaged: true, mode: "compass" },
      kpis: { window1m: { rmsErrorRad: 40 * D, meanErrorRad: 30 * D } },
      courseChangeSettling: true, nowMs: 0,
    };
    assert.equal(rule("heading-deviation").evaluate(ctx), false);
    assert.equal(rule("cruise-drift").evaluate(ctx), false);
    ctx.courseChangeSettling = false;
    assert.equal(rule("heading-deviation").evaluate(ctx), true);
  });
});

describe("light wind (Rev748)", () => {
  const base = (over: any = {}) => ({
    sample: { engaged: true, mode: "wind" }, nowMs: 1_000_000,
    lightWind: { kn: 2.5, thresholdKn: 4 }, ...over,
  });
  it("is off by default", () => assert.equal(rule("light-wind").defaultEnabled, false));
  it("fires under the threshold in wind modes only, engaged", () => {
    assert.equal(rule("light-wind").evaluate(base() as any), true);
    assert.equal(rule("light-wind").evaluate(base({ lightWind: { kn: 5, thresholdKn: 4 } }) as any), false);
    assert.equal(rule("light-wind").evaluate(base({ sample: { engaged: true, mode: "compass" } }) as any), false);
    assert.equal(rule("light-wind").evaluate(base({ sample: { engaged: false, mode: "wind" } }) as any), false);
    assert.equal(rule("light-wind").evaluate(base({ lightWind: { kn: null, thresholdKn: 4 } }) as any), false);
    assert.equal(rule("light-wind").evaluate(base({ maneuverInProgress: true }) as any), false);
  });
  it("after the compass switch it says so for two minutes", () => {
    const c: any = base({ sample: { engaged: true, mode: "compass" },
      lightWind: { kn: 2.5, thresholdKn: 4, switchedAtMs: 1_000_000 - 1000, switchedHdgDeg: 123.4 } });
    assert.equal(rule("light-wind").evaluate(c), true);
    assert.match(rule("light-wind").message(c), /switched to compass at 123°/);
    c.nowMs += LIGHT_WIND_SWITCH_NOTICE_MS;
    assert.equal(rule("light-wind").evaluate(c), false);
  });
});
