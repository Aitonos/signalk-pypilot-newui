// Rev571 (auto-Doctor phase 4): gain watchdog. A separate process,
// started by the plugin only while an automatic gain trial is running,
// that puts pypilot back on the original profile if the plugin stops
// renewing its lease (plugin crashed, Signal K frozen or restarted).
//
// Why a separate process: on 2026-10-23 Signal K froze for 5 hours. A
// trial running inside the plugin then could not undo itself; this
// process keeps running because it is not part of Signal K.
//
// Usage: node gain-watchdog.js <dir>
//   <dir>/lease.json    written by the plugin (gain-guard.ts)
//   <dir>/watchdog.pid  this process
//   <dir>/watchdog.log  what it did
//
// It talks to pypilot over its own TCP port (23322), not through the
// plugin. It only ever writes `profile` (back to the original one, and
// only if that profile still exists). It exits after 10 idle minutes.
//
// Plain Node, no dependencies, so it can run while the plugin cannot.

import * as fs from "fs";
import * as net from "net";
import * as path from "path";

export interface GainLease {
  /** Rev580 (GPT re-audit R02): one id per trial. Every write checks it,
   *  so a restore of an old trial never touches a newer one. */
  id?: string;
  active: boolean;
  /** Profile to go back to. */
  restoreProfile: string;
  /** Profile being tested (for the log). */
  testProfile: string | null;
  host: string;
  port: number;
  /** Plugin's last renewal (ms). */
  renewedTs: number;
  /** Lease expires this long after the last renewal. */
  ttlMs: number;
  reason?: string;
  restoredTs?: number;
  restoredBy?: string;
  /** Definitive failure only ("missing": the profile no longer exists). */
  restoreError?: string;
  /** Rev578 (GPT audit B03): not restored because the sailor picked
   *  another profile meanwhile. */
  restoreSkipped?: string;
  /** Rev578 (GPT audit A10): last transient failure, still retrying. */
  lastAttemptError?: string;
}

const TICK_MS = 1000;
const IDLE_EXIT_MS = 10 * 60 * 1000;
// Rev578 (GPT audit A10): transient failures (WiFi to the TinyPilot
// down, pypilot restarting) are retried for as long as the lease stays
// expired, waiting 5 s, 10 s, 20 s... up to 60 s between attempts.
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60_000;
const LOG_CAP_BYTES = 256 * 1024;

/** JSON with every non-ASCII char escaped, so pypilot reads the same
 *  name whatever byte encoding it assumes. */
export function jsonAscii(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Ask pypilot to switch profile and wait until it reports it.
 *  Refuses when the profile no longer exists (pypilot would create it
 *  as a copy of the active one). Rev578 (GPT audit B03): with `onlyFrom`
 *  it only switches if the active profile is still that one (the trial
 *  profile); anything else means the sailor chose, and wins ("manual").
 *  "ok" also when the profile is already the wanted one. */
export function setProfile(host: string, port: number, profile: string, timeoutMs = 5000, onlyFrom?: string | null): Promise<"ok" | "missing" | "manual" | "timeout" | "error"> {
  return new Promise((resolve) => {
    let done = false;
    let buf = "";
    let profiles: string[] | null = null;
    let active: string | null = null;
    let sent = false;
    const sock = net.createConnection({ host, port });
    const finish = (r: "ok" | "missing" | "manual" | "timeout" | "error") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* silent */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    sock.setEncoding("utf8");
    sock.on("error", () => finish("error"));
    sock.on("connect", () => sock.write(`watch=${JSON.stringify({ profiles: true, profile: true })}\n`));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq);
        let val: unknown;
        try { val = JSON.parse(line.slice(eq + 1)); } catch { continue; }
        if (key === "profiles" && Array.isArray(val)) profiles = val.map(String);
        else if (key === "profile" && typeof val === "string") active = val;
        else continue;
        if (sent) {
          if (active === profile) return finish("ok");
          continue;
        }
        if (profiles == null || active == null) continue;   // need both first
        if (active === profile) return finish("ok");
        if (!profiles.includes(profile)) return finish("missing");
        if (onlyFrom != null && active !== onlyFrom) return finish("manual");
        sent = true;
        sock.write(`profile=${jsonAscii(profile)}\n`);
      }
    });
  });
}

function readLease(file: string): GainLease | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as GainLease; } catch { return null; }
}

function writeLease(file: string, lease: GainLease): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lease));
  fs.renameSync(tmp, file);
}

export function runWatchdog(dir: string): void {
  const leaseFile = path.join(dir, "lease.json");
  const pidFile = path.join(dir, "watchdog.pid");
  // Rev580 (GPT re-audit R04): heartbeat, so the plugin can tell a live
  // watchdog from a stuck one (a pid alone does not show progress).
  const beatFile = path.join(dir, "watchdog.beat");
  const logFile = path.join(dir, "watchdog.log");
  const log = (msg: string) => {
    try {
      const st = fs.existsSync(logFile) ? fs.statSync(logFile) : null;
      if (st && st.size > LOG_CAP_BYTES) fs.renameSync(logFile, `${logFile}.1`);
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
    } catch { /* silent */ }
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid));
  log(`started pid ${process.pid}`);
  let idleSince: number | null = null;
  let restoring = false;
  const quit = (why: string) => {
    log(`exit: ${why}`);
    try { if (fs.readFileSync(pidFile, "utf8").trim() === String(process.pid)) fs.unlinkSync(pidFile); } catch { /* silent */ }
    process.exit(0);
  };
  process.on("SIGTERM", () => quit("SIGTERM"));
  process.on("SIGINT", () => quit("SIGINT"));

  // Rev580 (GPT re-audit R02): only update the lease if it is still the
  // trial this restore belongs to.
  const writeIfSame = (id: string | undefined, patch: Partial<GainLease>): boolean => {
    const cur = readLease(leaseFile);
    if (!cur || cur.id !== id) return false;
    writeLease(leaseFile, { ...cur, ...patch });
    return true;
  };

  const restore = async (lease: GainLease) => {
    restoring = true;
    log(`lease expired (${Math.round((Date.now() - lease.renewedTs) / 1000)} s without renewal) during trial of "${lease.testProfile}"; restoring "${lease.restoreProfile}"`);
    for (let i = 0; ; i += 1) {
      const now = readLease(leaseFile);
      if (!now || now.id !== lease.id) {
        log("a newer trial replaced this one; leaving it to its own lease");
        break;
      }
      // The plugin came back and renewed, or ended the trial itself.
      if (!now.active || Date.now() - now.renewedTs <= now.ttlMs) {
        log("plugin renewed or ended the trial meanwhile; nothing to do");
        break;
      }
      const r = await setProfile(lease.host, lease.port, lease.restoreProfile, 5000, lease.testProfile);
      if (r === "ok") {
        if (writeIfSame(lease.id, { active: false, restoredTs: Date.now(), restoredBy: "watchdog", lastAttemptError: undefined })) log(`restored "${lease.restoreProfile}"`);
        else log(`restored "${lease.restoreProfile}"; a newer trial now owns the lease, left untouched`);
        break;
      }
      if (r === "manual") {
        writeIfSame(lease.id, { active: false, restoreSkipped: "sailor chose another profile" });
        log(`not restoring "${lease.restoreProfile}": the active profile is no longer "${lease.testProfile}" (sailor's choice wins)`);
        break;
      }
      if (r === "missing") {
        writeIfSame(lease.id, { active: false, restoreError: "missing" });
        log(`could not restore "${lease.restoreProfile}": the profile no longer exists`);
        break;
      }
      const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(i, 4));
      if (!writeIfSame(lease.id, { lastAttemptError: r })) { log("a newer trial replaced this one during the retry"); break; }
      log(`attempt ${i + 1}: ${r}; retrying in ${wait / 1000} s`);
      await new Promise((res) => setTimeout(res, wait));
    }
    restoring = false;
  };

  setInterval(() => {
    try { fs.writeFileSync(beatFile, String(Date.now())); } catch { /* silent */ }
    if (restoring) return;
    const lease = readLease(leaseFile);
    const now = Date.now();
    if (lease && lease.active) {
      idleSince = null;
      if (now - lease.renewedTs > lease.ttlMs) void restore(lease);
      return;
    }
    if (idleSince == null) idleSince = now;
    if (now - idleSince > IDLE_EXIT_MS) quit("idle");
  }, TICK_MS);
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { process.stderr.write("usage: gain-watchdog <dir>\n"); process.exit(2); }
  runWatchdog(dir);
}
