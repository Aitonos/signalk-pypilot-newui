import { PypilotCatalog } from "./pypilot-client";

// One entry per pypilot name we know how to translate to Signal K.
// For values from `ap.pilot.<pilot>.<gain>` we handle them dynamically
// (see mapDynamicName below) because the middle segment is discovered.
export interface Mapping {
  skPath: string;
  units?: string;
  displayName?: string;
  description?: string;
  /** Convert pypilot value to SK value (default: identity). */
  convert?: (v: unknown) => unknown;
  /** Kind of PUT accepted by our handler: 'plain' or 'unsupported'. */
  putKind?: "plain" | "unsupported";
  /** True: this path is 'core' Autopilot API territory - never publish. */
  reserved?: boolean;
}

const DEG_TO_RAD = Math.PI / 180;
const CELSIUS_TO_KELVIN = 273.15;

const identity = (v: unknown) => v;
const degToRad = (v: unknown) =>
  typeof v === "number" ? v * DEG_TO_RAD : v;
const cToK = (v: unknown) =>
  typeof v === "number" ? v + CELSIUS_TO_KELVIN : v;

/**
 * Fixed mappings: pypilot key -> SK path descriptor.
 *
 * Rules:
 *   1. Never touch the paths the official pypilot-autopilot-provider owns:
 *      steering.autopilot.{state,mode,target,engaged,availableActions}.
 *   2. Everything else goes under steering.autopilot.pypilot.* .
 *   3. Angles in radians per SK convention.
 *   4. Temperatures in kelvin per SK convention.
 */
export const FIXED_MAPPINGS: Record<string, Mapping> = {
  // Pilot / profile
  "ap.pilot": {
    skPath: "steering.autopilot.pypilot.pilot",
    displayName: "Active pilot",
    description: "Currently selected pypilot algorithm",
    putKind: "plain",
  },
  "profile": {
    skPath: "steering.autopilot.pypilot.profile",
    displayName: "Active profile",
    putKind: "plain",
  },
  "profiles": {
    skPath: "steering.autopilot.pypilot.profiles",
    displayName: "Profiles",
    putKind: "unsupported",
  },

  // Servo telemetry
  "servo.voltage": {
    skPath: "steering.autopilot.pypilot.servo.voltage",
    units: "V",
    displayName: "Servo voltage",
  },
  "servo.current": {
    skPath: "steering.autopilot.pypilot.servo.current",
    units: "A",
    displayName: "Servo current",
  },
  "servo.controller_temp": {
    skPath: "steering.autopilot.pypilot.servo.controllerTemperature",
    units: "K",
    displayName: "Controller temperature",
    convert: cToK,
  },
  "servo.motor_temp": {
    skPath: "steering.autopilot.pypilot.servo.motorTemperature",
    units: "K",
    displayName: "Motor temperature",
    convert: cToK,
  },
  "servo.flags": {
    skPath: "steering.autopilot.pypilot.servo.flags",
    displayName: "Servo flags",
  },
  "servo.amp_hours": {
    skPath: "steering.autopilot.pypilot.servo.ampHours",
    units: "Ah",
    displayName: "Amp-hours consumed",
  },
  "servo.engaged": {
    skPath: "steering.autopilot.pypilot.servo.engaged",
    displayName: "Servo clutch engaged",
  },
  "servo.controller": {
    skPath: "steering.autopilot.pypilot.errors.controller",
    displayName: "Controller error",
  },

  // Rudder calibration (angle -> rad, dimensionless coefficients passthrough)
  "imu.heading_offset": {
    skPath: "steering.autopilot.pypilot.calibration.imuHeadingOffset",
    units: "rad",
    displayName: "IMU heading offset",
    convert: degToRad,
    putKind: "plain",
  },
  "rudder.range": {
    skPath: "steering.autopilot.pypilot.calibration.rudderRange",
    units: "rad",
    displayName: "Rudder range",
    convert: degToRad,
    putKind: "plain",
  },
  "rudder.offset": {
    skPath: "steering.autopilot.pypilot.calibration.rudderOffset",
    displayName: "Rudder offset",
  },
  "rudder.scale": {
    skPath: "steering.autopilot.pypilot.calibration.rudderScale",
    displayName: "Rudder scale",
  },
  "rudder.nonlinearity": {
    skPath: "steering.autopilot.pypilot.calibration.rudderNonlinearity",
    displayName: "Rudder nonlinearity",
  },
  "rudder.calibration_state": {
    skPath: "steering.autopilot.pypilot.calibration.state",
    displayName: "Rudder calibration state",
    putKind: "plain",
  },

  // Tack detail (the tack action itself is owned by pypilot-autopilot-provider)
  "ap.tack.state": {
    skPath: "steering.autopilot.pypilot.tack.state",
    displayName: "Tack state",
  },
  "ap.tack.timeout": {
    skPath: "steering.autopilot.pypilot.tack.timeout",
    units: "s",
    displayName: "Tack timeout",
  },
  "ap.tack.direction": {
    skPath: "steering.autopilot.pypilot.tack.direction",
    displayName: "Tack direction",
  },

  // Warnings & errors
  "imu.error": {
    skPath: "steering.autopilot.pypilot.errors.imu",
    displayName: "IMU error",
  },
  "imu.warning": {
    skPath: "steering.autopilot.pypilot.warnings.imu",
    displayName: "IMU warning",
  },

  // Runtime + version
  "ap.runtime": {
    skPath: "steering.autopilot.pypilot.runtime",
    units: "s",
    displayName: "Autopilot runtime",
  },
  "ap.version": {
    skPath: "steering.autopilot.pypilot.version",
    displayName: "PyPilot version",
  },

  // Modes (list) - handy for UIs even though the provider also carries mode
  "ap.modes": {
    skPath: "steering.autopilot.pypilot.availableModes",
    displayName: "Available modes",
  },
};

/**
 * Extra one-shot publishes at catalog time. These come from the catalog's
 * metadata (e.g. ap.pilot.choices) rather than from a value delta, so we do
 * not have a fixed mapping keyed by pypilot name.
 */
export function extractCatalogDerivedPublishes(
  catalog: Record<string, any>
): Array<{ skPath: string; value: unknown; displayName?: string }> {
  const out: Array<{ skPath: string; value: unknown; displayName?: string }> = [];
  const apPilot = catalog["ap.pilot"];
  if (apPilot && Array.isArray(apPilot.choices)) {
    out.push({
      skPath: "steering.autopilot.pypilot.availablePilots",
      value: apPilot.choices,
      displayName: "Available pilots",
    });
  }
  return out;
}

// Paths whose ownership we cede to pypilot-autopilot-provider. NEVER republish.
export const RESERVED_PYPILOT_KEYS = new Set<string>([
  "ap.enabled",     // -> steering.autopilot.engaged
  "ap.heading",     // navigation.headingMagnetic already owned by pypilot plugin
  "ap.heading_command",
  "ap.mode",        // -> steering.autopilot.mode
]);

/**
 * Dynamic mapping for `ap.pilot.<pilot>.<gain>` values.
 * Returns a Mapping if the name matches, else null.
 */
export function mapDynamicName(
  name: string,
  catalog: PypilotCatalog
): Mapping | null {
  // Gains: `ap.pilot.<pilot>.<gain>` where catalog[<name>].AutopilotGain === true
  if (name.startsWith("ap.pilot.")) {
    const parts = name.split(".");
    if (parts.length >= 4) {
      const pilot = parts[2];
      const gain = parts.slice(3).join(".");
      const meta = catalog[name];
      if (meta && meta.AutopilotGain) {
        return {
          skPath: `steering.autopilot.pypilot.gains.${sanitize(pilot)}.${sanitize(gain)}`,
          displayName: `Gain ${gain} (${pilot})`,
        };
      }
    }
  }
  return null;
}

/**
 * Auto-mapping for anything else, if user opted-in via `publishUnmapped`.
 * Turns `foo.bar.baz` into `steering.autopilot.pypilot.foo.bar.baz`.
 */
export function autoMap(name: string): Mapping {
  return {
    skPath: `steering.autopilot.pypilot.${name.split(".").map(sanitize).join(".")}`,
    displayName: name,
  };
}

/**
 * Reverse-lookup helper for PUT handlers: SK path -> pypilot name.
 */
export function skPathToPypilotName(
  skPath: string,
  catalog: PypilotCatalog
): string | null {
  for (const [name, m] of Object.entries(FIXED_MAPPINGS)) {
    if (m.skPath === skPath) return name;
  }
  // Dynamic gains
  const m = skPath.match(
    /^steering\.autopilot\.pypilot\.gains\.([^.]+)\.(.+)$/
  );
  if (m) {
    const pilot = m[1];
    const gain = m[2];
    const candidate = `ap.pilot.${pilot}.${gain}`;
    if (catalog[candidate]) return candidate;
  }
  // Auto-mapped: reconstruct.
  const prefix = "steering.autopilot.pypilot.";
  if (skPath.startsWith(prefix)) {
    const suffix = skPath.substring(prefix.length);
    if (catalog[suffix]) return suffix;
  }
  return null;
}

function sanitize(s: string): string {
  // SK paths use dot notation; we keep names as-is but forbid spaces and
  // path-corrupting characters. pypilot names are already dot-safe.
  return s.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Convert a raw pypilot value to the value we publish on SK, using the mapping.
 */
export function convertForSK(mapping: Mapping, value: unknown): unknown {
  if (mapping.convert) return mapping.convert(value);
  return value;
}
