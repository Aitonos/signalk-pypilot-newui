// Post-tack catch-up offset.
//
// After the pilot completes a tack, the boat leaves the maneuver
// pointing at the new target heading but moving slower than it will
// be a few seconds later — the sails still filling, the hull still
// recovering apparent wind. Steering exactly at the new target here
// tends to bleed VMG: the boat needs a temporary bear-off of a few
// degrees to rebuild speed before settling to the true target.
//
// The classical racing racks answer this with a "tack offset": right
// after the tack the target is nudged a few degrees toward the wind
// off-course direction, then that nudge decays exponentially over a
// handful of seconds. This module models that behaviour as a pure
// state machine so the wire-up in index.ts can decide whether to
// (a) publish the offset as a diagnostic path or (b) actually add
// it to the commanded heading.
//
// Sign convention (Signal K wind mode):
//   AWA/TWA > 0  = wind from starboard (starboard tack)
//   AWA/TWA < 0  = wind from port (port tack)
//   After a tack from port→stbd tack (new AWA > 0) the temporary
//   bear-off is toward port, i.e. NEGATIVE target delta.
//   After a tack from stbd→port tack (new AWA < 0) the bear-off is
//   toward starboard, i.e. POSITIVE target delta.
// The caller passes the tack direction; the module returns a signed
// offset in radians.

const DEG = Math.PI / 180;

export type TackDirection = "port" | "stbd";

export interface TackCatchupOptions {
  /** Peak offset immediately after tack completion, in degrees.
   *  Practical range 0..15°. 0 disables the module. */
  offsetDeg: number;
  /** Exponential decay time constant, seconds. Practical 2..12 s. */
  tauSec: number;
}

const DEFAULTS: TackCatchupOptions = {
  offsetDeg: 0,
  tauSec: 6,
};

export class TackCatchup {
  private opts: TackCatchupOptions;
  private startedAtMs: number | null = null;
  private direction: TackDirection | null = null;

  constructor(opts: Partial<TackCatchupOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  update(patch: Partial<TackCatchupOptions>): void {
    this.opts = { ...this.opts, ...patch };
    if (this.opts.offsetDeg <= 0) this.reset();
  }

  getOptions(): Readonly<TackCatchupOptions> { return this.opts; }

  /** Whether a decay is currently in progress. */
  isActive(): boolean { return this.startedAtMs != null; }

  /** Cancel any ongoing decay. Call on standby, mode change, or
   *  when the sailor manually reissues a target. */
  reset(): void {
    this.startedAtMs = null;
    this.direction = null;
  }

  /** Signal that a tack has just completed. Starts a fresh decay
   *  window; a mid-decay tack simply overwrites the previous state
   *  (the sailor has committed to a new maneuver). */
  onTackComplete(direction: TackDirection, nowMs: number): void {
    if (this.opts.offsetDeg <= 0) return;
    this.startedAtMs = nowMs;
    this.direction = direction;
  }

  /** Compute the current catch-up delta in radians. Returns 0 when
   *  the module is inert, no tack has been signalled, or the decay
   *  has fallen below the practical noise floor (~0.1°). */
  compute(nowMs: number): number {
    if (this.opts.offsetDeg <= 0) return 0;
    if (this.startedAtMs == null || this.direction == null) return 0;
    const dtSec = (nowMs - this.startedAtMs) / 1000;
    if (dtSec < 0) return 0;
    const peakRad = this.opts.offsetDeg * DEG;
    const decayed = peakRad * Math.exp(-dtSec / Math.max(0.1, this.opts.tauSec));
    // Prune when the residual would be sub-degree noise: further
    // decimals just churn without changing the sailor's experience.
    if (decayed < 0.1 * DEG) {
      this.reset();
      return 0;
    }
    // Bear-off direction: after a tack ONTO port tack the boat wants
    // to bear off toward starboard, and vice versa. See sign note in
    // the file header.
    const sign = this.direction === "port" ? +1 : -1;
    return sign * decayed;
  }
}
