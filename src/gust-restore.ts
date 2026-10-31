// Rev577 (GPT audit of 3.8.1, A01/A02): what to do after a gust
// strategy expires, as a pure function so it can be tested.
//
// boost-D raised D by 20 % on one profile. Restoring it:
//   - that profile is not active: wait. Never write the old D into
//     another profile; restore when the boosted profile is back.
//   - D is the original value again: done, report it.
//   - D is still the boosted value: send the original, again every 5 s
//     while it does not show up (a refused or lost write is retried).
//   - D is something else: the sailor changed it; leave it.
// temp-heavy switched to the heavy profile; switching back follows the
// same pattern (done when the old profile is active, sailor's third
// choice wins, resend every 5 s).

export interface GustRestore {
  pilot: string;
  profile: string | null;
  path: string;
  value: number;
  boosted: number;
  lastSendTs: number;
  awayNotified: boolean;
}

export interface HeavyRestore { restore: string; heavy: string; lastSendTs: number }

export interface GustIo {
  set(path: string, value: unknown): boolean;
  markGain(path: string, value: number): void;
  markProfile(name: string): void;
  notify(id: "gust-boost-d" | "gust-heavy-profile", message: string): void;
  debug(message: string): void;
}

export const GUST_RESEND_MS = 5000;
/** Rev581 (GPT re-audit R01): after a profile switch pypilot sends the new
 *  profile's gains a moment later; until then the cached D may still be
 *  the previous profile's. Do not judge D in that window. */
export const GUST_PROFILE_SETTLE_MS = 3000;

/** pypilot may round what it stores. */
export function gustSame(a: unknown, b: number): boolean {
  return typeof a === "number" && Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 0.01);
}

export function processGustRestores(
  pending: GustRestore[], heavy: HeavyRestore | null,
  vals: Record<string, unknown>, now: number, io: GustIo,
  /** ms since the active profile last changed (Infinity if unknown/long). */
  profileSinceMs = Infinity,
): { pending: GustRestore[]; heavy: HeavyRestore | null } {
  const keep = pending.filter((r) => {
    // Rev583 (self-audit): pilot / profile not reported yet (just after a
    // start, before pypilot sent its values) is not "the profile changed".
    if (typeof vals["ap.pilot"] !== "string" || (r.profile != null && typeof vals["profile"] !== "string")) return true;
    if (vals["ap.pilot"] !== r.pilot || (r.profile != null && vals["profile"] !== r.profile)) {
      if (!r.awayNotified) {
        r.awayNotified = true;
        io.notify("gust-boost-d", `Profile changed during the gust: D of "${r.profile}" will be restored when it is active again`);
      }
      return true;
    }
    const d = vals[r.path];
    // Rev581 (GPT re-audit R01): unknown D (missing, not a number) or a
    // profile switched moments ago is no evidence of anything: keep the
    // obligation and look again on the next tick.
    if (typeof d !== "number" || !Number.isFinite(d) || profileSinceMs < GUST_PROFILE_SETTLE_MS) return true;
    if (gustSame(d, r.value)) {
      io.notify("gust-boost-d", "D restored to pre-gust value");
      return false;
    }
    if (!gustSame(d, r.boosted)) {
      io.notify("gust-boost-d", "D changed during the gust window - not restoring");
      return false;
    }
    if (now - r.lastSendTs >= GUST_RESEND_MS) {
      r.lastSendTs = now;
      let ok = false;
      try { io.markGain(r.path, r.value); ok = io.set(r.path, r.value); } catch { /* silent */ }
      if (!ok) io.debug(`[gust] D restore not sent, retrying in ${GUST_RESEND_MS / 1000} s`);
    }
    return true;
  });
  let h = heavy;
  if (h) {
    const cur = typeof vals["profile"] === "string" ? vals["profile"] as string : null;
    if (cur === h.restore) {
      io.notify("gust-heavy-profile", "Profile restored to pre-gust value");
      h = null;
    } else if (cur != null && cur !== h.heavy) {
      io.notify("gust-heavy-profile", `Manual profile change (${cur}) detected during gust heavy - not restoring`);
      h = null;
    } else if (now - h.lastSendTs >= GUST_RESEND_MS) {
      h.lastSendTs = now;
      let ok = false;
      try { io.markProfile(h.restore); ok = io.set("profile", h.restore); } catch { /* silent */ }
      if (!ok) io.debug(`[gust] profile restore not sent, retrying in ${GUST_RESEND_MS / 1000} s`);
    }
  }
  return { pending: keep, heavy: h };
}
