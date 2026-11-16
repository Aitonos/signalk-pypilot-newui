// Rev713 (KIP test on Tunatunes 2026-11-16): KIP's Switch Panel sent each
// tap twice, 120-130 ms apart, and in compass mode each one tacked: 100 + 100
// deg. A second tack within 3 s of the previous one is refused, whatever the
// client.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AutopilotProvider } from "../autopilot-provider";

const D = Math.PI / 180;

function makeProvider() {
  const values: Record<string, unknown> = {};
  const client = { connected: true, healthy: true, set(n: string, v: unknown) { values[n] = v; return true; }, getValues: () => values };
  const app = { getSelfPath: () => undefined, getCourse: async () => ({}) };
  const p = new AutopilotProvider(client as any, app);
  p.receiveValue("ap.modes", ["compass", "gps", "wind", "true wind"]);
  p.receiveValue("ap.mode", "compass");
  p.receiveValue("ap.enabled", true);
  p.receiveValue("ap.heading_command", 120);
  return p;
}

describe("a tack sent twice (Rev713)", () => {
  it("the second tack within 3 s is refused and the course turns once", async () => {
    const p = makeProvider();
    const iface = p.toProviderInterface() as any;
    await iface.tack("starboard", "_default");
    const afterFirst = p.data.target as number;
    assert.ok(Math.abs(afterFirst - 120 * D) > 1 * D, "the first tack moved the target");
    await assert.rejects(iface.tack("starboard", "_default"), /less than 3 s/);
    assert.equal(p.data.target, afterFirst);
  });
});
