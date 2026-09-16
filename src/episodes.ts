// Correction episode detector + step-response metrics.
//
// A correction episode is the period between the moment the AP receives
// a new heading (or wind angle) target and the moment the boat settles
// within a small band around it. Each episode is scored with four
// classic step-response numbers:
//
//   Rise time      seconds from target change to entering the 10% band
//                  around the new target for the first time.
//   Overshoot %    max excursion past the target after rise, in % of
//                  the step size.
//   Settling time  seconds until |error| stays below 5% of the step for
//                  a hold window (5 s) continuously.
//   SSE            steady-state error, mean signed error in the last
//                  `sseWindowSec` seconds of the episode.
//
// The detector consumes samples in order via onSample(). It ignores
// samples where the AP is disengaged. A change in headingCmd larger
// than `minStepRad` opens an episode; the episode closes when it
// settles, when a fresh larger step arrives (superseding it), or after
// `maxDurationSec` (timeout — recorded as "did not settle").
//
// Design goals:
//   - O(1) per sample except when closing (one linear pass over the
//     buffered samples). Episode buffers are capped so pathological
//     tacks that never settle do not eat RAM.
//   - Wind-mode compatible: `errorRad` is computed via the same helper
//     that KPIComputer uses, so the wind vs compass distinction is
//     shared.
//   - Pure data — the module never touches Signal K or filesystems. The
//     plugin wires onSample() into its sampler tick and exposes
//     snapshot() from an endpoint.

import { Sample } from "./historian";
import { errorRad } from "./kpis";

/** Immutable summary of a closed episode. */
export interface EpisodeSummary {
  /** Wall-clock ms when the target step was detected. */
  startedTs: number;
  /** Wall-clock ms when the episode was closed. */
  endedTs: number;
  /** "compass" / "wind" / "true wind" / "gps" — mode at start. */
  mode: string | null;
  /** Step size in rad (signed): newTarget - previousTarget, wrapped to [-pi, pi]. */
  stepRad: number;
  /** Rise time in seconds. Null if the boat never entered the ±10% band. */
  riseSec: number | null;
  /** Overshoot as a fraction of |stepRad| (0.2 = 20%). Null if no rise, or no crossing past the target. */
  overshoot: number | null;
  /** Settling time in seconds. Null if the boat did not stay in the ±5% band for `settleHoldSec`. */
  settlingSec: number | null;
  /** Steady-state signed mean error (rad) over the last `sseWindowSec` of the episode. Null if not enough samples. */
  sseRad: number | null;
  /** True if the episode closed on the maxDuration timeout without settling. */
  timedOut: boolean;
  /** Number of samples consumed. */
  samples: number;
}

export interface EpisodeDetectorOptions {
  /** Ignore steps smaller than this (rad). Default 3° = 0.0524. */
  minStepRad?: number;
  /** Rise band as a fraction of |stepRad|. Default 0.10 (10%). */
  riseBandFrac?: number;
  /** Settling band as a fraction of |stepRad|. Default 0.05 (5%). */
  settleBandFrac?: number;
  /** Hold time inside the settling band to declare settled (s). Default 5. */
  settleHoldSec?: number;
  /** Absolute max episode duration (s). Default 60. */
  maxDurationSec?: number;
  /** Window for SSE, seconds counted from episode end. Default 5. */
  sseWindowSec?: number;
  /** Max samples buffered per open episode (guard against runaway). Default 300. */
  maxBufferedSamples?: number;
  /** Ring buffer capacity for closed episodes. Default 20. */
  historyCapacity?: number;
}

const DEG = Math.PI / 180;

interface OpenEpisode {
  startedTs: number;
  startCmd: number;   // headingCmd at start (after step)
  prevCmd: number;    // headingCmd just before the step (used to compute stepRad)
  stepRad: number;
  mode: string | null;
  targetSide: 1 | -1; // sign of stepRad: +1 means we need to turn "up" from prevCmd to startCmd
  buffer: Sample[];
  hasEnteredRiseBand: boolean;
  riseSec: number | null;
  // Max absolute excursion past startCmd IN THE OVERSHOOT DIRECTION,
  // measured only after rise. Tracked as |error| when its sign is the
  // "overshoot" sign (opposite of the initial approach direction).
  maxOvershootAbs: number;
  // Settled tracking: candidate settle timestamp — the earliest sample
  // in the current continuous stretch that is inside the settle band.
  // Null when we are NOT currently inside the band.
  candidateSettleTs: number | null;
  settlingSec: number | null;
}

/** Detector + rolling history of correction episodes. Stateful.
 *  Call `onSample(s)` for every historian sample and read the current
 *  closed history via `snapshot()`. Also exposes the currently open
 *  episode (if any) so the UI can render "in progress". */
export class EpisodeDetector {
  private readonly minStepRad: number;
  private readonly riseBandFrac: number;
  private readonly settleBandFrac: number;
  private readonly settleHoldSec: number;
  private readonly maxDurationSec: number;
  private readonly sseWindowSec: number;
  private readonly maxBufferedSamples: number;
  private readonly historyCapacity: number;

  private open: OpenEpisode | null = null;
  private history: EpisodeSummary[] = [];
  private lastCmd: number | null = null;   // last seen headingCmd while engaged
  private lastMode: string | null = null;

  constructor(opts: EpisodeDetectorOptions = {}) {
    this.minStepRad     = opts.minStepRad     ?? 3 * DEG;
    this.riseBandFrac   = opts.riseBandFrac   ?? 0.10;
    this.settleBandFrac = opts.settleBandFrac ?? 0.05;
    this.settleHoldSec  = opts.settleHoldSec  ?? 5;
    this.maxDurationSec = opts.maxDurationSec ?? 60;
    this.sseWindowSec   = opts.sseWindowSec   ?? 5;
    this.maxBufferedSamples = opts.maxBufferedSamples ?? 300;
    this.historyCapacity    = opts.historyCapacity    ?? 20;
  }

  /** Feed one sample. Safe to call unconditionally on every tick. */
  onSample(s: Sample): void {
    // Disengaged: close any open episode without a settling.
    if (!s.engaged) {
      if (this.open) this.closeOpen(s.ts, false);
      this.lastCmd = null;
      this.lastMode = null;
      return;
    }

    if (typeof s.headingCmd !== "number") {
      // Engaged but no target yet — nothing to do.
      return;
    }

    const cmd = s.headingCmd;
    const mode = s.mode ?? null;

    // Detect a step: change in headingCmd larger than the threshold.
    if (this.lastCmd != null && Math.abs(wrapPi(cmd - this.lastCmd)) >= this.minStepRad) {
      // Close previous episode as superseded (if still open).
      if (this.open) this.closeOpen(s.ts, false);
      // Open a new one.
      const step = wrapPi(cmd - this.lastCmd);
      this.open = {
        startedTs: s.ts,
        startCmd: cmd,
        prevCmd: this.lastCmd,
        stepRad: step,
        mode,
        targetSide: step >= 0 ? 1 : -1,
        buffer: [],
        hasEnteredRiseBand: false,
        riseSec: null,
        maxOvershootAbs: 0,
        candidateSettleTs: null,
        settlingSec: null,
      };
    }

    // Update tracking baselines for next tick.
    this.lastCmd = cmd;
    this.lastMode = mode;

    // If an episode is open, feed the sample to it.
    if (this.open) {
      this.updateOpen(s);
    }
  }

  private updateOpen(s: Sample): void {
    const ep = this.open;
    if (!ep) return;

    ep.buffer.push(s);
    if (ep.buffer.length > this.maxBufferedSamples) {
      ep.buffer.shift();
    }

    const err = errorRad(s);
    if (err == null) return;

    const stepAbs = Math.abs(ep.stepRad);
    const riseBand = stepAbs * this.riseBandFrac;
    const settleBand = stepAbs * this.settleBandFrac;

    // Rise: first time |error| enters the rise band.
    if (!ep.hasEnteredRiseBand && Math.abs(err) <= riseBand) {
      ep.hasEnteredRiseBand = true;
      ep.riseSec = (s.ts - ep.startedTs) / 1000;
    }

    // Overshoot: after rise, track max |error| when it points past target.
    // error = cmd - actual. If we came from prevCmd to cmd with step > 0
    // (turned "up"), actual approaches cmd from below → error > 0 during
    // the approach, error < 0 after overshoot. So overshoot direction has
    // sign opposite to stepRad.
    if (ep.hasEnteredRiseBand) {
      const overshootSign = -ep.targetSide;
      if (Math.sign(err) === overshootSign) {
        const excursion = Math.abs(err);
        if (excursion > ep.maxOvershootAbs) ep.maxOvershootAbs = excursion;
      }
    }

    // Settling: track continuous stretch inside settleBand.
    if (Math.abs(err) <= settleBand) {
      if (ep.candidateSettleTs == null) ep.candidateSettleTs = s.ts;
      const heldSec = (s.ts - ep.candidateSettleTs) / 1000;
      if (heldSec >= this.settleHoldSec && ep.settlingSec == null) {
        ep.settlingSec = (ep.candidateSettleTs - ep.startedTs) / 1000;
        this.closeOpen(s.ts, false);
        return;
      }
    } else {
      ep.candidateSettleTs = null;
    }

    // Timeout.
    const elapsedSec = (s.ts - ep.startedTs) / 1000;
    if (elapsedSec >= this.maxDurationSec) {
      this.closeOpen(s.ts, true);
    }
  }

  private closeOpen(endedTs: number, timedOut: boolean): void {
    const ep = this.open;
    if (!ep) return;
    const stepAbs = Math.abs(ep.stepRad);
    // SSE: mean signed error over last sseWindowSec of the episode.
    const cutoff = endedTs - this.sseWindowSec * 1000;
    let sseSum = 0;
    let sseN = 0;
    for (const s of ep.buffer) {
      if (s.ts < cutoff) continue;
      const e = errorRad(s);
      if (e != null) { sseSum += e; sseN += 1; }
    }
    const sse = sseN > 0 ? sseSum / sseN : null;
    const overshoot = ep.hasEnteredRiseBand && stepAbs > 0
      ? ep.maxOvershootAbs / stepAbs
      : null;
    const summary: EpisodeSummary = {
      startedTs: ep.startedTs,
      endedTs,
      mode: ep.mode,
      stepRad: ep.stepRad,
      riseSec: ep.riseSec,
      overshoot,
      settlingSec: ep.settlingSec,
      sseRad: sse,
      timedOut,
      samples: ep.buffer.length,
    };
    this.history.push(summary);
    if (this.history.length > this.historyCapacity) {
      this.history.splice(0, this.history.length - this.historyCapacity);
    }
    this.open = null;
  }

  /** Read-only snapshot of closed episodes (newest last). */
  snapshot(): EpisodeSummary[] {
    return this.history.slice();
  }

  /** Descriptor of the currently-in-progress episode, or null. */
  current(): { startedTs: number; stepRad: number; mode: string | null; samples: number } | null {
    if (!this.open) return null;
    return {
      startedTs: this.open.startedTs,
      stepRad: this.open.stepRad,
      mode: this.open.mode,
      samples: this.open.buffer.length,
    };
  }

  reset(): void {
    this.open = null;
    this.history = [];
    this.lastCmd = null;
    this.lastMode = null;
  }
}

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Bucket an episode's numbers into a coarse quality band for the UI.
 *  Thresholds are conservative defaults — they can be tuned once we
 *  have water data. */
export type QualityBand = "good" | "acceptable" | "poor" | "unknown";

export function rateEpisode(ep: EpisodeSummary): {
  rise: QualityBand;
  overshoot: QualityBand;
  settling: QualityBand;
  sse: QualityBand;
  overall: QualityBand;
} {
  const stepDeg = Math.abs(ep.stepRad) * 180 / Math.PI;
  // Rise time expectation scales roughly with step size. A 10° step
  // should complete rise in a few seconds; a 90° tack may take much
  // longer legitimately. Rough map: ~1 s per 3° of step.
  const expectedRiseSec = Math.max(3, stepDeg / 3);
  const rise: QualityBand =
    ep.riseSec == null ? "unknown" :
    ep.riseSec <= expectedRiseSec ? "good" :
    ep.riseSec <= expectedRiseSec * 2 ? "acceptable" : "poor";
  const overshoot: QualityBand =
    ep.overshoot == null ? "unknown" :
    ep.overshoot < 0.10 ? "good" :
    ep.overshoot < 0.25 ? "acceptable" : "poor";
  const settling: QualityBand =
    ep.settlingSec == null ? "poor" :  // failed to settle
    ep.settlingSec <= expectedRiseSec * 2 ? "good" :
    ep.settlingSec <= expectedRiseSec * 4 ? "acceptable" : "poor";
  const sseAbsDeg = ep.sseRad == null ? null : Math.abs(ep.sseRad) * 180 / Math.PI;
  const sse: QualityBand =
    sseAbsDeg == null ? "unknown" :
    sseAbsDeg < 1.5 ? "good" :
    sseAbsDeg < 4 ? "acceptable" : "poor";
  // Overall: worst of the four (unknowns count as acceptable).
  const rank = (b: QualityBand): number =>
    b === "good" ? 0 : b === "acceptable" || b === "unknown" ? 1 : 2;
  const overall: QualityBand = [rise, overshoot, settling, sse]
    .reduce<QualityBand>((worst, b) => (rank(b) > rank(worst) ? b : worst), "good");
  return { rise, overshoot, settling, sse, overall };
}
