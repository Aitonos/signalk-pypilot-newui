import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ServoErrorLog, SERVO_FAULT_RULE_IDS } from "../servo-error-log";
import type { AlarmSnapshot } from "../alarms";
import type { Sample } from "../historian";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "servo-err-log-"));
}

function mkSnapshot(active: Array<{ ruleId: string; label?: string; severity?: string; message?: string; activeSinceMs?: number }>): AlarmSnapshot {
  return {
    computedTs: Date.now(),
    active: active.map(a => ({
      ruleId: a.ruleId,
      label: a.label ?? a.ruleId,
      severity: (a.severity ?? "alarm") as any,
      message: a.message ?? "",
      activeSinceMs: a.activeSinceMs ?? Date.now(),
      ackedAtMs: null,
    })),
    recent: [],
  };
}

function mkSample(over: Partial<Sample> = {}): Sample {
  return {
    ts: Date.now(), headingCmd: 0, headingActual: 0,
    rudder: null, servoCurrent: null, servoTemp: null, servoMotorTemp: null,
    servoVoltage: null, awa: null, aws: null, twa: null, tws: null,
    sog: null, heel: null, engaged: true, mode: null,
    ...over,
  };
}

describe("ServoErrorLog — transitions", () => {
  it("records a fresh servo-overcurrent event", () => {
    const dir = tmpDir();
    const samples: Sample[] = [
      mkSample({ ts: 1000, servoCurrent: 3.0, servoTemp: 40 }),
      mkSample({ ts: 2000, servoCurrent: 6.5, servoTemp: 55 }),
    ];
    const log = new ServoErrorLog({ dataDir: dir, getRecentSamples: () => samples });
    // Off → nothing captured.
    log.observeAlarms(mkSnapshot([]));
    assert.equal(log.entries().length, 0);
    // Transition to active.
    log.observeAlarms(mkSnapshot([{ ruleId: "servo-overcurrent", message: "6.5A > 5A" }]));
    const entries = log.entries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ruleId, "servo-overcurrent");
    assert.equal(entries[0].peak.maxServoA, 6.5);
    assert.equal(entries[0].peak.samples, 2);
  });

  it("does NOT duplicate an entry while the alarm stays active", () => {
    const dir = tmpDir();
    const log = new ServoErrorLog({ dataDir: dir, getRecentSamples: () => [] });
    const snap = mkSnapshot([{ ruleId: "servo-motor-temp" }]);
    log.observeAlarms(snap);
    log.observeAlarms(snap);
    log.observeAlarms(snap);
    assert.equal(log.entries().length, 1);
  });

  it("captures a NEW event after off → on → off → on cycle", () => {
    const dir = tmpDir();
    const log = new ServoErrorLog({ dataDir: dir, getRecentSamples: () => [] });
    log.observeAlarms(mkSnapshot([{ ruleId: "servo-overcurrent", activeSinceMs: 1000 }]));
    log.observeAlarms(mkSnapshot([]));
    log.observeAlarms(mkSnapshot([{ ruleId: "servo-overcurrent", activeSinceMs: 5000 }]));
    assert.equal(log.entries().length, 2);
  });

  it("ignores non-servo alarms", () => {
    const dir = tmpDir();
    const log = new ServoErrorLog({ dataDir: dir, getRecentSamples: () => [] });
    log.observeAlarms(mkSnapshot([{ ruleId: "heading-deviation" }]));
    log.observeAlarms(mkSnapshot([{ ruleId: "pypilot-disconnected" }]));
    assert.equal(log.entries().length, 0);
    // Confirms the whitelist.
    assert.equal(SERVO_FAULT_RULE_IDS.has("heading-deviation"), false);
    assert.equal(SERVO_FAULT_RULE_IDS.has("servo-overcurrent"), true);
  });
});

describe("ServoErrorLog — persistence", () => {
  it("appends each event to the JSONL file", () => {
    const dir = tmpDir();
    const log = new ServoErrorLog({ dataDir: dir, getRecentSamples: () => [] });
    log.observeAlarms(mkSnapshot([{ ruleId: "servo-overcurrent" }]));
    const file = path.join(dir, "servo-error-log.jsonl");
    assert.ok(fs.existsSync(file));
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.ruleId, "servo-overcurrent");
  });

  it("loads existing entries from disk on start", () => {
    const dir = tmpDir();
    // Pre-seed the file.
    const seed = {
      ts: 1000, ruleId: "servo-overcurrent", label: "L", severity: "alarm", message: "m",
      peak: { maxServoA: 7, maxControllerC: null, maxMotorC: null, minVoltageV: null, maxHeadingErrRad: null, samples: 0, windowSec: 30 },
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "servo-error-log.jsonl"), JSON.stringify(seed) + "\n");
    const log = new ServoErrorLog({ dataDir: dir, getRecentSamples: () => [] });
    assert.equal(log.entries().length, 1);
    assert.equal(log.entries()[0].peak.maxServoA, 7);
  });

  it("clear() removes RAM entries and disk file", () => {
    const dir = tmpDir();
    const log = new ServoErrorLog({ dataDir: dir, getRecentSamples: () => [] });
    log.observeAlarms(mkSnapshot([{ ruleId: "servo-overcurrent" }]));
    log.clear();
    assert.equal(log.entries().length, 0);
    assert.equal(fs.existsSync(path.join(dir, "servo-error-log.jsonl")), false);
  });

  it("ring capacity trims oldest RAM entries", () => {
    const dir = tmpDir();
    const log = new ServoErrorLog({ dataDir: dir, ringCapacity: 3, getRecentSamples: () => [] });
    for (let i = 0; i < 5; i += 1) {
      log.observeAlarms(mkSnapshot([{ ruleId: "servo-overcurrent", activeSinceMs: 1000 + i * 1000 }]));
      log.observeAlarms(mkSnapshot([]));
    }
    assert.equal(log.entries().length, 3);
    // Oldest kept should be the 3rd event (ts=3000).
    assert.equal(log.entries()[0].ts, 3000);
  });
});
