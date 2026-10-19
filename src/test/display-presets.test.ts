// Rev522: named rose display presets.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DisplayPresets, MAX_PRESETS } from "../display-presets";

describe("display presets (Rev522)", () => {
  it("saves, overwrites by name, persists, lists sorted, removes", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dp-")), "display-presets.json");
    const a = new DisplayPresets(f);
    assert.ok(a.save("Regata", { "pypilot-newui.showCog": "1" }, 1));
    assert.ok(a.save("Crucero", { "pypilot-newui.showCog": "0" }, 2));
    assert.ok(a.save("Regata", { "pypilot-newui.showCog": "0", "pypilot-newui.dashCorners": "{\"tl\":\"sog\"}" }, 3));
    const b = new DisplayPresets(f);   // reload from disk
    assert.deepEqual(b.list().map((p) => p.name), ["Crucero", "Regata"]);
    assert.equal(b.list()[1].data["pypilot-newui.dashCorners"], "{\"tl\":\"sog\"}");
    assert.equal(b.remove("Crucero"), true);
    assert.deepEqual(new DisplayPresets(f).list().map((p) => p.name), ["Regata"]);
  });

  it("drops unknown keys, rejects empty names, caps the count", () => {
    const p = new DisplayPresets(null);
    const s = p.save("  Noche  ", { "evil.key": "x", "pypilot-newui.showCurrent": "1", "pypilotnewui.helmBar": null });
    assert.equal(s!.name, "Noche");
    assert.deepEqual(s!.data, { "pypilot-newui.showCurrent": "1", "pypilotnewui.helmBar": null });
    assert.equal(p.save("   ", {}), null);
    for (let i = 0; i < MAX_PRESETS + 5; i++) p.save(`p${i}`, {});
    assert.equal(p.list().length, MAX_PRESETS);
  });
});
