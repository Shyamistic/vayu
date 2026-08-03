/**
 * Property-Based Test: Cross-Section Sampling Density
 *
 * **Validates: Requirements 13.3**
 *
 * Property 10: For any polyline transect drawn on the globe (regardless of total length),
 * the sampling function SHALL produce at least 50 evenly-distributed interpolation points
 * along the transect path.
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { sampleTransect } from './crossSectionTool';
import type { GridCell } from '../../../types';
import type { LatLon } from './crossSectionTool';

// India approximate bounds
const INDIA_LAT_MIN = 8.0;
const INDIA_LAT_MAX = 37.0;
const INDIA_LON_MIN = 68.0;
const INDIA_LON_MAX = 97.5;

/**
 * Arbitrary: Generate a coordinate within India bounds.
 */
const latLonArb: fc.Arbitrary<LatLon> = fc.record({
  lat: fc.double({ min: INDIA_LAT_MIN, max: INDIA_LAT_MAX, noNaN: true, noDefaultInfinity: true }),
  lon: fc.double({ min: INDIA_LON_MIN, max: INDIA_LON_MAX, noNaN: true, noDefaultInfinity: true }),
});

/**
 * Arbitrary: Generate a GridCell with realistic values.
 */
const gridCellArb: fc.Arbitrary<GridCell> = fc.record({
  lat: fc.double({ min: INDIA_LAT_MIN, max: INDIA_LAT_MAX, noNaN: true, noDefaultInfinity: true }),
  lon: fc.double({ min: INDIA_LON_MIN, max: INDIA_LON_MAX, noNaN: true, noDefaultInfinity: true }),
  node_idx: fc.nat({ max: 10000 }),
  rainfall: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
  temp_max: fc.double({ min: -10, max: 55, noNaN: true, noDefaultInfinity: true }),
  temp_min: fc.double({ min: -20, max: 45, noNaN: true, noDefaultInfinity: true }),
  rainfall_uncertainty: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  temp_max_uncertainty: fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
  temp_min_uncertainty: fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
});

/**
 * Arbitrary: Generate a non-empty array of grid cells (1 to 30 cells).
 */
const gridCellsArb = fc.array(gridCellArb, { minLength: 1, maxLength: 30 });

/**
 * Arbitrary: Generate a variable ID.
 */
const variableArb = fc.constantFrom('rainfall' as const, 'temp_max' as const, 'temp_min' as const);

describe('Property 10: Cross-Section Sampling Density', () => {
  /**
   * For any start/end coordinates and any grid cells,
   * sampleTransect always produces at least 50 points.
   */
  test.prop([latLonArb, latLonArb, gridCellsArb, variableArb])(
    'sampleTransect always produces at least 50 points for any transect',
    (start, end, gridCells, variable) => {
      const points = sampleTransect(start, end, gridCells, variable);
      expect(points.length).toBeGreaterThanOrEqual(50);
    }
  );

  /**
   * Even when a user requests fewer than 50 points,
   * the function enforces the minimum of 50.
   */
  test.prop([latLonArb, latLonArb, gridCellsArb, variableArb, fc.integer({ min: 1, max: 49 })])(
    'sampleTransect enforces minimum 50 points even when fewer are requested',
    (start, end, gridCells, variable, requestedPoints) => {
      const points = sampleTransect(start, end, gridCells, variable, requestedPoints);
      expect(points.length).toBeGreaterThanOrEqual(50);
    }
  );

  /**
   * Distances along the transect are monotonically non-decreasing,
   * confirming points are ordered along the path.
   */
  test.prop([latLonArb, latLonArb, gridCellsArb, variableArb])(
    'sample point distances are monotonically non-decreasing',
    (start, end, gridCells, variable) => {
      const points = sampleTransect(start, end, gridCells, variable);

      for (let i = 1; i < points.length; i++) {
        expect(points[i].distance).toBeGreaterThanOrEqual(points[i - 1].distance);
      }
    }
  );

  /**
   * Points are roughly evenly spaced: the spacing between consecutive points
   * should be approximately constant (within a tolerance).
   * For a valid transect with non-zero length, the maximum spacing between
   * consecutive points should not exceed 3x the minimum spacing.
   */
  test.prop([latLonArb, latLonArb, gridCellsArb, variableArb])(
    'sample points are approximately evenly distributed along the transect',
    (start, end, gridCells, variable) => {
      const points = sampleTransect(start, end, gridCells, variable);

      // Skip check if start and end are the same point (zero-length transect)
      if (points[points.length - 1].distance === 0) return;

      // Compute spacings between consecutive points
      const spacings: number[] = [];
      for (let i = 1; i < points.length; i++) {
        spacings.push(points[i].distance - points[i - 1].distance);
      }

      // Filter out zero spacings (shouldn't exist for non-zero transect with distinct endpoints)
      const nonZeroSpacings = spacings.filter((s) => s > 0);
      if (nonZeroSpacings.length === 0) return;

      const minSpacing = Math.min(...nonZeroSpacings);
      const maxSpacing = Math.max(...nonZeroSpacings);

      // For evenly-distributed points, all spacings should be approximately equal.
      // We allow a tolerance factor of 3x to account for floating-point precision
      // in great-circle vs linear interpolation differences.
      expect(maxSpacing).toBeLessThanOrEqual(minSpacing * 3 + 1e-10);
    }
  );
});
