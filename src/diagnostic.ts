// Rev727 (Carlos 2026-11-18, OpenMarine #18): "Capture diagnostic", as in
// mareas-ihm. A user sends one JSON instead of screenshots; it must carry
// what we need and nothing personal. Pure helpers, tested on their own.

import { isPypilotDevice, plainIp, DeviceEntry, PendingRequest } from "./pypilot-sk-access";

/** Keys whose value is never sent, whatever the plugin version adds. */
const SECRET_KEY_RE = /pass|pin|token|secret|cookie|session|key$|apikey|credential/i;

/** Private, loopback and link-local addresses stay: they are what tells
 *  why pypilot's access fails. Anything else is masked. */
export function maskIp(ip: string | undefined | null): string | null {
  if (ip == null || ip === "") return null;
  const v = plainIp(String(ip));
  if (/^(10\.|127\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(v)) return v;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return v;
  if (v === "::1" || /^f[cd]/i.test(v) || /^fe80/i.test(v)) return v;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return v.replace(/\.\d+\.\d+$/, ".x.x");
  return "XXXX";
}

/** Host names and addresses: an address goes through maskIp, a name stays
 *  (tinypilot.local, openplotter) unless it looks like a public domain. */
export function maskHost(host: string | undefined | null): string | null {
  if (!host) return null;
  const h = String(host).trim();
  if (/^[\d.]+$/.test(h) || h.includes(":")) return maskIp(h);
  if (!h.includes(".") || /\.(local|lan|home|internal)$/i.test(h)) return h;
  return "XXXX";
}

/** The plugin settings without secrets; nested objects too. */
export function sanitizeConfig(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(value)) return value.map((v) => sanitizeConfig(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = v === undefined || v === null || v === "" ? v : "XXXX";
    } else if (/^(host|address|ip)$/i.test(k) && typeof v === "string") {
      out[k] = maskHost(v);
    } else if (/^(lat|latitude|lon|lng|longitude)$/i.test(k) && typeof v === "number") {
      // About 11 km: the sea area, not the berth.
      out[k] = Math.round(v * 10) / 10;
    } else if (/^(coordinates|polygon|geometry)$/i.test(k)) {
      out[k] = "XXXX";
    } else {
      out[k] = sanitizeConfig(v, depth + 1);
    }
  }
  return out;
}

export type AccessVerdict =
  | "ok"               // pypilot's device is read/write
  | "noSecurity"       // Signal K security off: nothing to approve
  | "noControl"        // the plugin cannot reach Signal K's security
  | "autoApproveOff"   // the user switched the automatic approval off
  | "pendingOtherIp"   // pypilot asked, from an address the plugin does not expect
  | "pending"          // pypilot asked; approval on its way
  | "readOnly"         // pypilot's device is read only; being fixed
  | "noDevice";        // no device and no request: pypilot has not asked

export interface AccessInputs {
  securityOn: boolean;
  canControl: boolean;
  autoApprove: boolean;
  /** pypilot's own client id (signalk.uid), when pypilot told us. */
  pypilotUid: string | null;
  devices: DeviceEntry[];
  pending: PendingRequest[];
  /** Addresses the configured TinyPilot host stands for. */
  hostIps: string[];
}

export interface AccessReport {
  verdict: AccessVerdict;
  pypilotUid: string | null;
  device: { clientId: string; permissions: string | null } | null;
  pypilotDevices: { clientId: string; permissions: string | null }[];
  pending: { clientId: string; ip: string | null; fromTinypilot: boolean }[];
  hostIps: string[];
}

/** Why pypilot can or cannot write to Signal K, from what the server holds. */
export function accessReport(i: AccessInputs): AccessReport {
  type Entry = { clientId?: string; accessIdentifier?: string; description?: string; accessDescription?: string };
  const idOf = (d: Entry) => d.clientId ?? d.accessIdentifier ?? "";
  const looksPypilot = (d: Entry) =>
    isPypilotDevice({ clientId: idOf(d), description: d.description ?? d.accessDescription })
    || (!!i.pypilotUid && idOf(d) === i.pypilotUid);
  // pypilot's own id when it told us; otherwise any pypilot-<digits>.
  const mine = (d: Entry) => (i.pypilotUid ? idOf(d) === i.pypilotUid : looksPypilot(d));
  const brief = (d: DeviceEntry) => ({ clientId: d.clientId, permissions: d.permissions ?? null });
  const pypilotDevices = i.devices.filter(looksPypilot).map(brief);
  // Signal K appends on approval: the last one is the newest.
  const ownDevices = i.devices.filter(mine);
  const device = ownDevices.length ? brief(ownDevices[ownDevices.length - 1]) : null;
  const ips = new Set(i.hostIps.map(plainIp));
  const pending = i.pending
    .filter((r) => (r.state ?? "PENDING") === "PENDING" && mine(r))
    .map((r) => ({ clientId: String(r.accessIdentifier), ip: maskIp(r.ip), fromTinypilot: ips.has(plainIp(r.ip)) }));
  let verdict: AccessVerdict;
  if (!i.securityOn) verdict = "noSecurity";
  else if (device && (device.permissions === "readwrite" || device.permissions === "admin")) verdict = "ok";
  else if (!i.canControl) verdict = "noControl";
  else if (!i.autoApprove) verdict = "autoApproveOff";
  else if (pending.some((r) => !r.fromTinypilot)) verdict = "pendingOtherIp";
  else if (pending.length) verdict = "pending";
  else if (device) verdict = "readOnly";
  else verdict = "noDevice";
  return {
    verdict,
    pypilotUid: i.pypilotUid,
    device,
    pypilotDevices,
    pending,
    hostIps: [...ips].map((ip) => maskIp(ip) ?? ip),
  };
}

/** A bounded list of recent lines for the report (newest last). */
export class DiagRing {
  private lines: { ts: number; tag: string; msg: string }[] = [];
  constructor(private readonly max = 300) {}
  add(tag: string, msg: string, ts = Date.now()): void {
    this.lines.push({ ts, tag, msg });
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }
  list(): { ts: string; tag: string; msg: string }[] {
    return this.lines.map((l) => ({ ts: new Date(l.ts).toISOString(), tag: l.tag, msg: l.msg }));
  }
}
