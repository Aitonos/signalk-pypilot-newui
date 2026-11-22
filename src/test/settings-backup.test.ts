// Rev650: daily settings backup in a visible folder.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeBackup, listBackups, dayName, stripSecrets, parseTinypilotFiles, TINYPILOT_MARK, isBackupName, backupDir } from "../settings-backup";
import { captureBundle } from "../config-backup";

describe("settings backup (Rev650)", () => {
  it("one file per day, readable JSON, the newest 30 kept", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bk-")), "Backups-pypilot-newui");
    for (let d = 1; d <= 33; d++) writeBackup(dir, new Date(2026, 9, d, 3, 0, 0), { day: d });
    writeBackup(dir, new Date(2026, 10, 2, 22, 0, 0), { day: "again" });   // same day replaced
    const list = listBackups(dir);
    assert.equal(list.length, 30);
    assert.equal(list[0].name, "pypilot-newui-2026-11-02.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, list[0].name), "utf8")), { day: "again" });
    assert.ok(!list.some((f) => f.name === "pypilot-newui-2026-10-03.json"), "oldest gone");
    assert.ok(list.some((f) => f.name === "pypilot-newui-2026-10-04.json"), "30th kept");
    assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith(".tmp")));
  });

  it("names and folder", () => {
    assert.equal(dayName(new Date(2026, 10, 7)), "pypilot-newui-2026-11-07.json");
    assert.ok(isBackupName("pypilot-newui-2026-11-07.json"));
    assert.ok(!isBackupName("../../etc/passwd"));
    assert.equal(path.basename(backupDir("/srv/crew")), "Backups-pypilot-newui");
  });

  it("the SSH password never reaches a backup or the config export", () => {
    assert.equal("sshPassword" in stripSecrets({ host: "x", sshPassword: "secret" }), false);
    const b = captureBundle({ revision: "t", props: { host: "x", sshPassword: "secret" }, catalog: {}, values: {} });
    assert.equal("sshPassword" in b.pluginOptions, false);
  });

  it("parses the TinyPilot files, skipping missing and unknown ones", () => {
    const out = [
      `${TINYPILOT_MARK}pypilot.conf`, 'profile="A"', "ap.pilot.basic.P=0.003",
      `${TINYPILOT_MARK}hat.conf`,
      `${TINYPILOT_MARK}signalk-token`, "SECRET",
      `${TINYPILOT_MARK}servodevice`, "/dev/ttyAMA0\r",
    ].join("\n");
    const f = parseTinypilotFiles(out);
    assert.deepEqual(Object.keys(f).sort(), ["pypilot.conf", "servodevice"]);
    assert.equal(f["pypilot.conf"], 'profile="A"\nap.pilot.basic.P=0.003\n');
    assert.equal(f["servodevice"], "/dev/ttyAMA0\n");
  });
});

describe("latest copy in the data dir (Rev663)", () => {
  it("is written atomically inside the plugin's data dir and replaced each time", () => {
    const { writeLatestCopy, LATEST_COPY_NAME } = require("../settings-backup");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bkd-"));
    const f1 = writeLatestCopy(dataDir, { n: 1 });
    writeLatestCopy(dataDir, { n: 2 });
    assert.equal(path.basename(f1), LATEST_COPY_NAME);
    assert.deepEqual(JSON.parse(fs.readFileSync(f1, "utf8")), { n: 2 });
    assert.deepEqual(fs.readdirSync(dataDir), [LATEST_COPY_NAME], "no .tmp left");
  });
});

describe("Rev734: wider TinyPilot copy and host key memory", () => {
  it("copies the wifi, the extra files and the system identity, never DSA keys", () => {
    const { tinypilotCopyCommand, TINYPILOT_FILES, TINYPILOT_SYSTEM_FILES } = require("../settings-backup");
    for (const f of ["networking.txt", "lcddriver", "web.conf", "nmea0device"]) assert.ok(TINYPILOT_FILES.includes(f), f);
    const c: string = tinypilotCopyCommand();
    assert.match(c, /sudo -n grep '\^tc:' \/etc\/shadow/);
    assert.match(c, /ssh_host_ed25519_key/);
    assert.ok(!/dsa_key/.test(c.replace(/ecdsa/g, "")));
    assert.ok(TINYPILOT_SYSTEM_FILES.includes("sys/shadow-tc"));
  });
  it("parses system files and ignores unknown names", () => {
    const out = [`${TINYPILOT_MARK}networking.txt`, "mode=Master+Managed", "client_ssid=boat",
      `${TINYPILOT_MARK}sys/shadow-tc`, "tc:$6$abc$def:19000:0:99999:7:::",
      `${TINYPILOT_MARK}sys/evil`, "nope"].join("\n");
    const f = parseTinypilotFiles(out);
    assert.equal(f["networking.txt"], "mode=Master+Managed\nclient_ssid=boat\n");
    assert.equal(f["sys/shadow-tc"], "tc:$6$abc$def:19000:0:99999:7:::\n");
    assert.equal(f["sys/evil"], undefined);
  });
  it("host key: first seen, same, changed, accepted", () => {
    const { HostKeyMemory } = require("../tinypilot-hostkey");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hk-")), "k.json");
    const m = new HostKeyMemory(file);
    assert.equal(m.observe(Buffer.from("A"), 1), "new");
    assert.equal(m.observe(Buffer.from("A"), 2), "same");
    assert.equal(m.observe(Buffer.from("B"), 3), "changed");
    assert.ok(new HostKeyMemory(file).get().changed);
    m.accept(4);
    assert.equal(m.observe(Buffer.from("B"), 5), "same");
  });
});

describe("Rev734: a file without a final newline does not swallow the next one", () => {
  it("each mark starts on its own line", () => {
    const { tinypilotCopyCommand } = require("../settings-backup");
    const c: string = tinypilotCopyCommand();
    const marks = c.split(`echo "${TINYPILOT_MARK}`).length - 1;
    const withNewline = c.split(`echo; echo "${TINYPILOT_MARK}`).length - 1;
    assert.ok(marks > 10);
    assert.equal(withNewline, marks, "every mark has the newline before it");
    // what the shell prints for "4800" (no newline) followed by the next file
    const out = `\n${TINYPILOT_MARK}gpsd_baud_hint\n4800\n${TINYPILOT_MARK}networking.txt\nmode=Master\n\n`;
    const f = parseTinypilotFiles(out);
    assert.equal(f["gpsd_baud_hint"], "4800\n");
    assert.equal(f["networking.txt"], "mode=Master\n");
  });
});
