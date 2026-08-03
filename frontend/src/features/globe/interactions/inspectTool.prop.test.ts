/**
 * Property-Based Test: Inspect Tool Nearest-Cell Lookup
 *
 * **Validates: Requirements 3.1, 3.2**
 *
 * Property 3: For any click position within the active region's bounding box,
 * the inspect tool SHALL return the grid cell whose center is closest to (lat, lon),
 * and that distance SHALL be within 0.25° (the grid resolution tolerance).
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { findNearestCell } from './inspectTool';
import type { GridCell } from '../../../types';

// India approximate bounds for grid generation
const INDIA_LAT_MIN = 8.0;
const INDIA_LAT_MAX = 37.0;
const INDIA_LON_MIN = 68.0;
const INDIA_LON_MAX = 97.5;

// Grid resolution
const GRID_STEP = 0.25;

/**
 * Arbitrary: Generate a lat value snapped to 0.25° grid within India bounds.
 */
const gridLat = fc.double({ min: INDIA_LAT_MIN, max: INDIA_LAT_MAX, noNaN: true }).map(
  (v) => Math.round(v / GRID_STEP) * GRID_STEP
);

/**
 * Arbitrary: Generate a lon value snapped to 0.25° grid within India bounds.
 */
const gridLon = fc.double({ min: INDIA_LON_MIN, max: INDIA_LON_MAX, noNaN: true }).map(
  (v) => Math.round(v / GRID_STEP) * GRID_STEP
);

/**
 * Arbitrary: Generate a GridCell on the 0.25° grid.
 */
const gridCellArb: fc.Arbitrary<GridCell> = fc.record({
  lat: gridLat,
  lon: gridLon,
  node_idx: fc.nat({ max: 10000 }),
  rainfall: fc.double({ min: 0, max: 500, noNaN: true }),
  temp_max: fc.double({ min: -10, max: 55, noNaN: true }),
  temp_min: fc.double({ min: -20, max: 45, noNaN: true }),
  rainfall_uncertainty: fc.double({ min: 0, max: 100, noNaN: true }),
  temp_max_uncertainty: fc.double({ min: 0, max: 10, noNaN: true }),
  temp_min_uncertainty: fc.double({ min: 0, max: 10, noNaN: true }),
});

/**
 * Arbitrary: Generate a non-empty array of grid cells (1 to 50 cells).
 */
const gridCellsArb = fc.array(gridCellArb, { minLength: 1, maxLength: 50 });

/**
 * Helper: Euclidean distance in degree space.
 */
function euclideanDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

describe('Property 3: Inspect Tool Nearest-Cell Lookup', () => {
  /**
   * For any click within the bounding box of a grid cell array,
   * findNearestCell returns the closest cell and its distance ≤ 0.25°.
   */
  test.prop([gridCellsArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })])(
    'returned cell center is within 0.25° of click position when click is inside grid bounds',
    (cells, latFrac, lonFrac) => {
      // Compute bounding box of the cells
      const lats = cells.map((c) => c.lat);
      const lons = cells.map((c) => c.lon);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);

      // Generate a click position within the bounding box of the cells
      const clickLat = minLat + latFrac * (maxLat - minLat);
      const clickLon = minLon + lonFrac * (maxLon - minLon);

      const result = findNearestCell(clickLat, clickLon, cells, 0.25);

      if (result !== null) {
        // The returned cell's center must be within 0.25° of the click
        const dist = euclideanDist(clickLat, clickLon, result.lat, result.lon);
        expect(dist).toBeLessThanOrEqual(0.25 + 1e-10); // small epsilon for floating point
      }
      // result can be null if click is more than 0.25° from any cell
      // (possible if bounding box is larger than cell spacing)
    }
  );

  /**
   * For any click position very close to a cell center (within half a grid step),
   * findNearestCell should always return that cell (it's clearly the nearest).
   */
  test.prop([gridCellsArb, fc.nat()])(
    'click at a cell center always returns that cell',
    (cells, idx) => {
      // Pick an arbitrary cell from the array
      const targetCell = cells[idx % cells.length];

      const result = findNearestCell(targetCell.lat, targetCell.lon, cells, 0.25);

      // Clicking exactly on a cell center should always find it
      expect(result).not.toBeNull();
      expect(result!.lat).toBe(targetCell.lat);
      expect(result!.lon).toBe(targetCell.lon);
    }
  );

  /**
   * Clicks outside tolerance (> 0.25° from any cell) return null.
   */
  test.prop([gridCellsArb])(
    'click far outside all cells returns null',
    (cells) => {
      // Compute bounding box and place click well outside (> 0.25° from all cells)
      const lats = cells.map((c) => c.lat);
      const lons = cells.map((c) => c.lon);
      const maxLat = Math.max(...lats);
      const maxLon = Math.max(...lons);

      // Click 1° beyond the bounding box — guaranteed > 0.25° from any cell
      const farLat = maxLat + 1.0;
      const farLon = maxLon + 1.0;

      const result = findNearestCell(farLat, farLon, cells, 0.25);
      expect(result).toBeNull();
    }
  );

  /**
   * findNearestCell always returns the actual closest cell (no cell is closer).
   */
  test.prop([gridCellsArb, fc.double({ min: INDIA_LAT_MIN, max: INDIA_LAT_MAX, noNaN: true }), fc.double({ min: INDIA_LON_MIN, max: INDIA_LON_MAX, noNaN: true })])(
    'returned cell is the true nearest cell among all candidates',
    (cells, clickLat, clickLon) => {
      const result = findNearestCell(clickLat, clickLon, cells, 0.25);

      if (result !== null) {
        const resultDist = euclideanDist(clickLat, clickLon, result.lat, result.lon);

        // Verify no other cell is closer
        for (const cell of cells) {
          const cellDist = euclideanDist(clickLat, clickLon, cell.lat, cell.lon);
          expect(resultDist).toBeLessThanOrEqual(cellDist + 1e-10);
        }
      }
    }
  );
});
