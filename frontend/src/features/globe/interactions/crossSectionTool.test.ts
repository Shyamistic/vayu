/**
 * Unit tests for the cross-section atmospheric profile tool.
 *
 * Tests sampleTransect, interpolateValue, and haversineDistance
 * for correctness against Requirements 13.1, 13.2, 13.3, 13.4.
 */

import { describe, it, expect } from 'vitest';
import {
  sampleTransect,
  interpolateValue,
  haversineDistance,
  estimateElevation,
} from './crossSectionTool';
import type { GridCell, VariableId } from '../../../types';

/** Helper: create a simple grid of cells for testing */
function makeGridCells(
  latRange: [number, number],
  lonRange: [number, number],
  step: number = 0.25
): GridCell[] {
  const cells: GridCell[] = [];
  let idx = 0;
  for (let lat = latRange[0]; lat <= latRange[1]; lat += step) {
    for (let lon = lonRange[0]; lon <= lonRange[1]; lon += step) {
      cells.push({
        lat,
        lon,
        node_idx: idx++,
        rainfall: 10 + lat * 0.5 + lon * 0.3,
        temp_max: 30 + (lat - 20) * 0.2,
        temp_min: 20 + (lat - 20) * 0.15,
        rainfall_uncertainty: 2,
        temp_max_uncertainty: 0.5,
        temp_min_uncertainty: 0.5,
      });
    }
  }
  return cells;
}

describe('crossSectionTool', () => {
  describe('haversineDistance', () => {
    it('returns 0 for same point', () => {
      const dist = haversineDistance({ lat: 20, lon: 80 }, { lat: 20, lon: 80 });
      expect(dist).toBeCloseTo(0, 5);
    });

    it('computes approximately correct distance for known points', () => {
      // Delhi (28.6, 77.2) to Mumbai (19.07, 72.87) ≈ 1148 km
      const dist = haversineDistance(
        { lat: 28.6, lon: 77.2 },
        { lat: 19.07, lon: 72.87 }
      );
      expect(dist).toBeGreaterThan(1100);
      expect(dist).toBeLessThan(1200);
    });

    it('is symmetric', () => {
      const a = { lat: 15, lon: 75 };
      const b = { lat: 25, lon: 85 };
      expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 10);
    });
  });

  describe('interpolateValue', () => {
    const cells = makeGridCells([19, 21], [79, 81]);

    it('returns exact value when point coincides with a grid cell', () => {
      const value = interpolateValue(20, 80, cells, 'rainfall');
      const exactCell = cells.find((c) => c.lat === 20 && c.lon === 80);
      expect(value).toBeCloseTo(exactCell!.rainfall, 5);
    });

    it('returns interpolated value for point between cells', () => {
      const value = interpolateValue(20.1, 80.1, cells, 'rainfall');
      // Should be close to the values of nearby cells
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(100);
    });

    it('handles empty grid gracefully', () => {
      const value = interpolateValue(20, 80, [], 'rainfall');
      expect(value).toBe(0);
    });

    it('returns nearest cell value when point is far from all cells', () => {
      const farCells: GridCell[] = [
        {
          lat: 10,
          lon: 70,
          node_idx: 0,
          rainfall: 42,
          temp_max: 35,
          temp_min: 25,
          rainfall_uncertainty: 1,
          temp_max_uncertainty: 0.5,
          temp_min_uncertainty: 0.5,
        },
      ];
      // Point very far from the single cell
      const value = interpolateValue(30, 90, farCells, 'rainfall');
      expect(value).toBe(42);
    });
  });

  describe('estimateElevation', () => {
    it('returns a positive number', () => {
      const elev = estimateElevation(20, 80);
      expect(elev).toBeGreaterThanOrEqual(0);
    });

    it('returns higher values for Himalayan latitudes', () => {
      const himalayan = estimateElevation(32, 78);
      const plains = estimateElevation(26, 80);
      expect(himalayan).toBeGreaterThan(plains);
    });
  });

  describe('sampleTransect', () => {
    const cells = makeGridCells([18, 22], [78, 82]);

    it('produces at least 50 points regardless of transect length', () => {
      const result = sampleTransect(
        { lat: 20, lon: 79 },
        { lat: 20, lon: 81 },
        cells,
        'rainfall'
      );
      expect(result.length).toBeGreaterThanOrEqual(50);
    });

    it('produces exactly numPoints when specified above minimum', () => {
      const result = sampleTransect(
        { lat: 19, lon: 79 },
        { lat: 21, lon: 81 },
        cells,
        'temp_max',
        100
      );
      expect(result.length).toBe(100);
    });

    it('clamps to 50 when numPoints is less than 50', () => {
      const result = sampleTransect(
        { lat: 19, lon: 79 },
        { lat: 21, lon: 81 },
        cells,
        'rainfall',
        10
      );
      expect(result.length).toBe(50);
    });

    it('first point is at distance 0 and matches start coordinates', () => {
      const start = { lat: 20, lon: 79 };
      const end = { lat: 20, lon: 81 };
      const result = sampleTransect(start, end, cells, 'rainfall');

      expect(result[0].distance).toBeCloseTo(0, 5);
      expect(result[0].lat).toBeCloseTo(start.lat, 5);
      expect(result[0].lon).toBeCloseTo(start.lon, 5);
    });

    it('last point distance equals total transect length', () => {
      const start = { lat: 20, lon: 79 };
      const end = { lat: 20, lon: 81 };
      const result = sampleTransect(start, end, cells, 'rainfall');

      const expectedDist = haversineDistance(start, end);
      expect(result[result.length - 1].distance).toBeCloseTo(expectedDist, 1);
    });

    it('distances are monotonically increasing', () => {
      const result = sampleTransect(
        { lat: 19, lon: 79 },
        { lat: 22, lon: 82 },
        cells,
        'rainfall'
      );

      for (let i = 1; i < result.length; i++) {
        expect(result[i].distance).toBeGreaterThanOrEqual(result[i - 1].distance);
      }
    });

    it('all points have valid lat/lon within start-end range', () => {
      const start = { lat: 19, lon: 79 };
      const end = { lat: 22, lon: 82 };
      const result = sampleTransect(start, end, cells, 'rainfall');

      for (const point of result) {
        expect(point.lat).toBeGreaterThanOrEqual(Math.min(start.lat, end.lat) - 0.001);
        expect(point.lat).toBeLessThanOrEqual(Math.max(start.lat, end.lat) + 0.001);
        expect(point.lon).toBeGreaterThanOrEqual(Math.min(start.lon, end.lon) - 0.001);
        expect(point.lon).toBeLessThanOrEqual(Math.max(start.lon, end.lon) + 0.001);
      }
    });

    it('all points have non-negative elevation', () => {
      const result = sampleTransect(
        { lat: 19, lon: 79 },
        { lat: 22, lon: 82 },
        cells,
        'rainfall'
      );

      for (const point of result) {
        expect(point.elevation).toBeGreaterThanOrEqual(0);
      }
    });

    it('all points have numeric value (not NaN)', () => {
      const result = sampleTransect(
        { lat: 19, lon: 79 },
        { lat: 22, lon: 82 },
        cells,
        'temp_max'
      );

      for (const point of result) {
        expect(Number.isFinite(point.value)).toBe(true);
      }
    });

    it('works with different variables', () => {
      const variables: VariableId[] = ['rainfall', 'temp_max', 'temp_min'];
      for (const v of variables) {
        const result = sampleTransect(
          { lat: 20, lon: 79 },
          { lat: 20, lon: 81 },
          cells,
          v
        );
        expect(result.length).toBeGreaterThanOrEqual(50);
        expect(result[0].value).toBeDefined();
      }
    });
  });
});
