// Rev630 (sea trial 2026-11-05): "a visor manoeuvre is running" flag
// (Aproado / Empopado). While it is set, AUTOWIND does not switch and the
// heading-deviation / cruise-drift / unable-to-steer alarms stay quiet.
//
// One entry per manoeuvre id, each with its own expiry: one visor ending
// its manoeuvre does not end another visor's. A visor older than Rev630
// sends no id and shares the "legacy" entry.
//
// Rev633 (GPT re-audit 2026-11-06 R08): an id that ended is remembered for
// one TTL, so a renewal of it that was still in flight cannot open it
// again (and silence the alarms for another 3 minutes). Visor ids are
// unique per manoeuvre; "legacy" is reused and keeps the old behaviour.

export const MANEUVER_GATE_TTL_MS = 180_000;
export const MANEUVER_GATE_MAX = 16;
const LEGACY = "legacy";

export class ManeuverGate {
  private readonly until = new Map<string, number>();
  private readonly ended = new Map<string, number>();   // id -> forget after

  constructor(private readonly ttlMs = MANEUVER_GATE_TTL_MS) {}

  /** Applies one visor message: {active: true|false, id?}. */
  update(active: unknown, id: unknown, nowMs: number): void {
    const key = typeof id === "string" && id ? id.slice(0, 64) : LEGACY;
    this.sweep(nowMs);
    if (active === true) {
      if (this.ended.has(key)) return;
      this.until.delete(key);
      this.until.set(key, nowMs + this.ttlMs);
      while (this.until.size > MANEUVER_GATE_MAX) this.until.delete(this.until.keys().next().value as string);
    } else if (active === false) {
      this.until.delete(key);
      if (key !== LEGACY) {
        this.ended.set(key, nowMs + this.ttlMs);
        while (this.ended.size > MANEUVER_GATE_MAX * 4) this.ended.delete(this.ended.keys().next().value as string);
      }
    }
  }

  active(nowMs: number): boolean {
    this.sweep(nowMs);
    return this.until.size > 0;
  }

  private sweep(nowMs: number): void {
    for (const [key, until] of this.until) if (until <= nowMs) this.until.delete(key);
    for (const [key, until] of this.ended) if (until <= nowMs) this.ended.delete(key);
  }
}
