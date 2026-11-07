// Rev648 (Carlos 2026-11-06): pause / resume / discard the trip in progress.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TripRecorder, TripSample } from "../trip-recorder";

const sample = (ts: number, lat: number): TripSample => ({
  ts, lat, lon: -8.8, sog: 2.5, cog: 0, heading: 0, tws: 6, twa: 0.8, aws: 7, awa: 0.6,
  heel: 0.1, rudder: null, depth: 10, servoCur: 1, servoVolt: 13, engaged: true, mode: "wind", state: "sailing",
});
const newRec = () => new TripRecorder({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "trip-")), flushIntervalMs: 3_600_000 } as any);

describe("trip controls (Rev648)", () => {
  it("while paused no sample, no distance and no time count; the jump on resume is not joined", () => {
    const r = newRec();
    r.start({ navStateAtStart: "sailing", gainsAtStart: null, revision: "test" });
    const id = r.currentTripId()!;
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) r.sample(sample(t0 + i * 1000, 42.27 + i * 0.0001));
    const before = r.summary(id) as any;
    assert.ok(r.pause(t0 + 30_000));
    assert.equal(r.isPaused(), true);
    assert.equal(r.pause(t0 + 31_000), false, "already paused");
    for (let i = 30; i < 60; i++) r.sample(sample(t0 + i * 1000, 42.30 + i * 0.0001));
    const during = r.summary(id) as any;
    assert.equal(during.sampleCount, 30);
    assert.equal(during.distanceNm, before.distanceNm);
    assert.ok(r.resume(t0 + 60_000));   // explicit times: on a fast CI runner pause and resume fell in the same ms
    r.sample(sample(t0 + 61_000, 42.40));          // 7 nm away: not joined
    const after = r.summary(id) as any;
    assert.equal(after.distanceNm, before.distanceNm);
    assert.ok(typeof after.pausedMs === "number");
    r.flushNow();
    const kinds = fs.readFileSync(r.jsonlPath(id), "utf8").trim().split("\n").map((l) => JSON.parse(l).type);
    assert.ok(kinds.includes("pause") && kinds.includes("resume"));
    r.discardCurrent();
  });

  it("discard throws the trip in progress away, files included", () => {
    const r = newRec();
    r.start({ navStateAtStart: "sailing", gainsAtStart: null, revision: "test" });
    const id = r.currentTripId()!;
    r.sample(sample(Date.now(), 42.27));
    r.flushNow();
    const file = r.jsonlPath(id);
    assert.ok(fs.existsSync(file));
    assert.ok(r.discardCurrent());
    assert.equal(r.isRecording(), false);
    assert.equal(fs.existsSync(file), false);
    assert.equal(r.discardCurrent(), false, "nothing left to discard");
  });
});
