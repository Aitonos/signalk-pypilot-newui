import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FailsafeBspResolver } from "../failsafe-bsp";

const KN_PER_MS = 1.9438444924406046;
function kn(v: number): number { return v / KN_PER_MS; }

describe("FailsafeBspResolver — priority ladder", () => {
  it("prefers BSP when present", () => {
    const r = new FailsafeBspResolver({ failSafeBspKn: 6 });
    const out = r.resolve(kn(5), kn(4.7));
    assert.equal(out.source, "bsp");
    assert.equal(out.valueMs, kn(5));
  });

  it("falls back to SOG when BSP missing", () => {
    const r = new FailsafeBspResolver({ failSafeBspKn: 6 });
    const out = r.resolve(null, kn(4.7));
    assert.equal(out.source, "sog");
    assert.equal(out.valueMs, kn(4.7));
  });

  it("falls back to failsafe when BSP and SOG both missing", () => {
    const r = new FailsafeBspResolver({ failSafeBspKn: 6 });
    const out = r.resolve(null, null);
    assert.equal(out.source, "failsafe");
    assert.ok(Math.abs(out.valueMs! - kn(6)) < 1e-9);
  });

  it("returns none when failsafe is 0 and both inputs missing", () => {
    const r = new FailsafeBspResolver({ failSafeBspKn: 0 });
    const out = r.resolve(null, null);
    assert.equal(out.source, "none");
    assert.equal(out.valueMs, null);
  });

  it("treats NaN as missing", () => {
    const r = new FailsafeBspResolver({ failSafeBspKn: 6 });
    const out = r.resolve(NaN, kn(4));
    assert.equal(out.source, "sog");
  });

  it("treats negative as missing (drift on speedo)", () => {
    const r = new FailsafeBspResolver({ failSafeBspKn: 6 });
    const out = r.resolve(-0.5, kn(4));
    assert.equal(out.source, "sog");
  });
});

describe("FailsafeBspResolver — runtime update", () => {
  it("update({failSafeBspKn}) turns the failsafe on and off", () => {
    const r = new FailsafeBspResolver({ failSafeBspKn: 0 });
    assert.equal(r.resolve(null, null).source, "none");
    r.update({ failSafeBspKn: 6 });
    assert.equal(r.resolve(null, null).source, "failsafe");
    r.update({ failSafeBspKn: 0 });
    assert.equal(r.resolve(null, null).source, "none");
  });
});
