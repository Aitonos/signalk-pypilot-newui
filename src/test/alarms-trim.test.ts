import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AlarmEngine,
  DEFAULT_RULES,
  RULE_SERVO_OVERCURR_A,
  RULE_SERVO_TRIM_FRAC,
  RULE_RUDDER_TRIM_RAD,
  RULE_LOW_VOLTAGE_V,
  RULE_SERVO_TEMP_C,
  DEFAULT_MOTOR_TEMP_C,
  type EvalContext,
} from "../alarms";
import type { Sample } from "../historian";

function sample(over: Partial<Sample> = {}): Sample {
  return {
    ts: 0, headingCmd: 0, headingActual: 0,
    rudder: null, servoCurrent: null, servoTemp: null, servoMotorTemp: null,
    servoVoltage: null, awa: null, aws: null, twa: null, tws: null,
    sog: null, heel: null, pitch: null, engaged: true, mode: null,
    ...over,
  };
}

function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return {
    sample: sample(),
    kpis: null,
    quality: null,
    servoHealth: null,
    connected: true,
    disconnectedSinceMs: null,
    nowMs: 1000,
    ...over,
  };
}

function findRule(id: string): (typeof DEFAULT_RULES)[number] {
  const r = DEFAULT_RULES.find(x => x.id === id);
  if (!r) throw new Error(`rule ${id} not registered`);
  return r;
}

describe("E1 trim warnings — servo-current-trim", () => {
  const rule = findRule("servo-current-trim");

  it("info-severity by design (pre-fault, not fault)", () => {
    assert.equal(rule.severity, "info");
  });

  it("fires between the trim threshold and the overcurrent limit", () => {
    const trimA = RULE_SERVO_OVERCURR_A * RULE_SERVO_TRIM_FRAC;
    // Just above the trim threshold, below overcurrent → match.
    const c = ctx({ sample: sample({ servoCurrent: trimA + 0.1 }) });
    assert.equal(rule.evaluate(c), true);
  });

  it("does NOT fire below the trim threshold", () => {
    const trimA = RULE_SERVO_OVERCURR_A * RULE_SERVO_TRIM_FRAC;
    const c = ctx({ sample: sample({ servoCurrent: trimA - 0.1 }) });
    assert.equal(rule.evaluate(c), false);
  });

  it("backs off above the overcurrent limit (dedupes with fault rule)", () => {
    const c = ctx({ sample: sample({ servoCurrent: RULE_SERVO_OVERCURR_A + 1 }) });
    assert.equal(rule.evaluate(c), false);
  });

  it("does NOT fire with no current reading", () => {
    const c = ctx({ sample: sample({ servoCurrent: null }) });
    assert.equal(rule.evaluate(c), false);
  });

  it("message names the number and the limit", () => {
    const trimA = RULE_SERVO_OVERCURR_A * RULE_SERVO_TRIM_FRAC + 0.1;
    const msg = rule.message(ctx({ sample: sample({ servoCurrent: trimA }) }));
    assert.ok(msg.includes("A"), `message=${msg}`);
    assert.ok(msg.includes(RULE_SERVO_OVERCURR_A.toFixed(1)));
  });
});

describe("E1 trim warnings — rudder-range-trim", () => {
  const rule = findRule("rudder-range-trim");

  it("info-severity by design", () => {
    assert.equal(rule.severity, "info");
  });

  it("fires above the absolute rudder trim threshold", () => {
    const c = ctx({ sample: sample({ rudder: RULE_RUDDER_TRIM_RAD + 0.01 }) });
    assert.equal(rule.evaluate(c), true);
  });

  it("fires symmetrically on the port side", () => {
    const c = ctx({ sample: sample({ rudder: -(RULE_RUDDER_TRIM_RAD + 0.01) }) });
    assert.equal(rule.evaluate(c), true);
  });

  it("does NOT fire inside the safe band", () => {
    const c = ctx({ sample: sample({ rudder: RULE_RUDDER_TRIM_RAD - 0.01 }) });
    assert.equal(rule.evaluate(c), false);
  });

  it("does NOT fire with no rudder reading", () => {
    const c = ctx({ sample: sample({ rudder: null }) });
    assert.equal(rule.evaluate(c), false);
  });

  it("message names the side", () => {
    const msgStbd = rule.message(ctx({ sample: sample({ rudder: RULE_RUDDER_TRIM_RAD + 0.1 }) }));
    const msgPort = rule.message(ctx({ sample: sample({ rudder: -(RULE_RUDDER_TRIM_RAD + 0.1) }) }));
    assert.ok(msgStbd.toLowerCase().includes("stbd"));
    assert.ok(msgPort.toLowerCase().includes("port"));
  });
});

describe("E2/E3 configurable thresholds", () => {
  const lowVoltage = findRule("low-voltage");
  const servoTemp = findRule("servo-temp-high");
  const motorTemp = findRule("servo-motor-temp");

  it("low-voltage uses default when no override present", () => {
    const c = ctx({ sample: sample({ servoVoltage: RULE_LOW_VOLTAGE_V - 0.1 }) });
    assert.equal(lowVoltage.evaluate(c), true);
  });

  it("low-voltage honours a per-install override (higher trip point)", () => {
    // Boat with lithium bank might set 12.5V trip; 11.9V should fire.
    const c = ctx({
      sample: sample({ servoVoltage: 11.9 }),
      thresholds: { lowVoltageV: 12.5 },
    });
    assert.equal(lowVoltage.evaluate(c), true);
    // With the same voltage but default threshold, no fire.
    const c2 = ctx({ sample: sample({ servoVoltage: 11.9 }) });
    assert.equal(lowVoltage.evaluate(c2), false);
  });

  it("low-voltage honours a lower trip point (deep-cycle bank)", () => {
    const c = ctx({
      sample: sample({ servoVoltage: 10.5 }),
      thresholds: { lowVoltageV: 10.0 },
    });
    assert.equal(lowVoltage.evaluate(c), false);
  });

  it("servo-temp-high uses default when no override", () => {
    const c = ctx({ sample: sample({ servoTemp: RULE_SERVO_TEMP_C + 1 }) });
    assert.equal(servoTemp.evaluate(c), true);
  });

  it("servo-temp-high honours a stricter per-install threshold", () => {
    const c = ctx({
      sample: sample({ servoTemp: 55 }),
      thresholds: { servoTempC: 50 },
    });
    assert.equal(servoTemp.evaluate(c), true);
  });

  it("servo-motor-temp default is DEFAULT_MOTOR_TEMP_C", () => {
    const c = ctx({ sample: sample({ servoMotorTemp: DEFAULT_MOTOR_TEMP_C + 1 }) });
    assert.equal(motorTemp.evaluate(c), true);
    const c2 = ctx({ sample: sample({ servoMotorTemp: DEFAULT_MOTOR_TEMP_C - 1 }) });
    assert.equal(motorTemp.evaluate(c2), false);
  });

  it("servo-motor-temp honours override", () => {
    const c = ctx({
      sample: sample({ servoMotorTemp: 65 }),
      thresholds: { servoMotorTempC: 60 },
    });
    assert.equal(motorTemp.evaluate(c), true);
  });

  it("messages include the effective threshold value", () => {
    const c = ctx({
      sample: sample({ servoVoltage: 11.9 }),
      thresholds: { lowVoltageV: 12.5 },
    });
    const msg = lowVoltage.message(c);
    assert.ok(msg.includes("12.5"), `expected msg to include effective threshold; got: ${msg}`);
  });
});

describe("E1 trim warnings — engine integration", () => {
  it("AlarmEngine registers both rules with defaults enabled", () => {
    const engine = new AlarmEngine();
    const rules = engine.describe();
    const ids = new Set(rules.map((r: any) => r.id));
    assert.ok(ids.has("servo-current-trim"));
    assert.ok(ids.has("rudder-range-trim"));
  });

  it("engine.tick() activates trim rule after sustainSec", () => {
    const engine = new AlarmEngine();
    const trimA = RULE_SERVO_OVERCURR_A * RULE_SERVO_TRIM_FRAC + 0.1;
    // sustainSec for servo-current-trim is 5. Tick with 6 s of held condition.
    for (let ms = 0; ms < 5000; ms += 1000) {
      engine.tick(ctx({ sample: sample({ servoCurrent: trimA }), nowMs: ms }));
    }
    // Not yet active at ms=4000 (needs full 5s).
    let ruleState = engine.ruleState("servo-current-trim");
    assert.equal(ruleState?.active, false, "should not be active before 5s");
    engine.tick(ctx({ sample: sample({ servoCurrent: trimA }), nowMs: 5100 }));
    ruleState = engine.ruleState("servo-current-trim");
    assert.equal(ruleState?.active, true, "should be active after 5s");
    assert.equal(ruleState?.severity, "info");
  });
});
