/**
 * State/UT lookup by point — reverse-geocodes a lat/lon against India's state
 * boundaries (GADM level-1, the same `NAME_1` field CesiumGlobe's state
 * outlines are drawn from), so results can be labelled with a place name
 * instead of raw coordinates.
 *
 * District-level (GADM level-2) boundaries aren't bundled in this repo, so
 * lookups stop at state/UT.
 *
 * Reuses `pointInIndia`'s ray-casting test from `indiaClip.ts` per state
 * instead of re-implementing it — two independent point-in-polygon
 * implementations would be exactly the kind of drift that module already
 * exists to avoid.
 */

import { pointInIndia, polygonBBox, type Polygon, type PolygonBBox } from './indiaClip';

export interface StateFeature {
  name: string;
  type: string;
  polygons: Polygon[];
  bboxes: PolygonBBox[];
}

/** Parse the india_states.geojson FeatureCollection into named polygon groups. */
export function parseIndiaStates(geojson: {
  features?: {
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: unknown };
  }[];
}): StateFeature[] {
  const states: StateFeature[] = [];
  for (const feature of geojson.features ?? []) {
    const name = feature.properties?.NAME_1;
    const type = feature.properties?.ENGTYPE_1;
    const geomType = feature.geometry?.type;
    const coordinates = feature.geometry?.coordinates;
    if (typeof name !== 'string' || !coordinates) continue;

    let polygons: Polygon[] = [];
    if (geomType === 'Polygon') {
      const rings = (coordinates as Polygon).filter((r) => r.length >= 3);
      if (rings.length > 0) polygons = [rings];
    } else if (geomType === 'MultiPolygon') {
      polygons = (coordinates as Polygon[])
        .map((p) => p.filter((r) => r.length >= 3))
        .filter((p) => p.length > 0);
    }
    if (polygons.length === 0) continue;

    states.push({
      name,
      type: typeof type === 'string' && type.length > 0 ? type : 'State',
      polygons,
      bboxes: polygons.map(polygonBBox),
    });
  }
  return states;
}

/** Which state/UT a point falls in, or null if it's outside all of them (ocean, another country). */
export function findStateForPoint(lat: number, lon: number, states: StateFeature[]): StateFeature | null {
  for (const state of states) {
    if (pointInIndia(lon, lat, state.polygons, state.bboxes)) return state;
  }
  return null;
}

let statesPromise: Promise<StateFeature[]> | null = null;

/**
 * Fetch and parse india_states.geojson once per page load, cached for every
 * later caller. The file is ~11MB (full-resolution state polygons, the same
 * bundle CesiumGlobe draws state outlines from) so callers should only
 * invoke this when a lookup is actually needed, not on mount.
 */
export function loadIndiaStates(): Promise<StateFeature[]> {
  if (!statesPromise) {
    statesPromise = fetch('/india_states.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`india_states.geojson HTTP ${res.status}`);
        return res.json();
      })
      .then((geojson) => parseIndiaStates(geojson))
      .catch((err) => {
        // Let the next caller retry instead of caching a permanent failure.
        statesPromise = null;
        throw err;
      });
  }
  return statesPromise;
}
