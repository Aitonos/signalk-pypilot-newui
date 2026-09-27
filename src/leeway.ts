// Leeway (drift angle) estimator.
//
// The classical drift model used by the racing crowd:
//
//     drift_deg = adj * heel_deg / bsp_kn^2
//
// with `adj` a single boat-specific coefficient (typical 9..12 for a
// keelboat). The value comes from the polar delivered by the naval
// architect: derive one drift observation at a known heel and boat
// speed, then rearrange
//
//     adj = drift_deg * bsp_kn^2 / heel_deg
//
// and average a few points. The formula is symmetric: a positive heel
// (stbd, mast to stbd in Signal K's convention) produces a positive
// leeway angle (boat is slipping to port relative to its heading).
//
// This module publishes `performance.leeway` in radians, matching the
// canonical Signal K path (see spec §navigation.performance). It is
// opt-in: absent an `adj` value in options the estimator returns null
// and nothing is published — we do NOT overwrite whatever
// `signalk-derived-data` (or any other plugin) is already emitting.
//
// Guardrails:
//   - `bsp_kn` is clamped from below at `minBspKn` (default 1 kn) so a
//     stopped or near-stopped boat does not explode the divisor.
//     Below `minBspKn` the estimator still emits — clamped, not null —
//     because the caller likely wants a smooth transition rather than
//     a hole in the display.
//   - Output is clamped to ±`maxLeewayDeg` (default 20°) so a bad
//     `adj` or a sensor glitch cannot produce a 90° leeway.
//   - When either `heel` or `bsp` is null the estimator returns null.

const KN_PER_MS = 1.9438444924406046; // 1 m/s in knots
const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;

export interface LeewayOptions {
  /** Boat-specific drift coefficient. Practical range 9..12. When 0
   *  the estimator is inert (compute() returns null). */
  adj: number;
  /** BSP floor in knots to prevent divide-by-zero. Default 1.0. */
  minBspKn: number;
  /** Symmetric clamp on the output in degrees. Default 20. */
  maxLeewayDeg: number;
}

const DEFAULTS: LeewayOptions = {
  adj: 0,
  minBspKn: 1.0,
  maxLeewayDeg: 20,
};

export class LeewayEstimator {
  private opts: LeewayOptions;

  constructor(opts: Partial<LeewayOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  update(patch: Partial<LeewayOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  getOptions(): Readonly<LeewayOptions> { return this.opts; }

  /** Returns leeway in radians, or null if the estimator is inert or
   *  a required input is missing.
   *
   *  heelRad: navigation.attitude.roll (positive stbd in SK convention).
   *  bspMs:   navigation.speedThroughWater.
   */
  compute(heelRad: number | null, bspMs: number | null): number | null {
    if (this.opts.adj <= 0) return null;
    if (typeof heelRad !== "number" || !Number.isFinite(heelRad)) return null;
    if (typeof bspMs !== "number" || !Number.isFinite(bspMs)) return null;

    const heelDeg = heelRad * DEG_PER_RAD;
    let bspKn = bspMs * KN_PER_MS;
    if (bspKn < this.opts.minBspKn) bspKn = this.opts.minBspKn;

    const driftDeg = (this.opts.adj * heelDeg) / (bspKn * bspKn);
    const clamped = Math.max(
      -this.opts.maxLeewayDeg,
      Math.min(this.opts.maxLeewayDeg, driftDeg),
    );
    return clamped * RAD_PER_DEG;
  }
}
