/**
 * Property-Based Test: Temporal Interpolation Boundedness
 *
 * **Validates: Requirements 11.3**
 *
 * Property 8: For any two consecutive forecast day grid cell arrays A and B,
 * and any interpolation fraction t in [0, 1], the interpolated value for each
 * cell SHALL be bounded: min(A[i], B[i]) ≤ interpolated[i] ≤ max(A[i], B[i]).
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { interpolateGridCells } from './animationEngine';
import type { GridCell } from '../../../types';

/**
 * Arbitrary: Generate a GridCell with random but realistic climate values.
 */
const gridCellArb: fc.Arbitrary<GridCell> = fc.record({
  lat: fc.double({ min: 8.0, max: 37.0, noNaN: true }),
  lon: fc.double({ min: 68.0, max: 97.5, noNaN: true }),
  node_idx: fc.nat({ max: 10000 }),
  rainfall: fc.double({ min: 0, max: 500, noNaN: true }),
  temp_max: fc.double({ min: -10, max: 55, noNaN: true }),
  temp_min: fc.double({ min: -20, max: 45, noNaN: true }),
  rainfall_uncertainty: fc.double({ min: 0, max: 100, noNaN: true }),
  temp_max_uncertainty: fc.double({ min: 0, max: 10, noNaN: true }),
  temp_min_uncertainty: fc.double({ min: 0, max: 10, noNaN: true }),
});

/**
 * Arbitrary: Generate a pair of GridCell arrays with the same length (1–50 cells).
 * Both arrays share the same length to match the interpolation requirement.
 */
const gridCellPairArb = fc.nat({ max: 49 }).chain((len) => {
  const length = len + 1; // 1–50
  return fc.tuple(
    fc.array(gridCellArb, { minLength: length, maxLength: length }),
    fc.array(gridCellArb, { minLength: length, maxLength: length }),
  );
});

/**
 * Arbitrary: Interpolation fraction in [0, 1].
 */
const fractionArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

describe('Property 8: Temporal Interpolation Boundedness', () => {
  /**
   * For any two cell arrays and fraction t in [0,1], every interpolated
   * value (rainfall, temp_max, temp_min) is bounded between the min and max
   * of the corresponding source values.
   */
  test.prop([gridCellPairArb, fractionArb])(
    'interpolated values are bounded between min and max of source values',
    ([cellsA, cellsB], t) => {
      const result = interpolateGridCells(cellsA, cellsB, t);

      expect(result).toHaveLength(Math.min(cellsA.length, cellsB.length));

      for (let i = 0; i < result.length; i++) {
        const a = cellsA[i];
        const b = cellsB[i];
        const r = result[i];

        // Rainfall bounded
        const minRainfall = Math.min(a.rainfall, b.rainfall);
        const maxRainfall = Math.max(a.rainfall, b.rainfall);
        expect(r.rainfall).toBeGreaterThanOrEqual(minRainfall - 1e-10);
        expect(r.rainfall).toBeLessThanOrEqual(maxRainfall + 1e-10);

        // Temp max bounded
        const minTempMax = Math.min(a.temp_max, b.temp_max);
        const maxTempMax = Math.max(a.temp_max, b.temp_max);
        expect(r.temp_max).toBeGreaterThanOrEqual(minTempMax - 1e-10);
        expect(r.temp_max).toBeLessThanOrEqual(maxTempMax + 1e-10);

        // Temp min bounded
        const minTempMin = Math.min(a.temp_min, b.temp_min);
        const maxTempMin = Math.max(a.temp_min, b.temp_min);
        expect(r.temp_min).toBeGreaterThanOrEqual(minTempMin - 1e-10);
        expect(r.temp_min).toBeLessThanOrEqual(maxTempMin + 1e-10);
      }
    }
  );

  /**
   * When t=0, interpolation returns cellsA values exactly.
   */
  test.prop([gridCellPairArb])(
    't=0 returns cellsA values',
    ([cellsA, cellsB]) => {
      const result = interpolateGridCells(cellsA, cellsB, 0);

      for (let i = 0; i < result.length; i++) {
        expect(result[i].rainfall).toBeCloseTo(cellsA[i].rainfall, 10);
        expect(result[i].temp_max).toBeCloseTo(cellsA[i].temp_max, 10);
        expect(result[i].temp_min).toBeCloseTo(cellsA[i].temp_min, 10);
      }
    }
  );

  /**
   * When t=1, interpolation returns cellsB values exactly.
   */
  test.prop([gridCellPairArb])(
    't=1 returns cellsB values',
    ([cellsA, cellsB]) => {
      const result = interpolateGridCells(cellsA, cellsB, 1);

      for (let i = 0; i < result.length; i++) {
        expect(result[i].rainfall).toBeCloseTo(cellsB[i].rainfall, 10);
        expect(result[i].temp_max).toBeCloseTo(cellsB[i].temp_max, 10);
        expect(result[i].temp_min).toBeCloseTo(cellsB[i].temp_min, 10);
      }
    }
  );
});
