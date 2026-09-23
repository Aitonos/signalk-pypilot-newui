import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ProfileChangeLog } from "../profile-change-log";

describe("ProfileChangeLog — external attribution", () => {
  it("first delta with no planned write is 'external'", () => {
    const log = new ProfileChangeLog();
    log.observeDelta("default", 1000);
    const e = log.entries();
    assert.equal(e.length, 1);
    assert.equal(e[0].source, "external");
    assert.equal(e[0].from, null);
    assert.equal(e[0].to, "default");
  });

  it("second delta with no planned write is also 'external' and shows transition", () => {
    const log = new ProfileChangeLog();
    log.observeDelta("basic", 1000);
    log.observeDelta("racing", 2000);
    const e = log.entries();
    assert.equal(e.length, 2);
    assert.equal(e[1].from, "basic");
    assert.equal(e[1].to, "racing");
    assert.equal(e[1].source, "external");
  });
});

describe("ProfileChangeLog — attribution via planned write", () => {
  it("markPlannedWrite+observeDelta credits the source", () => {
    const log = new ProfileChangeLog();
    log.markPlannedWrite("racing", "user", "sailor toggled radio", 1000);
    log.observeDelta("racing", 1100);
    const e = log.entries()[0];
    assert.equal(e.source, "user");
    assert.equal(e.reason, "sailor toggled radio");
    assert.equal(e.to, "racing");
  });

  it("the planned write is consumed (next external delta remains external)", () => {
    const log = new ProfileChangeLog();
    log.markPlannedWrite("racing", "user", undefined, 1000);
    log.observeDelta("racing", 1100);
    log.observeDelta("default", 2000);
    const rows = log.entries();
    assert.equal(rows[0].source, "user");
    assert.equal(rows[1].source, "external");
  });

  it("planned write beyond the correlation window is discarded", () => {
    const log = new ProfileChangeLog({ correlationWindowMs: 500 });
    log.markPlannedWrite("racing", "auto-profile", "TWS 6 kn", 1000);
    log.observeDelta("racing", 2000);
    const e = log.entries()[0];
    assert.equal(e.source, "external", "expired planned write must not credit");
  });

  it("planned write mismatches (name differs) do not steal credit", () => {
    const log = new ProfileChangeLog();
    log.markPlannedWrite("racing", "auto-profile", undefined, 1000);
    log.observeDelta("cruising", 1200);
    assert.equal(log.entries()[0].source, "external");
    // The planned write stays around for its window (might land later).
    assert.equal(log.pendingPlanned().length, 1);
  });

  it("multiple planned writes queue up; each delta consumes the freshest match", () => {
    const log = new ProfileChangeLog();
    log.markPlannedWrite("racing", "user", "A", 1000);
    log.markPlannedWrite("cruising", "auto-profile", "B", 1100);
    log.markPlannedWrite("racing", "gust-heavy", "C", 1200);
    log.observeDelta("racing", 1300);
    // Freshest match is the "gust-heavy" one at ts=1200.
    assert.equal(log.entries()[0].source, "gust-heavy");
    assert.equal(log.entries()[0].reason, "C");
    // The 1000 user write for "racing" stays around; the 1100
    // cruising write also (mismatched value).
    const pending = log.pendingPlanned();
    assert.equal(pending.length, 2);
  });
});

describe("ProfileChangeLog — deduplication", () => {
  it("a delta with the same profile value as the previous is NOT logged", () => {
    const log = new ProfileChangeLog();
    log.observeDelta("racing", 1000);
    log.observeDelta("racing", 1100);   // no-op
    log.observeDelta("racing", 1200);   // no-op
    log.observeDelta("cruising", 1300); // real change
    assert.equal(log.entries().length, 2);
    assert.equal(log.entries()[1].to, "cruising");
  });

  it("a dup delta still consumes a matching planned write (caller's intent honoured)", () => {
    const log = new ProfileChangeLog();
    log.observeDelta("racing", 1000); // establishes lastProfile
    log.markPlannedWrite("racing", "user", "sailor re-picked same", 1100);
    log.observeDelta("racing", 1150); // duplicate value
    // Nothing new in the ring, but the planned write is gone.
    assert.equal(log.entries().length, 1);
    assert.equal(log.pendingPlanned().length, 0);
  });
});

describe("ProfileChangeLog — ring capacity", () => {
  it("only keeps the last N entries", () => {
    const log = new ProfileChangeLog({ ringCapacity: 3 });
    log.observeDelta("a", 100);
    log.observeDelta("b", 200);
    log.observeDelta("c", 300);
    log.observeDelta("d", 400);
    log.observeDelta("e", 500);
    const e = log.entries();
    assert.equal(e.length, 3);
    assert.deepEqual(e.map(x => x.to), ["c", "d", "e"]);
  });
});

describe("ProfileChangeLog — summary + reset", () => {
  it("summary counts entries by source", () => {
    const log = new ProfileChangeLog();
    log.markPlannedWrite("a", "user", undefined, 100);
    log.observeDelta("a", 110);
    log.markPlannedWrite("b", "auto-profile", undefined, 200);
    log.observeDelta("b", 210);
    log.observeDelta("c", 300);            // external
    log.markPlannedWrite("d", "gust-heavy", undefined, 400);
    log.observeDelta("d", 410);
    const s = log.summary();
    assert.equal(s.user, 1);
    assert.equal(s["auto-profile"], 1);
    assert.equal(s["gust-heavy"], 1);
    assert.equal(s.external, 1);
  });

  it("reset() empties ring and planned buffer", () => {
    const log = new ProfileChangeLog();
    log.markPlannedWrite("a", "user", undefined, 100);
    log.observeDelta("a", 110);
    log.reset();
    assert.equal(log.entries().length, 0);
    assert.equal(log.pendingPlanned().length, 0);
    assert.equal(log.current(), null);
  });
});

describe("ProfileChangeLog — GC of stale planned writes", () => {
  it("expired planned writes are pruned before matching", () => {
    const log = new ProfileChangeLog({ correlationWindowMs: 500 });
    log.markPlannedWrite("stale", "user", undefined, 100);
    // A new mark at ts=1000 triggers gc; the stale one is gone.
    log.markPlannedWrite("fresh", "auto-profile", undefined, 1000);
    assert.equal(log.pendingPlanned().length, 1);
    assert.equal(log.pendingPlanned()[0].name, "fresh");
  });
});
