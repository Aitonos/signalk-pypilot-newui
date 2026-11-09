// Rev668 (Carlos 2026-11-09): restore pypilot from a settings backup.
//
// The backup carries the TinyPilot's own pypilot.conf: global "key=value"
// lines, then one section per profile, `[profile="name"]`, with that
// profile's values (gains). The restore does NOT replace files on the
// TinyPilot (its persistence is delicate); it goes through pypilot itself,
// profile by profile - select it, write its values - so pypilot saves them.
//
// Decided by Carlos:
// - every profile in the backup is restored (gains, always);
// - installation settings (IMU / compass calibration, servo, NMEA,
//   offsets) only when asked - a new sensor or servo would make them wrong;
// - profiles that exist now and are not in the backup are left alone.

import { isRestoreBlocked } from "./config-backup";

export interface ParsedPypilotConf {
  global: Record<string, unknown>;
  profiles: { name: string; values: Record<string, unknown> }[];
}

function parseValue(raw: string): { ok: boolean; value?: unknown } {
  const s = raw.trim();
  try { return { ok: true, value: JSON.parse(s) }; } catch { /* python-ish */ }
  if (s === "True") return { ok: true, value: true };
  if (s === "False") return { ok: true, value: false };
  return { ok: false };
}

export function parsePypilotConf(text: string): ParsedPypilotConf {
  const out: ParsedPypilotConf = { global: {}, profiles: [] };
  let cur: Record<string, unknown> = out.global;
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const sec = /^\[profile=(.*)\]\s*$/.exec(line);
    if (sec) {
      const n = parseValue(sec[1]);
      if (!n.ok || typeof n.value !== "string") { cur = {}; continue; }   // unreadable section: skipped
      const p = { name: n.value, values: {} as Record<string, unknown> };
      out.profiles.push(p);
      cur = p.values;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const v = parseValue(line.slice(eq + 1));
    if (v.ok) cur[key] = v.value;
  }
  return out;
}

export interface CatalogEntry { profiled?: boolean; AutopilotGain?: boolean; persistent?: boolean; info?: { persistent?: boolean } }

export interface RestorePlan {
  profiles: { name: string; values: Record<string, unknown> }[];
  installation: Record<string, unknown>;
  skipped: string[];
  /** Sections of profiles deleted before the copy was made. */
  staleProfiles: string[];
}

/** Global keys that look like settings but are counters, values pypilot
 *  recomputes, raw calibration samples, or pypilot's own identity towards
 *  Signal K (restoring an old one would confuse its access). */
export const INSTALLATION_NEVER = new Set<string>([
  "servo.faults", "servo.amp_hours", "ap.tack.count",
  "imu.gyrobias", "imu.accel.calibration.points", "imu.compass.calibration.points",
  "signalk.uid",
]);

/** Profile values: keys pypilot knows, never orders (engage, mode, target,
 *  tack, servo commands). Installation: global persistent keys that are not
 *  per-profile, same filter, only when `withInstallation`. */
export function planRestore(conf: ParsedPypilotConf, catalog: Record<string, CatalogEntry>, withInstallation: boolean): RestorePlan {
  const skipped = new Set<string>();
  const usable = (k: string) => {
    if (k === "profile" || k === "profiles") return false;
    if (isRestoreBlocked(k) || !(k in catalog)) { skipped.add(k); return false; }
    return true;
  };
  // pypilot keeps the section of a profile after the profile is deleted (the
  // boat's file: 63 sections, 12 profiles). Only the profiles listed in
  // `profiles=` when the copy was made are real; the rest stay buried.
  const listed = Array.isArray(conf.global["profiles"]) ? new Set((conf.global["profiles"] as unknown[]).map(String)) : null;
  const staleProfiles: string[] = [];
  const profiles = conf.profiles.filter((p) => {
    if (!listed || listed.has(p.name)) return true;
    staleProfiles.push(p.name);
    return false;
  }).map((p) => {
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p.values)) if (usable(k)) values[k] = v;
    return { name: p.name, values };
  });
  const installation: Record<string, unknown> = {};
  if (withInstallation) {
    for (const [k, v] of Object.entries(conf.global)) {
      const e = catalog[k];
      const profiled = !!(e && (e.profiled || e.AutopilotGain));
      if (profiled) continue;   // per profile: comes from the sections
      if (INSTALLATION_NEVER.has(k)) { skipped.add(k); continue; }
      if (usable(k)) installation[k] = v;
    }
  }
  return { profiles, installation, skipped: [...skipped].sort(), staleProfiles };
}
