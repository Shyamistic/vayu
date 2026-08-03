/**
 * Unit tests for OrographicAnalysis pure functions.
 *
 * Validates: Requirements 34.1, 34.2, 34.3, 34.4
 */

import { describe, it, expect } from 'vitest';
import {
  buildElevatedCells,
  classifyElevationBand,
  computeLinearRegression,
  computeOEF,
  getPeakLabels,
  lookupElevation,
  ELEVATION_BANDS,
  ELEVATION_CONTOUR_LEVELS,
  MAJOR_PEAKS,
  MOCK_ELEVATED_CELLS,
  WG_LAT_MIN,
  WG_LAT_MAX,
  WG_WINDWARD_LON_MIN,
  WG_WINDWARD_LON_MAX,
  WG_LEEWARD_LON_MIN,
  WG_LEEWARD_LON_MAX,
  type ElevatedCell,
} from './OrographicAnalysis';
import type { GridCell } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat: 15.0,
    lon: 74.0,
    node_idx: 0,
    rainfall: 20,
    temp_max: 30,
    temp_min: 22,
    rainfall_uncertainty: 2,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 1,
    ...overrides,
  };
}

function makeElevated(elev: number, rain: number, lat = 15, lon = 74): ElevatedCell {
  return { lat, lon, elevationM: elev, rainfall: rain };
}

// ── Elevation Contour Level Constants ────────────────────────────────────────

describe('ELEVATION_CONTOUR_LEVELS — Requirement 34.1', () => {
  it('contains exactly the five required levels', () => {
    expect(ELEVATION_CONTOUR_LEVELS).toEqual([200, 500, 1000, 1500, 2000]);
  });

  it('levels are in ascending order', () => {
    for (let i = 1; i < ELEVATION_CONTOUR_LEVELS.length; i++) {
      expect(ELEVATION_CONTOUR_LEVELS[i]).toBeGreaterThan(ELEVATION_CONTOUR_LEVELS[i - 1]);
    }
  });
});

// ── lookupElevation ───────────────────────────────────────────────────────────

describe('lookupElevation', () => {
  it('returns a positive elevation for any Indian lat/lon', () => {
    const indiaPoints = [
      [8, 77], [15, 74], [20, 82], [28, 77], [32, 77],
    ];
    for (const [lat, lon] of indiaPoints) {
      expect(lookupElevation(lat, lon)).toBeGreaterThan(0);
    }
  });

  it('returns higher values for Western Ghats crest than eastern rain shadow', () => {
    const crest     = lookupElevation(14.5, 74.25); // near crest
    const rainshadow = lookupElevation(14.0, 77.25); // rain shadow
    expect(crest).toBeGreaterThan(rainshadow);
  });

  it('returns high values for Himalayan cells', () => {
    expect(lookupElevation(30.0, 79.0)).toBeGreaterThanOrEqual(500);
  });
});

// ── buildElevatedCells ────────────────────────────────────────────────────────

describe('buildElevatedCells — Requirement 34.1', () => {
  it('returns one ElevatedCell per GridCell', () => {
    const cells = [makeCell(), makeCell({ lat: 16 }), makeCell({ lat: 17 })];
    const result = buildElevatedCells(cells);
    expect(result).toHaveLength(3);
  });

  it('preserves lat, lon, rainfall from source cell', () => {
    const src = makeCell({ lat: 12, lon: 75, rainfall: 42 });
    const [el] = buildElevatedCells([src]);
    expect(el.lat).toBe(12);
    expect(el.lon).toBe(75);
    expect(el.rainfall).toBe(42);
  });

  it('attaches a positive elevationM to each cell', () => {
    const cells = [makeCell({ lat: 10, lon: 76 }), makeCell({ lat: 20, lon: 74 })];
    const result = buildElevatedCells(cells);
    for (const c of result) {
      expect(c.elevationM).toBeGreaterThan(0);
    }
  });

  it('returns empty array for empty input', () => {
    expect(buildElevatedCells([])).toEqual([]);
  });
});

// ── classifyElevationBand ─────────────────────────────────────────────────────

describe('classifyElevationBand — Requirement 34.1', () => {
  it('classifies 0m as first band (0–200m)', () => {
    const band = classifyElevationBand(0);
    expect(band.minM).toBe(0);
    expect(band.maxM).toBe(200);
  });

  it('classifies 200m into the 200–500m band', () => {
    const band = classifyElevationBand(200);
    expect(band.minM).toBe(200);
    expect(band.maxM).toBe(500);
  });

  it('classifies 1500m into the 1500–2000m band', () => {
    const band = classifyElevationBand(1500);
    expect(band.minM).toBe(1500);
    expect(band.maxM).toBe(2000);
  });

  it('classifies 2500m into the >2000m band', () => {
    const band = classifyElevationBand(2500);
    expect(band.minM).toBe(2000);
    expect(band.maxM).toBe(Infinity);
  });

  it('every band has a non-empty label and colour', () => {
    for (const band of ELEVATION_BANDS) {
      expect(band.label.length).toBeGreaterThan(0);
      expect(band.color.length).toBeGreaterThan(0);
    }
  });
});

// ── computeLinearRegression ───────────────────────────────────────────────────

describe('computeLinearRegression — Requirement 34.2', () => {
  it('returns null for fewer than 2 cells', () => {
    expect(computeLinearRegression([])).toBeNull();
    expect(computeLinearRegression([makeElevated(100, 10)])).toBeNull();
  });

  it('computes correct slope and intercept for a perfect linear relationship', () => {
    // y = 0.02x + 5  (slope = 0.02, intercept = 5)
    const cells: ElevatedCell[] = [
      makeElevated(0,    5),
      makeElevated(500,  15),
      makeElevated(1000, 25),
      makeElevated(1500, 35),
      makeElevated(2000, 45),
    ];
    const reg = computeLinearRegression(cells);
    expect(reg).not.toBeNull();
    expect(reg!.slope).toBeCloseTo(0.02, 5);
    expect(reg!.intercept).toBeCloseTo(5, 5);
    expect(reg!.r2).toBeCloseTo(1, 4);
    expect(reg!.r).toBeCloseTo(1, 4);
  });

  it('r² is in [0, 1] for any valid input', () => {
    const cells: ElevatedCell[] = [
      makeElevated(100, 30),
      makeElevated(500, 20),
      makeElevated(1200, 50),
      makeElevated(200, 10),
      makeElevated(800, 35),
    ];
    const reg = computeLinearRegression(cells);
    expect(reg!.r2).toBeGreaterThanOrEqual(0);
    expect(reg!.r2).toBeLessThanOrEqual(1);
  });

  it('returns n equal to the number of input cells', () => {
    const cells = [makeElevated(200, 20), makeElevated(600, 35), makeElevated(1200, 55)];
    expect(computeLinearRegression(cells)!.n).toBe(3);
  });

  it('handles cells all at same elevation (zero slope)', () => {
    const cells = [
      makeElevated(500, 10),
      makeElevated(500, 20),
      makeElevated(500, 30),
    ];
    const reg = computeLinearRegression(cells);
    expect(reg!.slope).toBe(0);
    expect(reg!.r2).toBe(0);
  });
});

// ── computeOEF ────────────────────────────────────────────────────────────────

describe('computeOEF — Requirement 34.4', () => {
  it('returns null when no cells lie within the Western Ghats transect', () => {
    // Cells far outside the transect bounds
    const cells: ElevatedCell[] = [
      makeElevated(100, 30, 25, 85),  // north India
      makeElevated(200, 20, 22, 80),
    ];
    expect(computeOEF(cells)).toBeNull();
  });

  it('returns null when only windward cells are present', () => {
    const windward: ElevatedCell[] = [
      makeElevated(900, 50, 14, 74.0),
      makeElevated(1200, 60, 15, 74.5),
    ];
    expect(computeOEF(windward)).toBeNull();
  });

  it('returns null when only leeward cells are present', () => {
    const leeward: ElevatedCell[] = [
      makeElevated(200, 10, 14, 77.0),
      makeElevated(100, 8,  15, 77.5),
    ];
    expect(computeOEF(leeward)).toBeNull();
  });

  it('OEF > 1 when windward rainfall exceeds leeward rainfall', () => {
    const cells: ElevatedCell[] = [
      // windward (73–75°E)
      makeElevated(1000, 60, 14, 74.0),
      makeElevated(1200, 70, 14, 74.5),
      // leeward (76–78°E)
      makeElevated(300, 15, 14, 76.5),
      makeElevated(200, 12, 14, 77.0),
    ];
    const result = computeOEF(cells);
    expect(result).not.toBeNull();
    expect(result!.oef).toBeGreaterThan(1);
  });

  it('OEF === 1 when both sides have equal rainfall', () => {
    const cells: ElevatedCell[] = [
      makeElevated(800, 30, 14, 74.0),
      makeElevated(800, 30, 14, 77.0),
    ];
    const result = computeOEF(cells);
    expect(result!.oef).toBeCloseTo(1, 4);
  });

  it('OEF is Infinity when leeward rainfall is 0', () => {
    const cells: ElevatedCell[] = [
      makeElevated(1000, 50, 14, 74.5),
      makeElevated(200, 0,  14, 77.0),
    ];
    const result = computeOEF(cells);
    expect(result!.oef).toBe(Infinity);
  });

  it('reports correct windward and leeward cell counts', () => {
    const cells: ElevatedCell[] = [
      makeElevated(900, 40, 12, 73.5),
      makeElevated(1000, 50, 14, 74.0),
      makeElevated(1200, 60, 16, 74.5),
      makeElevated(300, 12, 12, 76.5),
      makeElevated(200, 10, 14, 77.0),
    ];
    const result = computeOEF(cells);
    expect(result!.windwardCells).toBe(3);
    expect(result!.leewardCells).toBe(2);
  });

  it('computes OEF correctly with mock data', () => {
    const result = computeOEF(MOCK_ELEVATED_CELLS);
    expect(result).not.toBeNull();
    // Windward side should be rainier than leeward
    expect(result!.windwardMeanMm).toBeGreaterThan(result!.leewardMeanMm);
    expect(result!.oef).toBeGreaterThan(1);
  });

  it('uses correct transect bounds', () => {
    // Verify the constants are used correctly
    expect(WG_LAT_MIN).toBe(8);
    expect(WG_LAT_MAX).toBe(21);
    expect(WG_WINDWARD_LON_MIN).toBe(73.0);
    expect(WG_WINDWARD_LON_MAX).toBe(75.0);
    expect(WG_LEEWARD_LON_MIN).toBe(76.0);
    expect(WG_LEEWARD_LON_MAX).toBe(78.0);
  });
});

// ── getPeakLabels ─────────────────────────────────────────────────────────────

describe('getPeakLabels — Requirement 34.3', () => {
  it('returns empty array when exaggeration is exactly 2', () => {
    expect(getPeakLabels(2)).toHaveLength(0);
  });

  it('returns empty array when exaggeration < 2', () => {
    expect(getPeakLabels(1)).toHaveLength(0);
    expect(getPeakLabels(1.5)).toHaveLength(0);
  });

  it('returns peaks when exaggeration > 2', () => {
    const peaks = getPeakLabels(2.5);
    expect(peaks.length).toBeGreaterThan(0);
  });

  it('returns all MAJOR_PEAKS when exaggeration > 2', () => {
    const peaks = getPeakLabels(3);
    expect(peaks).toHaveLength(MAJOR_PEAKS.length);
  });

  it('returns peaks at exaggeration = 5 (maximum)', () => {
    const peaks = getPeakLabels(5);
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks.every((p) => p.elevationM > 0)).toBe(true);
  });

  it('each peak has valid lat, lon, and elevationM > 0', () => {
    for (const peak of MAJOR_PEAKS) {
      expect(peak.lat).toBeGreaterThan(0);
      expect(peak.lon).toBeGreaterThan(0);
      expect(peak.elevationM).toBeGreaterThan(0);
      expect(peak.name.length).toBeGreaterThan(0);
    }
  });
});

// ── Integration: mock data produces valid analysis ────────────────────────────

describe('MOCK_ELEVATED_CELLS integration', () => {
  it('regression on mock data has positive slope (more rain at higher elevation)', () => {
    const reg = computeLinearRegression(MOCK_ELEVATED_CELLS);
    expect(reg).not.toBeNull();
    expect(reg!.slope).toBeGreaterThan(0);
  });

  it('OEF on mock data is a finite positive number', () => {
    const oef = computeOEF(MOCK_ELEVATED_CELLS);
    expect(oef).not.toBeNull();
    expect(oef!.oef).toBeGreaterThan(0);
    expect(isFinite(oef!.oef)).toBe(true);
  });

  it('mock data covers a range of elevation bands', () => {
    const bands = new Set(MOCK_ELEVATED_CELLS.map((c) => classifyElevationBand(c.elevationM).label));
    expect(bands.size).toBeGreaterThanOrEqual(3);
  });
});
