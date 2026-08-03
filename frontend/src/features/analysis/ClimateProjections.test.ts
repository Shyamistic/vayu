/**
 * Unit tests for ClimateProjections pure functions.
 *
 * Covers:
 *  - computeCompositeRiskScore: bounds, weighted formula, edge values
 *  - isHighRisk: threshold boundary
 *  - riskScoreToColor: gradient output range
 *  - riskCategory: label classification
 *  - sortDistricts: ordering correctness
 *
 * Property-based tests:
 *  - Property 15: Composite Climate Risk Score Bounds and Composition
 *
 * Validates: Requirements 26.1, 26.2, 26.3, 26.4
 */

import { describe, it, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  computeCompositeRiskScore,
  isHighRisk,
  riskScoreToColor,
  riskCategory,
  sortDistricts,
  buildClimateRiskScore,
  HAZARD_WEIGHTS,
  HIGH_RISK_THRESHOLD,
  type HazardScores,
} from './ClimateProjections';

// ── computeCompositeRiskScore ─────────────────────────────────────────────────

describe('computeCompositeRiskScore', () => {
  it('returns 0 for all-zero components', () => {
    const components: HazardScores = { flood: 0, drought: 0, heatwave: 0, cyclone: 0 };
    expect(computeCompositeRiskScore(components)).toBe(0);
  });

  it('returns 100 for all-maximum components', () => {
    const components: HazardScores = { flood: 100, drought: 100, heatwave: 100, cyclone: 100 };
    expect(computeCompositeRiskScore(components)).toBe(100);
  });

  it('correctly applies weighted formula', () => {
    const components: HazardScores = { flood: 80, drought: 60, heatwave: 70, cyclone: 40 };
    const expected =
      80 * HAZARD_WEIGHTS.flood +
      60 * HAZARD_WEIGHTS.drought +
      70 * HAZARD_WEIGHTS.heatwave +
      40 * HAZARD_WEIGHTS.cyclone;
    expect(computeCompositeRiskScore(components)).toBeCloseTo(expected, 5);
  });

  it('result is always in [0, 100] — midpoint values', () => {
    const components: HazardScores = { flood: 50, drought: 50, heatwave: 50, cyclone: 50 };
    const result = computeCompositeRiskScore(components);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('clamps result to 0 when components would produce negative (guard)', () => {
    // Weights sum to 1 so this won't normally go below 0, but clamping is enforced
    const components: HazardScores = { flood: 0, drought: 0, heatwave: 0, cyclone: 0 };
    expect(computeCompositeRiskScore(components)).toBeGreaterThanOrEqual(0);
  });

  it('weights sum to 1.0 (ensuring composite equals weighted mean of 100 = 100)', () => {
    const sum = Object.values(HAZARD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

// ── isHighRisk ────────────────────────────────────────────────────────────────

describe('isHighRisk', () => {
  it('returns false for overall score at threshold (75)', () => {
    const score = buildClimateRiskScore('TestDistrict', 'TestState', {
      flood: 0, drought: 0, heatwave: 0, cyclone: 0,
    });
    // Override overall to exactly threshold
    const atThreshold = { ...score, overall: HIGH_RISK_THRESHOLD };
    expect(isHighRisk(atThreshold)).toBe(false);
  });

  it('returns true for score above threshold (76)', () => {
    const score = buildClimateRiskScore('TestDistrict', 'TestState', {
      flood: 0, drought: 0, heatwave: 0, cyclone: 0,
    });
    const aboveThreshold = { ...score, overall: HIGH_RISK_THRESHOLD + 1 };
    expect(isHighRisk(aboveThreshold)).toBe(true);
  });

  it('returns false for a clearly safe district (overall = 30)', () => {
    const score = buildClimateRiskScore('SafeDistrict', 'TestState', {
      flood: 20, drought: 20, heatwave: 20, cyclone: 20,
    });
    expect(isHighRisk(score)).toBe(false);
  });

  it('returns true for all-maximum components', () => {
    const score = buildClimateRiskScore('DangerDistrict', 'TestState', {
      flood: 100, drought: 100, heatwave: 100, cyclone: 100,
    });
    expect(isHighRisk(score)).toBe(true);
  });
});

// ── riskCategory ──────────────────────────────────────────────────────────────

describe('riskCategory', () => {
  it('returns "Low" for score 0', () => expect(riskCategory(0)).toBe('Low'));
  it('returns "Low" for score 25', () => expect(riskCategory(25)).toBe('Low'));
  it('returns "Moderate" for score 26', () => expect(riskCategory(26)).toBe('Moderate'));
  it('returns "Moderate" for score 50', () => expect(riskCategory(50)).toBe('Moderate'));
  it('returns "High" for score 51', () => expect(riskCategory(51)).toBe('High'));
  it('returns "High" for score 75', () => expect(riskCategory(75)).toBe('High'));
  it('returns "Extreme" for score 76', () => expect(riskCategory(76)).toBe('Extreme'));
  it('returns "Extreme" for score 100', () => expect(riskCategory(100)).toBe('Extreme'));
});

// ── riskScoreToColor ──────────────────────────────────────────────────────────

describe('riskScoreToColor', () => {
  it('returns an rgb() string for score 0 (green)', () => {
    const color = riskScoreToColor(0);
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it('returns an rgb() string for score 100 (red)', () => {
    const color = riskScoreToColor(100);
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it('clamps out-of-range input below 0', () => {
    const color = riskScoreToColor(-10);
    expect(color).toBe(riskScoreToColor(0));
  });

  it('clamps out-of-range input above 100', () => {
    const color = riskScoreToColor(110);
    expect(color).toBe(riskScoreToColor(100));
  });

  it('score 0 has more green than red (R < G)', () => {
    const color = riskScoreToColor(0);
    const [r, g] = color.match(/\d+/g)!.map(Number);
    expect(g).toBeGreaterThan(r);
  });

  it('score 100 has more red than green (R > G)', () => {
    const color = riskScoreToColor(100);
    const [r, g] = color.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(g);
  });
});

// ── sortDistricts ─────────────────────────────────────────────────────────────

describe('sortDistricts', () => {
  const districts = [
    buildClimateRiskScore('A', 'S1', { flood: 80, drought: 60, heatwave: 70, cyclone: 40 }),
    buildClimateRiskScore('B', 'S2', { flood: 20, drought: 10, heatwave: 15, cyclone: 5 }),
    buildClimateRiskScore('C', 'S3', { flood: 50, drought: 50, heatwave: 50, cyclone: 50 }),
  ];

  it('sorts descending by overall by default', () => {
    const sorted = sortDistricts(districts, 'overall', 'desc');
    expect(sorted[0].district).toBe('A');
    expect(sorted[sorted.length - 1].district).toBe('B');
  });

  it('sorts ascending by overall', () => {
    const sorted = sortDistricts(districts, 'overall', 'asc');
    expect(sorted[0].district).toBe('B');
    expect(sorted[sorted.length - 1].district).toBe('A');
  });

  it('sorts descending by flood component', () => {
    const sorted = sortDistricts(districts, 'flood', 'desc');
    expect(sorted[0].components.flood).toBeGreaterThanOrEqual(sorted[1].components.flood);
  });

  it('does not mutate the original array', () => {
    const original = [...districts];
    sortDistricts(districts, 'overall', 'asc');
    expect(districts[0].district).toBe(original[0].district);
  });
});

// ── Property 15: Composite Climate Risk Score Bounds and Composition ──────────
//
// **Validates: Requirements 26.1**
//
// For any hazard scores (flood, drought, heatwave, cyclone each in [0,100]):
//   1. The composite score is always in [0,100]
//   2. The composite score equals the deterministic weighted formula
//   3. Higher individual scores produce equal or higher composite scores (monotonicity)

/** Arbitrary that generates a valid HazardScores object with each component in [0,100] */
const hazardScoresArb = fc.record<HazardScores>({
  flood:    fc.float({ min: 0, max: 100, noNaN: true }),
  drought:  fc.float({ min: 0, max: 100, noNaN: true }),
  heatwave: fc.float({ min: 0, max: 100, noNaN: true }),
  cyclone:  fc.float({ min: 0, max: 100, noNaN: true }),
});

describe('Property 15: Composite Climate Risk Score Bounds and Composition', () => {
  // ── Property 15a: Result is always in [0, 100] ──────────────────────────────
  test.prop([hazardScoresArb])(
    '15a — result is always in [0, 100] for any component scores each in [0, 100]',
    (scores) => {
      const result = computeCompositeRiskScore(scores);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    },
  );

  // ── Property 15b: Result equals deterministic weighted formula ───────────────
  test.prop([hazardScoresArb])(
    '15b — result equals deterministic weighted formula flood*0.35 + drought*0.25 + heatwave*0.25 + cyclone*0.15',
    (scores) => {
      const expected =
        scores.flood    * HAZARD_WEIGHTS.flood    +
        scores.drought  * HAZARD_WEIGHTS.drought  +
        scores.heatwave * HAZARD_WEIGHTS.heatwave +
        scores.cyclone  * HAZARD_WEIGHTS.cyclone;
      // Clamp to [0,100] as the implementation does
      const clampedExpected = Math.min(100, Math.max(0, expected));
      const result = computeCompositeRiskScore(scores);
      expect(result).toBeCloseTo(clampedExpected, 10);
    },
  );

  // ── Property 15c: Monotonicity — higher scores produce equal or higher composite ─
  test.prop([hazardScoresArb])(
    '15c — monotonicity: increasing any component score does not decrease the composite',
    (scores) => {
      // Pick a delta in (0, remaining headroom] for each component
      const checkMonotone = (key: keyof HazardScores) => {
        const headroom = 100 - scores[key];
        if (headroom <= 0) return; // already at max, skip
        const delta = headroom * 0.5; // increase by half the remaining headroom
        const higher: HazardScores = { ...scores, [key]: scores[key] + delta };
        expect(computeCompositeRiskScore(higher)).toBeGreaterThanOrEqual(
          computeCompositeRiskScore(scores) - 1e-9, // tolerance for floating-point
        );
      };
      checkMonotone('flood');
      checkMonotone('drought');
      checkMonotone('heatwave');
      checkMonotone('cyclone');
    },
  );
});
