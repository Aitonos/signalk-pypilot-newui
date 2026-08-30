// Rev100: Alarm engine. Runs once per sampler tick (1 Hz), evaluates a
// small set of built-in rules against the latest Sample + KPI snapshot
// + Sensor Quality + Servo Health, and fires SK-canonical notifications
// under notifications.autopilot.<rule-id>. Ack / mute state is kept in
// memory only for Rev100; persistence lands with the disk snapshots.
//
// Design principles:
//   - Each rule is a pure evaluator that returns true if the condition
//     is met THIS tick. Sustain filtering (needs to be met for N s
//     before firing) is applied uniformly by the engine, not per-rule.
//   - Rules never share state - a rule that says "true" this tick can
//     later say "false" without any cleanup dance.
//   - Every fire increments a per-rule counter used to add jitter to
//     the emitted notification timestamp, so KIP/WilhelmSK never
//     collapse two consecutive alerts into one.

import { Sample } from "./historian";
import { KPISnapshot } from "./kpis";
import { QualitySnapshot } from "./sensor-quality";
import { ServoHealthSnapshot } from "./servo-health";

export type Severity = "info" | "warn" | "alarm";
export type SkState = "normal" | "nominal" | "alert" | "warn" | "alarm" | "emergency";

const SEV_TO_SK: Record<Severity, SkState> = {
  info: "nominal",
  warn: "warn",
  alarm: "alarm",
};

export interface EvalContext {
  sample: Sample | null;
  kpis: KPISnapshot | null;
  quality: QualitySnapshot | null;
  servoHealth: ServoHealthSnapshot | null;
  connected: boolean;                 // pypilot_web socket state
  disconnectedSinceMs: number | null; // wall-clock ms of last disconnect
  nowMs: number;
}

export interface RuleDef {
  id: string;
  label: string;
  severity: Severity;
  defaultEnabled: boolean;
  /** How many seconds the condition must hold before firing. */
  sustainSec: number;
  /** Human-readable description of what the rule watches. */
  description: string;
  /** Returns true when the condition is met on this tick. */
  evaluate(ctx: EvalContext): boolean;
  /** Builds a user-facing message. Called AFTER evaluate returned true. */
  message(ctx: EvalContext): string;
}

export interface RuleRuntimeState {
  ruleId: string;
  enabled: boolean;
  matched: boolean;
  matchedSinceMs: number | null;
  active: boolean;
  activeSinceMs: number | null;
  clearedAtMs: number | null;
  ackedAtMs: number | null;
  mutedUntilMs: number | null;
  message: string;
  severity: Severity;
  label: string;
}

export interface ActiveAlarm {
  ruleId: string;
  label: string;
  severity: Severity;
  message: string;
  activeSinceMs: number;
  ackedAtMs: number | null;
}

export interface AlarmSnapshot {
  computedTs: number;
  active: ActiveAlarm[];
  recent: (ActiveAlarm & { clearedAtMs: number })[];
}

// -------- Built-in rules --------
// Thresholds picked to be sensible defaults for a cruising sailboat.
// A future Rev exposes them via plugin schema.

export const RULE_HEADING_ERR_RAD = 20 * Math.PI / 180;   // 20 deg
export const RULE_UNABLE_ERR_RAD  = 30 * Math.PI / 180;   // 30 deg
export const RULE_UNABLE_DUTY_MIN = 0.7;                  // 70% duty
export const RULE_SERVO_OVERCURR_A = 5.0;
export const RULE_SERVO_TEMP_C     = 60;
export const RULE_LOW_VOLTAGE_V    = 11.0;
export const RULE_PYPILOT_DISC_SEC = 10;

export const DEFAULT_RULES: RuleDef[] = [
  {
    id: "heading-deviation",
    label: "Heading deviation",
    severity: "warn",
    defaultEnabled: true,
    sustainSec: 15,
    description: `RMS heading error exceeds ${(RULE_HEADING_ERR_RAD * 180 / Math.PI) | 0}° with the AP engaged.`,
    evaluate: (c) => {
      if (!c.kpis || !c.sample || !c.sample.engaged) return false;
      const r = c.kpis.window1m.rmsErrorRad;
      return typeof r === "number" && r > RULE_HEADING_ERR_RAD;
    },
    message: (c) => {
      const r = c.kpis?.window1m.rmsErrorRad ?? 0;
      return `AP heading error ${(r * 180 / Math.PI).toFixed(1)}° sustained`;
    },
  },
  {
    id: "unable-to-steer",
    label: "Unable to steer",
    severity: "alarm",
    defaultEnabled: true,
    sustainSec: 20,
    description: `Sustained high error AND servo running at ${(RULE_UNABLE_DUTY_MIN * 100) | 0}%+ duty - the AP is losing authority.`,
    evaluate: (c) => {
      if (!c.kpis || !c.sample || !c.sample.engaged) return false;
      const r = c.kpis.window1m.rmsErrorRad;
      const d = c.kpis.window1m.servoDutyPct;
      return typeof r === "number" && r > RULE_UNABLE_ERR_RAD
          && typeof d === "number" && d > RULE_UNABLE_DUTY_MIN;
    },
    message: (c) => {
      const r = c.kpis?.window1m.rmsErrorRad ?? 0;
      const d = c.kpis?.window1m.servoDutyPct ?? 0;
      return `AP losing authority: ${(r * 180 / Math.PI).toFixed(0)}° error, servo ${(d * 100).toFixed(0)}% duty`;
    },
  },
  {
    id: "servo-overcurrent",
    label: "Servo overcurrent",
    severity: "warn",
    defaultEnabled: true,
    sustainSec: 2,
    description: `Servo current spike above ${RULE_SERVO_OVERCURR_A} A.`,
    evaluate: (c) => {
      if (!c.sample || typeof c.sample.servoCurrent !== "number") return false;
      return c.sample.servoCurrent > RULE_SERVO_OVERCURR_A;
    },
    message: (c) => `Servo overcurrent ${(c.sample?.servoCurrent ?? 0).toFixed(1)} A`,
  },
  {
    id: "servo-temp-high",
    label: "Servo temperature high",
    severity: "warn",
    defaultEnabled: true,
    sustainSec: 10,
    description: `Servo controller temperature above ${RULE_SERVO_TEMP_C} °C.`,
    evaluate: (c) => {
      if (!c.sample || typeof c.sample.servoTemp !== "number") return false;
      return c.sample.servoTemp > RULE_SERVO_TEMP_C;
    },
    message: (c) => `Servo temp ${(c.sample?.servoTemp ?? 0).toFixed(0)} °C`,
  },
  {
    id: "low-voltage",
    label: "Low battery voltage",
    severity: "warn",
    defaultEnabled: true,
    sustainSec: 10,
    description: `Servo battery voltage below ${RULE_LOW_VOLTAGE_V} V.`,
    evaluate: (c) => {
      if (!c.sample || typeof c.sample.servoVoltage !== "number") return false;
      return c.sample.servoVoltage < RULE_LOW_VOLTAGE_V;
    },
    message: (c) => `Low voltage ${(c.sample?.servoVoltage ?? 0).toFixed(1)} V`,
  },
  {
    id: "sensor-lost",
    label: "Sensor lost",
    severity: "warn",
    defaultEnabled: true,
    sustainSec: 5,
    description: "One or more critical SK paths have gone stale beyond their lost threshold.",
    evaluate: (c) => {
      if (!c.quality) return false;
      return c.quality.items.some((it) => it.level === "lost");
    },
    message: (c) => {
      const lost = (c.quality?.items || []).filter((i) => i.level === "lost").map((i) => i.label);
      return lost.length > 0 ? `Sensor lost: ${lost.join(", ")}` : "Sensor lost";
    },
  },
  {
    id: "pypilot-disconnected",
    label: "pypilot disconnected",
    severity: "alarm",
    defaultEnabled: true,
    sustainSec: RULE_PYPILOT_DISC_SEC,
    description: `pypilot_web socket has been down for ${RULE_PYPILOT_DISC_SEC} seconds.`,
    evaluate: (c) => !c.connected,
    message: (c) => {
      if (c.disconnectedSinceMs == null) return "pypilot_web disconnected";
      const secs = Math.floor((c.nowMs - c.disconnectedSinceMs) / 1000);
      return `pypilot_web disconnected ${secs}s`;
    },
  },
];

export interface AlarmEngineOptions {
  /** Retain N most-recent resolved alarms in the /alarms/state history. */
  historySize?: number;
}

export class AlarmEngine {
  private readonly rules = new Map<string, RuleDef>();
  private readonly state = new Map<string, RuleRuntimeState>();
  private readonly history: (ActiveAlarm & { clearedAtMs: number })[] = [];
  private readonly historySize: number;

  constructor(rules: RuleDef[] = DEFAULT_RULES, opts: AlarmEngineOptions = {}) {
    this.historySize = Math.max(10, opts.historySize ?? 50);
    for (const r of rules) {
      this.rules.set(r.id, r);
      this.state.set(r.id, {
        ruleId: r.id,
        enabled: r.defaultEnabled,
        matched: false,
        matchedSinceMs: null,
        active: false,
        activeSinceMs: null,
        clearedAtMs: null,
        ackedAtMs: null,
        mutedUntilMs: null,
        message: "",
        severity: r.severity,
        label: r.label,
      });
    }
  }

  /** Tick the engine. Returns the list of rule ids whose state changed
   *  this tick (fired, cleared, or message updated) so the caller can
   *  publish only the deltas as SK notifications. */
  tick(ctx: EvalContext): string[] {
    const changed: string[] = [];
    for (const [id, rule] of this.rules) {
      const s = this.state.get(id)!;
      if (!s.enabled) {
        if (s.active) {
          this.resolve(s, ctx.nowMs);
          changed.push(id);
        }
        continue;
      }
      if (s.mutedUntilMs != null && ctx.nowMs < s.mutedUntilMs) {
        continue;   // muted - skip evaluation entirely
      }
      let matched = false;
      try { matched = rule.evaluate(ctx); } catch { /* silent */ }
      if (matched) {
        if (s.matchedSinceMs == null) s.matchedSinceMs = ctx.nowMs;
        s.matched = true;
        const held = ctx.nowMs - (s.matchedSinceMs ?? ctx.nowMs);
        if (!s.active && held >= rule.sustainSec * 1000) {
          this.fire(s, rule, ctx);
          changed.push(id);
        } else if (s.active) {
          // Refresh message so callers see the latest values.
          const newMsg = safeMessage(rule, ctx);
          if (newMsg !== s.message) {
            s.message = newMsg;
            changed.push(id);
          }
        }
      } else {
        s.matched = false;
        s.matchedSinceMs = null;
        if (s.active) {
          this.resolve(s, ctx.nowMs);
          changed.push(id);
        }
      }
    }
    return changed;
  }

  private fire(s: RuleRuntimeState, rule: RuleDef, ctx: EvalContext): void {
    s.active = true;
    s.activeSinceMs = ctx.nowMs;
    s.clearedAtMs = null;
    s.ackedAtMs = null;
    s.message = safeMessage(rule, ctx);
  }
  private resolve(s: RuleRuntimeState, nowMs: number): void {
    if (s.active && s.activeSinceMs != null) {
      const entry: ActiveAlarm & { clearedAtMs: number } = {
        ruleId: s.ruleId,
        label: s.label,
        severity: s.severity,
        message: s.message,
        activeSinceMs: s.activeSinceMs,
        ackedAtMs: s.ackedAtMs,
        clearedAtMs: nowMs,
      };
      this.history.unshift(entry);
      if (this.history.length > this.historySize) this.history.length = this.historySize;
    }
    s.active = false;
    s.activeSinceMs = null;
    s.clearedAtMs = nowMs;
    s.matched = false;
    s.matchedSinceMs = null;
    s.ackedAtMs = null;
  }

  ack(ruleId: string, nowMs: number = Date.now()): boolean {
    const s = this.state.get(ruleId);
    if (!s || !s.active) return false;
    s.ackedAtMs = nowMs;
    return true;
  }

  mute(ruleId: string, durationMs: number, nowMs: number = Date.now()): boolean {
    const s = this.state.get(ruleId);
    if (!s) return false;
    s.mutedUntilMs = nowMs + Math.max(1000, durationMs);
    return true;
  }

  setEnabled(ruleId: string, enabled: boolean): boolean {
    const s = this.state.get(ruleId);
    if (!s) return false;
    s.enabled = enabled;
    return true;
  }

  ruleState(ruleId: string): RuleRuntimeState | null {
    return this.state.get(ruleId) ?? null;
  }

  snapshot(nowMs: number = Date.now()): AlarmSnapshot {
    const active: ActiveAlarm[] = [];
    for (const s of this.state.values()) {
      if (s.active && s.activeSinceMs != null) {
        active.push({
          ruleId: s.ruleId,
          label: s.label,
          severity: s.severity,
          message: s.message,
          activeSinceMs: s.activeSinceMs,
          ackedAtMs: s.ackedAtMs,
        });
      }
    }
    return {
      computedTs: nowMs,
      active,
      recent: this.history.slice(),
    };
  }

  /** Describe every rule for the future config UI: label, severity,
   *  enabled, mute status, description. Cheap - just iterates the map. */
  describe(): {
    id: string; label: string; severity: Severity;
    enabled: boolean; description: string; sustainSec: number;
    active: boolean; mutedUntilMs: number | null;
  }[] {
    const out: ReturnType<AlarmEngine["describe"]> = [];
    for (const [id, rule] of this.rules) {
      const s = this.state.get(id)!;
      out.push({
        id,
        label: rule.label,
        severity: rule.severity,
        enabled: s.enabled,
        description: rule.description,
        sustainSec: rule.sustainSec,
        active: s.active,
        mutedUntilMs: s.mutedUntilMs,
      });
    }
    return out;
  }

  /** Convert Severity to the SK notification state string. */
  static skState(sev: Severity): SkState {
    return SEV_TO_SK[sev];
  }
}

function safeMessage(rule: RuleDef, ctx: EvalContext): string {
  try { return rule.message(ctx); } catch { return rule.label; }
}
