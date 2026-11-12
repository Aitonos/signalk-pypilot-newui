// Rev695 (GitHub #6): heading in pypilot but not in Signal K.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runPrechecks } from "../prechecks";

const base = {
  connected: true,
  disconnectedSinceMs: null,
  hasAutopilotProvider: true,
  autopilotId: "pypilot-newui",
  sample: null,
  quality: { computedTs: 0, windowSec: 30, items: [] },
  servoHealth: null,
};

describe("prechecks: heading not reaching Signal K (Rev695)", () => {
  it("points at pypilot's Signal K access when pypilot has a fresh heading", () => {
    const snap = runPrechecks({ ...base, pypilotHeadingFresh: true });
    for (const id of ["navigation.headingMagnetic", "navigation.attitude"]) {
      const it = snap.items.find((x) => x.id === id)!;
      assert.equal(it.status, "fail");
      assert.equal(it.code, "notInSk");
      assert.equal(it.hintCode, "skAccess");
    }
    assert.equal(snap.overall, "do-not-engage");
  });
  it("keeps the plain sensor message otherwise", () => {
    const snap = runPrechecks({ ...base, pypilotHeadingFresh: false });
    const it = snap.items.find((x) => x.id === "navigation.headingMagnetic")!;
    assert.equal(it.code, "unmonitored");
  });
});

describe("prechecks: heading through the plugin's fallback (Rev698)", () => {
  const good = (path: string) => ({ path, label: path, level: "good", ageMs: 200, hz: 5, source: "pypilot-newui" });
  const quality = { computedTs: 0, windowSec: 30, items: [good("navigation.headingMagnetic"), good("navigation.attitude"), good("navigation.position")] } as any;
  it("warns and points at pypilot's access while the plugin publishes it", () => {
    const snap = runPrechecks({ ...base, quality, pypilotHeadingFresh: true, fallbackPaths: ["navigation.headingMagnetic"] });
    const h = snap.items.find((x) => x.id === "navigation.headingMagnetic")!;
    assert.equal(h.status, "warn");
    assert.equal(h.code, "viaFallback");
    assert.equal(h.hintCode, "skAccess");
    assert.equal(snap.items.find((x) => x.id === "navigation.attitude")!.status, "pass", "attitude from another source");
    assert.notEqual(snap.overall, "do-not-engage");
  });
  it("plain pass when pypilot writes it itself", () => {
    const snap = runPrechecks({ ...base, quality, pypilotHeadingFresh: true, fallbackPaths: [] });
    assert.equal(snap.items.find((x) => x.id === "navigation.headingMagnetic")!.status, "pass");
  });
});

describe("prechecks: autopilot held by another plugin (Rev706, GitHub #7)", () => {
  it("passes with the external provider's id", () => {
    const snap = runPrechecks({ ...base, hasAutopilotProvider: false, autopilotId: "pypilot-sk (pypilot-autopilot-provider)" });
    const it = snap.items.find((x) => x.id === "ap-provider")!;
    assert.equal(it.status, "pass");
    assert.equal(it.code, "external");
  });
  it("fails when nobody holds it", () => {
    const snap = runPrechecks({ ...base, hasAutopilotProvider: false, autopilotId: null });
    assert.equal(snap.items.find((x) => x.id === "ap-provider")!.code, "none");
  });
});

describe("prechecks: other boats (Rev707)", () => {
  const good = (path: string) => ({ path, label: path, level: "good", ageMs: 200, hz: 5, source: "x" });
  const lost = (path: string) => ({ path, label: path, level: "lost", ageMs: 60000, hz: 0, source: "x" });
  const q = (items: any[]) => ({ computedTs: 0, windowSec: 30, items } as any);
  const noGps = q([good("navigation.headingMagnetic"), good("navigation.attitude"), lost("navigation.position")]);
  it("no GPS in compass mode: a caveat, not do-not-engage", () => {
    const snap = runPrechecks({ ...base, quality: noGps, apMode: "compass" });
    assert.equal(snap.items.find((x) => x.id === "navigation.position")!.status, "warn");
    assert.notEqual(snap.overall, "do-not-engage");
  });
  it("no GPS in gps mode: still do-not-engage", () => {
    const snap = runPrechecks({ ...base, quality: noGps, apMode: "gps" });
    assert.equal(snap.items.find((x) => x.id === "navigation.position")!.status, "fail");
    assert.equal(snap.overall, "do-not-engage");
  });
  it("true heading only counts as heading", () => {
    const snap = runPrechecks({ ...base, quality: q([good("navigation.attitude"), good("navigation.position")]), headingTrueAgeMs: 300 });
    const h = snap.items.find((x) => x.id === "navigation.headingMagnetic")!;
    assert.equal(h.status, "pass");
    assert.equal(h.code, "viaTrue");
  });
  it("a stale true heading does not", () => {
    const snap = runPrechecks({ ...base, quality: q([]), headingTrueAgeMs: 9000 });
    assert.notEqual(snap.items.find((x) => x.id === "navigation.headingMagnetic")!.status, "pass");
  });
  it("warns when pypilot-autopilot-provider is active as well", () => {
    const snap = runPrechecks({ ...base, autopilotDevices: {
      "pypilot-newui": { provider: "signalk-pypilot-newui", isDefault: false },
      "pypilot-sk": { provider: "pypilot-autopilot-provider", isDefault: true },
    } });
    const it = snap.items.find((x) => x.id === "ap-provider")!;
    assert.equal(it.status, "warn");
    assert.equal(it.code, "both");
  });
  it("warns when another autopilot is Signal K's default", () => {
    const snap = runPrechecks({ ...base, autopilotDevices: {
      "pypilot-newui": { provider: "signalk-pypilot-newui", isDefault: false },
      "raymarine": { provider: "raymarine-autopilot", isDefault: true },
    } });
    const it = snap.items.find((x) => x.id === "ap-provider")!;
    assert.equal(it.code, "notDefault");
    assert.equal(it.params!.id, "raymarine");
  });
  it("only us and default: plain pass", () => {
    const snap = runPrechecks({ ...base, autopilotDevices: { "pypilot-newui": { provider: "signalk-pypilot-newui", isDefault: true } } });
    assert.equal(snap.items.find((x) => x.id === "ap-provider")!.status, "pass");
  });
});
