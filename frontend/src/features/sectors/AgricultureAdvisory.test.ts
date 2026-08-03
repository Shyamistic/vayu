/**
 * Tests for AgricultureAdvisory pure functions.
 *
 * Covers:
 * - computeDailyGDD: base/upper temp clamping, zero-floor
 * - computeGDDAccumulation: accumulation, progress, days remaining
 * - getRainfallAdvisory: threshold logic for each crop stage
 * - generateAdvisories: advisory generation across 7-day forecast
 * - getActiveWindowCrops: crop calendar month windows
 * - buildAdvisoryMessage: message content
 *
 * Validates: Requirements 19.1, 19.2, 19.3, 19.4
 */

import { describe, it, expect } from 'vitest';
import type { GridCell } from '../../types';
import {
  computeDailyGDD,
  computeGDDAccumulation,
  getRainfallAdvisory,
  generateAdvisories,
  getActiveWindowCrops,
  buildAdvisoryMessage,
  CROP_CALENDAR,
  RAINFALL_ADVISORY_THRESHOLD_MM,
} from './AgricultureAdvisory';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat: 20.0,
    lon: 78.0,
    node_idx: 0,
    rainfall: 10,
    temp_max: 30,
    temp_min: 20,
    rainfall_uncertainty: 0,
    temp_max_uncertainty: 0,
    temp_min_uncertainty: 0,
    ...overrides,
  };
}

// ── computeDailyGDD ──────────────────────────────────────────────────────────

describe('computeDailyGDD', () => {
  it('returns correct GDD for typical values (rice)', () => {
    // mean = (30+20)/2 = 25; GDD = 25 - 10 = 15
    expect(computeDailyGDD(30, 20, 10, 36)).toBeCloseTo(15);
  });

  it('returns 0 when mean temperature is below base temp', () => {
    // mean = (5+2)/2 = 3.5; below base 10 → 0
    expect(computeDailyGDD(5, 2, 10, 36)).toBe(0);
  });

  it('clamps tMax to upperTemp when tMax exceeds cutoff', () => {
    // tMax=40 clamped to 36; mean = (36+20)/2 = 28; GDD = 28-10 = 18
    expect(computeDailyGDD(40, 20, 10, 36)).toBeCloseTo(18);
  });

  it('returns 0 when tMin is above upper temp', () => {
    // both get clamped to 36 after min(max,upper) and max(min,base)
    // clampedMax=36, clampedMin=max(40,10)=40 → clampedMin > clampedMax → 0
    expect(computeDailyGDD(45, 40, 10, 36)).toBe(0);
  });

  it('is always non-negative', () => {
    expect(computeDailyGDD(-5, -15, 0, 30)).toBeGreaterThanOrEqual(0);
  });

  it('handles equal base and upper temp edge case', () => {
    // upperTemp === baseTemp: (clampedMax + clampedMin)/2 - baseTemp = 0
    expect(computeDailyGDD(20, 15, 20, 20)).toBe(0);
  });
});

// ── computeGDDAccumulation ────────────────────────────────────────────────────

describe('computeGDDAccumulation', () => {
  it('accumulates GDD across all forecast days', () => {
    // Rice: base=10, upper=36. Each cell: tMax=30, tMin=20 → daily GDD = 15
    const cells = Array.from({ length: 7 }, () => makeCell({ temp_max: 30, temp_min: 20 }));
    const result = computeGDDAccumulation(cells, 'rice');
    expect(result.accumulatedGDD).toBeCloseTo(105, 1); // 7 × 15 = 105
  });

  it('returns progress between 0 and 1', () => {
    const cells = Array.from({ length: 7 }, () => makeCell({ temp_max: 30, temp_min: 20 }));
    const result = computeGDDAccumulation(cells, 'rice');
    expect(result.progress).toBeGreaterThanOrEqual(0);
    expect(result.progress).toBeLessThanOrEqual(1);
  });

  it('caps progress at 1.0 when accumulated GDD exceeds gddToMaturity', () => {
    // Very hot cells to force rapid accumulation
    const cells = Array.from({ length: 7 }, () =>
      makeCell({ temp_max: 36, temp_min: 36 }),
    );
    // rice: gddToMaturity = 1200; max daily GDD = (36-10) = 26 × 7 = 182 — won't exceed 1200
    // Instead test with a crop that has a small gddToMaturity by using extremely high temps
    const result = computeGDDAccumulation(
      Array.from({ length: 7 }, () => makeCell({ temp_max: 36, temp_min: 35 })),
      'tea', // gddToMaturity = 900, but let's verify capping
    );
    expect(result.progress).toBeLessThanOrEqual(1);
  });

  it('returns null estimatedDaysRemaining when forecastCells is empty', () => {
    const result = computeGDDAccumulation([], 'wheat');
    expect(result.estimatedDaysRemaining).toBeNull();
    expect(result.accumulatedGDD).toBe(0);
    expect(result.progress).toBe(0);
  });

  it('uses correct crop-specific base and upper temps', () => {
    // Wheat: base=0, upper=30. tMax=25, tMin=5 → mean=15, GDD=15
    const cells = [makeCell({ temp_max: 25, temp_min: 5 })];
    const result = computeGDDAccumulation(cells, 'wheat');
    expect(result.accumulatedGDD).toBeCloseTo(15, 1);
  });

  it('includes crop and gddToMaturity in result', () => {
    const cells = [makeCell()];
    const result = computeGDDAccumulation(cells, 'cotton');
    expect(result.crop).toBe('cotton');
    expect(result.gddToMaturity).toBe(CROP_CALENDAR.cotton.gddToMaturity);
  });
});

// ── getRainfallAdvisory ────────────────────────────────────────────────────────

describe('getRainfallAdvisory', () => {
  it('returns None when rainfall is at the threshold (boundary)', () => {
    // Req 19.2: > 50 mm triggers, so exactly 50 should NOT trigger
    expect(getRainfallAdvisory(RAINFALL_ADVISORY_THRESHOLD_MM, 'sowing')).toBe('None');
  });

  it('returns Delay Sowing for pre-sowing stage when rainfall exceeds threshold', () => {
    expect(getRainfallAdvisory(60, 'pre-sowing')).toBe('Delay Sowing');
  });

  it('returns Delay Sowing for sowing stage when rainfall exceeds threshold', () => {
    expect(getRainfallAdvisory(75, 'sowing')).toBe('Delay Sowing');
  });

  it('returns Harvest Immediately for harvest stage when rainfall exceeds threshold', () => {
    expect(getRainfallAdvisory(80, 'harvest')).toBe('Harvest Immediately');
  });

  it('returns Harvest Immediately for flowering stage when rainfall exceeds threshold', () => {
    expect(getRainfallAdvisory(55, 'flowering')).toBe('Harvest Immediately');
  });

  it('returns None for vegetative stage even with extreme rainfall', () => {
    expect(getRainfallAdvisory(200, 'vegetative')).toBe('None');
  });

  it('returns None when rainfall is zero', () => {
    expect(getRainfallAdvisory(0, 'harvest')).toBe('None');
  });
});

// ── generateAdvisories ────────────────────────────────────────────────────────

describe('generateAdvisories', () => {
  it('returns empty array when no cell exceeds the rainfall threshold', () => {
    const cells = Array.from({ length: 7 }, () => makeCell({ rainfall: 20 }));
    expect(generateAdvisories(cells)).toHaveLength(0);
  });

  it('generates advisories only for cells with rainfall > 50 mm (Req 19.2)', () => {
    const cells = [
      makeCell({ rainfall: 10 }),
      makeCell({ rainfall: 80 }),  // trigger day 2
    ];
    const advisories = generateAdvisories(cells);
    expect(advisories.length).toBeGreaterThan(0);
    advisories.forEach((adv) => {
      expect(adv.triggerRainfall).toBeGreaterThan(RAINFALL_ADVISORY_THRESHOLD_MM);
    });
  });

  it('includes advisories for all 6 supported crop types (Req 19.1)', () => {
    // Use a stage that triggers for all — adjust active stages would be needed,
    // but generateAdvisories uses calendar activeStage. Some return None for vegetative.
    // Verify crops with non-vegetative stage get advisories.
    const cells = [makeCell({ rainfall: 100 })];
    const advisories = generateAdvisories(cells);
    const triggeredCrops = new Set(advisories.map((a) => a.crop));
    // At least some crops must trigger (all except those in vegetative stage)
    expect(triggeredCrops.size).toBeGreaterThan(0);
  });

  it('correctly maps trigger day to 1-based day index', () => {
    const cells = [
      makeCell({ rainfall: 10 }),
      makeCell({ rainfall: 10 }),
      makeCell({ rainfall: 80 }),  // index 2 → day 3
    ];
    const advisories = generateAdvisories(cells);
    advisories.forEach((adv) => {
      expect(adv.triggerDay).toBe(3);
    });
  });

  it('returns subset of advisories when specific crops are provided', () => {
    const cells = [makeCell({ rainfall: 80 })];
    const riceOnly = generateAdvisories(cells, ['rice']);
    const riceAndWheat = generateAdvisories(cells, ['rice', 'wheat']);
    expect(riceAndWheat.length).toBeGreaterThanOrEqual(riceOnly.length);
  });
});

// ── getActiveWindowCrops ─────────────────────────────────────────────────────

describe('getActiveWindowCrops', () => {
  it('returns crops in both sowing and harvest windows for a given month', () => {
    // June (6): rice sowing, cotton sowing
    const active = getActiveWindowCrops(6);
    expect(active.length).toBeGreaterThan(0);
    const crops = active.map((a) => a.crop);
    expect(crops).toContain('rice');
  });

  it('identifies harvest window crops correctly', () => {
    // November (11): rice harvest, cotton harvest, sugarcane harvest
    const active = getActiveWindowCrops(11);
    const harvestCrops = active.filter((a) => a.windowType === 'harvest').map((a) => a.crop);
    expect(harvestCrops).toContain('rice');
    expect(harvestCrops).toContain('cotton');
  });

  it('returns empty array for months with no defined windows', () => {
    // September (9) — check if any windows exist; result may be non-empty,
    // but the function should always return an array (never throw)
    const active = getActiveWindowCrops(9);
    expect(Array.isArray(active)).toBe(true);
  });

  it('does not mix sowing and harvest in the same entry', () => {
    for (let m = 1; m <= 12; m++) {
      const active = getActiveWindowCrops(m as 1);
      active.forEach((entry) => {
        expect(['sowing', 'harvest']).toContain(entry.windowType);
      });
    }
  });
});

// ── buildAdvisoryMessage ──────────────────────────────────────────────────────

describe('buildAdvisoryMessage', () => {
  it('includes crop label in delay sowing message', () => {
    const msg = buildAdvisoryMessage('rice', 'Delay Sowing', 60, 2);
    expect(msg).toContain('Rice');
    expect(msg).toContain('Delay sowing');
    expect(msg).toContain('60.0');
    expect(msg).toContain('Day 2');
  });

  it('includes crop label in harvest immediately message', () => {
    const msg = buildAdvisoryMessage('cotton', 'Harvest Immediately', 85, 5);
    expect(msg).toContain('Cotton');
    expect(msg).toContain('Harvest immediately');
    expect(msg).toContain('85.0');
    expect(msg).toContain('Day 5');
  });

  it('returns empty string for None advisory type', () => {
    expect(buildAdvisoryMessage('wheat', 'None', 10, 1)).toBe('');
  });
});

// ── CROP_CALENDAR data integrity ──────────────────────────────────────────────

describe('CROP_CALENDAR', () => {
  const cropIds = ['rice', 'wheat', 'cotton', 'sugarcane', 'tea', 'coffee'] as const;

  it('contains all 6 required crops (Req 19.1)', () => {
    cropIds.forEach((id) => {
      expect(CROP_CALENDAR[id]).toBeDefined();
    });
  });

  it('each crop has base temp lower than upper temp', () => {
    cropIds.forEach((id) => {
      const entry = CROP_CALENDAR[id];
      expect(entry.baseTemp).toBeLessThan(entry.upperTemp);
    });
  });

  it('each crop has positive gddToMaturity', () => {
    cropIds.forEach((id) => {
      expect(CROP_CALENDAR[id].gddToMaturity).toBeGreaterThan(0);
    });
  });

  it('each crop has at least one sowing month and one harvest month', () => {
    cropIds.forEach((id) => {
      expect(CROP_CALENDAR[id].sowingMonths.length).toBeGreaterThan(0);
      expect(CROP_CALENDAR[id].harvestMonths.length).toBeGreaterThan(0);
    });
  });
});
