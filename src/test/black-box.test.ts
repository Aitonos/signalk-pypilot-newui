// Rev525: autopilot black box.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BlackBox, BlackBoxSample, BB_MAX_FILES } from "../black-box";

const S = (ts: number, over: Partial<BlackBoxSample> = {}): BlackBoxSample => ({
  ts, mode: "wind", engaged: true, hdgDeg: 90, cmdDeg: 45, errDeg: 0, awaDeg: 45, twaDeg: 50,
  twsKn: 12, sogKn: 5, heelDeg: 10, servoA: 1, servoV: 13, flags: "SYNC", tackState: "none", vtPhase: null, ...over,
});

describe("black box (Rev525)", () => {
  it("saves one minute before and one after a trigger, merging close events", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-"));
    const bb = new BlackBox(dir);
    const t0 = Date.UTC(2026, 9, 20, 12, 0, 0);
    for (let s = 0; s < 90; s++) bb.push(S(t0 + s * 1000));            // 90 s of history
    const id = bb.trigger("steer-dropped", "AP off from the remote", t0 + 90_000)!;
    assert.ok(id);
    for (let s = 90; s < 120; s++) bb.push(S(t0 + s * 1000));
    assert.equal(bb.trigger("alarm", "steer-dropped alarm", t0 + 120_000), id, "same incident");
    for (let s = 120; s < 185; s++) bb.push(S(t0 + s * 1000));
    assert.equal(bb.isRecording(), false, "closed 60 s after the last event");
    const list = bb.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].events, 2);
    const inc = bb.get(list[0].id)!;
    assert.ok(inc.samples[0].ts <= t0 + 30_000 + 1000, "pre window starts ~60 s before");
    assert.ok(inc.samples[inc.samples.length - 1].ts >= t0 + 180_000, "post window 60 s after the last event");
    assert.equal(list[0].seen, false);
    assert.ok(bb.markSeen(list[0].id));
    assert.equal(bb.list()[0].seen, true, "seen survives on disk");
  });

  it("rate-limits the same kind when idle, never the Mark button", () => {
    const bb = new BlackBox(null);
    const t0 = 1_000_000;
    bb.push(S(t0));
    assert.ok(bb.trigger("overcurrent", "x", t0));
    bb.flush(t0 + 1000);
    assert.equal(bb.trigger("overcurrent", "x", t0 + 10_000), null);
    assert.ok(bb.trigger("mark", "sailor", t0 + 11_000));
    bb.flush(t0 + 12_000);
    assert.ok(bb.trigger("mark", "sailor", t0 + 13_000));
  });

  it("keeps the newest files only and rejects bad ids", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-"));
    const bb = new BlackBox(dir);
    let t = Date.UTC(2026, 9, 20, 0, 0, 0);
    for (let i = 0; i < BB_MAX_FILES + 5; i++) {
      bb.push(S(t));
      bb.trigger("mark", `m${i}`, t);
      bb.flush(t + 1000);
      t += 2000;
    }
    assert.equal(bb.list().length, BB_MAX_FILES);
    assert.equal(bb.get("../../etc/passwd"), null);
    assert.equal(bb.remove("../x"), false);
  });
});
