// Rev295 (bug C "piloto girando loco") — pure decision function that
// tells the caller whether a mode change needs to re-anchor
// heading_command and, if so, what value to write.
//
// This module is EXTRACTED from autopilot-provider.ts so it can be
// unit-tested without spinning up the pypilot socket. The provider
// still owns the actual client.set() call — this function only
// decides what.
//
// The domain problem: pypilot stores `ap.heading_command` in a
// different space depending on the current `ap.mode`:
//
//   compass / gps / nav          → compass heading in degrees 0..360
//   wind                         → AWA (apparent wind angle) -180..+180
//   true wind                    → TWA (true wind angle)     -180..+180
//
// A target that was correct in the previous mode becomes numerically
// intact but semantically wrong when the mode crosses the compass ↔
// wind boundary. pypilot then swings the boat toward it as if the
// number belonged in the new space, and the sailor sees the pilot
// "girar a lo bestia". The fix re-anchors heading_command to the
// current measurement in the destination space right after ap.mode
// is written.

export interface ReAnchorDecision {
  /** True if the caller should write ap.heading_command with `valueDeg`. */
  shouldReAnchor: boolean;
  /** Value to write, in degrees. Null when we should NOT write. */
  valueDeg: number | null;
  /** Which pypilot key the anchor came from, for diagnostics. Null when
   *  we skipped either because the transition doesn't need it or
   *  because no measurement was available. */
  sourceKey: string | null;
  /** Reason string for the log / /diagnostic endpoint. */
  reason: string;
}

const IS_WIND = (m: string): boolean => m.toLowerCase().includes("wind");
const IS_TRUE_WIND = (m: string): boolean => {
  const s = m.toLowerCase();
  return s.includes("true") && s.includes("wind");
};

/** Decide whether a mode transition triggers a heading_command
 *  re-anchor, and what value to write. Pure — takes the raw catalog
 *  values map (as returned by pypilot-client.getValues()) and returns
 *  a decision. */
export function decideReAnchor(
  oldMode: string,
  newMode: string,
  values: Record<string, unknown>,
): ReAnchorDecision {
  const oldWind = IS_WIND(oldMode);
  const newWind = IS_WIND(newMode);
  if (oldWind === newWind) {
    return {
      shouldReAnchor: false,
      valueDeg: null,
      sourceKey: null,
      reason: `same target-space (${oldWind ? "wind" : "compass"}) — no anchor needed`,
    };
  }
  let sourceKey: string;
  if (newWind) {
    sourceKey = IS_TRUE_WIND(newMode) ? "wind.true_direction" : "wind.direction";
  } else {
    sourceKey = "ap.heading";
  }
  const raw = values[sourceKey];
  if (typeof raw !== "number" || !isFinite(raw)) {
    return {
      shouldReAnchor: false,
      valueDeg: null,
      sourceKey,
      reason: `no measurement for ${sourceKey}; sailor will nudge`,
    };
  }
  return {
    shouldReAnchor: true,
    valueDeg: raw,
    sourceKey,
    reason: `${oldMode} → ${newMode}: anchor to ${sourceKey}=${raw.toFixed(2)}°`,
  };
}
