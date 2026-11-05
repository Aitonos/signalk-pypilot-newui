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
// Rev630 (GPT audit 2026-11-05 F07): after a switch that failed, wait this
// long before asking again (the 30 s gap counts only real switches).
export const AUTOWIND_RETRY_MS = 10_000;
// Rev632 (AUTOWIND audit 2026-11-05, GPT F06): wind data older than this
// counts as missing (on Tunatunes derived-data and the vane update every
// 1-4 s). And a gap longer than AUTOWIND_MAX_TICK_GAP_MS between two
// inputs restarts the 10 s count: two readings 60 s apart are not "10 s
// sustained".
export const AUTOWIND_MAX_DATA_AGE_MS = 10_000;
export const AUTOWIND_MAX_TICK_GAP_MS = 3_000;

/** The number in a Signal K node ({value, timestamp}) if it is younger
 *  than maxAgeMs, else null. No timestamp = not fresh; a timestamp in
 *  the future by more than maxAgeMs (clock step) = not fresh either. */
export function freshNumber(node: unknown, nowMs: number, maxAgeMs = AUTOWIND_MAX_DATA_AGE_MS): number | null {
  if (!node || typeof node !== "object") return null;
  const v = (node as any).value;
  const ts = Date.parse(String((node as any).timestamp));
  if (typeof v !== "number" || !isFinite(v) || !isFinite(ts)) return null;
  return Math.abs(nowMs - ts) <= maxAgeMs ? v : null;
}
// Rev521 (Carlos 2026-10-20, in port with the AP off: "no cambió de
// modo"): it now also switches with the AP disengaged, so engaging lands
// in the right mode, but only with a meaningful wind - below 3 kn TWS the
// true wind angle is noise (0.3 kn at the berth flips it side to side).
export const AUTOWIND_MIN_TWS_KN = 3;

export interface AutowindInput {
  nowMs: number;
  /** True wind angle in degrees (signed or not), null if unknown. */
  twaDeg: number | null;
  /** pypilot's current mode. */
  mode: string | null;
  /** Kept for callers; no longer gates the decision (Rev521). */
  engaged: boolean;
  /** True wind speed in knots; null = unknown (no switch). */
  twsKn?: number | null;
  /** Virtual tack, pypilot tack, aproado / empopado: never switch then. */
  blocked: boolean;
  thresholdDeg?: number;
}

/** Side of the threshold the wind is on, with hysteresis; null in the band. */
export function desiredSubMode(twaDeg: number, thresholdDeg = AUTOWIND_DEFAULT_THRESHOLD_DEG): WindSubMode | null {
  // Rev532 (Gemini audit #11): a 0..360 source (330 = 30 to port) must
  // not read as downwind.
  const a = Math.abs((((twaDeg % 360) + 540) % 360) - 180);
  if (a >= thresholdDeg + AUTOWIND_HYSTERESIS_DEG) return "true wind";
  if (a <= thresholdDeg - AUTOWIND_HYSTERESIS_DEG) return "wind";
  return null;
}

export class AutowindDecider {
  private pending: WindSubMode | null = null;
  private pendingSince: number | null = null;
  private lastSwitchMs: number | null = null;
  private lastFailMs: number | null = null;
  private lastTickMs: number | null = null;

  /** Returns the mode to switch to now, or null. The caller reports the
   *  outcome with noteSwitch() or noteFailure(). */
  tick(i: AutowindInput): WindSubMode | null {
    // Rev632: a hole in the inputs (plugin busy, clock step) restarts the count.
    const gap = this.lastTickMs == null ? 0 : i.nowMs - this.lastTickMs;
    this.lastTickMs = i.nowMs;
    if (gap < 0 || gap > AUTOWIND_MAX_TICK_GAP_MS) { this.pending = null; this.pendingSince = null; }
    const cur = String(i.mode || "").toLowerCase();
    const curSub: WindSubMode | null = cur === "true wind" ? "true wind" : cur === "wind" ? "wind" : null;
    const windOk = typeof i.twsKn === "number" && isFinite(i.twsKn) && i.twsKn >= AUTOWIND_MIN_TWS_KN;
    if (i.blocked || !windOk || typeof i.twaDeg !== "number" || !isFinite(i.twaDeg)) {
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
    if (this.lastFailMs != null && i.nowMs - this.lastFailMs < AUTOWIND_RETRY_MS) return null;
    this.pending = null; this.pendingSince = null;
    return want;
  }

  /** Called when Autowind is switched on: no sustain, no gap. */
  initial(twaDeg: number | null, thresholdDeg?: number): WindSubMode {
    this.pending = null; this.pendingSince = null;
    if (typeof twaDeg !== "number" || !isFinite(twaDeg)) return "wind";
    const a = Math.abs((((twaDeg % 360) + 540) % 360) - 180);
    return a >= (thresholdDeg ?? AUTOWIND_DEFAULT_THRESHOLD_DEG) ? "true wind" : "wind";
  }

  noteSwitch(nowMs: number): void { this.lastSwitchMs = nowMs; this.lastFailMs = null; }

  noteFailure(nowMs: number): void { this.lastFailMs = nowMs; }
}
