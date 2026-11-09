// Rev665 (Carlos 2026-11-09): the TinyPilot has no clock of its own and no
// internet, so after every reboot it runs about two years behind - its logs
// carry dates that mean nothing. When pypilot comes back (connect) the
// plugin gives it the Signal K server's time over SSH.
//
// Carefully, because of what @signalk/set-system-time did to the IMU:
// RTIMULib stamps samples with the wall clock, so a clock jump corrupts the
// filter's dt and the attitude jumps up to +-150 deg for 1-2 s. Hence:
// - never with the autopilot engaged (it waits);
// - only when the clock is clearly wrong (> CLOCK_SYNC_MIN_OFFSET_S), never
//   small periodic corrections;
// - once per TinyPilot boot (its kernel boot id).

export const CLOCK_SYNC_MIN_OFFSET_S = 300;
export const CLOCK_PROBE_COMMAND = "date -u +%s; cat /proc/sys/kernel/random/boot_id";

export interface ClockProbe { epochS: number; bootId: string }

export function parseClockProbe(stdout: string): ClockProbe | null {
  const lines = String(stdout).split("\n").map((l) => l.replace(/\r$/, "").trim()).filter(Boolean);
  if (lines.length < 2 || !/^\d{9,11}$/.test(lines[0]) || !/^[0-9a-f-]{16,}$/i.test(lines[1])) return null;
  return { epochS: Number(lines[0]), bootId: lines[1] };
}

export type ClockDecision =
  | { action: "set"; offsetS: number }
  | { action: "skip"; reason: "synced-this-boot" | "close-enough" | "engaged"; offsetS: number };

export function decideClockSync(args: {
  probe: ClockProbe;
  serverEpochS: number;
  syncedBootId: string | null;
  engaged: boolean;
}): ClockDecision {
  const offsetS = Math.round(args.serverEpochS - args.probe.epochS);
  if (args.syncedBootId && args.syncedBootId === args.probe.bootId) return { action: "skip", reason: "synced-this-boot", offsetS };
  if (Math.abs(offsetS) <= CLOCK_SYNC_MIN_OFFSET_S) return { action: "skip", reason: "close-enough", offsetS };
  if (args.engaged) return { action: "skip", reason: "engaged", offsetS };
  return { action: "set", offsetS };
}

/** BusyBox date: `date -u -s "YYYY-MM-DD hh:mm:ss"`. */
export function setClockCommand(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${at.getUTCFullYear()}-${p(at.getUTCMonth() + 1)}-${p(at.getUTCDate())} ${p(at.getUTCHours())}:${p(at.getUTCMinutes())}:${p(at.getUTCSeconds())}`;
  return `sudo date -u -s "${s}"`;
}
