// Rev707: pypilot on a machine that is not a TinyPilot.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { isLocalPypilotHost, defaultSshUser, pypilotRestartCommand } from "../pypilot-host";

describe("pypilot-host: is pypilot on this Signal K machine (Rev707)", () => {
  it("localhost and loopback are local", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "127.0.1.1", "::1"]) assert.equal(isLocalPypilotHost(h, []), true, h);
  });
  it("an address that resolved to this machine is local", () => {
    assert.equal(isLocalPypilotHost("openplotter.local", ["192.168.1.20", "127.0.0.1", "::1"]), true);
  });
  it("a TinyPilot on the LAN is not, nor an empty host", () => {
    assert.equal(isLocalPypilotHost("192.168.1.115", ["192.168.1.115"]), false);
    assert.equal(isLocalPypilotHost("", []), false);
  });
  it("default SSH user: tc on a TinyPilot, pi here", () => {
    assert.equal(defaultSshUser(false), "tc");
    assert.equal(defaultSshUser(true), "pi");
  });
});

// Runs the generated command in a shell with fake sv / systemctl / sudo on
// the PATH, to see which branch runs and what it exits with.
function runWith(fakes: Record<string, string>, which: "all" | "web", runitDir: boolean): { code: number; out: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs"), os = require("os"), path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pnu-host-"));
  for (const [name, body] of Object.entries(fakes)) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  let cmd = pypilotRestartCommand(which);
  if (!runitDir) cmd = cmd.replace("[ -d /etc/sv/pypilot ]", "false");
  else cmd = cmd.replace("[ -d /etc/sv/pypilot ]", "true");
  try {
    const out = execFileSync("sh", ["-c", cmd], { env: { PATH: `${dir}:/usr/bin:/bin` }, encoding: "utf8" });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout || "") };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// POSIX only: on Windows there is no real sh with these fakes (CI runs Linux).
const hasSh = process.platform !== "win32";

describe("pypilot-host: restart command (Rev707)", { skip: !hasSh && "needs a POSIX sh" }, () => {
  const sudo = 'shift 0; "$@"';
  it("systemd: restarts only the running units and says so", () => {
    const r = runWith({
      sudo,
      systemctl: 'if [ "$1" = is-active ]; then [ "$3" = pypilot ] || [ "$3" = pypilot_web ]; exit $?; fi; echo "systemctl $*"',
    }, "all", false);
    assert.equal(r.code, 0);
    assert.match(r.out, /restarted pypilot\b/);
    assert.match(r.out, /restarted pypilot_web/);
    assert.doesNotMatch(r.out, /pypilot_boatimu|pypilot_hat/);
  });
  it("systemd with no pypilot running: fails instead of claiming a restart", () => {
    const r = runWith({ sudo, systemctl: 'if [ "$1" = is-active ]; then exit 3; fi' }, "all", false);
    assert.equal(r.code, 3);
    assert.match(r.out, /no pypilot service is running/);
  });
  it("systemd restart that fails: non-zero", () => {
    const r = runWith({ sudo, systemctl: 'if [ "$1" = is-active ]; then exit 0; fi; exit 5' }, "web", false);
    assert.equal(r.code, 1);
  });
  it("runit (TinyPilot): uses sv as before", () => {
    const r = runWith({ sudo, sv: 'echo "sv $*"', pkill: "exit 0", sleep: "exit 0" }, "all", true);
    assert.equal(r.code, 0);
    assert.match(r.out, /sv restart \/etc\/sv\/pypilot /);
  });
});
