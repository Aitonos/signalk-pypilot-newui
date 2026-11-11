// Rev664 (Carlos 2026-11-09): the visor had to ask Signal K for an ADMIN
// token, because every plugin route used to be admin-only - and an admin
// token kept in a tablet's browser gives full control of the server. Since
// Signal K 2.31 (PR SignalK/signalk-server#2498) a plugin can declare each
// route with router.access('readonly' | 'readwrite'); undeclared routes stay
// admin-only.
//
// Rules:
// - reads: readonly, except the ones that hand out data files (downloads,
//   exports, log tails, incidents), which need readwrite;
// - writes: readwrite. The technical ones are also behind this plugin's own
//   admin PIN (requireAdmin);
// - the free-form SSH shell stays Signal K admin.

export type AccessLevel = "readonly" | "readwrite" | "admin";

export const ADMIN_ONLY_ROUTES = new Set<string>(["POST /ssh-exec"]);
// Reads that hand out data files, /scan (probes the whole LAN) and the
// folder browser (folder names of the home folder).
const DATA_FILE_GET = /(download|export|\/tail\b|\/incident\/|^\/scan$|^\/tinypilot\/folders$)/;

export function routeAccessLevel(method: string, path: string): AccessLevel {
  const m = String(method).toUpperCase();
  if (ADMIN_ONLY_ROUTES.has(`${m} ${path}`)) return "admin";
  if (m === "GET") return DATA_FILE_GET.test(path) ? "readwrite" : "readonly";
  return "readwrite";
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** A router whose get/post/... declare their access level when the server
 *  supports it; otherwise the router itself, unchanged. */
export function accessScopedRouter(router: any): any {
  if (!router || typeof router.access !== "function") return router;
  const scoped: any = Object.create(router);
  for (const m of METHODS) {
    scoped[m] = (path: unknown, ...handlers: unknown[]) => {
      const level = typeof path === "string" ? routeAccessLevel(m, path) : "admin";
      if (level === "admin") return router[m](path, ...handlers);
      return router.access(level)[m](path, ...handlers);
    };
  }
  return scoped;
}

/** Keys the visor may save through POST /options. */
export interface VisorOptionsPlan {
  ok: boolean;
  error?: string;
  patch: Record<string, unknown>;
  /** Needs the admin PIN (connection, SSH, paths). */
  technical: boolean;
  /** The plugin must restart for it to apply (connection). */
  restart: boolean;
}

export function visorOptionsPatch(body: Record<string, unknown>): VisorOptionsPlan {
  const patch: Record<string, unknown> = {};
  let technical = false;
  let restart = false;
  const fail = (error: string): VisorOptionsPlan => ({ ok: false, error, patch: {}, technical: false, restart: false });
  for (const [k, v] of Object.entries(body || {})) {
    switch (k) {
      case "nudgeSmall":
      case "nudgeBig":
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 90) return fail(`${k} must be a number of degrees (0-90]`);
        patch[k] = v;
        break;
      case "host":
        if (typeof v !== "string" || !v.trim() || v.trim().length > 253 || /\s/.test(v.trim())) return fail("host must be an address without spaces");
        patch.host = v.trim(); technical = true; restart = true;
        break;
      case "port":
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 65535) return fail("port must be 1-65535");
        patch.port = v; technical = true; restart = true;
        break;
      case "sshUser":
        if (typeof v !== "string" || v.length > 64) return fail("sshUser must be text");
        patch.sshUser = v.trim(); technical = true;
        break;
      case "sshPassword":
        if (typeof v !== "string" || v.length > 128) return fail("sshPassword must be text");
        patch.sshPassword = v; technical = true;
        break;
      case "absorbProvider":
        if (typeof v !== "boolean") return fail("absorbProvider must be true or false");
        patch.absorbProvider = v; technical = true; restart = true;
        break;
      case "publishOnlyEssentials":
        if (typeof v !== "boolean") return fail("publishOnlyEssentials must be true or false");
        patch.publishOnlyEssentials = v; technical = true;
        break;
      // Rev676: moved from the Signal K admin to the visor.
      case "pypilotAutoApprove":
        if (typeof v !== "boolean") return fail("pypilotAutoApprove must be true or false");
        patch.pypilotAutoApprove = v; technical = true;
        break;
      case "headingFallback":   // Rev698
        if (typeof v !== "boolean") return fail("headingFallback must be true or false");
        patch.headingFallback = v; technical = true;
        break;
      case "sessionRecorderEnabled":
        if (typeof v !== "boolean") return fail("sessionRecorderEnabled must be true or false");
        patch.sessionRecorderEnabled = v;
        break;
      case "logCaptureIntervalSec":
        if (typeof v !== "number" || !Number.isFinite(v) || v < 30 || v > 3600) return fail("logCaptureIntervalSec must be 30-3600 s");
        patch.logCaptureIntervalSec = Math.round(v); technical = true;
        break;
      default:
        return fail(`unknown option: ${k}`);
    }
  }
  if (!Object.keys(patch).length) return fail("nothing to save");
  return { ok: true, patch, technical, restart };
}
