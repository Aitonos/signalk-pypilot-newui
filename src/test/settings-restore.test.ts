// Rev668: restore pypilot profiles from a settings backup.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parsePypilotConf, planRestore } from "../settings-restore";

const CONF = [
  "imu.rate=20",
  'nmea.client="192.168.1.104:10110"',
  "imu.heading_offset=-110.0000",
  "ap.pilot.basic.P=0.0030",
  'profile="Ceñida"',
  'profiles=["Ceñida","Popa "]',
  "ap.enabled=true",
  "servo.command=0.5",
  '[profile="Ceñida"]',
  "ap.pilot.basic.P=0.0030",
  "ap.pilot.basic.D=0.0900",
  '[profile="Popa "]',
  "ap.pilot.basic.P=0.0050\r",
  "ap.pilot.basic.D=0.1500",
  "ap.mode=\"wind\"",
  "unknown.key=1",
].join("\n");

const CATALOG: any = {
  "imu.rate": { persistent: true },
  "nmea.client": { persistent: true },
  "imu.heading_offset": { persistent: true },
  "ap.pilot.basic.P": { profiled: true, AutopilotGain: true },
  "ap.pilot.basic.D": { profiled: true, AutopilotGain: true },
  "ap.enabled": {}, "ap.mode": {}, "servo.command": {}, "profile": {}, "profiles": {},
};

describe("settings restore (Rev668)", () => {
  it("reads the global part and every profile section, names exactly (trailing space kept)", () => {
    const c = parsePypilotConf(CONF);
    assert.deepEqual(c.profiles.map((p) => p.name), ["Ceñida", "Popa "]);
    assert.equal(c.profiles[1].values["ap.pilot.basic.P"], 0.005);
    assert.equal(c.global["nmea.client"], "192.168.1.104:10110");
  });

  it("profiles always; orders and unknown keys never; installation only when asked", () => {
    const c = parsePypilotConf(CONF);
    const without = planRestore(c, CATALOG, false);
    assert.deepEqual(without.profiles[1].values, { "ap.pilot.basic.P": 0.005, "ap.pilot.basic.D": 0.15 }, "ap.mode is an order, unknown.key unknown");
    assert.deepEqual(without.installation, {});
    assert.ok(without.skipped.includes("ap.mode") && without.skipped.includes("unknown.key"));
    const withInst = planRestore(c, CATALOG, true);
    assert.deepEqual(withInst.installation, { "nmea.client": "192.168.1.104:10110", "imu.heading_offset": -110 },
      "gains stay per profile; engage, servo commands and *.rate (shared import blocklist) never");
  });

  it("does not bring back deleted profiles, counters or pypilot's Signal K identity", () => {
    const conf = parsePypilotConf([
      'profiles=["A"]',
      "servo.faults=2663", "servo.amp_hours=66.47", "ap.tack.count=177", 'signalk.uid="pypilot-1"', "imu.heading_offset=-110",
      '[profile="A"]', "ap.pilot.basic.P=0.003",
      '[profile="tune-20260909-1949"]', "ap.pilot.basic.P=0.009",
      '[profile="asd"]', "ap.pilot.basic.P=0.1",
    ].join("\n"));
    const cat: any = { ...CATALOG, "servo.faults": {}, "servo.amp_hours": {}, "ap.tack.count": {}, "signalk.uid": {} };
    const plan = planRestore(conf, cat, true);
    assert.deepEqual(plan.profiles.map((p) => p.name), ["A"]);
    assert.deepEqual(plan.staleProfiles, ["tune-20260909-1949", "asd"]);
    assert.deepEqual(plan.installation, { "imu.heading_offset": -110 });
  });
});
