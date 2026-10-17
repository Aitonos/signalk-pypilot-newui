import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  VisorPrefs,
  HARBOR_ENTER_HOLD_MS,
  HARBOR_EXIT_HOLD_MS,
  AIS_ACK_TTL_MS,
} from "../visor-prefs";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "visor-prefs-")), "visor-prefs.json");
}

describe("VisorPrefs", () => {
  it("starts with the old per-browser defaults and not initialized", () => {
    const s = new VisorPrefs(null).snapshot();
    assert.equal(s.aisMode, "underway");
    assert.equal(s.aisVoice, true);
    assert.equal(s.aisHarborAuto, true);
    assert.equal(s.gustGhost, true);
    assert.equal(s.initialized, false);
    assert.deepEqual(s.aisAcks, {});
  });

  it("applies a valid partial update, ignores junk, persists across instances", () => {
    const f = tmpFile();
    const a = new VisorPrefs(f);
    const s = a.update({ aisMode: "anchor", gustGhost: false, aisVoice: "yes", bogus: 1, aisAcks: { "123456789": 9e15 } });
    assert.equal(s.aisMode, "anchor");
    assert.equal(s.gustGhost, false);
    assert.equal(s.aisVoice, true, "non-boolean ignored");
    assert.deepEqual(s.aisAcks, {}, "acks cannot be injected through update()");
    assert.equal(s.initialized, true);
    const b = new VisorPrefs(f).snapshot();
    assert.equal(b.aisMode, "anchor");
    assert.equal(b.gustGhost, false);
    assert.equal(b.initialized, true);
  });

  it("rejects an unknown AIS mode", () => {
    const s = new VisorPrefs(null).update({ aisMode: "panic" });
    assert.equal(s.aisMode, "underway");
  });

  it("ack / unack by MMSI with TTL, shared through the file", () => {
    const f = tmpFile();
    const t0 = 1_000_000;
    const a = new VisorPrefs(f);
    a.ack("244060022", AIS_ACK_TTL_MS, t0);
    a.ack("not-an-mmsi", AIS_ACK_TTL_MS, t0);
    let s = new VisorPrefs(f).snapshot(t0 + 1000);
    assert.deepEqual(Object.keys(s.aisAcks), ["244060022"]);
    s = new VisorPrefs(f).snapshot(t0 + AIS_ACK_TTL_MS + 1);
    assert.deepEqual(s.aisAcks, {}, "expired ack pruned");
    a.ack("244060022", AIS_ACK_TTL_MS, t0);
    a.ack("261010366", AIS_ACK_TTL_MS, t0);
    s = a.unack("244060022", t0 + 1);
    assert.deepEqual(Object.keys(s.aisAcks), ["261010366"]);
    s = a.unack("all", t0 + 2);
    assert.deepEqual(s.aisAcks, {});
  });

  it("harbour auto: enters after 2 min slow, exits after 30 s fast", () => {
    const p = new VisorPrefs(null);
    const t0 = 0;
    assert.equal(p.tickHarbor(0.1, t0), false);
    assert.equal(p.tickHarbor(0.1, t0 + HARBOR_ENTER_HOLD_MS - 1), false);
    assert.equal(p.tickHarbor(0.1, t0 + HARBOR_ENTER_HOLD_MS), true);
    assert.equal(p.snapshot().harborActive, true);
    const t1 = t0 + HARBOR_ENTER_HOLD_MS + 10;
    p.tickHarbor(1.0, t1);
    assert.equal(p.snapshot().harborActive, true, "still in harbour before the exit hold");
    assert.equal(p.tickHarbor(1.0, t1 + HARBOR_EXIT_HOLD_MS), true);
    assert.equal(p.snapshot().harborActive, false);
  });

  it("harbour auto off: never active and resets the machine", () => {
    const p = new VisorPrefs(null);
    p.tickHarbor(0, 0);
    p.tickHarbor(0, HARBOR_ENTER_HOLD_MS);
    assert.equal(p.snapshot().harborActive, true);
    p.update({ aisHarborAuto: false });
    assert.equal(p.snapshot().harborActive, false);
    assert.equal(p.tickHarbor(0, HARBOR_ENTER_HOLD_MS * 3), false);
  });
});
