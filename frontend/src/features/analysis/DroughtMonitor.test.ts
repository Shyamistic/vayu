/**
 * Unit tests for DroughtMonitor pure functions.
 *
 * Tests classifyDrought, computeSPI, computeSPIForGrid,
 * generateDroughtAdvisories, and buildSparklines.
 * Validates: Requirements 21.1, 21.2, 21.3, 21.4
 */

import { describe, it, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  classifyDrought,
  computeSPI,
  accumulateRainfall,
  computeSPIForGrid,
  generateDroughtAdvisories,
  buildSparklines,
  regularizedGammaP,
  normalQuantile,
  type DroughtCategory,
  type SPITimescale,
} from './DroughtMonitor';
import type { GridCell } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat: 20.0,
    lon: 75.0,
    node_idx: 0,
    rainfall: 10,
    temp_max: 35,
    temp_min: 25,
    rainfall_uncertainty: 2,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 1,
    ...overrides,
  };
}

// ── classifyDrought tests ────────────────────────────────────────────────────

describe('classifyDrought', () => {
  it('classifies extreme drought for SPI < -2.0', () => {
    expect(classifyDrought(-2.5)).toBe('extreme_drought');
    expect(classifyDrought(-3.0)).toBe('extreme_drought');
    expect(classifyDrought(-2.01)).toBe('extreme_drought');
  });

  it('classifies severe drought for -2.0 ≤ SPI < -1.5', () => {
    expect(classifyDrought(-2.0)).toBe('severe_drought');
    expect(classifyDrought(-1.8)).toBe('severe_drought');
    expect(classifyDrought(-1.51)).toBe('severe_drought');
  });

  it('classifies moderate drought for -1.5 ≤ SPI < -1.0', () => {
    expect(classifyDrought(-1.5)).toBe('moderate_drought');
    expect(classifyDrought(-1.2)).toBe('moderate_drought');
    expect(classifyDrought(-1.01)).toBe('moderate_drought');
  });

  it('classifies near normal for -1.0 ≤ SPI ≤ 1.0', () => {
    expect(classifyDrought(-1.0)).toBe('near_normal');
    expect(classifyDrought(0)).toBe('near_normal');
    expect(classifyDrought(1.0)).toBe('near_normal');
  });

  it('classifies moderately wet for 1.0 < SPI ≤ 1.5', () => {
    expect(classifyDrought(1.01)).toBe('moderately_wet');
    expect(classifyDrought(1.3)).toBe('moderately_wet');
    expect(classifyDrought(1.5)).toBe('moderately_wet');
  });

  it('classifies severely wet for 1.5 < SPI ≤ 2.0', () => {
    expect(classifyDrought(1.51)).toBe('severely_wet');
    expect(classifyDrought(1.8)).toBe('severely_wet');
    expect(classifyDrought(2.0)).toBe('severely_wet');
  });

  it('classifies extremely wet for SPI > 2.0', () => {
    expect(classifyDrought(2.01)).toBe('extremely_wet');
    expect(classifyDrought(3.0)).toBe('extremely_wet');
  });

  it('handles exact boundary values correctly', () => {
    expect(classifyDrought(-2.0)).toBe('severe_drought');
    expect(classifyDrought(-1.5)).toBe('moderate_drought');
    expect(classifyDrought(-1.0)).toBe('near_normal');
    expect(classifyDrought(1.0)).toBe('near_normal');
    expect(classifyDrought(1.5)).toBe('moderately_wet');
    expect(classifyDrought(2.0)).toBe('severely_wet');
  });
});

// ── normalQuantile tests ─────────────────────────────────────────────────────

describe('normalQuantile', () => {
  it('returns 0 for p = 0.5 (median)', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 4);
  });

  it('returns positive value for p > 0.5', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.96, 1);
  });

  it('returns negative value for p < 0.5', () => {
    expect(normalQuantile(0.025)).toBeCloseTo(-1.96, 1);
  });

  it('is symmetric: normalQuantile(p) = -normalQuantile(1-p)', () => {
    const p = 0.1;
    expect(normalQuantile(p)).toBeCloseTo(-normalQuantile(1 - p), 5);
  });

  it('returns extreme values for p near 0 or 1', () => {
    expect(normalQuantile(0)).toBe(-8);
    expect(normalQuantile(1)).toBe(8);
  });
});

// ── regularizedGammaP tests ──────────────────────────────────────────────────

describe('regularizedGammaP', () => {
  it('returns 0 for x = 0', () => {
    expect(regularizedGammaP(2, 0)).toBe(0);
  });

  it('returns value between 0 and 1 for valid inputs', () => {
    const result = regularizedGammaP(2, 3);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('approaches 1 for large x', () => {
    expect(regularizedGammaP(2, 100)).toBeCloseTo(1, 3);
  });

  it('is monotonically increasing in x', () => {
    const a = 2;
    const vals = [1, 2, 3, 4, 5].map((x) => regularizedGammaP(a, x));
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
  });
});

// ── accumulateRainfall tests ─────────────────────────────────────────────────

describe('accumulateRainfall', () => {
  it('returns empty array when series is shorter than timescale', () => {
    expect(accumulateRainfall([10, 20], 3)).toHaveLength(0);
  });

  it('computes correct 1-month accumulation (identity)', () => {
    const series = [10, 20, 30, 40];
    const result = accumulateRainfall(series, 1);
    expect(result).toEqual([10, 20, 30, 40]);
  });

  it('computes correct 3-month rolling sums', () => {
    const series = [10, 20, 30, 40, 50];
    const result = accumulateRainfall(series, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(60);  // 10+20+30
    expect(result[1]).toBe(90);  // 20+30+40
    expect(result[2]).toBe(120); // 30+40+50
  });

  it('computes correct 6-month rolling sums', () => {
    const series = [5, 10, 15, 20, 25, 30, 35];
    const result = accumulateRainfall(series, 6);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(105); // 5+10+15+20+25+30
    expect(result[1]).toBe(135); // 10+15+20+25+30+35
  });
});

// ── computeSPI tests ─────────────────────────────────────────────────────────

describe('computeSPI', () => {
  it('returns 0 for series with fewer than 2 values', () => {
    expect(computeSPI([])).toBe(0);
    expect(computeSPI([50])).toBe(0);
  });

  it('returns a value near 0 for a series where the last value is near the mean', () => {
    // All values equal → last value is at the mean → SPI ≈ 0
    const series = new Array(30).fill(50);
    const spi = computeSPI(series);
    // All identical: variance = 0, should return 0
    expect(spi).toBe(0);
  });

  it('returns negative SPI for below-average rainfall', () => {
    // Build a series of mostly high values, with a low last value
    const highSeries = Array.from({ length: 29 }, () => 100);
    const series = [...highSeries, 5]; // very low last value
    const spi = computeSPI(series);
    expect(spi).toBeLessThan(0);
  });

  it('returns positive SPI for above-average rainfall', () => {
    const lowSeries = Array.from({ length: 29 }, () => 10);
    const series = [...lowSeries, 200]; // very high last value
    const spi = computeSPI(series);
    expect(spi).toBeGreaterThan(0);
  });

  it('returns extreme negative SPI for an all-zero series', () => {
    const series = new Array(20).fill(0);
    const spi = computeSPI(series);
    expect(spi).toBeLessThanOrEqual(-2.0);
  });

  it('returns a finite number for valid input', () => {
    const series = [20, 35, 45, 10, 60, 30, 25, 40, 55, 15, 70, 20];
    const spi = computeSPI(series);
    expect(isFinite(spi)).toBe(true);
  });
});

// ── computeSPIForGrid tests ───────────────────────────────────────────────────

describe('computeSPIForGrid', () => {
  it('returns SPIResult for each grid cell', () => {
    const cells = [makeCell({ node_idx: 0 }), makeCell({ node_idx: 1, lat: 21 })];
    const history = new Map<number, number[]>();
    history.set(0, Array.from({ length: 20 }, (_, i) => 10 + i));
    history.set(1, Array.from({ length: 20 }, (_, i) => 20 + i));

    const results = computeSPIForGrid(cells, history, 3);
    expect(results).toHaveLength(2);
    expect(results[0].cell.node_idx).toBe(0);
    expect(results[1].cell.node_idx).toBe(1);
  });

  it('returns SPI=0 and near_normal for cells with no history', () => {
    const cells = [makeCell({ node_idx: 99 })];
    const history = new Map<number, number[]>();
    const results = computeSPIForGrid(cells, history, 3);
    expect(results).toHaveLength(1);
    expect(results[0].spi).toBe(0);
    expect(results[0].category).toBe('near_normal');
  });

  it('applies correct timescale accumulation', () => {
    const cell = makeCell({ node_idx: 0 });
    const history = new Map<number, number[]>();
    // 6 months: very low first 5, high last
    history.set(0, [5, 5, 5, 5, 5, 200]);

    const spi1 = computeSPIForGrid([cell], history, 1)[0].spi;
    const spi3 = computeSPIForGrid([cell], history, 3)[0].spi;
    const spi6 = computeSPIForGrid([cell], history, 6)[0].spi;

    // SPI-1 sees only the last month (200mm), should be positive
    expect(spi1).toBeGreaterThan(0);
    // SPI-6 averages over all 6 months, should be less positive than SPI-1
    expect(spi6).toBeLessThan(spi1);
  });

  it('classifies drought cells correctly', () => {
    const cell = makeCell({ node_idx: 0 });
    const history = new Map<number, number[]>();
    // Long dry series with a very dry last value → should trigger drought
    const drySeries = Array.from({ length: 30 }, (_, i) =>
      i < 29 ? 80 + (i % 5) : 2
    );
    history.set(0, drySeries);

    const result = computeSPIForGrid([cell], history, 3)[0];
    expect(result.category).not.toBe('near_normal');
    expect(['extreme_drought', 'severe_drought', 'moderate_drought']).toContain(
      result.category,
    );
  });
});

// ── generateDroughtAdvisories tests ─────────────────────────────────────────

describe('generateDroughtAdvisories', () => {
  it('returns empty array when no cells have SPI < -1.5', () => {
    const results = [
      { cell: makeCell(), spi: -1.4, category: 'moderate_drought' as DroughtCategory, timescale: 3 as SPITimescale },
      { cell: makeCell(), spi: 0.2, category: 'near_normal' as DroughtCategory, timescale: 3 as SPITimescale },
    ];
    expect(generateDroughtAdvisories(results)).toHaveLength(0);
  });

  it('generates advisory when SPI < -1.5', () => {
    const results = [
      { cell: makeCell(), spi: -1.8, category: 'severe_drought' as DroughtCategory, timescale: 3 as SPITimescale },
    ];
    const advisories = generateDroughtAdvisories(results);
    expect(advisories).toHaveLength(1);
    expect(advisories[0].spi).toBe(-1.8);
    expect(advisories[0].message).toContain('SPI-3');
  });

  it('generates extreme warning message for SPI < -2.0', () => {
    const results = [
      { cell: makeCell({ lat: 25, lon: 80 }), spi: -2.5, category: 'extreme_drought' as DroughtCategory, timescale: 6 as SPITimescale },
    ];
    const advisories = generateDroughtAdvisories(results);
    expect(advisories).toHaveLength(1);
    expect(advisories[0].message).toContain('EXTREME DROUGHT');
    expect(advisories[0].message).toContain('SPI-6');
  });

  it('generates advisory for multiple drought cells', () => {
    const results = [
      { cell: makeCell({ node_idx: 0 }), spi: 0.5, category: 'near_normal' as DroughtCategory, timescale: 1 as SPITimescale },
      { cell: makeCell({ node_idx: 1 }), spi: -1.7, category: 'severe_drought' as DroughtCategory, timescale: 1 as SPITimescale },
      { cell: makeCell({ node_idx: 2 }), spi: -2.2, category: 'extreme_drought' as DroughtCategory, timescale: 1 as SPITimescale },
    ];
    const advisories = generateDroughtAdvisories(results);
    expect(advisories).toHaveLength(2);
  });

  it('advisory boundary: exactly -1.5 does NOT trigger advisory', () => {
    const results = [
      { cell: makeCell(), spi: -1.5, category: 'moderate_drought' as DroughtCategory, timescale: 3 as SPITimescale },
    ];
    // SPI < -1.5 (strict), so -1.5 itself is excluded
    expect(generateDroughtAdvisories(results)).toHaveLength(0);
  });

  it('advisory boundary: -1.501 DOES trigger advisory', () => {
    const results = [
      { cell: makeCell(), spi: -1.501, category: 'severe_drought' as DroughtCategory, timescale: 3 as SPITimescale },
    ];
    expect(generateDroughtAdvisories(results)).toHaveLength(1);
  });
});

// ── buildSparklines tests ────────────────────────────────────────────────────

describe('buildSparklines', () => {
  it('returns sparkline for each grid cell', () => {
    const cells = [makeCell({ node_idx: 0 }), makeCell({ node_idx: 1, lat: 22 })];
    const history = new Map<number, number[]>();
    history.set(0, Array.from({ length: 12 }, () => 30));
    history.set(1, Array.from({ length: 12 }, () => 60));

    const sparklines = buildSparklines(cells, history, 3, ['J','F','M','A','M','J']);
    expect(sparklines).toHaveLength(2);
  });

  it('sparkline spiValues has at most 6 entries', () => {
    const cells = [makeCell({ node_idx: 0 })];
    const history = new Map<number, number[]>();
    history.set(0, Array.from({ length: 24 }, (_, i) => 20 + i));

    const sparklines = buildSparklines(cells, history, 1, ['J','F','M','A','M','J']);
    expect(sparklines[0].spiValues.length).toBeLessThanOrEqual(6);
  });

  it('returns empty spiValues for cell with insufficient history', () => {
    const cells = [makeCell({ node_idx: 0 })];
    const history = new Map<number, number[]>();
    // Only 2 months — for SPI-6, this is too short (accumulateRainfall returns [])
    history.set(0, [30, 40]);

    const sparklines = buildSparklines(cells, history, 6, ['J','F','M','A','M','J']);
    expect(sparklines[0].spiValues).toHaveLength(0);
  });

  it('regionKey encodes lat/lon correctly', () => {
    const cell = makeCell({ lat: 15.5, lon: 73.25 });
    const history = new Map<number, number[]>();
    history.set(0, Array.from({ length: 10 }, () => 50));

    const sparklines = buildSparklines([cell], history, 1, ['J','F','M','A','M','J']);
    expect(sparklines[0].regionKey).toBe('15.50_73.25');
  });
});

// ── Property-Based Tests ─────────────────────────────────────────────────────

/**
 * **Validates: Requirements 21.1, 21.2**
 *
 * Property 14: SPI Computation and Drought Classification
 *
 * Three properties verified:
 *   P14a – classifyDrought always returns one of the 7 valid categories
 *   P14b – category boundaries are respected for any SPI value
 *   P14c – computeSPI returns a finite number for any valid series of length ≥ 2
 */

const VALID_DROUGHT_CATEGORIES: DroughtCategory[] = [
  'extreme_drought',
  'severe_drought',
  'moderate_drought',
  'near_normal',
  'moderately_wet',
  'severely_wet',
  'extremely_wet',
];

describe('Property 14: SPI Computation and Drought Classification', () => {
  // P14a — classifyDrought always returns one of the 7 valid categories
  test.prop(
    [fc.float({ min: -10, max: 10, noNaN: true })],
    { numRuns: 500 }
  )(
    'P14a: classifyDrought returns one of the 7 valid drought categories for any SPI value',
    (spi) => {
      const category = classifyDrought(spi);
      expect(VALID_DROUGHT_CATEGORIES).toContain(category);
    }
  );

  // P14b — category boundaries are respected for every SPI value
  test.prop(
    [fc.float({ min: -10, max: 10, noNaN: true })],
    { numRuns: 500 }
  )(
    'P14b: classifyDrought respects standard WMO SPI boundary thresholds',
    (spi) => {
      const category = classifyDrought(spi);

      if (spi < -2.0) {
        expect(category).toBe('extreme_drought');
      } else if (spi < -1.5) {
        expect(category).toBe('severe_drought');
      } else if (spi < -1.0) {
        expect(category).toBe('moderate_drought');
      } else if (spi <= 1.0) {
        expect(category).toBe('near_normal');
      } else if (spi <= 1.5) {
        expect(category).toBe('moderately_wet');
      } else if (spi <= 2.0) {
        expect(category).toBe('severely_wet');
      } else {
        expect(category).toBe('extremely_wet');
      }
    }
  );

  // P14c — computeSPI returns a finite number for any valid series of length ≥ 2
  test.prop(
    [
      fc.array(
        fc.float({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        { minLength: 2, maxLength: 60 }
      ),
    ],
    { numRuns: 300 }
  )(
    'P14c: computeSPI returns a finite number for any rainfall series of length ≥ 2',
    (series) => {
      const spi = computeSPI(series);
      expect(Number.isFinite(spi)).toBe(true);
    }
  );
});
