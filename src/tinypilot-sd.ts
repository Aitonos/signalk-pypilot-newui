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

/** Names to delete so the newest SD_KEEP stay. */
export function sdImagesToDrop(names: string[], keep = SD_KEEP): string[] {
  return names.filter(isSdImageName).sort().reverse().slice(keep);
}
