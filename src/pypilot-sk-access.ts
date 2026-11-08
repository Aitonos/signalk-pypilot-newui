// Rev659 (Carlos 2026-11-08): pypilot (the TinyPilot) drops its Signal K
// token whenever a Signal K restart answers it with 503, asks for access
// again with a NEW client id, and does not say which permission it needs -
// so the Signal K admin offers "read only" and a sailor who approves it
// gets a pypilot that reads wind and GPS but whose heading, heel and pitch
// are silently thrown away. On the boat that piled up 4 pypilot devices
// (two of them read only) and the heading vanished from Signal K.
//
// Here, from inside the server:
// - a pending request from the device "pypilot-<digits>" described as
//   "pypilot", coming from the TinyPilot address this plugin is configured
//   with, is approved at once with read/write. Nothing else is approved.
// - the pypilot devices left behind are removed, keeping the newest one,
//   which is set to read/write.
// It uses Signal K's own security strategy and its own config save, the same
// calls the admin UI makes. When either is missing (security off, another
// server version, immutable config) it does nothing and the alarm
// pypilot-sk-access stays the safety net.

export const PYPILOT_CLIENT_RE = /^pypilot-\d+$/;

export interface PendingRequest {
  accessIdentifier?: string;
  accessDescription?: string;
  ip?: string;
  state?: string;
  type?: string;
}
export interface DeviceEntry { clientId: string; description?: string; permissions?: string }

/** "::ffff:192.168.1.115" -> "192.168.1.115". */
export function plainIp(ip: string | undefined): string {
  return String(ip || "").replace(/^::ffff:/i, "").trim();
}

export function isPypilotDevice(d: { clientId?: string; description?: string }): boolean {
  return PYPILOT_CLIENT_RE.test(String(d.clientId || "")) && String(d.description || "") === "pypilot";
}

/** Pending pypilot requests coming from the TinyPilot's address. */
export function requestsToApprove(pending: PendingRequest[], tinypilotIps: string[]): PendingRequest[] {
  const ips = new Set(tinypilotIps.map(plainIp).filter(Boolean));
  if (!ips.size) return [];
  return pending.filter((r) =>
    (r.state === undefined || r.state === "PENDING")
    && (r.type === undefined || r.type === "accessRequest")
    && isPypilotDevice({ clientId: r.accessIdentifier, description: r.accessDescription })
    && ips.has(plainIp(r.ip)));
}

/** Of the pypilot devices, the newest (Signal K appends on approval) is the
 *  one in use: keep it read/write, remove the rest. */
export function pypilotDevicePlan(devices: DeviceEntry[]): { keep: string | null; makeReadWrite: boolean; remove: string[] } {
  const mine = devices.filter(isPypilotDevice);
  if (!mine.length) return { keep: null, makeReadWrite: false, remove: [] };
  const keep = mine[mine.length - 1];
  return {
    keep: keep.clientId,
    makeReadWrite: keep.permissions !== "readwrite",
    remove: mine.slice(0, -1).map((d) => d.clientId),
  };
}
