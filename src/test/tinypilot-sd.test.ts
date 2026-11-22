// Rev671: TinyPilot SD card image.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sdImageMiB, sdReadCommand, sdImageName, isSdImageName, sdImagesToDrop, sdDestinations } from "../tinypilot-sd";

describe("folder browser bounds (Rev673)", () => {
  it("home, /media and /mnt only - never system folders", () => {
    const { isAllowedFolder } = require("../tinypilot-sd");
    assert.ok(isAllowedFolder("/srv/crew", "/srv/crew"));
    assert.ok(isAllowedFolder("/srv/crew/Backups", "/srv/crew"));
    assert.ok(isAllowedFolder("/media/pi/KINGSTON USB", "/srv/crew"));
    assert.ok(isAllowedFolder("/mnt/nas/boat/", "/srv/crew"));
    assert.ok(!isAllowedFolder("/etc", "/srv/crew"));
    assert.ok(!isAllowedFolder("/srv/crewman", "/srv/crew"), "a prefix is not a parent");
    assert.ok(!isAllowedFolder("/", "/srv/crew"));
    assert.ok(!isAllowedFolder("relative/path", "/srv/crew"));
  });
});

describe("SD image destinations (Rev672)", () => {
  it("default folder plus writable sticks / shares under /media and /mnt only", () => {
    const mounts = [
      "/dev/nvme0n1p2 / ext4 rw,noatime 0 0",
      "/dev/sda1 /media/pi/KINGSTON\\040USB vfat rw,nosuid 0 0",
      "/dev/sdb1 /media/pi/OLD iso9660 ro 0 0",
      "//nas/boat /mnt/nas cifs rw 0 0",
      "tmpfs /mnt/ram tmpfs rw 0 0",
      "/dev/sda2 /boot/firmware vfat rw 0 0",
    ].join("\n");
    const d = sdDestinations(mounts, "/srv/crew/Backups-pypilot-newui", "/srv/crew");
    assert.deepEqual(d.map((x) => x.id), ["default", "/media/pi/KINGSTON USB", "/mnt/nas"]);
    assert.equal(d[1].dir, "/media/pi/KINGSTON USB/Backups-pypilot-newui");
  });
});

describe("TinyPilot SD image (Rev671)", () => {
  it("reads up to the end of the last partition (the boat's card: 1094 MiB of 15 GB)", () => {
    assert.equal(sdImageMiB("8192 131072\n139264 2100713\n"), 1094);
    assert.equal(sdImageMiB("cat: no such file\n"), null);
  });
  it("dd at the lowest priority, after sync", () => {
    assert.equal(sdReadCommand(1094), "sync; sudo nice -n 19 dd if=/dev/mmcblk0 bs=1M count=1094 2>/dev/null");
  });
  it("Rev734: consistent read - services down, read-only, put back on exit and by a safety net", () => {
    const { sdReadConsistentCommand } = require("../tinypilot-sd");
    const c: string = sdReadConsistentCommand(1094, 1800);
    assert.match(c, /setsid sh -c 'sleep 1800; sudo mount -o remount,rw \/mnt\/mmcblk0p2 [^']*sudo sv up [^']*' <\/dev\/null/);
    assert.match(c, /trap '[^']*remount,rw[^']*sv up[^']*' EXIT HUP INT TERM/);
    assert.ok(c.indexOf("sv down") < c.indexOf("remount,ro") && c.indexOf("remount,ro") < c.indexOf("dd if=/dev/mmcblk0"));
    assert.match(c, /echo "PNU_RO=\$RO" >&2/);
    assert.match(c, /dd if=\/dev\/mmcblk0 bs=1M count=1094 2>\/dev\/null$/);
    // nothing but the image may reach stdout
    for (const part of c.split("; ")) {
      if (/^(sudo sv down|sudo mount -o remount,ro)/.test(part)) assert.match(part, />\/dev\/null 2>&1/);
    }
  });
  it("names and keeps the newest three", () => {
    // Rev737: version, boat, date and time, "backup"
    assert.equal(sdImageName(new Date(2026, 10, 22, 21, 5), "pypilot 0.56", "TUNATUNES"), "tinypilot-v0.56-tunatunes-2026-11-22-2105-backup.img.gz");
    assert.equal(sdImageName(new Date(2026, 10, 22, 9, 0), null, "Ceñida Ñ"), "tinypilot-vunknown-cenida-n-2026-11-22-0900-backup.img.gz");
    assert.ok(isSdImageName("tinypilot-sd-2026-11-09.img.gz"), "old names still listed");
    assert.ok(!isSdImageName("../etc/passwd"));
    assert.ok(!isSdImageName("tinypilot_2026_07_05.img.xz"), "official images are not copies");
    const names = ["tinypilot-sd-2026-08-01.img.gz", "tinypilot-v0.56-boat-2026-11-22-2105-backup.img.gz", "tinypilot-sd-2026-10-01.img.gz",
      "tinypilot-v0.71-boat-2026-09-01-0800-backup.img.gz", "pypilot-newui-2026-11-09.json"];
    assert.deepEqual(sdImagesToDrop(names), ["tinypilot-sd-2026-08-01.img.gz"]);
  });
});
