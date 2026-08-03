/**
 * Unit tests for AnomalyDetection pure functions.
 *
 * Tests classifyAnomaly, detectAnomalies, and sortBySeverity.
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4
 */

import { describe, it, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  classifyAnomaly,
  detectAnomalies,
  sortBySeverity,
  SEVERITY_SCORE,
  type AnomalyResult,
  type AnomalySeverity,
} from './AnomalyDetection';
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

// ── classifyAnomaly tests ────────────────────────────────────────────────────

describe('classifyAnomaly', () => {
  const mean = 100;
  const stdDev = 10;

  it('returns "none" when |value - mean| < 1.5σ', () => {
    expect(classifyAnomaly(100, mean, stdDev)).toBe('none');
    expect(classifyAnomaly(105, mean, stdDev)).toBe('none');
    expect(classifyAnomaly(86, mean, stdDev)).toBe('none'); // 1.4σ
    expect(classifyAnomaly(114.9, mean, stdDev)).toBe('none'); // just under 1.5σ
  });

  it('returns "warning" when 1.5σ ≤ |value - mean| < 2σ', () => {
    expect(classifyAnomaly(115, mean, stdDev)).toBe('warning'); // exactly 1.5σ
    expect(classifyAnomaly(85, mean, stdDev)).toBe('warning'); // 1.5σ below
    expect(classifyAnomaly(119, mean, stdDev)).toBe('warning'); // 1.9σ
    expect(classifyAnomaly(81, mean, stdDev)).toBe('warning'); // 1.9σ below
  });

  it('returns "severe" when 2σ ≤ |value - mean| < 3σ', () => {
    expect(classifyAnomaly(120, mean, stdDev)).toBe('severe'); // exactly 2σ
    expect(classifyAnomaly(80, mean, stdDev)).toBe('severe'); // 2σ below
    expect(classifyAnomaly(129, mean, stdDev)).toBe('severe'); // 2.9σ
    expect(classifyAnomaly(71, mean, stdDev)).toBe('severe'); // 2.9σ below
  });

  it('returns "extreme" when |value - mean| ≥ 3σ', () => {
    expect(classifyAnomaly(130, mean, stdDev)).toBe('extreme'); // exactly 3σ
    expect(classifyAnomaly(70, mean, stdDev)).toBe('extreme'); // 3σ below
    expect(classifyAnomaly(150, mean, stdDev)).toBe('extreme'); // 5σ
    expect(classifyAnomaly(50, mean, stdDev)).toBe('extreme'); // 5σ below
  });

  it('returns "none" when stdDev is 0', () => {
    expect(classifyAnomaly(150, 100, 0)).toBe('none');
  });

  it('returns "none" when stdDev is negative', () => {
    expect(classifyAnomaly(150, 100, -5)).toBe('none');
  });

  it('handles value exactly at mean', () => {
    expect(classifyAnomaly(100, 100, 10)).toBe('none');
  });
});

// ── detectAnomalies tests ────────────────────────────────────────────────────

describe('detectAnomalies', () => {
  const climatology = { mean: 20, stdDev: 5 };

  it('returns empty array when no anomalies exist', () => {
    const cells = [
      makeCell({ rainfall: 20 }),
      makeCell({ rainfall: 22 }), // 0.4σ
      makeCell({ rainfall: 18 }), // 0.4σ
    ];
    const result = detectAnomalies(cells, climatology, 'rainfall');
    expect(result).toHaveLength(0);
  });

  it('detects warning-level anomalies', () => {
    const cells = [makeCell({ rainfall: 28 })]; // 1.6σ
    const result = detectAnomalies(cells, climatology, 'rainfall');
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');
    expect(result[0].departure).toBeCloseTo(8, 5);
    expect(result[0].sigmaValue).toBeCloseTo(1.6, 5);
  });

  it('detects severe-level anomalies', () => {
    const cells = [makeCell({ rainfall: 32 })]; // 2.4σ
    const result = detectAnomalies(cells, climatology, 'rainfall');
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('severe');
  });

  it('detects extreme-level anomalies', () => {
    const cells = [makeCell({ rainfall: 36 })]; // 3.2σ
    const result = detectAnomalies(cells, climatology, 'rainfall');
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('extreme');
  });

  it('handles multiple cells with mixed severities', () => {
    const cells = [
      makeCell({ node_idx: 0, rainfall: 20 }),  // none
      makeCell({ node_idx: 1, rainfall: 28 }),  // warning (1.6σ)
      makeCell({ node_idx: 2, rainfall: 32 }),  // severe (2.4σ)
      makeCell({ node_idx: 3, rainfall: 40 }),  // extreme (4σ)
    ];
    const result = detectAnomalies(cells, climatology, 'rainfall');
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.severity)).toEqual(['warning', 'severe', 'extreme']);
  });

  it('works with temp_max variable', () => {
    const cells = [makeCell({ temp_max: 50 })]; // (50-20)/5 = 6σ
    const result = detectAnomalies(cells, climatology, 'temp_max');
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('extreme');
    expect(result[0].variable).toBe('temp_max');
  });

  it('returns empty array for empty grid cells', () => {
    expect(detectAnomalies([], climatology, 'rainfall')).toHaveLength(0);
  });
});

// ── sortBySeverity tests ─────────────────────────────────────────────────────

describe('sortBySeverity', () => {
  function makeAnomaly(
    severity: AnomalySeverity,
    sigmaValue: number,
  ): AnomalyResult {
    return {
      cell: makeCell(),
      severity,
      departure: sigmaValue * 5,
      sigmaValue,
      variable: 'rainfall',
    };
  }

  it('sorts by severity descending (extreme first, warning last)', () => {
    const anomalies = [
      makeAnomaly('warning', 1.6),
      makeAnomaly('extreme', 3.5),
      makeAnomaly('severe', 2.5),
    ];
    const sorted = sortBySeverity(anomalies);
    expect(sorted[0].severity).toBe('extreme');
    expect(sorted[1].severity).toBe('severe');
    expect(sorted[2].severity).toBe('warning');
  });

  it('breaks ties using sigmaValue (higher sigma first)', () => {
    const anomalies = [
      makeAnomaly('extreme', 3.1),
      makeAnomaly('extreme', 5.0),
      makeAnomaly('extreme', 3.8),
    ];
    const sorted = sortBySeverity(anomalies);
    expect(sorted[0].sigmaValue).toBe(5.0);
    expect(sorted[1].sigmaValue).toBe(3.8);
    expect(sorted[2].sigmaValue).toBe(3.1);
  });

  it('returns empty array for empty input', () => {
    expect(sortBySeverity([])).toHaveLength(0);
  });

  it('does not mutate the original array', () => {
    const anomalies = [
      makeAnomaly('warning', 1.6),
      makeAnomaly('extreme', 3.5),
    ];
    const original = [...anomalies];
    sortBySeverity(anomalies);
    expect(anomalies[0].severity).toBe(original[0].severity);
    expect(anomalies[1].severity).toBe(original[1].severity);
  });

  it('handles single element array', () => {
    const anomalies = [makeAnomaly('severe', 2.5)];
    const sorted = sortBySeverity(anomalies);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].severity).toBe('severe');
  });
});


// ── Property-Based Tests ─────────────────────────────────────────────────────

/**
 * **Validates: Requirements 14.4**
 *
 * Property 12: Anomaly Summary Sorting
 *
 * For any list of anomalous cells with severity scores, the Extreme Event
 * Summary panel SHALL present them sorted in descending order by severity
 * score. Ties in severity are broken by sigmaValue descending.
 */

/** Arbitrary for AnomalySeverity (excluding 'none' — only anomalous cells). */
const arb_severity = fc.constantFrom<AnomalySeverity>(
  'warning',
  'severe',
  'extreme',
);

/** Arbitrary for a single AnomalyResult with a given severity and sigmaValue. */
const arb_anomalyResult: fc.Arbitrary<AnomalyResult> = fc
  .tuple(
    arb_severity,
    fc.float({ min: 1.5, max: 10, noNaN: true }),
  )
  .map(([severity, sigmaValue]) => ({
    cell: {
      lat: 20.0,
      lon: 75.0,
      node_idx: 0,
      rainfall: 10,
      temp_max: 35,
      temp_min: 25,
      rainfall_uncertainty: 2,
      temp_max_uncertainty: 1,
      temp_min_uncertainty: 1,
    },
    severity,
    departure: sigmaValue * 5,
    sigmaValue,
    variable: 'rainfall' as const,
  }));

describe('sortBySeverity — property-based tests', () => {
  /**
   * Property 12a: Descending severity order.
   *
   * For any randomly generated list of AnomalyResult objects, each pair of
   * adjacent elements in the sorted output must satisfy:
   *   SEVERITY_SCORE[sorted[i]] >= SEVERITY_SCORE[sorted[i+1]]
   */
  test.prop([fc.array(arb_anomalyResult, { minLength: 0, maxLength: 50 })])(
    'sorted output is in descending severity order for any input list',
    (anomalies) => {
      const sorted = sortBySeverity(anomalies);

      for (let i = 0; i < sorted.length - 1; i++) {
        expect(SEVERITY_SCORE[sorted[i].severity]).toBeGreaterThanOrEqual(
          SEVERITY_SCORE[sorted[i + 1].severity],
        );
      }
    },
  );

  /**
   * Property 12b: Tie-breaking by sigmaValue descending.
   *
   * For any two adjacent elements with equal severity, the element with the
   * higher sigmaValue must appear first.
   */
  test.prop([fc.array(arb_anomalyResult, { minLength: 0, maxLength: 50 })])(
    'ties in severity are broken by sigmaValue descending',
    (anomalies) => {
      const sorted = sortBySeverity(anomalies);

      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].severity === sorted[i + 1].severity) {
          expect(sorted[i].sigmaValue).toBeGreaterThanOrEqual(
            sorted[i + 1].sigmaValue,
          );
        }
      }
    },
  );

  /**
   * Property 12c: Output length equals input length.
   *
   * Sorting must not drop or duplicate any elements.
   */
  test.prop([fc.array(arb_anomalyResult, { minLength: 0, maxLength: 50 })])(
    'sorted output has the same length as the input',
    (anomalies) => {
      const sorted = sortBySeverity(anomalies);
      expect(sorted).toHaveLength(anomalies.length);
    },
  );

  /**
   * Property 12d: Original array is not mutated.
   *
   * sortBySeverity must be a pure function that returns a new array.
   */
  test.prop([fc.array(arb_anomalyResult, { minLength: 1, maxLength: 50 })])(
    'does not mutate the original input array',
    (anomalies) => {
      const snapshot = anomalies.map((a) => ({
        severity: a.severity,
        sigmaValue: a.sigmaValue,
      }));
      sortBySeverity(anomalies);
      anomalies.forEach((a, i) => {
        expect(a.severity).toBe(snapshot[i].severity);
        expect(a.sigmaValue).toBe(snapshot[i].sigmaValue);
      });
    },
  );

  /**
   * Property 12e: Extreme cells always precede warning cells.
   *
   * For any list containing at least one 'extreme' and one 'warning' result,
   * the last 'extreme' must appear before the first 'warning' in the sorted
   * output.
   */
  test.prop([fc.array(arb_anomalyResult, { minLength: 2, maxLength: 50 })])(
    'all extreme results appear before all warning results in sorted output',
    (anomalies) => {
      const sorted = sortBySeverity(anomalies);

      const lastExtremeIdx = sorted.map((a) => a.severity).lastIndexOf('extreme');
      const firstWarningIdx = sorted.map((a) => a.severity).indexOf('warning');

      // Only check the constraint when both severities are present
      if (lastExtremeIdx !== -1 && firstWarningIdx !== -1) {
        expect(lastExtremeIdx).toBeLessThan(firstWarningIdx);
      }
    },
  );
});
