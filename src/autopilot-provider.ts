// Autopilot Provider adapter. When props.absorbProvider is on, this plugin
// registers itself with the SK server as an autopilot provider, in addition
// to its own steering.autopilot.pypilot.* paths. Purpose: eliminate the
// duplicate socket to pypilot_web that occurs when both this plugin and the
// official pypilot-autopilot-provider are enabled.
//
// Translation semantics of engage / setMode / setTarget / tack / dodge come
// from the official pypilot-autopilot-provider (Apache-2.0, Panaaj). We
// re-implemented them here on top of our own PypilotClient so we keep a
// single socket to pypilot_web. See NOTICE + CHANGELOG for attribution.

import { PypilotClient } from "./pypilot-client";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type ApState = "enabled" | "disabled" | "off-line" | "standby" | "auto";

export interface ApAction {
  id: string;
  name: string;
  available: boolean;
}

export interface ApData {
  state: ApState;
  mode: string | null;
  target: number | null; // radians
  engaged: boolean;
  options: {
    states: Array<{ name: string; engaged: boolean }>;
    modes: string[];
    actions: ApAction[];
  };
}

export class AutopilotProvider {
  readonly deviceId = "pypilot-newui";
  readonly pilotIds = ["pypilot-newui"];

  data: ApData = {
    state: "off-line",
    mode: null,
    target: null,
    engaged: false,
    options: {
      states: [
        { name: "enabled", engaged: true },
        { name: "disabled", engaged: false },
      ],
      modes: [],
      actions: [
        { id: "tack", name: "Tack", available: false },
        { id: "courseCurrentPoint", name: "To Destination", available: false },
      ],
    },
  };

  private pypilotModes: string[] = [];
  private allowDodge = false;

  constructor(
    private client: PypilotClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private app: any,
    opts?: { allowDodge?: boolean }
  ) {
    if (opts?.allowDodge) this.allowDodge = true;
  }

  // Called from PypilotClient 'value' event. Returns true if apData changed
  // and an autopilotUpdate should be pushed.
  receiveValue(name: string, value: unknown): boolean {
    let changed = false;
    switch (name) {
      case "ap.heading_command":
        if (typeof value === "number") {
          const rad = value * DEG_TO_RAD;
          if (rad !== this.data.target) { this.data.target = rad; changed = true; }
        } else if (value === false && this.data.target !== null) {
          this.data.target = null; changed = true;
        }
        break;
      case "ap.mode":
        if (typeof value === "string" && value !== this.data.mode) {
          this.data.mode = value;
          if (this.data.options.modes.length === 0) {
            this.data.options.modes.push(value);
          }
          changed = true;
        }
        break;
      case "ap.modes":
        if (Array.isArray(value)) {
          this.pypilotModes = value.map(String);
          this.data.options.modes = [...this.pypilotModes];
        }
        break;
      case "ap.enabled": {
        const eng = !!value;
        const st: ApState = eng ? "enabled" : "disabled";
        if (this.data.state !== st || this.data.engaged !== eng) {
          this.data.state = st;
          this.data.engaged = eng;
          changed = true;
        }
        break;
      }
    }
    if (changed) this.recomputeActions();
    return changed;
  }

  markOffline(): void {
    if (this.data.state !== "off-line" || this.data.engaged) {
      this.data.state = "off-line";
      this.data.engaged = false;
      this.recomputeActions();
    }
  }

  // ---- write path ----

  private async setState(state: string): Promise<boolean> {
    const st = this.data.options.states.find((s) => s.name === state);
    if (!st) throw new Error(`Invalid state: ${state}`);
    this.client.set("ap.enabled", st.engaged);
    return st.engaged;
  }

  private async setMode(mode: string): Promise<void> {
    if (
      this.data.options.modes.length > 0 &&
      !this.data.options.modes.includes(mode)
    ) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    this.client.set("ap.mode", mode);
  }

  private async setTarget(rad: number): Promise<void> {
    const deg = rad * RAD_TO_DEG;
    this.client.set("ap.heading_command", deg);
  }

  private async adjustTarget(rad: number): Promise<void> {
    if (this.data.engaged) {
      const base = typeof this.data.target === "number" ? this.data.target : 0;
      const newRad = base + rad;
      this.client.set("ap.heading_command", newRad * RAD_TO_DEG);
    } else if (this.allowDodge) {
      await this.dodge(rad);
    } else {
      throw new Error("Adjust while disengaged requires allowDirectServo");
    }
  }

  private async tack(direction: "port" | "starboard"): Promise<void> {
    // The upstream provider only writes ap.tack.direction and lets pypilot
    // auto-begin. We explicitly send begin too so the tack starts even on
    // pypilot versions that require it.
    this.client.set("ap.tack.direction", direction);
    this.client.set("ap.tack.state", "begin");
  }

  private async engage(): Promise<void> {
    try {
      await this.setNavMode();
    } catch {
      await this.setState("enabled");
    }
  }

  private async disengage(): Promise<void> {
    await this.setState("disabled");
  }

  private async setNavMode(): Promise<void> {
    const cdata = await this.app.getCourse?.();
    if (
      cdata?.nextPoint &&
      this.getAvailableActionIds().includes("courseCurrentPoint")
    ) {
      await this.setMode("nav");
      setTimeout(() => this.setState("enabled").catch(() => {}), 500);
    } else {
      throw new Error("Nav mode is not available");
    }
  }

  private async dodge(rad: number): Promise<void> {
    if (!this.allowDodge) {
      throw new Error("Dodge requires allowDirectServo=true in plugin config");
    }
    // Simple dodge: emit a servo.command pulse. Upstream watchdogs it every
    // 200 ms for a couple of ticks; we only emit once and let pypilot's own
    // servo watchdog return the rudder to neutral (6 s upstream default).
    const sign = rad > 0 ? 1 : -1;
    this.client.set("servo.command", -sign);
  }

  private recomputeActions(): void {
    for (const a of this.data.options.actions) {
      if (a.id === "tack") {
        a.available = this.data.engaged;
      } else if (a.id === "courseCurrentPoint") {
        a.available = this.data.engaged && this.pypilotModes.includes("nav");
      }
    }
  }

  private getAvailableActionIds(): string[] {
    return this.data.options.actions
      .filter((a) => a.available)
      .map((a) => a.id);
  }

  // Object literal expected by app.registerAutopilotProvider(...).
  toProviderInterface(): Record<string, unknown> {
    const self = this;
    return {
      getData: async (_id: string) => self.data,
      getState: async (_id: string) => self.data.state,
      setState: async (state: string, _id: string) => {
        await self.setState(state);
      },
      getMode: async (_id: string) => self.data.mode,
      setMode: async (mode: string, _id: string) => self.setMode(mode),
      getTarget: async (_id: string) => self.data.target,
      setTarget: async (value: number, _id: string) => self.setTarget(value),
      adjustTarget: async (value: number, _id: string) =>
        self.adjustTarget(value),
      engage: async (_id: string) => self.engage(),
      disengage: async (_id: string) => self.disengage(),
      courseCurrentPoint: async (_id: string) => self.setNavMode(),
      courseNextPoint: async (_id: string) => {
        throw new Error("Not implemented");
      },
      tack: async (direction: "port" | "starboard", _id: string) =>
        self.tack(direction),
      gybe: async (_direction: string, _id: string) => {
        throw new Error("Not implemented");
      },
      dodge: async (value: number, _id: string) => {
        if (value) await self.dodge(value);
        else throw new Error("Not implemented");
      },
    };
  }
}
