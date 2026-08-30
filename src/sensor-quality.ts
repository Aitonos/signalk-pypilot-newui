// Rev97: Sensor Quality monitor. Watches the freshness / update rate /
// jitter / source of a curated list of SK paths the AP relies on, and
// exposes a snapshot via /quality for the frontend Sensor Quality panel.
//
// Approach: reuse the historian's 1 Hz tick. On each tick we peek at
// `app.getSelfPath(path)` for every watched path and compare its
// timestamp with the last one we saw. Timestamp bumped -> a new source
// sample arrived; keep it in a small ring buffer of arrival times so we
// can compute observed Hz and jitter over a rolling window.
//
// The monitor is intentionally source-agnostic: it does NOT subscribe to
// the SK delta bus. Sampling at 1 Hz is enough to grade "fresh / stale
// / lost" and estimate update frequency for values up to ~5 Hz cleanly.
// Faster sources (10 Hz IMU) will get a slightly underestimated Hz but
// the freshness and jitter classification is still meaningful.

export type QualityLevel = "good" | "degraded" | "lost" | "missing";

export interface QualityThreshold {
  /** Above this age -> degraded. */
  degradedAgeMs: number;
  /** Above this age -> lost. */
  lostAgeMs: number;
  /** Nominal minimum Hz. Below this the panel flags degraded even if
   *  the last sample is fresh (e.g. IMU reporting once and then dead). */
  minHz?: number;
  /** Optional friendly label shown in the panel. Defaults to the SK path. */
  label?: string;
}

export interface PathQuality {
  path: string;
  label: string;
  ageMs: number | null;
  hz: number | null;
  jitterMs: number | null;
  source: string | null;
  level: QualityLevel;
  /** Most recent value. May be a number, string, or an object like
   *  `navigation.attitude` = { pitch, roll, yaw }. */
  lastValue: unknown;
  /** Sample count in the rolling stats window (default 30 s). */
  samplesInWindow: number;
}

export interface QualitySnapshot {
  computedTs: number;
  windowSec: number;
  items: PathQuality[];
}

/** Curated list of paths the AP actually leans on. Each row can be
 *  extended per-installation later - for now the defaults cover the
 *  common OpenPlotter + pypilot stack.
 *
 *  Rev98: `minHz` intentionally omitted from the defaults. The
 *  historian samples at 1 Hz, so the Hz OBSERVED by the monitor is
 *  capped at ~1.0 even if the underlying sensor publishes at 5-10 Hz -
 *  a `minHz: 1` threshold produced spurious "degraded" flags whenever
 *  jitter dipped the measurement below 1.0. Freshness (`age`) is a
 *  much better proxy for "is this sensor alive": if the source dies,
 *  the age climbs past `degradedAgeMs` in seconds. The Hz column is
 *  still shown for diagnostic value, it just no longer penalises the
 *  status pill. */
export const DEFAULT_QUALITY_WATCH: Record<string, QualityThreshold> = {
  "navigation.headingMagnetic":       { label: "Heading",     degradedAgeMs: 2000,  lostAgeMs: 8000 },
  "navigation.attitude":              { label: "IMU attitude", degradedAgeMs: 2000, lostAgeMs: 8000 },
  "navigation.speedOverGround":       { label: "SOG",         degradedAgeMs: 5000,  lostAgeMs: 30000 },
  "navigation.courseOverGroundTrue":  { label: "COG",         degradedAgeMs: 5000,  lostAgeMs: 30000 },
  "navigation.position":              { label: "GPS position", degradedAgeMs: 5000, lostAgeMs: 30000 },
  "environment.wind.angleApparent":   { label: "AWA",         degradedAgeMs: 5000,  lostAgeMs: 30000 },
  "environment.wind.speedApparent":   { label: "AWS",         degradedAgeMs: 5000,  lostAgeMs: 30000 },
  "environment.wind.speedTrue":       { label: "TWS",         degradedAgeMs: 5000,  lostAgeMs: 30000 },
  "steering.rudderAngle":             { label: "Rudder",      degradedAgeMs: 3000,  lostAgeMs: 20000 },
};

export interface QualityOptions {
  /** Rolling window (ms) used to derive Hz and jitter. Default 30_000. */
  windowMs?: number;
  /** Max arrivals kept per path (safety cap on RAM). Default 60. */
  bufferPerPath?: number;
}

interface Slot {
  path: string;
  threshold: QualityThreshold;
  /** Ring buffer of arrival wall-clock ms. */
  arrivals: number[];
  head: number;
  count: number;
  /** SK-reported timestamp of the last sample we counted (dedup key). */
  lastSkTs: number | null;
  lastValue: unknown;
  lastSource: string | null;
}

export class SensorQualityMonitor {
  private readonly windowMs: number;
  private readonly bufferPerPath: number;
  private readonly slots = new Map<string, Slot>();

  constructor(watch: Record<string, QualityThreshold>, opts: QualityOptions = {}) {
    this.windowMs = Math.max(5_000, opts.windowMs ?? 30_000);
    this.bufferPerPath = Math.max(10, opts.bufferPerPath ?? 60);
    for (const [path, thr] of Object.entries(watch)) {
      this.slots.set(path, {
        path,
        threshold: thr,
        arrivals: new Array(this.bufferPerPath).fill(0),
        head: 0,
        count: 0,
        lastSkTs: null,
        lastValue: null,
        lastSource: null,
      });
    }
  }

  /** Feed one observation into the monitor. Called from the plugin's
   *  sampler tick with the SK entry as returned by `app.getSelfPath()`
   *  (the FULL object, not just .value). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  observe(path: string, entry: any, nowMs: number): void {
    const slot = this.slots.get(path);
    if (!slot) return;
    if (!entry || typeof entry !== "object") return;
    // Skip if value is undefined - the path exists in the store but has
    // never received a real update (a shell entry from another plugin).
    if (entry.value === undefined) return;
    // Timestamp may arrive as ISO string, epoch ms, or Date. Normalise.
    const skTs = normaliseTs(entry.timestamp ?? entry.$source);
    slot.lastValue = entry.value;
    slot.lastSource = pickSource(entry);
    if (skTs == null) {
      // No timestamp - fall back to counting each observation as fresh,
      // one per tick. This is worst-case; log-only paths still work.
      this.pushArrival(slot, nowMs);
      slot.lastSkTs = nowMs;
      return;
    }
    if (slot.lastSkTs != null && skTs === slot.lastSkTs) {
      // Same sample as last tick - source did not publish new data.
      return;
    }
    this.pushArrival(slot, nowMs);
    slot.lastSkTs = skTs;
  }

  private pushArrival(slot: Slot, ts: number): void {
    slot.arrivals[slot.head] = ts;
    slot.head = (slot.head + 1) % this.bufferPerPath;
    if (slot.count < this.bufferPerPath) slot.count += 1;
  }

  snapshot(nowMs: number = Date.now()): QualitySnapshot {
    const items: PathQuality[] = [];
    for (const slot of this.slots.values()) {
      items.push(this.classify(slot, nowMs));
    }
    return {
      computedTs: nowMs,
      windowSec: this.windowMs / 1000,
      items,
    };
  }

  private classify(slot: Slot, nowMs: number): PathQuality {
    if (slot.count === 0 || slot.lastSkTs == null) {
      return {
        path: slot.path,
        label: slot.threshold.label || slot.path,
        ageMs: null,
        hz: null,
        jitterMs: null,
        source: null,
        level: "missing",
        lastValue: null,
        samplesInWindow: 0,
      };
    }
    // Age is the wall-clock gap since our most recent unique arrival.
    const start = (slot.head - slot.count + this.bufferPerPath) % this.bufferPerPath;
    const arrivalsChron: number[] = [];
    for (let i = 0; i < slot.count; i += 1) {
      const idx = (start + i) % this.bufferPerPath;
      const t = slot.arrivals[idx];
      if (t >= nowMs - this.windowMs) arrivalsChron.push(t);
    }
    const lastArrival = slot.arrivals[(slot.head - 1 + this.bufferPerPath) % this.bufferPerPath];
    const ageMs = Math.max(0, nowMs - lastArrival);
    let hz: number | null = null;
    let jitterMs: number | null = null;
    if (arrivalsChron.length >= 2) {
      const spanMs = arrivalsChron[arrivalsChron.length - 1] - arrivalsChron[0];
      hz = spanMs > 0 ? ((arrivalsChron.length - 1) * 1000) / spanMs : null;
      const intervals: number[] = [];
      for (let i = 1; i < arrivalsChron.length; i += 1) {
        intervals.push(arrivalsChron[i] - arrivalsChron[i - 1]);
      }
      const meanI = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((a, b) => a + (b - meanI) * (b - meanI), 0) / intervals.length;
      jitterMs = Math.sqrt(variance);
    } else if (arrivalsChron.length === 1) {
      hz = arrivalsChron[0] > nowMs - this.windowMs ? 1 / (this.windowMs / 1000) : null;
    }
    const level = this.gradeLevel(slot.threshold, ageMs, hz);
    return {
      path: slot.path,
      label: slot.threshold.label || slot.path,
      ageMs,
      hz,
      jitterMs,
      source: slot.lastSource,
      level,
      lastValue: slot.lastValue,
      samplesInWindow: arrivalsChron.length,
    };
  }

  private gradeLevel(thr: QualityThreshold, ageMs: number, hz: number | null): QualityLevel {
    if (ageMs > thr.lostAgeMs) return "lost";
    if (ageMs > thr.degradedAgeMs) return "degraded";
    if (thr.minHz != null && hz != null && hz < thr.minHz) return "degraded";
    return "good";
  }
}

function normaliseTs(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && isFinite(raw)) return raw;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "string") {
    const n = Date.parse(raw);
    return isFinite(n) ? n : null;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickSource(entry: any): string | null {
  if (typeof entry.$source === "string") return entry.$source;
  if (entry.sentence && typeof entry.sentence === "string") return entry.sentence;
  return null;
}
