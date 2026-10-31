// Rev570 (auto-Doctor phase 3, docs/_design_auto_doctor_2026-10-30.md):
// navigation database. One row per 90 s window with the autopilot
// engaged: the conditions (mode, wind, point of sail, tack, sea state
// from the attitude), the setup (pilot, profile, gains) and the result
// (heading error, servo work, what each pypilot term contributed,
// corrections), plus whether the window is clean enough to compare with
// others and, if not, why.
//
// It only records. Nothing here touches the pilot. The rows are what the
// shadow-mode comparator (phase 5) and the learning will read.
//
// Storage: <dataDir>/nav-db/windows-YYYYMM.jsonl, appended asynchronously
// (never blocks Signal K's thread), oldest months dropped past a budget.

import * as fs from "fs";
import * as path from "path";
import { SERVO_ON_MIN_A } from "./constants";

export const NAV_DB_FORMAT = 1;
const RAD = 180 / Math.PI;
const KN = 1.943844;
const TERMS = ["P", "I", "D", "DD", "PR", "FF"] as const;

/** One 1 Hz sample as the plugin sees it. Angles in rad, speeds in m/s,
 *  heading rate in deg/s (pypilot's unit). */
export interface NavDbSample {
  ts: number;
  engaged: boolean;
  mode: string | null;
  pilot: string | null;
  profile: string | null;
  gains: Record<string, number>;
  /** Contribution of each pypilot term to the servo command (Pgain...). */
  terms: Record<string, number>;
  hdgErr: number | null;
  hdgRate: number | null;
  servoCur: number | null;
  servoFlags: string | null;
  tws: number | null;
  twa: number | null;
  aws: number | null;
  awa: number | null;
  sog: number | null;
  heel: number | null;
  pitch: number | null;
  /** pypilot ap.tack.state ("none" when no tack). */
  tackState: string | null;
  /** A gust was detected in the last 30 s or a gust strategy is acting. */
  gustActive: boolean;
  /** Rev574: no correction to a new target in progress and well past
   *  engaging. Only these samples count for the heading-error numbers. */
  steady?: boolean;
}

export interface NavDbEpisode { startedTs: number; endedTs: number; overshoot: number | null; riseSec: number | null; complete: boolean }

export type ExcludeReason = "mode" | "profile" | "gains" | "tack" | "gust" | "coverage" | "short" | "steps";

export interface NavDbRow {
  type: "window";
  format: number;
  rev: string;
  t0: number;
  t1: number;
  n: number;
  /** Clean enough to compare with another window. */
  valid: boolean;
  why: ExcludeReason[];
  ctx: {
    mode: string | null; pilot: string | null; profile: string | null;
    gains: Record<string, number>;
    /** Wind on port or starboard, from the mean apparent wind angle. */
    tack: "port" | "stbd" | null;
    twsKn: number | null; twsSdKn: number | null;
    twaDeg: number | null; awaDeg: number | null; awsKn: number | null;
    sogKn: number | null;
    heelDeg: number | null; rollSdDeg: number | null; pitchSdDeg: number | null;
    yawRateRmsDps: number | null;
  };
  res: {
    errMeanDeg: number | null; errRmsDeg: number | null; errP95Deg: number | null;
    crossings: number;
    /** Rev574: % of samples that were steady (error numbers use only those). */
    steadyPct: number;
    servoDutyPct: number | null; servoCoveragePct: number; servoCurMeanA: number | null;
    overcurrent: boolean;
    /** RMS of each term's contribution to the servo command. */
    termsRms: Record<string, number>;
  };
  ep: { n: number; complete: number; overshootMean: number | null; riseMeanSec: number | null };
  /** Rev572: shadow-mode decision for this window (shadow-tuner.ts). */
  shadow?: unknown;
}

class Stat {
  n = 0; sum = 0; sumSq = 0;
  add(v: number | null | undefined): void {
    if (typeof v !== "number" || !isFinite(v)) return;
    this.n += 1; this.sum += v; this.sumSq += v * v;
  }
  mean(): number | null { return this.n ? this.sum / this.n : null; }
  rms(): number | null { return this.n ? Math.sqrt(this.sumSq / this.n) : null; }
  sd(): number | null {
    if (this.n < 2) return null;
    const m = this.sum / this.n;
    return Math.sqrt(Math.max(0, this.sumSq / this.n - m * m));
  }
}

/** Circular mean of angles (rad), so 179° and -179° average to 180°. */
class AngleStat {
  n = 0; s = 0; c = 0;
  add(v: number | null | undefined): void {
    if (typeof v !== "number" || !isFinite(v)) return;
    this.n += 1; this.s += Math.sin(v); this.c += Math.cos(v);
  }
  mean(): number | null { return this.n ? Math.atan2(this.s, this.c) : null; }
}

const r1 = (v: number | null): number | null => v == null ? null : Math.round(v * 10) / 10;
const r3 = (v: number | null): number | null => v == null ? null : Math.round(v * 1000) / 1000;

/** Accumulates one window. */
export class NavDbWindow {
  readonly t0: number;
  private t1: number;
  private n = 0;
  private readonly first: NavDbSample;
  private why = new Set<ExcludeReason>();
  private err = new Stat();
  private absErr: number[] = [];
  private crossings = 0;
  private lastErrSign = 0;
  private steadyN = 0;
  /** Rev579 (GPT audit A03): longest gap between two samples. */
  private maxGapMs = 0;
  private curN = 0; private curOn = 0; private cur = new Stat();
  private overcurrent = false;
  private tws = new Stat(); private sog = new Stat(); private aws = new Stat();
  private twa = new AngleStat(); private awa = new AngleStat();
  private heel = new Stat(); private pitch = new Stat(); private yaw = new Stat();
  private terms: Record<string, Stat> = {};

  constructor(s: NavDbSample) {
    this.first = s;
    this.t0 = s.ts;
    this.t1 = s.ts;
    this.add(s);
  }

  add(s: NavDbSample): void {
    this.n += 1;
    if (this.n > 1) this.maxGapMs = Math.max(this.maxGapMs, s.ts - this.t1);
    this.t1 = s.ts;
    const f = this.first;
    if (s.mode !== f.mode) this.why.add("mode");
    if (s.profile !== f.profile || s.pilot !== f.pilot) this.why.add("profile");
    for (const [k, v] of Object.entries(f.gains)) {
      const now = s.gains[k];
      if (typeof now === "number" && Math.abs(now - v) > 1e-9 + 1e-6 * Math.abs(v)) this.why.add("gains");
    }
    if (s.tackState && s.tackState !== "none") this.why.add("tack");
    if (s.gustActive) this.why.add("gust");
    // Rev574 (audit 3.8.0 #B/#D): heading-error numbers from steady
    // samples only. A +10 or the first turn after engaging is a step
    // response, not a sustained offset or an oscillation.
    const steady = s.steady !== false;
    if (steady) this.steadyN += 1;
    else this.lastErrSign = 0;
    if (steady && typeof s.hdgErr === "number" && isFinite(s.hdgErr)) {
      this.err.add(s.hdgErr);
      if (this.absErr.length < 600) this.absErr.push(Math.abs(s.hdgErr));
      const sg = Math.sign(s.hdgErr);
      if (sg !== 0) {
        if (this.lastErrSign !== 0 && sg !== this.lastErrSign) this.crossings += 1;
        this.lastErrSign = sg;
      }
    }
    if (typeof s.servoCur === "number") {
      this.curN += 1;
      if (s.servoCur > SERVO_ON_MIN_A) this.curOn += 1;
      this.cur.add(s.servoCur);
    }
    if (s.servoFlags && /OVERCURRENT/i.test(s.servoFlags)) this.overcurrent = true;
    this.tws.add(s.tws); this.sog.add(s.sog); this.aws.add(s.aws);
    this.twa.add(s.twa); this.awa.add(s.awa);
    this.heel.add(s.heel); this.pitch.add(s.pitch); this.yaw.add(s.hdgRate);
    for (const k of TERMS) {
      const v = s.terms[k];
      if (typeof v !== "number") continue;
      (this.terms[k] ??= new Stat()).add(v);
    }
  }

  durationSec(): number { return (this.t1 - this.t0) / 1000 + 1; }

  close(rev: string, episodes: NavDbEpisode[], minSec: number): NavDbRow {
    const why = new Set(this.why);
    if (this.durationSec() < minSec) why.add("short");
    // Rev579 (GPT audit A03): a 90 s window needs ~90 samples (1 Hz) and
    // no long hole; two samples 89 s apart are not 90 s of observation.
    if (this.n < 0.8 * this.durationSec() || this.maxGapMs > 10_000) why.add("coverage");
    if (this.n > 0 && this.steadyN / this.n < 0.5) why.add("steps");
    else if (this.steadyN > 0 && this.err.n / this.steadyN < 0.8) why.add("coverage");
    const sorted = this.absErr.slice().sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
    const awa = this.awa.mean();
    const termsRms: Record<string, number> = {};
    for (const [k, st] of Object.entries(this.terms)) {
      const v = st.rms();
      if (v != null) termsRms[k] = Math.round(v * 1e5) / 1e5;
    }
    const eps = episodes.filter((e) => e.endedTs >= this.t0 && e.endedTs <= this.t1);
    const done = eps.filter((e) => e.complete);
    const os = done.map((e) => e.overshoot).filter((v): v is number => typeof v === "number");
    const rise = done.map((e) => e.riseSec).filter((v): v is number => typeof v === "number");
    const deg = (v: number | null) => v == null ? null : v * RAD;
    const kn = (v: number | null) => v == null ? null : v * KN;
    return {
      type: "window", format: NAV_DB_FORMAT, rev, t0: this.t0, t1: this.t1, n: this.n,
      valid: why.size === 0, why: [...why],
      ctx: {
        mode: this.first.mode, pilot: this.first.pilot, profile: this.first.profile,
        gains: { ...this.first.gains },
        tack: awa == null || Math.abs(awa) < 1e-3 ? null : (awa < 0 ? "port" : "stbd"),
        twsKn: r1(kn(this.tws.mean())), twsSdKn: r1(kn(this.tws.sd())),
        twaDeg: r1(deg(this.twa.mean())), awaDeg: r1(deg(awa)), awsKn: r1(kn(this.aws.mean())),
        sogKn: r1(kn(this.sog.mean())),
        heelDeg: r1(deg(this.heel.mean())), rollSdDeg: r1(deg(this.heel.sd())), pitchSdDeg: r1(deg(this.pitch.sd())),
        yawRateRmsDps: r1(this.yaw.rms()),
      },
      res: {
        errMeanDeg: r1(deg(this.err.mean())), errRmsDeg: r1(deg(this.err.rms())), errP95Deg: r1(deg(p95)),
        crossings: this.crossings,
        steadyPct: this.n ? Math.round(100 * this.steadyN / this.n) : 0,
        servoDutyPct: this.curN ? Math.round(100 * this.curOn / this.curN) : null,
        servoCoveragePct: this.n ? Math.round(100 * this.curN / this.n) : 0,
        servoCurMeanA: r1(this.cur.mean()),
        overcurrent: this.overcurrent,
        termsRms,
      },
      ep: {
        n: eps.length, complete: done.length,
        overshootMean: os.length ? r3(os.reduce((a, b) => a + b, 0) / os.length) : null,
        riseMeanSec: rise.length ? r1(rise.reduce((a, b) => a + b, 0) / rise.length) : null,
      },
    };
  }
}

interface NavDbOptions {
  dataDir: string;
  rev: string;
  windowSec?: number;
  /** Windows shorter than this (disengage) are kept but marked "short". */
  minSec?: number;
  maxBytes?: number;
  episodes?: () => NavDbEpisode[];
  /** Rev572: called with each closed row before it is written. */
  decorate?: (row: NavDbRow) => void;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

/** Window rotation + async append. Feed every 1 Hz tick to onSample(). */
export class NavDb {
  private readonly dir: string;
  private readonly windowMs: number;
  private readonly minSec: number;
  private readonly maxBytes: number;
  private open: NavDbWindow | null = null;
  private rows = 0;
  private lastRow: NavDbRow | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly opts: NavDbOptions) {
    this.dir = path.join(opts.dataDir, "nav-db");
    this.windowMs = (opts.windowSec ?? 90) * 1000;
    this.minSec = opts.minSec ?? 60;
    this.maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
    fs.promises.mkdir(this.dir, { recursive: true }).then(() => this.prune()).catch(() => { /* silent */ });
  }

  onSample(s: NavDbSample): NavDbRow | null {
    if (!s.engaged) {
      if (!this.open) return null;
      return this.closeOpen();   // disengage ends the window
    }
    if (!this.open) { this.open = new NavDbWindow(s); return null; }
    if (s.ts - this.open.t0 >= this.windowMs) {
      const row = this.closeOpen();
      this.open = new NavDbWindow(s);
      return row;
    }
    this.open.add(s);
    return null;
  }

  /** Close the open window now (plugin stop). */
  flush(): Promise<void> {
    if (this.open) this.closeOpen();
    return this.writing;
  }

  stats(): { rowsThisRun: number; lastRow: NavDbRow | null; dir: string } {
    return { rowsThisRun: this.rows, lastRow: this.lastRow, dir: this.dir };
  }

  /** Data files, newest first. */
  files(): string[] {
    try {
      return fs.readdirSync(this.dir).filter((f) => /^windows-\d{6}\.jsonl$/.test(f)).sort().reverse();
    } catch { return []; }
  }

  private closeOpen(): NavDbRow | null {
    const w = this.open;
    this.open = null;
    if (!w) return null;
    let eps: NavDbEpisode[] = [];
    try { eps = this.opts.episodes ? this.opts.episodes() : []; } catch { /* silent */ }
    const row = w.close(this.opts.rev, eps, this.minSec);
    try { this.opts.decorate?.(row); } catch { /* silent */ }
    this.rows += 1;
    this.lastRow = row;
    const d = new Date(row.t0);
    const file = path.join(this.dir, `windows-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}.jsonl`);
    const line = JSON.stringify(row) + "\n";
    this.writing = this.writing
      .then(() => fs.promises.appendFile(file, line))
      .catch((e) => this.opts.log?.("error", `[nav-db] write failed: ${e?.message || e}`));
    return row;
  }

  /** Drop the oldest month files while the folder is over budget. */
  private async prune(): Promise<void> {
    try {
      const names = (await fs.promises.readdir(this.dir)).filter((f) => /^windows-\d{6}\.jsonl$/.test(f)).sort();
      const sizes = await Promise.all(names.map((n) => fs.promises.stat(path.join(this.dir, n)).then((st) => st.size).catch(() => 0)));
      let total = sizes.reduce((a, b) => a + b, 0);
      for (let i = 0; i < names.length - 1 && total > this.maxBytes; i += 1) {
        await fs.promises.unlink(path.join(this.dir, names[i])).catch(() => { /* silent */ });
        total -= sizes[i];
        this.opts.log?.("info", `[nav-db] dropped ${names[i]} (over ${Math.round(this.maxBytes / 1048576)} MB)`);
      }
    } catch { /* silent */ }
  }
}
