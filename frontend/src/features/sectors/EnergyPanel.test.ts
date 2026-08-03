/**
 * Unit tests for EnergyPanel pure functions.
 *
 * Covers:
 *  - computeGHI (Req 55.1)
 *  - computeWindPowerDensity / extrapolateWindToHubHeight (Req 55.2)
 *  - computeSolarCapacityFactor / computeWindCapacityFactor (Req 55.3)
 *  - buildDailyGenerationCurve (Req 55.4)
 *  - Color helpers and label helpers
 */

import { describe, it, expect } from 'vitest';
import {
  computeGHI,
  extrapolateWindToHubHeight,
  computeWindPowerDensity,
  computeSolarCapacityFactor,
  computeWindCapacityFactor,
  computeEnergyCellResult,
  buildDailyGenerationCurve,
  solarCapacityColor,
  windCapacityColor,
  solarPotentialLabel,
  windPotentialLabel,
  estimateCloudCoverFraction,
  SOLAR_CONSTANT_W_M2,
  INDIA_MEAN_COS_ZENITH,
  AIR_DENSITY_KG_M3,
} from './EnergyPanel';
import type { GridCell } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat: 20, lon: 78, node_idx: 0,
    rainfall: 5, temp_max: 35, temp_min: 24,
    rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    ...overrides,
  };
}

// ── computeGHI ────────────────────────────────────────────────────────────────

describe('computeGHI', () => {
  it('returns maximum clear-sky GHI when cloud cover is 0', () => {
    const result = computeGHI(0);
    const expected = SOLAR_CONSTANT_W_M2 * INDIA_MEAN_COS_ZENITH;
    expect(result).toBeCloseTo(expected, 0);
  });

  it('returns near-zero GHI when cloud cover is 1 (overcast)', () => {
    // 1 − 0.75 × 1³ = 0.25 → still some diffuse radiation
    const result = computeGHI(1);
    const expected = 0.25 * SOLAR_CONSTANT_W_M2 * INDIA_MEAN_COS_ZENITH;
    expect(result).toBeCloseTo(expected, 0);
  });

  it('returns intermediate GHI for partial cloud cover', () => {
    const half = computeGHI(0.5);
    const clear = computeGHI(0);
    const overcast = computeGHI(1);
    expect(half).toBeGreaterThan(overcast);
    expect(half).toBeLessThan(clear);
  });

  it('clamps input cloud fraction below 0 to 0', () => {
    expect(computeGHI(-0.5)).toEqual(computeGHI(0));
  });

  it('clamps input cloud fraction above 1 to 1', () => {
    expect(computeGHI(1.5)).toEqual(computeGHI(1));
  });

  it('returns 0 for zenith angle cosine = 0 (sun at horizon)', () => {
    expect(computeGHI(0, 0)).toBe(0);
  });

  it('result is always between 0 and SOLAR_CONSTANT', () => {
    [-0.5, 0, 0.3, 0.7, 1, 1.5].forEach((n) => {
      const v = computeGHI(n);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SOLAR_CONSTANT_W_M2);
    });
  });
});

// ── extrapolateWindToHubHeight ────────────────────────────────────────────────

describe('extrapolateWindToHubHeight', () => {
  it('returns a higher speed at 80 m than at 10 m', () => {
    const hubSpeed = extrapolateWindToHubHeight(5);
    expect(hubSpeed).toBeGreaterThan(5);
  });

  it('matches the power-law formula V_hub = V_ref × (80/10)^(1/7)', () => {
    const expected = 5 * Math.pow(80 / 10, 1 / 7);
    expect(extrapolateWindToHubHeight(5)).toBeCloseTo(expected, 5);
  });

  it('returns 0 for negative wind speeds', () => {
    expect(extrapolateWindToHubHeight(-3)).toBe(0);
  });

  it('returns 0 when wind is 0', () => {
    expect(extrapolateWindToHubHeight(0)).toBe(0);
  });

  it('scales linearly with reference speed', () => {
    const ratio = extrapolateWindToHubHeight(10) / extrapolateWindToHubHeight(5);
    expect(ratio).toBeCloseTo(2, 5);
  });
});

// ── computeWindPowerDensity ───────────────────────────────────────────────────

describe('computeWindPowerDensity', () => {
  it('computes ½ρV³ correctly', () => {
    const expected = 0.5 * AIR_DENSITY_KG_M3 * 8 ** 3;
    expect(computeWindPowerDensity(8)).toBeCloseTo(expected, 3);
  });

  it('returns 0 for wind speed = 0', () => {
    expect(computeWindPowerDensity(0)).toBe(0);
  });

  it('returns 0 for negative wind speed', () => {
    expect(computeWindPowerDensity(-5)).toBe(0);
  });

  it('is proportional to V³', () => {
    // Doubling V should give 8× power density
    const p1 = computeWindPowerDensity(5);
    const p2 = computeWindPowerDensity(10);
    expect(p2 / p1).toBeCloseTo(8, 2);
  });
});

// ── computeSolarCapacityFactor ────────────────────────────────────────────────

describe('computeSolarCapacityFactor', () => {
  it('returns 0 for GHI = 0', () => {
    expect(computeSolarCapacityFactor(0)).toBe(0);
  });

  it('returns panelEfficiency (0.2) at STC (1000 W/m²)', () => {
    expect(computeSolarCapacityFactor(1000)).toBeCloseTo(0.2, 5);
  });

  it('clamps to 1 for very high GHI', () => {
    expect(computeSolarCapacityFactor(10000)).toBe(1);
  });

  it('result is always in [0, 1]', () => {
    [-100, 0, 300, 600, 1000, 2000].forEach((ghi) => {
      const cf = computeSolarCapacityFactor(ghi);
      expect(cf).toBeGreaterThanOrEqual(0);
      expect(cf).toBeLessThanOrEqual(1);
    });
  });

  it('is monotonically increasing with GHI up to clamp', () => {
    expect(computeSolarCapacityFactor(400)).toBeGreaterThan(computeSolarCapacityFactor(200));
  });
});

// ── computeWindCapacityFactor ─────────────────────────────────────────────────

describe('computeWindCapacityFactor', () => {
  it('returns 0 below cut-in speed (3 m/s)', () => {
    expect(computeWindCapacityFactor(0)).toBe(0);
    expect(computeWindCapacityFactor(2.9)).toBe(0);
  });

  it('returns 1 at rated speed (12 m/s)', () => {
    expect(computeWindCapacityFactor(12)).toBe(1);
  });

  it('returns 1 between rated and cut-out (12–25 m/s)', () => {
    expect(computeWindCapacityFactor(18)).toBe(1);
    expect(computeWindCapacityFactor(24)).toBe(1);
  });

  it('returns 0 above cut-out speed (25 m/s)', () => {
    expect(computeWindCapacityFactor(26)).toBe(0);
  });

  it('returns partial load value between 3 and 12 m/s', () => {
    const cf = computeWindCapacityFactor(7);
    expect(cf).toBeGreaterThan(0);
    expect(cf).toBeLessThan(1);
  });

  it('result is always in [0, 1]', () => {
    [0, 2, 3, 6, 10, 12, 15, 25, 30].forEach((v) => {
      const cf = computeWindCapacityFactor(v);
      expect(cf).toBeGreaterThanOrEqual(0);
      expect(cf).toBeLessThanOrEqual(1);
    });
  });

  it('is non-decreasing in the partial load region (3–12 m/s)', () => {
    const cf7  = computeWindCapacityFactor(7);
    const cf10 = computeWindCapacityFactor(10);
    expect(cf10).toBeGreaterThanOrEqual(cf7);
  });
});

// ── estimateCloudCoverFraction ────────────────────────────────────────────────

describe('estimateCloudCoverFraction', () => {
  it('returns high cloud fraction for heavy rainfall cell', () => {
    const cell = makeCell({ rainfall: 40, temp_max: 28 });
    expect(estimateCloudCoverFraction(cell)).toBeGreaterThan(0.7);
  });

  it('returns low cloud fraction for dry, hot cell', () => {
    const cell = makeCell({ rainfall: 0, temp_max: 42 });
    expect(estimateCloudCoverFraction(cell)).toBeLessThan(0.3);
  });

  it('result is always in [0, 1]', () => {
    [
      makeCell({ rainfall: 0, temp_max: 45 }),
      makeCell({ rainfall: 5, temp_max: 35 }),
      makeCell({ rainfall: 50, temp_max: 20 }),
    ].forEach((cell) => {
      const cf = estimateCloudCoverFraction(cell);
      expect(cf).toBeGreaterThanOrEqual(0);
      expect(cf).toBeLessThanOrEqual(1);
    });
  });
});

// ── computeEnergyCellResult ───────────────────────────────────────────────────

describe('computeEnergyCellResult', () => {
  it('returns a result with all expected fields', () => {
    const cell = makeCell();
    const result = computeEnergyCellResult(cell);
    expect(result).toHaveProperty('lat', 20);
    expect(result).toHaveProperty('lon', 78);
    expect(result).toHaveProperty('ghi');
    expect(result).toHaveProperty('windSpeedHub');
    expect(result).toHaveProperty('windPowerDensity');
    expect(result).toHaveProperty('solarCapacityFactor');
    expect(result).toHaveProperty('windCapacityFactor');
  });

  it('capacity factors are in [0, 1]', () => {
    const result = computeEnergyCellResult(makeCell());
    expect(result.solarCapacityFactor).toBeGreaterThanOrEqual(0);
    expect(result.solarCapacityFactor).toBeLessThanOrEqual(1);
    expect(result.windCapacityFactor).toBeGreaterThanOrEqual(0);
    expect(result.windCapacityFactor).toBeLessThanOrEqual(1);
  });

  it('GHI is in [0, SOLAR_CONSTANT]', () => {
    const result = computeEnergyCellResult(makeCell());
    expect(result.ghi).toBeGreaterThanOrEqual(0);
    expect(result.ghi).toBeLessThanOrEqual(SOLAR_CONSTANT_W_M2);
  });
});

// ── buildDailyGenerationCurve ─────────────────────────────────────────────────

describe('buildDailyGenerationCurve', () => {
  function makeGrid(rainfall: number, tempMax: number): GridCell[] {
    return Array.from({ length: 10 }, (_, i) =>
      makeCell({ lat: 18 + i * 0.25, lon: 75, rainfall, temp_max: tempMax }),
    );
  }

  it('returns exactly 7 points', () => {
    const grids = new Map<number, GridCell[]>();
    for (let d = 1; d <= 7; d++) grids.set(d, makeGrid(5, 35));
    const curve = buildDailyGenerationCurve(grids);
    expect(curve).toHaveLength(7);
  });

  it('day numbers are 1 through 7', () => {
    const grids = new Map<number, GridCell[]>();
    for (let d = 1; d <= 7; d++) grids.set(d, makeGrid(5, 35));
    const curve = buildDailyGenerationCurve(grids);
    curve.forEach((p, i) => expect(p.day).toBe(i + 1));
  });

  it('GWh values are non-negative', () => {
    const grids = new Map<number, GridCell[]>();
    for (let d = 1; d <= 7; d++) grids.set(d, makeGrid(10, 30));
    const curve = buildDailyGenerationCurve(grids);
    curve.forEach((p) => {
      expect(p.solarGWh).toBeGreaterThanOrEqual(0);
      expect(p.windGWh).toBeGreaterThanOrEqual(0);
    });
  });

  it('returns zero generation for missing grids', () => {
    const grids = new Map<number, GridCell[]>();
    // Only provide day 1
    grids.set(1, makeGrid(5, 35));
    const curve = buildDailyGenerationCurve(grids);
    // Days 2–7 should be zero
    curve.filter((p) => p.day > 1).forEach((p) => {
      expect(p.solarGWh).toBe(0);
      expect(p.windGWh).toBe(0);
    });
  });

  it('heavily overcast day produces less solar than clear day', () => {
    const grids = new Map<number, GridCell[]>();
    grids.set(1, makeGrid(50, 22)); // heavy rain, overcast
    grids.set(2, makeGrid(0, 42)); // dry, sunny
    const curve = buildDailyGenerationCurve(grids);
    expect(curve[1].solarGWh).toBeGreaterThan(curve[0].solarGWh);
  });
});

// ── Color helpers ─────────────────────────────────────────────────────────────

describe('solarCapacityColor', () => {
  it('returns an rgb() string', () => {
    expect(solarCapacityColor(0.5)).toMatch(/^rgb\(/);
  });
  it('does not throw for out-of-range values', () => {
    expect(() => solarCapacityColor(-1)).not.toThrow();
    expect(() => solarCapacityColor(2)).not.toThrow();
  });
});

describe('windCapacityColor', () => {
  it('returns an rgb() string', () => {
    expect(windCapacityColor(0.5)).toMatch(/^rgb\(/);
  });
  it('does not throw for out-of-range values', () => {
    expect(() => windCapacityColor(-1)).not.toThrow();
    expect(() => windCapacityColor(2)).not.toThrow();
  });
});

// ── Label helpers ─────────────────────────────────────────────────────────────

describe('solarPotentialLabel', () => {
  it('returns "Poor" for low GHI', () => {
    expect(solarPotentialLabel(100)).toBe('Poor');
  });
  it('returns "Outstanding" for very high GHI (≥800 W/m²)', () => {
    expect(solarPotentialLabel(900)).toBe('Outstanding');
  });

  it('returns "Excellent" for GHI in 600–799 W/m²', () => {
    expect(solarPotentialLabel(700)).toBe('Excellent');
  });
});

describe('windPotentialLabel', () => {
  it('returns "Poor" for low wind power density', () => {
    expect(windPotentialLabel(50)).toBe('Poor');
  });
  it('returns "Excellent" for high wind power density', () => {
    expect(windPotentialLabel(800)).toBe('Excellent');
  });
});
