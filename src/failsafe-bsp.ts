// Fail-safe boat speed resolver.
//
// When both `navigation.speedThroughWater` (BSP) and
// `navigation.speedOverGround` (SOG) disappear at the same time —
// speedo cable snagged, GPS antenna covered by a sail, both plugin
// providers dropped — several downstream calculations collapse:
//
//   - `environment.wind.speedTrue` needs BSP to subtract vessel motion
//     from the masthead reading. Without BSP, `signalk-derived-data`
//     stops emitting TWS and everything that depends on it (Doctor
//     rules, wind KPIs, leeway estimator) goes null.
//   - Our `performance.leeway` estimator (leeway.ts) divides by
//     BSP squared and refuses to publish when BSP is null.
//
// The classical racing racks answer this with a configured "failsafe
// boat speed" — a plausible value (typically 5–7 kn for a cruising
// keelboat) that keeps the wind stack producing plausible numbers
// while the sailor investigates. We adopt the same pattern.
//
// Ranking (highest priority first):
//   1. Direct BSP.
//   2. SOG as proxy (acceptable in calm current; a source of error
//      when there is significant tide, but the alternative is a hole
//      in the wind chain).
//   3. Configured `failSafeBspKn` converted to m/s.
//   4. null.
//
// The caller receives both the resolved value and a `source` label so
// KPIs, Doctor, and the visor can tag any measurement that leans on
// the failsafe. This is important: a TWS computed off a failsafe BSP
// is a plausibility, not a measurement, and should not be graded like
// a real one.

const KN_PER_MS = 1.9438444924406046;

export type BspSource = "bsp" | "sog" | "failsafe" | "none";

export interface FailsafeBspOptions {
  /** Fallback boat speed in knots. 0 disables the failsafe (only
   *  BSP and SOG proxy are used). Practical range 3..10 kn. */
  failSafeBspKn: number;
}

export interface ResolvedBsp {
  /** Resolved boat speed in m/s, or null when nothing plausible
   *  was available and the failsafe is disabled. */
  valueMs: number | null;
  /** Which candidate produced `valueMs`. Callers persist this to
   *  tag downstream derivations that lean on the failsafe. */
  source: BspSource;
}

const DEFAULTS: FailsafeBspOptions = {
  failSafeBspKn: 0,
};

export class FailsafeBspResolver {
  private opts: FailsafeBspOptions;

  constructor(opts: Partial<FailsafeBspOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  update(patch: Partial<FailsafeBspOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  getOptions(): Readonly<FailsafeBspOptions> { return this.opts; }

  /** Pick a boat-speed value in m/s using the priority ladder.
   *  Callers pass whatever they read from SK; null and NaN are both
   *  treated as "missing". */
  resolve(bspMs: number | null, sogMs: number | null): ResolvedBsp {
    if (typeof bspMs === "number" && Number.isFinite(bspMs) && bspMs >= 0) {
      return { valueMs: bspMs, source: "bsp" };
    }
    if (typeof sogMs === "number" && Number.isFinite(sogMs) && sogMs >= 0) {
      return { valueMs: sogMs, source: "sog" };
    }
    if (this.opts.failSafeBspKn > 0) {
      return { valueMs: this.opts.failSafeBspKn / KN_PER_MS, source: "failsafe" };
    }
    return { valueMs: null, source: "none" };
  }
}
