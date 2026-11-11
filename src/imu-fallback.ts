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
 *  inputs are missing, or not in `only` when given, are left out. */
export function imuFallbackValues(v: Record<string, unknown>, only?: ReadonlySet<string>): { path: string; value: unknown }[] {
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
  return only ? out.filter((x) => only.has(x.path)) : out;
}

// Rev698 (Carlos: "¿se te ocurren otras casuísticas?"): each of the three
// paths is decided on its own, so a boat with its own attitude sensor but
// no heading (or the other way round) gets only what is missing.
// Rate of turn only together with the heading (decided in index.ts):
// pypilot itself never sends it.
export const IMU_FALLBACK_PATHS = ["navigation.headingMagnetic", "navigation.attitude", "navigation.rateOfTurn"];

export interface FallbackPathState { active: boolean; miss: number; offs: number }
export const newFallbackPathState = (): FallbackPathState => ({ active: false, miss: 0, offs: 0 });

/** One 5 s pass for one path. Steps back at once when another source
 *  writes it, pypilot has no heading or the user switched the fallback
 *  off. Comes on after 2 quiet passes (10 s) - 6 (30 s) once another
 *  source has been seen, so a slow or patchy source does not make it
 *  flap on and off. Returns the change, if any. */
export function stepFallbackPath(st: FallbackPathState, otherFresh: boolean, pypilotHas: boolean, enabled: boolean): "on" | "off" | null {
  if (st.active) {
    if (enabled && !otherFresh && pypilotHas) return null;
    st.active = false; st.miss = 0;
    if (otherFresh) st.offs += 1;
    return "off";
  }
  if (otherFresh) st.offs = Math.max(st.offs, 1);
  st.miss = enabled && !otherFresh && pypilotHas ? st.miss + 1 : 0;
  if (st.miss < (st.offs ? 6 : 2)) return null;
  st.active = true; st.miss = 0;
  return "on";
}
