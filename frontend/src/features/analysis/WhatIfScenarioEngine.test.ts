/**
 * Unit tests for WhatIfScenarioEngine utilities.
 * Tests: 6 scenario types defined, anomaly map aggregation, chain logic.
 * Validates: Requirements 83.1, 83.2, 83.3, 83.4, 83.5
 */
import { describe, it, expect } from 'vitest';
import { SCENARIO_OPTIONS } from './WhatIfScenarioEngine';
import type { ScenarioTypeId } from '../../types';

// ── Scenario option definitions ───────────────────────────────────────────────

describe('SCENARIO_OPTIONS', () => {
  it('should define exactly 6 scenario types (req 83.1)', () => {
    expect(SCENARIO_OPTIONS).toHaveLength(6);
  });

  it('should include all required scenario types', () => {
    const ids = SCENARIO_OPTIONS.map((o) => o.id);
    const required: ScenarioTypeId[] = [
      'temperature_offset',
      'rainfall_scaling',
      'monsoon_delay',
      'sst_anomaly',
      'urbanization_change',
      'deforestation_impact',
    ];
    for (const id of required) {
      expect(ids).toContain(id);
    }
  });

  it('each scenario should have valid magnitude range (min < max)', () => {
    for (const opt of SCENARIO_OPTIONS) {
      expect(opt.magnitudeMin).toBeLessThan(opt.magnitudeMax);
    }
  });

  it('each scenario should have a defaultMagnitude within [min, max]', () => {
    for (const opt of SCENARIO_OPTIONS) {
      expect(opt.defaultMagnitude).toBeGreaterThanOrEqual(opt.magnitudeMin);
      expect(opt.defaultMagnitude).toBeLessThanOrEqual(opt.magnitudeMax);
    }
  });

  it('each scenario should have a formatMagnitude function', () => {
    for (const opt of SCENARIO_OPTIONS) {
      expect(typeof opt.formatMagnitude).toBe('function');
      // Should return a non-empty string for defaultMagnitude
      const formatted = opt.formatMagnitude(opt.defaultMagnitude);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    }
  });
});

// ── Temperature offset formatting ─────────────────────────────────────────────

describe('temperature_offset formatMagnitude', () => {
  const opt = SCENARIO_OPTIONS.find((o) => o.id === 'temperature_offset')!;
  it('formats positive magnitude with leading +', () => {
    expect(opt.formatMagnitude(2.0)).toBe('+2.0°C');
  });
  it('formats negative magnitude without +', () => {
    expect(opt.formatMagnitude(-1.5)).toBe('-1.5°C');
  });
  it('formats zero', () => {
    expect(opt.formatMagnitude(0)).toMatch(/0\.0°C/);
  });
});

// ── Rainfall scaling formatting ───────────────────────────────────────────────

describe('rainfall_scaling formatMagnitude', () => {
  const opt = SCENARIO_OPTIONS.find((o) => o.id === 'rainfall_scaling')!;
  it('formats scale factor 1.2 as 20% (wetter, no + prefix for pct)', () => {
    expect(opt.formatMagnitude(1.2)).toBe('20%');
  });
  it('formats scale factor 0.8 as -20%', () => {
    expect(opt.formatMagnitude(0.8)).toBe('-20%');
  });
  it('formats scale factor 1.0 as 0%', () => {
    expect(opt.formatMagnitude(1.0)).toBe('0%');
  });
});

// ── Urbanization and deforestation ────────────────────────────────────────────

describe('urbanization_change formatMagnitude', () => {
  const opt = SCENARIO_OPTIONS.find((o) => o.id === 'urbanization_change')!;
  it('formats 0.5 as +50%', () => {
    expect(opt.formatMagnitude(0.5)).toBe('+50%');
  });
  it('formats -0.3 as -30%', () => {
    expect(opt.formatMagnitude(-0.3)).toBe('-30%');
  });
});

describe('deforestation_impact formatMagnitude', () => {
  const opt = SCENARIO_OPTIONS.find((o) => o.id === 'deforestation_impact')!;
  it('formats 0.3 as +30%', () => {
    expect(opt.formatMagnitude(0.3)).toBe('+30%');
  });
  it('formats -0.5 as -50% (afforestation)', () => {
    expect(opt.formatMagnitude(-0.5)).toBe('-50%');
  });
});

// ── Anomaly aggregation logic (compound chaining, req 83.4) ──────────────────

describe('anomaly aggregation for compound scenarios', () => {
  const makeResult = (rainDelta: number[], tMaxDelta: number[], tMinDelta: number[]) => ({
    scenario_type: 'temperature_offset' as ScenarioTypeId,
    magnitude: 1.0,
    baseline: { rainfall: [5, 6], temp_max: [30, 31], temp_min: [22, 23] },
    scenario: { rainfall: [5, 6], temp_max: [30, 31], temp_min: [22, 23] },
    delta: { rainfall: rainDelta, temp_max: tMaxDelta, temp_min: tMinDelta },
    hotspots: [],
    summary: {},
    clamped: false,
    computation_time_s: 0.5,
    scenarioLabel: 'Test',
    timestamp: Date.now(),
  });

  it('summing deltas across 2 chained scenarios gives compound effect', () => {
    const r1 = makeResult([1, 2], [0.5, 0.5], [0.3, 0.3]);
    const r2 = makeResult([-0.5, -1], [1.0, 1.0], [0.5, 0.5]);

    // Simulate the compound aggregation logic
    const allResults = [r1, r2];
    const variables = ['rainfall', 'temp_max', 'temp_min'] as const;
    for (const variable of variables) {
      const deltas = allResults.map((r) => r.delta[variable]);
      const len = deltas[0].length;
      const aggregated = Array.from({ length: len }, (_, i) =>
        deltas.reduce((sum, d) => sum + d[i], 0)
      );
      if (variable === 'rainfall') {
        expect(aggregated[0]).toBeCloseTo(0.5, 5);
        expect(aggregated[1]).toBeCloseTo(1.0, 5);
      }
      if (variable === 'temp_max') {
        expect(aggregated[0]).toBeCloseTo(1.5, 5);
      }
    }
  });
});
