import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { applyFirefoxFix, firefoxFixStatus, FIREFOX_SW_PREF } from "../firefox-fix";

function fakeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ffix-"));
  const root = path.join(home, ".mozilla", "firefox");
  fs.mkdirSync(path.join(root, "aaa.default-release"), { recursive: true });
  fs.mkdirSync(path.join(root, "bbb.default"), { recursive: true });
  fs.writeFileSync(path.join(root, "profiles.ini"),
    "[Profile1]\r\nName=default\r\nIsRelative=1\r\nPath=bbb.default\r\n\r\n" +
    "[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=aaa.default-release\r\nDefault=1\r\n\r\n" +
    "[Profile2]\r\nIsRelative=1\r\nPath=gone.profile\r\n");
  return home;
}

describe("firefox-fix", () => {
  it("finds the profiles in profiles.ini that exist, none applied yet", () => {
    const st = firefoxFixStatus(fakeHome());
    assert.equal(st.length, 2);
    assert.ok(st.every((p) => !p.applied));
  });

  it("no Firefox at all -> empty list, apply is a no-op", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ffix-none-"));
    assert.deepEqual(firefoxFixStatus(home), []);
    assert.deepEqual(applyFirefoxFix(home), []);
  });

  it("apply appends the pref once, keeps existing user.js content", () => {
    const home = fakeHome();
    const ujs = path.join(home, ".mozilla", "firefox", "aaa.default-release", "user.js");
    fs.writeFileSync(ujs, 'user_pref("browser.startup.page", 3);');
    const st = applyFirefoxFix(home);
    assert.ok(st.every((p) => p.applied));
    applyFirefoxFix(home);
    const txt = fs.readFileSync(ujs, "utf8");
    assert.ok(txt.startsWith('user_pref("browser.startup.page", 3);\n'));
    assert.equal(txt.split(FIREFOX_SW_PREF).length - 1, 1, "pref written exactly once");
  });

  it("an existing manual pref counts as applied", () => {
    const home = fakeHome();
    const ujs = path.join(home, ".mozilla", "firefox", "bbb.default", "user.js");
    fs.writeFileSync(ujs, "user_pref('gfx.webrender.software', true);\n");
    const st = firefoxFixStatus(home).find((p) => p.path.endsWith("bbb.default"));
    assert.equal(st?.applied, true);
  });
});
