// Rev653: admin PIN for the Technical Setup group.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AdminPin, ADMIN_SESSION_MS, ADMIN_LOCKOUT_MS } from "../admin-pin";

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pin-")), "admin-pin.json");

describe("AdminPin (Rev653)", () => {
  it("no PIN set: everything allowed (an update locks nobody out)", () => {
    const p = new AdminPin(file());
    assert.equal(p.isSet(), false);
    assert.equal(p.allows(undefined), true);
  });

  it("set, unlock, expire, lock", () => {
    const f = file();
    const p = new AdminPin(f);
    const t0 = 1_000_000;
    assert.equal(p.setPin("12", undefined, t0).ok, false, "too short");
    const s = p.setPin("4821", undefined, t0);
    assert.ok(s.ok);
    assert.ok(!fs.readFileSync(f, "utf8").includes("4821"), "never stored in clear");
    assert.equal(p.allows(undefined, t0), false);
    const u = p.unlock("4821", t0);
    assert.ok(u.ok);
    const key = (u as any).key;
    assert.equal(p.allows(key, t0 + 1000), true);
    assert.equal(p.allows(key, t0 + ADMIN_SESSION_MS + 1), false, "expired");
    const u2 = p.unlock("4821", t0) as any;
    p.lock(u2.key);
    assert.equal(p.allows(u2.key, t0), false);
    assert.equal(new AdminPin(f).isSet(), true, "survives a restart");
    assert.equal(new AdminPin(f).allows(key, t0), false, "sessions do not");
  });

  it("five wrong PINs block unlocking for five minutes", () => {
    const p = new AdminPin(file());
    const t0 = 2_000_000;
    p.setPin("1234", undefined, t0);
    for (let i = 0; i < 5; i++) assert.equal(p.unlock("0000", t0).ok, false);
    assert.equal(p.unlock("1234", t0 + 1000).ok, false, "even the right one, while blocked");
    assert.equal(p.unlock("1234", t0 + ADMIN_LOCKOUT_MS + 1).ok, true);
  });

  it("changing needs the current PIN; clear forgets it", () => {
    const f = file();
    const p = new AdminPin(f);
    p.setPin("1234");
    assert.equal(p.setPin("5678", "0000").ok, false);
    assert.equal(p.setPin("5678", "1234").ok, true);
    assert.equal(p.unlock("1234").ok, false);
    p.clear();
    assert.equal(p.isSet(), false);
    assert.equal(fs.existsSync(f), false);
  });

  it("switched off: kept, not asked; on again asks it (Rev680)", () => {
    const f = file();
    const p = new AdminPin(f);
    p.setPin("1234");
    assert.equal(p.allows(""), false);
    assert.equal(p.setOn(false), true);
    assert.equal(p.isSet(), true);
    assert.equal(p.isOn(), false);
    assert.equal(p.allows(""), true, "nothing is asked while off");
    assert.equal(new AdminPin(f).isOn(), false, "survives a restart");
    p.setOn(true);
    assert.equal(p.allows(""), false);
    assert.equal(p.unlock("1234").ok, true, "same PIN as before");
  });
});
