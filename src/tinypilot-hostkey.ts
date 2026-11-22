// Rev734 (Carlos 2026-11-22, GPT audit of the TinyPilot update): remember
// the TinyPilot's SSH host key the first time we see it (trust on first
// use) and notice when it changes. Until now ssh2 accepted any machine that
// answered on that address.
//
// For now it only records and reports: a changed key does not block the
// connection (a sailor who re-flashed the card would otherwise lose SSH with
// no way to accept the new key). The image assistant shows the fingerprint,
// keeps the old keys in the new image and asks before accepting a new one.
import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface HostKeyState {
  fingerprint: string | null;
  firstSeenTs: number | null;
  /** Set when a different key was seen; cleared by accept(). */
  changed: { fingerprint: string; ts: number } | null;
}

export function fingerprint(key: Buffer): string {
  return "SHA256:" + crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
}

export class HostKeyMemory {
  private state: HostKeyState = { fingerprint: null, firstSeenTs: null, changed: null };
  constructor(private file: string) {
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { /* first run */ }
  }
  private save(): void {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2)); } catch { /* best effort */ }
  }
  /** Called from ssh2's hostVerifier with the raw key. Never blocks. */
  observe(key: Buffer, now = Date.now()): "new" | "same" | "changed" {
    const fp = fingerprint(key);
    if (!this.state.fingerprint) { this.state = { fingerprint: fp, firstSeenTs: now, changed: null }; this.save(); return "new"; }
    if (fp === this.state.fingerprint) return "same";
    if (this.state.changed?.fingerprint !== fp) { this.state.changed = { fingerprint: fp, ts: now }; this.save(); }
    return "changed";
  }
  /** The sailor confirmed the new key (after a new card, for instance). */
  accept(now = Date.now()): void {
    if (!this.state.changed) return;
    this.state = { fingerprint: this.state.changed.fingerprint, firstSeenTs: now, changed: null };
    this.save();
  }
  get(): HostKeyState { return { ...this.state }; }
}
