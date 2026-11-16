// Rev710 (forum, Moeritsen 2026-11-16): the "pypilot disconnected" warning
// fired constantly with the TinyPilot switched off. It now fires only if the
// pilot was engaged at the loss or in the 5 minutes before, and its text is
// English like the other rules (it reaches Signal K / KIP as is).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_RULES, PYPILOT_DISC_ENGAGED_WINDOW_MS, type EvalContext } from "../alarms";

const rule = DEFAULT_RULES.find((r) => r.id === "pypilot-disconnected")!;
const LOST = 10_000_000;
const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  sample: null, kpis: null, quality: null, servoHealth: null,
  connected: false, disconnectedSinceMs: LOST, nowMs: LOST + 60_000, ...over,
});

describe("pypilot-disconnected alarm (Rev710)", () => {
  it("fires when the pilot was engaged at the loss", () => {
    assert.equal(rule.evaluate(ctx({ lastEngagedMs: LOST - 1000 })), true);
  });

  it("fires when it was engaged within 5 min before the loss", () => {
    assert.equal(rule.evaluate(ctx({ lastEngagedMs: LOST - PYPILOT_DISC_ENGAGED_WINDOW_MS })), true);
  });

  it("stays quiet if the pilot was never engaged or long ago", () => {
    assert.equal(rule.evaluate(ctx({ lastEngagedMs: null })), false);
    assert.equal(rule.evaluate(ctx()), false);
    assert.equal(rule.evaluate(ctx({ lastEngagedMs: LOST - PYPILOT_DISC_ENGAGED_WINDOW_MS - 1 })), false);
  });

  it("stays quiet while connected", () => {
    assert.equal(rule.evaluate(ctx({ connected: true, lastEngagedMs: LOST })), false);
  });

  it("speaks English with the seconds the visor turns into words", () => {
    assert.equal(rule.message!(ctx({ lastEngagedMs: LOST })), "pypilot disconnected for 60 s");
    for (const r of DEFAULT_RULES) assert.doesNotMatch(r.label, /desconectado|pide acceso|Escora|Cabeceo/, r.id);
  });
});
