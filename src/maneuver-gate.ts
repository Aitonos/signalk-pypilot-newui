// Rev630 (sea trial 2026-11-05): "a visor manoeuvre is running" flag
// (Aproado / Empopado). While it is set, AUTOWIND does not switch and the
// heading-deviation / cruise-drift / unable-to-steer alarms stay quiet.
//
// One entry per manoeuvre id, each with its own expiry: one visor ending
// its manoeuvre does not end another visor's, and a renewal of a
// manoeuvre that was cleared only revives that same id until it expires.
// A visor older than Rev630 sends no id and shares the "legacy" entry.

export const MANEUVER_GATE_TTL_MS = 180_000;
export const MANEUVER_GATE_MAX = 16;

export class ManeuverGate {
  private readonly until = new Map<string, number>();

  constructor(private readonly ttlMs = MANEUVER_GATE_TTL_MS) {}

  /** Applies one visor message: {active: true|false, id?}. */
  update(active: unknown, id: unknown, nowMs: number): void {
    const key = typeof id === "string" && id ? id.slice(0, 64) : "legacy";
    if (active === true) {
      this.until.delete(key);
      this.until.set(key, nowMs + this.ttlMs);
      while (this.until.size > MANEUVER_GATE_MAX) this.until.delete(this.until.keys().next().value as string);
    } else if (active === false) {
      this.until.delete(key);
    }
  }

  active(nowMs: number): boolean {
    for (const [key, until] of this.until) if (until <= nowMs) this.until.delete(key);
    return this.until.size > 0;
  }
}
