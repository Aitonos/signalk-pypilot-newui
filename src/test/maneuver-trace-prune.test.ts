// Rev514: maneuver-trace keeps only the newest 60 files.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ManeuverTraceLog } from "../maneuver-trace";

describe("maneuver-trace prune (Rev514)", () => {
  it("keeps the newest 60 trace files, current one included, ignores other files", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-"));
    const dir = path.join(dataDir, "maneuver-trace");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 70; i++) {
      const d = String(i).padStart(2, "0");
      fs.writeFileSync(path.join(dir, `trace-202609${d.length ? "01" : ""}-0000${d}.jsonl`), "{}\n");
    }
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
    const t = new ManeuverTraceLog({ dataDir } as any);
    t.start();  // opens a new (newest) file -> prune
    const left = fs.readdirSync(dir).filter((f) => f.startsWith("trace-"));
    // 59 old ones survive + the current file (not written yet) = 60.
    assert.equal(left.length, 59);
    assert.ok(!left.includes("trace-20260901-000000.jsonl"), "oldest removed");
    assert.ok(left.includes("trace-20260901-000069.jsonl"), "newest old one kept");
    assert.ok(fs.existsSync(path.join(dir, "notes.txt")));
    t.stop();
  });
});
