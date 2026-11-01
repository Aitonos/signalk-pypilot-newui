# Harbour regions: issue for signalk-server + PR for collision-alerts

Borradores para publicar con la cuenta de Carlos (Aitonos). Nada publicado
todavía. Código listo en `C:\Users\bybek\Downloads\collision-alerts`, rama
`feat-quiet-harbour-regions` (1 commit sobre 0.6.1, `npm run build:all`
en verde: lint, tipos, build y 105 tests, 15 nuevos).

Orden: 1) issue en SignalK/signalk-server, 2) fork + PR en
SignalK/collision-alerts enlazando la issue, 3) comentario corto en
collision-alerts#24 avisando a Dirkwa.

---

## 1. Issue — SignalK/signalk-server

**Title:** Mark a region as a harbour, berth or mooring field (`zoneType`)

**Body:**

Collision alarms are least wanted where boats lie close together on
purpose: entering a harbour, moving inside it, picking up a mooring. An
alarm that fires there teaches the crew to ignore it or switch it off.
Each plugin works around this on its own today, with different results in
each app.

Regions are already a standard resource (`/resources/regions`, a GeoJSON
feature with free-form `properties`), Freeboard-SK can draw them, and a
plugin can read them with `app.resourcesApi.listResources('regions', …)`.
What is missing is an agreed way to say what a region *is*.

Proposal: a `zoneType` property in `feature.properties`:

| Value | Meaning |
|---|---|
| `harbour` | Harbour basin, port entrance, marina |
| `berth` | A single berth or pontoon area |
| `anchorage` | Designated anchorage |
| `mooringField` | Field of mooring buoys |

The property only describes the place; what a plugin does with it is up to
the plugin. It is backwards compatible: old clients ignore it.

Next steps, as discussed with @dirkwa in SignalK/collision-alerts#24:

- Freeboard-SK: a "Zone type" selector in the region dialog (today it
  only offers "Hazard").
- collision-alerts: no alarm for *stopped* boats inside `harbour`, `berth`
  or `mooringField` regions; a boat moving or drifting there still alarms.
  Draft PR: SignalK/collision-alerts#<PR>.

Open questions: is `zoneType` the right name (or namespaced)? Closed list
of values, or open with these documented? Is a server-side "which regions
contain this position" helper worth adding?

---

## 2. PR — SignalK/collision-alerts

**Title:** `feat: no alarms for stopped boats inside harbour, berth and mooring field regions`

**Body:**

Follows up on #24. The region convention is proposed in
SignalK/signalk-server#<issue>; this PR is the collision-alerts side, so
the idea can be tried while the convention is discussed. Happy to rename
the property or change the values to whatever is agreed there.

### What it does

- Reads the server's `regions` resources once a minute and keeps those
  whose `feature.properties.zoneType` is `harbour`, `berth` or
  `mooringField` (Polygon and MultiPolygon, holes respected, malformed
  geometry skipped).
- A **stopped** target inside one raises nothing. "Stopped" is the
  existing test (reported speed 0 and not found drifting), so a boat
  moving, or dragging its anchor, inside a harbour still alarms. An alarm
  already raised is released once the boat stops inside a region.
- New setting **No alarms for stopped boats inside harbour regions**,
  default on. Without regions, or without a resources provider, nothing
  changes (one debug line, not repeated every minute).
- README section with an example region.

### Tests

`npm run build:all` passes: lint, typecheck, build and 105 tests.

- `regions.test.ts`: point in polygon with holes, zone type filtering,
  MultiPolygon, malformed input.
- `evaluator.test.ts`: stopped boat inside a region is quiet; the same
  boat outside alarms; a moving boat inside alarms; a drifting boat inside
  alarms; an alarm is released when the boat stops inside.
- `plugin.test.ts`: the plugin reads `regions` and stays quiet; with the
  setting off it does not read regions and alarms.

---

## 3. Comentario en collision-alerts#24

Thanks for 0.6.1, and for the pointer on regions. I opened
SignalK/signalk-server#<issue> to propose a `zoneType` property, and a
draft PR here (#<PR>) with the collision-alerts side, limited to stopped
boats as you suggested, so we can try it while the name is discussed.
