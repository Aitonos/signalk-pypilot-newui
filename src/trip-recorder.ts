// Rev178 (Carlos): trip recorder.
//
// A "trip" is the interval during which `navigation.state` (published by
// signalk-autostate or any compatible plugin) is anything except
// "moored". Transition FROM moored -> underway/sailing opens a trip,
// transition BACK TO moored closes it and emits a summary.
//
// Output layout under <dataDir>/trips/
//   - trip-<yyyymmdd>-<hhmmss>-<epochSuffix>.jsonl   raw per-second samples
//   - trip-<...>.summary.json                        computed KPIs
//
// The JSONL is the source of truth. The summary is derived and can be
// re-computed offline from the JSONL if the summary logic evolves.
//
// Trip samples carry a superset of what the session recorder writes,
// because a trip is not gated on AP engagement - it covers motor legs,
// tender rides and sailing all in one file.

import * as fs from "fs";
import * as path from "path";

export interface TripSample {
  ts: number;
  lat: number | null;
  lon: number | null;
  sog: number | null;       // m/s
  cog: number | null;       // rad
  heading: number | null;   // rad
  tws: number | null;       // m/s
  twa: number | null;       // rad, signed
  aws: number | null;       // m/s
  awa: number | null;       // rad, signed
  heel: number | null;      // rad
  rudder: number | null;    // rad
  depth: number | null;     // m below transducer
  servoCur: number | null;  // A
  servoVolt: number | null; // V
  engaged: boolean;
  mode: string | null;
  state: string | null;     // navigation.state at this tick
}

export interface TripHeader {
  navStateAtStart: string;
  gainsAtStart: Record<string, number> | null;
  revision: string;
}

export interface TripSummary {
  id: string;
  startTs: number;
  endTs: number;
  durationMs: number;
  distanceNm: number;

  // Wind
  twsAvgKn: number | null;
  twsMaxKn: number | null;
  awsAvgKn: number | null;
  awsMaxKn: number | null;
  twaAvgDeg: number | null;

  // Boat motion
  sogAvgKn: number | null;
  sogMaxKn: number | null;
  heelAvgDeg: number | null;
  heelMaxDeg: number | null;

  // Points of sail (only counted while sailing, |AWA| makes sense)
  pctUpwind: number | null;   // |AWA| < 65
  pctReach:  number | null;   // 65..110
  pctDownwind: number | null; // > 110

  // Maneuvers
  tacks: number;

  // Battery health
  voltAvgV: number | null;
  voltMinV: number | null;
  voltSagsBelow115: number;   // discrete events < 11.5 V

  // Highlights (offsets into the jsonl by ts)
  peakWindTs: number | null;
  peakWindKn: number | null;
  peakSogTs: number | null;
  peakSogKn: number | null;
  minVoltTs: number | null;
  minVoltV: number | null;

  // AP context
  pctEngaged: number;
  modeShare: Record<string, number>;

  // Meta
  navStateAtStart: string;
  revision: string;
  sampleCount: number;
}

interface Options {
  dataDir: string;
  log?: (level: string, msg: string) => void;
  flushIntervalMs?: number;
}

const RAD2DEG = 180 / Math.PI;
const MS_TO_KN = 1.94384;

export class TripRecorder {
  private dir: string;
  private log: (level: string, msg: string) => void;
  private flushMs: number;
  private currentFile: string | null = null;
  private currentSummaryFile: string | null = null;
  private currentId: string | null = null;
  private header: TripHeader | null = null;
  private startTs: number | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private sampleCount = 0;

  // Rolling stats accumulated live so stop() is cheap.
  private twsSum = 0; private twsN = 0; private twsMax: number | null = null;
  private awsSum = 0; private awsN = 0; private awsMax: number | null = null;
  private twaSum = 0; private twaN = 0;
  private sogSum = 0; private sogN = 0; private sogMax: number | null = null;
  private heelSumAbs = 0; private heelN = 0; private heelMaxAbs: number | null = null;
  private upwindN = 0; private reachN = 0; private downwindN = 0; private polN = 0;
  private tackCount = 0; private lastAwaSign = 0; private lastTackSignFlipTs = 0;
  private voltSum = 0; private voltN = 0; private voltMin: number | null = null;
  private voltInSag = false; private voltSags = 0;
  private engagedTicks = 0; private allTicks = 0;
  private modeShareTicks: Record<string, number> = {};
  private lastLat: number | null = null; private lastLon: number | null = null;
  private lastPosTs = 0;
  private distanceMeters = 0;
  private peakWindTs: number | null = null; private peakWindKn: number | null = null;
  private peakSogTs: number | null = null; private peakSogKn: number | null = null;
  private minVoltTs: number | null = null; private minVoltTracked: number | null = null;

  constructor(opts: Options) {
    this.dir = path.join(opts.dataDir, "trips");
    this.flushMs = opts.flushIntervalMs ?? 30000;
    this.log = opts.log ?? (() => {});
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch { /* silent */ }
  }

  isRecording(): boolean { return this.currentFile != null; }
  currentTripId(): string | null { return this.currentId; }
  currentStartTs(): number | null { return this.startTs; }
  currentSampleCount(): number { return this.sampleCount; }

  start(header: TripHeader): void {
    if (this.currentFile) return;
    const now = new Date();
    const yy = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const suffix = String(Date.now() % 100000).padStart(5, "0");
    this.currentId = `${yy}${mo}${dd}-${hh}${mi}${ss}-${suffix}`;
    this.currentFile = path.join(this.dir, `trip-${this.currentId}.jsonl`);
    this.currentSummaryFile = path.join(this.dir, `trip-${this.currentId}.summary.json`);
    this.startTs = Date.now();
    this.header = header;
    this.sampleCount = 0;
    this._resetStats();
    const headerLine = JSON.stringify({
      type: "header",
      tripId: this.currentId,
      startTs: this.startTs,
      navStateAtStart: header.navStateAtStart,
      gainsAtStart: header.gainsAtStart,
      revision: header.revision,
    });
    this.buffer.push(headerLine);
    this.flush();
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => this.flush(), this.flushMs);
    if (typeof (this.flushTimer as NodeJS.Timeout & { unref?: () => void }).unref === "function") {
      (this.flushTimer as NodeJS.Timeout & { unref: () => void }).unref();
    }
    this.log("info", `[trip] started ${this.currentId} nav=${header.navStateAtStart}`);
  }

  sample(s: TripSample): void {
    if (!this.currentFile) return;
    this.buffer.push(JSON.stringify({ type: "sample", ...s }));
    this.sampleCount += 1;
    this.allTicks += 1;
    // Live-accumulate KPIs so stop() is O(1).
    if (typeof s.tws === "number") {
      const kn = s.tws * MS_TO_KN;
      this.twsSum += kn; this.twsN += 1;
      if (this.twsMax == null || kn > this.twsMax) { this.twsMax = kn; this.peakWindTs = s.ts; this.peakWindKn = kn; }
    }
    if (typeof s.aws === "number") {
      const kn = s.aws * MS_TO_KN;
      this.awsSum += kn; this.awsN += 1;
      if (this.awsMax == null || kn > this.awsMax) this.awsMax = kn;
    }
    if (typeof s.twa === "number") {
      this.twaSum += Math.abs(s.twa * RAD2DEG); this.twaN += 1;
    }
    if (typeof s.sog === "number") {
      const kn = s.sog * MS_TO_KN;
      this.sogSum += kn; this.sogN += 1;
      if (this.sogMax == null || kn > this.sogMax) { this.sogMax = kn; this.peakSogTs = s.ts; this.peakSogKn = kn; }
    }
    if (typeof s.heel === "number") {
      const deg = Math.abs(s.heel * RAD2DEG);
      this.heelSumAbs += deg; this.heelN += 1;
      if (this.heelMaxAbs == null || deg > this.heelMaxAbs) this.heelMaxAbs = deg;
    }
    if (typeof s.awa === "number") {
      const abs = Math.abs(s.awa * RAD2DEG);
      if (abs < 65) this.upwindN += 1;
      else if (abs < 110) this.reachN += 1;
      else this.downwindN += 1;
      this.polN += 1;
      // Sustained sign-flip = tack. Require >= 8 s since last flip so
      // choppy AWA does not inflate the counter.
      const sgn = s.awa > 0.05 ? 1 : (s.awa < -0.05 ? -1 : 0);
      if (sgn !== 0 && this.lastAwaSign !== 0 && sgn !== this.lastAwaSign
          && s.ts - this.lastTackSignFlipTs > 8000) {
        this.tackCount += 1;
        this.lastTackSignFlipTs = s.ts;
      }
      if (sgn !== 0) this.lastAwaSign = sgn;
    }
    if (typeof s.servoVolt === "number") {
      this.voltSum += s.servoVolt; this.voltN += 1;
      if (this.voltMin == null || s.servoVolt < this.voltMin) { this.voltMin = s.servoVolt; this.minVoltTs = s.ts; this.minVoltTracked = s.servoVolt; }
      // Sag counter: enter < 11.5, exit >= 11.5.
      if (s.servoVolt < 11.5 && !this.voltInSag) { this.voltInSag = true; this.voltSags += 1; }
      if (s.servoVolt >= 11.5 && this.voltInSag) { this.voltInSag = false; }
    }
    if (s.engaged) this.engagedTicks += 1;
    if (s.mode) this.modeShareTicks[s.mode] = (this.modeShareTicks[s.mode] ?? 0) + 1;
    // Distance: integrate great-circle between consecutive positions.
    if (typeof s.lat === "number" && typeof s.lon === "number") {
      if (this.lastLat != null && this.lastLon != null) {
        const dm = _haversineMeters(this.lastLat, this.lastLon, s.lat, s.lon);
        if (dm < 100) this.distanceMeters += dm; // skip GPS jumps > 100 m/s
      }
      this.lastLat = s.lat; this.lastLon = s.lon; this.lastPosTs = s.ts;
    }
    // Cap buffer size.
    if (this.buffer.length > 2000) this.buffer = this.buffer.slice(-2000);
  }

  stop(): TripSummary | null {
    if (!this.currentFile || this.startTs == null) return null;
    const endTs = Date.now();
    const durMs = endTs - this.startTs;
    // Guard: too short (< 60 s) or too few samples (< 60) - discard.
    // A short outing that autostate flagged for a moment is not a trip.
    if (this.sampleCount < 60 || durMs < 60_000) {
      if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
      const file = this.currentFile;
      const sumFile = this.currentSummaryFile;
      this.buffer = [];
      try { fs.unlinkSync(file); } catch { /* silent */ }
      try { if (sumFile) fs.unlinkSync(sumFile); } catch { /* silent */ }
      this.log("info", `[trip] discarded ${this.currentId} (${this.sampleCount} samples in ${(durMs / 1000).toFixed(1)}s)`);
      this._resetActive();
      return null;
    }
    // Terminal event line.
    this.buffer.push(JSON.stringify({
      type: "end",
      endTs,
      sampleCount: this.sampleCount,
    }));
    this.flush();
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    // Compute summary.
    const summary: TripSummary = {
      id: this.currentId!,
      startTs: this.startTs,
      endTs,
      durationMs: durMs,
      distanceNm: this.distanceMeters / 1852,

      twsAvgKn: this.twsN > 0 ? this.twsSum / this.twsN : null,
      twsMaxKn: this.twsMax,
      awsAvgKn: this.awsN > 0 ? this.awsSum / this.awsN : null,
      awsMaxKn: this.awsMax,
      twaAvgDeg: this.twaN > 0 ? this.twaSum / this.twaN : null,

      sogAvgKn: this.sogN > 0 ? this.sogSum / this.sogN : null,
      sogMaxKn: this.sogMax,
      heelAvgDeg: this.heelN > 0 ? this.heelSumAbs / this.heelN : null,
      heelMaxDeg: this.heelMaxAbs,

      pctUpwind:   this.polN > 0 ? (this.upwindN   / this.polN) * 100 : null,
      pctReach:    this.polN > 0 ? (this.reachN    / this.polN) * 100 : null,
      pctDownwind: this.polN > 0 ? (this.downwindN / this.polN) * 100 : null,

      tacks: this.tackCount,

      voltAvgV: this.voltN > 0 ? this.voltSum / this.voltN : null,
      voltMinV: this.voltMin,
      voltSagsBelow115: this.voltSags,

      peakWindTs: this.peakWindTs,
      peakWindKn: this.peakWindKn,
      peakSogTs: this.peakSogTs,
      peakSogKn: this.peakSogKn,
      minVoltTs: this.minVoltTs,
      minVoltV: this.minVoltTracked,

      pctEngaged: this.allTicks > 0 ? (this.engagedTicks / this.allTicks) * 100 : 0,
      modeShare: Object.fromEntries(Object.entries(this.modeShareTicks).map(([k, v]) => [k, this.allTicks > 0 ? (v / this.allTicks) * 100 : 0])),

      navStateAtStart: this.header?.navStateAtStart ?? "?",
      revision: this.header?.revision ?? "?",
      sampleCount: this.sampleCount,
    };
    try {
      if (this.currentSummaryFile) fs.writeFileSync(this.currentSummaryFile, JSON.stringify(summary, null, 2));
    } catch (e: any) {
      this.log("error", `trip summary write failed: ${e?.message || e}`);
    }
    this.log("info", `[trip] closed ${this.currentId} (${this.sampleCount} samples, ${summary.distanceNm.toFixed(1)} nm, ${this.tackCount} tacks)`);
    this._resetActive();
    return summary;
  }

  private flush(): void {
    if (!this.currentFile || this.buffer.length === 0) return;
    const payload = this.buffer.join("\n") + "\n";
    this.buffer = [];
    try { fs.appendFileSync(this.currentFile, payload); } catch (e: any) {
      this.log("error", `trip flush failed: ${e?.message || e}`);
    }
  }

  private _resetActive(): void {
    this.currentFile = null;
    this.currentSummaryFile = null;
    this.currentId = null;
    this.header = null;
    this.startTs = null;
    this.sampleCount = 0;
    this.buffer = [];
    this._resetStats();
  }

  private _resetStats(): void {
    this.twsSum = 0; this.twsN = 0; this.twsMax = null;
    this.awsSum = 0; this.awsN = 0; this.awsMax = null;
    this.twaSum = 0; this.twaN = 0;
    this.sogSum = 0; this.sogN = 0; this.sogMax = null;
    this.heelSumAbs = 0; this.heelN = 0; this.heelMaxAbs = null;
    this.upwindN = 0; this.reachN = 0; this.downwindN = 0; this.polN = 0;
    this.tackCount = 0; this.lastAwaSign = 0; this.lastTackSignFlipTs = 0;
    this.voltSum = 0; this.voltN = 0; this.voltMin = null;
    this.voltInSag = false; this.voltSags = 0;
    this.engagedTicks = 0; this.allTicks = 0;
    this.modeShareTicks = {};
    this.lastLat = null; this.lastLon = null; this.lastPosTs = 0;
    this.distanceMeters = 0;
    this.peakWindTs = null; this.peakWindKn = null;
    this.peakSogTs = null; this.peakSogKn = null;
    this.minVoltTs = null; this.minVoltTracked = null;
  }

  // -- listing / retrieval helpers --

  list(): { id: string; sizeBytes: number; hasSummary: boolean }[] {
    const out: { id: string; sizeBytes: number; hasSummary: boolean }[] = [];
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir).filter((f) => f.startsWith("trip-") && f.endsWith(".jsonl")); } catch { return out; }
    for (const name of names) {
      const id = name.replace(/^trip-|\.jsonl$/g, "");
      const full = path.join(this.dir, name);
      try {
        const st = fs.statSync(full);
        const sumPath = path.join(this.dir, `trip-${id}.summary.json`);
        const hasSummary = fs.existsSync(sumPath);
        out.push({ id, sizeBytes: st.size, hasSummary });
      } catch { /* skip */ }
    }
    // Newest first.
    out.sort((a, b) => (a.id < b.id ? 1 : -1));
    return out;
  }

  summary(id: string): TripSummary | null {
    const sumPath = path.join(this.dir, `trip-${id}.summary.json`);
    try { return JSON.parse(fs.readFileSync(sumPath, "utf8")) as TripSummary; } catch { return null; }
  }

  jsonlPath(id: string): string {
    return path.join(this.dir, `trip-${id}.jsonl`);
  }

  deleteTrip(id: string): boolean {
    try { fs.unlinkSync(path.join(this.dir, `trip-${id}.jsonl`)); } catch { /* file may be missing */ }
    try { fs.unlinkSync(path.join(this.dir, `trip-${id}.summary.json`)); } catch { /* silent */ }
    return true;
  }

  directory(): string { return this.dir; }
}

function _haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
