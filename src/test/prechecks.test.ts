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
