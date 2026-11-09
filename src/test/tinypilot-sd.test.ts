// Rev671: TinyPilot SD card image.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sdImageMiB, sdReadCommand, sdImageName, isSdImageName, sdImagesToDrop } from "../tinypilot-sd";

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
