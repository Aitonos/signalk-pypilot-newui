// Rev545 (Carlos 2026-10-23): follow a Freeboard route with pypilot's own
// NAV mode, no extra plugins. This module is PURE (no I/O): leg geometry,
// waypoint arrival and the APB sentence pypilot reads.
// Design: docs/_design_route_following_2026-10-23.md.
//
// pypilot (nmea.py / sensors.py, master) reads from APB: field [2] XTE (nm),
// [3] L/R, [12] track, [13] T/M (only T is used). In NAV mode it steers
// heading_command = track + apb.xte.gain (300) * xte, at most 2 APB/s, and
// drops the APB source after 8 s without one. Its XTE cap is one-sided
// (min(xte, 0.15)), so we cap both sides here.

export interface LatLon { latitude: number; longitude: number }   // degrees

const R_EARTH_M = 6_371_000;
const D2R = Math.PI / 180;
export const M_PER_NM = 1852;
/** pypilot clips XTE at +0.15 nm only; we clip both ways before sending. */
export const APB_XTE_CAP_NM = 0.15;

export function isLatLon(p: unknown): p is LatLon {
  const q = p as LatLon;
  return !!q && typeof q.latitude === "number" && typeof q.longitude === "number"
    && isFinite(q.latitude) && isFinite(q.longitude) && Math.abs(q.latitude) <= 90 && Math.abs(q.longitude) <= 180;
}

/** Great-circle distance, metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const f1 = a.latitude * D2R, f2 = b.latitude * D2R;
  const df = f2 - f1, dl = (b.longitude - a.longitude) * D2R;
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing a -> b, radians true in [0, 2pi). */
export function bearingRad(a: LatLon, b: LatLon): number {
  const f1 = a.latitude * D2R, f2 = b.latitude * D2R, dl = (b.longitude - a.longitude) * D2R;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  const t = Math.atan2(y, x);
  return (t + 2 * Math.PI) % (2 * Math.PI);
}

export interface LegState {
  /** Bearing of the leg prev -> next (what pypilot steers on), rad true. */
  legBearingRad: number;
  /** Bearing from the boat to the waypoint, rad true. */
  bearingToWpRad: number;
  /** Distance boat -> waypoint, metres. */
  distanceM: number;
  /** Cross-track error, metres; POSITIVE = boat to starboard of the track. */
  xteM: number;
  /** Inside the arrival circle. */
  arrived: boolean;
  /** Past the line through the waypoint perpendicular to the leg. */
  perpendicularPassed: boolean;
}

/** Leg geometry for the boat at `pos` on the leg `prev` -> `next`. Without a
 *  usable previous point (or prev == next) the leg is boat -> waypoint. */
export function legState(prev: LatLon | null, next: LatLon, pos: LatLon, arrivalCircleM: number): LegState {
  const dWp = distanceM(pos, next);
  const brgWp = bearingRad(pos, next);
  const usePrev = prev && distanceM(prev, next) > 1;
  const legBrg = usePrev ? bearingRad(prev!, next) : brgWp;
  let xte = 0, perp = false;
  if (usePrev) {
    // Cross-track: signed distance from the great circle prev -> next.
    const d13 = distanceM(prev!, pos) / R_EARTH_M;
    const t13 = bearingRad(prev!, pos);
    const xt = Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(t13 - legBrg))));
    xte = xt * R_EARTH_M;   // > 0 when pos is to the right of the track
    // Along-track distance from prev; past the waypoint when beyond the leg.
    const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.max(1e-12, Math.cos(xt))))) * R_EARTH_M;
    const ahead = Math.cos(t13 - legBrg) >= 0;   // projection falls ahead of prev
    perp = ahead && at > distanceM(prev!, next);
  }
  const circle = Math.max(0, Number(arrivalCircleM) || 0);
  return {
    legBearingRad: legBrg,
    bearingToWpRad: brgWp,
    distanceM: dWp,
    xteM: xte,
    arrived: circle > 0 && dWp <= circle,
    perpendicularPassed: perp,
  };
}

/** NMEA checksum. */
export function nmeaChecksum(body: string): string {
  let c = 0;
  for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i);
  return c.toString(16).toUpperCase().padStart(2, "0");
}

const deg = (r: number) => ((r / D2R) % 360 + 360) % 360;

/** APB sentence for pypilot. Field 13 ("heading to steer") carries the LEG
 *  bearing: pypilot adds its own XTE correction (gain * xte), so we must not
 *  pre-correct. XTE clipped to +-APB_XTE_CAP_NM. */
export function buildApb(leg: LegState, wpId: string, talker = "GP"): string {
  const xteNm = Math.min(APB_XTE_CAP_NM, Math.abs(leg.xteM) / M_PER_NM);
  // Boat right of the track -> steer LEFT (pypilot: 'L' makes xte negative).
  const dir = leg.xteM > 0 ? "L" : "R";
  const id = String(wpId || "WP").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 10) || "WP";
  const f = [
    "A", "A",
    xteNm.toFixed(3), dir, "N",
    leg.arrived ? "A" : "V",
    leg.perpendicularPassed ? "A" : "V",
    deg(leg.legBearingRad).toFixed(1), "T",
    id,
    deg(leg.bearingToWpRad).toFixed(1), "T",
    deg(leg.legBearingRad).toFixed(1), "T",
  ];
  const body = `${talker}APB,${f.join(",")}`;
  return `$${body}*${nmeaChecksum(body)}`;
}

/** Spoken / shown waypoint name. */
export function wpLabel(name: string | null | undefined, index: number | null): string {
  const n = String(name || "").trim();
  if (n) return n.slice(0, 40);
  return index != null ? `WP ${index + 1}` : "WP";
}
