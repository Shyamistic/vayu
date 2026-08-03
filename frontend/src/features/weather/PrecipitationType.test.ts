/**
 * Unit tests for PrecipitationType pure functions.
 *
 * Validates: Requirements 54.1, 54.2, 54.3, 54.4
 */

import { describe, it, expect } from 'vitest';
import {
  classifyPrecipitationType,
  estimateDewPoint,
  estimateSnowLineAltitude,
  isCellAboveSnowLine,
  computeSnowfallEquivalent,
  classifyAllCells,
  buildSnowLineContour,
  summarizePrecipTypes,
  PRECIP_TYPE_STYLES,
  MIN_RAINFALL_MM,
  RAIN_THRESHOLD_C,
  SNOW_TO_LIQUID_RATIO,
} from './PrecipitationType';
import type { GridCell } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> & { node_idx: number }): GridCell {
  return {
    lat: 28.6,
    lon: 77.2,
    rainfall: 10,
    temp_max: 15,
    temp_min: 10,
    rainfall_uncertainty: 0,
    temp_max_uncertainty: 0,
    temp_min_uncertainty: 0,
    ...overrides,
  };
}

// ── classifyPrecipitationType ─────────────────────────────────────────────────

describe('classifyPrecipitationType — Requirement 54.1', () => {
  it('returns none when rainfall is below threshold', () => {
    expect(classifyPrecipitationType(0, 5, 0)).toBe('none');
    expect(classifyPrecipitationType(MIN_RAINFALL_MM - 0.01, 5, 0)).toBe('none');
  });

  it('classifies rain when surface temp ≥ 2°C', () => {
    expect(classifyPrecipitationType(5, RAIN_THRESHOLD_C, 0)).toBe('rain');
    expect(classifyPrecipitationType(5, 30, 20)).toBe('rain');
    expect(classifyPrecipitationType(5, 2.0, 1)).toBe('rain');
  });

  it('classifies sleet when surface temp in [0, 2)', () => {
    expect(classifyPrecipitationType(5, 0.0, -2)).toBe('sleet');
    expect(classifyPrecipitationType(5, 1.5, -0.5)).toBe('sleet');
    expect(classifyPrecipitationType(5, 1.99, 0)).toBe('sleet');
  });

  it('classifies freezing rain when surface temp < 0 and dew point > -1', () => {
    expect(classifyPrecipitationType(5, -0.5, 0)).toBe('freezing_rain');
    expect(classifyPrecipitationType(5, -2, -0.5)).toBe('freezing_rain');
    expect(classifyPrecipitationType(5, -1, -0.99)).toBe('freezing_rain');
  });

  it('classifies snow when surface temp < 0 and dew point ≤ -1', () => {
    expect(classifyPrecipitationType(5, -3, -4)).toBe('snow');
    expect(classifyPrecipitationType(5, -1, -1)).toBe('snow');
    expect(classifyPrecipitationType(5, -5, -10)).toBe('snow');
  });

  it('exact boundary: temp = 0 is sleet (not freezing rain)', () => {
    expect(classifyPrecipitationType(1, 0.0, -2)).toBe('sleet');
  });

  it('exact boundary: temp = 2 is rain (not sleet)', () => {
    expect(classifyPrecipitationType(1, 2.0, 0)).toBe('rain');
  });
});

// ── estimateDewPoint ──────────────────────────────────────────────────────────

describe('estimateDewPoint', () => {
  it('returns tempMin minus 2', () => {
    expect(estimateDewPoint(10)).toBeCloseTo(8, 5);
    expect(estimateDewPoint(0)).toBeCloseTo(-2, 5);
    expect(estimateDewPoint(-5)).toBeCloseTo(-7, 5);
  });
});

// ── estimateSnowLineAltitude ──────────────────────────────────────────────────

describe('estimateSnowLineAltitude — Requirement 54.3', () => {
  it('returns station altitude when surface temp ≤ 0', () => {
    expect(estimateSnowLineAltitude(0, 500)).toBe(500);
    expect(estimateSnowLineAltitude(-5, 1000)).toBe(1000);
  });

  it('increases snow line altitude with warmer surface temps', () => {
    const alt1 = estimateSnowLineAltitude(10, 0);
    const alt2 = estimateSnowLineAltitude(20, 0);
    expect(alt2).toBeGreaterThan(alt1);
  });

  it('uses 6.5°C/1000m lapse rate correctly', () => {
    // 6.5°C / 1000m → 1°C per 153.85m
    const expected = 0 + 13 / (6.5 / 1000); // ≈ 2000m
    expect(estimateSnowLineAltitude(13, 0)).toBeCloseTo(expected, 0);
  });

  it('defaults station altitude to 0m', () => {
    const alt = estimateSnowLineAltitude(6.5);
    expect(alt).toBeCloseTo(1000, 0); // 6.5 / 0.0065 = 1000
  });
});

// ── isCellAboveSnowLine ───────────────────────────────────────────────────────

describe('isCellAboveSnowLine — Requirement 54.3', () => {
  it('uses explicit altitude when provided', () => {
    expect(isCellAboveSnowLine(3000, 2500, 25)).toBe(true);
    expect(isCellAboveSnowLine(2000, 2500, 25)).toBe(false);
    expect(isCellAboveSnowLine(2500, 2500, 25)).toBe(true); // exactly at snow line
  });

  it('falls back to latitude heuristic when altitude is undefined', () => {
    expect(isCellAboveSnowLine(undefined, 3000, 31)).toBe(true);  // north of 30°N
    expect(isCellAboveSnowLine(undefined, 3000, 29)).toBe(false); // south of 30°N
    expect(isCellAboveSnowLine(undefined, 3000, 30)).toBe(false); // exactly 30° → false
  });
});

// ── computeSnowfallEquivalent ─────────────────────────────────────────────────

describe('computeSnowfallEquivalent — Requirement 54.4', () => {
  it('returns 0 for non-snow phases', () => {
    expect(computeSnowfallEquivalent(10, 'rain', true)).toBe(0);
    expect(computeSnowfallEquivalent(10, 'sleet', true)).toBe(0);
    expect(computeSnowfallEquivalent(10, 'freezing_rain', true)).toBe(0);
    expect(computeSnowfallEquivalent(10, 'none', true)).toBe(0);
  });

  it('returns 0 for snow cells below snow line', () => {
    expect(computeSnowfallEquivalent(10, 'snow', false)).toBe(0);
  });

  it('applies 10:1 snow-to-liquid ratio for snow above snow line', () => {
    expect(computeSnowfallEquivalent(5, 'snow', true)).toBe(5 * SNOW_TO_LIQUID_RATIO);
    expect(computeSnowfallEquivalent(12.3, 'snow', true)).toBeCloseTo(123, 5);
  });

  it('returns 0 for zero rainfall', () => {
    expect(computeSnowfallEquivalent(0, 'snow', true)).toBe(0);
  });
});

// ── classifyAllCells ──────────────────────────────────────────────────────────

describe('classifyAllCells — Requirement 54.1, 54.4', () => {
  const cells: GridCell[] = [
    makeCell({ node_idx: 1, lat: 34.0, temp_max: -3, temp_min: -5, rainfall: 8 }),   // snow
    makeCell({ node_idx: 2, lat: 31.0, temp_max: 1.0, temp_min: -1, rainfall: 5 }), // sleet
    makeCell({ node_idx: 3, lat: 28.6, temp_max: 20, temp_min: 15, rainfall: 15 }), // rain
    makeCell({ node_idx: 4, lat: 25.0, temp_max: 30, temp_min: 22, rainfall: 0 }),  // none
  ];

  it('classifies each cell with the correct phase', () => {
    const results = classifyAllCells(cells);
    const phaseByIdx = Object.fromEntries(results.map((r) => [r.node_idx, r.phase]));
    expect(phaseByIdx[1]).toBe('snow');
    expect(phaseByIdx[2]).toBe('sleet');
    expect(phaseByIdx[3]).toBe('rain');
    expect(phaseByIdx[4]).toBe('none');
  });

  it('computes snowfall equivalent only for snow cells above snow line', () => {
    const results = classifyAllCells(cells);
    const snowCell = results.find((r) => r.node_idx === 1)!;
    const sleetCell = results.find((r) => r.node_idx === 2)!;
    const rainCell = results.find((r) => r.node_idx === 3)!;

    // Snow cell at lat 34 → above snow line heuristic
    expect(snowCell.snowfallEquivalent).toBeGreaterThan(0);
    expect(sleetCell.snowfallEquivalent).toBe(0);
    expect(rainCell.snowfallEquivalent).toBe(0);
  });

  it('returns empty array for empty input', () => {
    expect(classifyAllCells([])).toHaveLength(0);
  });
});

// ── buildSnowLineContour ──────────────────────────────────────────────────────

describe('buildSnowLineContour — Requirement 54.3', () => {
  it('returns a valid contour object with altitudeM and computedAt', () => {
    const cells = [makeCell({ node_idx: 1, temp_max: 13, rainfall: 5 })];
    const contour = buildSnowLineContour(cells);
    expect(contour.altitudeM).toBeGreaterThan(0);
    expect(contour.computedAt).toBeTruthy();
    expect(new Date(contour.computedAt).getTime()).not.toBeNaN();
  });

  it('identifies contour cells near 0°C surface temperature', () => {
    const cells = [
      makeCell({ node_idx: 1, lat: 31.0, lon: 77.0, temp_max: 0.3, rainfall: 5 }),  // near 0
      makeCell({ node_idx: 2, lat: 30.5, lon: 78.0, temp_max: 15.0, rainfall: 5 }), // warm
      makeCell({ node_idx: 3, lat: 32.0, lon: 76.5, temp_max: -0.4, rainfall: 5 }), // near 0
    ];
    const contour = buildSnowLineContour(cells);
    // Cells 1 and 3 are within ±0.5°C of 0
    expect(contour.contourCells).toHaveLength(2);
  });
});

// ── summarizePrecipTypes ──────────────────────────────────────────────────────

describe('summarizePrecipTypes — Requirement 54.4', () => {
  it('counts each phase correctly', () => {
    const results = [
      { phase: 'rain' as const, snowfallEquivalent: 0, aboveSnowLine: false, lat: 0, lon: 0, node_idx: 1, surfaceTemp: 20, dewPoint: 10, rainfall: 10 },
      { phase: 'snow' as const, snowfallEquivalent: 50, aboveSnowLine: true,  lat: 33, lon: 77, node_idx: 2, surfaceTemp: -3, dewPoint: -5, rainfall: 5 },
      { phase: 'snow' as const, snowfallEquivalent: 80, aboveSnowLine: true,  lat: 34, lon: 76, node_idx: 3, surfaceTemp: -5, dewPoint: -8, rainfall: 8 },
      { phase: 'none' as const, snowfallEquivalent: 0, aboveSnowLine: false, lat: 25, lon: 75, node_idx: 4, surfaceTemp: 28, dewPoint: 15, rainfall: 0 },
    ];
    const summary = summarizePrecipTypes(results);
    expect(summary.counts.rain).toBe(1);
    expect(summary.counts.snow).toBe(2);
    expect(summary.counts.none).toBe(1);
    expect(summary.counts.sleet).toBe(0);
    expect(summary.totalSnowfallMm).toBe(130);
    expect(summary.aboveSnowLineCells).toBe(2);
  });

  it('returns zeros for empty input', () => {
    const summary = summarizePrecipTypes([]);
    expect(summary.totalSnowfallMm).toBe(0);
    expect(summary.aboveSnowLineCells).toBe(0);
  });
});

// ── PRECIP_TYPE_STYLES ────────────────────────────────────────────────────────

describe('PRECIP_TYPE_STYLES — Requirement 54.2', () => {
  const phases = ['rain', 'snow', 'sleet', 'freezing_rain', 'none'] as const;

  it('defines a distinct symbol for every phase', () => {
    const symbols = phases.map((p) => PRECIP_TYPE_STYLES[p].symbol);
    const unique = new Set(symbols);
    expect(unique.size).toBe(phases.length);
  });

  it('defines a distinct color for every active phase', () => {
    const activePhases = ['rain', 'snow', 'sleet', 'freezing_rain'] as const;
    const colors = activePhases.map((p) => PRECIP_TYPE_STYLES[p].color);
    const unique = new Set(colors);
    expect(unique.size).toBe(activePhases.length);
  });

  it('each phase style has a non-empty label and symbol', () => {
    for (const phase of phases) {
      expect(PRECIP_TYPE_STYLES[phase].label.length).toBeGreaterThan(0);
      expect(PRECIP_TYPE_STYLES[phase].symbol.length).toBeGreaterThan(0);
    }
  });
});
