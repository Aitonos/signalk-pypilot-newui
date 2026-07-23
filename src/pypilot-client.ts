import { EventEmitter } from "events";
import { io, Socket } from "socket.io-client";

// Protocol note (confirmed from pypilot upstream `web/static/pypilot_control.js`,
// version bundled with TinyPilot images through 2026):
//
//   Client -> server (socket.io v2/v3/v4 - autodetected by the client):
//     socket.emit('pypilot', 'name=<json_value>')          // WRITE
//     socket.emit('pypilot', 'watch={"name":<period>}')    // SUBSCRIBE
//     socket.emit('ping')                                  // latency
//     socket.emit('language', '<lang>')                    // i18n (unused here)
//
//   Server -> client:
//     socket.on('pypilot_values',   json_string_of_catalog)   // ONE-SHOT on connect
//     socket.on('pypilot',          json_string_of_updates)   // updates dict
//     socket.on('pypilot_disconnect')                         // pypilot core gone
//     socket.on('pong')                                       // latency reply
//
// `watch` period value semantics:
//     true        -> deliver on every change
//     <number>    -> poll at N seconds
//     false       -> cancel

export type PypilotCatalog = Record<string, PypilotVarMeta>;

export interface PypilotVarMeta {
  type?: string;
  min?: number;
  max?: number;
  units?: string;
  choices?: string[];
  profiled?: boolean;
  AutopilotGain?: boolean;
  persistent?: boolean;
  [k: string]: unknown;
}

export interface PypilotClientOpts {
  host: string;
  port: number;
  reconnectDelayMs?: number;
  log?: (level: "debug" | "info" | "warn" | "error", msg: string) => void;
}

/**
 * Talks to pypilot_web on TinyPilot / classic pypilot install.
 * Emits:
 *   'connect'                       socket.io session established
 *   'disconnect'      (reason)      transport dropped
 *   'catalog'         (catalog)     full var dict after `pypilot_values` event
 *   'value'           (name, val)   each key parsed from a `pypilot` event
 *   'pypilot_offline'               pypilot core reported gone
 *   'pong'            (latencyMs)   ping reply
 */
export class PypilotClient extends EventEmitter {
  private socket: Socket | null = null;
  private opts: Required<PypilotClientOpts>;
  private catalog: PypilotCatalog = {};
  private lastValues: Record<string, unknown> = {};
  private watches: Record<string, true | number> = {};
  private pingTimer: NodeJS.Timeout | null = null;
  private pingStartMs = 0;
  private closed = false;

  constructor(opts: PypilotClientOpts) {
    super();
    this.opts = {
      host: opts.host,
      port: opts.port,
      reconnectDelayMs: opts.reconnectDelayMs ?? 3000,
      log: opts.log ?? (() => {}),
    };
  }

  get connected(): boolean {
    return !!this.socket && this.socket.connected;
  }

  getCatalog(): PypilotCatalog {
    return this.catalog;
  }

  getValues(): Record<string, unknown> {
    return this.lastValues;
  }

  start(): void {
    // Guard against double-start. Previously an accidental restart could
    // leave TWO sockets to pypilot_web spinning at the same time.
    if (this.socket) {
      this.opts.log("warn", "[pypilot] start() called but socket already exists - no-op");
      return;
    }
    this.closed = false;
    const url = `http://${this.opts.host}:${this.opts.port}`;
    this.opts.log("info", `[pypilot] connecting socket.io to ${url}`);
    this.socket = io(url, {
      transports: ["websocket", "polling"],
      // Reconnect but with a ceiling so a wedged pypilot_web (Pi Zero pinned
      // at 100% CPU) does not get hammered forever. After the ceiling we
      // give up until the user pushes /resume from the webapp.
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: this.opts.reconnectDelayMs,
      reconnectionDelayMax: 20000,
      timeout: 10000,
      autoConnect: true,
    });
    this.socket.on("connect", () => {
      this.opts.log("info", `[pypilot] socket.io connected id=${this.socket?.id}`);
      this.emit("connect");
      // Re-apply watches after reconnect so subscriptions survive drops.
      for (const [name, period] of Object.entries(this.watches)) {
        this.sendWatch(name, period);
      }
      this.startPing();
    });
    this.socket.on("disconnect", (reason: string) => {
      this.opts.log("warn", `[pypilot] disconnected: ${reason}`);
      this.stopPing();
      this.emit("disconnect", reason);
    });
    this.socket.on("connect_error", (err: Error) => {
      this.opts.log("warn", `[pypilot] connect_error: ${err.message}`);
    });
    this.socket.on("pypilot_values", (msg: unknown) => {
      try {
        const raw = typeof msg === "string" ? JSON.parse(msg) : msg;
        this.catalog = raw as PypilotCatalog;
        this.opts.log(
          "info",
          `[pypilot] catalog received: ${Object.keys(this.catalog).length} vars`
        );
        this.emit("catalog", this.catalog);
      } catch (e: any) {
        this.opts.log("error", `[pypilot] catalog parse failed: ${e?.message || e}`);
      }
    });
    this.socket.on("pypilot", (msg: unknown) => {
      try {
        const dict = typeof msg === "string" ? JSON.parse(msg) : msg;
        if (!dict || typeof dict !== "object") return;
        for (const [name, value] of Object.entries(dict)) {
          this.lastValues[name] = value;
          this.emit("value", name, value);
        }
      } catch (e: any) {
        this.opts.log("debug", `[pypilot] pypilot msg parse failed: ${e?.message || e}`);
      }
    });
    this.socket.on("pypilot_disconnect", () => {
      this.opts.log("warn", "[pypilot] pypilot core reported offline");
      this.emit("pypilot_offline");
    });
    this.socket.on("pong", () => {
      const latency = Date.now() - this.pingStartMs;
      this.emit("pong", latency);
    });
  }

  stop(): void {
    this.closed = true;
    this.stopPing();
    if (this.socket) {
      try {
        // Kill the reconnection manager first, otherwise disconnect()
        // schedules another attempt.
        (this.socket as any).io?.reconnection?.(false);
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch { /* defensive */ }
      this.socket = null;
    }
    this.watches = {};
    this.catalog = {};
    this.lastValues = {};
  }

  /**
   * Pause: keep watches remembered but disconnect the socket so we stop
   * hammering pypilot_web. resume() opens a new socket and re-applies them.
   */
  pause(): void {
    if (!this.socket) return;
    try {
      (this.socket as any).io?.reconnection?.(false);
      this.socket.removeAllListeners();
      this.socket.disconnect();
    } catch { /* defensive */ }
    this.socket = null;
    this.stopPing();
    this.closed = true;
  }

  resume(): void {
    if (this.socket) return;
    this.closed = false;
    this.start();
  }

  /**
   * Subscribe to a pypilot variable. period=true delivers on every change,
   * a number polls at N seconds, false cancels the subscription.
   */
  watch(name: string, period: true | number | false = true): void {
    if (period === false) {
      if (!(name in this.watches)) return;
      delete this.watches[name];
      this.sendWatch(name, false);
      return;
    }
    this.watches[name] = period;
    if (this.connected) this.sendWatch(name, period);
  }

  /**
   * Write a value. Value is JSON-stringified per pypilot protocol.
   * The pypilot server accepts scalars, arrays, and dicts.
   */
  set(name: string, value: unknown): void {
    if (!this.socket) return;
    try {
      const payload = `${name}=${JSON.stringify(value)}`;
      this.socket.emit("pypilot", payload);
    } catch (e: any) {
      this.opts.log("warn", `[pypilot] set failed for ${name}: ${e?.message || e}`);
    }
  }

  private sendWatch(name: string, period: true | number | false): void {
    if (!this.socket) return;
    try {
      const dict: Record<string, true | number | false> = {};
      dict[name] = period;
      this.socket.emit("pypilot", `watch=${JSON.stringify(dict)}`);
    } catch (e: any) {
      this.opts.log("warn", `[pypilot] watch send failed: ${e?.message || e}`);
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.socket || !this.socket.connected) return;
      this.pingStartMs = Date.now();
      try {
        this.socket.emit("ping");
      } catch { /* defensive */ }
    }, 5000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
