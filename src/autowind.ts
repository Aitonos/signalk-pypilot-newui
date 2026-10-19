// Rev518 (Carlos 2026-10-19): pseudo-mode AUTOWIND. Apparent wind
// (pypilot "wind") when |TWA| < threshold, true wind ("true wind") when
// above: downwind the apparent angle swings with boat speed and the
// pilot chases it (2026-10-19 18:48: +-40 deg in apparent at TWA ~140,
// steady in true wind). Each side has its own pypilot profile, so the
// true-wind side can be the more reactive one.
//
// Pure decision logic: fed once per second, no I/O.

export type WindSubMode = "wind" | "true wind";

export const AUTOWIND_DEFAULT_THRESHOLD_DEG = 120;
export const AUTOWIND_HYSTERESIS_DEG = 5;      // +-5 around the threshold
export const AUTOWIND_SUSTAIN_MS = 10_000;     // condition held this long
export const AUTOWIND_MIN_GAP_MS = 30_000;     // between two switches

export interface AutowindInput {
  nowMs: number;
  /** True wind angle in degrees (signed or not), null if unknown. */
  twaDeg: number | null;
  /** pypilot's current mode. */
  mode: string | null;
  engaged: boolean;
  /** Virtual tack, pypilot tack, aproado / empopado: never switch then. */
  blocked: boolean;
  thresholdDeg?: number;
}

/** Side of the threshold the wind is on, with hysteresis; null in the band. */
export function desiredSubMode(twaDeg: number, thresholdDeg = AUTOWIND_DEFAULT_THRESHOLD_DEG): WindSubMode | null {
  const a = Math.abs(twaDeg);
  if (a >= thresholdDeg + AUTOWIND_HYSTERESIS_DEG) return "true wind";
  if (a <= thresholdDeg - AUTOWIND_HYSTERESIS_DEG) return "wind";
  return null;
}

export class AutowindDecider {
  private pending: WindSubMode | null = null;
  private pendingSince: number | null = null;
  private lastSwitchMs: number | null = null;

  /** Returns the mode to switch to now, or null. */
  tick(i: AutowindInput): WindSubMode | null {
    const cur = String(i.mode || "").toLowerCase();
    const curSub: WindSubMode | null = cur === "true wind" ? "true wind" : cur === "wind" ? "wind" : null;
    if (!i.engaged || i.blocked || typeof i.twaDeg !== "number" || !isFinite(i.twaDeg)) {
      this.pending = null; this.pendingSince = null;
      return null;
    }
    const want = desiredSubMode(i.twaDeg, i.thresholdDeg);
    if (want == null || want === curSub) {
      this.pending = null; this.pendingSince = null;
      return null;
    }
    if (this.pending !== want) {
      this.pending = want; this.pendingSince = i.nowMs;
      return null;
    }
    if (this.pendingSince != null && i.nowMs - this.pendingSince < AUTOWIND_SUSTAIN_MS) return null;
    if (this.lastSwitchMs != null && i.nowMs - this.lastSwitchMs < AUTOWIND_MIN_GAP_MS) return null;
    this.pending = null; this.pendingSince = null;
    this.lastSwitchMs = i.nowMs;
    return want;
  }

  /** Called when Autowind is switched on: no sustain, no gap. */
  initial(twaDeg: number | null, thresholdDeg?: number): WindSubMode {
    this.pending = null; this.pendingSince = null;
    if (typeof twaDeg !== "number" || !isFinite(twaDeg)) return "wind";
    return Math.abs(twaDeg) >= (thresholdDeg ?? AUTOWIND_DEFAULT_THRESHOLD_DEG) ? "true wind" : "wind";
  }

  noteSwitch(nowMs: number): void { this.lastSwitchMs = nowMs; }
}
