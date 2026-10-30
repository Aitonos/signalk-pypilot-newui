# Prompt para Gemini y GPT: motor de IA en la Pi para el auto-ajuste del piloto

Cómo usarlo:

1. Abre una conversación nueva en Gemini y otra en GPT.
2. Pega el prompt de abajo (desde "## Prompt" hasta el final).
3. Adjunta estos ficheros del repo:
   - `docs/_design_auto_doctor_2026-10-30.md` (el diseño actual, en español)
   - `src/doctor.ts`, `src/episodes.ts`, `src/historian.ts`, `src/kpis.ts`,
     `src/session-recorder.ts`
4. Si quieres leer la respuesta directamente, añade al final: "Answer in
   Spanish."
5. Pásame las dos respuestas y las comparo con el diseño.

---

## Prompt

You are a senior engineer in marine autopilot control and in embedded
machine learning. I want your critical analysis and your ideas, not
agreement. Challenge the design where it is wrong.

### Goal

A Signal K plugin that drives a **pypilot autopilot on a sailing boat**
should tune the autopilot's gains **by itself**, adapting to conditions in
real time and learning across outings. The owner wants a small "AI engine"
running on the boat's Raspberry Pi to manage this. I want to know whether
that is the right approach, which algorithm, and how to make it safe.

### System context

- **Boat:** a cruising sailboat, sailing in the Ría de Vigo (Spain):
  short, steep chop, frequent wind shifts and gusts, tidal current.
- **Raspberry Pi 5 (8 GB, 4 cores, ARM64)** runs Signal K (Node.js 22)
  and this plugin (TypeScript). Many other Signal K plugins run in the same
  Node process. The Pi is not a dedicated machine.
- **Autopilot:** a TinyPilot (pypilot on a Pi Zero W) reached over TCP.
  pypilot runs the steering control loop and owns the IMU. The plugin
  reads pypilot values and writes gains over pypilot's TCP protocol. Gains
  written to pypilot **stay there** even if the plugin crashes.
- **pypilot "basic" pilot gains:** P, I, D, DD, PR, FF. Profiles group a
  full set of gains; the plugin already switches profiles (Light / Medium /
  Heavy) by true wind speed.
- **Network:** the boat's internet is 4G and unreliable. Everything must
  work fully offline, on the Pi.

### What already exists

- **Historian:** 1 Hz samples of commanded vs actual heading (in the active
  mode: compass, apparent wind, true wind, GPS), rudder angle, servo
  current / voltage / temperatures, AWA / AWS / TWA / TWS, SOG, heel,
  pitch, engaged flag, mode. See `src/historian.ts`.
- **IMU values from pypilot:** heading, heading rate (`imu.headingrate`),
  pitch, roll (attitude). These can be sampled faster than 1 Hz.
- **Episode detector:** every target step of 3° or more becomes an episode
  with rise time, overshoot, settling time, steady-state error and a 60 s
  timeout. See `src/episodes.ts`.
- **Pypilot Doctor:** records a 3-minute engaged session and proposes gain
  changes with fixed rules (bias -> +20 % I; oscillation -> +20-30 % D;
  low authority -> +15 % P; step overshoot > 20 % -> +15-25 % D; chatter ->
  info only). It refuses to suggest gains when the servo is on more than
  75 % of the time with RMS error above 5° ("hardware ceiling"). **Nothing
  is applied automatically today.** See `src/doctor.ts`.
- **Session recorder:** JSONL file per engaged session on the Pi, 1 Hz,
  with the gains at start. Built as "phase 1" of an AI-tuned Doctor. See
  `src/session-recorder.ts`.

### Current design (attached, `docs/_design_auto_doctor_2026-10-30.md`)

Summary:

- **Closed loop per parameter:** measure (baseline window) -> change one
  gain one small step -> measure (test window) -> keep if the symptom
  improved by at least 15 % and no "too much" symptom got worse by more
  than 10 %; otherwise undo. "When in doubt, undo."
- **Symptom table per gain** ("too little" vs "too much") for P, I and D.
- **Two layers:**
  - Fast (seconds): picks already-learned gains for the current situation
    (wind band, sea state from IMU, boat speed, point of sail).
  - Slow (1-2 min windows): the learning loop above.
- **Navigation database:** one row per 1-2 min window (conditions, gains
  used, results, decision), JSONL on the Pi, ~200 bytes per row.
- **Safety limits:** one gain at a time, 10-20 % steps, never beyond ±40 %
  of the original profile, works on a copy of the profile, any alarm / lost
  authority / disengage / manoeuvre cancels the test and undoes the last
  change, off by default. Shadow mode first (decides but does not apply).

### Hard constraints

1. **Never block Signal K's event loop.** In October 2026 an unbounded
   array in a plugin froze the whole Signal K server for 5 hours. Any heavy
   computation must run outside the main thread (worker thread or child
   process) with bounded memory and CPU.
2. **Minimal dependencies.** The project avoids new runtime dependencies.
   A native module or an ML runtime (ONNX Runtime, TensorFlow.js, etc.)
   must be justified: install size, RAM, ARM64 support, maintenance. Pure
   TypeScript is preferred if it is good enough.
3. **No hidden safety factors.** Every threshold must be explicit and
   explainable to the skipper.
4. **The skipper stays in control.** Every change is announced and
   reversible with one tap; the original profile is never modified.
5. **The plugin may crash or restart at any moment**, leaving an
   experimental gain inside pypilot. The design must cope with that.

### What I want from you

Answer each point concretely. Use pseudocode where it helps.

1. **"AI engine" or not?** Compare, for this problem and this hardware:
   - gain scheduling plus rule-based tuning (current design);
   - online optimisation per situation: contextual bandits, Bayesian
     optimisation, extremum seeking;
   - online system identification (e.g. recursive least squares on a
     simple yaw model) plus model-based gain calculation;
   - a small neural network or reinforcement learning.

   Recommend one (or a combination) and explain why, including how much
   data each needs before it is useful.

2. **Cost function.** What single score (or Pareto rule) should decide
   "better"? Heading error RMS, bias, overshoot, settling time, servo duty,
   servo current, rudder activity... How to weight them, and how to stop
   the tuner from simply making the servo work harder.

3. **Comparing windows under changing conditions.** Wind and sea change
   between the baseline and the test window. How to make the comparison
   statistically sound with 1-2 minute windows: normalising by sea state,
   paired or interleaved trials (A/B/A), minimum sample sizes,
   significance tests, or a model that separates the effect of the gains
   from the effect of the conditions.

4. **Situation buckets.** How to define the "situation" (wind band, sea
   state from IMU, boat speed, point of sail): fixed bins, clustering, or a
   continuous model? How to generalise when a bucket has little data.

5. **Using the IMU.** Which features best describe sea state and steering
   quality for this purpose (roll / pitch / yaw rate RMS, dominant wave
   period, spectral features, wave-encounter frequency)? At what sample
   rate, and how to compute them cheaply.

6. **Time scales and stability.** The pypilot loop corrects in seconds.
   How fast can the tuner safely adapt without destabilising the loop?
   Give numbers.

7. **Safety design.** Failure modes of a self-tuning autopilot (drift,
   runaway gains, learning from a bad sensor, learning during a
   manoeuvre, overfitting to one outing, plugin crash with an experimental
   gain left in pypilot) and the guard for each.

8. **Validation plan.** How to test before letting it steer: replay of
   recorded sessions, shadow mode at sea, acceptance criteria to move from
   shadow mode to active.

9. **Database schema.** Review the per-window row (conditions, gains,
   results, decision). What is missing, what is useless.

10. **What would you do differently?** Anything in the current design you
    would drop, simplify or replace.

### Format of your answer

- Start with a short verdict (5 lines max): recommended approach and the
  biggest risk.
- Then one section per question above, numbered the same way.
- End with a prioritised implementation plan in phases, each phase
  testable on its own.
- Say clearly when something is your assumption and not a known fact.
