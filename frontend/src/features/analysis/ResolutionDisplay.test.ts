/**
 * ResolutionDisplay — Unit Tests
 *
 * Tests for downscaling utilities and resolution display logic.
 * Validates: Requirements 84.1, 84.2, 84.3, 84.4
 */

import { describe, it, expect } from 'vitest';
import {
  bilinearInterpolate,
  downscaleGrid,
  applyOrographicCorrection,
  estimateSyntheticElevation,
  MODEL_RESOLUTION_COMPARISON,
  MAUSAM_DOWNSCALED,
  NATIVE_RESOLUTION_KM,
  DOWNSCALED_RESOLUTION_KM,
  NATIVE_RESOLUTION_DEG,
  DOWNSCALED_RESOLUTION_DEG,
  DOWNSCALE_FACTOR,
} from '../../core/utils/downscaling';
import type { GridCell } from '../../types';

// ── Test Fixtures ─────────────────────────────────────────────────────────────

/** Build a minimal GridCell for testing */
function makeCell(lat: number, lon: number, overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat,
    lon,
    node_idx: 0,
    rainfall: 10,
    temp_max: 30,
    temp_min: 20,
    rainfall_uncertainty: 1,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 1,
    ...overrides,
  };
}

/** Create a simple 2×2 coarse grid */
function make2x2Grid(): GridCell[] {
  return [
    makeCell(15.0, 75.0, { rainfall: 10, temp_max: 30, temp_min: 20 }),
    makeCell(15.0, 75.25, { rainfall: 20, temp_max: 32, temp_min: 22 }),
    makeCell(15.25, 75.0, { rainfall: 30, temp_max: 34, temp_min: 24 }),
    makeCell(15.25, 75.25, { rainfall: 40, temp_max: 36, temp_min: 26 }),
  ];
}

// ── Constants Tests ───────────────────────────────────────────────────────────

describe('Resolution Constants (Req 84.1)', () => {
  it('native resolution is 0.25 degrees', () => {
    expect(NATIVE_RESOLUTION_DEG).toBe(0.25);
  });

  it('downscaled resolution is 0.05 degrees', () => {
    expect(DOWNSCALED_RESOLUTION_DEG).toBe(0.05);
  });

  it('native resolution is approximately 28 km', () => {
    expect(NATIVE_RESOLUTION_KM).toBe(28);
  });

  it('downscaled resolution is approximately 6 km', () => {
    expect(DOWNSCALED_RESOLUTION_KM).toBe(6);
  });

  it('downscale factor is 5 (0.25 / 0.05)', () => {
    expect(DOWNSCALE_FACTOR).toBe(5);
  });
});

// ── Model Resolution Comparison Tests ────────────────────────────────────────

describe('Model Resolution Comparison (Req 84.4)', () => {
  it('contains at least 5 model entries', () => {
    expect(MODEL_RESOLUTION_COMPARISON.length).toBeGreaterThanOrEqual(5);
  });

  it('MAUSAM is marked as current model', () => {
    const mausam = MODEL_RESOLUTION_COMPARISON.find((m) => m.isCurrentModel);
    expect(mausam).toBeDefined();
    expect(mausam?.resolutionKm).toBe(28);
  });

  it('includes DestinE with 5km resolution', () => {
    const destine = MODEL_RESOLUTION_COMPARISON.find((m) =>
      m.name.toLowerCase().includes('destine') || m.label === 'DestinE'
    );
    expect(destine).toBeDefined();
    expect(destine?.resolutionKm).toBe(5);
  });

  it('includes ECMWF with better resolution than MAUSAM', () => {
    const ecmwf = MODEL_RESOLUTION_COMPARISON.find((m) =>
      m.label === 'ECMWF' || m.name.toLowerCase().includes('ecmwf')
    );
    const mausam = MODEL_RESOLUTION_COMPARISON.find((m) => m.isCurrentModel);
    expect(ecmwf).toBeDefined();
    expect(mausam).toBeDefined();
    expect(ecmwf!.resolutionKm).toBeLessThan(mausam!.resolutionKm);
  });

  it('every model has a unique color', () => {
    const colors = MODEL_RESOLUTION_COMPARISON.map((m) => m.color);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(colors.length);
  });

  it('all resolution values are positive', () => {
    for (const model of MODEL_RESOLUTION_COMPARISON) {
      expect(model.resolutionKm).toBeGreaterThan(0);
      expect(model.resolutionDeg).toBeGreaterThan(0);
    }
  });

  it('downscaled MAUSAM has 6km resolution', () => {
    expect(MAUSAM_DOWNSCALED.resolutionKm).toBe(DOWNSCALED_RESOLUTION_KM);
    expect(MAUSAM_DOWNSCALED.resolutionDeg).toBe(DOWNSCALED_RESOLUTION_DEG);
  });
});

// ── Bilinear Interpolation Tests ──────────────────────────────────────────────

describe('bilinearInterpolate', () => {
  const cells = make2x2Grid();

  it('returns the value at the SW corner exactly', () => {
    const result = bilinearInterpolate(15.0, 75.0, cells, 'rainfall');
    expect(result).toBeCloseTo(10, 1);
  });

  it('returns the value at the NE corner exactly', () => {
    const result = bilinearInterpolate(15.25, 75.25, cells, 'rainfall');
    expect(result).toBeCloseTo(40, 1);
  });

  it('interpolates the center correctly (average of all 4 corners)', () => {
    // Center of the 2×2 grid at equal weights → average of all 4
    const result = bilinearInterpolate(15.125, 75.125, cells, 'rainfall');
    const expected = (10 + 20 + 30 + 40) / 4; // 25
    expect(result).toBeCloseTo(expected, 1);
  });

  it('interpolates the midpoint of the western edge', () => {
    // Mid of west edge: average of SW (10) and NW (30)
    const result = bilinearInterpolate(15.125, 75.0, cells, 'rainfall');
    expect(result).toBeCloseTo(20, 1);
  });

  it('interpolated value is non-negative for rainfall', () => {
    const result = bilinearInterpolate(15.1, 75.1, cells, 'rainfall');
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('returns null for a point with no surrounding cells', () => {
    const result = bilinearInterpolate(0, 0, cells, 'rainfall');
    expect(result).toBeNull();
  });

  it('works for temperature variables', () => {
    const result = bilinearInterpolate(15.125, 75.125, cells, 'temp_max');
    const expected = (30 + 32 + 34 + 36) / 4; // 33
    expect(result).toBeCloseTo(expected, 1);
  });
});

// ── Orographic Correction Tests ───────────────────────────────────────────────

describe('applyOrographicCorrection', () => {
  it('reduces temperature for higher elevation (lapse rate)', () => {
    // 1000m elevation gain → -6.5°C
    const corrected = applyOrographicCorrection(30, 'temp_max', 1000, 0);
    expect(corrected).toBeCloseTo(30 - 6.5, 1);
  });

  it('increases temperature for lower elevation', () => {
    const corrected = applyOrographicCorrection(25, 'temp_min', 0, 1000);
    expect(corrected).toBeCloseTo(25 + 6.5, 1);
  });

  it('increases rainfall for higher elevation (orographic enhancement)', () => {
    // 500m gain should enhance rainfall
    const corrected = applyOrographicCorrection(10, 'rainfall', 500, 0);
    expect(corrected).toBeGreaterThan(10);
  });

  it('decreases rainfall for lower elevation (rain shadow)', () => {
    const corrected = applyOrographicCorrection(10, 'rainfall', 0, 500);
    expect(corrected).toBeLessThan(10);
    expect(corrected).toBeGreaterThanOrEqual(0); // Non-negative
  });

  it('no change when elevation delta is zero', () => {
    expect(applyOrographicCorrection(30, 'temp_max', 500, 500)).toBeCloseTo(30, 2);
    expect(applyOrographicCorrection(15, 'rainfall', 200, 200)).toBeCloseTo(15, 2);
  });

  it('rainfall correction never goes negative', () => {
    // Extreme rain shadow scenario
    const corrected = applyOrographicCorrection(0.5, 'rainfall', 0, 10000);
    expect(corrected).toBeGreaterThanOrEqual(0);
  });
});

// ── Synthetic Elevation Tests ─────────────────────────────────────────────────

describe('estimateSyntheticElevation', () => {
  it('returns non-negative elevation', () => {
    const testPoints = [
      [20, 75], // Deccan region
      [30, 77], // Near Himalayas
      [14, 74], // Western Ghats
      [10, 80], // South India plains
    ];
    for (const [lat, lon] of testPoints) {
      const elev = estimateSyntheticElevation(lat, lon);
      expect(elev).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns higher elevation near Himalayas than plains', () => {
    const himalayas = estimateSyntheticElevation(33, 77);
    const plains = estimateSyntheticElevation(26, 82);
    expect(himalayas).toBeGreaterThan(plains);
  });

  it('returns notable elevation in Western Ghats', () => {
    const ghats = estimateSyntheticElevation(14, 74.5);
    expect(ghats).toBeGreaterThan(300);
  });
});

// ── Downscale Grid Tests ──────────────────────────────────────────────────────

describe('downscaleGrid (Req 84.2)', () => {
  it('returns empty array for empty input', () => {
    expect(downscaleGrid([])).toHaveLength(0);
  });

  it('produces exactly DOWNSCALE_FACTOR² cells per coarse cell', () => {
    const singleCell = [makeCell(15.0, 75.0)];
    const result = downscaleGrid(singleCell);
    expect(result).toHaveLength(DOWNSCALE_FACTOR * DOWNSCALE_FACTOR);
  });

  it('all fine cells are within the coarse cell footprint', () => {
    const coarseLat = 15.0;
    const coarseLon = 75.0;
    const halfCoarse = NATIVE_RESOLUTION_DEG / 2;
    const cells = [makeCell(coarseLat, coarseLon)];
    const result = downscaleGrid(cells);

    for (const fine of result) {
      expect(fine.lat).toBeGreaterThanOrEqual(coarseLat - halfCoarse - 0.001);
      expect(fine.lat).toBeLessThanOrEqual(coarseLat + halfCoarse + 0.001);
      expect(fine.lon).toBeGreaterThanOrEqual(coarseLon - halfCoarse - 0.001);
      expect(fine.lon).toBeLessThanOrEqual(coarseLon + halfCoarse + 0.001);
    }
  });

  it('all fine cells have non-negative rainfall', () => {
    const coarseCells = make2x2Grid();
    const result = downscaleGrid(coarseCells);
    for (const cell of result) {
      expect(cell.rainfall).toBeGreaterThanOrEqual(0);
    }
  });

  it('fine-grid cells reference the correct source coarse cell', () => {
    const lat = 15.0;
    const lon = 75.0;
    const cells = [makeCell(lat, lon)];
    const result = downscaleGrid(cells);
    for (const fine of result) {
      expect(fine.sourceCell.lat).toBe(lat);
      expect(fine.sourceCell.lon).toBe(lon);
    }
  });

  it('returns 4× more cells for a 2×2 coarse grid', () => {
    const coarseCells = make2x2Grid();
    const result = downscaleGrid(coarseCells);
    // Each of 4 coarse cells → 25 fine cells
    expect(result).toHaveLength(4 * DOWNSCALE_FACTOR * DOWNSCALE_FACTOR);
  });

  it('elevation correction is applied in the Western Ghats area', () => {
    const cell = makeCell(14.0, 74.5, { rainfall: 20, temp_max: 28 });
    const result = downscaleGrid([cell], true);
    const correctedCount = result.filter((c) => c.elevationCorrected).length;
    // The Western Ghats region should trigger some elevation corrections
    expect(correctedCount).toBeGreaterThan(0);
  });

  it('no elevation correction when applyElevation=false', () => {
    const cells = make2x2Grid();
    const result = downscaleGrid(cells, false);
    const corrected = result.filter((c) => c.elevationCorrected);
    expect(corrected).toHaveLength(0);
  });

  it('mean of fine cells is close to original coarse cell value', () => {
    // For a uniform field, downscaling should approximately preserve the mean
    const cells = [makeCell(15.0, 75.0, { rainfall: 20, temp_max: 30, temp_min: 18 })];
    const result = downscaleGrid(cells, false);
    const meanRainfall = result.reduce((s, c) => s + c.rainfall, 0) / result.length;
    // Without elevation correction and for interior cells, mean should be ~20
    expect(meanRainfall).toBeCloseTo(20, 0);
  });

  it('fine cells have the correct spatial resolution (0.05° spacing)', () => {
    const cells = [makeCell(15.0, 75.0)];
    const result = downscaleGrid(cells);
    // Get unique lats and lons
    const lats = [...new Set(result.map((c) => +c.lat.toFixed(4)))].sort((a, b) => a - b);
    const lons = [...new Set(result.map((c) => +c.lon.toFixed(4)))].sort((a, b) => a - b);
    expect(lats).toHaveLength(DOWNSCALE_FACTOR);
    expect(lons).toHaveLength(DOWNSCALE_FACTOR);
    // Check spacing
    for (let i = 1; i < lats.length; i++) {
      expect(lats[i] - lats[i - 1]).toBeCloseTo(DOWNSCALED_RESOLUTION_DEG, 4);
    }
    for (let i = 1; i < lons.length; i++) {
      expect(lons[i] - lons[i - 1]).toBeCloseTo(DOWNSCALED_RESOLUTION_DEG, 4);
    }
  });
});
