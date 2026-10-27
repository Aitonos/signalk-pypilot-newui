// Rev554 (Carlos 2026-10-27, docs/_audit_data_flow_2026-10-27.md): the
// plugin republished ~34 diagnostic paths every second whether they had
// changed or not. Signal K fans each path out as its own delta to every
// subscriber, so moored that was ~400 KB/min per open visor tab of
// identical values. This filter lets a publisher drop values equal to
// the last one sent for the same path, while still re-sending each path
// at least every `heartbeatMs` so late joiners and staleness checks see
// it alive.

export const CHANGE_FILTER_HEARTBEAT_MS = 30_000;

export interface PathValue { path: string; value: unknown }

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    // Relative tolerance: float noise from recomputed aggregates is not a change.
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export class ChangeFilter {
  private last = new Map<string, { value: unknown; ts: number }>();

  constructor(private readonly heartbeatMs = CHANGE_FILTER_HEARTBEAT_MS) {}

  /** Values that changed since last sent, or whose heartbeat is due. */
  filter(values: PathValue[], nowMs: number): PathValue[] {
    const out: PathValue[] = [];
    for (const v of values) {
      const prev = this.last.get(v.path);
      if (prev && sameValue(prev.value, v.value) && nowMs - prev.ts < this.heartbeatMs) continue;
      this.last.set(v.path, { value: v.value, ts: nowMs });
      out.push(v);
    }
    return out;
  }

  /** Forget everything: the next filter() sends every path. */
  reset(): void {
    this.last.clear();
  }
}
