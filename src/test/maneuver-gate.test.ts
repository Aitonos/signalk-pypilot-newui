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

describe("ManeuverGate.reconcile (Rev638)", () => {
  it("ends an Aproado whose visor vanished once pypilot left wind mode for 3 s", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "apr-1", 0);
    assert.deepEqual(g.reconcile(5_000, "compass", false), [], "grace while starting");
    assert.deepEqual(g.reconcile(10_000, "wind", true), []);
    assert.deepEqual(g.reconcile(11_000, "compass", true), []);
    assert.deepEqual(g.reconcile(13_999, "compass", true), []);
    assert.deepEqual(g.reconcile(14_000, "compass", true), ["apr-1"]);
    assert.equal(g.active(14_000), false);
    g.update(true, "apr-1", 15_000);       // a late renewal cannot reopen it
    assert.equal(g.active(15_000), false);
  });

  it("an AP off shorter than 3 s (stuck-pilot recovery) does not end it", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "emp-1", 0);
    g.reconcile(12_000, "true wind", false);
    g.reconcile(13_000, "true wind", true);
    g.reconcile(17_000, "true wind", true);
    assert.equal(g.kind(17_000), "empopado");
  });

  it("leaves entries without a known manoeuvre (old visors) alone", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, undefined, 0);
    assert.deepEqual(g.reconcile(60_000, "compass", false), []);
    assert.equal(g.active(60_000), true);
  });
});

describe("ManeuverGate hand-over and memory (Rev639)", () => {
  it("a hand-over ends the ids the other screen saw (Rev641)", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "apr-1", 0);
    g.update(true, "emp-2", 0);
    assert.deepEqual(g.ids(0).sort(), ["apr-1", "emp-2"]);
    g.endIds(["apr-1", "emp-2"], 1000);
    assert.equal(g.active(1000), false);
    assert.equal(g.update(true, "apr-1", 2000), "ended", "its owner learns it was ended");
    assert.equal(g.active(2000), false);
  });

  it("Rev641 (GPT #3): an owner that keeps renewing an ended id never brings it back", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "apr-1", 0);
    g.endIds(["apr-1"], 1000);
    for (let t = 20_000; t <= 400_000; t += 20_000) g.update(true, "apr-1", t);
    assert.equal(g.active(400_000), false);
  });

  it("Rev641 (GPT #4): a late hand-over does not end a manoeuvre started after it", () => {
    const g = new ManeuverGate(180_000);
    g.update(true, "apr-1", 0);
    g.update(false, "apr-1", 1000);       // A closed by its own visor
    g.update(true, "emp-2", 2000);        // B starts
    g.endIds(["apr-1"], 3000);            // the old hand-over arrives late
    assert.equal(g.kind(3000), "empopado");
  });

  it("evicted and expired entries leave nothing behind", () => {
    const g = new ManeuverGate(1000);
    for (let i = 0; i < 80; i++) g.update(true, `apr-${i}`, 0);
    assert.equal(g.active(5000), false);
    const sizes = (g as any).startedAt.size + (g as any).mismatchSince.size;
    assert.equal(sizes, 0);
  });
});
