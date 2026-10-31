import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Historian, Sample } from "../historian";

function sample(over: Partial<Sample>): Sample {
  return {
    ts: Date.now(), headingCmd: null, headingActual: null, rudder: null,
    servoCurrent: null, servoTemp: null, servoMotorTemp: null, servoVoltage: null,
    awa: null, aws: null, twa: null, tws: null, sog: null, heel: null, pitch: null,
    engaged: false, mode: null, ...over,
  };
}

describe("historian speeds for the strip chart (Rev584/586)", () => {
  it("returns polarSpeed, stw and vmg when asked by path", () => {
    const h = new Historian({ capacitySamples: 10 });
    h.push(sample({ sog: 2.5, polarSpeed: 3.1, stw: 2.4, vmg: 1.8 }));
    const rows = h.slice(60_000, ["sog", "polarSpeed", "stw", "vmg"]);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { sog: rows[0].sog, polarSpeed: rows[0].polarSpeed, stw: rows[0].stw, vmg: rows[0].vmg },
      { sog: 2.5, polarSpeed: 3.1, stw: 2.4, vmg: 1.8 },
    );
  });

  it("a sample without a polar plugin has no polar value (shown as no data)", () => {
    const h = new Historian({ capacitySamples: 10 });
    h.push(sample({ sog: 2.5 }));
    const row = h.slice(60_000, ["polarSpeed"])[0];
    assert.equal(row.polarSpeed ?? null, null);
    assert.equal(JSON.parse(JSON.stringify(row)).polarSpeed, undefined);
  });
});
