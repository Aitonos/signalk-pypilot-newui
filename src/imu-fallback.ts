// Rev696 (GitHub #6, Carlos: "¿no hay solución a ese supuesto?"): pypilot
// itself writes the heading, attitude and rate of turn to Signal K - but
// only with read/write access, only when it finds the server, and only with
// its Signal K output enabled. When none of that happens the visor has no
// heading although pypilot has one. This plugin is connected to pypilot
// anyway, so it publishes the same three paths as a FALLBACK: only while no
// other source is writing navigation.headingMagnetic, and it steps back as
// soon as one is (pypilot getting its access, a compass on the bus...).
//
// Same data and units as pypilot's own signalk.py: imu.heading_lowpass,
// imu.pitch, imu.roll, imu.headingrate_lowpass (degrees) -> radians.

export const IMU_FALLBACK_KEYS = ["imu.heading_lowpass", "imu.pitch", "imu.roll", "imu.headingrate_lowpass"];

const D2R = Math.PI / 180;

/** True when a source other than `ownLabel` updated this Signal K path in
 *  the last `maxAgeMs`. Accepts the object getSelfPath returns: { value,
 *  $source, timestamp, values?: { [source]: { value, timestamp } } }. */
export function otherSourceFresh(pathObj: unknown, ownLabel: string, now: number, maxAgeMs: number): boolean {
  if (!pathObj || typeof pathObj !== "object") return false;
  const o = pathObj as { $source?: string; timestamp?: string; values?: Record<string, { timestamp?: string }> };
  const fresh = (ts: string | undefined): boolean => {
    const t = ts ? Date.parse(ts) : NaN;
    return Number.isFinite(t) && now - t <= maxAgeMs;
  };
  const own = (src: string | undefined): boolean => !!src && (src === ownLabel || src.startsWith(ownLabel + "."));
  if (o.values && typeof o.values === "object") {
    for (const [src, v] of Object.entries(o.values)) {
      if (!own(src) && fresh(v && v.timestamp)) return true;
    }
    return false;
  }
  return !own(o.$source) && fresh(o.timestamp);
}

/** Signal K values from pypilot's IMU readings (degrees). Paths whose
 *  inputs are missing are left out. */
export function imuFallbackValues(v: Record<string, unknown>): { path: string; value: unknown }[] {
  const num = (k: string): number | null => {
    const n = Number(v[k]);
    return v[k] == null || !Number.isFinite(n) ? null : n;
  };
  const h = num("imu.heading_lowpass");
  const pitch = num("imu.pitch");
  const roll = num("imu.roll");
  const rate = num("imu.headingrate_lowpass");
  const out: { path: string; value: unknown }[] = [];
  if (h == null) return out;
  const hRad = (((h % 360) + 360) % 360) * D2R;
  out.push({ path: "navigation.headingMagnetic", value: hRad });
  if (pitch != null && roll != null) out.push({ path: "navigation.attitude", value: { pitch: pitch * D2R, roll: roll * D2R, yaw: hRad } });
  if (rate != null) out.push({ path: "navigation.rateOfTurn", value: rate * D2R });
  return out;
}
