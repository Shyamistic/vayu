/**
 * Unit and property-based tests for ClimateChangeProjection pure functions.
 *
 * Covers:
 *  - interpolateProjection: linear interpolation, boundary clamping
 *  - computeEffectiveDelta: scaling delta by Time Machine fraction
 *  - computeAnomalyCells: absolute/percentage delta application
 *  - anomalyDeltaToColor: diverging colour mapping
 *  - getActiveVulnerabilityZones: year-filtered zones
 *  - buildTimeMachineLabel: human-readable label generation
 *  - getProjectionData: look-up from scenario table
 *
 * Validates: Requirements 42.1, 42.2, 42.3, 42.4
 */

import { describe, it, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  interpolateProjection,
  computeEffectiveDelta,
  computeAnomalyCells,
  anomalyDeltaToColor,
  getActiveVulnerabilityZones,
  buildTimeMachineLabel,
  getProjectionData,
  PROJECTION_SCENARIOS,
  VULNERABILITY_ZONES,
  CURRENT_YEAR,
  type ProjectionYear,
} from './ClimateChangeProjection';

// ── interpolateProjection ─────────────────────────────────────────────────────

describe('interpolateProjection', () => {
  it('returns presentValue at fraction=0', () => {
    expect(interpolateProjection(10, 50, 0)).toBe(10);
  });

  it('returns futureValue at fraction=1', () => {
    expect(interpolateProjection(10, 50, 1)).toBe(50);
  });

  it('returns midpoint at fraction=0.5', () => {
    expect(interpolateProjection(0, 100, 0.5)).toBeCloseTo(50);
  });

  it('clamps fraction below 0 to 0', () => {
    expect(interpolateProjection(10, 50, -0.5)).toBe(10);
  });

  it('clamps fraction above 1 to 1', () => {
    expect(interpolateProjection(10, 50, 1.5)).toBe(50);
  });

  it('handles negative future values', () => {
    expect(interpolateProjection(5, -5, 0.5)).toBeCloseTo(0);
  });

  it('handles identical present and future (no-op)', () => {
    expect(interpolateProjection(42, 42, 0.7)).toBeCloseTo(42);
  });
});

// ── computeEffectiveDelta ─────────────────────────────────────────────────────

describe('computeEffectiveDelta', () => {
  it('returns 0 at fraction=0 (no change at present)', () => {
    expect(computeEffectiveDelta(10, 0)).toBe(0);
  });

  it('returns full delta at fraction=1 (full future signal)', () => {
    expect(computeEffectiveDelta(10, 1)).toBe(10);
  });

  it('returns half delta at fraction=0.5', () => {
    expect(computeEffectiveDelta(10, 0.5)).toBeCloseTo(5);
  });

  it('works with negative deltas (cooling scenarios)', () => {
    expect(computeEffectiveDelta(-4, 0.5)).toBeCloseTo(-2);
  });
});

// ── computeAnomalyCells ───────────────────────────────────────────────────────

describe('computeAnomalyCells', () => {
  const baseCells = [
    { lat: 12, lon: 77, value: 200 }, // 200mm rainfall
    { lat: 13, lon: 78, value: 100 },
  ];

  it('applies percentage delta for rainfall', () => {
    const cells = computeAnomalyCells(baseCells, 'rainfall', 10);
    expect(cells[0].absoluteDelta).toBeCloseTo(20); // 10% of 200
    expect(cells[0].percentDelta).toBeCloseTo(10);
  });

  it('applies absolute °C delta for temp_max', () => {
    const cells = computeAnomalyCells(baseCells, 'temp_max', 1.5);
    expect(cells[0].absoluteDelta).toBeCloseTo(1.5);
    expect(cells[0].absoluteDelta).toBeCloseTo(cells[1].absoluteDelta);
  });

  it('preserves baseline mean in output', () => {
    const cells = computeAnomalyCells(baseCells, 'temp_min', 2.0);
    expect(cells[0].baselineMean).toBe(200);
    expect(cells[1].baselineMean).toBe(100);
  });

  it('preserves lat/lon coordinates', () => {
    const cells = computeAnomalyCells(baseCells, 'rainfall', 5);
    expect(cells[0].lat).toBe(12);
    expect(cells[0].lon).toBe(77);
  });

  it('returns correct length', () => {
    const cells = computeAnomalyCells(baseCells, 'rainfall', 5);
    expect(cells).toHaveLength(2);
  });

  it('handles zero baseline value for rainfall (0% change stays 0)', () => {
    const zeroCells = [{ lat: 0, lon: 0, value: 0 }];
    const cells = computeAnomalyCells(zeroCells, 'rainfall', 10);
    expect(cells[0].absoluteDelta).toBe(0);
  });

  it('handles zero baseline value for temperature (percentDelta = 0)', () => {
    const zeroCells = [{ lat: 0, lon: 0, value: 0 }];
    const cells = computeAnomalyCells(zeroCells, 'temp_max', 1.5);
    expect(cells[0].percentDelta).toBe(0);
  });
});

// ── anomalyDeltaToColor ───────────────────────────────────────────────────────

describe('anomalyDeltaToColor', () => {
  it('returns grey when maxDelta=0', () => {
    expect(anomalyDeltaToColor(5, 0)).toBe('rgb(128,128,128)');
  });

  it('returns white-ish for delta=0 (no anomaly)', () => {
    const color = anomalyDeltaToColor(0, 10);
    expect(color).toBe('rgb(255,255,255)');
  });

  it('returns red-family for positive delta', () => {
    const color = anomalyDeltaToColor(10, 10); // t=1
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    expect(r).toBe(255);
    expect(g).toBeLessThan(255);
    expect(b).toBeLessThan(255);
  });

  it('returns blue-family for negative delta', () => {
    const color = anomalyDeltaToColor(-10, 10); // t=-1
    const [r, , b] = color.match(/\d+/g)!.map(Number);
    expect(b).toBe(255);
    expect(r).toBeLessThan(255);
  });

  it('clamps delta beyond maxDelta', () => {
    // delta > maxDelta should clamp to maxDelta (t=1)
    const clampedColor = anomalyDeltaToColor(20, 10);
    const fullColor = anomalyDeltaToColor(10, 10);
    expect(clampedColor).toBe(fullColor);
  });

  it('returns rgb() format string', () => {
    expect(anomalyDeltaToColor(5, 10)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
});

// ── getActiveVulnerabilityZones ───────────────────────────────────────────────

describe('getActiveVulnerabilityZones', () => {
  it('returns zones active from 2030 when year=2030', () => {
    const zones = getActiveVulnerabilityZones(2030);
    expect(zones.every((z) => z.activeFromYear <= 2030)).toBe(true);
    expect(zones.length).toBeGreaterThan(0);
  });

  it('includes more zones for 2050 than for 2030', () => {
    const zones2030 = getActiveVulnerabilityZones(2030);
    const zones2050 = getActiveVulnerabilityZones(2050);
    expect(zones2050.length).toBeGreaterThanOrEqual(zones2030.length);
  });

  it('returns all VULNERABILITY_ZONES when year=2050 (all should be active)', () => {
    const zones = getActiveVulnerabilityZones(2050);
    expect(zones.length).toBe(VULNERABILITY_ZONES.length);
  });

  it('2040 returns superset of 2030 zones', () => {
    const zones2030 = getActiveVulnerabilityZones(2030);
    const zones2040 = getActiveVulnerabilityZones(2040);
    const ids2030 = new Set(zones2030.map((z) => z.id));
    zones2030.forEach((z) => {
      expect(zones2040.some((z40) => z40.id === z.id)).toBe(true);
    });
    expect(zones2040.length).toBeGreaterThanOrEqual(zones2030.length);
    // Silence "ids2030 is declared but its value is never read" warning
    void ids2030;
  });
});

// ── buildTimeMachineLabel ─────────────────────────────────────────────────────

describe('buildTimeMachineLabel', () => {
  it('returns "Present (2024)" at fraction=0', () => {
    expect(buildTimeMachineLabel(0, 2050)).toBe(`Present (${CURRENT_YEAR})`);
  });

  it('returns projection year string at fraction=1', () => {
    expect(buildTimeMachineLabel(1, 2050)).toBe('2050 Projection');
    expect(buildTimeMachineLabel(1, 2030)).toBe('2030 Projection');
  });

  it('returns interpolated year string at fraction=0.5 for 2050', () => {
    const label = buildTimeMachineLabel(0.5, 2050);
    // ~2037 (midpoint of 2024–2050)
    expect(label).toMatch(/^~\d{4}$/);
    const year = parseInt(label.slice(1), 10);
    expect(year).toBeGreaterThan(CURRENT_YEAR);
    expect(year).toBeLessThan(2050);
  });
});

// ── getProjectionData ─────────────────────────────────────────────────────────

describe('getProjectionData', () => {
  it('returns data for rcp45/2030', () => {
    const data = getProjectionData('rcp45', 2030);
    expect(data).toBeDefined();
    expect(data!.rcp).toBe('rcp45');
    expect(data!.year).toBe(2030);
  });

  it('returns data for rcp85/2050', () => {
    const data = getProjectionData('rcp85', 2050);
    expect(data).toBeDefined();
    expect(data!.tempMaxDeltaC).toBeGreaterThan(0);
  });

  it('rcp85 has greater tempMaxDeltaC than rcp45 for same year', () => {
    const rcp45 = getProjectionData('rcp45', 2050)!;
    const rcp85 = getProjectionData('rcp85', 2050)!;
    expect(rcp85.tempMaxDeltaC).toBeGreaterThan(rcp45.tempMaxDeltaC);
  });

  it('2050 has greater deltas than 2030 for same RCP', () => {
    const data2030 = getProjectionData('rcp85', 2030)!;
    const data2050 = getProjectionData('rcp85', 2050)!;
    expect(data2050.tempMaxDeltaC).toBeGreaterThan(data2030.tempMaxDeltaC);
  });

  it('all 6 scenario combinations are present', () => {
    expect(PROJECTION_SCENARIOS).toHaveLength(6);
    const rcps: Array<'rcp45' | 'rcp85'> = ['rcp45', 'rcp85'];
    const years: ProjectionYear[] = [2030, 2040, 2050];
    rcps.forEach((rcp) => {
      years.forEach((year) => {
        expect(getProjectionData(rcp, year)).toBeDefined();
      });
    });
  });
});

// ── Property Tests ────────────────────────────────────────────────────────────

/** Fraction arbitraries */
const fractionArb = fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true });
const anyFloatArb = fc.float({
  noNaN: true,
  noDefaultInfinity: true,
  min: Math.fround(-1e6),
  max: Math.fround(1e6),
});
const posFloatArb = fc.float({ min: Math.fround(0.001), max: Math.fround(1e6), noNaN: true });

describe('Property: interpolateProjection boundedness', () => {
  /**
   * For any present, future, and fraction t in [0,1],
   * the result is bounded: min(present,future) ≤ result ≤ max(present,future).
   *
   * Validates: Requirement 42.3 (smooth interpolation stays within range)
   */
  test.prop([anyFloatArb, anyFloatArb, fractionArb])(
    'result is bounded between min and max of present and future',
    (present, future, fraction) => {
      const result = interpolateProjection(present, future, fraction);
      const lo = Math.min(present, future);
      const hi = Math.max(present, future);
      expect(result).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(result).toBeLessThanOrEqual(hi + 1e-9);
    },
  );

  /**
   * Monotonicity: increasing t should move result from present toward future.
   */
  test.prop([anyFloatArb, anyFloatArb, fractionArb])(
    'interpolation is monotone with fraction when future >= present',
    (present, delta, fraction) => {
      const future = present + Math.abs(delta);
      const t2 = Math.min(1, fraction + 0.1);
      const r1 = interpolateProjection(present, future, fraction);
      const r2 = interpolateProjection(present, future, t2);
      expect(r2).toBeGreaterThanOrEqual(r1 - 1e-9);
    },
  );
});

describe('Property: computeEffectiveDelta scales delta linearly', () => {
  /**
   * computeEffectiveDelta(d, t) = t × d for t ∈ [0,1].
   * Validates: Requirement 42.3
   */
  test.prop([anyFloatArb, fractionArb])(
    'effective delta equals fraction × scenarioDelta',
    (scenarioDelta, fraction) => {
      const result = computeEffectiveDelta(scenarioDelta, fraction);
      expect(result).toBeCloseTo(fraction * scenarioDelta, 8);
    },
  );
});

describe('Property: anomalyDeltaToColor returns valid rgb string', () => {
  /**
   * For any delta and positive maxDelta, anomalyDeltaToColor returns
   * a well-formed "rgb(r,g,b)" string with each channel in [0,255].
   *
   * Validates: Requirement 42.2 (anomaly map rendering)
   */
  test.prop([anyFloatArb, posFloatArb])(
    'always returns rgb(r,g,b) with channels in [0,255]',
    (delta, maxDelta) => {
      const color = anomalyDeltaToColor(delta, maxDelta);
      expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      const [r, g, b] = color.match(/\d+/g)!.map(Number);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    },
  );
});

describe('Property: getActiveVulnerabilityZones monotone with year', () => {
  /**
   * For any two projection years y1 ≤ y2, zones(y1) ⊆ zones(y2).
   * Validates: Requirement 42.4 (zones appropriate to each timeframe)
   */
  const yearArb = fc.constantFrom<ProjectionYear>(2030, 2040, 2050);

  test.prop([yearArb, yearArb])(
    'zones for earlier year are a subset of zones for later year',
    (y1, y2) => {
      const earlier = y1 <= y2 ? y1 : y2;
      const later   = y1 <= y2 ? y2 : y1;
      const zonesEarlier = getActiveVulnerabilityZones(earlier);
      const zonesLater   = getActiveVulnerabilityZones(later);
      zonesEarlier.forEach((z) => {
        expect(zonesLater.some((zl) => zl.id === z.id)).toBe(true);
      });
    },
  );
});
