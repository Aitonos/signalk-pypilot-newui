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
import { SessionRecorder, SessionSample, SessionTags } from "./session-recorder";

// Rev counter bumped on every build so the user can distinguish deploys
// from the webapp header (feedback_revision_bump_each_build).
const PLUGIN_REVISION = "Rev145";

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
  // Rev100: Alarm engine + pypilot disconnect timestamp used by the
  // pypilot-disconnected rule.
  let alarms: AlarmEngine | null = null;
  let disconnectedSinceMs: number | null = null;
  // Rev103: Doctor engine (holds one active diagnostic session at a time).
  let doctor: DoctorEngine | null = null;
  // Rev143 (Carlos): navigation session recorder. Persists engaged
  // sessions labelled by conditions to disk so I (Claude) can analyse
  // them offline and inject boat-specific tuning heuristics in a
  // future Rev. See src/session-recorder.ts.
  let sessionRecorder: SessionRecorder | null = null;
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
            "When on, this plugin registers itself as the SK Autopilot Provider (WilhelmSK, freeboard, etc. control it via /signalk/v2/api/vessels/self/autopilots). REQUIRES you to disable the official 'pypilot-autopilot-provider' plugin at the same time - otherwise both fight for the deviceId. Benefit: only one socket to pypilot_web (halves the load on a Pi Zero TinyPilot).",
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
          const changed = apProvider.receiveValue(name, value);
          if (changed) pushAutopilotUpdate();
        }
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
            // then so JS + KIP + WilhelmSK snap without waiting for the
            // pypilot echo round-trip.
            // Rev84: forward the field mask ("engaged" / "target" /
            // "all") so pushAutopilotUpdate filters the emitted delta
            // paths accordingly.
            onDataChanged: (fields) => pushAutopilotUpdate(fields),
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
      servoHealth = new ServoHealthMonitor();
      // Rev100: Alarm engine. Evaluates 7 built-in rules against every
      // tick + snapshot from the KPI computer + Sensor Quality + Servo
      // Health. Rules that fire publish canonical SK notifications and
      // land in /alarms/state for the visor banner.
      alarms = new AlarmEngine();
      // Rev103: Pypilot Doctor engine. Starts an idle instance;
      // sessions are triggered on demand via /doctor/start.
      doctor = new DoctorEngine(historian, client);
      // Rev143: session recorder wired into the historian tick so we
      // share the same 1 Hz cadence and the same collectSample() call.
      sessionRecorder = new SessionRecorder({
        dataDir: (app.getDataDirPath ? app.getDataDirPath() : "."),
        log: (level: string, msg: string) => { try { (app as any).debug?.(`${level} ${msg}`); } catch {} },
      });
      historian.start(() => {
        const s = collectSample();
        // Update session counters BEFORE the sample lands in the buffer -
        // KPIComputer.onSample is O(1) so this stays cheap on Pi 4.
        if (kpis) { try { kpis.onSample(s); } catch { /* silent */ } }
        if (servoHealth) { try { servoHealth.onSample(s); } catch { /* silent */ } }
        // Rev97: also feed the quality monitor. Reading each watched
        // path costs one getSelfPath() call, cheap on Pi 4.
        if (sensorQuality) { try { feedSensorQuality(); } catch { /* silent */ } }
        // Rev143: session recorder gets a copy of this tick's sample
        // when the AP is engaged. Engage/disengage transitions open
        // and close a JSONL file.
        if (props.sessionRecorderEnabled) { try { _sessionTick(s); } catch { /* silent */ } }
        // Rev100: run the alarm engine last so it has every input up to
        // date. Changed rules trigger SK notification deltas.
        try { evaluateAndPublishAlarms(s); } catch { /* silent */ }
        return s;
      });
      kpiPublishTimer = setInterval(() => {
        try { publishKpiPaths(); } catch { /* silent */ }
        try { publishServoHealthPaths(); } catch { /* silent */ }
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
      // Rev97: drop the sensor quality monitor (its ring buffers go with it).
      sensorQuality = null;
      // Rev99: drop the servo health monitor (its EWMA baseline resets
      // on plugin restart - persistence lands with the disk snapshots).
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
      if (sessionSampleTimer) {
        try { clearInterval(sessionSampleTimer); } catch {}
        sessionSampleTimer = null;
      }
      lastEngagedState = false;
      // Rev103: cancel any in-flight diagnostic session and drop the doctor.
      if (doctor) { try { doctor.cancel(); } catch { /* silent */ } }
      doctor = null;
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
          // that KIP/WilhelmSK poll frequently.
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
        res.json(sensorQuality.snapshot());
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
        if (!props.allowDirectServo && name === "servo.command") {
          return res.status(403).json({ error: "servo.command requires allowDirectServo" });
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

      router.post("/pause", (_req: any, res: any) => {
        try {
          client?.pause();
          app.setPluginStatus(`${PLUGIN_REVISION} - paused (manual)`);
          res.json({ ok: true, state: "paused" });
        } catch (e: any) {
          res.status(500).json({ error: e?.message || String(e) });
        }
      });
      router.post("/resume", (_req: any, res: any) => {
        try {
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
            for (const l of fresh) newLines.push(`[${src.split("/").pop()}] ${l}`);
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
        } catch (e: any) {
          logCaptureLastError = e?.message || String(e);
        }
      }
      function _lcStart(): void {
        if (logCaptureTimer) return;
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
        });
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
        const expireTs = Date.now() + ttl * 1000;
        for (const k of keys) {
          // Rev141: reserved keys can also be focused (see _applyWatches
          // comment). Reserved means "do not republish", not "do not
          // subscribe".
          _focusWatches.set(k, { period, expireTs });
        }
        if (client) {
          try { _applyWatches(client, lastCatalog); } catch { /* silent */ }
        }
        res.json({ ok: true, focused: keys.length, periodSec: period, ttlSec: ttl });
      });
      router.post("/watch/release", (req: any, res: any) => {
        const body = req.body || {};
        const keys: string[] = Array.isArray(body.keys) ? body.keys : [];
        if (keys.length === 0) {
          _focusWatches.clear();
        } else {
          for (const k of keys) _focusWatches.delete(k);
        }
        if (client) {
          try { _applyWatches(client, lastCatalog); } catch { /* silent */ }
        }
        res.json({ ok: true, remaining: _focusWatches.size });
      });
      router.get("/watch/status", (_req: any, res: any) => {
        const now = Date.now();
        const focus: Array<{ key: string; periodSec: number; expiresInSec: number }> = [];
        for (const [key, e] of _focusWatches.entries()) {
          focus.push({ key, periodSec: e.period, expiresInSec: Math.max(0, Math.floor((e.expireTs - now) / 1000)) });
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

      // Rev66 / 2.0.4: reconnection watchdog. If the socket has been
      // disconnected for > 90 s (much longer than any legitimate
      // pypilot_web restart), force a pause+resume to kick socket.io out
      // of whatever state it got stuck in. Anti-loop: at most 3 forced
      // reconnects in a rolling 15-min window - after that we stop
      // trying automatically so a permanently-dead pypilot_web does
      // not turn into a local DDoS.
      // Rev66 / 2.0.4: watchdog tick every 60 s (was 30 s). The Pi Zero
      // running pypilot is fragile so we minimise every recurring
      // operation - a check that took 30 s worth of wakeups now takes 60 s.
      // Combined with the >90 s "down" threshold, the watchdog only ever
      // acts when the socket has been dead for a while, not on transient
      // Tailscale hiccups.
      let _wdogDisconnectSince: number | null = null;
      let _wdogForcedAttempts: number[] = [];   // timestamps of forced reconnects
      const _wdogTimer = setInterval(() => {
        try {
          if (client?.connected) {
            _wdogDisconnectSince = null;
            return;
          }
          if (_wdogDisconnectSince == null) {
            _wdogDisconnectSince = Date.now();
            return;
          }
          const downMs = Date.now() - _wdogDisconnectSince;
          if (downMs < 90_000) return;
          // Prune attempts older than 15 min.
          const cutoff = Date.now() - 15 * 60_000;
          _wdogForcedAttempts = _wdogForcedAttempts.filter((t) => t > cutoff);
          if (_wdogForcedAttempts.length >= 3) return;
          _wdogForcedAttempts.push(Date.now());
          _wdogDisconnectSince = Date.now();   // reset the timer for the next check
          app.debug(`[watchdog] socket down ${(downMs/1000)|0}s - forcing pause+resume (attempt ${_wdogForcedAttempts.length}/3 in 15 min)`);
          doReconnect();
        } catch { /* silent */ }
      }, 60_000);
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
    };
  }

  function pushAutopilotUpdate(fields: "engaged" | "target" | "all" = "all"): void {
    if (!apProvider) return;
    try {
      // Push structured update through the Autopilot API (WilhelmSK etc.).
      // The App API accepts partial updates - only include changed fields
      // so a target-only or engaged-only notify does not overwrite the
      // sibling field's provider-visible value with a stale copy.
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
    if (values.length === 0) return;
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
  function _sessionTick(s: Sample): void {
    if (!sessionRecorder) return;
    const engagedNow = !!s.engaged;
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
      const hdgErr = (typeof s.headingCmd === "number" && typeof s.headingActual === "number")
        ? _wrapPi(s.headingCmd - s.headingActual)
        : null;
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
        twa: null,
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
      servoVoltage:  servoV,
      awa:           skNum("environment.wind.angleApparent"),
      aws:           skNum("environment.wind.speedApparent"),
      tws:           skNum("environment.wind.speedTrue"),
      sog:           skNum("navigation.speedOverGround"),
      heel:          skAttitudeField("roll"),
      engaged,
      mode,
    };
  }

  // Rev100: evaluate the alarm engine on this tick and publish SK
  // notifications for any rule whose state changed. Notifications
  // follow the canonical SK format under notifications.autopilot.<id>
  // with state / method / message so WilhelmSK, KIP, and any other
  // client honour them out of the box.
  function evaluateAndPublishAlarms(sample: Sample): void {
    if (!alarms) return;
    const ctx = {
      sample,
      kpis: kpis ? kpis.snapshot() : null,
      quality: sensorQuality ? sensorQuality.snapshot() : null,
      servoHealth: servoHealth ? servoHealth.snapshot() : null,
      connected: !!(client && client.connected),
      disconnectedSinceMs,
      nowMs: Date.now(),
    };
    const changed = alarms.tick(ctx);
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
  // downstream WilhelmSK / KIP widgets update in sync.
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
    for (const path of Object.keys(DEFAULT_QUALITY_WATCH)) {
      try {
        const entry = app.getSelfPath(path);
        if (entry) sensorQuality.observe(path, entry, now);
      } catch { /* silent - a missing path stays "missing" naturally */ }
    }
  }

  // Rev95: publish the current KPI snapshot as Signal K paths under
  // steering.autopilot.pypilot.stats.*. Called once per second by the
  // kpiPublishTimer while the plugin is running - a KIP or WilhelmSK
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
  const _focusWatches = new Map<string, { period: number; expireTs: number }>();
  let _lastAppliedWatches: Record<string, number> = {};
  function _corePeriodFor(name: string, catalog: PypilotCatalog): number | null {
    // Highest-priority state paths - drive the AP status indicator
    // and the SK autopilot API bridge.
    if (name === "ap.enabled") return WATCH_HIGH;
    if (name === "ap.mode") return WATCH_HIGH;
    if (name === "ap.heading_command") return WATCH_HIGH;
    if (name === "servo.engaged") return WATCH_HIGH;
    // Mid-priority telemetry watched permanently so alarms/servo-health
    // KPIs never see a gap - kept at 1 Hz so the load is modest.
    if (
      name === "servo.voltage" || name === "servo.current" ||
      name === "servo.controller_temp" || name === "servo.motor_temp" ||
      name === "servo.amp_hours"
    ) return WATCH_MED;
    if (name === "imu.warning" || name === "imu.error") return WATCH_MED;
    // Rarely-changing metadata used by the visor's Info tab.
    if (name === "ap.pilot" || name === "profile" || name === "profiles" || name === "ap.modes") return WATCH_MED;
    // Everything the user has opted-in to publish (enabledPaths) but
    // is not currently focusing goes at the resting rate - 10 s is
    // enough to reflect a slow-moving telemetry change in KIP /
    // WilhelmSK without pinning pypilot_web.
    const en = props.enabledPaths || {};
    if (en[name] === true) return WATCH_LOW;
    // Anything else stays unwatched by default.
    void catalog;
    return null;
  }
  function _applyWatches(c: PypilotClient, catalog: PypilotCatalog): void {
    const now = Date.now();
    const desired: Record<string, number> = {};
    // Sweep expired focuses first.
    for (const [name, entry] of _focusWatches.entries()) {
      if (entry.expireTs <= now) _focusWatches.delete(name);
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
    // Focus wins over core (finer period, i.e. smaller number).
    for (const [name, entry] of _focusWatches.entries()) {
      const cur = desired[name];
      if (cur == null || entry.period < cur) desired[name] = entry.period;
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

    // Rev29: KIP (and OpenPlotter switches) send booleans as 1/0 int or "on"/"off"
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
          const b = coerceBool(value);
          if (b === null) return bad("value must be boolean-like");
          if (!client?.connected) return noConn();
          // PUT false on a radio switch is a no-op: profiles cannot be
          // "turned off" individually, only replaced by picking another.
          if (!b) return okLog(skPath, false);
          if (!profilesList.includes(profileName)) {
            return bad(`profile "${profileName}" no longer exists`);
          }
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
        if (apProvider) {
          values.push(
            { path: "steering.autopilot.state",   value: apProvider.data.state },
            { path: "steering.autopilot.mode",    value: apProvider.data.mode },
            { path: "steering.autopilot.target",  value: apProvider.data.target },
            { path: "steering.autopilot.engaged", value: engaged },
            { path: "steering.autopilot.availableActions",
              value: apProvider.data.options.actions.filter((a) => a.available).map((a) => a.id) },
          );
        }
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
