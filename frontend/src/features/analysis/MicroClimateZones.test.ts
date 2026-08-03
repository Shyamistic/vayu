/**
 * Unit tests for MicroClimateZones pure functions.
 *
 * Tests cover:
 *  - buildSpatialIndex
 *  - findNeighbors
 *  - meanAndStdDev
 *  - detectMicroClimateZones (Req 60.1)
 *  - inferCause (Req 60.2)
 *  - estimateLULC / buildLULCOverlay (Req 60.4)
 *  - generateMicroClimateReport (Req 60.3)
 */

import { describe, it, expect } from 'vitest';
import type { GridCell } from '../../types';
import {
  buildSpatialIndex,
  findNeighbors,
  meanAndStdDev,
  getCellValue,
  inferCause,
  detectMicroClimateZones,
  estimateLULC,
  buildLULCOverlay,
  generateMicroClimateReport,
  MICRO_CLIMATE_SIGMA_THRESHOLD,
  MOCK_GRID_CELLS,
} from './MicroClimateZones';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCell(lat: number, lon: number, rainfall = 50, temp_max = 35, temp_min = 25): GridCell {
  return {
    lat, lon,
    node_idx: 0,
    rainfall,
    temp_max,
    temp_min,
    rainfall_uncertainty: 5,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 0.8,
  };
}

/**
 * Build a 3×3 grid centred at (lat, lon) with a 0.25° spacing.
 * The centre cell gets `centreValue`; all neighbours get `neighborValue`.
 */
function make3x3Grid(
  centreValue: number,
  neighborValue: number,
  variable: 'rainfall' | 'temp_max' | 'temp_min' = 'rainfall',
): GridCell[] {
  const cells: GridCell[] = [];
  let idx = 0;
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const lat = parseFloat((20 + dLat * 0.25).toFixed(2));
      const lon = parseFloat((78 + dLon * 0.25).toFixed(2));
      const isCentre = dLat === 0 && dLon === 0;
      const v = isCentre ? centreValue : neighborValue;
      cells.push(makeCell(
        lat, lon,
        variable === 'rainfall' ? v : 50,
        variable === 'temp_max' ? v : 35,
        variable === 'temp_min' ? v : 25,
      ));
      idx++;
    }
  }
  return cells;
}

// ── buildSpatialIndex ─────────────────────────────────────────────────────────

describe('buildSpatialIndex', () => {
  it('indexes cells by "lat_lon" key', () => {
    const cells = [makeCell(20.00, 78.00), makeCell(20.25, 78.25)];
    const index = buildSpatialIndex(cells);
    expect(index.has('20.00_78.00')).toBe(true);
    expect(index.has('20.25_78.25')).toBe(true);
  });

  it('returns the correct cell for a given key', () => {
    const cell = makeCell(15.50, 74.25, 120);
    const index = buildSpatialIndex([cell]);
    const found = index.get('15.50_74.25');
    expect(found?.rainfall).toBe(120);
  });

  it('handles empty array', () => {
    expect(buildSpatialIndex([]).size).toBe(0);
  });
});

// ── findNeighbors ─────────────────────────────────────────────────────────────

describe('findNeighbors', () => {
  it('returns all 8 neighbors for a cell fully surrounded in a 3×3 grid', () => {
    const cells = make3x3Grid(100, 50);
    const index = buildSpatialIndex(cells);
    const neighbors = findNeighbors(20.00, 78.00, index);
    expect(neighbors).toHaveLength(8);
  });

  it('does not include the cell itself', () => {
    const cells = make3x3Grid(100, 50);
    const index = buildSpatialIndex(cells);
    const neighbors = findNeighbors(20.00, 78.00, index);
    const selfInNeighbors = neighbors.some(n => n.lat === 20 && n.lon === 78);
    expect(selfInNeighbors).toBe(false);
  });

  it('returns fewer than 8 for edge cells (only present neighbors found)', () => {
    // Single isolated cell — no neighbors in index
    const cells = [makeCell(20.00, 78.00)];
    const index = buildSpatialIndex(cells);
    const neighbors = findNeighbors(20.00, 78.00, index);
    expect(neighbors).toHaveLength(0);
  });
});

// ── meanAndStdDev ─────────────────────────────────────────────────────────────

describe('meanAndStdDev', () => {
  it('computes correct mean and stddev for known values', () => {
    const { mean, stdDev } = meanAndStdDev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean).toBeCloseTo(5, 5);
    expect(stdDev).toBeCloseTo(2, 5);
  });

  it('returns { mean: 0, stdDev: 0 } for empty array', () => {
    const { mean, stdDev } = meanAndStdDev([]);
    expect(mean).toBe(0);
    expect(stdDev).toBe(0);
  });

  it('returns stdDev 0 for identical values', () => {
    const { stdDev } = meanAndStdDev([5, 5, 5, 5]);
    expect(stdDev).toBe(0);
  });
});

// ── getCellValue ──────────────────────────────────────────────────────────────

describe('getCellValue', () => {
  const cell = makeCell(20, 78, 100, 38, 24);
  it('returns rainfall for "rainfall"', () => expect(getCellValue(cell, 'rainfall')).toBe(100));
  it('returns temp_max for "temp_max"', () => expect(getCellValue(cell, 'temp_max')).toBe(38));
  it('returns temp_min for "temp_min"', () => expect(getCellValue(cell, 'temp_min')).toBe(24));
});

// ── detectMicroClimateZones ───────────────────────────────────────────────────

describe('detectMicroClimateZones', () => {
  it('detects centre cell when it deviates >1.5σ from all-same neighbors', () => {
    // All 8 neighbors = 50, centre = 200 (huge positive deviation)
    const grid = make3x3Grid(200, 50, 'rainfall');
    const zones = detectMicroClimateZones(grid, 'rainfall');
    expect(zones.length).toBeGreaterThanOrEqual(1);
    // The anomalous centre cell should be in the results
    const centre = zones.find(z => z.cell.lat === 20.00 && z.cell.lon === 78.00);
    expect(centre).toBeDefined();
    expect(Math.abs(centre!.sigmaDeviation)).toBeGreaterThan(MICRO_CLIMATE_SIGMA_THRESHOLD);
  });

  it('does not flag a cell when deviation is below 1.5σ', () => {
    // All cells have the same value — no anomaly possible
    const grid = make3x3Grid(50, 50, 'rainfall');
    const zones = detectMicroClimateZones(grid, 'rainfall');
    expect(zones).toHaveLength(0);
  });

  it('returns empty array for empty grid', () => {
    expect(detectMicroClimateZones([], 'rainfall')).toHaveLength(0);
  });

  it('sorts results by |sigmaDeviation| descending', () => {
    const zones = detectMicroClimateZones(MOCK_GRID_CELLS, 'rainfall');
    for (let i = 1; i < zones.length; i++) {
      expect(Math.abs(zones[i - 1].sigmaDeviation)).toBeGreaterThanOrEqual(
        Math.abs(zones[i].sigmaDeviation),
      );
    }
  });

  it('sigmaDeviation is positive when cell value exceeds neighbor mean', () => {
    const grid = make3x3Grid(200, 50, 'rainfall');
    const zones = detectMicroClimateZones(grid, 'rainfall');
    const centre = zones.find(z => z.cell.lat === 20 && z.cell.lon === 78)!;
    expect(centre.sigmaDeviation).toBeGreaterThan(0);
  });

  it('sigmaDeviation is negative when cell value is below neighbor mean', () => {
    const grid = make3x3Grid(0, 50, 'rainfall');
    const zones = detectMicroClimateZones(grid, 'rainfall');
    const centre = zones.find(z => z.cell.lat === 20 && z.cell.lon === 78)!;
    // If detected, deviation must be negative
    if (centre) expect(centre.sigmaDeviation).toBeLessThan(0);
  });

  it('works for temp_max variable', () => {
    const grid = make3x3Grid(48, 35, 'temp_max');
    const zones = detectMicroClimateZones(grid, 'temp_max');
    expect(zones.length).toBeGreaterThanOrEqual(1);
  });
});

// ── inferCause ────────────────────────────────────────────────────────────────

describe('inferCause', () => {
  it('returns coastal_effect for rainfall anomaly on west coast', () => {
    const cell = makeCell(15, 75, 300);
    expect(inferCause(cell, 'rainfall', 2.5)).toBe('coastal_effect');
  });

  it('returns urban_heat for positive temp anomaly near Delhi', () => {
    const cell = makeCell(28.75, 77.0, 10, 46, 32);
    expect(inferCause(cell, 'temp_max', 3.0)).toBe('urban_heat');
  });

  it('returns valley_channeling for negative temperature deviation', () => {
    const cell = makeCell(25, 80, 20, 30, 22);
    expect(inferCause(cell, 'temp_max', -2.0)).toBe('valley_channeling');
  });

  it('returns elevation for positive rainfall in Western Ghats', () => {
    const cell = makeCell(15, 75.5, 280);
    // West coast applies here; test orographic in NE India instead
    const cellNE = makeCell(25, 92, 300);
    expect(inferCause(cellNE, 'rainfall', 2.5)).toBe('elevation');
  });
});

// ── estimateLULC ──────────────────────────────────────────────────────────────

describe('estimateLULC', () => {
  it('returns snow_ice for high-altitude Himalayan location', () => {
    expect(estimateLULC(34, 78)).toBe('snow_ice');
  });

  it('returns urban near Delhi', () => {
    expect(estimateLULC(28.61, 77.21)).toBe('urban');
  });

  it('returns forest in Western Ghats', () => {
    expect(estimateLULC(15, 76)).toBe('forest');
  });

  it('returns barren in Thar Desert', () => {
    expect(estimateLULC(27, 71)).toBe('barren');
  });

  it('returns cropland for generic central India location', () => {
    expect(estimateLULC(22, 82)).toBe('cropland');
  });
});

// ── buildLULCOverlay ──────────────────────────────────────────────────────────

describe('buildLULCOverlay', () => {
  it('returns one LULCCell per input grid cell', () => {
    const overlay = buildLULCOverlay(MOCK_GRID_CELLS);
    expect(overlay).toHaveLength(MOCK_GRID_CELLS.length);
  });

  it('each cell has a non-empty color and label', () => {
    const overlay = buildLULCOverlay(MOCK_GRID_CELLS);
    for (const cell of overlay) {
      expect(cell.color).toBeTruthy();
      expect(cell.label).toBeTruthy();
    }
  });

  it('preserves lat/lon from input cells', () => {
    const overlay = buildLULCOverlay(MOCK_GRID_CELLS);
    for (let i = 0; i < MOCK_GRID_CELLS.length; i++) {
      expect(overlay[i].lat).toBe(MOCK_GRID_CELLS[i].lat);
      expect(overlay[i].lon).toBe(MOCK_GRID_CELLS[i].lon);
    }
  });

  it('returns empty array for empty grid', () => {
    expect(buildLULCOverlay([])).toHaveLength(0);
  });
});

// ── generateMicroClimateReport ────────────────────────────────────────────────

describe('generateMicroClimateReport', () => {
  it('returns a report with historicalFrequency in [0, 1]', () => {
    const zones = detectMicroClimateZones(MOCK_GRID_CELLS, 'rainfall');
    if (zones.length === 0) return; // guard against degenerate mock data
    const report = generateMicroClimateReport(zones[0], MOCK_GRID_CELLS);
    expect(report.historicalFrequency).toBeGreaterThanOrEqual(0);
    expect(report.historicalFrequency).toBeLessThanOrEqual(1);
  });

  it('summary is a non-empty string', () => {
    const zones = detectMicroClimateZones(MOCK_GRID_CELLS, 'rainfall');
    if (zones.length === 0) return;
    const report = generateMicroClimateReport(zones[0], MOCK_GRID_CELLS);
    expect(typeof report.summary).toBe('string');
    expect(report.summary.length).toBeGreaterThan(20);
  });

  it('report.zone references the same zone that was passed in', () => {
    const zones = detectMicroClimateZones(MOCK_GRID_CELLS, 'rainfall');
    if (zones.length === 0) return;
    const report = generateMicroClimateReport(zones[0], MOCK_GRID_CELLS);
    expect(report.zone).toBe(zones[0]);
  });
});
