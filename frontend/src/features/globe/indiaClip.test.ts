/**
 * Tests for the India clipping helpers.
 *
 * These decide whether a rainfall value is painted over the Arabian Sea, so the
 * geometry is asserted against hand-reasoned cases rather than against whatever
 * the implementation returns. The critical property is that `pointInIndia` and
 * `clipCanvasToIndia` agree: one filters entities, the other masks a raster, and
 * if they disagreed the scenario overlay and the heatmap would show different
 * coastlines for the same region.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  clipCanvasToIndia,
  parseIndiaOutline,
  pointInIndia,
  polygonBBox,
  type Polygon,
} from './indiaClip';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Unit square from (0,0) to (10,10). */
const SQUARE: Polygon = [
  [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ],
];

/** Same square with a hole from (4,4) to (6,6) — a lake. */
const SQUARE_WITH_HOLE: Polygon = [
  SQUARE[0],
  [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ],
];

/** Two disjoint squares, like a mainland and an island group. */
const MAINLAND: Polygon = SQUARE;
const ISLAND: Polygon = [
  [
    [20, 20],
    [24, 20],
    [24, 24],
    [20, 24],
    [20, 20],
  ],
];

// ── polygonBBox ───────────────────────────────────────────────────────────────

describe('polygonBBox', () => {
  it('spans every ring, including holes', () => {
    expect(polygonBBox(SQUARE_WITH_HOLE)).toEqual({
      minLon: 0,
      maxLon: 10,
      minLat: 0,
      maxLat: 10,
    });
  });

  it('handles a single-ring polygon', () => {
    expect(polygonBBox(ISLAND)).toEqual({ minLon: 20, maxLon: 24, minLat: 20, maxLat: 24 });
  });
});

// ── parseIndiaOutline ─────────────────────────────────────────────────────────

describe('parseIndiaOutline', () => {
  it('reads a Polygon feature', () => {
    const out = parseIndiaOutline({
      features: [{ geometry: { type: 'Polygon', coordinates: SQUARE } }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(1);
  });

  it('flattens a MultiPolygon into separate polygons', () => {
    const out = parseIndiaOutline({
      features: [{ geometry: { type: 'MultiPolygon', coordinates: [MAINLAND, ISLAND] } }],
    });
    expect(out).toHaveLength(2);
  });

  it('retains interior rings, so lakes can be excluded later', () => {
    const out = parseIndiaOutline({
      features: [{ geometry: { type: 'Polygon', coordinates: SQUARE_WITH_HOLE } }],
    });
    expect(out[0]).toHaveLength(2);
  });

  it('drops degenerate rings with fewer than three vertices', () => {
    const out = parseIndiaOutline({
      features: [
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it('tolerates missing features and geometry rather than throwing', () => {
    expect(parseIndiaOutline({})).toEqual([]);
    expect(parseIndiaOutline({ features: [{}] })).toEqual([]);
    expect(parseIndiaOutline({ features: [{ geometry: { type: 'Point' } }] })).toEqual([]);
  });
});

// ── pointInIndia ──────────────────────────────────────────────────────────────

describe('pointInIndia', () => {
  it('accepts an interior point', () => {
    expect(pointInIndia(5, 5, [SQUARE])).toBe(true);
  });

  it('rejects a point outside every polygon', () => {
    expect(pointInIndia(15, 5, [SQUARE])).toBe(false);
    expect(pointInIndia(5, -1, [SQUARE])).toBe(false);
  });

  it('rejects a point inside a hole, which is the even-odd rule', () => {
    // (5,5) is inside the exterior ring but also inside the lake, so it crosses
    // twice and must read as outside. This is the case that keeps weather colour
    // out of inland water bodies.
    expect(pointInIndia(5, 5, [SQUARE_WITH_HOLE])).toBe(false);
    // Still inside where the hole is not.
    expect(pointInIndia(2, 2, [SQUARE_WITH_HOLE])).toBe(true);
  });

  it('accepts points in a disjoint island polygon', () => {
    const polygons = [MAINLAND, ISLAND];
    expect(pointInIndia(22, 22, polygons)).toBe(true);
    expect(pointInIndia(5, 5, polygons)).toBe(true);
    expect(pointInIndia(15, 15, polygons)).toBe(false);
  });

  it('does not double-count a point level with a vertex', () => {
    // A latitude exactly equal to a vertex is the classic ray-casting bug: a
    // naive test counts that vertex twice and flips the answer.
    const diamond: Polygon = [
      [
        [0, 5],
        [5, 0],
        [10, 5],
        [5, 10],
        [0, 5],
      ],
    ];
    expect(pointInIndia(5, 5, [diamond])).toBe(true);
    expect(pointInIndia(-1, 5, [diamond])).toBe(false);
    expect(pointInIndia(11, 5, [diamond])).toBe(false);
  });

  it('returns false for non-finite coordinates instead of throwing', () => {
    expect(pointInIndia(Number.NaN, 5, [SQUARE])).toBe(false);
    expect(pointInIndia(5, Infinity, [SQUARE])).toBe(false);
  });

  it('returns false when there are no polygons', () => {
    expect(pointInIndia(5, 5, [])).toBe(false);
  });

  it('gives the same answer with and without the bbox fast path', () => {
    const polygons = [MAINLAND, ISLAND];
    const boxes = polygons.map(polygonBBox);
    for (const [lon, lat] of [
      [5, 5],
      [22, 22],
      [15, 15],
      [0.5, 9.5],
      [-3, 4],
    ] as const) {
      expect(pointInIndia(lon, lat, polygons, boxes)).toBe(
        pointInIndia(lon, lat, polygons),
      );
    }
  });
});

// ── clipCanvasToIndia ─────────────────────────────────────────────────────────

/** Minimal 2D context spy — jsdom has no real canvas implementation. */
function fakeCtx() {
  return {
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    clearRect: vi.fn(),
  };
}

describe('clipCanvasToIndia', () => {
  const bounds = { west: 0, east: 10, south: 0, north: 10 };

  it('reports failure and touches nothing when no outline is available', () => {
    const ctx = fakeCtx();
    expect(
      clipCanvasToIndia(ctx as unknown as CanvasRenderingContext2D, 100, 100, bounds, null),
    ).toBe(false);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it('reports failure for an empty polygon list', () => {
    const ctx = fakeCtx();
    expect(
      clipCanvasToIndia(ctx as unknown as CanvasRenderingContext2D, 100, 100, bounds, []),
    ).toBe(false);
  });

  it('masks with the even-odd rule so holes stay transparent', () => {
    const ctx = fakeCtx();
    const applied = clipCanvasToIndia(
      ctx as unknown as CanvasRenderingContext2D,
      100,
      100,
      bounds,
      [SQUARE_WITH_HOLE],
    );
    expect(applied).toBe(true);
    expect(ctx.fill).toHaveBeenCalledWith('evenodd');
    // Both rings are traced, not just the exterior.
    expect(ctx.closePath).toHaveBeenCalledTimes(2);
  });

  it('restores the previous composite operation', () => {
    const ctx = fakeCtx();
    ctx.globalCompositeOperation = 'source-over';
    clipCanvasToIndia(
      ctx as unknown as CanvasRenderingContext2D,
      100,
      100,
      bounds,
      [SQUARE],
    );
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('projects lon/lat to pixels with latitude increasing upward', () => {
    const ctx = fakeCtx();
    clipCanvasToIndia(
      ctx as unknown as CanvasRenderingContext2D,
      100,
      100,
      bounds,
      [SQUARE],
    );
    // First vertex (0,0) is the south-west corner: x=0, and y=100 because the
    // canvas origin is the NORTH edge. An inverted y would render the map
    // upside down while still "clipping".
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 100);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 100); // (10,0) south-east
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 0); // (10,10) north-east
  });

  it('clears the tile when no polygon overlaps it', () => {
    const ctx = fakeCtx();
    // The island sits at lon 20-24, far outside this tile.
    const applied = clipCanvasToIndia(
      ctx as unknown as CanvasRenderingContext2D,
      100,
      100,
      bounds,
      [ISLAND],
    );
    expect(applied).toBe(true);
    // Clearing is correct: "nothing overlaps" means every pixel is outside
    // India, so leaving the raster unmasked would paint pure ocean.
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 100);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('rejects degenerate bounds rather than dividing by zero', () => {
    const ctx = fakeCtx();
    expect(
      clipCanvasToIndia(
        ctx as unknown as CanvasRenderingContext2D,
        100,
        100,
        { west: 5, east: 5, south: 0, north: 10 },
        [SQUARE],
      ),
    ).toBe(false);
  });
});

// ── Agreement between the two clipping paths ──────────────────────────────────

describe('raster and entity clipping agree', () => {
  it('uses the even-odd rule in both, so a lake is excluded either way', () => {
    // pointInIndia excludes the hole...
    expect(pointInIndia(5, 5, [SQUARE_WITH_HOLE])).toBe(false);
    // ...and the canvas path is filled with the matching rule.
    const ctx = fakeCtx();
    clipCanvasToIndia(
      ctx as unknown as CanvasRenderingContext2D,
      100,
      100,
      { west: 0, east: 10, south: 0, north: 10 },
      [SQUARE_WITH_HOLE],
    );
    expect(ctx.fill).toHaveBeenCalledWith('evenodd');
  });
});
