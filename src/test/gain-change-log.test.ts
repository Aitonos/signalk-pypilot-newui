import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GainChangeLog } from "../gain-change-log";

const D = "ap.pilot.basic.D";

describe("GainChangeLog (Rev568)", () => {
  it("credits a planned write to its source at once", () => {
    const g = new GainChangeLog();
    g.observe(D, 0.09, 0);
    g.markPlannedWrite(D, 0.108, "gust-boost", "gust", 1000);
    const c = g.observe(D, 0.108, 1200);
    assert.equal(c?.source, "gust-boost");
    assert.equal(c?.from, 0.09);
    assert.equal(c?.reason, "gust");
  });

  it("matches a write pypilot rounded", () => {
    const g = new GainChangeLog();
    g.observe(D, 0.09, 0);
    g.markPlannedWrite(D, 0.1080001, "user", "Tune", 1000);
    assert.equal(g.observe(D, 0.108, 1100)?.source, "user");
  });

  it("an unclaimed change comes out as external after 3 s", () => {
    const g = new GainChangeLog();
    g.observe(D, 0.09, 0);
    assert.equal(g.observe(D, 0.1, 10_000), null);
    assert.deepEqual(g.drain(11_000), []);
    const out = g.drain(13_100);
    assert.equal(out.length, 1);
    assert.equal(out[0].source, "external");
  });

  it("gains that move with a profile switch are not separate changes", () => {
    const g = new GainChangeLog();
    g.observe(D, 0.09, 0);
    g.observe("ap.pilot.basic.P", 0.003, 0);
    // pypilot may send the new gains just before the new profile name...
    g.observe(D, 0.12, 10_000);
    g.noteProfileChange(10_200);
    // ...or just after it.
    assert.equal(g.observe("ap.pilot.basic.P", 0.004, 10_400), null);
    assert.deepEqual(g.drain(20_000), []);
  });

  it("the Doctor's gain write right after its profile fork is still logged", () => {
    const g = new GainChangeLog();
    g.observe("ap.pilot.basic.I", 0.001, 0);
    g.noteProfileChange(5000);
    g.markPlannedWrite("ap.pilot.basic.I", 0.0012, "doctor", "Doctor I +20 %", 5300);
    assert.equal(g.observe("ap.pilot.basic.I", 0.0012, 5500)?.source, "doctor");
  });

  it("ignores non-gain paths and the first value seen", () => {
    const g = new GainChangeLog();
    assert.equal(g.observe("ap.heading_command", 120, 0), null);
    assert.equal(g.observe(D, 0.09, 0), null);
  });
});
