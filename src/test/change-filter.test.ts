import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ChangeFilter } from "../change-filter";

const paths = (vs: { path: string }[]) => vs.map((v) => v.path);

describe("ChangeFilter", () => {
  it("sends every path the first time", () => {
    const f = new ChangeFilter(30_000);
    const out = f.filter([{ path: "a", value: 1 }, { path: "b", value: null }], 0);
    assert.deepEqual(paths(out), ["a", "b"]);
  });

  it("drops unchanged values until the heartbeat is due", () => {
    const f = new ChangeFilter(30_000);
    f.filter([{ path: "a", value: 1 }, { path: "b", value: false }], 0);
    assert.deepEqual(f.filter([{ path: "a", value: 1 }, { path: "b", value: false }], 1_000), []);
    assert.deepEqual(f.filter([{ path: "a", value: 1 }, { path: "b", value: false }], 29_999), []);
    assert.deepEqual(paths(f.filter([{ path: "a", value: 1 }, { path: "b", value: false }], 30_000)), ["a", "b"]);
  });

  it("sends only the paths that changed", () => {
    const f = new ChangeFilter(30_000);
    f.filter([{ path: "a", value: 1 }, { path: "b", value: 2 }], 0);
    assert.deepEqual(paths(f.filter([{ path: "a", value: 1 }, { path: "b", value: 3 }], 1_000)), ["b"]);
  });

  it("treats float noise as unchanged but real changes as changes", () => {
    const f = new ChangeFilter(30_000);
    f.filter([{ path: "a", value: 0.1 + 0.2 }], 0);
    assert.deepEqual(f.filter([{ path: "a", value: 0.3 }], 1_000), []);
    assert.deepEqual(paths(f.filter([{ path: "a", value: 0.3001 }], 2_000)), ["a"]);
  });

  it("detects null <-> number and object changes", () => {
    const f = new ChangeFilter(30_000);
    f.filter([{ path: "a", value: null }, { path: "o", value: { x: 1 } }], 0);
    assert.deepEqual(f.filter([{ path: "a", value: null }, { path: "o", value: { x: 1 } }], 1_000), []);
    assert.deepEqual(paths(f.filter([{ path: "a", value: 0 }, { path: "o", value: { x: 2 } }], 2_000)), ["a", "o"]);
  });

  it("reset() makes the next call send everything", () => {
    const f = new ChangeFilter(30_000);
    f.filter([{ path: "a", value: 1 }], 0);
    f.reset();
    assert.deepEqual(paths(f.filter([{ path: "a", value: 1 }], 1_000)), ["a"]);
  });
});
