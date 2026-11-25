// Rev772: tacks and gybes in the logbook.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectManoeuvres } from "../manoeuvres";

const D = Math.PI / 180;
const KN = 1 / 1.943844;
// one sample every 5 s; wind from 0 deg; the boat sails `hdg`
function leg(t0: number, secs: number, hdg: (t: number) => number, sogKn = 5, twaNoise = (_t: number) => 0) {
  const out = [];
  for (let t = 0; t < secs; t += 5) {
    const h = hdg(t);
    let twa = -h + twaNoise(t);            // wind from 0: TWA = 0 - heading
    twa = ((twa + 540) % 360) - 180;
    out.push({ ts: t0 + t * 1000, heading: ((h % 360) + 360) % 360 * D, twa: twa * D, sog: sogKn * KN });
  }
  return out;
}

describe("logbook tacks and gybes (Rev772)", () => {
  it("a real tack: 45 -> 315 (wind 0) is one tack", () => {
    const s = [...leg(0, 300, () => 45), ...leg(300_000, 20, (t) => 45 - t * 4.5), ...leg(320_000, 300, () => 315)];
    const ev = detectManoeuvres(s);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].kind, "tack");
    assert.ok(ev[0].turnDeg >= 80);
  });

  it("a gybe: 150 -> 210 is one gybe", () => {
    const s = [...leg(0, 300, () => 150), ...leg(300_000, 300, () => 210)];
    const ev = detectManoeuvres(s);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].kind, "gybe");
  });

  it("small course changes and a wandering vane in light air are not tacks", () => {
    // close-hauled at 30 deg TWA, heading +-10 deg, the wind swinging +-60 deg
    const s = leg(0, 1800, (t) => 30 + 10 * Math.sin(t / 40), 3, (t) => 60 * Math.sin(t / 25));
    assert.equal(detectManoeuvres(s).length, 0);
  });

  it("drifting in port (SOG 0.3 kn) with the wind flipping sides is not a tack", () => {
    const s = [...leg(0, 300, () => 45, 0.3), ...leg(300_000, 300, () => 315, 0.3)];
    assert.equal(detectManoeuvres(s).length, 0);
  });

  it("a short excursion to the other side (under 45 s) is not a tack", () => {
    const s = [...leg(0, 300, () => 45), ...leg(300_000, 30, () => 315), ...leg(330_000, 300, () => 45)];
    assert.equal(detectManoeuvres(s).length, 0);
  });
});
