/**
 * Unit tests for ReportGenerator pure functions.
 *
 * Tests cover:
 * - computeDayStats: correct aggregation of grid cell statistics
 * - buildForecastRow: correct date assignment and stats
 * - buildForecastTable: correct 7-row table construction
 * - computeRiskAssessment: correct overall risk level classification
 * - compileReport: end-to-end report compilation
 *
 * Validates: Requirements 44.1, 44.2, 44.3, 44.4
 */

import { describe, it, expect } from 'vitest';
import {
  computeDayStats,
  buildForecastRow,
  buildForecastTable,
  computeRiskAssessment,
  compileReport,
} from './ReportGenerator';
import type { GridCell, RegionId } from '../../types';
import type { AnomalySummaryEntry, ForecastRow, ReportInput } from './ReportGenerator';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat: 12.5,
    lon: 77.5,
    node_idx: 0,
    rainfall: 10,
    temp_max: 30,
    temp_min: 20,
    rainfall_uncertainty: 2,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 0.5,
    ...overrides,
  };
}

const EMPTY_ANOMALIES: AnomalySummaryEntry[] = [];
const BASE_REGION: RegionId = 'full_india';

// ── computeDayStats ───────────────────────────────────────────────────────────

describe('computeDayStats', () => {
  it('returns zeros for empty cell array', () => {
    const stats = computeDayStats([]);
    expect(stats.avgRainfall).toBe(0);
    expect(stats.maxRainfall).toBe(0);
    expect(stats.avgTempMax).toBe(0);
    expect(stats.avgTempMin).toBe(0);
    expect(stats.rainfallUncertainty).toBe(0);
    expect(stats.tempMaxUncertainty).toBe(0);
  });

  it('correctly computes average and max for a single cell', () => {
    const cell = makeCell({ rainfall: 50, temp_max: 38, temp_min: 25, rainfall_uncertainty: 5, temp_max_uncertainty: 2 });
    const stats = computeDayStats([cell]);
    expect(stats.avgRainfall).toBe(50);
    expect(stats.maxRainfall).toBe(50);
    expect(stats.avgTempMax).toBe(38);
    expect(stats.avgTempMin).toBe(25);
    expect(stats.rainfallUncertainty).toBe(5);
    expect(stats.tempMaxUncertainty).toBe(2);
  });

  it('correctly computes averages across multiple cells', () => {
    const cells = [
      makeCell({ rainfall: 20, temp_max: 30, temp_min: 20 }),
      makeCell({ rainfall: 40, temp_max: 34, temp_min: 22 }),
      makeCell({ rainfall: 60, temp_max: 32, temp_min: 18 }),
    ];
    const stats = computeDayStats(cells);
    expect(stats.avgRainfall).toBeCloseTo(40, 5);
    expect(stats.maxRainfall).toBe(60);
    expect(stats.avgTempMax).toBeCloseTo(32, 5);
    expect(stats.avgTempMin).toBeCloseTo(20, 5);
  });

  it('correctly identifies the max rainfall across cells', () => {
    const cells = [
      makeCell({ rainfall: 5 }),
      makeCell({ rainfall: 200 }),
      makeCell({ rainfall: 80 }),
    ];
    const stats = computeDayStats(cells);
    expect(stats.maxRainfall).toBe(200);
  });
});

// ── buildForecastRow ──────────────────────────────────────────────────────────

describe('buildForecastRow', () => {
  it('assigns day number as dayIndex + 1', () => {
    const row = buildForecastRow(0, [makeCell()], new Date('2025-07-01'));
    expect(row.day).toBe(1);
    const row6 = buildForecastRow(6, [makeCell()], new Date('2025-07-01'));
    expect(row6.day).toBe(7);
  });

  it('produces a non-empty date string', () => {
    const row = buildForecastRow(2, [makeCell()], new Date('2025-07-01'));
    expect(typeof row.date).toBe('string');
    expect(row.date.length).toBeGreaterThan(0);
  });

  it('aggregates stats correctly from cells', () => {
    const cells = [makeCell({ rainfall: 30 }), makeCell({ rainfall: 70 })];
    const row = buildForecastRow(0, cells, new Date('2025-07-01'));
    expect(row.avgRainfall).toBeCloseTo(50, 5);
    expect(row.maxRainfall).toBe(70);
  });
});

// ── buildForecastTable ────────────────────────────────────────────────────────

describe('buildForecastTable', () => {
  it('always returns exactly 7 rows', () => {
    const table = buildForecastTable([], new Date());
    expect(table).toHaveLength(7);
  });

  it('returns 7 rows when fewer days are provided', () => {
    const table = buildForecastTable([[makeCell()], [makeCell()]], new Date());
    expect(table).toHaveLength(7);
  });

  it('assigns sequential day numbers 1–7', () => {
    const table = buildForecastTable([], new Date());
    table.forEach((row, i) => expect(row.day).toBe(i + 1));
  });

  it('zero-fills missing days', () => {
    const table = buildForecastTable([], new Date());
    for (const row of table) {
      expect(row.avgRainfall).toBe(0);
    }
  });

  it('uses cell data when provided', () => {
    const day1Cells = [makeCell({ rainfall: 80 }), makeCell({ rainfall: 120 })];
    const table = buildForecastTable([day1Cells], new Date());
    expect(table[0].avgRainfall).toBeCloseTo(100, 5);
    expect(table[0].maxRainfall).toBe(120);
    // Other days should be zero-filled
    expect(table[1].avgRainfall).toBe(0);
  });
});

// ── computeRiskAssessment ─────────────────────────────────────────────────────

describe('computeRiskAssessment', () => {
  function makeRow(overrides: Partial<ForecastRow>): ForecastRow {
    return {
      day: 1, date: 'Mon 01 Jul',
      avgRainfall: 10, maxRainfall: 20,
      avgTempMax: 32, avgTempMin: 22,
      rainfallUncertainty: 2, tempMaxUncertainty: 1,
      ...overrides,
    };
  }

  it('returns low risk for mild, anomaly-free forecast', () => {
    const rows = Array.from({ length: 7 }, () => makeRow({}));
    const risk = computeRiskAssessment(rows, []);
    expect(risk.overallRiskLevel).toBe('low');
    expect(risk.anomalyCount).toBe(0);
  });

  it('returns moderate when avg rainfall exceeds 50mm on any day', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRow({ avgRainfall: i === 2 ? 60 : 10 }));
    const risk = computeRiskAssessment(rows, []);
    expect(['moderate', 'high', 'extreme']).toContain(risk.overallRiskLevel);
  });

  it('returns extreme when an extreme anomaly is present', () => {
    const anomalies: AnomalySummaryEntry[] = [
      { lat: 12, lon: 77, variable: 'rainfall', value: 200, departure: 150, severity: 'extreme' },
    ];
    const rows = Array.from({ length: 7 }, () => makeRow({}));
    const risk = computeRiskAssessment(rows, anomalies);
    expect(risk.overallRiskLevel).toBe('extreme');
    expect(risk.anomalyCount).toBe(1);
  });

  it('counts heat wave days correctly', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRow({ avgTempMax: i < 3 ? 42 : 32 }));
    const risk = computeRiskAssessment(rows, []);
    expect(risk.heatWaveCount).toBe(3);
  });

  it('counts flood risk days correctly', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRow({ avgRainfall: i < 2 ? 80 : 10 }));
    const risk = computeRiskAssessment(rows, []);
    expect(risk.floodRiskCount).toBe(2);
  });

  it('counts high flood risk days (maxRainfall > 100) correctly', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRow({ maxRainfall: i === 0 ? 150 : 40 }));
    const risk = computeRiskAssessment(rows, []);
    expect(risk.highFloodRiskCount).toBe(1);
  });
});

// ── compileReport ─────────────────────────────────────────────────────────────

describe('compileReport', () => {
  function makeInput(overrides: Partial<ReportInput> = {}): ReportInput {
    return {
      template: 'daily_briefing',
      region: BASE_REGION,
      variable: 'rainfall',
      forecastDaysCells: Array.from({ length: 7 }, () => [makeCell()]),
      anomalySummary: EMPTY_ANOMALIES,
      globeCanvas: null,
      ...overrides,
    };
  }

  it('returns a report with 7 forecast rows', () => {
    const report = compileReport(makeInput());
    expect(report.forecastRows).toHaveLength(7);
  });

  it('sets the correct template', () => {
    const report = compileReport(makeInput({ template: 'extreme_event_alert' }));
    expect(report.template).toBe('extreme_event_alert');
  });

  it('sets the correct region and variable', () => {
    const report = compileReport(makeInput({ region: 'western_ghats', variable: 'temp_max' }));
    expect(report.region).toBe('western_ghats');
    expect(report.variable).toBe('temp_max');
  });

  it('includes anomalies passed in input', () => {
    const anomalies: AnomalySummaryEntry[] = [
      { lat: 12, lon: 77, variable: 'rainfall', value: 150, departure: 100, severity: 'severe' },
    ];
    const report = compileReport(makeInput({ anomalySummary: anomalies }));
    expect(report.anomalies).toHaveLength(1);
    expect(report.riskAssessment.anomalyCount).toBe(1);
  });

  it('generatedAt is a Date close to now', () => {
    const before = Date.now();
    const report = compileReport(makeInput());
    const after = Date.now();
    expect(report.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(report.generatedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('sets globeScreenshotDataUrl to undefined when no canvas is provided', () => {
    const report = compileReport(makeInput({ globeCanvas: null }));
    expect(report.globeScreenshotDataUrl).toBeUndefined();
  });

  it('sets overallRiskLevel to extreme when extreme anomalies are present', () => {
    const anomalies: AnomalySummaryEntry[] = [
      { lat: 12, lon: 77, variable: 'rainfall', value: 300, departure: 250, severity: 'extreme' },
    ];
    const report = compileReport(makeInput({ anomalySummary: anomalies }));
    expect(report.riskAssessment.overallRiskLevel).toBe('extreme');
  });
});
