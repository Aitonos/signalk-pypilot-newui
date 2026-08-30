// Rev93: in-memory ring buffer of telemetry samples for the Chart tab
// and the KPI computer (Rev94+). Runs entirely on the SK-server host
// (Pi 5 in Tunatunes, Pi 4 for other users). Kept RAM-only by default
// so Pi 4 SD cards do not take a write hit; disk snapshots are opt-in
// and land in a later batch (Rev96+).
//
// Sample rate: 1 Hz. At the default capacity of 1800 samples that gives
// 30 minutes of history using ~144 KB of RAM (12 numeric fields × 8 B ×
// 1800). Adjusting `capacitySamples` linearly changes both the window
// and the RAM footprint - keep the product below the Pi 4 headroom.

/** Numeric fields are in Signal K SI units (rad for angles, m/s for
 *  speeds, A for current, degrees C for temperatures). Conversions to
 *  degrees / knots happen at the frontend so the raw stream stays
 *  losslessly comparable across sessions. */
export interface Sample {
  ts: number;                    // wall-clock ms (Date.now())
  headingCmd:    number | null;  // rad - the AP's commanded heading (compass mode) or wind angle (wind mode)
  headingActual: number | null;  // rad - navigation.headingMagnetic
  rudder:        number | null;  // rad - steering.rudderAngle
  servoCurrent:  number | null;  // A
  servoTemp:     number | null;  // C
  servoVoltage:  number | null;  // V - Rev99: needed by the Servo Health card
  awa:           number | null;  // rad - environment.wind.angleApparent
  aws:           number | null;  // m/s - environment.wind.speedApparent
  tws:           number | null;  // m/s - environment.wind.speedTrue
  sog:           number | null;  // m/s
  heel:          number | null;  // rad - navigation.attitude.roll (positive stbd)
  engaged:       boolean;
  mode:          string | null;  // "compass" | "wind" | "gps" | "true wind" | ...
}

/** Any keyof Sample except `ts` (which is always emitted). */
export type SamplePath = Exclude<keyof Sample, "ts">;

export interface HistorianOptions {
  /** Ring buffer capacity in samples. Default 1800 = 30 min at 1 Hz. */
  capacitySamples?: number;
  /** Sample period in ms. Default 1000. */
  samplePeriodMs?: number;
}

export type Sampler = () => Sample;

/** Small append-only ring buffer of Samples. Old samples are overwritten
 *  in place, so memory never grows beyond `capacitySamples`. */
export class Historian {
  private readonly buf: (Sample | null)[];
  private readonly capacity: number;
  private readonly periodMs: number;
  private head = 0;    // index where the NEXT push will land
  private count = 0;   // number of valid samples currently in the buffer
  private timer: NodeJS.Timeout | null = null;
  private sampler: Sampler | null = null;
  private startedAtMs: number | null = null;

  constructor(opts: HistorianOptions = {}) {
    this.capacity = Math.max(60, opts.capacitySamples ?? 1800);
    this.periodMs = Math.max(200, opts.samplePeriodMs ?? 1000);
    this.buf = new Array(this.capacity).fill(null);
  }

  /** Overwrites the oldest slot with `s`. Safe to call from a setInterval. */
  push(s: Sample): void {
    this.buf[this.head] = s;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  /** Returns samples in the last `windowMs`, oldest first. If `paths` is
   *  given, only those fields (plus `ts`) are included in each row -
   *  useful to trim JSON payload from the /history endpoint when the
   *  frontend only cares about, say, heading and rudder. */
  slice(windowMs: number, paths?: SamplePath[]): Partial<Sample>[] {
    if (this.count === 0) return [];
    const cutoff = Date.now() - Math.max(0, windowMs);
    const out: Partial<Sample>[] = [];
    // Walk in chronological order: oldest is at (head - count + capacity) % capacity.
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i += 1) {
      const idx = (start + i) % this.capacity;
      const s = this.buf[idx];
      if (!s || s.ts < cutoff) continue;
      if (paths && paths.length > 0) {
        const row: Partial<Sample> = { ts: s.ts };
        for (const p of paths) (row as Record<string, unknown>)[p] = s[p];
        out.push(row);
      } else {
        out.push(s);
      }
    }
    return out;
  }

  /** Diagnostic snapshot of the buffer state - exposed via /status for
   *  QA visibility. Never returns actual samples (use slice() for that). */
  status(): { count: number; capacity: number; periodMs: number; startedAtMs: number | null; oldestTs: number | null; newestTs: number | null } {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    const oldest = this.count > 0 ? this.buf[start]?.ts ?? null : null;
    const newestIdx = (this.head - 1 + this.capacity) % this.capacity;
    const newest = this.count > 0 ? this.buf[newestIdx]?.ts ?? null : null;
    return {
      count: this.count,
      capacity: this.capacity,
      periodMs: this.periodMs,
      startedAtMs: this.startedAtMs,
      oldestTs: oldest,
      newestTs: newest,
    };
  }

  /** Attach a sampler callback and begin ticking. Idempotent: repeated
   *  calls with a different sampler swap the callback but do not start
   *  a second interval. */
  start(sampler: Sampler): void {
    this.sampler = sampler;
    if (this.timer) return;
    this.startedAtMs = Date.now();
    this.timer = setInterval(() => {
      if (!this.sampler) return;
      try {
        const s = this.sampler();
        // Cheap sanity: the sampler must stamp `ts`. If it forgot, stamp now.
        if (typeof s.ts !== "number") s.ts = Date.now();
        this.push(s);
      } catch { /* silent - a bad sample must never crash the plugin */ }
    }, this.periodMs);
    // Node's Timeout has an .unref() so the sampler does not keep the
    // process alive during shutdown - not strictly needed inside SK
    // server (which owns the loop) but harmless.
    if (typeof (this.timer as NodeJS.Timeout & { unref?: () => void }).unref === "function") {
      (this.timer as NodeJS.Timeout & { unref: () => void }).unref();
    }
  }

  /** Stops the sampler interval. Buffer contents are retained (a
   *  subsequent start() will keep pushing on top of the old samples).
   *  Called from plugin.stop() to avoid leaking timers across a
   *  Disable+Enable cycle in the SK admin. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.sampler = null;
  }
}
