// Profile metadata store.
//
// pypilot itself has no room for custom metadata on a profile (it's
// just a named bundle of gains + tack settings + servo params).  This
// module keeps a parallel dictionary that lives inside the plugin's
// pluginOptions, so the sailor can tag each profile with:
//
//   condition:  what wind band / mode the profile is meant for
//               (light / medium / heavy / motor / custom)
//   notes:      a short free-text hint that shows up as a tooltip
//               under the profile name in the visor
//
// The visor renders these hints as chips next to the profile picker.
// The future auto-profile-by-condition supervisor can also read them
// to auto-select the right profile for the current TWS band without
// the sailor having to configure the light/medium/heavy slots by
// hand in Smart Pilot.
//
// This module is PURE. Persistence happens via app.savePluginOptions
// in the plugin's request handler.

export const CONDITIONS = ["light", "medium", "heavy", "motor", "custom"] as const;
export type Condition = typeof CONDITIONS[number];

export interface ProfileEntry {
  condition: Condition;
  notes?: string;
  updatedTs: number;
}

/** The dictionary is a plain map of profileName → entry. Keys are
 *  case-sensitive; pypilot profile names are opaque strings. */
export type ProfileMetadata = Record<string, ProfileEntry>;

export interface UpsertInput {
  condition?: Condition;
  notes?: string | null;
}

const MAX_NOTES_LEN = 200;

/** Validate the body of a PUT /profiles/metadata/:name request.
 *  Returns null on success or a human-readable error message. */
export function validateUpsert(x: unknown): string | null {
  if (!x || typeof x !== "object") return "body is not an object";
  const b = x as Record<string, unknown>;
  if (b.condition !== undefined && !CONDITIONS.includes(b.condition as Condition)) {
    return `condition '${String(b.condition)}' not in [${CONDITIONS.join(",")}]`;
  }
  if (b.notes !== undefined && b.notes !== null && typeof b.notes !== "string") {
    return "notes must be a string or null";
  }
  if (typeof b.notes === "string" && b.notes.length > MAX_NOTES_LEN) {
    return `notes exceeds ${MAX_NOTES_LEN} characters`;
  }
  return null;
}

/** Validate a persisted metadata object, coming back from pluginOptions
 *  after a plugin restart. Kept liberal — malformed rows are dropped,
 *  not rejected, so a single corrupt entry can't lock the sailor out
 *  of the whole store. */
export function loadMetadata(x: unknown): ProfileMetadata {
  if (!x || typeof x !== "object") return {};
  const out: ProfileMetadata = {};
  for (const [name, raw] of Object.entries(x as Record<string, unknown>)) {
    if (!name) continue;
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (!CONDITIONS.includes(r.condition as Condition)) continue;
    const ts = typeof r.updatedTs === "number" ? r.updatedTs : 0;
    const notes = typeof r.notes === "string" && r.notes.length > 0 && r.notes.length <= MAX_NOTES_LEN
      ? r.notes : undefined;
    out[name] = { condition: r.condition as Condition, updatedTs: ts, notes };
  }
  return out;
}

/** Apply an upsert to a mutable metadata store. Returns the new entry
 *  (never null — the caller is responsible for handling name validity).
 *  If both `condition` and `notes` are omitted, the existing entry is
 *  refreshed with the current timestamp only (i.e. touch). */
export function upsert(
  store: ProfileMetadata,
  name: string,
  input: UpsertInput,
  nowMs: number,
): ProfileEntry {
  const prev = store[name];
  const cond: Condition = input.condition ?? prev?.condition ?? "custom";
  let notes: string | undefined = prev?.notes;
  if (input.notes === null) notes = undefined;
  else if (typeof input.notes === "string") notes = input.notes.length > 0 ? input.notes : undefined;
  const entry: ProfileEntry = { condition: cond, updatedTs: nowMs, ...(notes ? { notes } : {}) };
  store[name] = entry;
  return entry;
}

/** Remove one entry. Returns true if it existed. */
export function remove(store: ProfileMetadata, name: string): boolean {
  if (!(name in store)) return false;
  delete store[name];
  return true;
}

/** For a given target condition, return the profile names tagged with
 *  it, newest-updated first. Used by the future auto-select supervisor
 *  and by the visor to render "matching" chips. */
export function findByCondition(store: ProfileMetadata, condition: Condition): string[] {
  const rows: Array<[string, number]> = [];
  for (const [name, e] of Object.entries(store)) {
    if (e.condition === condition) rows.push([name, e.updatedTs]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  return rows.map(r => r[0]);
}
