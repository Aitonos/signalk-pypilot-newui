// Rev575 (GPT audit of 3.8.1, A07): constant-time angle wrapping.
//
// The old `while (x > PI) x -= 2*PI` loops never end for Infinity, and
// practically never for a huge finite value (1e300 - 2*PI === 1e300), so
// one bad number from a sensor or a delta would freeze Signal K's thread.
// These helpers use the remainder and return NaN for non-finite input;
// callers treat NaN as "no value".

const TWO_PI = 2 * Math.PI;

/** Wrap radians to [-PI, PI]; NaN when the input is not finite. */
export function wrapPi(a: number): number {
  if (!Number.isFinite(a)) return NaN;
  let r = ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  if (r === -Math.PI && a > 0) r = Math.PI;   // keep +PI as the old loops did
  return r;
}
