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
  /** Rev683: the visor translates label / detail / hint from these
   *  (pc.<id>.label, pc.<id>.<code>, pc.<id>.hint[.<hintCode>]); the
   *  English text above stays as the fallback. */
  code?: string;
  hintCode?: string;
  params?: Record<string, string | number>;
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
  /** Rev695 (GitHub #6): pypilot itself reports a fresh heading. When
   *  Signal K has none, the IMU is fine - pypilot cannot write to Signal K. */
  pypilotHeadingFresh?: boolean;
  /** Rev698: Signal K paths the plugin is publishing for pypilot (heading fallback). */
  fallbackPaths?: string[];
  /** Rev707: pypilot's ap.mode. GPS is only critical in gps / nav mode. */
  apMode?: string | null;
  /** Rev707: age of navigation.headingTrue in Signal K (boats whose compass
   *  only publishes true heading). */
  headingTrueAgeMs?: number | null;
  /** Rev707: Signal K's autopilot list (GET .../autopilots), to see a second
   *  provider or another default autopilot. */
  autopilotDevices?: Record<string, { provider?: string; isDefault?: boolean }> | null;
  /** Voltage thresholds - overridable per install. */
  batteryOkV?: number;
  batteryWarnV?: number;
  servoTempWarnC?: number;
  servoTempFailC?: number;
}

const OWN_PROVIDER = "signalk-pypilot-newui";
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
      code: "ok",
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
      hint: "Power up the TinyPilot and check its address in Setup > pypilot connection (or Scan).",
      code: downSec != null ? "down" : "downNoTime",
      params: downSec != null ? { sec: downSec } : undefined,
    });
  }

  // ---- 2. SK Autopilot API ----
  if (inputs.hasAutopilotProvider) {
    items.push({
      id: "ap-provider",
      label: "SK Autopilot provider",
      status: "pass",
      detail: `Registered as '${inputs.autopilotId || "?"}'.`,
      code: "ok", params: { id: inputs.autopilotId || "?" },
    });
  } else if (inputs.autopilotId) {
    items.push({
      id: "ap-provider",
      label: "SK Autopilot provider",
      status: "pass",
      detail: `External provider '${inputs.autopilotId}' active.`,
      code: "external", params: { id: inputs.autopilotId },
    });
  } else {
    items.push({
      id: "ap-provider",
      label: "SK Autopilot provider",
      status: "fail",
      detail: "No autopilot registered on this Signal K server.",
      hint: "Turn on 'absorb provider' in Setup > pypilot connection, or enable pypilot-autopilot-provider.",
      code: "none",
    });
  }

  // Rev707: we are a provider, but Signal K also has another one. With
  // pypilot-autopilot-provider too, there are two pypilot autopilots; with
  // another default autopilot, KIP and the other apps steer that one.
  if (inputs.hasAutopilotProvider && inputs.autopilotDevices) {
    const others = Object.entries(inputs.autopilotDevices).filter(([, d]) => d?.provider !== OWN_PROVIDER);
    const panaaj = others.find(([, d]) => d?.provider === "pypilot-autopilot-provider");
    const dflt = others.find(([, d]) => d?.isDefault);
    const ap = items.find((x) => x.id === "ap-provider");
    if (ap && panaaj) {
      ap.status = "warn";
      ap.detail = `pypilot-autopilot-provider is also active ('${panaaj[0]}').`;
      ap.hint = "Leave only one: disable pypilot-autopilot-provider, or turn 'absorb provider' off.";
      ap.code = "both"; ap.hintCode = "both"; ap.params = { id: panaaj[0] };
    } else if (ap && dflt) {
      ap.status = "warn";
      ap.detail = `Signal K's default autopilot is '${dflt[0]}', not pypilot.`;
      ap.hint = "Apps that use the default autopilot (KIP and others) steer that one, not pypilot.";
      ap.code = "notDefault"; ap.hintCode = "notDefault"; ap.params = { id: dflt[0] };
    }
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

  // Rev707: a compass that only publishes true heading is a heading too.
  const hdg = items.find((x) => x.id === "navigation.headingMagnetic");
  if (hdg && hdg.status !== "pass" && typeof inputs.headingTrueAgeMs === "number" && inputs.headingTrueAgeMs < 2000) {
    hdg.status = "pass";
    hdg.detail = "True heading only (navigation.headingTrue).";
    hdg.hint = undefined; hdg.hintCode = undefined;
    hdg.code = "viaTrue"; hdg.params = {};
  }

  // Rev707: compass mode steers without GPS; only gps / nav need it.
  const gpsNeeded = inputs.apMode === "gps" || inputs.apMode === "nav";
  if (!gpsNeeded) {
    for (const it of items) {
      if ((it.id === "navigation.position" || it.id === "navigation.speedOverGround") && it.status === "fail") it.status = "warn";
    }
  }

  // Rev695: say what is really wrong when pypilot has the heading but
  // Signal K does not (pypilot without read/write access in Signal K).
  if (inputs.pypilotHeadingFresh && inputs.connected) {
    for (const it of items) {
      if ((it.id === "navigation.headingMagnetic" || it.id === "navigation.attitude") && it.status !== "pass") {
        it.status = "fail";
        it.detail = "pypilot has it, but Signal K is not receiving it.";
        it.hint = "pypilot needs read/write access in Signal K: Security > Access Requests / Devices.";
        it.code = "notInSk";
        it.hintCode = "skAccess";
        it.params = {};
      }
    }
  }

  // Rev698: the heading reaches Signal K, but through the plugin's
  // fallback - pypilot itself still cannot write (its other data, such as
  // the autopilot state other apps read, does not arrive). A caveat, not a
  // stop: the autopilot works.
  const viaFallback = new Set(inputs.fallbackPaths || []);
  for (const it of items) {
    if (viaFallback.has(it.id) && it.status === "pass") {
      it.status = "warn";
      it.detail = "Published by this plugin: pypilot itself cannot write to Signal K.";
      it.hint = "pypilot needs read/write access in Signal K: Security > Access Requests / Devices.";
      it.code = "viaFallback";
      it.hintCode = "skAccess";
      it.params = {};
    }
  }

  // ---- 7. Servo current is reaching us ----
  const sh = inputs.servoHealth;
  const cur = sh?.lastCurrentA;
  if (typeof cur === "number") {
    items.push({
      id: "servo-current",
      label: "Servo current telemetry",
      status: "pass",
      detail: `Last reading ${cur.toFixed(2)} A.`,
      code: "ok", params: { a: cur.toFixed(2) },
    });
  } else {
    items.push({
      id: "servo-current",
      label: "Servo current telemetry",
      status: "warn",
      detail: "No current reading from the servo yet.",
      hint: "Engage the AP briefly - the pypilot controller only reports current when moving.",
      code: "none",
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
      code: "ok", params: { c: temp.toFixed(0), limit: tWarn },
    });
  } else {
    items.push({
      id: "servo-temp",
      label: "Servo temperature",
      status: "unknown",
      detail: "No temperature reading yet.",
      code: "none",
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
      code: "ok", params: { v: volt.toFixed(1), min: batOk },
    });
  } else {
    items.push({
      id: "battery",
      label: "Battery voltage",
      status: "unknown",
      detail: "No voltage reading yet.",
      code: "none",
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
        code: "deviation", hintCode: "high", params: { ratio: sh.deviationRatio?.toFixed(2) ?? "?" },
      });
    } else if (sh.status === "elevated") {
      items.push({
        id: "servo-health",
        label: "Servo health baseline",
        status: "warn",
        detail: `Deviation ${sh.deviationRatio?.toFixed(2)}× baseline.`,
        hint: "Servo working harder than the learned baseline - inspect rudder linkage before a long leg.",
        code: "deviation", hintCode: "elevated", params: { ratio: sh.deviationRatio?.toFixed(2) ?? "?" },
      });
    } else if (sh.status === "good" || sh.status === "idle") {
      items.push({
        id: "servo-health",
        label: "Servo health baseline",
        status: "pass",
        detail: sh.baselineA != null ? `Baseline ${sh.baselineA.toFixed(2)} A, healthy.` : "Idle, no anomalies.",
        code: sh.baselineA != null ? "healthy" : "idle",
        params: sh.baselineA != null ? { a: sh.baselineA.toFixed(2) } : undefined,
      });
    } else {
      items.push({
        id: "servo-health",
        label: "Servo health baseline",
        status: "unknown",
        detail: `Learning baseline (${sh.samplesLearned}/${sh.samplesTargetForLearn}).`,
        code: "learning", params: { n: sh.samplesLearned, total: sh.samplesTargetForLearn },
      });
    }
  }

  // ---- Overall verdict ----
  const passCount = items.filter((i) => i.status === "pass").length;
  const warnCount = items.filter((i) => i.status === "warn").length;
  const failCount = items.filter((i) => i.status === "fail").length;
  const unknownCount = items.filter((i) => i.status === "unknown").length;
  // Rev280 (audit T14): a critical source in `unknown` state (heading,
  // IMU attitude, GPS position, autopilot provider) MUST be treated as
  // fail. Previously the verdict was pass/warn/fail-only, so a boot
  // where five critical sensors were unknown and only one check
  // (pypilot-connect) had produced a "pass" still reported READY,
  // which is worse than saying the truth ("we don't know yet").
  const CRITICAL_IDS = new Set<string>([
    "pypilot-connect",
    "ap-provider",
    "navigation.headingMagnetic",
    "navigation.attitude",
    ...(gpsNeeded ? ["navigation.position"] : []),   // Rev707
  ]);
  const criticalUnknowns = items.filter(
    (i) => i.status === "unknown" && CRITICAL_IDS.has(i.id)
  ).length;
  let overall: OverallVerdict;
  if (failCount > 0 || criticalUnknowns > 0) overall = "do-not-engage";
  else if (warnCount > 0 || unknownCount > 0) overall = "ready-with-caveats";
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
  if (!q) return { id: path, label, status: "unknown", detail: "Not being monitored.", code: "unmonitored" };
  const status = qualityToStatus(q.level);
  const bits: string[] = [];
  if (q.ageMs != null) bits.push(`age ${Math.floor(q.ageMs / 100) / 10}s`);
  if (q.hz != null)    bits.push(`${q.hz.toFixed(2)} Hz`);
  if (q.source)        bits.push(q.source);
  const detail = bits.length > 0 ? bits.join(" · ") : "No data.";
  const params: Record<string, string | number> = {};
  if (q.ageMs != null) params.age = Math.floor(q.ageMs / 100) / 10;
  if (q.hz != null) params.hz = q.hz.toFixed(2);
  if (q.source) params.source = q.source;
  return {
    id: path,
    label,
    status,
    detail,
    hint: status === "pass" ? undefined : hint,
    code: bits.length > 0 ? "sensor" : "nodata",
    params,
  };
}

function qualityToStatus(l: QualityLevel): CheckStatus {
  if (l === "good") return "pass";
  if (l === "degraded") return "warn";
  if (l === "lost") return "fail";
  return "unknown";
}
