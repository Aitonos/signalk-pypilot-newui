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
    g.begin({ restoreProfile: "Ceñida fondo", testProfile: "tune-x", reason: "test" });
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
    g.begin({ restoreProfile: "gone", testProfile: "tune-x" });
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
});
