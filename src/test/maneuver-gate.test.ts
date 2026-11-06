// Rev630 (sea trial 2026-11-05): the "visor manoeuvre running" flag, per
// manoeuvre id. See src/maneuver-gate.ts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ManeuverGate, MANEUVER_GATE_MAX } from "../maneuver-gate";

describe("ManeuverGate", () => {
  it("is off until a manoeuvre starts and off again when it ends", () => {
    const g = new ManeuverGate(180_000);
    assert.equal(g.active(0), false);
    g.update(true, "emp-1", 0);
    assert.equal(g.active(1000), true);
    g.update(false, "emp-1", 2000);
    assert.equal(g.active(2000), false);
  });

  it("expires when the visor stops renewing", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "emp-1", 0);
    assert.equal(g.active(179_999), true);
    assert.equal(g.active(180_000), false);
  });

  it("one visor ending its manoeuvre does not end another visor's", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "emp-1", 0);
    g.update(true, "apr-2", 0);
    g.update(false, "emp-1", 1000);
    assert.equal(g.active(1000), true);
    g.update(false, "apr-2", 1000);
    assert.equal(g.active(1000), false);
  });

  it("a visor without id (before Rev630) still works on its own entry", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, undefined, 0);
    assert.equal(g.active(0), true);
    g.update(true, "emp-1", 0);
    g.update(false, undefined, 0);
    assert.equal(g.active(0), true, "the id'd manoeuvre is untouched");
  });

  it("ignores messages that are not true/false and keeps a bounded size", () => {
    const g = new ManeuverGate(180_000);
    g.update("yes", "x", 0);
    assert.equal(g.active(0), false);
    for (let i = 0; i < MANEUVER_GATE_MAX + 10; i++) g.update(true, `m-${i}`, 0);
    for (let i = 0; i < MANEUVER_GATE_MAX + 10; i++) g.update(false, `m-${i}`, 0);
    assert.equal(g.active(0), false);
  });
});

describe("ManeuverGate - late messages (Rev633)", () => {
  it("a renewal that arrives after the end does not open the manoeuvre again", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "emp-1", 0);
    g.update(false, "emp-1", 1000);
    g.update(true, "emp-1", 2000);       // renewal sent before the end, late
    assert.equal(g.active(2000), false);
    assert.equal(g.active(181_999), false);
  });

  it("a new manoeuvre (new id) still opens it", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "emp-1", 0);
    g.update(false, "emp-1", 1000);
    g.update(true, "emp-2", 2000);
    assert.equal(g.active(2000), true);
  });
});

describe("ManeuverGate.kind (Rev634)", () => {
  it("names the running manoeuvre for every visor", () => {
    const g = new ManeuverGate(180_000);
    assert.equal(g.kind(0), null);
    g.update(true, "emp-1", 0);
    assert.equal(g.kind(0), "empopado");
    g.update(false, "emp-1", 0);
    g.update(true, "apr-2", 0);
    assert.equal(g.kind(0), "aproado");
    g.update(false, "apr-2", 0);
    g.update(true, undefined, 0);
    assert.equal(g.kind(0), "manoeuvre");
  });
});
