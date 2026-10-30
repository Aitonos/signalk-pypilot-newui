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
  restoreError?: string;
}

const TICK_MS = 1000;
const IDLE_EXIT_MS = 10 * 60 * 1000;
const RETRY_MS = 5000;
const MAX_ATTEMPTS = 6;
const LOG_CAP_BYTES = 256 * 1024;

/** JSON with every non-ASCII char escaped, so pypilot reads the same
 *  name whatever byte encoding it assumes. */
export function jsonAscii(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Ask pypilot to switch profile and wait until it reports it.
 *  Refuses when the profile no longer exists (pypilot would create it
 *  as a copy of the active one). */
export function setProfile(host: string, port: number, profile: string, timeoutMs = 5000): Promise<"ok" | "missing" | "timeout" | "error"> {
  return new Promise((resolve) => {
    let done = false;
    let buf = "";
    let profiles: string[] | null = null;
    let sent = false;
    const sock = net.createConnection({ host, port });
    const finish = (r: "ok" | "missing" | "timeout" | "error") => {
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
        if (key === "profiles" && Array.isArray(val)) {
          profiles = val.map(String);
          if (!profiles.includes(profile)) return finish("missing");
          if (!sent) { sent = true; sock.write(`profile=${jsonAscii(profile)}\n`); }
        } else if (key === "profile" && sent && val === profile) {
          return finish("ok");
        }
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

  const restore = async (lease: GainLease) => {
    restoring = true;
    log(`lease expired (${Math.round((Date.now() - lease.renewedTs) / 1000)} s without renewal) during trial of "${lease.testProfile}"; restoring "${lease.restoreProfile}"`);
    let last = "error";
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const now = readLease(leaseFile);
      // The plugin came back and renewed, or ended the trial itself.
      if (!now || !now.active || Date.now() - now.renewedTs <= now.ttlMs) {
        log("plugin renewed or ended the trial meanwhile; nothing to do");
        restoring = false;
        return;
      }
      last = await setProfile(lease.host, lease.port, lease.restoreProfile);
      if (last === "ok" || last === "missing") break;
      log(`attempt ${i + 1}: ${last}`);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
    const cur = readLease(leaseFile) ?? lease;
    if (last === "ok") {
      writeLease(leaseFile, { ...cur, active: false, restoredTs: Date.now(), restoredBy: "watchdog" });
      log(`restored "${lease.restoreProfile}"`);
    } else {
      writeLease(leaseFile, { ...cur, restoreError: last });
      log(`could not restore "${lease.restoreProfile}": ${last}${last === "missing" ? " (profile no longer exists)" : ""}`);
    }
    restoring = false;
  };

  setInterval(() => {
    if (restoring) return;
    const lease = readLease(leaseFile);
    const now = Date.now();
    if (lease && lease.active && !lease.restoreError) {
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
