import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { wrapPi } from "../angles";
import { errorRad } from "../kpis";

describe("wrapPi (Rev575, GPT audit A07)", () => {
  it("wraps like the old loops for normal values", () => {
    const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
    close(wrapPi(0), 0);
    close(wrapPi(3 * Math.PI), Math.PI);
    close(wrapPi(-3 * Math.PI), -Math.PI);
    close(wrapPi(1.5 * Math.PI), -0.5 * Math.PI);
    close(wrapPi(-1.5 * Math.PI), 0.5 * Math.PI);
    assert.equal(wrapPi(Math.PI), Math.PI);
  });

  it("returns NaN for non-finite input and stays fast for huge values", () => {
    assert.ok(Number.isNaN(wrapPi(Infinity)));
    assert.ok(Number.isNaN(wrapPi(-Infinity)));
    assert.ok(Number.isNaN(wrapPi(NaN)));
    const t0 = Date.now();
    const v = wrapPi(1e300);
    assert.ok(Date.now() - t0 < 50);
    assert.ok(v >= -Math.PI && v <= Math.PI);
  });

  it("errorRad gives null instead of looping on Infinity", () => {
    const s: any = { headingCmd: Infinity, headingActual: 0, mode: "compass" };
    assert.equal(errorRad(s), null);
  });
});
