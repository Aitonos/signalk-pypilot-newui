// Rev727: diagnostic report - nothing personal leaves, and the access
// verdict says why pypilot cannot write to Signal K.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { maskIp, maskHost, sanitizeConfig, accessReport, DiagRing } from "../diagnostic";

describe("diagnostic report (Rev727)", () => {
  it("keeps local addresses and masks public ones", () => {
    assert.equal(maskIp("::ffff:192.168.1.115"), "192.168.1.115");
    assert.equal(maskIp("10.10.10.1"), "10.10.10.1");
    assert.equal(maskIp("100.127.222.27"), "100.127.222.27", "Tailscale range stays");
    assert.equal(maskIp("172.20.0.4"), "172.20.0.4");
    assert.equal(maskIp("83.45.120.7"), "83.45.x.x");
    assert.equal(maskIp(""), null);
    assert.equal(maskHost("tinypilot.local"), "tinypilot.local");
    assert.equal(maskHost("openplotter"), "openplotter");
    assert.equal(maskHost("myboat.example.com"), "XXXX");
  });

  it("removes secrets from the settings, at any depth", () => {
    const out = sanitizeConfig({
      host: "192.168.1.115",
      sshPassword: "hunter2",
      sshUser: "pi",
      adminPinHash: "abc",
      telegram: { botToken: "123:xyz", chatId: 5 },
      allowWrites: true,
      empty: { sshPassword: "" },
    }) as Record<string, any>;
    assert.equal(out.host, "192.168.1.115");
    assert.equal(out.sshPassword, "XXXX");
    assert.equal(out.sshUser, "pi");
    assert.equal(out.adminPinHash, "XXXX");
    assert.equal(out.telegram.botToken, "XXXX");
    assert.equal(out.telegram.chatId, 5);
    assert.equal(out.allowWrites, true);
    assert.equal(out.empty.sshPassword, "", "an empty secret says it is not set");
    const geo = sanitizeConfig({ zones: [{ latitude: 42.27555, longitude: -8.73608, geometry: { type: "Polygon" } }] }) as any;
    assert.deepEqual(geo.zones[0], { latitude: 42.3, longitude: -8.7, geometry: "XXXX" });
  });

  const base = {
    securityOn: true, canControl: true, autoApprove: true, pypilotUid: "pypilot-123",
    devices: [], pending: [], hostIps: ["192.168.1.115"],
  };

  it("says read/write when pypilot's own device is", () => {
    const r = accessReport({ ...base, devices: [
      { clientId: "pypilot-999", description: "pypilot", permissions: "readonly" },
      { clientId: "pypilot-123", description: "pypilot", permissions: "readwrite" },
    ] });
    assert.equal(r.verdict, "ok");
    assert.deepEqual(r.device, { clientId: "pypilot-123", permissions: "readwrite" });
    assert.equal(r.pypilotDevices.length, 2, "every pypilot device is listed");
  });

  it("tells a request from another address apart from one on its way", () => {
    const fromTp = accessReport({ ...base, pending: [
      { accessIdentifier: "pypilot-123", accessDescription: "pypilot", ip: "::ffff:192.168.1.115", state: "PENDING" },
    ] });
    assert.equal(fromTp.verdict, "pending");
    const other = accessReport({ ...base, pending: [
      { accessIdentifier: "pypilot-123", accessDescription: "pypilot", ip: "::ffff:192.168.1.50", state: "PENDING" },
    ] });
    assert.equal(other.verdict, "pendingOtherIp");
    assert.deepEqual(other.pending, [{ clientId: "pypilot-123", ip: "192.168.1.50", fromTinypilot: false }]);
  });

  it("says read only, no device, no control, no security", () => {
    const ro = [{ clientId: "pypilot-123", description: "pypilot", permissions: "readonly" }];
    assert.equal(accessReport({ ...base, devices: ro }).verdict, "readOnly");
    assert.equal(accessReport(base).verdict, "noDevice");
    assert.equal(accessReport({ ...base, devices: ro, canControl: false }).verdict, "noControl");
    assert.equal(accessReport({ ...base, devices: ro, autoApprove: false }).verdict, "autoApproveOff");
    assert.equal(accessReport({ ...base, securityOn: false }).verdict, "noSecurity");
  });

  it("without pypilot's id, any pypilot-<digits> device counts", () => {
    const r = accessReport({ ...base, pypilotUid: null, devices: [
      { clientId: "pypilot-5", description: "pypilot", permissions: "readwrite" },
    ] });
    assert.equal(r.verdict, "ok");
  });

  it("keeps the last lines only", () => {
    const ring = new DiagRing(3);
    for (let n = 0; n < 5; n++) ring.add("t", `m${n}`, n);
    assert.deepEqual(ring.list().map((l) => l.msg), ["m2", "m3", "m4"]);
  });
});
