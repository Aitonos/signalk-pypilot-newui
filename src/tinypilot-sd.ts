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
