// Config backup + restore helpers.
//
// Two independent things travel in one bundle:
//   1. This plugin's own SK options (host, port, propose*, thresholds).
//   2. The pypilot core settings that the boat spent effort tuning
//      (P/I/D/DD/FF per pilot, tack angle/rate/delay/threshold, servo
//      max_current, wind offset, compass alignment, profile names).
//
// Runtime values (headings, currents, temps) are NOT included. The
// filter distinguishes them by name: any key whose "info.persistent"
// flag is true in the pypilot catalog, or that matches an explicit
// whitelist, is treated as a persistent setting.
//
// Restore applies the pypilot settings back to the core one at a time
// via client.set(). The plugin's own props are handed back to the
// caller so it can savePluginOptions() them.

export interface ConfigBundle {
  /** Bundle format version. */
  version: 1;
  /** Wall-clock ms when the bundle was captured. */
  capturedTs: number;
  /** Plugin revision at capture time. */
  revision: string;
  /** Human note attached to the backup (free text, optional). */
  note?: string;
  /** This plugin's own SK options (from readPluginOptions). */
  pluginOptions: Record<string, unknown>;
  /** Pypilot core persistent settings (key → value). */
  pypilotSettings: Record<string, unknown>;
}

/** Extra pypilot keys we always include even if their catalog entry
 *  does not flag them as persistent. Empirically these have proved
 *  worth carrying across a restore. */
const EXTRA_PERSISTENT_KEYS = [
  "ap.mode",
  "profile",
  "profiles",
  "servo.max_current",
  "servo.min_speed",
  "servo.max_speed",
];

/** Runtime keys we NEVER include even if the catalog claims persistent. */
const RUNTIME_BLOCKLIST_SUFFIXES = [
  ".command",
  ".position",
  ".voltage",
  ".current",
  ".temperature",
  ".rate",
  ".heading",
  ".heel",
  ".pitch",
  ".roll",
  ".fault",
  ".flags",
];

/** Returns true if the value of a pypilot key looks like a runtime
 *  telemetry number (which we should never include in a config backup)
 *  rather than a persistent setting. */
export function isRuntimeKey(key: string): boolean {
  for (const suf of RUNTIME_BLOCKLIST_SUFFIXES) {
    if (key.endsWith(suf)) return true;
  }
  return false;
}

/** Build a bundle from the current in-memory state. `catalog` comes
 *  from client.getCatalog(); `values` from client.getValues(); `props`
 *  from the plugin's own options. */
export function captureBundle(args: {
  revision: string;
  props: Record<string, unknown>;
  catalog: Record<string, { info?: { persistent?: boolean; type?: string } }>;
  values: Record<string, unknown>;
  note?: string;
}): ConfigBundle {
  const pypilotSettings: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(args.catalog)) {
    const persistent = entry?.info?.persistent === true;
    const extra = EXTRA_PERSISTENT_KEYS.includes(key);
    if (!persistent && !extra) continue;
    if (isRuntimeKey(key)) continue;
    const v = args.values[key];
    if (v === undefined) continue;
    // Skip nested objects and arrays — pypilot settings are scalars.
    if (typeof v === "object" && v !== null) continue;
    pypilotSettings[key] = v;
  }
  return {
    version: 1,
    capturedTs: Date.now(),
    revision: args.revision,
    note: args.note,
    pluginOptions: JSON.parse(JSON.stringify(args.props)),
    pypilotSettings,
  };
}

/** Validate that a bundle looks well-formed. Returns null on success,
 *  an error message otherwise. Kept liberal — we accept older
 *  bundles even if some fields are missing, as long as the essentials
 *  parse. */
export function validateBundle(b: unknown): string | null {
  if (!b || typeof b !== "object") return "not an object";
  const bb = b as Partial<ConfigBundle>;
  if (bb.version !== 1) return `unsupported version: ${(bb as any).version}`;
  if (typeof bb.capturedTs !== "number") return "capturedTs missing";
  if (!bb.pluginOptions || typeof bb.pluginOptions !== "object") return "pluginOptions missing";
  if (!bb.pypilotSettings || typeof bb.pypilotSettings !== "object") return "pypilotSettings missing";
  for (const [k, v] of Object.entries(bb.pypilotSettings)) {
    if (v && typeof v === "object") return `pypilotSettings.${k} is not a scalar`;
  }
  return null;
}

/** Apply the pypilot settings from a bundle to the running core via
 *  the given setter. Skips keys that no longer exist in the catalog
 *  (a firmware downgrade would remove them). Returns an audit list. */
export function applyBundleToPypilot(
  bundle: ConfigBundle,
  catalog: Record<string, unknown>,
  set: (key: string, value: unknown) => void,
): Array<{ key: string; status: "applied" | "skipped-unknown" | "skipped-runtime" | "error"; error?: string }> {
  const out: Array<{ key: string; status: "applied" | "skipped-unknown" | "skipped-runtime" | "error"; error?: string }> = [];
  for (const [key, value] of Object.entries(bundle.pypilotSettings)) {
    if (isRuntimeKey(key)) { out.push({ key, status: "skipped-runtime" }); continue; }
    if (!(key in catalog)) { out.push({ key, status: "skipped-unknown" }); continue; }
    try {
      set(key, value);
      out.push({ key, status: "applied" });
    } catch (e: any) {
      out.push({ key, status: "error", error: String(e?.message || e) });
    }
  }
  return out;
}
