// Rev568 (Carlos 2026-10-30, "cuando vemos sesiones guardadas, ¿podemos
// ver un resumen y si se aplicaron cambios y por qué?"): attribution of
// pypilot gain changes, the gain-side twin of ProfileChangeLog.
//
// Every place in the plugin that writes a gain calls markPlannedWrite()
// first. When pypilot reports the gain back, observe() pairs the change
// with that planned write (same path, same value, recent) and credits its
// source; a change nobody claimed is "external" (another client, pypilot
// itself). Gains that move because the profile was just switched are not
// separate changes: the profile change already explains them.
//
// Pure data, no I/O. The plugin forwards changes to the session recorder.

export type GainChangeSource =
  | "user"
  | "doctor"
  | "gust-boost"
  | "gust-boost-restore"
  | "external";

export interface GainChange {
  ts: number;
  /** pypilot path, e.g. "ap.pilot.basic.D". */
  key: string;
  from: number;
  to: number;
  source: GainChangeSource;
  reason?: string;
}

interface PlannedGainWrite {
  path: string;
  value: number;
  source: GainChangeSource;
  reason?: string;
  ts: number;
}

/** pypilot gain paths whose changes are worth logging. */
export const GAIN_PATH_RE = /^ap\.pilot\.[^.]+\.(P|I|D|DD|PR|FF)$/;

export class GainChangeLog {
  private planned: PlannedGainWrite[] = [];
  private readonly last = new Map<string, number>();
  private profileChangedTs = -Infinity;

  constructor(
    /** How long a planned write stays credit-eligible (ms). */
    private readonly correlationWindowMs = 5000,
    /** Gain moves within this long after a profile switch belong to it (ms). */
    private readonly profileSettleMs = 3000,
  ) {}

  markPlannedWrite(path: string, value: number, source: GainChangeSource, reason?: string, now: number = Date.now()): void {
    this.gc(now);
    this.planned.push({ path, value, source, reason, ts: now });
    if (this.planned.length > 50) this.planned.splice(0, this.planned.length - 50);
  }

  /** Call when pypilot reports a new active profile. Unclaimed gain moves
   *  just before it (pypilot may send the new gains first) are dropped. */
  noteProfileChange(now: number = Date.now()): void {
    this.profileChangedTs = now;
    this.pending = this.pending.filter((c) => c.ts < now - this.profileSettleMs);
  }

  /** Unclaimed changes wait profileSettleMs: if a profile switch shows up
   *  meanwhile they were part of it. */
  private pending: GainChange[] = [];

  /** Feed every value pypilot reports. Returns a change claimed by a
   *  planned write at once; unclaimed ones come out of drain() later. */
  observe(path: string, value: unknown, now: number = Date.now()): GainChange | null {
    if (typeof value !== "number" || !isFinite(value) || !GAIN_PATH_RE.test(path)) return null;
    const prev = this.last.get(path);
    this.last.set(path, value);
    if (prev === undefined || Math.abs(prev - value) <= 1e-9 + 1e-6 * Math.abs(value)) return null;
    this.gc(now);
    // A planned write is credited even right after a profile switch: the
    // Doctor forks the profile and writes the gain within a second.
    for (let i = this.planned.length - 1; i >= 0; i -= 1) {
      const p = this.planned[i];
      if (p.path === path && closeEnough(p.value, value)) {
        this.planned.splice(i, 1);
        return { ts: now, key: path, from: prev, to: value, source: p.source, reason: p.reason };
      }
    }
    if (now - this.profileChangedTs < this.profileSettleMs) return null;
    this.pending.push({ ts: now, key: path, from: prev, to: value, source: "external" });
    if (this.pending.length > 50) this.pending.splice(0, this.pending.length - 50);
    return null;
  }

  /** Unclaimed changes old enough not to belong to a profile switch. */
  drain(now: number = Date.now()): GainChange[] {
    if (this.pending.length === 0) return [];
    const ready = this.pending.filter((c) => now - c.ts >= this.profileSettleMs);
    if (ready.length > 0) this.pending = this.pending.filter((c) => now - c.ts < this.profileSettleMs);
    return ready;
  }

  private gc(now: number): void {
    this.planned = this.planned.filter((p) => now - p.ts <= this.correlationWindowMs);
  }
}

/** pypilot may round what it stores: a write is matched within 1 %. */
function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.01);
}
