// Minimal smoke tests for the Signal K plugin registry.
// Uses node:test (built-in, no devDependencies pulled) so it works when
// the registry clones the source and runs `npm test`. We do NOT call
// start() here because start() opens a socket.io connection to
// pypilot_web and would hang the test runner. The registry does its
// own activate check with the schema defaults.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginFactory: (app: unknown) => unknown = require("../index");

describe("signalk-pypilot-newui plugin", () => {
  const app = {
    debug: () => {},
    error: () => {},
    setPluginStatus: () => {},
    setPluginError: () => {},
    selfId: "test-vessel",
    getPath: () => undefined,
    getSelfPath: () => undefined,
    handleMessage: () => {},
    registerPutHandler: () => {},
    registerActionHandler: () => {},
    registerAutopilotProvider: () => {},
    subscriptionmanager: {
      subscribe: () => {},
    },
    streambundle: {
      getSelfBus: () => ({ onValue: () => () => {}, subscribe: () => ({ unsubscribe: () => {} }) }),
    },
    savePluginOptions: (_o: unknown, cb: () => void) => cb(),
    readPluginOptions: () => ({ configuration: {} }),
  };

  const plugin = pluginFactory(app) as {
    id: string;
    name: string;
    description?: string;
    schema: () => Record<string, unknown>;
    start: (config: unknown, restartPlugin?: unknown) => void;
    stop: () => void;
  };

  it("exports a factory that returns a plugin object", () => {
    assert.equal(typeof pluginFactory, "function");
    assert.ok(plugin, "factory returned a truthy plugin object");
  });

  it("exposes id and name", () => {
    assert.equal(typeof plugin.id, "string");
    assert.ok(plugin.id.length > 0, "plugin.id is non-empty");
    assert.equal(typeof plugin.name, "string");
    assert.ok(plugin.name.length > 0, "plugin.name is non-empty");
  });

  it("exposes start and stop functions", () => {
    assert.equal(typeof plugin.start, "function");
    assert.equal(typeof plugin.stop, "function");
  });

  it("exposes a schema function that returns a valid JSON Schema object", () => {
    assert.equal(typeof plugin.schema, "function");
    const s = plugin.schema() as {
      type: string;
      properties: Record<string, { type: string; default?: unknown }>;
    };
    assert.equal(s.type, "object");
    assert.ok(s.properties, "schema has properties");
    // host and port are the two required connection fields.
    assert.ok(s.properties.host, "schema declares host");
    assert.ok(s.properties.port, "schema declares port");
    // Port ships with a sensible default so the registry can activate
    // without user input.
    assert.equal(s.properties.port.default, 80);
  });

  it("stop() is safe to call when nothing was started", () => {
    // Must not throw. start() is intentionally not exercised here — it
    // opens a real socket.io client.
    assert.doesNotThrow(() => plugin.stop());
  });
});
