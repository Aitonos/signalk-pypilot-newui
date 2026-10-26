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
/** Rev538 (GPT review 4 #12): one incident is written after 15 min / 100
 *  events at most; what keeps happening opens the next one. */
export const BB_MAX_INCIDENT_SAMPLES = 900;
export const BB_MAX_EVENTS = 100;
export const BB_NOTE_MAX = 1000;

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
  seen?: boolean;        // Rev528: opened in the visor at least once
  note?: string;         // Rev544: the sailor's words (dictated with the phone keyboard)
}

export interface BlackBoxSummary {
  id: string; ts: number; kind: string; detail: string; events: number; samples: number; seen: boolean;
  note: string;
}

export class BlackBox {
  private ring: BlackBoxSample[] = [];
  private open: BlackBoxIncident | null = null;
  private lastKindTs = new Map<string, number>();
  private readonly dir: string | null;
  // Rev529: the visor polls the list every 10 s; parse the files only
  // when something changed.
  private listCache: BlackBoxSummary[] | null = null;

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
      if (s.ts - lastEvt >= BB_POST_MS || this.open.samples.length >= BB_MAX_INCIDENT_SAMPLES) this.close(s.ts);
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
      if (this.open.events.length < BB_MAX_EVENTS) this.open.events.push(evt);
      else this.open.events[this.open.events.length - 1] = evt;
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
    if (this.listCache) return this.listCache.slice();
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir).filter((f) => f.startsWith("bb-") && f.endsWith(".json")); } catch { return []; }
    const out: BlackBoxSummary[] = [];
    for (const n of names.sort().reverse()) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(this.dir, n), "utf8")) as BlackBoxIncident;
        out.push({ id: j.id, ts: j.ts, kind: j.kind, detail: j.detail, events: j.events.length, samples: j.samples.length, seen: !!j.seen, note: typeof j.note === "string" ? j.note : "" });
      } catch { /* skip broken */ }
    }
    this.listCache = out;
    return out.slice();
  }

  get(id: string): BlackBoxIncident | null {
    if (!this.dir || !/^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$/i.test(id)) return null;
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, `bb-${id}.json`), "utf8")); } catch { return null; }
  }

  /** Rev528: the sailor opened it; the Setup tile goes back to green. */
  markSeen(id: string): boolean {
    const inc = this.get(id);
    if (!inc || !this.dir) return false;
    if (inc.seen) return true;
    inc.seen = true;
    this.listCache = null;
    return this.writeAtomic(inc);
  }

  /** Rev544: attach / replace the sailor's note. Works on the incident
   *  still recording (written when it closes) and on saved ones.
   *  Rev551 (audit): `append` - a second Mark inside the same incident adds
   *  its note instead of replacing the first; the popup's Note replaces. */
  setNote(id: string, raw: string, append = false): boolean {
    const clean = String(raw || "").replace(/[\x00-\x1F\x7F]/g, " ").trim();
    const join = (old: string | undefined): string =>
      (append && old ? (clean ? `${old} | ${clean}` : old) : clean).slice(0, BB_NOTE_MAX);
    if (this.open && this.open.id === id) { this.open.note = join(this.open.note); return true; }
    const inc = this.get(id);
    if (!inc || !this.dir) return false;
    inc.note = join(inc.note);
    this.listCache = null;
    return this.writeAtomic(inc);
  }

  /** Rev551: tmp + rename, so a power cut never leaves a half-written incident. */
  private writeAtomic(inc: BlackBoxIncident): boolean {
    if (!this.dir) return false;
    try {
      const file = path.join(this.dir, `bb-${inc.id}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(inc));
      fs.renameSync(`${file}.tmp`, file);
      return true;
    } catch { return false; }
  }

  /** Rev544: the incident being recorded right now (for the "Mark" note). */
  openId(): string | null { return this.open ? this.open.id : null; }

  remove(id: string): boolean {
    if (!this.dir || !/^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$/i.test(id)) return false;
    this.listCache = null;
    try { fs.unlinkSync(path.join(this.dir, `bb-${id}.json`)); return true; } catch { return false; }
  }

  private close(nowMs: number): void {
    const inc = this.open!;
    this.open = null;
    inc.closedTs = nowMs;
    this.listCache = null;
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
