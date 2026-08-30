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

export type DoctorState = "idle" | "running" | "analyzing" | "completed" | "cancelled";

export interface Suggestion {
  id: string;
  category: "bias" | "oscillation" | "authority" | "noise";
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

  constructor(historian: Historian, client: PypilotClient | null) {
    this.historian = historian;
    this.client = client;
  }

  setClient(client: PypilotClient | null): void { this.client = client; }

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
    const servoOnCount = engaged.filter((s) => typeof s.servoCurrent === "number" && s.servoCurrent > 0.3).length;
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
      });
      return this.buildResult(session, now, samples, engaged, findings, suggestions);
    }

    // ---- Rule 1: Persistent bias -> increase I ----
    if (Math.abs(meanDeg) > 3) {
      findings.push({
        category: "bias",
        severity: Math.abs(meanDeg) > 6 ? "critical" : "warn",
        message: `Persistent heading offset of ${meanDeg.toFixed(1)}° (mean error).`,
        metric: `meanErr=${meanDeg.toFixed(2)}°`,
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
      });
      // No P/I/D suggestion - chatter is usually a deadband issue.
    }

    return this.buildResult(session, now, samples, engaged, findings, suggestions);
  }

  private buildResult(
    session: Session, now: number,
    samples: Sample[], engaged: Sample[],
    findings: DiagnosticFinding[], suggestions: Suggestion[],
  ): DoctorResult {
    let summary: string;
    if (findings.length === 0) summary = "No significant issues detected. Current gains look healthy.";
    else if (suggestions.length === 0) summary = `${findings.length} issue(s) noted (no gain change suggested).`;
    else summary = `${findings.length} issue(s) detected. ${suggestions.length} gain change(s) suggested.`;
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

  applyAll(): { ok: boolean; applied: string[]; failed: { id: string; message: string }[] } {
    const applied: string[] = [];
    const failed: { id: string; message: string }[] = [];
    if (!this.result) return { ok: false, applied, failed };
    for (const s of this.result.suggestions) {
      if (s.applied || s.dismissed) continue;
      const r = this.applySuggestion(s.id);
      if (r.ok) applied.push(s.id);
      else failed.push({ id: s.id, message: r.message });
    }
    return { ok: failed.length === 0, applied, failed };
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
