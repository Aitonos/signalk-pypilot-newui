// Rev95: KPI computer for the pilot-performance layer. Consumes the
// historian ring buffer to derive:
//   - Session counters (engagedSec, distanceNm, servoRuntimeSec, energyAh,
//     maxServoA, tacks/gybes) accumulated incrementally on each sample.
//   - Window statistics (last N seconds) recomputed from the buffer on
//     demand: mean/RMS/p95 heading error, servo duty-cycle.
//
// Design goals:
//   - O(1) per-sample update. RMS/p95/etc are O(windowSize) on snapshot()
//     but the default window is 60 samples so it is negligible on Pi 4.
//   - No allocations in the hot path. Session updates just mutate fields.
//   - Tacks/gybes counted heuristically from AWA sign transitions; the
//     detector debounces on 3 s of "same side" to avoid gust chatter.
//   - Error is computed relative to the AP's target based on the active
//     mode: heading in compass/gps modes, AWA in wind modes.

import { Historian, Sample } from "./historian";

export interface SessionStats {
  /** Wall-clock ms of session start (or last reset). */
  startedTs: number;
  /** Seconds the AP has been engaged this session. */
  engagedSec: number;
  /** Nautical miles travelled while engaged (integrated from SOG). */
  distanceNm: number;
  tacks: number;
  gybes: number;
  /** Seconds the servo was drawing more than `servoOnThresholdA`. */
  servoRuntimeSec: number;
  /** Amp-hours consumed by the servo (integrated over sampleTickMs). */
  energyAh: number;
  /** Peak servo current seen this session (A). */
  maxServoA: number;
}

export interface WindowStats {
  windowSec: number;
  /** Total samples that fell in the window. */
  samples: number;
  /** Subset of samples with engaged=true. */
  engagedSamples: number;
  /** Signed mean heading error (rad), engaged samples only. */
  meanErrorRad: number | null;
  /** Root-mean-square error (rad), engaged samples only. */
  rmsErrorRad: number | null;
  /** 95th percentile of |error| (rad), engaged samples only. */
  p95ErrorRad: number | null;
  /** Fraction of samples where servoCurrent > threshold (0..1). */
  servoDutyPct: number | null;
}

export interface KPISnapshot {
  computedTs: number;
  session: SessionStats;
  window1m: WindowStats;
}

export interface KPIOptions {
  /** Servo current threshold to count as "on" (A). Default 0.3. */
  servoOnThresholdA?: number;
  /** Rolling window length for window1m (seconds). Default 60. */
  windowSec?: number;
  /** Sampling tick in ms - must match the Historian's samplePeriodMs. */
  sampleTickMs?: number;
  /** Debounce interval for tack/gybe detection (ms). Default 3000. */
  tackDebounceMs?: number;
}

export class KPIComputer {
  private readonly hist: Historian;
  private readonly servoOnThresholdA: number;
  private readonly windowSec: number;
  private readonly tickMs: number;
  private readonly tackDebounceMs: number;
  private session: SessionStats;
  // Tack/gybe detector state - remembers the last "stable" AWA sign and
  // the timestamp of the last flip candidate so a single crossing is
  // required to sit for tackDebounceMs before counting.
  private lastStableAwaSign: -1 | 0 | 1 = 0;
  private candidateAwaSign: -1 | 0 | 1 = 0;
  private candidateSinceMs = 0;

  constructor(hist: Historian, opts: KPIOptions = {}) {
    this.hist = hist;
    this.servoOnThresholdA = opts.servoOnThresholdA ?? 0.3;
    this.windowSec = opts.windowSec ?? 60;
    this.tickMs = opts.sampleTickMs ?? 1000;
    this.tackDebounceMs = opts.tackDebounceMs ?? 3000;
    this.session = KPIComputer.freshSession();
  }

  private static freshSession(): SessionStats {
    return {
      startedTs: Date.now(),
      engagedSec: 0,
      distanceNm: 0,
      tacks: 0,
      gybes: 0,
      servoRuntimeSec: 0,
      energyAh: 0,
      maxServoA: 0,
    };
  }

  /** Zero all counters and start the session clock over. The historian
   *  buffer is untouched so window1m keeps working with existing data. */
  reset(): void {
    this.session = KPIComputer.freshSession();
    this.lastStableAwaSign = 0;
    this.candidateAwaSign = 0;
    this.candidateSinceMs = 0;
  }

  /** Called once per sampler tick by the plugin's samplerTick wrapper,
   *  BEFORE the sample lands in the historian buffer. All updates are
   *  O(1) so this is safe on Pi 4 at 1 Hz. */
  onSample(s: Sample): void {
    const dtSec = this.tickMs / 1000;
    if (s.engaged) this.session.engagedSec += dtSec;
    if (s.engaged && typeof s.sog === "number" && s.sog > 0) {
      // sog is m/s. m/s * s = m. Convert to nm.
      this.session.distanceNm += (s.sog * dtSec) / 1852;
    }
    if (typeof s.servoCurrent === "number" && s.servoCurrent > this.servoOnThresholdA) {
      this.session.servoRuntimeSec += dtSec;
      // A * s / 3600 = Ah
      this.session.energyAh += (s.servoCurrent * dtSec) / 3600;
    }
    if (typeof s.servoCurrent === "number" && s.servoCurrent > this.session.maxServoA) {
      this.session.maxServoA = s.servoCurrent;
    }
    this.tackGybeStep(s);
  }

  /** Sign-crossing detector for the AWA. A crossing counts once the new
   *  side has held for `tackDebounceMs` (default 3 s), which filters
   *  gust chatter that briefly flips the sensor across zero. Bow-through
   *  (tack) vs stern-through (gybe) is distinguished by the direction of
   *  the crossing:
   *   -1 -> +1  through 0        -> tack (bow crossed the wind)
   *   +1 -> -1  through 0        -> tack (bow crossed the wind)
   *   sign change through ±pi    -> gybe (stern crossed the wind)
   *  Since AWA is normally in (-pi, +pi], a bow-through crossing sees a
   *  small |AWA| at the moment of change; a stern-through crossing has
   *  |AWA| > pi/2. We approximate by looking at the |AWA| WHEN the sign
   *  flipped: <= pi/2 -> tack, > pi/2 -> gybe. */
  private tackGybeStep(s: Sample): void {
    if (!s.engaged) {
      // Reset the detector so a disengaged period never counts.
      this.lastStableAwaSign = 0;
      this.candidateAwaSign = 0;
      this.candidateSinceMs = 0;
      return;
    }
    if (typeof s.awa !== "number") return;
    const sign: -1 | 0 | 1 = s.awa > 0 ? 1 : s.awa < 0 ? -1 : 0;
    if (sign === 0) return;
    if (this.lastStableAwaSign === 0) {
      // Bootstrap: first stable reading is the baseline, no count.
      this.lastStableAwaSign = sign;
      this.candidateAwaSign = sign;
      this.candidateSinceMs = s.ts;
      return;
    }
    if (sign === this.lastStableAwaSign) {
      // Still on the same side - reset any pending candidate.
      this.candidateAwaSign = sign;
      this.candidateSinceMs = s.ts;
      return;
    }
    // sign != lastStableAwaSign - either a fresh candidate or a debounce
    // completing.
    if (sign !== this.candidateAwaSign) {
      this.candidateAwaSign = sign;
      this.candidateSinceMs = s.ts;
      return;
    }
    if (s.ts - this.candidateSinceMs >= this.tackDebounceMs) {
      // Debounce elapsed - COUNT it.
      const absAwa = Math.abs(s.awa);
      if (absAwa <= Math.PI / 2) this.session.tacks += 1;
      else this.session.gybes += 1;
      this.lastStableAwaSign = sign;
      this.candidateSinceMs = s.ts;
    }
  }

  snapshot(): KPISnapshot {
    return {
      computedTs: Date.now(),
      session: { ...this.session },
      window1m: this.computeWindow(this.windowSec),
    };
  }

  private computeWindow(sec: number): WindowStats {
    const samples = this.hist.slice(sec * 1000) as Sample[];
    const errors: number[] = [];
    let engagedCount = 0;
    let servoOnCount = 0;
    for (const s of samples) {
      if (s.engaged) engagedCount += 1;
      if (typeof s.servoCurrent === "number" && s.servoCurrent > this.servoOnThresholdA) {
        servoOnCount += 1;
      }
      if (s.engaged) {
        const e = errorRad(s);
        if (e != null) errors.push(e);
      }
    }
    let mean: number | null = null;
    let rms: number | null = null;
    let p95: number | null = null;
    if (errors.length > 0) {
      let sum = 0;
      let sumSq = 0;
      for (const e of errors) { sum += e; sumSq += e * e; }
      mean = sum / errors.length;
      rms = Math.sqrt(sumSq / errors.length);
      const abs = errors.map(Math.abs).sort((a, b) => a - b);
      const idx = Math.min(abs.length - 1, Math.floor(0.95 * (abs.length - 1)));
      p95 = abs[idx];
    }
    const duty = samples.length > 0 ? servoOnCount / samples.length : null;
    return {
      windowSec: sec,
      samples: samples.length,
      engagedSamples: engagedCount,
      meanErrorRad: mean,
      rmsErrorRad: rms,
      p95ErrorRad: p95,
      servoDutyPct: duty,
    };
  }
}

/** Heading error for a single sample. Compass / gps modes compare to
 *  headingActual; wind modes compare to awa. Result wrapped to
 *  [-pi, +pi]. Null if either operand is missing. */
export function errorRad(s: Sample): number | null {
  if (s.headingCmd == null) return null;
  const mode = (s.mode || "").toLowerCase();
  const actual = mode.includes("wind") ? s.awa : s.headingActual;
  if (actual == null) return null;
  let e = s.headingCmd - actual;
  while (e > Math.PI) e -= 2 * Math.PI;
  while (e < -Math.PI) e += 2 * Math.PI;
  return e;
}
