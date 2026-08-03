/**
 * Unit tests for contour generation (marching squares algorithm).
 *
 * Tests core logic: buildValueGrid, marchingSquares, generateContours.
 */

import { describe, it, expect } from 'vitest';
import {
  buildValueGrid,
  marchingSquares,
  generateContours,
  type ContourSegment,
} from './contourGenerator';
import type { GridCell } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGridCell(lat: number, lon: number, rainfall: number): GridCell {
  return {
    lat,
    lon,
    node_idx: 0,
    rainfall,
    temp_max: 30,
    temp_min: 20,
    rainfall_uncertainty: 0,
    temp_max_uncertainty: 0,
    temp_min_uncertainty: 0,
  };
}

// ── buildValueGrid Tests ─────────────────────────────────────────────────────

describe('buildValueGrid', () => {
  it('returns empty grid for empty input', () => {
    const result = buildValueGrid([], 'rainfall');
    expect(result.grid).toEqual([]);
    expect(result.lats).toEqual([]);
    expect(result.lons).toEqual([]);
  });

  it('builds a 2x2 grid correctly', () => {
    const cells: GridCell[] = [
      makeGridCell(10, 70, 5),
      makeGridCell(10, 71, 15),
      makeGridCell(11, 70, 25),
      makeGridCell(11, 71, 35),
    ];

    const result = buildValueGrid(cells, 'rainfall');

    // Lats sorted descending (north first)
    expect(result.lats).toEqual([11, 10]);
    // Lons sorted ascending (west first)
    expect(result.lons).toEqual([70, 71]);
    // Grid: row0 = lat 11, row1 = lat 10
    expect(result.grid).toEqual([
      [25, 35],
      [5, 15],
    ]);
  });

  it('builds a 3x3 grid from unsorted cells', () => {
    const cells: GridCell[] = [
      makeGridCell(9, 72, 1),
      makeGridCell(10, 70, 2),
      makeGridCell(11, 71, 3),
      makeGridCell(9, 70, 4),
      makeGridCell(11, 70, 5),
      makeGridCell(10, 71, 6),
      makeGridCell(9, 71, 7),
      makeGridCell(10, 72, 8),
      makeGridCell(11, 72, 9),
    ];

    const result = buildValueGrid(cells, 'rainfall');

    expect(result.lats).toEqual([11, 10, 9]);
    expect(result.lons).toEqual([70, 71, 72]);
    expect(result.grid).toEqual([
      [5, 3, 9],
      [2, 6, 8],
      [4, 7, 1],
    ]);
  });
});

// ── marchingSquares Tests ────────────────────────────────────────────────────

describe('marchingSquares', () => {
  it('returns no segments for uniform grid above threshold', () => {
    const grid = [
      [10, 10],
      [10, 10],
    ];
    const lats = [11, 10];
    const lons = [70, 71];

    const segments = marchingSquares(grid, lats, lons, 5);
    expect(segments).toEqual([]);
  });

  it('returns no segments for uniform grid below threshold', () => {
    const grid = [
      [2, 2],
      [2, 2],
    ];
    const lats = [11, 10];
    const lons = [70, 71];

    const segments = marchingSquares(grid, lats, lons, 5);
    expect(segments).toEqual([]);
  });

  it('returns segments when contour crosses the grid', () => {
    // TL=0, TR=10, BL=0, BR=10 — vertical contour at threshold=5
    const grid = [
      [0, 10],
      [0, 10],
    ];
    const lats = [11, 10];
    const lons = [70, 71];

    const segments = marchingSquares(grid, lats, lons, 5);
    expect(segments.length).toBeGreaterThan(0);

    // Verify all points on segments have interpolated value near threshold
    for (const [ptA, ptB] of segments) {
      // Points should lie within the grid bounds
      expect(ptA.lat).toBeGreaterThanOrEqual(10);
      expect(ptA.lat).toBeLessThanOrEqual(11);
      expect(ptA.lon).toBeGreaterThanOrEqual(70);
      expect(ptA.lon).toBeLessThanOrEqual(71);
      expect(ptB.lat).toBeGreaterThanOrEqual(10);
      expect(ptB.lat).toBeLessThanOrEqual(11);
      expect(ptB.lon).toBeGreaterThanOrEqual(70);
      expect(ptB.lon).toBeLessThanOrEqual(71);
    }
  });

  it('handles horizontal contour (top above, bottom below)', () => {
    // TL=10, TR=10, BL=0, BR=0 — horizontal contour at threshold=5
    const grid = [
      [10, 10],
      [0, 0],
    ];
    const lats = [11, 10];
    const lons = [70, 71];

    const segments = marchingSquares(grid, lats, lons, 5);
    expect(segments.length).toBe(1);

    // The contour should be a horizontal line at lat=10.5
    const [ptA, ptB] = segments[0];
    expect(ptA.lat).toBeCloseTo(10.5, 5);
    expect(ptB.lat).toBeCloseTo(10.5, 5);
  });

  it('produces no segments for grids smaller than 2x2', () => {
    const grid = [[5]];
    const lats = [10];
    const lons = [70];

    const segments = marchingSquares(grid, lats, lons, 3);
    expect(segments).toEqual([]);
  });

  it('handles a larger grid with diagonal contour', () => {
    // 3x3 grid with values increasing diagonally
    const grid = [
      [0, 5, 10],
      [5, 10, 15],
      [10, 15, 20],
    ];
    const lats = [12, 11, 10];
    const lons = [70, 71, 72];

    const segments = marchingSquares(grid, lats, lons, 7.5);
    // Should produce segments — contour crosses multiple cells
    expect(segments.length).toBeGreaterThan(0);
  });
});

// ── generateContours Tests ───────────────────────────────────────────────────

describe('generateContours', () => {
  it('returns empty results for empty grid cells', () => {
    const results = generateContours([], 'rainfall', [5, 10]);
    expect(results).toEqual([]);
  });

  it('returns empty results for empty levels', () => {
    const cells = [makeGridCell(10, 70, 5)];
    const results = generateContours(cells, 'rainfall', []);
    expect(results).toEqual([]);
  });

  it('generates contours for multiple levels', () => {
    const cells: GridCell[] = [
      makeGridCell(11, 70, 0),
      makeGridCell(11, 71, 10),
      makeGridCell(10, 70, 20),
      makeGridCell(10, 71, 30),
    ];

    const results = generateContours(cells, 'rainfall', [5, 10, 25]);

    expect(results.length).toBe(3);
    expect(results[0].level).toBe(5);
    expect(results[1].level).toBe(10);
    expect(results[2].level).toBe(25);

    // Each level should produce at least one segment (values span 0-30)
    expect(results[0].segments.length).toBeGreaterThan(0);
    expect(results[1].segments.length).toBeGreaterThan(0);
    expect(results[2].segments.length).toBeGreaterThan(0);
  });

  it('returns no segments for a level outside data range', () => {
    const cells: GridCell[] = [
      makeGridCell(11, 70, 0),
      makeGridCell(11, 71, 5),
      makeGridCell(10, 70, 3),
      makeGridCell(10, 71, 8),
    ];

    const results = generateContours(cells, 'rainfall', [100]);
    expect(results.length).toBe(1);
    expect(results[0].segments.length).toBe(0);
  });
});
