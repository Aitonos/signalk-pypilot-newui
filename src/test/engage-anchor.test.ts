// Rev709: engaging is heading_command first, then enabled (pypilot's own
// web does it that way; the core keeps the old command in standby). An
// engage through the Signal K API (Freeboard, KIP) used to write only
// ap.enabled, so pypilot went back to the course held before the last
// disengage.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AutopilotProvider } from "../autopilot-provider";

const D = Math.PI / 180;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makeSim(start: Record<string, unknown>) {
  const values: Record<string, unknown> = { ...start };
  const writes: Array<{ name: string; value: unknown }> = [];
  let provider: AutopilotProvider | null = null;
  const client = {
    connected: true,
    set(name: string, value: unknown) {
      writes.push({ name, value });
      values[name] = value;
      setTimeout(() => provider?.receiveValue(name, value), 5);
      return true;
    },
    getValues: () => values,
  };
  const app = { getSelfPath: () => undefined, getCourse: async () => ({}) };
  return {
    client, app, writes, values,
    attach(p: AutopilotProvider) {
      provider = p;
      p.receiveValue("ap.modes", ["compass", "gps", "wind", "true wind"]);
      for (const k of ["ap.enabled", "ap.mode", "ap.heading_command", "ap.heading"]) {
        if (k in values) p.receiveValue(k, values[k]);
      }
    },
  };
}

describe("engage through the Signal K API anchors the current heading (Rev709)", () => {
  it("compass: writes heading_command = current heading before ap.enabled", async () => {
    // Held 90° before the disengage, now hand-steered onto 212°.
    const sim = makeSim({ "ap.enabled": false, "ap.mode": "compass", "ap.heading_command": 90, "ap.heading": 212 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    await (p.toProviderInterface() as any).engage("_default");
    const iCmd = sim.writes.findIndex((w) => w.name === "ap.heading_command");
    const iEn = sim.writes.findIndex((w) => w.name === "ap.enabled" && w.value === true);
    assert.ok(iCmd >= 0, "heading_command written");
    assert.ok(iEn > iCmd, "ap.enabled written after heading_command");
    assert.ok(Math.abs(Number(sim.writes[iCmd].value) - 212) < 0.01, `anchored to 212, got ${sim.writes[iCmd].value}`);
  });

  it("wind: anchors to the wind angle pypilot reports as ap.heading", async () => {
    const sim = makeSim({ "ap.enabled": false, "ap.mode": "wind", "ap.heading_command": 120, "ap.heading": -45 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    await (p.toProviderInterface() as any).engage("_default");
    const cmd = sim.writes.find((w) => w.name === "ap.heading_command");
    assert.ok(cmd && Math.abs(Number(cmd.value) + 45) < 0.01, `anchored to -45, got ${cmd?.value}`);
  });

  it("a target set just before the engage is kept (app sends target, then engage)", async () => {
    const sim = makeSim({ "ap.enabled": false, "ap.mode": "compass", "ap.heading_command": 90, "ap.heading": 212 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    const api = p.toProviderInterface() as any;
    await api.setTarget(250 * D, "_default");
    await sleep(20);
    sim.writes.length = 0;
    await api.engage("_default");
    assert.equal(sim.writes.filter((w) => w.name === "ap.heading_command").length, 0, "no anchor over the target just set");
    assert.ok(Math.abs(Number(sim.values["ap.heading_command"]) - 250) < 0.01);
  });

  it("the visor's AP button (engageCurrentMode) does not anchor: it sends its own target", async () => {
    const sim = makeSim({ "ap.enabled": false, "ap.mode": "compass", "ap.heading_command": 90, "ap.heading": 212 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    await p.engageCurrentMode();
    assert.equal(sim.writes.filter((w) => w.name === "ap.heading_command").length, 0);
  });

  it("already engaged: nothing to anchor", async () => {
    const sim = makeSim({ "ap.enabled": true, "ap.mode": "compass", "ap.heading_command": 90, "ap.heading": 212 });
    const p = new AutopilotProvider(sim.client as any, sim.app);
    sim.attach(p);
    await (p.toProviderInterface() as any).engage("_default");
    assert.equal(sim.writes.filter((w) => w.name === "ap.heading_command").length, 0);
  });
});
