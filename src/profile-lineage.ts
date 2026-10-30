// Rev569 (Carlos 2026-10-30, "que los perfiles grabados tengan un
// timestamp para saber si es uno creado desde cero o mejorando otro
// anterior, como un versionado"): history of each pypilot profile.
//
// pypilot has no "empty" profile: writing an unknown name to `profile`
// creates it as a copy of the active one. So every profile created while
// the plugin runs has a parent (the profile active at that moment), a
// creation time, how it was made (Tune fork, New, Doctor, import...) and
// a version = parent's version + 1. Profiles that existed before have no
// entry ("no history"); counted as v1 when they become a parent.
//
// A rename in the visor is "copy to the new name, delete the old one";
// renameIfPending() turns that pair back into a rename that keeps the
// old profile's version and history.
//
// Pure data. The plugin persists the store in its options.

export type LineageOrigin = "new" | "tune" | "doctor" | "import" | "user" | "external";

export interface LineageEntry {
  createdTs: number;
  /** Profile active when this one was created (its gains were the start). */
  parent: string | null;
  origin: LineageOrigin;
  version: number;
  /** Set when the profile got its current name by a rename. */
  renamedFrom?: string;
  renamedTs?: number;
}

export type ProfileLineage = Record<string, LineageEntry>;

const ORIGINS: LineageOrigin[] = ["new", "tune", "doctor", "import", "user", "external"];
const MAX_ENTRIES = 300;
/** A delete this soon after a copy from the same profile is a rename. */
export const RENAME_WINDOW_MS = 15_000;

export function loadLineage(x: unknown): ProfileLineage {
  if (!x || typeof x !== "object") return {};
  const out: ProfileLineage = {};
  for (const [name, raw] of Object.entries(x as Record<string, unknown>)) {
    if (!name || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.createdTs !== "number" || typeof r.version !== "number") continue;
    out[name] = {
      createdTs: r.createdTs,
      parent: typeof r.parent === "string" ? r.parent : null,
      origin: ORIGINS.includes(r.origin as LineageOrigin) ? r.origin as LineageOrigin : "external",
      version: Math.max(1, Math.floor(r.version)),
      ...(typeof r.renamedFrom === "string" ? { renamedFrom: r.renamedFrom } : {}),
      ...(typeof r.renamedTs === "number" ? { renamedTs: r.renamedTs } : {}),
    };
  }
  return out;
}

/** Record a new profile copied from `parent`. */
export function recordCreation(
  store: ProfileLineage, name: string, parent: string | null, origin: LineageOrigin, now: number,
): LineageEntry {
  const parentVersion = parent ? (store[parent]?.version ?? 1) : 0;
  const entry: LineageEntry = { createdTs: now, parent, origin, version: parentVersion + 1 };
  store[name] = entry;
  trim(store);
  return entry;
}

/** Called when `removed` disappears from pypilot's list. If a profile was
 *  copied from it moments ago, that copy is the renamed profile: it takes
 *  over the old history and version. Returns the new name, or null. */
export function renameIfPending(store: ProfileLineage, removed: string, now: number): string | null {
  const old = store[removed];
  let renamedTo: string | null = null;
  for (const [name, e] of Object.entries(store)) {
    if (e.parent === removed && !e.renamedFrom && now - e.createdTs <= RENAME_WINDOW_MS) {
      renamedTo = name;
      break;
    }
  }
  if (renamedTo) {
    // Renaming a profile without history keeps it without history
    // (createdTs 0 = unknown) but remembers the rename.
    store[renamedTo] = old
      ? { ...old, renamedFrom: removed, renamedTs: now }
      : { createdTs: 0, parent: null, origin: "external", version: 1, renamedFrom: removed, renamedTs: now };
  }
  delete store[removed];
  return renamedTo;
}

/** Names that look the same to a person: case, and extra or trailing spaces. */
export function lookAlikes(names: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const k = n.trim().replace(/\s+/g, " ").toLowerCase();
    groups.set(k, [...(groups.get(k) || []), n]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function trim(store: ProfileLineage): void {
  const names = Object.keys(store);
  if (names.length <= MAX_ENTRIES) return;
  names.sort((a, b) => store[a].createdTs - store[b].createdTs);
  for (const n of names.slice(0, names.length - MAX_ENTRIES)) delete store[n];
}
