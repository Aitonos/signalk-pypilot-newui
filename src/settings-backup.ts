// Rev650 (Carlos 2026-11-06/07): daily backup of every setting, in a
// folder the sailor can SEE ("una copia que no sabes que tienes no sirve
// para nada"): ~/Backups-pypilot-newui/ in the home of the user Signal K
// runs as, not hidden under ~/.signalk.
//
// One readable JSON file per day (pypilot-newui-YYYY-MM-DD.json, ~50-80 KB),
// the last BACKUP_KEEP kept. It carries:
//   - config: the /config/export bundle (plugin options without secrets +
//     pypilot's persistent settings of the active profile) - what
//     /config/import restores;
//   - plugin: the plugin's own small state files (visor prefs, display
//     presets, servo baseline, gain watchdog lease);
//   - tinypilot: pypilot's own config files from the TinyPilot over SSH
//     (pypilot.conf holds EVERY profile's gains), when SSH is configured.
// Never: trips, sessions, logs, history, black box (data, not settings),
// the SSH password or pypilot's Signal K token. Rev734: it does carry the
// boat wifi key (networking.txt), the TinyPilot's password HASH and its SSH
// host keys, needed to prepare a new image; never logged.
import fs from "fs";
import os from "os";
import path from "path";

export const BACKUP_KEEP = 30;
export const BACKUP_DIR_NAME = "Backups-pypilot-newui";
const NAME = /^pypilot-newui-(\d{4}-\d{2}-\d{2})\.json$/;

/** Plugin options never written to a backup file. */
export const BACKUP_SECRET_KEYS = ["sshPassword"];

/** pypilot files copied from the TinyPilot (~/.pypilot). Not the
 *  signalk-token, not the .bak copies. Rev734 (Carlos 2026-11-22): also the
 *  boat wifi (networking.txt), the display driver and the files newer images
 *  keep there (web.conf, nmea0device), so a new image can be prepared with
 *  them (tinypilot-migrate.ts). Files a given image does not have are simply
 *  not in the copy. */
export const TINYPILOT_FILES = ["pypilot.conf", "hat.conf", "pypilot_client.conf", "RTIMULib.ini", "servodevice", "blacklist_serial_ports", "gpsd_baud_hint", "networking.txt", "lcddriver", "web.conf", "nmea0device"];

/** Rev734: system files outside ~/.pypilot, read with sudo, so the new image
 *  keeps the TinyPilot's login and identity: the tc line of /etc/shadow (the
 *  password hash, never the password) and the SSH host keys (the plugin then
 *  still recognises the TinyPilot). DSA keys are left out: newer OpenSSH
 *  refuses them. */
const SSH_KEY_DIR = "/usr/local/etc/ssh";
const HOST_KEY_TYPES = ["rsa", "ecdsa", "ed25519"];
export const TINYPILOT_SYSTEM_FILES = [
  "sys/shadow-tc",
  ...HOST_KEY_TYPES.flatMap((t) => [`sys/ssh_host_${t}_key`, `sys/ssh_host_${t}_key.pub`]),
];

export function backupDir(home: string = os.homedir()): string {
  return path.join(home, BACKUP_DIR_NAME);
}

export function dayName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `pypilot-newui-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export interface BackupFileInfo { name: string; ts: number; size: number }

export function listBackups(dir: string): BackupFileInfo[] {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out: BackupFileInfo[] = [];
  for (const n of names) {
    if (!NAME.test(n)) continue;
    try { const st = fs.statSync(path.join(dir, n)); out.push({ name: n, ts: st.mtimeMs, size: st.size }); } catch { /* gone */ }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));   // newest first
}

/** Writes today's file (replacing an earlier one of the same day) and keeps
 *  the newest `keep`. Atomic: a crash never leaves a half file. */
export function writeBackup(dir: string, now: Date, content: unknown, keep = BACKUP_KEEP): BackupFileInfo {
  fs.mkdirSync(dir, { recursive: true });
  const name = dayName(now);
  const full = path.join(dir, name);
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(content, null, 2));
  fs.renameSync(tmp, full);
  for (const old of listBackups(dir).slice(keep)) {
    try { fs.unlinkSync(path.join(dir, old.name)); } catch { /* gone */ }
  }
  const st = fs.statSync(full);
  return { name, ts: st.mtimeMs, size: st.size };
}

/** Rev663: name of the newest copy kept in the plugin's data dir (inside
 *  ~/.signalk), for tools that back up the whole Signal K folder. */
export const LATEST_COPY_NAME = "settings-backup-latest.json";

/** Rev663: atomic write of the newest copy into the plugin's data dir. */
export function writeLatestCopy(dataDir: string, content: unknown): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const full = path.join(dataDir, LATEST_COPY_NAME);
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(content, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, full);
  return full;
}

/** Only names this module writes may become a path (download by name). */
export function isBackupName(name: string): boolean { return NAME.test(String(name)); }

export function stripSecrets(opts: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(opts || {}));
  for (const k of BACKUP_SECRET_KEYS) delete out[k];
  return out;
}

/** Splits the output of the TinyPilot copy command into files. */
export const TINYPILOT_MARK = "===PNU:FILE===";
// Rev734: "echo;" before each mark - a file without a final newline
// (gpsd_baud_hint is just "4800") used to glue the next mark to its last
// line, and that next file was lost. The extra blank line is trimmed.
/** Rev745 (Carlos 2026-11-22; GPT + Gemini F1): the password hash and the
 *  SSH host keys only when the sailor chose to keep them; otherwise the copy
 *  has none, and the wifi key is blanked (blankWifiKeys). */
export function tinypilotCopyCommand(withSecrets = true): string {
  const own = TINYPILOT_FILES.map((f) => `echo; echo "${TINYPILOT_MARK}${f}"; cat ~/.pypilot/${f} 2>/dev/null`);
  if (!withSecrets) return own.join("; ");
  const sys = [
    `echo; echo "${TINYPILOT_MARK}sys/shadow-tc"; sudo -n grep '^tc:' /etc/shadow 2>/dev/null`,
    ...HOST_KEY_TYPES.flatMap((t) => [
      `echo; echo "${TINYPILOT_MARK}sys/ssh_host_${t}_key"; sudo -n cat ${SSH_KEY_DIR}/ssh_host_${t}_key 2>/dev/null`,
      `echo; echo "${TINYPILOT_MARK}sys/ssh_host_${t}_key.pub"; cat ${SSH_KEY_DIR}/ssh_host_${t}_key.pub 2>/dev/null`,
    ]),
  ];
  return [...own, ...sys].join("; ");
}
export function parseTinypilotFiles(stdout: string): Record<string, string> {
  const files: Record<string, string> = {};
  let cur: string | null = null;
  let buf: string[] = [];
  const close = () => { if (cur && buf.join("").trim()) files[cur] = buf.join("\n").replace(/\n+$/, "") + "\n"; };
  for (const raw of String(stdout).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith(TINYPILOT_MARK)) {
      close();
      const name = line.slice(TINYPILOT_MARK.length).trim();
      cur = TINYPILOT_FILES.includes(name) || TINYPILOT_SYSTEM_FILES.includes(name) ? name : null;
      buf = [];
      continue;
    }
    if (cur) buf.push(line);
  }
  close();
  return files;
}

/** Rev745: networking.txt without its keys (key= / client_key= emptied). */
export function blankWifiKeys(text: string): string {
  return String(text).split("\n").map((l) => /^(key|client_key)=/.test(l) ? l.replace(/=.*$/, "=") : l).join("\n");
}
