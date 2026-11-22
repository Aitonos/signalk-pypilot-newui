import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseConf, mergePypilotConf, mergeNetworking, mergeNetworkingClient, mergeHatConf, mergeSmallFile,
  leftoverFiles, mergeOnboot, mergeShadow, groupOf, isNeverKey, DEFAULT_GROUPS, SK_FIX_TCZ, Groups,
} from "../tinypilot-migrate";

// A new image that still carries its previous owner's settings (as Sean's
// 0.71 does) and a boat backup from an older pypilot.
const IMAGE = [
  'profile="default"',
  'profiles=["default","absolute_test"]',
  'signalk.uid="pypilot"',
  "imu.alignmentQ=[0.47, 0.55, 0.48, -0.47]",
  "imu.heading_offset=-90.0000",
  "imu.accel.calibration=[[0.1, 0.2, 0.3, 1.0], [0.0, 0.0]]",
  "imu.gyrobias=[1.0, 2.0, 3.0]",
  "rudder.range=15.0000",
  "servo.max_current=3.3000",
  "servo.faults=113",
  "wind.offset=0.0000",
  "wind.rate=4.0000",
  '[profile="default"]',
  "ap.pilot.basic.P=0.0051",
  "ap.pilot.basic.D=0.0343",
  '[profile="absolute_test"]',
  "ap.pilot.basic.P=0.0051",
].join("\n");
const BOAT = [
  'profile="Stellian"',
  'profiles=["default","Stellian"]',
  'signalk.uid="pypilot-1234"',
  "imu.alignmentQ=[0.03, -0.02, -0.69, -0.71]",
  "imu.heading_offset=-175.0000",
  "imu.accel.calibration=[[0.003, -0.018, 0.016, 1.007], [0.008, 0.0]]",
  "imu.accel.calibration.locked=true",
  "imu.gyrobias=[-0.6, -0.6, 0.4]",
  "imu.compass.calibration.points=[[1, 2, 3]]",
  "rudder.range=50.0000",
  "servo.max_current=5.8700",
  "servo.amp_hours=16.45",
  "wind.offset=3.0000",
  "ap.tack.count=26",
  "some.old.key=1",
  '[profile="default"]',
  "ap.pilot.basic.P=0.0027",
  "ap.pilot.simple.P=0.0050",
  '[profile="Stellian"]',
  "ap.pilot.basic.P=0.0022",
  '[profile="deleted_one"]',
  "ap.pilot.basic.P=0.9",
].join("\n");

const g = (over: Partial<Groups> = {}): Groups => ({ ...DEFAULT_GROUPS, ...over });
const val = (text: string, key: string) => parseConf(text).global.find((l) => l.key === key)?.raw;

describe("tinypilot-migrate - pypilot.conf (Rev735)", () => {
  it("groups and never-keys", () => {
    assert.equal(groupOf("imu.alignmentQ"), "imu");
    assert.equal(groupOf("servo.max_current"), "motor");
    assert.equal(groupOf("rudder.range"), "motor");
    assert.equal(groupOf("wind.offset"), "sensors");
    assert.equal(groupOf("imu.gyrobias"), null);
    assert.ok(isNeverKey("imu.compass.calibration.points") && isNeverKey("servo.amp_hours") && isNeverKey("ap.tack.count"));
  });
  it("the boat's values replace the image's; never-keys and the previous owner's counters are removed", () => {
    const m = mergePypilotConf(IMAGE, BOAT, g({ imu: true }));
    assert.equal(val(m.text, "imu.alignmentQ"), "[0.03, -0.02, -0.69, -0.71]");
    assert.equal(val(m.text, "rudder.range"), "50.0000");
    assert.equal(val(m.text, "servo.max_current"), "5.8700");
    assert.equal(val(m.text, "wind.offset"), "3.0000");
    assert.equal(val(m.text, "wind.rate"), "4.0000", "a key only the new version has stays");
    for (const k of ["imu.gyrobias", "servo.faults", "servo.amp_hours", "ap.tack.count", "imu.compass.calibration.points"]) assert.equal(val(m.text, k), undefined, k);
    assert.equal(val(m.text, "imu.accel.calibration.locked"), "true");
    assert.ok(m.warnings.some((w) => /locked/.test(w)));
    assert.deepEqual(m.notCarried, ["some.old.key"]);
  });
  it("IMU and motor not ticked: the previous owner's calibration is removed, not kept", () => {
    const m = mergePypilotConf(IMAGE, BOAT, g({ imu: false, motor: false }));
    for (const k of ["imu.alignmentQ", "imu.heading_offset", "imu.accel.calibration", "rudder.range", "servo.max_current"]) assert.equal(val(m.text, k), undefined, k);
    assert.equal(val(m.text, "wind.offset"), "3.0000");
  });
  it("sensors not ticked: the image's value stays", () => {
    const m = mergePypilotConf(IMAGE, BOAT, g({ sensors: false }));
    assert.equal(val(m.text, "wind.offset"), "0.0000");
  });
  it("profiles: the boat's active ones replace the image's; unknown gains and deleted profiles left out", () => {
    const m = mergePypilotConf(IMAGE, BOAT, g());
    const c = parseConf(m.text);
    assert.deepEqual(c.sections.map((s) => s.name), ["default", "Stellian"]);
    assert.equal(val(m.text, "profile"), '"Stellian"');
    assert.equal(val(m.text, "profiles"), '["default","Stellian"]');
    assert.deepEqual(m.droppedProfileKeys, ["ap.pilot.simple.P"]);
    assert.equal(c.sections[0].lines.find((l) => l.key === "ap.pilot.basic.P")?.raw, "0.0027");
  });
  it("signalk.uid only with the signalk group", () => {
    assert.equal(val(mergePypilotConf(IMAGE, BOAT, g()).text, "signalk.uid"), '"pypilot"');
    assert.equal(val(mergePypilotConf(IMAGE, BOAT, g({ signalk: true })).text, "signalk.uid"), '"pypilot-1234"');
  });
  it("output is readable by the same parser, nothing unreadable", () => {
    const m = mergePypilotConf(IMAGE, BOAT, g({ imu: true }));
    assert.equal(parseConf(m.text).bad.length, 0);
  });
  it("no pypilot.conf in the image: built from the boat's values, with a warning", () => {
    const m = mergePypilotConf(null, BOAT, g({ imu: true }));
    assert.equal(val(m.text, "rudder.range"), "50.0000");
    assert.ok(m.warnings.some((w) => /no pypilot\.conf/.test(w)));
  });
});

describe("tinypilot-migrate - other files (Rev735)", () => {
  const NET_IMG = "mode=Master\nssid=pypilot\nkey=\nclient_ssid=lastgasp\nclient_key=12345678\nclient_address=\n";
  const NET_BOAT = "mode=Master+Managed\nssid=pypilot\nkey=\nclient_ssid=TUNATUNES\nclient_key=secret\nclient_address=\n";
  it("wifi: same format merged, the previous owner's network gone", () => {
    const r = mergeNetworking(NET_IMG, NET_BOAT);
    assert.equal(r.action, "merge");
    assert.match(r.text!, /client_ssid=TUNATUNES/);
    assert.ok(!/lastgasp|12345678/.test(r.text!));
  });
  it("wifi: unknown format on either side is skipped, never guessed", () => {
    assert.equal(mergeNetworking("[wifi]\nssid=x", NET_BOAT).action, "skip");
    assert.equal(mergeNetworking(NET_IMG, "garbage").action, "skip");
    assert.equal(mergeNetworking(NET_IMG, null).action, "skip");
    assert.equal(mergeNetworking(null, NET_BOAT).action, "copy");
  });
  it("client copy of the wifi rewritten with the boat's network", () => {
    const r = mergeNetworkingClient("mode=Managed\nclient_ssid=lastgasp\nclient_key=12345678\nclient_address=10.42.0.2\n", NET_BOAT);
    assert.match(r.text!, /^mode=Managed\nclient_ssid=TUNATUNES\nclient_key=secret\n/);
  });
  it("hat.conf: remote codes and display from the boat, hardware from the image", () => {
    const r = mergeHatConf(JSON.stringify({ host: "localhost", actions: { "+1": ["rfOLD"] }, lcd: { contrast: 60, language: "en" }, hat: { mpu: { driver: "new" } } }),
      JSON.stringify({ actions: { "+1": ["rfBOAT"] }, lcd: { contrast: 49 }, hat: { mpu: { driver: "old" } } }));
    const o = JSON.parse(r.text!);
    assert.deepEqual(o.actions, { "+1": ["rfBOAT"] });
    assert.equal(o.lcd.contrast, 49);
    assert.equal(o.lcd.language, "en");
    assert.equal(o.hat.mpu.driver, "new");
    assert.equal(mergeHatConf(null, "{}").action, "skip");
  });
  it("small files only when the new image still has them", () => {
    assert.equal(mergeSmallFile("servodevice", '["/dev/ttyAMA0",38400]', '["/dev/ttyAMA0",38400]').action, "copy");
    assert.equal(mergeSmallFile("gpsd_baud_hint", null, "4800").action, "skip");
    assert.equal(mergeSmallFile("servodevice", "not json", '["/dev/ttyAMA0",38400]').action, "skip");
    assert.equal(mergeSmallFile("RTIMULib.ini", "x", "y").action, "skip");
  });
  it("leftovers of the image's previous owner", () => {
    assert.deepEqual(leftoverFiles([".pypilot_conf.k_c4", "pypilot.conf", "pypilot.conf~", "networking.txt~", "persist_fail", "pypilot.conf.restore", "hat.conf.bak", "hat.conf", "pypilot.conf.bak"]),
      [".pypilot_conf.k_c4", "pypilot.conf~", "networking.txt~", "persist_fail", "pypilot.conf.restore", "hat.conf.bak"]);
  });
  it("onboot.lst: adds the Signal K packages the image carries, once", () => {
    const r = mergeOnboot("\npython3.11-wheel.tcz\navahi.tcz\n", [...SK_FIX_TCZ, "other.tcz"]);
    assert.deepEqual(r.added, SK_FIX_TCZ);
    assert.ok(r.text.startsWith("python3.11-wheel.tcz\navahi.tcz\n"));
    assert.deepEqual(mergeOnboot(r.text, SK_FIX_TCZ).added, []);
    assert.deepEqual(mergeOnboot("avahi.tcz\n", []).added, []);
  });
  it("shadow: only a real tc hash replaces the image's tc line", () => {
    const img = "root:*:1:0:99999:7:::\ntc:$6$x$y:1:0:99999:7:::\n";
    const r = mergeShadow(img, "tc:$6$boat$hash:19000:0:99999:7:::");
    assert.match(r.text!, /^root:\*.*\ntc:\$6\$boat\$hash:19000/);
    assert.equal(mergeShadow(img, "tc:!:1::::::").action, "skip");
    assert.equal(mergeShadow("root:*:1:::\n", "tc:$6$a$b:1::::::").action, "skip");
  });
});

describe("tinypilot-image - damaged file system detection (Rev736)", () => {
  it("recognises debugfs failing to open an inconsistent image", () => {
    const { fsNotOpen } = require("../tinypilot-image");
    assert.ok(fsNotOpen("x.img?offset=1: Block bitmap checksum does not match bitmap while reading allocation bitmaps\nls: Filesystem not open"));
    assert.ok(!fsNotOpen("debugfs 1.47.0 (5-Feb-2023)\n"));
  });
});
