// Rev102: Pre-departure autopilot check. Aggregates the freshness /
// health data the plugin already collects into a single READY / DO NOT
// ENGAGE verdict the user can eyeball before leaving the dock.
//
// Every check reads from data that other modules already computed -
// this is pure O(N items) aggregation, no new sampling or subscriptions.

import { QualitySnapshot, PathQuality, QualityLevel } from "./sensor-quality";
import { ServoHealthSnapshot } from "./servo-health";
import { Sample } from "./historian";

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";
export type OverallVerdict = "ready" | "ready-with-caveats" | "do-not-engage" | "unknown";

export interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  /** Human summary of the current reading. */
  detail: string;
  /** What to do if this check is not passing. Optional. */
  hint?: string;
}

export interface PrecheckSnapshot {
  computedTs: number;
  overall: OverallVerdict;
  passCount: number;
  warnCount: number;
  failCount: number;
  items: CheckItem[];
}

export interface PrecheckInputs {
  connected: boolean;                    // pypilot_web socket state
  disconnectedSinceMs: number | null;
  hasAutopilotProvider: boolean;          // SK AP provider registered
  autopilotId: string | null;
  sample: Sample | null;
  quality: QualitySnapshot | null;
  servoHealth: ServoHealthSnapshot | null;
  /** Voltage thresholds - overridable per install. */
  batteryOkV?: number;
  batteryWarnV?: number;
  servoTempWarnC?: number;
  servoTempFailC?: number;
}

const DEFAULT_BATTERY_OK_V   = 12.0;
const DEFAULT_BATTERY_WARN_V = 11.5;
const DEFAULT_SERVO_TEMP_WARN_C = 55;
const DEFAULT_SERVO_TEMP_FAIL_C = 65;

export function runPrechecks(inputs: PrecheckInputs): PrecheckSnapshot {
  const now = Date.now();
  const items: CheckItem[] = [];
  const batOk   = inputs.batteryOkV   ?? DEFAULT_BATTERY_OK_V;
  const batWarn = inputs.batteryWarnV ?? DEFAULT_BATTERY_WARN_V;
  const tWarn   = inputs.servoTempWarnC ?? DEFAULT_SERVO_TEMP_WARN_C;
  const tFail   = inputs.servoTempFailC ?? DEFAULT_SERVO_TEMP_FAIL_C;

  // ---- 1. pypilot connectivity ----
  if (inputs.connected) {
    items.push({
      id: "pypilot-connect",
      label: "pypilot connectivity",
      status: "pass",
      detail: "Socket to pypilot_web is up.",
    });
  } else {
    const downSec = inputs.disconnectedSinceMs
      ? Math.floor((now - inputs.disconnectedSinceMs) / 1000)
      : null;
    items.push({
      id: "pypilot-connect",
      label: "pypilot connectivity",
      status: "fail",
      detail: downSec != null ? `Disconnected ${downSec}s.` : "Disconnected.",
      hint: "Power up the TinyPilot and check host/port in the plugin config.",
    });
  }

  // ---- 2. SK Autopilot API ----
  if (inputs.hasAutopilotProvider) {
    items.push({
      id: "ap-provider",
      label: "SK Autopilot provider",
      status: "pass",
      detail: `Registered as '${inputs.autopilotId || "?"}'.`,
    });
  } else if (inputs.autopilotId) {
    items.push({
      id: "ap-provider",
      label: "SK Autopilot provider",
      status: "pass",
      detail: `External provider '${inputs.autopilotId}' active.`,
    });
  } else {
    items.push({
      id: "ap-provider",
      label: "SK Autopilot provider",
      status: "fail",
      detail: "No autopilot registered on this Signal K server.",
      hint: "Enable absorbProvider in the plugin, or enable pypilot-autopilot-provider.",
    });
  }

  // ---- 3-6. Sensor freshness (heading, IMU attitude, GPS, wind) ----
  const qi = qualityIndex(inputs.quality);
  items.push(qualityCheck(qi, "navigation.headingMagnetic", "Heading",
    "Fix the compass/IMU source - the AP cannot steer without heading."));
  items.push(qualityCheck(qi, "navigation.attitude", "IMU attitude",
    "The IMU is silent - run the pypilot calibration wizard."));
  items.push(qualityCheck(qi, "navigation.position", "GPS position",
    "No GPS fix - GPS/nav modes will not work."));
  items.push(qualityCheck(qi, "navigation.speedOverGround", "SOG",
    "GPS is publishing position but no SOG."));
  items.push(qualityCheck(qi, "environment.wind.angleApparent", "Wind sensor",
    "Wind mode will not work until the sensor publishes."));

  // ---- 7. Servo current is reaching us ----
  const sh = inputs.servoHealth;
  const cur = sh?.lastCurrentA;
  if (typeof cur === "number") {
    items.push({
      id: "servo-current",
      label: "Servo current telemetry",
      status: "pass",
      detail: `Last reading ${cur.toFixed(2)} A.`,
    });
  } else {
    items.push({
      id: "servo-current",
      label: "Servo current telemetry",
      status: "warn",
      detail: "No current reading from the servo yet.",
      hint: "Engage the AP briefly - the pypilot controller only reports current when moving.",
    });
  }

  // ---- 8. Servo temperature ----
  const temp = sh?.lastTempC;
  if (typeof temp === "number") {
    let status: CheckStatus;
    if (temp >= tFail) status = "fail";
    else if (temp >= tWarn) status = "warn";
    else status = "pass";
    items.push({
      id: "servo-temp",
      label: "Servo temperature",
      status,
      detail: `${temp.toFixed(0)} °C.`,
      hint: status === "pass" ? undefined : `Let the servo cool below ${tWarn} °C before a long leg.`,
    });
  } else {
    items.push({
      id: "servo-temp",
      label: "Servo temperature",
      status: "unknown",
      detail: "No temperature reading yet.",
    });
  }

  // ---- 9. Battery voltage ----
  const volt = sh?.lastVoltageV;
  if (typeof volt === "number") {
    let status: CheckStatus;
    if (volt < batWarn) status = "fail";
    else if (volt < batOk) status = "warn";
    else status = "pass";
    items.push({
      id: "battery",
      label: "Battery voltage",
      status,
      detail: `${volt.toFixed(1)} V.`,
      hint: status === "pass" ? undefined : `Charge or reduce load - the AP servo needs at least ${batOk} V for reliable steering.`,
    });
  } else {
    items.push({
      id: "battery",
      label: "Battery voltage",
      status: "unknown",
      detail: "No voltage reading yet.",
    });
  }

  // ---- 10. Servo health verdict ----
  if (sh) {
    if (sh.status === "high") {
      items.push({
        id: "servo-health",
        label: "Servo health baseline",
        status: "fail",
        detail: `Deviation ${sh.deviationRatio?.toFixed(2)}× baseline.`,
        hint: "Servo working much harder than usual - check for hard rudder, cable drag, clutch or biofouling.",
      });
    } else if (sh.status === "elevated") {
      items.push({
        id: "servo-health",
        label: "Servo health baseline",
        status: "warn",
        detail: `Deviation ${sh.deviationRatio?.toFixed(2)}× baseline.`,
        hint: "Servo working harder than the learned baseline - inspect rudder linkage before a long leg.",
      });
    } else if (sh.status === "good" || sh.status === "idle") {
      items.push({
        id: "servo-health",
        label: "Servo health baseline",
        status: "pass",
        detail: sh.baselineA != null ? `Baseline ${sh.baselineA.toFixed(2)} A, healthy.` : "Idle, no anomalies.",
      });
    } else {
      items.push({
        id: "servo-health",
        label: "Servo health baseline",
        status: "unknown",
        detail: `Learning baseline (${sh.samplesLearned}/${sh.samplesTargetForLearn}).`,
      });
    }
  }

  // ---- Overall verdict ----
  const passCount = items.filter((i) => i.status === "pass").length;
  const warnCount = items.filter((i) => i.status === "warn").length;
  const failCount = items.filter((i) => i.status === "fail").length;
  let overall: OverallVerdict;
  if (failCount > 0) overall = "do-not-engage";
  else if (warnCount > 0) overall = "ready-with-caveats";
  else if (passCount > 0) overall = "ready";
  else overall = "unknown";

  return { computedTs: now, overall, passCount, warnCount, failCount, items };
}

function qualityIndex(q: QualitySnapshot | null): Map<string, PathQuality> {
  const out = new Map<string, PathQuality>();
  if (!q) return out;
  for (const it of q.items) out.set(it.path, it);
  return out;
}

function qualityCheck(idx: Map<string, PathQuality>, path: string, label: string, hint: string): CheckItem {
  const q = idx.get(path);
  if (!q) return { id: path, label, status: "unknown", detail: "Not being monitored." };
  const status = qualityToStatus(q.level);
  const bits: string[] = [];
  if (q.ageMs != null) bits.push(`age ${Math.floor(q.ageMs / 100) / 10}s`);
  if (q.hz != null)    bits.push(`${q.hz.toFixed(2)} Hz`);
  if (q.source)        bits.push(q.source);
  const detail = bits.length > 0 ? bits.join(" · ") : "No data.";
  return {
    id: path,
    label,
    status,
    detail,
    hint: status === "pass" ? undefined : hint,
  };
}

function qualityToStatus(l: QualityLevel): CheckStatus {
  if (l === "good") return "pass";
  if (l === "degraded") return "warn";
  if (l === "lost") return "fail";
  return "unknown";
}
