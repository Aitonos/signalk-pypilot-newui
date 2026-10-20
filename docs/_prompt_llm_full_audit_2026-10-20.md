# Prompt for an external LLM review: full code audit of signalk-pypilot-newui (Rev530)

How to use it: paste the prompt below into the LLM, then attach the files
for ONE block at a time (the whole repo is ~42 000 lines, too big for one
message). Use a new conversation per block, or say "block 2" in the same
one. Ask for the answer in Spanish if you want to read it directly.

| Block | Files | Lines |
|---|---|---|
| 1. Pilot core (writes to the autopilot) | `src/autopilot-provider.ts`, `src/pypilot-client.ts`, `src/virtual-tack.ts`, `src/tack-catchup.ts`, `src/mode-reanchor.ts`, `src/autowind.ts`, `src/steer-watch.ts` | ~3 000 |
| 2. Plugin wiring + HTTP API | `src/index.ts` | ~6 200 |
| 3. Safety / alarms / diagnostics | `src/alarms.ts`, `src/doctor.ts`, `src/prechecks.ts`, `src/servo-health.ts`, `src/servo-error-log.ts`, `src/sensor-quality.ts`, `src/failsafe-bsp.ts` | ~2 500 |
| 4. Recording / storage | `src/black-box.ts`, `src/trip-recorder.ts`, `src/session-recorder.ts`, `src/maneuver-trace.ts`, `src/historian.ts`, `src/episodes.ts`, `src/kpis.ts`, `src/visor-prefs.ts`, `src/display-presets.ts`, `src/config-backup.ts`, `src/profile-change-log.ts` | ~2 600 |
| 5. Visor (browser UI) | `public/app.js` (split in 4 parts of ~5 000 lines), `public/index.html`, `public/style.css` | ~26 000 |

---

## Prompt

You are a senior reviewer of safety-relevant embedded / marine software.
Review the code I attach for real bugs. It is a Signal K server plugin
(Node.js + TypeScript backend, plain JavaScript browser UI) that drives a
**pypilot autopilot on a sailing boat**. A bug can make the boat steer
somewhere it should not, drop the autopilot without warning, or hide an
alarm. Treat it accordingly.

### System context

- Hardware: a Raspberry Pi 5 runs Signal K and this plugin. The autopilot
  computer is a **TinyPilot (pypilot on a Pi Zero W)** reached over TCP
  port 23322 (pypilot's line protocol: `name=value` lines, `watch={...}`).
  The Pi Zero is weak: polling, sockets and watches must stay minimal.
- pypilot behaviours the code must respect:
  - Modes: `compass`, `gps`, `wind` (apparent), `true wind`. Changing
    `ap.mode` makes pypilot recompute `ap.heading_command` itself in its
    own loop, so a target written right after a mode change can be
    overwritten (known race; the code waits for the mode echo + 0.4 s,
    writes, verifies at 1.2 s, rewrites).
  - `ap.tack.direction` is rewritten by pypilot's tacking.py from the
    wind side.
  - `servo.flags` containing `PORT_OVERCURRENT_FAULT` /
    `STARBOARD_OVERCURRENT_FAULT` means a real end stop / jam;
    `DRIVER_TIMEOUT` with 0 A does NOT mean the servo stopped. The fault
    flag clears only when `ap.enabled` changes.
  - True wind exists only when there is GPS speed.
- Product rules (decided by the owner, not bugs):
  - Backend is the single source of truth; the browser keeps only
    per-device conveniences in localStorage.
  - "Head to wind" (aproado) always steers on APPARENT wind, never compass.
  - Alarms and automatic behaviours are OFF by default (opt-in).
  - "AUTO WIND" pseudo-mode switches apparent <-> true wind around
    TWA 120 deg with hysteresis and a sustain time.
  - Virtual tack = the plugin performs the tack itself (compass -> wind
    FSM) instead of pypilot's native tack.
  - The black box keeps 60 s of 1 Hz samples in RAM and writes 60 s
    before + 60 s after each incident to its own JSON file (max 50).
- Several browsers (phone, tablet, Pi screen) can be connected at the
  same time; state changes must reach all of them.

### What to look for (in this order)

1. **Steering safety**: any path that writes `ap.enabled`, `ap.mode`,
   `ap.heading_command` or tack commands at the wrong time, twice, with a
   stale value, in degrees vs radians, with a wrong sign (port vs
   starboard), or with 0/360 / -180/180 wrap errors. Races between a
   user command, a timer, an FSM step and pypilot's own echo.
2. **Silent failures**: caught exceptions that hide a real fault, promises
   without `.catch`, timers that keep running after `stop()`, listeners
   added twice, reconnect loops that never back off or never give up,
   alarms that can stay latched or never fire.
3. **Resource leaks** on a 24/7 Pi: unbounded arrays / maps / logs /
   files, intervals not cleared, sockets not destroyed, per-request work
   that re-reads many files.
4. **HTTP API**: routes that write without checking the `allowWrites`
   setting, path traversal in ids/file names, missing input validation,
   JSON bodies trusted as numbers.
5. **Browser UI**: stale state shown as current (no "data is old"
   indication), wrong unit conversions (rad <-> deg, m/s <-> kn), XSS
   through `innerHTML` with server or pypilot strings, handlers attached
   on every render, i18n keys missing in one language (EN/ES).
6. **Units and maths**: angle averaging across 0/360, hysteresis
   inversions, thresholds compared in the wrong unit.

### Rules for your answer

- Report ONLY bugs you can point to in the code. For each one give:
  `file:line` (or function name), what goes wrong, a **concrete scenario**
  (inputs/state -> wrong result), severity (CRITICAL = can steer wrong or
  drop/hide the pilot; HIGH = wrong data or alarm; MEDIUM = leak or UX
  bug; LOW = cosmetic), and a minimal fix.
- Do not report style, naming, missing tests, "could be refactored", or
  the product rules listed above as bugs.
- If something depends on pypilot behaviour you are not sure of, say so
  and mark it "NEEDS CHECK" instead of guessing.
- If a block has no real bug, say "no bugs found" — that is a valid answer.
- Rank the list most severe first. Maximum 20 items per block.
