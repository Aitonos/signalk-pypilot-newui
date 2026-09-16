// Profile advisor.
//
// Watches the KPI window and, when the tracking quality has been
// sustained on either extreme long enough, suggests the sailor
// considers switching to a more or less aggressive profile. Never
// applies anything — only produces an advisory event that the plugin
// publishes as a Signal K notification.
//
// The two triggers:
//
//   HIGH-RMS branch (bad tracking):
//     rms > rmsHighDeg for sustainSec seconds
//         → advisory "consider-more-aggressive"
//
//   LOW-RMS-HIGH-DUTY branch (over-tight, wasting battery):
//     rms < rmsLowDeg AND duty > dutyHighPct for sustainSec seconds
//         → advisory "consider-less-aggressive"
//
// The second branch guards against a boat that could steer softer (and
// save current) but is fighting a tight setpoint. Duty is required
// because a boat with perfect tracking and idle servo is not wasteful
// — it is just settled.
//
// After an emission the advisor stays silent for `cooldownSec` so the
// sailor can act (or ignore) without repeated pings.

export interface KpiWindow {
  rmsErrorRad: number | null;
  servoDutyPct: number | null;
  engagedSamples: number;
}

export interface ProfileAdvisorOptions {
  rmsHighDeg: number;
  rmsLowDeg: number;
  dutyHighPct: number;
  sustainSec: number;
  cooldownSec: number;
  minEngagedSamples: number;
}

export const DEFAULT_ADVISOR_OPTIONS: ProfileAdvisorOptions = {
  rmsHighDeg: 10,
  rmsLowDeg: 1,
  dutyHighPct: 50,
  sustainSec: 60,
  cooldownSec: 300,
  minEngagedSamples: 30,
};

export type AdvisoryKind = "consider-more-aggressive" | "consider-less-aggressive";

export interface AdvisoryEvent {
  ts: number;
  kind: AdvisoryKind;
  /** English fallback describing the metric. */
  message: string;
  /** i18n key + args mirroring the Doctor convention. */
  messageKey: string;
  messageArgs: Record<string, string>;
  /** Machine-readable metric snapshot, e.g. "rms=12.3° sustain=60s". */
  metric: string;
}

export interface AdvisorStatus {
  options: ProfileAdvisorOptions;
  lastEvent: AdvisoryEvent | null;
  highSinceMs: number | null;
  lowSinceMs: number | null;
  cooldownRemainingMs: number;
}

export class ProfileAdvisor {
  private opts: ProfileAdvisorOptions;
  private highSinceMs: number | null = null;
  private lowSinceMs: number | null = null;
  private lastEmitTs = 0;
  private lastEvent: AdvisoryEvent | null = null;

  constructor(opts: Partial<ProfileAdvisorOptions> = {}) {
    this.opts = { ...DEFAULT_ADVISOR_OPTIONS, ...opts };
  }

  update(patch: Partial<ProfileAdvisorOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  getOptions(): Readonly<ProfileAdvisorOptions> { return this.opts; }

  /** Feed one KPI window sample. Returns an event if an advisory just
   *  fired; null otherwise. `now` is the current wall-clock ms
   *  (injected so tests can control time). */
  onTick(now: number, w: KpiWindow): AdvisoryEvent | null {
    // Bootstrap gate: too little data to trust the window.
    if (w.engagedSamples < this.opts.minEngagedSamples) {
      this.highSinceMs = null;
      this.lowSinceMs = null;
      return null;
    }
    if (w.rmsErrorRad == null || !isFinite(w.rmsErrorRad)) {
      this.highSinceMs = null;
      this.lowSinceMs = null;
      return null;
    }
    // Cooldown: never emit inside the silence window.
    if (this.lastEmitTs > 0 && (now - this.lastEmitTs) < this.opts.cooldownSec * 1000) {
      return null;
    }
    const rmsDeg = Math.abs(w.rmsErrorRad) * 180 / Math.PI;
    const dutyPct = w.servoDutyPct != null ? w.servoDutyPct * 100 : 0;

    // Branch 1: high RMS.
    if (rmsDeg > this.opts.rmsHighDeg) {
      this.lowSinceMs = null;
      if (this.highSinceMs == null) this.highSinceMs = now;
      if ((now - this.highSinceMs) >= this.opts.sustainSec * 1000) {
        return this.emit(now, "consider-more-aggressive", {
          message: `Heading RMS ${rmsDeg.toFixed(1)}° over ${this.opts.sustainSec}s. Consider a more aggressive profile or tuning.`,
          messageKey: "advisor.moreAggressive",
          messageArgs: { rms: rmsDeg.toFixed(1), sec: String(this.opts.sustainSec) },
          metric: `rms=${rmsDeg.toFixed(1)}°`,
        });
      }
      return null;
    }

    // Branch 2: low RMS + high duty.
    if (rmsDeg < this.opts.rmsLowDeg && dutyPct > this.opts.dutyHighPct) {
      this.highSinceMs = null;
      if (this.lowSinceMs == null) this.lowSinceMs = now;
      if ((now - this.lowSinceMs) >= this.opts.sustainSec * 1000) {
        return this.emit(now, "consider-less-aggressive", {
          message: `Tracking is very tight (${rmsDeg.toFixed(1)}°) but the servo runs at ${dutyPct.toFixed(0)}% duty. A less aggressive profile could save current.`,
          messageKey: "advisor.lessAggressive",
          messageArgs: { rms: rmsDeg.toFixed(1), duty: dutyPct.toFixed(0), sec: String(this.opts.sustainSec) },
          metric: `rms=${rmsDeg.toFixed(1)}° duty=${dutyPct.toFixed(0)}%`,
        });
      }
      return null;
    }

    // Neither condition met right now — reset both sustain timers so a
    // brief dip does not carry across a stretch of good tracking.
    this.highSinceMs = null;
    this.lowSinceMs = null;
    return null;
  }

  status(now: number = Date.now()): AdvisorStatus {
    const cooldownMs = this.opts.cooldownSec * 1000;
    const remaining = this.lastEmitTs > 0
      ? Math.max(0, cooldownMs - (now - this.lastEmitTs))
      : 0;
    return {
      options: this.opts,
      lastEvent: this.lastEvent,
      highSinceMs: this.highSinceMs,
      lowSinceMs: this.lowSinceMs,
      cooldownRemainingMs: remaining,
    };
  }

  reset(): void {
    this.highSinceMs = null;
    this.lowSinceMs = null;
    this.lastEmitTs = 0;
    this.lastEvent = null;
  }

  // -------- helpers --------

  private emit(
    now: number,
    kind: AdvisoryKind,
    body: { message: string; messageKey: string; messageArgs: Record<string, string>; metric: string },
  ): AdvisoryEvent {
    const ev: AdvisoryEvent = { ts: now, kind, ...body };
    this.lastEmitTs = now;
    this.lastEvent = ev;
    // Reset the branch that just fired so the sustain window does not
    // stay accumulating across the silence period.
    this.highSinceMs = null;
    this.lowSinceMs = null;
    return ev;
  }
}
