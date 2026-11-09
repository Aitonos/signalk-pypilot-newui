// Rev671: TinyPilot SD card image.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sdImageMiB, sdReadCommand, sdImageName, isSdImageName, sdImagesToDrop, sdDestinations } from "../tinypilot-sd";

describe("folder browser bounds (Rev673)", () => {
  it("home, /media and /mnt only - never system folders", () => {
    const { isAllowedFolder } = require("../tinypilot-sd");
    assert.ok(isAllowedFolder("/home/pi", "/home/pi"));
    assert.ok(isAllowedFolder("/home/pi/Backups", "/home/pi"));
    assert.ok(isAllowedFolder("/media/pi/KINGSTON USB", "/home/pi"));
    assert.ok(isAllowedFolder("/mnt/nas/boat/", "/home/pi"));
    assert.ok(!isAllowedFolder("/etc", "/home/pi"));
    assert.ok(!isAllowedFolder("/home/pirate", "/home/pi"), "a prefix is not a parent");
    assert.ok(!isAllowedFolder("/", "/home/pi"));
    assert.ok(!isAllowedFolder("relative/path", "/home/pi"));
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
    const d = sdDestinations(mounts, "/home/pi/Backups-pypilot-newui", "/home/pi");
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
  it("names and keeps the newest three", () => {
    assert.equal(sdImageName(new Date(2026, 10, 9)), "tinypilot-sd-2026-11-09.img.gz");
    assert.ok(!isSdImageName("../etc/passwd"));
    const names = ["tinypilot-sd-2026-08-01.img.gz", "tinypilot-sd-2026-11-09.img.gz", "tinypilot-sd-2026-10-01.img.gz",
      "tinypilot-sd-2026-09-01.img.gz", "pypilot-newui-2026-11-09.json"];
    assert.deepEqual(sdImagesToDrop(names), ["tinypilot-sd-2026-08-01.img.gz"]);
  });
});
