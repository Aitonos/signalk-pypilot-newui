// Rev571 (auto-Doctor phase 4): plugin side of the gain watchdog.
//
// Before any automatic gain trial the caller runs begin(): the lease file
// says which profile to go back to and the plugin keeps renewing it every
// few seconds. end() closes the trial. If the renewals stop (plugin
// crash, Signal K frozen or restarted, power cut) the separate watchdog
// process (gain-watchdog.ts) switches pypilot back to that profile.
//
// The watchdog is only started while a trial is running, or at plugin
// start when an unfinished trial is found. With automatic tuning off
// there is no extra process.

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import type { GainLease } from "./gain-watchdog";

export interface GainGuardOptions {
  /** Folder for lease, pid and log (inside the plugin's data dir). */
  dir: string;
  /** pypilot host and its TCP port (23322). */
  host: string;
  port?: number;
  /** Lease lifetime without renewal. */
  ttlMs?: number;
  renewMs?: number;
  /** Compiled watchdog script; defaults to the one next to this file. */
  scriptPath?: string;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export class GainGuard {
  private readonly leaseFile: string;
  private readonly pidFile: string;
  private readonly ttlMs: number;
  private readonly renewMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: GainGuardOptions) {
    this.leaseFile = path.join(opts.dir, "lease.json");
    this.pidFile = path.join(opts.dir, "watchdog.pid");
    this.ttlMs = opts.ttlMs ?? 15_000;
    this.renewMs = opts.renewMs ?? 3_000;
    try { fs.mkdirSync(opts.dir, { recursive: true }); } catch { /* silent */ }
  }

  /** At plugin start: an active lease left behind means a trial did not
   *  finish (crash, power cut). The watchdog will find it expired and
   *  restore the original profile. Returns true when one was found. */
  recoverOnStart(): boolean {
    const l = this.read();
    if (!l || !l.active) return false;
    this.opts.log?.("warn", `[gain-guard] unfinished trial of "${l.testProfile}" found; watchdog restores "${l.restoreProfile}"`);
    this.ensureWatchdog();
    return true;
  }

  /** Rev578 (GPT audit B02): arms the protection and says whether it is
   *  really in place - the lease is on disk and the watchdog process is
   *  running (waits up to 3 s for it). Callers must not start a trial when
   *  ok is false. */
  async begin(t: { restoreProfile: string; testProfile: string | null; reason?: string }): Promise<{ ok: boolean; error?: string }> {
    const written = this.write({
      active: true, restoreProfile: t.restoreProfile, testProfile: t.testProfile,
      host: this.opts.host, port: this.opts.port ?? 23322,
      renewedTs: Date.now(), ttlMs: this.ttlMs, reason: t.reason,
    });
    if (!written) return { ok: false, error: "could not write the lease" };
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.renew(), this.renewMs);
    this.ensureWatchdog();
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      const pid = this.watchdogPid();
      if (pid != null && alive(pid)) return { ok: true };
      await new Promise((r) => setTimeout(r, 100));
    }
    this.end();
    return { ok: false, error: "the watchdog did not start" };
  }

  /** Trial over (kept or undone by the caller itself). */
  end(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const l = this.read();
    if (l && l.active) this.write({ ...l, active: false });
  }

  /** Plugin stopping: stop renewing but leave the lease, so a trial still
   *  running is undone by the watchdog once it expires. */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  status(): { lease: GainLease | null; watchdogPid: number | null; watchdogAlive: boolean } {
    const pid = this.watchdogPid();
    return { lease: this.read(), watchdogPid: pid, watchdogAlive: pid != null && alive(pid) };
  }

  private renew(): void {
    const l = this.read();
    if (!l || !l.active) { this.stop(); return; }
    this.write({ ...l, renewedTs: Date.now() });
  }

  private ensureWatchdog(): void {
    const pid = this.watchdogPid();
    if (pid != null && alive(pid)) return;
    const script = this.opts.scriptPath ?? path.join(__dirname, "gain-watchdog.js");
    try {
      const child = spawn(process.execPath, [script, this.opts.dir], { detached: true, stdio: "ignore" });
      child.on("error", (e) => this.opts.log?.("error", `[gain-guard] watchdog process error: ${e?.message || e}`));
      child.unref();
      this.opts.log?.("info", `[gain-guard] watchdog started (pid ${child.pid})`);
    } catch (e: any) {
      this.opts.log?.("error", `[gain-guard] could not start the watchdog: ${e?.message || e}`);
    }
  }

  private watchdogPid(): number | null {
    try {
      const n = parseInt(fs.readFileSync(this.pidFile, "utf8").trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch { return null; }
  }

  private read(): GainLease | null {
    try { return JSON.parse(fs.readFileSync(this.leaseFile, "utf8")) as GainLease; } catch { return null; }
  }

  /** Small file, written atomically (temp + rename): the watchdog never
   *  reads half a lease. */
  private write(l: GainLease): boolean {
    try {
      const tmp = `${this.leaseFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(l));
      fs.renameSync(tmp, this.leaseFile);
      return true;
    } catch (e: any) {
      this.opts.log?.("error", `[gain-guard] lease write failed: ${e?.message || e}`);
      return false;
    }
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (e: any) { if (e?.code !== "EPERM") return false; }
  // A stale pid file can point at a reused pid: on Linux check it is
  // really the watchdog.
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmd.includes("gain-watchdog");
  } catch { return true; }   // no /proc (tests on Windows): trust kill(0)
}
