/**
 * Unit tests for PopulationExposure pure functions.
 *
 * Validates: Requirements 62.1, 62.2, 62.3, 62.4
 */

import { describe, it, expect } from 'vitest';
import {
  cellAreaKm2,
  estimateDensityAtCell,
  densityToColor,
  buildPopDensityOverlay,
  computeHazardExposure,
  totalExposureByHazard,
  mostVulnerableAreas,
  computePopWeightedDistrictRisk,
  formatPopulation,
  hazardSeverityLabel,
  DISTRICT_DEFINITIONS,
  MOCK_HAZARD_CELLS,
  VULNERABILITY_DISPLAY_THRESHOLD,
} from './PopulationExposure';
import type { GridCell } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(lat: number, lon: number, overrides: Partial<GridCell> = {}): GridCell {
  return {
    lat,
    lon,
    node_idx: 0,
    rainfall: 50,
    temp_max: 35,
    temp_min: 25,
    rainfall_uncertainty: 5,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 0.5,
    ...overrides,
  };
}

// ── cellAreaKm2 ───────────────────────────────────────────────────────────────

describe('cellAreaKm2', () => {
  it('returns a positive area for any valid latitude', () => {
    expect(cellAreaKm2(0)).toBeGreaterThan(0);
    expect(cellAreaKm2(20)).toBeGreaterThan(0);
    expect(cellAreaKm2(30)).toBeGreaterThan(0);
  });

  it('area at equator (lat=0) is larger than at high latitude (lat=60)', () => {
    // cos(0) = 1 > cos(60°) = 0.5
    expect(cellAreaKm2(0)).toBeGreaterThan(cellAreaKm2(60));
  });

  it('returns ~768 km² for a 0.25° cell near the equator', () => {
    // 6371² × (0.25 × π/180)² × cos(0) ≈ 768 km²
    const area = cellAreaKm2(0, 0.25);
    expect(area).toBeCloseTo(768, -1); // within ±50 km²
  });
});

// ── estimateDensityAtCell ─────────────────────────────────────────────────────

describe('estimateDensityAtCell', () => {
  it('returns a positive density for a location inside India', () => {
    // Patna centre
    const density = estimateDensityAtCell(25.59, 85.13, DISTRICT_DEFINITIONS);
    expect(density).toBeGreaterThan(0);
  });

  it('returns higher density near Patna (1802/km²) than near Jaisalmer (17/km²)', () => {
    const patna = estimateDensityAtCell(25.59, 85.13, DISTRICT_DEFINITIONS);
    const jaisalmer = estimateDensityAtCell(26.91, 70.91, DISTRICT_DEFINITIONS);
    expect(patna).toBeGreaterThan(jaisalmer);
  });

  it('uses provided districts array', () => {
    const synthetic = [
      { district: 'TestA', state: 'S', lat: 20, lon: 80, densityPerKm2: 999, radiusDeg: 1,
        components: { flood: 0, drought: 0, heatwave: 0, cyclone: 0 } },
    ];
    const density = estimateDensityAtCell(20, 80, synthetic);
    expect(density).toBeCloseTo(999, 0);
  });
});

// ── densityToColor ────────────────────────────────────────────────────────────

describe('densityToColor', () => {
  it('returns a string for all valid density inputs', () => {
    [0, 1, 100, 500, 1000, 2500, 5000].forEach((d) => {
      expect(typeof densityToColor(d)).toBe('string');
      expect(densityToColor(d).length).toBeGreaterThan(0);
    });
  });

  it('different densities produce different colours', () => {
    const low = densityToColor(10);
    const high = densityToColor(2000);
    expect(low).not.toBe(high);
  });
});

// ── buildPopDensityOverlay ────────────────────────────────────────────────────

describe('buildPopDensityOverlay', () => {
  it('returns one overlay cell per grid cell', () => {
    const cells = [makeCell(20, 80), makeCell(25, 85), makeCell(15, 75)];
    const overlay = buildPopDensityOverlay(cells, DISTRICT_DEFINITIONS);
    expect(overlay).toHaveLength(3);
  });

  it('each overlay cell has a positive density and valid colour string', () => {
    const cells = [makeCell(25.59, 85.13)];
    const [oc] = buildPopDensityOverlay(cells, DISTRICT_DEFINITIONS);
    expect(oc.densityPerKm2).toBeGreaterThan(0);
    expect(typeof oc.color).toBe('string');
  });

  it('preserves lat/lon from the source grid cell', () => {
    const cells = [makeCell(17.5, 82.3)];
    const [oc] = buildPopDensityOverlay(cells, DISTRICT_DEFINITIONS);
    expect(oc.lat).toBe(17.5);
    expect(oc.lon).toBe(82.3);
  });
});

// ── computeHazardExposure ─────────────────────────────────────────────────────

describe('computeHazardExposure (Req 62.2)', () => {
  it('returns one exposure entry per input hazard cell', () => {
    const result = computeHazardExposure(MOCK_HAZARD_CELLS, DISTRICT_DEFINITIONS);
    expect(result).toHaveLength(MOCK_HAZARD_CELLS.length);
  });

  it('each exposure has non-negative exposedPopulation', () => {
    const result = computeHazardExposure(MOCK_HAZARD_CELLS, DISTRICT_DEFINITIONS);
    result.forEach((e) => {
      expect(e.exposedPopulation).toBeGreaterThanOrEqual(0);
    });
  });

  it('results are sorted descending by exposedPopulation', () => {
    const result = computeHazardExposure(MOCK_HAZARD_CELLS, DISTRICT_DEFINITIONS);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].exposedPopulation).toBeGreaterThanOrEqual(result[i].exposedPopulation);
    }
  });

  it('propagates hazardType and severity from input cells', () => {
    const cell = { ...MOCK_HAZARD_CELLS[0] };
    const [first] = computeHazardExposure([cell], DISTRICT_DEFINITIONS);
    expect(first.hazardType).toBe(cell.hazardType);
    expect(first.severity).toBe(cell.severity);
  });

  it('returns empty array for empty input', () => {
    expect(computeHazardExposure([])).toEqual([]);
  });
});

// ── totalExposureByHazard ─────────────────────────────────────────────────────

describe('totalExposureByHazard (Req 62.2)', () => {
  it('sums exposure per hazard type correctly', () => {
    const exposures = computeHazardExposure(MOCK_HAZARD_CELLS, DISTRICT_DEFINITIONS);
    const totals = totalExposureByHazard(exposures);

    const manualFloodTotal = exposures
      .filter((e) => e.hazardType === 'flood')
      .reduce((s, e) => s + e.exposedPopulation, 0);
    expect(totals.flood).toBeCloseTo(manualFloodTotal, 0);
  });

  it('returns zero for hazard types with no cells', () => {
    const singleCell = [{ ...MOCK_HAZARD_CELLS[0], hazardType: 'flood' as const }];
    const exposures = computeHazardExposure(singleCell, DISTRICT_DEFINITIONS);
    const totals = totalExposureByHazard(exposures);
    expect(totals.drought).toBe(0);
    expect(totals.cyclone).toBe(0);
    expect(totals.heatwave).toBe(0);
  });
});

// ── mostVulnerableAreas ───────────────────────────────────────────────────────

describe('mostVulnerableAreas (Req 62.3)', () => {
  it('returns entries above VULNERABILITY_DISPLAY_THRESHOLD', () => {
    const exposures = computeHazardExposure(MOCK_HAZARD_CELLS, DISTRICT_DEFINITIONS);
    const vulnerable = mostVulnerableAreas(exposures);
    vulnerable.forEach((e) => {
      expect(e.exposedPopulation).toBeGreaterThanOrEqual(VULNERABILITY_DISPLAY_THRESHOLD);
    });
  });

  it('results are sorted by exposedPopulation descending', () => {
    const exposures = computeHazardExposure(MOCK_HAZARD_CELLS, DISTRICT_DEFINITIONS);
    const vulnerable = mostVulnerableAreas(exposures);
    for (let i = 1; i < vulnerable.length; i++) {
      expect(vulnerable[i - 1].exposedPopulation).toBeGreaterThanOrEqual(vulnerable[i].exposedPopulation);
    }
  });

  it('respects the limit parameter', () => {
    const exposures = computeHazardExposure(MOCK_HAZARD_CELLS, DISTRICT_DEFINITIONS);
    const vulnerable = mostVulnerableAreas(exposures, 3);
    expect(vulnerable.length).toBeLessThanOrEqual(3);
  });
});

// ── computePopWeightedDistrictRisk ────────────────────────────────────────────

describe('computePopWeightedDistrictRisk (Req 62.4)', () => {
  it('returns one entry per district definition', () => {
    const result = computePopWeightedDistrictRisk([], DISTRICT_DEFINITIONS);
    expect(result).toHaveLength(DISTRICT_DEFINITIONS.length);
  });

  it('populationWeightedScore is in [0, 100] for all districts', () => {
    const cells = DISTRICT_DEFINITIONS.map((d) => makeCell(d.lat, d.lon, { rainfall: 80 }));
    const result = computePopWeightedDistrictRisk(cells, DISTRICT_DEFINITIONS);
    result.forEach((d) => {
      expect(d.populationWeightedScore).toBeGreaterThanOrEqual(0);
      expect(d.populationWeightedScore).toBeLessThanOrEqual(100);
    });
  });

  it('results are sorted by populationWeightedScore descending', () => {
    const cells = DISTRICT_DEFINITIONS.map((d) => makeCell(d.lat, d.lon));
    const result = computePopWeightedDistrictRisk(cells, DISTRICT_DEFINITIONS);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].populationWeightedScore).toBeGreaterThanOrEqual(
        result[i].populationWeightedScore,
      );
    }
  });

  it('with no grid cells, falls back to raw risk score', () => {
    const result = computePopWeightedDistrictRisk([], DISTRICT_DEFINITIONS);
    result.forEach((d) => {
      expect(d.populationWeightedScore).toBeCloseTo(d.rawRiskScore, 5);
    });
  });

  it('dense districts (high density) propagate larger totalExposedPopulation', () => {
    const cells = DISTRICT_DEFINITIONS.map((d) => makeCell(d.lat, d.lon));
    const result = computePopWeightedDistrictRisk(cells, DISTRICT_DEFINITIONS);

    // Patna (1802/km²) and Varanasi (2395/km²) should have higher exposure than Jaisalmer (17/km²)
    const patna = result.find((d) => d.district === 'Patna')!;
    const jaisalmer = result.find((d) => d.district === 'Jaisalmer')!;
    expect(patna.totalExposedPopulation).toBeGreaterThan(jaisalmer.totalExposedPopulation);
  });
});

// ── formatPopulation ──────────────────────────────────────────────────────────

describe('formatPopulation', () => {
  it('formats millions correctly', () => {
    expect(formatPopulation(1_234_567)).toBe('1.23 M');
    expect(formatPopulation(10_000_000)).toBe('10.00 M');
  });

  it('formats thousands correctly', () => {
    expect(formatPopulation(5_000)).toBe('5.0 K');
    expect(formatPopulation(999)).toBe('999');
  });

  it('handles zero', () => {
    expect(formatPopulation(0)).toBe('0');
  });
});

// ── hazardSeverityLabel ───────────────────────────────────────────────────────

describe('hazardSeverityLabel', () => {
  it('returns Extreme for score ≥ 90', () => {
    expect(hazardSeverityLabel(90)).toBe('Extreme');
    expect(hazardSeverityLabel(100)).toBe('Extreme');
  });

  it('returns High for score in [70, 89]', () => {
    expect(hazardSeverityLabel(70)).toBe('High');
    expect(hazardSeverityLabel(89)).toBe('High');
  });

  it('returns Moderate for score in [50, 69]', () => {
    expect(hazardSeverityLabel(50)).toBe('Moderate');
    expect(hazardSeverityLabel(69)).toBe('Moderate');
  });

  it('returns Low for score in [30, 49]', () => {
    expect(hazardSeverityLabel(30)).toBe('Low');
    expect(hazardSeverityLabel(49)).toBe('Low');
  });

  it('returns Minimal for score < 30', () => {
    expect(hazardSeverityLabel(0)).toBe('Minimal');
    expect(hazardSeverityLabel(29)).toBe('Minimal');
  });
});
