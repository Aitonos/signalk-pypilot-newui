// APB target computer.
//
// When a waypoint is active, Signal K exposes two ways to steer to it:
//
//   navigation.courseGreatCircle.nextPoint.bearingTrue
//     The direct bearing FROM the boat TO the waypoint. Simple; ignores
//     cross-track error and set/drift. This is what an NMEA0183 APB
//     sentence carries when configured for "bearing to waypoint".
//
//   navigation.courseGreatCircle.nextPoint.steerTo
//     The heading the boat should steer to actually stay on the
//     track between prevPoint and nextPoint. Includes an XTE
//     correction and, when the current-drift plugin is running, a
//     drift compensation. This is what an MFD's "heading to steer"
//     shows and is what a serious NAV mode should follow.
//
// The two agree when the boat is on-track and there is no current;
// they diverge when set/drift or XTE is significant.
//
// This module is PURE. Given the app.getCourse() shape and a user
// preference (auto / steerTo / bearing), it returns the value to use
// plus what source it came from. Nothing here writes to pypilot.

export type ApbSource = "auto" | "steerTo" | "bearing";

/** Subset of the Signal K API v2 course data shape we care about.
 *  Kept structural on purpose — the real object is bigger. */
export interface CourseData {
  nextPoint?: {
    bearingTrue?: number | null;    // rad
    steerTo?: number | null;         // rad
    distance?: number | null;        // m
    velocityMadeGood?: number | null;
  };
  crossTrackError?: number | null;   // m, signed (positive = starboard of track)
  activeRoute?: { name?: string; href?: string };
}

export interface ApbTarget {
  /** Chosen target heading in radians. Null if no waypoint. */
  targetRad: number | null;
  /** Which path actually supplied the number. */
  source: "steerTo" | "bearing" | "none";
  /** Cross-track error in metres (signed, positive = stbd of track). Null when unavailable. */
  xteM: number | null;
  /** Distance to next waypoint in metres. Null when unavailable. */
  distanceM: number | null;
  /** True when the sailor asked for steerTo but only bearingTrue was
   *  available on the wire — a signal that the current-drift plugin is
   *  probably not running. */
  fallback: boolean;
}

/** Given course data and a preference, pick the target. */
export function computeApbTarget(course: CourseData | null | undefined, pref: ApbSource): ApbTarget {
  const nxt = course?.nextPoint;
  if (!nxt) {
    return { targetRad: null, source: "none", xteM: null, distanceM: null, fallback: false };
  }
  const steerTo = typeof nxt.steerTo === "number" && isFinite(nxt.steerTo) ? nxt.steerTo : null;
  const bearing = typeof nxt.bearingTrue === "number" && isFinite(nxt.bearingTrue) ? nxt.bearingTrue : null;
  const xte = typeof course?.crossTrackError === "number" ? course!.crossTrackError! : null;
  const dist = typeof nxt.distance === "number" ? nxt.distance : null;

  // Resolve preference.
  if (pref === "steerTo") {
    if (steerTo != null) return { targetRad: steerTo, source: "steerTo", xteM: xte, distanceM: dist, fallback: false };
    if (bearing != null) return { targetRad: bearing, source: "bearing", xteM: xte, distanceM: dist, fallback: true };
    return { targetRad: null, source: "none", xteM: xte, distanceM: dist, fallback: false };
  }
  if (pref === "bearing") {
    if (bearing != null) return { targetRad: bearing, source: "bearing", xteM: xte, distanceM: dist, fallback: false };
    if (steerTo != null) return { targetRad: steerTo, source: "steerTo", xteM: xte, distanceM: dist, fallback: true };
    return { targetRad: null, source: "none", xteM: xte, distanceM: dist, fallback: false };
  }
  // "auto": prefer steerTo (usually the plotter's "heading to steer")
  // and fall back to bearing without flagging that as a problem — a
  // vanilla install without a current-drift plugin is not misconfigured.
  if (steerTo != null) return { targetRad: steerTo, source: "steerTo", xteM: xte, distanceM: dist, fallback: false };
  if (bearing != null) return { targetRad: bearing, source: "bearing", xteM: xte, distanceM: dist, fallback: false };
  return { targetRad: null, source: "none", xteM: xte, distanceM: dist, fallback: false };
}

/** Convenience: describe the divergence in a way the visor can render. */
export function apbDivergence(course: CourseData | null | undefined): {
  bothPresent: boolean;
  divergenceRad: number | null;
} {
  const nxt = course?.nextPoint;
  const s = nxt?.steerTo, b = nxt?.bearingTrue;
  if (typeof s !== "number" || typeof b !== "number") {
    return { bothPresent: false, divergenceRad: null };
  }
  let d = s - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return { bothPresent: true, divergenceRad: d };
}

/** Validate an ApbSource coming from a POST body. */
export function isApbSource(x: unknown): x is ApbSource {
  return x === "auto" || x === "steerTo" || x === "bearing";
}
