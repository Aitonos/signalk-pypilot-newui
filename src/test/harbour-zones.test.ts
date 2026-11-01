import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { inAnyPolygon, inPolygon, zonePolygons, type Polygon } from "../harbour-zones";
import { VisorPrefs } from "../visor-prefs";

// ~1 km square around Moaña with a small hole in the middle.
const square: Polygon = [
  [[-8.742, 42.27], [-8.73, 42.27], [-8.73, 42.28], [-8.742, 42.28], [-8.742, 42.27]],
  [[-8.7372, 42.2745], [-8.7348, 42.2745], [-8.7348, 42.2755], [-8.7372, 42.2755], [-8.7372, 42.2745]],
];
const region = (zoneType: unknown, geometry: unknown = { type: "Polygon", coordinates: square }) =>
  ({ name: "x", feature: { type: "Feature", geometry, properties: { zoneType } } });

describe("harbour zones (Rev612)", () => {
  it("point inside, in a hole and outside", () => {
    assert.equal(inPolygon({ latitude: 42.272, longitude: -8.735 }, square), true);
    assert.equal(inPolygon({ latitude: 42.275, longitude: -8.736 }, square), false);
    assert.equal(inPolygon({ latitude: 42.29, longitude: -8.735 }, square), false);
  });

  it("keeps only harbour regions by default", () => {
    const polys = zonePolygons({ a: region("harbour"), b: region("mooringField"), c: region("berth"), d: { name: "bare" } });
    assert.equal(polys.length, 1);
  });

  it("reads MultiPolygon and skips malformed geometry", () => {
    assert.equal(zonePolygons({ a: region("harbour", { type: "MultiPolygon", coordinates: [square, square] }) }).length, 2);
    assert.equal(zonePolygons({ a: region("harbour", { type: "Polygon", coordinates: [[[1, 2]]] }), b: null }).length, 0);
    assert.equal(zonePolygons(undefined).length, 0);
  });

  it("no position or no zones is never inside", () => {
    assert.equal(inAnyPolygon(null, [square]), false);
    assert.equal(inAnyPolygon({ latitude: NaN, longitude: 1 }, [square]), false);
    assert.equal(inAnyPolygon({ latitude: 42.272, longitude: -8.735 }, []), false);
  });

  it("inside a harbour zone turns the AIS harbour mode on at once, and off on leaving", () => {
    const vp = new VisorPrefs(null);
    vp.update({ aisHarborAuto: true });
    assert.equal(vp.snapshot().harborActive, false);
    assert.equal(vp.setInHarbourZone(true), true);
    assert.equal(vp.snapshot().harborActive, true);
    assert.equal(vp.setInHarbourZone(true), false);
    vp.setInHarbourZone(false);
    assert.equal(vp.snapshot().harborActive, false);
  });

  it("the zone does nothing when the automatic harbour mode is off", () => {
    const vp = new VisorPrefs(null);
    vp.update({ aisHarborAuto: false });
    vp.setInHarbourZone(true);
    assert.equal(vp.snapshot().harborActive, false);
  });
});
