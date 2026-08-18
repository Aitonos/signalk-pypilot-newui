import { PypilotClient, PypilotCatalog } from "./pypilot-client";
import {
  ESSENTIAL_PYPILOT_KEYS,
  FIXED_MAPPINGS,
  RESERVED_PYPILOT_KEYS,
  autoMap,
  convertForSK,
  extractCatalogDerivedPublishes,
  mapDynamicName,
  Mapping,
  skPathToPypilotName,
} from "./publisher";
import { scanLan } from "./scanner";
import { AutopilotProvider } from "./autopilot-provider";

// Rev counter bumped on every build so the user can distinguish deploys
// from the webapp header (feedback_revision_bump_each_build).
const PLUGIN_REVISION = "Rev33";

const PLUGIN_ID = "signalk-pypilot-newui";
const SOURCE_LABEL = "pypilot-newui";

// Default watch periods per rate class. NEVER `true` (event-driven) - on
// the Tunatunes Pi Zero W hosting pypilot_web, event-driven watches from
// two or three concurrent clients (pypilot-autopilot-provider + upstream
// UI + ours) saturated the process and cascaded to a hung SK server.
// Reference: memory/project_tinypilot_pi_zero_limit.md
const WATCH_HIGH: number = 0.5;   // 2 Hz - UI-facing values users may slide
const WATCH_MED: number = 1;      // 1 Hz - telemetry (voltage, current, temps)
const WATCH_LOW: number = 5;      // 0.2 Hz - runtime / version

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
        app.setPluginStatus(
          `${PLUGIN_REVISION} - connected to ${props.host}:${props.port}${apProvider ? " (AutopilotProvider active)" : ""}`
        );
      });

      client.on("disconnect", (reason: string) => {
        lastDisconnectReason = reason;
        if (apProvider) apProvider.markOffline();
        pushAutopilotUpdate();
        app.setPluginStatus(
          `${PLUGIN_REVISION} - reconnecting (last: ${reason})`
        );
      });

      client.on("pong", (latency: number) => {
        lastPingLatencyMs = latency;
      });

      client.on("catalog", (catalog: PypilotCatalog) => {
        lastCatalog = catalog;
        metaSent = new Set(); // resend meta on catalog refresh
        const catalogKeys = Object.keys(catalog);
        const gainKeys = catalogKeys.filter(
          (k) => k.startsWith("ap.pilot.") && (catalog[k] as any).AutopilotGain
        );
        const apKeys = catalogKeys.filter((k) => k.startsWith("ap.pilot."));
        app.setPluginStatus(
          `${PLUGIN_REVISION} - connected, catalog ${catalogKeys.length} vars (ap.pilots.*=${apKeys.length}, AutopilotGain=${gainKeys.length})`
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
    },

    stop: () => {
      if (client) {
        try { client.stop(); } catch { /* defensive */ }
        client = null;
      }
      // Clear the action-paths keep-alive interval registered on the app.
      const ka = (app as any)._pypilotNewuiKeepAlive;
      if (ka) { try { clearInterval(ka); } catch { /* defensive */ } (app as any)._pypilotNewuiKeepAlive = null; }
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
      router.get("/status", (_req: any, res: any) => {
        res.json({
          revision: PLUGIN_REVISION,
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
        });
      });

      router.get("/paths", (_req: any, res: any) => {
        const items: any[] = [];
        for (const [name, meta] of Object.entries(lastCatalog)) {
          if (RESERVED_PYPILOT_KEYS.has(name)) continue;
          let mapping: Mapping | null = FIXED_MAPPINGS[name] || null;
          if (!mapping) mapping = mapDynamicName(name, lastCatalog);
          if (!mapping) {
            if (props.publishUnmapped) mapping = autoMap(name);
            else continue;
          }
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
    };
  }

  function pushAutopilotUpdate(): void {
    if (!apProvider) return;
    try {
      // Push structured update through the Autopilot API (WilhelmSK etc.)
      if (typeof app.autopilotUpdate === "function") {
        app.autopilotUpdate(apProvider.deviceId, {
          state: apProvider.data.state,
          mode: apProvider.data.mode,
          target: apProvider.data.target,
          engaged: apProvider.data.engaged,
          actions: apProvider.data.options.actions,
        });
      }
    } catch (e: any) {
      app.debug(`[absorb] autopilotUpdate failed: ${e?.message || e}`);
    }
    // ALSO emit canonical steering.autopilot.* deltas so anything subscribed
    // to the WebSocket stream (including our own webapp) sees the change.
    // autopilotUpdate() alone only feeds the REST endpoint - deltas would not
    // arrive to stream subscribers otherwise.
    const values: any[] = [
      { path: "steering.autopilot.state",   value: apProvider.data.state },
      { path: "steering.autopilot.mode",    value: apProvider.data.mode },
      { path: "steering.autopilot.target",  value: apProvider.data.target },
      { path: "steering.autopilot.engaged", value: apProvider.data.engaged },
      { path: "steering.autopilot.availableActions",
        value: apProvider.data.options.actions.filter((a) => a.available).map((a) => a.id) },
    ];
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
  }

  function setupWatches(c: PypilotClient, catalog: PypilotCatalog): void {
    // High-rate: engage/mode changes and gains that the user might slide.
    for (const name of Object.keys(catalog)) {
      if (RESERVED_PYPILOT_KEYS.has(name)) continue;
      // Note: pypilot exposes gains as ap.pilot.<pilot>.<gain> (SINGULAR),
      // not ap.pilots.*. Confirmed by inspecting pypilot_values on the wire.
      if (name.startsWith("ap.pilot.") && !RESERVED_PYPILOT_KEYS.has(name)) {
        c.watch(name, WATCH_HIGH);
      } else if (
        name.startsWith("ap.tack.") ||
        name === "ap.pilot" ||
        name === "profile" ||
        name === "profiles" ||
        name === "ap.modes"
      ) {
        c.watch(name, WATCH_HIGH);
      } else if (
        name === "servo.voltage" ||
        name === "servo.current" ||
        name === "servo.controller_temp" ||
        name === "servo.motor_temp" ||
        name === "servo.amp_hours" ||
        name === "servo.engaged" ||
        name === "servo.flags" ||
        name === "servo.controller"
      ) {
        c.watch(name, WATCH_MED);
      } else if (name.startsWith("rudder.") || name.startsWith("imu.")) {
        c.watch(name, WATCH_MED);
      } else if (name === "ap.runtime" || name === "ap.version") {
        c.watch(name, WATCH_LOW);
      } else if (name === "imu.warning" || name === "imu.error") {
        c.watch(name, WATCH_HIGH);
      }
      // Anything else is left unwatched by default. User can request via /raw
      // (future: expose per-path opt-in via config UI).
    }
    // Rev32: watch the four core AP vars that RESERVED_PYPILOT_KEYS skips
    // above. These feed apProvider.data.{state,mode,target,engaged} which in
    // turn drive the canonical steering.autopilot.* deltas. Registered here
    // (post-catalog) rather than in plugin.start() so the socket is fully
    // settled and pypilot_web does not drop the subscription.
    if (apProvider) {
      c.watch("ap.enabled", WATCH_HIGH);
      c.watch("ap.mode", WATCH_HIGH);
      c.watch("ap.heading_command", WATCH_HIGH);
    }
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
    let mapping: Mapping | null = FIXED_MAPPINGS[name] || null;
    if (!mapping) mapping = mapDynamicName(name, lastCatalog);
    if (!mapping) {
      if (!props.publishUnmapped) return;
      mapping = autoMap(name);
    }
    if (mapping.reserved) return;

    const skValue = convertForSK(mapping, value);
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
        // Reverse unit conversion for angle paths that we stored in rad.
        let pypilotValue: unknown = value;
        const mapping = FIXED_MAPPINGS[name];
        if (mapping?.units === "rad" && typeof value === "number") {
          pypilotValue = value * 180 / Math.PI;
        }
        client.set(name, pypilotValue);
        return { state: "COMPLETED", statusCode: 200 };
      };
      try {
        app.registerPutHandler("vessels.self", skPath, cb, SOURCE_LABEL);
        putHandlersRegistered.add(skPath);
      } catch (e: any) {
        app.debug(`[put] register failed for ${skPath}: ${e?.message || e}`);
      }
    };

    for (const [name, mapping] of Object.entries(FIXED_MAPPINGS)) {
      if (mapping.putKind !== "plain") continue;
      if (!catalog[name]) continue;
      registerOne(mapping.skPath);
    }
    // Gains: register handler for each discovered ap.pilots.<pilot>.<gain> that
    // catalog exposes as AutopilotGain.
    for (const [name, meta] of Object.entries(catalog)) {
      if (!meta.AutopilotGain) continue;
      const m = mapDynamicName(name, catalog);
      if (m) registerOne(m.skPath);
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
