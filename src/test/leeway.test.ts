import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LeewayEstimator } from "../leeway";

const DEG = Math.PI / 180;
const KN_PER_MS = 1.9438444924406046;

function kn(v: number): number { return v / KN_PER_MS; }
function deg(v: number): number { return v * DEG; }

describe("LeewayEstimator — envelope", () => {
  it("returns null when adj <= 0 (opt-in gate)", () => {
    const l = new LeewayEstimator({ adj: 0 });
    assert.equal(l.compute(deg(10), kn(6)), null);
  });

  it("returns null when heel is missing", () => {
    const l = new LeewayEstimator({ adj: 10 });
    assert.equal(l.compute(null, kn(6)), null);
    assert.equal(l.compute(NaN, kn(6)), null);
  });

  it("returns null when bsp is missing", () => {
    const l = new LeewayEstimator({ adj: 10 });
    assert.equal(l.compute(deg(10), null), null);
    assert.equal(l.compute(deg(10), NaN), null);
  });
});

describe("LeewayEstimator — formula", () => {
  it("classical formula: adj=10, heel=15deg, bsp=6kn ⇒ ~4.17°", () => {
    const l = new LeewayEstimator({ adj: 10, maxLeewayDeg: 20 });
    const out = l.compute(deg(15), kn(6));
    assert.ok(out != null);
    // drift_deg = 10 * 15 / 36 = 4.167°
    const outDeg = out! / DEG;
    assert.ok(Math.abs(outDeg - 4.167) < 0.01, `expected ~4.17°, got ${outDeg}`);
  });

  it("sign matches heel (stbd heel ⇒ positive leeway)", () => {
    const l = new LeewayEstimator({ adj: 10 });
    const stbd = l.compute(deg(10), kn(6));
    const port = l.compute(deg(-10), kn(6));
    assert.ok(stbd != null && port != null);
    assert.ok(stbd! > 0);
    assert.ok(port! < 0);
    assert.ok(Math.abs(stbd! + port!) < 1e-9, "symmetric around 0");
  });

  it("scales linearly with heel", () => {
    const l = new LeewayEstimator({ adj: 10 });
    const a = l.compute(deg(5), kn(6))!;
    const b = l.compute(deg(10), kn(6))!;
    assert.ok(Math.abs(b - 2 * a) < 1e-9, "heel doubles ⇒ drift doubles");
  });

  it("scales inversely with bsp squared", () => {
    const l = new LeewayEstimator({ adj: 10 });
    const at6 = l.compute(deg(10), kn(6))!;
    const at3 = l.compute(deg(10), kn(3))!;
    // bsp halves ⇒ drift * 4
    assert.ok(Math.abs(at3 - 4 * at6) < 1e-9, `expected ${4 * at6}, got ${at3}`);
  });
});

describe("LeewayEstimator — guardrails", () => {
  it("clamps bsp at minBspKn to avoid divide-by-zero explosion", () => {
    const l = new LeewayEstimator({ adj: 10, minBspKn: 1.0, maxLeewayDeg: 200 });
    // BSP 0.1 kn would give drift = 10 * 10 / 0.01 = 10000° without clamp
    const outAtZero = l.compute(deg(10), kn(0.1))!;
    const outAtMin = l.compute(deg(10), kn(1.0))!;
    assert.ok(Math.abs(outAtZero - outAtMin) < 1e-9,
      "below minBspKn should behave as if at minBspKn");
  });

  it("clamps output at ±maxLeewayDeg", () => {
    const l = new LeewayEstimator({ adj: 10, maxLeewayDeg: 20, minBspKn: 0.1 });
    // Force a huge drift: heel 30°, bsp 0.5 kn ⇒ 10*30/0.25 = 1200°
    const out = l.compute(deg(30), kn(0.5))!;
    const outDeg = out / DEG;
    assert.ok(Math.abs(outDeg) <= 20 + 1e-9, `expected |leeway| ≤ 20°, got ${outDeg}`);
    assert.equal(outDeg, 20, "positive heel ⇒ positive clamp");
  });

  it("returns 0 when heel is 0", () => {
    const l = new LeewayEstimator({ adj: 10 });
    assert.equal(l.compute(0, kn(6)), 0);
  });
});

describe("LeewayEstimator — runtime update", () => {
  it("update({adj}) turns the estimator on and off", () => {
    const l = new LeewayEstimator({ adj: 0 });
    assert.equal(l.compute(deg(10), kn(6)), null);
    l.update({ adj: 10 });
    assert.ok(l.compute(deg(10), kn(6)) != null);
    l.update({ adj: 0 });
    assert.equal(l.compute(deg(10), kn(6)), null);
  });
});
