// Persistent log of servo-related fault events.
//
// The AlarmEngine already detects overcurrent / motor-temp /
// controller-temp / low-voltage in real time and shows a banner. What
// this module adds:
//   1. A durable per-fault record (JSONL, one line per event) so the
//      user can review "what tripped last month" after a reboot.
//   2. A snapshot of the pre-fault telemetry (30 s at 1 Hz by default,
//      taken from the historian) so we can see what led up to the
//      event, not just the moment it fired.
//
// Runtime behaviour:
//   - The plugin's sampler tick calls `observeAlarms(snapshot)` after
//     evaluating the alarms. The log detects off→on transitions of a
//     configured subset of rules (servo-*, low-voltage) and stores an
//     entry.
//   - Entries are appended to `<dataDir>/servo-error-log.jsonl`.
//   - On start-up we read up to `initialLoadCap` most-recent lines so
//     the visor sees history that predates this plugin uptime.
//   - No rotation: the file grows slowly (few dozen entries per
//     season on a healthy install). If it ever bloats, we add a
//     rotate-by-size pass; not needed for a first cut.

import * as fs from "fs";
import * as path from "path";
import type { AlarmSnapshot } from "./alarms";
import type { Sample } from "./historian";

/** IDs of AlarmEngine rules we treat as "servo faults" for logging. */
export const SERVO_FAULT_RULE_IDS = new Set<string>([
  "servo-overcurrent",
  "servo-temp-high",
  "servo-motor-temp",
  "low-voltage",
]);

export interface ServoErrorEntry {
  ts: number;
  ruleId: string;
  label: string;
  severity: string;
  message: string;
  /** Compact peak summary of the pre-fault window (context). */
  peak: {
    maxServoA: number | null;
    maxControllerC: number | null;
    maxMotorC: number | null;
    minVoltageV: number | null;
    maxHeadingErrRad: number | null;
    /** Number of pre-fault samples that fed the summary. */
    samples: number;
    /** How wide the window was, seconds. */
    windowSec: number;
  };
}

export interface ServoErrorLogOptions {
  /** Base directory. Log lives at <dataDir>/servo-error-log.jsonl. */
  dataDir: string;
  /** Pre-fault window duration in seconds. Default 30. */
  contextWindowSec?: number;
  /** Max entries kept in RAM (older ones stay on disk). Default 200. */
  ringCapacity?: number;
  /** How many trailing lines to load from disk on start. Default 50. */
  initialLoadCap?: number;
  /** Optional logger for diagnostics; falls back to no-op. */
  log?: (level: string, msg: string) => void;
  /** Provider of pre-fault samples. Called with the desired window in ms. */
  getRecentSamples?: (windowMs: number) => Sample[];
}

export class ServoErrorLog {
  private readonly opts: Required<Omit<ServoErrorLogOptions, "log" | "getRecentSamples">>
    & Pick<ServoErrorLogOptions, "log" | "getRecentSamples">;
  private readonly file: string;
  private readonly ring: ServoErrorEntry[] = [];
  private lastActive = new Set<string>();

  constructor(opts: ServoErrorLogOptions) {
    this.opts = {
      dataDir: opts.dataDir,
      contextWindowSec: Math.max(1, opts.contextWindowSec ?? 30),
      ringCapacity: Math.max(1, opts.ringCapacity ?? 200),
      initialLoadCap: Math.max(0, opts.initialLoadCap ?? 50),
      log: opts.log,
      getRecentSamples: opts.getRecentSamples,
    };
    this.file = path.join(this.opts.dataDir, "servo-error-log.jsonl");
    this.loadFromDisk();
  }

  /** Call once per tick with the current alarm snapshot. Detects
   *  rules whose id belongs to SERVO_FAULT_RULE_IDS and that just
   *  transitioned to active. */
  observeAlarms(snap: AlarmSnapshot): void {
    const now = new Set<string>();
    for (const a of snap.active) if (SERVO_FAULT_RULE_IDS.has(a.ruleId)) now.add(a.ruleId);
    // Fresh transitions: id in now but not in lastActive.
    for (const id of now) {
      if (this.lastActive.has(id)) continue;
      const a = snap.active.find(x => x.ruleId === id);
      if (!a) continue;
      const entry = this.buildEntry(a, snap.computedTs);
      this.append(entry);
    }
    this.lastActive = now;
  }

  /** Read-only list of entries in RAM (newest last). */
  entries(): ServoErrorEntry[] {
    return this.ring.slice();
  }

  /** Delete every entry (RAM + disk). Used from the visor via
   *  POST /servo-error-log/clear. */
  clear(): void {
    this.ring.length = 0;
    this.lastActive.clear();
    try {
      if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    } catch (e: any) {
      this.opts.log?.("warn", `[servo-error-log] clear failed: ${e?.message || e}`);
    }
  }

  // -------- internals --------

  private buildEntry(a: AlarmSnapshot["active"][0], nowMs: number): ServoErrorEntry {
    const windowMs = this.opts.contextWindowSec * 1000;
    const samples = this.opts.getRecentSamples?.(windowMs) ?? [];
    let maxA: number | null = null;
    let maxCtl: number | null = null;
    let maxMotor: number | null = null;
    let minV: number | null = null;
    let maxErr: number | null = null;
    for (const s of samples) {
      if (typeof s.servoCurrent === "number" && (maxA == null || s.servoCurrent > maxA)) maxA = s.servoCurrent;
      if (typeof s.servoTemp === "number"   && (maxCtl == null || s.servoTemp > maxCtl)) maxCtl = s.servoTemp;
      if (typeof s.servoMotorTemp === "number" && (maxMotor == null || s.servoMotorTemp > maxMotor)) maxMotor = s.servoMotorTemp;
      if (typeof s.servoVoltage === "number" && (minV == null || s.servoVoltage < minV)) minV = s.servoVoltage;
      if (typeof s.headingCmd === "number" && typeof s.headingActual === "number") {
        const e = Math.abs(wrapPi(s.headingCmd - s.headingActual));
        if (maxErr == null || e > maxErr) maxErr = e;
      }
    }
    return {
      ts: a.activeSinceMs || nowMs,
      ruleId: a.ruleId,
      label: a.label,
      severity: a.severity,
      message: a.message,
      peak: {
        maxServoA: maxA,
        maxControllerC: maxCtl,
        maxMotorC: maxMotor,
        minVoltageV: minV,
        maxHeadingErrRad: maxErr,
        samples: samples.length,
        windowSec: this.opts.contextWindowSec,
      },
    };
  }

  private append(entry: ServoErrorEntry): void {
    this.ring.push(entry);
    while (this.ring.length > this.opts.ringCapacity) this.ring.shift();
    try {
      fs.mkdirSync(this.opts.dataDir, { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf8");
    } catch (e: any) {
      this.opts.log?.("error", `[servo-error-log] append failed: ${e?.message || e}`);
    }
  }

  private loadFromDisk(): void {
    if (this.opts.initialLoadCap <= 0) return;
    let content: string;
    try {
      if (!fs.existsSync(this.file)) return;
      content = fs.readFileSync(this.file, "utf8");
    } catch (e: any) {
      this.opts.log?.("warn", `[servo-error-log] read failed: ${e?.message || e}`);
      return;
    }
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    const tail = lines.slice(-this.opts.initialLoadCap);
    for (const line of tail) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed.ts === "number" && typeof parsed.ruleId === "string") {
          this.ring.push(parsed as ServoErrorEntry);
        }
      } catch { /* skip malformed line */ }
    }
  }
}

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}
