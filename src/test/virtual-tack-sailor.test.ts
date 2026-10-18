// Rev506 (Carlos sea trial 2026-10-18): the sailor always wins over a
// running virtual tack.
//   - taking the AP off (our order OR pypilot / remote / KIP) annuls it;
//   - +-1/+-10 move its final destination instead of being rejected;
//   - nothing keeps driving pypilot after the annul ("comandos fantasma").
// Uses a small simulated pypilot: the hull turns towards heading_command
// in compass mode, the wind direction is fixed, AWA derives from heading.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AutopilotProvider } from "../autopilot-provider";

const D = Math.PI / 180;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const wrapDeg = (d: number) => ((d % 360) + 360) % 360;
const signedDeg = (d: number) => ((d + 540) % 360) - 180;

function makeSim(opts: { twdDeg: number; headingDeg: number; turnDegPerTick?: number }) {
  const values: Record<string, unknown> = {
    "ap.enabled": true, "ap.mode": "wind", "ap.heading_command": 0,
  };
  let headingDeg = opts.headingDeg;
  const writes: Array<{ t: number; name: string; value: unknown }> = [];
  let provider: AutopilotProvider | null = null;
  const awaDeg = () => signedDeg(opts.twdDeg - headingDeg);
  const client = {
    connected: true,
    set(name: string, value: unknown) {
      writes.push({ t: Date.now(), name, value });
      values[name] = value;
      // pypilot echoes asynchronously
      setTimeout(() => provider?.receiveValue(name, value), 5);
      return true;
    },
    getValues: () => values,
  };
  const app = {
    getSelfPath(path: string) {
      const ts = new Date().toISOString();
      if (path === "navigation.headingTrue") return { value: wrapDeg(headingDeg) * D, timestamp: ts };
      if (path === "environment.wind.angleApparent" || path === "environment.wind.angleTrueWater") {
        return { value: awaDeg() * D, timestamp: ts };
      }
      return undefined;
    },
  };
  const step = opts.turnDegPerTick ?? 6;
  const timer = setInterval(() => {
    if (values["ap.enabled"] !== true) return;
    const mode = String(values["ap.mode"]);
    const cmd = Number(values["ap.heading_command"]);
    let err: number;
    if (mode === "compass") err = signedDeg(cmd - headingDeg);
    else err = -signedDeg(cmd - awaDeg()); // wind: AWA target, bow opposite
    if (Math.abs(err) > 0.5) headingDeg += Math.sign(err) * Math.min(step, Math.abs(err));
  }, 20);
  return {
    client, app, writes, values,
    heading: () => wrapDeg(headingDeg),
    awa: awaDeg,
    attach(p: AutopilotProvider) {
      provider = p;
      p.receiveValue("ap.modes", ["compass", "gps", "wind", "true wind"]);
      p.receiveValue("ap.enabled", true);
      p.receiveValue("ap.mode", "wind");
      p.receiveValue("ap.heading_command", awaDeg());
    },
    stop: () => clearInterval(timer),
  };
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(20); }
  return cond();
}

describe("virtual tack - the sailor always wins (Rev506)", () => {
  it("taking the AP off annuls the tack and nothing keeps writing to pypilot", async () => {
    // Close-hauled starboard tack: wind from 0°, heading 315° -> AWA +45°.
    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 1 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "starboard" });
      assert.equal(p.isVirtualTackActive(), true);
      await waitFor(() => p.getVirtualTackState()?.phase === "turning", 2000);
      await (p.toProviderInterface() as any).disengage("_default");
      const done = await waitFor(() => !p.isVirtualTackActive(), 3000);
      assert.ok(done, "tack must end after the AP is taken off");
      assert.equal(p.getVirtualTackState()?.phase, "cancelled");
      // No ghost: after the annul settles, no further writes for 1.5 s.
      await sleep(300);
      const n = sim.writes.length;
      await sleep(1500);
      assert.equal(sim.writes.length, n, "no writes to pypilot after the tack is annulled");
      assert.equal(sim.values["ap.enabled"], false);
    } finally { sim.stop(); }
  });

  it("AP off coming from pypilot itself (or a remote) also annuls the tack", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 1 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "starboard" });
      await waitFor(() => p.getVirtualTackState()?.phase === "turning", 2000);
      sim.values["ap.enabled"] = false;
      p.receiveValue("ap.enabled", false);   // external, no order of ours
      assert.ok(await waitFor(() => !p.isVirtualTackActive(), 3000));
      assert.equal(p.getVirtualTackState()?.phase, "cancelled");
    } finally { sim.stop(); }
  });

  it("+-10 during the tack move the final destination (no rejection)", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 3 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "starboard" });
      await waitFor(() => p.getVirtualTackState()?.phase === "turning", 2000);
      const g = p.getVirtualTackState()!.geometry!;
      // Two "+10" taps (bow to starboard): final heading +20°.
      assert.equal(p.adjustVirtualTack(10 * D), true);
      assert.equal(p.adjustVirtualTack(10 * D), true);
      const ok = await waitFor(() => p.getVirtualTackState()?.phase === "completed", 15000);
      assert.ok(ok, `tack completes (phase=${p.getVirtualTackState()?.phase})`);
      const expectedWind = signedDeg(g.angleNewRad / D - 20);
      const cmd = Number(sim.values["ap.heading_command"]);
      assert.ok(Math.abs(signedDeg(cmd - expectedWind)) < 1.5,
        `final wind target ${cmd.toFixed(1)} should be ${expectedWind.toFixed(1)} (mirror - 20)`);
      assert.equal(sim.values["ap.mode"], "wind");
    } finally { sim.stop(); }
  });

  it("adjust is refused when no tack is running (visor falls back to a normal nudge)", () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      assert.equal(p.adjustVirtualTack(10 * D), false);
    } finally { sim.stop(); }
  });
});
