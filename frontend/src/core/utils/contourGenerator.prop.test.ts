/**
 * Property-Based Test: Contour Generation Correctness (Marching Squares)
 *
 * **Validates: Requirements 10.1, 10.4**
 *
 * Property 7: For any 2D value grid of size N×M (N,M ≥ 2) and any threshold
 * value v, the marching squares algorithm SHALL produce contour line segments
 * where every point on those segments has an interpolated value within ε of v
 * (where ε is determined by grid cell spacing).
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { marchingSquares } from './contourGenerator';
import type { ContourSegment, ContourPoint } from './contourGenerator';

/**
 * Arbitrary: Generate a 2D grid of random values with dimensions [rows x cols].
 * Rows and cols are in [2, 10].
 */
const gridArb = fc
  .tuple(
    fc.integer({ min: 2, max: 10 }), // rows
    fc.integer({ min: 2, max: 10 })  // cols
  )
  .chain(([rows, cols]) =>
    fc.tuple(
      fc.constant(rows),
      fc.constant(cols),
      fc.array(
        fc.array(fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }), {
          minLength: cols,
          maxLength: cols,
        }),
        { minLength: rows, maxLength: rows }
      )
    )
  );

/**
 * Helper: Build evenly-spaced lat and lon arrays for a grid.
 * Lats are descending (north to south), lons are ascending (west to east).
 */
function buildAxes(rows: number, cols: number): { lats: number[]; lons: number[] } {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i < rows; i++) {
    lats.push(30 - i * 0.25); // north to south
  }
  for (let j = 0; j < cols; j++) {
    lons.push(70 + j * 0.25); // west to east
  }
  return { lats, lons };
}

/**
 * Helper: Bilinear interpolation of a value at a geographic point within the grid.
 * Returns the interpolated value at (lat, lon) given the grid and axis arrays.
 */
function bilinearInterpolate(
  grid: number[][],
  lats: number[],
  lons: number[],
  point: ContourPoint
): number {
  const { lat, lon } = point;

  // Find the cell that contains this point
  // Lats are descending, so row index increases as lat decreases
  let rowIdx = -1;
  for (let i = 0; i < lats.length - 1; i++) {
    if (lat <= lats[i] && lat >= lats[i + 1]) {
      rowIdx = i;
      break;
    }
    // Handle points exactly on the top or bottom edge
    if (Math.abs(lat - lats[i]) < 1e-10) {
      rowIdx = Math.max(0, i - (i === lats.length - 1 ? 1 : 0));
      break;
    }
  }
  // Edge case: point is on the last lat
  if (rowIdx === -1 && Math.abs(lat - lats[lats.length - 1]) < 1e-10) {
    rowIdx = lats.length - 2;
  }

  let colIdx = -1;
  for (let j = 0; j < lons.length - 1; j++) {
    if (lon >= lons[j] && lon <= lons[j + 1]) {
      colIdx = j;
      break;
    }
    if (Math.abs(lon - lons[j]) < 1e-10) {
      colIdx = Math.max(0, j - (j === lons.length - 1 ? 1 : 0));
      break;
    }
  }
  // Edge case: point is on the last lon
  if (colIdx === -1 && Math.abs(lon - lons[lons.length - 1]) < 1e-10) {
    colIdx = lons.length - 2;
  }

  if (rowIdx === -1 || colIdx === -1) {
    // Point is outside the grid — shouldn't happen for valid contour output
    return NaN;
  }

  // Get corner values
  const tl = grid[rowIdx][colIdx];
  const tr = grid[rowIdx][colIdx + 1];
  const bl = grid[rowIdx + 1][colIdx];
  const br = grid[rowIdx + 1][colIdx + 1];

  // Compute fractional position within cell
  const latRange = lats[rowIdx] - lats[rowIdx + 1]; // positive (north - south)
  const lonRange = lons[colIdx + 1] - lons[colIdx]; // positive (east - west)

  const tLat = latRange > 1e-10 ? (lats[rowIdx] - lat) / latRange : 0;
  const tLon = lonRange > 1e-10 ? (lon - lons[colIdx]) / lonRange : 0;

  // Bilinear interpolation
  const top = tl + tLon * (tr - tl);
  const bottom = bl + tLon * (br - bl);
  return top + tLat * (bottom - top);
}

describe('Property 7: Contour Generation Correctness (Marching Squares)', () => {
  /**
   * For any grid and threshold within the grid's value range, every point on
   * generated contour segments has an interpolated grid value within ε of the threshold.
   */
  test.prop([gridArb, fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })])(
    'all contour segment points have interpolated value within ε of threshold',
    ([rows, cols, grid], thresholdFrac) => {
      const { lats, lons } = buildAxes(rows, cols);

      // Compute grid value range to pick a meaningful threshold
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (const row of grid) {
        for (const val of row) {
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      }

      // Threshold within the grid value range (ensures contours are likely produced)
      const threshold = minVal + thresholdFrac * (maxVal - minVal);

      // Skip degenerate case where all grid values are equal
      if (Math.abs(maxVal - minVal) < 1e-10) return;

      const segments: ContourSegment[] = marchingSquares(grid, lats, lons, threshold);

      // ε is half the grid cell spacing (0.25° / 2 = 0.125°)
      // In value space, ε is the max difference between interpolated value and threshold
      // For linear interpolation on a cell, contour points should be at exactly the threshold
      // Allow a small numerical tolerance
      const epsilon = 1e-6;

      for (const [pointA, pointB] of segments) {
        for (const point of [pointA, pointB]) {
          const interpolatedValue = bilinearInterpolate(grid, lats, lons, point);

          // The interpolated value at any contour point should be very close to threshold
          expect(interpolatedValue).not.toBeNaN();
          expect(Math.abs(interpolatedValue - threshold)).toBeLessThanOrEqual(epsilon);
        }
      }
    }
  );

  /**
   * When all grid values are strictly above the threshold, no contour segments
   * should be produced (case 15 for all cells).
   */
  test.prop([
    fc.tuple(
      fc.integer({ min: 2, max: 10 }),
      fc.integer({ min: 2, max: 10 })
    ).chain(([rows, cols]) =>
      fc.tuple(
        fc.constant(rows),
        fc.constant(cols),
        fc.array(
          fc.array(fc.double({ min: 10, max: 100, noNaN: true, noDefaultInfinity: true }), {
            minLength: cols,
            maxLength: cols,
          }),
          { minLength: rows, maxLength: rows }
        )
      )
    ),
  ])(
    'no segments produced when all grid values are above threshold',
    ([rows, cols, grid]) => {
      const { lats, lons } = buildAxes(rows, cols);

      // Threshold below all grid values (all values are >= 10, threshold is 5)
      const threshold = 5;

      const segments = marchingSquares(grid, lats, lons, threshold);
      expect(segments).toHaveLength(0);
    }
  );

  /**
   * When all grid values are strictly below the threshold, no contour segments
   * should be produced (case 0 for all cells).
   */
  test.prop([
    fc.tuple(
      fc.integer({ min: 2, max: 10 }),
      fc.integer({ min: 2, max: 10 })
    ).chain(([rows, cols]) =>
      fc.tuple(
        fc.constant(rows),
        fc.constant(cols),
        fc.array(
          fc.array(fc.double({ min: -100, max: -10, noNaN: true, noDefaultInfinity: true }), {
            minLength: cols,
            maxLength: cols,
          }),
          { minLength: rows, maxLength: rows }
        )
      )
    ),
  ])(
    'no segments produced when all grid values are below threshold',
    ([rows, cols, grid]) => {
      const { lats, lons } = buildAxes(rows, cols);

      // Threshold above all grid values (all values are <= -10, threshold is 0)
      const threshold = 0;

      const segments = marchingSquares(grid, lats, lons, threshold);
      expect(segments).toHaveLength(0);
    }
  );
});
