// Rev645 (Carlos 2026-11-06): the Doctor's new profile is named
// "<active profile> - Doc NNN" by default.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { doctorDefaultProfileName } from "../doctor";

describe("doctorDefaultProfileName", () => {
  it("starts at 001 for the active profile", () => {
    assert.equal(doctorDefaultProfileName("Ceñida", ["default", "Ceñida"]), "Ceñida - Doc 001");
  });
  it("goes one above the highest already used for that profile", () => {
    assert.equal(doctorDefaultProfileName("Ceñida", ["Ceñida", "Ceñida - Doc 001", "Ceñida - Doc 007", "Popa - Doc 020"]), "Ceñida - Doc 008");
  });
  it("ignores names that only look alike", () => {
    assert.equal(doctorDefaultProfileName("A", ["A - Doc 3x", "A - Doc", "AB - Doc 005"]), "A - Doc 001");
  });
  it("copes with a name full of symbols and no profile list", () => {
    assert.equal(doctorDefaultProfileName("ola (+1.5) [x]", null), "ola (+1.5) [x] - Doc 001");
    assert.equal(doctorDefaultProfileName(null, []), "profile - Doc 001");
  });
});
