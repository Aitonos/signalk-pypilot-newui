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

function makeSim(opts: { twdDeg: number; headingDeg: number; turnDegPerTick?: number; compassStallDeg?: number; modeChangeClobberDeg?: number }) {
  const values: Record<string, unknown> = {
    "ap.enabled": true, "ap.mode": "wind", "ap.heading_command": 0,
  };
  let headingDeg = opts.headingDeg;
  const writes: Array<{ t: number; name: string; value: unknown; headingDeg: number }> = [];
  let provider: AutopilotProvider | null = null;
  const awaDeg = () => signedDeg(opts.twdDeg - headingDeg);
  const client = {
    connected: true,
    set(name: string, value: unknown) {
      writes.push({ t: Date.now(), name, value, headingDeg });
      const modeChanged = name === "ap.mode" && values["ap.mode"] !== value;
      values[name] = value;
      // pypilot "keeps the heading" on a mode change, in its own loop,
      // overwriting whatever heading_command just arrived (2026-10-19).
      if (modeChanged && typeof opts.modeChangeClobberDeg === "number") {
        setTimeout(() => {
          values["ap.heading_command"] = opts.modeChangeClobberDeg;
          provider?.receiveValue("ap.heading_command", opts.modeChangeClobberDeg);
        }, 120);
      }
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
    if (mode === "compass") {
      err = signedDeg(cmd - headingDeg);
      // Weather helm: the hull stops short of the compass target.
      if (opts.compassStallDeg && Math.abs(err) <= opts.compassStallDeg) err = 0;
    }
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

  it("Rev508: a recovery cycle keeps the tack alive, re-engages, and is not 'external'", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 1 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    let external = 0;
    p.onExternalDisengage = () => { external++; };
    try {
      await p.startVirtualTack({ direction: "starboard" });
      await waitFor(() => p.getVirtualTackState()?.phase === "turning", 2000);
      const r = await p.recoveryCycle(100);
      assert.equal(r, "done");
      assert.equal(p.isVirtualTackActive(), true, "the cycle must not annul the tack");
      const enabledWrites = sim.writes.filter((w) => w.name === "ap.enabled").map((w) => w.value);
      assert.deepEqual(enabledWrites, [false, true]);
      await sleep(200);
      assert.equal(sim.values["ap.enabled"], true);
      assert.equal(external, 0);
    } finally { sim.stop(); }
  });

  it("Rev508: an order during the recovery gap wins (no re-engage)", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      const cyc = p.recoveryCycle(300);
      await sleep(100);
      await (p.toProviderInterface() as any).disengage("_default");
      assert.equal(await cyc, "aborted");
      await sleep(400);
      assert.equal(sim.values["ap.enabled"], false);
    } finally { sim.stop(); }
  });

  it("Rev508: AP off from outside the app reports an external disengage", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    let external = 0;
    p.onExternalDisengage = () => { external++; };
    try {
      p.receiveValue("ap.enabled", false);
      assert.equal(external, 1);
    } finally { sim.stop(); }
  });

  it("Rev515: cancel keeps our target even if pypilot overwrites it on the mode change", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 1, modeChangeClobberDeg: 4 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "starboard" });
      await waitFor(() => p.getVirtualTackState()?.phase === "turning", 2000);
      await sleep(300);
      p.cancelVirtualTack();
      assert.ok(await waitFor(() => !p.isVirtualTackActive(), 6000));
      await sleep(200);
      const cmd = Number(sim.values["ap.heading_command"]);
      assert.equal(sim.values["ap.mode"], "wind");
      assert.ok(Math.abs(cmd - 4) > 5, `target must not stay at pypilot's 4 deg (got ${cmd})`);
      assert.ok(Math.abs(signedDeg(cmd - sim.awa())) < 15, `target ~ current AWA (${cmd} vs ${sim.awa().toFixed(0)})`);
    } finally { sim.stop(); }
  });

  it("Rev522: the first ap.enabled=false after (re)connect is not an external disengage", () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    let external = 0;
    p.onExternalDisengage = () => { external++; };
    try {
      p.receiveValue("ap.modes", ["compass", "wind"]);
      p.receiveValue("ap.enabled", false);   // initial sync, never engaged
      assert.equal(external, 0);
    } finally { sim.stop(); }
  });

  it("Rev532: the handover to wind keeps the final target even if pypilot overwrites it", async () => {
    const o: { twdDeg: number; headingDeg: number; turnDegPerTick: number; modeChangeClobberDeg?: number } = { twdDeg: 0, headingDeg: 315, turnDegPerTick: 6 };
    const sim = makeSim(o);
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "starboard" });
      assert.ok(await waitFor(() => p.getVirtualTackState()?.phase === "turning", 3000));
      o.modeChangeClobberDeg = 4;   // pypilot overwrites on the way back to wind
      assert.ok(await waitFor(() => p.getVirtualTackState()?.phase === "settling", 15000), "reaches settling");
      await sleep(200);
      const cmd = Number(sim.values["ap.heading_command"]);
      assert.equal(sim.values["ap.mode"], "wind");
      assert.ok(Math.abs(cmd - (-45)) < 3, `final target -45 on the new tack, not pypilot's 4 (got ${cmd})`);
      p.cancelVirtualTack();
      await waitFor(() => !p.isVirtualTackActive(), 6000);
    } finally { sim.stop(); }
  });

  it("Rev532: +-10 from KIP / the SK API during a tack re-aims it, no direct target write", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 1 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "starboard" });
      await waitFor(() => p.getVirtualTackState()?.phase === "turning", 2000);
      await (p.toProviderInterface() as any).adjustTarget(10 * D, "_default");
      assert.ok(Math.abs((p.getVirtualTackState() as any).adjustRad - 10 * D) < 1e-9, "goes to the tack's adjust");
      p.cancelVirtualTack();
      await waitFor(() => !p.isVirtualTackActive(), 6000);
    } finally { sim.stop(); }
  });

  it("Rev532: a second tack order from the API does not restart a running tack", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315, turnDegPerTick: 1 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await (p.toProviderInterface() as any).tack("starboard", "_default");
      const id = p.getVirtualTackState()?.id;
      assert.ok(id);
      await assert.rejects((p.toProviderInterface() as any).tack("starboard", "_default"));
      assert.equal(p.getVirtualTackState()?.id, id, "same manoeuvre");
      p.cancelVirtualTack();
      await waitFor(() => !p.isVirtualTackActive(), 6000);
    } finally { sim.stop(); }
  });

  it("Rev532: an 'off' from the remote inside the engage echo window is not lost", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    // pypilot that does not echo our engage (it is switched off from the remote first)
    const quiet = { ...sim.client, set(name: string, value: unknown) { sim.values[name] = value; return true; } };
    const p = new AutopilotProvider(quiet as any, sim.app);
    p.receiveValue("ap.modes", ["compass", "wind"]);
    p.receiveValue("ap.enabled", false);
    p.receiveValue("ap.mode", "compass");
    try {
      await (p.toProviderInterface() as any).engage("_default");
      assert.equal(p.data.engaged, true, "optimistic engage");
      p.receiveValue("ap.enabled", true);    // pypilot applies it
      p.receiveValue("ap.enabled", false);   // ...and the remote takes it off at once
      await sleep(3000);
      assert.equal(p.data.engaged, false, "reconciled to pypilot's last value");
    } finally { sim.stop(); }
  });

  it("Rev532: a target retry is dropped when the mode changes in between", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    let fail = true;
    const flaky = { ...sim.client, set(name: string, value: unknown) {
      if (name === "ap.heading_command" && fail) { fail = false; return false; }
      return sim.client.set(name, value);
    } };
    const p = new AutopilotProvider(flaky as any, sim.app);
    sim.attach(p);
    try {
      p.receiveValue("ap.mode", "compass");
      const t = (p.toProviderInterface() as any).setTarget(120 * D, "_default").catch(() => "aborted");
      await sleep(50);
      await (p.toProviderInterface() as any).setMode("wind", "_default");
      assert.equal(await t, "aborted");
      const late = sim.writes.filter((w) => w.name === "ap.heading_command" && Number(w.value) === 120);
      assert.equal(late.length, 0, "the compass 120 never reaches pypilot as AWA 120");
    } finally { sim.stop(); }
  });

  it("Rev532: compass targets go out in 0..360 (tack from 120 to starboard = 220, -10 at 005 = 355)", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 120 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      p.receiveValue("ap.mode", "compass");
      p.receiveValue("ap.heading_command", 120);
      await (p.toProviderInterface() as any).tack("starboard", "_default");
      const last = () => Number(sim.writes.filter((w) => w.name === "ap.heading_command").at(-1)?.value);
      assert.ok(Math.abs(last() - 220) < 0.01, `got ${last()}`);
    } finally { sim.stop(); }
    const sim2 = makeSim({ twdDeg: 0, headingDeg: 5 });
    const p2 = new AutopilotProvider(sim2.client as any, sim2.app);
    sim2.attach(p2);
    try {
      p2.receiveValue("ap.mode", "compass");
      p2.receiveValue("ap.heading_command", 5);
      await (p2.toProviderInterface() as any).adjustTarget(-10 * D, "_default");
      const last2 = Number(sim2.writes.filter((w) => w.name === "ap.heading_command").at(-1)?.value);
      assert.ok(Math.abs(last2 - 355) < 0.01, `got ${last2}`);
    } finally { sim2.stop(); }
  });

  it("Rev532: a late echo of the old target does not revert a nudge", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    const quiet = { ...sim.client, set(name: string, value: unknown) { sim.values[name] = value; return true; } };
    const p = new AutopilotProvider(quiet as any, sim.app);
    p.receiveValue("ap.modes", ["compass", "wind"]);
    p.receiveValue("ap.enabled", true);
    p.receiveValue("ap.mode", "wind");
    p.receiveValue("ap.heading_command", 40);
    try {
      await (p.toProviderInterface() as any).adjustTarget(1 * D, "_default");
      p.receiveValue("ap.heading_command", 40);     // stale watch tick
      assert.ok(Math.abs((p.data.target as number) - 41 * D) < 1e-6, "still 41");
      await (p.toProviderInterface() as any).adjustTarget(1 * D, "_default");
      assert.ok(Math.abs((p.data.target as number) - 42 * D) < 1e-6, "second +1 counts from 41");
    } finally { sim.stop(); }
  });

  it("Rev542: three quick +1 (KIP) and pypilot's late echoes 40, 41, 42 do not pull the target back", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    const quiet = { ...sim.client, set(name: string, value: unknown) { sim.values[name] = value; return true; } };
    const p = new AutopilotProvider(quiet as any, sim.app);
    p.receiveValue("ap.modes", ["compass", "wind"]);
    p.receiveValue("ap.enabled", true);
    p.receiveValue("ap.mode", "wind");
    p.receiveValue("ap.heading_command", 40);
    try {
      for (let i = 0; i < 3; i++) await (p.toProviderInterface() as any).adjustTarget(1 * D, "_default");
      for (const e of [40, 41, 42]) {
        p.receiveValue("ap.heading_command", e);
        assert.ok(Math.abs((p.data.target as number) - 43 * D) < 1e-6, `stays 43 after echo ${e}`);
      }
      p.receiveValue("ap.heading_command", 60);   // a real external change is still taken
      assert.ok(Math.abs((p.data.target as number) - 60 * D) < 1e-6);
    } finally { sim.stop(); }
  });

  it("Rev543: our echo merged away, only the remote's 40 arrives -> target follows pypilot after the window", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 315 });
    const quiet = { ...sim.client, set(name: string, value: unknown) { sim.values[name] = value; return true; } };
    const p = new AutopilotProvider(quiet as any, sim.app);
    p.receiveValue("ap.modes", ["compass", "wind"]);
    p.receiveValue("ap.enabled", true);
    p.receiveValue("ap.mode", "wind");
    p.receiveValue("ap.heading_command", 40);
    try {
      await (p.toProviderInterface() as any).adjustTarget(10 * D, "_default");
      p.receiveValue("ap.heading_command", 40);   // looks like ours (the value we replaced)
      assert.ok(Math.abs((p.data.target as number) - 50 * D) < 1e-6, "held during the window");
      await sleep(2900);
      assert.ok(Math.abs((p.data.target as number) - 40 * D) < 1e-6, "then pypilot's real value");
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

describe("long-way gybe needs confirmation (Rev511)", () => {
  it("18:11:44 case: right after a cancel, AWA +41, port button -> refused without confirm", async () => {
    // Wind from 0 deg, heading 319 -> AWA +41 (wind on starboard bow).
    const sim = makeSim({ twdDeg: 0, headingDeg: 319 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "starboard" });
      p.cancelVirtualTack();
      await waitFor(() => !p.isVirtualTackActive(), 3000);
      const writesBefore = sim.writes.length;
      await assert.rejects(p.startVirtualTack({ direction: "port" }), (e: any) => e.code === "confirm_long_jibe" && Math.abs(e.deltaDeg) > 180);
      assert.equal(p.isVirtualTackActive(), false);
      assert.equal(sim.writes.length, writesBefore, "nothing sent to pypilot");
      await p.startVirtualTack({ direction: "port", confirmLongJibe: true });
      assert.equal(p.isVirtualTackActive(), true);
      await p.cancelVirtualTack();
      await waitFor(() => !p.isVirtualTackActive(), 3000);
    } finally { sim.stop(); }
  });

  it("Rev515: a deliberate long gybe (no recent cancel) does not ask", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 319 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "port" });
      assert.equal(p.isVirtualTackActive(), true);
      p.cancelVirtualTack();
      await waitFor(() => !p.isVirtualTackActive(), 3000);
    } finally { sim.stop(); }
  });

  it("a normal tack and a gybe from a broad reach never ask", async () => {
    const sim = makeSim({ twdDeg: 0, headingDeg: 319 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    try {
      await p.startVirtualTack({ direction: "starboard" });
      assert.equal(p.isVirtualTackActive(), true);
      await p.cancelVirtualTack();
      await waitFor(() => !p.isVirtualTackActive(), 3000);
    } finally { sim.stop(); }
    // Broad reach: wind from 0, heading 210 -> AWA +150; gybe = 60 deg.
    const sim2 = makeSim({ twdDeg: 0, headingDeg: 210 });
    const p2 = new AutopilotProvider(sim2.client as any, sim2.app);
    sim2.attach(p2);
    try {
      await p2.startVirtualTack({ direction: "port" });
      assert.equal(p2.isVirtualTackActive(), true);
      await p2.cancelVirtualTack();
      await waitFor(() => !p2.isVirtualTackActive(), 3000);
    } finally { sim2.stop(); }
  });
});
