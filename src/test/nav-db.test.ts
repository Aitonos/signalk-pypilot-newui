import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { NavDb, NavDbSample } from "../nav-db";

const DEG = Math.PI / 180;

function smp(i: number, o: Partial<NavDbSample> = {}): NavDbSample {
  return {
    ts: 1_000_000 + i * 1000, engaged: true, mode: "compass", pilot: "basic", profile: "default",
    gains: { P: 0.0165, D: 0.15 }, terms: { P: i % 2 ? 0.01 : -0.01, D: 0.02 },
    hdgErr: (i % 2 ? 2 : -2) * DEG, hdgRate: 1, servoCur: i % 4 === 0 ? 1.0 : 0.0, servoFlags: null,
    tws: 5, twa: 140 * DEG, aws: 4, awa: -120 * DEG, sog: 3, heel: (5 + (i % 2 ? 2 : -2)) * DEG, pitch: 0,
    tackState: "none", gustActive: false, ...o,
  };
}

function db(): NavDb {
  return new NavDb({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "navdb-")), rev: "RevT" });
}

describe("NavDb (Rev570)", () => {
  it("closes a 90 s window into one clean row", () => {
    const d = db();
    let row = null;
    for (let i = 0; i <= 90 && !row; i += 1) row = d.onSample(smp(i));
    assert.ok(row, "a row after 90 s");
    assert.equal(row!.valid, true, JSON.stringify(row!.why));
    assert.equal(row!.n, 90);
    assert.equal(row!.res.errRmsDeg, 2);
    assert.equal(row!.res.errMeanDeg, 0);
    assert.equal(row!.res.crossings, 89);
    assert.equal(row!.res.servoDutyPct, 26);
    assert.equal(row!.ctx.tack, "port");
    assert.equal(row!.ctx.heelDeg, 5);
    assert.equal(row!.ctx.rollSdDeg, 2);
    assert.equal(row!.ctx.twsKn, 9.7);
    assert.equal(row!.res.termsRms.P, 0.01);
  });

  it("marks why a window is not comparable", () => {
    const d = db();
    let row = null;
    for (let i = 0; i <= 90 && !row; i += 1) {
      row = d.onSample(smp(i, {
        mode: i < 45 ? "compass" : "wind",
        gains: { P: i < 30 ? 0.0165 : 0.02, D: 0.15 },
        tackState: i === 10 ? "tacking" : "none",
        gustActive: i === 20,
      }));
    }
    assert.equal(row!.valid, false);
    for (const r of ["mode", "gains", "tack", "gust"]) assert.ok(row!.why.includes(r as any), r);
  });

  it("a disengage closes a short window, marked short", () => {
    const d = db();
    for (let i = 0; i < 20; i += 1) d.onSample(smp(i));
    const row = d.onSample(smp(20, { engaged: false }));
    assert.ok(row);
    assert.ok(row!.why.includes("short"));
    assert.equal(d.onSample(smp(21, { engaged: false })), null);
  });

  it("writes rows to the monthly file without blocking", async () => {
    const d = db();
    for (let i = 0; i <= 90; i += 1) d.onSample(smp(i));
    await d.flush();
    const files = d.files();
    assert.equal(files.length, 1);
    const lines = fs.readFileSync(path.join(d.stats().dir, files[0]), "utf8").trim().split("\n");
    assert.equal(JSON.parse(lines[0]).type, "window");
  });
});

describe("NavDb steady samples (Rev574, audit #B/#D)", () => {
  it("a +10 correction does not count as a sustained offset", () => {
    const d = db();
    let row = null;
    // 20 s of correcting a 10° step (not steady), then on course.
    for (let i = 0; i <= 90 && !row; i += 1) {
      row = d.onSample(smp(i, i < 20
        ? { hdgErr: (10 - i * 0.5) * DEG, steady: false }
        : { hdgErr: (i % 2 ? 0.5 : -0.5) * DEG, steady: true }));
    }
    assert.ok(row);
    assert.ok(Math.abs(row!.res.errMeanDeg!) < 1, `mean ${row!.res.errMeanDeg}`);
    assert.equal(row!.res.steadyPct, 78);
    assert.equal(row!.valid, true);
  });

  it("a window that is mostly corrections is marked 'steps'", () => {
    const d = db();
    let row = null;
    for (let i = 0; i <= 90 && !row; i += 1) row = d.onSample(smp(i, { steady: i > 60 }));
    assert.ok(row!.why.includes("steps"));
  });
});
