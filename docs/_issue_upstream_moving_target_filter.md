# Draft upstream issue — signalk-collision-alerts

Repo target: https://github.com/dirkwa/signalk-collision-alerts
Opened by: Aitonos / Carlos
Date: 2026-10-11
Status: DRAFT — not posted yet; waiting on Carlos review.

---

## Title

Suppress alerts when either vessel is effectively stationary (SOG-aware threat check)

## Body

Hi dirkwa, thanks again for the quick merge of #17 — our visor
pypilot-newui is a happy consumer and we are already shipping 3.1.x
with the dropdown-render fix in place for sailors who are still on 0.3.0.

While sea-trialing the integration over the last couple of days we hit
a pain point that we think is worth smoothing upstream rather than
every consumer plugging it individually. We are happy to open a PR if
you prefer that route.

### The pain

The sailboat (Tunatunes, MMSI 228023660) is based inside Marina
Puerto Deportivo Moaña (Ría de Vigo). In a typical weekday morning the harbour
holds dozens of AIS-equipped vessels, mostly moored or drifting around
their mooring at effectively zero speed.

With `preset: harbour`, this triggers something like the following
pattern for a sailor approaching or leaving the dock:

- 10–30 `notifications.navigation.closestApproach.<mmsi>` entries
  active at any time.
- Many of them from vessels that are moored only a few metres away.
- Each state transition to `warn` / `alarm` fires a notification method
  (`sound`, `visual`), which in our visor downstream drives a TTS
  prompt and a red hull on the compass rose.

The "collision risk" surfaced in those cases is a side effect of the
distance threshold triggering between two static vessels — moving the
boat 20 cm with the wind is enough to cross the band back and forth —
not an actual collision geometry: there is no closing speed, so there
is no closing time either.

A quick snapshot from the current REST state while writing this up:

```
TOTAL: 5
urn:mrn:imo:mmsi:224060440 state=normal  Collision risk: LAMU PRIMERO,     CPA 0.03 NM in 5 min
urn:mrn:imo:mmsi:261010366 state=normal  Collision risk: POLARYS,          CPA 0.03 NM in 0 min
urn:mrn:imo:mmsi:224438370 state=normal  Collision risk: JESUS PORTELA,    CPA 0.04 NM in 2 min
urn:mrn:imo:mmsi:224261460 state=warn    Collision risk: PIRATA DE ONZA,   CPA 0.00 NM in 2 min
urn:mrn:imo:mmsi:225989274 state=normal  Collision risk: JESUS ROSA ACUNA, CPA 0.04 NM in 0 min
```

Our vessel's SOG = 0. Four of the five targets are moored vessels; the
`warn` one (PIRATA DE ONZA) is the one actually moving at 10 kn out of
the marina — exactly the one you want surfaced.

### Why we think this belongs upstream

Consumers can filter by target SOG downstream (we do it in our visor:
if the target's cached SOG is below ~0.08 m/s we drop the entry from
the overlay). But:

- The notification was already issued through the SK v2 Notifications
  API, which means the sound method fires once per transition
  regardless of what we do downstream — the engine of the alert lives
  in your plugin.
- Every consumer that wants quiet marina behaviour (Freeboard-SK, KIP,
  WhatsApp bridges, etc.) ends up reimplementing the same filter.
- The CPA/TCPA math already deals with SOG — a projected closest
  approach between two SOG=0 vessels in a geodesic sense is only
  meaningful if drift is zero too, which it never is, so the current
  threshold effectively fires on positional jitter.

### Proposal

Add an opt-in SOG-aware threat check inside the alert evaluator. Two
natural places to put it:

1. **Preset flag** on each preset:
   `requireMovement: { selfMinSogMs: 0.5, targetMinSogMs: 0.5 }`
   (default values per preset, override via `customZones` / `custom`).
   Suppress the alert emission when BOTH self and target are below
   their respective thresholds.

2. **Scenario preset extension** — a new preset `harbour-anchored`
   that bakes `targetMinSogMs ≈ 1.0` into the existing `harbour`
   thresholds, so the sailor who leaves the plugin in `harbour` while
   actually moored only hears alarms from genuinely moving boats.

We would favour option (1) because it stays composable with the
existing presets and does not force a user to pick between "quiet
when moored" and "sensitive to coastal approach". It also gives you
the knob to say "even at anchor, warn me on anything closing faster
than X" via `customZones` without reinventing presets.

### Related, probably in scope for a separate issue

Two small follow-ups we hit, happy to open as separate issues or roll
into the same PR, whichever you prefer:

- **COG-aware threat check** — a target moving perpendicular to the
  self vessel at range ~CPA is a false positive if its heading change
  rate is already pulling it off collision. The current implementation
  assumes straight-line projection, which is correct in open water but
  noisy around marinas with manoeuvring boats. A small SOG × angle
  gating would cut false positives further.

- **COG in the notification payload** — right now `data.cpaPositions`
  carries projected positions at CPA; it would help downstream
  renderers to also carry `targetCog` + `targetSog` so they can draw a
  projected track line out of the hull without a REST round-trip per
  target. We already added that to our visor via `/v1/api/.../cog/value`
  but a value in the delta payload would be much cheaper.

### Happy to send a PR

If you tell us which of (1) / (2) you prefer, or if neither matches
how you think about it, we are happy to send a PR against your main.
The visor side is already live under the "Fondeo" (anchor) / "Puerto"
(harbour) selector in pypilot-newui 3.1.3+, so we have a reference
geometry to validate the backend behaviour against.

Thanks a lot for the plugin and for being so responsive on #17 — it
makes the ecosystem considerably more pleasant to build on top of.

— Aitonos / Tunatunes

---

## Companion comment on #17 (short thank-you to post)

```
Thanks for the quick fix on #17! Just to close the loop: our visor
pypilot-newui 3.1.2 is shipping with the dropdown-render workaround
unneeded now, and we also surfaced a few integration follow-ups in
a dedicated issue: <LINK>. Happy to send a PR if you prefer that
route for any of them.
```
