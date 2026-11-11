// Rev659: approve pypilot's Signal K access with read/write, tidy old devices.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { requestsToApprove, pypilotDevicePlan, plainIp, withLocalAliases } from "../pypilot-sk-access";

describe("pypilot Signal K access (Rev659)", () => {
  it("approves only pypilot requests from the TinyPilot's address", () => {
    const pending = [
      { accessIdentifier: "pypilot-86083580620", accessDescription: "pypilot", ip: "::ffff:192.168.1.115", state: "PENDING", type: "accessRequest" },
      { accessIdentifier: "pypilot-11111111111", accessDescription: "pypilot", ip: "::ffff:192.168.1.50", state: "PENDING", type: "accessRequest" },  // another machine
      { accessIdentifier: "kip-1", accessDescription: "KIP", ip: "::ffff:192.168.1.115", state: "PENDING", type: "accessRequest" },
      { accessIdentifier: "pypilot-22", accessDescription: "not pypilot", ip: "::ffff:192.168.1.115", state: "PENDING", type: "accessRequest" },
    ];
    const got = requestsToApprove(pending, ["192.168.1.115"]);
    assert.deepEqual(got.map((r) => r.accessIdentifier), ["pypilot-86083580620"]);
    assert.deepEqual(requestsToApprove(pending, []), [], "no TinyPilot address known: nothing");
  });

  it("keeps the newest pypilot device read/write and removes the rest; never OpenPlotter's or the visor's", () => {
    const plan = pypilotDevicePlan([
      { clientId: "PYPILOT-96c0-44df", description: "OpenPlotter PYPILOT", permissions: "readwrite" },
      { clientId: "pypilot-84025861262", description: "pypilot", permissions: "readwrite" },
      { clientId: "1a97a96b-b004", description: "PyPilot New-UI visor", permissions: "admin" },
      { clientId: "pypilot-05300985196", description: "pypilot", permissions: "readwrite" },
      { clientId: "pypilot-94029094049", description: "pypilot", permissions: "readonly" },
      { clientId: "pypilot-86083580620", description: "pypilot", permissions: "readonly" },
    ]);
    assert.equal(plan.keep, "pypilot-86083580620");
    assert.equal(plan.makeReadWrite, true);
    assert.deepEqual(plan.remove, ["pypilot-84025861262", "pypilot-05300985196", "pypilot-94029094049"]);
  });

  it("nothing to do without pypilot devices", () => {
    assert.deepEqual(pypilotDevicePlan([]), { keep: null, makeReadWrite: false, remove: [] });
    assert.equal(plainIp("::ffff:10.0.0.2"), "10.0.0.2");
  });

  it("pypilot on the Signal K machine: loopback and own addresses count (Rev695, #6)", () => {
    const own = ["127.0.0.1", "10.10.10.100", "::1", "fe80::1"];
    const ips = withLocalAliases(["10.10.10.100"], own);
    for (const ip of ["127.0.0.1", "::1", "10.10.10.100"]) assert.ok(ips.includes(ip), ip);
    const pending = [
      { accessIdentifier: "pypilot-123", accessDescription: "pypilot", ip: "::1", state: "PENDING", type: "accessRequest" },
      { accessIdentifier: "pypilot-456", accessDescription: "pypilot", ip: "::ffff:127.0.0.1", state: "PENDING", type: "accessRequest" },
      { accessIdentifier: "kip-1", accessDescription: "KIP", ip: "::1", state: "PENDING", type: "accessRequest" },
    ];
    assert.deepEqual(requestsToApprove(pending, ips).map((r) => r.accessIdentifier), ["pypilot-123", "pypilot-456"]);
    assert.ok(withLocalAliases(["localhost-resolved", "127.0.0.1"], []).includes("::1"));
    // a separate TinyPilot: nothing added
    assert.deepEqual(withLocalAliases(["192.168.1.115"], own), ["192.168.1.115"]);
  });
});
