// Rev508: steer-* alarm rules + unable-to-steer without servo duty.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_RULES, type EvalContext } from "../alarms";
import type { Sample } from "../historian";
import type { SteerWatchSnapshot } from "../steer-watch";

function sample(over: Partial<Sample> = {}): Sample {
  return {
    ts: 0, headingCmd: 0, headingActual: 0,
    rudder: null, servoCurrent: null, servoTemp: null, servoMotorTemp: null,
    servoVoltage: null, awa: null, aws: null, twa: null, tws: null,
    sog: null, heel: null, pitch: null, engaged: true, mode: "wind",
    ...over,
  };
}
const steer = (over: Partial<SteerWatchSnapshot> = {}): SteerWatchSnapshot => ({
  stuck: false, stuckSinceMs: null, gaveUp: false, cyclesInWindow: 0, lastCycleMs: null,
  droppedActive: false, droppedAtMs: null, dirFault: false, ...over,
});
function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return {
    sample: sample(), kpis: null, quality: null, servoHealth: null,
    connected: true, disconnectedSinceMs: null, nowMs: 1000, ...over,
  };
}
const kpis = (rmsDeg: number, duty: number | null) => ({
  window1m: { rmsErrorRad: rmsDeg * Math.PI / 180, servoDutyPct: duty },
}) as any;
const rule = (id: string) => {
  const r = DEFAULT_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`rule ${id} not registered`);
  return r;
};

describe("steer alarms (Rev508)", () => {
  it("new rules are opt-in (BASIC rule: every alarm OFF by default)", () => {
    for (const id of ["steer-stuck", "steer-gave-up", "steer-dropped"]) {
      assert.equal(rule(id).defaultEnabled, false, id);
      assert.equal(rule(id).severity, "alarm", id);
    }
  });

  it("steer-stuck fires while stuck, hands over to steer-gave-up", () => {
    assert.equal(rule("steer-stuck").evaluate(ctx({ steer: steer({ stuck: true }) })), true);
    assert.equal(rule("steer-stuck").evaluate(ctx({ steer: steer({ stuck: true, gaveUp: true }) })), false);
    assert.equal(rule("steer-gave-up").evaluate(ctx({ steer: steer({ stuck: true, gaveUp: true }) })), true);
    assert.equal(rule("steer-stuck").evaluate(ctx()), false);
  });

  it("steer-dropped follows the watcher", () => {
    assert.equal(rule("steer-dropped").evaluate(ctx({ steer: steer({ droppedActive: true }) })), true);
    assert.equal(rule("steer-dropped").evaluate(ctx({ steer: steer() })), false);
  });

  it("unable-to-steer now fires with null duty when the servo has a directional fault", () => {
    const r = rule("unable-to-steer");
    // 2026-10-18: duty null, RMS 40 deg, false end stop.
    assert.equal(r.evaluate(ctx({ kpis: kpis(40, null), steer: steer({ dirFault: true }) })), true);
    assert.match(r.message(ctx({ kpis: kpis(40, null), steer: steer({ dirFault: true }) })), /stopped by overcurrent/);
    // No fault and no duty: still silent (no evidence).
    assert.equal(r.evaluate(ctx({ kpis: kpis(40, null), steer: steer() })), false);
    // Legacy duty path unchanged.
    assert.equal(r.evaluate(ctx({ kpis: kpis(40, 0.8) })), true);
    assert.match(r.message(ctx({ kpis: kpis(40, 0.8) })), /: 40° error, servo 80% duty/);
    // Small error: silent even with a fault.
    assert.equal(r.evaluate(ctx({ kpis: kpis(10, null), steer: steer({ dirFault: true }) })), false);
    // Manoeuvre silence kept.
    assert.equal(r.evaluate(ctx({ kpis: kpis(40, null), steer: steer({ dirFault: true }), maneuverInProgress: true })), false);
  });
});
