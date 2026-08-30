// Rev99: Servo Health monitor. Learns a "normal" servo current
// baseline from the first few minutes of engaged navigation, then
// grades the recent draw against that baseline to flag mechanical or
// electrical trouble early:
//
//   deviation = recentAvgA / baselineA
//   deviation < 1.20   -> good      (business as usual)
//   1.20 <= dev < 1.65 -> elevated  (working harder than usual)
//   deviation >= 1.65  -> high      (possibly hard rudder, clutch,
//                                    cable drag, weather helm, fouling)
//
// Baseline logic:
//   - Only ACCUMULATE samples while engaged=true AND the servo is
//     actively pulling (current > servoOnThresholdA). Servo-idle
//     ticks contribute nothing; a boat sitting at the dock with AP
//     off never poisons the baseline.
//   - Learn until we have `baselineSamples` (default 300) of activity.
//     At 1 Hz sampling with a servo that pulls maybe half the time,
//     that is roughly 10 minutes of real engaged navigation.
//   - After learn: keep an EWMA (alpha=0.02) so the baseline slowly
//     adapts to slow-changing conditions (fresh biofouling, day-to-day
//     wind pattern) without letting a single incident move it.
//
// The recent-avg window is the last 30 s of engaged servo-on samples,
// mirroring the KPI computer's `window1m` philosophy.
//
// Rev99 keeps the baseline in memory only; it resets on plugin restart.
// Persistence (baseline saved to disk between sessions) is a later
// batch alongside the historian disk snapshots.

import { Sample } from "./historian";

export type ServoHealthStatus = "learning" | "good" | "elevated" | "high" | "idle";

export interface ServoHealthSnapshot {
  computedTs: number;
  status: ServoHealthStatus;
  baselineA: number | null;
  recentAvgA: number | null;
  deviationRatio: number | null;      // recentAvgA / baselineA, or null
  peakA: number | null;               // max in the last window
  samplesLearned: number;
  samplesTargetForLearn: number;
  // Extras that mirror the raw servo readings so the UI can show
  // temperatures / voltage alongside the health verdict.
  lastCurrentA: number | null;
  lastTempC: number | null;
  lastVoltageV: number | null;
  engaged: boolean;
}

export interface ServoHealthOptions {
  /** Current threshold (A) above which we count the servo as "on".
   *  Should match the KPI computer's threshold so the two agree on
   *  what "working" means. Default 0.3. */
  servoOnThresholdA?: number;
  /** How many servo-on samples we need before we consider the
   *  baseline learned. Default 300 (~10 minutes of half-duty). */
  baselineSamples?: number;
  /** Recent-average window in seconds. Default 30. */
  recentWindowSec?: number;
  /** Ratio thresholds for the status pill. Defaults per Carlos's spec. */
  elevatedRatio?: number;   // default 1.20
  highRatio?: number;       // default 1.65
  /** EWMA alpha for slow baseline drift after learn. Default 0.02. */
  driftAlpha?: number;
}

interface RecentEntry {
  ts: number;
  a: number;
}

export class ServoHealthMonitor {
  private readonly servoOnA: number;
  private readonly targetSamples: number;
  private readonly recentWindowMs: number;
  private readonly elevatedRatio: number;
  private readonly highRatio: number;
  private readonly driftAlpha: number;
  private baselineA: number | null = null;
  private learnCount = 0;
  private learnSum = 0;
  private recent: RecentEntry[] = [];
  private lastSample: Sample | null = null;

  constructor(opts: ServoHealthOptions = {}) {
    this.servoOnA = opts.servoOnThresholdA ?? 0.3;
    this.targetSamples = Math.max(30, opts.baselineSamples ?? 300);
    this.recentWindowMs = Math.max(5000, (opts.recentWindowSec ?? 30) * 1000);
    this.elevatedRatio = opts.elevatedRatio ?? 1.20;
    this.highRatio = opts.highRatio ?? 1.65;
    this.driftAlpha = Math.max(0.001, Math.min(0.5, opts.driftAlpha ?? 0.02));
  }

  reset(): void {
    this.baselineA = null;
    this.learnCount = 0;
    this.learnSum = 0;
    this.recent = [];
    this.lastSample = null;
  }

  /** Called on every sampler tick with the latest Sample. O(1). */
  onSample(s: Sample): void {
    this.lastSample = s;
    if (!s.engaged) return;
    if (typeof s.servoCurrent !== "number" || !isFinite(s.servoCurrent)) return;
    if (s.servoCurrent < this.servoOnA) return;
    // Update recent-window buffer (drop entries older than window).
    this.recent.push({ ts: s.ts, a: s.servoCurrent });
    const cutoff = s.ts - this.recentWindowMs;
    while (this.recent.length > 0 && this.recent[0].ts < cutoff) this.recent.shift();
    // Baseline learning phase.
    if (this.baselineA == null) {
      this.learnCount += 1;
      this.learnSum += s.servoCurrent;
      if (this.learnCount >= this.targetSamples) {
        this.baselineA = this.learnSum / this.learnCount;
      }
      return;
    }
    // Post-learn: gentle EWMA drift so seasonal changes migrate the
    // baseline. The alpha is tiny (0.02) so a single incident cannot
    // push the baseline up and mask the very anomaly it should catch.
    this.baselineA = this.baselineA * (1 - this.driftAlpha) + s.servoCurrent * this.driftAlpha;
  }

  snapshot(): ServoHealthSnapshot {
    const now = Date.now();
    // Recent average + peak from the rolling window.
    let recentAvg: number | null = null;
    let peak: number | null = null;
    if (this.recent.length > 0) {
      let sum = 0;
      let mx = -Infinity;
      for (const e of this.recent) {
        sum += e.a;
        if (e.a > mx) mx = e.a;
      }
      recentAvg = sum / this.recent.length;
      peak = mx;
    }
    // Deviation and status verdict.
    let deviation: number | null = null;
    let status: ServoHealthStatus;
    if (!this.lastSample || !this.lastSample.engaged) {
      status = "idle";
    } else if (this.baselineA == null) {
      status = "learning";
    } else if (recentAvg == null) {
      // Engaged but no recent servo activity to grade - treat as good.
      status = "good";
    } else {
      deviation = recentAvg / this.baselineA;
      if (deviation >= this.highRatio) status = "high";
      else if (deviation >= this.elevatedRatio) status = "elevated";
      else status = "good";
    }
    return {
      computedTs: now,
      status,
      baselineA: this.baselineA,
      recentAvgA: recentAvg,
      deviationRatio: deviation,
      peakA: peak,
      samplesLearned: this.baselineA == null ? this.learnCount : this.targetSamples,
      samplesTargetForLearn: this.targetSamples,
      lastCurrentA: this.lastSample && typeof this.lastSample.servoCurrent === "number" ? this.lastSample.servoCurrent : null,
      lastTempC:    this.lastSample && typeof this.lastSample.servoTemp === "number" ? this.lastSample.servoTemp : null,
      lastVoltageV: this.lastSample && typeof this.lastSample.servoVoltage === "number" ? this.lastSample.servoVoltage : null,
      engaged: !!(this.lastSample && this.lastSample.engaged),
    };
  }
}
