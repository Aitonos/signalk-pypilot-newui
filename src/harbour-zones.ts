// Rev612 (Carlos): harbour zones. Signal K regions (drawn in Freeboard)
// marked with feature.properties.zoneType = "harbour" (proposal
// SignalK/signalk-server#3271, marked from the visor's harbour zones
// card). While own ship is inside one, the AIS harbour mode switches on
// at once instead of after 2 min stopped.

/** A GeoJSON polygon: outer ring first, then holes; positions are [lon, lat]. */
export type Polygon = Array<Array<[number, number]>>;

export interface LatLon { latitude: number; longitude: number; }

function isPosition(p: unknown): p is [number, number] {
  return Array.isArray(p) && p.length >= 2
    && typeof p[0] === "number" && typeof p[1] === "number"
    && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function toPolygon(coords: unknown): Polygon | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const rings: Polygon = [];
  for (const ring of coords) {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPosition)) return null;
    rings.push(ring as Array<[number, number]>);
  }
  return rings;
}

/** Polygons of every region whose zoneType is one of `types`. */
export function zonePolygons(resources: unknown, types: readonly string[] = ["harbour"]): Polygon[] {
  const out: Polygon[] = [];
  if (!resources || typeof resources !== "object") return out;
  for (const value of Object.values(resources as Record<string, unknown>)) {
    const feature = (value as { feature?: { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> | null } } | null)?.feature;
    const zoneType = feature?.properties?.zoneType;
    if (typeof zoneType !== "string" || !types.includes(zoneType)) continue;
    const g = feature?.geometry;
    if (g?.type === "Polygon") {
      const poly = toPolygon(g.coordinates);
      if (poly) out.push(poly);
    } else if (g?.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      for (const c of g.coordinates) {
        const poly = toPolygon(c);
        if (poly) out.push(poly);
      }
    }
  }
  return out;
}

// Ray casting; harbour-sized areas are small enough to treat as flat.
function inRing(p: LatLon, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > p.latitude) !== (yj > p.latitude)
        && p.longitude < ((xj - xi) * (p.latitude - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function inPolygon(p: LatLon, polygon: Polygon): boolean {
  const [outer, ...holes] = polygon;
  return inRing(p, outer) && !holes.some((h) => inRing(p, h));
}

export function inAnyPolygon(p: LatLon | null | undefined, polygons: Polygon[]): boolean {
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return false;
  return polygons.some((poly) => inPolygon(p, poly));
}
