/**
 * Clipping helpers that keep data overlays inside India's landmass.
 *
 * Every gridded product in this app is a lon/lat *rectangle*, because that is
 * what the model grid is. A rectangle that contains India necessarily also
 * contains ocean and parts of six neighbouring countries — the Western Ghats box
 * (7.5-21.5N, 72-77.5E) is roughly a third Arabian Sea. Painting rainfall there
 * is not a cosmetic problem: it asserts a forecast over water where the model has
 * no land-surface inputs, and it is the first thing a reviewer notices.
 *
 * Two shapes of the same fix live here because the overlays are drawn two
 * different ways:
 *
 *   - `clipCanvasToIndia` masks a raster with a destination-in composite. Used
 *     for the heatmap and the before/after comparison, where the data is already
 *     an image.
 *   - `pointInIndia` tests a single cell centre. Used for entity-based overlays
 *     (the scenario delta rectangles), where there is no canvas to mask.
 *
 * Both consume the same GeoJSON rings, so the raster and the entities agree on
 * where the coastline is. Keeping them in one module is the point: two
 * independent coastline definitions would drift.
 */

/** A polygon as GeoJSON gives it: ring 0 is the exterior, the rest are holes. */
export type Ring = [number, number][];
export type Polygon = Ring[];

export interface LonLatBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** Axis-aligned bounds of a polygon, used to skip irrelevant ones cheaply. */
export interface PolygonBBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export function polygonBBox(polygon: Polygon): PolygonBBox {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of polygon) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLon, maxLon, minLat, maxLat };
}

/**
 * Parse a GeoJSON FeatureCollection into flat polygons.
 *
 * Every ring is retained, including interior ones. Dropping holes would fill
 * lakes and enclaves with weather colour; the even-odd fill rule in
 * `clipCanvasToIndia` and the crossing count in `pointInIndia` both rely on the
 * holes being present to exclude them.
 */
export function parseIndiaOutline(geojson: {
  features?: { geometry?: { type?: string; coordinates?: unknown } }[];
}): Polygon[] {
  const polygons: Polygon[] = [];
  for (const feature of geojson.features ?? []) {
    const type = feature.geometry?.type;
    const coordinates = feature.geometry?.coordinates;
    if (!coordinates) continue;

    if (type === 'Polygon') {
      const rings = (coordinates as Ring[]).filter((r) => r.length >= 3);
      if (rings.length > 0) polygons.push(rings);
    } else if (type === 'MultiPolygon') {
      for (const polygon of coordinates as Polygon[]) {
        const rings = polygon.filter((r) => r.length >= 3);
        if (rings.length > 0) polygons.push(rings);
      }
    }
  }
  return polygons;
}

/**
 * Ray-casting point-in-polygon over every ring of every polygon.
 *
 * Counts crossings across ALL rings and returns odd/even, which is the even-odd
 * rule: a point inside an exterior ring but also inside a hole crosses twice and
 * correctly reads as outside. That matches `clipCanvasToIndia`'s
 * `ctx.fill('evenodd')`, so a cell filtered here and a pixel masked there make
 * the same decision.
 *
 * `bboxes` is optional and purely an optimisation — pass the precomputed array
 * when testing many points against the same outline (144 polygons x thousands of
 * cells otherwise dominates a render).
 */
export function pointInIndia(
  lon: number,
  lat: number,
  polygons: Polygon[],
  bboxes?: PolygonBBox[],
): boolean {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;

  let crossings = 0;
  for (let p = 0; p < polygons.length; p += 1) {
    const bbox = bboxes?.[p];
    if (bbox) {
      if (lon < bbox.minLon || lon > bbox.maxLon) continue;
      if (lat < bbox.minLat || lat > bbox.maxLat) continue;
    }
    for (const ring of polygons[p]) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        // Half-open latitude test (yi > lat) !== (yj > lat) counts a vertex
        // exactly once, which keeps a point level with a vertex from being
        // double-counted and flipping to the wrong side.
        if ((yi > lat) !== (yj > lat)) {
          const t = (lat - yi) / (yj - yi);
          if (lon < xi + t * (xj - xi)) crossings += 1;
        }
      }
    }
  }
  return crossings % 2 === 1;
}

/**
 * Mask everything outside India out of an already-drawn canvas.
 *
 * Uses `destination-in`, which keeps existing pixels only where the new shape is
 * opaque, rather than redrawing the raster into a clipped path. That preserves
 * the interpolated image exactly and costs one composite pass.
 *
 * Returns true when a mask was applied, false when the outline was unavailable —
 * callers should treat false as "unclipped raster" rather than assume success.
 */
/**
 * Trace India's outline as a canvas path in pixel space for the given lon/lat
 * bounds. Shared by `clipCanvasToIndia` (fills it as a mask) and
 * `strokeIndiaOutline` (strokes it as a visible border) so both draw the
 * exact same line — pulled out once specifically because two independent
 * projections of the same coastline would drift, which is the whole reason
 * this module exists in the first place.
 */
function traceIndiaPath(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bounds: LonLatBounds,
  polygons: Polygon[],
): boolean {
  const { west, east, south, north } = bounds;
  const lonSpan = east - west;
  const latSpan = north - south;

  ctx.beginPath();
  let drewAnything = false;
  for (const polygon of polygons) {
    // Cheap reject: most of the outline's polygons are irrelevant to a regional
    // tile. The full ring set is kept after the reject so holes still work.
    const { minLon, maxLon, minLat, maxLat } = polygonBBox(polygon);
    if (maxLon < west || minLon > east || maxLat < south || minLat > north) continue;

    for (const ring of polygon) {
      ring.forEach(([lon, lat], i) => {
        const px = ((lon - west) / lonSpan) * width;
        const py = ((north - lat) / latSpan) * height;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      drewAnything = true;
    }
  }
  return drewAnything;
}

export function clipCanvasToIndia(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bounds: LonLatBounds,
  polygons: Polygon[] | null,
): boolean {
  if (!polygons || polygons.length === 0) return false;

  const lonSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  if (!(lonSpan > 0) || !(latSpan > 0)) return false;

  const drewAnything = traceIndiaPath(ctx, width, height, bounds, polygons);

  if (!drewAnything) {
    // The tile lies entirely outside India. Clear it rather than leaving an
    // unmasked rectangle, which is what "no overlapping polygon" actually means.
    ctx.clearRect(0, 0, width, height);
    return true;
  }

  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'destination-in';
  // Even-odd so interior rings (lakes, enclaves) stay transparent instead of
  // being filled with data colour, and disjoint island polygons still work.
  ctx.fill('evenodd');
  ctx.globalCompositeOperation = previous;
  return true;
}

/**
 * Stroke India's coastline/border on top of an already-drawn (and usually
 * already-clipped) canvas. A raster clipped to India but never outlined reads
 * as a scatter of coloured blobs with no implied shape on days or regions
 * where the data is sparse — the stroke gives the reader the country's
 * silhouette regardless of how much of it the data actually covers.
 */
export function strokeIndiaOutline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bounds: LonLatBounds,
  polygons: Polygon[] | null,
  options: { color?: string; lineWidth?: number } = {},
): boolean {
  if (!polygons || polygons.length === 0) return false;

  const lonSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  if (!(lonSpan > 0) || !(latSpan > 0)) return false;

  const drewAnything = traceIndiaPath(ctx, width, height, bounds, polygons);
  if (!drewAnything) return false;

  ctx.save();
  ctx.strokeStyle = options.color ?? 'rgba(100, 116, 139, 0.6)'; // slate-500, readable on light and dark panels
  ctx.lineWidth = options.lineWidth ?? 1;
  ctx.stroke();
  ctx.restore();
  return true;
}
