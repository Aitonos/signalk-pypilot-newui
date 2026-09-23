// Rev296 (Carlos, navigating - bug D "me cargaba con default"):
// running log of every ap.mode profile change the plugin observes,
// with WHO caused it. Provides a durable audit trail so the sailor
// can go back after a surprise switch and see which subsystem did it
// (auto-profile? gust supervisor? another client? pypilot itself?).
//
// Sources tracked:
//   "user"                  — /profiles PUT handler from the visor / KIP
//   "auto-profile"          — the Rev164 auto-profile-by-wind-band supervisor
//   "gust-heavy"            — the Rev167 gust temp-heavy strategy switching TO heavy
//   "gust-heavy-restore"    — the same strategy restoring the pre-gust profile
//   "doctor"                — the Doctor's ensureForkedProfile()
//   "external"              — a delta from pypilot that does NOT match
//                             any plugin-initiated write we have on record
//                             (another SK client, or pypilot rebooted, etc.)
//
// This module is PURE data + policy. The plugin wires it as follows:
//   - Every time the plugin CALLS client.set("profile", name) it first
//     invokes markPlannedWrite(name, source, reason). That records
//     the intent, and the next 'profile' delta from pypilot that
//     matches the planned name is credited to that source.
//   - Any 'profile' delta that arrives WITHOUT a matching planned
//     write (or whose write is older than the correlation window) is
//     recorded as "external".

export type ProfileChangeSource =
  | "user"
  | "auto-profile"
  | "gust-heavy"
  | "gust-heavy-restore"
  | "doctor"
  | "external"
  | "unknown";

export interface ProfileChangeEntry {
  /** Wall-clock ms when the delta landed. */
  ts: number;
  /** Previous profile name (null when the plugin had not seen a name yet). */
  from: string | null;
  /** New profile name (whatever pypilot echoed). */
  to: string;
  /** Attributed source. Best-effort — "external" when nobody claimed it. */
  source: ProfileChangeSource;
  /** Optional human explanation ("TWS avg 6.2 kn → light → profile fastGenoa"). */
  reason?: string;
}

interface PlannedWrite {
  name: string;
  source: ProfileChangeSource;
  reason?: string;
  ts: number;
}

export interface ProfileChangeLogOptions {
  /** How many wall-clock ms a planned write stays credit-eligible. Once a
   *  matching delta lands OR the window expires, the record is discarded.
   *  Default 3000 (matches pypilot's typical echo latency plus retry). */
  correlationWindowMs?: number;
  /** Ring buffer capacity. Default 50. */
  ringCapacity?: number;
}

export class ProfileChangeLog {
  private readonly ring: ProfileChangeEntry[] = [];
  private planned: PlannedWrite[] = [];
  private lastProfile: string | null = null;
  private readonly correlationWindowMs: number;
  private readonly ringCapacity: number;

  constructor(opts: ProfileChangeLogOptions = {}) {
    this.correlationWindowMs = Math.max(200, opts.correlationWindowMs ?? 3000);
    this.ringCapacity = Math.max(1, opts.ringCapacity ?? 50);
  }

  /** Register an intent to write. Call BEFORE client.set("profile", name). */
  markPlannedWrite(name: string, source: ProfileChangeSource, reason?: string, now: number = Date.now()): void {
    // Drop any expired planned writes so they don't pile up on lossy connections.
    this.gcPlanned(now);
    this.planned.push({ name, source, reason, ts: now });
  }

  /** Feed one 'profile' delta from pypilot. */
  observeDelta(newProfile: string, now: number = Date.now()): void {
    this.gcPlanned(now);
    // Match the freshest planned write to this delta.
    let source: ProfileChangeSource = "external";
    let reason: string | undefined;
    for (let i = this.planned.length - 1; i >= 0; i -= 1) {
      const p = this.planned[i];
      if (p.name === newProfile) {
        source = p.source;
        reason = p.reason;
        this.planned.splice(i, 1);
        break;
      }
    }
    // Only record when the profile actually changed. A duplicate delta
    // (pypilot re-emitting the same value) is not a change worth logging.
    if (this.lastProfile !== null && this.lastProfile === newProfile) {
      // Still consume the planned write if any — that's the caller's
      // intent even if the value happened to be identical.
      return;
    }
    const entry: ProfileChangeEntry = {
      ts: now,
      from: this.lastProfile,
      to: newProfile,
      source,
      reason,
    };
    this.ring.push(entry);
    if (this.ring.length > this.ringCapacity) this.ring.shift();
    this.lastProfile = newProfile;
  }

  /** Read-only snapshot, newest last. */
  entries(): ProfileChangeEntry[] {
    return this.ring.slice();
  }

  /** Count of entries attributed to each source. */
  summary(): Record<ProfileChangeSource, number> {
    const out: Record<string, number> = {};
    for (const e of this.ring) out[e.source] = (out[e.source] ?? 0) + 1;
    return {
      user: 0, "auto-profile": 0, "gust-heavy": 0, "gust-heavy-restore": 0,
      doctor: 0, external: 0, unknown: 0, ...out,
    } as Record<ProfileChangeSource, number>;
  }

  /** Wipe RAM state. The correlation window and lastProfile also reset. */
  reset(): void {
    this.ring.length = 0;
    this.planned = [];
    this.lastProfile = null;
  }

  /** Current profile as last seen. Null until the first delta. */
  current(): string | null { return this.lastProfile; }

  // Also expose the pending planned-writes buffer for testing.
  pendingPlanned(): PlannedWrite[] { return this.planned.slice(); }

  private gcPlanned(now: number): void {
    if (this.planned.length === 0) return;
    const cutoff = now - this.correlationWindowMs;
    let i = 0;
    while (i < this.planned.length && this.planned[i].ts < cutoff) i += 1;
    if (i > 0) this.planned.splice(0, i);
  }
}
