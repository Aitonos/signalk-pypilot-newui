// Rev322 (Carlos, 2026-09-27): Maneuver Trace Log. Every user action
// posted by the visor is stored together with the pypilot state that
// was current in that exact instant AND with the state observed a
// short delay later (default 300 ms). The pair pre/post makes it
// trivial to answer "did pypilot obey what we asked?" — the core bug
// symptom in the aproado / empopado / tack-in-wind sea trial 2026-09-27.
//
// Not a general audit log — this only stores maneuver-relevant events.
// The samples-per-second telemetry keeps living in session-recorder.
//
// Storage model:
//   - one JSONL file per session (auto-rolls on start()).
//   - <dataDir>/maneuver-trace/trace-<yyyymmdd>-<hhmmss>.jsonl
//   - two lines per event: {phase:"pre",...} then {phase:"post",...}.
//   - in-memory ring buffer (500 entries) so /tail can serve without
//     touching disk even on a Pi 4 with a slow SD card.

import * as fs from "fs";
import * as path from "path";

export type ManeuverEventKind =
  | "aproado_start"
  | "aproado_pick"
  | "aproado_teardown"
  | "empopado_start"
  | "empopado_pick"
  | "empopado_teardown"
  | "tack_tap"
  | "tack_cancel"
  | "mode_change"
  | "target_put"
  | "engage"
  | "disengage"
  | "nudge"
  | "other";

export interface ManeuverEventInput {
  kind: ManeuverEventKind;
  payload?: Record<string, unknown>;
  visorRev?: string;
}

// Snapshot of pypilot / SK state at a moment in time. Kept flat so the
// JSONL grep-friendliness is preserved.
export interface ManeuverContext {
  ts: number;                 // ms epoch
  mode: string | null;        // "compass" | "wind" | ...
  target: number | null;      // rad (interpretation is mode-dependent)
  heading: number | null;     // rad
  awa: number | null;         // rad
  twa: number | null;         // rad
  engaged: boolean | null;
  tackState: string | null;   // "none" | "begin" | "waiting" | ...
  tackDirection: string | null;
  servoCur: number | null;    // A
}

export interface TraceEntry {
  ts: number;
  kind: ManeuverEventKind;
  payload: Record<string, unknown>;
  visorRev: string | null;
  pre: ManeuverContext;
  post: ManeuverContext | null;
  postDelayMs: number | null;
}

interface Options {
  dataDir: string;
  flushIntervalMs?: number;
  ringSize?: number;
  postDelayMs?: number;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export class ManeuverTraceLog {
  private readonly dir: string;
  private readonly flushMs: number;
  private readonly ringSize: number;
  private readonly postDelayMs: number;
  private readonly log: (l: string, m: string) => void;
  private enabled = false;
  private currentFile: string | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private ring: TraceEntry[] = [];
  private pendingPost: Set<NodeJS.Timeout> = new Set();

  constructor(opts: Options) {
    this.dir = path.join(opts.dataDir, "maneuver-trace");
    this.flushMs = opts.flushIntervalMs ?? 5000;
    this.ringSize = opts.ringSize ?? 500;
    this.postDelayMs = opts.postDelayMs ?? 300;
    this.log = (opts.log as (l: string, m: string) => void) ?? (() => {});
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch { /* silent */ }
  }

  isEnabled(): boolean { return this.enabled; }
  currentFilePath(): string | null { return this.currentFile; }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.rollFile();
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flush(), this.flushMs);
    }
    this.log("info", "[maneuver-trace] started");
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    for (const t of this.pendingPost) clearTimeout(t);
    this.pendingPost.clear();
    this.flush();
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    this.log("info", "[maneuver-trace] stopped");
  }

  private rollFile(): void {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const name = `trace-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jsonl`;
    this.currentFile = path.join(this.dir, name);
  }

  record(
    input: ManeuverEventInput,
    pre: ManeuverContext,
    getPost: () => ManeuverContext | null,
  ): TraceEntry {
    const entry: TraceEntry = {
      ts: pre.ts,
      kind: input.kind,
      payload: input.payload ?? {},
      visorRev: input.visorRev ?? null,
      pre,
      post: null,
      postDelayMs: null,
    };
    this.pushRing(entry);
    if (!this.enabled) return entry;
    this.buffer.push(JSON.stringify({ phase: "pre", ...entry }));
    const timer = setTimeout(() => {
      try {
        const post = getPost();
        if (post) {
          entry.post = post;
          entry.postDelayMs = this.postDelayMs;
          this.buffer.push(JSON.stringify({
            phase: "post",
            ts: post.ts,
            kind: entry.kind,
            payload: entry.payload,
            delayMs: this.postDelayMs,
            pre: entry.pre,
            post,
          }));
        }
      } catch (e) {
        this.log("warn", `[maneuver-trace] post capture failed: ${(e as Error).message}`);
      }
      this.pendingPost.delete(timer);
    }, this.postDelayMs);
    this.pendingPost.add(timer);
    return entry;
  }

  private pushRing(entry: TraceEntry): void {
    this.ring.push(entry);
    if (this.ring.length > this.ringSize) this.ring.shift();
  }

  tail(n: number): TraceEntry[] {
    if (n <= 0) return [];
    return this.ring.slice(-Math.min(n, this.ring.length));
  }

  private flush(): void {
    if (!this.currentFile || this.buffer.length === 0) return;
    const lines = this.buffer;
    this.buffer = [];
    try {
      fs.appendFileSync(this.currentFile, lines.join("\n") + "\n", "utf8");
    } catch (e) {
      this.log("warn", `[maneuver-trace] flush failed: ${(e as Error).message}`);
    }
  }

  status(): { enabled: boolean; file: string | null; ringEntries: number; pendingPosts: number } {
    return {
      enabled: this.enabled,
      file: this.currentFile,
      ringEntries: this.ring.length,
      pendingPosts: this.pendingPost.size,
    };
  }
}
