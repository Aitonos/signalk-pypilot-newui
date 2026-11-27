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
// Rev737 (Carlos 2026-11-22): the name says what it is - pypilot version,
// boat, date and time, "backup" - so it never mixes with official images:
// tinypilot-v0.56-tunatunes-2026-11-22-2130-backup.img.gz. Copies made with
// the old name (tinypilot-sd-YYYY-MM-DD.img.gz) are still listed.
const NAME_OLD = /^tinypilot-sd-(\d{4}-\d{2}-\d{2})\.img\.gz$/;
const NAME_NEW = /^tinypilot-v[\w.]+-[a-z0-9-]+-(\d{4}-\d{2}-\d{2}-\d{4})-backup\.img\.gz$/;

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
/** Rev806: what puts the TinyPilot back after a card read (card writable,
 *  pypilot and its web and hat services up). Harmless if already done. */
export const SD_BACK_COMMAND = `sudo mount -o remount,rw ${SD_PART} >/dev/null 2>&1; sudo sv up ${SD_SERVICES} >/dev/null 2>&1`;
export function sdReadConsistentCommand(mib: number, netS = 1800): string {
  const back = SD_BACK_COMMAND;
  // Rev745 (GPT + Gemini): the safety net is killed when the copy ends (it
  // used to wake up 30 min later and could start pypilot in the middle of
  // the next copy), dd is killed before putting things back, and the copy
  // does not start until runit confirms the three services are down.
  // "cmd &" must not be followed by ";" (a syntax error in sh).
  return `setsid sh -c 'sleep ${Math.floor(netS)}; ${back}' </dev/null >/dev/null 2>&1 & NET=$!; ` + [
    // setsid makes the net its own process group: kill the group, sleep included
    // Rev806 (Carlos 2026-11-28, Stop 2 s after the start): a signal used to
    // kill the shell without the EXIT trap (SIGPIPE was not even trapped:
    // writing to the closed session killed it) and pypilot stayed down. Now
    // every signal only exits, and the EXIT trap always puts things back.
    `trap 'kill $DD 2>/dev/null; kill -TERM -$NET 2>/dev/null; kill $NET 2>/dev/null; ${back}' EXIT`,
    `trap 'exit 1' HUP INT TERM PIPE`,
    `sudo sv -w 15 down ${SD_SERVICES} >/dev/null 2>&1`,
    `if sudo sv status ${SD_SERVICES} 2>/dev/null | grep -q "^run:"; then echo "PNU_SVUP=1" >&2; exit 3; fi`,
    `sleep 2; sync`,
    `RO=0; sudo mount -o remount,ro ${SD_PART} >/dev/null 2>&1 && RO=1`,
    `echo "PNU_RO=$RO" >&2`,
    `sudo nice -n 19 dd if=/dev/mmcblk0 bs=1M count=${Math.floor(mib)} 2>/dev/null & DD=$!`,
    `wait $DD`,
  ].join("; ");
}

/** Name part from free text: ascii, lower case, dashes (accents dropped). */
export function slug(s: string, fallback: string): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || fallback;
}
/** "pypilot 0.56" / "0.71" -> "0.56" / "0.71"; unknown -> "unknown". */
export function versionTag(v: string | null | undefined): string {
  const m = /(\d+(?:\.\d+)+)/.exec(String(v ?? ""));
  return m ? m[1] : "unknown";
}
export function backupImageName(d: Date, version: string | null | undefined, boat: string | null | undefined): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `tinypilot-v${versionTag(version)}-${slug(boat ?? "", "boat")}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-backup.img.gz`;
}
export function sdImageName(d: Date, version?: string | null, boat?: string | null): string { return backupImageName(d, version, boat); }
export function isSdImageName(n: string): boolean { return NAME_OLD.test(String(n)) || NAME_NEW.test(String(n)); }
/** Sort key by date (old names have no time: 0000). */
export function sdImageDateKey(n: string): string {
  const a = NAME_NEW.exec(n); if (a) return a[1];
  const b = NAME_OLD.exec(n); return b ? `${b[1]}-0000` : "";
}

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
  return names.filter(isSdImageName).sort((a, b) => sdImageDateKey(b).localeCompare(sdImageDateKey(a))).slice(keep);
}
