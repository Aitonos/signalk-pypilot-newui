// High-level tuning knobs: expose three sliders to the sailor instead
// of raw P/I/D/DD. Under the hood the module maps
//
//   Aggressivity          a ∈ [0, 100], centre 50
//   Understeer/Oversteer  u ∈ [-100, +100], centre 0  (- = more P, + = more D)
//   Balance Heading/Rate  b ∈ [-100, +100], centre 0  (- = more I, + = more DD)
//
// onto a set of four pypilot gains (P, I, D, DD). The mapping preserves
// two invariants worth keeping in mind:
//
//   1. IDENTITY: knobs (50, 0, 0) returns baseline verbatim. This is
//      what the sailor sees the first time the panel opens, so the
//      centre position must never move a working boat.
//   2. CLAMPED: each final gain is baseline * factor where factor is
//      clamped to [0.3, 3.0]. No slider combination can drop or raise
//      a gain by more than 3× — a safety net against a runaway UI or
//      a bug in the mapping.
//
// The module is PURE. The plugin passes in the baseline (usually the
// gains snapshotted when the user opened the panel) and gets back the
// four computed gains. Applying them to pypilot is a separate call
// that the caller decides to make.

export interface TuningKnobs {
  /** 0..100, centre 50. Global scale on P and D. */
  aggressivity: number;
  /** -100..+100, centre 0. Negative → boost P (understeer fix).
   *  Positive → boost D (oversteer fix). */
  understeerOversteer: number;
  /** -100..+100, centre 0. Negative → boost I (heading focus).
   *  Positive → boost DD (rate damping focus). */
  balanceHeadingRate: number;
}

export interface GainSet {
  P: number;
  I: number;
  D: number;
  DD: number;
}

/** Any factor applied to a baseline gain is clamped to this range,
 *  regardless of the slider combination. */
export const MIN_FACTOR = 0.3;
export const MAX_FACTOR = 3.0;

/** Neutral knobs — the identity point where computeGains() returns
 *  the baseline unchanged. Handy for tests and for the "reset" button. */
export const NEUTRAL_KNOBS: TuningKnobs = {
  aggressivity: 50,
  understeerOversteer: 0,
  balanceHeadingRate: 0,
};

/** Compute the pypilot gains that correspond to the given knob
 *  positions relative to `baseline`. Pure function; no I/O.
 *
 *  A baseline gain of 0 stays 0 (multiplying by any factor still
 *  yields 0). That way a boat that doesn't use DD keeps DD=0 and
 *  the slider is harmless.
 */
export function computeGains(baseline: GainSet, knobs: TuningKnobs): GainSet {
  const a = clamp01(knobs.aggressivity / 100);
  const u = clampPn1(knobs.understeerOversteer / 100);
  const b = clampPn1(knobs.balanceHeadingRate / 100);

  // aggScale: 0.5..1.5, exactly 1.0 at a=0.5 (identity point).
  const aggScale = 0.5 + a * 1.0;

  // Understeer/Oversteer shifts weight between P and D.
  //   u < 0 (understeer): boost P by up to +40%, drop D by up to -15%
  //   u > 0 (oversteer):  boost D by up to +40%, drop P by up to -15%
  // Asymmetric magnitudes intentional: the "boost the deficient one"
  // move is larger than the "trim the strong one" move.
  const negU = Math.max(0, -u);
  const posU = Math.max(0, u);
  const pShift = 1 + negU * 0.40 - posU * 0.15;
  const dShift = 1 - negU * 0.15 + posU * 0.40;

  // Balance shifts weight between I and DD.
  //   b < 0 (heading focus): boost I by up to +60%, drop DD by up to -20%
  //   b > 0 (rate focus):    boost DD by up to +60%, drop I by up to -20%
  // Larger swing here because I and DD play more disjoint roles than
  // P and D do.
  const negB = Math.max(0, -b);
  const posB = Math.max(0, b);
  const iShift  = 1 + negB * 0.60 - posB * 0.20;
  const ddShift = 1 - negB * 0.20 + posB * 0.60;

  return {
    P:  baseline.P  * clampFactor(aggScale * pShift),
    I:  baseline.I  * clampFactor(iShift),
    D:  baseline.D  * clampFactor(aggScale * dShift),
    DD: baseline.DD * clampFactor(ddShift),
  };
}

/** Round each gain to 4 significant digits — pypilot stores floats
 *  and the difference below the 5th digit is not physically
 *  meaningful, so this stops the UI from showing 0.030000000004. */
export function roundGains(g: GainSet): GainSet {
  return {
    P:  round4sig(g.P),
    I:  round4sig(g.I),
    D:  round4sig(g.D),
    DD: round4sig(g.DD),
  };
}

/** Validation for a knobs object coming from an HTTP body.
 *  Returns null if valid, an error message otherwise. */
export function validateKnobs(x: unknown): string | null {
  if (!x || typeof x !== "object") return "knobs is not an object";
  const k = x as Record<string, unknown>;
  const checks: Array<[string, number, number]> = [
    ["aggressivity", 0, 100],
    ["understeerOversteer", -100, 100],
    ["balanceHeadingRate", -100, 100],
  ];
  for (const [name, min, max] of checks) {
    const v = k[name];
    if (typeof v !== "number" || !isFinite(v)) return `knobs.${name} not a finite number`;
    if (v < min || v > max) return `knobs.${name}=${v} outside [${min},${max}]`;
  }
  return null;
}

/** Validation for a baseline gain set. */
export function validateBaseline(x: unknown): string | null {
  if (!x || typeof x !== "object") return "baseline is not an object";
  const b = x as Record<string, unknown>;
  for (const key of ["P", "I", "D", "DD"] as const) {
    const v = b[key];
    if (typeof v !== "number" || !isFinite(v)) return `baseline.${key} not a finite number`;
    if (v < 0) return `baseline.${key}=${v} is negative (pypilot gains are non-negative)`;
  }
  return null;
}

// ---------- helpers ----------

// NaN falls to the centre of the axis (0 for both). +Infinity clamps
// to the max; -Infinity clamps to the min. The centres are safe: for
// aggressivity the panel opens at 50 (which normalises to 0.5), and
// for the +/-1 sliders 0 = identity.
function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function clampPn1(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x <= -1) return -1;
  if (x >= 1) return 1;
  return x;
}

function clampFactor(f: number): number {
  if (Number.isNaN(f)) return 1;
  if (f <= MIN_FACTOR) return MIN_FACTOR;
  if (f >= MAX_FACTOR) return MAX_FACTOR;
  return f;
}

function round4sig(x: number): number {
  if (x === 0 || !isFinite(x)) return x;
  const mag = Math.pow(10, 3 - Math.floor(Math.log10(Math.abs(x))));
  return Math.round(x * mag) / mag;
}
