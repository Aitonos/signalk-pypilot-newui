# RFC: mark a Signal K region as a harbour, berth or anchorage

Status: draft for discussion (to be filed on SignalK/signalk-server)
Date: 2026-11-01
Context: [SignalK/collision-alerts#24](https://github.com/SignalK/collision-alerts/issues/24)

## Problem

Collision alarms are most needed in open water and least wanted when
entering or moving inside a harbour, where passing a few metres from
moored boats is normal. An alarm that fires there trains the crew to
ignore it or to switch it off, and then it is off when it matters.

Today each plugin solves this on its own (speed thresholds, "harbour
mode" switches, its own exclusion settings), with different results in
each app. Signal K already has the building block: regions are a
standard resource (`/resources/regions`, a GeoJSON polygon with
free-form `properties`), Freeboard-SK can draw and edit them, and a
plugin can read them with `app.resourcesApi.listResources('regions', …)`.
What is missing is an agreed way to say what a region *is*, so that every
plugin can act on it the same way.

## Proposal

1. **A standard region property** `zoneType` with a small fixed set of
   values:

   | Value | Meaning |
   |---|---|
   | `harbour` | Harbour basin, port entrance, marina |
   | `berth` | A single berth or pontoon area |
   | `anchorage` | Designated anchorage |
   | `mooringField` | Field of mooring buoys |

   Example (illustrative coordinates):

   ```json
   {
     "name": "Moaña marina",
     "description": "Puerto Deportivo de Moaña",
     "feature": {
       "type": "Feature",
       "geometry": { "type": "Polygon", "coordinates": [[[-8.739, 42.278], [-8.733, 42.278], [-8.733, 42.274], [-8.739, 42.274], [-8.739, 42.278]]] },
       "properties": { "zoneType": "harbour" }
     }
   }
   ```

   The property only describes the place. What each plugin does with it
   is up to the plugin, documented by the plugin.

2. **Freeboard-SK**: a "Zone type" selector in the region dialog (today
   it only has "Hazard", which changes nothing but the symbol).

3. **First consumer, collision-alerts** (as proposed by its maintainer):
   suppress alarms for **stopped** targets inside a `harbour`, `berth` or
   `mooringField` region. A target that is moving, or that is stopped but
   drifting (dragging), still raises the alarm. Other consumers can follow
   (anchor watch, autostate, chart plotters, logbooks).

## Why a property and not a separate resource type

- Regions already have storage, an API, sharing between devices and an
  editor (Freeboard). A new resource type would duplicate all of that.
- `properties` is free-form GeoJSON, so the change is backwards
  compatible: old clients ignore the field, existing regions keep working.

## Sharing common zones

The value of this grows with coverage. Most sailors use a handful of
harbours over and over, so even a personal set of regions removes most
false alarms. Regions can be exported and imported as GeoJSON, which
also allows clubs or marinas to publish their own.

## Open questions

- Is `zoneType` the right name, or should it be namespaced
  (e.g. `navigation.zoneType`)?
- Should the list of values be closed, or open with these as the
  documented ones?
- Should a server-side helper ("which zones contain this position?") be
  offered, so every plugin does not reimplement point-in-polygon?
