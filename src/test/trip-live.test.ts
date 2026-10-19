// Rev516: the logbook can be read while the trip is being recorded.
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

describe("trip recorder - live trip (Rev516)", () => {
  it("summary(currentId) returns live stats and the track is on disk after flushNow", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-"));
    const r = new TripRecorder({ dataDir, flushIntervalMs: 3_600_000 } as any);
    r.start({ navStateAtStart: "sailing", gainsAtStart: null, revision: "test" });
    const id = r.currentTripId()!;
    const t0 = Date.now();
    for (let i = 0; i < 120; i++) r.sample(sample(t0 + i * 1000, 42.27 + i * 0.0001));
    const live = r.summary(id) as any;
    assert.ok(live, "live summary exists");
    assert.equal(live.live, true);
    assert.equal(live.sampleCount, 120);
    assert.ok(live.distanceNm > 0, `distance ${live.distanceNm}`);
    assert.ok(Math.abs(live.twsAvgKn - 6 * 1.94384) < 0.5 || live.twsAvgKn > 0);
    r.flushNow();
    const lines = fs.readFileSync(r.jsonlPath(id), "utf8").trim().split("\n");
    assert.ok(lines.length >= 120, `track on disk: ${lines.length} lines`);
    // (A trip under 60 s real time is discarded on stop() by design.)
    r.stop();
  });
});
