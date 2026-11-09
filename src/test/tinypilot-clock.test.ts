// Rev665: give the TinyPilot the server's time after it reboots.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseClockProbe, decideClockSync, setClockCommand } from "../tinypilot-clock";

const probe = { epochS: 1728578298, bootId: "ed0ac2e0-ec48-4dfe-8000-33d0401891c2" };
const now = 1794251318;   // the boat, 2026-11-09: 760 days ahead

describe("TinyPilot clock (Rev665)", () => {
  it("parses the probe output (CRLF from a pty included)", () => {
    assert.deepEqual(parseClockProbe("1728578298\r\ned0ac2e0-ec48-4dfe-8000-33d0401891c2\r\n"), probe);
    assert.equal(parseClockProbe("date: not found\n"), null);
  });

  it("sets the clock when it is clearly wrong and the pilot is off", () => {
    const d = decideClockSync({ probe, serverEpochS: now, syncedBootId: null, engaged: false });
    assert.equal(d.action, "set");
    assert.equal(d.offsetS, now - probe.epochS);
  });

  it("never with the pilot engaged - a clock jump upsets the IMU filter", () => {
    const d = decideClockSync({ probe, serverEpochS: now, syncedBootId: null, engaged: true });
    assert.deepEqual(d, { action: "skip", reason: "engaged", offsetS: now - probe.epochS });
  });

  it("no small corrections, and once per boot", () => {
    assert.equal(decideClockSync({ probe, serverEpochS: probe.epochS + 120, syncedBootId: null, engaged: false }).action, "skip");
    const again = decideClockSync({ probe, serverEpochS: now, syncedBootId: probe.bootId, engaged: false });
    assert.deepEqual(again, { action: "skip", reason: "synced-this-boot", offsetS: now - probe.epochS });
    // a new boot id (it rebooted) is synced again
    assert.equal(decideClockSync({ probe: { ...probe, bootId: "new-boot-id-0000-1111" }, serverEpochS: now, syncedBootId: probe.bootId, engaged: false }).action, "set");
  });

  it("builds the BusyBox command in UTC", () => {
    assert.equal(setClockCommand(new Date(Date.UTC(2026, 10, 9, 19, 8, 38))), 'sudo date -u -s "2026-11-09 19:08:38"');
  });
});
