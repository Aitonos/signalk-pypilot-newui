// Rev664: route access levels (Signal K >= 2.31) and the visor's own options.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeAccessLevel, accessScopedRouter, visorOptionsPatch } from "../route-access";

describe("route access levels (Rev664)", () => {
  it("reads readonly, data files readwrite, writes readwrite, the SSH shell admin", () => {
    assert.equal(routeAccessLevel("GET", "/status"), "readonly");
    assert.equal(routeAccessLevel("GET", "/backup/download/:name"), "readwrite");
    assert.equal(routeAccessLevel("GET", "/config/export"), "readwrite");
    assert.equal(routeAccessLevel("GET", "/log-capture/tail"), "readwrite");
    assert.equal(routeAccessLevel("GET", "/black-box/incident/:id"), "readwrite");
    assert.equal(routeAccessLevel("GET", "/scan"), "readwrite", "probes the LAN");
    assert.equal(routeAccessLevel("GET", "/tinypilot/folders"), "readwrite", "folder names");
    assert.equal(routeAccessLevel("POST", "/ap/engage"), "readwrite");
    assert.equal(routeAccessLevel("PUT", "/raw"), "readwrite");
    assert.equal(routeAccessLevel("POST", "/ssh-exec"), "admin");
  });

  it("declares each route through router.access when the server has it", () => {
    const calls: string[] = [];
    const router: any = {
      get: (p: string) => calls.push(`plain GET ${p}`),
      post: (p: string) => calls.push(`plain POST ${p}`),
      put: () => {}, patch: () => {}, delete: () => {},
      access: (level: string) => ({
        get: (p: string) => calls.push(`${level} GET ${p}`),
        post: (p: string) => calls.push(`${level} POST ${p}`),
      }),
    };
    const r = accessScopedRouter(router);
    r.get("/status", () => {});
    r.post("/ap/engage", () => {});
    r.post("/ssh-exec", () => {});
    assert.deepEqual(calls, ["readonly GET /status", "readwrite POST /ap/engage", "plain POST /ssh-exec"]);
  });

  it("leaves an older server's router as it is", () => {
    const router: any = { get: () => {}, post: () => {} };
    assert.equal(accessScopedRouter(router), router);
  });
});

describe("visor options (Rev664)", () => {
  it("nudge steps need no PIN and no restart", () => {
    const p = visorOptionsPatch({ nudgeSmall: 1, nudgeBig: 10 });
    assert.ok(p.ok);
    assert.equal(p.technical, false);
    assert.equal(p.restart, false);
  });
  it("connection needs the PIN and restarts the plugin", () => {
    const p = visorOptionsPatch({ host: " 192.168.1.115 ", port: 80 });
    assert.ok(p.ok);
    assert.deepEqual(p.patch, { host: "192.168.1.115", port: 80 });
    assert.equal(p.technical, true);
    assert.equal(p.restart, true);
  });
  it("refuses unknown keys and bad values - nothing else can be written", () => {
    assert.equal(visorOptionsPatch({ allowWrites: true }).ok, false);
    assert.equal(visorOptionsPatch({ adminPinReset: true }).ok, false);
    assert.equal(visorOptionsPatch({ port: 70000 }).ok, false);
    assert.equal(visorOptionsPatch({ host: "a b" }).ok, false);
    assert.equal(visorOptionsPatch({}).ok, false);
  });
  it("options moved from the Signal K admin (Rev676)", () => {
    const a = visorOptionsPatch({ pypilotAutoApprove: false });
    assert.deepEqual(a.patch, { pypilotAutoApprove: false });
    assert.equal(a.technical, true);
    assert.equal(a.restart, false);
    const s = visorOptionsPatch({ sessionRecorderEnabled: true });
    assert.equal(s.ok, true);
    assert.equal(s.technical, false);
    const l = visorOptionsPatch({ logCaptureIntervalSec: 120.4 });
    assert.deepEqual(l.patch, { logCaptureIntervalSec: 120 });
    assert.equal(l.technical, true);
    assert.equal(visorOptionsPatch({ logCaptureIntervalSec: 10 }).ok, false);
    assert.equal(visorOptionsPatch({ pypilotAutoApprove: "yes" }).ok, false);
    const h = visorOptionsPatch({ headingFallback: false });   // Rev698
    assert.deepEqual(h.patch, { headingFallback: false });
    assert.equal(h.technical, true);
    assert.equal(visorOptionsPatch({ headingFallback: 1 }).ok, false);
  });
});
