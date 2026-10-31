// Rev572 (auto-Doctor phase 5): shadow mode. Looks at every closed
// navigation-database window and decides what an automatic tuner would
// try next, and whether an A/B/A trial would even be possible right now
// (three comparable windows in a row). It never writes to pypilot: the
// decision is stored with the window and in the session, so the skipper
// can judge it after the outing.
//
// Rules and thresholds: docs/_design_auto_doctor_2026-10-30.md,
// "Modo sombra v1". All explicit; no hidden factors.

import type { NavDbRow } from "./nav-db";

export type ShadowGain = "P" | "D" | "PR";

export interface ShadowAction {
  gain: ShadowGain;
  /** +1 raise, -1 lower. */
  dir: 1 | -1;
  pct: number;
  from: number;
  to: number;
  /** Short machine reason: oscillation, overshoot, nervous, bias, slow. */
  why: string;
  /** Human detail with the numbers that triggered it. */
  detail: string;
}

export interface ShadowDecision {
  /** Null on the first window or when either window is not valid. */
  comparablePrev: boolean | null;
  notComparableWhy: string[];
  /** The last three windows are mutually comparable. */
  abaFeasible: boolean;
  action: ShadowAction | null;
  /** Why no action although a symptom was seen (servo limit, range...). */
  blocked: string | null;
}

export interface ShadowTunerOptions {
  /** pypilot range of a gain for a pilot, if known. */
  range?: (pilot: string, gain: string) => { min: number; max: number } | null;
  stepPct?: number;
  maxDevPct?: number;
}

const SEA_REL = 0.25;
/** Rev574 (audit #C): windows further apart than this are not "in a row". */
const CONTIGUOUS_MS = 5000;
const contiguous = (a: NavDbRow, b: NavDbRow) => b.t0 - a.t1 <= CONTIGUOUS_MS && b.t0 >= a.t0;
const TWS_KN = 2.5;

function seaClose(a: number | null, b: number | null, floor: number): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) <= Math.max(floor, SEA_REL * Math.max(Math.abs(a), Math.abs(b)));
}

/** Why two windows cannot be compared ([] = comparable). */
export function incomparable(a: NavDbRow, b: NavDbRow): string[] {
  const why: string[] = [];
  if (!a.valid || !b.valid) why.push("invalid");
  if (a.ctx.mode !== b.ctx.mode) why.push("mode");
  if (a.ctx.pilot !== b.ctx.pilot || a.ctx.profile !== b.ctx.profile) why.push("profile");
  if (JSON.stringify(a.ctx.gains) !== JSON.stringify(b.ctx.gains)) why.push("gains");
  if (a.ctx.tack !== b.ctx.tack) why.push("tack");
  if (a.ctx.twsKn != null && b.ctx.twsKn != null && Math.abs(a.ctx.twsKn - b.ctx.twsKn) > TWS_KN) why.push("wind");
  if (!seaClose(a.ctx.rollSdDeg, b.ctx.rollSdDeg, 0.5)
    || !seaClose(a.ctx.pitchSdDeg, b.ctx.pitchSdDeg, 0.5)
    || !seaClose(a.ctx.yawRateRmsDps, b.ctx.yawRateRmsDps, 0.5)) why.push("sea");
  return why;
}

export class ShadowTuner {
  private recent: NavDbRow[] = [];
  /** First gains seen per pilot/profile in this run: the ±40 % anchor. */
  private readonly anchor = new Map<string, Record<string, number>>();
  private readonly stepPct: number;
  private readonly maxDevPct: number;

  constructor(private readonly opts: ShadowTunerOptions = {}) {
    this.stepPct = opts.stepPct ?? 10;
    this.maxDevPct = opts.maxDevPct ?? 40;
  }

  decide(row: NavDbRow): ShadowDecision {
    const prev = this.recent[this.recent.length - 1] ?? null;
    let comparablePrev: boolean | null = null;
    let notComparableWhy: string[] = [];
    if (prev && prev.valid && row.valid && contiguous(prev, row)) {
      notComparableWhy = incomparable(prev, row);
      comparablePrev = notComparableWhy.length === 0;
    }
    this.recent.push(row);
    if (this.recent.length > 3) this.recent.shift();
    const r = this.recent;
    const abaFeasible = r.length === 3
      && contiguous(r[0], r[1]) && contiguous(r[1], r[2])
      && incomparable(r[0], r[1]).length === 0
      && incomparable(r[1], r[2]).length === 0
      && incomparable(r[0], r[2]).length === 0;

    const key = `${row.ctx.pilot}/${row.ctx.profile}`;
    if (!this.anchor.has(key)) this.anchor.set(key, { ...row.ctx.gains });
    const { action, blocked } = row.valid ? this.pick(row, this.anchor.get(key)!) : { action: null, blocked: null };
    return { comparablePrev, notComparableWhy, abaFeasible, action, blocked };
  }

  private pick(row: NavDbRow, anchor: Record<string, number>): { action: ShadowAction | null; blocked: string | null } {
    const res = row.res;
    const rms = res.errRmsDeg ?? 0;
    const duty = res.servoDutyPct;
    if (duty == null || res.servoCoveragePct < 50) return { action: null, blocked: "servo activity unknown" };
    if (duty > 75 && rms > 5) return { action: null, blocked: `servo at its limit (${duty} %, error ${rms}°)` };

    const periodS = res.crossings > 0 ? (2 * row.n) / res.crossings : Infinity;
    const candidates: Array<{ gain: ShadowGain; dir: 1 | -1; why: string; detail: string } | null> = [
      res.crossings >= 6 && periodS < 20 && rms > 3
        ? { gain: "D", dir: 1, why: "oscillation", detail: `oscillating every ${periodS.toFixed(0)} s, error ${rms}°` } : null,
      row.ep.complete >= 2 && (row.ep.overshootMean ?? 0) > 0.2
        ? { gain: "D", dir: 1, why: "overshoot", detail: `overshoots ${Math.round((row.ep.overshootMean ?? 0) * 100)} % on ${row.ep.complete} corrections` } : null,
      rms < 1.5 && duty > 35
        ? { gain: "D", dir: -1, why: "nervous", detail: `error only ${rms}° but servo working ${duty} %` } : null,
      res.errMeanDeg != null && Math.abs(res.errMeanDeg) > 3
        ? { gain: "PR", dir: 1, why: "bias", detail: `sustained offset ${res.errMeanDeg}°` } : null,
      row.ep.riseMeanSec != null && row.ep.riseMeanSec > 8 && duty < 55
        ? { gain: "P", dir: 1, why: "slow", detail: `takes ${row.ep.riseMeanSec} s to reach a new heading, servo ${duty} %` } : null,
    ];
    const c = candidates.find((x) => x != null);
    if (!c) return { action: null, blocked: null };

    const from = row.ctx.gains[c.gain];
    if (typeof from !== "number") return { action: null, blocked: `${c.gain} not reported` };
    const to = round5(from * (1 + c.dir * this.stepPct / 100));
    const base = anchor[c.gain] ?? from;
    const rng = row.ctx.pilot ? this.opts.range?.(row.ctx.pilot, c.gain) : null;
    if (Math.abs(to - base) > base * this.maxDevPct / 100 + 1e-12) {
      return { action: null, blocked: `${c.gain} ${c.why}: would go beyond ±${this.maxDevPct} % of ${base}` };
    }
    if (rng && (to > rng.max || to < rng.min)) {
      return { action: null, blocked: `${c.gain} ${c.why}: outside pypilot range ${rng.min}-${rng.max}` };
    }
    return { action: { ...c, pct: c.dir * this.stepPct, from, to }, blocked: null };
  }
}

function round5(v: number): number { return Math.round(v * 1e5) / 1e5; }
