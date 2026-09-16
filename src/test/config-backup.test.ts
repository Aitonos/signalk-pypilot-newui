import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  captureBundle,
  validateBundle,
  applyBundleToPypilot,
  isRuntimeKey,
} from "../config-backup";

describe("config-backup — capture", () => {
  it("collects persistent-flagged keys and skips runtime ones", () => {
    const catalog = {
      "ap.pilots.basic.P":  { info: { persistent: true,  type: "float" } },
      "ap.pilots.basic.I":  { info: { persistent: true,  type: "float" } },
      "ap.tack.angle":      { info: { persistent: true,  type: "int" } },
      "ap.heading":         { info: { persistent: false, type: "float" } },   // runtime
      "servo.current":      { info: { persistent: false, type: "float" } },   // runtime
      "servo.controller_temp": { info: { persistent: false, type: "float" } }, // runtime
      "servo.max_current":  { info: { persistent: false, type: "float" } },    // in EXTRA
    };
    const values: Record<string, unknown> = {
      "ap.pilots.basic.P": 0.003,
      "ap.pilots.basic.I": 0.02,
      "ap.tack.angle": 90,
      "ap.heading": 45.5,
      "servo.current": 1.2,
      "servo.controller_temp": 38.5,
      "servo.max_current": 6.0,
    };
    const b = captureBundle({
      revision: "RevTest",
      props: { host: "openplotter.local", port: 80 },
      catalog,
      values,
    });
    assert.equal(b.version, 1);
    assert.equal(b.revision, "RevTest");
    assert.ok("ap.pilots.basic.P" in b.pypilotSettings);
    assert.ok("ap.tack.angle" in b.pypilotSettings);
    assert.ok("servo.max_current" in b.pypilotSettings, "EXTRA list forces inclusion");
    assert.ok(!("ap.heading" in b.pypilotSettings), "runtime key excluded");
    assert.ok(!("servo.current" in b.pypilotSettings), "runtime key excluded");
    assert.equal(b.pluginOptions.host, "openplotter.local");
    assert.equal(b.pluginOptions.port, 80);
  });

  it("captures a note when supplied", () => {
    const b = captureBundle({
      revision: "R", props: {}, catalog: {}, values: {},
      note: "before rig change",
    });
    assert.equal(b.note, "before rig change");
  });

  it("clones pluginOptions (mutation-safe)", () => {
    const props = { host: "one", nested: { a: 1 } };
    const b = captureBundle({
      revision: "R", props, catalog: {}, values: {},
    });
    // Mutate the source; bundle must be unaffected.
    (props as any).host = "two";
    (props as any).nested.a = 99;
    assert.equal(b.pluginOptions.host, "one");
    assert.equal((b.pluginOptions.nested as any).a, 1);
  });
});

describe("config-backup — validate", () => {
  it("accepts a well-formed bundle", () => {
    const b = {
      version: 1, capturedTs: 1, revision: "R",
      pluginOptions: {}, pypilotSettings: { "ap.pilots.basic.P": 0.003 },
    };
    assert.equal(validateBundle(b), null);
  });

  it("rejects unknown version", () => {
    assert.ok(validateBundle({ version: 2, capturedTs: 1, pluginOptions: {}, pypilotSettings: {} })!
      .includes("unsupported version"));
  });

  it("rejects non-scalar pypilot values", () => {
    const msg = validateBundle({
      version: 1, capturedTs: 1,
      pluginOptions: {}, pypilotSettings: { key: { nested: true } },
    });
    assert.ok(msg && msg.includes("not a scalar"));
  });

  it("rejects a null input", () => {
    assert.ok(validateBundle(null) !== null);
    assert.ok(validateBundle(undefined) !== null);
    assert.ok(validateBundle("string") !== null);
  });
});

describe("config-backup — apply", () => {
  it("calls set() for each known persistent key and returns audit", () => {
    const applied: Array<[string, unknown]> = [];
    const bundle = {
      version: 1 as const, capturedTs: 1, revision: "R",
      pluginOptions: {},
      pypilotSettings: {
        "ap.pilots.basic.P": 0.003,
        "ap.tack.angle": 90,
        "ap.unknown.key": 42,      // not in catalog → skipped-unknown
        "servo.current": 5,        // runtime suffix → skipped-runtime
      },
    };
    const catalog = {
      "ap.pilots.basic.P": {},
      "ap.tack.angle": {},
      "servo.current": {},
    };
    const audit = applyBundleToPypilot(bundle, catalog, (k, v) => { applied.push([k, v]); });
    assert.equal(applied.length, 2);
    assert.deepEqual(applied[0], ["ap.pilots.basic.P", 0.003]);
    assert.deepEqual(applied[1], ["ap.tack.angle", 90]);
    const summary = Object.fromEntries(audit.map(a => [a.key, a.status]));
    assert.equal(summary["ap.pilots.basic.P"], "applied");
    assert.equal(summary["ap.tack.angle"], "applied");
    assert.equal(summary["ap.unknown.key"], "skipped-unknown");
    assert.equal(summary["servo.current"], "skipped-runtime");
  });

  it("records an error entry when set() throws", () => {
    const audit = applyBundleToPypilot(
      { version: 1, capturedTs: 1, revision: "R", pluginOptions: {},
        pypilotSettings: { "ap.tack.angle": 90 } },
      { "ap.tack.angle": {} },
      () => { throw new Error("boom"); },
    );
    assert.equal(audit[0].status, "error");
    assert.ok(audit[0].error!.includes("boom"));
  });
});

describe("isRuntimeKey", () => {
  it("flags common runtime suffixes", () => {
    assert.equal(isRuntimeKey("ap.heading"), true);
    assert.equal(isRuntimeKey("servo.current"), true);
    assert.equal(isRuntimeKey("imu.pitch"), true);
    assert.equal(isRuntimeKey("some.foo.rate"), true);
  });
  it("does NOT flag setting keys", () => {
    assert.equal(isRuntimeKey("ap.pilots.basic.P"), false);
    assert.equal(isRuntimeKey("ap.tack.angle"), false);
    assert.equal(isRuntimeKey("servo.max_current"), false);
    assert.equal(isRuntimeKey("profile"), false);
  });
});
