// Rev671 (Carlos 2026-11-09): image of the TinyPilot's SD card, the backup
// for everything the plugin must not restore itself (IMU / compass
// calibration, servo, the whole piCore system). Only the partitions are
// read - on the boat 1.1 GB of a 15 GB card - so the image fits any card of
// 2 GB or more and is written back with Raspberry Pi Imager / balenaEtcher.
// ~/.pypilot lives on the SD (/mnt/mmcblk0p2/.pypilot), so the image has
// every profile and calibration as pypilot last saved them.

/** Lists "start size" (512-byte sectors) of every partition of the card. */
export const SD_PROBE_COMMAND = "for p in /sys/block/mmcblk0/mmcblk0p*; do echo $(cat $p/start) $(cat $p/size); done";
export const SD_KEEP = 3;
const NAME = /^tinypilot-sd-(\d{4}-\d{2}-\d{2})\.img\.gz$/;

/** MiB to read from the start of the card to include every partition. */
export function sdImageMiB(probeStdout: string): number | null {
  let end = 0;
  for (const line of String(probeStdout).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line.replace(/\r$/, ""));
    if (m) end = Math.max(end, Number(m[1]) + Number(m[2]));
  }
  if (!end) return null;
  return Math.ceil((end * 512) / (1024 * 1024));
}

/** Reads the card at the lowest priority; `sync` first so what pypilot just
 *  saved is on it. */
export function sdReadCommand(mib: number): string {
  return `sync; sudo nice -n 19 dd if=/dev/mmcblk0 bs=1M count=${Math.floor(mib)} 2>/dev/null`;
}

/** Rev734 (Carlos 2026-11-22; GPT and Gemini audit): a consistent image.
 *  pypilot writes pypilot.conf to the card every few minutes, so a plain dd
 *  can catch a half-written file. Stop pypilot, its web and hat services,
 *  sync, remount the card read-only, read it, then put everything back.
 *  - Only the image goes to stdout; "PNU_RO=1" (or 0 if the read-only
 *    remount was refused) goes to stderr. On the boat's TinyPilot it is
 *    refused (3 extensions are loop-mounted read-write from the card), so in
 *    practice the protection is pypilot stopped (the only regular writer)
 *    plus sync; read-only is a bonus where it works.
 *  - Everything is put back on exit, also if the SSH session drops (trap),
 *    and a detached safety net does it again after `netS` seconds in case
 *    the shell is killed outright. Both are harmless if already done. */
export const SD_PART = "/mnt/mmcblk0p2";
const SD_SERVICES = "/etc/sv/pypilot /etc/sv/pypilot_web /etc/sv/pypilot_hat";
export function sdReadConsistentCommand(mib: number, netS = 1800): string {
  const back = `sudo mount -o remount,rw ${SD_PART} >/dev/null 2>&1; sudo sv up ${SD_SERVICES} >/dev/null 2>&1`;
  // "cmd &" must not be followed by ";" (a syntax error in sh).
  return `setsid sh -c 'sleep ${Math.floor(netS)}; ${back}' </dev/null >/dev/null 2>&1 & ` + [
    `trap '${back}' EXIT HUP INT TERM`,
    `sudo sv down ${SD_SERVICES} >/dev/null 2>&1`,
    `sleep 2; sync`,
    `RO=0; sudo mount -o remount,ro ${SD_PART} >/dev/null 2>&1 && RO=1`,
    `echo "PNU_RO=$RO" >&2`,
    `sudo nice -n 19 dd if=/dev/mmcblk0 bs=1M count=${Math.floor(mib)} 2>/dev/null`,
  ].join("; ");
}

export function sdImageName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `tinypilot-sd-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.img.gz`;
}
export function isSdImageName(n: string): boolean { return NAME.test(String(n)); }

/** Rev672 (Carlos 2026-11-09): where the image may go - the default folder,
 *  or any writable USB stick / disk / network share mounted under /media or
 *  /mnt (OpenPlotter mounts sticks at /media/pi/<label>). Only these: the
 *  route never writes to a path the sailor typed. */
export interface SdDestination { id: string; label: string; dir: string; mount: string }
const SKIP_FS = new Set(["proc", "sysfs", "tmpfs", "devtmpfs", "squashfs", "overlay", "cgroup", "cgroup2", "autofs", "debugfs", "tracefs"]);
export function sdDestinations(procMounts: string, defaultDir: string, defaultMount: string): SdDestination[] {
  const out: SdDestination[] = [{ id: "default", label: defaultDir, dir: defaultDir, mount: defaultMount }];
  const seen = new Set<string>();
  for (const line of String(procMounts).split("\n")) {
    const [, rawMount, fstype, opts] = line.split(" ");
    if (!rawMount || !fstype) continue;
    const mount = rawMount.replace(/\\040/g, " ");
    if (!/^\/(media|mnt)\//.test(mount) || SKIP_FS.has(fstype)) continue;
    if (String(opts || "").split(",").includes("ro")) continue;
    if (seen.has(mount)) continue;
    seen.add(mount);
    out.push({ id: mount, label: mount, dir: `${mount}/Backups-pypilot-newui`, mount });
  }
  return out;
}

/** Rev673 (Carlos 2026-11-09): a folder the sailor picked in the visor's
 *  folder browser. Only inside the home folder, /media (USB sticks) or /mnt
 *  (disks, network shares) - never system folders. `realPath` is the path
 *  with every symlink resolved, so a link cannot lead outside. */
export function folderRoots(home: string): string[] { return [home, "/media", "/mnt"]; }
export function isAllowedFolder(realPath: string, home: string): boolean {
  const p = String(realPath || "");
  if (!p.startsWith("/") || p.includes("\0")) return false;
  const norm = p.replace(/\/+$/, "") || "/";
  return folderRoots(home).some((r) => norm === r || norm.startsWith(`${r}/`));
}

/** Names to delete so the newest SD_KEEP stay. */
export function sdImagesToDrop(names: string[], keep = SD_KEEP): string[] {
  return names.filter(isSdImageName).sort().reverse().slice(keep);
}
