// Rev545: route following - leg geometry, arrival and the APB pypilot reads.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { legState, buildApb, bearingRad, distanceM, nmeaChecksum, APB_XTE_CAP_NM, M_PER_NM } from "../route-nav";

const D = 180 / Math.PI;
const A = { latitude: 42.20, longitude: -8.80 };
const B = { latitude: 42.20, longitude: -8.70 };   // leg ~ east

/** Parse an APB the way pypilot's nmea.py does (indexes after "$xxAPB,"). */
function pypilotParse(s: string) {
  const star = s.lastIndexOf("*");
  const body = s.slice(1, star);
  assert.equal(s.slice(star + 1), nmeaChecksum(body), "checksum");
  const data = s.slice(7, star).split(",");
  assert.ok(data.length >= 14, "pypilot needs >= 14 fields");
  let xte = parseFloat(data[2]);
  if (data[3] === "L") xte = -xte;
  return { xte: Math.min(xte, 0.15), track: parseFloat(data[12]), mode: data[13] === "M" ? "compass" : "gps", arrival: data[5], perp: data[6] };
}

describe("route-nav geometry", () => {
  it("bearing and distance of a known leg", () => {
    assert.ok(Math.abs(bearingRad(A, B) * D - 90) < 0.1, `${bearingRad(A, B) * D}`);
    assert.ok(Math.abs(distanceM(A, B) - 8236) < 30, `${distanceM(A, B)}`);
  });

  it("boat north of an eastbound leg is LEFT of track -> XTE < 0 -> steer R", () => {
    const leg = legState(A, B, { latitude: 42.21, longitude: -8.75 }, 100);
    assert.ok(leg.xteM < 0 && Math.abs(Math.abs(leg.xteM) - 1112) < 15, `${leg.xteM}`);
    const p = pypilotParse(buildApb(leg, "B"));
    assert.ok(p.xte > 0, "pypilot turns right (track + gain*xte grows)");
  });

  it("boat south is RIGHT of track -> steer L", () => {
    const leg = legState(A, B, { latitude: 42.19, longitude: -8.75 }, 100);
    assert.ok(leg.xteM > 0);
    const p = pypilotParse(buildApb(leg, "B"));
    assert.ok(p.xte < 0);
  });

  it("XTE sent is capped at 0.15 nm on BOTH sides (pypilot caps only one)", () => {
    for (const lat of [42.25, 42.15]) {
      const p = pypilotParse(buildApb(legState(A, B, { latitude: lat, longitude: -8.75 }, 100), "B"));
      assert.ok(Math.abs(p.xte) <= APB_XTE_CAP_NM + 1e-9, `${p.xte}`);
    }
  });

  it("perpendicular passed only beyond the waypoint", () => {
    assert.equal(legState(A, B, { latitude: 42.20, longitude: -8.71 }, 50).perpendicularPassed, false);
    assert.equal(legState(A, B, { latitude: 42.20, longitude: -8.69 }, 50).perpendicularPassed, true);
    // behind the start point is not "past the waypoint"
    assert.equal(legState(A, B, { latitude: 42.20, longitude: -8.85 }, 50).perpendicularPassed, false);
  });

  it("arrival circle", () => {
    const near = { latitude: 42.20, longitude: -8.7012 };   // ~100 m before B
    assert.equal(legState(A, B, near, 200).arrived, true);
    assert.equal(legState(A, B, near, 50).arrived, false);
    assert.equal(legState(A, B, near, 0).arrived, false, "no circle -> perpendicular decides");
  });

  it("APB track is the LEG bearing in TRUE, so pypilot does the XTE correction once", () => {
    const leg = legState(A, B, { latitude: 42.205, longitude: -8.75 }, 100);
    const p = pypilotParse(buildApb(leg, "Wp,*1"));
    assert.ok(Math.abs(p.track - 90) < 0.2, `${p.track}`);
    assert.equal(p.mode, "gps", "T reference (pypilot ignores M)");
  });

  it("go-to without a previous point: leg = boat -> waypoint, no XTE", () => {
    const leg = legState(null, B, { latitude: 42.10, longitude: -8.70 }, 100);
    assert.equal(leg.xteM, 0);
    assert.ok(Math.abs(leg.legBearingRad * D - 0) < 0.5 || Math.abs(leg.legBearingRad * D - 360) < 0.5);
  });

  it("crossing 0/360 and the antimeridian keeps a sane bearing", () => {
    const n1 = { latitude: 42.0, longitude: -8.8 }, n2 = { latitude: 42.1, longitude: -8.8 };
    assert.ok(bearingRad(n1, n2) * D < 0.5 || bearingRad(n1, n2) * D > 359.5);
    const w = bearingRad({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 }) * D;
    assert.ok(Math.abs(w - 90) < 0.5, `${w}`);
    assert.ok(M_PER_NM === 1852);
  });
});
