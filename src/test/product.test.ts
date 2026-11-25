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
