// Rev501 (Carlos 2026-10-18, "¿no se puede hacer como los comandos que
// mandamos a la Pi Zero?"): Firefox on the Raspberry Pi's own screen
// needs gfx.webrender.software=true (GPU WebRender on the V3D: ~94 % GPU
// with the visor, 64 % dropped video frames; software: ~3 % GPU, same
// CPU). A web page cannot change a Firefox pref, but this plugin runs on
// that same Pi as the same OS user, so it can write the pref into the
// profiles' user.js — only when the sailor taps "Apply" in the Info tab.
// Firefox reads user.js at start-up: it must be restarted afterwards.

import * as fs from "fs";
import * as path from "path";

export const FIREFOX_SW_PREF = 'user_pref("gfx.webrender.software", true);';
const PREF_RE = /^\s*user_pref\(\s*["']gfx\.webrender\.software["']\s*,\s*true\s*\)/m;
const HEADER = "// Added by signalk-pypilot-newui: software WebRender (GPU WebRender is slow on the Raspberry Pi)";

export interface FirefoxProfileStatus {
  path: string;
  applied: boolean;
}

/** Firefox roots for this OS user: the regular one and the snap one. */
export function firefoxRoots(home: string): string[] {
  return [
    path.join(home, ".mozilla", "firefox"),
    path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
  ];
}

/** Profiles declared in each root's profiles.ini that exist on disk. */
export function findProfiles(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    let ini = "";
    try { ini = fs.readFileSync(path.join(root, "profiles.ini"), "utf8"); } catch { continue; }
    let rel = true;
    let p: string | null = null;
    const flush = () => {
      if (p) {
        const dir = rel ? path.join(root, p) : p;
        try {
          if (fs.statSync(dir).isDirectory() && !out.includes(dir)) out.push(dir);
        } catch { /* missing profile dir */ }
      }
      rel = true; p = null;
    };
    for (const raw of ini.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("[")) { flush(); continue; }
      const m = /^(\w+)=(.*)$/.exec(line);
      if (!m) continue;
      if (m[1] === "Path") p = m[2];
      else if (m[1] === "IsRelative") rel = m[2] !== "0";
    }
    flush();
  }
  return out;
}

export function profileStatus(dir: string): FirefoxProfileStatus {
  let txt = "";
  try { txt = fs.readFileSync(path.join(dir, "user.js"), "utf8"); } catch { /* none yet */ }
  return { path: dir, applied: PREF_RE.test(txt) };
}

export function firefoxFixStatus(home: string): FirefoxProfileStatus[] {
  return findProfiles(firefoxRoots(home)).map(profileStatus);
}

/** Append the pref to every profile's user.js that lacks it (idempotent). */
export function applyFirefoxFix(home: string): FirefoxProfileStatus[] {
  return findProfiles(firefoxRoots(home)).map((dir) => {
    const st = profileStatus(dir);
    if (st.applied) return st;
    const file = path.join(dir, "user.js");
    let prev = "";
    try { prev = fs.readFileSync(file, "utf8"); } catch { /* new file */ }
    const sep = prev && !prev.endsWith("\n") ? "\n" : "";
    try {
      fs.writeFileSync(file, prev + sep + HEADER + "\n" + FIREFOX_SW_PREF + "\n");
    } catch { return st; }
    return profileStatus(dir);
  });
}
