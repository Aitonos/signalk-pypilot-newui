import { Socket } from "net";
import { networkInterfaces } from "os";

export interface ScanHit {
  ip: string;
  port: number;
  hint: string;
}

export interface ScanOptions {
  subnet?: string;         // CIDR-24 form e.g. "192.168.1.0/24". Optional; auto-detected.
  ports?: number[];        // Ports to probe. Default: [80, 8000].
  tcpTimeoutMs?: number;   // Per-TCP-connect timeout. Default 400.
  httpTimeoutMs?: number;  // Per-HTTP-fetch timeout. Default 800.
  parallelism?: number;    // Concurrent probes. Default 32.
}

/**
 * Scan the local subnets for pypilot_web instances.
 *
 * Two-stage probe per host:
 *   1. TCP connect on candidate ports. Fast filter (~400ms).
 *   2. On any open port, HTTP GET / and look for pypilot markers in the body:
 *      - '<title>pypilot control</title>'
 *      - 'pypilot_web_port'
 *      - '/static/pypilot_control.js'
 *
 * Returns unique {ip, port} hits.
 */
export async function scanLan(opts: ScanOptions = {}): Promise<ScanHit[]> {
  return (await scanLanReport(opts)).hits;
}

export interface LocalSubnet { iface: string; address: string; subnet: string }
export interface ScanReport { hits: ScanHit[]; subnets: LocalSubnet[]; ports: number[] }

/** Rev656 (forum 2026-11-07, AvNav on a Pi 5): the scan looked only at the
 *  /24 of the FIRST interface - on AvNav that is often its own Wi-Fi
 *  hotspot, not the network the TinyPilot is on. Now every IPv4 interface
 *  (link-local and container bridges skipped), at most MAX_SUBNETS. */
export const MAX_SUBNETS = 4;
export function localSubnets(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): LocalSubnet[] {
  const out: LocalSubnet[] = [];
  for (const name of Object.keys(ifaces)) {
    if (/^(docker|veth|br-|virbr|lo|tailscale|wg|tun|tap|zt)/.test(name)) continue;   // containers and VPNs
    for (const info of ifaces[name] || []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const parts = info.address.split(".").map(Number);
      if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) continue;
      if (parts[0] === 169 && parts[1] === 254) continue;
      if (info.netmask === "255.255.255.255") continue;   // point-to-point (VPN), no neighbours to scan
      const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      if (out.some((x) => x.subnet === subnet)) continue;
      out.push({ iface: name, address: info.address, subnet });
    }
  }
  return out.slice(0, MAX_SUBNETS);
}

export async function scanLanReport(opts: ScanOptions = {}): Promise<ScanReport> {
  const ports = opts.ports ?? [80, 8000];
  const tcpTimeout = opts.tcpTimeoutMs ?? 400;
  const httpTimeout = opts.httpTimeoutMs ?? 800;
  const parallelism = opts.parallelism ?? 32;

  const subnets: LocalSubnet[] = opts.subnet
    ? [{ iface: "manual", address: "", subnet: opts.subnet }]
    : localSubnets();
  if (!subnets.length) return { hits: [], subnets, ports };

  const hosts = subnets.flatMap((x) => enumerate24(x.subnet));
  const results: ScanHit[] = [];
  const queue = [...hosts];

  async function worker() {
    while (queue.length) {
      const ip = queue.shift();
      if (!ip) return;
      for (const port of ports) {
        const open = await tcpProbe(ip, port, tcpTimeout);
        if (!open) continue;
        const hint = await httpProbe(ip, port, httpTimeout);
        if (hint) {
          results.push({ ip, port, hint });
          break; // one hit per host is enough
        }
      }
    }
  }

  const workers = Array.from({ length: parallelism }, () => worker());
  await Promise.all(workers);
  return { hits: results, subnets, ports };
}

function enumerate24(cidr: string): string[] {
  const m = cidr.match(/^(\d+)\.(\d+)\.(\d+)\.\d+\/24$/);
  if (!m) return [];
  const base = `${m[1]}.${m[2]}.${m[3]}`;
  const out: string[] = [];
  for (let i = 1; i <= 254; i++) out.push(`${base}.${i}`);
  return out;
}

function tcpProbe(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* defensive */ }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.once("error", () => finish(false));
    sock.once("connect", () => finish(true));
    try {
      sock.connect(port, ip);
    } catch {
      finish(false);
    }
  });
}

async function httpProbe(
  ip: string,
  port: number,
  timeoutMs: number
): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://${ip}:${port}/`, {
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = await res.text();
    if (body.includes("<title>pypilot control</title>")) return "title";
    if (body.includes("pypilot_web_port")) return "js-const";
    if (body.includes("/static/pypilot_control.js")) return "script-tag";
    return null;
  } catch {
    return null;
  }
}
