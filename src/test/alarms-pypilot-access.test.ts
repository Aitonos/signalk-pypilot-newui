// Rev640 (Carlos 2026-11-06): pypilot's Signal K access request waiting
// for approval is an alarm (pypilot drops its token when a Signal K
// restart answers 503, and nobody noticed for 40 min).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_RULES, type EvalContext } from "../alarms";

const rule = DEFAULT_RULES.find((r) => r.id === "pypilot-sk-access")!;
const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  sample: null, kpis: null, quality: null, servoHealth: null,
  connected: true, disconnectedSinceMs: null, nowMs: 1000, ...over,
});

describe("pypilot-sk-access alarm (Rev640)", () => {
  it("exists, is on by default, waits 30 s", () => {
    assert.ok(rule);
    assert.equal(rule.defaultEnabled, true);
    assert.equal(rule.sustainSec, 30);
  });

  it("fires only while pypilot's request is pending", () => {
    assert.equal(rule.evaluate(ctx({ pypilotAccessPending: true })), true);
    assert.equal(rule.evaluate(ctx({ pypilotAccessPending: false })), false);
    assert.equal(rule.evaluate(ctx()), false);
  });
});
