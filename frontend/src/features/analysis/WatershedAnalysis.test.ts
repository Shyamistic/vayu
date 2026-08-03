/**
 * Unit tests for WatershedAnalysis pure functions.
 *
 * Tests computeBasinVolume, getCellsInBasin, assessBasins,
 * percentile90, and generateHydrograph.
 *
 * Validates: Requirements 40.1, 40.2, 40.3, 40.4
 */

import { describe, it, expect } from 'vitest';
import {
  computeBasinVolume,
  getCellsInBasin,
  assessBasins,
  percentile90,
  generateHydrograph,
  BASIN_HISTORICAL_P90_MM,
  type BasinVolume,
} from './WatershedAnalysis';
import { RIVER_BASINS, type RiverBasin } from './FloodRiskPanel';
import type { GridCell } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat: 15.0,
    lon: 75.0,
    node_idx: 0,
    rainfall: 10,
    temp_max: 32,
    temp_min: 22,
    rainfall_uncertainty: 2,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 1,
    ...overrides,
  };
}

function makeBasin(overrides: Partial<RiverBasin> = {}): RiverBasin {
  return {
    id: 'test_basin',
    name: 'Test Basin',
    bounds: [10, 20, 70, 80],
    criticalThreshold: 100,
    ...overrides,
  };
}

// ── computeBasinVolume ────────────────────────────────────────────────────────

describe('computeBasinVolume', () => {
  it('returns 0 for empty cell array', () => {
    expect(computeBasinVolume([])).toBe(0);
  });

  it('computes positive volume for single cell with rainfall', () => {
    const cell = makeCell({ rainfall: 10 });
    const vol = computeBasinVolume([cell]);
    expect(vol).toBeGreaterThan(0);
  });

  it('volume scales linearly with rainfall', () => {
    const cell10 = makeCell({ rainfall: 10 });
    const cell20 = makeCell({ rainfall: 20 });
    const vol10 = computeBasinVolume([cell10]);
    const vol20 = computeBasinVolume([cell20]);
    expect(vol20).toBeCloseTo(vol10 * 2, 5);
  });

  it('volume scales linearly with number of cells', () => {
    const cell = makeCell({ rainfall: 50 });
    const vol1 = computeBasinVolume([cell]);
    const vol3 = computeBasinVolume([cell, cell, cell]);
    expect(vol3).toBeCloseTo(vol1 * 3, 5);
  });

  it('returns zero for all-zero rainfall cells', () => {
    const cells = [makeCell({ rainfall: 0 }), makeCell({ rainfall: 0 })];
    expect(computeBasinVolume(cells)).toBe(0);
  });

  it('result is in million m³ — realistic scale for single cell at 100mm', () => {
    // 1 cell × 717.24 km² × 100 mm = 717.24×10⁶ m² × 0.1 m = 71.724×10⁶ m³ = 71.724 Mm³
    const cell = makeCell({ rainfall: 100 });
    const vol = computeBasinVolume([cell]);
    expect(vol).toBeCloseTo(71.724, 1);
  });
});

// ── getCellsInBasin ───────────────────────────────────────────────────────────

describe('getCellsInBasin', () => {
  const basin = makeBasin({ bounds: [10, 20, 70, 80] });

  it('returns cells inside the bounding box', () => {
    const inside = makeCell({ lat: 15, lon: 75 });
    const result = getCellsInBasin([inside], basin);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(inside);
  });

  it('excludes cells outside the bounding box', () => {
    const outside1 = makeCell({ lat: 5, lon: 75 });   // lat below min
    const outside2 = makeCell({ lat: 15, lon: 85 });  // lon above max
    const outside3 = makeCell({ lat: 25, lon: 75 });  // lat above max
    expect(getCellsInBasin([outside1, outside2, outside3], basin)).toHaveLength(0);
  });

  it('includes cells on boundary edges', () => {
    const onMinLat = makeCell({ lat: 10, lon: 75 });
    const onMaxLon = makeCell({ lat: 15, lon: 80 });
    const result = getCellsInBasin([onMinLat, onMaxLon], basin);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no cells are provided', () => {
    expect(getCellsInBasin([], basin)).toHaveLength(0);
  });

  it('returns empty array when no cells intersect the basin', () => {
    const cell = makeCell({ lat: 50, lon: 50 });
    expect(getCellsInBasin([cell], basin)).toHaveLength(0);
  });
});

// ── assessBasins ──────────────────────────────────────────────────────────────

describe('assessBasins', () => {
  it('returns one entry per basin', () => {
    const results = assessBasins([], RIVER_BASINS);
    expect(results).toHaveLength(RIVER_BASINS.length);
  });

  it('basin with no cells has volume 0 and meanRainfall 0', () => {
    const results = assessBasins([], RIVER_BASINS);
    results.forEach((bv) => {
      expect(bv.volumeMillionM3).toBe(0);
      expect(bv.meanRainfallMm).toBe(0);
    });
  });

  it('basin with cells in range has positive volume', () => {
    // Ganga basin bounds: [24, 31, 78, 88]
    const gangaCell = makeCell({ lat: 27, lon: 83, rainfall: 100 });
    const results = assessBasins([gangaCell], RIVER_BASINS);
    const ganga = results.find((b) => b.basin.id === 'ganga')!;
    expect(ganga.volumeMillionM3).toBeGreaterThan(0);
    expect(ganga.cells).toHaveLength(1);
  });

  it('cell outside all basins contributes to no basin', () => {
    // Remote cell that doesn't fall in any basin bounds
    const remoteCell = makeCell({ lat: 1, lon: 1, rainfall: 500 });
    const results = assessBasins([remoteCell], RIVER_BASINS);
    results.forEach((bv) => {
      expect(bv.cells).toHaveLength(0);
    });
  });

  it('flags basins above 90th percentile threshold', () => {
    // Ganga P90 = 180mm; inject a cell with rainfall >> 180 to trigger flag
    const gangaCell = makeCell({ lat: 27, lon: 83, rainfall: 300 });
    const results = assessBasins([gangaCell], RIVER_BASINS);
    const ganga = results.find((b) => b.basin.id === 'ganga')!;
    expect(ganga.isAbove90thPercentile).toBe(true);
  });

  it('does not flag basins below 90th percentile threshold', () => {
    // Ganga P90 = 180mm; inject low-rainfall cell
    const gangaCell = makeCell({ lat: 27, lon: 83, rainfall: 50 });
    const results = assessBasins([gangaCell], RIVER_BASINS);
    const ganga = results.find((b) => b.basin.id === 'ganga')!;
    expect(ganga.isAbove90thPercentile).toBe(false);
  });

  it('correctly computes meanRainfallMm across multiple cells', () => {
    const basin = makeBasin({ bounds: [24, 31, 78, 88] });
    const cells = [
      makeCell({ lat: 26, lon: 82, rainfall: 100 }),
      makeCell({ lat: 28, lon: 84, rainfall: 200 }),
    ];
    const results = assessBasins(cells, [basin]);
    expect(results[0].meanRainfallMm).toBeCloseTo(150, 5);
  });
});

// ── percentile90 ──────────────────────────────────────────────────────────────

describe('percentile90', () => {
  it('returns 0 for empty array', () => {
    expect(percentile90([])).toBe(0);
  });

  it('returns the single value for a 1-element array', () => {
    expect(percentile90([42])).toBe(42);
  });

  it('returns 9 for [1..10] — 90th percentile is at index ceil(0.9×10)-1 = 8', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // sorted: [1,2,3,4,5,6,7,8,9,10], idx = ceil(9) - 1 = 8 → value 9
    expect(percentile90(vals)).toBe(9);
  });

  it('p90 of [1..100] is 90', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile90(vals)).toBe(90);
  });

  it('is not affected by input order', () => {
    const sorted = [10, 20, 30, 40, 50];
    const shuffled = [30, 10, 50, 20, 40];
    expect(percentile90(sorted)).toBe(percentile90(shuffled));
  });

  it('p90 value is always within the range of input values', () => {
    const vals = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
    const p = percentile90(vals);
    expect(p).toBeGreaterThanOrEqual(Math.min(...vals));
    expect(p).toBeLessThanOrEqual(Math.max(...vals));
  });
});

// ── generateHydrograph ────────────────────────────────────────────────────────

describe('generateHydrograph', () => {
  function makeFakeBasinVolume(overrides: Partial<BasinVolume> = {}): BasinVolume {
    const basin = makeBasin();
    return {
      basin,
      cells: [makeCell(), makeCell()], // 2 cells → small basin
      volumeMillionM3: 10,
      meanRainfallMm: 50,
      isAbove90thPercentile: false,
      ...overrides,
    };
  }

  it('generates non-empty hydrograph for non-zero rainfall', () => {
    const bv = makeFakeBasinVolume();
    const daily = Array(7).fill(50);
    const points = generateHydrograph(bv, daily);
    expect(points.length).toBeGreaterThan(0);
  });

  it('all discharge values are non-negative', () => {
    const bv = makeFakeBasinVolume();
    const daily = [100, 80, 60, 40, 20, 10, 5];
    const points = generateHydrograph(bv, daily);
    points.forEach((p) => {
      expect(p.discharge).toBeGreaterThanOrEqual(0);
    });
  });

  it('hydrograph spans 0 to 168 hours', () => {
    const bv = makeFakeBasinVolume();
    const daily = Array(7).fill(30);
    const points = generateHydrograph(bv, daily);
    const hours = points.map((p) => p.hourOffset);
    expect(Math.min(...hours)).toBe(0);
    expect(Math.max(...hours)).toBe(168);
  });

  it('returns zero discharge everywhere for zero rainfall', () => {
    const bv = makeFakeBasinVolume({ cells: [makeCell({ rainfall: 0 })] });
    const daily = Array(7).fill(0);
    const points = generateHydrograph(bv, daily);
    points.forEach((p) => {
      expect(p.discharge).toBe(0);
    });
  });

  it('peak discharge increases with higher rainfall', () => {
    const bv = makeFakeBasinVolume();
    const lowRain = Array(7).fill(10);
    const highRain = Array(7).fill(200);
    const lowPoints = generateHydrograph(bv, lowRain);
    const highPoints = generateHydrograph(bv, highRain);
    const lowPeak = Math.max(...lowPoints.map((p) => p.discharge));
    const highPeak = Math.max(...highPoints.map((p) => p.discharge));
    expect(highPeak).toBeGreaterThan(lowPeak);
  });

  it('hourOffset values are evenly spaced at 6-hour intervals', () => {
    const bv = makeFakeBasinVolume();
    const daily = Array(7).fill(50);
    const points = generateHydrograph(bv, daily);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].hourOffset - points[i - 1].hourOffset).toBe(6);
    }
  });
});

// ── BASIN_HISTORICAL_P90_MM sanity checks ─────────────────────────────────────

describe('BASIN_HISTORICAL_P90_MM', () => {
  it('covers all known basins from RIVER_BASINS', () => {
    RIVER_BASINS.forEach((basin) => {
      expect(BASIN_HISTORICAL_P90_MM[basin.id]).toBeDefined();
      expect(BASIN_HISTORICAL_P90_MM[basin.id]).toBeGreaterThan(0);
    });
  });

  it('brahmaputra P90 is highest (wettest basin)', () => {
    const values = Object.values(BASIN_HISTORICAL_P90_MM);
    expect(BASIN_HISTORICAL_P90_MM.brahmaputra).toBe(Math.max(...values));
  });
});
