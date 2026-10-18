// Rev508 (Carlos sea trial 2026-10-18, 18:00-18:21): "no podemos dejar
// el barco sin gobierno". Watches for a pilot that stopped steering and
// decides when a recovery cycle (AP off -> on) is due.
//
// Why a cycle helps (pypilot servo.py): with no rudder sensor, an
// overcurrent sets PORT/STARBOARD_OVERCURRENT_FAULT in the direction of
// travel and pypilot refuses to drive that way again (a false end stop).
// That flag is cleared when ap.enabled changes. See
// docs/_audit_sea_trial_2026-10-18.md section 9.
//
// Pure state machine: fed once per second, no I/O, no timers.

export const STUCK_ERR_DEG = 25;
export const STUCK_SUSTAIN_MS = 4000;
export const CONVERGE_WINDOW_MS = 4000;
export const CONVERGE_MIN_DROP_DEG = 3;
export const ENGAGE_GRACE_MS = 5000;
export const IDLE_CURRENT_A = 0.3;
export const MAX_CYCLES = 3;
export const CYCLE_WINDOW_MS = 60_000;
export const CYCLE_MIN_GAP_MS = 10_000;
export const DROPPED_ALARM_MS = 60_000;
export const DROPPED_MIN_SOG_MS = 1 * 0.514444; // 1 kn

export interface SteerWatchInput {
  nowMs: number;
  engaged: boolean;
  /** Mode-aware heading error in degrees (compass / AWA / TWA), or null. */
  errDeg: number | null;
  servoCurrentA: number | null;
  /** pypilot servo.flags string, e.g. "SYNC PORT_OVERCURRENT_FAULT". */
  servoFlags: string | null;
  /** pypilot's own tack (ap.tack.state != none): no cycles then. */
  nativeTack: boolean;
  recoveryEnabled: boolean;
}

export type SteerAction = "cycle" | null;

export interface SteerWatchSnapshot {
  stuck: boolean;
  stuckSinceMs: number | null;
  gaveUp: boolean;
  cyclesInWindow: number;
  lastCycleMs: number | null;
  droppedActive: boolean;
  droppedAtMs: number | null;
  dirFault: boolean;
}

export function hasDirectionalFault(flags: string | null | undefined): boolean {
  if (typeof flags !== "string") return false;
  return /\b(PORT_OVERCURRENT_FAULT|STARBOARD_OVERCURRENT_FAULT)\b/.test(flags);
}

export class SteerWatch {
  private engagedSinceMs: number | null = null;
  private errHist: Array<{ ts: number; absErr: number }> = [];
  private condSinceMs: number | null = null;
  private stuck = false;
  private cycles: number[] = [];
  private gaveUp = false;
  private droppedAtMs: number | null = null;
  private dirFault = false;

  tick(i: SteerWatchInput): SteerAction {
    const now = i.nowMs;
    this.dirFault = hasDirectionalFault(i.servoFlags);
    this.cycles = this.cycles.filter((t) => now - t < CYCLE_WINDOW_MS);
    if (this.droppedAtMs != null && now - this.droppedAtMs >= DROPPED_ALARM_MS) {
      this.droppedAtMs = null;
    }

    if (!i.engaged) {
      this.engagedSinceMs = null;
      this.reset();
      return null;
    }
    if (this.engagedSinceMs == null) this.engagedSinceMs = now;
    this.droppedAtMs = null;

    if (typeof i.errDeg !== "number" || !isFinite(i.errDeg)) {
      this.errHist = [];
      this.condSinceMs = null;
      this.stuck = false;
      return null;
    }
    const absErr = Math.abs(i.errDeg);
    this.errHist.push({ ts: now, absErr });
    while (this.errHist.length > 0 && now - this.errHist[0].ts > CONVERGE_WINDOW_MS + 2000) {
      this.errHist.shift();
    }

    const graceOk = now - this.engagedSinceMs >= ENGAGE_GRACE_MS;
    const bigErr = absErr > STUCK_ERR_DEG;
    const notPushing = this.dirFault
      || (typeof i.servoCurrentA === "number" && i.servoCurrentA < IDLE_CURRENT_A);
    const notConverging = this.notConverging(now, absErr);
    const cond = graceOk && bigErr && notPushing && notConverging;

    if (!cond) {
      this.condSinceMs = null;
      this.stuck = false;
      // Recovered for a whole window: forget the give-up latch.
      if (this.gaveUp && this.cycles.length === 0) this.gaveUp = false;
      return null;
    }
    if (this.condSinceMs == null) this.condSinceMs = now;
    if (now - this.condSinceMs < STUCK_SUSTAIN_MS) return null;
    this.stuck = true;

    if (!i.recoveryEnabled || i.nativeTack) return null;
    const last = this.cycles.length ? this.cycles[this.cycles.length - 1] : null;
    if (last != null && now - last < CYCLE_MIN_GAP_MS) return null;
    if (this.cycles.length >= MAX_CYCLES) {
      this.gaveUp = true;
      return null;
    }
    this.cycles.push(now);
    // The cycle re-engages: restart the grace and the sustain clocks.
    this.engagedSinceMs = now;
    this.condSinceMs = null;
    this.errHist = [];
    return "cycle";
  }

  /** An ap.enabled=false that no app order explains (remote, TinyPilot keys). */
  noteExternalDisengage(nowMs: number, sogMs: number | null): void {
    if (typeof sogMs === "number" && sogMs < DROPPED_MIN_SOG_MS) return;
    this.droppedAtMs = nowMs;
  }

  /** Any app order (engage, disengage, standby) clears the dropped alarm. */
  noteAppOrder(): void {
    this.droppedAtMs = null;
  }

  snapshot(): SteerWatchSnapshot {
    return {
      stuck: this.stuck,
      stuckSinceMs: this.stuck ? this.condSinceMs : null,
      gaveUp: this.gaveUp,
      cyclesInWindow: this.cycles.length,
      lastCycleMs: this.cycles.length ? this.cycles[this.cycles.length - 1] : null,
      droppedActive: this.droppedAtMs != null,
      droppedAtMs: this.droppedAtMs,
      dirFault: this.dirFault,
    };
  }

  private notConverging(now: number, absErr: number): boolean {
    // Oldest sample at least CONVERGE_WINDOW_MS old; without a full
    // window we cannot tell, so we do not call it stuck yet.
    let ref: { ts: number; absErr: number } | null = null;
    for (const h of this.errHist) {
      if (now - h.ts >= CONVERGE_WINDOW_MS) ref = h;
      else break;
    }
    if (!ref) return false;
    return absErr > ref.absErr - CONVERGE_MIN_DROP_DEG;
  }

  private reset(): void {
    this.errHist = [];
    this.condSinceMs = null;
    this.stuck = false;
    this.gaveUp = false;
  }
}
