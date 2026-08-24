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

// Rev68: after a local target write we ignore pypilot echoes that do not
// match, for up to this many ms. 2 s covers the worst RTT + pypilot apply
// latency observed on Tunatunes (~500-800 ms). See receiveValue for why.
const TARGET_PENDING_MS = 2500;
// Tolerance for treating an echoed heading_command as "the value we asked
// for" vs "stale echo of the previous value". Pypilot stores heading_command
// as float and echoes verbatim in practice, but allow a small margin for
// rounding on the wire.
const TARGET_ECHO_TOL_RAD = 2 * DEG_TO_RAD;

function shortestArcRad(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

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
  // Rev68: echo cancellation for local target writes. See setTarget /
  // adjustTarget / receiveValue.
  private pendingTarget: { value: number; until: number } | null = null;
  // Rev70: same treatment for the engaged flag. Without it, a pypilot
  // ap.enabled=false echo can arrive between our POST /engage and the
  // real echo, flip data.engaged to false, push a SK delta, and the
  // JS button turns off; user re-taps and the AP ends up bouncing.
  private pendingEngaged: { value: boolean; until: number } | null = null;
  // Rev84: onDataChanged accepts an optional "fields" mask so the
  // consumer (pushAutopilotUpdate in index.ts) only publishes the SK
  // paths that actually changed. Without this, setState + setTarget
  // fired in parallel from JS could produce two deltas each carrying
  // both fields; whichever landed second would clobber the other with
  // its now-stale copy of the sibling field (the classic "DIA jumps
  // to 115° then back to 75°" race Carlos reported on Rev82).
  private onDataChanged?: (fields?: "engaged" | "target" | "all") => void;

  constructor(
    private client: PypilotClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private app: any,
    opts?: { allowDodge?: boolean; onDataChanged?: (fields?: "engaged" | "target" | "all") => void }
  ) {
    if (opts?.allowDodge) this.allowDodge = true;
    this.onDataChanged = opts?.onDataChanged;
  }

  private notifyChanged(fields?: "engaged" | "target" | "all"): void {
    try { this.onDataChanged?.(fields || "all"); } catch { /* silent */ }
  }

  // Called from PypilotClient 'value' event. Returns true if apData changed
  // and an autopilotUpdate should be pushed.
  receiveValue(name: string, value: unknown): boolean {
    let changed = false;
    switch (name) {
      case "ap.heading_command":
        if (typeof value === "number") {
          const rad = value * DEG_TO_RAD;
          // Rev68: echo cancellation. When JS pushes a nudge or engage the
          // provider assigns data.target OPTIMISTICALLY and marks pending.
          // Pypilot needs 200-800 ms to apply the set and echo the new
          // heading_command; meanwhile its 2 Hz watch tick may push the
          // OLD value on the wire. Without gating, that stale echo would
          // overwrite data.target and the diamond would jump back to the
          // previous target, then jump forward again when the real echo
          // finally landed. Bug reported by Carlos on Rev67 v2.0.4:
          // "aparece en mal sitio, nudge lo mueve pero se mueve solo
          // luego, hace rebotes".
          if (this.pendingTarget && Date.now() < this.pendingTarget.until) {
            const diff = Math.abs(shortestArcRad(rad, this.pendingTarget.value));
            if (diff <= TARGET_ECHO_TOL_RAD) {
              // Real echo landed - clear pending, keep our value (may be
              // slightly more precise than the echo). No change signal
              // needed since data.target already equals the pending value.
              this.pendingTarget = null;
            }
            // Whether match or stale, do not overwrite data.target inside
            // the pending window.
            break;
          }
          if (rad !== this.data.target) { this.data.target = rad; changed = true; }
        } else if (value === false && this.data.target !== null) {
          this.data.target = null;
          this.pendingTarget = null;
          changed = true;
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
        // Rev70: echo cancellation on the engaged flag. See notes on
        // pendingEngaged. Without this, when the JS button POSTs an
        // engage, pypilot's 2 Hz watch tick may push ap.enabled=false
        // (its OLD stored value) between our set and pypilot's real
        // apply. That stale echo would flip data.engaged back to false,
        // publish a SK delta, and the JS button would grey out
        // momentarily - Carlos re-taps and the whole AP bounces
        // engage-disengage-engage. Ignore echoes that don't match the
        // pending intent while the pending window is open.
        if (this.pendingEngaged && Date.now() < this.pendingEngaged.until) {
          if (eng === this.pendingEngaged.value) {
            this.pendingEngaged = null;
          }
          break;
        }
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
      this.pendingEngaged = null;
      this.pendingTarget = null;
      this.recomputeActions();
    }
  }

  // ---- write path ----

  private async setState(state: string): Promise<boolean> {
    const st = this.data.options.states.find((s) => s.name === state);
    if (!st) throw new Error(`Invalid state: ${state}`);
    // Rev70: optimistic + echo-cancellation on ap.enabled. Same rationale
    // as setTarget: SK subscribers see the ordered engaged state in the
    // same tick as the write, and receiveValue() ignores stale pypilot
    // echoes while pending.
    const eng = st.engaged;
    const apSt: ApState = eng ? "enabled" : "disabled";
    this.data.state = apSt;
    this.data.engaged = eng;
    this.pendingEngaged = { value: eng, until: Date.now() + TARGET_PENDING_MS };
    this.recomputeActions();
    this.client.set("ap.enabled", eng);
    // Rev84: publish ONLY the engaged/state/actions delta - do NOT
    // include target. If setTarget was called in parallel, its own
    // notifyChanged("target") will publish the new target value
    // independently. Publishing target here would carry the STALE
    // apProvider.data.target and clobber JS state.target if this
    // delta happens to land second.
    this.notifyChanged("engaged");
    return eng;
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
    // Rev68: optimistic + echo-cancellation. Assign our authoritative value
    // immediately so downstream SK deltas (and every subscribed UI) snap to
    // the ordered target in the same tick as the write; mark a pending
    // window during which receiveValue() filters stale pypilot echoes.
    this.data.target = rad;
    this.pendingTarget = { value: rad, until: Date.now() + TARGET_PENDING_MS };
    this.client.set("ap.heading_command", deg);
    // Rev84: publish ONLY the target delta - see setState notes.
    this.notifyChanged("target");
  }

  private async adjustTarget(rad: number): Promise<void> {
    if (this.data.engaged) {
      const base = typeof this.data.target === "number" ? this.data.target : 0;
      const newRad = base + rad;
      this.data.target = newRad;
      this.pendingTarget = { value: newRad, until: Date.now() + TARGET_PENDING_MS };
      this.client.set("ap.heading_command", newRad * RAD_TO_DEG);
      // Rev84: publish ONLY the target delta.
      this.notifyChanged("target");
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
