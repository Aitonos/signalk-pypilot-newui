// Rev498 (Carlos 2026-10-17, "sonaban los avisos pero no se veían en la
// tablet"): visor preferences that change WHAT the sailor is warned
// about used to live in each browser's localStorage, so the tablet, the
// phone and the laptop could disagree (one in harbour mode, the other
// underway; a target silenced on one device still nagging on another;
// gust ghost on here, off there). They now live here, persisted next to
// the plugin data, and every visor reads / writes the same copy.
//
// Also owns the AIS "harbour auto" machine (Rev462/464): silence AIS
// alarms while WE are moored. It used to run in every visor from the
// SOG it had seen since page load, so two devices could be in different
// states; now it is evaluated once, here.

import * as fs from "fs";
import * as path from "path";

export type AisMode = "off" | "anchor" | "underway";
export const AIS_MODES: readonly AisMode[] = ["off", "anchor", "underway"];

export interface VisorPrefsData {
  aisMode: AisMode;
  aisVoice: boolean;
  aisHarborAuto: boolean;
  gustGhost: boolean;
  /** Rev522: short click on every tap (off by default). */
  tapSound: boolean;
  /** mmsi -> silenced-until epoch ms */
  aisAcks: Record<string, number>;
  /** false until the first visor uploads its legacy localStorage values */
  initialized: boolean;
  updatedAt: number;
}

export interface VisorPrefsSnapshot extends VisorPrefsData {
  harborActive: boolean;
  now: number;
}

export const DEFAULT_VISOR_PREFS: VisorPrefsData = {
  aisMode: "underway",
  aisVoice: true,
  aisHarborAuto: true,
  gustGhost: true,
  tapSound: false,
  aisAcks: {},
  initialized: false,
  updatedAt: 0,
};

// Same thresholds the visor used (Rev462).
export const HARBOR_ENTER_SOG_MS = 0.30;   // < 0.6 kn
export const HARBOR_EXIT_SOG_MS = 0.60;    // > 1.2 kn
export const HARBOR_ENTER_HOLD_MS = 120_000;
export const HARBOR_EXIT_HOLD_MS = 30_000;
export const AIS_ACK_TTL_MS = 10 * 60 * 1000;
const MAX_ACK_TTL_MS = 24 * 60 * 60 * 1000;

export class VisorPrefs {
  private data: VisorPrefsData = { ...DEFAULT_VISOR_PREFS, aisAcks: {} };
  private harborActive = false;
  private slowSince: number | null = null;
  private fastSince: number | null = null;

  constructor(private readonly file: string | null) {
    this.load();
  }

  private load(): void {
    if (!this.file) return;
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = sanitize(raw, this.data);
    } catch { /* keep defaults */ }
  }

  private save(): void {
    if (!this.file) return;
    try {
      const tmp = this.file + ".tmp";
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch { /* best effort */ }
  }

  snapshot(now = Date.now()): VisorPrefsSnapshot {
    this.pruneAcks(now);
    return {
      ...this.data,
      aisAcks: { ...this.data.aisAcks },
      harborActive: this.data.aisHarborAuto && this.harborActive,
      now,
    };
  }

  /** Partial update from a visor. Unknown / invalid fields are ignored. */
  update(patch: unknown, now = Date.now()): VisorPrefsSnapshot {
    const next = sanitize(patch, this.data);
    // aisAcks are only changed through ack()/unack(), never by a patch.
    next.aisAcks = this.data.aisAcks;
    next.initialized = true;
    next.updatedAt = now;
    if (!next.aisHarborAuto) this.resetHarbor();
    this.data = next;
    this.save();
    return this.snapshot(now);
  }

  ack(mmsi: string, ttlMs = AIS_ACK_TTL_MS, now = Date.now()): VisorPrefsSnapshot {
    const id = normMmsi(mmsi);
    if (id) {
      const ttl = Math.max(1000, Math.min(MAX_ACK_TTL_MS, Number(ttlMs) || AIS_ACK_TTL_MS));
      this.data.aisAcks[id] = now + ttl;
      this.data.updatedAt = now;
      this.save();
    }
    return this.snapshot(now);
  }

  /** mmsi = "all" clears every silenced target. */
  unack(mmsi: string, now = Date.now()): VisorPrefsSnapshot {
    if (mmsi === "all") this.data.aisAcks = {};
    else {
      const id = normMmsi(mmsi);
      if (id) delete this.data.aisAcks[id];
    }
    this.data.updatedAt = now;
    this.save();
    return this.snapshot(now);
  }

  /** Feed own SOG (m/s). Returns true when the harbour state flipped. */
  tickHarbor(sog: number | null, now = Date.now()): boolean {
    if (!this.data.aisHarborAuto || sog == null || !isFinite(sog)) return false;
    const before = this.harborActive;
    if (!this.harborActive) {
      if (sog < HARBOR_ENTER_SOG_MS) {
        if (this.slowSince == null) this.slowSince = now;
        if (now - this.slowSince >= HARBOR_ENTER_HOLD_MS) {
          this.harborActive = true;
          this.fastSince = null;
        }
      } else {
        this.slowSince = null;
      }
    } else if (sog > HARBOR_EXIT_SOG_MS) {
      if (this.fastSince == null) this.fastSince = now;
      if (now - this.fastSince >= HARBOR_EXIT_HOLD_MS) {
        this.harborActive = false;
        this.slowSince = null;
      }
    } else {
      this.fastSince = null;
    }
    return before !== this.harborActive;
  }

  private resetHarbor(): void {
    this.harborActive = false;
    this.slowSince = null;
    this.fastSince = null;
  }

  private pruneAcks(now: number): void {
    let changed = false;
    for (const [k, exp] of Object.entries(this.data.aisAcks)) {
      if (!(exp > now)) { delete this.data.aisAcks[k]; changed = true; }
    }
    if (changed) this.save();
  }
}

function normMmsi(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{6,10}$/.test(s) ? s : null;
}

function sanitize(raw: unknown, base: VisorPrefsData): VisorPrefsData {
  const out: VisorPrefsData = { ...base, aisAcks: { ...base.aisAcks } };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.aisMode === "string" && (AIS_MODES as readonly string[]).includes(r.aisMode)) {
    out.aisMode = r.aisMode as AisMode;
  }
  if (typeof r.aisVoice === "boolean") out.aisVoice = r.aisVoice;
  if (typeof r.aisHarborAuto === "boolean") out.aisHarborAuto = r.aisHarborAuto;
  if (typeof r.gustGhost === "boolean") out.gustGhost = r.gustGhost;
  if (typeof r.tapSound === "boolean") out.tapSound = r.tapSound;
  if (typeof r.initialized === "boolean") out.initialized = r.initialized;
  if (typeof r.updatedAt === "number" && isFinite(r.updatedAt)) out.updatedAt = r.updatedAt;
  if (r.aisAcks && typeof r.aisAcks === "object") {
    const acks: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.aisAcks as Record<string, unknown>)) {
      const id = normMmsi(k);
      if (id && typeof v === "number" && isFinite(v)) acks[id] = v;
    }
    out.aisAcks = acks;
  }
  return out;
}
