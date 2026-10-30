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
//   - later lines: samples (1 Hz), tags updates, changes (Rev568),
//     session close
//   - Rev568: the end line also carries a summary (error, servo work,
//     wind, speed, modes) and the list of profile / gain changes with
//     who made them and why, so the visor can show them without
//     reading the whole file
//   - sessions auto-open on engage, auto-close on disengage or plugin stop
//   - flush to disk every 30 s so a crash loses at most that much data

import * as fs from "fs";
import * as path from "path";
import { SERVO_ON_MIN_A } from "./constants";

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
  // Rev508: pypilot servo.flags (e.g. "SYNC PORT_OVERCURRENT_FAULT").
  servoFlags?: string | null;
  engaged: boolean;
  mode: string | null;
  tws: number | null;
  twa: number | null;
  aws: number | null;
  awa: number | null;
  sog: number | null;
  cog: number | null;
  // Rev564 (GPT review #2a): instantaneous attitude, named for what it
  // is. Format 1 files (no `format` in the header) stored the heel in a
  // field called `rollRms` and always null in `pitchRms`.
  heel: number | null;   // rad, navigation.attitude.roll at this sample
  pitch: number | null;  // rad, navigation.attitude.pitch at this sample
}

/** Rev564: bumped when a sample field changes meaning. 1 = no `format`
 *  in the header (rollRms / pitchRms), 2 = heel / pitch. */
export const SESSION_FORMAT = 2;

/** Rev568: a profile or gain change seen while recording. */
export interface SessionChange {
  ts: number;
  kind: "profile" | "gain";
  /** "profile" or the pypilot gain path ("ap.pilot.basic.D"). */
  key: string;
  from: string | number | null;
  to: string | number;
  /** Who made it: user, doctor, auto-profile, gust-boost, external... */
  source: string;
  reason?: string;
}

/** Rev568: per-session numbers, computed while recording. */
export interface SessionSummary {
  durationSec: number;
  samples: number;
  /** Mean signed heading (or wind angle) error, degrees. */
  meanErrDeg: number | null;
  rmsErrDeg: number | null;
  /** % of samples with servo current where the servo was drawing. */
  servoDutyPct: number | null;
  twsMeanKn: number | null;
  sogMeanKn: number | null;
  /** Samples (= seconds at 1 Hz) spent in each AP mode. */
  modes: Record<string, number>;
  changes: number;
}

const MAX_CHANGES = 100;
const MS_TO_KN = 1.943844;
const RAD_TO_DEG = 180 / Math.PI;

/** Running sums for SessionSummary; O(1) per sample. */
class SummaryAcc {
  private n = 0;
  private errN = 0; private errSum = 0; private errSumSq = 0;
  private curN = 0; private curOn = 0;
  private twsN = 0; private twsSum = 0;
  private sogN = 0; private sogSum = 0;
  private readonly modes: Record<string, number> = {};
  add(s: Partial<SessionSample>): void {
    this.n += 1;
    if (typeof s.hdgErr === "number" && isFinite(s.hdgErr)) { this.errN += 1; this.errSum += s.hdgErr; this.errSumSq += s.hdgErr * s.hdgErr; }
    if (typeof s.servoCur === "number") { this.curN += 1; if (s.servoCur > SERVO_ON_MIN_A) this.curOn += 1; }
    if (typeof s.tws === "number" && isFinite(s.tws)) { this.twsN += 1; this.twsSum += s.tws; }
    if (typeof s.sog === "number" && isFinite(s.sog)) { this.sogN += 1; this.sogSum += s.sog; }
    const m = typeof s.mode === "string" && s.mode ? s.mode : "?";
    if (m in this.modes || Object.keys(this.modes).length < 10) this.modes[m] = (this.modes[m] || 0) + 1;
  }
  result(durationSec: number, changes: number): SessionSummary {
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      durationSec: Math.round(durationSec),
      samples: this.n,
      meanErrDeg: this.errN ? r1(this.errSum / this.errN * RAD_TO_DEG) : null,
      rmsErrDeg: this.errN ? r1(Math.sqrt(this.errSumSq / this.errN) * RAD_TO_DEG) : null,
      servoDutyPct: this.curN ? Math.round(100 * this.curOn / this.curN) : null,
      twsMeanKn: this.twsN ? r1(this.twsSum / this.twsN * MS_TO_KN) : null,
      sogMeanKn: this.sogN ? r1(this.sogSum / this.sogN * MS_TO_KN) : null,
      modes: { ...this.modes },
      changes,
    };
  }
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
  /** Rev568: null for sessions recorded before Rev568. */
  summary?: SessionSummary | null;
  changes?: SessionChange[];
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
  private acc = new SummaryAcc();
  private changes: SessionChange[] = [];

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
    try { this.pruneToCount(); } catch { /* silent */ }
    // Rev176 (Carlos): purge "short session" files left over by earlier
    // Revs. Before Rev176 the recorder opened a JSONL on every
    // engage->disengage transition without debouncing. External clients
    // (KIP widgets, our own visor's reconnect logic, pypilot_web
    // watchdogs) toggling ap.enabled fast filled the directory with
    // files carrying 1..2 samples. Sweep them here so the retro noise
    // does not linger forever.
    try { this.pruneShortSessions(); } catch { /* silent */ }
  }

  // Rev176 (Carlos): delete every closed session with less than
  // `minSamples` samples OR less than `minMs` of duration. Only touches
  // finished files - the one currently being written (this.currentFile)
  // is always skipped. Cheap: one readdir + a fast peek at last line
  // for each file.
  pruneShortSessions(minSamples = 30, minMs = 30_000): { deleted: number } {
    let deleted = 0;
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir).filter((f) => f.startsWith("session-") && f.endsWith(".jsonl"));
    } catch { return { deleted }; }
    for (const name of names) {
      const full = path.join(this.dir, name);
      if (this.currentFile && full === this.currentFile) continue;
      try {
        const st = fs.statSync(full);
        // Fast heuristic first: files < 2 KB have almost certainly less
        // than 30 samples, so skip reading them and delete.
        if (st.size < 2 * 1024) {
          fs.unlinkSync(full);
          deleted += 1;
          continue;
        }
        // Otherwise read and count samples + span. Cheap for the sizes
        // we care about (< 100 KB); the big navigation files skip past
        // this in the size guard below.
        if (st.size > 100 * 1024) continue;
        const txt = fs.readFileSync(full, "utf8");
        let samples = 0, first = 0, last = 0;
        for (const l of txt.split("\n")) {
          if (!l) continue;
          try {
            const j = JSON.parse(l);
            if (j.type === "sample") {
              samples += 1;
              if (first === 0) first = j.ts;
              last = j.ts;
            }
          } catch { /* skip malformed line */ }
        }
        // Rev538 (GPT review 4 #7): N samples at 1 Hz cover N seconds
        // (0..N-1 is a span of N-1): same rule as stop(), which kept it.
        const span = last - first + 1000;
        if (samples < minSamples || (span > 1000 && span < minMs)) {
          fs.unlinkSync(full);
          deleted += 1;
        }
      } catch { /* skip */ }
    }
    if (deleted > 0) this.log("info", `[session] pruned ${deleted} short sessions (< ${minSamples} samples OR < ${minMs / 1000}s)`);
    return { deleted };
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

  // Rev505 (Carlos 2026-10-18, "últimas 50"): keep only the newest
  // `maxCount` sessions. 224 had piled up (one per engage) and made the
  // recorded-sessions list unusable. Oldest first by file name, which
  // embeds the start time (session-YYYYMMDD-HHMMSS-...), so it does not
  // depend on mtime. Never touches the session being recorded.
  pruneToCount(maxCount = 50): { deleted: number } {
    let deleted = 0;
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir).filter((f) => f.startsWith("session-") && f.endsWith(".jsonl"));
    } catch { return { deleted }; }
    names.sort();  // ascending = oldest first
    const current = this.currentFile ? path.basename(this.currentFile) : null;
    const closed = names.filter((n) => n !== current);
    const keepClosed = Math.max(0, maxCount - (current ? 1 : 0));
    for (const name of closed.slice(0, Math.max(0, closed.length - keepClosed))) {
      try { fs.unlinkSync(path.join(this.dir, name)); deleted += 1; } catch { /* skip */ }
    }
    if (deleted > 0) this.log("info", `[session] pruned ${deleted} old sessions (keeping the newest ${maxCount})`);
    return { deleted };
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
    // Rev505: after currentFile is set, so the new session counts in the 50.
    try { this.pruneToCount(); } catch { /* silent */ }
    this.startTs = Date.now();
    this.sampleCount = 0;
    this.tags = {};
    this.acc = new SummaryAcc();
    this.changes = [];
    const headerLine = JSON.stringify({
      type: "header",
      format: SESSION_FORMAT,
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
    this.acc.add(s);
    // Cap in-memory buffer at 2000 lines (~200 KB) so a stuck disk
    // does not eat all the plugin's RAM.
    if (this.buffer.length > 2000) this.buffer = this.buffer.slice(-2000);
  }

  /** Rev568: note a profile / gain change in the session being recorded. */
  recordChange(c: SessionChange): void {
    if (!this.currentFile) return;
    const clean: SessionChange = {
      ...c,
      reason: c.reason ? String(c.reason).slice(0, 160).replace(/[\r\n\t]+/g, " ") : undefined,
    };
    this.buffer.push(JSON.stringify({ type: "change", ...clean }));
    if (this.changes.length < MAX_CHANGES) this.changes.push(clean);
  }

  /** Rev568: summary of the session being recorded, from memory. */
  currentSummary(): SessionSummary | null {
    if (!this.currentFile || this.startTs == null) return null;
    return this.acc.result((Date.now() - this.startTs) / 1000, this.changes.length);
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
    // Rev176 (Carlos): if this session is trivially short (< 30 samples
    // OR < 30 s), discard it instead of flushing to disk. Pre-Rev176
    // recorders wrote a JSONL on every engage flicker so the directory
    // filled with 1-sample noise; the debounce upstream already blocks
    // most flickers, but this belt-and-suspenders drops anything that
    // still sneaks through (a legit disengage 10 s after engage).
    const durMs = this.startTs ? endTs - this.startTs : 0;
    const shouldDiscard = this.sampleCount < 30 || durMs < 30_000;
    if (shouldDiscard) {
      if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
      const file = this.currentFile;
      // Wipe in-flight buffer (nothing else will consume it).
      this.buffer = [];
      // Flush already-written content on disk gets unlinked in one shot.
      try { fs.unlinkSync(file); } catch { /* file may not exist yet if we never flushed */ }
      this.log("info", `[session] discarded ${this.currentId} (only ${this.sampleCount} samples in ${(durMs / 1000).toFixed(1)}s - bounce or short reset)`);
      this.currentFile = null;
      this.currentId = null;
      this.startTs = null;
      this.sampleCount = 0;
      this.tags = {};
      return;
    }
    this.buffer.push(JSON.stringify({
      type: "end",
      endTs,
      sampleCount: this.sampleCount,
      finalTags: this.tags,
      summary: this.acc.result(durMs / 1000, this.changes.length),
      changes: this.changes,
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
    const lines = this.buffer;
    this.buffer = [];
    try { fs.appendFileSync(this.currentFile, lines.join("\n") + "\n"); } catch (e: any) {
      // Rev538 (GPT review 4 #5): keep them for the next flush (bounded).
      this.buffer = lines.concat(this.buffer).slice(-5000);
      this.log("error", `session flush failed: ${e?.message || e}`);
    }
  }

  // ---- discovery helpers used by the HTTP endpoints ----

  // Rev567 (GPT review #8): the listing used to read and parse every
  // session file in full, synchronously, on Signal K's thread - 50 files
  // and 69 MB on Tunatunes, the biggest 21 MB. A closed session carries
  // everything the listing needs in its first line (header) and its last
  // line (end: endTs, sampleCount, finalTags), so only those are read.
  // Files without an end line (power cut) fall back to a full read once
  // and are cached by size + mtime.
  private summaryCache = new Map<string, { size: number; mtimeMs: number; info: SessionInfo }>();

  list(): SessionInfo[] {
    const out: SessionInfo[] = [];
    let files: string[] = [];
    try { files = fs.readdirSync(this.dir).filter((f) => f.startsWith("session-") && f.endsWith(".jsonl")); } catch { return out; }
    files.sort().reverse();
    const seen = new Set<string>();
    for (const f of files) {
      seen.add(f);
      const full = path.join(this.dir, f);
      if (this.currentFile && full === this.currentFile) {
        const live = this.liveInfo(full);
        if (live) out.push(live);
        continue;
      }
      let st: fs.Stats;
      try { st = fs.statSync(full); } catch { continue; }
      const hit = this.summaryCache.get(f);
      if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) { out.push(hit.info); continue; }
      const info = this.summariseFast(full) ?? this.summarise(full);
      if (!info) continue;
      this.summaryCache.set(f, { size: st.size, mtimeMs: st.mtimeMs, info });
      out.push(info);
    }
    for (const k of this.summaryCache.keys()) if (!seen.has(k)) this.summaryCache.delete(k);
    return out;
  }

  /** The session being recorded, from memory (its file is still growing). */
  private liveInfo(file: string): SessionInfo | null {
    if (!this.currentId || this.startTs == null) return null;
    const head = readEdgeLines(file).first;
    let pilot: string | null = null, profile: string | null = null;
    let gainsAtStart: Record<string, number> | null = null;
    try {
      const h = head ? JSON.parse(head) : null;
      if (h && h.type === "header") { pilot = h.pilot ?? null; profile = h.profile ?? null; gainsAtStart = h.gainsAtStart ?? null; }
    } catch { /* header unreadable */ }
    return {
      id: this.currentId, file, startTs: this.startTs, endTs: null,
      sampleCount: this.sampleCount, tags: { ...this.tags }, pilot, profile, gainsAtStart,
      summary: this.currentSummary(), changes: this.changes.slice(),
    };
  }

  /** Header + end line only. Null when the file has no end line. */
  private summariseFast(file: string): SessionInfo | null {
    const { first, last } = readEdgeLines(file);
    if (!first || !last) return null;
    try {
      const h = JSON.parse(first);
      const e = JSON.parse(last);
      if (h.type !== "header" || e.type !== "end" || typeof e.sampleCount !== "number") return null;
      return {
        id: h.sessionId || path.basename(file).replace(/^session-|\.jsonl$/g, ""),
        file,
        startTs: h.startTs || 0,
        endTs: e.endTs || null,
        sampleCount: e.sampleCount,
        tags: { ...(e.finalTags || {}) },
        pilot: h.pilot ?? null,
        profile: h.profile ?? null,
        gainsAtStart: h.gainsAtStart ?? null,
        summary: e.summary ?? null,
        changes: Array.isArray(e.changes) ? e.changes : [],
      };
    } catch { return null; }
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
      let summary: SessionSummary | null = null;
      const changes: SessionChange[] = [];
      // Rev568: a format-2 file without an end line (power cut) gets its
      // summary rebuilt from the samples; older files have none.
      const acc = new SummaryAcc();
      let lastSampleTs = 0;
      let formatAtLeast2 = false;
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          if (j.type === "header") {
            startTs = j.startTs || 0;
            id = j.sessionId || id;
            pilot = j.pilot ?? null;
            profile = j.profile ?? null;
            gainsAtStart = j.gainsAtStart ?? null;
            formatAtLeast2 = (j.format ?? 1) >= 2;
          } else if (j.type === "sample") {
            sampleCount += 1;
            acc.add(j);
            lastSampleTs = j.ts || lastSampleTs;
          } else if (j.type === "change") {
            if (changes.length < MAX_CHANGES) changes.push(j);
          } else if (j.type === "tags") {
            tags = { ...tags, ...(j.tags || {}) };
          } else if (j.type === "end") {
            endTs = j.endTs || null;
            if (j.finalTags) tags = { ...tags, ...j.finalTags };
            if (j.summary) summary = j.summary;
          }
        } catch { /* skip corrupt line */ }
      }
      if (!summary && formatAtLeast2 && startTs && lastSampleTs) {
        summary = acc.result((lastSampleTs - startTs) / 1000, changes.length);
      }
      return { id, file, startTs, endTs, sampleCount, tags, pilot, profile, gainsAtStart, summary, changes };
    } catch {
      return null;
    }
  }

  deleteSession(id: string): boolean {
    // Rev538 (GPT review 4 #6): same rule as the trip recorder.
    if (this.currentId && id === this.currentId) return false;
    const file = path.join(this.dir, `session-${id}.jsonl`);
    try { fs.unlinkSync(file); return true; } catch { return false; }
  }

  fileFor(id: string): string {
    return path.join(this.dir, `session-${id}.jsonl`);
  }

  directory(): string { return this.dir; }
}

/** Rev567: first and last non-empty lines of a file, reading at most
 *  EDGE_BYTES from each end. A line longer than that comes back null. */
const EDGE_BYTES = 64 * 1024;   // Rev568: the end line carries up to 100 changes
export function readEdgeLines(file: string): { first: string | null; last: string | null } {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (size === 0) return { first: null, last: null };
    const headLen = Math.min(size, EDGE_BYTES);
    const head = Buffer.alloc(headLen);
    fs.readSync(fd, head, 0, headLen, 0);
    const headTxt = head.toString("utf8");
    const nl = headTxt.indexOf("\n");
    const first = nl >= 0 ? headTxt.slice(0, nl) : (size <= EDGE_BYTES ? headTxt : null);
    const tailLen = Math.min(size, EDGE_BYTES);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const lines = tail.toString("utf8").split("\n").filter(Boolean);
    // The first piece of a partial tail read may be cut mid-line.
    const usable = tailLen < size ? lines.slice(1) : lines;
    const last = usable.length > 0 ? usable[usable.length - 1] : null;
    return { first: first || null, last };
  } catch {
    return { first: null, last: null };
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch { /* silent */ } }
  }
}
