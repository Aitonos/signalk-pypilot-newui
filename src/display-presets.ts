// Rev522 (Carlos 2026-10-20): named rose display presets. The visor
// keeps its rose layout in per-device browser keys (corners, extras,
// custom paths, bottom chip, wind corner, A/T arrows, COG, current, helm
// bar). A preset is a named snapshot of those keys; "server" presets live
// here so every device can apply them ("local" ones stay in the browser).
import * as fs from "fs";

/** Browser keys a preset may carry (anything else is dropped). */
export const DISPLAY_PRESET_KEYS: readonly string[] = [
  "pypilot-newui.dashCorners",
  "pypilot-newui.dashExtras",
  "pypilot-newui.dashCustom",
  "pypilot-newui.roseBottomChipPaths",
  "pypilot-newui.windCornerShow",
  "pypilot-newui.windCornerPinned",
  "pypilot-newui.windArrow.awa",
  "pypilot-newui.windArrow.twa",
  "pypilot-newui.showCog",
  "pypilot-newui.showCurrent",
  "pypilotnewui.helmBar",
];
export const MAX_PRESETS = 30;
export const MAX_NAME_LEN = 40;
export const MAX_VALUE_LEN = 20_000;

export interface DisplayPreset {
  name: string;
  /** key -> raw browser value (null = key absent on the saving device). */
  data: Record<string, string | null>;
  updatedAt: number;
}

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME_LEN);
  return n.length > 0 ? n : null;
}

export function sanitizeData(raw: unknown): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of DISPLAY_PRESET_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === null) out[k] = null;
    else if (typeof v === "string" && v.length <= MAX_VALUE_LEN) out[k] = v;
  }
  return out;
}

export class DisplayPresets {
  private presets: DisplayPreset[] = [];

  constructor(private readonly file: string | null) {
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(j?.presets)) {
        for (const p of j.presets) {
          const name = sanitizeName(p?.name);
          if (name) this.presets.push({ name, data: sanitizeData(p?.data), updatedAt: Number(p?.updatedAt) || 0 });
        }
      }
    } catch { /* first run */ }
  }

  list(): DisplayPreset[] {
    return this.presets.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Create or overwrite by name. Returns null when the name is invalid or full. */
  save(rawName: unknown, rawData: unknown, nowMs = Date.now()): DisplayPreset | null {
    const name = sanitizeName(rawName);
    if (!name) return null;
    const data = sanitizeData(rawData);
    const i = this.presets.findIndex((p) => p.name === name);
    const preset = { name, data, updatedAt: nowMs };
    if (i >= 0) this.presets[i] = preset;
    else {
      if (this.presets.length >= MAX_PRESETS) return null;
      this.presets.push(preset);
    }
    this.persist();
    return preset;
  }

  remove(rawName: unknown): boolean {
    const name = sanitizeName(rawName);
    const i = this.presets.findIndex((p) => p.name === name);
    if (i < 0) return false;
    this.presets.splice(i, 1);
    this.persist();
    return true;
  }

  private persist(): void {
    if (!this.file) return;
    // Rev537 (Gemini review 4 #4): tmp + rename, so a power cut mid-write
    // never leaves an empty presets file.
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ presets: this.presets }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch { /* best effort */ }
  }
}
