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

/** Minimal pypilot stand-in: values change only when "pypilot" echoes
 *  them back, `echoMs` after the write (never if echo is false). */
function fakeClient(init: Record<string, unknown>, opts: { echo?: boolean; echoMs?: number } = {}) {
  const values: Record<string, unknown> = { ...init };
  const echo = opts.echo ?? true;
  return {
    values,
    getValues: () => values,
    getCatalog: () => ({}),
    set: (name: string, v: unknown) => {
      if (echo || name === "profile") setTimeout(() => { values[name] = v; }, opts.echoMs ?? 20);
      return true;
    },
  };
}

const GAINS = { "ap.pilot": "basic", "profile": "default", "ap.pilot.basic.P": 0.003, "ap.pilot.basic.I": 0.001, "ap.pilot.basic.D": 0.09 };

/** A finished diagnostic with a +I suggestion, ready to apply. */
function diagnosed(client: ReturnType<typeof fakeClient>) {
  const h = fill(120, () => ({ headingActual: -5 * DEG, servoCurrent: 0.0 }));
  const doc = new DoctorEngine(h, client as any);
  const session = {
    id: "t", startedTs: Date.now() - 180_000, targetDurationSec: 180,
    pilotId: "basic", initialGains: { P: 0.003, I: 0.001, D: 0.09 }, originalProfile: "default",
  };
  const r = (doc as any).analyze(session) as DoctorResult;
  (doc as any).result = r;
  const sug = r.suggestions.find((s) => s.gainKey === "I");
  assert.ok(sug, "expected a +I suggestion");
  return { doc, sug: sug! };
}

describe("DoctorEngine configuration checks (Rev566)", () => {
  it("does not suggest from a window that mixes two modes", () => {
    const h = fill(120, (i) => ({ headingActual: -5 * DEG, servoCurrent: 0.0, mode: i < 60 ? "compass" : "gps" }));
    const r = analyze(h);
    assert.ok(r.findings.some((f) => f.category === "config-changed"));
    assert.equal(r.suggestions.length, 0);
  });

  it("does not suggest when the gains changed during the session", () => {
    const h = fill(120, () => ({ headingActual: -5 * DEG, servoCurrent: 0.0 }));
    const c = fakeClient({ ...GAINS, "ap.pilot.basic.I": 0.002 });
    const doc = new DoctorEngine(h, c as any);
    const r = (doc as any).analyze({
      id: "t", startedTs: Date.now() - 180_000, targetDurationSec: 180,
      pilotId: "basic", initialGains: { P: 0.003, I: 0.001, D: 0.09 }, originalProfile: "default",
    }) as DoctorResult;
    assert.ok(r.findings.some((f) => f.category === "config-changed"));
    assert.equal(r.suggestions.length, 0);
  });
});

describe("DoctorEngine apply (Rev566)", () => {
  it("refuses when the profile changed since the diagnostic", async () => {
    const c = fakeClient(GAINS);
    const { doc, sug } = diagnosed(c);
    c.values["profile"] = "heavy";
    const res = await doc.applySuggestion(sug.id);
    assert.equal(res.ok, false);
    assert.match(res.message, /Profile changed/);
  });

  it("refuses when the gain is no longer the measured one", async () => {
    const c = fakeClient(GAINS);
    const { doc, sug } = diagnosed(c);
    c.values["ap.pilot.basic.I"] = 0.0015;
    const res = await doc.applySuggestion(sug.id);
    assert.equal(res.ok, false);
    assert.equal(sug.applied, false);
  });

  it("marks applied only after pypilot reports the new value", async () => {
    const c = fakeClient(GAINS, { echoMs: 200 });
    const { doc, sug } = diagnosed(c);
    const res = await doc.applySuggestion(sug.id);
    assert.equal(res.ok, true, res.message);
    assert.equal(sug.applied, true);
    assert.equal(c.values["ap.pilot.basic.I"], sug.suggestedValue);
  });

  it("does not mark applied when pypilot never confirms", async () => {
    const c = fakeClient(GAINS, { echo: false });
    const { doc, sug } = diagnosed(c);
    const res = await doc.applySuggestion(sug.id);
    assert.equal(res.ok, false);
    assert.match(res.message, /did not confirm/);
    assert.equal(sug.applied, false);
  });

  it("serialises two applies arriving together", async () => {
    const c = fakeClient(GAINS, { echoMs: 100 });
    const { doc, sug } = diagnosed(c);
    const [a, b] = await Promise.all([doc.applySuggestion(sug.id), doc.applySuggestion(sug.id)]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
  });
});

describe("DoctorEngine (Rev577, GPT audit A08/B04)", () => {
  it("A08: a reset while the profile fork is pending stops cleanly, no TypeError", async () => {
    const c = fakeClient(GAINS, { echoMs: 300 });
    const { doc, sug } = diagnosed(c);
    const p = doc.applySuggestion(sug.id);
    doc.reset();
    const res = await p;
    assert.equal(res.ok, false);
    assert.match(res.message, /reset/);
    assert.equal(c.values["ap.pilot.basic.I"], 0.001, "nothing written");
  });

  it("refuses to start a new diagnostic while a gain is being applied", async () => {
    const c = fakeClient({ ...GAINS, "ap.enabled": true }, { echoMs: 300 });
    const { doc, sug } = diagnosed(c);
    const p = doc.applySuggestion(sug.id);
    assert.equal(doc.start(60).ok, false);
    await p;
  });

  it("B04: a setup changed and changed back during the session is seen", () => {
    const h = fill(120, () => ({ headingActual: -5 * DEG, servoCurrent: 0.0 }));
    const c = fakeClient(GAINS);
    const doc = new DoctorEngine(h, c as any);
    let gen = 7;
    doc.setConfigGenerationAccessor(() => gen);
    const session = {
      id: "t", startedTs: Date.now() - 180_000, targetDurationSec: 180,
      pilotId: "basic", initialGains: { P: 0.003, I: 0.001, D: 0.09 }, originalProfile: "default", configGen: 7,
    };
    gen = 9;   // A -> B -> A: profile and gains look the same at the end
    const r = (doc as any).analyze(session) as DoctorResult;
    assert.ok(r.findings.some((f) => f.category === "config-changed"));
    assert.equal(r.suggestions.length, 0);
  });
});
