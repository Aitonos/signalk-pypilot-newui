import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { loadLineage, recordCreation, renameIfPending, lookAlikes, type ProfileLineage } from "../profile-lineage";

describe("profile lineage (Rev569)", () => {
  it("a copy of a profile without history is v2; its copy v3", () => {
    const s: ProfileLineage = {};
    assert.equal(recordCreation(s, "tune-1", "Ceñida 18 aws", "tune", 1000).version, 2);
    assert.equal(recordCreation(s, "doctor-1", "tune-1", "doctor", 2000).version, 3);
    assert.equal(s["doctor-1"].parent, "tune-1");
  });

  it("a rename keeps the old profile's history and version", () => {
    const s: ProfileLineage = {};
    recordCreation(s, "tune-1", "base", "tune", 1000);
    recordCreation(s, "tune-2", "tune-1", "tune", 2000);           // v3
    recordCreation(s, "Ceñida fuerte", "tune-2", "user", 50_000);  // the rename's copy
    const to = renameIfPending(s, "tune-2", 51_000);
    assert.equal(to, "Ceñida fuerte");
    assert.equal(s["Ceñida fuerte"].version, 3);
    assert.equal(s["Ceñida fuerte"].parent, "tune-1");
    assert.equal(s["Ceñida fuerte"].renamedFrom, "tune-2");
    assert.equal(s["tune-2"], undefined);
  });

  it("deleting a profile long after copying it is not a rename", () => {
    const s: ProfileLineage = {};
    recordCreation(s, "A2", "A", "new", 1000);
    assert.equal(renameIfPending(s, "A", 1000 + 60_000), null);
    assert.equal(s["A2"].renamedFrom, undefined);
  });

  it("finds names that only differ in spaces or capitals", () => {
    const g = lookAlikes(["Ceñida fondo medio viento ", "Mar plana", "Ceñida fondo medio viento", "basic", "BASIC"]);
    assert.equal(g.length, 2);
  });

  it("drops malformed persisted rows", () => {
    const s = loadLineage({ ok: { createdTs: 1, version: 2, parent: "x", origin: "tune" }, bad: { version: "x" }, "": {} });
    assert.deepEqual(Object.keys(s), ["ok"]);
  });
});
