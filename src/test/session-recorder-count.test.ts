import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { SessionRecorder } from "../session-recorder";

// Big enough (> 100 KB) that the Rev176 short-session sweep leaves them alone.
const BODY = "x".repeat(120 * 1024);

function seed(n: number): string {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "sess-count-"));
  const dir = path.join(data, "nav-sessions");
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const day = String(1 + Math.floor(i / 24)).padStart(2, "0");
    const hh = String(i % 24).padStart(2, "0");
    fs.writeFileSync(path.join(dir, `session-202609${day}-${hh}0000-${String(i).padStart(5, "0")}.jsonl`), BODY);
  }
  return data;
}
const list = (data: string) => fs.readdirSync(path.join(data, "nav-sessions")).sort();

describe("SessionRecorder.pruneToCount (Rev505)", () => {
  it("keeps the newest 50 on construction", () => {
    const data = seed(60);
    const before = list(data);
    new SessionRecorder({ dataDir: data });
    const after = list(data);
    assert.equal(after.length, 50);
    assert.deepEqual(after, before.slice(10), "the 10 oldest are the ones removed");
  });

  it("leaves a directory under the cap alone", () => {
    const data = seed(12);
    new SessionRecorder({ dataDir: data });
    assert.equal(list(data).length, 12);
  });

  it("a new session counts inside the 50 and is never the one deleted", () => {
    const data = seed(50);
    const rec = new SessionRecorder({ dataDir: data });
    try {
      rec.start({ pilot: null, profile: null, gainsAtStart: null, revision: "test" });
      const id = String(rec.currentSessionId());
      const names = list(data);
      assert.equal(names.length, 50, "49 old + the new one");
      assert.ok(names.some((n) => n.includes(id)), "the new session survives");
      assert.equal(rec.pruneToCount(1).deleted, 49);
      assert.deepEqual(list(data).map((n) => n.includes(id)), [true]);
    } finally {
      rec.stop();
    }
  });
});
