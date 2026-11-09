// Rev653 (Carlos 2026-11-07): admin PIN for the "Technical" Setup group,
// independent of mareas-ihm's PIN. See docs/_diseno_pin_admin_2026-11-07.md.
//
// - The PIN is stored as scrypt(pin, salt) in the plugin's data dir, never
//   in the plugin options (so it never travels in an export or backup).
// - Unlocking gives a random session key valid ADMIN_SESSION_MS, kept in
//   memory only (a Signal K restart drops every key).
// - 5 wrong PINs in a row block unlocking for ADMIN_LOCKOUT_MS.
// - No PIN set = nothing is locked (an update never locks anybody out).
import crypto from "crypto";
import fs from "fs";

export const ADMIN_SESSION_MS = 12 * 3600_000;
export const ADMIN_MAX_FAILS = 5;
export const ADMIN_LOCKOUT_MS = 5 * 60_000;
const PIN_RE = /^\d{4,8}$/;

// off: the PIN is kept but not asked (Rev680, boats with only trusted crew).
interface Stored { salt: string; hash: string; setTs: number; off?: boolean }

export class AdminPin {
  private stored: Stored | null = null;
  private sessions = new Map<string, number>();   // key -> expiry ms
  private fails = 0;
  private lockedUntil = 0;

  constructor(private file: string | null) {
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j && typeof j.salt === "string" && typeof j.hash === "string") this.stored = j;
    } catch { /* no PIN yet */ }
  }

  isSet(): boolean { return !!this.stored; }
  /** Set and in use (not switched off). */
  isOn(): boolean { return !!this.stored && !this.stored.off; }
  /** Switch asking for the PIN on or off; the PIN itself is kept. */
  setOn(on: boolean): boolean {
    if (!this.stored) return false;
    this.stored = { ...this.stored, off: !on };
    if (on) this.sessions.clear();
    return this.save();
  }
  lockedUntilMs(now = Date.now()): number { return this.lockedUntil > now ? this.lockedUntil : 0; }

  private hash(pin: string, salt: string): string {
    return crypto.scryptSync(pin, salt, 32).toString("hex");
  }
  private matches(pin: string): boolean {
    if (!this.stored) return false;
    const a = Buffer.from(this.hash(String(pin), this.stored.salt), "hex");
    const b = Buffer.from(this.stored.hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  private save(): boolean {
    if (!this.file) return true;
    try {
      if (this.stored) {
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.stored), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
      } else {
        try { fs.unlinkSync(this.file); } catch { /* none */ }
      }
      return true;
    } catch { return false; }
  }

  /** Set or change the PIN. Changing needs the current one. Returns a fresh
   *  session key so the sailor stays unlocked, or an error. */
  setPin(newPin: string, currentPin?: string, now = Date.now()): { ok: true; key: string } | { ok: false; error: string } {
    if (!PIN_RE.test(String(newPin))) return { ok: false, error: "the PIN is 4 to 8 digits" };
    if (this.stored) {
      const blocked = this.lockedUntilMs(now);
      if (blocked) return { ok: false, error: "too many wrong PINs - wait" };
      if (!this.matches(String(currentPin ?? ""))) { this.noteFail(now); return { ok: false, error: "wrong current PIN" }; }
    }
    const salt = crypto.randomBytes(16).toString("hex");
    this.stored = { salt, hash: this.hash(String(newPin), salt), setTs: now };
    if (!this.save()) { return { ok: false, error: "could not save the PIN" }; }
    this.sessions.clear();
    this.fails = 0;
    return { ok: true, key: this.newSession(now) };
  }

  /** Forget the PIN (the reset box in the Signal K admin). */
  clear(): void {
    this.stored = null;
    this.sessions.clear();
    this.fails = 0;
    this.lockedUntil = 0;
    this.save();
  }

  unlock(pin: string, now = Date.now()): { ok: true; key: string } | { ok: false; error: string; lockedUntil?: number } {
    if (!this.isOn()) return { ok: true, key: this.newSession(now) };
    const blocked = this.lockedUntilMs(now);
    if (blocked) return { ok: false, error: "too many wrong PINs - wait", lockedUntil: blocked };
    if (!this.matches(String(pin ?? ""))) {
      this.noteFail(now);
      const until = this.lockedUntilMs(now);
      return { ok: false, error: "wrong PIN", ...(until ? { lockedUntil: until } : {}) };
    }
    this.fails = 0;
    return { ok: true, key: this.newSession(now) };
  }

  lock(key: string): void { this.sessions.delete(String(key)); }

  /** True when no PIN is set or it is switched off, or the key is a live session. */
  allows(key: unknown, now = Date.now()): boolean {
    if (!this.isOn()) return true;
    if (typeof key !== "string" || !key) return false;
    const exp = this.sessions.get(key);
    if (!exp) return false;
    if (exp <= now) { this.sessions.delete(key); return false; }
    return true;
  }

  private noteFail(now: number): void {
    this.fails++;
    if (this.fails >= ADMIN_MAX_FAILS) { this.lockedUntil = now + ADMIN_LOCKOUT_MS; this.fails = 0; }
  }
  private newSession(now: number): string {
    for (const [k, exp] of this.sessions) if (exp <= now) this.sessions.delete(k);
    const key = crypto.randomBytes(24).toString("hex");
    this.sessions.set(key, now + ADMIN_SESSION_MS);
    return key;
  }
}
