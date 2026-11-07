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
    assert.equal(path.basename(backupDir("/home/pi")), "Backups-pypilot-newui");
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
