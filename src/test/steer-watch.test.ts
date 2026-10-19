// Rev508: steer-watch - stuck pilot detection and recovery cycles.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SteerWatch, SteerWatchInput, hasDirectionalFault, MAX_CYCLES } from "../steer-watch";

const base = (over: Partial<SteerWatchInput>): SteerWatchInput => ({
  nowMs: 0, engaged: true, errDeg: 0, servoCurrentA: 2, servoFlags: "SYNC",
  nativeTack: false, recoveryEnabled: true, ...over,
});

/** Feeds 1 Hz samples from t0 for n seconds; errAt(sec) gives the error. */
function run(w: SteerWatch, t0: number, n: number, over: (sec: number) => Partial<SteerWatchInput>) {
  const actions: Array<{ sec: number; action: string }> = [];
  for (let s = 0; s < n; s++) {
    const a = w.tick(base({ nowMs: t0 + s * 1000, ...over(s) }));
    if (a) actions.push({ sec: s, action: a });
  }
  return actions;
}

describe("steer-watch (Rev508)", () => {
  it("parses pypilot directional faults only", () => {
    assert.equal(hasDirectionalFault("SYNC BAD_FUSES"), false);
    assert.equal(hasDirectionalFault("SYNC PORT_OVERCURRENT_FAULT"), true);
    assert.equal(hasDirectionalFault("STARBOARD_OVERCURRENT_FAULT SYNC"), true);
    assert.equal(hasDirectionalFault(null), false);
  });

  it("18:20 case: error growing with a directional overcurrent fault -> stuck -> one cycle", () => {
    const w = new SteerWatch();
    // 10 s engaged and fine, then error grows 11 -> 62 with 0 A.
    run(w, 0, 10, () => ({ errDeg: 3 }));
    const acts = run(w, 10_000, 12, (s) => ({ errDeg: 11 + s * 5, servoCurrentA: 0, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(acts.length, 1, JSON.stringify(acts));
    assert.equal(acts[0].action, "cycle");
  });

  it("directional fault flag counts as not pushing even with current noise", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3 }));
    const acts = run(w, 10_000, 12, () => ({ errDeg: 40, servoCurrentA: 0.8, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(acts.length, 1);
  });

  it("rudder hard over in a tack (error falling) is NOT stuck", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3 }));
    // -160 deg, turning 2.5 deg/s, 0 A at the end stop.
    const acts = run(w, 10_000, 30, (s) => ({ errDeg: -160 + s * 2.5, servoCurrentA: 0, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(acts.length, 0);
    assert.equal(w.snapshot().stuck, false);
  });

  it("servo working hard (current flowing, no fault) is NOT stuck", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3 }));
    const acts = run(w, 10_000, 20, () => ({ errDeg: 45, servoCurrentA: 6 }));
    assert.equal(acts.length, 0);
  });

  it("no cycle in the first seconds after engaging", () => {
    const w = new SteerWatch();
    const acts = run(w, 0, 5, () => ({ errDeg: 60, servoCurrentA: 0, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(acts.length, 0);
  });

  it("at most 3 cycles per minute, >= 10 s apart, then gives up", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3 }));
    // Permanently stuck, error keeps growing slowly.
    const acts = run(w, 10_000, 55, (s) => ({ errDeg: 30 + s, servoCurrentA: 0, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(acts.length, MAX_CYCLES, JSON.stringify(acts));
    for (let k = 1; k < acts.length; k++) assert.ok(acts[k].sec - acts[k - 1].sec >= 10);
    assert.equal(w.snapshot().gaveUp, true);
  });

  it("recovery disabled: alarms (stuck) but never cycles", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3 }));
    const acts = run(w, 10_000, 15, (s) => ({ errDeg: 30 + s * 2, servoCurrentA: 0, recoveryEnabled: false, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(acts.length, 0);
    assert.equal(w.snapshot().stuck, true);
  });

  it("no cycle during pypilot's own tack", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3 }));
    const acts = run(w, 10_000, 15, (s) => ({ errDeg: 30 + s * 2, servoCurrentA: 0, nativeTack: true, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(acts.length, 0);
  });

  it("Rev515: 0 A with DRIVER_TIMEOUT (current not measured) is NOT stuck", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3 }));
    const acts = run(w, 10_000, 20, (s) => ({ errDeg: 30 + s * 3, servoCurrentA: 0, servoFlags: "SYNC ENGAGED BAD_FUSES DRIVER_TIMEOUT SATURATED" }));
    assert.equal(acts.length, 0);
    assert.equal(w.snapshot().stuck, false);
  });

  it("Rev515: 18:53 replay - remote tack in compass, old target kept, then +100 -> no cycle", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 1, cmdDeg: 2 }));
    // waiting + tacking: the hull turns away from the old target (2 deg).
    const errs = [1, 0, -1, -4, -9, -15, -21, -28, -34, -42];
    let t = 10_000;
    for (const e of errs) { assert.equal(w.tick(base({ nowMs: t, errDeg: e, cmdDeg: 2, servoCurrentA: 0, nativeTack: true, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" })), null); t += 1000; }
    // tack done: target jumps to 102, error 51 -> converging. Even with a
    // fault flag the holdoff covers the end of the tack.
    for (const e of [51, 44, 36, 30, 23, 17, 12, 8]) { assert.equal(w.tick(base({ nowMs: t, errDeg: e, cmdDeg: 102, servoCurrentA: 0, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" })), null); t += 1000; }
  });

  it("Rev515: a big target change restarts the stuck clock", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3, cmdDeg: 100 }));
    // 3 s of growing error with a fault, then the sailor sets +90.
    run(w, 10_000, 3, (s) => ({ errDeg: 30 + s, cmdDeg: 100, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    const acts = run(w, 13_000, 3, (s) => ({ errDeg: 90 + s, cmdDeg: 190, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(acts.length, 0, "clock restarted by the new target");
  });

  it("disengaged: nothing happens and the give-up latch clears", () => {
    const w = new SteerWatch();
    run(w, 0, 10, () => ({ errDeg: 3 }));
    run(w, 10_000, 55, (s) => ({ errDeg: 30 + s, servoCurrentA: 0, servoFlags: "SYNC PORT_OVERCURRENT_FAULT" }));
    assert.equal(w.snapshot().gaveUp, true);
    const acts = run(w, 70_000, 5, () => ({ engaged: false, errDeg: 90, servoCurrentA: 0 }));
    assert.equal(acts.length, 0);
    assert.equal(w.snapshot().gaveUp, false);
  });

  it("external disengage underway raises 'dropped' until re-engage or 60 s", () => {
    const w = new SteerWatch();
    w.noteExternalDisengage(1000, 2.5);
    w.tick(base({ nowMs: 2000, engaged: false }));
    assert.equal(w.snapshot().droppedActive, true);
    w.tick(base({ nowMs: 62_000, engaged: false }));
    assert.equal(w.snapshot().droppedActive, false);
    w.noteExternalDisengage(70_000, 2.5);
    w.tick(base({ nowMs: 71_000, engaged: true }));
    assert.equal(w.snapshot().droppedActive, false);
  });

  it("Rev522: SOG unknown (no GPS) is not an alarm", () => {
    const w = new SteerWatch();
    w.noteExternalDisengage(1000, null);
    assert.equal(w.snapshot().droppedActive, false);
  });

  it("external disengage moored (SOG < 1 kn) is not an alarm", () => {
    const w = new SteerWatch();
    w.noteExternalDisengage(1000, 0.1);
    assert.equal(w.snapshot().droppedActive, false);
  });
});
