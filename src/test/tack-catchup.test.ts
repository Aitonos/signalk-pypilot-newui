import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TackCatchup } from "../tack-catchup";

const DEG = Math.PI / 180;

describe("TackCatchup — envelope", () => {
  it("returns 0 when offsetDeg = 0 (inert)", () => {
    const c = new TackCatchup({ offsetDeg: 0 });
    c.onTackComplete("port", 0);
    assert.equal(c.compute(0), 0);
    assert.equal(c.compute(1000), 0);
  });

  it("returns 0 before any tack is signalled", () => {
    const c = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    assert.equal(c.compute(0), 0);
    assert.equal(c.compute(1000), 0);
  });

  it("returns 0 after reset", () => {
    const c = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    c.onTackComplete("port", 0);
    assert.ok(c.compute(0) > 0);
    c.reset();
    assert.equal(c.compute(500), 0);
  });
});

describe("TackCatchup — decay", () => {
  it("peaks at offsetDeg immediately after tack completion", () => {
    const c = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    c.onTackComplete("port", 1000);
    const outRad = c.compute(1000);
    assert.ok(Math.abs(outRad - 5 * DEG) < 1e-9,
      `expected +5° at t=0, got ${outRad / DEG}°`);
  });

  it("decays exponentially with the configured tau", () => {
    const c = new TackCatchup({ offsetDeg: 10, tauSec: 5 });
    c.onTackComplete("port", 0);
    // At t = tau, offset should be 10° * exp(-1) ≈ 3.68°
    const outAtTau = c.compute(5000) / DEG;
    assert.ok(Math.abs(outAtTau - 10 * Math.exp(-1)) < 0.01,
      `expected ~3.68° at t=tau, got ${outAtTau}°`);
  });

  it("prunes to 0 once the residual is sub-degree noise", () => {
    const c = new TackCatchup({ offsetDeg: 5, tauSec: 2 });
    c.onTackComplete("port", 0);
    // At t = 10s (5 * tau), 5° * exp(-5) ≈ 0.034° → prune.
    assert.equal(c.compute(10_000), 0);
    assert.equal(c.isActive(), false);
  });
});

describe("TackCatchup — direction sign", () => {
  it("port tack → positive delta (bear off to stbd)", () => {
    const c = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    c.onTackComplete("port", 0);
    assert.ok(c.compute(0) > 0, "port tack should produce +delta");
  });

  it("stbd tack → negative delta (bear off to port)", () => {
    const c = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    c.onTackComplete("stbd", 0);
    assert.ok(c.compute(0) < 0, "stbd tack should produce -delta");
  });

  it("magnitudes match across tacks", () => {
    const p = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    const s = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    p.onTackComplete("port", 0);
    s.onTackComplete("stbd", 0);
    assert.ok(Math.abs(p.compute(2000) + s.compute(2000)) < 1e-9,
      "port and stbd deltas should be symmetric");
  });
});

describe("TackCatchup — successive tacks", () => {
  it("a fresh tack overrides an in-flight decay", () => {
    const c = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    c.onTackComplete("port", 0);
    // Halfway through the decay, tack again to stbd.
    c.onTackComplete("stbd", 3000);
    const outRad = c.compute(3000);
    assert.ok(Math.abs(outRad - (-5 * DEG)) < 1e-9,
      `expected -5° peak at new tack, got ${outRad / DEG}°`);
  });
});

describe("TackCatchup — runtime update", () => {
  it("setting offsetDeg to 0 cancels an in-flight decay", () => {
    const c = new TackCatchup({ offsetDeg: 5, tauSec: 6 });
    c.onTackComplete("port", 0);
    assert.ok(c.isActive());
    c.update({ offsetDeg: 0 });
    assert.equal(c.isActive(), false);
    assert.equal(c.compute(1000), 0);
  });
});
