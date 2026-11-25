// Rev772 (Carlos 2026-11-25: "una virada es cuando hacemos un bordo /
// trasluchada, no cuando cambiamos levemente de rumbo"). One rule for the
// logbook's count, its map markers and the live trip.
//
// A tack or gybe is counted when, together:
//   1. the true wind changes side (TWA between 20 and 160 deg on each side,
//      so wind near the bow or stern decides nothing) and stays on the new
//      side for 45 s;
//   2. the boat really turned: its mean heading over the 75 s before and
//      the time after differ by 50 deg or more;
//   3. the boat was sailing: mean SOG over 1 kn before and after.
// Wind ahead of the beam before the turn = tack, abaft = gybe. Apparent wind
// stands in when there is no true wind. Pure, no I/O.

export interface ManoeuvreSample {
  ts: number;
  twa?: number | null;      // rad, signed
  awa?: number | null;      // rad, signed
  heading?: number | null;  // rad
  cog?: number | null;      // rad
  sog?: number | null;      // m/s
}

export interface Manoeuvre { ts: number; kind: "tack" | "gybe"; turnDeg: number }

export const MAN_SIDE_MIN_DEG = 20;
export const MAN_SIDE_MAX_DEG = 160;
export const MAN_HOLD_MS = 45_000;
export const MAN_TURN_MIN_DEG = 50;
export const MAN_SOG_MIN_MS = 1 / 1.943844;   // 1 kn
const BEFORE_FROM_MS = 90_000, BEFORE_TO_MS = 15_000;
const KEEP_MS = 240_000;

const R2D = 180 / Math.PI;
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

interface Pt { ts: number; hdg: number | null; absWa: number | null; sog: number | null }

function circMeanDeg(vals: number[]): number | null {
  if (!vals.length) return null;
  let sx = 0, sy = 0;
  for (const v of vals) { sx += Math.cos(v / R2D); sy += Math.sin(v / R2D); }
  if (Math.hypot(sx, sy) < 1e-9) return null;
  return Math.atan2(sy, sx) * R2D;
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export class ManoeuvreDetector {
  private stable = 0;            // confirmed side: -1 port, +1 starboard, 0 unknown
  private cand = 0;              // side being watched
  private candSince = 0;
  private ring: Pt[] = [];
  readonly events: Manoeuvre[] = [];

  /** Feed one sample (any rate, oldest first). Returns the manoeuvre it
   *  confirmed, if any (confirmed MAN_HOLD_MS after it started). */
  feed(s: ManoeuvreSample): Manoeuvre | null {
    const wa = fin(s.twa) ? s.twa : fin(s.awa) ? s.awa : null;
    const hdgRad = fin(s.heading) ? s.heading : fin(s.cog) ? s.cog : null;
    const absWa = wa != null ? Math.abs(wa * R2D) : null;
    this.ring.push({ ts: s.ts, hdg: hdgRad != null ? hdgRad * R2D : null, absWa, sog: fin(s.sog) ? s.sog : null });
    while (this.ring.length && s.ts - this.ring[0].ts > KEEP_MS) this.ring.shift();

    const side = absWa != null && absWa >= MAN_SIDE_MIN_DEG && absWa <= MAN_SIDE_MAX_DEG ? (wa! > 0 ? 1 : -1) : 0;
    if (side === 0) return null;
    if (side !== this.cand) { this.cand = side; this.candSince = s.ts; }
    if (s.ts - this.candSince < MAN_HOLD_MS || this.cand === this.stable) return null;
    const was = this.stable;
    this.stable = this.cand;
    if (was === 0) return null;   // first side of the trip
    const t0 = this.candSince;
    const before = this.ring.filter((p) => p.ts >= t0 - BEFORE_FROM_MS && p.ts <= t0 - BEFORE_TO_MS);
    const after = this.ring.filter((p) => p.ts >= t0 + BEFORE_TO_MS);
    const hb = circMeanDeg(before.map((p) => p.hdg).filter(fin));
    const ha = circMeanDeg(after.map((p) => p.hdg).filter(fin));
    if (hb == null || ha == null) return null;
    let turn = Math.abs(ha - hb) % 360;
    if (turn > 180) turn = 360 - turn;
    if (turn < MAN_TURN_MIN_DEG) return null;
    const sb = mean(before.map((p) => p.sog).filter(fin));
    const sa = mean(after.map((p) => p.sog).filter(fin));
    if (sb == null || sa == null || sb < MAN_SOG_MIN_MS || sa < MAN_SOG_MIN_MS) return null;
    const wb = mean(before.map((p) => p.absWa).filter(fin));
    const ev: Manoeuvre = { ts: t0, kind: wb != null && wb > 90 ? "gybe" : "tack", turnDeg: Math.round(turn) };
    this.events.push(ev);
    return ev;
  }

  counts(): { tacks: number; gybes: number } {
    let tacks = 0, gybes = 0;
    for (const e of this.events) { if (e.kind === "tack") tacks += 1; else gybes += 1; }
    return { tacks, gybes };
  }
}

/** Whole trip at once (old trips, the map). */
export function detectManoeuvres(samples: ManoeuvreSample[]): Manoeuvre[] {
  const d = new ManoeuvreDetector();
  for (const s of samples) d.feed(s);
  return d.events;
}
