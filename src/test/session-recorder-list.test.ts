import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { SessionRecorder, readEdgeLines } from "../session-recorder";

// The real module object: the "import * as fs" namespace is read-only.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const realFs = require("fs");

function dataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sess-list-"));
}

/** Write a closed session file by hand: header, n samples (padded so the
 *  file is large), a tags line, and optionally the end line. */
function writeSession(data: string, id: string, n: number, withEnd: boolean): string {
  const dir = path.join(data, "nav-sessions");
  fs.mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  lines.push(JSON.stringify({ type: "header", format: 2, sessionId: id, startTs: 1000, pilot: "basic", profile: "default", gainsAtStart: { P: 0.003 }, revision: "Rev567" }));
  for (let i = 0; i < n; i += 1) lines.push(JSON.stringify({ type: "sample", ts: 1000 + i * 1000, pad: "x".repeat(200) }));
  lines.push(JSON.stringify({ type: "tags", ts: 5000, tags: { wind: "10-15", note: "test" } }));
  if (withEnd) lines.push(JSON.stringify({ type: "end", endTs: 1000 + n * 1000, sampleCount: n, finalTags: { wind: "10-15", note: "test" } }));
  const file = path.join(dir, `session-${id}.jsonl`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

describe("SessionRecorder.list (Rev567)", () => {
  it("lists a closed session from its first and last lines, without reading the whole file", () => {
    const data = dataDir();
    writeSession(data, "20261030-100000-00001", 2000, true);   // ~450 KB
    const rec = new SessionRecorder({ dataDir: data });
    const spy = mock.method(realFs, "readFileSync");
    const out = rec.list();
    assert.equal(out.length, 1);
    assert.equal(out[0].sampleCount, 2000);
    assert.equal(out[0].endTs, 1000 + 2000 * 1000);
    assert.deepEqual(out[0].tags, { wind: "10-15", note: "test" });
    assert.equal(out[0].pilot, "basic");
    assert.equal(spy.mock.callCount(), 0);
    spy.mock.restore();
  });

  it("falls back to a full read for a file without an end line, then caches it", () => {
    const data = dataDir();
    writeSession(data, "20261030-110000-00002", 600, false);
    const rec = new SessionRecorder({ dataDir: data });
    const spy = mock.method(realFs, "readFileSync");
    const a = rec.list();
    assert.equal(a[0].sampleCount, 600);
    assert.equal(a[0].endTs, null);
    assert.equal(spy.mock.callCount(), 1);
    rec.list();
    assert.equal(spy.mock.callCount(), 1, "second listing served from cache");
    spy.mock.restore();
  });

  it("readEdgeLines returns the first and last lines of a large file", () => {
    const data = dataDir();
    const file = writeSession(data, "20261030-120000-00003", 3000, true);
    const { first, last } = readEdgeLines(file);
    assert.equal(JSON.parse(first!).type, "header");
    assert.equal(JSON.parse(last!).type, "end");
  });
});

describe("SessionRecorder summary and changes (Rev568)", () => {
  function sample(i: number): any {
    return {
      ts: 1_000_000 + i * 1000, hdgCmd: 0, hdgAct: 0, hdgErr: (i % 2 ? 2 : 4) * Math.PI / 180,
      hdgRate: null, hdgRateRate: null, servoCmd: null, servoCur: i % 4 === 0 ? 1.0 : 0.0,
      servoDuty: null, servoVolt: null, engaged: true, mode: "compass",
      tws: 5, twa: null, aws: null, awa: null, sog: 2.5, cog: null, heel: null, pitch: null,
    };
  }

  it("writes the summary and the changes into the end line and lists them", () => {
    const data = dataDir();
    const rec = new SessionRecorder({ dataDir: data, flushIntervalMs: 60_000 });
    rec.start({ pilot: "basic", profile: "default", gainsAtStart: { D: 0.09 }, revision: "Rev568" });
    (rec as any).startTs = Date.now() - 120_000;   // long enough to keep
    for (let i = 0; i < 40; i += 1) rec.sample(sample(i));
    rec.recordChange({ ts: 1_010_000, kind: "gain", key: "ap.pilot.basic.D", from: 0.09, to: 0.108, source: "gust-boost", reason: "Gust 22 kn" });
    rec.recordChange({ ts: 1_020_000, kind: "profile", key: "profile", from: "default", to: "heavy", source: "auto-profile" });
    const live = rec.currentSummary();
    assert.equal(live?.changes, 2);
    rec.stop();

    const [row] = rec.list();
    assert.ok(row.summary, "summary present");
    assert.equal(row.summary!.samples, 40);
    assert.equal(row.summary!.meanErrDeg, 3);
    assert.equal(row.summary!.servoDutyPct, 25);
    assert.equal(row.summary!.twsMeanKn, 9.7);
    assert.deepEqual(row.summary!.modes, { compass: 40 });
    assert.equal(row.changes!.length, 2);
    assert.equal(row.changes![0].source, "gust-boost");
  });

  it("a session from before Rev568 has no summary", () => {
    const data = dataDir();
    writeSession(data, "20261030-130000-00004", 100, true);
    const rec = new SessionRecorder({ dataDir: data });
    const [row] = rec.list();
    assert.equal(row.summary ?? null, null);
  });
});
