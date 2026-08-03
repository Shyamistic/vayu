/**
 * Unit tests for FloodRiskPanel pure functions.
 *
 * Tests classifyFloodRisk, computeCumulativeRainfall, assessFloodRisk,
 * and flagCriticalBasins.
 *
 * Validates: Requirements 20.1, 20.2, 20.3, 20.4
 */

import { describe, it, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  classifyFloodRisk,
  computeCumulativeRainfall,
  assessFloodRisk,
  flagCriticalBasins,
  REGION_THRESHOLDS,
  RIVER_BASINS,
  type FloodRiskLevel,
} from './FloodRiskPanel';
import type { GridCell, RegionId } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat: 15.0,
    lon: 75.0,
    node_idx: 0,
    rainfall: 10,
    temp_max: 32,
    temp_min: 22,
    rainfall_uncertainty: 2,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 1,
    ...overrides,
  };
}

// ── classifyFloodRisk ─────────────────────────────────────────────────────────

describe('classifyFloodRisk — western_ghats (base=100mm)', () => {
  const region = 'western_ghats';
  const { base, low, moderate, high } = REGION_THRESHOLDS[region];

  it('returns "none" at or below base threshold', () => {
    expect(classifyFloodRisk(0, region)).toBe('none');
    expect(classifyFloodRisk(base, region)).toBe('none');
    expect(classifyFloodRisk(base - 0.1, region)).toBe('none');
  });

  it('returns "low" just above base up to low threshold', () => {
    expect(classifyFloodRisk(base + 0.1, region)).toBe('low');
    expect(classifyFloodRisk(low, region)).toBe('low');
  });

  it('returns "moderate" above low up to moderate threshold', () => {
    expect(classifyFloodRisk(low + 0.1, region)).toBe('moderate');
    expect(classifyFloodRisk(moderate, region)).toBe('moderate');
  });

  it('returns "high" above moderate up to high threshold', () => {
    expect(classifyFloodRisk(moderate + 0.1, region)).toBe('high');
    expect(classifyFloodRisk(high, region)).toBe('high');
  });

  it('returns "extreme" above high threshold', () => {
    expect(classifyFloodRisk(high + 0.1, region)).toBe('extreme');
    expect(classifyFloodRisk(500, region)).toBe('extreme');
  });
});

describe('classifyFloodRisk — indo_gangetic_plain (base=150mm)', () => {
  const region = 'indo_gangetic_plain';
  const { base } = REGION_THRESHOLDS[region];

  it('returns "none" at or below 150mm', () => {
    expect(classifyFloodRisk(150, region)).toBe('none');
    expect(classifyFloodRisk(100, region)).toBe('none');
  });

  it('returns flood risk above 150mm', () => {
    const level = classifyFloodRisk(151, region);
    expect(['low', 'moderate', 'high', 'extreme']).toContain(level);
  });

  it('uses a higher base threshold than western_ghats', () => {
    // 120mm is flood risk for western_ghats but not for indo_gangetic
    expect(classifyFloodRisk(120, 'western_ghats')).not.toBe('none');
    expect(classifyFloodRisk(120, region)).toBe('none');
  });
});

describe('classifyFloodRisk — all regions have correct base thresholds', () => {
  it('western_ghats base is 100mm', () => {
    expect(REGION_THRESHOLDS.western_ghats.base).toBe(100);
    expect(classifyFloodRisk(100, 'western_ghats')).toBe('none');
    expect(classifyFloodRisk(101, 'western_ghats')).toBe('low');
  });

  it('indo_gangetic_plain base is 150mm', () => {
    expect(REGION_THRESHOLDS.indo_gangetic_plain.base).toBe(150);
    expect(classifyFloodRisk(150, 'indo_gangetic_plain')).toBe('none');
    expect(classifyFloodRisk(151, 'indo_gangetic_plain')).toBe('low');
  });
});

// ── computeCumulativeRainfall ─────────────────────────────────────────────────

describe('computeCumulativeRainfall', () => {
  it('sums rainfall across 3 days for matching node', () => {
    const day1 = [makeCell({ node_idx: 1, rainfall: 30 })];
    const day2 = [makeCell({ node_idx: 1, rainfall: 50 })];
    const day3 = [makeCell({ node_idx: 1, rainfall: 40 })];
    expect(computeCumulativeRainfall(1, [day1, day2, day3])).toBeCloseTo(120);
  });

  it('returns 0 when node is absent in all days', () => {
    const day1 = [makeCell({ node_idx: 99, rainfall: 30 })];
    expect(computeCumulativeRainfall(5, [day1])).toBe(0);
  });

  it('uses 0 for missing days', () => {
    const day1 = [makeCell({ node_idx: 2, rainfall: 60 })];
    const day2: GridCell[] = []; // node absent
    const day3 = [makeCell({ node_idx: 2, rainfall: 40 })];
    expect(computeCumulativeRainfall(2, [day1, day2, day3])).toBeCloseTo(100);
  });

  it('handles empty daily arrays', () => {
    expect(computeCumulativeRainfall(0, [[], [], []])).toBe(0);
  });
});

// ── assessFloodRisk ───────────────────────────────────────────────────────────

describe('assessFloodRisk', () => {
  const region = 'western_ghats'; // base=100mm

  it('returns only cells exceeding the threshold', () => {
    // Node 1: 30+30+30=90mm (below 100mm threshold → none)
    // Node 2: 40+40+40=120mm (above 100mm → low)
    const cells = [
      makeCell({ node_idx: 1 }),
      makeCell({ node_idx: 2 }),
    ];
    const day: GridCell[] = [
      makeCell({ node_idx: 1, rainfall: 30 }),
      makeCell({ node_idx: 2, rainfall: 40 }),
    ];
    const result = assessFloodRisk(cells, [day, day, day], region);
    expect(result).toHaveLength(1);
    expect(result[0].cell.node_idx).toBe(2);
    expect(result[0].riskLevel).toBe('low');
    expect(result[0].cumulativeRainfall).toBeCloseTo(120);
  });

  it('returns empty array when no cells breach threshold', () => {
    const cells = [makeCell({ node_idx: 0, rainfall: 10 })];
    const result = assessFloodRisk(cells, [[makeCell({ node_idx: 0, rainfall: 10 })], [], []], region);
    expect(result).toHaveLength(0);
  });

  it('correctly flags extreme cells', () => {
    const cells = [makeCell({ node_idx: 7 })];
    const day = [makeCell({ node_idx: 7, rainfall: 110 })]; // 330mm total > high=300
    const result = assessFloodRisk(cells, [day, day, day], region);
    expect(result).toHaveLength(1);
    expect(result[0].riskLevel).toBe('extreme');
  });
});

// ── flagCriticalBasins ────────────────────────────────────────────────────────

describe('flagCriticalBasins', () => {
  it('flags a basin when mean accumulation exceeds its critical threshold', () => {
    // Ganga basin bounds: [24, 31, 78, 88], threshold: 120mm
    const riskCells = [
      {
        cell: makeCell({ lat: 27, lon: 82 }),
        cumulativeRainfall: 150,
        riskLevel: 'high' as FloodRiskLevel,
        region: 'indo_gangetic_plain' as const,
      },
    ];
    const critical = flagCriticalBasins(riskCells, RIVER_BASINS);
    expect(critical.some((b) => b.id === 'ganga')).toBe(true);
  });

  it('does not flag a basin when mean accumulation is below threshold', () => {
    const riskCells = [
      {
        cell: makeCell({ lat: 27, lon: 82 }),
        cumulativeRainfall: 100, // below Ganga threshold 120
        riskLevel: 'low' as FloodRiskLevel,
        region: 'indo_gangetic_plain' as const,
      },
    ];
    const critical = flagCriticalBasins(riskCells, RIVER_BASINS);
    expect(critical.some((b) => b.id === 'ganga')).toBe(false);
  });

  it('returns empty array when no risk cells overlap any basin', () => {
    const riskCells = [
      {
        cell: makeCell({ lat: 10, lon: 72 }), // outside all basins
        cumulativeRainfall: 300,
        riskLevel: 'extreme' as FloodRiskLevel,
        region: 'western_ghats' as const,
      },
    ];
    const critical = flagCriticalBasins(riskCells, RIVER_BASINS);
    expect(critical).toHaveLength(0);
  });

  it('returns empty array for empty risk cells', () => {
    expect(flagCriticalBasins([], RIVER_BASINS)).toHaveLength(0);
  });

  it('returns empty array when no basins provided', () => {
    const riskCells = [
      {
        cell: makeCell({ lat: 27, lon: 82 }),
        cumulativeRainfall: 200,
        riskLevel: 'high' as FloodRiskLevel,
        region: 'indo_gangetic_plain' as const,
      },
    ];
    expect(flagCriticalBasins(riskCells, [])).toHaveLength(0);
  });
});

// ── Property-Based Tests ──────────────────────────────────────────────────────

/**
 * Property 13: Flood Risk Threshold Classification
 *
 * For any grid cell with a cumulative rainfall value and any valid region,
 * classifyFloodRisk must flag the cell as flood-risk (riskLevel !== 'none')
 * if and only if its cumulative rainfall exceeds the region's base threshold.
 *
 * Validates: Requirements 20.1
 */
describe('Property 13: Flood Risk Threshold Classification', () => {
  /** Arbitrary generator for all valid region IDs */
  const regionArb = fc.constantFrom<RegionId>(
    'western_ghats',
    'indo_gangetic_plain',
    'north_east_india',
    'central_india',
    'pilot',
  );

  /**
   * Arbitrary rainfall: spread across a wide realistic range including
   * values at, below, and above all region thresholds.
   * Range [0, 600] covers well above the maximum high threshold (350mm).
   */
  const rainfallArb = fc.float({ min: 0, max: 600, noNaN: true });

  test.prop([rainfallArb, regionArb])(
    'cell is flagged as flood-risk iff cumulative rainfall exceeds region base threshold',
    (cumulativeRainfall, region) => {
      const result = classifyFloodRisk(cumulativeRainfall, region);
      const baseThreshold = REGION_THRESHOLDS[region].base;

      const isFlagged = result !== 'none';
      const exceedsThreshold = cumulativeRainfall > baseThreshold;

      // The biconditional: flagged ⟺ exceeds threshold
      return isFlagged === exceedsThreshold;
    },
  );

  test.prop([rainfallArb, regionArb])(
    'cell is NOT flagged when cumulative rainfall is at or below base threshold',
    (cumulativeRainfall, region) => {
      const baseThreshold = REGION_THRESHOLDS[region].base;
      // Clamp to [0, base] so we only test the "not-flagged" domain
      const rainfall = cumulativeRainfall % (baseThreshold + 1);
      const result = classifyFloodRisk(rainfall, region);
      return result === 'none';
    },
  );

  test.prop([rainfallArb, regionArb])(
    'cell IS flagged with a non-none risk level when cumulative rainfall exceeds base threshold',
    (cumulativeRainfall, region) => {
      const baseThreshold = REGION_THRESHOLDS[region].base;
      // Shift into the flood-risk domain by adding baseThreshold + small delta
      const rainfall = baseThreshold + (cumulativeRainfall % 300) + 0.01;
      const result = classifyFloodRisk(rainfall, region);
      return result !== 'none';
    },
  );

  test.prop([
    fc.constantFrom<RegionId>('western_ghats', 'pilot', 'central_india'),
  ])(
    'western_ghats / pilot / central_india use 100mm base threshold',
    (region) => {
      expect(REGION_THRESHOLDS[region].base).toBe(100);
      expect(classifyFloodRisk(100, region)).toBe('none');
      expect(classifyFloodRisk(100.01, region)).not.toBe('none');
    },
  );

  test.prop([fc.constantFrom<RegionId>('indo_gangetic_plain')])(
    'indo_gangetic_plain uses 150mm base threshold',
    (region) => {
      expect(REGION_THRESHOLDS[region].base).toBe(150);
      expect(classifyFloodRisk(150, region)).toBe('none');
      expect(classifyFloodRisk(150.01, region)).not.toBe('none');
    },
  );
});
