// Rev658 (Carlos 2026-11-08): a saved enable list switched off every alarm
// added after it - the pypilot access alarm (Rev640) never fired on the boat.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveEnabled } from "../alarms";

const rules = [
  { id: "steer-stuck", defaultEnabled: true },
  { id: "heading-deviation", defaultEnabled: true },
  { id: "attitude-heel-extreme", defaultEnabled: false },
  { id: "pypilot-sk-access", defaultEnabled: true, addedRev: 640 },
];

describe("resolveEnabled (Rev658)", () => {
  it("no saved list: defaults", () => {
    const m = resolveEnabled(rules, undefined, undefined);
    assert.equal(m.get("heading-deviation"), true);
    assert.equal(m.get("attitude-heel-extreme"), false);
  });
  it("old saved list (no 'known'): a rule added since Rev640 keeps its default", () => {
    const m = resolveEnabled(rules, ["steer-stuck"], undefined);   // the boat's config
    assert.equal(m.get("steer-stuck"), true);
    assert.equal(m.get("heading-deviation"), false, "the sailor switched it off");
    assert.equal(m.get("pypilot-sk-access"), true, "never seen, so its default");
  });
  it("list saved knowing the rule: the sailor's choice wins", () => {
    const m = resolveEnabled(rules, ["steer-stuck"], rules.map((r) => r.id));
    assert.equal(m.get("pypilot-sk-access"), false);
  });
  it("a rule newer than the saved 'known' list keeps its default", () => {
    const m = resolveEnabled(rules, ["steer-stuck"], ["steer-stuck", "heading-deviation", "attitude-heel-extreme"]);
    assert.equal(m.get("pypilot-sk-access"), true);
  });
});
