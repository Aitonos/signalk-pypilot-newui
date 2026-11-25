// Rev779: one source, two packages - the plugin id follows the package name.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("product (Rev779)", () => {
  it("this package stays PyPilot New-UI", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
    assert.equal(pkg.name, "signalk-pypilot-newui");
  });
  it("the visor and the backend name the spin-off the same way", () => {
    const app = fs.readFileSync(path.join(__dirname, "..", "..", "public", "app.js"), "utf8");
    const idx = fs.readFileSync(path.join(__dirname, "..", "..", "src", "index.ts"), "utf8");
    assert.ok(app.includes('"signalk-autopilot-enhanced-visor"'));
    assert.ok(idx.includes('const GENERIC_PACKAGE = "signalk-autopilot-enhanced-visor"'));
  });
});

// Rev785: the spin-off's single checkpoint for pypilot-only requests.
describe("spin-off request checkpoint (Rev785)", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "public", "app.js"), "utf8");
  const m = app.match(/const PNU_PYPILOT_ONLY = (\/.*\/);/);
  // eslint-disable-next-line no-new-func
  const re: RegExp = new Function(`return ${m ? m[1] : "/$^/"};`)();
  const G = "/plugins/signalk-autopilot-enhanced-visor/";
  it("never sends pypilot-only routes", () => {
    assert.ok(m, "PNU_PYPILOT_ONLY not found in app.js");
    for (const p of [G + "supervisor/status", G + "tinypilot/sd-check", G + "ap/engage?current=1", G + "backup/now", G + "values",
      G + "doctor/start", G + "virtual-tack/start", G + "mode-profiles/last", G + "raw", G + "black-box/list",
      "/signalk/v1/api/vessels/self/steering/autopilot/pypilot/actions/nudge"]) {
      assert.ok(re.test(p), `should be blocked: ${p}`);
    }
  });
  it("lets the common routes and the Autopilot API through", () => {
    for (const p of [G + "status", G + "alarms/state", G + "visor-prefs", G + "history", G + "trip-recorder/status",
      G + "display-presets", G + "valuesX", G + "apfoo", "/signalk/v2/api/vessels/self/autopilots/raymarine/engage",
      "/signalk/v2/api/vessels/self/autopilots"]) {
      assert.ok(!re.test(p), `should pass: ${p}`);
    }
  });
});

// Rev792: the spin-off computes a heading error only for a mode whose
// reference is certain.
import { errorRad, genericModeRef } from "../kpis";
describe("spin-off mode reference (Rev792)", () => {
  const D = Math.PI / 180;
  it("names that leave no doubt", () => {
    assert.equal(genericModeRef("compass"), "compass");
    assert.equal(genericModeRef(" Compass "), "compass");
    assert.equal(genericModeRef("true wind"), "true wind");
    assert.equal(genericModeRef("trueWind"), "true wind");
  });
  it("ambiguous names give no reference", () => {
    for (const m of ["wind", "auto", "route", "nav", "gps", "standby", "", null, undefined]) assert.equal(genericModeRef(m as any), null, String(m));
  });
  it("no error with a null reference, the right one otherwise", () => {
    assert.equal(errorRad({ headingCmd: 100 * D, mode: "wind", modeRef: null, awa: 80 * D, headingActual: 90 * D } as any), null);
    const c = errorRad({ headingCmd: 100 * D, mode: "auto", modeRef: "compass", headingActual: 90 * D } as any);
    assert.ok(c != null && Math.abs(c / D - 10) < 1e-9);
    const tw = errorRad({ headingCmd: 100 * D, mode: "x", modeRef: "true wind", twa: 95 * D, awa: 40 * D } as any);
    assert.ok(tw != null && Math.abs(tw / D - 5) < 1e-9);
  });
  it("PyPilot New-UI samples (no modeRef) keep working by mode", () => {
    const e = errorRad({ headingCmd: 100 * D, mode: "wind", awa: 90 * D } as any);
    assert.ok(e != null && Math.abs(e / D - 10) < 1e-9);
  });
});
