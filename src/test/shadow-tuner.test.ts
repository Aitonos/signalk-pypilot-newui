import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ShadowTuner, incomparable } from "../shadow-tuner";
import type { NavDbRow } from "../nav-db";

function row(o: { res?: Partial<NavDbRow["res"]>; ctx?: Partial<NavDbRow["ctx"]>; ep?: Partial<NavDbRow["ep"]>; valid?: boolean; t0?: number } = {}): NavDbRow {
  return {
    type: "window", format: 1, rev: "T", t0: o.t0 ?? 0, t1: (o.t0 ?? 0) + 89_000, n: 90, valid: o.valid ?? true, why: [],
    ctx: {
      mode: "compass", pilot: "basic", profile: "default", gains: { P: 0.0165, D: 0.15, PR: 0.005 }, tack: "port",
      twsKn: 10, twsSdKn: 1, twaDeg: 140, awaDeg: -120, awsKn: 8, sogKn: 5,
      heelDeg: 8, rollSdDeg: 3, pitchSdDeg: 2, yawRateRmsDps: 2, ...(o.ctx || {}),
    },
    res: {
      errMeanDeg: 0, errRmsDeg: 2, errP95Deg: 4, crossings: 2, steadyPct: 100, servoDutyPct: 30, servoCoveragePct: 100,
      servoCurMeanA: 1, overcurrent: false, termsRms: {}, ...(o.res || {}),
    },
    ep: { n: 0, complete: 0, overshootMean: null, riseMeanSec: null, ...(o.ep || {}) },
  };
}

describe("ShadowTuner (Rev572)", () => {
  it("proposes nothing for a clean window", () => {
    const d = new ShadowTuner().decide(row());
    assert.equal(d.action, null);
    assert.equal(d.blocked, null);
  });

  it("oscillation: D +10 %", () => {
    const d = new ShadowTuner().decide(row({ res: { crossings: 12, errRmsDeg: 5 } }));
    assert.equal(d.action?.gain, "D");
    assert.equal(d.action?.pct, 10);
    assert.equal(d.action?.to, 0.165);
  });

  it("sustained offset: PR +10 %", () => {
    const d = new ShadowTuner().decide(row({ res: { errMeanDeg: -4 } }));
    assert.equal(d.action?.gain, "PR");
  });

  it("nervous servo: D -10 %", () => {
    const d = new ShadowTuner().decide(row({ res: { errRmsDeg: 1, servoDutyPct: 50 } }));
    assert.equal(d.action?.gain, "D");
    assert.equal(d.action?.dir, -1);
  });

  it("slow only with servo headroom", () => {
    assert.equal(new ShadowTuner().decide(row({ ep: { riseMeanSec: 12 } })).action?.gain, "P");
    assert.equal(new ShadowTuner().decide(row({ ep: { riseMeanSec: 12 }, res: { servoDutyPct: 70 } })).action, null);
  });

  it("never acts with the servo at its limit or unknown", () => {
    const a = new ShadowTuner().decide(row({ res: { servoDutyPct: 85, errRmsDeg: 8, crossings: 12 } }));
    assert.equal(a.action, null);
    assert.match(a.blocked || "", /limit/);
    const b = new ShadowTuner().decide(row({ res: { servoCoveragePct: 20, crossings: 12, errRmsDeg: 5 } }));
    assert.equal(b.action, null);
  });

  it("respects the pypilot range", () => {
    const t = new ShadowTuner({ range: () => ({ min: 0, max: 0.16 }) });
    const d = t.decide(row({ res: { crossings: 12, errRmsDeg: 5 } }));
    assert.equal(d.action, null);
    assert.match(d.blocked || "", /range/);
  });

  it("A/B/A is possible only after three comparable windows", () => {
    const t = new ShadowTuner();
    assert.equal(t.decide(row({ t0: 0 })).abaFeasible, false);
    assert.equal(t.decide(row({ t0: 90_000 })).comparablePrev, true);
    assert.equal(t.decide(row({ t0: 180_000 })).abaFeasible, true);
    const d = t.decide(row({ t0: 270_000, ctx: { twsKn: 15 } }));
    assert.equal(d.comparablePrev, false);
    assert.deepEqual(d.notComparableWhy, ["wind"]);
    assert.equal(d.abaFeasible, false);
  });

  it("calm sea is not a sea-state change", () => {
    assert.deepEqual(incomparable(row({ ctx: { rollSdDeg: 0.2 } }), row({ ctx: { rollSdDeg: 0.6 } })), []);
    assert.deepEqual(incomparable(row({ ctx: { rollSdDeg: 3 } }), row({ ctx: { rollSdDeg: 6 } })), ["sea"]);
  });
});

describe("ShadowTuner contiguity (Rev574, audit #C)", () => {
  it("windows far apart in time are not comparable nor an A/B/A", () => {
    const t = new ShadowTuner();
    t.decide(row({ t0: 0 }));
    const later = { ...row({ t0: 3_600_000 }), t1: 3_689_000 };
    assert.equal(t.decide(later).comparablePrev, null);
    const next = { ...row({ t0: 3_690_000 }), t1: 3_779_000 };
    assert.equal(t.decide(next).abaFeasible, false, "the first of the three is an hour earlier");
  });
});

describe("ShadowTuner (Rev579, GPT audit A04/A05)", () => {
  it("A04: different boat speed or angle to the wind is not comparable", () => {
    assert.ok(incomparable(row(), row({ ctx: { sogKn: 12 } })).includes("speed"));
    assert.ok(incomparable(row(), row({ ctx: { twaDeg: 60 } })).includes("wind angle"));
    assert.deepEqual(incomparable(row({ ctx: { twaDeg: 178 } }), row({ ctx: { twaDeg: -175 } })), [], "wraps around 180");
    assert.ok(incomparable(row(), row({ ctx: { twsKn: null } })).includes("wind"));
  });

  it("A05: no proposal that changes nothing (gain at 0)", () => {
    const d = new ShadowTuner().decide(row({ ctx: { gains: { P: 0.0165, D: 0.15, PR: 0 } }, res: { errMeanDeg: 5 } }));
    assert.equal(d.action, null);
    assert.match(d.blocked || "", /does not change/);
  });
});
