/**
 * Unit tests for VegetationHealth pure functions.
 *
 * Covers:
 *  - ndviToColor palette correctness (Req 57.1)
 *  - temperatureStress clamping (Req 57.2)
 *  - computeVSI bounds and formula (Req 57.2)
 *  - classifyStress tier boundaries (Req 57.2)
 *  - generateCropStressAlerts threshold and sort (Req 57.3)
 *  - estimateNDVI proxy formula
 *  - computeVegetationCells integration
 */

import { describe, it, expect } from 'vitest';
import {
  ndviToColor,
  temperatureStress,
  computeVSI,
  classifyStress,
  ndviAnomaly,
  estimateNDVI,
  generateCropStressAlerts,
  computeVegetationCells,
  buildCropStressMessage,
  CROP_STRESS_ALERT_THRESHOLD,
  VSI_THRESHOLDS,
  type VegetationCell,
} from './VegetationHealth';
import type { GridCell } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeCell = (overrides: Partial<GridCell> = {}): GridCell => ({
  lat: 20.0,
  lon: 78.0,
  node_idx: 0,
  rainfall: 5,
  temp_max: 32,
  temp_min: 22,
  rainfall_uncertainty: 0.5,
  temp_max_uncertainty: 0.3,
  temp_min_uncertainty: 0.3,
  ...overrides,
});

// ── ndviToColor ───────────────────────────────────────────────────────────────

describe('ndviToColor', () => {
  it('returns a blue-ish color for negative NDVI (water)', () => {
    const color = ndviToColor(-0.5);
    expect(color).toMatch(/^rgb\(70,130,180\)$/);
  });

  it('returns tan for bare soil (0.05)', () => {
    const color = ndviToColor(0.05);
    expect(color).toMatch(/^rgb\(210,180,140\)$/);
  });

  it('returns green for healthy vegetation (0.55)', () => {
    const color = ndviToColor(0.55);
    expect(color).toContain('rgb(');
    // green channel should dominate
    const m = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
    expect(m).not.toBeNull();
    if (m) {
      expect(parseInt(m[2])).toBeGreaterThan(parseInt(m[1])); // green > red
    }
  });

  it('returns a dark green for dense canopy (> 0.6)', () => {
    const color = ndviToColor(0.75);
    expect(color).toBe('rgb(0,80,10)');
  });
});

// ── ndviAnomaly ───────────────────────────────────────────────────────────────

describe('ndviAnomaly', () => {
  it('returns 0 when stdNDVI is 0', () => {
    expect(ndviAnomaly(0.5, 0.5, 0)).toBe(0);
  });

  it('returns 1.0 for exactly +1 std deviation', () => {
    expect(ndviAnomaly(0.5, 0.4, 0.1)).toBeCloseTo(1.0);
  });

  it('returns negative for below-average NDVI', () => {
    expect(ndviAnomaly(0.3, 0.5, 0.1)).toBeLessThan(0);
  });
});

// ── temperatureStress ─────────────────────────────────────────────────────────

describe('temperatureStress', () => {
  it('returns 0 at and below 35°C', () => {
    expect(temperatureStress(30)).toBe(0);
    expect(temperatureStress(35)).toBe(0);
  });

  it('returns 1 at and above 45°C', () => {
    expect(temperatureStress(45)).toBe(1);
    expect(temperatureStress(50)).toBe(1);
  });

  it('returns 0.5 at 40°C', () => {
    expect(temperatureStress(40)).toBeCloseTo(0.5);
  });

  it('is strictly increasing between 35°C and 45°C', () => {
    for (let t = 35; t < 45; t++) {
      expect(temperatureStress(t + 1)).toBeGreaterThan(temperatureStress(t));
    }
  });
});

// ── computeVSI ────────────────────────────────────────────────────────────────

describe('computeVSI', () => {
  it('returns an integer in [0, 100]', () => {
    for (const { ndvi, mean, std, temp } of [
      { ndvi: 0.6, mean: 0.65, std: 0.1, temp: 32 },
      { ndvi: 0.1, mean: 0.5,  std: 0.1, temp: 42 },
      { ndvi: 0.0, mean: 0.4,  std: 0.0, temp: 25 },
    ]) {
      const vsi = computeVSI(ndvi, mean, std, temp);
      expect(vsi).toBeGreaterThanOrEqual(0);
      expect(vsi).toBeLessThanOrEqual(100);
      expect(Number.isInteger(vsi)).toBe(true);
    }
  });

  it('returns 0 when NDVI is exactly at the mean and temp is below 35°C', () => {
    const vsi = computeVSI(0.5, 0.5, 0.2, 30);
    expect(vsi).toBe(0);
  });

  it('increases as temperature rises beyond 35°C (all else equal)', () => {
    const v30 = computeVSI(0.5, 0.5, 0.1, 30);
    const v40 = computeVSI(0.5, 0.5, 0.1, 40);
    expect(v40).toBeGreaterThan(v30);
  });

  it('increases as NDVI departs further from the mean', () => {
    const vSmall = computeVSI(0.45, 0.5, 0.1, 30); // 0.5σ departure
    const vLarge = computeVSI(0.30, 0.5, 0.1, 30); // 2σ departure
    expect(vLarge).toBeGreaterThan(vSmall);
  });
});

// ── classifyStress ────────────────────────────────────────────────────────────

describe('classifyStress', () => {
  it('classifies VSI < moderate threshold as none', () => {
    expect(classifyStress(0)).toBe('none');
    expect(classifyStress(VSI_THRESHOLDS.moderate - 1)).toBe('none');
  });

  it('classifies VSI at moderate threshold as moderate', () => {
    expect(classifyStress(VSI_THRESHOLDS.moderate)).toBe('moderate');
  });

  it('classifies VSI at high threshold as high', () => {
    expect(classifyStress(VSI_THRESHOLDS.high)).toBe('high');
  });

  it('classifies VSI at critical threshold as critical', () => {
    expect(classifyStress(VSI_THRESHOLDS.critical)).toBe('critical');
    expect(classifyStress(100)).toBe('critical');
  });
});

// ── estimateNDVI ──────────────────────────────────────────────────────────────

describe('estimateNDVI', () => {
  it('returns a higher NDVI for high rainfall and low temp', () => {
    const wet  = estimateNDVI(makeCell({ rainfall: 20, temp_max: 25 }));
    const dry  = estimateNDVI(makeCell({ rainfall: 0,  temp_max: 45 }));
    expect(wet).toBeGreaterThan(dry);
  });

  it('is in [-0.1, 0.9]', () => {
    for (const { rainfall, temp_max } of [
      { rainfall: 0, temp_max: 50 },
      { rainfall: 30, temp_max: 20 },
      { rainfall: 5, temp_max: 35 },
    ]) {
      const ndvi = estimateNDVI(makeCell({ rainfall, temp_max }));
      expect(ndvi).toBeGreaterThanOrEqual(-0.1);
      expect(ndvi).toBeLessThanOrEqual(0.9);
    }
  });
});

// ── generateCropStressAlerts ──────────────────────────────────────────────────

describe('generateCropStressAlerts', () => {
  const makeVegCell = (vsi: number): VegetationCell => ({
    lat: 20, lon: 78, ndvi: 0.3, meanNDVI: 0.5, stdNDVI: 0.1, vsi,
    stressLevel: classifyStress(vsi),
    ndviColor: '#00f',
  });

  it('includes only cells with VSI > CROP_STRESS_ALERT_THRESHOLD', () => {
    const cells = [
      makeVegCell(50),
      makeVegCell(71),
      makeVegCell(90),
    ];
    const alerts = generateCropStressAlerts(cells);
    expect(alerts.length).toBe(2);
    alerts.forEach((a) => expect(a.vsi).toBeGreaterThan(CROP_STRESS_ALERT_THRESHOLD));
  });

  it('is sorted descending by VSI', () => {
    const cells = [makeVegCell(72), makeVegCell(95), makeVegCell(80)];
    const alerts = generateCropStressAlerts(cells);
    expect(alerts[0].vsi).toBe(95);
    expect(alerts[1].vsi).toBe(80);
    expect(alerts[2].vsi).toBe(72);
  });

  it('returns empty array when no cells exceed the threshold', () => {
    const cells = [makeVegCell(20), makeVegCell(65)];
    expect(generateCropStressAlerts(cells)).toHaveLength(0);
  });
});

// ── buildCropStressMessage ────────────────────────────────────────────────────

describe('buildCropStressMessage', () => {
  it('includes the VSI value in the message', () => {
    const msg = buildCropStressMessage(85, 'critical');
    expect(msg).toContain('85');
  });

  it('mentions critical severity for critical stress', () => {
    expect(buildCropStressMessage(90, 'critical').toLowerCase()).toContain('critical');
  });
});

// ── computeVegetationCells integration ───────────────────────────────────────

describe('computeVegetationCells', () => {
  it('returns one VegetationCell per GridCell', () => {
    const cells = [makeCell(), makeCell({ lat: 21 }), makeCell({ lat: 22 })];
    const result = computeVegetationCells(cells);
    expect(result).toHaveLength(3);
  });

  it('each cell has a VSI in [0, 100]', () => {
    const cells = Array.from({ length: 10 }, (_, i) => makeCell({ lat: 20 + i * 0.25 }));
    const result = computeVegetationCells(cells);
    result.forEach((c) => {
      expect(c.vsi).toBeGreaterThanOrEqual(0);
      expect(c.vsi).toBeLessThanOrEqual(100);
    });
  });

  it('respects ndviOverrides when supplied', () => {
    const cell = makeCell({ lat: 20.00, lon: 78.00 });
    const overrides = new Map([['20.00,78.00', 0.8]]);
    const [result] = computeVegetationCells([cell], new Map(), overrides);
    expect(result.ndvi).toBeCloseTo(0.8);
  });

  it('uses estimateNDVI when no override is provided', () => {
    const cell = makeCell({ rainfall: 0, temp_max: 50 });
    const [result] = computeVegetationCells([cell]);
    expect(result.ndvi).toBeLessThan(0.2); // low rainfall + high temp → low NDVI
  });
});
