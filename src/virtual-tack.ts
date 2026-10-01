/**
 * virtual-tack.ts — Rev377 (Carlos, 2026-10-01)
 *
 * Virtual two-phase tack that bypasses the pypilot core
 * "direction rewrite on short arc" bug in wind modes.
 *
 * Design validated 2026-10-01 (memory: virtual-tack-wind-mode-design):
 *
 *   Phase 1 — Switch pypilot to COMPASS, rotate the hull by the
 *             geometric delta we compute ourselves (fractionated into
 *             <=170deg steps so pypilot's internal short-arc selection
 *             never fights our intended direction). Stop phase 1 when
 *             the remaining rotation is within 20 degrees of H_target.
 *
 *   Phase 2 — Switch pypilot back to the original wind mode
 *             (wind | true wind) and command the final target angle
 *             (AWA_new or TWA_new). The last <=20 degrees are small
 *             enough that pypilot's own short-arc choice is trivially
 *             the correct one, so the upstream bug cannot bite.
 *
 * This file only contains the geometry primitives + the FSM shell.
 * Wiring into apTackPort/apTackStar comes in Rev378.
 */

export type WindMode = "wind" | "true wind";

export type TackDirection = "port" | "starboard";

export type VirtualTackPhase =
  | "idle"
  | "calc"
  | "phase1"
  | "phase2"
  | "done"
  | "abort";

export interface TackGeometry {
  /** The signed source angle at tack start, radians. Positive = starboard. */
  angleStartRad: number;
  /** The signed source angle target after the tack, radians. */
  angleNewRad: number;
  /** Compass delta needed to rotate the hull, radians. Signed. Wrapped to (-pi, +pi]. */
  deltaHRad: number;
  /** Absolute compass heading at tack start, radians (0..2pi). */
  hStartRad: number;
  /** Absolute compass heading we want at the end of phase 1, radians (0..2pi). */
  hTargetRad: number;
  /** Phase 1 intermediate compass targets, radians (0..2pi), in order. */
  intermediatesRad: number[];
}

/** Cached geometry + runtime state for one virtual tack cycle. */
export interface VirtualTackState {
  phase: VirtualTackPhase;
  windMode: WindMode | null;
  direction: TackDirection | null;
  geometry: TackGeometry | null;
  /** Index into geometry.intermediatesRad currently being driven. */
  stepIndex: number;
  startedAtMs: number;
  /** For rollback — mode + angle at tack start, so Abort can restore. */
  originalMode: WindMode | null;
  originalAngleRad: number | null;
  /** Last observed state.mode (for mode-change watchdog). */
  lastSeenModeChangeTargetAtMs: number;
  /** For phase 1 stuck detection. */
  phase1StepStartedAtMs: number;
}

export const TWO_PI = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Default thresholds — Carlos validated 2026-10-01. */
export const DEFAULT_PHASE_TOLERANCE_DEG = 20;
export const DEFAULT_PHASE1_SWITCH_DEG = 20;
export const DEFAULT_MAX_STEP_DEG = 170;
export const DEFAULT_MODE_SWITCH_SETTLE_MS = 150;
export const DEFAULT_MODE_SWITCH_TIMEOUT_MS = 500;
export const DEFAULT_PHASE1_STEP_TIMEOUT_MS = 60_000;

/**
 * Normalize radians to [0, 2pi).
 * Works for arbitrarily negative or large inputs.
 */
export function normalizeTwoPi(rad: number): number {
  const r = rad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/**
 * Normalize radians to the signed (-pi, +pi] range.
 * Used for direction-aware deltas.
 */
export function normalizeSignedPi(rad: number): number {
  let r = ((rad + Math.PI) % TWO_PI) - Math.PI;
  // (-PI, +PI]: nudge -PI up to +PI so the result includes +PI, excludes -PI.
  if (r <= -Math.PI) r += TWO_PI;
  return r;
}

/**
 * Signed shortest-arc delta from `fromRad` to `toRad`, in (-pi, +pi].
 * Positive = clockwise (starboard).
 */
export function signedAngleDelta(fromRad: number, toRad: number): number {
  return normalizeSignedPi(toRad - fromRad);
}

/**
 * Core geometry primitive — returns everything the FSM needs to drive
 * phase 1 and phase 2.
 *
 * Convention (Signal K standard):
 *   - heading compass: 0 = north, increases clockwise.
 *   - angle (AWA or TWA) signed: positive = wind from STARBOARD.
 *   - A tack flips the sign of the wind-angle: angleNew = -angleStart.
 *   - Compass rotation needed: deltaH = angleStart - angleNew = 2 * angleStart.
 *     Positive deltaH = clockwise rotation (starboard tack from port tack).
 *
 * The explicit `direction` argument lets the caller force a side even
 * when the sign of `angleStartRad` is ambiguous near head-to-wind or
 * dead-downwind — in those cases we pick the magnitude from a conservative
 * fallback and the sign from `direction`.
 */
export function computeTackGeometry(opts: {
  angleStartRad: number;
  hStartRad: number;
  direction: TackDirection;
  maxStepDeg?: number;
}): TackGeometry {
  const maxStepRad = (opts.maxStepDeg ?? DEFAULT_MAX_STEP_DEG) * DEG;
  const dirSign = opts.direction === "starboard" ? +1 : -1;

  // Normalize source angle to (-pi, +pi].
  const angleStartSigned = normalizeSignedPi(opts.angleStartRad);

  // Base magnitude of the current amura (how far off head-to-wind we are).
  // Clamp to a conservative floor so a tiny AWA near 0 does not produce
  // a degenerate 0deg tack — in that case we rotate at least ~30deg to
  // get out of irons.
  const magnitude = Math.max(Math.abs(angleStartSigned), 30 * DEG);

  // The post-tack source angle has the sign of the requested side
  // (direction=starboard means we want wind FROM port after the tack,
  // which is a negative TWA under the "positive = from starboard" convention).
  const angleNewRad = -dirSign * magnitude;

  // Compass rotation needed to achieve that flip. We take the signed
  // difference angleStart - angleNew: positive = clockwise = starboard rotation.
  // The sign of deltaHRad agrees with `direction` by construction.
  let deltaHRad = angleStartSigned - angleNewRad;
  // Preserve sign: do NOT wrap deltaHRad to (-pi, +pi] because tacks in
  // the downwind quadrants may legitimately need > 180deg of rotation,
  // and the fractionation step below depends on knowing the real signed
  // magnitude.
  // However, cap it at the full circle minus epsilon — anything larger
  // is a degenerate input.
  if (deltaHRad > TWO_PI) deltaHRad -= TWO_PI;
  if (deltaHRad < -TWO_PI) deltaHRad += TWO_PI;

  const hStartRad = normalizeTwoPi(opts.hStartRad);
  const hTargetRad = normalizeTwoPi(hStartRad + deltaHRad);

  // Fractionate the rotation so no single step exceeds maxStepRad.
  // Pypilot in compass mode picks the SHORT arc automatically, so a
  // single-shot target with |delta| > 180deg would spin the hull the
  // wrong way; by capping steps at <=170deg we guarantee that pypilot's
  // short-arc choice ALWAYS matches our intended direction.
  const intermediatesRad = fractionateRotation({
    hStartRad,
    deltaHRad,
    maxStepRad,
  });

  return {
    angleStartRad: angleStartSigned,
    angleNewRad,
    deltaHRad,
    hStartRad,
    hTargetRad,
    intermediatesRad,
  };
}

/**
 * Split a signed compass rotation into N consecutive intermediate
 * absolute heading targets, each one at most `maxStepRad` away from
 * the previous. The final element always equals the overall target.
 *
 * Guaranteed:
 *   - All intermediates are in [0, 2pi).
 *   - The intermediate chain monotonically advances by `sign(deltaH)` in
 *     unwrapped terms, so pypilot's short-arc choice in compass mode
 *     agrees with the sign at every step.
 *   - For |deltaH| <= maxStep the result is a single element.
 */
export function fractionateRotation(opts: {
  hStartRad: number;
  deltaHRad: number;
  maxStepRad: number;
}): number[] {
  const { hStartRad, deltaHRad, maxStepRad } = opts;
  if (maxStepRad <= 0) {
    throw new Error("fractionateRotation: maxStepRad must be > 0");
  }
  const out: number[] = [];
  const absDelta = Math.abs(deltaHRad);
  if (absDelta < 1e-6) return out;

  const sign = deltaHRad >= 0 ? +1 : -1;
  const n = Math.ceil(absDelta / maxStepRad);
  for (let i = 1; i <= n; i++) {
    const stepMag = Math.min(i * maxStepRad, absDelta);
    const h = normalizeTwoPi(hStartRad + sign * stepMag);
    out.push(h);
  }
  return out;
}

/**
 * Initial state for a fresh virtual tack cycle. The FSM owner (the
 * autopilot provider in Rev378) seeds this and then advances it from
 * its periodic tick.
 */
export function makeInitialState(): VirtualTackState {
  return {
    phase: "idle",
    windMode: null,
    direction: null,
    geometry: null,
    stepIndex: 0,
    startedAtMs: 0,
    originalMode: null,
    originalAngleRad: null,
    lastSeenModeChangeTargetAtMs: 0,
    phase1StepStartedAtMs: 0,
  };
}

/**
 * Convenience: did the hull reach the current phase-1 intermediate
 * within `toleranceDeg`? Compared on the signed shortest arc so
 * wrap-around at 0/360 is handled.
 */
export function isAtTarget(opts: {
  hNowRad: number;
  hTargetRad: number;
  toleranceDeg?: number;
}): boolean {
  const tol = (opts.toleranceDeg ?? DEFAULT_PHASE_TOLERANCE_DEG) * DEG;
  return Math.abs(signedAngleDelta(opts.hNowRad, opts.hTargetRad)) <= tol;
}

/**
 * Convenience: has the current wind-source angle converged on the
 * tack target angle within `toleranceDeg`? Used in phase 2 to decide
 * when the overall maneuver is done.
 */
export function isWindConverged(opts: {
  angleNowRad: number;
  angleTargetRad: number;
  toleranceDeg?: number;
}): boolean {
  const tol = (opts.toleranceDeg ?? DEFAULT_PHASE_TOLERANCE_DEG) * DEG;
  return (
    Math.abs(signedAngleDelta(opts.angleNowRad, opts.angleTargetRad)) <= tol
  );
}
