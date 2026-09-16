import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONDITIONS,
  validateUpsert,
  loadMetadata,
  upsert,
  remove,
  findByCondition,
  type ProfileMetadata,
} from "../profile-metadata";

describe("profile-metadata — validateUpsert", () => {
  it("accepts a minimal valid body", () => {
    assert.equal(validateUpsert({ condition: "light" }), null);
    assert.equal(validateUpsert({ condition: "heavy", notes: "for genoa reefed" }), null);
    assert.equal(validateUpsert({ notes: null }), null); // clear notes only
    assert.equal(validateUpsert({}), null); // touch-only
  });

  it("rejects an unknown condition", () => {
    const err = validateUpsert({ condition: "hurricane" });
    assert.ok(err && err.includes("condition"));
  });

  it("rejects non-string notes", () => {
    const err = validateUpsert({ notes: 42 });
    assert.ok(err && err.includes("notes"));
  });

  it("rejects notes over 200 chars", () => {
    const err = validateUpsert({ notes: "x".repeat(201) });
    assert.ok(err && err.includes("200"));
  });

  it("rejects a non-object payload", () => {
    assert.ok(validateUpsert(null) !== null);
    assert.ok(validateUpsert("string") !== null);
    assert.ok(validateUpsert(42) !== null);
  });

  it("exposes CONDITIONS enum for the visor", () => {
    assert.deepEqual(CONDITIONS, ["light", "medium", "heavy", "motor", "custom"]);
  });
});

describe("profile-metadata — loadMetadata", () => {
  it("returns empty map for missing / non-object input", () => {
    assert.deepEqual(loadMetadata(undefined), {});
    assert.deepEqual(loadMetadata(null), {});
    assert.deepEqual(loadMetadata("foo"), {});
  });

  it("keeps well-formed rows", () => {
    const src = {
      light1: { condition: "light", notes: "genny", updatedTs: 1_000 },
      heavy1: { condition: "heavy", updatedTs: 2_000 },
    };
    const m = loadMetadata(src);
    assert.equal(m.light1.condition, "light");
    assert.equal(m.light1.notes, "genny");
    assert.equal(m.light1.updatedTs, 1_000);
    assert.equal(m.heavy1.notes, undefined);
  });

  it("silently drops rows with unknown condition", () => {
    const m = loadMetadata({
      good:    { condition: "light",     updatedTs: 1 },
      bad:     { condition: "hurricane", updatedTs: 2 },
    });
    assert.ok("good" in m);
    assert.ok(!("bad" in m));
  });

  it("silently drops rows with malformed body", () => {
    const m = loadMetadata({ p1: "not-an-object", p2: null, p3: { condition: "light", updatedTs: 1 } });
    assert.equal(Object.keys(m).length, 1);
    assert.ok("p3" in m);
  });

  it("clips notes past MAX_NOTES_LEN", () => {
    const m = loadMetadata({ p: { condition: "light", updatedTs: 1, notes: "x".repeat(500) } });
    // Should have dropped the notes field.
    assert.equal(m.p.notes, undefined);
  });

  it("defaults timestamp to 0 when missing", () => {
    const m = loadMetadata({ p: { condition: "light" } });
    assert.equal(m.p.updatedTs, 0);
  });
});

describe("profile-metadata — upsert", () => {
  it("creates a new entry with the specified condition and timestamp", () => {
    const store: ProfileMetadata = {};
    const entry = upsert(store, "raceMode", { condition: "medium" }, 1234);
    assert.deepEqual(entry, { condition: "medium", updatedTs: 1234 });
    assert.equal(store.raceMode, entry);
  });

  it("preserves prior condition when only notes are supplied", () => {
    const store: ProfileMetadata = { p: { condition: "heavy", updatedTs: 1 } };
    upsert(store, "p", { notes: "downhaul in" }, 2);
    assert.equal(store.p.condition, "heavy");
    assert.equal(store.p.notes, "downhaul in");
    assert.equal(store.p.updatedTs, 2);
  });

  it("clears notes when notes:null is passed", () => {
    const store: ProfileMetadata = { p: { condition: "light", updatedTs: 1, notes: "foo" } };
    upsert(store, "p", { notes: null }, 2);
    assert.equal(store.p.notes, undefined);
  });

  it("touches timestamp even when nothing else changes", () => {
    const store: ProfileMetadata = { p: { condition: "light", updatedTs: 1 } };
    upsert(store, "p", {}, 99);
    assert.equal(store.p.updatedTs, 99);
  });

  it("defaults to 'custom' if creating without condition", () => {
    const store: ProfileMetadata = {};
    upsert(store, "brandNew", {}, 1);
    assert.equal(store.brandNew.condition, "custom");
  });
});

describe("profile-metadata — remove", () => {
  it("deletes a present entry and returns true", () => {
    const store: ProfileMetadata = { p: { condition: "light", updatedTs: 1 } };
    assert.equal(remove(store, "p"), true);
    assert.equal("p" in store, false);
  });

  it("returns false for a missing entry (idempotent)", () => {
    const store: ProfileMetadata = {};
    assert.equal(remove(store, "nope"), false);
  });
});

describe("profile-metadata — findByCondition", () => {
  it("orders matches by most-recent updatedTs first", () => {
    const store: ProfileMetadata = {
      a: { condition: "light", updatedTs: 100 },
      b: { condition: "light", updatedTs: 300 },
      c: { condition: "heavy", updatedTs: 500 },
      d: { condition: "light", updatedTs: 200 },
    };
    assert.deepEqual(findByCondition(store, "light"), ["b", "d", "a"]);
    assert.deepEqual(findByCondition(store, "heavy"), ["c"]);
    assert.deepEqual(findByCondition(store, "motor"), []);
  });
});
