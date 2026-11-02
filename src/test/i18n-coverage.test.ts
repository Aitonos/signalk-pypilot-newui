// Every visor text must exist in every language. t() falls back to EN
// (or to the raw key), so a missing translation never breaks the visor
// silently: it just shows English or "tack.vtFailed" to the user. This
// test makes that visible at build time.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const APP = path.join(__dirname, "..", "..", "public", "app.js");
const HTML = path.join(__dirname, "..", "..", "public", "index.html");
const LANGS = ["en", "es", "de", "fr"];

// Reads each "    xx: {" block of the I18N object line by line, the same
// layout the visor keeps (6-space indented "key": "value" lines).
function readBlocks(src: string): Record<string, { keys: Map<string, string>; dups: string[] }> {
  const lines = src.split("\n");
  const out: Record<string, { keys: Map<string, string>; dups: string[] }> = {};
  for (const lang of LANGS) {
    const start = lines.indexOf(`    ${lang}: {`);
    assert.ok(start >= 0, `I18N block '${lang}' not found`);
    const keys = new Map<string, string>();
    const dups: string[] = [];
    for (let i = start + 1; i < lines.length && !/^    \},?$/.test(lines[i]); i++) {
      const m = /^\s+"([^"]+)":\s*"(.*)",?\s*(\/\/.*)?$/.exec(lines[i]);
      if (!m) continue;
      if (keys.has(m[1])) dups.push(m[1]);
      keys.set(m[1], m[2]);
    }
    out[lang] = { keys, dups };
  }
  return out;
}

const placeholders = (s: string): string => (s.match(/\{\w+\}/g) || []).sort().join(",");

describe("visor i18n", () => {
  const src = fs.readFileSync(APP, "utf8");
  const blocks = readBlocks(src);
  const en = blocks.en.keys;

  it("has no duplicate keys inside a language (the last one would win silently)", () => {
    for (const lang of LANGS) assert.deepEqual(blocks[lang].dups, [], `duplicates in ${lang}`);
  });

  for (const lang of LANGS.filter((l) => l !== "en")) {
    it(`${lang} has every EN key`, () => {
      const missing = [...en.keys()].filter((k) => !blocks[lang].keys.has(k));
      assert.deepEqual(missing, [], `missing in ${lang}`);
    });

    it(`${lang} keeps the same {placeholders} as EN`, () => {
      const bad = [...en.entries()]
        .filter(([k, v]) => blocks[lang].keys.has(k) && placeholders(v) !== placeholders(blocks[lang].keys.get(k)!))
        .map(([k]) => k);
      assert.deepEqual(bad, [], `placeholder mismatch in ${lang}`);
    });
  }

  it("every literal t(\"key\") and data-i18n key used by the visor exists in EN", () => {
    const html = fs.readFileSync(HTML, "utf8");
    const used = new Set<string>();
    for (const re of [/\bt\(\s*"([^"]+)"/g, /data-i18n(?:-[a-z]+)?="([^"]+)"/g]) {
      for (const s of [src, html]) for (const m of s.matchAll(re)) used.add(m[1]);
    }
    const unknown = [...used].filter((k) => !en.has(k) && !/[${}+:,]/.test(k));
    assert.deepEqual(unknown, [], "keys used but not defined in EN");
  });
});
