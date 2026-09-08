// Rev143 (Carlos): navigation session recorder. Fase 1 of the AI-tuned
// Doctor plan - we collect labelled real-world engaged sessions on the
// boat so I (Claude) can analyse them offline and inject boat-specific
// heuristics into a future Rev. The plugin itself does NOT do any AI
// at runtime; it just records raw telemetry + user labels and lets the
// user download the archive.
//
// Model:
//   - one JSONL file per session in <dataDir>/nav-sessions/
//   - filename: session-<yyyymmdd>-<hhmmss>-<epochSuffix>.jsonl
//   - first line: header (pilot, profile, gains at start, plugin rev)
//   - later lines: samples (1 Hz), tags updates, session close
//   - sessions auto-open on engage, auto-close on disengage or plugin stop
//   - flush to disk every 30 s so a crash loses at most that much data

import * as fs from "fs";
import * as path from "path";

export interface SessionSample {
  ts: number;
  hdgCmd: number | null;
  hdgAct: number | null;
  hdgErr: number | null;
  hdgRate: number | null;
  hdgRateRate: number | null;
  servoCmd: number | null;
  servoCur: number | null;
  servoDuty: number | null;
  servoVolt: number | null;
  engaged: boolean;
  mode: string | null;
  tws: number | null;
  twa: number | null;
  aws: number | null;
  awa: number | null;
  sog: number | null;
  cog: number | null;
  pitchRms: number | null;
  rollRms: number | null;
}

export interface SessionTags {
  wind?: string;   // "<5" | "5-10" | "10-15" | "15-20" | "20-30" | ">30"
  sea?: string;    // "flat" | "ripple" | "short-chop" | "long-swell" | "mixed"
  motor?: string;  // "sail" | "motor-sailing" | "motor"
  pos?: string;    // "close-hauled" | "reaching" | "broad-reach" | "running"
  crew?: string;   // "single" | "double" | "crewed"
  note?: string;   // free text (<=200 chars, sanitised)
}

export interface SessionInfo {
  id: string;
  file: string;
  startTs: number;
  endTs: number | null;
  sampleCount: number;
  tags: SessionTags;
  pilot: string | null;
  profile: string | null;
  gainsAtStart: Record<string, number> | null;
}

interface Options {
  dataDir: string;
  flushIntervalMs?: number;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export class SessionRecorder {
  private readonly dir: string;
  private readonly flushMs: number;
  private readonly log: (l: string, m: string) => void;
  private currentFile: string | null = null;
  private currentId: string | null = null;
  private startTs: number | null = null;
  private sampleCount = 0;
  private tags: SessionTags = {};
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(opts: Options) {
    this.dir = path.join(opts.dataDir, "nav-sessions");
    this.flushMs = opts.flushIntervalMs ?? 30000;
    this.log = (opts.log as (l: string, m: string) => void) ?? (() => {});
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch {}
    // Rev159 (Carlos): prune old sessions on startup so the plugin
    // reclaims disk if the user forgot to delete them. Runs once here
    // and again inside start() so a long uptime with many sessions
    // does not grow unbounded either.
    try { this.pruneToBudget(); } catch { /* silent */ }
  }

  // Rev159: FIFO cap on the sessions directory. Enforce a soft
  // budget in bytes (default 200 MB): while total > budget, delete
  // the oldest session file. Never touches the file currently being
  // written to (currentFile).
  pruneToBudget(maxBytes = 200 * 1024 * 1024): { deleted: number; freedBytes: number } {
    let deleted = 0, freed = 0;
    let entries: Array<{ name: string; mtime: number; size: number }> = [];
    try {
      const names = fs.readdirSync(this.dir).filter((f) => f.startsWith("session-") && f.endsWith(".jsonl"));
      for (const name of names) {
        try {
          const st = fs.statSync(path.join(this.dir, name));
          entries.push({ name, mtime: st.mtimeMs, size: st.size });
        } catch { /* skip unreadable */ }
      }
    } catch { return { deleted, freedBytes: freed }; }
    let total = entries.reduce((a, e) => a + e.size, 0);
    if (total <= maxBytes) return { deleted, freedBytes: freed };
    // Sort ascending by mtime = oldest first.
    entries.sort((a, b) => a.mtime - b.mtime);
    for (const e of entries) {
      if (total <= maxBytes) break;
      const full = path.join(this.dir, e.name);
      if (this.currentFile && full === this.currentFile) continue;
      try {
        fs.unlinkSync(full);
        total -= e.size;
        freed += e.size;
        deleted += 1;
      } catch { /* skip */ }
    }
    if (deleted > 0) this.log("info", `[session] pruned ${deleted} old sessions (${(freed / 1024 / 1024).toFixed(1)} MB freed)`);
    return { deleted, freedBytes: freed };
  }

  isRecording(): boolean { return this.currentFile != null; }
  currentSessionId(): string | null { return this.currentId; }
  currentSampleCount(): number { return this.sampleCount; }
  currentStartTs(): number | null { return this.startTs; }
  currentTags(): SessionTags { return { ...this.tags }; }

  start(header: {
    pilot: string | null;
    profile: string | null;
    gainsAtStart: Record<string, number> | null;
    revision: string;
  }): void {
    if (this.currentFile) return;   // idempotent
    // Rev159: enforce the FIFO budget before opening a new file so a
    // long-running boat does not silently fill the SD card.
    try { this.pruneToBudget(); } catch { /* silent */ }
    const now = new Date();
    const yy = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const suffix = String(Date.now() % 100000).padStart(5, "0");
    this.currentId = `${yy}${mo}${dd}-${hh}${mi}${ss}-${suffix}`;
    this.currentFile = path.join(this.dir, `session-${this.currentId}.jsonl`);
    this.startTs = Date.now();
    this.sampleCount = 0;
    this.tags = {};
    const headerLine = JSON.stringify({
      type: "header",
      sessionId: this.currentId,
      startTs: this.startTs,
      pilot: header.pilot,
      profile: header.profile,
      gainsAtStart: header.gainsAtStart,
      revision: header.revision,
    }) + "\n";
    try { fs.writeFileSync(this.currentFile, headerLine); } catch (e: any) {
      this.log("error", `session start write failed: ${e?.message || e}`);
      this.currentFile = null;
      this.currentId = null;
      return;
    }
    this.log("info", `[session] started ${this.currentId}`);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => this.flush(), this.flushMs);
  }

  sample(s: SessionSample): void {
    if (!this.currentFile) return;
    this.buffer.push(JSON.stringify({ type: "sample", ...s }));
    this.sampleCount += 1;
    // Cap in-memory buffer at 2000 lines (~200 KB) so a stuck disk
    // does not eat all the plugin's RAM.
    if (this.buffer.length > 2000) this.buffer = this.buffer.slice(-2000);
  }

  updateTags(patch: SessionTags): void {
    if (!this.currentFile) return;
    const clean: SessionTags = {};
    if (patch.wind)  clean.wind  = String(patch.wind).slice(0, 20);
    if (patch.sea)   clean.sea   = String(patch.sea).slice(0, 20);
    if (patch.motor) clean.motor = String(patch.motor).slice(0, 20);
    if (patch.pos)   clean.pos   = String(patch.pos).slice(0, 20);
    if (patch.crew)  clean.crew  = String(patch.crew).slice(0, 20);
    if (patch.note != null) {
      clean.note = String(patch.note).slice(0, 200).replace(/[\r\n\t]+/g, " ");
    }
    this.tags = { ...this.tags, ...clean };
    this.buffer.push(JSON.stringify({ type: "tags", ts: Date.now(), tags: this.tags }));
  }

  stop(): void {
    if (!this.currentFile) return;
    const endTs = Date.now();
    this.buffer.push(JSON.stringify({
      type: "end",
      endTs,
      sampleCount: this.sampleCount,
      finalTags: this.tags,
    }));
    this.flush();
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    this.log("info", `[session] stopped ${this.currentId} (${this.sampleCount} samples)`);
    this.currentFile = null;
    this.currentId = null;
    this.startTs = null;
    this.sampleCount = 0;
    this.tags = {};
    this.buffer = [];
  }

  private flush(): void {
    if (!this.currentFile || this.buffer.length === 0) return;
    const payload = this.buffer.join("\n") + "\n";
    this.buffer = [];
    try { fs.appendFileSync(this.currentFile, payload); } catch (e: any) {
      this.log("error", `session flush failed: ${e?.message || e}`);
    }
  }

  // ---- discovery helpers used by the HTTP endpoints ----

  list(): SessionInfo[] {
    const out: SessionInfo[] = [];
    let files: string[] = [];
    try { files = fs.readdirSync(this.dir).filter((f) => f.startsWith("session-") && f.endsWith(".jsonl")); } catch { return out; }
    files.sort().reverse();
    for (const f of files) {
      const info = this.summarise(path.join(this.dir, f));
      if (info) out.push(info);
    }
    return out;
  }

  private summarise(file: string): SessionInfo | null {
    try {
      const txt = fs.readFileSync(file, "utf8");
      const lines = txt.split("\n").filter(Boolean);
      let startTs = 0, endTs: number | null = null;
      let sampleCount = 0;
      let tags: SessionTags = {};
      let id = path.basename(file).replace(/^session-|\.jsonl$/g, "");
      let pilot: string | null = null;
      let profile: string | null = null;
      let gainsAtStart: Record<string, number> | null = null;
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          if (j.type === "header") {
            startTs = j.startTs || 0;
            id = j.sessionId || id;
            pilot = j.pilot ?? null;
            profile = j.profile ?? null;
            gainsAtStart = j.gainsAtStart ?? null;
          } else if (j.type === "sample") {
            sampleCount += 1;
          } else if (j.type === "tags") {
            tags = { ...tags, ...(j.tags || {}) };
          } else if (j.type === "end") {
            endTs = j.endTs || null;
            if (j.finalTags) tags = { ...tags, ...j.finalTags };
          }
        } catch { /* skip corrupt line */ }
      }
      return { id, file, startTs, endTs, sampleCount, tags, pilot, profile, gainsAtStart };
    } catch {
      return null;
    }
  }

  deleteSession(id: string): boolean {
    const file = path.join(this.dir, `session-${id}.jsonl`);
    try { fs.unlinkSync(file); return true; } catch { return false; }
  }

  fileFor(id: string): string {
    return path.join(this.dir, `session-${id}.jsonl`);
  }

  directory(): string { return this.dir; }
}
