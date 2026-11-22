// Rev735 (Carlos 2026-11-22): prepare a new TinyPilot image with the boat's
// own settings already inside, to be written to a SECOND card (the card in
// use is never touched: it stays as the way back). Plan and audits:
// docs/_plan_imagen_personalizada_tinypilot_2026-11-22.md and
// docs/_auditoria_actualizacion_tinypilot_*.md (GPT + Gemini).
//
// Pure functions only: what goes into ~/.pypilot of the new image, worked
// out from the boat's backup (settings-backup.ts) and the files the new
// image already carries. Not tied to one pypilot version: every critical
// file is checked in both places and merged only when its format matches;
// anything that does not fit is skipped with the reason, never guessed.
//
// Found in Sean's 0.71 image (2026-07-05): its ~/.pypilot holds his own test
// boat's settings (IMU calibration, rudder range 15, servo 3.3 A, his remote
// codes, his wifi). So a group the sailor does not bring over must not keep
// those: boat-specific values (IMU, motor and rudder) are then REMOVED so
// pypilot starts from its own defaults and asks for calibration.

export type GroupId = "wifi" | "remotes" | "profiles" | "imu" | "motor" | "sensors" | "login" | "signalk" | "skFix";
export type Groups = Record<GroupId, boolean>;

export const DEFAULT_GROUPS: Groups = {
  wifi: true, remotes: true, profiles: true, imu: false, motor: true, sensors: true, login: true, signalk: false, skFix: true,
};

// ---------- pypilot.conf ----------

/** One line of pypilot.conf, raw value text kept (pypilot's own number
 *  formatting is preserved). */
interface ConfLine { key: string; raw: string }
interface ConfSection { name: string; header: string; lines: ConfLine[] }
export interface ParsedConf { global: ConfLine[]; sections: ConfSection[]; bad: string[] }

function rawOk(raw: string): boolean {
  const s = raw.trim();
  if (s === "True" || s === "False") return true;
  try { JSON.parse(s); return true; } catch { return false; }
}

export function parseConf(text: string): ParsedConf {
  const out: ParsedConf = { global: [], sections: [], bad: [] };
  let cur: ConfLine[] = out.global;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const sec = /^\[profile=(.*)\]\s*$/.exec(line);
    if (sec) {
      let name: unknown = null;
      try { name = JSON.parse(sec[1]); } catch { /* unreadable */ }
      if (typeof name !== "string") { out.bad.push(line); cur = []; continue; }
      const s: ConfSection = { name, header: line, lines: [] };
      out.sections.push(s);
      cur = s.lines;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) { out.bad.push(line); continue; }
    const key = line.slice(0, eq).trim();
    const v = line.slice(eq + 1);
    if (!rawOk(v)) { out.bad.push(line); continue; }
    cur.push({ key, raw: v.trim() });
  }
  return out;
}

function serialize(c: ParsedConf): string {
  const lines = c.global.map((l) => `${l.key}=${l.raw}`);
  for (const s of c.sections) { lines.push(s.header); for (const l of s.lines) lines.push(`${l.key}=${l.raw}`); }
  return lines.join("\n") + "\n";
}

/** Never carried over: counters, values pypilot recomputes (gyro bias),
 *  raw calibration samples. Removed from the new image too, so nothing of
 *  the image's previous owner stays. */
export function isNeverKey(k: string): boolean {
  return k === "imu.gyrobias" || /\.calibration\.points$/.test(k)
    || k === "servo.faults" || k === "servo.amp_hours" || k === "ap.tack.count";
}

const IMU_KEYS = new Set(["imu.alignmentQ", "imu.heading_offset", "imu.accel.calibration", "imu.accel.calibration.locked", "imu.compass.calibration", "imu.compass.calibration.locked"]);
const SENSOR_EXTRA = new Set(["apb.xte.gain", "ap.gps_and_nav_modes", "ap.tack.use_heel", "ap.tack.use_wind_direction", "ap.wind_offset_filter", "ap.pilot.rate.maxturnrate"]);

/** Which group a GLOBAL key belongs to (null: left as the image has it). */
export function groupOf(k: string): GroupId | null {
  if (isNeverKey(k)) return null;
  if (IMU_KEYS.has(k)) return "imu";
  if (/^(servo|rudder)\./.test(k)) return "motor";
  if (/^(nmea|gps|wind|truewind|water)\./.test(k) || SENSOR_EXTRA.has(k)) return "sensors";
  if (k === "signalk.uid") return "signalk";
  return null;
}

export interface ConfChange { key: string; from: string | null; to: string | null; group: GroupId | "never" | "profiles" }
export interface ConfMerge {
  text: string;
  changes: ConfChange[];
  /** Profile values the new image does not know (left out). */
  droppedProfileKeys: string[];
  /** Global keys of the backup in no group (not carried over). */
  notCarried: string[];
  profiles: string[];
  warnings: string[];
}

/** Merges the boat's pypilot.conf into the new image's.
 *  - Groups ticked: the boat's values replace the image's (added when the
 *    image has no such line, with a warning).
 *  - IMU and motor not ticked: the image's values are removed (pypilot's
 *    defaults, never the previous owner's calibration).
 *  - Never-keys removed. Profiles: the image's are replaced by the boat's
 *    active ones (deleted profiles left behind in the file are not kept). */
export function mergePypilotConf(imageText: string | null, boatText: string, groups: Groups): ConfMerge {
  const img = parseConf(imageText ?? "");
  const boat = parseConf(boatText);
  const changes: ConfChange[] = [];
  const warnings: string[] = [];
  if (!imageText) warnings.push("The new image has no pypilot.conf: it is created from the boat's values only.");
  if (boat.bad.length) warnings.push(`${boat.bad.length} unreadable line(s) in the boat's pypilot.conf were left out.`);
  if (img.bad.length) warnings.push(`${img.bad.length} unreadable line(s) in the image's pypilot.conf were dropped.`);

  const boatGlobal = new Map(boat.global.map((l) => [l.key, l.raw]));
  const out: ConfLine[] = [];
  const done = new Set<string>();
  for (const l of img.global) {
    if (l.key === "profile" || l.key === "profiles") { if (!groups.profiles) out.push(l); continue; }
    if (isNeverKey(l.key)) { changes.push({ key: l.key, from: l.raw, to: null, group: "never" }); continue; }
    const g = groupOf(l.key);
    if (g && groups[g] && boatGlobal.has(l.key)) {
      const to = boatGlobal.get(l.key)!;
      if (to !== l.raw) changes.push({ key: l.key, from: l.raw, to, group: g });
      out.push({ key: l.key, raw: to });
      done.add(l.key);
      continue;
    }
    if (g && !groups[g] && (g === "imu" || g === "motor")) { changes.push({ key: l.key, from: l.raw, to: null, group: g }); continue; }
    out.push(l);
    done.add(l.key);
  }
  const notCarried: string[] = [];
  for (const l of boat.global) {
    if (done.has(l.key) || l.key === "profile" || l.key === "profiles" || isNeverKey(l.key)) continue;
    const g = groupOf(l.key);
    if (g && groups[g]) {
      out.push(l);
      changes.push({ key: l.key, from: null, to: l.raw, group: g });
      if (imageText) warnings.push(`${l.key}: not in the new image's file, added with the boat's value.`);
    } else if (!g) notCarried.push(l.key);
  }

  let sections = img.sections;
  let profiles: string[] = img.sections.map((s) => s.name);
  const droppedProfileKeys = new Set<string>();
  if (groups.profiles) {
    let list: string[] = [];
    try { const p = JSON.parse(boatGlobal.get("profiles") ?? "[]"); if (Array.isArray(p)) list = p.filter((x) => typeof x === "string"); } catch { /* none */ }
    const known = new Set(img.sections.flatMap((s) => s.lines.map((l) => l.key)));
    const keep = boat.sections.filter((s) => list.length === 0 || list.includes(s.name));
    sections = keep.map((s) => ({
      ...s,
      lines: s.lines.filter((l) => {
        if (isNeverKey(l.key)) return false;
        if (known.size && !known.has(l.key)) { droppedProfileKeys.add(l.key); return false; }
        return true;
      }),
    }));
    profiles = sections.map((s) => s.name);
    const active = boatGlobal.get("profile");
    const listRaw = JSON.stringify(profiles.length ? (list.length ? list.filter((n) => profiles.includes(n)) : profiles) : ["default"]);
    out.unshift({ key: "profiles", raw: listRaw });
    let activeName: unknown = null;
    try { activeName = active ? JSON.parse(active) : null; } catch { /* none */ }
    out.unshift({ key: "profile", raw: JSON.stringify(typeof activeName === "string" && profiles.includes(activeName) ? activeName : (profiles[0] ?? "default")) });
    changes.push({ key: "profiles", from: JSON.stringify(img.sections.map((s) => s.name)), to: listRaw, group: "profiles" });
    if (droppedProfileKeys.size) warnings.push(`Profile values the new image does not know were left out: ${[...droppedProfileKeys].join(", ")}.`);
  }
  if (groups.imu) {
    for (const k of ["imu.accel.calibration.locked", "imu.compass.calibration.locked"]) {
      if (boatGlobal.get(k) === "true") warnings.push(`${k} is true in the copy: that calibration stays locked on the new card.`);
    }
  }
  return { text: serialize({ global: out, sections, bad: [] }), changes, droppedProfileKeys: [...droppedProfileKeys], notCarried, profiles, warnings };
}

// ---------- networking.txt ----------

function parseKv(text: string): Map<string, string> | null {
  const m = new Map<string, string>();
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) return null;
    m.set(line.slice(0, eq).trim(), line.slice(eq + 1));
  }
  return m;
}
const NET_REQUIRED = ["mode", "client_ssid"];

export interface FileMerge { text: string | null; action: "merge" | "copy" | "skip"; reason: string }

/** The image's keys, with the boat's values. Needs the same key=value
 *  format on both sides (mode, client_ssid...). */
export function mergeNetworking(imageText: string | null, boatText: string | null): FileMerge {
  if (!boatText) return { text: null, action: "skip", reason: "not in the copy (make a new copy first)" };
  const b = parseKv(boatText);
  if (!b || !NET_REQUIRED.every((k) => b.has(k))) return { text: null, action: "skip", reason: "the copy's file has an unknown format" };
  if (!imageText) return { text: boatText.replace(/\n*$/, "\n"), action: "copy", reason: "the new image has none: the boat's is used as it is" };
  const i = parseKv(imageText);
  if (!i || !NET_REQUIRED.every((k) => i.has(k))) return { text: null, action: "skip", reason: "the new image uses another format: set the wifi on its /wifi page" };
  const extra = [...b.keys()].filter((k) => !i.has(k));
  const lines = [...i.keys()].map((k) => `${k}=${b.has(k) ? b.get(k) : i.get(k)}`);
  return { text: lines.join("\n") + "\n", action: "merge", reason: extra.length ? `merged; not in the new format: ${extra.join(", ")}` : "merged" };
}

/** Sean's image keeps a client-mode copy (networking.txt-client): same
 *  keys, rewritten with the boat's client values so no other wifi stays. */
export function mergeNetworkingClient(imageText: string | null, boatText: string | null): FileMerge {
  if (!imageText) return { text: null, action: "skip", reason: "not in the new image" };
  if (!boatText) return { text: null, action: "skip", reason: "not in the copy (make a new copy first)" };
  const i = parseKv(imageText), b = parseKv(boatText);
  if (!i || !b) return { text: null, action: "skip", reason: "unknown format" };
  const lines = [...i.keys()].map((k) => `${k}=${k.startsWith("client_") && b.has(k) ? b.get(k) : i.get(k)}`);
  return { text: lines.join("\n") + "\n", action: "merge", reason: "client wifi of the boat" };
}

// ---------- hat.conf ----------

/** Remote codes ("actions") and display preferences ("lcd") from the boat;
 *  the hardware part stays as the image has it (the HAT's EEPROM fills it
 *  at boot). */
export function mergeHatConf(imageText: string | null, boatText: string | null): FileMerge {
  if (!boatText) return { text: null, action: "skip", reason: "not in the copy" };
  let b: any, i: any;
  try { b = JSON.parse(boatText); } catch { return { text: null, action: "skip", reason: "the copy's file is not valid JSON" }; }
  if (!imageText) return { text: null, action: "skip", reason: "the new image has none: set the remote again on the TinyPilot" };
  try { i = JSON.parse(imageText); } catch { return { text: null, action: "skip", reason: "the new image's file is not valid JSON" }; }
  if (!b || typeof b !== "object" || !i || typeof i !== "object") return { text: null, action: "skip", reason: "unknown format" };
  if (b.actions && typeof b.actions === "object") i.actions = b.actions;
  if (b.lcd && typeof b.lcd === "object") i.lcd = { ...(i.lcd || {}), ...b.lcd };
  return { text: JSON.stringify(i), action: "merge", reason: "remote codes and display preferences" };
}

// ---------- small files and leftovers ----------

/** Copied only when the new image has the same file (it still uses it) and
 *  both sides parse the same way. */
const SMALL_FILES: Record<string, "json" | "line"> = {
  "servodevice": "json", "pypilot_client.conf": "json", "web.conf": "json", "nmea0device": "json",
  "lcddriver": "line", "blacklist_serial_ports": "line", "gpsd_baud_hint": "line",
};
export function mergeSmallFile(name: string, imageText: string | null, boatText: string | null): FileMerge {
  const kind = SMALL_FILES[name];
  if (!kind) return { text: null, action: "skip", reason: "unknown file" };
  if (!boatText) return { text: null, action: "skip", reason: "not in the copy" };
  if (imageText == null) return { text: null, action: "skip", reason: "the new image does not use it" };
  if (kind === "json") {
    try { JSON.parse(boatText); JSON.parse(imageText); } catch { return { text: null, action: "skip", reason: "format differs" }; }
  }
  return { text: boatText.replace(/\n*$/, "\n"), action: "copy", reason: "same file in the new image" };
}

/** Files in the image's ~/.pypilot that belong to its previous owner or
 *  would bring the old settings back: removed. pypilot falls back to
 *  pypilot.conf.bak when pypilot.conf fails to load, so the .bak is
 *  rewritten with the merged file instead of left with someone else's. */
export function leftoverFiles(names: string[]): string[] {
  return names.filter((n) => /^\.pypilot_conf\./.test(n) || /~$/.test(n)
    || n === "pypilot.conf.restore" || n === "persist_fail" || n === "hat.conf.bak" || n === "signalk-token");
}

// ---------- onboot.lst (the 0.71 Signal K fix) ----------

export const SK_FIX_TCZ = ["python3.11-urllib3.tcz", "python3.11-idna.tcz", "python3.11-certifi.tcz", "python3.11-chardet.tcz", "python3.11-requests.tcz", "python3.11-websocket.tcz"]   // same list as tinypilot071FixCommand (websocket-client ships as "websocket");

/** Adds to onboot.lst the Signal K packages present in tce/optional and
 *  missing from the list. Nothing when they are not in the image. */
export function mergeOnboot(onboot: string, optional: string[]): { text: string; added: string[] } {
  const have = new Set(String(onboot).split("\n").map((s) => s.trim()).filter(Boolean));
  const opt = new Set(optional);
  const added = SK_FIX_TCZ.filter((t) => opt.has(t) && !have.has(t));
  const base = String(onboot).replace(/\n*$/, "\n").replace(/^\n+/, "");
  return { text: base + added.map((t) => t + "\n").join(""), added };
}

// ---------- login (shadow) ----------

/** Replaces the tc line of /etc/shadow with the boat's (same password on
 *  the new card). Only a well-formed tc line with a crypt hash is used. */
export function mergeShadow(imageShadow: string, boatTcLine: string | null): FileMerge {
  const line = String(boatTcLine ?? "").trim();
  if (!/^tc:\$(1|5|6|y|2[aby])\$[^:]+:/.test(line)) return { text: null, action: "skip", reason: "no usable password hash in the copy" };
  const rows = String(imageShadow).split("\n");
  const i = rows.findIndex((r) => r.startsWith("tc:"));
  if (i < 0) return { text: null, action: "skip", reason: "the new image has no tc user" };
  rows[i] = line;
  return { text: rows.join("\n"), action: "merge", reason: "the TinyPilot's password" };
}
