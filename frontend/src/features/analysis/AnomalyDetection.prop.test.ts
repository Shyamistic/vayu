/**
 * Property-Based Test: Anomaly Severity Classification
 *
 * **Validates: Requirements 14.1, 14.2**
 *
 * Property 11: For any grid cell value and given climatological mean and
 * standard deviation, the anomaly classifier SHALL produce:
 * - No alert  if |value - mean| < 1.5σ
 * - Warning   if 1.5σ ≤ |value - mean| < 2σ
 * - Severe    if 2σ ≤ |value - mean| < 3σ
 * - Extreme   if |value - mean| ≥ 3σ
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { classifyAnomaly } from './AnomalyDetection';

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * A positive, finite standard deviation (stdDev > 0).
 * We exclude 0 and negatives because the function correctly short-circuits
 * to 'none' in those cases (tested separately below).
 */
const positiveStdDevArb = fc.double({ min: 0.001, max: 1000, noNaN: true, noDefaultInfinity: true });

/**
 * A finite mean in a realistic numeric range.
 */
const meanArb = fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true });

// ── Property 11: σ-tier classification correctness ────────────────────────────

describe('Property 11: Anomaly Severity Classification', () => {
  /**
   * For any value/mean/stdDev with |value - mean| < 1.5σ,
   * classifyAnomaly SHALL return 'none'.
   */
  test.prop([
    meanArb,
    positiveStdDevArb,
    // value offset constrained to (-1.5σ, +1.5σ) exclusive — use 0..1.4999 × σ
    fc.double({ min: 0, max: 1.4999, noNaN: true, noDefaultInfinity: true }),
    fc.boolean(), // sign of offset
  ])(
    'returns "none" when |value - mean| < 1.5σ',
    (mean, stdDev, sigmaFraction, negative) => {
      const offset = sigmaFraction * stdDev;
      const value = mean + (negative ? -offset : offset);

      const result = classifyAnomaly(value, mean, stdDev);

      expect(result).toBe('none');
    },
  );

  /**
   * For any value/mean/stdDev with 1.5σ ≤ |value - mean| < 2σ,
   * classifyAnomaly SHALL return 'warning'.
   *
   * We construct the offset as exactly sigmaFraction × stdDev where
   * sigmaFraction ∈ [1.5, 2.0). To avoid floating-point rounding turning
   * 1.5 into 1.4999…, we use a range slightly inside the boundary and rely
   * on the classifyAnomaly function's own threshold checks.
   */
  test.prop([
    meanArb,
    positiveStdDevArb,
    // Use a range well inside [1.5, 2.0) to avoid float boundary issues
    fc.double({ min: 1.5001, max: 1.9998, noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
  ])(
    'returns "warning" when 1.5σ ≤ |value - mean| < 2σ',
    (mean, stdDev, sigmaFraction, negative) => {
      const offset = sigmaFraction * stdDev;
      const value = mean + (negative ? -offset : offset);

      const result = classifyAnomaly(value, mean, stdDev);
      expect(result).toBe('warning');
    },
  );

  /**
   * For any value/mean/stdDev with 2σ ≤ |value - mean| < 3σ,
   * classifyAnomaly SHALL return 'severe'.
   */
  test.prop([
    meanArb,
    positiveStdDevArb,
    // Use a range well inside [2.0, 3.0) to avoid float boundary issues
    fc.double({ min: 2.0001, max: 2.9998, noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
  ])(
    'returns "severe" when 2σ ≤ |value - mean| < 3σ',
    (mean, stdDev, sigmaFraction, negative) => {
      const offset = sigmaFraction * stdDev;
      const value = mean + (negative ? -offset : offset);

      const result = classifyAnomaly(value, mean, stdDev);
      expect(result).toBe('severe');
    },
  );

  /**
   * For any value/mean/stdDev with |value - mean| ≥ 3σ,
   * classifyAnomaly SHALL return 'extreme'.
   */
  test.prop([
    meanArb,
    positiveStdDevArb,
    // offset in [3.0, 10.0] × σ
    fc.double({ min: 3.0, max: 10.0, noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
  ])(
    'returns "extreme" when |value - mean| ≥ 3σ',
    (mean, stdDev, sigmaFraction, negative) => {
      const offset = sigmaFraction * stdDev;
      const value = mean + (negative ? -offset : offset);

      const result = classifyAnomaly(value, mean, stdDev);

      expect(result).toBe('extreme');
    },
  );

  /**
   * Exhaustive tier coverage: the result is always one of the four
   * defined tiers, never undefined or an unexpected value.
   */
  test.prop([
    meanArb,
    positiveStdDevArb,
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  ])(
    'always returns a valid severity tier',
    (mean, stdDev, value) => {
      const result = classifyAnomaly(value, mean, stdDev);
      expect(['none', 'warning', 'severe', 'extreme']).toContain(result);
    },
  );

  /**
   * Edge case: stdDev ≤ 0 always yields 'none' regardless of value/mean.
   */
  test.prop([
    meanArb,
    fc.double({ min: -1000, max: 0, noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  ])(
    'returns "none" for any value when stdDev ≤ 0',
    (mean, stdDev, value) => {
      expect(classifyAnomaly(value, mean, stdDev)).toBe('none');
    },
  );

  /**
   * Symmetry: positive and negative deviations of equal magnitude
   * produce the same severity tier.
   */
  test.prop([
    meanArb,
    positiveStdDevArb,
    fc.double({ min: 0, max: 10.0, noNaN: true, noDefaultInfinity: true }),
  ])(
    'symmetric: positive and negative deviations of same magnitude yield the same tier',
    (mean, stdDev, sigmaFraction) => {
      const offset = sigmaFraction * stdDev;
      const above = classifyAnomaly(mean + offset, mean, stdDev);
      const below = classifyAnomaly(mean - offset, mean, stdDev);
      expect(above).toBe(below);
    },
  );
});
