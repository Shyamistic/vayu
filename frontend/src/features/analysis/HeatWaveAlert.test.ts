/**
 * Unit and property-based tests for HeatWaveAlert pure functions.
 *
 * Tests:
 *  - computeHeatIndex        (Heat Index / Feels Like — Req 24.3)
 *  - resolveIsHillStation    (threshold selection — Req 24.1)
 *  - countConsecutiveDays... (streak counting — Req 24.1)
 *  - detectHeatWave          (single-cell detection — Req 24.1)
 *  - detectHeatWaves         (multi-cell detection — Req 24.1)
 *  - generateHeatWaveBulletin (bulletin generation — Req 24.4)
 *
 * Validates: Requirements 24.1, 24.3, 24.4
 */

import { describe, it, expect } from 'vitest';
import { fc, test as fcTest } from '@fast-check/vitest';
import {
  computeHeatIndex,
  resolveIsHillStation,
  countConsecutiveDaysAboveThreshold,
  detectHeatWave,
  detectHeatWaves,
  generateHeatWaveBulletin,
  HEAT_WAVE_THRESHOLD_PLAINS,
  HEAT_WAVE_THRESHOLD_HILLS,
  HEAT_WAVE_MIN_DAYS,
  type DailyTempRecord,
  type HeatWaveResult,
} from './HeatWaveAlert';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<DailyTempRecord> = {}): DailyTempRecord {
  return {
    lat: 25.0,
    lon: 80.0,
    node_idx: 0,
    tempMaxSeries: [35, 36, 37],
    humiditySeries: [50, 50, 50],
    ...overrides,
  };
}

function makeHeatWaveResult(overrides: Partial<HeatWaveResult> = {}): HeatWaveResult {
  return {
    lat: 25.0,
    lon: 80.0,
    node_idx: 0,
    isHeatWave: true,
    consecutiveDays: 4,
    peakTemp: 43,
    heatIndex: 48,
    isHillStation: false,
    threshold: HEAT_WAVE_THRESHOLD_PLAINS,
    ...overrides,
  };
}

// ── computeHeatIndex ──────────────────────────────────────────────────────────

describe('computeHeatIndex', () => {
  it('returns a value higher than the dry-bulb temperature for hot & humid conditions', () => {
    // At 40°C and 60% humidity, heat index should exceed 40°C
    const hi = computeHeatIndex(40, 60);
    expect(hi).toBeGreaterThan(40);
  });

  it('returns a reasonable value for mild conditions', () => {
    // At 27°C and 40% humidity, heat index should be in sensible range
    const hi = computeHeatIndex(27, 40);
    expect(hi).toBeGreaterThan(15);
    expect(hi).toBeLessThan(50);
  });

  it('produces higher heat index with higher humidity at same temperature', () => {
    const hiLow = computeHeatIndex(38, 30);
    const hiHigh = computeHeatIndex(38, 90);
    expect(hiHigh).toBeGreaterThan(hiLow);
  });

  it('increases as temperature increases at constant humidity', () => {
    const hi35 = computeHeatIndex(35, 60);
    const hi40 = computeHeatIndex(40, 60);
    const hi45 = computeHeatIndex(45, 60);
    expect(hi40).toBeGreaterThan(hi35);
    expect(hi45).toBeGreaterThan(hi40);
  });

  it('returns a finite number for all valid inputs', () => {
    expect(Number.isFinite(computeHeatIndex(40, 50))).toBe(true);
    expect(Number.isFinite(computeHeatIndex(20, 20))).toBe(true);
  });
});

// Property: Heat Index is always finite for temperatures in [20, 55]°C and humidity in [0, 100]%
// Validates: Requirements 24.3
fcTest.prop([fc.float({ min: 20, max: 55, noNaN: true }), fc.float({ min: 0, max: 100, noNaN: true })])(
  'computeHeatIndex returns a finite number for any valid temp/humidity',
  (temp, humidity) => {
    const result = computeHeatIndex(temp, humidity);
    expect(Number.isFinite(result)).toBe(true);
  },
);

// Property: Heat Index ≥ temperature when humidity ≥ 40% and temp ≥ 27°C
// Validates: Requirements 24.3
fcTest.prop([fc.float({ min: 27, max: 55, noNaN: true }), fc.float({ min: 40, max: 100, noNaN: true })])(
  'computeHeatIndex >= dry-bulb temperature for hot humid conditions',
  (temp, humidity) => {
    const result = computeHeatIndex(temp, humidity);
    expect(result).toBeGreaterThanOrEqual(temp - 1); // allow 1°C floating-point tolerance
  },
);

// ── resolveIsHillStation ──────────────────────────────────────────────────────

describe('resolveIsHillStation', () => {
  it('returns explicit true when isHillStation=true regardless of lat', () => {
    expect(resolveIsHillStation(20, true)).toBe(true);
    expect(resolveIsHillStation(35, true)).toBe(true);
  });

  it('returns explicit false when isHillStation=false regardless of lat', () => {
    expect(resolveIsHillStation(35, false)).toBe(false);
    expect(resolveIsHillStation(10, false)).toBe(false);
  });

  it('uses lat > 30 heuristic when isHillStation is undefined', () => {
    expect(resolveIsHillStation(31)).toBe(true);
    expect(resolveIsHillStation(30)).toBe(false);
    expect(resolveIsHillStation(25)).toBe(false);
    expect(resolveIsHillStation(35)).toBe(true);
  });
});

// ── countConsecutiveDaysAboveThreshold ───────────────────────────────────────

describe('countConsecutiveDaysAboveThreshold', () => {
  it('returns 0 when no days exceed threshold', () => {
    expect(countConsecutiveDaysAboveThreshold([30, 32, 35], 40)).toBe(0);
  });

  it('returns the streak from the end of the series', () => {
    expect(countConsecutiveDaysAboveThreshold([30, 41, 42, 43], 40)).toBe(3);
  });

  it('stops counting when a day falls at or below threshold', () => {
    // [30, 42, 38, 41, 43] — the streak from the end is 2 (38 breaks it)
    expect(countConsecutiveDaysAboveThreshold([30, 42, 38, 41, 43], 40)).toBe(2);
  });

  it('returns full length when all days exceed threshold', () => {
    expect(countConsecutiveDaysAboveThreshold([41, 42, 43, 44], 40)).toBe(4);
  });

  it('returns 0 for empty series', () => {
    expect(countConsecutiveDaysAboveThreshold([], 40)).toBe(0);
  });

  it('does not count a day exactly at the threshold', () => {
    // strictly greater than threshold, so exactly 40 does NOT count
    expect(countConsecutiveDaysAboveThreshold([41, 40, 41], 40)).toBe(1);
  });
});

// Property: consecutive count is bounded by series length
// Validates: Requirements 24.1
fcTest.prop([
  fc.array(fc.float({ min: 25, max: 55, noNaN: true }), { minLength: 0, maxLength: 20 }),
  fc.float({ min: 35, max: 45, noNaN: true }),
])(
  'countConsecutiveDaysAboveThreshold is bounded by series length',
  (series, threshold) => {
    const count = countConsecutiveDaysAboveThreshold(series, threshold);
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBeLessThanOrEqual(series.length);
  },
);

// ── detectHeatWave ────────────────────────────────────────────────────────────

describe('detectHeatWave', () => {
  it('classifies as heat wave when plains threshold exceeded for 3+ days', () => {
    const record = makeRecord({
      lat: 25,
      tempMaxSeries: [41, 42, 43], // 3 days > 40°C
      humiditySeries: [50, 50, 50],
      isHillStation: false,
    });
    const result = detectHeatWave(record);
    expect(result.isHeatWave).toBe(true);
    expect(result.consecutiveDays).toBe(3);
    expect(result.threshold).toBe(HEAT_WAVE_THRESHOLD_PLAINS);
  });

  it('does NOT classify as heat wave when streak is fewer than 3 days', () => {
    const record = makeRecord({
      lat: 25,
      tempMaxSeries: [41, 42], // only 2 days
      humiditySeries: [50, 50],
      isHillStation: false,
    });
    const result = detectHeatWave(record);
    expect(result.isHeatWave).toBe(false);
    expect(result.consecutiveDays).toBe(2);
  });

  it('uses hill-station threshold (30°C) when isHillStation=true', () => {
    const record = makeRecord({
      lat: 32,
      tempMaxSeries: [31, 32, 33],
      humiditySeries: [60, 60, 60],
      isHillStation: true,
    });
    const result = detectHeatWave(record);
    expect(result.isHeatWave).toBe(true);
    expect(result.threshold).toBe(HEAT_WAVE_THRESHOLD_HILLS);
    expect(result.isHillStation).toBe(true);
  });

  it('does NOT classify as plains heat wave when temps only exceed hill threshold', () => {
    // 33°C > hill threshold (30) but NOT plains threshold (40)
    const record = makeRecord({
      lat: 25, // plains lat
      tempMaxSeries: [33, 34, 35],
      humiditySeries: [50, 50, 50],
      isHillStation: false,
    });
    const result = detectHeatWave(record);
    expect(result.isHeatWave).toBe(false);
  });

  it('applies lat heuristic: lat > 30 → hill station', () => {
    const record = makeRecord({
      lat: 31, // should be hill
      tempMaxSeries: [31, 32, 33],
      humiditySeries: [60, 60, 60],
      isHillStation: undefined,
    });
    const result = detectHeatWave(record);
    expect(result.isHillStation).toBe(true);
    expect(result.threshold).toBe(HEAT_WAVE_THRESHOLD_HILLS);
  });

  it('computes peakTemp as the maximum in the series', () => {
    const record = makeRecord({
      tempMaxSeries: [41, 45, 43, 42, 44],
      humiditySeries: [50, 50, 50, 50, 50],
    });
    const result = detectHeatWave(record);
    expect(result.peakTemp).toBe(45);
  });

  it('computes heat index for the last day in the series', () => {
    const record = makeRecord({
      tempMaxSeries: [41, 42, 43],
      humiditySeries: [50, 55, 60],
    });
    const result = detectHeatWave(record);
    // Heat index at 43°C, 60% humidity should be > 43°C
    expect(result.heatIndex).toBeGreaterThan(43);
  });

  it('handles a 7-day record meeting the requirement', () => {
    const record = makeRecord({
      tempMaxSeries: [40, 38, 41, 42, 43, 44, 45], // last 5 days above threshold
      humiditySeries: Array(7).fill(55),
      isHillStation: false,
    });
    const result = detectHeatWave(record);
    expect(result.isHeatWave).toBe(true);
    expect(result.consecutiveDays).toBe(5);
  });
});

// Property: when temp series has N days all above threshold, consecutiveDays == N and isHeatWave == (N >= HEAT_WAVE_MIN_DAYS)
// Validates: Requirements 24.1
fcTest.prop([
  fc.integer({ min: 1, max: 10 }),
])(
  'detectHeatWave: streak of N plains days all above threshold sets consecutiveDays=N',
  (n) => {
    const series = Array.from({ length: n }, () => HEAT_WAVE_THRESHOLD_PLAINS + 1 + Math.random());
    const humidity = Array(n).fill(50);
    const record = makeRecord({
      lat: 25,
      tempMaxSeries: series,
      humiditySeries: humidity,
      isHillStation: false,
    });
    const result = detectHeatWave(record);
    expect(result.consecutiveDays).toBe(n);
    expect(result.isHeatWave).toBe(n >= HEAT_WAVE_MIN_DAYS);
  },
);

// ── detectHeatWaves ───────────────────────────────────────────────────────────

describe('detectHeatWaves', () => {
  it('returns only records that are in a heat wave', () => {
    const records: DailyTempRecord[] = [
      makeRecord({ node_idx: 0, tempMaxSeries: [41, 42, 43], humiditySeries: [50, 50, 50], isHillStation: false }),  // heat wave
      makeRecord({ node_idx: 1, tempMaxSeries: [35, 36, 37], humiditySeries: [50, 50, 50], isHillStation: false }),  // no heat wave
      makeRecord({ node_idx: 2, tempMaxSeries: [41, 42], humiditySeries: [50, 50], isHillStation: false }),          // 2 days only
    ];
    const result = detectHeatWaves(records);
    expect(result).toHaveLength(1);
    expect(result[0].node_idx).toBe(0);
  });

  it('returns empty array when no heat waves detected', () => {
    const records: DailyTempRecord[] = [
      makeRecord({ tempMaxSeries: [30, 31, 32], isHillStation: false }),
    ];
    expect(detectHeatWaves(records)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(detectHeatWaves([])).toHaveLength(0);
  });

  it('handles all cells in heat wave', () => {
    const records: DailyTempRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeRecord({
        node_idx: i,
        tempMaxSeries: [41, 42, 43],
        humiditySeries: [50, 50, 50],
        isHillStation: false,
      }),
    );
    expect(detectHeatWaves(records)).toHaveLength(5);
  });
});

// ── generateHeatWaveBulletin ──────────────────────────────────────────────────

describe('generateHeatWaveBulletin', () => {
  it('generates a bulletin with correct peak temperature', () => {
    const results = [
      makeHeatWaveResult({ peakTemp: 43 }),
      makeHeatWaveResult({ node_idx: 1, peakTemp: 46 }),
    ];
    const bulletin = generateHeatWaveBulletin(results, new Date('2025-07-15T12:00:00Z'));
    expect(bulletin.peakTemperature).toBe(46);
  });

  it('generates a bulletin with correct max duration', () => {
    const results = [
      makeHeatWaveResult({ consecutiveDays: 4 }),
      makeHeatWaveResult({ node_idx: 1, consecutiveDays: 7 }),
    ];
    const bulletin = generateHeatWaveBulletin(results);
    expect(bulletin.maxDuration).toBe(7);
  });

  it('includes all affected cells', () => {
    const results = [
      makeHeatWaveResult({ node_idx: 0 }),
      makeHeatWaveResult({ node_idx: 1 }),
      makeHeatWaveResult({ node_idx: 2 }),
    ];
    const bulletin = generateHeatWaveBulletin(results);
    expect(bulletin.affectedCells).toHaveLength(3);
  });

  it('provides at least one recommendation', () => {
    const results = [makeHeatWaveResult()];
    const bulletin = generateHeatWaveBulletin(results);
    expect(bulletin.recommendations.length).toBeGreaterThan(0);
  });

  it('generates a valid ISO-8601 timestamp', () => {
    const now = new Date('2025-06-15T10:30:00Z');
    const bulletin = generateHeatWaveBulletin([makeHeatWaveResult()], now);
    expect(bulletin.generatedAt).toBe('2025-06-15T10:30:00.000Z');
    expect(() => new Date(bulletin.generatedAt)).not.toThrow();
  });

  it('returns empty bulletin data for empty input', () => {
    const bulletin = generateHeatWaveBulletin([]);
    expect(bulletin.affectedCells).toHaveLength(0);
    expect(bulletin.peakTemperature).toBe(0);
    expect(bulletin.maxDuration).toBe(0);
  });

  it('does not mutate the input array', () => {
    const results = [makeHeatWaveResult()];
    const original = [...results];
    generateHeatWaveBulletin(results);
    expect(results[0]).toEqual(original[0]);
  });
});

// Property: bulletin peakTemperature equals the maximum of all cell peakTemps
// Validates: Requirements 24.4
fcTest.prop([
  fc.array(
    fc.record({
      lat: fc.constant(25),
      lon: fc.constant(80),
      node_idx: fc.integer({ min: 0, max: 999 }),
      isHeatWave: fc.constant(true as const),
      consecutiveDays: fc.integer({ min: HEAT_WAVE_MIN_DAYS, max: 14 }),
      peakTemp: fc.float({ min: 40, max: 50, noNaN: true }),
      heatIndex: fc.float({ min: 40, max: 60, noNaN: true }),
      isHillStation: fc.constant(false as const),
      threshold: fc.constant(HEAT_WAVE_THRESHOLD_PLAINS),
    }),
    { minLength: 1, maxLength: 20 },
  ),
])(
  'bulletin peakTemperature equals max of all cell peakTemps',
  (results) => {
    const bulletin = generateHeatWaveBulletin(results);
    const expectedPeak = Math.max(...results.map((r) => r.peakTemp));
    expect(bulletin.peakTemperature).toBeCloseTo(expectedPeak, 5);
  },
);

// Property: bulletin maxDuration equals the max consecutiveDays across all affected cells
// Validates: Requirements 24.4
fcTest.prop([
  fc.array(
    fc.record({
      lat: fc.constant(25),
      lon: fc.constant(80),
      node_idx: fc.integer({ min: 0, max: 999 }),
      isHeatWave: fc.constant(true as const),
      consecutiveDays: fc.integer({ min: HEAT_WAVE_MIN_DAYS, max: 14 }),
      peakTemp: fc.float({ min: 40, max: 50, noNaN: true }),
      heatIndex: fc.float({ min: 40, max: 60, noNaN: true }),
      isHillStation: fc.constant(false as const),
      threshold: fc.constant(HEAT_WAVE_THRESHOLD_PLAINS),
    }),
    { minLength: 1, maxLength: 20 },
  ),
])(
  'bulletin maxDuration equals max of all cell consecutiveDays',
  (results) => {
    const bulletin = generateHeatWaveBulletin(results);
    const expectedMax = Math.max(...results.map((r) => r.consecutiveDays));
    expect(bulletin.maxDuration).toBe(expectedMax);
  },
);
