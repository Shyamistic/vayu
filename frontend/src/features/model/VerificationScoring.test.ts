/**
 * Tests for VerificationScoring pure functions.
 *
 * Validates: Requirements 61.1, 61.2, 61.3, 61.4
 */

import { describe, it, expect } from 'vitest';
import {
  computeRMSE,
  computeMAE,
  computeBias,
  computeCorrelation,
  computeBrierScore,
  computeSkillScore,
  buildReliabilityDiagram,
  buildROCCurve,
  computeAUC,
  computeModelHealthScore,
  type VerificationPair,
} from './VerificationScoring';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePairs(observed: number[], forecast: number[]): VerificationPair[] {
  return observed.map((obs, i) => ({ observed: obs, forecast: forecast[i] }));
}

function makeProbPairs(
  observed: number[],
  forecast: number[],
  probabilities: number[],
  events: boolean[],
): VerificationPair[] {
  return observed.map((obs, i) => ({
    observed: obs,
    forecast: forecast[i],
    probability: probabilities[i],
    eventOccurred: events[i],
  }));
}

// ── RMSE ─────────────────────────────────────────────────────────────────────

describe('computeRMSE', () => {
  it('returns NaN for empty input', () => {
    expect(computeRMSE([])).toBeNaN();
  });

  it('returns 0 for perfect forecasts', () => {
    const pairs = makePairs([1, 2, 3], [1, 2, 3]);
    expect(computeRMSE(pairs)).toBe(0);
  });

  it('computes RMSE correctly for known values', () => {
    // errors: [1, -1, 2] => squared: [1, 1, 4] => mean: 2 => sqrt: ~1.4142
    const pairs = makePairs([0, 2, 0], [1, 1, 2]);
    expect(computeRMSE(pairs)).toBeCloseTo(Math.sqrt(2), 5);
  });

  it('RMSE is always non-negative', () => {
    const pairs = makePairs([10, 20, 30], [8, 22, 35]);
    expect(computeRMSE(pairs)).toBeGreaterThanOrEqual(0);
  });

  it('RMSE >= MAE for the same input', () => {
    const pairs = makePairs([5, 10, 15, 20], [4, 12, 11, 25]);
    expect(computeRMSE(pairs)).toBeGreaterThanOrEqual(computeMAE(pairs));
  });
});

// ── MAE ──────────────────────────────────────────────────────────────────────

describe('computeMAE', () => {
  it('returns NaN for empty input', () => {
    expect(computeMAE([])).toBeNaN();
  });

  it('returns 0 for perfect forecasts', () => {
    const pairs = makePairs([5, 10], [5, 10]);
    expect(computeMAE(pairs)).toBe(0);
  });

  it('computes MAE correctly for known values', () => {
    // abs errors: [1, 2, 3] => mean: 2
    const pairs = makePairs([0, 0, 0], [1, 2, 3]);
    expect(computeMAE(pairs)).toBeCloseTo(2, 10);
  });

  it('MAE is non-negative', () => {
    const pairs = makePairs([10, 20], [15, 18]);
    expect(computeMAE(pairs)).toBeGreaterThanOrEqual(0);
  });
});

// ── Bias ─────────────────────────────────────────────────────────────────────

describe('computeBias', () => {
  it('returns NaN for empty input', () => {
    expect(computeBias([])).toBeNaN();
  });

  it('returns 0 for unbiased forecasts', () => {
    // errors cancel: +2 and -2
    const pairs = makePairs([0, 4], [2, 2]);
    expect(computeBias(pairs)).toBeCloseTo(0, 10);
  });

  it('positive bias when forecasts exceed observations', () => {
    const pairs = makePairs([0, 0, 0], [1, 2, 3]);
    expect(computeBias(pairs)).toBeGreaterThan(0);
  });

  it('negative bias when forecasts are below observations', () => {
    const pairs = makePairs([5, 5, 5], [2, 3, 4]);
    expect(computeBias(pairs)).toBeLessThan(0);
  });

  it('computes bias for known values', () => {
    // errors: [2, 3] => mean: 2.5
    const pairs = makePairs([0, 0], [2, 3]);
    expect(computeBias(pairs)).toBeCloseTo(2.5, 10);
  });
});

// ── Correlation ───────────────────────────────────────────────────────────────

describe('computeCorrelation', () => {
  it('returns NaN for fewer than 2 pairs', () => {
    expect(computeCorrelation([])).toBeNaN();
    expect(computeCorrelation([{ observed: 1, forecast: 1 }])).toBeNaN();
  });

  it('returns 1 for perfect positive correlation', () => {
    const pairs = makePairs([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(computeCorrelation(pairs)).toBeCloseTo(1, 10);
  });

  it('returns -1 for perfect negative correlation', () => {
    const pairs = makePairs([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(computeCorrelation(pairs)).toBeCloseTo(-1, 10);
  });

  it('returns NaN when all forecasts are constant (zero variance)', () => {
    const pairs = makePairs([1, 2, 3], [5, 5, 5]);
    expect(computeCorrelation(pairs)).toBeNaN();
  });

  it('correlation is in [-1, 1]', () => {
    const pairs = makePairs([1, 4, 2, 8, 5], [3, 5, 2, 7, 4]);
    const r = computeCorrelation(pairs);
    expect(r).toBeGreaterThanOrEqual(-1);
    expect(r).toBeLessThanOrEqual(1);
  });
});

// ── Brier Score ───────────────────────────────────────────────────────────────

describe('computeBrierScore', () => {
  it('returns NaN when no pairs have probability/event fields', () => {
    expect(computeBrierScore(makePairs([1], [1]))).toBeNaN();
  });

  it('returns 0 for perfect probabilistic forecasts', () => {
    const pairs: VerificationPair[] = [
      { observed: 1, forecast: 1, probability: 1, eventOccurred: true  },
      { observed: 0, forecast: 0, probability: 0, eventOccurred: false },
    ];
    expect(computeBrierScore(pairs)).toBeCloseTo(0, 10);
  });

  it('returns 1 for worst-case forecasts', () => {
    const pairs: VerificationPair[] = [
      { observed: 1, forecast: 1, probability: 0, eventOccurred: true  },
      { observed: 0, forecast: 0, probability: 1, eventOccurred: false },
    ];
    expect(computeBrierScore(pairs)).toBeCloseTo(1, 10);
  });

  it('Brier Score is in [0, 1]', () => {
    const pairs: VerificationPair[] = [
      { observed: 5, forecast: 6, probability: 0.7, eventOccurred: true  },
      { observed: 2, forecast: 3, probability: 0.3, eventOccurred: false },
      { observed: 8, forecast: 7, probability: 0.9, eventOccurred: true  },
    ];
    const bs = computeBrierScore(pairs);
    expect(bs).toBeGreaterThanOrEqual(0);
    expect(bs).toBeLessThanOrEqual(1);
  });
});

// ── Skill Score ───────────────────────────────────────────────────────────────

describe('computeSkillScore', () => {
  it('returns 0 when model RMSE equals reference RMSE', () => {
    expect(computeSkillScore(5, 5)).toBe(0);
  });

  it('returns positive skill when model RMSE is less than reference', () => {
    expect(computeSkillScore(3, 5)).toBeGreaterThan(0);
  });

  it('returns negative skill when model RMSE exceeds reference', () => {
    expect(computeSkillScore(7, 5)).toBeLessThan(0);
  });

  it('returns 1 for perfect model (RMSE = 0)', () => {
    expect(computeSkillScore(0, 5)).toBe(1);
  });

  it('returns NaN when reference RMSE is 0', () => {
    expect(computeSkillScore(2, 0)).toBeNaN();
  });
});

// ── Reliability Diagram ───────────────────────────────────────────────────────

describe('buildReliabilityDiagram', () => {
  it('returns empty array when no pairs have probability/event', () => {
    expect(buildReliabilityDiagram(makePairs([1, 2], [1, 2]))).toHaveLength(0);
  });

  it('returns only bins with data', () => {
    const pairs: VerificationPair[] = [
      { observed: 1, forecast: 1, probability: 0.1, eventOccurred: true },
      { observed: 1, forecast: 1, probability: 0.1, eventOccurred: false },
      { observed: 1, forecast: 1, probability: 0.8, eventOccurred: true },
    ];
    const result = buildReliabilityDiagram(pairs);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('each bin has observedFreq in [0, 1]', () => {
    const pairs: VerificationPair[] = Array.from({ length: 20 }, (_, i) => ({
      observed: i,
      forecast: i,
      probability: (i % 10) / 10,
      eventOccurred: i % 2 === 0,
    }));
    const result = buildReliabilityDiagram(pairs);
    for (const p of result) {
      expect(p.observedFreq).toBeGreaterThanOrEqual(0);
      expect(p.observedFreq).toBeLessThanOrEqual(1);
    }
  });
});

// ── ROC Curve ─────────────────────────────────────────────────────────────────

describe('buildROCCurve', () => {
  it('returns empty array when no valid pairs', () => {
    expect(buildROCCurve(makePairs([1], [1]))).toHaveLength(0);
  });

  it('returns empty when all events are positive (no negatives)', () => {
    const pairs: VerificationPair[] = [
      { observed: 1, forecast: 1, probability: 0.9, eventOccurred: true },
      { observed: 1, forecast: 1, probability: 0.8, eventOccurred: true },
    ];
    expect(buildROCCurve(pairs)).toHaveLength(0);
  });

  it('all FPR and TPR values are in [0, 1]', () => {
    const pairs: VerificationPair[] = Array.from({ length: 10 }, (_, i) => ({
      observed: i,
      forecast: i + 1,
      probability: i / 10,
      eventOccurred: i >= 5,
    }));
    const result = buildROCCurve(pairs);
    for (const p of result) {
      expect(p.falsePositiveRate).toBeGreaterThanOrEqual(0);
      expect(p.falsePositiveRate).toBeLessThanOrEqual(1);
      expect(p.truePositiveRate).toBeGreaterThanOrEqual(0);
      expect(p.truePositiveRate).toBeLessThanOrEqual(1);
    }
  });
});

// ── AUC ──────────────────────────────────────────────────────────────────────

describe('computeAUC', () => {
  it('returns NaN for fewer than 2 points', () => {
    expect(computeAUC([])).toBeNaN();
    expect(computeAUC([{ falsePositiveRate: 0, truePositiveRate: 0, threshold: 1 }])).toBeNaN();
  });

  it('returns approximately 0.5 for the diagonal (no skill)', () => {
    const diagonal = [
      { falsePositiveRate: 0, truePositiveRate: 0, threshold: 1 },
      { falsePositiveRate: 0.5, truePositiveRate: 0.5, threshold: 0.5 },
      { falsePositiveRate: 1, truePositiveRate: 1, threshold: 0 },
    ];
    expect(computeAUC(diagonal)).toBeCloseTo(0.5, 5);
  });

  it('AUC is in [0, 1]', () => {
    const pairs: VerificationPair[] = Array.from({ length: 20 }, (_, i) => ({
      observed: i,
      forecast: i,
      probability: i / 20,
      eventOccurred: i >= 10,
    }));
    const roc = buildROCCurve(pairs);
    const auc = computeAUC(roc);
    if (!isNaN(auc)) {
      expect(auc).toBeGreaterThanOrEqual(0);
      expect(auc).toBeLessThanOrEqual(1);
    }
  });
});

// ── Model Health Score ────────────────────────────────────────────────────────

describe('computeModelHealthScore', () => {
  it('returns a score in [0, 100]', () => {
    const metrics = { rmse: 3, mae: 2, bias: 0.5, correlation: 0.9, brierScore: 0.1 };
    const score = computeModelHealthScore(metrics, 10, 50);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns a high score for near-perfect metrics', () => {
    const metrics = { rmse: 0.5, mae: 0.3, bias: 0.01, correlation: 0.99, brierScore: 0.02 };
    const score = computeModelHealthScore(metrics, 10, 50);
    expect(score).toBeGreaterThan(75);
  });

  it('returns a lower score for poor metrics', () => {
    const metrics = { rmse: 15, mae: 12, bias: 8, correlation: 0.1, brierScore: 0.45 };
    const score = computeModelHealthScore(metrics, 10, 50);
    expect(score).toBeLessThan(50);
  });

  it('handles NaN metrics gracefully without throwing', () => {
    const metrics = { rmse: NaN, mae: NaN, bias: NaN, correlation: NaN, brierScore: NaN };
    expect(() => computeModelHealthScore(metrics, 10, 50)).not.toThrow();
  });
});
