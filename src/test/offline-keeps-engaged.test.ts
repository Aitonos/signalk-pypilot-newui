// Rev711 (forum, Moeritsen 2026-11-16; tested on Tunatunes with the link
// to the TinyPilot cut for 75 s): losing pypilot_web does not disengage the
// TinyPilot, it keeps steering. The provider used to report engaged=false,
// so the visor, KIP and Signal K showed "AP off" while it steered.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AutopilotProvider } from "../autopilot-provider";

function makeProvider(engaged: boolean) {
  const client = { connected: true, set: () => true, getValues: () => ({}) };
  const app = { getSelfPath: () => undefined, getCourse: async () => ({}) };
  const p = new AutopilotProvider(client as any, app);
  p.receiveValue("ap.modes", ["compass", "gps", "wind", "true wind"]);
  p.receiveValue("ap.mode", "compass");
  p.receiveValue("ap.enabled", engaged);
  return p;
}

describe("link to pypilot lost (Rev711)", () => {
  it("keeps the last known engaged state, only the state says off-line", () => {
    const p = makeProvider(true);
    assert.equal(p.data.engaged, true);
    p.markOffline();
    assert.equal(p.data.engaged, true);
    assert.equal(p.data.state, "off-line");
  });

  it("a disengaged pilot stays disengaged", () => {
    const p = makeProvider(false);
    p.markOffline();
    assert.equal(p.data.engaged, false);
    assert.equal(p.data.state, "off-line");
  });
});
