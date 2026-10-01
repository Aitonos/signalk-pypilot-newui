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
  | "preparing"   // Rev387: setup / mode-change arming, before any rotation
  | "turning"     // Rev387 (was "phase1"): driving compass intermediates
  | "handover"   // Rev387: within 20deg of final target, switching back to wind
  | "settling"   // Rev387 (new): wind mode set, waiting for AWA/TWA error < tol
  | "completed"  // Rev387 (was "done"): maneuver finished successfully
  | "cancelling" // Rev387 (new): abort requested, rollback in flight
  | "cancelled"  // Rev387 (was part of "abort"): user cancelled, rollback done
  | "failed";    // Rev387 (was part of "abort"): error / timeout, rollback best-effort

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
  /** Rev387: stable per-maneuver UUID so the visor can anchor its HUD
   *  and reject stale snapshots. */
  id: string;
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
  /** Rev387: last transition reason for the UI (timeout, user, error). */
  outcomeReason: string | null;
  /** Rev387: user-provided requestId for idempotent start. */
  requestId: string | null;
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
// Rev384 (Carlos, 2026-10-01): 60s was too long during harbour QA
// (moored boat never rotates → always timed out at 60s, cluttered the
// test cycle). 20s is enough for real sea trial steps (a close-hauled
// tack settles in 10-15s) while giving a fast abort in harbour.
export const DEFAULT_PHASE1_STEP_TIMEOUT_MS = 20_000;

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

  // Rev383 (Carlos, 2026-10-01): `direction` is the DIRECTION THE BOW
  // SWINGS TO, not the final amura. port = CCW rotation (delta_H < 0),
  // starboard = CW rotation (delta_H > 0). The compass delta magnitude
  // depends on whether the requested rotation side matches the natural
  // tack (cross the wind by the short arc) or forces a jibe (cross the
  // stern by the long arc).
  const angleStartSigned = normalizeSignedPi(opts.angleStartRad);
  const absStart = Math.abs(angleStartSigned);

  let angleNewRad: number;
  let deltaHRad: number;

  if (absStart < 15 * DEG) {
    // Near head-to-wind (in irons). The natural delta is tiny and its
    // sign is noisy; let the requested direction dictate the rotation,
    // and swing out to a defined 30deg amura on the OPPOSITE side so
    // the sailor exits irons cleanly.
    deltaHRad = dirSign * 30 * DEG;
    angleNewRad = angleStartSigned - deltaHRad;
  } else {
    // Normal case: a tack flips the sign of the wind angle so
    // angleNew = -angleStart, and the natural compass rotation is
    // naturalDelta = angleStart - angleNew = 2 * angleStart.
    angleNewRad = -angleStartSigned;
    const naturalDelta = 2 * angleStartSigned;
    if (Math.sign(naturalDelta) === dirSign) {
      // Natural tack rotation matches the requested side (short arc,
      // crosses the wind through the bow).
      deltaHRad = naturalDelta;
    } else {
      // Requested side is opposite the natural rotation → sailor wants
      // the LONG WAY around (crosses the stern = jibe). Both routes
      // reach the same final heading; this one just points the bow
      // where the button said it should go.
      deltaHRad = naturalDelta - Math.sign(naturalDelta) * TWO_PI;
    }
  }
  // Defensive cap: anything beyond a full circle is a degenerate input.
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
    id: "",
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
    outcomeReason: null,
    requestId: null,
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
