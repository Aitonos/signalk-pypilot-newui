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

// Rev272 (audit R07): bounded-cost normalisation. The previous while
// loop could spin forever on pathological inputs (e.g. |a-b| >= 1e15
// where 2π is below the mantissa's precision, so subtracting a full
// turn does not change the number). Every call boundary now also
// validates finiteness, but a defensive modular reduction here means
// even a value that slipped through returns in O(1).
function shortestArcRad(a: number, b: number): number {
  const d = a - b;
  if (!Number.isFinite(d)) return 0;
  const twoPi = 2 * Math.PI;
  // Map d to (-π, π] via a single modulo. JavaScript's % keeps the
  // sign of the dividend, so we shift by +π before reducing so the
  // result lands in [0, 2π), then shift back.
  let r = ((d + Math.PI) % twoPi + twoPi) % twoPi;
  return r - Math.PI;
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
  // Rev271 (audit R01+R04): monotonic counter bumped on every
  // engage/disengage intent. Retries that were queued under an older
  // generation abort silently instead of pushing a stale enable/disable
  // to pypilot after a newer one has already landed. Also cancels the
  // 500 ms NAV-mode setTimeout that setNavMode arms, so a disengage
  // during that window cannot be undone by the timer waking up.
  private engageGen = 0;
  private navPendingTimer: NodeJS.Timeout | null = null;
  // Rev272 (audit R06): adjustTarget reads data.target BEFORE awaiting
  // the write, so two concurrent +Δ calls could both start from the
  // same base and lose one increment. Chain them through a single
  // promise so the second call reads the base written by the first.
  private _adjustChain: Promise<unknown> = Promise.resolve();
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

  // Rev255 (Carlos): _setWithRetry tolerates a transient socket
  // hiccup - a socket.io reconnect can drop `.connected` for a few
  // hundred ms. Try the emit up to 3 times with 250 ms + 750 ms
  // backoff before giving up. Total worst-case latency added to a
  // successful order: ~1 s (only when the socket was actually flapping).
  // If all three attempts fail the socket really is offline; the
  // caller then throws so the visor learns the truth instead of
  // reporting a false success.
  private async _setWithRetry(
    name: string,
    value: unknown,
    isStale?: () => boolean,
  ): Promise<boolean> {
    if (this.client.set(name, value)) return true;
    if (isStale && isStale()) return false;
    await new Promise((r) => setTimeout(r, 250));
    if (isStale && isStale()) return false;
    if (this.client.set(name, value)) return true;
    if (isStale && isStale()) return false;
    await new Promise((r) => setTimeout(r, 750));
    if (isStale && isStale()) return false;
    return this.client.set(name, value);
  }

  // Rev271 (audit R01+R04): every engage/disengage intent bumps a
  // generation counter and cancels any pending NAV-mode timer. The
  // async _setWithRetry checks isStale() before each retry, so a
  // disengage that lands during a hanging engage retry (or vice versa)
  // prevents the older order from ever reaching pypilot.
  private _bumpEngageGen(): number {
    this.engageGen += 1;
    if (this.navPendingTimer) {
      clearTimeout(this.navPendingTimer);
      this.navPendingTimer = null;
    }
    return this.engageGen;
  }

  private async setState(state: string): Promise<boolean> {
    const st = this.data.options.states.find((s) => s.name === state);
    if (!st) throw new Error(`Invalid state: ${state}`);
    // Rev70: optimistic + echo-cancellation on ap.enabled. Same rationale
    // as setTarget: SK subscribers see the ordered engaged state in the
    // same tick as the write, and receiveValue() ignores stale pypilot
    // echoes while pending.
    const eng = st.engaged;
    const apSt: ApState = eng ? "enabled" : "disabled";
    // Rev271 (audit R01+R04): bump generation and cancel any NAV
    // pending timer. If this call is superseded before we make it past
    // the retry backoff, the stale isStale() check aborts the retry
    // and we throw without mutating optimistic state.
    const gen = this._bumpEngageGen();
    // Rev254 (Carlos audit): reject the write BEFORE mutating optimistic
    // state if the pypilot socket is offline. Previously the visor was
    // told the order succeeded even though nothing left the plugin.
    // Rev255: retry with backoff to tolerate socket.io reconnects.
    if (!(await this._setWithRetry("ap.enabled", eng, () => this.engageGen !== gen))) {
      if (this.engageGen !== gen) {
        throw new Error("engage/disengage superseded by newer order");
      }
      throw new Error("pypilot offline: engage/disengage not delivered");
    }
    // Rev271: last-check after the successful set - a newer bump could
    // have won the race between the emit and this line. Do not mutate
    // optimistic state in that case; the winner's own setState will.
    if (this.engageGen !== gen) {
      throw new Error("engage/disengage superseded after write");
    }
    this.data.state = apSt;
    this.data.engaged = eng;
    this.pendingEngaged = { value: eng, until: Date.now() + TARGET_PENDING_MS };
    this.recomputeActions();
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
    // Rev254 (Carlos audit): fail explicit when pypilot offline.
    // Rev255: retry with backoff.
    if (!(await this._setWithRetry("ap.mode", mode))) {
      throw new Error("pypilot offline: mode change not delivered");
    }
  }

  private async setTarget(rad: number): Promise<void> {
    // Rev272 (audit R07): reject at the boundary. Downstream callers
    // (pypilot, echo cancellation, shortestArcRad) all assume a finite
    // radian value in a sane range. An integration accidentally
    // handing us Infinity, NaN or an astronomically large radian
    // must fail loud instead of poisoning state.
    if (!Number.isFinite(rad) || Math.abs(rad) > 100) {
      throw new Error(`Invalid target rad: ${rad}`);
    }
    const deg = rad * RAD_TO_DEG;
    // Rev199 (Carlos): trace the values so we can tell whether SK
    // Autopilot API normalises rad to [-pi, pi] BEFORE it reaches us
    // (we ship unnormalised to force pypilot to honour the sailor's
    // side).
    // eslint-disable-next-line no-console
    console.log(`[apProvider.setTarget] rad=${rad.toFixed(4)} deg=${deg.toFixed(2)}`);
    // Rev254 (Carlos audit): reject BEFORE mutating optimistic target.
    // Rev255: retry with backoff.
    if (!(await this._setWithRetry("ap.heading_command", deg))) {
      throw new Error("pypilot offline: target not delivered");
    }
    this.data.target = rad;
    this.pendingTarget = { value: rad, until: Date.now() + TARGET_PENDING_MS };
    this.notifyChanged("target");
  }

  private async adjustTarget(rad: number): Promise<void> {
    // Rev272 (audit R07): reject non-finite deltas at the boundary.
    if (!Number.isFinite(rad) || Math.abs(rad) > 10) {
      throw new Error(`Invalid adjust rad: ${rad}`);
    }
    // Rev272 (audit R06): serialise on the shared chain. base must be
    // read AFTER any pending adjust has committed data.target,
    // otherwise two concurrent +Δ calls both start from the same
    // stale base and collapse into one increment. The chain never
    // rejects (errors are surfaced through the returned promise), so
    // one caller's throw does not poison the next caller's turn.
    const run = async (): Promise<void> => {
      if (this.data.engaged) {
        const base = typeof this.data.target === "number" ? this.data.target : 0;
        const newRad = base + rad;
        // Rev254 (Carlos audit): same reject-before-optimistic guard.
        // Rev255: retry with backoff.
        if (!(await this._setWithRetry("ap.heading_command", newRad * RAD_TO_DEG))) {
          throw new Error("pypilot offline: target adjust not delivered");
        }
        this.data.target = newRad;
        this.pendingTarget = { value: newRad, until: Date.now() + TARGET_PENDING_MS };
        // Rev84: publish ONLY the target delta.
        this.notifyChanged("target");
      } else if (this.allowDodge) {
        await this.dodge(rad);
      } else {
        throw new Error("Adjust while disengaged requires allowDirectServo");
      }
    };
    const next = this._adjustChain.then(run, run);
    // Swallow rejection on the chain slot so the next queued caller
    // still runs. The returned promise (`next`) still rejects for
    // this caller as expected.
    this._adjustChain = next.catch(() => undefined);
    return next;
  }

  private async tack(direction: "port" | "starboard"): Promise<void> {
    // Rev192 (Carlos): synthetic tack. In sea trial on Tunatunes (2026-09-10)
    // pypilot 0.x on the Pi Zero received `ap.tack.state=begin` and looped
    // it straight back to "none" without ever rotating heading_command
    // (traced via journalctl: heading_command stayed at 291.7 deg across
    // three consecutive tack POSTs). Instead of relying on pypilot's own
    // tack primitive, we rotate the target ourselves:
    //   - compass / GPS modes: shift heading_command by tackAngle (default
    //     100 deg from `ap.tack.angle`, capped 30..170), sign per direction.
    //   - wind / true wind modes: flip AWA/TWA sign (target -> -target).
    // The frontend already provides the pre-tack countdown UI + circle-tap
    // cancel, so we do not need pypilot's own delay/state machine.
    if (!this.data.engaged || this.data.target == null) return;
    const values = (this.client as any).getValues?.() || {};
    const rawAngle = values["ap.tack.angle"];
    const tackAngleDeg = (typeof rawAngle === "number" && rawAngle >= 30 && rawAngle <= 170)
      ? rawAngle
      : 100;
    const modeStr = String(this.data.mode || "").toLowerCase();
    const isWind = modeStr.includes("wind");
    let newRad: number;
    if (isWind) {
      newRad = -this.data.target;
    } else {
      const sign = direction === "port" ? -1 : 1;
      newRad = this.data.target + sign * tackAngleDeg * DEG_TO_RAD;
      while (newRad > Math.PI)  newRad -= 2 * Math.PI;
      while (newRad < -Math.PI) newRad += 2 * Math.PI;
    }
    // eslint-disable-next-line no-console
    console.log(`[apProvider.tack] dir=${direction} mode=${modeStr} angle=${tackAngleDeg} tgt ${this.data.target.toFixed(3)} -> ${newRad.toFixed(3)} rad`);
    await this.setTarget(newRad);
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
      // Rev271 (audit R04): snapshot the generation at the moment we
      // arm the delayed engage. A disengage or other setState between
      // now and the timer firing will have bumped the counter, and the
      // timer will simply exit. Cancelling the timer directly (in
      // _bumpEngageGen) is the primary defence; this second check
      // covers the tiny window where the bump happens after our
      // clearTimeout would have fired.
      const gen = this.engageGen;
      if (this.navPendingTimer) clearTimeout(this.navPendingTimer);
      this.navPendingTimer = setTimeout(() => {
        this.navPendingTimer = null;
        if (this.engageGen !== gen) return; // superseded, do nothing
        this.setState("enabled").catch(() => {});
      }, 500);
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
