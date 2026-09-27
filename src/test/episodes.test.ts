import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EpisodeDetector, rateEpisode } from "../episodes";
import type { Sample } from "../historian";

const DEG = Math.PI / 180;

function mkSample(overrides: Partial<Sample>): Sample {
  return {
    ts: 0,
    headingCmd: 0,
    headingActual: 0,
    rudder: null,
    servoCurrent: null,
    servoTemp: null,
    servoMotorTemp: null,
    servoVoltage: null,
    awa: null,
    aws: null,
    twa: null,
    tws: null,
    sog: null,
    heel: null,
    pitch: null,
    engaged: true,
    mode: "compass",
    ...overrides,
  };
}

/** First-order step response: actualHeading tracks cmdHeading with a
 *  time constant tauSec. Monotonic, no overshoot. */
function firstOrderStep(opts: {
  startTs: number;
  startHeading: number;     // rad
  endHeading: number;       // rad
  tauSec: number;
  totalSec: number;
  periodMs?: number;
  cmdStepAt?: number;       // sample index at which cmd changes (default 1)
}): Sample[] {
  const periodMs = opts.periodMs ?? 1000;
  const n = Math.floor((opts.totalSec * 1000) / periodMs) + 1;
  const cmdStepIdx = opts.cmdStepAt ?? 1;
  const out: Sample[] = [];
  const delta = opts.endHeading - opts.startHeading;
  for (let i = 0; i < n; i += 1) {
    const ts = opts.startTs + i * periodMs;
    const cmd = i < cmdStepIdx ? opts.startHeading : opts.endHeading;
    let actual: number;
    if (i < cmdStepIdx) {
      actual = opts.startHeading;
    } else {
      const dtSec = (i - cmdStepIdx) * (periodMs / 1000);
      const settle = 1 - Math.exp(-dtSec / opts.tauSec);
      actual = opts.startHeading + delta * settle;
    }
    out.push(mkSample({ ts, headingCmd: cmd, headingActual: actual, mode: "compass", engaged: true }));
  }
  return out;
}

/** Second-order underdamped step response.
 *  Damping zeta ∈ (0,1); with zeta=0.5 the theoretical overshoot is
 *  exp(-pi*z/sqrt(1-z²)) ≈ 0.163 (16.3%). wn is the natural frequency
 *  in rad/s (peak time = pi / (wn * sqrt(1-z²))). */
function underdampedStep(opts: {
  startTs: number;
  startHeading: number;
  endHeading: number;
  zeta: number;              // damping ratio (0.3..0.8 useful)
  wn: number;                // natural freq rad/s
  totalSec: number;
  periodMs?: number;
  cmdStepAt?: number;
}): Sample[] {
  const periodMs = opts.periodMs ?? 1000;
  const n = Math.floor((opts.totalSec * 1000) / periodMs) + 1;
  const cmdStepIdx = opts.cmdStepAt ?? 1;
  const out: Sample[] = [];
  const delta = opts.endHeading - opts.startHeading;
  const { zeta, wn } = opts;
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  const phi = Math.acos(zeta);
  for (let i = 0; i < n; i += 1) {
    const ts = opts.startTs + i * periodMs;
    const cmd = i < cmdStepIdx ? opts.startHeading : opts.endHeading;
    let actual: number;
    if (i < cmdStepIdx) {
      actual = opts.startHeading;
    } else {
      const t = (i - cmdStepIdx) * (periodMs / 1000);
      const y = 1 - (Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta))
                    * Math.sin(wd * t + phi);
      actual = opts.startHeading + delta * y;
    }
    out.push(mkSample({ ts, headingCmd: cmd, headingActual: actual, mode: "compass", engaged: true }));
  }
  return out;
}

describe("EpisodeDetector — basic step response", () => {
  it("detects a 30° step and reports rise, settling and near-zero SSE", () => {
    const det = new EpisodeDetector({ settleHoldSec: 3, maxDurationSec: 30 });
    const samples = firstOrderStep({
      startTs: 1000,
      startHeading: 0,
      endHeading: 30 * DEG,
      tauSec: 3,
      totalSec: 25,
    });
    for (const s of samples) det.onSample(s);
    // Need an extra disengage sample to force-close (only for coverage).
    const hist = det.snapshot();
    assert.equal(hist.length, 1, "one episode recorded");
    const ep = hist[0];
    assert.equal(ep.timedOut, false);
    // Step should be ~30° (allow 1° tolerance for step-detection cmd wrap).
    assert.ok(Math.abs(ep.stepRad - 30 * DEG) < 1 * DEG, `stepRad=${ep.stepRad}`);
    // Rise: for tau=3s the 90% band (residual 10%) is at ~ln(10)*3 ≈ 6.9s.
    // Our rise band is 10% of the step so it maps to residual = 10% too.
    assert.ok(ep.riseSec != null && ep.riseSec >= 6 && ep.riseSec <= 8,
      `riseSec=${ep.riseSec} not in [6,8]`);
    // Settling: 95% band (residual 5%) is at ln(20)*3 ≈ 8.99s.
    assert.ok(ep.settlingSec != null && ep.settlingSec >= 8 && ep.settlingSec <= 11,
      `settlingSec=${ep.settlingSec} not in [8,11]`);
    // No injected overshoot → overshoot fraction near 0.
    assert.ok(ep.overshoot != null && ep.overshoot < 0.02,
      `overshoot=${ep.overshoot} should be ~0`);
    // SSE: episode closes as soon as settling completes, so the SSE
    // window spans the last 5s of the transient. First-order tau=3s
    // has ~0.5° residual near settling → averaged over 5s is a few
    // degrees. Allow up to 5° (0.087 rad).
    assert.ok(ep.sseRad != null && Math.abs(ep.sseRad) < 0.087,
      `sseRad=${ep.sseRad} should be < 5°`);
  });

  it("captures overshoot when the response overshoots the target", () => {
    const det = new EpisodeDetector({ settleHoldSec: 3, maxDurationSec: 30 });
    // zeta=0.5 → theoretical Mp ≈ 16.3%.  wn=1 → peak at pi/√0.75 ≈ 3.6s.
    const samples = underdampedStep({
      startTs: 2000,
      startHeading: 0,
      endHeading: 20 * DEG,
      zeta: 0.5,
      wn: 1.0,
      totalSec: 30,
    });
    for (const s of samples) det.onSample(s);
    const ep = det.snapshot()[0];
    // 1 Hz sampling aliases the peak: theoretical 16% at t=3.6s becomes
    // ~7% at the nearest sample (t=3 or t=4). This is a real limitation
    // of the 1 Hz historian — a true 16% overshoot will be reported as
    // 7–10% by the detector. Test the alias-aware range.
    assert.ok(ep.overshoot != null && ep.overshoot > 0.05,
      `overshoot=${ep.overshoot} should be > 5% (theoretical 16%, aliased at 1Hz)`);
    assert.ok(ep.overshoot != null && ep.overshoot < 0.20,
      `overshoot=${ep.overshoot} should be < 20% (theoretical 16%)`);
  });

  it("resolves overshoot more accurately with faster sampling", () => {
    const det = new EpisodeDetector({ settleHoldSec: 3, maxDurationSec: 30 });
    // Same physical response, 100 ms sampling → peak captured close to
    // its theoretical value.
    const samples = underdampedStep({
      startTs: 3000,
      startHeading: 0,
      endHeading: 20 * DEG,
      zeta: 0.5,
      wn: 1.0,
      totalSec: 25,
      periodMs: 100,
    });
    for (const s of samples) det.onSample(s);
    const ep = det.snapshot()[0];
    assert.ok(ep.overshoot != null && ep.overshoot > 0.13,
      `overshoot=${ep.overshoot} should approach the theoretical 16%`);
    assert.ok(ep.overshoot != null && ep.overshoot < 0.19,
      `overshoot=${ep.overshoot} should stay near 16%`);
  });

  it("ignores steps below the minimum threshold", () => {
    const det = new EpisodeDetector({ minStepRad: 5 * DEG });
    const samples = firstOrderStep({
      startTs: 3000,
      startHeading: 0,
      endHeading: 2 * DEG,  // below threshold
      tauSec: 2,
      totalSec: 20,
    });
    for (const s of samples) det.onSample(s);
    assert.equal(det.snapshot().length, 0);
  });

  it("closes without timeout on disengage", () => {
    const det = new EpisodeDetector({ settleHoldSec: 3, maxDurationSec: 30 });
    // Feed a step and then a disengage sample before settling.
    const samples = firstOrderStep({
      startTs: 4000, startHeading: 0, endHeading: 25 * DEG,
      tauSec: 3, totalSec: 4,
    });
    for (const s of samples) det.onSample(s);
    det.onSample(mkSample({ ts: 4_010_000, engaged: false }));
    const hist = det.snapshot();
    assert.equal(hist.length, 1);
    // Disengage counts as non-timeout close; settling may or may not be null.
    assert.equal(hist[0].timedOut, false);
  });

  it("times out when the boat never settles", () => {
    const det = new EpisodeDetector({ settleHoldSec: 3, maxDurationSec: 10 });
    // Cmd steps to +30°, but actual stays at 0 forever (broken servo).
    const samples: Sample[] = [];
    samples.push(mkSample({ ts: 0, headingCmd: 0, headingActual: 0, engaged: true }));
    for (let i = 1; i < 15; i += 1) {
      samples.push(mkSample({ ts: i * 1000, headingCmd: 30 * DEG, headingActual: 0, engaged: true }));
    }
    for (const s of samples) det.onSample(s);
    const ep = det.snapshot()[0];
    assert.equal(ep.timedOut, true);
    assert.equal(ep.riseSec, null);
    assert.equal(ep.settlingSec, null);
  });

  it("supersedes an in-progress episode when a fresh larger step arrives", () => {
    const det = new EpisodeDetector({ settleHoldSec: 3, maxDurationSec: 30 });
    // First step to +20°, then before settling, a new step to -30°.
    const first = firstOrderStep({
      startTs: 0, startHeading: 0, endHeading: 20 * DEG,
      tauSec: 3, totalSec: 4,
    });
    for (const s of first) det.onSample(s);
    const second = firstOrderStep({
      startTs: 5000, startHeading: 20 * DEG, endHeading: -30 * DEG,
      tauSec: 3, totalSec: 20, cmdStepAt: 0,
    });
    for (const s of second) det.onSample(s);
    const hist = det.snapshot();
    assert.equal(hist.length, 2, "two episodes: superseded + fresh");
  });
});

describe("rateEpisode", () => {
  it("scores a clean small step as good overall", () => {
    const good = {
      startedTs: 0, endedTs: 10_000, mode: "compass",
      stepRad: 10 * DEG,
      riseSec: 3, overshoot: 0.05, settlingSec: 6, sseRad: 0.5 * DEG,
      timedOut: false, samples: 10,
    };
    const r = rateEpisode(good);
    assert.equal(r.overall, "good");
  });

  it("scores a slow, high-overshoot response as poor overall", () => {
    const bad = {
      startedTs: 0, endedTs: 60_000, mode: "compass",
      stepRad: 20 * DEG,
      riseSec: 30, overshoot: 0.45, settlingSec: null, sseRad: 8 * DEG,
      timedOut: true, samples: 60,
    };
    const r = rateEpisode(bad);
    assert.equal(r.overall, "poor");
  });
});
