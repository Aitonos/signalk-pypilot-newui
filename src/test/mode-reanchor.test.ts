import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decideReAnchor } from "../mode-reanchor";

// Realistic pypilot catalog snapshot for the fixtures.
const CATALOG = (over: Record<string, unknown> = {}) => ({
  "ap.heading": 92.5,             // compass heading (deg 0..360)
  "wind.direction": 42.7,          // AWA (deg -180..+180)
  "wind.true_direction": 55.1,     // TWA (deg -180..+180)
  ...over,
});

describe("decideReAnchor — same-space transitions (no anchor)", () => {
  it("compass → compass", () => {
    const d = decideReAnchor("compass", "compass", CATALOG());
    assert.equal(d.shouldReAnchor, false);
    assert.equal(d.valueDeg, null);
    assert.equal(d.sourceKey, null);
    assert.ok(d.reason.includes("same target-space"));
  });

  it("compass → gps (same compass family)", () => {
    const d = decideReAnchor("compass", "gps", CATALOG());
    assert.equal(d.shouldReAnchor, false);
  });

  it("compass → nav (same compass family)", () => {
    const d = decideReAnchor("compass", "nav", CATALOG());
    assert.equal(d.shouldReAnchor, false);
  });

  it("gps → nav (still compass family)", () => {
    const d = decideReAnchor("gps", "nav", CATALOG());
    assert.equal(d.shouldReAnchor, false);
  });

  it("wind → true wind (both wind family)", () => {
    const d = decideReAnchor("wind", "true wind", CATALOG());
    assert.equal(d.shouldReAnchor, false);
  });

  it("true wind → wind (both wind family)", () => {
    const d = decideReAnchor("true wind", "wind", CATALOG());
    assert.equal(d.shouldReAnchor, false);
  });
});

describe("decideReAnchor — compass → wind (bug C root cause)", () => {
  it("anchors to wind.direction with the current AWA", () => {
    const d = decideReAnchor("compass", "wind", CATALOG());
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.sourceKey, "wind.direction");
    assert.equal(d.valueDeg, 42.7);
    assert.ok(d.reason.includes("42.7"));
  });

  it("anchors to wind.true_direction when new mode is 'true wind'", () => {
    const d = decideReAnchor("compass", "true wind", CATALOG());
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.sourceKey, "wind.true_direction");
    assert.equal(d.valueDeg, 55.1);
  });

  it("works from gps → wind (both are cross-space)", () => {
    const d = decideReAnchor("gps", "wind", CATALOG());
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.sourceKey, "wind.direction");
  });

  it("works from nav → true wind", () => {
    const d = decideReAnchor("nav", "true wind", CATALOG());
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.sourceKey, "wind.true_direction");
  });
});

describe("decideReAnchor — wind → compass (bug C reverse)", () => {
  it("anchors to ap.heading with the current compass heading", () => {
    const d = decideReAnchor("wind", "compass", CATALOG());
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.sourceKey, "ap.heading");
    assert.equal(d.valueDeg, 92.5);
  });

  it("wind → gps also anchors to ap.heading", () => {
    const d = decideReAnchor("wind", "gps", CATALOG());
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.sourceKey, "ap.heading");
  });

  it("true wind → nav anchors to ap.heading", () => {
    const d = decideReAnchor("true wind", "nav", CATALOG());
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.sourceKey, "ap.heading");
  });
});

describe("decideReAnchor — missing measurements", () => {
  it("compass → wind with no wind.direction: skipped, sailor nudges", () => {
    const d = decideReAnchor("compass", "wind", CATALOG({ "wind.direction": undefined }));
    assert.equal(d.shouldReAnchor, false);
    assert.equal(d.valueDeg, null);
    assert.equal(d.sourceKey, "wind.direction");
    assert.ok(d.reason.includes("no measurement"));
  });

  it("wind → compass with no ap.heading: skipped", () => {
    const d = decideReAnchor("wind", "compass", CATALOG({ "ap.heading": undefined }));
    assert.equal(d.shouldReAnchor, false);
    assert.equal(d.sourceKey, "ap.heading");
  });

  it("compass → true wind with no wind.true_direction: skipped", () => {
    const d = decideReAnchor("compass", "true wind", CATALOG({ "wind.true_direction": undefined }));
    assert.equal(d.shouldReAnchor, false);
    assert.equal(d.sourceKey, "wind.true_direction");
  });

  it("non-number values are treated as missing", () => {
    const d = decideReAnchor("compass", "wind", CATALOG({ "wind.direction": "not a number" }));
    assert.equal(d.shouldReAnchor, false);
  });

  it("NaN and Infinity are treated as missing", () => {
    assert.equal(decideReAnchor("compass", "wind", CATALOG({ "wind.direction": NaN })).shouldReAnchor, false);
    assert.equal(decideReAnchor("compass", "wind", CATALOG({ "wind.direction": Infinity })).shouldReAnchor, false);
  });
});

describe("decideReAnchor — case & synonym robustness", () => {
  it("uppercase mode names still work", () => {
    const d = decideReAnchor("COMPASS", "WIND", CATALOG());
    assert.equal(d.shouldReAnchor, true);
  });

  it("mode names with extra whitespace behave correctly", () => {
    const d = decideReAnchor(" compass ", " wind ", CATALOG());
    // Both are trimmed via `.toLowerCase().includes("wind")` so the
    // "wind" check still catches the destination.
    assert.equal(d.shouldReAnchor, true);
  });

  it("realistic Signal K mode string 'apparent wind' works", () => {
    const d = decideReAnchor("compass", "apparent wind", CATALOG());
    assert.equal(d.shouldReAnchor, true);
    // 'apparent wind' does not contain 'true' → wind.direction, not wind.true_direction.
    assert.equal(d.sourceKey, "wind.direction");
  });
});

describe("decideReAnchor — edge case: value at zero", () => {
  it("value 0 is a valid anchor (must not be treated as missing)", () => {
    const d = decideReAnchor("compass", "wind", CATALOG({ "wind.direction": 0 }));
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.valueDeg, 0);
  });

  it("value -0 is a valid anchor", () => {
    const d = decideReAnchor("compass", "wind", CATALOG({ "wind.direction": -0 }));
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.valueDeg, -0);
  });

  it("very small negative value is a valid anchor", () => {
    const d = decideReAnchor("compass", "wind", CATALOG({ "wind.direction": -179.9 }));
    assert.equal(d.shouldReAnchor, true);
    assert.equal(d.valueDeg, -179.9);
  });
});
