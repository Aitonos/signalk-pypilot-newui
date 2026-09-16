// Roll feed-forward computer.
//
// Boats in a downwind seaway roll enough that each swing generates an
// evolving moment: as the boat heels to one side, the hull's asymmetric
// waterplane produces a small yaw bump that the AP would normally see
// as heading error and correct AFTER the bump — too late, over-shooting
// the target and starting a snake. A feed-forward term keyed off the
// dynamic roll (the bumps, not the mean heel) applies a small
// pre-emptive shift of the commanded heading, so the AP acts BEFORE
// the heading itself starts moving.
//
// Sign convention (Signal K convention):
//   roll > 0  = starboard heel (mast to stbd)
//   in downwind & aft quarter this bumps yaw toward port ("bear-away
//   to port") - so the target should shift toward port to compensate,
//   which in a right-handed heading frame means a NEGATIVE delta on the
//   commanded heading.
//   ergo delta = -gain * rollHighPass  (a stbd bump produces a port
//   correction, matching physical intuition).
//
// Behaviour envelope:
//   - Disabled when gain <= 0.  This is the default.
//   - Disabled when AP not engaged (nothing to correct).
//   - Disabled when |TWA| <= twaGateDeg (closehauled/reach: the
//     mechanism does not apply; forcing a target shift there would only
//     add noise).
//   - Output clamped to ±maxDeltaRad so a huge roll spike can never
//     command the AP to swing 30° at once.
//
// This module is PURE. It computes a delta on each sample; the caller
// decides whether to publish it (Rev282+) or to actually add it to the
// AP's heading_command (staged for a later Rev once we can validate at
// sea).

export interface RollFFOptions {
  /** Feed-forward gain. Dimensionless: output_rad = -gain * rollHp_rad.
   *  Practical range 0.05 .. 0.5. Off (=inert) at 0. */
  gain: number;
  /** High-pass filter time constant, seconds. Larger = more of the
   *  low-frequency heel component is preserved. Typical 2..5 s. */
  tauSec: number;
  /** Absolute TWA (deg) above which the FF is active. Below this the
   *  FF returns 0 without touching internal state. Default 90. */
  twaGateDeg: number;
  /** Symmetric clamp on the output (rad). Default 10° = 0.1745. */
  maxDeltaRad: number;
}

const DEFAULTS: RollFFOptions = {
  gain: 0,
  tauSec: 3,
  twaGateDeg: 90,
  maxDeltaRad: 10 * Math.PI / 180,
};

export class RollFeedForward {
  private opts: RollFFOptions;
  private rollHp = 0;
  private lastRoll: number | null = null;
  private lastTs: number | null = null;

  constructor(opts: Partial<RollFFOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Update tuning at runtime (e.g. from a slider in Setup). */
  update(patch: Partial<RollFFOptions>): void {
    this.opts = { ...this.opts, ...patch };
    // If turned off, drop stale HP state so a re-enable starts clean.
    if (this.opts.gain <= 0) this.reset();
  }

  /** Discard filter state and last sample. Call on disengage. */
  reset(): void {
    this.rollHp = 0;
    this.lastRoll = null;
    this.lastTs = null;
  }

  /** Read-only view of current options (for /roll-ff and unit tests). */
  getOptions(): Readonly<RollFFOptions> { return this.opts; }

  /** Current high-pass state, exposed for diagnostics. */
  getState(): { rollHpRad: number; hasSample: boolean } {
    return { rollHpRad: this.rollHp, hasSample: this.lastRoll != null };
  }

  /** Compute the feed-forward delta for this sample, in rad.
   *  Returns 0 when disabled, disengaged, or gated out by TWA. Also
   *  advances the internal HP state.
   *
   *  Sample-rate agnostic: uses (ts_now - ts_prev) to size the HP
   *  coefficient, so a 1 Hz historian and a 10 Hz test bench both
   *  yield the same steady-state shape (only the resolution differs).
   */
  compute(s: {
    ts: number;
    heel: number | null;
    twa: number | null;
    engaged: boolean;
  }): number {
    if (this.opts.gain <= 0) return 0;
    if (!s.engaged) { this.reset(); return 0; }
    if (typeof s.heel !== "number") return 0;

    // TWA gate. Absent TWA is treated as "unknown" → gated out.
    if (typeof s.twa !== "number") { this.reset(); return 0; }
    const twaAbsDeg = Math.abs(s.twa) * 180 / Math.PI;
    if (twaAbsDeg <= this.opts.twaGateDeg) { this.reset(); return 0; }

    // First sample: seed the filter without emitting.
    if (this.lastRoll == null || this.lastTs == null) {
      this.lastRoll = s.heel;
      this.lastTs = s.ts;
      // rollHp starts at 0.
      return 0;
    }

    const dtSec = (s.ts - this.lastTs) / 1000;
    if (dtSec <= 0) return 0;

    // Discrete high-pass: y[n] = a * (y[n-1] + x[n] - x[n-1]),
    // with a = tau / (tau + dt). At tau >> dt, a ≈ 1 and the HP
    // integrates fast bumps; at tau ~ dt, a ≈ 0.5 and the HP
    // decays quickly.
    const a = this.opts.tauSec / (this.opts.tauSec + dtSec);
    this.rollHp = a * (this.rollHp + s.heel - this.lastRoll);

    this.lastRoll = s.heel;
    this.lastTs = s.ts;

    let delta = -this.opts.gain * this.rollHp;
    if (delta > this.opts.maxDeltaRad) delta = this.opts.maxDeltaRad;
    if (delta < -this.opts.maxDeltaRad) delta = -this.opts.maxDeltaRad;
    return delta;
  }
}
