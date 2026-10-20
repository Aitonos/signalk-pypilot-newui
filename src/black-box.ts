// Rev525 (Carlos 2026-10-20): "black box" for the autopilot. Keeps the
// last minute of 1 Hz samples in RAM; when something happens (external
// disengage, stuck pilot, overcurrent fault, a tack that takes too long,
// an alarm, or the sailor's "Mark" button) it saves one minute before and
// one minute after to its own file, so the moment can be found without
// knowing the time. Same resolution as the sessions (pypilot sends most
// servo values at 1 Hz and the Pi Zero is not pushed harder).
import * as fs from "fs";
import * as path from "path";

export const BB_PRE_MS = 60_000;
export const BB_POST_MS = 60_000;
export const BB_MAX_FILES = 50;
export const BB_SAME_KIND_COOLDOWN_MS = 60_000;

export interface BlackBoxSample {
  ts: number;
  mode: string | null;
  engaged: boolean;
  hdgDeg: number | null;
  cmdDeg: number | null;
  errDeg: number | null;
  awaDeg: number | null;
  twaDeg: number | null;
  twsKn: number | null;
  sogKn: number | null;
  heelDeg: number | null;
  servoA: number | null;
  servoV: number | null;
  flags: string | null;
  tackState: string | null;
  vtPhase: string | null;
}

export interface BlackBoxEvent { ts: number; kind: string; detail: string }

export interface BlackBoxIncident {
  id: string;
  ts: number;            // first trigger
  kind: string;          // first trigger kind
  detail: string;
  events: BlackBoxEvent[];
  samples: BlackBoxSample[];
  closedTs: number | null;
}

export interface BlackBoxSummary {
  id: string; ts: number; kind: string; detail: string; events: number; samples: number;
}

export class BlackBox {
  private ring: BlackBoxSample[] = [];
  private open: BlackBoxIncident | null = null;
  private lastKindTs = new Map<string, number>();
  private readonly dir: string | null;

  constructor(dataDir: string | null, private readonly log: (m: string) => void = () => {}) {
    this.dir = dataDir ? path.join(dataDir, "black-box") : null;
    if (this.dir) { try { fs.mkdirSync(this.dir, { recursive: true }); } catch { /* silent */ } }
  }

  /** 1 Hz feed. Closes and writes the open incident when its post window ends. */
  push(s: BlackBoxSample): void {
    this.ring.push(s);
    while (this.ring.length && s.ts - this.ring[0].ts > BB_PRE_MS) this.ring.shift();
    if (this.open) {
      this.open.samples.push(s);
      const lastEvt = this.open.events[this.open.events.length - 1].ts;
      if (s.ts - lastEvt >= BB_POST_MS) this.close(s.ts);
    }
  }

  /** Something happened. Returns the incident id, or null when rate-limited. */
  trigger(kind: string, detail: string, nowMs = Date.now()): string | null {
    const last = this.lastKindTs.get(kind);
    if (kind !== "mark" && last != null && nowMs - last < BB_SAME_KIND_COOLDOWN_MS && !this.open) return null;
    this.lastKindTs.set(kind, nowMs);
    const evt = { ts: nowMs, kind, detail: String(detail || "").slice(0, 300) };
    if (this.open) {
      // Same incident: one more event, the post window restarts from it.
      this.open.events.push(evt);
      return this.open.id;
    }
    const d = new Date(nowMs);
    const pad = (n: number) => String(n).padStart(2, "0");
    const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${kind.replace(/[^a-z0-9-]/gi, "").slice(0, 24)}`;
    this.open = { id, ts: nowMs, kind, detail: evt.detail, events: [evt], samples: this.ring.slice(), closedTs: null };
    this.log(`[black-box] incident ${id}: ${evt.detail}`);
    return id;
  }

  isRecording(): boolean { return this.open != null; }

  /** Force-write the open incident (plugin stop). */
  flush(nowMs = Date.now()): void { if (this.open) this.close(nowMs); }

  list(): BlackBoxSummary[] {
    if (!this.dir) return [];
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir).filter((f) => f.startsWith("bb-") && f.endsWith(".json")); } catch { return []; }
    const out: BlackBoxSummary[] = [];
    for (const n of names.sort().reverse()) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(this.dir, n), "utf8")) as BlackBoxIncident;
        out.push({ id: j.id, ts: j.ts, kind: j.kind, detail: j.detail, events: j.events.length, samples: j.samples.length });
      } catch { /* skip broken */ }
    }
    return out;
  }

  get(id: string): BlackBoxIncident | null {
    if (!this.dir || !/^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$/i.test(id)) return null;
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, `bb-${id}.json`), "utf8")); } catch { return null; }
  }

  remove(id: string): boolean {
    if (!this.dir || !/^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$/i.test(id)) return false;
    try { fs.unlinkSync(path.join(this.dir, `bb-${id}.json`)); return true; } catch { return false; }
  }

  private close(nowMs: number): void {
    const inc = this.open!;
    this.open = null;
    inc.closedTs = nowMs;
    if (!this.dir) return;
    try {
      fs.writeFileSync(path.join(this.dir, `bb-${inc.id}.json`), JSON.stringify(inc));
      this.prune();
    } catch (e: any) { this.log(`[black-box] write failed: ${e?.message || e}`); }
  }

  private prune(): void {
    if (!this.dir) return;
    try {
      const names = fs.readdirSync(this.dir).filter((f) => f.startsWith("bb-") && f.endsWith(".json")).sort();
      for (const n of names.slice(0, Math.max(0, names.length - BB_MAX_FILES))) {
        try { fs.unlinkSync(path.join(this.dir, n)); } catch { /* skip */ }
      }
    } catch { /* silent */ }
  }
}
