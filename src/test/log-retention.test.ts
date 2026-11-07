// Rev647: TinyPilot log capture retention.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { pruneLogDir } from "../log-retention";

function dirWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-"));
  for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), body);
  return dir;
}
const NOW = new Date(2026, 10, 7, 10, 0, 0);

describe("pruneLogDir (Rev647)", () => {
  it("gzips past days, keeps today's file plain, contents intact", async () => {
    const body = "[pypilot] line\n".repeat(2000);
    const dir = dirWith({ "pizero-20261106.log": body, "pizero-20261107.log": "today\n", "other.txt": "x" });
    const r = await pruneLogDir(dir, NOW);
    assert.deepEqual(r.gzipped, ["pizero-20261106.log"]);
    const names = fs.readdirSync(dir).sort();
    assert.deepEqual(names, ["other.txt", "pizero-20261106.log.gz", "pizero-20261107.log"]);
    assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(dir, "pizero-20261106.log.gz"))).toString(), body);
  });

  it("deletes files older than the age limit", async () => {
    const dir = dirWith({ "pizero-20260901.log.gz": "a", "pizero-20261020.log.gz": "b", "pizero-20261107.log": "c" });
    const r = await pruneLogDir(dir, NOW, { maxAgeDays: 30, maxTotalBytes: 1e9 });
    assert.deepEqual(r.deleted, ["pizero-20260901.log.gz"]);
  });

  it("drops the oldest while above the size cap, never today's file", async () => {
    const dir = dirWith({
      "pizero-20261101.log.gz": "x".repeat(400),
      "pizero-20261102.log.gz": "x".repeat(400),
      "pizero-20261107.log": "x".repeat(900),
    });
    const r = await pruneLogDir(dir, NOW, { maxAgeDays: 30, maxTotalBytes: 1000 });
    assert.deepEqual(r.deleted, ["pizero-20261101.log.gz", "pizero-20261102.log.gz"]);
    assert.ok(fs.existsSync(path.join(dir, "pizero-20261107.log")), "today kept even above the cap");
  });

  it("a missing folder is not an error", async () => {
    const r = await pruneLogDir(path.join(os.tmpdir(), "lc-does-not-exist-647"), NOW);
    assert.deepEqual(r, { gzipped: [], deleted: [], totalBytes: 0 });
  });
});
