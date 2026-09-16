// Rev103: Pypilot Doctor engine. Runs a fixed-duration diagnostic
// session (default 3 min) while the AP is engaged, then analyses the
// heading-error stream + servo duty to derive P / I / D adjustment
// suggestions. Nothing is applied automatically - suggestions are
// stored until the user confirms via /doctor/apply/:id.
//
// Rules implemented in Rev103 (MVP):
//   1. Persistent bias   -> increase I
//   2. Oscillation       -> increase D
//   3. Low authority     -> increase P
//   4. Chatter / hunting -> reduce P or increase deadband (info only)
//
// The rules use conservative +15-30% adjustments (never destructive)
// and expose "confidence" so the frontend can flag borderline ones.

import { Historian, Sample } from "./historian";
import { errorRad } from "./kpis";
import { PypilotClient } from "./pypilot-client";
import { SERVO_ON_MIN_A } from "./constants";
import { EpisodeDetector } from "./episodes";

export type DoctorState = "idle" | "running" | "analyzing" | "completed" | "cancelled";

export interface Suggestion {
  id: string;
  category: "bias" | "oscillation" | "authority" | "noise" | "step-overshoot";
  pilotId: string;
  gainKey: string;     // "P" | "I" | "D" | "DD" | "PR" | "FF"
  path: string;        // pypilot path e.g. "ap.pilot.basic.I"
  currentValue: number;
  suggestedValue: number;
  deltaPct: number;    // +/- percent change
  /** English fallback message (also mirrored to SK notifications). */
  reason: string;
  expectedEffect: string;
  /** Rev121: i18n key + args so the frontend renders in the user's
   *  language. `reason` above stays as the English fallback for clients
   *  that don't know the key (KIP, WilhelmSK, older visor caches). */
  reasonKey?: string;
  reasonArgs?: Record<string, string | number>;
  effectKey?: string;
  effectArgs?: Record<string, string | number>;
  confidence: "low" | "medium" | "high";
  applied: boolean;
  appliedTs: number | null;
  dismissed?: boolean;
  dismissedTs?: number | null;
}

export interface DiagnosticFinding {
  category: string;
  severity: "info" | "warn" | "critical";
  message: string;
  metric: string;      // machine-readable snippet e.g. "meanErr=8.2°"
  // Rev136 (Carlos): i18n handles for the frontend. `message` stays as
  // an English fallback for legacy consumers (KIP/WilhelmSK) and for
  // languages that don't ship a translation for this key.
  messageKey?: string;
  messageArgs?: Record<string, string | number>;
}

export interface DoctorResult {
  sessionId: string;
  startedTs: number;
  endedTs: number;
  durationSec: number;
  samplesAnalyzed: number;
  engagedSamples: number;
  pilotId: string;
  /** Profile name that was active WHEN the session started. */
  originalProfile: string | null;
  /** New profile created on the first apply of this session (null until
   *  the user hits APPLY on any suggestion). Carlos Rev120: never
   *  overwrite the previous profile - always fork so the user can go
   *  back with a single profile-select change. */
  newProfileName: string | null;
  findings: DiagnosticFinding[];
  suggestions: Suggestion[];
  summary: string;
  // Rev136: i18n handles for the summary line, same pattern as findings.
  summaryKey?: string;
  summaryArgs?: Record<string, string | number>;
}

export interface DoctorStatus {
  state: DoctorState;
  sessionId: string | null;
  startedTs: number | null;
  targetDurationSec: number;
  elapsedSec: number;
  progressPct: number;      // 0..1
  message: string;
  result: DoctorResult | null;
}

interface Session {
  id: string;
  startedTs: number;
  targetDurationSec: number;
  pilotId: string;
  initialGains: Record<string, number>;
  originalProfile: string | null;
}

const MIN_DURATION_SEC = 30;
const DEFAULT_DURATION_SEC = 180;

export class DoctorEngine {
  private state: DoctorState = "idle";
  private session: Session | null = null;
  private result: DoctorResult | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly historian: Historian;
  private client: PypilotClient | null;
  // Rev284: episode detector fed by the plugin's sampler tick. When
  // present, analyze() runs step-response rules on top of the existing
  // window statistics.
  private episodes: EpisodeDetector | null;
  // Rev288 (Rule 6): live-read a slice of plugin state (currently
  // rollFfGain, potentially more later). The accessor is a function
  // so the caller does not need to keep it in sync with option
  // changes — Doctor re-reads it right before each analysis.
  private getPluginState: (() => { rollFfGain: number }) | null;

  constructor(
    historian: Historian,
    client: PypilotClient | null,
    episodes: EpisodeDetector | null = null,
    getPluginState: (() => { rollFfGain: number }) | null = null,
  ) {
    this.historian = historian;
    this.client = client;
    this.episodes = episodes;
    this.getPluginState = getPluginState;
  }

  setClient(client: PypilotClient | null): void { this.client = client; }
  setEpisodes(episodes: EpisodeDetector | null): void { this.episodes = episodes; }
  setPluginStateAccessor(fn: (() => { rollFfGain: number }) | null): void { this.getPluginState = fn; }

  status(): DoctorStatus {
    const now = Date.now();
    const target = this.session?.targetDurationSec ?? DEFAULT_DURATION_SEC;
    // Rev104: freeze elapsedSec at the session duration once we leave
    // "running" - otherwise the progress bar in the visor keeps ticking
    // to 120% / 200% / ... while the user reads the completed result.
    let elapsed = 0;
    if (this.session) {
      const running = this.state === "running";
      const endTs = running ? now : (this.result?.endedTs ?? (this.session.startedTs + target * 1000));
      elapsed = Math.max(0, Math.floor((endTs - this.session.startedTs) / 1000));
      elapsed = Math.min(elapsed, target);
    }
    return {
      state: this.state,
      sessionId: this.session?.id ?? null,
      startedTs: this.session?.startedTs ?? null,
      targetDurationSec: target,
      elapsedSec: elapsed,
      progressPct: Math.min(1, elapsed / target),
      message: this.stateMessage(elapsed, target),
      result: (this.state === "completed") ? this.result : null,
    };
  }

  private stateMessage(elapsed: number, target: number): string {
    switch (this.state) {
      case "idle":      return "Ready. Engage the AP and press DIAGNOSE.";
      case "running":   return `Recording... ${elapsed}s / ${target}s`;
      case "analyzing": return "Analysing samples...";
      case "completed": return "Done. Review the suggestions below.";
      case "cancelled": return "Cancelled.";
    }
  }

  start(durationSec: number = DEFAULT_DURATION_SEC): { ok: boolean; message: string; sessionId?: string } {
    if (this.state === "running" || this.state === "analyzing") {
      return { ok: false, message: "A diagnostic session is already in progress." };
    }
    if (!this.client) {
      return { ok: false, message: "pypilot client not initialised." };
    }
    const pv = this.client.getValues();
    // Verify AP is engaged
    const engaged = pv["ap.enabled"] === true || pv["ap.enabled"] === 1;
    if (!engaged) {
      return { ok: false, message: "The AP is disengaged. Engage it before running DIAGNOSE." };
    }
    const pilotId = typeof pv["ap.pilot"] === "string" ? String(pv["ap.pilot"]) : "basic";
    // Snapshot current gains
    const initialGains: Record<string, number> = {};
    for (const k of ["P", "I", "D", "DD", "PR", "FF"]) {
      const v = pv[`ap.pilot.${pilotId}.${k}`];
      if (typeof v === "number") initialGains[k] = v;
    }
    if (Object.keys(initialGains).length === 0) {
      return { ok: false, message: `No gain values available for pilot '${pilotId}'. Wait for the catalog to populate.` };
    }
    const dur = Math.max(MIN_DURATION_SEC, Math.floor(durationSec));
    // Rev120: snapshot the currently-active profile so the "new profile"
    // fork on apply can reference it in the summary and can be
    // restored by the user via the Tune profile dropdown.
    const originalProfile = typeof pv["profile"] === "string" ? pv["profile"] as string : null;
    this.session = {
      id: `doc-${Date.now()}`,
      startedTs: Date.now(),
      targetDurationSec: dur,
      pilotId,
      initialGains,
      originalProfile,
    };
    this.result = null;
    this.state = "running";
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finishAndAnalyze(), dur * 1000);
    return { ok: true, message: "Recording started.", sessionId: this.session.id };
  }

  cancel(): { ok: boolean; message: string } {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.state === "idle" || this.state === "cancelled" || this.state === "completed") {
      return { ok: false, message: "No active session to cancel." };
    }
    this.state = "cancelled";
    this.session = null;
    return { ok: true, message: "Session cancelled." };
  }

  private finishAndAnalyze(): void {
    if (!this.session) { this.state = "idle"; return; }
    this.state = "analyzing";
    try {
      this.result = this.analyze(this.session);
      this.state = "completed";
    } catch {
      this.state = "cancelled";
    }
    this.timer = null;
  }

  private analyze(session: Session): DoctorResult {
    const now = Date.now();
    const windowMs = session.targetDurationSec * 1000;
    const samples = this.historian.slice(windowMs) as Sample[];
    const engaged = samples.filter((s) => s.engaged);
    const errors = engaged
      .map((s) => errorRad(s))
      .filter((v): v is number => typeof v === "number" && isFinite(v));

    const findings: DiagnosticFinding[] = [];
    const suggestions: Suggestion[] = [];
    const n = errors.length;

    // Stats
    let mean = 0, rms = 0;
    if (n > 0) {
      let sum = 0, sumSq = 0;
      for (const e of errors) { sum += e; sumSq += e * e; }
      mean = sum / n;
      rms = Math.sqrt(sumSq / n);
    }
    const meanDeg = mean * 180 / Math.PI;
    const rmsDeg = rms * 180 / Math.PI;

    // Servo duty (fraction of engaged samples with servo drawing)
    const servoOnCount = engaged.filter((s) => typeof s.servoCurrent === "number" && s.servoCurrent > SERVO_ON_MIN_A).length;
    const servoDuty = engaged.length > 0 ? servoOnCount / engaged.length : 0;

    // Zero-crossing count -> rough oscillation period estimate
    let crossings = 0;
    for (let i = 1; i < errors.length; i += 1) {
      if ((errors[i - 1] > 0 && errors[i] < 0) || (errors[i - 1] < 0 && errors[i] > 0)) {
        crossings += 1;
      }
    }
    // Samples per second is 1 (historian rate). Period = 2 * samples / crossings.
    const oscPeriodS = crossings > 1 ? (2 * errors.length) / crossings : Infinity;

    // Guard: too little data to trust anything.
    if (n < 30) {
      findings.push({
        category: "insufficient-data",
        severity: "warn",
        message: `Only ${n} engaged samples collected. Analysis skipped - keep the AP engaged during the whole session.`,
        metric: `n=${n}`,
        messageKey: "doctor.finding.insufficientData",
        messageArgs: { n: String(n) },
      });
      return this.buildResult(session, now, samples, engaged, findings, suggestions);
    }

    // Rev163 (Carlos, per Sean D'Epagnier forum #6): hardware ceiling
    // finding. Sean's core message was that the best gain tuning
    // cannot beat a saturated servo - a stronger motor is the fix.
    // We flag "hardware ceiling" when:
    //   - servo duty > 0.75 (drive is on 3/4 of the time)  AND
    //   - RMS heading error still > 5° (i.e. tracking is bad)
    // AND emit it as a finding WITHOUT any P/I/D suggestion so the
    // skipper doesn't chase gains that cannot help. The message
    // explicitly names hardware, not tuning, as the fix.
    if (servoDuty > 0.75 && rmsDeg > 5) {
      findings.push({
        category: "hardware-ceiling",
        severity: "critical",
        message: `Servo running at ${(servoDuty * 100).toFixed(0)}% duty with ${rmsDeg.toFixed(1)}° RMS error. Tuning cannot close a saturated actuator - consider a more powerful drive or reducing steering friction.`,
        metric: `duty=${(servoDuty * 100).toFixed(0)}% rms=${rmsDeg.toFixed(1)}°`,
        messageKey: "doctor.finding.hardwareCeiling",
        messageArgs: { duty: (servoDuty * 100).toFixed(0), rms: rmsDeg.toFixed(1) },
      });
      // Intentional early return: the follow-on rules would suggest
      // gain changes that cannot help while the drive is saturated.
      // Present just the honest verdict.
      return this.buildResult(session, now, samples, engaged, findings, suggestions);
    }

    // ---- Rule 1: Persistent bias -> increase I ----
    if (Math.abs(meanDeg) > 3) {
      findings.push({
        category: "bias",
        severity: Math.abs(meanDeg) > 6 ? "critical" : "warn",
        message: `Persistent heading offset of ${meanDeg.toFixed(1)}° (mean error).`,
        metric: `meanErr=${meanDeg.toFixed(2)}°`,
        messageKey: "doctor.finding.bias",
        messageArgs: { deg: meanDeg.toFixed(1) },
      });
      const I = session.initialGains["I"];
      if (typeof I === "number" && I > 0) {
        const factor = 1.20;
        suggestions.push({
          id: "sug-I-bias",
          category: "bias",
          pilotId: session.pilotId,
          gainKey: "I",
          path: `ap.pilot.${session.pilotId}.I`,
          currentValue: I,
          suggestedValue: round5(I * factor),
          deltaPct: (factor - 1) * 100,
          reason: `Mean heading error ${meanDeg.toFixed(1)}° indicates insufficient integral correction.`,
          expectedEffect: "Reduce the persistent bias in a few seconds. Watch for overshoot.",
          reasonKey: "doctor.reason.bias",
          reasonArgs: { deg: meanDeg.toFixed(1) },
          effectKey: "doctor.effect.bias",
          confidence: Math.abs(meanDeg) > 6 ? "high" : "medium",
          applied: false, appliedTs: null,
        });
      }
    }

    // ---- Rule 2: Oscillation -> increase D ----
    if (crossings > 4 && isFinite(oscPeriodS) && oscPeriodS < 25 && rmsDeg > 5) {
      findings.push({
        category: "oscillation",
        severity: "warn",
        message: `Heading oscillating with period ~${oscPeriodS.toFixed(1)}s, RMS ${rmsDeg.toFixed(1)}°.`,
        metric: `oscPeriod=${oscPeriodS.toFixed(1)}s rms=${rmsDeg.toFixed(2)}°`,
        messageKey: "doctor.finding.oscillation",
        messageArgs: { period: oscPeriodS.toFixed(1), rms: rmsDeg.toFixed(1) },
      });
      const D = session.initialGains["D"];
      if (typeof D === "number" && D > 0) {
        // Short period -> more aggressive damping
        const factor = oscPeriodS < 8 ? 1.30 : 1.20;
        suggestions.push({
          id: "sug-D-oscil",
          category: "oscillation",
          pilotId: session.pilotId,
          gainKey: "D",
          path: `ap.pilot.${session.pilotId}.D`,
          currentValue: D,
          suggestedValue: round5(D * factor),
          deltaPct: (factor - 1) * 100,
          reason: `Oscillation period ${oscPeriodS.toFixed(1)}s suggests insufficient derivative damping.`,
          expectedEffect: "Reduce oscillation amplitude, may slightly slow response.",
          reasonKey: "doctor.reason.oscillation",
          reasonArgs: { period: oscPeriodS.toFixed(1) },
          effectKey: "doctor.effect.oscillation",
          confidence: "medium",
          applied: false, appliedTs: null,
        });
      }
    }

    // ---- Rule 3: Low authority (high error + high duty) -> increase P ----
    if (rmsDeg > 8 && servoDuty > 0.55) {
      findings.push({
        category: "authority",
        severity: "critical",
        message: `Servo running at ${(servoDuty * 100).toFixed(0)}% duty but heading error still ${rmsDeg.toFixed(1)}°. AP is losing authority.`,
        metric: `rms=${rmsDeg.toFixed(2)}° duty=${(servoDuty * 100).toFixed(0)}%`,
        messageKey: "doctor.finding.authority",
        messageArgs: { duty: (servoDuty * 100).toFixed(0), rms: rmsDeg.toFixed(1) },
      });
      const P = session.initialGains["P"];
      if (typeof P === "number" && P > 0) {
        const factor = 1.15;
        suggestions.push({
          id: "sug-P-authority",
          category: "authority",
          pilotId: session.pilotId,
          gainKey: "P",
          path: `ap.pilot.${session.pilotId}.P`,
          currentValue: P,
          suggestedValue: round5(P * factor),
          deltaPct: (factor - 1) * 100,
          reason: "AP is fighting the boat but not winning. Proportional gain may be too weak.",
          expectedEffect: "Tighter tracking of the target heading. Watch for hunting if too high.",
          reasonKey: "doctor.reason.authority",
          effectKey: "doctor.effect.authority",
          confidence: "medium",
          applied: false, appliedTs: null,
        });
      }
    }

    // ---- Rule 4: Chatter (very low error with high servo activity) -> info ----
    if (rmsDeg < 1.5 && servoDuty > 0.35) {
      findings.push({
        category: "noise",
        severity: "info",
        message: `Heading is tight (${rmsDeg.toFixed(2)}°) but servo running ${(servoDuty * 100).toFixed(0)}% duty - possible chatter on a noisy heading signal.`,
        metric: `rms=${rmsDeg.toFixed(2)}° duty=${(servoDuty * 100).toFixed(0)}%`,
        messageKey: "doctor.finding.noise",
        messageArgs: { rms: rmsDeg.toFixed(2), duty: (servoDuty * 100).toFixed(0) },
      });
      // No P/I/D suggestion - chatter is usually a deadband issue.
    }

    // ---- Rule 5 (Rev284): step-response metrics from EpisodeDetector.
    // Only fires when at least 3 correction episodes closed during this
    // Doctor session's window. Complements Rule 2 (raw oscillation) with
    // per-correction Rise/Overshoot/Settling.
    if (this.episodes) {
      const eps = this.episodes.snapshot().filter(e => e.endedTs >= session.startedTs && e.endedTs <= now);
      if (eps.length >= 3) {
        let overshootSum = 0, overshootN = 0;
        let timedOutCount = 0;
        for (const e of eps) {
          if (e.overshoot != null) { overshootSum += e.overshoot; overshootN += 1; }
          if (e.timedOut) timedOutCount += 1;
        }
        const meanOvershoot = overshootN > 0 ? overshootSum / overshootN : null;
        // High overshoot → more D
        if (meanOvershoot != null && meanOvershoot > 0.20) {
          findings.push({
            category: "step-overshoot",
            severity: meanOvershoot > 0.35 ? "critical" : "warn",
            message: `Corrections overshoot ${(meanOvershoot * 100).toFixed(0)}% on average across ${eps.length} episodes. Boat consistently blows past the target.`,
            metric: `overshoot=${(meanOvershoot * 100).toFixed(0)}% n=${eps.length}`,
            messageKey: "doctor.finding.stepOvershoot",
            messageArgs: { overshoot: (meanOvershoot * 100).toFixed(0), n: String(eps.length) },
          });
          const D = session.initialGains["D"];
          if (typeof D === "number" && D > 0) {
            const factor = meanOvershoot > 0.35 ? 1.25 : 1.15;
            suggestions.push({
              id: "sug-D-step-overshoot",
              category: "step-overshoot",
              pilotId: session.pilotId,
              gainKey: "D",
              path: `ap.pilot.${session.pilotId}.D`,
              currentValue: D,
              suggestedValue: round5(D * factor),
              deltaPct: (factor - 1) * 100,
              reason: `Persistent overshoot (${(meanOvershoot * 100).toFixed(0)}%) on step responses. More derivative damping should reduce it.`,
              expectedEffect: "Less overshoot, slightly slower settling. Watch RMS after applying.",
              reasonKey: "doctor.reason.stepOvershoot",
              reasonArgs: { overshoot: (meanOvershoot * 100).toFixed(0) },
              effectKey: "doctor.effect.stepOvershoot",
              confidence: eps.length >= 5 ? "high" : "medium",
              applied: false, appliedTs: null,
            });
          }
        }
        // Many timeouts → authority is not enough to reach the target.
        if (timedOutCount >= 2 && timedOutCount / eps.length > 0.3) {
          findings.push({
            category: "step-timeout",
            severity: "critical",
            message: `${timedOutCount} of ${eps.length} corrections never settled within the timeout. AP is not reaching the target.`,
            metric: `timeouts=${timedOutCount}/${eps.length}`,
            messageKey: "doctor.finding.stepTimeout",
            messageArgs: { fail: String(timedOutCount), total: String(eps.length) },
          });
        }
      }
    }

    // ---- Rule 6 (Rev288): downwind roll advisory.
    // If the sailor spent enough time downwind (|TWA| > 90°) with a
    // dynamic roll RMS above 5° AND the Roll FF slider is at 0, hint
    // that activating it may reduce serpenteo. Never a suggestion —
    // Roll FF is not a pypilot gain, it's a plugin-side term. So this
    // rule emits only a finding.
    if (this.getPluginState) {
      const st = this.getPluginState();
      if (st.rollFfGain === 0) {
        let heelSumSq = 0;
        let n = 0;
        for (const s of engaged) {
          if (typeof s.heel !== "number") continue;
          if (typeof s.twa !== "number") continue;
          if (Math.abs(s.twa) < Math.PI / 2) continue; // upwind: skip
          heelSumSq += s.heel * s.heel;
          n += 1;
        }
        if (n >= 30) {
          const heelRmsDeg = Math.sqrt(heelSumSq / n) * 180 / Math.PI;
          if (heelRmsDeg > 5) {
            findings.push({
              category: "downwind-roll",
              severity: "info",
              message: `Downwind roll RMS ${heelRmsDeg.toFixed(1)}° over ${n} samples with Roll feed-forward disabled. Consider raising the Roll FF slider in Setup to reduce downwind serpenteo.`,
              metric: `heelRms=${heelRmsDeg.toFixed(1)}° n=${n} twaGate=90°`,
              messageKey: "doctor.finding.downwindRoll",
              messageArgs: { heelRms: heelRmsDeg.toFixed(1), n: String(n) },
            });
          }
        }
      }
    }

    return this.buildResult(session, now, samples, engaged, findings, suggestions);
  }

  private buildResult(
    session: Session, now: number,
    samples: Sample[], engaged: Sample[],
    findings: DiagnosticFinding[], suggestions: Suggestion[],
  ): DoctorResult {
    let summary: string;
    let summaryKey: string;
    let summaryArgs: Record<string, string | number>;
    if (findings.length === 0) {
      summary = "No significant issues detected. Current gains look healthy.";
      summaryKey = "doctor.summary.clean";
      summaryArgs = {};
    } else if (suggestions.length === 0) {
      summary = `${findings.length} issue(s) noted (no gain change suggested).`;
      summaryKey = "doctor.summary.notedOnly";
      summaryArgs = { issues: findings.length };
    } else {
      summary = `${findings.length} issue(s) detected. ${suggestions.length} gain change(s) suggested.`;
      summaryKey = "doctor.summary.detected";
      summaryArgs = { issues: findings.length, suggestions: suggestions.length };
    }
    return {
      sessionId: session.id,
      startedTs: session.startedTs,
      endedTs: now,
      durationSec: session.targetDurationSec,
      samplesAnalyzed: samples.length,
      engagedSamples: engaged.length,
      pilotId: session.pilotId,
      originalProfile: session.originalProfile,
      newProfileName: null,
      findings,
      suggestions,
      summary,
      summaryKey,
      summaryArgs,
    };
  }

  // Rev120 (Carlos): on the FIRST apply of this session we fork the
  // currently-active pypilot profile into a new one named `doctor-<ts>`
  // so the previous gains stay one profile-select click away. Every
  // subsequent apply in the SAME session writes into the same new
  // profile (no per-suggestion fork storm).
  private ensureForkedProfile(): string | null {
    if (!this.result) return null;
    if (this.result.newProfileName) return this.result.newProfileName;
    if (!this.client) return null;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const name = `doctor-${stamp}`;
    try {
      // pypilot: writing to `profile` with a name that does NOT exist
      // creates it as a copy of the currently-active profile.
      this.client.set("profile", name);
      this.result.newProfileName = name;
      return name;
    } catch {
      return null;
    }
  }

  applySuggestion(id: string): { ok: boolean; message: string; suggestion?: Suggestion; newProfile?: string | null } {
    if (!this.result) return { ok: false, message: "No result available. Run a diagnostic session first." };
    if (!this.client) return { ok: false, message: "pypilot client not initialised." };
    const s = this.result.suggestions.find((x) => x.id === id);
    if (!s) return { ok: false, message: `Suggestion '${id}' not found.` };
    if (s.applied) return { ok: false, message: "Suggestion already applied." };
    // Fork the profile before the first write so the original stays intact.
    const forked = this.ensureForkedProfile();
    try {
      this.client.set(s.path, s.suggestedValue);
      s.applied = true;
      s.appliedTs = Date.now();
      const msg = forked
        ? `Applied ${s.gainKey} = ${s.suggestedValue} in new profile '${forked}'`
        : `Applied ${s.gainKey} = ${s.suggestedValue}`;
      return { ok: true, message: msg, suggestion: s, newProfile: forked };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: `Apply failed: ${msg}` };
    }
  }

  // Rev121: mark a suggestion as dismissed (user rejected it). Kept in
  // the result so the frontend can render it greyed-out or hide it.
  dismissSuggestion(id: string): { ok: boolean; message: string } {
    if (!this.result) return { ok: false, message: "No result available." };
    const s = this.result.suggestions.find((x) => x.id === id);
    if (!s) return { ok: false, message: `Suggestion '${id}' not found.` };
    if (s.applied) return { ok: false, message: "Cannot dismiss an already-applied suggestion." };
    s.dismissed = true;
    s.dismissedTs = Date.now();
    return { ok: true, message: "Dismissed." };
  }

  // Rev162 (Carlos, per Sean D'Epagnier): apply ONLY ONE gain at a
  // time. The old applyAll iterated blindly through P + I + D in the
  // same tick, which contradicts Sean's forum advice ("tweak the
  // values one at a time") and made it impossible to isolate which
  // change helped. Now applyAll picks the top-priority suggestion,
  // applies it, and marks the rest as "waiting for a fresh Doctor
  // session before the next change". The visor uses `mustRunFreshSession`
  // in the response to render the banner.
  applyAll(): {
    ok: boolean;
    applied: string[];
    failed: { id: string; message: string }[];
    mustRunFreshSession?: boolean;
    remaining?: number;
  } {
    const applied: string[] = [];
    const failed: { id: string; message: string }[] = [];
    if (!this.result) return { ok: false, applied, failed };
    // Rev280 (audit T08): the previous version told the visor
    // `mustRunFreshSession=true` when suggestions remained, but the
    // engine did NOT enforce it — a second applyAll call before
    // running a fresh session happily applied the next suggestion.
    // Now the result is locked with `awaitingFreshSession` after any
    // partial apply; further applyAll calls are refused until the
    // next `record(...)` clears the flag.
    if ((this.result as any).awaitingFreshSession) {
      return {
        ok: false,
        applied,
        failed: [{ id: "*", message: "Run a fresh Doctor session before applying the next suggestion." }],
        mustRunFreshSession: true,
        remaining: this.result.suggestions.filter((s) => !s.applied && !s.dismissed).length,
      };
    }
    const priority: Record<string, number> = { bias: 0, authority: 1, oscillation: 2, noise: 3 };
    const pending = this.result.suggestions
      .filter((s) => !s.applied && !s.dismissed)
      .sort((a, b) => (priority[a.category] ?? 99) - (priority[b.category] ?? 99));
    if (pending.length === 0) {
      return { ok: true, applied, failed, mustRunFreshSession: false, remaining: 0 };
    }
    const first = pending[0];
    const r = this.applySuggestion(first.id);
    if (r.ok) applied.push(first.id);
    else failed.push({ id: first.id, message: r.message });
    const remaining = pending.length - 1;
    const mustRun = remaining > 0;
    if (mustRun) {
      // Lock so a second applyAll call cannot bypass the fresh-session
      // requirement.
      (this.result as any).awaitingFreshSession = true;
    }
    return {
      ok: failed.length === 0,
      applied,
      failed,
      mustRunFreshSession: mustRun,
      remaining,
    };
  }

  reset(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.state = "idle";
    this.session = null;
    this.result = null;
  }
}

function round5(v: number): number {
  // Keep 5 significant digits so displayed values match KIP / pypilot UI.
  return Number(v.toFixed(5));
}
