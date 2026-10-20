// Rev538: fixes from the fourth external review (restore, recorders,
// episodes, harbour mode, black box).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyBundleToPypilot, captureBundle } from "../config-backup";
import { EpisodeDetector } from "../episodes";
import { VisorPrefs } from "../visor-prefs";
import { BlackBox, BB_MAX_INCIDENT_SAMPLES } from "../black-box";
import { errorRad } from "../kpis";

const D = Math.PI / 180;

describe("Rev538: restore never steers", () => {
  it("ap.enabled / heading_command / tack / mode are skipped; a refused write is an error", () => {
    const sent: string[] = [];
    const bundle = { version: 1 as const, capturedTs: 1, revision: "R", pluginOptions: {}, pypilotSettings: {
      "ap.enabled": true, "ap.heading_command": 170, "ap.tack.state": "begin", "ap.mode": "wind",
      "servo.command": 1, "ap.pilot.basic.P": 0.3, "ap.tack.angle": 100 } };
    const catalog = Object.fromEntries(Object.keys(bundle.pypilotSettings).map((k) => [k, {}]));
    const audit = applyBundleToPypilot(bundle, catalog, (k) => { sent.push(k); return k !== "ap.tack.angle"; });
    assert.deepEqual(sent, ["ap.pilot.basic.P", "ap.tack.angle"]);
    const st = Object.fromEntries(audit.map((a) => [a.key, a.status]));
    assert.equal(st["ap.enabled"], "skipped-runtime");
    assert.equal(st["ap.heading_command"], "skipped-runtime");
    assert.equal(st["ap.tack.angle"], "error");
  });
  it("capture reads the top-level persistent / profiled flags", () => {
    const b = captureBundle({ revision: "R", props: {}, values: { "ap.pilot.basic.P": 0.3 },
      catalog: { "ap.pilot.basic.P": { profiled: true } } as any });
    assert.ok("ap.pilot.basic.P" in b.pypilotSettings);
  });
});

describe("Rev538: episodes", () => {
  it("a compass -> wind switch is not a -135 step", () => {
    const e = new EpisodeDetector();
    const base = { engaged: true, headingActual: 180 * D, awa: 45 * D } as any;
    e.onSample({ ...base, ts: 0, mode: "compass", headingCmd: 180 * D });
    e.onSample({ ...base, ts: 1000, mode: "wind", headingCmd: 45 * D });
    e.onSample({ ...base, ts: 2000, mode: "wind", headingCmd: 45 * D });
    assert.equal(e.snapshot().length, 0);
  });
});

describe("Rev538: KPI true-wind error without TWA", () => {
  it("is unknown, not target - AWA", () => {
    assert.equal(errorRad({ headingCmd: 120 * D, mode: "true wind", twa: null, awa: 80 * D } as any), null);
  });
});

describe("Rev538: harbour mode needs 2 continuous minutes", () => {
  it("0, ten minutes without SOG, 0 -> not in harbour yet", () => {
    const v = new VisorPrefs(null);
    v.tickHarbor(0, 0);
    v.tickHarbor(null, 300_000);
    v.tickHarbor(0, 600_000);
    assert.equal(v.snapshot(600_000).harborActive, false);
  });
});

describe("Rev538: black-box incident is bounded", () => {
  it("events every 30 s for an hour still write after 15 min", () => {
    const bb = new BlackBox(null);
    const t0 = 1_000_000;
    bb.push({ ts: t0 } as any);
    bb.trigger("mark", "x", t0);
    let closed = false;
    for (let s = 1; s < 3600 && !closed; s++) {
      if (s % 30 === 0) bb.trigger("mark", "x", t0 + s * 1000);
      bb.push({ ts: t0 + s * 1000 } as any);
      if (!bb.isRecording()) closed = true;
    }
    assert.ok(closed, "closed by the size limit");
    assert.ok(BB_MAX_INCIDENT_SAMPLES <= 900);
  });
});
