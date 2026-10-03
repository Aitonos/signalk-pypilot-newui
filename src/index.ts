import { PypilotClient, PypilotCatalog } from "./pypilot-client";
import {
  ESSENTIAL_PYPILOT_KEYS,
  RESERVED_PYPILOT_KEYS,
  extractCatalogDerivedPublishes,
  Mapping,
  mappingFor,
  skPathToPypilotName,
} from "./publisher";
import { scanLan } from "./scanner";
import { AutopilotProvider } from "./autopilot-provider";
import { Historian, Sample, SamplePath } from "./historian";
import { KPIComputer, KPISnapshot } from "./kpis";
import { SensorQualityMonitor, DEFAULT_QUALITY_WATCH } from "./sensor-quality";
import { ServoHealthMonitor, ServoHealthSnapshot } from "./servo-health";
import { AlarmEngine } from "./alarms";
import { runPrechecks } from "./prechecks";
import { DoctorEngine } from "./doctor";
import { EpisodeDetector } from "./episodes";
import {
  captureBundle,
  validateBundle,
  applyBundleToPypilot,
  ConfigBundle,
} from "./config-backup";
import { RollFeedForward } from "./roll-ff";
import { LeewayEstimator } from "./leeway";
import { FailsafeBspResolver, BspSource } from "./failsafe-bsp";
import { TackCatchup, TackDirection } from "./tack-catchup";
import { ServoErrorLog } from "./servo-error-log";
import {
  computeGains,
  roundGains,
  validateKnobs,
  validateBaseline,
  NEUTRAL_KNOBS,
  type TuningKnobs,
  type GainSet,
} from "./tuning-knobs";
import { ProfileAdvisor, type AdvisoryEvent } from "./profile-advisor";
import { ProfileChangeLog, type ProfileChangeSource } from "./profile-change-log";
import {
  loadMetadata,
  upsert as pmUpsert,
  remove as pmRemove,
  validateUpsert as pmValidateUpsert,
  CONDITIONS as PROFILE_CONDITIONS,
  type ProfileMetadata,
} from "./profile-metadata";
import {
  computeApbTarget,
  apbDivergence,
  isApbSource,
  type ApbSource,
  type CourseData,
} from "./nav-bearing";
import { SessionRecorder, SessionSample, SessionTags } from "./session-recorder";
import { TripRecorder, TripSample } from "./trip-recorder";
import {
  ManeuverTraceLog,
  type ManeuverContext,
  type ManeuverEventKind,
} from "./maneuver-trace";

// Rev counter bumped on every build so the user can distinguish deploys
// from the webapp header (feedback_revision_bump_each_build).
const PLUGIN_REVISION = "Rev407";

// Rev59: read package.json once at load time so /status can report the
// npm package version alongside the internal Rev counter.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PLUGIN_PKG_VERSION: string = (() => {
  try { return require("../package.json").version || ""; }
  catch { return ""; }
})();

const PLUGIN_ID = "signalk-pypilot-newui";
const SOURCE_LABEL = "pypilot-newui";

// Default watch periods per rate class. NEVER `true` (event-driven) - on
// the Tunatunes Pi Zero W hosting pypilot_web, event-driven watches from
// two or three concurrent clients (pypilot-autopilot-provider + upstream
// UI + ours) saturated the process and cascaded to a hung SK server.
// Reference: memory/project_tinypilot_pi_zero_limit.md
// Rev140 (Carlos): after Sean D'Epagnier flagged that our watch policy
// pressures pypilot_web too hard, we redesigned watches around a small
// permanently-active "core" set + a dynamic "focus" set that the UI
// bumps only while a relevant tab is open. Rates were also relaxed to
// the 1-2 Hz band Sean suggested for the streaming path.
const WATCH_HIGH: number = 0.5;   // 2 Hz - only the couple of state paths that drive the AP indicator
const WATCH_MED: number = 1;      // 1 Hz - core telemetry watched permanently (voltage, current, engaged)
const WATCH_LOW: number = 10;     // 0.1 Hz - resting rate for RangeSettings the user opted-in but is not looking at
const WATCH_FOCUS_MAX_TTL_S: number = 300;   // cap the requested TTL so a leaked focus dies within 5 min
const WATCH_FOCUS_MIN_PERIOD_S: number = 0.5; // client cannot ask faster than 2 Hz
const WATCH_FOCUS_MAX_KEYS: number = 80;      // per-request key cap
// Rev280 (audit T21): global cap across all requests. Ten calls of
// 80 fresh keys used to add up to 800 focus entries and pin
// pypilot_web on the Pi Zero W. Sean D'Epagnier's advice was to
// keep the total subscription count comfortably under 40; a 200-key
// budget covers the whole visor (gains, calibration sliders, the
// tack countdown paths) with headroom.
const WATCH_FOCUS_MAX_GLOBAL_KEYS: number = 200;

interface PluginProps {
  host: string;
  port: number;
  reconnectDelayMs?: number;
  allowWrites?: boolean;
  allowDirectServo?: boolean;
  publishUnmapped?: boolean;
  nudgeSmall?: number;   // small step in degrees for the -1/+1 buttons
  nudgeBig?: number;     // big step in degrees for the -10/+10 buttons
  absorbProvider?: boolean; // register as SK Autopilot Provider (replaces the official one)
  enabledPaths?: Record<string, boolean>;  // pypilot name -> publish yes/no
  // Rev23: publish policy. When true, publishValue only emits essentials
  // + paths the user explicitly enabled in enabledPaths. When false, the
  // old behavior: publish everything except paths explicitly disabled.
  // Auto-detected on first boot: fresh installs -> true, upgrades from
  // configs that already have enabledPaths populated -> false (do NOT
  // silently shrink what a user already had set up).
  publishOnlyEssentials?: boolean;
  // Rev55: SSH credentials used by /restart-pypilot to reboot the
  // pypilot process on the TinyPilot. Password-based auth (no key
  // setup needed). Stored plain in the config file.
  sshUser?: string;
  sshPassword?: string;
  // Rev138 (Carlos): opt-in log capture from the TinyPilot Pi Zero.
  // piCore keeps /var/log on tmpfs, so any hang or crash wipes the
  // logs after a hard reset. When enabled we SSH into the Pi every
  // logCaptureIntervalSec seconds, pull the tail of the pypilot logs
  // and append the new lines to a persistent file on the Pi 5 side.
  logCaptureEnabled?: boolean;
  logCaptureIntervalSec?: number;
  // Rev143 (Carlos): navigation session recorder. Enabled by default -
  // the JSONL files stay local on the Pi 5 until the user downloads
  // them, and the recorder only opens a session while the AP is
  // actually engaged, so a moored boat produces nothing.
  sessionRecorderEnabled?: boolean;
  // Rev324 (Carlos, 2026-09-28): per-path "ignored sensor" list for
  // the Setup → Sensor Quality panel. Kept in backend so a tablet and
  // a phone talking to the same SK server share the same set of
  // acknowledged-missing sensors. Empty by default.
  sensorsIgnored?: string[];
  // Rev328 (Carlos, 2026-09-28): master enable for the trip recorder
  // ("Bitácora" / "Logbook"). ON by default so existing installs keep
  // recording. When OFF, the plugin skips every tripRecorder.start() /
  // sample() call — the historian and other subsystems keep running.
  tripRecorderEnabled?: boolean;
  // Rev322 (Carlos, 2026-09-27): maneuver trace log. Records every
  // user-driven maneuver event posted by the visor (aproado_pick,
  // empopado_pick, tack_tap, mode_change, target_put, engage,
  // disengage, nudge) with pypilot state right before + a snapshot
  // 300 ms later, so we can see whether the AP actually obeyed the
  // command. Off by default — only enable during sea trial forensics.
  maneuverTraceEnabled?: boolean;
  // Rev164 (Carlos): auto-select a pypilot profile per wind band.
  // Off by default (opt-in). Bins hard-coded to <8 kn / 8-16 / >16 kn
  // for now - the wind numbers below reflect typical wind-response
  // damping bands and are safe on most cruising boats. Requires engaged
  // navigation and a valid tws source; will not touch the profile at
  // the dock.
  autoProfileEnabled?: boolean;
  autoProfileLight?: string;    // profile name for TWS < 8 kn
  autoProfileMedium?: string;   // profile name for TWS 8-16 kn
  autoProfileHeavy?: string;    // profile name for TWS > 16 kn
  // Rev282: roll feed-forward. Off by default. When > 0 the plugin
  // computes a small pre-emptive shift of the commanded heading based
  // on the dynamic component of the boat's roll. Only active downwind
  // (|TWA| > rollFfTwaGateDeg). Output is currently PUBLISHED only,
  // not applied to the AP - a later Rev flips the switch after sea
  // trial.
  rollFfGain?: number;
  rollFfTauSec?: number;
  rollFfTwaGateDeg?: number;
  // Rev298 (H4): leeway estimator. When leewayAdjustment > 0 the
  // plugin publishes `performance.leeway` derived from the classical
  // heel-over-speed² formula drift_deg = adj * heel_deg / bsp_kn^2. Opt-in;
  // when disabled we do NOT overwrite whatever signalk-derived-data
  // (or any other plugin) is already emitting on that path.
  leewayAdjustment?: number;
  // Rev299 (H2): failsafe boat speed in knots. When BSP and SOG are
  // both missing (speedo unplugged AND GPS fix lost), the plugin
  // pretends BSP is this many knots so downstream calculations
  // (leeway, KPIs, any future wind-compensation) keep producing
  // plausible numbers instead of going null. 0 = disabled.
  failSafeBspKn?: number;
  // Rev299 (I2): post-tack catch-up offset. Peak in degrees applied
  // immediately after a tack completes, decayed exponentially with
  // tackCatchupTauSec. 0 = disabled (nothing published). PUBLISHES
  // only; not applied to the pilot yet, same gating pattern as
  // Roll FF pending sea trial validation.
  tackCatchupDeg?: number;
  tackCatchupTauSec?: number;
  // Rev286 (B2): profile advisor. Watches window1m KPIs and emits a
  // notification when the sailor should consider a profile change.
  // Never applies anything. On by default; can be silenced from the
  // Smart Pilot card.
  profileAdvisorEnabled?: boolean;
  profileAdvisorRmsHighDeg?: number;
  profileAdvisorRmsLowDeg?: number;
  profileAdvisorSustainSec?: number;
  // Rev289 (B5): per-profile tags {condition, notes}. Persistent map,
  // keyed by pypilot profile name. Visor renders it as chips; future
  // auto-profile-by-condition may read from it.
  profileMetadata?: ProfileMetadata;
  // Rev290 (E2/E3): per-install alarm thresholds. Overrides the
  // module-level RULE_* defaults in alarms.ts. Undefined fields fall
  // back to the defaults.
  alarmLowVoltageV?: number;
  alarmServoTempC?: number;
  alarmServoMotorTempC?: number;
  // Rev299 (I1): attitude safety envelope thresholds. Overrides the
  // module-level RULE_ATTITUDE_* defaults.
  alarmAttitudeHeelDeg?: number;
  alarmAttitudePitchDeg?: number;
  // Rev299 (2026-09-24): per-rule enable list for the AlarmEngine.
  // Semantics:
  //   - undefined  → legacy: every rule keeps its defaultEnabled=true
  //                  (Tunatunes and other pre-Rev299 installs).
  //   - []         → fresh install: NO rule fires. This is the schema
  //                  default so a new user in OpenPlotter never sees
  //                  a random alarm without opting in.
  //   - [ids...]   → only the listed rule ids are active. All others
  //                  are silently skipped by the engine.
  // Rule ids match the `id` fields in DEFAULT_RULES (alarms.ts) —
  // "heading-deviation", "unable-to-steer", "servo-overcurrent", etc.
  alarmsEnabled?: string[];
  // Rev342 (Carlos, 2026-09-28): per-rule severity override. Absent
  // keys keep the RuleDef's default severity. Applied on plugin start.
  alarmSeverityOverrides?: Record<string, "info" | "warn" | "alarm">;
  // Rev292 (Carlos, navigating): sustain window before the pypilot-
  // disconnected banner fires. Was hardcoded at 1 s (too eager in a
  // marine SIM/4G environment). Default 15 s; sailors on a stable LAN
  // can shorten it, sailors on lossy 4G can extend it.
  alarmPypilotDiscSec?: number;
  // Rev291 (F1): NAV mode target source preference. "auto" (default)
  // uses steerTo when the plotter provides it, bearingTrue otherwise.
  // Currently READ-ONLY: the plugin exposes the computed target under
  // /nav/apb-preview but does NOT push it to pypilot yet — pypilot's
  // own nav mode still runs the show. A future Rev may switch to
  // plugin-side NAV once we can validate at sea.
  apbSource?: "auto" | "steerTo" | "bearing";
  // Rev167 (Carlos): gust *strategy*, not just a warning. Was Rev165
  // gustDetectorEnabled; now the user picks what to do when a gust
  // lands:
  //   "off"          - do nothing
  //   "warn"         - fire an advisory notification (Rev165 behaviour)
  //   "freeze-target"- pin the current target for GUST_FREEZE_SEC so
  //                    the AP does not chase the shifted apparent wind.
  //                    Wind-mode only.
  //   "boost-D"      - temporarily raise D by +20% for GUST_BOOST_SEC
  //                    to damp the rudder response.
  //   "temp-heavy"   - swap to the "heavy" profile of autoProfile*
  //                    for GUST_HEAVY_SEC, then restore.
  gustStrategy?: "off" | "warn" | "freeze-target" | "boost-D" | "temp-heavy";
  // Rev166: auto-disengage safety. When RMS > 30 deg sustained 10 s AND
  // duty > 0.90, cut the AP. Opt-in - defaults OFF until validated at sea.
  autoDisengageOnLostAuthority?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = function (app: any) {
  let client: PypilotClient | null = null;
  let apProvider: AutopilotProvider | null = null;
  let props: PluginProps = { host: "", port: 80 };
  let lastCatalog: PypilotCatalog = {};
  let lastPingLatencyMs: number | null = null;
  let publishedSkPaths: Set<string> = new Set();
  let metaSent: Set<string> = new Set();
  let putHandlersRegistered: Set<string> = new Set();
  let lastConnectAt: number | null = null;
  let lastDisconnectReason: string | null = null;
  let deltaSentCount = 0;
  // Rev93: telemetry historian for the Chart tab + Rev95 KPIs.
  let historian: Historian | null = null;
  // Rev95: KPI computer + its SK-paths publisher interval.
  let kpis: KPIComputer | null = null;
  let kpiPublishTimer: NodeJS.Timeout | null = null;
  let kpiMetaSent = false;
  // Rev97: Sensor Quality monitor. Reads freshness / Hz / jitter per
  // watched SK path from the same sampler tick as the historian.
  let sensorQuality: SensorQualityMonitor | null = null;
  // Rev99: Servo Health monitor. Learns a baseline current from the
  // first ~5-10 min of engaged navigation and grades subsequent draws.
  let servoHealth: ServoHealthMonitor | null = null;
  let servoHealthMetaSent = false;
  // Rev158: periodic snapshot of the baseline learn state.
  let servoHealthPersistTimer: NodeJS.Timeout | null = null;
  // Rev164 (Carlos): supervisor state that watches TWS averaged over the
  // last 60 s and switches the pypilot profile when the wind band has
  // been stable for BAND_STABLE_MS. Kept off the historian tick to
  // avoid entangling the KPI loop.
  const AUTO_PROFILE_BAND_STABLE_MS = 90 * 1000;
  const AUTO_PROFILE_WIND_AVG_MS    = 60 * 1000;
  const AUTO_PROFILE_TWS_MED_KN     = 8;    // < 8 kn = light
  const AUTO_PROFILE_TWS_HEAVY_KN   = 16;   // > 16 kn = heavy
  type AutoProfileBand = "light" | "medium" | "heavy" | null;
  let _autoProfileCurrentBand: AutoProfileBand = null;
  let _autoProfilePendingBand: AutoProfileBand = null;
  let _autoProfilePendingSince: number | null = null;
  let _autoProfileLastSwitchTs: number | null = null;
  let _autoProfileLastReason: string | null = null;
  // Rev167: gust supervisor. Rolling ring of AWS samples with timestamps.
  const GUST_WINDOW_MS    = 5000;     // look-back for rate-of-change
  const GUST_MIN_JUMP_KN  = 5;        // AWS jump >= 5 kn = "gust"
  // Rev283: second signal to confirm a real gust vs a sensor spike.
  // If heel data is available on both the min-AWS and max-AWS ends of
  // the window, require the heel to have changed at least this many
  // degrees during the same interval. Without heel data the check
  // fails open (legacy Rev167 behaviour).
  const GUST_HEEL_CONFIRM_DEG = 2;
  const GUST_COOLDOWN_MS  = 60_000;   // do not re-alert / re-strategy for 60 s
  const GUST_FREEZE_SEC   = 12;       // pin target for 12 s after detection
  const GUST_BOOST_SEC    = 20;       // damp D for 20 s after detection
  const GUST_HEAVY_SEC    = 30;       // temp heavy profile for 30 s
  const _gustAwsBuffer: Array<{ ts: number; ktts: number; heelRad: number | null }> = [];
  let _gustLastAlertTs = 0;
  // Rev283: last suppressed-by-heel event for observability.
  let _gustLastSuppressedTs: number | null = null;
  let _gustLastSuppressReason: string | null = null;
  // Runtime state for the "freeze-target" strategy so the visor +
  // /supervisor/status can show why the target has stopped following
  // the wind for a few seconds.
  let _gustFreezeUntilMs: number | null = null;
  let _gustFreezeTargetRad: number | null = null;
  // "boost-D" bookkeeping: original D per pilot so we can restore.
  let _gustBoostUntilMs: number | null = null;
  let _gustBoostRestoreGain: { pilot: string; key: "D"; value: number } | null = null;
  // "temp-heavy" bookkeeping: original profile so we can restore.
  let _gustHeavyUntilMs: number | null = null;
  let _gustHeavyRestoreProfile: string | null = null;
  // Rev166: authority-lost auto-disengage. Track how long we have been
  // in the "cannot steer" condition so the disengage fires exactly at
  // 10 s of sustained loss, not on a single spike.
  const AUTHORITY_LOST_SUSTAIN_MS   = 10_000;
  const AUTHORITY_LOST_RMS_DEG      = 30;
  const AUTHORITY_LOST_DUTY_MIN     = 0.90;
  const AUTHORITY_LOST_COOLDOWN_MS  = 60_000;   // after auto-disengage, block re-arm 60 s
  let _authorityLostSinceMs: number | null = null;
  let _authorityLastAutoDisengageTs: number | null = null;
  // Rev176 (Carlos): debounce the raw `engaged` flag so a rebound
  // caused by a competing client (pypilot_web on another device, a KIP
  // widget cycling, socket races) does not open+close a JSONL every 5 s.
  // Only accept a new stable state once it has held for ENGAGED_DEBOUNCE_MS.
  // Also count how many rebounds we filter so the status endpoint can
  // surface it - handy for spotting a rogue client from the diagnostics
  // page.
  const ENGAGED_DEBOUNCE_MS = 8_000;
  let _engagedRaw: boolean | null = null;      // last raw value we saw
  let _engagedRawSince: number = 0;             // when that raw flipped
  let _engagedStable: boolean = false;           // debounced value (what session recorder sees)
  let _engagedBouncesFiltered: number = 0;      // running counter
  let _engagedLastFilteredMs: number = 0;
  let _engagedLastFilteredDetails: string | null = null;
  // Rev100: Alarm engine + pypilot disconnect timestamp used by the
  // pypilot-disconnected rule.
  let alarms: AlarmEngine | null = null;
  let disconnectedSinceMs: number | null = null;
  // Rev103: Doctor engine (holds one active diagnostic session at a time).
  let doctor: DoctorEngine | null = null;
  // Rev281: correction episode detector. Watches headingCmd for step
  // changes and reports classic step-response metrics (rise / overshoot
  // / settling / SSE) per correction. Consumed by the Chart tab as a
  // quality-band gauge and by the Doctor as ground truth for tuning
  // advice.
  let episodes: EpisodeDetector | null = null;
  // Rev282: roll feed-forward computer. Idle unless props.rollFfGain > 0.
  // Currently PUBLISHES its output only, does not apply it to the AP.
  let rollFf: RollFeedForward | null = null;
  let _lastRollFfDeltaRad = 0;
  // Rev298 (H4): leeway estimator. Idle unless props.leewayAdjustment > 0.
  // Publishes `performance.leeway` on each historian tick.
  let leewayEst: LeewayEstimator | null = null;
  let _lastLeewayRad: number | null = null;
  // Rev299 (H2): failsafe BSP resolver. Feeds a plausible boat speed
  // into leeway and any future speed-dependent derivation when both
  // BSP and SOG are missing. `_lastBspSource` is exposed via
  // /api/diagnostic so operators know when they are looking at a
  // failsafe-derived value.
  let bspResolver: FailsafeBspResolver | null = null;
  let _lastBspSource: BspSource = "none";
  // Rev299 (I2): tack catch-up. `_tackStatePrev` and `_tackDirection`
  // let observeTackTransition tell "just finished a tack" from any
  // other state change of ap.tack.state.
  let tackCatchup: TackCatchup | null = null;
  let _lastTackCatchupRad = 0;
  let _tackStatePrev: string | null = null;
  let _tackDirection: TackDirection | null = null;
  // Rev283: persistent servo error log. Writes JSONL to dataDir on
  // every off→on transition of a servo-* alarm rule and remembers the
  // 30 s pre-fault window from the historian.
  let servoErrorLog: ServoErrorLog | null = null;
  // Rev286 (B2): profile advisor + last-published state for the SK
  // notification path. Idempotent publish: only sends a delta when
  // the state changes to avoid flooding subscribers.
  let profileAdvisor: ProfileAdvisor | null = null;
  let _profileAdvisorLastPubKind: string | null = null; // "normal" | AdvisoryKind
  let _profileAdvisorMetaSent = false;
  // Rev296 (Carlos, navigating - bug D): audit trail of every profile
  // change with source attribution. Every plugin-initiated set() marks
  // a planned write; the pypilot 'profile' delta hook correlates and
  // credits the source, or records "external" for changes we did not
  // initiate.
  const profileChangeLog = new ProfileChangeLog();
  // Rev143 (Carlos): navigation session recorder. Persists engaged
  // sessions labelled by conditions to disk so I (Claude) can analyse
  // them offline and inject boat-specific tuning heuristics in a
  // future Rev. See src/session-recorder.ts.
  let sessionRecorder: SessionRecorder | null = null;
  // Rev178 (Carlos): trip recorder. Fires on autostate transitions
  // (moored <-> underway/sailing/anchored...) instead of on AP engage,
  // so it also covers motor legs and tender rides. Independent of the
  // session recorder.
  let tripRecorder: TripRecorder | null = null;
  // Rev322 (Carlos, 2026-09-27): maneuver trace log. Off by default.
  let maneuverTrace: ManeuverTraceLog | null = null;
  // Rev323 (Carlos, 2026-09-27): pseudo-modo visor-side. El visor lo
  // posta a `/maneuver-state` al arrancar / cerrar Aproado o Empopado.
  // Se usa para silenciar heading-deviation / cruise-drift / unable-
  // to-steer durante la maniobra, INDEPENDIENTE de `ap.tack.state` —
  // en modo wind pypilot NO obedece y ap.tack.state se queda en "none"
  // aunque el visor esté pilotando la maniobra por otras vías.
  let _maneuverPseudoActive = false;
  let lastNavState: string | null = null;
  let sessionSampleTimer: NodeJS.Timeout | null = null;
  let lastEngagedState = false;
  // Rev138 (Carlos): Pi Zero log capture runtime state.
  let logCaptureTimer: NodeJS.Timeout | null = null;
  let logCaptureLastRunTs: number | null = null;
  let logCaptureLastError: string | null = null;
  let logCaptureLastAppendedBytes = 0;
  let logCaptureTailBuffer: string[] = [];
  const LOG_CAPTURE_TAIL_MAX = 400;   // lines of preview kept in RAM
  // per-source last-seen line hash for dedupe across polls.
  const logCaptureLastLineHash: Record<string, string> = {};
  // Rev176 (Carlos): persist the per-source last-line hash to disk so a
  // plugin restart does NOT re-inject the entire tail of every pypilot
  // log into the aggregated file. Before Rev176 every start() reset
  // this map, so the first poll after a `-Restart` deploy always saw
  // "no known lastHash" and appended the whole tail again - the same
  // block ended up in the file 32+ times, matching what showed up in
  // pizero-20260908.log ("32 events per burst window").
  const _lcStatePath = (): string => {
    const dataDir = (app.getDataDirPath ? app.getDataDirPath() : ".");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require("path");
    return p.join(dataDir, "pizero-log-state.json");
  };
  const _lcLoadState = (): void => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs");
      const raw = fs.readFileSync(_lcStatePath(), "utf8");
      const j = JSON.parse(raw);
      if (j && typeof j === "object") {
        for (const k of Object.keys(j)) {
          if (typeof j[k] === "string") logCaptureLastLineHash[k] = j[k];
        }
      }
    } catch { /* first run / no state yet */ }
  };
  const _lcSaveState = (): void => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs");
      fs.writeFileSync(_lcStatePath(), JSON.stringify(logCaptureLastLineHash));
    } catch { /* silent */ }
  };

  const plugin = {
    id: PLUGIN_ID,
    name: "PyPilot New-UI + SK Paths",
    description:
      "Modern touch-first control panel for pypilot autopilot plus every pypilot value as a first-class Signal K path (KIP-ready). Complements the official pypilot-autopilot-provider.",
    revision: PLUGIN_REVISION,

    schema: () => ({
      type: "object",
      required: ["host", "port"],
      properties: {
        host: {
          type: "string",
          title: "pypilot_web host",
          description:
            "IP or hostname of the machine running pypilot_web. Use the SETUP tab of the webapp to scan the LAN.",
          default: "",
        },
        port: {
          type: "number",
          title: "pypilot_web port",
          description:
            "TinyPilot ships pypilot_web on port 80. Classic pypilot install uses 8000.",
          default: 80,
        },
        reconnectDelayMs: {
          type: "number",
          title: "Reconnect delay (ms)",
          default: 3000,
        },
        allowWrites: {
          type: "boolean",
          title: "Allow writes",
          description:
            "Enables PUT handlers so Signal K clients can send commands (engage, mode, target, gains). Off = read-only mode.",
          default: true,
        },
        allowDirectServo: {
          type: "boolean",
          title: "Allow direct servo command",
          description:
            "DANGER: exposes the raw servo.command back-door used for manual steering. Watchdog is still enforced, but leave this OFF unless you understand the safety implications.",
          default: false,
        },
        publishUnmapped: {
          type: "boolean",
          title: "Publish unmapped values",
          description:
            "When on, every pypilot value discovered at runtime that is not in the fixed mapping table is auto-published under steering.autopilot.pypilot.<sanitized_name>.",
          default: false,
        },
        nudgeSmall: {
          type: "number",
          title: "Small nudge step (degrees)",
          description:
            "Label and value of the fine nudge buttons in the mobile UI. Default 1.",
          default: 1,
        },
        nudgeBig: {
          type: "number",
          title: "Big nudge step (degrees)",
          description:
            "Label and value of the coarse nudge buttons in the mobile UI. Default 10.",
          default: 10,
        },
        absorbProvider: {
          type: "boolean",
          title: "Absorb pypilot-autopilot-provider (one-socket mode)",
          description:
            "When on, this plugin registers itself as the SK Autopilot Provider (downstream SK autopilot clients control it via /signalk/v2/api/vessels/self/autopilots). REQUIRES you to disable the official 'pypilot-autopilot-provider' plugin at the same time - otherwise both fight for the deviceId. Benefit: only one socket to pypilot_web (halves the load on a Pi Zero TinyPilot).",
          default: false,
        },
        enabledPaths: {
          type: "object",
          title: "Enabled paths (pypilot name -> boolean)",
          description:
            "When publishOnlyEssentials is true: publish a non-essential path by setting it to true. When false: skip a path by setting it to false. Configure interactively via the webapp's Paths & API tab.",
          default: {},
        },
        publishOnlyEssentials: {
          type: "boolean",
          title: "Publish only essential paths (opt-in the rest)",
          description:
            "When ON, this plugin only publishes state/mode/target/engaged + the paths the UI needs (pilot list, modes list, tack, servo.engaged) + paths you explicitly turn on in the Paths & API tab. Reduces noise on the SK data browser. New installs default to ON.",
          default: true,
        },
        sshUser: {
          type: "string",
          title: "SSH user on the TinyPilot",
          description:
            "Username used by the 'Restart pypilot' button in Setup to log into the machine hosting pypilot_web. Default 'tc' matches TinyCore-based images.",
          default: "tc",
        },
        sshPassword: {
          type: "string",
          title: "SSH password (used by 'Restart pypilot')",
          description:
            "Password for the SSH user above. Stored in the plugin's config file in plain text (Signal K does not encrypt plugin settings). Leave blank to disable remote restart.",
          default: "",
        },
        logCaptureEnabled: {
          type: "boolean",
          title: "Capture Pi Zero logs to disk",
          description:
            "When ON, the plugin polls the TinyPilot via SSH every logCaptureIntervalSec seconds and appends the tail of /var/log/pypilot/current and /var/log/pypilot_web/current to daily files under this plugin's data directory. Useful because piCore keeps /var/log on tmpfs - after a hard reset the logs of the previous session are lost. Requires sshUser + sshPassword.",
          default: false,
        },
        logCaptureIntervalSec: {
          type: "number",
          title: "Log capture poll interval (seconds)",
          description: "How often to pull new lines from the Pi Zero. Default 60 s. Keep >=30 s to avoid pressuring the Pi Zero W (438 MB RAM).",
          default: 60,
        },
        sessionRecorderEnabled: {
          type: "boolean",
          title: "Record labelled navigation sessions",
          description: "When ON, the plugin appends 1 Hz autopilot telemetry (heading command/actual, servo current/duty, wind, etc.) to a JSONL file for every engaged session. Files stay on the Pi 5 until you download them from the visor. Used to feed the AI-tuned Doctor roadmap.",
          default: true,
        },
        sensorsIgnored: {
          type: "array",
          title: "Ignored sensor SK paths",
          description: "List of Signal K paths the sailor has marked as 'not on this boat' from Setup → Sensor Quality. Ignored sensors stop turning the Setup chip red without hiding the row. Managed from the visor; edit here only if you know the exact path names.",
          items: { type: "string" },
          default: [],
        },
        tripRecorderEnabled: {
          type: "boolean",
          title: "Record logbook (bitácora) trips",
          description: "When ON, the plugin auto-opens a trip on every leg away from moored, records position + wind + speed samples, and closes on return with a summary + KPI. Files stay on the Pi 5. Managed from Setup → Logbook.",
          default: true,
        },
        maneuverTraceEnabled: {
          type: "boolean",
          title: "Trace user maneuvers vs. pypilot response (sea-trial forensics)",
          description: "When ON, every maneuver-related action from the visor (aproado / empopado / tack / mode change / target PUT / engage) is logged along with pypilot state before and 300 ms after the command, so we can audit whether pypilot actually obeyed. Files land under <plugin data dir>/maneuver-trace/*.jsonl. Off by default — enable only during a sea trial.",
          default: false,
        },
        // Rev299 (2026-09-24): per-rule alarm enable list. Managed from
        // the visor's Setup → Alarms card. NO schema default here on
        // purpose: an existing install that upgraded from a pre-Rev299
        // plugin must not have its (implicit) alarms silenced by a
        // schema default of []. The visor is responsible for prompting
        // a first-time user to opt in ("start clean" vs "keep all on").
        alarmsEnabled: {
          type: "array",
          title: "Alarms enabled (rule ids)",
          description: "List of alarm rule ids that are active. When absent the plugin keeps its legacy behaviour (every rule on). Managed from the visor's Setup → Alarms card; edit here only if you know the rule ids (heading-deviation, servo-overcurrent, low-voltage, etc.).",
          items: { type: "string" },
        },
        // Rev167 (Carlos): the Smart Pilot toggles (auto-profile, gust
        // strategy, auto-disengage) live under Setup > Smart Pilot in
        // the visor, not here. Kept in the runtime PluginProps for
        // persistence but not exposed to the SK Admin schema.
      },
    }),

    start: (options: PluginProps) => {
      props = normalizeProps(options);
      if (!props.host) {
        app.setPluginStatus(
          "Not configured - open Plugin Config and set host:port, or use the SETUP tab of the webapp."
        );
        return;
      }
      app.setPluginStatus(
        `${PLUGIN_REVISION} - connecting to pypilot_web at ${props.host}:${props.port}`
      );

      client = new PypilotClient({
        host: props.host,
        port: props.port,
        reconnectDelayMs: props.reconnectDelayMs,
        log: (level, msg) => {
          if (level === "error") app.error(msg);
          else if (level === "warn") app.debug(msg);
          else app.debug(msg);
        },
      });
      // Rev271 (audit R05): propagate the allowWrites gate to the
      // single write path in PypilotClient.set(). Every route to a
      // pypilot write — provider interface, PUT handlers on action
      // paths, momentary switches — goes through set(), so this
      // check covers them all.
      client.setAllowWrites(props.allowWrites !== false);

      client.on("connect", () => {
        lastConnectAt = Date.now();
        lastDisconnectReason = null;
        disconnectedSinceMs = null;   // Rev100: clear alarm timer.
        app.setPluginStatus(
          `${PLUGIN_REVISION} - connected to ${props.host}:${props.port}${apProvider ? " (AutopilotProvider active)" : ""}`
        );
      });

      client.on("disconnect", (reason: string) => {
        lastDisconnectReason = reason;
        if (disconnectedSinceMs == null) disconnectedSinceMs = Date.now();  // Rev100
        if (apProvider) apProvider.markOffline();
        pushAutopilotUpdate();
        app.setPluginStatus(
          `${PLUGIN_REVISION} - reconnecting (last: ${reason})`
        );
      });

      client.on("pong", (latency: number) => {
        lastPingLatencyMs = latency;
      });

      // Rev271 (audit R03): pypilot_web can stay alive while the core
      // died; propagate the sticky offline flag so alarms + status +
      // AP provider all know. The PypilotClient itself refuses set()
      // while coreOffline is true, but this makes the UI reflect it
      // and gives downstream SK clients an accurate autopilot state.
      client.on("pypilot_offline", () => {
        app.error("[pypilot-newui] pypilot core reported offline");
        if (apProvider) apProvider.markOffline();
        pushAutopilotUpdate();
        app.setPluginStatus(
          `${PLUGIN_REVISION} - pypilot core offline (web socket still up)`
        );
      });
      client.on("pypilot_online", () => {
        app.debug("[pypilot-newui] pypilot core back online");
        pushAutopilotUpdate();
        app.setPluginStatus(
          `${PLUGIN_REVISION} - connected to ${props.host}:${props.port}${apProvider ? " (AutopilotProvider active)" : ""}`
        );
      });

      client.on("catalog", (catalog: PypilotCatalog, info?: { isDelta: boolean; newKeys: string[] }) => {
        const isDelta = !!info?.isDelta;
        lastCatalog = catalog;
        // Rev63 / 2.0.0 (issue #2): only reset the meta-sent tracker on the
        // INITIAL catalog. A delta catalog carries only newly-appeared keys
        // (typically calibration finishing to load a few seconds after
        // core), and we do NOT want to re-emit meta for the paths we
        // already published - it would flood the SK bus with duplicate
        // meta blobs. `metaSent` naturally excludes the new keys because
        // they were never added to it, so those will emit meta on first
        // publish as expected.
        if (!isDelta) metaSent = new Set();
        const catalogKeys = Object.keys(catalog);
        const gainKeys = catalogKeys.filter(
          (k) => k.startsWith("ap.pilot.") && (catalog[k] as any).AutopilotGain
        );
        const apKeys = catalogKeys.filter((k) => k.startsWith("ap.pilot."));
        app.setPluginStatus(
          `${PLUGIN_REVISION} - connected, catalog ${catalogKeys.length} vars (ap.pilots.*=${apKeys.length}, AutopilotGain=${gainKeys.length})${isDelta ? " [+" + info!.newKeys.length + " new]" : ""}`
        );
        setupWatches(client!, catalog);
        registerPutHandlers(catalog);
        publishCatalogDerived(catalog);
      });

      client.on("value", (name: string, value: unknown) => {
        publishValue(name, value);
        if (apProvider) {
          // Rev352: receiveValue now returns the field that changed
          // (engaged | target | all | null) so we push field-scoped
          // deltas instead of dragging every other value along. That
          // stops the "engaged=false push a few ms before the real
          // engaged=true" race that subscription-manager's minPeriod
          // collapsed into a lost delta (trace analysis 2026-09-30).
          const changedField = apProvider.receiveValue(name, value);
          if (changedField) pushAutopilotUpdate(changedField);
        }
        // Rev299 (I2): watch ap.tack.state for the tacking → none
        // transition, which is the moment the sailor needs the
        // catch-up nudge. `ap.tack.direction` is watched separately
        // so we already know which side we tacked onto by the time
        // the state event lands.
        try { observeTackTransition(name, value); } catch { /* silent */ }
        // Rev38: forward profile / profiles updates to the dynamic profile
        // switch registrar so KIP's radio group stays in sync.
        try {
          const hook = (app as any)._pypilotNewuiProfileHook as
            ((n: string, v: unknown) => void) | undefined;
          if (hook) hook(name, value);
        } catch { /* silent */ }
      });

      // Rev24: register KIP-friendly action PUT handlers regardless of
      // absorbProvider. These give KIP simple bool/number/string paths to
      // PUT from custom buttons (+10, AP toggle, tack).
      registerActionHandlers();
      // Rev27: force one autopilot-update push after start so canonical
      // steering.autopilot.{state,mode,target,engaged} appear immediately
      // even if pypilot has not sent an ap.enabled/mode update yet.
      setTimeout(() => pushAutopilotUpdate(), 4000);

      // Optional: absorb the official pypilot-autopilot-provider by registering
      // ourselves as the SK Autopilot Provider. Reduces the second socket to
      // pypilot_web that the Pi Zero cannot afford.
      if (props.absorbProvider && typeof app.registerAutopilotProvider === "function") {
        try {
          apProvider = new AutopilotProvider(client, app, {
            allowDodge: !!props.allowDirectServo,
            // Rev68: setTarget/adjustTarget assign optimistically and need
            // to push a canonical steering.autopilot.target delta right
            // then so the visor JS and any downstream SK client snap
            // without waiting for the pypilot echo round-trip.
            // Rev84: forward the field mask ("engaged" / "target" /
            // "all") so pushAutopilotUpdate filters the emitted delta
            // paths accordingly.
            onDataChanged: (fields) => pushAutopilotUpdate(fields),
            // Rev350 (Carlos, 2026-09-29): frontier observability. The
            // provider emits {stage:"provider", ...} events at every
            // decision point in receiveValue (accepted / echo-dropped /
            // override-applied). Forwarded to maneuver-trace when the
            // sailor has trace ON. Cheap when OFF (early-return).
            onStageEvent: (stage, ev) => {
              try { maneuverTrace?.logStageEvent(stage, ev); } catch { /* silent */ }
            },
          });
          app.registerAutopilotProvider(
            apProvider.toProviderInterface(),
            apProvider.pilotIds
          );
          // Watches for ap.enabled/mode/heading_command/modes are registered
          // in setupWatches() after the catalog arrives. Registering them here
          // (pre-connect) raced with the socket.io connect + pypilot_values
          // burst and the subscriptions were silently dropped by pypilot_web:
          // Rev32 diagnosis on Tunatunes showed apProvider.data stuck at the
          // "off-line" default for the whole session because ap.enabled never
          // arrived. ap.tack.* worked because setupWatches registers it
          // post-catalog when the socket is fully settled.
          app.setPluginStatus(
            `${PLUGIN_REVISION} - AutopilotProvider registered. IMPORTANT: disable the 'pypilot-autopilot-provider' plugin to avoid conflict.`
          );
        } catch (e: any) {
          app.error(`[absorb] registerAutopilotProvider failed: ${e?.message || e}`);
          apProvider = null;
        }
      } else if (props.absorbProvider) {
        app.setPluginStatus(
          `${PLUGIN_REVISION} - absorbProvider requested but app.registerAutopilotProvider is not available (SK Server too old).`
        );
      }

      client.start();

      // Rev93: telemetry historian. RAM-only ring buffer at 1 Hz - the
      // Chart tab pulls slices via /history, the KPI computer reads from
      // it too. Kept modest on purpose so Pi 4 hosts have headroom;
      // disk persistence is opt-in in a later batch.
      historian = new Historian({ capacitySamples: 1800, samplePeriodMs: 1000 });
      // Rev95: KPI computer feeds off every sample and publishes a
      // compact digest every second as SK paths (see publishKpiPaths).
      kpis = new KPIComputer(historian, { sampleTickMs: 1000 });
      // Rev97: Sensor Quality monitor rides the same 1 Hz tick. On each
      // tick we hand it the FULL SK entry (with timestamp + source) for
      // each watched path so it can grade freshness / Hz / jitter.
      sensorQuality = new SensorQualityMonitor(DEFAULT_QUALITY_WATCH, { windowMs: 30_000 });
      // Rev99: Servo Health monitor learns baseline + grades deviation
      // from each servo-on engaged sample. Also O(1).
      // Rev158 (Carlos): load persisted baseline if present so the
      // ~10 min of learning survives plugin restarts. Snapshot is
      // written every 5 min while running (see servoHealthPersistTimer
      // below) and on plugin.stop().
      servoHealth = new ServoHealthMonitor();
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const p = require("path");
        const file = p.join(app.getDataDirPath ? app.getDataDirPath() : ".", "servo-baseline.json");
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, "utf8"));
          servoHealth.loadPersisted(raw);
          app.debug?.(`[servo-health] baseline restored (${raw.baselineA?.toFixed?.(3)} A saved ${raw.savedAt ? new Date(raw.savedAt).toISOString() : "?"})`);
        }
      } catch (e: any) {
        app.debug?.(`[servo-health] baseline load skipped: ${e?.message || e}`);
      }
      if (servoHealthPersistTimer) { try { clearInterval(servoHealthPersistTimer); } catch {} }
      servoHealthPersistTimer = setInterval(() => {
        try {
          if (!servoHealth) return;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require("fs");
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const p = require("path");
          const file = p.join(app.getDataDirPath ? app.getDataDirPath() : ".", "servo-baseline.json");
          fs.writeFileSync(file, JSON.stringify(servoHealth.toPersistable()));
        } catch { /* silent */ }
      }, 5 * 60 * 1000);
      if (typeof (servoHealthPersistTimer as NodeJS.Timeout & { unref?: () => void }).unref === "function") {
        (servoHealthPersistTimer as NodeJS.Timeout & { unref: () => void }).unref();
      }
      // Rev100: Alarm engine. Evaluates 7 built-in rules against every
      // tick + snapshot from the KPI computer + Sensor Quality + Servo
      // Health. Rules that fire publish canonical SK notifications and
      // land in /alarms/state for the visor banner.
      alarms = new AlarmEngine();
      // Rev292 (Carlos, navigating): apply the user's chosen pypilot-
      // disconnect sustain window on start-up, in case pluginOptions
      // already carries a value.
      try { alarms.setRuleSustain("pypilot-disconnected", props.alarmPypilotDiscSec ?? 15); }
      catch { /* silent */ }
      // Rev299: apply the per-rule enable list. undefined = legacy
      // behaviour (every rule stays on its defaultEnabled). Array
      // (including empty) = user-selected: only the listed ids fire.
      try { applyAlarmsEnabled(props.alarmsEnabled); } catch { /* silent */ }
      // Rev342 (Carlos, 2026-09-28): apply per-rule severity overrides
      // saved from the visor. Missing keys keep the RuleDef default.
      try {
        const overrides = props.alarmSeverityOverrides || {};
        for (const [ruleId, sev] of Object.entries(overrides)) {
          if (sev === "info" || sev === "warn" || sev === "alarm") {
            alarms.setRuleSeverity(ruleId, sev);
          }
        }
      } catch { /* silent */ }
      // Rev281: episode detector idles until the sampler feeds it.
      episodes = new EpisodeDetector();
      // Rev103: Pypilot Doctor engine. Starts an idle instance;
      // sessions are triggered on demand via /doctor/start.
      // Rev284: Doctor now consumes step-response episodes on top of
      // raw heading statistics.
      // Rev288: Doctor also reads the current Roll FF setting so
      // Rule 6 can flag downwind roll when the FF slider is at 0.
      doctor = new DoctorEngine(historian, client, episodes, () => ({
        rollFfGain: props.rollFfGain ?? 0,
      }));
      // Rev296 (bug D): Doctor fork writes go through the change log.
      doctor.setProfileWriteHook((name, reason) => {
        try { profileChangeLog.markPlannedWrite(name, "doctor", reason); }
        catch { /* silent */ }
      });
      // Rev282: roll feed-forward, off unless the user turned it on.
      rollFf = new RollFeedForward({
        gain: props.rollFfGain ?? 0,
        tauSec: props.rollFfTauSec ?? 3,
        twaGateDeg: props.rollFfTwaGateDeg ?? 90,
      });
      // Rev298 (H4): leeway estimator, off unless leewayAdjustment > 0.
      leewayEst = new LeewayEstimator({
        adj: props.leewayAdjustment ?? 0,
      });
      // Rev299 (H2): failsafe BSP resolver. Always instantiated so
      // leeway/etc. can call resolve() unconditionally; failSafeBspKn
      // = 0 keeps it inert until the sailor opts in.
      bspResolver = new FailsafeBspResolver({
        failSafeBspKn: props.failSafeBspKn ?? 0,
      });
      // Rev299 (I2): tack catch-up. tackCatchupDeg=0 keeps it inert.
      tackCatchup = new TackCatchup({
        offsetDeg: props.tackCatchupDeg ?? 0,
        tauSec: props.tackCatchupTauSec ?? 6,
      });
      // Rev283: servo error log. Shares dataDir with the session and
      // trip recorders. On startup loads recent history from disk so
      // the visor has continuity across a Pi restart.
      servoErrorLog = new ServoErrorLog({
        dataDir: (app.getDataDirPath ? app.getDataDirPath() : "."),
        log: (level: string, msg: string) => { try { (app as any).debug?.(`${level} ${msg}`); } catch {} },
        getRecentSamples: (windowMs) => (historian ? historian.slice(windowMs) as Sample[] : []),
      });
      // Rev286 (B2): profile advisor. Off unless props.profileAdvisorEnabled.
      profileAdvisor = new ProfileAdvisor({
        rmsHighDeg: props.profileAdvisorRmsHighDeg ?? 10,
        rmsLowDeg:  props.profileAdvisorRmsLowDeg  ?? 1,
        sustainSec: props.profileAdvisorSustainSec ?? 60,
      });
      // Rev143: session recorder wired into the historian tick so we
      // share the same 1 Hz cadence and the same collectSample() call.
      sessionRecorder = new SessionRecorder({
        dataDir: (app.getDataDirPath ? app.getDataDirPath() : "."),
        log: (level: string, msg: string) => { try { (app as any).debug?.(`${level} ${msg}`); } catch {} },
      });
      // Rev178 (Carlos): trip recorder. Same data dir, own subfolder.
      tripRecorder = new TripRecorder({
        dataDir: (app.getDataDirPath ? app.getDataDirPath() : "."),
        log: (level: string, msg: string) => { try { (app as any).debug?.(`${level} ${msg}`); } catch {} },
      });
      // Rev322 (Carlos, 2026-09-27): maneuver trace log. Instance is
      // always created so the ring buffer + /tail work; disk writes
      // only start when props.maneuverTraceEnabled is true (or the
      // sailor toggles start from the visor at runtime).
      maneuverTrace = new ManeuverTraceLog({
        dataDir: (app.getDataDirPath ? app.getDataDirPath() : "."),
        log: (level: "info" | "warn" | "error", msg: string) => {
          try { (app as any).debug?.(`${level} ${msg}`); } catch {}
        },
      });
      if (props.maneuverTraceEnabled) maneuverTrace.start();
      historian.start(() => {
        const s = collectSample();
        // Update session counters BEFORE the sample lands in the buffer -
        // KPIComputer.onSample is O(1) so this stays cheap on Pi 4.
        if (kpis) { try { kpis.onSample(s); } catch { /* silent */ } }
        if (servoHealth) { try { servoHealth.onSample(s); } catch { /* silent */ } }
        if (episodes) { try { episodes.onSample(s); } catch { /* silent */ } }
        // Rev282: roll feed-forward tick. Output goes to _lastRollFfDeltaRad
        // and is published under steering.autopilot.pypilot.tuning.rollFf.*
        // by the KPI publisher interval. NOT applied to the AP yet.
        if (rollFf) {
          try {
            _lastRollFfDeltaRad = rollFf.compute({
              ts: s.ts,
              heel: s.heel,
              twa: s.twa,
              engaged: s.engaged,
            });
          } catch { _lastRollFfDeltaRad = 0; }
        }
        // Rev298 (H4) + Rev299 (H2): leeway estimator tick. Goes
        // through the FailsafeBspResolver so that if the speedo AND
        // SOG both drop, the failsafe kicks in and leeway keeps
        // publishing instead of going null. `_lastBspSource` is used
        // by /api/diagnostic to reveal when leeway is leaning on the
        // failsafe.
        if (leewayEst && bspResolver) {
          try {
            const bspRawMs = (app.getSelfPath
              ? app.getSelfPath("navigation.speedThroughWater.value")
              : null) as number | null;
            const resolved = bspResolver.resolve(bspRawMs, s.sog);
            _lastBspSource = resolved.source;
            _lastLeewayRad = leewayEst.compute(s.heel, resolved.valueMs);
            if (_lastLeewayRad != null) publishLeewayDelta(_lastLeewayRad, s.ts);
          } catch { _lastLeewayRad = null; }
        }
        // Rev299 (I2): tack catch-up tick. Advances the exponential
        // decay set by observeTackTransition. Published as diagnostic
        // path only; NOT applied to the pilot yet.
        if (tackCatchup) {
          try { _lastTackCatchupRad = tackCatchup.compute(s.ts); }
          catch { _lastTackCatchupRad = 0; }
        }
        // Rev97: also feed the quality monitor. Reading each watched
        // path costs one getSelfPath() call, cheap on Pi 4.
        if (sensorQuality) { try { feedSensorQuality(); } catch { /* silent */ } }
        // Rev143: session recorder gets a copy of this tick's sample
        // when the AP is engaged. Engage/disengage transitions open
        // and close a JSONL file.
        if (props.sessionRecorderEnabled) { try { _sessionTick(s); } catch { /* silent */ } }
        // Rev178 (Carlos): trip recorder tick, driven by navigation.state
        // instead of engage. Cheap even when idle.
        try { _tripTick(s); } catch { /* silent */ }
        // Rev164/165/166: supervisor layer. Each helper is cheap and
        // returns immediately when its feature is disabled.
        try { _supervisorTick(s); } catch (e: any) { app.debug?.(`[supervisor] tick: ${e?.message || e}`); }
        // Rev100: run the alarm engine last so it has every input up to
        // date. Changed rules trigger SK notification deltas.
        try { evaluateAndPublishAlarms(s); } catch { /* silent */ }
        // Rev286 (B2): profile advisor. Watches window1m and emits an
        // advisory notification when tracking has been sustainedly bad
        // or over-tight. Never applies anything.
        try { tickProfileAdvisor(s.ts); } catch { /* silent */ }
        return s;
      });
      kpiPublishTimer = setInterval(() => {
        try { publishKpiPaths(); } catch { /* silent */ }
        try { publishServoHealthPaths(); } catch { /* silent */ }
        try { publishRollFfPaths(); } catch { /* silent */ }
        try { publishTackCatchupPaths(); } catch { /* silent */ }
      }, 1000);
      if (typeof (kpiPublishTimer as NodeJS.Timeout & { unref?: () => void }).unref === "function") {
        (kpiPublishTimer as NodeJS.Timeout & { unref: () => void }).unref();
      }
    },

    stop: () => {
      if (client) {
        try { client.stop(); } catch { /* defensive */ }
        client = null;
      }
      // Rev93: stop the historian sampler so its setInterval does not
      // outlive the plugin (Disable+Enable in the SK admin would leak
      // it just like the watchdog timer used to).
      if (historian) {
        try { historian.stop(); } catch { /* defensive */ }
        historian = null;
      }
      // Rev95: stop the KPI publisher and drop the computer.
      if (kpiPublishTimer) {
        try { clearInterval(kpiPublishTimer); } catch { /* defensive */ }
        kpiPublishTimer = null;
      }
      kpis = null;
      kpiMetaSent = false;
      rollFfMetaSent = false;
      leewayMetaSent = false;
      tackCatchupMetaSent = false;
      // Rev97: drop the sensor quality monitor (its ring buffers go with it).
      sensorQuality = null;
      // Rev99: drop the servo health monitor (its EWMA baseline resets
      // on plugin restart - persistence lands with the disk snapshots).
      // Rev158: flush the baseline one last time before dropping the
      // monitor so a graceful stop persists whatever was learned this
      // uptime, even if the 5 min timer had not fired yet.
      if (servoHealth) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require("fs");
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const p = require("path");
          const file = p.join(app.getDataDirPath ? app.getDataDirPath() : ".", "servo-baseline.json");
          fs.writeFileSync(file, JSON.stringify(servoHealth.toPersistable()));
        } catch { /* silent */ }
      }
      if (servoHealthPersistTimer) {
        try { clearInterval(servoHealthPersistTimer); } catch {}
        servoHealthPersistTimer = null;
      }
      servoHealth = null;
      servoHealthMetaSent = false;
      // Rev100: drop the alarm engine. Active alarms will be re-fired
      // when the plugin restarts if the underlying condition persists.
      alarms = null;
      disconnectedSinceMs = null;
      // Rev138: stop the Pi Zero log capture timer so it does not
      // outlive the plugin. State (last hash / tail buffer) is
      // module-scope so it survives a start/stop cycle within the
      // same node process - intentional, so a restart does not lose
      // dedupe.
      if (logCaptureTimer) {
        try { clearInterval(logCaptureTimer); } catch {}
        logCaptureTimer = null;
      }
      // Rev140: stop the watch sweep timer and drop focus state so a
      // subsequent enable does not resurrect stale subscriptions.
      _stopWatchSweep();
      _focusWatches.clear();
      _lastAppliedWatches = {};
      // Rev143: close any in-flight session before dropping the
      // recorder so we do not leave a JSONL half-written.
      if (sessionRecorder) {
        try { sessionRecorder.stop(); } catch {}
        sessionRecorder = null;
      }
      // Rev178 (Carlos): close any open trip on plugin stop so the
      // summary lands on disk before the process exits.
      if (tripRecorder) {
        try { tripRecorder.stop(); } catch {}
        tripRecorder = null;
      }
      // Rev322 (Carlos, 2026-09-27): flush the trace file + kill any
      // pending post-capture timers on plugin stop.
      if (maneuverTrace) {
        try { maneuverTrace.stop(); } catch {}
        maneuverTrace = null;
      }
      if (sessionSampleTimer) {
        try { clearInterval(sessionSampleTimer); } catch {}
        sessionSampleTimer = null;
      }
      lastEngagedState = false;
      // Rev103: cancel any in-flight diagnostic session and drop the doctor.
      if (doctor) { try { doctor.cancel(); } catch { /* silent */ } }
      doctor = null;
      // Rev281: drop the episode detector so its history is not stale
      // across a Disable+Enable cycle.
      episodes = null;
      // Rev282: drop the roll feed-forward computer.
      rollFf = null;
      _lastRollFfDeltaRad = 0;
      leewayEst = null;
      _lastLeewayRad = null;
      bspResolver = null;
      _lastBspSource = "none";
      tackCatchup = null;
      _lastTackCatchupRad = 0;
      _tackStatePrev = null;
      _tackDirection = null;
      // Rev283: drop the servo error log (persisted state stays on disk).
      servoErrorLog = null;
      // Rev286: drop advisor + reset dedup markers so a re-enable
      // sends fresh SK notification state.
      profileAdvisor = null;
      _profileAdvisorLastPubKind = null;
      _profileAdvisorMetaSent = false;
      // Clear the action-paths keep-alive interval registered on the app.
      const ka = (app as any)._pypilotNewuiKeepAlive;
      if (ka) { try { clearInterval(ka); } catch { /* defensive */ } (app as any)._pypilotNewuiKeepAlive = null; }
      // Rev66 / 2.0.4: clear the reconnection watchdog interval, otherwise
      // a Disable+Enable cycle in SK Admin would leave the previous
      // watchdog running against a null `client` forever.
      const wd = (app as any)._pypilotNewuiWatchdogTimer;
      if (wd) { try { clearInterval(wd); } catch { /* defensive */ } (app as any)._pypilotNewuiWatchdogTimer = null; }
      // The SK autopilot API does not expose an unregister; on plugin stop
      // the server drops our provider when it garbage-collects the plugin.
      apProvider = null;
      lastCatalog = {};
      publishedSkPaths = new Set();
      metaSent = new Set();
      putHandlersRegistered = new Set();
      deltaSentCount = 0;
      lastConnectAt = null;
      lastDisconnectReason = null;
      app.setPluginStatus(`${PLUGIN_REVISION} - stopped`);
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerWithRouter: (router: any) => {
      // Rev66 / 2.0.4: shared "hard reconnect" helper - pauses the socket
      // and re-opens it after a short beat. Used by /restart-pypilot,
      // /debug-cmd (restart.web / reboot.pi presets) and the watchdog.
      const doReconnect = () => {
        try { client?.pause(); setTimeout(() => client?.resume(), 800); } catch {}
      };

      router.get("/status", (_req: any, res: any) => {
        res.json({
          revision: PLUGIN_REVISION,
          version: PLUGIN_PKG_VERSION,
          host: props.host,
          port: props.port,
          connected: client?.connected ?? false,
          // Rev260 (Carlos): stricter pong-aware liveness. The visor
          // uses this to grey out engage/nudge/tack BEFORE the sailor
          // can fire a write that would end up rejected with a 500.
          healthy: client?.healthy ?? false,
          lastConnectAt,
          lastDisconnectReason,
          catalogSize: Object.keys(lastCatalog).length,
          publishedPaths: [...publishedSkPaths],
          putHandlersRegistered: [...putHandlersRegistered],
          deltaSentCount,
          lastPingLatencyMs,
          allowWrites: props.allowWrites ?? true,
          allowDirectServo: props.allowDirectServo ?? false,
          nudgeSmall: props.nudgeSmall ?? 1,
          nudgeBig: props.nudgeBig ?? 10,
          absorbProvider: !!apProvider,
          apData: apProvider ? apProvider.data : null,
          enabledPaths: props.enabledPaths || {},
          publishOnlyEssentials: !!props.publishOnlyEssentials,
          sshUser: props.sshUser || "tc",
          sshPasswordSet: !!(props.sshPassword && props.sshPassword.length),
          // Rev93: historian buffer state (count / capacity / oldest+newest ts).
          // Cheap: no sample data returned, just the header. See /history for
          // the actual samples.
          historian: historian ? historian.status() : null,
          // Rev95: KPI snapshot header (computedTs + session start). Full
          // snapshot lives under /stats to avoid bloating /status calls
          // that downstream SK clients poll frequently.
          kpisComputedTs: kpis ? kpis.snapshot().computedTs : null,
        });
      });

      router.get("/paths", (_req: any, res: any) => {
        const items: any[] = [];
        for (const [name, meta] of Object.entries(lastCatalog)) {
          if (RESERVED_PYPILOT_KEYS.has(name)) continue;
          const mapping = mappingFor(name, meta);
          items.push({
            pypilotName: name,
            skPath: mapping.skPath,
            units: mapping.units,
            displayName: mapping.displayName,
            catalog: meta,
            essential: ESSENTIAL_PYPILOT_KEYS.has(name),
            get: `/signalk/v1/api/vessels/self/${mapping.skPath.replace(/\./g, "/")}`,
            put: mapping.putKind === "plain"
              ? `PUT /plugins/${PLUGIN_ID}/raw  {"name":"${name}","value":<value>}`
              : null,
          });
        }
        res.json({
          count: items.length,
          items,
          enabledPaths: props.enabledPaths || {},
          essentials: [...ESSENTIAL_PYPILOT_KEYS],
          publishOnlyEssentials: !!props.publishOnlyEssentials,
        });
      });

      router.get("/catalog", (_req: any, res: any) => {
        res.json(lastCatalog);
      });

      // Rev281 (D3): config backup + restore.
      //   GET  /config/export           - download a JSON bundle of plugin
      //                                   options + persistent pypilot
      //                                   settings. Runtime telemetry is
      //                                   filtered out.
      //   POST /config/import           - accept a bundle previously
      //                                   downloaded from /config/export
      //                                   (or a copy from another boat)
      //                                   and apply it. Returns an audit
      //                                   list with per-key status. The
      //                                   plugin restart to pick up the
      //                                   new pluginOptions is triggered
      //                                   asynchronously - the client
      //                                   should reconnect after ~2 s.
      router.get("/config/export", (_req: any, res: any) => {
        if (!client) { res.status(503).json({ error: "pypilot client not connected" }); return; }
        try {
          const bundle = captureBundle({
            revision: PLUGIN_REVISION,
            props: props as unknown as Record<string, unknown>,
            catalog: client.getCatalog() as unknown as Record<string, { info?: { persistent?: boolean } }>,
            values: client.getValues(),
          });
          const stamp = new Date(bundle.capturedTs).toISOString().replace(/[:.]/g, "-");
          res.setHeader("Content-Disposition",
            `attachment; filename="pypilot-newui-config-${stamp}.json"`);
          res.setHeader("Content-Type", "application/json");
          res.send(JSON.stringify(bundle, null, 2));
        } catch (e: any) {
          res.status(500).json({ error: String(e?.message || e) });
        }
      });
      router.post("/config/import", (req: any, res: any) => {
        if (!client) { res.status(503).json({ error: "pypilot client not connected" }); return; }
        const bundle = req.body as ConfigBundle;
        const err = validateBundle(bundle);
        if (err) { res.status(400).json({ error: err }); return; }
        try {
          const audit = applyBundleToPypilot(
            bundle,
            client.getCatalog() as unknown as Record<string, unknown>,
            (k, v) => { client!.set(k, v); },
          );
          // Persist plugin-side options too if available.
          let pluginOptionsSaved = false;
          const anyApp = app as any;
          if (bundle.pluginOptions && typeof anyApp.savePluginOptions === "function") {
            try {
              const merged = { ...props, ...bundle.pluginOptions };
              anyApp.savePluginOptions(merged, (_e: any) => { /* silent */ });
              pluginOptionsSaved = true;
            } catch { /* silent */ }
          }
          res.json({
            ok: true,
            capturedTs: bundle.capturedTs,
            revision: bundle.revision,
            pluginOptionsSaved,
            audit,
          });
        } catch (e: any) {
          res.status(500).json({ error: String(e?.message || e) });
        }
      });

      // Rev93: telemetry history slice for the Chart tab. Query params:
      //   window=30s | 2m | 10m | 90000    (default 30s, capped at 60m)
      //   paths=headingCmd,rudder,...      (default: all)
      // Response: { count, windowMs, historian:{...status}, samples:[...] }.
      // The samples array is oldest-first and each row includes `ts` plus
      // the requested fields (or all Sample fields if paths is omitted).
      router.get("/history", (req: any, res: any) => {
        if (!historian) {
          res.status(503).json({ error: "historian not initialised" });
          return;
        }
        const windowMs = parseWindowMs(req.query?.window);
        const paths = parseSamplePaths(req.query?.paths);
        const samples = historian.slice(windowMs, paths);
        res.json({
          windowMs,
          count: samples.length,
          paths: paths ?? null,
          historian: historian.status(),
          samples,
        });
      });

      // Rev95: KPI snapshot for the Trip Stats card. Cheap - O(window) at
      // ~60 samples so it can be called on every visor refresh without
      // load. Session numbers accumulate since plugin start / last reset.
      router.get("/stats", (_req: any, res: any) => {
        if (!kpis) {
          res.status(503).json({ error: "kpis not initialised" });
          return;
        }
        res.json(kpis.snapshot());
      });

      // Rev97: Sensor Quality snapshot for the panel in Setup. Cheap -
      // O(watched paths) with ring buffers of at most 60 entries each,
      // so a poll every 3 s from the visor is fine on Pi 4.
      router.get("/quality", (_req: any, res: any) => {
        if (!sensorQuality) {
          res.status(503).json({ error: "sensor quality not initialised" });
          return;
        }
        // Rev324 (Carlos, 2026-09-28): include the shared "ignored"
        // list so the visor renders the same acknowledgments on every
        // device without touching localStorage.
        const snap = sensorQuality.snapshot();
        const ignored = Array.isArray(props.sensorsIgnored) ? props.sensorsIgnored : [];
        res.json({ ...snap, ignored });
      });
      // Rev326 (Carlos, 2026-09-28): OSM tile proxy. Both OpenStreetMap
      // volunteer servers (403 "App not following tile policy") and
      // CartoDB Voyager (watermark "API KEY REQUIRED" since late 2026)
      // reject embedded webapps served over Signal K. Routing tiles
      // through this backend lets us send the User-Agent that OSM's
      // policy requires (self-identifying app string) and centralises
      // caching. Zero external dependencies — Node 18+ has fetch built
      // in, browser handles per-tile caching via Cache-Control.
      router.get("/tiles/:z/:x/:y.png", async (req: any, res: any) => {
        const z = parseInt(req.params.z, 10);
        const x = parseInt(req.params.x, 10);
        const y = parseInt(req.params.y, 10);
        if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)
            || z < 0 || z > 19 || x < 0 || y < 0) {
          res.status(400).json({ error: "bad tile coords" });
          return;
        }
        const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
        try {
          const upstream = await fetch(url, {
            headers: {
              "User-Agent": `signalk-pypilot-newui/${PLUGIN_PKG_VERSION || "dev"} (https://github.com/Aitonos/signalk-pypilot-newui)`,
              "Accept": "image/png,image/*;q=0.8",
            },
          });
          if (!upstream.ok) {
            res.status(upstream.status).end();
            return;
          }
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.setHeader("Content-Type", "image/png");
          // Cache 24 h in the browser — OSM tiles are effectively
          // immutable within a day; a hard reload still fetches fresh.
          res.setHeader("Cache-Control", "public, max-age=86400, immutable");
          res.send(buf);
        } catch (e: any) {
          res.status(502).json({ error: String(e?.message || e) });
        }
      });

      // Rev324 (Carlos, 2026-09-28): mark/unmark a sensor as ignored
      // in the shared backend list. Body: {path: "...", ignored: bool}.
      router.post("/quality/ignored", (req: any, res: any) => {
        const body = req.body || {};
        const p = typeof body.path === "string" ? body.path.trim() : "";
        const ig = !!body.ignored;
        if (!p) return res.status(400).json({ error: "path required" });
        const current = new Set(Array.isArray(props.sensorsIgnored) ? props.sensorsIgnored : []);
        if (ig) current.add(p); else current.delete(p);
        props.sensorsIgnored = [...current].slice(0, 100);
        try {
          app.savePluginOptions?.(props, () => { /* noop */ });
        } catch (e: any) {
          return res.status(500).json({ error: String(e?.message || e) });
        }
        res.json({ ok: true, ignored: props.sensorsIgnored });
      });

      // Rev281: step-response metrics per correction episode. Cheap
      // (returns a fixed-capacity ring buffer, currently up to 20).
      router.get("/episodes", (_req: any, res: any) => {
        if (!episodes) { res.status(503).json({ error: "episodes not initialised" }); return; }
        try {
          const { rateEpisode } = require("./episodes");
          const history = episodes.snapshot().map((ep: any) => ({
            ...ep,
            rating: rateEpisode(ep),
          }));
          res.json({ current: episodes.current(), history });
        } catch (e: any) {
          res.status(500).json({ error: String(e?.message || e) });
        }
      });

      // Rev99: Servo Health snapshot. Same idea - O(1) read of the
      // monitor's precomputed state.
      router.get("/servo-health", (_req: any, res: any) => {
        if (!servoHealth) {
          res.status(503).json({ error: "servo health not initialised" });
          return;
        }
        res.json(servoHealth.snapshot());
      });

      // Rev100: alarm engine endpoints.
      //   GET  /alarms/state    - active alarms + short resolved history
      //   GET  /alarms/rules    - metadata of every rule for the config UI
      //   POST /alarms/ack/:id  - acknowledge one active alarm (silences sound)
      //   POST /alarms/mute/:id - mute the RULE for N minutes (query ?min=15)
      //   POST /alarms/enable/:id  ?on=1|0
      router.get("/alarms/state", (_req: any, res: any) => {
        if (!alarms) { res.status(503).json({ error: "alarms not initialised" }); return; }
        res.json(alarms.snapshot());
      });
      router.get("/alarms/rules", (_req: any, res: any) => {
        if (!alarms) { res.status(503).json({ error: "alarms not initialised" }); return; }
        res.json({ rules: alarms.describe() });
      });
      router.post("/alarms/ack/:id", (req: any, res: any) => {
        if (!alarms) { res.status(503).json({ error: "alarms not initialised" }); return; }
        const ok = alarms.ack(String(req.params?.id || ""));
        res.json({ ok, snapshot: alarms.snapshot() });
      });
      router.post("/alarms/mute/:id", (req: any, res: any) => {
        if (!alarms) { res.status(503).json({ error: "alarms not initialised" }); return; }
        const mins = Number(req.query?.min);
        const durMs = isFinite(mins) && mins > 0 ? mins * 60_000 : 15 * 60_000;
        const ok = alarms.mute(String(req.params?.id || ""), durMs);
        res.json({ ok, durationMs: durMs });
      });
      router.post("/alarms/enable/:id", (req: any, res: any) => {
        if (!alarms) { res.status(503).json({ error: "alarms not initialised" }); return; }
        const on = String(req.query?.on ?? "1") !== "0";
        const ok = alarms.setEnabled(String(req.params?.id || ""), on);
        res.json({ ok, enabled: on });
      });
      // Rev342 (Carlos, 2026-09-28): change the severity of one rule
      // and persist the override. Body: {severity: "info"|"warn"|"alarm"}.
      router.post("/alarms/severity/:id", (req: any, res: any) => {
        if (!alarms) return res.status(503).json({ error: "alarms not initialised" });
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const id = String(req.params?.id || "");
        const sev = String(req.body?.severity || "");
        if (sev !== "info" && sev !== "warn" && sev !== "alarm") {
          return res.status(400).json({ error: "severity must be info | warn | alarm" });
        }
        const ok = alarms.setRuleSeverity(id, sev);
        if (!ok) return res.status(404).json({ error: "unknown rule id" });
        // Persist the override so it survives a plugin restart.
        try {
          const map = { ...(props.alarmSeverityOverrides || {}) };
          map[id] = sev;
          props.alarmSeverityOverrides = map;
          app.savePluginOptions?.(props, () => { /* noop */ });
        } catch (e: any) {
          return res.status(500).json({ error: String(e?.message || e) });
        }
        res.json({ ok: true, id, severity: sev });
      });

      // Rev103: Pypilot Doctor endpoints.
      //   POST /doctor/start ?duration=180  - start a diagnostic session
      //   POST /doctor/cancel               - cancel the current session
      //   GET  /doctor/status               - state + progress + result
      //   POST /doctor/apply/:id            - apply one suggestion
      //   POST /doctor/apply-all            - apply every suggestion
      //   POST /doctor/reset                - clear result, back to idle
      router.post("/doctor/start", (req: any, res: any) => {
        if (!doctor) { res.status(503).json({ error: "doctor not initialised" }); return; }
        const q = Number(req.query?.duration);
        const dur = isFinite(q) && q > 0 ? q : 180;
        const r = doctor.start(dur);
        res.json({ ...r, status: doctor.status() });
      });
      router.post("/doctor/cancel", (_req: any, res: any) => {
        if (!doctor) { res.status(503).json({ error: "doctor not initialised" }); return; }
        const r = doctor.cancel();
        res.json({ ...r, status: doctor.status() });
      });
      router.get("/doctor/status", (_req: any, res: any) => {
        if (!doctor) { res.status(503).json({ error: "doctor not initialised" }); return; }
        res.json(doctor.status());
      });
      router.post("/doctor/apply/:id", (req: any, res: any) => {
        if (!doctor) { res.status(503).json({ error: "doctor not initialised" }); return; }
        const r = doctor.applySuggestion(String(req.params?.id || ""));
        res.json({ ...r, status: doctor.status() });
      });
      router.post("/doctor/apply-all", (_req: any, res: any) => {
        if (!doctor) { res.status(503).json({ error: "doctor not initialised" }); return; }
        const r = doctor.applyAll();
        res.json({ ...r, status: doctor.status() });
      });
      // Rev121: dismiss one suggestion (user explicitly ignores it).
      router.post("/doctor/dismiss/:id", (req: any, res: any) => {
        if (!doctor) { res.status(503).json({ error: "doctor not initialised" }); return; }
        const r = doctor.dismissSuggestion(String(req.params?.id || ""));
        res.json({ ...r, status: doctor.status() });
      });
      router.post("/doctor/reset", (_req: any, res: any) => {
        if (!doctor) { res.status(503).json({ error: "doctor not initialised" }); return; }
        doctor.reset();
        res.json({ ok: true, status: doctor.status() });
      });

      // Rev102: Pre-departure autopilot check. Pure aggregation over
      // data already collected by the historian / sensor quality /
      // servo health modules, so no separate sampling budget.
      router.get("/prechecks", (_req: any, res: any) => {
        const snap = runPrechecks({
          connected: !!(client && client.connected),
          disconnectedSinceMs,
          hasAutopilotProvider: !!apProvider,
          autopilotId: apProvider ? "pypilot-newui" : null,
          sample: null,   // prechecks only need aggregate signals
          quality: sensorQuality ? sensorQuality.snapshot() : null,
          servoHealth: servoHealth ? servoHealth.snapshot() : null,
        });
        res.json(snap);
      });

      // Rev95: reset the session counters. Buffer is untouched so the
      // Chart keeps showing the last 30 min - only the aggregate cards
      // zero out. Idempotent, no body required.
      router.post("/session/reset", (_req: any, res: any) => {
        if (!kpis) {
          res.status(503).json({ error: "kpis not initialised" });
          return;
        }
        kpis.reset();
        // Force one publish so subscribers see the zeroed counters
        // immediately instead of waiting up to 1 s for the next tick.
        try { publishKpiPaths(); } catch { /* silent */ }
        res.json({ ok: true, resetAt: Date.now(), snapshot: kpis.snapshot() });
      });

      // Rev21: expose the current pypilot value cache so the webapp can
      // populate slider positions (gains, calibration inputs, configuration
      // RangeSetting sliders) with the actual values on tab open.
      router.get("/values", (_req: any, res: any) => {
        res.json(client ? client.getValues() : {});
      });

      // Rev21/22: hot-apply enabledPaths (per-path publish toggle) WITHOUT a
      // plugin restart. Uses savePluginOptions to persist. Rev22: verifies
      // the call worked and reports persistence status back to the webapp
      // so a failure is visible in the UI (Carlos: "no se guardan").
      router.post("/publish", (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const ep = req.body?.enabledPaths;
        if (!ep || typeof ep !== "object") return res.status(400).json({ error: "enabledPaths object required" });
        props.enabledPaths = ep;
        const settings = {
          host: props.host,
          port: props.port,
          reconnectDelayMs: props.reconnectDelayMs,
          allowWrites: props.allowWrites,
          allowDirectServo: props.allowDirectServo,
          publishUnmapped: props.publishUnmapped,
          nudgeSmall: props.nudgeSmall,
          nudgeBig: props.nudgeBig,
          absorbProvider: props.absorbProvider,
          enabledPaths: ep,
          publishOnlyEssentials: props.publishOnlyEssentials,
        };
        const hasSave = typeof (app as any).savePluginOptions === "function";
        if (!hasSave) {
          app.error("[publish] app.savePluginOptions is not available; changes are in-memory only");
          return res.json({ ok: true, count: Object.keys(ep).length, persisted: false, warning: "savePluginOptions API missing" });
        }
        try {
          (app as any).savePluginOptions(settings, (err: any) => {
            if (err) {
              app.error(`[publish] savePluginOptions callback error: ${err?.message || err}`);
              return res.json({ ok: true, count: Object.keys(ep).length, persisted: false, warning: String(err?.message || err) });
            }
            app.debug(`[publish] persisted ${Object.keys(ep).length} toggles`);
            res.json({ ok: true, count: Object.keys(ep).length, persisted: true });
          });
        } catch (e: any) {
          app.error(`[publish] savePluginOptions threw: ${e?.message || e}`);
          res.json({ ok: true, count: Object.keys(ep).length, persisted: false, warning: String(e?.message || e) });
        }
      });

      router.get("/scan", async (req: any, res: any) => {
        try {
          const subnet = typeof req.query.subnet === "string" ? req.query.subnet : undefined;
          const hits = await scanLan({ subnet });
          res.json({ subnet: subnet ?? "auto", hits });
        } catch (e: any) {
          res.status(500).json({ error: e?.message || String(e) });
        }
      });

      router.put("/raw", (req: any, res: any) => {
        if (!props.allowWrites) {
          return res.status(403).json({ error: "allowWrites is disabled" });
        }
        if (!client || !client.connected) {
          return res.status(503).json({ error: "pypilot not connected" });
        }
        const name = req.body?.name;
        const value = req.body?.value;
        if (typeof name !== "string") {
          return res.status(400).json({ error: "missing 'name' string" });
        }
        // Rev280 (audit T22): previously only `servo.command` was
        // guarded, so a PUT with name="servo.position" or any other
        // direct-servo pypilot key slipped through and moved the rudder
        // without the sailor having enabled allowDirectServo. Any
        // `servo.*` key that pypilot itself treats as a direct
        // steering command must go behind that flag; the gains under
        // `ap.pilot.*.servo.*` are unaffected because they do not
        // share this prefix.
        if (!props.allowDirectServo && /^servo\.(command|position|raw|rawcommand|raw_command|velocity|torque|watts|amps|voltage_command|controller_command|pwm|duty)$/i.test(name)) {
          return res.status(403).json({ error: `${name} requires allowDirectServo` });
        }
        // Rev296 (bug D): mark profile writes coming through /raw as
        // "user" so the change log credits them correctly. Any other
        // key falls through unmodified.
        if (name === "profile" && typeof value === "string") {
          try { profileChangeLog.markPlannedWrite(value, "user", "PUT /raw"); }
          catch { /* silent */ }
        }
        // Rev381 (Carlos, 2026-10-01): intercept tack-begin via /raw.
        // The frontend tackHandler issues two raw writes:
        //   PUT /raw { name: "ap.tack.direction", value: "port|starboard" }
        //   PUT /raw { name: "ap.tack.state",     value: "begin" }
        // Rev378-380 put the virtual-tack FSM behind the POST /ap/tack/:dir
        // endpoint, but the frontend never calls it — the raw path bypassed
        // our provider.tack() entirely (seen in trace-20261001-161853 QA
        // 2026-10-01 16:49: ap.tack.state=begin forwarded to pypilot
        // unchanged, mode stayed "wind" throughout, no virtual-tack).
        // Fix: when a "begin" lands in wind modes and the apProvider is
        // active, re-route it through the FSM and DO NOT forward the raw
        // write to pypilot (otherwise pypilot runs its own buggy wind
        // tack in parallel). The direction write that typically precedes
        // "begin" by a few ms is harmless — pypilot stores it but our
        // FSM derives direction from its own argument.
        // Rev382 (Carlos, 2026-10-01): memorise the direction the
        // frontend sends in the ap.tack.direction raw write so the
        // state=begin that follows ~100ms later uses the FRESH value.
        // Rev381 QA on Tunatunes read ap.tack.direction from the
        // pypilot values cache which still carried the previous tack's
        // "starboard" when the user had just pressed "port" — the
        // intercept launched the wrong direction (16:58:42 journal).
        if (name === "ap.tack.direction" && (value === "port" || value === "starboard")) {
          (app as any)._pypilotNewuiLastTackDirection = {
            value,
            setAt: Date.now(),
          };
        }
        if (
          name === "ap.tack.state" &&
          value === "begin" &&
          apProvider
        ) {
          const modeStr = String((apProvider as any).data?.mode || "").toLowerCase();
          if (modeStr === "wind" || modeStr === "true wind") {
            const cached = (app as any)._pypilotNewuiLastTackDirection;
            const freshEnough = cached && (Date.now() - cached.setAt) < 1000;
            const dirCache = freshEnough ? cached.value : null;
            const dirRaw = (client as any).getValues?.()["ap.tack.direction"];
            const dir = dirCache
              ? dirCache
              : (dirRaw === "port" || dirRaw === "starboard" ? dirRaw : "starboard");
            // eslint-disable-next-line no-console
            console.log(`[/raw tack intercept] mode=${modeStr} dir=${dir} (cache=${dirCache ?? "n/a"} cache=${dirRaw ?? "n/a"}) → virtual-tack`);
            (apProvider as any)
              .toProviderInterface()
              .tack(dir, (apProvider as any).deviceId)
              .catch((e: any) => {
                // eslint-disable-next-line no-console
                console.log(`[/raw tack intercept] virtual-tack failed: ${e?.message || e}`);
              });
            return res.json({ ok: true, name, value, virtualTack: true });
          }
        }
        client.set(name, value);
        res.json({ ok: true, name, value });
      });

      // Emergency valves for when pypilot_web on the Pi Zero starts to
      // choke: pause disconnects our socket without unregistering the
      // plugin, resume opens a fresh one. State/catalog are kept in place.
      // Autopilot control endpoints - proxied through our plugin so writes
      // require the SAME auth as GET /status (which the SK admin session
      // already has). Avoids the extra permission wall that
      // /signalk/v2/api/vessels/self/autopilots/*/* enforces.
      const requireProvider = (res: any) => {
        if (!apProvider) {
          res.status(409).json({ error: "absorbProvider is not enabled - either enable it in Setup, or POST to /raw with e.g. name='ap.enabled'." });
          return false;
        }
        return true;
      };
      router.post("/ap/engage", async (_req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites is disabled" });
        try {
          if (apProvider) {
            await (apProvider.toProviderInterface() as any).engage(apProvider.deviceId);
          } else if (client?.connected) {
            client.set("ap.enabled", true);
          } else {
            return res.status(503).json({ error: "not connected" });
          }
          res.json({ ok: true });
        } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
      });
      router.post("/ap/disengage", async (_req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites is disabled" });
        try {
          if (apProvider) {
            await (apProvider.toProviderInterface() as any).disengage(apProvider.deviceId);
          } else if (client?.connected) {
            client.set("ap.enabled", false);
          } else {
            return res.status(503).json({ error: "not connected" });
          }
          res.json({ ok: true });
        } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
      });
      router.put("/ap/mode", async (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites is disabled" });
        const value = req.body?.value;
        if (typeof value !== "string") return res.status(400).json({ error: "value must be a string" });
        try {
          if (apProvider) {
            await (apProvider.toProviderInterface() as any).setMode(value, apProvider.deviceId);
          } else if (client?.connected) {
            client.set("ap.mode", value);
          } else {
            return res.status(503).json({ error: "not connected" });
          }
          res.json({ ok: true });
        } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
      });
      router.put("/ap/target", async (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites is disabled" });
        const rad = req.body?.value;
        if (typeof rad !== "number") return res.status(400).json({ error: "value must be a number (radians)" });
        try {
          if (apProvider) {
            await (apProvider.toProviderInterface() as any).setTarget(rad, apProvider.deviceId);
          } else if (client?.connected) {
            client.set("ap.heading_command", rad * 180 / Math.PI);
          } else {
            return res.status(503).json({ error: "not connected" });
          }
          res.json({ ok: true });
        } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
      });
      router.post("/ap/tack/:direction", async (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites is disabled" });
        const dir = req.params.direction;
        if (dir !== "port" && dir !== "starboard") return res.status(400).json({ error: "direction must be port or starboard" });
        try {
          if (apProvider) {
            await (apProvider.toProviderInterface() as any).tack(dir, apProvider.deviceId);
          } else if (client?.connected) {
            client.set("ap.tack.direction", dir);
            client.set("ap.tack.state", "begin");
          } else {
            return res.status(503).json({ error: "not connected" });
          }
          res.json({ ok: true });
        } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
      });

      // Rev378 (Carlos, 2026-10-01): virtual-tack observability + cancel.
      // The frontend polls /virtual-tack/status at 2 Hz during a tack
      // in wind modes so it can mask the mode selector while the
      // backend momentarily switches to compass (phase 1). Cancel is
      // called when the sailor taps the orange tack button a second
      // time; the driver rolls back on its next await.
      router.get("/virtual-tack/status", (_req: any, res: any) => {
        if (!apProvider) return res.json({ active: false });
        const vt = (apProvider as any).getVirtualTackState?.();
        if (!vt) return res.json({ active: false });
        // Rev384 (Carlos, 2026-10-01): expose intermediate target +
        // current heading so the sailor can see "where the FSM is
        // trying to steer" vs "where the hull actually is" in real
        // time during a tack. Useful in harbour QA to confirm the
        // intermediate math; useful in sea trial to spot when the
        // boat is lagging.
        const RAD2DEG = 180 / Math.PI;
        const g = vt.geometry;
        const stepRad = g?.intermediatesRad?.[vt.stepIndex];
        const stepDeg = typeof stepRad === "number" ? stepRad * RAD2DEG : null;
        let hNowDeg: number | null = null;
        try {
          const h = (app as any).getSelfPath?.("navigation.headingTrue");
          const v = h?.value;
          if (typeof v === "number") hNowDeg = v * RAD2DEG;
        } catch { /* noop */ }
        res.json({
          active: vt.phase !== "idle" && vt.phase !== "done" && vt.phase !== "abort",
          phase: vt.phase,
          direction: vt.direction,
          windMode: vt.windMode,
          stepIndex: vt.stepIndex,
          totalSteps: g?.intermediatesRad?.length ?? 0,
          startedAtMs: vt.startedAtMs,
          elapsedMs: vt.startedAtMs ? Date.now() - vt.startedAtMs : 0,
          angleStartDeg: g ? g.angleStartRad * RAD2DEG : null,
          angleNewDeg: g ? g.angleNewRad * RAD2DEG : null,
          deltaHDeg: g ? g.deltaHRad * RAD2DEG : null,
          hStartDeg: g ? g.hStartRad * RAD2DEG : null,
          hTargetDeg: g ? g.hTargetRad * RAD2DEG : null,
          intermediateDeg: stepDeg,
          headingNowDeg: hNowDeg,
          remainingDeg: (stepDeg !== null && hNowDeg !== null)
            ? Math.abs(((stepDeg - hNowDeg + 540) % 360) - 180)
            : null,
        });
      });
      router.post("/virtual-tack/cancel", (_req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites is disabled" });
        if (!apProvider) return res.status(503).json({ error: "no ap provider" });
        (apProvider as any).cancelVirtualTack?.();
        res.json({ ok: true });
      });
      // Rev387 (Carlos, 2026-10-01): idempotent start endpoint.
      // Body: { direction: "port"|"starboard", requestId?: string }.
      // The visor Rev388 will use this instead of the two-PUT /raw
      // sequence (ap.tack.direction + ap.tack.state=begin) to eliminate
      // the inter-request race and the maneuver trace confusion.
      router.post("/virtual-tack/start", async (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites is disabled" });
        if (!apProvider) return res.status(503).json({ error: "no ap provider" });
        const dir = req.body?.direction;
        if (dir !== "port" && dir !== "starboard") {
          return res.status(400).json({ error: "direction must be 'port' or 'starboard'" });
        }
        const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : null;
        try {
          const r = await (apProvider as any).startVirtualTack({ direction: dir, requestId });
          res.json(r);
        } catch (e: any) {
          res.status(409).json({ error: e?.message || String(e) });
        }
      });

      router.post("/pause", (_req: any, res: any) => {
        try {
          // Rev280 (audit T24): mark the intent so the reconnect
          // watchdog does not immediately undo a deliberate pause.
          // Cleared by /resume and by a plugin restart.
          (app as any)._pypilotNewuiPausedByUser = true;
          client?.pause();
          app.setPluginStatus(`${PLUGIN_REVISION} - paused (manual)`);
          res.json({ ok: true, state: "paused" });
        } catch (e: any) {
          res.status(500).json({ error: e?.message || String(e) });
        }
      });
      router.post("/resume", (_req: any, res: any) => {
        try {
          (app as any)._pypilotNewuiPausedByUser = false;
          client?.resume();
          res.json({ ok: true, state: "resuming" });
        } catch (e: any) {
          res.status(500).json({ error: e?.message || String(e) });
        }
      });

      // Rev55: restart pypilot on the TinyPilot via SSH password auth.
      // Credentials come from plugin config (sshUser + sshPassword). Uses
      // the ssh2 npm package - no reliance on external ssh/sshpass binaries.
      // Falls back to local socket reconnect if credentials are missing
      // or the SSH connection fails.
      router.post("/restart-pypilot", async (_req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const host = props.host;
        const sshUser = props.sshUser || "tc";
        const sshPassword = props.sshPassword || "";
        // Rev66 / 2.0.4: TinyPilot runs piCore Linux which uses runit,
        // NOT systemd. Our previous `sudo systemctl restart ...` command
        // was silently falling through to `|| true` on every install
        // because systemctl does not exist. The only step that had any
        // effect was the pkill; runsv then auto-relaunched the killed
        // processes. That inconsistent "kill without a clean start"
        // pattern was accumulating zombies + saturating the Pi Zero's
        // RAM until it hung.
        //
        // The runit-native way: `sudo sv restart /etc/sv/<service>` sends
        // SIGTERM to the child, waits for it to exit, and starts it back
        // up under supervision. Clean by design. We keep pkill as a
        // belt-and-braces safety net in case a python child ignores TERM
        // (some pypilot subprocesses have historically done that).
        const restartCmd = [
          "sudo sv restart /etc/sv/pypilot /etc/sv/pypilot_web /etc/sv/pypilot_hat 2>&1 || true",
          "sleep 2",
          "sudo pkill -9 -f 'python.*pypilot --version' 2>&1 || true",
          "sleep 1",
          "sudo sv up /etc/sv/pypilot /etc/sv/pypilot_web /etc/sv/pypilot_hat 2>&1 || true",
        ].join(" ; ");
        // `doReconnect` is defined at the router scope (Rev66) and reused by
        // /restart-pypilot, /debug-cmd and the watchdog.
        if (!sshPassword) {
          doReconnect();
          return res.status(202).json({
            ok: false,
            method: "reconnect-only",
            hint: "SSH password not set. Open Plugin Config in SK Admin (or the Setup tab) and fill 'SSH password'. Meanwhile the local socket was reconnected.",
          });
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { Client } = require("ssh2");
          const conn = new Client();
          const runOnce = () => new Promise<{ ok: boolean; out: string; code?: number }>((resolve) => {
            let settled = false;
            const finish = (r: { ok: boolean; out: string; code?: number }) => {
              if (settled) return;
              settled = true;
              try { conn.end(); } catch {}
              resolve(r);
            };
            conn.on("ready", () => {
              conn.exec(restartCmd, { pty: true }, (err: any, stream: any) => {
                if (err) { finish({ ok: false, out: err.message }); return; }
                let out = "";
                stream.on("close", (code: number) => finish({ ok: code === 0, out, code }));
                stream.on("data", (data: Buffer) => { out += data.toString(); });
                stream.stderr.on("data", (data: Buffer) => { out += data.toString(); });
                // If sudo prompts for a password on stdin (NOPASSWD not
                // configured), feed the SSH password again. Works on many
                // TinyCore setups where the same password is used for both.
                setTimeout(() => { try { stream.write(sshPassword + "\n"); } catch {} }, 300);
              });
            });
            conn.on("error", (err: any) => finish({ ok: false, out: `ssh: ${err?.message || err}` }));
            conn.on("timeout", () => finish({ ok: false, out: "ssh timeout" }));
            try {
              conn.connect({
                host, port: 22, username: sshUser, password: sshPassword,
                readyTimeout: 8000,
                tryKeyboard: true,
              });
              conn.on("keyboard-interactive", (_n: any, _i: any, _l: any, _p: any, finish2: any) => {
                finish2([sshPassword]);
              });
            } catch (e: any) { finish({ ok: false, out: e?.message || String(e) }); }
          });
          const r = await runOnce();
          if (r.ok) {
            setTimeout(doReconnect, 3000);
            return res.json({ ok: true, method: "ssh", detail: r.out.slice(0, 400) });
          }
          doReconnect();
          return res.status(202).json({
            ok: false,
            method: "reconnect-only",
            hint: `SSH to ${sshUser}@${host} failed (check password + user). Local socket was reconnected.`,
            detail: r.out.slice(0, 400),
          });
        } catch (e: any) {
          doReconnect();
          return res.status(500).json({ error: e?.message || String(e) });
        }
      });

      // Rev63 / 2.0.0: Debug console. A whitelist of preset commands
      // executed over the same ssh2 session as /restart-pypilot. The
      // whitelist is CLOSED - the endpoint refuses any command not in
      // DEBUG_PRESETS below, so a leaked JWT cannot be used to run
      // arbitrary shell on the TinyPilot. Requires allowWrites.
      const DEBUG_PRESETS: Record<string, string> = {
        "logs.pypilot":      "journalctl -u pypilot -n 200 --no-pager 2>&1 || (test -f /var/log/pypilot.log && tail -n 200 /var/log/pypilot.log) || echo 'no journal / no logfile'",
        "logs.pypilot_web":  "journalctl -u pypilot_web -n 200 --no-pager 2>&1 || echo 'no pypilot_web unit'",
        "logs.follow":       "(journalctl -u pypilot --since '30 seconds ago' --no-pager 2>/dev/null || (test -f /var/log/pypilot.log && tail -n 30 /var/log/pypilot.log) || echo 'no journal / no logfile - follow disabled')",
        "dmesg.tail":        "dmesg 2>&1 | tail -100",
        "top.snapshot":      "top -bn1 2>&1 | head -20",
        "uptime":            "uptime && cat /proc/loadavg",
        "df":                "df -h 2>&1",
        // Rev66 / 2.0.4: `pypilot --version` starts the full pypilot
        // process and never exits cleanly on TinyCore + pypilot 2021 -
        // every click of this preset left a python zombie holding I2C
        // and TCP resources. Wrap with `timeout 3` so the exec is killed
        // after 3 s, then fall back to reading the packaged version
        // file. Also `python3 -c 'import pypilot; print(pypilot.__version__)'`
        // as belt-and-braces.
        "pypilot.version":   "timeout 3 python3 -c 'import pypilot; print(getattr(pypilot, \"__version__\", \"n/a\"))' 2>/dev/null || (test -d /tmp/tcloop/pypilot && ls -1 /tmp/tcloop/pypilot/usr/local/lib/python3.8/site-packages/pypilot*/version* 2>/dev/null | head -1 | xargs -I{} cat {} 2>/dev/null) || (test -f /tmp/tcloop/pypilot/usr/local/lib/python3.8/site-packages/pypilot/dist_data/version.py && cat /tmp/tcloop/pypilot/usr/local/lib/python3.8/site-packages/pypilot/dist_data/version.py) || (find /usr/local/lib/python3.8/site-packages -maxdepth 2 -name 'pypilot*.dist-info' 2>/dev/null | head -1) || echo 'unknown'",
        // Rev66 / 2.0.4: piCore uses runit, not systemd. `sudo sv
        // restart /etc/sv/pypilot_web` is the correct clean-restart
        // primitive - it TERMs the child, waits, then supervise brings
        // it back up. Scoped to the web unit so the AP core keeps
        // steering. Kept as an advanced preset in the Debug console
        // (the Emergency triad simplified to 2 levels: RESTART pypilot
        // + reboot Pi).
        "restart.web":       "sudo sv restart /etc/sv/pypilot_web 2>&1 && echo OK",
        "reboot.pi":         "sudo reboot",
        // Rev113 / Rev114 (Carlos feedback on piCore + BusyBox): all
        // extras now have BusyBox-safe fallbacks. TinyCore ships busybox
        // free/ifconfig/iw and lacks ip/iwconfig/vcgencmd/journalctl.
        "free":              "free 2>&1",
        "ps.pypilot":        "ps -ef 2>&1 | grep -E 'pypilot|python' | grep -v grep",
        "ip":                "(ip -brief a 2>/dev/null || ifconfig 2>&1) && echo && (ip route 2>/dev/null || route -n 2>&1)",
        "iwconfig":          "(iwconfig 2>/dev/null || iw dev 2>/dev/null || echo 'no wireless tools on this host')",
        "temp":              "(vcgencmd measure_temp 2>/dev/null || (test -r /sys/class/thermal/thermal_zone0/temp && awk '{printf \"CPU %.1f C\\n\", $1/1000}' /sys/class/thermal/thermal_zone0/temp) || echo 'no thermal sensor')",
        "who":               "who 2>&1 && echo && (last -H 2>/dev/null | head -6 || echo 'last not available')",
      };
      // Rev113: extracted SSH helper - runs one shell command via the
      // saved SSH credentials, with a 30 s hard timeout, and returns
      // { ok, stdout, code, elapsedMs }. Used by both /debug-cmd (with
      // whitelisted presets) and /ssh-exec (with the user's own
      // command from the interactive console).
      async function _runSsh(cmd: string, timeoutMs: number = 30000):
        Promise<{ ok: boolean; stdout: string; code?: number; elapsedMs: number; error?: string }>
      {
        const sshUser = props.sshUser || "tc";
        const sshPassword = props.sshPassword || "";
        if (!sshPassword) {
          return { ok: false, stdout: "", elapsedMs: 0, error: "SSH password not set" };
        }
        const t0 = Date.now();
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { Client } = require("ssh2");
          const conn = new Client();
          const result = await new Promise<{ ok: boolean; stdout: string; code?: number }>((resolve) => {
            let settled = false;
            const finish = (r: { ok: boolean; stdout: string; code?: number }) => {
              if (settled) return;
              settled = true;
              try { conn.end(); } catch {}
              resolve(r);
            };
            const killTimer = setTimeout(() => finish({ ok: false, stdout: `timeout ${timeoutMs}ms` }), timeoutMs);
            conn.on("ready", () => {
              conn.exec(cmd, { pty: true }, (err: any, stream: any) => {
                if (err) { clearTimeout(killTimer); finish({ ok: false, stdout: err.message }); return; }
                let out = "";
                stream.on("close", (code: number) => { clearTimeout(killTimer); finish({ ok: code === 0, stdout: out, code }); });
                stream.on("data", (data: Buffer) => { out += data.toString(); });
                stream.stderr.on("data", (data: Buffer) => { out += data.toString(); });
                setTimeout(() => { try { stream.write(sshPassword + "\n"); } catch {} }, 300);
              });
            });
            conn.on("error", (err: any) => { clearTimeout(killTimer); finish({ ok: false, stdout: `ssh: ${err?.message || err}` }); });
            conn.on("timeout", () => { clearTimeout(killTimer); finish({ ok: false, stdout: "ssh timeout" }); });
            try {
              conn.connect({
                host: props.host, port: 22,
                username: sshUser, password: sshPassword,
                readyTimeout: 8000, tryKeyboard: true,
              });
              conn.on("keyboard-interactive", (_n: any, _i: any, _l: any, _p: any, finish2: any) => {
                finish2([sshPassword]);
              });
            } catch (e: any) { clearTimeout(killTimer); finish({ ok: false, stdout: e?.message || String(e) }); }
          });
          return { ...result, elapsedMs: Date.now() - t0 };
        } catch (e: any) {
          return { ok: false, stdout: e?.message || String(e), elapsedMs: Date.now() - t0, error: "ssh_setup_failed" };
        }
      }

      // ============================================================
      // Rev138 (Carlos): Pi Zero log capture
      // ============================================================
      // piCore keeps /var/log entirely in tmpfs, so the moment we hard
      // reset the Pi Zero we lose every log line from the previous
      // session. This module polls the TinyPilot via SSH, tails the
      // pypilot / pypilot_web / pypilot_hat logs, dedupes the lines
      // it already saved, and appends the new ones to a daily file
      // in this plugin's data directory (persistent on the Pi 5).
      const LOG_CAPTURE_SOURCES = [
        "/var/log/pypilot/current",
        "/var/log/pypilot_web/current",
        "/var/log/pypilot_hat/current",
      ];
      function _lcHash(s: string): string {
        // FNV-1a 32-bit - short and stable, no crypto needed.
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i += 1) {
          h ^= s.charCodeAt(i);
          h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h.toString(16);
      }
      function _lcTodayPath(): string {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require("path");
        const dir = path.join(app.getDataDirPath ? app.getDataDirPath() : ".", "pizero-logs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return path.join(dir, `pizero-${yyyy}${mm}${dd}.log`);
      }
      async function _lcTick(): Promise<void> {
        try {
          if (!props.host || !(props.sshPassword && props.sshPassword.length)) {
            logCaptureLastError = "SSH not configured";
            return;
          }
          const marker = "===LC:SRC===";
          const cmd = LOG_CAPTURE_SOURCES.map(
            (p) => `echo "${marker}${p}"; tail -n 500 ${p} 2>/dev/null || echo "(missing)"`
          ).join("; ");
          const r = await _runSsh(cmd, 15000);
          if (!r.ok) {
            logCaptureLastError = `ssh failed: ${r.stdout.slice(0, 200)}`;
            return;
          }
          const chunks: Record<string, string[]> = {};
          let currentSrc = "";
          for (const raw of r.stdout.split("\n")) {
            const line = raw.replace(/\r$/, "");
            if (line.startsWith(marker)) {
              currentSrc = line.substring(marker.length).trim();
              chunks[currentSrc] = [];
              continue;
            }
            if (currentSrc) chunks[currentSrc].push(line);
          }
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require("fs");
          let appended = 0;
          const outFile = _lcTodayPath();
          const newLines: string[] = [];
          for (const src of Object.keys(chunks)) {
            const lines = chunks[src].filter((l) => l && l !== "(missing)");
            if (lines.length === 0) continue;
            const lastHash = logCaptureLastLineHash[src];
            let startIdx = 0;
            if (lastHash) {
              // Find lastHash in the freshly tailed chunk; anything
              // after it is new. If not found, log rotated or was
              // truncated -> take everything.
              for (let i = lines.length - 1; i >= 0; i -= 1) {
                if (_lcHash(lines[i]) === lastHash) { startIdx = i + 1; break; }
                if (i === 0) startIdx = 0;
              }
            }
            const fresh = lines.slice(startIdx);
            if (fresh.length === 0) continue;
            // Rev149 (Carlos): tag each line with the parent directory
            // instead of the file basename. All three logs are named
            // "current" (svlogd convention) so the previous prefix
            // showed [current] for everything - useless when reviewing
            // the aggregated file. Now: [pypilot], [pypilot_web],
            // [pypilot_hat].
            const parts = src.split("/");
            const tag = parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || "log");
            for (const l of fresh) newLines.push(`[${tag}] ${l}`);
            logCaptureLastLineHash[src] = _lcHash(lines[lines.length - 1]);
          }
          if (newLines.length > 0) {
            const payload = newLines.join("\n") + "\n";
            fs.appendFileSync(outFile, payload);
            appended = Buffer.byteLength(payload, "utf8");
            logCaptureTailBuffer.push(...newLines);
            if (logCaptureTailBuffer.length > LOG_CAPTURE_TAIL_MAX) {
              logCaptureTailBuffer = logCaptureTailBuffer.slice(-LOG_CAPTURE_TAIL_MAX);
            }
          }
          logCaptureLastRunTs = Date.now();
          logCaptureLastAppendedBytes = appended;
          logCaptureLastError = null;
          // Rev176 (Carlos): persist the per-source lastHash map every
          // successful poll so a plugin restart resumes from the same
          // cursor instead of re-injecting the entire tail.
          _lcSaveState();
        } catch (e: any) {
          logCaptureLastError = e?.message || String(e);
        }
      }
      function _lcStart(): void {
        if (logCaptureTimer) return;
        // Rev176 (Carlos): restore the persisted dedupe cursors first so
        // the first tick after a restart already knows where the last
        // run left off.
        _lcLoadState();
        const intervalSec = Math.max(30, Number(props.logCaptureIntervalSec) || 60);
        // Fire once immediately (best-effort) then on a cadence.
        _lcTick().catch(() => {});
        logCaptureTimer = setInterval(() => { _lcTick().catch(() => {}); }, intervalSec * 1000);
        app.debug?.(`[log-capture] started (interval ${intervalSec}s)`);
      }
      function _lcStop(): void {
        if (!logCaptureTimer) return;
        clearInterval(logCaptureTimer);
        logCaptureTimer = null;
        app.debug?.("[log-capture] stopped");
      }
      // Auto-start on plugin boot if config says so.
      if (props.logCaptureEnabled) _lcStart();

      // Rev164-166: supervisor status. Visor uses this to render the
      // "smart pilot" card so the skipper can see WHY the plugin
      // acted (or did not act).
      router.get("/supervisor/status", (_req: any, res: any) => {
        res.json({
          autoProfile: {
            enabled: !!props.autoProfileEnabled,
            currentBand: _autoProfileCurrentBand,
            pendingBand: _autoProfilePendingBand,
            pendingForSec: _autoProfilePendingSince ? Math.floor((Date.now() - _autoProfilePendingSince) / 1000) : null,
            stableThresholdSec: Math.floor(AUTO_PROFILE_BAND_STABLE_MS / 1000),
            lastSwitchTs: _autoProfileLastSwitchTs,
            lastReason: _autoProfileLastReason,
            profiles: {
              light: props.autoProfileLight || "",
              medium: props.autoProfileMedium || "",
              heavy: props.autoProfileHeavy || "",
            },
            twsThresholdsKn: { light: AUTO_PROFILE_TWS_MED_KN, heavy: AUTO_PROFILE_TWS_HEAVY_KN },
          },
          // Rev167: legacy field kept for compat with any KIP widget
          // that read it under the old name. Prefer the "gust" block
          // below for the full strategy state.
          gustDetector: {
            enabled: (props.gustStrategy ?? "off") !== "off",
            windowSec: Math.floor(GUST_WINDOW_MS / 1000),
            minJumpKn: GUST_MIN_JUMP_KN,
            lastAlertTs: _gustLastAlertTs || null,
          },
          autoDisengage: {
            enabled: !!props.autoDisengageOnLostAuthority,
            rmsThresholdDeg: AUTHORITY_LOST_RMS_DEG,
            dutyThreshold: AUTHORITY_LOST_DUTY_MIN,
            sustainSec: Math.floor(AUTHORITY_LOST_SUSTAIN_MS / 1000),
            currentlyLostSinceSec: _authorityLostSinceMs ? Math.floor((Date.now() - _authorityLostSinceMs) / 1000) : null,
            lastAutoDisengageTs: _authorityLastAutoDisengageTs,
          },
          // Rev167: gust strategy runtime state.
          gust: {
            strategy: props.gustStrategy ?? "off",
            lastAlertTs: _gustLastAlertTs || null,
            // Rev283: observability of the heel-confirm gate.
            lastSuppressedTs: _gustLastSuppressedTs,
            lastSuppressReason: _gustLastSuppressReason,
            heelConfirmDeg: GUST_HEEL_CONFIRM_DEG,
            freezeActive: _gustFreezeUntilMs != null,
            freezeRemainingSec: _gustFreezeUntilMs ? Math.max(0, Math.floor((_gustFreezeUntilMs - Date.now()) / 1000)) : null,
            boostActive: _gustBoostUntilMs != null,
            boostRemainingSec: _gustBoostUntilMs ? Math.max(0, Math.floor((_gustBoostUntilMs - Date.now()) / 1000)) : null,
            heavyActive: _gustHeavyUntilMs != null,
            heavyRemainingSec: _gustHeavyUntilMs ? Math.max(0, Math.floor((_gustHeavyUntilMs - Date.now()) / 1000)) : null,
          },
        });
      });

      // Rev167: config read + write for the Smart Pilot card. All the
      // toggles live in the visor, not in the SK Admin schema. Writes
      // go through app.savePluginOptions so they survive restart.
      router.get("/supervisor/config", (_req: any, res: any) => {
        res.json({
          autoProfileEnabled: !!props.autoProfileEnabled,
          autoProfileLight:  props.autoProfileLight  || "",
          autoProfileMedium: props.autoProfileMedium || "",
          autoProfileHeavy:  props.autoProfileHeavy  || "",
          gustStrategy: props.gustStrategy ?? "off",
          autoDisengageOnLostAuthority: !!props.autoDisengageOnLostAuthority,
          rollFfGain: props.rollFfGain ?? 0,
          rollFfTauSec: props.rollFfTauSec ?? 3,
          rollFfTwaGateDeg: props.rollFfTwaGateDeg ?? 90,
          leewayAdjustment: props.leewayAdjustment ?? 0,
          failSafeBspKn: props.failSafeBspKn ?? 0,
          bspSource: _lastBspSource,
          tackCatchupDeg: props.tackCatchupDeg ?? 0,
          tackCatchupTauSec: props.tackCatchupTauSec ?? 6,
          tackCatchupActive: tackCatchup ? tackCatchup.isActive() : false,
          // Rev299: null = legacy (every rule on defaultEnabled), otherwise
          // the exact user selection. `describe()` lets the visor render
          // the toggle list without an extra request.
          alarmsEnabled: props.alarmsEnabled ?? null,
          alarmSeverityOverrides: props.alarmSeverityOverrides ?? {},
          alarmsAvailable: alarms ? alarms.describe() : [],
          profileAdvisorEnabled: props.profileAdvisorEnabled !== false,
          profileAdvisorRmsHighDeg: props.profileAdvisorRmsHighDeg ?? 10,
          profileAdvisorRmsLowDeg: props.profileAdvisorRmsLowDeg ?? 1,
          profileAdvisorSustainSec: props.profileAdvisorSustainSec ?? 60,
          alarmLowVoltageV: props.alarmLowVoltageV ?? 11.0,
          alarmServoTempC: props.alarmServoTempC ?? 60,
          alarmServoMotorTempC: props.alarmServoMotorTempC ?? 70,
          alarmPypilotDiscSec: props.alarmPypilotDiscSec ?? 15,
          apbSource: props.apbSource ?? "auto",
        });
      });
      router.post("/supervisor/config", (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const b = req.body || {};
        const patch: Partial<PluginProps> = {};
        if (typeof b.autoProfileEnabled === "boolean") patch.autoProfileEnabled = b.autoProfileEnabled;
        if (typeof b.autoProfileLight  === "string") patch.autoProfileLight  = b.autoProfileLight.trim();
        if (typeof b.autoProfileMedium === "string") patch.autoProfileMedium = b.autoProfileMedium.trim();
        if (typeof b.autoProfileHeavy  === "string") patch.autoProfileHeavy  = b.autoProfileHeavy.trim();
        if (["off","warn","freeze-target","boost-D","temp-heavy"].includes(b.gustStrategy)) {
          patch.gustStrategy = b.gustStrategy;
        }
        if (typeof b.autoDisengageOnLostAuthority === "boolean") {
          patch.autoDisengageOnLostAuthority = b.autoDisengageOnLostAuthority;
        }
        // Rev282: Roll FF live-tunable knobs. Clamped in normalizeProps
        // on plugin restart; also clamped here to keep an out-of-range
        // POST from taking hold.
        if (typeof b.rollFfGain === "number") {
          patch.rollFfGain = clampNumber(b.rollFfGain, 0, 2, 0);
        }
        if (typeof b.rollFfTauSec === "number") {
          patch.rollFfTauSec = clampNumber(b.rollFfTauSec, 0.5, 30, 3);
        }
        if (typeof b.rollFfTwaGateDeg === "number") {
          patch.rollFfTwaGateDeg = clampNumber(b.rollFfTwaGateDeg, 30, 179, 90);
        }
        // Rev298 (H4): leeway adjustment. Clamped 0..30; 0 = disabled.
        if (typeof b.leewayAdjustment === "number") {
          patch.leewayAdjustment = clampNumber(b.leewayAdjustment, 0, 30, 0);
        }
        // Rev299 (H2): failsafe boat speed. Clamped 0..15 kn; 0 = disabled.
        if (typeof b.failSafeBspKn === "number") {
          patch.failSafeBspKn = clampNumber(b.failSafeBspKn, 0, 15, 0);
        }
        // Rev299 (I2): tack catch-up knobs.
        if (typeof b.tackCatchupDeg === "number") {
          patch.tackCatchupDeg = clampNumber(b.tackCatchupDeg, 0, 15, 0);
        }
        if (typeof b.tackCatchupTauSec === "number") {
          patch.tackCatchupTauSec = clampNumber(b.tackCatchupTauSec, 1, 15, 6);
        }
        // Rev299: per-rule alarm enable list. Explicit array (including
        // empty) is what the visor sends; null resets to legacy defaults.
        let alarmsEnabledTouched = false;
        if (Array.isArray(b.alarmsEnabled)) {
          patch.alarmsEnabled = b.alarmsEnabled.filter((s: unknown): s is string => typeof s === "string");
          alarmsEnabledTouched = true;
        } else if (b.alarmsEnabled === null) {
          patch.alarmsEnabled = undefined;
          alarmsEnabledTouched = true;
        }
        // Rev286 (B2) knobs.
        if (typeof b.profileAdvisorEnabled === "boolean") {
          patch.profileAdvisorEnabled = b.profileAdvisorEnabled;
        }
        if (typeof b.profileAdvisorRmsHighDeg === "number") {
          patch.profileAdvisorRmsHighDeg = clampNumber(b.profileAdvisorRmsHighDeg, 3, 45, 10);
        }
        if (typeof b.profileAdvisorRmsLowDeg === "number") {
          patch.profileAdvisorRmsLowDeg = clampNumber(b.profileAdvisorRmsLowDeg, 0.1, 5, 1);
        }
        if (typeof b.profileAdvisorSustainSec === "number") {
          patch.profileAdvisorSustainSec = clampNumber(b.profileAdvisorSustainSec, 15, 600, 60);
        }
        // Rev290 (E2/E3) knobs.
        if (typeof b.alarmLowVoltageV === "number") {
          patch.alarmLowVoltageV = clampNumber(b.alarmLowVoltageV, 8, 14, 11.0);
        }
        if (typeof b.alarmServoTempC === "number") {
          patch.alarmServoTempC = clampNumber(b.alarmServoTempC, 40, 85, 60);
        }
        if (typeof b.alarmServoMotorTempC === "number") {
          patch.alarmServoMotorTempC = clampNumber(b.alarmServoMotorTempC, 40, 90, 70);
        }
        if (typeof b.alarmPypilotDiscSec === "number") {
          patch.alarmPypilotDiscSec = clampNumber(b.alarmPypilotDiscSec, 3, 300, 15);
        }
        // Rev291 (F1): APB source preference (read-only side, no
        // pypilot write yet).
        if (isApbSource(b.apbSource)) {
          patch.apbSource = b.apbSource;
        }
        Object.assign(props, patch);
        // Rev292 (bug A): hot-apply the pypilot-disconnect sustain
        // window so the sailor sees the change without a plugin restart.
        if (typeof patch.alarmPypilotDiscSec === "number" && alarms) {
          try { alarms.setRuleSustain("pypilot-disconnected", patch.alarmPypilotDiscSec); }
          catch { /* silent */ }
        }
        // Rev282: hot-apply Roll FF options so the sailor sees the
        // effect on the sample tick without a plugin restart.
        if (rollFf && (patch.rollFfGain !== undefined || patch.rollFfTauSec !== undefined || patch.rollFfTwaGateDeg !== undefined)) {
          try {
            rollFf.update({
              gain: props.rollFfGain ?? 0,
              tauSec: props.rollFfTauSec ?? 3,
              twaGateDeg: props.rollFfTwaGateDeg ?? 90,
            });
          } catch { /* silent */ }
        }
        // Rev298 (H4): hot-apply leeway adjustment.
        if (leewayEst && patch.leewayAdjustment !== undefined) {
          try { leewayEst.update({ adj: props.leewayAdjustment ?? 0 }); }
          catch { /* silent */ }
        }
        // Rev299 (H2): hot-apply failsafe BSP.
        if (bspResolver && patch.failSafeBspKn !== undefined) {
          try { bspResolver.update({ failSafeBspKn: props.failSafeBspKn ?? 0 }); }
          catch { /* silent */ }
        }
        // Rev299 (I2): hot-apply tack catch-up.
        if (tackCatchup && (patch.tackCatchupDeg !== undefined || patch.tackCatchupTauSec !== undefined)) {
          try {
            tackCatchup.update({
              offsetDeg: props.tackCatchupDeg ?? 0,
              tauSec: props.tackCatchupTauSec ?? 6,
            });
          } catch { /* silent */ }
        }
        // Rev299: hot-apply per-rule alarm enable list. `alarmsEnabledTouched`
        // covers the null-to-legacy reset case where `patch.alarmsEnabled`
        // is intentionally undefined.
        if (alarms && alarmsEnabledTouched) {
          try { applyAlarmsEnabled(props.alarmsEnabled); } catch { /* silent */ }
        }
        // Rev286 (B2): hot-apply advisor thresholds; also reset its
        // sustain timers if the sailor disabled the feature outright,
        // so a later re-enable starts clean.
        if (profileAdvisor && (
          patch.profileAdvisorRmsHighDeg !== undefined ||
          patch.profileAdvisorRmsLowDeg !== undefined ||
          patch.profileAdvisorSustainSec !== undefined ||
          patch.profileAdvisorEnabled !== undefined
        )) {
          try {
            profileAdvisor.update({
              rmsHighDeg: props.profileAdvisorRmsHighDeg ?? 10,
              rmsLowDeg:  props.profileAdvisorRmsLowDeg  ?? 1,
              sustainSec: props.profileAdvisorSustainSec ?? 60,
            });
            if (patch.profileAdvisorEnabled === false) {
              profileAdvisor.reset();
              publishProfileAdvisorNormal();
            }
          } catch { /* silent */ }
        }
        try {
          app.savePluginOptions?.(props, () => { /* noop */ });
        } catch (e: any) {
          return res.status(500).json({ error: e?.message || String(e) });
        }
        res.json({ ok: true, applied: patch });
      });

      // Rev291 (F1): APB target preview. Reads the current SK course
      // data via app.getCourse and returns what the AP *would* steer to
      // if the plugin drove NAV directly. Diagnostic only — pypilot's
      // own nav mode is still the one commanding the pilot.
      router.get("/nav/apb-preview", async (_req: any, res: any) => {
        try {
          const cdata = (app.getCourse ? await app.getCourse() : null) as CourseData | null;
          const pref: ApbSource = (props.apbSource as ApbSource) || "auto";
          const target = computeApbTarget(cdata, pref);
          const divergence = apbDivergence(cdata);
          const targetDeg = target.targetRad != null
            ? (target.targetRad * 180 / Math.PI + 360) % 360
            : null;
          res.json({
            preference: pref,
            hasWaypoint: !!cdata?.nextPoint,
            target: {
              rad: target.targetRad,
              deg: targetDeg,
              source: target.source,
              fallback: target.fallback,
            },
            xteM: target.xteM,
            distanceM: target.distanceM,
            divergence: {
              bothPresent: divergence.bothPresent,
              rad: divergence.divergenceRad,
              deg: divergence.divergenceRad != null ? divergence.divergenceRad * 180 / Math.PI : null,
            },
            appliedToAp: false,
            note: "This value is computed and displayed but NOT written to pypilot. The pilot's own nav mode remains the authoritative source.",
          });
        } catch (e: any) {
          res.status(500).json({ error: String(e?.message || e) });
        }
      });

      // Rev296 (Carlos, navigating - bug D): audit trail of profile
      // switches. Answers "who cargó default?" — shows the last N
      // changes with source attribution (user / auto-profile /
      // gust-heavy / doctor / external / etc).
      router.get("/profile-change-log", (_req: any, res: any) => {
        res.json({
          current: profileChangeLog.current(),
          summary: profileChangeLog.summary(),
          entries: profileChangeLog.entries(),
        });
      });

      // Rev289 (B5): profile metadata store.
      //   GET    /profiles/metadata          - full map + activePilot + availablePilots + CONDITIONS
      //   PUT    /profiles/metadata/:name    - upsert one entry {condition?, notes?}
      //   DELETE /profiles/metadata/:name    - remove one entry
      router.get("/profiles/metadata", (_req: any, res: any) => {
        const store = props.profileMetadata ?? {};
        let activePilot: string | null = null;
        const pilots = new Set<string>();
        if (client) {
          const values = client.getValues();
          activePilot = typeof values["ap.pilot"] === "string" ? String(values["ap.pilot"]) : null;
          for (const k of Object.keys(client.getCatalog())) {
            const m = /^ap\.pilots\.([^.]+)\./.exec(k);
            if (m) pilots.add(m[1]);
          }
        }
        res.json({
          activePilot,
          availablePilots: Array.from(pilots).sort(),
          metadata: store,
          conditions: PROFILE_CONDITIONS,
        });
      });
      router.put("/profiles/metadata/:name", (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const name = String(req.params?.name || "").trim();
        if (!name) return res.status(400).json({ error: "profile name required in path" });
        const err = pmValidateUpsert(req.body);
        if (err) return res.status(400).json({ error: err });
        const store: ProfileMetadata = props.profileMetadata ?? {};
        const entry = pmUpsert(store, name, req.body || {}, Date.now());
        props.profileMetadata = store;
        try {
          app.savePluginOptions?.(props, () => { /* silent */ });
        } catch (e: any) {
          return res.status(500).json({ error: String(e?.message || e) });
        }
        res.json({ ok: true, name, entry });
      });
      router.delete("/profiles/metadata/:name", (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const name = String(req.params?.name || "").trim();
        if (!name) return res.status(400).json({ error: "profile name required in path" });
        const store: ProfileMetadata = props.profileMetadata ?? {};
        const existed = pmRemove(store, name);
        props.profileMetadata = store;
        try {
          app.savePluginOptions?.(props, () => { /* silent */ });
        } catch (e: any) {
          return res.status(500).json({ error: String(e?.message || e) });
        }
        res.json({ ok: true, name, existed });
      });

      // Rev286 (B2): profile advisor state for the Smart Pilot card.
      router.get("/advisor/status", (_req: any, res: any) => {
        if (!profileAdvisor) { res.status(503).json({ error: "not initialised" }); return; }
        const st = profileAdvisor.status();
        res.json({
          enabled: !!props.profileAdvisorEnabled,
          ...st,
        });
      });

      // Rev283: persistent servo error log (C1).
      //   GET  /servo-error-log         - list every recorded fault (newest last)
      //                                   plus a peak summary of the 30 s
      //                                   pre-fault telemetry window.
      //   POST /servo-error-log/clear   - wipe RAM + delete the JSONL file.
      //                                   Requires allowWrites.
      router.get("/servo-error-log", (_req: any, res: any) => {
        if (!servoErrorLog) { res.status(503).json({ error: "not initialised" }); return; }
        res.json({ entries: servoErrorLog.entries() });
      });
      router.post("/servo-error-log/clear", (_req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        if (!servoErrorLog) return res.status(503).json({ error: "not initialised" });
        servoErrorLog.clear();
        res.json({ ok: true });
      });

      // Rev285 (A1): high-level tuning knobs. Three sliders that map
      // onto pypilot's raw P/I/D/DD via the pure module tuning-knobs.ts.
      //
      //   GET  /tuning/knobs           - describe the currently-active
      //                                  pilot: its id, its available
      //                                  gains from the catalog, and
      //                                  the neutral knob positions.
      //                                  Frontend uses this to prime the
      //                                  panel.
      //   POST /tuning/knobs           - compute (and optionally apply)
      //                                  gains for a given knob triple.
      //                                  Body: {
      //                                    pilotId?: string,
      //                                    baseline: { P,I,D,DD },
      //                                    knobs:    { aggressivity, understeerOversteer, balanceHeadingRate },
      //                                    apply?: boolean (default false)
      //                                  }
      //                                  Response: { computed, applied,
      //                                              applyErrors: string[] }.
      router.get("/tuning/knobs", (_req: any, res: any) => {
        if (!client) { res.status(503).json({ error: "pypilot client not connected" }); return; }
        const values = client.getValues();
        const activePilot = typeof values["ap.pilot"] === "string" ? String(values["ap.pilot"]) : "basic";
        const current: GainSet = {
          P:  numberOr0(values[`ap.pilot.${activePilot}.P`]),
          I:  numberOr0(values[`ap.pilot.${activePilot}.I`]),
          D:  numberOr0(values[`ap.pilot.${activePilot}.D`]),
          DD: numberOr0(values[`ap.pilot.${activePilot}.DD`]),
        };
        // Enumerate available pilots from the catalog (any key
        // ap.pilots.<name> matches). Keeps ordering stable.
        const pilots = new Set<string>();
        for (const k of Object.keys(client.getCatalog())) {
          const m = /^ap\.pilots\.([^.]+)\./.exec(k);
          if (m) pilots.add(m[1]);
        }
        res.json({
          activePilot,
          availablePilots: Array.from(pilots).sort(),
          currentGains: current,
          neutralKnobs: NEUTRAL_KNOBS,
        });
      });
      router.post("/tuning/knobs", (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        if (!client) return res.status(503).json({ error: "pypilot client not connected" });
        const body = req.body || {};
        const knobsErr = validateKnobs(body.knobs);
        if (knobsErr) return res.status(400).json({ error: knobsErr });
        const baseErr = validateBaseline(body.baseline);
        if (baseErr) return res.status(400).json({ error: baseErr });
        const values = client.getValues();
        const activePilot = typeof values["ap.pilot"] === "string" ? String(values["ap.pilot"]) : "basic";
        const pilotId = typeof body.pilotId === "string" && body.pilotId.length > 0
          ? String(body.pilotId) : activePilot;
        const baseline = body.baseline as GainSet;
        const knobs = body.knobs as TuningKnobs;
        const apply = body.apply === true;
        const computed = roundGains(computeGains(baseline, knobs));
        // Guard: refuse to apply if the pilotId is not one we know from
        // the catalog. Otherwise a typo could set values under a bogus
        // path that pypilot silently ignores or, worse, creates.
        const catalog = client.getCatalog();
        const pilotKnown = Object.keys(catalog).some(k => k.startsWith(`ap.pilots.${pilotId}.`));
        if (apply && !pilotKnown) {
          return res.status(400).json({ error: `pilotId '${pilotId}' not present in pypilot catalog`, computed });
        }
        let applied = false;
        const applyErrors: string[] = [];
        if (apply) {
          for (const gainKey of ["P", "I", "D", "DD"] as const) {
            const target = `ap.pilot.${pilotId}.${gainKey}`;
            const value = computed[gainKey];
            try { client.set(target, value); }
            catch (e: any) { applyErrors.push(`${target}: ${e?.message || e}`); }
          }
          applied = applyErrors.length === 0;
        }
        res.json({
          pilotId,
          baseline,
          knobs,
          computed,
          applied,
          applyErrors,
        });
      });

      // Rev282: Roll FF diagnostic snapshot for the visor.
      router.get("/roll-ff/status", (_req: any, res: any) => {
        if (!rollFf) { res.status(503).json({ error: "not initialised" }); return; }
        const st = rollFf.getState();
        const o = rollFf.getOptions();
        res.json({
          gain: o.gain,
          tauSec: o.tauSec,
          twaGateDeg: o.twaGateDeg,
          maxDeltaRad: o.maxDeltaRad,
          rollHpRad: st.rollHpRad,
          hasSample: st.hasSample,
          lastDeltaRad: _lastRollFfDeltaRad,
          appliedToAp: false,
          note: "Delta is computed and published under steering.autopilot.pypilot.tuning.rollFf.* but NOT applied to the pilot yet. Sea trial gates the enable switch.",
        });
      });

      router.get("/log-capture/status", (_req: any, res: any) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        const file = _lcTodayPath();
        let fileSize = 0;
        try { fileSize = fs.statSync(file).size; } catch {}
        res.json({
          enabled: !!logCaptureTimer,
          configured: !!(props.host && props.sshPassword),
          intervalSec: Math.max(30, Number(props.logCaptureIntervalSec) || 60),
          lastRunTs: logCaptureLastRunTs,
          lastAppendedBytes: logCaptureLastAppendedBytes,
          lastError: logCaptureLastError,
          todayFile: file,
          todayFileSize: fileSize,
          bufferedLines: logCaptureTailBuffer.length,
        });
      });
      router.post("/log-capture/start", (_req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        if (!props.sshPassword) return res.status(400).json({ error: "sshPassword not set" });
        _lcStart();
        // Persist opt-in so it survives restarts.
        try {
          props.logCaptureEnabled = true;
          app.savePluginOptions?.(props, () => { /* noop */ });
        } catch {}
        res.json({ ok: true, enabled: true });
      });
      router.post("/log-capture/stop", (_req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        _lcStop();
        try {
          props.logCaptureEnabled = false;
          app.savePluginOptions?.(props, () => { /* noop */ });
        } catch {}
        res.json({ ok: true, enabled: false });
      });
      router.get("/log-capture/tail", (req: any, res: any) => {
        const n = Math.max(1, Math.min(LOG_CAPTURE_TAIL_MAX, Number(req.query?.lines) || 200));
        const lines = logCaptureTailBuffer.slice(-n);
        res.type("text/plain").send(lines.join("\n"));
      });
      router.get("/log-capture/download", (_req: any, res: any) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require("path");
        const file = _lcTodayPath();
        if (!fs.existsSync(file)) {
          res.type("text/plain").send("(no data yet)");
          return;
        }
        res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file)}"`);
        res.type("text/plain").sendFile(file);
      });

      // ============================================================
      // Rev143 (Carlos): navigation session recorder endpoints
      // ============================================================
      // Session state (running / tags / sample count) + read of the
      // archived JSONL files. Downloads go straight to the user; the
      // idea is they email/WhatsApp them to the maintainer, who runs
      // an offline AI analysis and hands back an "advice" JSON that
      // the visor then displays under a "Consejos recibidos" panel.
      router.get("/session-recorder/status", (_req: any, res: any) => {
        res.json({
          enabled: !!props.sessionRecorderEnabled,
          recording: sessionRecorder ? sessionRecorder.isRecording() : false,
          sessionId: sessionRecorder ? sessionRecorder.currentSessionId() : null,
          startTs: sessionRecorder ? sessionRecorder.currentStartTs() : null,
          samples: sessionRecorder ? sessionRecorder.currentSampleCount() : 0,
          tags: sessionRecorder ? sessionRecorder.currentTags() : {},
          // Rev176 (Carlos): expose the debounce counters so the
          // diagnostics page can flag a rogue engage/disengage source.
          bouncesFiltered: _engagedBouncesFiltered,
          lastBounceMs: _engagedLastFilteredMs || null,
          lastBounceDetails: _engagedLastFilteredDetails,
        });
      });

      // ==== Rev322 (Carlos, 2026-09-27): Maneuver Trace Log ====
      // Sailor toggles it from the visor Setup card during sea trial.
      // The visor POSTs one event per user action; we snapshot pypilot
      // state right then AND again 300 ms later so a forensic pass can
      // see whether the AP obeyed. Ring buffer + JSONL to disk.
      router.get("/maneuver-trace/status", (_req: any, res: any) => {
        if (!maneuverTrace) { res.status(503).json({ error: "not initialised" }); return; }
        res.json(maneuverTrace.status());
      });
      router.post("/maneuver-trace/start", (_req: any, res: any) => {
        if (!maneuverTrace) return res.status(503).json({ error: "not initialised" });
        maneuverTrace.start();
        // Persist opt-in so the trace survives a plugin restart during
        // the sea trial (writing options triggers a plugin reload, so
        // do it after start() to avoid the current instance vanishing
        // mid-request).
        try {
          props.maneuverTraceEnabled = true;
          app.savePluginOptions?.(props, () => { /* noop */ });
        } catch {}
        res.json({ ok: true, ...maneuverTrace.status() });
      });
      router.post("/maneuver-trace/stop", (_req: any, res: any) => {
        if (!maneuverTrace) return res.status(503).json({ error: "not initialised" });
        maneuverTrace.stop();
        try {
          props.maneuverTraceEnabled = false;
          app.savePluginOptions?.(props, () => { /* noop */ });
        } catch {}
        res.json({ ok: true, ...maneuverTrace.status() });
      });
      router.get("/maneuver-trace/tail", (req: any, res: any) => {
        if (!maneuverTrace) return res.status(503).json({ error: "not initialised" });
        const n = Math.max(1, Math.min(500, Number(req.query?.n) || 100));
        res.json({ entries: maneuverTrace.tail(n) });
      });
      // Rev323 (Carlos, 2026-09-27): visor-side pseudo-modo gate for
      // heading-deviation / cruise-drift / unable-to-steer. Visor
      // POSTs {active:true} on aproadoExecute / empopadoExecute and
      // {active:false} on their teardowns. Independent of trace log.
      router.get("/maneuver-state", (_req: any, res: any) => {
        res.json({ pseudoActive: _maneuverPseudoActive });
      });
      router.post("/maneuver-state", (req: any, res: any) => {
        const body = req.body || {};
        if (typeof body.active === "boolean") {
          _maneuverPseudoActive = body.active;
        }
        res.json({ ok: true, pseudoActive: _maneuverPseudoActive });
      });
      router.post("/maneuver-trace/event", (req: any, res: any) => {
        if (!maneuverTrace) return res.status(503).json({ error: "not initialised" });
        const body = req.body || {};
        const kind = String(body.kind || "").trim() as ManeuverEventKind;
        const validKinds: ManeuverEventKind[] = [
          "aproado_start", "aproado_pick", "aproado_teardown",
          "empopado_start", "empopado_pick", "empopado_teardown",
          "tack_tap", "tack_cancel",
          "mode_change", "target_put", "engage", "disengage", "nudge", "other",
        ];
        if (!validKinds.includes(kind)) {
          return res.status(400).json({ error: "unknown kind", kind });
        }
        const payload = (body.payload && typeof body.payload === "object") ? body.payload : {};
        const visorRev = typeof body.visorRev === "string" ? body.visorRev : undefined;
        const pre = _captureManeuverContext();
        const entry = maneuverTrace.record(
          { kind, payload, visorRev },
          pre,
          () => _captureManeuverContext(),
        );
        res.json({ ok: true, ts: entry.ts, kind: entry.kind });
      });
      // Rev176 (Carlos): manual purge endpoint - lets the user clear
      // legacy short-session noise on demand from Setup.
      router.post("/session-recorder/purge-short", (_req: any, res: any) => {
        if (!sessionRecorder) return res.status(503).json({ error: "recorder not initialised" });
        const r = sessionRecorder.pruneShortSessions();
        res.json({ ok: true, ...r });
      });
      router.post("/session-recorder/tags", (req: any, res: any) => {
        if (!sessionRecorder) return res.status(503).json({ error: "recorder not initialised" });
        if (!sessionRecorder.isRecording()) return res.status(400).json({ error: "no active session" });
        const patch: SessionTags = req.body?.tags && typeof req.body.tags === "object" ? req.body.tags : {};
        sessionRecorder.updateTags(patch);
        res.json({ ok: true, tags: sessionRecorder.currentTags() });
      });
      router.get("/session-recorder/list", (_req: any, res: any) => {
        if (!sessionRecorder) return res.status(503).json({ error: "recorder not initialised" });
        const rows = sessionRecorder.list();
        const summaries = rows.map((r) => ({
          id: r.id,
          startTs: r.startTs,
          endTs: r.endTs,
          durationSec: r.endTs && r.startTs ? Math.round((r.endTs - r.startTs) / 1000) : null,
          samples: r.sampleCount,
          tags: r.tags,
          pilot: r.pilot,
          profile: r.profile,
          hasAdvice: _sessionHasAdvice(r.id),
        }));
        res.json({ sessions: summaries });
      });
      router.get("/session-recorder/download/:id", (req: any, res: any) => {
        if (!sessionRecorder) return res.status(503).json({ error: "recorder not initialised" });
        const id = String(req.params.id || "").replace(/[^A-Za-z0-9\-]/g, "");
        if (!id) return res.status(400).json({ error: "bad id" });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        const file = sessionRecorder.fileFor(id);
        if (!fs.existsSync(file)) return res.status(404).json({ error: "not found" });
        res.setHeader("Content-Disposition", `attachment; filename="session-${id}.jsonl"`);
        res.type("application/x-ndjson").sendFile(file);
      });
      router.delete("/session-recorder/session/:id", (req: any, res: any) => {
        if (!sessionRecorder) return res.status(503).json({ error: "recorder not initialised" });
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const id = String(req.params.id || "").replace(/[^A-Za-z0-9\-]/g, "");
        const ok = sessionRecorder.deleteSession(id);
        // Also drop advice tied to this session if present.
        try { _sessionDeleteAdvice(id); } catch { /* silent */ }
        res.json({ ok });
      });

      // ============================================================
      // Rev178 (Carlos): trip recorder endpoints
      // ============================================================
      router.get("/trip-recorder/status", (_req: any, res: any) => {
        res.json({
          // Rev328: expose the master enable so the visor toggle stays
          // in sync across devices.
          enabled: props.tripRecorderEnabled !== false,
          recording: tripRecorder ? tripRecorder.isRecording() : false,
          tripId: tripRecorder ? tripRecorder.currentTripId() : null,
          startTs: tripRecorder ? tripRecorder.currentStartTs() : null,
          samples: tripRecorder ? tripRecorder.currentSampleCount() : 0,
          navState: lastNavState,
        });
      });
      // Rev328 (Carlos, 2026-09-28): master enable/disable from the
      // visor. Persists via savePluginOptions so it survives restarts.
      router.post("/trip-recorder/enable", (req: any, res: any) => {
        const body = req.body || {};
        if (typeof body.enabled !== "boolean") {
          return res.status(400).json({ error: "enabled (boolean) required" });
        }
        props.tripRecorderEnabled = body.enabled;
        try {
          app.savePluginOptions?.(props, () => { /* noop */ });
        } catch (e: any) {
          return res.status(500).json({ error: String(e?.message || e) });
        }
        res.json({ ok: true, enabled: props.tripRecorderEnabled });
      });
      router.get("/trip-recorder/list", (_req: any, res: any) => {
        if (!tripRecorder) return res.status(503).json({ error: "recorder not initialised" });
        // Return list + attach summary for each so the visor can render
        // the card grid with one call.
        const rows = tripRecorder.list().map((r) => ({
          ...r,
          summary: tripRecorder!.summary(r.id),
        }));
        res.json({ trips: rows });
      });
      router.get("/trip-recorder/summary/:id", (req: any, res: any) => {
        if (!tripRecorder) return res.status(503).json({ error: "recorder not initialised" });
        const id = String(req.params.id || "").replace(/[^A-Za-z0-9\-]/g, "");
        const sum = tripRecorder.summary(id);
        if (!sum) return res.status(404).json({ error: "not found" });
        // Rev327 (Carlos, 2026-09-28): attach the friendly name if the
        // sailor set one via /trip-recorder/trip/:id/name.
        res.json({ ...sum, name: tripRecorder.getName(id) });
      });
      // Rev327 (Carlos, 2026-09-28): rename a trip. Sidecar file
      // trip-<id>.name.txt keeps the friendly name out of the JSONL
      // so summaries never get regenerated on a rename.
      router.patch("/trip-recorder/trip/:id/name", (req: any, res: any) => {
        if (!tripRecorder) return res.status(503).json({ error: "recorder not initialised" });
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const id = String(req.params.id || "").replace(/[^A-Za-z0-9\-]/g, "");
        const body = req.body || {};
        const name = typeof body.name === "string" ? body.name : "";
        const r = tripRecorder.renameTrip(id, name);
        if (!r.ok) return res.status(500).json({ error: r.error || "rename failed" });
        res.json({ ok: true, id, name: r.name });
      });
      router.get("/trip-recorder/download/:id", (req: any, res: any) => {
        if (!tripRecorder) return res.status(503).json({ error: "recorder not initialised" });
        const id = String(req.params.id || "").replace(/[^A-Za-z0-9\-]/g, "");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        const file = tripRecorder.jsonlPath(id);
        if (!fs.existsSync(file)) return res.status(404).json({ error: "not found" });
        res.setHeader("Content-Disposition", `attachment; filename="trip-${id}.jsonl"`);
        res.type("application/x-ndjson").sendFile(file);
      });
      router.delete("/trip-recorder/trip/:id", (req: any, res: any) => {
        if (!tripRecorder) return res.status(503).json({ error: "recorder not initialised" });
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const id = String(req.params.id || "").replace(/[^A-Za-z0-9\-]/g, "");
        const ok = tripRecorder.deleteTrip(id);
        res.json({ ok });
      });
      // Advice files land here from an off-boat analysis. The visor
      // fetches them under /session-recorder/advice to render the
      // "Consejos recibidos" list.
      function _sessionAdviceDir(): string {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const p = require("path");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs2 = require("fs");
        const dir = p.join((app.getDataDirPath ? app.getDataDirPath() : "."), "session-advice");
        try { fs2.mkdirSync(dir, { recursive: true }); } catch {}
        return dir;
      }
      function _sessionHasAdvice(id: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs2 = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const p = require("path");
        try { return fs2.existsSync(p.join(_sessionAdviceDir(), `advice-${id}.json`)); } catch { return false; }
      }
      function _sessionDeleteAdvice(id: string): void {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs2 = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const p = require("path");
        try { fs2.unlinkSync(p.join(_sessionAdviceDir(), `advice-${id}.json`)); } catch {}
      }
      router.get("/session-recorder/advice", (_req: any, res: any) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs2 = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const p = require("path");
        const dir = _sessionAdviceDir();
        const out: any[] = [];
        try {
          const files = fs2.readdirSync(dir).filter((f: string) => f.startsWith("advice-") && f.endsWith(".json"));
          for (const f of files) {
            try {
              const raw = fs2.readFileSync(p.join(dir, f), "utf8");
              const j = JSON.parse(raw);
              j.__file = f;
              out.push(j);
            } catch { /* skip corrupt */ }
          }
        } catch { /* empty dir */ }
        out.sort((a, b) => (b.analyzedAt || 0) - (a.analyzedAt || 0));
        res.json({ advice: out });
      });
      router.post("/session-recorder/advice", (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const body = req.body || {};
        const sessionId = String(body.sessionId || "").replace(/[^A-Za-z0-9\-]/g, "");
        if (!sessionId) return res.status(400).json({ error: "sessionId required" });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs2 = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const p = require("path");
        try {
          const payload = { ...body, sessionId, analyzedAt: body.analyzedAt || Date.now() };
          fs2.writeFileSync(p.join(_sessionAdviceDir(), `advice-${sessionId}.json`), JSON.stringify(payload, null, 2));
          res.json({ ok: true });
        } catch (e: any) {
          res.status(500).json({ error: e?.message || String(e) });
        }
      });
      router.post("/session-recorder/advice/:id/helpful", (req: any, res: any) => {
        const id = String(req.params.id || "").replace(/[^A-Za-z0-9\-]/g, "");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs2 = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const p = require("path");
        try {
          const file = p.join(_sessionAdviceDir(), `advice-${id}.json`);
          const j = JSON.parse(fs2.readFileSync(file, "utf8"));
          j.userFeedback = req.body?.feedback || "helpful";
          j.feedbackTs = Date.now();
          fs2.writeFileSync(file, JSON.stringify(j, null, 2));
          res.json({ ok: true });
        } catch (e: any) {
          res.status(500).json({ error: e?.message || String(e) });
        }
      });

      // ============================================================
      // Rev140 (Carlos, following Sean D'Epagnier): dynamic watch focus
      // ============================================================
      // The visor calls /watch/focus when a tab that shows detailed
      // values opens (Tune -> pilot gains, Setup > Calibration ->
      // RangeSettings). The plugin bumps the requested keys to the
      // asked period for at most ttlSec seconds; when the tab
      // closes the sweep timer (5 s cadence) drops them back to their
      // resting rate. Cap keys per request and honour a min period so
      // a runaway client cannot pin pypilot_web.
      router.post("/watch/focus", (req: any, res: any) => {
        const body = req.body || {};
        const keysReq = Array.isArray(body.keys) ? body.keys : [];
        // Rev251 (audit fix 10): scope each focus by owner id so a
        // second visor cannot inadvertently retract our subscriptions.
        // Missing owner => "default" (older visors); still isolated
        // from any owner that DID identify itself.
        const owner = typeof body.owner === "string" && body.owner.length > 0
          ? body.owner.slice(0, 128)
          : "default";
        const period = Math.max(
          WATCH_FOCUS_MIN_PERIOD_S,
          Number(body.periodSec) > 0 ? Number(body.periodSec) : 1
        );
        const ttl = Math.min(
          WATCH_FOCUS_MAX_TTL_S,
          Math.max(5, Number(body.ttlSec) > 0 ? Number(body.ttlSec) : 60)
        );
        const keys: string[] = keysReq
          .filter((k: any) => typeof k === "string" && k.length > 0)
          .slice(0, WATCH_FOCUS_MAX_KEYS);
        // Rev280 (audit T21): purge expired entries BEFORE enforcing
        // the global budget so a wave of expiring old requests does
        // not starve fresh legitimate ones.
        const nowMs = Date.now();
        for (const [k, owners] of _focusWatches.entries()) {
          for (const [ownerId, entry] of owners.entries()) {
            if (entry.expireTs <= nowMs) owners.delete(ownerId);
          }
          if (owners.size === 0) _focusWatches.delete(k);
        }
        // Reject the request if it would push the total over the
        // budget. Existing keys we already track are free (updating
        // period/ttl); only genuinely new keys count.
        const trulyNew = keys.filter((k) => !_focusWatches.has(k));
        if (_focusWatches.size + trulyNew.length > WATCH_FOCUS_MAX_GLOBAL_KEYS) {
          return res.status(429).json({
            error: "focus budget exhausted",
            used: _focusWatches.size,
            requested: trulyNew.length,
            cap: WATCH_FOCUS_MAX_GLOBAL_KEYS,
          });
        }
        const expireTs = nowMs + ttl * 1000;
        for (const k of keys) {
          // Rev141: reserved keys can also be focused (see _applyWatches
          // comment). Reserved means "do not republish", not "do not
          // subscribe".
          let ownersForKey = _focusWatches.get(k);
          if (!ownersForKey) {
            ownersForKey = new Map();
            _focusWatches.set(k, ownersForKey);
          }
          ownersForKey.set(owner, { period, expireTs });
        }
        if (client) {
          try { _applyWatches(client, lastCatalog); } catch { /* silent */ }
        }
        res.json({ ok: true, focused: keys.length, periodSec: period, ttlSec: ttl, owner });
      });
      router.post("/watch/release", (req: any, res: any) => {
        const body = req.body || {};
        const owner = typeof body.owner === "string" && body.owner.length > 0
          ? body.owner.slice(0, 128)
          : "default";
        const keys: string[] = Array.isArray(body.keys) ? body.keys : [];
        // Rev251 (audit fix 10): a release only affects THIS owner's
        // entries. Empty keys => release everything WE requested (not
        // everyone's). Other owners' subscriptions stay intact.
        const targetKeys = keys.length === 0
          ? Array.from(_focusWatches.keys())
          : keys;
        for (const k of targetKeys) {
          const ownersForKey = _focusWatches.get(k);
          if (!ownersForKey) continue;
          ownersForKey.delete(owner);
          if (ownersForKey.size === 0) _focusWatches.delete(k);
        }
        if (client) {
          try { _applyWatches(client, lastCatalog); } catch { /* silent */ }
        }
        res.json({ ok: true, remaining: _focusWatches.size, owner });
      });
      router.get("/watch/status", (_req: any, res: any) => {
        const now = Date.now();
        const focus: Array<{ key: string; periodSec: number; expiresInSec: number; owners: number }> = [];
        for (const [key, owners] of _focusWatches.entries()) {
          let minPeriod = Infinity;
          let maxExpire = 0;
          for (const e of owners.values()) {
            if (e.period < minPeriod) minPeriod = e.period;
            if (e.expireTs > maxExpire) maxExpire = e.expireTs;
          }
          if (owners.size > 0) {
            focus.push({
              key,
              periodSec: minPeriod,
              expiresInSec: Math.max(0, Math.floor((maxExpire - now) / 1000)),
              owners: owners.size,
            });
          }
        }
        res.json({
          totalWatched: Object.keys(_lastAppliedWatches).length,
          focusCount: focus.length,
          focus,
          appliedByPeriod: Object.entries(_lastAppliedWatches).reduce((acc: Record<string, number>, [, p]) => {
            const label = `${p}s`;
            acc[label] = (acc[label] || 0) + 1;
            return acc;
          }, {}),
        });
      });

      // Rev140: quick reboot of the pypilot_web process on the Pi
      // Zero. piCore uses runit, so `sv restart pypilot_web` is the
      // right primitive. Useful when the socket buffer looks jammed
      // and a full hard reset would be overkill. Guarded by
      // allowWrites + a saved SSH password, same as /debug-cmd.
      router.post("/pypilot-web-restart", async (_req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        if (!props.sshPassword) return res.status(400).json({ error: "sshPassword not set" });
        const r = await _runSsh("sv restart pypilot_web 2>&1", 15000);
        return res.json({
          ok: r.ok,
          elapsedMs: r.elapsedMs,
          stdout: r.stdout.slice(0, 4000),
        });
      });

      // Rev113: free-form SSH exec. Runs any shell command as the saved
      // SSH user on the TinyPilot. Requires allowWrites (same guard as
      // /debug-cmd) plus SK admin auth (SK server enforces). No
      // whitelist: the user chose to enable writes and stored SSH creds,
      // this is the deliberate escape hatch for the Remote Control
      // Console when a preset does not cover the diagnostic they need.
      router.post("/ssh-exec", async (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const cmd = String(req.body?.cmd || "").trim();
        if (!cmd) return res.status(400).json({ error: "cmd required in body" });
        if (cmd.length > 2000) return res.status(400).json({ error: "cmd too long (max 2000 chars)" });
        const r = await _runSsh(cmd, 30000);
        return res.json({
          ok: r.ok,
          cmd,
          elapsedMs: r.elapsedMs,
          code: r.code,
          stdout: r.stdout.slice(0, 32000),
          error: r.error,
        });
      });

      router.post("/debug-cmd", async (req: any, res: any) => {
        if (!props.allowWrites) return res.status(403).json({ error: "allowWrites disabled" });
        const preset = (req.body && req.body.preset) || "";
        const cmd = DEBUG_PRESETS[preset];
        if (!cmd) {
          return res.status(400).json({
            error: "unknown preset",
            available: Object.keys(DEBUG_PRESETS),
          });
        }
        const sshUser = props.sshUser || "tc";
        const sshPassword = props.sshPassword || "";
        if (!sshPassword) {
          return res.status(202).json({
            ok: false,
            preset,
            hint: "SSH password not set - open Setup > Emergency and save it.",
          });
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { Client } = require("ssh2");
          const conn = new Client();
          const t0 = Date.now();
          const result = await new Promise<{ ok: boolean; stdout: string; code?: number }>((resolve) => {
            let settled = false;
            const finish = (r: { ok: boolean; stdout: string; code?: number }) => {
              if (settled) return;
              settled = true;
              try { conn.end(); } catch {}
              resolve(r);
            };
            conn.on("ready", () => {
              conn.exec(cmd, { pty: true }, (err: any, stream: any) => {
                if (err) { finish({ ok: false, stdout: err.message }); return; }
                let out = "";
                stream.on("close", (code: number) => finish({ ok: code === 0, stdout: out, code }));
                stream.on("data", (data: Buffer) => { out += data.toString(); });
                stream.stderr.on("data", (data: Buffer) => { out += data.toString(); });
                setTimeout(() => { try { stream.write(sshPassword + "\n"); } catch {} }, 300);
              });
            });
            conn.on("error", (err: any) => finish({ ok: false, stdout: `ssh: ${err?.message || err}` }));
            conn.on("timeout", () => finish({ ok: false, stdout: "ssh timeout" }));
            try {
              conn.connect({
                host: props.host, port: 22,
                username: sshUser, password: sshPassword,
                readyTimeout: 8000, tryKeyboard: true,
              });
              conn.on("keyboard-interactive", (_n: any, _i: any, _l: any, _p: any, finish2: any) => {
                finish2([sshPassword]);
              });
            } catch (e: any) { finish({ ok: false, stdout: e?.message || String(e) }); }
          });
          // Rev66 / 2.0.4: schedule a hard reconnect after presets that
          // disrupt pypilot_web. Level 1 (restart.web) is quick - 4 s is
          // enough for the socket to notice + wait for pypilot_web to be
          // back up. Level 3 (reboot.pi) needs to survive a ~40 s cold
          // reboot; the watchdog below picks up anything longer than that.
          if (preset === "restart.web") setTimeout(doReconnect, 4000);
          if (preset === "reboot.pi")   setTimeout(doReconnect, 60000);
          // For reboot.pi the ssh session drops as the box goes down, so we
          // report success even on a non-zero exit if we at least connected.
          return res.json({
            ok: preset === "reboot.pi" ? true : result.ok,
            preset,
            elapsedMs: Date.now() - t0,
            code: result.code,
            stdout: result.stdout.slice(0, 32000),
          });
        } catch (e: any) {
          return res.status(500).json({ error: e?.message || String(e), preset });
        }
      });

      // Rev66 / 2.0.4 / Rev255: reconnection watchdog. Rev255 (Carlos):
      // Carlos hit a case where cycling pypilot power left the socket
      // in a "closed forever" state despite the socket.io infinite
      // reconnect setting, and the visor could not engage for 90 s.
      // Threshold lowered from 90 s to 20 s and tick from 60 s to 15 s,
      // so a cycle-pypilot round-trip clears in under half a minute
      // instead of a minute and a half. Anti-loop stays at 3 forced
      // reconnects per 15-min window - Pi Zero is still fragile.
      let _wdogDisconnectSince: number | null = null;
      let _wdogForcedAttempts: number[] = [];   // timestamps of forced reconnects
      const _wdogTimer = setInterval(() => {
        try {
          // Rev280 (audit T24): honour a manual /pause. Without this
          // guard the 20 s reconnect watchdog immediately undid a
          // deliberate pause, so the user could not actually silence
          // the plugin's socket to pypilot_web.
          if ((app as any)._pypilotNewuiPausedByUser) {
            _wdogDisconnectSince = null;
            return;
          }
          if (client?.connected) {
            _wdogDisconnectSince = null;
            return;
          }
          if (_wdogDisconnectSince == null) {
            _wdogDisconnectSince = Date.now();
            return;
          }
          const downMs = Date.now() - _wdogDisconnectSince;
          if (downMs < 20_000) return;
          // Prune attempts older than 15 min.
          const cutoff = Date.now() - 15 * 60_000;
          _wdogForcedAttempts = _wdogForcedAttempts.filter((t) => t > cutoff);
          if (_wdogForcedAttempts.length >= 3) return;
          _wdogForcedAttempts.push(Date.now());
          _wdogDisconnectSince = Date.now();   // reset the timer for the next check
          app.debug(`[watchdog] socket down ${(downMs/1000)|0}s - forcing pause+resume (attempt ${_wdogForcedAttempts.length}/3 in 15 min)`);
          doReconnect();
        } catch { /* silent */ }
      }, 15_000);
      // Store on `app` so plugin.stop() can clear it (defensive - the
      // registerWithRouter closure does not have a stop hook here).
      (app as any)._pypilotNewuiWatchdogTimer = _wdogTimer;
    },
  };

  // ---- helpers ----

  function normalizeProps(options: Partial<PluginProps>): PluginProps {
    // Rev23 migration: infer publishOnlyEssentials for legacy configs so we
    // do not silently stop publishing paths a user already had turned on.
    // Rule: field explicitly set -> respect it. Field missing AND
    // enabledPaths already populated -> user is on a legacy setup, default
    // to false (keep publishing everything except the ones they disabled).
    // Field missing AND enabledPaths empty -> fresh install, default to true.
    let poe: boolean;
    if (typeof options.publishOnlyEssentials === "boolean") {
      poe = options.publishOnlyEssentials;
    } else if (options.enabledPaths && typeof options.enabledPaths === "object" && Object.keys(options.enabledPaths).length > 0) {
      poe = false;
    } else {
      poe = true;
    }
    return {
      host: (options.host || "").trim(),
      port: typeof options.port === "number" ? options.port : 80,
      reconnectDelayMs:
        typeof options.reconnectDelayMs === "number"
          ? options.reconnectDelayMs
          : 3000,
      allowWrites: options.allowWrites !== false,
      allowDirectServo: options.allowDirectServo === true,
      publishUnmapped: options.publishUnmapped === true,
      nudgeSmall: typeof options.nudgeSmall === "number" ? options.nudgeSmall : 1,
      nudgeBig: typeof options.nudgeBig === "number" ? options.nudgeBig : 10,
      absorbProvider: options.absorbProvider === true,
      enabledPaths: (options.enabledPaths && typeof options.enabledPaths === "object")
        ? options.enabledPaths
        : {},
      publishOnlyEssentials: poe,
      sshUser: typeof options.sshUser === "string" && options.sshUser.trim()
        ? options.sshUser.trim() : "tc",
      sshPassword: typeof options.sshPassword === "string" ? options.sshPassword : "",
      logCaptureEnabled: options.logCaptureEnabled === true,
      logCaptureIntervalSec: typeof options.logCaptureIntervalSec === "number"
        ? Math.max(30, options.logCaptureIntervalSec) : 60,
      sessionRecorderEnabled: options.sessionRecorderEnabled !== false,
      maneuverTraceEnabled: options.maneuverTraceEnabled === true,
      sensorsIgnored: Array.isArray(options.sensorsIgnored)
        ? options.sensorsIgnored
            .filter((p: unknown) => typeof p === "string" && (p as string).length > 0)
            .slice(0, 100)
        : [],
      tripRecorderEnabled: options.tripRecorderEnabled !== false,
      autoProfileEnabled: options.autoProfileEnabled === true,
      autoProfileLight:   typeof options.autoProfileLight  === "string" ? options.autoProfileLight.trim()  : "",
      autoProfileMedium:  typeof options.autoProfileMedium === "string" ? options.autoProfileMedium.trim() : "",
      autoProfileHeavy:   typeof options.autoProfileHeavy  === "string" ? options.autoProfileHeavy.trim()  : "",
      // Rev177 (Carlos): default flipped from "warn" to "off". Real
      // sea trial showed that "warn" alone was fine but the moment the
      // sailor bumped up to "freeze-target" / "boost-D" / "temp-heavy",
      // the pilot could get "pillado" (freeze without restore) when
      // gust exit conditions were ambiguous. Until we harden the
      // watchdog + restore path, the safe default is disabled. The
      // opt-in strategy stays wired for the user to choose from
      // Smart Pilot card.
      gustStrategy: (["off","warn","freeze-target","boost-D","temp-heavy"] as const)
        .includes(options.gustStrategy as any) ? options.gustStrategy : "off",
      autoDisengageOnLostAuthority: options.autoDisengageOnLostAuthority === true,
      rollFfGain: clampNumber(options.rollFfGain, 0, 2, 0),
      rollFfTauSec: clampNumber(options.rollFfTauSec, 0.5, 30, 3),
      rollFfTwaGateDeg: clampNumber(options.rollFfTwaGateDeg, 30, 179, 90),
      // Rev298 (H4): leeway adjustment. Practical range 9..12 for a
      // keelboat. 0 = disabled (nothing published). Upper cap 30 keeps
      // a stray fat-finger config from producing a 40° leeway.
      leewayAdjustment: clampNumber(options.leewayAdjustment, 0, 30, 0),
      // Rev299 (H2): failsafe boat speed in knots. Clamped 0..15;
      // 0 = disabled. Practical range 3..8 kn for a cruising keelboat.
      failSafeBspKn: clampNumber(options.failSafeBspKn, 0, 15, 0),
      // Rev299 (I2): tack catch-up. Peak 0..15° (0 disables); tau
      // 1..15 s. Defaults keep the module inert; sailor opts in
      // after sea trial validation.
      tackCatchupDeg: clampNumber(options.tackCatchupDeg, 0, 15, 0),
      tackCatchupTauSec: clampNumber(options.tackCatchupTauSec, 1, 15, 6),
      profileAdvisorEnabled: options.profileAdvisorEnabled !== false,
      profileAdvisorRmsHighDeg: clampNumber(options.profileAdvisorRmsHighDeg, 3, 45, 10),
      profileAdvisorRmsLowDeg: clampNumber(options.profileAdvisorRmsLowDeg, 0.1, 5, 1),
      profileAdvisorSustainSec: clampNumber(options.profileAdvisorSustainSec, 15, 600, 60),
      // Rev289 (B5): sanitise the persisted metadata against the current
      // schema — a plugin downgrade could otherwise leave stray rows
      // with unknown conditions.
      profileMetadata: loadMetadata(options.profileMetadata),
      // Rev290 (E2/E3): threshold overrides, clamped to sane ranges.
      alarmLowVoltageV: clampNumber(options.alarmLowVoltageV, 8, 14, 11.0),
      alarmServoTempC: clampNumber(options.alarmServoTempC, 40, 85, 60),
      alarmServoMotorTempC: clampNumber(options.alarmServoMotorTempC, 40, 90, 70),
      alarmPypilotDiscSec: clampNumber(options.alarmPypilotDiscSec, 3, 300, 15),
      // Rev299 (I1): attitude envelope thresholds. Ranges kept wide
      // enough for coastal cruisers (25°) and racers who purposely
      // put the rail under (60°). Defaults are conservative.
      alarmAttitudeHeelDeg: clampNumber(options.alarmAttitudeHeelDeg, 15, 70, 45),
      alarmAttitudePitchDeg: clampNumber(options.alarmAttitudePitchDeg, 10, 45, 25),
      // Rev299: per-rule enable list. Preserve undefined so legacy
      // installs keep their default-on behaviour; only sanitise when
      // the user (or the schema default of []) provided an actual array.
      alarmSeverityOverrides: (options.alarmSeverityOverrides && typeof options.alarmSeverityOverrides === "object")
        ? Object.fromEntries(
            Object.entries(options.alarmSeverityOverrides).filter(
              ([, v]) => v === "info" || v === "warn" || v === "alarm"
            )
          )
        : {},
      alarmsEnabled: Array.isArray(options.alarmsEnabled)
        ? options.alarmsEnabled.filter((s: unknown): s is string => typeof s === "string")
        : undefined,
      apbSource: (["auto","steerTo","bearing"] as const).includes(options.apbSource as any)
        ? options.apbSource : "auto",
    };
  }

  function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
    if (typeof v !== "number" || !isFinite(v)) return fallback;
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function numberOr0(v: unknown): number {
    return typeof v === "number" && isFinite(v) ? v : 0;
  }

  function pushAutopilotUpdate(fields: "engaged" | "target" | "all" | "virtualTack" = "all"): void {
    if (!apProvider) return;
    // Rev387 (Carlos, 2026-10-01, GPT/Gemini consult): REVERTED Rev386
    // masking. Both LLMs flagged it as a bus pollution bug — other SK
    // clients (KIP, derived-data, etc.) subscribe to steering.autopilot.*
    // and need the TRUTH about mode/target, not a convenient visor-side
    // lie. Masking belongs in the VISOR's presentation layer, consuming
    // the dedicated `steering.autopilot.virtualTack` path we now publish
    // alongside the canonical deltas. Rev388 frontend will do the
    // display-side override.
    // Rev394: 'virtualTack' is a VT-only notification — skip the
    // autopilotUpdate call and the canonical delta block below, only
    // emit the virtualTack path itself (which may now carry `null`
    // telling the visor to drop its shield).
    if (fields !== "virtualTack") {
      try {
        if (typeof app.autopilotUpdate === "function") {
          const apUpdate: any = {};
          if (fields === "all" || fields === "engaged") {
            apUpdate.state = apProvider.data.state;
            apUpdate.engaged = apProvider.data.engaged;
            apUpdate.actions = apProvider.data.options.actions;
          }
          if (fields === "all" || fields === "target") {
            apUpdate.target = apProvider.data.target;
          }
          if (fields === "all") {
            apUpdate.mode = apProvider.data.mode;
          }
          app.autopilotUpdate(apProvider.deviceId, apUpdate);
        }
      } catch (e: any) {
        app.debug(`[absorb] autopilotUpdate failed: ${e?.message || e}`);
      }
    }
    // Rev84: canonical SK deltas now filtered by the same field mask.
    // setTarget publishes ONLY steering.autopilot.target, setState
    // publishes ONLY state/engaged/availableActions. This kills the
    // race where a parallel /engage + /target pair produced two deltas
    // each carrying both fields; whichever landed second would clobber
    // the sibling with a stale copy (the "DIA jumps to 115° then back
    // to 75°" Carlos reported on Rev82). "all" is still used by the
    // 30-s keep-alive and startup push.
    const values: any[] = [];
    if (fields === "all" || fields === "engaged") {
      values.push(
        { path: "steering.autopilot.state",   value: apProvider.data.state },
        { path: "steering.autopilot.engaged", value: apProvider.data.engaged },
        { path: "steering.autopilot.availableActions",
          value: apProvider.data.options.actions.filter((a) => a.available).map((a) => a.id) },
      );
    }
    if (fields === "all" || fields === "target") {
      values.push({ path: "steering.autopilot.target",  value: apProvider.data.target });
    }
    if (fields === "all") {
      values.push({ path: "steering.autopilot.mode",    value: apProvider.data.mode });
    }
    // Rev387 (Carlos, 2026-10-01): publish virtual-tack status as a
    // structured object on its own SK path. The visor subscribes to
    // this and uses it to mask the mode selector + rose rendering
    // without touching the canonical steering.autopilot.{mode,target}
    // values that KIP and other clients rely on.
    try {
      const vt = (apProvider as any).getVirtualTackState?.();
      // Rev394: explicit null delta on cleanup so the visor's shield
      // can drop. 'virtualTack' is the dedicated field used by the
      // cleanup timer; it must publish something even when vt is null.
      if (fields === "virtualTack" && !vt) {
        values.push({ path: "steering.autopilot.virtualTack", value: null });
      } else if (vt && vt.phase !== "idle") {
        const g = vt.geometry;
        const RAD2DEG = 180 / Math.PI;
        let hNowRad: number | null = null;
        try {
          const h = (app as any).getSelfPath?.("navigation.headingTrue");
          const v = h?.value;
          if (typeof v === "number") hNowRad = v;
        } catch { /* noop */ }
        const stepRad = g?.intermediatesRad?.[vt.stepIndex];
        const remainingDeg = (typeof stepRad === "number" && hNowRad !== null)
          ? Math.abs(((stepRad - hNowRad) * RAD2DEG + 540) % 360 - 180)
          : null;
        const activePhases = ["preparing","turning","handover","settling","cancelling","phase1","phase2","calc"];
        const terminalPhases = ["completed","cancelled","failed","done","abort"];
        values.push({
          path: "steering.autopilot.virtualTack",
          value: {
            id: vt.id ?? null,
            phase: vt.phase,
            active: activePhases.includes(vt.phase),
            terminal: terminalPhases.includes(vt.phase),
            cancellable: activePhases.includes(vt.phase) && vt.phase !== "cancelling",
            direction: vt.direction,
            windMode: vt.windMode,
            // Rev394: backend-computed kind so visor doesn't misdetect
            // from |AWA| vs 90°. "tack" = rotation crosses bow; "jibe"
            // = crosses stern.
            maneuverKind: g?.maneuverKind ?? null,
            finalWindTargetRad: g?.angleNewRad ?? null,
            // Rev396 (Carlos, 2026-10-02, Round-4 Codex+Gemini): publish
            // the pre-tack wind angle so the visor does NOT have to snapshot
            // state.target at snapshot-arrival time. The visor's local
            // _targetBeforeVt capture races against the canonical target
            // delta's shield in chained maneuvers (Round-4 investigation);
            // reading originalWindTargetRad from the snapshot is immune to
            // that race.
            originalWindTargetRad: typeof vt.originalAngleRad === "number"
              ? vt.originalAngleRad
              : null,
            elapsedMs: vt.startedAtMs ? Date.now() - vt.startedAtMs : 0,
            stepIndex: vt.stepIndex,
            totalSteps: g?.intermediatesRad?.length ?? 0,
            remainingDeg,
            outcomeReason: vt.outcomeReason ?? null,
          },
        });
      }
    } catch { /* silent */ }
    if (values.length === 0) return;
    // Rev350: stage=publish for the CANONICAL pilot deltas (state,
    // engaged, target, mode). Complements the wildcard publisher log
    // in publishValue().
    try {
      maneuverTrace?.logStageEvent("publish", {
        source: "canonical",
        fields,
        values: values.map((v: any) => ({ path: v.path, value: v.value })),
      });
    } catch { /* silent */ }
    try {
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{
          $source: SOURCE_LABEL,
          timestamp: new Date().toISOString(),
          values,
        }],
      });
    } catch (e: any) {
      app.debug(`[absorb] canonical delta emit failed: ${e?.message || e}`);
    }
    // Rev34: mirror the active mode into the mode.* radio switch group
    // so KIP's Simple Switch widgets reflect pypilot's current mode.
    // Only when publishing the "all" or a mode-carrying update.
    if (fields === "all") {
      try {
        const emit = (app as any)._pypilotNewuiEmitModeSwitches as
          ((activePy: string | null) => void) | undefined;
        if (emit) emit(apProvider.data.mode);
      } catch { /* silent */ }
    }
  }

  // Rev93: sampler invoked once per second by the historian. Pulls the
  // latest known value for each telemetry path from three sources:
  //   - client.getValues()      -> live pypilot telemetry (servo, imu,
  //                                ap.heading_command, ap.mode/enabled)
  //   - apProvider.data         -> canonical engaged/mode/target when
  //                                the plugin absorbs the SK provider
  //   - app.getSelfPath(...)    -> external SK paths (wind, sog, heel)
  //                                published by other plugins.
  // Missing values are `null` - the historian tolerates them.
  // Rev143: per-tick handler that mirrors the historian sample into
  // the session recorder while the AP is engaged. Engage/disengage
  // transitions open/close a JSONL file. Off-boat analysis reads the
  // file to produce a "corpus navegante" - future Revs will inject
  // heuristics learned from this corpus back into the Doctor.
  // Rev178 (Carlos): trip recorder tick. Reads navigation.state and
  // opens/closes trips on moored <-> !moored transitions. Cheap: one
  // getSelfPath call per tick, one JSONL line while a trip is open.
  function _tripTick(s: Sample): void {
    if (!tripRecorder) return;
    // Rev328 (Carlos, 2026-09-28): master switch. When the sailor
    // disables the logbook from Setup we neither open new trips nor
    // record samples into an open one — but we DO close any trip that
    // was already recording so its summary lands cleanly on disk.
    if (props.tripRecorderEnabled === false) {
      if (tripRecorder.isRecording()) {
        try { tripRecorder.stop(); } catch { /* silent */ }
      }
      return;
    }
    const stateRaw = app.getSelfPath ? app.getSelfPath("navigation.state.value") : null;
    const navState = typeof stateRaw === "string" ? stateRaw : "moored";
    // Transitions.
    // Rev280 (audit T10): also open a trip when the plugin boots
    // with the vessel already off "moored". Previously the "start"
    // path only fired on a moored → sailing transition, so restarting
    // Signal K mid-outing missed the entire session and stored zero
    // trips. Treat lastNavState==null (boot) the same as coming from
    // "moored" for the purpose of opening a new trip.
    if (navState !== "moored" && (lastNavState === "moored" || lastNavState === null) && !tripRecorder.isRecording()) {
      // Opening. Snapshot the current pypilot gains so the trip header
      // records how the pilot was tuned when the boat left the dock.
      const pv = (client && client.connected) ? client.getValues() : {};
      const pilotName = typeof pv["ap.pilot"] === "string" ? (pv["ap.pilot"] as string) : null;
      const gains: Record<string, number> = {};
      if (pilotName) {
        for (const k of Object.keys(pv)) {
          if (k.startsWith(`ap.pilot.${pilotName}.`) && typeof pv[k] === "number") {
            const short = k.split(".").slice(3).join(".");
            gains[short] = pv[k] as number;
          }
        }
      }
      tripRecorder.start({
        navStateAtStart: navState,
        gainsAtStart: Object.keys(gains).length > 0 ? gains : null,
        revision: PLUGIN_REVISION,
      });
    } else if (navState === "moored" && lastNavState !== null && lastNavState !== "moored") {
      // Closing. Compute + write summary.
      try { tripRecorder.stop(); } catch { /* silent */ }
    }
    lastNavState = navState;
    if (tripRecorder.isRecording()) {
      const lat = app.getSelfPath ? app.getSelfPath("navigation.position.value.latitude") : null;
      const lon = app.getSelfPath ? app.getSelfPath("navigation.position.value.longitude") : null;
      const heel = app.getSelfPath ? app.getSelfPath("navigation.attitude.value.roll") : null;
      const depth = app.getSelfPath ? app.getSelfPath("environment.depth.belowTransducer.value") : null;
      const twa = app.getSelfPath ? app.getSelfPath("environment.wind.angleTrueWater.value") : null;
      const sample: TripSample = {
        ts: s.ts,
        lat: typeof lat === "number" ? lat : null,
        lon: typeof lon === "number" ? lon : null,
        sog: typeof s.sog === "number" ? s.sog : null,
        cog: null,
        heading: typeof s.headingActual === "number" ? s.headingActual : null,
        tws: typeof s.tws === "number" ? s.tws : null,
        twa: typeof twa === "number" ? twa : null,
        aws: typeof s.aws === "number" ? s.aws : null,
        awa: typeof s.awa === "number" ? s.awa : null,
        heel: typeof heel === "number" ? heel : (typeof s.heel === "number" ? s.heel : null),
        rudder: typeof s.rudder === "number" ? s.rudder : null,
        depth: typeof depth === "number" ? depth : null,
        servoCur: typeof s.servoCurrent === "number" ? s.servoCurrent : null,
        servoVolt: typeof s.servoVoltage === "number" ? s.servoVoltage : null,
        engaged: !!s.engaged,
        mode: s.mode,
        state: navState,
      };
      tripRecorder.sample(sample);
    }
  }

  function _sessionTick(s: Sample): void {
    if (!sessionRecorder) return;
    const now = Date.now();
    const engagedRawNow = !!s.engaged;
    // Rev176 debounce: only propagate a change once the new raw state
    // has held for ENGAGED_DEBOUNCE_MS. Everything else is a bounce and
    // gets logged so we can spot rogue clients later.
    if (_engagedRaw === null) {
      _engagedRaw = engagedRawNow;
      _engagedRawSince = now;
      _engagedStable = engagedRawNow;
    } else if (engagedRawNow !== _engagedRaw) {
      // Raw value flipped. If the previous run was < DEBOUNCE, we call
      // it a bounce and record it, then track the new raw value.
      const heldMs = now - _engagedRawSince;
      if (heldMs < ENGAGED_DEBOUNCE_MS) {
        _engagedBouncesFiltered += 1;
        _engagedLastFilteredMs = now;
        _engagedLastFilteredDetails = `engaged ${_engagedRaw ? "true" : "false"}->${engagedRawNow ? "true" : "false"} held only ${heldMs}ms`;
        try { app.debug?.(`[bounce] ${_engagedLastFilteredDetails}`); } catch { /* silent */ }
      }
      _engagedRaw = engagedRawNow;
      _engagedRawSince = now;
    } else {
      // Same raw value as last tick. If it has held long enough AND
      // differs from the current stable state, promote it.
      if (engagedRawNow !== _engagedStable && (now - _engagedRawSince) >= ENGAGED_DEBOUNCE_MS) {
        _engagedStable = engagedRawNow;
      }
    }
    const engagedNow = _engagedStable;
    if (engagedNow && !lastEngagedState) {
      // Engaging: start a new session with the pilot / profile / gains
      // snapshot the visor is currently using.
      const pv = (client && client.connected) ? client.getValues() : {};
      const pilotName = typeof pv["ap.pilot"] === "string" ? (pv["ap.pilot"] as string) : null;
      const profileName = typeof pv["profile"] === "string" ? (pv["profile"] as string) : null;
      const gains: Record<string, number> = {};
      if (pilotName) {
        for (const k of Object.keys(pv)) {
          if (k.startsWith(`ap.pilot.${pilotName}.`) && typeof pv[k] === "number") {
            const short = k.split(".").slice(3).join(".");
            gains[short] = pv[k] as number;
          }
        }
      }
      sessionRecorder.start({
        pilot: pilotName,
        profile: profileName,
        gainsAtStart: Object.keys(gains).length > 0 ? gains : null,
        revision: PLUGIN_REVISION,
      });
    } else if (!engagedNow && lastEngagedState) {
      // Disengaging: close the session so the JSONL is a finished
      // artifact ready to share.
      sessionRecorder.stop();
    }
    lastEngagedState = engagedNow;
    if (engagedNow && sessionRecorder.isRecording()) {
      const pv = (client && client.connected) ? client.getValues() : {};
      // Rev146: TWA comes from angleTrueWater in most SK setups
      // (derived-data emits that, not the legacy angleTrue).
      const twaRad = (typeof (app.getSelfPath ? app.getSelfPath("environment.wind.angleTrueWater.value") : null) === "number")
        ? app.getSelfPath("environment.wind.angleTrueWater.value") as number
        : null;
      // Rev176 (Carlos): hdgErr now depends on the AP mode. Pre-Rev176
      // we always stored `headingCmd - headingActual`, which is correct
      // only in compass/gps/nav modes where the target and the actual
      // are both boat headings. In `wind` mode `heading_command` is the
      // apparent-wind-angle setpoint and must be compared with AWA. In
      // `true wind` mode it's the true-wind-angle setpoint compared
      // with TWA. Storing the wrong error made every wind-mode session
      // look catastrophic on the offline analyser.
      const modeStr = String(s.mode || "").toLowerCase();
      let hdgErr: number | null = null;
      if (typeof s.headingCmd === "number") {
        if (modeStr.includes("true") && modeStr.includes("wind")) {
          if (typeof twaRad === "number") hdgErr = _wrapPi(s.headingCmd - twaRad);
        } else if (modeStr.includes("wind")) {
          if (typeof s.awa === "number") hdgErr = _wrapPi(s.headingCmd - s.awa);
        } else if (typeof s.headingActual === "number") {
          hdgErr = _wrapPi(s.headingCmd - s.headingActual);
        }
      }
      const sample: SessionSample = {
        ts: s.ts,
        hdgCmd: s.headingCmd,
        hdgAct: s.headingActual,
        hdgErr,
        hdgRate: typeof pv["imu.headingrate"] === "number" ? pv["imu.headingrate"] as number : null,
        hdgRateRate: null,
        servoCmd: typeof pv["servo.command"] === "number" ? pv["servo.command"] as number : null,
        servoCur: s.servoCurrent,
        servoDuty: null,
        servoVolt: s.servoVoltage,
        engaged: engagedNow,
        mode: s.mode,
        tws: s.tws,
        twa: twaRad,
        aws: s.aws,
        awa: s.awa,
        sog: s.sog,
        cog: null,
        pitchRms: null,
        rollRms: s.heel,
      };
      sessionRecorder.sample(sample);
    }
  }
  // Rev164/165/166: supervisor layer. Runs on every historian tick.
  // Three independent responsibilities:
  //   - Auto-profile switch by wind band (only while engaged, opt-in).
  //   - Gust detector (advisory notification, no pilot command).
  //   - Authority-lost auto-disengage (safety-off, opt-in).
  // Every branch is defensive: if a required input is missing the tick
  // returns without doing anything.
  function _supervisorTick(s: Sample): void {
    const now = Date.now();
    // ------------------ Rev167: gust supervisor ------------------
    // Release any strategy whose timer has expired BEFORE evaluating a
    // new gust. Guarantees restore-first even if a follow-on gust
    // lands during the window.
    _releaseGustStrategiesIfExpired(now);
    const strat = props.gustStrategy ?? "off";
    if (strat !== "off") {
      const awsKn = typeof s.aws === "number" ? s.aws * 1.94384 : null;
      if (awsKn != null) {
        _gustAwsBuffer.push({
          ts: s.ts,
          ktts: awsKn,
          heelRad: typeof s.heel === "number" ? s.heel : null,
        });
        const cutoff = s.ts - GUST_WINDOW_MS;
        while (_gustAwsBuffer.length > 0 && _gustAwsBuffer[0].ts < cutoff) _gustAwsBuffer.shift();
        if (_gustAwsBuffer.length >= 3 && now - _gustLastAlertTs > GUST_COOLDOWN_MS) {
          let minKn = Infinity, maxKn = -Infinity;
          let minEntry = _gustAwsBuffer[0], maxEntry = _gustAwsBuffer[0];
          for (const e of _gustAwsBuffer) {
            if (e.ktts < minKn) { minKn = e.ktts; minEntry = e; }
            if (e.ktts > maxKn) { maxKn = e.ktts; maxEntry = e; }
          }
          const jump = maxKn - minKn;
          if (jump >= GUST_MIN_JUMP_KN && maxKn === awsKn) {
            // Rev283: heel confirmation. When both endpoints of the AWS
            // window have heel data, require the heel to have changed
            // >= GUST_HEEL_CONFIRM_DEG. This filters sensor spikes that
            // did not physically load the boat. Fails open if either
            // heel sample is missing (legacy behaviour).
            let heelConfirmed = true;
            let heelDeltaDeg: number | null = null;
            if (minEntry.heelRad != null && maxEntry.heelRad != null) {
              heelDeltaDeg = Math.abs(maxEntry.heelRad - minEntry.heelRad) * 180 / Math.PI;
              heelConfirmed = heelDeltaDeg >= GUST_HEEL_CONFIRM_DEG;
            }
            if (heelConfirmed) {
              _gustLastAlertTs = now;
              _applyGustStrategy(strat, minKn, maxKn, s, now);
            } else {
              _gustLastSuppressedTs = now;
              _gustLastSuppressReason = `heel delta ${heelDeltaDeg?.toFixed(1)}deg < ${GUST_HEEL_CONFIRM_DEG}deg (AWS jump ${jump.toFixed(1)}kn looks like a sensor spike)`;
            }
          }
        }
      }
    }
    // ------------------ Rev166: authority-lost auto-disengage ------------------
    if (props.autoDisengageOnLostAuthority && kpis && apProvider) {
      const engaged = !!apProvider.data.engaged;
      const rmsRad = kpis.snapshot().window1m.rmsErrorRad;
      const duty = kpis.snapshot().window1m.servoDutyPct;
      if (engaged && typeof rmsRad === "number" && typeof duty === "number"
          && rmsRad * 180 / Math.PI > AUTHORITY_LOST_RMS_DEG
          && duty > AUTHORITY_LOST_DUTY_MIN
          && (!_authorityLastAutoDisengageTs || now - _authorityLastAutoDisengageTs > AUTHORITY_LOST_COOLDOWN_MS)) {
        if (_authorityLostSinceMs == null) _authorityLostSinceMs = now;
        else if (now - _authorityLostSinceMs > AUTHORITY_LOST_SUSTAIN_MS) {
          // Fire once, then latch the cooldown so a bouncing metric
          // does not cause a disengage/re-engage loop.
          _authorityLastAutoDisengageTs = now;
          _authorityLostSinceMs = null;
          try { client?.set("ap.enabled", false); } catch { /* silent */ }
          _emitEmergencyNotification("authority-lost",
            `AP AUTO-DISENGAGED: heading control lost (RMS ${(rmsRad * 180 / Math.PI).toFixed(0)}deg, duty ${(duty * 100).toFixed(0)}%). Take the helm.`);
        }
      } else {
        _authorityLostSinceMs = null;
      }
    }
    // ------------------ Rev164: auto-profile by wind band ------------------
    if (props.autoProfileEnabled && apProvider && client && historian) {
      const engaged = !!apProvider.data.engaged;
      if (!engaged) {
        _autoProfilePendingBand = null;
        _autoProfilePendingSince = null;
        return;
      }
      // Average TWS over the last 60 s from the historian ring.
      const samples = historian.slice(AUTO_PROFILE_WIND_AVG_MS, ["tws"]);
      let sum = 0, n = 0;
      for (const sm of samples) {
        if (typeof sm.tws === "number" && isFinite(sm.tws)) { sum += sm.tws; n += 1; }
      }
      if (n < 10) return;
      const avgKn = (sum / n) * 1.94384;
      const targetBand: AutoProfileBand =
        avgKn < AUTO_PROFILE_TWS_MED_KN   ? "light"
        : avgKn > AUTO_PROFILE_TWS_HEAVY_KN ? "heavy"
        : "medium";
      if (targetBand === _autoProfileCurrentBand) {
        _autoProfilePendingBand = null;
        _autoProfilePendingSince = null;
        return;
      }
      if (_autoProfilePendingBand !== targetBand) {
        _autoProfilePendingBand = targetBand;
        _autoProfilePendingSince = now;
        return;
      }
      if (_autoProfilePendingSince != null && now - _autoProfilePendingSince > AUTO_PROFILE_BAND_STABLE_MS) {
        const targetProfile =
          targetBand === "light"  ? (props.autoProfileLight  || "")
          : targetBand === "heavy" ? (props.autoProfileHeavy || "")
          : (props.autoProfileMedium || "");
        if (!targetProfile) { _autoProfilePendingSince = null; return; }
        const currentProfile = client.getValues()["profile"];
        if (currentProfile !== targetProfile) {
          _autoProfileLastReason = `TWS avg ${avgKn.toFixed(1)} kn → band ${targetBand} → profile ${targetProfile}`;
          try {
            profileChangeLog.markPlannedWrite(targetProfile, "auto-profile", _autoProfileLastReason);
            client.set("profile", targetProfile);
          } catch { /* silent */ }
          _autoProfileLastSwitchTs = now;
          _emitAdvisoryNotification("auto-profile-switch", _autoProfileLastReason);
        }
        _autoProfileCurrentBand = targetBand;
        _autoProfilePendingBand = null;
        _autoProfilePendingSince = null;
      }
    }
  }
  // Rev167: gust strategy dispatcher. Called once per detected gust.
  function _applyGustStrategy(strat: string, minKn: number, maxKn: number, s: Sample, now: number): void {
    const summary = `AWS ${minKn.toFixed(0)}->${maxKn.toFixed(0)} kn in ${(GUST_WINDOW_MS / 1000).toFixed(0)} s`;
    if (strat === "warn") {
      _emitAdvisoryNotification("gust-detected", `Gust detected: ${summary}`);
      return;
    }
    if (!apProvider || !client) return;
    const engaged = !!apProvider.data.engaged;
    if (!engaged) {
      // Nothing to do - no target to pin, no gain to boost. Fall
      // back to a warning so the skipper still sees the gust.
      _emitAdvisoryNotification("gust-detected", `Gust (AP off): ${summary}`);
      return;
    }
    if (strat === "freeze-target") {
      const mode = String(apProvider.data.mode || "").toLowerCase();
      // Only meaningful in wind / true wind modes - in compass/nav the
      // target is already fixed to a heading, so a "freeze" is a
      // no-op. Fall back to warn in that case.
      if (!mode.includes("wind")) {
        _emitAdvisoryNotification("gust-detected", `Gust in ${mode || "?"} mode (freeze not applicable): ${summary}`);
        return;
      }
      const currentTarget = typeof apProvider.data.target === "number" ? apProvider.data.target : null;
      if (currentTarget == null) return;
      _gustFreezeUntilMs = now + GUST_FREEZE_SEC * 1000;
      _gustFreezeTargetRad = currentTarget;
      // Re-PUT the target every second while frozen (inside the
      // _releaseGustStrategiesIfExpired check on the next tick). The
      // *first* PUT here nails it so pypilot cannot drift on this
      // sample already.
      try { client.set("ap.heading_command", currentTarget * 180 / Math.PI); } catch { /* silent */ }
      _emitAdvisoryNotification("gust-target-frozen",
        `Gust ${summary}: target pinned at ${(currentTarget * 180 / Math.PI).toFixed(0)}deg for ${GUST_FREEZE_SEC} s`);
      return;
    }
    if (strat === "boost-D") {
      const pilot = typeof client.getValues()["ap.pilot"] === "string" ? client.getValues()["ap.pilot"] as string : null;
      if (!pilot) return;
      const key = `ap.pilot.${pilot}.D`;
      const currentD = client.getValues()[key];
      if (typeof currentD !== "number" || currentD <= 0) return;
      const boostedD = currentD * 1.20;
      _gustBoostUntilMs = now + GUST_BOOST_SEC * 1000;
      _gustBoostRestoreGain = { pilot, key: "D", value: currentD };
      try { client.set(key, boostedD); } catch { /* silent */ }
      _emitAdvisoryNotification("gust-boost-d",
        `Gust ${summary}: D boosted ${currentD.toFixed(4)} -> ${boostedD.toFixed(4)} for ${GUST_BOOST_SEC} s`);
      return;
    }
    if (strat === "temp-heavy") {
      const heavy = props.autoProfileHeavy || "";
      if (!heavy) {
        // Configuration incomplete - warn instead of silently doing
        // nothing so the skipper knows the strategy needs setup.
        _emitAdvisoryNotification("gust-detected", `Gust ${summary} (temp-heavy needs Heavy profile filled in)`);
        return;
      }
      const currentProfile = typeof client.getValues()["profile"] === "string"
        ? client.getValues()["profile"] as string : null;
      if (currentProfile === heavy) return;   // already there
      _gustHeavyUntilMs = now + GUST_HEAVY_SEC * 1000;
      _gustHeavyRestoreProfile = currentProfile;
      const gustReason = `Gust ${summary}: profile ${currentProfile ?? "?"} -> ${heavy} for ${GUST_HEAVY_SEC} s`;
      try {
        profileChangeLog.markPlannedWrite(heavy, "gust-heavy", gustReason);
        client.set("profile", heavy);
      } catch { /* silent */ }
      _emitAdvisoryNotification("gust-heavy-profile", gustReason);
      return;
    }
    // Unknown strategy - do nothing.
    void s;
  }
  // Rev167: release any expired gust strategy so the pilot returns to
  // its normal behaviour without needing a wind lull. Called at the
  // top of _supervisorTick before evaluating a new gust.
  function _releaseGustStrategiesIfExpired(now: number): void {
    if (_gustFreezeUntilMs != null) {
      if (now >= _gustFreezeUntilMs) {
        _gustFreezeUntilMs = null;
        _gustFreezeTargetRad = null;
        _emitAdvisoryNotification("gust-target-frozen", "Gust freeze released");
      } else if (client && _gustFreezeTargetRad != null) {
        // While frozen we keep the target pinned - pypilot may drift
        // otherwise if the skipper had a wind-mode target.
        try { client.set("ap.heading_command", _gustFreezeTargetRad * 180 / Math.PI); } catch { /* silent */ }
      }
    }
    if (_gustBoostUntilMs != null && now >= _gustBoostUntilMs) {
      const r = _gustBoostRestoreGain;
      if (client && r) {
        try { client.set(`ap.pilot.${r.pilot}.${r.key}`, r.value); } catch { /* silent */ }
      }
      _gustBoostUntilMs = null;
      _gustBoostRestoreGain = null;
      _emitAdvisoryNotification("gust-boost-d", "D restored to pre-gust value");
    }
    if (_gustHeavyUntilMs != null && now >= _gustHeavyUntilMs) {
      if (client && _gustHeavyRestoreProfile != null) {
        // Rev296 (Carlos, navigating - bug D "me cargaba con default"):
        // respect a manual profile change the sailor made DURING the
        // temp-heavy window. If the currently-active profile is
        // neither the heavy target nor the pre-gust one, someone
        // (sailor, KIP, another visor) picked a third option and we
        // must not stomp on that decision.
        const heavy = props.autoProfileHeavy || "";
        const currentNow = typeof client.getValues()["profile"] === "string"
          ? client.getValues()["profile"] as string : null;
        const sailorOverrode = currentNow != null
          && currentNow !== heavy
          && currentNow !== _gustHeavyRestoreProfile;
        if (sailorOverrode) {
          _emitAdvisoryNotification("gust-heavy-profile",
            `Manual profile change (${currentNow}) detected during gust heavy - not restoring`);
        } else {
          try {
            profileChangeLog.markPlannedWrite(_gustHeavyRestoreProfile, "gust-heavy-restore", "gust window expired");
            client.set("profile", _gustHeavyRestoreProfile);
          } catch { /* silent */ }
          _emitAdvisoryNotification("gust-heavy-profile", "Profile restored to pre-gust value");
        }
      }
      _gustHeavyUntilMs = null;
      _gustHeavyRestoreProfile = null;
    }
  }

  function _emitAdvisoryNotification(id: string, message: string): void {
    try {
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [{
          path: `notifications.autopilot.${id}`,
          value: { state: "nominal", method: ["visual"], message },
        }]}],
      });
    } catch (e: any) { app.debug?.(`[notify:${id}] ${e?.message || e}`); }
  }
  function _emitEmergencyNotification(id: string, message: string): void {
    try {
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{ $source: SOURCE_LABEL, timestamp: new Date().toISOString(), values: [{
          path: `notifications.autopilot.${id}`,
          value: { state: "emergency", method: ["visual", "sound"], message },
        }]}],
      });
    } catch (e: any) { app.debug?.(`[notify:${id}] ${e?.message || e}`); }
  }

  function _wrapPi(a: number): number {
    while (a > Math.PI)  a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function collectSample(): Sample {
    const pv = (client && client.connected) ? client.getValues() : {};
    const skNum = (path: string): number | null => {
      try {
        const v = app.getSelfPath(path + ".value");
        return typeof v === "number" && !isNaN(v) ? v : null;
      } catch { return null; }
    };
    // Rev94: navigation.attitude arrives as a composite object
    // { pitch, roll, yaw } under a single .value, not as three separate
    // scalar paths. Read the object and pluck the subfield we want.
    const skAttitudeField = (field: "pitch" | "roll" | "yaw"): number | null => {
      try {
        const att = app.getSelfPath("navigation.attitude.value");
        if (att && typeof att === "object" && typeof att[field] === "number" && !isNaN(att[field])) {
          return att[field];
        }
      } catch { /* silent */ }
      return null;
    };
    // pypilot serves ap.heading_command in DEGREES (see line 551 setter
    // dividing by 180/PI on the way out). Convert to rad to match the
    // rest of the Sample fields.
    const cmdDeg = pv["ap.heading_command"];
    const headingCmdRad = typeof cmdDeg === "number" ? cmdDeg * Math.PI / 180 : null;
    // Servo current + temp arrive as plain numbers from pypilot.
    const servoA = typeof pv["servo.current"] === "number" ? (pv["servo.current"] as number) : null;
    const servoT = typeof pv["servo.controller_temp"] === "number" ? (pv["servo.controller_temp"] as number) : null;
    // Rev156 (Carlos): motor coil temperature so servo-motor-temp
    // alarm has fresh data.
    const servoMT = typeof pv["servo.motor_temp"] === "number" ? (pv["servo.motor_temp"] as number) : null;
    // Rev99: pypilot exposes battery voltage as servo.voltage (V).
    const servoV = typeof pv["servo.voltage"] === "number" ? (pv["servo.voltage"] as number) : null;
    // Engaged / mode: prefer the AP provider when active, fall back to
    // raw pypilot values so the historian keeps working with
    // absorbProvider = false.
    const engaged = apProvider
      ? !!apProvider.data.engaged
      : (pv["ap.enabled"] === true || pv["ap.enabled"] === 1);
    const mode = apProvider
      ? (apProvider.data.mode || null)
      : (typeof pv["ap.mode"] === "string" ? pv["ap.mode"] as string : null);
    return {
      ts: Date.now(),
      headingCmd:    headingCmdRad,
      headingActual: skNum("navigation.headingMagnetic"),
      rudder:        skNum("steering.rudderAngle"),
      servoCurrent:  servoA,
      servoTemp:     servoT,
      servoMotorTemp: servoMT,
      servoVoltage:  servoV,
      awa:           skNum("environment.wind.angleApparent"),
      aws:           skNum("environment.wind.speedApparent"),
      // Rev280 (audit T04): TWA used by the KPI error computation in
      // true-wind mode. Fall back to angleTrueWater / angleTrueGround
      // if the canonical `angleTrue` is not published.
      twa:           skNum("environment.wind.angleTrue")
                     ?? skNum("environment.wind.angleTrueWater")
                     ?? skNum("environment.wind.angleTrueGround"),
      // Rev146 (Carlos): signalk-derived-data does not emit
      // environment.wind.speedTrue - it publishes speedOverGround
      // instead. Try the canonical path first (some setups still
      // populate it via NMEA MWD) and fall back to the derived one.
      tws:           skNum("environment.wind.speedTrue") ?? skNum("environment.wind.speedOverGround"),
      sog:           skNum("navigation.speedOverGround"),
      heel:          skAttitudeField("roll"),
      pitch:         skAttitudeField("pitch"),
      engaged,
      mode,
    };
  }

  // Rev322 (Carlos, 2026-09-27): snapshot pypilot + SK state for the
  // maneuver trace log. Cheaper than collectSample() — no historian
  // aggregations, no derivations. Read once, fill the flat object,
  // return. Called on every trace event pre + 300 ms later.
  function _captureManeuverContext(): ManeuverContext {
    const pv = (client && client.connected) ? client.getValues() : {};
    const skNum = (p: string): number | null => {
      try {
        const v = app.getSelfPath(p + ".value");
        return typeof v === "number" && !isNaN(v) ? v : null;
      } catch { return null; }
    };
    const cmdDeg = pv["ap.heading_command"];
    const headingCmdRad = typeof cmdDeg === "number" ? cmdDeg * Math.PI / 180 : null;
    const engaged = apProvider
      ? !!apProvider.data.engaged
      : (pv["ap.enabled"] === true || pv["ap.enabled"] === 1
          ? true
          : (pv["ap.enabled"] === false || pv["ap.enabled"] === 0 ? false : null));
    const mode = apProvider
      ? (apProvider.data.mode || null)
      : (typeof pv["ap.mode"] === "string" ? pv["ap.mode"] as string : null);
    const target = apProvider && apProvider.data.target != null
      ? apProvider.data.target
      : headingCmdRad;
    const tackState = typeof pv["ap.tack.state"] === "string"
      ? pv["ap.tack.state"] as string : null;
    const tackDirection = typeof pv["ap.tack.direction"] === "string"
      ? pv["ap.tack.direction"] as string : null;
    return {
      ts: Date.now(),
      mode,
      target,
      heading: skNum("navigation.headingMagnetic"),
      awa: skNum("environment.wind.angleApparent"),
      twa: skNum("environment.wind.angleTrue")
        ?? skNum("environment.wind.angleTrueWater")
        ?? skNum("environment.wind.angleTrueGround"),
      engaged,
      tackState,
      tackDirection,
      servoCur: typeof pv["servo.current"] === "number" ? (pv["servo.current"] as number) : null,
    };
  }

  // Rev100: evaluate the alarm engine on this tick and publish SK
  // notifications for any rule whose state changed. Notifications
  // follow the canonical SK format under notifications.autopilot.<id>
  // with state / method / message so any downstream SK client honours
  // them out of the box.
  // Rev299: apply the per-rule enable list to the AlarmEngine.
  // undefined = legacy → every rule keeps its defaultEnabled (=true
  // for pre-Rev299 installs, so Tunatunes carries on unchanged).
  // Array = user-selected → only listed ids are enabled, everything
  // else is silenced. Empty array = fresh install = ALL silent.
  // Rev299 (I2): watch pypilot values that describe the tack state
  // machine so we can trigger the catch-up module on completion.
  // Pypilot exposes:
  //   - ap.tack.state:     "none" | "begin" | "waiting" | "tacking"
  //   - ap.tack.direction: "port" | "starboard"
  // A tack is "just complete" when state transitions FROM "tacking"
  // (or "waiting") TO "none" while the pilot is still engaged. That
  // is the moment the sails need a few seconds to re-fill.
  function observeTackTransition(name: string, value: unknown): void {
    if (!tackCatchup) return;
    if (name === "ap.tack.direction" && typeof value === "string") {
      // Pypilot spells starboard out; we keep our internal "stbd".
      _tackDirection = value === "starboard" ? "stbd"
                     : value === "port" ? "port"
                     : _tackDirection;
      return;
    }
    if (name !== "ap.tack.state" || typeof value !== "string") return;
    const prev = _tackStatePrev;
    _tackStatePrev = value;
    if (prev == null) return; // seed only, do not fire on the first read
    const wasTacking = prev === "tacking" || prev === "waiting";
    const nowIdle = value === "none";
    if (wasTacking && nowIdle && _tackDirection != null) {
      tackCatchup.onTackComplete(_tackDirection, Date.now());
    }
  }

  function applyAlarmsEnabled(list: string[] | undefined): void {
    if (!alarms) return;
    if (list === undefined) return; // legacy: leave defaults alone
    const wanted = new Set(list);
    for (const rule of alarms.describe()) {
      alarms.setEnabled(rule.id, wanted.has(rule.id));
    }
  }

  function evaluateAndPublishAlarms(sample: Sample): void {
    if (!alarms) return;
    // Rev258 (Carlos): use `client.healthy` (pong-aware) instead of
    // `client.connected` so alarms see the peer as down as soon as
    // pings stop returning, not 5-10 s later when TCP heartbeat gives
    // up. Also seed `disconnectedSinceMs` from that stricter check so
    // pypilot-disconnected sustain does not wait for the socket-io
    // disconnect event.
    const isHealthy = !!(client && client.healthy);
    if (!isHealthy && disconnectedSinceMs == null) {
      disconnectedSinceMs = Date.now();
    } else if (isHealthy && disconnectedSinceMs != null) {
      disconnectedSinceMs = null;
    }
    const ctx = {
      sample,
      kpis: kpis ? kpis.snapshot() : null,
      quality: sensorQuality ? sensorQuality.snapshot() : null,
      servoHealth: servoHealth ? servoHealth.snapshot() : null,
      connected: isHealthy,
      disconnectedSinceMs,
      nowMs: Date.now(),
      // Rev290 (E2/E3): pass per-install threshold overrides so the
      // rules read from props instead of the module-level RULE_*
      // constants. Fields left undefined fall back to defaults.
      thresholds: {
        lowVoltageV:     props.alarmLowVoltageV,
        servoTempC:      props.alarmServoTempC,
        servoMotorTempC: props.alarmServoMotorTempC,
        attitudeHeelDeg: props.alarmAttitudeHeelDeg,
        attitudePitchDeg: props.alarmAttitudePitchDeg,
      },
      // Rev311 (Carlos sea trial 2026-09-25): flag para las reglas
      // de heading-error / drift / unable-to-steer. Durante una
      // virada nativa de pypilot (ap.tack.state != "none") el error
      // instantáneo es enorme por diseño; silenciamos esas alarmas.
      // `_tackStatePrev` lo mantiene observeTackTransition() al día en
      // el mismo callback de client.on("value"), así que siempre
      // refleja el último valor conocido de pypilot.
      maneuverInProgress: !!(_tackStatePrev && _tackStatePrev !== "none"),
      // Rev323 (Carlos, 2026-09-27): flag pseudo-modo del visor.
      maneuverPseudoActive: _maneuverPseudoActive,
    };
    const changed = alarms.tick(ctx);
    // Rev283: feed the servo error log AFTER the tick so its snapshot
    // reflects the just-evaluated state. Runs unconditionally (cheap)
    // - the log itself decides whether the transition is worth
    // recording.
    if (servoErrorLog) {
      try { servoErrorLog.observeAlarms(alarms.snapshot()); } catch { /* silent */ }
    }
    if (changed.length === 0) return;
    const nowIso = new Date().toISOString();
    const values: { path: string; value: unknown }[] = [];
    for (const id of changed) {
      const s = alarms.ruleState(id);
      if (!s) continue;
      const path = `notifications.autopilot.${id}`;
      if (s.active) {
        const skState = AlarmEngine.skState(s.severity);
        // Ack silences the sound method but keeps the visual banner.
        const method = s.ackedAtMs != null ? ["visual"] : ["visual", "sound"];
        values.push({
          path,
          value: { state: skState, method, message: s.message },
        });
      } else {
        values.push({
          path,
          value: { state: "normal", method: [], message: s.message || "" },
        });
      }
    }
    if (values.length === 0) return;
    try {
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, values }],
      });
    } catch (e: any) {
      app.debug(`[alarms] publish failed: ${e?.message || e}`);
    }
  }

  // Rev99: publish the servo health snapshot as SK paths under
  // steering.autopilot.pypilot.servo.health.*. Meta emitted once on
  // first publish. Emitted on the same 1 Hz cadence as the KPI paths so
  // downstream SK widgets update in sync.
  const SERVO_HEALTH_META: Record<string, { units?: string; description: string }> = {
    "steering.autopilot.pypilot.servo.health.status":         {              description: "Servo health verdict: idle / learning / good / elevated / high." },
    "steering.autopilot.pypilot.servo.health.baselineA":      { units: "A",  description: "Learned baseline servo current (mean of the first ~5-10 min of active navigation)." },
    "steering.autopilot.pypilot.servo.health.recentAvgA":     { units: "A",  description: "Rolling 30 s average of servo current while active." },
    "steering.autopilot.pypilot.servo.health.deviationRatio": { units: "ratio", description: "recentAvgA / baselineA. >=1.20 elevated, >=1.65 high (possible hard rudder, drag, clutch)." },
    "steering.autopilot.pypilot.servo.health.peakA":          { units: "A",  description: "Peak servo current in the last 30 s." },
    "steering.autopilot.pypilot.servo.health.learnedFrac":    { units: "ratio", description: "Baseline learn progress 0..1 (samples so far / target)." },
  };
  function publishServoHealthPaths(): void {
    if (!servoHealth) return;
    const snap: ServoHealthSnapshot = servoHealth.snapshot();
    const values = [
      { path: "steering.autopilot.pypilot.servo.health.status",         value: snap.status },
      { path: "steering.autopilot.pypilot.servo.health.baselineA",      value: snap.baselineA },
      { path: "steering.autopilot.pypilot.servo.health.recentAvgA",     value: snap.recentAvgA },
      { path: "steering.autopilot.pypilot.servo.health.deviationRatio", value: snap.deviationRatio },
      { path: "steering.autopilot.pypilot.servo.health.peakA",          value: snap.peakA },
      { path: "steering.autopilot.pypilot.servo.health.learnedFrac",    value: snap.samplesTargetForLearn > 0 ? snap.samplesLearned / snap.samplesTargetForLearn : null },
    ];
    const nowIso = new Date().toISOString();
    try {
      if (!servoHealthMetaSent) {
        const metaList = Object.entries(SERVO_HEALTH_META).map(([path, m]) => ({ path, value: m }));
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, meta: metaList }],
        });
        servoHealthMetaSent = true;
      }
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, values }],
      });
    } catch (e: any) {
      app.debug(`[servo-health] publish failed: ${e?.message || e}`);
    }
  }

  // Rev97: feed every watched path into the SensorQualityMonitor. Uses
  // app.getSelfPath(path) WITHOUT the ".value" suffix so we get the
  // full SK entry (value + timestamp + source) - the monitor needs the
  // timestamp to dedupe repeated observations of the same underlying
  // sample and to grade jitter honestly.
  function feedSensorQuality(): void {
    if (!sensorQuality) return;
    const now = Date.now();
    // Rev148 (Carlos): feed the primary path AND every alternative the
    // threshold advertises so the monitor can pick the freshest source
    // for that metric (TWS, TWA, ...) instead of failing on the
    // canonical path that most SK setups don't publish.
    for (const [path, thr] of Object.entries(DEFAULT_QUALITY_WATCH)) {
      try {
        const entry = app.getSelfPath(path);
        if (entry) sensorQuality.observe(path, entry, now);
      } catch { /* silent - a missing path stays "missing" naturally */ }
      if (thr.alternatives) {
        for (const alt of thr.alternatives) {
          try {
            const entry = app.getSelfPath(alt);
            if (entry) sensorQuality.observe(alt, entry, now);
          } catch { /* silent */ }
        }
      }
    }
  }

  // Rev95: publish the current KPI snapshot as Signal K paths under
  // steering.autopilot.pypilot.stats.*. Called once per second by the
  // kpiPublishTimer while the plugin is running - any downstream SK
  // client can bind a widget to any of these paths and see the same
  // aggregates the Trip Stats card in the webapp will render.
  //
  // Meta is sent once on the FIRST publish (units + description) so the
  // SK bus never sees duplicates on subsequent ticks.
  const KPI_META: Record<string, { units?: string; description: string }> = {
    "steering.autopilot.pypilot.stats.session.startedTs":       { units: "ms",  description: "Session start timestamp (Unix ms)." },
    "steering.autopilot.pypilot.stats.session.engagedSec":      { units: "s",   description: "Seconds the AP has been engaged this session." },
    "steering.autopilot.pypilot.stats.session.distanceNm":      { units: "nm",  description: "Distance travelled while engaged (nautical miles)." },
    "steering.autopilot.pypilot.stats.session.tacks":           {               description: "Tacks detected this session (AWA sign flip through the bow)." },
    "steering.autopilot.pypilot.stats.session.gybes":           {               description: "Gybes detected this session (AWA sign flip through the stern)." },
    "steering.autopilot.pypilot.stats.session.servoRuntimeSec": { units: "s",   description: "Seconds the servo drew more than the 'on' current threshold." },
    "steering.autopilot.pypilot.stats.session.energyAh":        { units: "Ah",  description: "Amp-hours consumed by the servo this session." },
    "steering.autopilot.pypilot.stats.session.maxServoA":       { units: "A",   description: "Peak servo current seen this session." },
    "steering.autopilot.pypilot.stats.error.meanRad":           { units: "rad", description: "Signed mean heading error over the last 60 s (engaged samples only)." },
    "steering.autopilot.pypilot.stats.error.rmsRad":            { units: "rad", description: "RMS heading error over the last 60 s (engaged samples only)." },
    "steering.autopilot.pypilot.stats.error.p95Rad":            { units: "rad", description: "95th percentile of |error| over the last 60 s (engaged samples only)." },
    "steering.autopilot.pypilot.stats.servo.dutyPct":           { units: "ratio", description: "Fraction of last-60-s samples with servo drawing above threshold (0..1)." },
    // Rev157 (Carlos): derived KPI - energy per distance. Useful as an
    // efficiency indicator on multi-hour passages. Null until session
    // has some distance under its belt (avoids divide-by-zero and
    // spurious huge values on first sample).
    "steering.autopilot.pypilot.stats.session.consumptionAhPerNm": { units: "Ah/nm", description: "Session amp-hour consumption divided by distance travelled (null until distance > 0.1 nm)." },
  };
  function publishKpiPaths(): void {
    if (!kpis) return;
    const snap: KPISnapshot = kpis.snapshot();
    const values: { path: string; value: unknown }[] = [
      { path: "steering.autopilot.pypilot.stats.session.startedTs",       value: snap.session.startedTs },
      { path: "steering.autopilot.pypilot.stats.session.engagedSec",      value: snap.session.engagedSec },
      { path: "steering.autopilot.pypilot.stats.session.distanceNm",      value: snap.session.distanceNm },
      { path: "steering.autopilot.pypilot.stats.session.tacks",           value: snap.session.tacks },
      { path: "steering.autopilot.pypilot.stats.session.gybes",           value: snap.session.gybes },
      { path: "steering.autopilot.pypilot.stats.session.servoRuntimeSec", value: snap.session.servoRuntimeSec },
      { path: "steering.autopilot.pypilot.stats.session.energyAh",        value: snap.session.energyAh },
      { path: "steering.autopilot.pypilot.stats.session.maxServoA",       value: snap.session.maxServoA },
      { path: "steering.autopilot.pypilot.stats.error.meanRad",           value: snap.window1m.meanErrorRad },
      { path: "steering.autopilot.pypilot.stats.error.rmsRad",            value: snap.window1m.rmsErrorRad },
      { path: "steering.autopilot.pypilot.stats.error.p95Rad",            value: snap.window1m.p95ErrorRad },
      { path: "steering.autopilot.pypilot.stats.servo.dutyPct",           value: snap.window1m.servoDutyPct },
      // Rev157: derived KPI. Cheap: two fields we already publish.
      {
        path: "steering.autopilot.pypilot.stats.session.consumptionAhPerNm",
        value: snap.session.distanceNm > 0.1 ? snap.session.energyAh / snap.session.distanceNm : null,
      },
    ];
    const nowIso = new Date().toISOString();
    try {
      if (!kpiMetaSent) {
        const metaList = Object.entries(KPI_META).map(([path, m]) => ({ path, value: m }));
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{
            $source: SOURCE_LABEL,
            timestamp: nowIso,
            meta: metaList,
          }],
        });
        kpiMetaSent = true;
      }
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, values }],
      });
    } catch (e: any) {
      app.debug(`[kpis] publish failed: ${e?.message || e}`);
    }
  }

  // Rev286 (B2): drive the profile advisor from the sampler tick.
  // Publishes a SK notification only on state transitions to avoid
  // flooding — the same idempotency the AlarmEngine uses.
  function tickProfileAdvisor(nowMs: number): void {
    if (!profileAdvisor || !kpis || !props.profileAdvisorEnabled) return;
    const snap = kpis.snapshot();
    const ev: AdvisoryEvent | null = profileAdvisor.onTick(nowMs, {
      rmsErrorRad:   snap.window1m.rmsErrorRad,
      servoDutyPct:  snap.window1m.servoDutyPct,
      engagedSamples: snap.window1m.engagedSamples,
    });
    if (ev) {
      publishProfileAdvisorNotification(ev);
    } else {
      // No new event — but if we previously published an advisory and
      // the cooldown has expired, revert the notification to normal so
      // downstream SK clients stop showing the banner.
      const st = profileAdvisor.status(nowMs);
      if (_profileAdvisorLastPubKind && _profileAdvisorLastPubKind !== "normal" && st.cooldownRemainingMs === 0) {
        publishProfileAdvisorNormal();
      }
    }
  }

  function publishProfileAdvisorNotification(ev: AdvisoryEvent): void {
    if (_profileAdvisorLastPubKind === ev.kind) return;
    _profileAdvisorLastPubKind = ev.kind;
    const nowIso = new Date().toISOString();
    try {
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{
          $source: SOURCE_LABEL,
          timestamp: nowIso,
          values: [{
            path: "notifications.autopilot.pypilot.profileAdvisor",
            value: {
              state: "alert",
              method: ["visual"],
              message: ev.message,
              messageKey: ev.messageKey,
              messageArgs: ev.messageArgs,
              metric: ev.metric,
              kind: ev.kind,
            },
          }],
        }],
      });
    } catch (e: any) {
      app.debug?.(`[advisor] publish failed: ${e?.message || e}`);
    }
  }

  function publishProfileAdvisorNormal(): void {
    if (_profileAdvisorLastPubKind === "normal") return;
    _profileAdvisorLastPubKind = "normal";
    const nowIso = new Date().toISOString();
    try {
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{
          $source: SOURCE_LABEL,
          timestamp: nowIso,
          values: [{
            path: "notifications.autopilot.pypilot.profileAdvisor",
            value: { state: "normal", method: [], message: "" },
          }],
        }],
      });
    } catch { /* silent */ }
    _profileAdvisorMetaSent = _profileAdvisorMetaSent; // keep flag warm
  }

  // Rev282: publish Roll FF diagnostic paths so KIP / freeboard widgets
  // can watch the term without polling the /roll-ff/status endpoint.
  // gain=0 (off) still publishes as 0 so the path is discoverable.
  let rollFfMetaSent = false;
  function publishRollFfPaths(): void {
    if (!rollFf) return;
    const st = rollFf.getState();
    const o = rollFf.getOptions();
    const values = [
      { path: "steering.autopilot.pypilot.tuning.rollFf.gain",         value: o.gain },
      { path: "steering.autopilot.pypilot.tuning.rollFf.tauSec",       value: o.tauSec },
      { path: "steering.autopilot.pypilot.tuning.rollFf.twaGateDeg",   value: o.twaGateDeg },
      { path: "steering.autopilot.pypilot.tuning.rollFf.rollHpRad",    value: st.rollHpRad },
      { path: "steering.autopilot.pypilot.tuning.rollFf.deltaRad",     value: _lastRollFfDeltaRad },
      { path: "steering.autopilot.pypilot.tuning.rollFf.appliedToAp",  value: false },
    ];
    const nowIso = new Date().toISOString();
    try {
      if (!rollFfMetaSent) {
        const meta = [
          { path: "steering.autopilot.pypilot.tuning.rollFf.gain",       value: { description: "Roll FF gain (unitless, output = -gain*rollHp). 0 = off." } },
          { path: "steering.autopilot.pypilot.tuning.rollFf.rollHpRad",  value: { units: "rad", description: "High-pass filtered roll (dynamic component only)." } },
          { path: "steering.autopilot.pypilot.tuning.rollFf.deltaRad",   value: { units: "rad", description: "Feed-forward heading delta this tick. Computed even when disabled — but only non-zero when gain>0, AP engaged, and |TWA| above the gate." } },
          { path: "steering.autopilot.pypilot.tuning.rollFf.appliedToAp",value: { description: "False until a later Rev flips the enable switch after sea trial." } },
        ];
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, meta }],
        });
        rollFfMetaSent = true;
      }
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, values }],
      });
    } catch (e: any) {
      app.debug(`[roll-ff] publish failed: ${e?.message || e}`);
    }
  }

  // Rev298 (H4) → Rev300: publish the leeway estimate on our own
  // namespace instead of the canonical `performance.leeway`. Two
  // reasons: (1) signalk-derived-data already publishes on that
  // canonical path with a different formula and the sailor was
  // seeing a stale 0 from that source instead of our estimate;
  // (2) our value is a plugin-specific derivation, so keeping it
  // under `steering.autopilot.pypilot.derived.*` makes provenance
  // obvious in KIP / Data Browser.
  let leewayMetaSent = false;
  const LEEWAY_PATH = "steering.autopilot.pypilot.derived.leewayRad";
  function publishLeewayDelta(leewayRad: number, tsMs: number): void {
    const nowIso = new Date(tsMs).toISOString();
    try {
      if (!leewayMetaSent) {
        const meta = [
          { path: LEEWAY_PATH, value: {
            units: "rad",
            description: "Estimated leeway (side-slip) angle from the plugin's own estimator. Formula: drift_deg = adj * heel_deg / bsp_kn^2 with adj set by the sailor (Setup → Smart Pilot → Sensor helpers). Positive = drifting to port. Published only when leewayAdjustment > 0. Kept off the canonical performance.leeway path so it does not overwrite signalk-derived-data.",
          }},
        ];
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, meta }],
        });
        leewayMetaSent = true;
      }
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{
          $source: SOURCE_LABEL,
          timestamp: nowIso,
          values: [{ path: LEEWAY_PATH, value: leewayRad }],
        }],
      });
    } catch (e: any) {
      app.debug?.(`[leeway] publish failed: ${e?.message || e}`);
    }
  }

  // Rev299 (I2): publish the current tack catch-up delta as a
  // diagnostic path so downstream SK clients can watch the decay.
  // NOT applied to the pilot yet — the sea trial gates that switch.
  let tackCatchupMetaSent = false;
  function publishTackCatchupPaths(): void {
    if (!tackCatchup) return;
    const o = tackCatchup.getOptions();
    const values = [
      { path: "steering.autopilot.pypilot.tuning.tackCatchup.offsetDeg", value: o.offsetDeg },
      { path: "steering.autopilot.pypilot.tuning.tackCatchup.tauSec",    value: o.tauSec },
      { path: "steering.autopilot.pypilot.tuning.tackCatchup.deltaRad",  value: _lastTackCatchupRad },
      { path: "steering.autopilot.pypilot.tuning.tackCatchup.active",    value: tackCatchup.isActive() },
      { path: "steering.autopilot.pypilot.tuning.tackCatchup.appliedToAp", value: false },
    ];
    const nowIso = new Date().toISOString();
    try {
      if (!tackCatchupMetaSent) {
        const meta = [
          { path: "steering.autopilot.pypilot.tuning.tackCatchup.offsetDeg", value: { units: "deg", description: "Peak catch-up offset applied at tack completion. 0 = module inert." } },
          { path: "steering.autopilot.pypilot.tuning.tackCatchup.tauSec",    value: { units: "s",   description: "Exponential decay time constant of the catch-up offset." } },
          { path: "steering.autopilot.pypilot.tuning.tackCatchup.deltaRad",  value: { units: "rad", description: "Current catch-up delta this tick. Signed: >0 = bear off to stbd, <0 = bear off to port." } },
          { path: "steering.autopilot.pypilot.tuning.tackCatchup.active",    value: { description: "True while a decay is in progress." } },
          { path: "steering.autopilot.pypilot.tuning.tackCatchup.appliedToAp", value: { description: "False until a later Rev flips the enable switch after sea trial." } },
        ];
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, meta }],
        });
        tackCatchupMetaSent = true;
      }
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{ $source: SOURCE_LABEL, timestamp: nowIso, values }],
      });
    } catch (e: any) {
      app.debug?.(`[tack-catchup] publish failed: ${e?.message || e}`);
    }
  }

  // Rev93: parse `?window=30s` / `?window=2m` / `?window=10m` (or plain
  // `?window=90000` ms) into a millisecond value. Anything unparseable
  // falls back to 30 s so a malformed query never returns everything.
  function parseWindowMs(raw: unknown): number {
    if (typeof raw === "number" && isFinite(raw) && raw > 0) return raw;
    if (typeof raw !== "string") return 30_000;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return 30_000;
    const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|min)?$/.exec(trimmed);
    if (!m) return 30_000;
    const n = parseFloat(m[1]);
    if (!isFinite(n) || n <= 0) return 30_000;
    const unit = (m[2] || "s").toLowerCase();
    const mul = unit === "ms" ? 1 : (unit === "m" || unit === "min") ? 60_000 : 1000;
    // Cap to the historian capacity so a huge window does not blow up
    // the JSON payload; historian.slice will trim naturally too.
    return Math.min(n * mul, 60 * 60_000);
  }

  // Rev93: parse `?paths=headingCmd,rudder,servoCurrent` into a typed
  // list. Unknown names are silently dropped so a client asking for a
  // path that does not exist just gets an empty column, no 400.
  const VALID_SAMPLE_PATHS: ReadonlySet<SamplePath> = new Set<SamplePath>([
    "headingCmd", "headingActual", "rudder", "servoCurrent", "servoTemp",
    "servoVoltage", "awa", "aws", "tws", "sog", "heel", "engaged", "mode",
  ]);
  function parseSamplePaths(raw: unknown): SamplePath[] | undefined {
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    const wanted = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const out: SamplePath[] = [];
    for (const w of wanted) {
      if (VALID_SAMPLE_PATHS.has(w as SamplePath)) out.push(w as SamplePath);
    }
    return out.length > 0 ? out : undefined;
  }

  // Rev140 (Carlos): watch policy revamp per Sean D'Epagnier's advice.
  // Instead of subscribing every RangeSetting in the catalog at 1 Hz
  // (which put ~170 permanent watches on pypilot_web), we now keep a
  // MINIMAL permanent set + accept "focus" requests from the visor.
  // The visor bumps a small set of keys to 1-2 Hz only while a tab
  // that shows them is open, and lets the TTL expire when the tab
  // is left. Everything else stays either unwatched or at WATCH_LOW.
  // Rev251 (audit fix 10): each focus entry is now scoped by the
  // requesting client's owner id. Previously the map was flat and
  // /watch/release without keys wiped every visor's subscriptions
  // (tab switch on device A could deafen device B). Structure:
  //   Map<pypilot key, Map<owner id, { period, expireTs }>>
  // At apply time the smallest period across owners wins.
  const _focusWatches = new Map<string, Map<string, { period: number; expireTs: number }>>();
  let _lastAppliedWatches: Record<string, number> = {};
  function _corePeriodFor(name: string, catalog: PypilotCatalog): number | null {
    // Highest-priority state paths - drive the AP status indicator
    // and the SK autopilot API bridge.
    if (name === "ap.enabled") return WATCH_HIGH;
    if (name === "ap.mode") return WATCH_HIGH;
    if (name === "ap.heading_command") return WATCH_HIGH;
    if (name === "servo.engaged") return WATCH_HIGH;
    // Rev191 (Carlos): tack.* paths MUST be watched core. Without a
    // subscribe pypilot never emits them, so the visor never sees the
    // "port|starboard|none" state machine after POST /tack/{dir}. The
    // countdown then hangs at "0 deg" because state.target and heading
    // are still identical - pypilot did (or did not) execute but we
    // have no way to tell. tack.state/direction at 1 Hz is enough for
    // renderTackButton to react; tack.delay/angle are near-static so
    // WATCH_LOW is plenty (visor reads them once via _tackFetchDelaySec).
    if (name === "ap.tack.state" || name === "ap.tack.direction") return WATCH_HIGH;
    if (name === "ap.tack.delay" || name === "ap.tack.angle") return WATCH_LOW;
    // Mid-priority telemetry watched permanently so alarms/servo-health
    // KPIs never see a gap - kept at 1 Hz so the load is modest.
    if (
      name === "servo.voltage" || name === "servo.current" ||
      name === "servo.controller_temp" || name === "servo.motor_temp" ||
      name === "servo.amp_hours"
    ) return WATCH_MED;
    if (name === "imu.warning" || name === "imu.error") return WATCH_MED;
    // Rev155 (Carlos): pypilot exposes its own hardware ceilings as
    // RangeSettings (servo.max_current, .max_motor_temp,
    // .max_controller_temp). Watching them at 10 s gives the Doctor +
    // Alarms free access to "hardware limit" comparisons without
    // asking the user to type them into the plugin config. Almost
    // static so 0.1 Hz is plenty.
    if (
      name === "servo.max_current" ||
      name === "servo.max_motor_temp" ||
      name === "servo.max_controller_temp"
    ) return WATCH_LOW;
    // Rarely-changing metadata used by the visor's Info tab.
    if (name === "ap.pilot" || name === "profile" || name === "profiles" || name === "ap.modes") return WATCH_MED;
    // Everything the user has opted-in to publish (enabledPaths) but
    // is not currently focusing goes at the resting rate - 10 s is
    // enough to reflect a slow-moving telemetry change in downstream
    // SK clients without pinning pypilot_web.
    const en = props.enabledPaths || {};
    if (en[name] === true) return WATCH_LOW;
    // Anything else stays unwatched by default.
    void catalog;
    return null;
  }
  function _applyWatches(c: PypilotClient, catalog: PypilotCatalog): void {
    const now = Date.now();
    const desired: Record<string, number> = {};
    // Rev251 (audit fix 10): sweep expired entries PER OWNER, and drop
    // a key entirely once every owner's entry has expired.
    for (const [name, owners] of _focusWatches.entries()) {
      for (const [ownerId, entry] of owners.entries()) {
        if (entry.expireTs <= now) owners.delete(ownerId);
      }
      if (owners.size === 0) _focusWatches.delete(name);
    }
    // Core paths applied to every catalog member. Rev141 fix: do NOT
    // skip RESERVED_PYPILOT_KEYS here - those are reserved from
    // PUBLISH (to avoid clashing with pypilot-autopilot-provider) but
    // we absolutely need to subscribe to them internally so the mode
    // selector, engage toggle and target heading stay in sync.
    for (const name of Object.keys(catalog)) {
      const p = _corePeriodFor(name, catalog);
      if (p != null) desired[name] = p;
    }
    // Focus wins over core (finer period, i.e. smaller number). With
    // multiple owners on the same key, pick the smallest requested
    // period so the strictest client is honoured.
    for (const [name, owners] of _focusWatches.entries()) {
      let minPeriod = Infinity;
      for (const e of owners.values()) {
        if (e.period < minPeriod) minPeriod = e.period;
      }
      if (!Number.isFinite(minPeriod)) continue;
      const cur = desired[name];
      if (cur == null || minPeriod < cur) desired[name] = minPeriod;
    }
    // Reconcile against last applied set: watch new/changed, unwatch dropped.
    for (const [name, period] of Object.entries(desired)) {
      if (_lastAppliedWatches[name] !== period) c.watch(name, period);
    }
    for (const name of Object.keys(_lastAppliedWatches)) {
      if (!(name in desired)) c.watch(name, false);
    }
    _lastAppliedWatches = desired;
  }
  // Timer that reruns _applyWatches so expiring focuses actually
  // relax the subscription. Runs every 5 s while the plugin is up.
  let watchSweepTimer: NodeJS.Timeout | null = null;
  function _startWatchSweep(c: PypilotClient): void {
    if (watchSweepTimer) return;
    watchSweepTimer = setInterval(() => {
      try { _applyWatches(c, lastCatalog); } catch { /* silent */ }
    }, 5000);
  }
  function _stopWatchSweep(): void {
    if (watchSweepTimer) {
      try { clearInterval(watchSweepTimer); } catch {}
      watchSweepTimer = null;
    }
  }

  function setupWatches(c: PypilotClient, catalog: PypilotCatalog): void {
    _lastAppliedWatches = {};
    _applyWatches(c, catalog);
    _startWatchSweep(c);
  }

  function publishValue(name: string, value: unknown): void {
    if (RESERVED_PYPILOT_KEYS.has(name)) return;
    // Rev23 policy:
    //  - Essential paths (ESSENTIAL_PYPILOT_KEYS) ALWAYS publish.
    //  - Non-essentials: if publishOnlyEssentials, require enabledPaths[name] === true.
    //  - Otherwise (legacy mode): publish unless explicitly false.
    if (!ESSENTIAL_PYPILOT_KEYS.has(name)) {
      const en = props.enabledPaths || {};
      if (props.publishOnlyEssentials) {
        if (en[name] !== true) return;
      } else {
        if (Object.prototype.hasOwnProperty.call(en, name) && en[name] === false) return;
      }
    }
    // Rev63 / 2.0.0: every pypilot key derives to steering.autopilot.pypilot.<key>
    // verbatim (Sean D'Epagnier's suggestion in #1). No conversions, no rename,
    // no hardcoded table - Signal K + downstream consumers handle units.
    const mapping = mappingFor(name, lastCatalog[name]);
    const skValue = value;
    const updateEntry: any = {
      $source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
      values: [{ path: mapping.skPath, value: skValue }],
    };
    // Attach meta INLINE on the first publish of each path. Sending it in a
    // separate delta with empty `values` upsets some third-party plugins
    // (signalk-pushover-plugin@0.0.6 crashes with 'update.values is not
    // iterable' when it iterates a values-empty update).
    if (!metaSent.has(mapping.skPath)) {
      const metaObj = buildMetaObj(mapping, lastCatalog[name]);
      if (metaObj) {
        updateEntry.meta = [{ path: mapping.skPath, value: metaObj }];
      }
      metaSent.add(mapping.skPath);
    }
    // Rev350 (Carlos, 2026-09-29): stage=publish frontier log for the
    // pilot-critical paths so we can measure how long between the
    // provider accepting a value and SK propagating the delta out.
    // Skips high-frequency non-critical values (servo current, imu, ...)
    // to keep the trace signal-to-noise high.
    if (_STAGE_PUBLISH_LOG_PATHS.has(name)) {
      try {
        maneuverTrace?.logStageEvent("publish", {
          pypilotName: name,
          skPath: mapping.skPath,
          value: skValue,
        });
      } catch { /* silent */ }
    }
    try {
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [updateEntry],
      });
      publishedSkPaths.add(mapping.skPath);
      deltaSentCount++;
    } catch (e: any) {
      app.debug(`[publish] handleMessage failed for ${mapping.skPath}: ${e?.message || e}`);
    }
  }
  // Rev350: pypilot names whose publish is worth tracing.
  const _STAGE_PUBLISH_LOG_PATHS: Set<string> = new Set([
    "ap.tack.state",
    "ap.tack.direction",
    "ap.heading_command",
    "ap.mode",
    "ap.enabled",
    "servo.engaged",
  ]);

  function publishCatalogDerived(catalog: PypilotCatalog): void {
    const items = extractCatalogDerivedPublishes(catalog);
    for (const it of items) {
      try {
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{
            $source: SOURCE_LABEL,
            timestamp: new Date().toISOString(),
            values: [{ path: it.skPath, value: it.value }],
            ...(it.displayName ? { meta: [{ path: it.skPath, value: { displayName: it.displayName } }] } : {}),
          }],
        });
        publishedSkPaths.add(it.skPath);
      } catch (e: any) {
        app.debug(`[publish] catalog-derived failed for ${it.skPath}: ${e?.message || e}`);
      }
    }
  }

  function buildMetaObj(mapping: Mapping, catalogEntry: unknown): any | null {
    const metaObj: any = {};
    if (mapping.units) metaObj.units = mapping.units;
    if (mapping.displayName) metaObj.displayName = mapping.displayName;
    if (mapping.description) metaObj.description = mapping.description;
    if (catalogEntry && typeof (catalogEntry as any).min === "number") {
      // Reserved for future zone metadata.
    }
    return Object.keys(metaObj).length ? metaObj : null;
  }

  function registerPutHandlers(catalog: PypilotCatalog): void {
    if (!props.allowWrites) return;
    const registerOne = (skPath: string) => {
      if (putHandlersRegistered.has(skPath)) return;
      const cb = (
        _context: string,
        _path: string,
        value: unknown,
        _callback?: unknown
      ) => {
        if (!client || !client.connected) {
          return { state: "COMPLETED", statusCode: 503, message: "pypilot not connected" };
        }
        const name = skPathToPypilotName(skPath, catalog);
        if (!name) {
          return { state: "COMPLETED", statusCode: 404, message: "unknown path" };
        }
        // Rev63 / 2.0.0: values are surfaced verbatim, so PUT writes verbatim
        // too. No reverse conversion needed - what the consumer sends is what
        // pypilot receives.
        client.set(name, value);
        return { state: "COMPLETED", statusCode: 200 };
      };
      try {
        app.registerPutHandler("vessels.self", skPath, cb, SOURCE_LABEL);
        putHandlersRegistered.add(skPath);
      } catch (e: any) {
        app.debug(`[put] register failed for ${skPath}: ${e?.message || e}`);
      }
    };

    // Register a PUT handler for every catalog key we consider writeable.
    // With verbatim mapping (Rev63) this collapses to a single loop.
    for (const [name, meta] of Object.entries(catalog)) {
      if (RESERVED_PYPILOT_KEYS.has(name)) continue;
      const mapping = mappingFor(name, meta);
      if (mapping.putKind !== "plain") continue;
      registerOne(mapping.skPath);
    }
  }

  // Rev24: dedicated ACTION paths for KIP-friendly PUT buttons.
  // KIP has widgets that PUT a fixed value on click - perfect for +10/+1/AP/Tack buttons.
  // These paths always exist regardless of publishOnlyEssentials.
  function registerActionHandlers(): void {
    const ACTIONS_PREFIX = "steering.autopilot.pypilot.actions";
    const okLog = (path: string, v: unknown) => {
      app.error(`[pypilot-newui ACTION] PUT ${path} value=${JSON.stringify(v)}`);
      return { state: "COMPLETED", statusCode: 200 };
    };
    const ok = { state: "COMPLETED", statusCode: 200 };
    const bad = (msg: string) => ({ state: "COMPLETED", statusCode: 400, message: msg });
    const noConn = () => ({ state: "COMPLETED", statusCode: 503, message: "not connected" });
    // Rev271 (audit R05): writes gate. The single PypilotClient.set()
    // check already refuses the emit, but returning 403 here gives
    // downstream SK clients a legible reason instead of a silent
    // no-op.
    const writesOff = () => ({ state: "COMPLETED", statusCode: 403, message: "allowWrites disabled" });

    // Rev29: downstream SK clients (and OpenPlotter switches) send booleans as 1/0 int or "on"/"off"
    // string, not true/false. Ewelink plugin accepts all of them. We do the same.
    const coerceBool = (v: unknown): boolean | null => {
      if (v === true || v === 1 || v === "1" || v === "on" || v === "true") return true;
      if (v === false || v === 0 || v === "0" || v === "off" || v === "false") return false;
      return null;
    };
    const coerceNum = (v: unknown): number | null => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };

    // ENGAGE - bool. true=engage, false=disengage.
    try {
      app.registerPutHandler("vessels.self", `${ACTIONS_PREFIX}.engage`, (_c: string, _p: string, value: unknown) => {
        if (!props.allowWrites) return writesOff();
        const b = coerceBool(value);
        if (b === null) return bad("value must be boolean-like (true/false/1/0/on/off)");
        if (!client?.connected) return noConn();
        if (apProvider) {
          const iface = apProvider.toProviderInterface() as any;
          if (b) iface.engage(apProvider.deviceId).catch(() => {});
          else iface.disengage(apProvider.deviceId).catch(() => {});
        } else {
          client.set("ap.enabled", b);
        }
        return okLog(`${ACTIONS_PREFIX}.engage`, b);
      }, SOURCE_LABEL);
      putHandlersRegistered.add(`${ACTIONS_PREFIX}.engage`);
    } catch (e: any) { app.debug(`[actions] engage register failed: ${e?.message || e}`); }

    // NUDGE - number, degrees. Adds this delta to the current target.
    try {
      app.registerPutHandler("vessels.self", `${ACTIONS_PREFIX}.nudge`, (_c: string, _p: string, value: unknown) => {
        if (!props.allowWrites) return writesOff();
        const delta = coerceNum(value);
        if (delta === null) return bad("value must be a number in degrees");
        if (!client?.connected) return noConn();
        if (apProvider) {
          const rad = delta * Math.PI / 180;
          const iface = apProvider.toProviderInterface() as any;
          iface.adjustTarget(rad, apProvider.deviceId).catch(() => {});
        } else {
          // Fallback: read current heading_command, add delta, write back.
          const cur = client.getValues()["ap.heading_command"];
          const base = typeof cur === "number" ? cur : 0;
          client.set("ap.heading_command", base + delta);
        }
        return okLog(`${ACTIONS_PREFIX}.nudge`, delta);
      }, SOURCE_LABEL);
      putHandlersRegistered.add(`${ACTIONS_PREFIX}.nudge`);
    } catch (e: any) { app.debug(`[actions] nudge register failed: ${e?.message || e}`); }

    // TACK - string "port" | "starboard" | "cancel".
    try {
      app.registerPutHandler("vessels.self", `${ACTIONS_PREFIX}.tack`, (_c: string, _p: string, value: unknown) => {
        if (!props.allowWrites) return writesOff();
        if (typeof value !== "string") return bad("value must be a string");
        if (!client?.connected) return noConn();
        if (value === "cancel") {
          client.set("ap.tack.state", "none");
          return okLog(`${ACTIONS_PREFIX}.tack`, "cancel");
        }
        if (value !== "port" && value !== "starboard") return bad("value must be port, starboard or cancel");
        if (apProvider) {
          const iface = apProvider.toProviderInterface() as any;
          iface.tack(value, apProvider.deviceId).catch(() => {});
        } else {
          client.set("ap.tack.direction", value);
          client.set("ap.tack.state", "begin");
        }
        return okLog(`${ACTIONS_PREFIX}.tack`, value);
      }, SOURCE_LABEL);
      putHandlersRegistered.add(`${ACTIONS_PREFIX}.tack`);
    } catch (e: any) { app.debug(`[actions] tack register failed: ${e?.message || e}`); }

    // Emit INITIAL VALID VALUES for each action path. KIP filters paths with
    // value:null in its picker because it cannot infer the type. Meta also
    // includes an explicit `type` string so KIP knows without guessing.
    try {
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{
          $source: SOURCE_LABEL,
          timestamp: new Date().toISOString(),
          values: [
            { path: `${ACTIONS_PREFIX}.engage`, value: false },
            { path: `${ACTIONS_PREFIX}.nudge`,  value: 0 },
            { path: `${ACTIONS_PREFIX}.tack`,   value: "none" },
          ],
          meta: [
            { path: `${ACTIONS_PREFIX}.engage`, value: {
                supportsPut: true, type: "boolean", units: "bool",
                displayName: "AP engage (bool)",
                description: "PUT true to engage the autopilot, false to disengage",
              } },
            { path: `${ACTIONS_PREFIX}.nudge`,  value: {
                supportsPut: true, type: "number", units: "deg",
                displayName: "Nudge target (deg)",
                description: "PUT a number in degrees (+10, +1, -1, -10) to shift the AP target",
              } },
            { path: `${ACTIONS_PREFIX}.tack`,   value: {
                supportsPut: true, type: "string", units: "enum",
                enum: ["port", "starboard", "cancel", "none"],
                displayName: "Tack action (string)",
                description: "PUT 'port', 'starboard' or 'cancel' to start or cancel a tack",
              } },
          ],
        }],
      });
    } catch (e: any) { app.debug(`[actions] initial delta failed: ${e?.message || e}`); }

    // Rev30: NUMERIC aliases for engage and tack so KIP's "Numeric Put"
    // widget (which only lists paths of type number in its picker) can
    // drive them from a single widget family. Semantics:
    //   engageInt: PUT 1 to engage, 0 to disengage
    //   tackInt:   PUT 1 to tack port, 2 to tack starboard, 0 to cancel
    try {
      app.registerPutHandler("vessels.self", `${ACTIONS_PREFIX}.engageInt`, (_c: string, _p: string, value: unknown) => {
        if (!props.allowWrites) return writesOff();
        const n = coerceNum(value);
        if (n === null) return bad("value must be 1 (engage) or 0 (disengage)");
        const b = n >= 1;
        if (!client?.connected) return noConn();
        if (apProvider) {
          const iface = apProvider.toProviderInterface() as any;
          if (b) iface.engage(apProvider.deviceId).catch(() => {});
          else iface.disengage(apProvider.deviceId).catch(() => {});
        } else {
          client.set("ap.enabled", b);
        }
        return okLog(`${ACTIONS_PREFIX}.engageInt`, n);
      }, SOURCE_LABEL);
      putHandlersRegistered.add(`${ACTIONS_PREFIX}.engageInt`);
    } catch (e: any) { app.debug(`[actions] engageInt failed: ${e?.message || e}`); }

    try {
      app.registerPutHandler("vessels.self", `${ACTIONS_PREFIX}.tackInt`, (_c: string, _p: string, value: unknown) => {
        if (!props.allowWrites) return writesOff();
        const n = coerceNum(value);
        if (n === null) return bad("value must be 1 (port) / 2 (starboard) / 0 (cancel)");
        if (!client?.connected) return noConn();
        if (n === 0) {
          client.set("ap.tack.state", "none");
          return okLog(`${ACTIONS_PREFIX}.tackInt`, "cancel");
        }
        const dir = n === 1 ? "port" : n === 2 ? "starboard" : null;
        if (!dir) return bad("value must be 1 / 2 / 0");
        if (apProvider) {
          const iface = apProvider.toProviderInterface() as any;
          iface.tack(dir, apProvider.deviceId).catch(() => {});
        } else {
          client.set("ap.tack.direction", dir);
          client.set("ap.tack.state", "begin");
        }
        return okLog(`${ACTIONS_PREFIX}.tackInt`, dir);
      }, SOURCE_LABEL);
      putHandlersRegistered.add(`${ACTIONS_PREFIX}.tackInt`);
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{
          $source: SOURCE_LABEL,
          timestamp: new Date().toISOString(),
          values: [
            { path: `${ACTIONS_PREFIX}.engageInt`, value: 0 },
            { path: `${ACTIONS_PREFIX}.tackInt`,   value: 0 },
          ],
          meta: [
            { path: `${ACTIONS_PREFIX}.engageInt`, value: {
              supportsPut: true, type: "number", units: "bool",
              displayName: "AP engage (int)",
              description: "PUT 1 to engage, 0 to disengage. Numeric alias for KIP's Numeric Put widget.",
            } },
            { path: `${ACTIONS_PREFIX}.tackInt`, value: {
              supportsPut: true, type: "number", units: "enum",
              displayName: "Tack (int)",
              description: "PUT 1 to tack to port, 2 to starboard, 0 to cancel. Numeric alias for KIP's Numeric Put widget.",
            } },
          ],
        }],
      });
    } catch (e: any) { app.debug(`[actions] tackInt failed: ${e?.message || e}`); }

    // Rev26: alias the AP engage bool under electrical.switches.* so KIP's
    // "Simple Switch" widget (which filters paths by that prefix) finds it.
    // The alias points to the SAME action - the PUT handler here proxies to
    // .actions.engage. Kip lists this instantly under any switch selector.
    const SW_ENGAGE = "electrical.switches.pypilot.ap.state";
    try {
      app.registerPutHandler("vessels.self", SW_ENGAGE, (_c: string, _p: string, value: unknown) => {
        if (!props.allowWrites) return writesOff();
        const b = coerceBool(value);
        if (b === null) return bad("value must be boolean-like");
        if (!client?.connected) return noConn();
        if (apProvider) {
          const iface = apProvider.toProviderInterface() as any;
          if (b) iface.engage(apProvider.deviceId).catch(() => {});
          else iface.disengage(apProvider.deviceId).catch(() => {});
        } else {
          client.set("ap.enabled", b);
        }
        // Mirror the new state into the switch value so KIP's toggle reflects it.
        try {
          app.handleMessage(PLUGIN_ID, {
            context: "vessels." + app.selfId,
            updates: [{
              $source: SOURCE_LABEL,
              timestamp: new Date().toISOString(),
              values: [{ path: SW_ENGAGE, value: b ? 1 : 0 }],
            }],
          });
        } catch { /* silent */ }
        return okLog(SW_ENGAGE, b);
      }, SOURCE_LABEL);
      putHandlersRegistered.add(SW_ENGAGE);
      // Rev29: emit initial value as INTEGER 1/0, matching OpenPlotter/Sonoff
      // convention. KIP's Simple Switch widget expects 1/0, not true/false.
      app.handleMessage(PLUGIN_ID, {
        context: "vessels." + app.selfId,
        updates: [{
          $source: SOURCE_LABEL,
          timestamp: new Date().toISOString(),
          values: [{ path: SW_ENGAGE, value: 0 }],
          meta: [{ path: SW_ENGAGE, value: {
            supportsPut: true, type: "boolean", units: "bool",
            displayName: "AP engage switch",
            description: "AP engage switch. PUT 1 to engage the autopilot, 0 to disengage. Accepts boolean, 1/0, 'on'/'off' or 'true'/'false'.",
          } }],
        }],
      });
    } catch (e: any) { app.debug(`[actions] switch alias register failed: ${e?.message || e}`); }

    // Rev33: momentary boolean switches under electrical.switches.pypilot.* .
    // KIP has no "Numeric Put" widget - its Simple Switch only writes booleans.
    // So each concrete action (+10, +1, -1, -10, tack port/star/cancel) needs
    // its own boolean path. PUT true triggers the action, then we emit false
    // ~200 ms later so the KIP toggle springs back and can be pressed again.
    const SW_NUDGE_PREFIX = "electrical.switches.pypilot.nudge";
    const SW_TACK_PREFIX  = "electrical.switches.pypilot.tack";
    const momentaryPaths: string[] = [];

    const registerMomentaryBool = (skPath: string, displayName: string, action: () => void) => {
      try {
        app.registerPutHandler("vessels.self", skPath, (_c: string, _p: string, value: unknown) => {
          if (!props.allowWrites) return writesOff();
          const b = coerceBool(value);
          if (b === null) return bad("value must be boolean-like");
          if (!client?.connected) return noConn();
          if (b) {
            try { action(); } catch (e: any) { app.error(`[actions] ${skPath} action failed: ${e?.message || e}`); }
            // Auto-reset to false so the KIP switch returns to OFF and can be
            // pressed again. 200 ms is enough for the round-trip to be visible.
            setTimeout(() => {
              try {
                app.handleMessage(PLUGIN_ID, {
                  context: "vessels." + app.selfId,
                  updates: [{
                    $source: SOURCE_LABEL,
                    timestamp: new Date().toISOString(),
                    values: [{ path: skPath, value: false }],
                  }],
                });
              } catch { /* silent */ }
            }, 200);
          }
          return okLog(skPath, b);
        }, SOURCE_LABEL);
        putHandlersRegistered.add(skPath);
        momentaryPaths.push(skPath);
        // Initial value + meta so KIP's picker sees the path immediately.
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{
            $source: SOURCE_LABEL,
            timestamp: new Date().toISOString(),
            values: [{ path: skPath, value: false }],
            meta: [{ path: skPath, value: {
              supportsPut: true, type: "boolean", units: "bool",
              displayName,
              description: `Momentary switch. PUT true to trigger; auto-resets to false in 200 ms so the KIP toggle can be pressed again.`,
            } }],
          }],
        });
      } catch (e: any) { app.debug(`[actions] momentary ${skPath} register failed: ${e?.message || e}`); }
    };

    // Nudge helper: applies delta degrees to ap.heading_command using the same
    // logic as the numeric .actions.nudge handler above.
    const doNudge = (delta: number) => {
      if (!client) return;
      if (apProvider) {
        const rad = delta * Math.PI / 180;
        const iface = apProvider.toProviderInterface() as any;
        iface.adjustTarget(rad, apProvider.deviceId).catch(() => {});
      } else {
        const cur = client.getValues()["ap.heading_command"];
        const base = typeof cur === "number" ? cur : 0;
        client.set("ap.heading_command", base + delta);
      }
    };
    registerMomentaryBool(`${SW_NUDGE_PREFIX}.plus10`,  "Nudge +10", () => doNudge(+10));
    registerMomentaryBool(`${SW_NUDGE_PREFIX}.plus1`,   "Nudge +1",  () => doNudge(+1));
    registerMomentaryBool(`${SW_NUDGE_PREFIX}.minus1`,  "Nudge -1",  () => doNudge(-1));
    registerMomentaryBool(`${SW_NUDGE_PREFIX}.minus10`, "Nudge -10", () => doNudge(-10));

    // Tack helper: same two-write sequence as .actions.tack above.
    const doTack = (direction: "port" | "starboard") => {
      if (!client) return;
      if (apProvider) {
        const iface = apProvider.toProviderInterface() as any;
        iface.tack(direction, apProvider.deviceId).catch(() => {});
      } else {
        client.set("ap.tack.direction", direction);
        client.set("ap.tack.state", "begin");
      }
    };
    const doTackCancel = () => {
      if (!client) return;
      client.set("ap.tack.state", "none");
    };
    registerMomentaryBool(`${SW_TACK_PREFIX}.port`,      "Tack Port",      () => doTack("port"));
    registerMomentaryBool(`${SW_TACK_PREFIX}.starboard`, "Tack Starboard", () => doTack("starboard"));
    registerMomentaryBool(`${SW_TACK_PREFIX}.cancel`,    "Tack Cancel",    () => doTackCancel());

    // Rev34: mode switches under electrical.switches.pypilot.mode.* .
    // Unlike nudge/tack these are NOT momentary - they behave as a radio
    // group so KIP shows which mode is currently active. Only one is true
    // at a time; PUTting true on one sets pypilot's ap.mode and the others
    // flip to false when the mode confirmation comes back from pypilot.
    const SW_MODE_PREFIX = "electrical.switches.pypilot.mode";
    // Each entry maps the URL-safe SK path key to the pypilot mode string.
    // "true wind" has a space, so its path is trueWind (camelCase).
    const SW_MODE_MAP: Array<{ key: string; py: string; label: string }> = [
      { key: "compass",  py: "compass",    label: "Mode Compass"    },
      { key: "gps",      py: "gps",        label: "Mode GPS"        },
      { key: "wind",     py: "wind",       label: "Mode Wind"       },
      { key: "trueWind", py: "true wind",  label: "Mode True Wind"  },
    ];
    const swModePathOf = (key: string) => `${SW_MODE_PREFIX}.${key}`;
    // emitModeSwitches broadcasts the current mode state as a radio group.
    // Called from pushAutopilotUpdate() and the keep-alive so KIP always
    // reflects the truth on the wire.
    const emitModeSwitches = (activePy: string | null) => {
      try {
        const values = SW_MODE_MAP.map((m) => ({
          path: swModePathOf(m.key),
          value: activePy === m.py,
        }));
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{
            $source: SOURCE_LABEL,
            timestamp: new Date().toISOString(),
            values,
          }],
        });
      } catch { /* silent */ }
    };
    (app as any)._pypilotNewuiEmitModeSwitches = emitModeSwitches;
    for (const m of SW_MODE_MAP) {
      const skPath = swModePathOf(m.key);
      try {
        app.registerPutHandler("vessels.self", skPath, (_c: string, _p: string, value: unknown) => {
          if (!props.allowWrites) return writesOff();
          const b = coerceBool(value);
          if (b === null) return bad("value must be boolean-like");
          if (!client?.connected) return noConn();
          // PUT false on a radio switch is a no-op: modes cannot be
          // "turned off" individually, only replaced by picking another.
          if (!b) return okLog(skPath, false);
          if (apProvider) {
            const iface = apProvider.toProviderInterface() as any;
            iface.setMode(m.py, apProvider.deviceId).catch(() => {});
          } else {
            client.set("ap.mode", m.py);
          }
          // Optimistically flip the radio group now so the KIP UI feels
          // instant. When pypilot confirms via receiveValue('ap.mode',...),
          // pushAutopilotUpdate() re-emits the true state a fraction later.
          emitModeSwitches(m.py);
          return okLog(skPath, m.py);
        }, SOURCE_LABEL);
        putHandlersRegistered.add(skPath);
        // Initial value: false unless pypilot has already told us the mode.
        const currentPy = apProvider?.data?.mode ?? null;
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{
            $source: SOURCE_LABEL,
            timestamp: new Date().toISOString(),
            values: [{ path: skPath, value: currentPy === m.py }],
            meta: [{ path: skPath, value: {
              supportsPut: true, type: "boolean", units: "bool",
              displayName: m.label,
              description: `PUT true to switch pypilot to ${m.py} mode. Radio-group behavior: only one of the mode.* switches is true at any time. PUT false is ignored.`,
            } }],
          }],
        });
      } catch (e: any) { app.debug(`[actions] mode switch ${skPath} register failed: ${e?.message || e}`); }
    }

    // Rev38: dynamic profile switches under electrical.switches.pypilot.profile.* .
    // Profiles are user-defined and change at runtime (add/remove/rename),
    // so we cannot enumerate them at boot. Instead we hook into the value
    // stream: when 'profiles' arrives (list of names), we register one
    // boolean radio switch per profile; when 'profile' arrives (active
    // name), we broadcast which switch is currently true. Only one is true.
    const SW_PROFILE_PREFIX = "electrical.switches.pypilot.profile";
    const profileSwitchKey = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_") || "unnamed";
    const profileSwitchPath = (s: string) => `${SW_PROFILE_PREFIX}.${profileSwitchKey(s)}`;
    let profilesList: string[] = [];
    let activeProfile: string | null = null;
    const registeredProfileSwitches: Set<string> = new Set();
    const emitProfileSwitches = () => {
      if (!profilesList.length) return;
      try {
        const values = profilesList.map((p) => ({
          path: profileSwitchPath(p),
          value: activeProfile != null && p === activeProfile,
        }));
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{
            $source: SOURCE_LABEL,
            timestamp: new Date().toISOString(),
            values,
          }],
        });
      } catch { /* silent */ }
    };
    const ensureProfileSwitchHandler = (profileName: string) => {
      const skPath = profileSwitchPath(profileName);
      if (registeredProfileSwitches.has(skPath) || putHandlersRegistered.has(skPath)) return;
      try {
        app.registerPutHandler("vessels.self", skPath, (_c: string, _p: string, value: unknown) => {
          if (!props.allowWrites) return writesOff();
          const b = coerceBool(value);
          if (b === null) return bad("value must be boolean-like");
          if (!client?.connected) return noConn();
          // PUT false on a radio switch is a no-op: profiles cannot be
          // "turned off" individually, only replaced by picking another.
          if (!b) return okLog(skPath, false);
          if (!profilesList.includes(profileName)) {
            return bad(`profile "${profileName}" no longer exists`);
          }
          try { profileChangeLog.markPlannedWrite(profileName, "user", "SK PUT handler (radio switch)"); }
          catch { /* silent */ }
          client.set("profile", profileName);
          // Optimistic radio flip; the confirmation delta will re-emit
          // authoritatively when pypilot echoes the new 'profile' value.
          activeProfile = profileName;
          emitProfileSwitches();
          return okLog(skPath, profileName);
        }, SOURCE_LABEL);
        putHandlersRegistered.add(skPath);
        registeredProfileSwitches.add(skPath);
        // Initial value + meta so KIP's picker sees the path immediately.
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{
            $source: SOURCE_LABEL,
            timestamp: new Date().toISOString(),
            values: [{ path: skPath, value: activeProfile === profileName }],
            meta: [{ path: skPath, value: {
              supportsPut: true, type: "boolean", units: "bool",
              displayName: `Profile: ${profileName}`,
              description: `PUT true to activate pypilot profile "${profileName}". Radio-group behavior: only one profile.* switch is true at a time. PUT false is ignored.`,
            } }],
          }],
        });
      } catch (e: any) { app.debug(`[actions] profile switch ${skPath} register failed: ${e?.message || e}`); }
    };
    // Hook invoked from client.on('value') above. Handles both 'profiles'
    // (array of names) and 'profile' (currently active name) updates.
    (app as any)._pypilotNewuiProfileHook = (name: string, value: unknown) => {
      if (name === "profiles" && Array.isArray(value)) {
        const next = value.map(String);
        profilesList = next;
        for (const p of next) ensureProfileSwitchHandler(p);
        emitProfileSwitches();
      } else if (name === "profile" && typeof value === "string") {
        // Rev296 (bug D): log the change with attribution.
        try { profileChangeLog.observeDelta(value); } catch { /* silent */ }
        activeProfile = value;
        // If pypilot revealed a profile name we did not yet know about,
        // register it lazily so KIP still sees the switch immediately.
        if (!profilesList.includes(value)) {
          profilesList = [...profilesList, value];
          ensureProfileSwitchHandler(value);
        }
        emitProfileSwitches();
      }
    };
    // Helper for the keep-alive so it can re-emit the profile switches.
    (app as any)._pypilotNewuiEmitProfileSwitches = emitProfileSwitches;

    // Keep them alive: some KIP versions expire paths that stop receiving
    // updates. Republish the current values every 30 s so they never drop
    // out of the model. Rev27: ALSO republish the canonical Autopilot API
    // paths (state/mode/target/engaged/availableActions) so those show up
    // in the SK tree even when pypilot has not emitted an ap.enabled/mode
    // change since restart.
    const keepAlive = setInterval(() => {
      try {
        const engaged = apProvider?.data?.engaged ?? false;
        const values: any[] = [
          { path: `${ACTIONS_PREFIX}.engage`, value: engaged },
          { path: `${ACTIONS_PREFIX}.nudge`,  value: 0 },
          { path: `${ACTIONS_PREFIX}.tack`,   value: apProvider?.data ? ((apProvider.data.options.actions.find((a) => a.id === "tack")?.available) ? "ready" : "none") : "none" },
          { path: SW_ENGAGE,                  value: engaged },
        ];
        // Rev33: keep the momentary boolean switches alive at value=false so
        // KIP does not drop them from its picker after a period of idleness.
        for (const p of momentaryPaths) values.push({ path: p, value: false });
        // Rev34: keep the mode radio switches alive with the current mode
        // reflected so KIP does not expire them and always shows the truth.
        const currentModePy = apProvider?.data?.mode ?? null;
        for (const m of SW_MODE_MAP) {
          values.push({ path: swModePathOf(m.key), value: currentModePy === m.py });
        }
        // Rev38: keep the profile radio switches alive too.
        try {
          const emitP = (app as any)._pypilotNewuiEmitProfileSwitches as
            (() => void) | undefined;
          if (emitP) emitP();
        } catch { /* silent */ }
        // Rev352 (Carlos, 2026-09-30, trace analysis): removed the
        // steering.autopilot.* canonical paths from this 30-s keep-
        // alive. Reason: subscription manager already keeps them
        // resident for subscribers; re-emitting the CURRENT
        // apProvider.data value periodically produced double-pushes
        // that raced with the real change delta and got collapsed by
        // minPeriod:500 on the visor's subscription — the sailor saw
        // engaged=false held for ~10 s after an external engage.
        // The KIP-specific momentary + mode radio + engage switch
        // values still ship (KIP UI needs them refreshed to stay in
        // its picker).
        app.handleMessage(PLUGIN_ID, {
          context: "vessels." + app.selfId,
          updates: [{
            $source: SOURCE_LABEL,
            timestamp: new Date().toISOString(),
            values,
          }],
        });
      } catch { /* silent */ }
    }, 30_000);
    // Track it so plugin.stop() cleans up (we do not currently, but a leak
    // here would leave the interval running past a plugin restart).
    (app as any)._pypilotNewuiKeepAlive = keepAlive;
  }

  return plugin;
};
