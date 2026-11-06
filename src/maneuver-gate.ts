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
// Rev638 (Carlos QA 2026-11-06 17:36): a visor that is reloaded or closed
// mid-manoeuvre never sends "off"; its entry lingered 3 min (button said
// APROADO with pypilot in compass, AUTOWIND blocked, alarms quiet). An
// Aproado / Empopado entry ends when pypilot has been out of its mode or
// off for MISMATCH_MS, once START_GRACE_MS have passed since it began
// (the visor changes mode and engages in the first seconds).
export const MANEUVER_GATE_START_GRACE_MS = 10_000;
export const MANEUVER_GATE_MISMATCH_MS = 3_000;
const LEGACY = "legacy";

export class ManeuverGate {
  private readonly until = new Map<string, number>();
  private readonly ended = new Map<string, number>();   // id -> forget after
  private readonly startedAt = new Map<string, number>();
  private readonly mismatchSince = new Map<string, number>();

  constructor(private readonly ttlMs = MANEUVER_GATE_TTL_MS) {}

  /** Applies one visor message: {active: true|false, id?}. Returns
   *  "ended" when a renewal names a manoeuvre that was ended (by its
   *  visor, a hand-over from another screen or reconcile): that visor must
   *  end it too. */
  update(active: unknown, id: unknown, nowMs: number): "ok" | "ended" {
    this.sweep(nowMs);
    const key = typeof id === "string" && id ? id.slice(0, 64) : LEGACY;
    if (active === true) {
      if (this.ended.has(key)) {
        // Rev641 (GPT re-audit of Rev640 #3): while its visor keeps renewing
        // an ended id, it stays ended - the TTL no longer lets it back in.
        this.ended.set(key, nowMs + this.ttlMs);
        return "ended";
      }
      if (!this.until.has(key)) this.startedAt.set(key, nowMs);
      this.until.delete(key);
      this.until.set(key, nowMs + this.ttlMs);
      // Rev639 (C9): evicting an entry clears its side maps too.
      while (this.until.size > MANEUVER_GATE_MAX) this.forget(this.until.keys().next().value as string);
    } else if (active === false) {
      this.end(key, nowMs);
    }
    return "ok";
  }

  /** Rev641 (GPT re-audit of Rev640 #3/#4): a hand-over ends exactly the
   *  manoeuvres the other screen saw, by id - a late hand-over never ends
   *  one that started after it. */
  endIds(ids: unknown, nowMs: number): void {
    this.sweep(nowMs);
    if (!Array.isArray(ids)) return;
    for (const id of ids.slice(0, MANEUVER_GATE_MAX)) {
      if (typeof id === "string" && id && id !== LEGACY) this.end(id.slice(0, 64), nowMs);
    }
  }

  /** The running manoeuvre ids (for the visors' hand-over). */
  ids(nowMs: number): string[] {
    this.sweep(nowMs);
    return [...this.until.keys()].filter((k) => k !== LEGACY);
  }

  /** Rev638: ends Aproado / Empopado entries pypilot is no longer doing.
   *  Returns the ids it ended. */
  reconcile(nowMs: number, mode: string, engaged: boolean): string[] {
    this.sweep(nowMs);
    const out: string[] = [];
    for (const key of [...this.until.keys()]) {
      const own = key.startsWith("emp-") ? "true wind" : key.startsWith("apr-") ? "wind" : null;
      if (!own) continue;
      if (nowMs - (this.startedAt.get(key) ?? nowMs) < MANEUVER_GATE_START_GRACE_MS) continue;
      if (engaged && String(mode).toLowerCase() === own) { this.mismatchSince.delete(key); continue; }
      const since = this.mismatchSince.get(key);
      if (since == null) { this.mismatchSince.set(key, nowMs); continue; }
      if (nowMs - since >= MANEUVER_GATE_MISMATCH_MS) { this.end(key, nowMs); out.push(key); }
    }
    return out;
  }

  private forget(key: string): void {
    this.until.delete(key);
    this.startedAt.delete(key);
    this.mismatchSince.delete(key);
  }

  private end(key: string, nowMs: number): void {
    this.forget(key);
    if (key !== LEGACY) {
      this.ended.set(key, nowMs + this.ttlMs);
      while (this.ended.size > MANEUVER_GATE_MAX * 4) this.ended.delete(this.ended.keys().next().value as string);
    }
  }

  /** Rev634 (Carlos QA 2026-11-06: the other tablet said REAL during an
   *  Empopado): which manoeuvre runs, from the visor's id prefix. */
  kind(nowMs: number): "aproado" | "empopado" | "manoeuvre" | null {
    if (!this.active(nowMs)) return null;
    const ids = [...this.until.keys()];
    if (ids.some((k) => k.startsWith("emp-"))) return "empopado";
    if (ids.some((k) => k.startsWith("apr-"))) return "aproado";
    return "manoeuvre";
  }

  active(nowMs: number): boolean {
    this.sweep(nowMs);
    return this.until.size > 0;
  }

  private sweep(nowMs: number): void {
    for (const [key, until] of this.until) {
      if (until <= nowMs) this.forget(key);
    }
    for (const [key, until] of this.ended) if (until <= nowMs) this.ended.delete(key);
  }
}
