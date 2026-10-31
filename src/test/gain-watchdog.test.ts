import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

import { GainGuard } from "../gain-guard";
import { jsonAscii } from "../gain-watchdog";

const SCRIPT = path.join(__dirname, "..", "gain-watchdog.js");

/** Minimal pypilot TCP server: answers watches with profiles / profile
 *  and switches profile on `profile=...`. */
function fakePypilot(profiles: string[], active: string) {
  const state = { active, sets: [] as string[] };
  const socks = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => { /* silent */ });
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line.startsWith("watch=")) {
          sock.write(`profiles=${JSON.stringify(profiles)}\n`);
          sock.write(`profile=${JSON.stringify(state.active)}\n`);
        } else if (line.startsWith("profile=")) {
          const v = JSON.parse(line.slice(8));
          state.sets.push(v);
          state.active = v;
          for (const s of socks) s.write(`profile=${JSON.stringify(v)}\n`);
        }
      }
    });
  });
  return new Promise<{ port: number; state: typeof state; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: (server.address() as net.AddressInfo).port, state,
      close: () => { for (const s of socks) s.destroy(); server.close(); },
    }));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(100); }
  return fn();
}

function killWatchdog(dir: string): void {
  try { process.kill(parseInt(fs.readFileSync(path.join(dir, "watchdog.pid"), "utf8"), 10), "SIGTERM"); } catch { /* silent */ }
}

describe("gain watchdog (Rev571)", () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) killWatchdog(d); });

  it("escapes non-ASCII profile names", () => {
    assert.equal(jsonAscii("Ceñida 18"), '"Ce\\u00f1ida 18"');
    assert.equal(JSON.parse(jsonAscii("Ceñida 18")), "Ceñida 18");
  });

  it("restores the original profile when the plugin stops renewing", async () => {
    const pp = await fakePypilot(["Ceñida fondo", "tune-x"], "tune-x");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-")); dirs.push(dir);
    const g = new GainGuard({ dir, host: "127.0.0.1", port: pp.port, ttlMs: 1500, renewMs: 300, scriptPath: SCRIPT });
    await g.begin({ restoreProfile: "Ceñida fondo", testProfile: "tune-x", reason: "test" });
    await wait(2500);
    assert.deepEqual(pp.state.sets, [], "renewing: nothing restored");
    g.stop();   // plugin frozen
    const ok = await until(() => pp.state.active === "Ceñida fondo", 8000);
    assert.ok(ok, "watchdog switched back");
    assert.ok(await until(() => g.status().lease?.restoredBy === "watchdog", 3000));
    assert.equal(g.status().lease?.active, false);
    pp.close();
  });

  it("does not create a profile that no longer exists", async () => {
    const pp = await fakePypilot(["tune-x"], "tune-x");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-")); dirs.push(dir);
    const g = new GainGuard({ dir, host: "127.0.0.1", port: pp.port, ttlMs: 1000, renewMs: 300, scriptPath: SCRIPT });
    await g.begin({ restoreProfile: "gone", testProfile: "tune-x" });
    g.stop();
    assert.ok(await until(() => g.status().lease?.restoreError === "missing", 8000));
    assert.deepEqual(pp.state.sets, []);
    pp.close();
  });

  it("an unfinished trial found at start is restored", async () => {
    const pp = await fakePypilot(["base", "tune-y"], "tune-y");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-")); dirs.push(dir);
    fs.writeFileSync(path.join(dir, "lease.json"), JSON.stringify({
      active: true, restoreProfile: "base", testProfile: "tune-y", host: "127.0.0.1", port: pp.port,
      renewedTs: Date.now() - 60_000, ttlMs: 1000,
    }));
    const g = new GainGuard({ dir, host: "127.0.0.1", port: pp.port, scriptPath: SCRIPT });
    assert.equal(g.recoverOnStart(), true);
    assert.ok(await until(() => pp.state.active === "base", 8000));
    pp.close();
  });
  it("B03: does not override a profile the sailor chose during the outage", async () => {
    const pp = await fakePypilot(["base", "tune-z", "Mi elección"], "Mi elección");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-")); dirs.push(dir);
    fs.writeFileSync(path.join(dir, "lease.json"), JSON.stringify({
      active: true, restoreProfile: "base", testProfile: "tune-z", host: "127.0.0.1", port: pp.port,
      renewedTs: Date.now() - 60_000, ttlMs: 1000,
    }));
    const g = new GainGuard({ dir, host: "127.0.0.1", port: pp.port, scriptPath: SCRIPT });
    g.recoverOnStart();
    assert.ok(await until(() => !!g.status().lease?.restoreSkipped, 8000));
    assert.deepEqual(pp.state.sets, []);
    assert.equal(g.status().lease?.active, false);
    pp.close();
  });

  it("A10: keeps retrying after connection failures and restores once pypilot is back", async () => {
    // Reserve a port, close it: the first attempts are refused.
    const probe = net.createServer(); await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
    const port = (probe.address() as net.AddressInfo).port; await new Promise<void>((r) => probe.close(() => r()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-")); dirs.push(dir);
    fs.writeFileSync(path.join(dir, "lease.json"), JSON.stringify({
      active: true, restoreProfile: "base", testProfile: "tune-w", host: "127.0.0.1", port,
      renewedTs: Date.now() - 60_000, ttlMs: 1000,
    }));
    const g = new GainGuard({ dir, host: "127.0.0.1", port, scriptPath: SCRIPT });
    g.recoverOnStart();
    assert.ok(await until(() => !!g.status().lease?.lastAttemptError, 8000), "a failed attempt recorded");
    assert.equal(g.status().lease?.active, true, "still pending, not given up");
    // pypilot comes back on the same port.
    const state = { active: "tune-w", sets: [] as string[] };
    const srv = net.createServer((sock) => {
      sock.setEncoding("utf8"); let buf = "";
      sock.on("error", () => { /* */ });
      sock.on("data", (d: string) => {
        buf += d; let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.startsWith("watch=")) { sock.write(`profiles=${JSON.stringify(["base", "tune-w"])}\n`); sock.write(`profile=${JSON.stringify(state.active)}\n`); }
          else if (line.startsWith("profile=")) { state.active = JSON.parse(line.slice(8)); state.sets.push(state.active); sock.write(`profile=${JSON.stringify(state.active)}\n`); }
        }
      });
    });
    await new Promise<void>((r) => srv.listen(port, "127.0.0.1", () => r()));
    assert.ok(await until(() => state.active === "base", 25_000), "restored after the outage");
    srv.close();
  });
});

describe("gain watchdog (Rev580, GPT re-audit R02/R04)", () => {
  const dirs: string[] = [];
  after(() => { for (const d of dirs) killWatchdog(d); });

  it("R02: a restore of an old trial never disarms a newer one", async () => {
    // pypilot answers slowly, so a new trial starts while the old restore waits.
    const state = { active: "tune-old" };
    const srv = net.createServer((sock) => {
      sock.setEncoding("utf8"); let buf = "";
      sock.on("error", () => { /* */ });
      sock.on("data", (d: string) => {
        buf += d; let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.startsWith("watch=")) setTimeout(() => {
            sock.write(`profiles=${JSON.stringify(["A", "tune-old", "B", "tune-new"])}\n`);
            sock.write(`profile=${JSON.stringify(state.active)}\n`);
          }, 1500);
          else if (line.startsWith("profile=")) { state.active = JSON.parse(line.slice(8)); sock.write(`profile=${JSON.stringify(state.active)}\n`); }
        }
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as net.AddressInfo).port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-")); dirs.push(dir);
    const leaseFile = path.join(dir, "lease.json");
    fs.writeFileSync(leaseFile, JSON.stringify({
      id: "old", active: true, restoreProfile: "A", testProfile: "tune-old", host: "127.0.0.1", port,
      renewedTs: Date.now() - 60_000, ttlMs: 1000,
    }));
    const g = new GainGuard({ dir, host: "127.0.0.1", port, scriptPath: SCRIPT });
    g.recoverOnStart();
    // the watchdog has started the old restore; a new trial takes the lease
    assert.ok(await until(() => fs.existsSync(path.join(dir, "watchdog.log"))
      && fs.readFileSync(path.join(dir, "watchdog.log"), "utf8").includes("restoring"), 6000));
    fs.writeFileSync(leaseFile, JSON.stringify({
      id: "new", active: true, restoreProfile: "B", testProfile: "tune-new", host: "127.0.0.1", port,
      renewedTs: Date.now() + 60_000, ttlMs: 60_000,
    }));
    await wait(3000);
    const l = JSON.parse(fs.readFileSync(leaseFile, "utf8"));
    assert.equal(l.id, "new");
    assert.equal(l.active, true, "the new trial is still protected");
    srv.close();
  });

  it("R04: a watchdog that dies during a trial is started again", async () => {
    const pp = await fakePypilot(["A", "T"], "T");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-")); dirs.push(dir);
    const g = new GainGuard({ dir, host: "127.0.0.1", port: pp.port, ttlMs: 30_000, renewMs: 300, scriptPath: SCRIPT });
    const armed = await g.begin({ restoreProfile: "A", testProfile: "T" });
    assert.equal(armed.ok, true);
    const pid1 = g.status().watchdogPid!;
    process.kill(pid1, "SIGTERM");
    assert.ok(await until(() => { const s = g.status(); return s.watchdogAlive && s.watchdogPid !== pid1; }, 8000), "restarted");
    g.end();
    pp.close();
  });
});

describe("gain guard (Rev583, self-audit)", () => {
  it("with allowWrites off an unfinished trial is reported, not restored", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
    fs.writeFileSync(path.join(dir, "lease.json"), JSON.stringify({
      id: "x", active: true, restoreProfile: "A", testProfile: "T", host: "127.0.0.1", port: 1, renewedTs: 0, ttlMs: 1000,
    }));
    const g = new GainGuard({ dir, host: "127.0.0.1", port: 1, scriptPath: SCRIPT });
    assert.equal(g.recoverOnStart(false), false);
    assert.equal(g.status().watchdogPid, null, "no watchdog started");
  });
});
