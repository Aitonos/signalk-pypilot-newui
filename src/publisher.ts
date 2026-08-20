import { PypilotCatalog, PypilotVarMeta } from "./pypilot-client";

// Rev63 / 2.0.0 - full path standardisation per Sean D'Epagnier's request
// (https://github.com/Aitonos/signalk-pypilot-newui/issues/1).
//
// Every pypilot key maps 1:1 to `steering.autopilot.pypilot.<key>`. No
// hardcoded FIXED_MAPPINGS table, no camelCase rename, no C->K / deg->rad
// conversion layer. Signal K infers units from the path type well enough,
// consumers pick their display unit, and we surface pypilot's own
// `meta.units` verbatim so nothing is lost. This deletes ~150 lines of
// noise and makes the mapping fully predictable for anyone wiring KIP
// widgets or WilhelmSK dashboards.

/**
 * Mapping descriptor kept as a thin shape so the existing consumers in
 * `index.ts` (put-handler registrar, `/paths` router, etc.) can keep the
 * same signature without a rewrite. The fields are all optional now
 * except `skPath`; everything else falls back to pypilot's own metadata.
 */
export interface Mapping {
  skPath: string;
  units?: string;
  displayName?: string;
  description?: string;
  /** Kind of PUT accepted by our handler: 'plain' or 'unsupported'. */
  putKind?: "plain" | "unsupported";
}

const SK_PREFIX = "steering.autopilot.pypilot.";

/**
 * Derive the Signal K path for any pypilot key, verbatim. Only
 * non-`[A-Za-z0-9_]` characters get sanitised to `_` because SK path
 * segments must be safe; pypilot's own naming is already dot-safe so
 * this is a no-op in practice.
 */
export function skPathFor(name: string): string {
  return SK_PREFIX + name.split(".").map(sanitizeSegment).join(".");
}

function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Build a Mapping for a pypilot key using only its catalog metadata.
 * The mapping is generated on demand (there is no dictionary to consult
 * anymore). Every pypilot key produces exactly one SK path.
 */
export function mappingFor(name: string, meta: PypilotVarMeta | undefined): Mapping {
  const m: Mapping = {
    skPath: skPathFor(name),
    displayName: name,
  };
  if (meta) {
    if (typeof meta.units === "string" && meta.units) m.units = meta.units;
    if (isWriteable(meta)) m.putKind = "plain";
  }
  return m;
}

/**
 * A pypilot value is writeable if the catalog metadata does not mark it
 * as sensor-only. In practice pypilot doesn't ship a canonical
 * "writeable" flag, so we conservatively allow PUTs on anything with a
 * scalar/bool/enum type and forbid list-typed metadata slots
 * (e.g. `profiles`) which are read-only aggregations.
 */
function isWriteable(meta: PypilotVarMeta): boolean {
  const t = String(meta.type || "").toLowerCase();
  if (t === "list" || t === "resettable") return false;
  return true;
}

/**
 * Catalog-derived one-shot publishes. `ap.pilot.choices` is a list held
 * inside the catalog metadata (not as a value delta), so we lift it to
 * a first-class `availablePilots` path so KIP / WilhelmSK see it without
 * having to walk metadata blobs.
 */
export function extractCatalogDerivedPublishes(
  catalog: Record<string, any>
): Array<{ skPath: string; value: unknown; displayName?: string }> {
  const out: Array<{ skPath: string; value: unknown; displayName?: string }> = [];
  const apPilot = catalog["ap.pilot"];
  if (apPilot && Array.isArray(apPilot.choices)) {
    out.push({
      skPath: SK_PREFIX + "availablePilots",
      value: apPilot.choices,
      displayName: "Available pilots",
    });
  }
  return out;
}

/**
 * Paths whose ownership we cede to `pypilot-autopilot-provider` (Panaaj's
 * plugin registers these on the canonical SK Autopilot API v2 surface).
 * NEVER republish under `steering.autopilot.pypilot.*`.
 */
export const RESERVED_PYPILOT_KEYS = new Set<string>([
  "ap.enabled",         // -> steering.autopilot.engaged
  "ap.heading",         // navigation.headingMagnetic already owned by pypilot plugin
  "ap.heading_command", // -> steering.autopilot.target
  "ap.mode",            // -> steering.autopilot.mode
]);

/**
 * pypilot values the plugin ALWAYS publishes. Everything else is opt-in
 * when `publishOnlyEssentials` is on (the default). The webapp does not
 * need any of these to render Control tab (the SK Autopilot API v2
 * covers state/mode/target/engaged/availableActions via our absorbed
 * provider), but keeping them essential means the Tune / Paths & API
 * tabs still work without asking the user to hunt for individual toggles.
 */
export const ESSENTIAL_PYPILOT_KEYS = new Set<string>([
  // UI selectors
  "ap.pilot",
  "ap.modes",
  "profile",
  "profiles",
  // Tack action state
  "ap.tack.state",
  "ap.tack.direction",
  // Servo state for the small indicator
  "servo.engaged",
]);

/**
 * Reverse-lookup helper for PUT handlers: SK path -> pypilot key.
 * Since every publish path is derived by prepending `SK_PREFIX`, this
 * is just a prefix strip + catalog membership check.
 */
export function skPathToPypilotName(
  skPath: string,
  catalog: PypilotCatalog
): string | null {
  if (!skPath.startsWith(SK_PREFIX)) return null;
  const suffix = skPath.substring(SK_PREFIX.length);
  return catalog[suffix] ? suffix : null;
}
