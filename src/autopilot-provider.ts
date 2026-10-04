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
import { decideReAnchor } from "./mode-reanchor";
import {
  computeTackGeometry,
  isAtTarget,
  normalizeTwoPi,
  recomputeRemainingIntermediates,
  DEFAULT_PHASE_TOLERANCE_DEG,
  TackDirection,
  VirtualTackPhase,
  VirtualTackState,
  WindMode,
  makeInitialState as makeVirtualTackInitialState,
} from "./virtual-tack";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// Rev68: after a local target write we ignore pypilot echoes that do not
// match, for up to this many ms. 2 s covers the worst RTT + pypilot apply
// latency observed on Tunatunes (~500-800 ms). See receiveValue for why.
const TARGET_PENDING_MS = 2500;
// Rev280 (audit T02): tightened from 2° to 0.1°. Pypilot echoes
// `heading_command` verbatim; the previous 2° window was wide enough
// that a stale echo of the previous value (e.g. 100°) matched a fresh
// request of 101°, so the visor kept snapping the target back to the
// value the user had just replaced. 0.1° covers float32 → double
// rounding on the wire without accidentally consuming a stale echo.
const TARGET_ECHO_TOL_RAD = 0.1 * DEG_TO_RAD;

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
  // Rev279 (audit follow-up A / B): parallel counters for target and
  // mode writes. Bumped on every setTarget / setMode / adjustTarget
  // and consulted by the retry loop, so a stale write that was
  // waiting to retry aborts before overwriting a newer intent. R01
  // only protected ap.enabled; these close the same class of race
  // on the two other write paths.
  private targetGen = 0;
  private modeGen = 0;
  // Rev378 (Carlos, 2026-10-01): virtual-tack FSM state. Non-null while
  // a two-phase (compass → wind) tack is in progress or recently
  // completed. See src/virtual-tack.ts for geometry + types, and
  // _runVirtualTack below for the driver that advances it.
  private _virtualTack: VirtualTackState | null = null;
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
  private onDataChanged?: (fields?: "engaged" | "target" | "all" | "virtualTack") => void;
  // Rev350 (Carlos, 2026-09-29): optional callback that receives
  // per-frontier observability events. Wired to ManeuverTraceLog
  // in index.ts when the trace is enabled. No-op when undefined so
  // the provider stays cheap in production runs with trace OFF.
  private onStageEvent?: (stage: string, event: Record<string, unknown>) => void;

  constructor(
    private client: PypilotClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private app: any,
    opts?: {
      allowDodge?: boolean;
      onDataChanged?: (fields?: "engaged" | "target" | "all" | "virtualTack") => void;
      onStageEvent?: (stage: string, event: Record<string, unknown>) => void;
    }
  ) {
    if (opts?.allowDodge) this.allowDodge = true;
    this.onDataChanged = opts?.onDataChanged;
    this.onStageEvent = opts?.onStageEvent;
  }

  private notifyChanged(fields?: "engaged" | "target" | "all" | "virtualTack"): void {
    try { this.onDataChanged?.(fields || "all"); } catch { /* silent */ }
  }

  // Called from PypilotClient 'value' event. Returns the field that
  // changed (so the caller can push a field-scoped delta and avoid
  // dragging siblings with stale values), or null if nothing changed.
  //
  // Rev352 (Carlos, 2026-09-30, trace analysis): previously returned
  // boolean and the caller line 729 defaulted to fields="all" — that
  // emitted state+engaged+target+mode+availableActions with whatever
  // apProvider.data held at that instant. When pypilot took seconds
  // to echo an engage (external tack from mando/nativo), any other
  // pypilot value arriving in the meantime triggered fields="all"
  // publishes with the stale engaged=false. The next echo produced
  // fields="all" with engaged=true, but subscription manager's
  // minPeriod:500 collapsed the pair and the visor saw only false.
  // Field-scoping the push kills the collision at source.
  receiveValue(name: string, value: unknown): "engaged" | "target" | "all" | null {
    let changed = false;
    let changedField: "engaged" | "target" | "all" | null = null;
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
              this.onStageEvent?.("provider", {
                path: "ap.heading_command",
                decision: "echo_dropped_match",
                reason: "diff_within_tol",
                rawValue: value,
                normalizedValue: rad,
                pendingValue: this.pendingTarget.value,
                diffRad: diff,
              });
              this.pendingTarget = null;
              break;
            }
            // Rev350 (Carlos, 2026-09-29, cross-check LLM audit): diff
            // GRANDE dentro de la ventana pending. Antes: descartábamos
            // el valor y no limpiábamos pending → si pypilot no volvía
            // a publicar tras el drop, data.target quedaba rancio hasta
            // que expiraba pending Y pypilot re-emitía. Confirmado por
            // GPT-Codex: "la ventana dura 2.5 s pero el valor descartado
            // puede perderse indefinidamente". Ver memoria
            // [[backend-echo-cancel-drops-external-override]].
            //
            // Ahora: interpretamos diff > TOL como OVERRIDE EXTERNO
            // genuino (mando físico / UI nativo cambió target mientras
            // nuestra escritura estaba pendiente). Aplicamos el valor,
            // liberamos el gate, notificamos cambio. El caso Rev68
            // original (echo con mismo valor) sigue funcionando: cae en
            // la rama `<= TOL` y limpia pending sin cambiar target.
            const pendingSnap = this.pendingTarget.value;
            this.pendingTarget = null;
            this.onStageEvent?.("provider", {
              path: "ap.heading_command",
              decision: "external_override_applied",
              reason: "diff_over_tol_in_pending_window",
              rawValue: value,
              normalizedValue: rad,
              pendingValue: pendingSnap,
              diffRad: diff,
            });
            if (rad !== this.data.target) { this.data.target = rad; changed = true; changedField = "target"; }
            break;
          }
          {
            const prev = this.data.target;
            if (rad !== prev) { this.data.target = rad; changed = true; changedField = "target"; }
            this.onStageEvent?.("provider", {
              path: "ap.heading_command",
              decision: changed ? "accepted_change" : "accepted_noop",
              reason: "no_pending_window",
              rawValue: value,
              normalizedValue: rad,
              prevValue: prev,
            });
          }
        } else if (value === false && this.data.target !== null) {
          const prev = this.data.target;
          this.data.target = null;
          this.pendingTarget = null;
          changed = true;
          changedField = "target";
          this.onStageEvent?.("provider", {
            path: "ap.heading_command",
            decision: "accepted_change",
            reason: "value_false_cleared_target",
            rawValue: value,
            prevValue: prev,
          });
        }
        break;
      case "ap.mode":
        if (typeof value === "string") {
          const prev = this.data.mode;
          if (value !== prev) {
            this.data.mode = value;
            if (this.data.options.modes.length === 0) {
              this.data.options.modes.push(value);
            }
            changed = true;
            // Rev352: mode change also affects recomputeActions (some
            // actions like courseCurrentPoint gate on mode). Push "all"
            // so state+engaged+target+mode+availableActions stay in
            // sync. This IS a genuine multi-field change, not a
            // spurious drag.
            changedField = "all";
          }
          this.onStageEvent?.("provider", {
            path: "ap.mode",
            decision: changed ? "accepted_change" : "accepted_noop",
            rawValue: value,
            prevValue: prev,
          });
        }
        break;
      case "ap.modes":
        if (Array.isArray(value)) {
          this.pypilotModes = value.map(String);
          this.data.options.modes = [...this.pypilotModes];
          // Rev280 (audit T16): the "courseCurrentPoint" action's
          // availability depends on pypilotModes.includes("nav"), so
          // a late-arriving ap.modes payload (typical: pypilot
          // publishes it once its config loader has finished, a few
          // seconds after the initial catalog) must trigger a fresh
          // recomputeActions and a delta push. Previously the action
          // stayed unavailable until the next engage/disengage.
          this.recomputeActions();
          changed = true;
          changedField = "all";
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
          const pendVal = this.pendingEngaged.value;
          if (eng === pendVal) {
            this.pendingEngaged = null;
            this.onStageEvent?.("provider", {
              path: "ap.enabled",
              decision: "echo_dropped_match",
              rawValue: value,
              normalizedValue: eng,
              pendingValue: pendVal,
            });
          } else {
            this.onStageEvent?.("provider", {
              path: "ap.enabled",
              decision: "echo_dropped_stale",
              rawValue: value,
              normalizedValue: eng,
              pendingValue: pendVal,
            });
          }
          break;
        }
        const st: ApState = eng ? "enabled" : "disabled";
        const prevState = this.data.state;
        const prevEngaged = this.data.engaged;
        if (this.data.state !== st || this.data.engaged !== eng) {
          this.data.state = st;
          this.data.engaged = eng;
          changed = true;
          changedField = "engaged";
        }
        this.onStageEvent?.("provider", {
          path: "ap.enabled",
          decision: changed ? "accepted_change" : "accepted_noop",
          rawValue: value,
          normalizedValue: eng,
          prevValue: prevEngaged,
          prevState,
        });
        break;
      }
    }
    if (changed) this.recomputeActions();
    return changedField;
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
    // Rev351 (Carlos, 2026-09-29, sea-trial QA Rev350): optimist STATE
    // + pending window BEFORE the await. Antes: pendingEngaged sólo se
    // seteaba tras el ACK de pypilot. Durante ese await (~10 s en engage
    // observados por Carlos en localhost), el watch 2 Hz de pypilot
    // seguía emitiendo `ap.enabled=false` (stale) y el receiveValue lo
    // aplicaba como estado real → push SK engaged=false → visor
    // revertía la UI optimista. Disengage no lo sufría porque pypilot
    // aplica disable en < 500 ms y el echo real llegaba inmediato.
    //
    // Fix: setear pendingEngaged + data.state/engaged + notifyChanged
    // ANTES del _setWithRetry, con ventana extendida a 15 s para cubrir
    // el peor caso de latencia pypilot. Si el set falla, revertimos.
    const prevState = this.data.state;
    const prevEngaged = this.data.engaged;
    this.pendingEngaged = { value: eng, until: Date.now() + 15000 };
    this.data.state = apSt;
    this.data.engaged = eng;
    this.recomputeActions();
    // Rev84: publish ONLY the engaged/state/actions delta - do NOT
    // include target. If setTarget was called in parallel, its own
    // notifyChanged("target") will publish the new target value
    // independently. Publishing target here would carry the STALE
    // apProvider.data.target and clobber JS state.target if this
    // delta happens to land second.
    this.notifyChanged("engaged");
    // Rev254 (Carlos audit): reject the write on offline socket.
    // Rev255: retry with backoff to tolerate socket.io reconnects.
    // Rev351: on failure, revert the optimist so the UI reflects
    // reality (unless a newer bump has already overwritten us).
    if (!(await this._setWithRetry("ap.enabled", eng, () => this.engageGen !== gen))) {
      if (this.engageGen === gen) {
        this.pendingEngaged = null;
        this.data.state = prevState;
        this.data.engaged = prevEngaged;
        this.recomputeActions();
        this.notifyChanged("engaged");
      }
      if (this.engageGen !== gen) {
        throw new Error("engage/disengage superseded by newer order");
      }
      throw new Error("pypilot offline: engage/disengage not delivered");
    }
    // Rev271: last-check after the successful set - a newer bump could
    // have won the race between the emit and this line. If superseded,
    // the winning order has already published its own optimist; leave
    // state alone and let the winner's echo reconcile.
    if (this.engageGen !== gen) {
      throw new Error("engage/disengage superseded after write");
    }
    // Rev351: pypilot ACK-eó el set. Reduce la ventana pending al
    // valor normal (2.5 s) porque el eco real llegará en < 1 s típico.
    this.pendingEngaged = { value: eng, until: Date.now() + TARGET_PENDING_MS };
    return eng;
  }

  private async setMode(mode: string): Promise<void> {
    // Rev390: same guard as setTarget — reject external mode changes
    // while the FSM is driving. If the sailor really wants to abort
    // the maneuver, they tap TACK a second time or call /virtual-tack/
    // cancel, which flows through cancelVirtualTack and rolls back
    // cleanly.
    if (this._virtualTack && !this._vtInternalWrite) {
      const active = this._virtualTack.phase !== "idle"
        && this._virtualTack.phase !== "completed"
        && this._virtualTack.phase !== "cancelled"
        && this._virtualTack.phase !== "failed";
      if (active) {
        // eslint-disable-next-line no-console
        console.log(`[virtual-tack] rejected external setMode '${mode}' (FSM is driving)`);
        return;
      }
    }
    if (
      this.data.options.modes.length > 0 &&
      !this.data.options.modes.includes(mode)
    ) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    // Rev292 (Carlos, navigating - bug C "piloto girando loco"):
    // snapshot the OLD mode so we can decide whether the transition
    // needs a heading_command re-anchor. Pypilot's ap.heading_command
    // lives in different spaces depending on the mode:
    //   compass/gps/nav   -> compass heading in degrees 0..360
    //   wind              -> AWA in degrees -180..+180
    //   true wind         -> TWA in degrees -180..+180
    // A stale value from the previous mode (say a 90° heading) becomes
    // a 90° AWA when we cross into wind mode, and pypilot promptly
    // tries to swing the boat toward it — the "piloto se vuelve loco"
    // symptom Carlos reported on Rev280 sea trial. The fix: right
    // after ap.mode changes, force heading_command to the CURRENT
    // measurement in the destination space, so the pilot has a
    // sane target and never chases a value that meant something else.
    const oldMode = String(this.data.mode || "").toLowerCase();
    const newMode = String(mode || "").toLowerCase();
    // Rev279 (audit follow-up B): bump modeGen so a stale mode retry
    // aborts before overwriting a newer setMode / setState intent.
    const gen = ++this.modeGen;
    // Rev254 (Carlos audit): fail explicit when pypilot offline.
    // Rev255: retry with backoff.
    if (!(await this._setWithRetry("ap.mode", mode, () => this.modeGen !== gen))) {
      if (this.modeGen !== gen) {
        throw new Error("mode change superseded by newer order");
      }
      throw new Error("pypilot offline: mode change not delivered");
    }
    if (this.modeGen !== gen) {
      throw new Error("mode change superseded after write");
    }
    // Rev292: re-anchor. Only when the mode's target-space actually
    // changed (compass↔gps↔nav share the compass space and don't need
    // it; wind↔true wind share the wind space; only compass-family ↔
    // wind-family crossings trigger the re-anchor).
    if (this.data.engaged) {
      try {
        this._reAnchorTargetAfterModeChange(oldMode, newMode);
      } catch (e: any) {
        // Never fail the mode change on the re-anchor path — worst
        // case we leave the stale target and the sailor corrects with
        // a nudge. Log so the diagnostic captures it.
        // eslint-disable-next-line no-console
        console.log(`[apProvider.setMode] re-anchor failed: ${e?.message || e}`);
      }
    }
  }

  /** Rev292: after a compass↔wind (or vice-versa) mode change, force
   *  heading_command to the current measurement in the destination
   *  space so pypilot never starts a mode with a target that meant
   *  something else in the previous mode. Rev295: decision extracted
   *  to src/mode-reanchor.ts (pure, unit-tested). This method only
   *  glues that decision to the pypilot socket. */
  private _reAnchorTargetAfterModeChange(oldMode: string, newMode: string): void {
    // Rev407 (Carlos sea trial 2026-10-03, audit O): respect the virtual
    // tack's internal-write flag. If the FSM is driving the pilot, the
    // re-anchor would write ap.heading_command = currentHeading right
    // after our setMode(compass), which pypilot then holds for 1-2 s
    // until our intermediate setTarget lands. Observed effect: the boat
    // "doesn't move the first 1-2 s of the VT" because pypilot IS obeying
    // — just not us. Skip re-anchor during VT; the FSM manages the target
    // explicitly after every setMode.
    if (this._vtInternalWrite) {
      // eslint-disable-next-line no-console
      console.log(`[apProvider.setMode] skip re-anchor: FSM driving`);
      return;
    }
    const values = (this.client as any).getValues?.() || {};
    const d = decideReAnchor(oldMode, newMode, values);
    // eslint-disable-next-line no-console
    console.log(`[apProvider.setMode] re-anchor: ${d.reason}`);
    if (!d.shouldReAnchor || d.valueDeg == null) return;
    // Push directly to pypilot without going through setTarget() —
    // setTarget bumps targetGen and could race with the modeGen we
    // just claimed. Also bypass echo cancellation: the anchor value is
    // what we WANT to see, so the echo does match.
    try { this.client.set("ap.heading_command", d.valueDeg); }
    catch (e: any) {
      // eslint-disable-next-line no-console
      console.log(`[apProvider.setMode] re-anchor write failed: ${e?.message || e}`);
    }
  }

  /** Rev390: internal flag set by _runVirtualTack around its own
   *  setMode/setTarget calls, so the external-write guard below can
   *  distinguish our FSM's writes from frontend writes (nudges,
   *  adjust target, legacy countdown) that would compete with the
   *  maneuver. */
  private _vtInternalWrite = false;

  private async setTarget(rad: number): Promise<void> {
    // Rev390 (Carlos, 2026-10-01, QA Rev389): reject external target
    // writes while a virtual tack is driving the pilot. Rev389 QA
    // caught a mid-maneuver `setTarget rad=0.9250 deg=53.00` that
    // competed with the FSM's own intermediate (`rad=0.4498 deg=25.77`)
    // and ultimately corrupted the maneuver. We now swallow any
    // target write that didn't originate from _runVirtualTack itself.
    if (this._virtualTack && !this._vtInternalWrite) {
      const active = this._virtualTack.phase !== "idle"
        && this._virtualTack.phase !== "completed"
        && this._virtualTack.phase !== "cancelled"
        && this._virtualTack.phase !== "failed";
      if (active) {
        // eslint-disable-next-line no-console
        console.log(`[virtual-tack] rejected external setTarget rad=${rad.toFixed(4)} (FSM is driving)`);
        return;
      }
    }
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
    // Rev279 (audit follow-up B): bump targetGen so a stale target
    // retry aborts before overwriting a newer setTarget. Without this
    // guard, target=1 rad → 2 rad → retry(1 rad) ended up leaving
    // 1 rad on pypilot.
    const gen = ++this.targetGen;
    // Rev254 (Carlos audit): reject BEFORE mutating optimistic target.
    // Rev255: retry with backoff.
    if (!(await this._setWithRetry("ap.heading_command", deg, () => this.targetGen !== gen))) {
      if (this.targetGen !== gen) {
        throw new Error("target superseded by newer order");
      }
      throw new Error("pypilot offline: target not delivered");
    }
    if (this.targetGen !== gen) {
      throw new Error("target superseded after write");
    }
    this.data.target = rad;
    this.pendingTarget = { value: rad, until: Date.now() + TARGET_PENDING_MS };
    this.notifyChanged("target");
  }

  private async adjustTarget(rad: number): Promise<void> {
    // Rev272 (audit R07): reject non-finite deltas at the boundary.
    // Rev292 (Carlos, navigating - bug C "piloto girando loco"):
    // tighten the ceiling. `adjustTarget` is called from user nudges
    // (max nudgeBig = 100°, so ~1.75 rad in extreme configurations)
    // and never for tacks (those go through this.tack() → setTarget
    // absolute). A single adjustTarget above 90° is either a bug in
    // the caller or a corrupt payload — refuse it before it reaches
    // pypilot, where it becomes an untraceable heading sweep.
    if (!Number.isFinite(rad) || Math.abs(rad) > Math.PI / 2) {
      throw new Error(`Invalid adjust rad: ${rad} (max ±π/2 = ±90°)`);
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
        // Rev279 (audit follow-up B): adjustTarget also bumps targetGen
        // so an in-flight absolute setTarget cannot silently overwrite
        // the adjusted value from a retry (and vice versa).
        const gen = ++this.targetGen;
        // Rev254 (Carlos audit): same reject-before-optimistic guard.
        // Rev255: retry with backoff.
        if (!(await this._setWithRetry("ap.heading_command", newRad * RAD_TO_DEG, () => this.targetGen !== gen))) {
          if (this.targetGen !== gen) {
            throw new Error("target adjust superseded by newer order");
          }
          throw new Error("pypilot offline: target adjust not delivered");
        }
        if (this.targetGen !== gen) {
          throw new Error("target adjust superseded after write");
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

  /** Rev387: public idempotent start entry-point for the new
   *  POST /virtual-tack/start endpoint. Rejects a start when another
   *  virtual tack is already active (not terminal). If called with the
   *  same requestId as the active tack, returns its id without starting
   *  a new one — makes the frontend safe to retry the request. */
  async startVirtualTack(opts: {
    direction: TackDirection;
    requestId?: string | null;
  }): Promise<{ id: string; alreadyRunning: boolean; windMode: WindMode }> {
    const current = this._virtualTack;
    if (current) {
      const terminal = ["completed", "cancelled", "failed"];
      if (!terminal.includes(current.phase)) {
        if (opts.requestId && current.requestId === opts.requestId) {
          return { id: current.id, alreadyRunning: true, windMode: current.windMode as WindMode };
        }
        throw new Error(`virtual-tack already active (phase=${current.phase}, id=${current.id})`);
      }
    }
    const modeStr = String(this.data.mode || "").toLowerCase();
    if (modeStr !== "wind" && modeStr !== "true wind") {
      throw new Error(`virtual-tack only valid in wind modes (current=${modeStr})`);
    }
    if (!this.data.engaged) throw new Error("virtual-tack requires engaged autopilot");
    // Rev407 (Carlos sea trial 2026-10-03, audit E+M): validate all
    // preconditions BEFORE the fire-and-forget runner. Previously, missing
    // heading made _runVirtualTack throw AFTER startVirtualTack had
    // returned {id:"", alreadyRunning:false, windMode}; the HTTP route
    // responded 200 and the sailor saw no virtual-tack, no error, nothing
    // in the UI. Carlos sea trial showed this as "pypilot silent" cases.
    const headingRad = this._readHeadingRad();
    if (headingRad === null) {
      throw new Error("virtual-tack: heading not available (SK bus + pypilot cache both empty)");
    }
    const windMode = modeStr as WindMode;
    // Rev409 (Carlos QA Rev408 sea trial 2026-10-03 19:30): the "angle
    // we mirror" has to be the CURRENT AWA from the sensor, NOT
    // this.data.target. The sailor saw the diamond go to aleta babor
    // casi popa (~-135°) when they expected través port (-90°).
    //
    // Root cause: Rev408 cancel leaves data.target = AWA at the moment
    // of cancel. If the boat kept rotating a bit between cancel and the
    // next tap, data.target is stale by that same amount, and the FSM
    // mirrors the STALE angle. computeTackGeometry (angleNewRad =
    // -angleStartSigned) is correct — the input was wrong.
    //
    // The visor's _tackStartFresh already uses state.windAngle (sensor
    // direct). Mirroring that same source backend-side keeps them in
    // sync and matches the physical "swap bordos" expectation.
    const awaPath = windMode === "wind"
      ? "environment.wind.angleApparent"
      : "environment.wind.angleTrueWater";
    let awaRad: number | null = null;
    try {
      const p = this.app?.getSelfPath?.(awaPath);
      const v = p?.value;
      if (typeof v === "number" && Number.isFinite(v)) awaRad = v;
    } catch { /* noop */ }
    if (awaRad === null) {
      // Fallback to data.target so we don't break the manoeuvre when
      // the SK bus is missing wind data (rare but possible on sensor
      // dropouts). The FSM worked this way pre-Rev409.
      if (this.data.target == null || !Number.isFinite(this.data.target)) {
        throw new Error(`virtual-tack: wind angle unavailable (${awaPath} empty, no fallback target)`);
      }
      awaRad = this.data.target;
    }
    this._runVirtualTack(opts.direction, windMode, headingRad, awaRad).catch((e: any) => {
      // eslint-disable-next-line no-console
      console.log(`[startVirtualTack] driver threw: ${e?.message || e}`);
    });
    // Attach the requestId to the just-created VT state (the FSM has
    // populated this._virtualTack synchronously before the first await).
    if (this._virtualTack && opts.requestId) {
      this._virtualTack.requestId = opts.requestId;
    }
    const id = this._virtualTack?.id ?? "";
    return { id, alreadyRunning: false, windMode };
  }

  /** Rev407 (audit B): unified heading reader. Cascades SK bus (true/mag)
   *  → pypilot client cache (ap.heading / imu.heading). Returns radians or
   *  null if ALL sources are empty. Used by BOTH startVirtualTack (as a
   *  precondition) and the _runVirtualTack loop (so the loop sees the same
   *  heading source the planner saw). */
  private _readHeadingRad(): number | null {
    try {
      const skH = this.app?.getSelfPath?.("navigation.headingTrue");
      const v = skH?.value;
      if (typeof v === "number" && Number.isFinite(v)) return v;
    } catch { /* noop */ }
    try {
      const skH = this.app?.getSelfPath?.("navigation.headingMagnetic");
      const v = skH?.value;
      if (typeof v === "number" && Number.isFinite(v)) return v;
    } catch { /* noop */ }
    const values = (this.client as any).getValues?.() || {};
    const apH = values["ap.heading"];
    if (typeof apH === "number" && Number.isFinite(apH)) return apH * DEG_TO_RAD;
    const imuH = values["imu.heading"];
    if (typeof imuH === "number" && Number.isFinite(imuH)) return imuH * DEG_TO_RAD;
    return null;
  }

  private async tack(direction: "port" | "starboard"): Promise<void> {
    // Rev192 (Carlos): synthetic tack. In sea trial on Tunatunes (2026-09-10)
    // pypilot 0.x on the Pi Zero received `ap.tack.state=begin` and looped
    // it straight back to "none" without ever rotating heading_command.
    // Instead of relying on pypilot's own tack primitive we rotate the
    // target ourselves.
    //
    // Rev378 (Carlos, 2026-10-01): WIND / TRUE WIND path now uses a
    // two-phase virtual tack (compass → wind) via `_runVirtualTack` to
    // defuse the pypilot core "direction rewrite on short arc" bug in
    // the downwind quadrants. Compass / GPS / nav modes keep the simple
    // target-shift behaviour because pypilot's short-arc choice already
    // matches the requested direction when the rotation is < 180°.
    if (!this.data.engaged || this.data.target == null) return;
    const modeStr = String(this.data.mode || "").toLowerCase();
    const isWind = modeStr === "wind" || modeStr === "true wind";
    if (isWind) {
      // Rev407+Rev409: _runVirtualTack takes heading + originalAWA
      // (sensor direct, not data.target — see startVirtualTack for the
      // reason). If either source is missing, abort silently.
      const headingRad = this._readHeadingRad();
      if (headingRad === null) return;
      const windMode = modeStr as WindMode;
      const awaPath = windMode === "wind"
        ? "environment.wind.angleApparent"
        : "environment.wind.angleTrueWater";
      let awaRad: number | null = null;
      try {
        const p = this.app?.getSelfPath?.(awaPath);
        const v = p?.value;
        if (typeof v === "number" && Number.isFinite(v)) awaRad = v;
      } catch { /* noop */ }
      if (awaRad === null) {
        // Fallback same as startVirtualTack.
        if (this.data.target == null || !Number.isFinite(this.data.target)) return;
        awaRad = this.data.target;
      }
      await this._runVirtualTack(direction, windMode, headingRad, awaRad);
      return;
    }
    const values = (this.client as any).getValues?.() || {};
    const rawAngle = values["ap.tack.angle"];
    const tackAngleDeg = (typeof rawAngle === "number" && rawAngle >= 30 && rawAngle <= 170)
      ? rawAngle
      : 100;
    const sign = direction === "port" ? -1 : 1;
    let newRad = this.data.target + sign * tackAngleDeg * DEG_TO_RAD;
    while (newRad > Math.PI)  newRad -= 2 * Math.PI;
    while (newRad < -Math.PI) newRad += 2 * Math.PI;
    // eslint-disable-next-line no-console
    console.log(`[apProvider.tack] dir=${direction} mode=${modeStr} angle=${tackAngleDeg} tgt ${this.data.target.toFixed(3)} -> ${newRad.toFixed(3)} rad`);
    await this.setTarget(newRad);
  }

  /**
   * Rev378: public read-only snapshot of the current virtual-tack cycle.
   * Returns `null` when there is no virtual tack in progress or recently
   * completed. The index.ts HTTP endpoint consumes this for the
   * frontend's mode-selector masking (see Rev379).
   */
  getVirtualTackState(): Readonly<VirtualTackState> | null {
    return this._virtualTack;
  }

  /** Rev378: the two-phase virtual tack driver. Runs the FSM declared
   *  in src/virtual-tack.ts against this.setMode / this.setTarget.
   *
   *  Rev407 (Carlos sea trial 2026-10-03): heavy refactor after sea trial
   *  showed all wind-mode virads timing out at 20 s even while the boat
   *  was rotating. Changes:
   *   - Precond validation moved to startVirtualTack; this function
   *     receives heading + target as parameters, already validated.
   *   - No fixed rotation timeout: Carlos's call ("no quiero timeout
   *     para las viradas"). We only abort on pypilot-stuck watchdog
   *     (no heading change in 60 s = pypilot has died or is not
   *     obeying) or on sailor cancel.
   *   - Session lock (vtId) on every await: cleanup of a previous VT
   *     cannot wipe the running one.
   *   - setPhase refuses to overwrite "cancelling": prevents the known
   *     race where cancelVirtualTack sets "cancelling" while the loop
   *     is between awaits.
   *   - Intermediates recomputed from REAL heading after each step
   *     reached: avoids the "20° tolerance + 170° step → next target at
   *     190° → short arc goes the wrong way" bug (audit H).
   *   - On cancel/failed: do NOT restore the wind target. Switch to
   *     compass mode and set target to CURRENT heading, so pypilot
   *     holds the boat where it is. Sailor chooses what to do next. */
  private async _runVirtualTack(
    direction: TackDirection,
    windMode: WindMode,
    headingRadParam: number,
    originalAngleRadParam: number,
  ): Promise<void> {
    const headingRad = headingRadParam;
    const originalAngleRad = originalAngleRadParam;
    const hStartRad = headingRad;

    const geometry = computeTackGeometry({
      angleStartRad: originalAngleRad,
      hStartRad,
      direction,
    });

    const now = Date.now();
    const vtId = `vt-${now}-${Math.random().toString(36).slice(2, 8)}`;
    this._virtualTack = {
      ...makeVirtualTackInitialState(),
      id: vtId,
      phase: "preparing",
      windMode,
      direction,
      geometry,
      startedAtMs: now,
      originalMode: windMode,
      originalAngleRad,
    };
    this.notifyChanged("all");

    // Rev407 (audit F): setPhase refuses to overwrite "cancelling".
    // The classic race was: loop waits on an await, cancelVirtualTack
    // sets phase="cancelling" from outside, the await resolves, the
    // loop advances to setPhase("settling") and clobbers the cancel.
    const setPhase = (p: VirtualTackPhase, reason?: string) => {
      if (!this._virtualTack || this._virtualTack.id !== vtId) return;
      if (this._virtualTack.phase === "cancelling" && p !== "cancelled" && p !== "failed") {
        return;
      }
      this._virtualTack.phase = p;
      if (reason) this._virtualTack.outcomeReason = reason;
      this.notifyChanged("all");
    };

    // Rev407 (audit G): session-lock check used after every await. If
    // the global this._virtualTack has changed id or been nulled (e.g.
    // by the 5 s cleanup of a previous run, or because another start
    // took over), the current runner must stop silently without
    // touching the new state.
    const sessionAlive = (): boolean =>
      !!this._virtualTack && this._virtualTack.id === vtId;
    const checkCancelled = (): void => {
      if (!sessionAlive()) {
        throw new Error("virtual-tack session superseded");
      }
      if (this._virtualTack!.phase === "cancelling" ||
          this._virtualTack!.phase === "cancelled") {
        throw new Error("virtual-tack cancelled by external cancel");
      }
    };

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Rev387/Rev407: event-driven wait for pypilot echo. Honours
    // session lock (vtId) and cancellation phase so a cancel between
    // echoes aborts quickly without waiting for the timeout.
    const waitForPypilotEcho = async (
      key: string,
      expected: unknown,
      timeoutMs: number,
    ): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const v = (this.client as any).getValues?.() || {};
        if (v[key] === expected) return true;
        await sleep(50);
        checkCancelled();
      }
      return false;
    };

    // Rev407 constants (replace the old DEFAULT_PHASE1_STEP_TIMEOUT_MS):
    // PYPILOT_STUCK_MS = how long we tolerate heading NOT changing at
    // all before concluding pypilot has died or is not obeying.
    // Carlos: "no quiero timeout para las viradas" — this is a safety
    // watchdog, not a maneuver clock. 60 s is deliberately generous:
    // even a very light wind + low SOG virada still shows some heading
    // drift. If pypilot really is stuck the sailor would notice much
    // sooner and cancel manually.
    const PYPILOT_STUCK_MS = 60_000;
    const STUCK_HEADING_TOL_DEG = 0.5;

    try {
      // ─── Phase turning: compass + fractionated rotation ───
      // eslint-disable-next-line no-console
      console.log(
        `[virtual-tack ${vtId}] turning dir=${direction} fromMode=${windMode} ` +
          `angle=${(originalAngleRad * RAD_TO_DEG).toFixed(1)}deg ` +
          `delta=${(geometry.deltaHRad * RAD_TO_DEG).toFixed(1)}deg ` +
          `steps=${geometry.intermediatesRad.length}`,
      );
      this._vtInternalWrite = true;
      try { await this.setMode("compass"); } finally { this._vtInternalWrite = false; }
      checkCancelled();
      const compassReady = await waitForPypilotEcho("ap.mode", "compass", 1500);
      if (!compassReady) {
        // eslint-disable-next-line no-console
        console.log(`[virtual-tack ${vtId}] WARN: ap.mode=compass echo not seen in 1.5s, continuing`);
      }
      checkCancelled();
      setPhase("turning");

      // Rev407 (audit H): intermediates are mutable now. After each
      // step reached we recompute the REMAINING intermediates from the
      // current (observed) heading, so the step N+1 target can never
      // land at a distance > 180° of real heading (which would make
      // pypilot pick the short arc in the WRONG direction).
      let remainingIntermediates = geometry.intermediatesRad.slice();
      let stepCounter = 0;
      let finalCompassTargetRad = geometry.hTargetRad;

      // Rev410 (fix T.1-A, Carlos 2026-10-04): publish an initial
      // `remainingDeg` so the visor's mirror HUD shows a meaningful
      // number from the first snapshot, not just elapsed seconds.
      // Granularity thereafter is "once per intermediate step reached"
      // (option A, confirmed by Carlos — no 500 ms tick).
      {
        const h0 = this._readHeadingRad();
        if (h0 !== null && this._virtualTack && this._virtualTack.id === vtId) {
          this._virtualTack.remainingDeg = Math.abs(
            shortestArcRad(finalCompassTargetRad, h0) * RAD_TO_DEG,
          );
          try { this.notifyChanged("virtualTack"); } catch { /* noop */ }
        }
      }

      while (remainingIntermediates.length > 0) {
        checkCancelled();
        this._virtualTack!.stepIndex = stepCounter;
        this._virtualTack!.phase1StepStartedAtMs = Date.now();
        const stepTargetRad = remainingIntermediates[0];
        this._vtInternalWrite = true;
        try { await this.setTarget(stepTargetRad); } finally { this._vtInternalWrite = false; }
        checkCancelled();

        // Poll heading until we reach the intermediate within tolerance,
        // OR pypilot has not moved the hull in PYPILOT_STUCK_MS → abort.
        // Rev407: no fixed maneuver timeout. The sailor cancels manually
        // if they want to abort for any other reason.
        let lastHeadingRad: number | null = null;
        let lastHeadingChangeTs = Date.now();
        while (true) {
          const hNow = this._readHeadingRad();
          if (hNow !== null) {
            if (
              isAtTarget({
                hNowRad: hNow,
                hTargetRad: stepTargetRad,
                toleranceDeg: DEFAULT_PHASE_TOLERANCE_DEG,
              })
            ) {
              break;
            }
            if (lastHeadingRad === null) {
              lastHeadingRad = hNow;
              lastHeadingChangeTs = Date.now();
            } else {
              const diffDeg = Math.abs(
                normalizeTwoPi(hNow - lastHeadingRad + Math.PI) * RAD_TO_DEG - 180,
              );
              if (diffDeg > STUCK_HEADING_TOL_DEG) {
                lastHeadingRad = hNow;
                lastHeadingChangeTs = Date.now();
              } else if (Date.now() - lastHeadingChangeTs > PYPILOT_STUCK_MS) {
                throw new Error(
                  `virtual-tack: pypilot stuck (no heading change in ${PYPILOT_STUCK_MS / 1000}s)`,
                );
              }
            }
          }
          await sleep(500);
          checkCancelled();
        }

        // Step reached. Pop it and recompute the rest from REAL heading.
        remainingIntermediates.shift();
        stepCounter++;
        // Rev410 (fix T.1-A): refresh `remainingDeg` from the current
        // heading. One update per step reached is the agreed granularity.
        {
          const hAfter = this._readHeadingRad();
          if (hAfter !== null && this._virtualTack && this._virtualTack.id === vtId) {
            this._virtualTack.remainingDeg = Math.abs(
              shortestArcRad(finalCompassTargetRad, hAfter) * RAD_TO_DEG,
            );
            try { this.notifyChanged("virtualTack"); } catch { /* noop */ }
          }
        }
        if (remainingIntermediates.length > 0) {
          const hNow = this._readHeadingRad();
          if (hNow !== null) {
            remainingIntermediates = recomputeRemainingIntermediates({
              hNowRad: hNow,
              finalCompassTargetRad,
              originalDeltaSign: Math.sign(geometry.deltaHRad),
            });
          }
        }
      }

      // ─── Phase handover → settling: back to wind mode, final target ───
      checkCancelled();
      setPhase("handover");
      this._vtInternalWrite = true;
      try { await this.setMode(windMode); } finally { this._vtInternalWrite = false; }
      checkCancelled();
      const windReady = await waitForPypilotEcho("ap.mode", windMode, 1500);
      if (!windReady) {
        // eslint-disable-next-line no-console
        console.log(`[virtual-tack ${vtId}] WARN: ap.mode=${windMode} echo not seen in 1.5s, continuing`);
      }
      checkCancelled();
      this._vtInternalWrite = true;
      try { await this.setTarget(geometry.angleNewRad); } finally { this._vtInternalWrite = false; }
      checkCancelled();

      // Rev387: settling phase. Watches the wind angle error until
      // it stays under tolerance for a short dwell.
      // Rev407: no artificial "declaring completed anyway" fallback.
      // If settling can't confirm within 30 s, we mark it as settling-
      // timeout (NOT ok). The sailor sees it and decides.
      setPhase("settling");
      const settleStart = Date.now();
      const SETTLE_TOLERANCE_DEG = 10;
      const SETTLE_DWELL_MS = 2000;
      const SETTLE_TIMEOUT_MS = 30000;
      let settledOk = false;
      let dwellStart: number | null = null;
      while (true) {
        checkCancelled();
        const skPath = windMode === "wind" ? "environment.wind.angleApparent" : "environment.wind.angleTrueWater";
        let windNowRad: number | null = null;
        try {
          const p = this.app?.getSelfPath?.(skPath);
          const v = p?.value;
          if (typeof v === "number" && Number.isFinite(v)) windNowRad = v;
        } catch { /* noop */ }
        if (windNowRad !== null) {
          const errDeg = Math.abs(
            ((((windNowRad - geometry.angleNewRad) * RAD_TO_DEG) + 540) % 360) - 180,
          );
          if (errDeg < SETTLE_TOLERANCE_DEG) {
            if (dwellStart === null) dwellStart = Date.now();
            else if (Date.now() - dwellStart > SETTLE_DWELL_MS) {
              settledOk = true;
              break;
            }
          } else {
            dwellStart = null;
          }
        }
        if (Date.now() - settleStart > SETTLE_TIMEOUT_MS) {
          // eslint-disable-next-line no-console
          console.log(`[virtual-tack ${vtId}] settling did not converge in ${SETTLE_TIMEOUT_MS/1000}s`);
          break;
        }
        await sleep(300);
      }

      setPhase("completed", settledOk ? "ok" : "settling-timeout");
      // eslint-disable-next-line no-console
      console.log(`[virtual-tack ${vtId}] completed in ${((Date.now() - now) / 1000).toFixed(1)}s (settled=${settledOk})`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.log(`[virtual-tack ${vtId}] ${err?.message || err}`);
      const msg = String(err?.message || err || "");
      const isUserCancel = /cancelled by external cancel/.test(msg);
      const isSuperseded = /session superseded/.test(msg);
      // Rev407 (audit D): on cancel / failure / stuck / supersede, do
      // NOT restore the original wind target. Carlos sea trial 2026-
      // 10-03 showed pypilot picks the SHORT arc from the current
      // heading back to the original AWA, often going the wrong way or
      // making a full 360°. Instead switch to compass mode and set the
      // target to the CURRENT heading, so pypilot holds the boat where
      // it is. The sailor chooses what to do next.
      // Session-superseded cases skip the restore entirely (another VT
      // owns the state now).
      if (isSuperseded) {
        setPhase(isUserCancel ? "cancelled" : "failed", msg);
        throw err;
      }
      // Only emit cancelling if we actually own the session.
      if (sessionAlive()) {
        setPhase("cancelling", msg);
      }
      // Rev408 (Carlos QA Rev407 sea trial 2026-10-03): "stay on this
      // course" means stay in the SAME wind mode with the CURRENT wind
      // angle as target. Rev407 Commit 1 switched to compass+heading,
      // which technically freezes the heading but broke the next TACK
      // ("virtual-tack only valid in wind modes") because the AP was
      // left in compass. In practice the sailor tacks several times in
      // a row — "quedarse en el rumbo" has to leave the pilot in a
      // state where another TACK works without manual mode change.
      //
      // In wind mode, target = current AWA keeps the boat at the AWA
      // it has right now. If wind is stable, heading stays. If wind
      // rotates, the AP follows the wind — same behaviour as any
      // normal wind-mode leg, which is what the sailor expects.
      try {
        // Make sure we are in the wind mode we started with. If we
        // were caught mid-step still in compass, bring the AP back.
        this._vtInternalWrite = true;
        try { await this.setMode(windMode); } catch { /* best-effort */ } finally { this._vtInternalWrite = false; }
      } catch { /* swallow */ }
      try {
        const skPath = windMode === "wind"
          ? "environment.wind.angleApparent"
          : "environment.wind.angleTrueWater";
        let awaRad: number | null = null;
        try {
          const p = this.app?.getSelfPath?.(skPath);
          const v = p?.value;
          if (typeof v === "number" && Number.isFinite(v)) awaRad = v;
        } catch { /* noop */ }
        if (awaRad !== null) {
          this._vtInternalWrite = true;
          try { await this.setTarget(awaRad); } catch { /* best-effort */ } finally { this._vtInternalWrite = false; }
        }
      } catch { /* swallow */ }
      if (sessionAlive()) {
        setPhase(isUserCancel ? "cancelled" : "failed", msg);
      }
      throw err;
    } finally {
      // Rev393 (Carlos, 2026-10-01, GPT-Codex round 2): capture the id
      // at this moment and only clear if it still matches when the
      // timer fires. Rev392's 5s linger was the main source of the
      // "second jump" — the final notifyChanged('all') republished a
      // canonical delta the visor was no longer protected from. Keep
      // the linger (overlay sees terminal snapshot for a short while)
      // but NEVER re-publish on cleanup; just drop _virtualTack silently
      // and the visor's dedupe guard (Rev393 frontend) ignores anything
      // else.
      const settledId = this._virtualTack?.id;
      setTimeout(() => {
        if (
          this._virtualTack &&
          this._virtualTack.id === settledId &&
          ["completed", "cancelled", "failed"].includes(this._virtualTack.phase)
        ) {
          this._virtualTack = null;
          // Rev394: emit an EXPLICIT virtualTack=null delta so the visor
          // knows it can lower its shield. We publish ONLY the virtualTack
          // path (fields='virtualTack') — not 'all' — so canonical
          // mode/target do NOT get republished (that was the Rev392
          // 'second jump' trigger). The visor's shield check is now
          // `state.virtualTack != null`; it drops when this null delta
          // arrives, and the next canonical delta is accepted normally.
          try { this.notifyChanged("virtualTack"); } catch { /* noop */ }
        }
      }, 5000);
    }
  }

  /** Rev378: external cancel entry-point. Called from the HTTP route
   *  when the sailor taps the tack button a second time (frontend
   *  Rev379). Sets phase to "abort" so the running driver bails and
   *  rolls back on its next await. */
  cancelVirtualTack(): void {
    if (!this._virtualTack) return;
    const terminal = ["completed", "cancelled", "failed"];
    if (terminal.includes(this._virtualTack.phase)) return;
    // eslint-disable-next-line no-console
    console.log(`[virtual-tack] external cancel at phase=${this._virtualTack.phase}`);
    this._virtualTack.phase = "cancelling";
    this._virtualTack.outcomeReason = "user cancelled";
    this.notifyChanged("all");
  }

  private async engage(): Promise<void> {
    // Rev279 (audit follow-up A): the catch used to fall through to
    // setState("enabled") on ANY setNavMode failure, including a
    // "superseded by newer order" thrown when a disengage arrived
    // during setMode's retry. That turned the cancellation into a
    // fresh engage. setNavMode now returns silently on supersede
    // (does not throw), but we still filter defensively so a
    // superseded throw from lower layers cannot re-arm engage either.
    try {
      await this.setNavMode();
    } catch (e: any) {
      if (/superseded/.test(String(e?.message))) return;
      await this.setState("enabled");
    }
  }

  private async disengage(): Promise<void> {
    await this.setState("disabled");
  }

  private async setNavMode(): Promise<void> {
    // Rev279 (audit follow-up A): capture engageGen BEFORE the first
    // await. On Rev278 the snapshot was taken after
    // `await this.setMode("nav")`, so a disengage that landed during
    // the mode retry ended up sharing the SAME generation as the
    // arming step — the 500 ms timer then happily fired an engage the
    // user had explicitly cancelled. Now: any bump between here and
    // the timer means we bail silently. engage()'s catch is not
    // supposed to re-fire that either, so we return normally instead
    // of throwing (throwing would trigger engage()'s fallback into a
    // direct setState("enabled"), reintroducing the same bug).
    const gen = this.engageGen;
    const isStale = () => this.engageGen !== gen;
    const cdata = await this.app.getCourse?.();
    if (isStale()) return;
    if (
      cdata?.nextPoint &&
      this.getAvailableActionIds().includes("courseCurrentPoint")
    ) {
      try {
        await this.setMode("nav");
      } catch (e: any) {
        // setMode threw because it was superseded — bail without
        // arming the delayed engage.
        if (/superseded/.test(String(e?.message))) return;
        throw e;
      }
      if (isStale()) return;
      if (this.navPendingTimer) clearTimeout(this.navPendingTimer);
      this.navPendingTimer = setTimeout(() => {
        this.navPendingTimer = null;
        if (isStale()) return; // superseded, do nothing
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
    // Rev411 (fix J-1.5, Carlos 2026-10-04): dodge is safety-critical
    // (evasive maneuver). If pypilot is offline the SK API must learn
    // about it instead of returning "COMPLETED" to a KIP tap that
    // never reached the servo. Propagates up to the provider API
    // caller as a rejected promise.
    if (!this.client.set("servo.command", -sign)) {
      throw new Error("pypilot offline: dodge not delivered");
    }
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
