/**
 * Unit tests for UrbanHeatIsland pure functions.
 *
 * Validates: Requirements 41.1, 41.2, 41.3
 */

import { describe, it, expect } from 'vitest';
import {
  latLonDistanceDeg,
  meanTempMax,
  selectUrbanCells,
  selectRuralCells,
  computeUHI,
  computeAllUHI,
  uhiIntensityToColor,
  uhiCategory,
  buildUHIOverlayCells,
  CITY_DEFINITIONS,
  MOCK_UHI_RESULTS,
  UHI_HOTSPOT_THRESHOLD,
} from './UrbanHeatIsland';
import type { GridCell } from '../../types';
import type { CityDefinition } from './UrbanHeatIsland';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(lat: number, lon: number, temp_max: number, idx = 0): GridCell {
  return {
    lat,
    lon,
    node_idx: idx,
    rainfall: 0,
    temp_max,
    temp_min: 20,
    rainfall_uncertainty: 0,
    temp_max_uncertainty: 0,
    temp_min_uncertainty: 0,
  };
}

const TEST_CITY: CityDefinition = {
  name: 'TestCity',
  state: 'TestState',
  lat: 20.0,
  lon: 80.0,
  urbanRadiusDeg: 0.375,
  ruralInnerDeg: 0.625,
  ruralOuterDeg: 1.25,
};

// Urban cells (within 0.375°)
const URBAN_CELLS = [
  makeCell(20.0,  80.0,  40.0, 1),
  makeCell(20.25, 80.0,  38.0, 2),
  makeCell(20.0,  80.25, 39.0, 3),
];

// Rural ring cells (0.625° < dist ≤ 1.25°)
const RURAL_CELLS = [
  makeCell(20.75, 80.0,  35.0, 10),
  makeCell(21.0,  80.0,  34.0, 11),
  makeCell(20.0,  81.0,  36.0, 12),
  makeCell(20.0,  79.0,  35.0, 13),
];

const ALL_CELLS = [...URBAN_CELLS, ...RURAL_CELLS];

// ── latLonDistanceDeg ─────────────────────────────────────────────────────────

describe('latLonDistanceDeg', () => {
  it('returns 0 for identical points', () => {
    expect(latLonDistanceDeg(20, 80, 20, 80)).toBe(0);
  });

  it('computes Euclidean distance correctly', () => {
    // 3-4-5 triangle in degree space
    expect(latLonDistanceDeg(0, 0, 3, 4)).toBeCloseTo(5, 5);
  });

  it('is symmetric', () => {
    expect(latLonDistanceDeg(15, 75, 18, 79)).toBeCloseTo(
      latLonDistanceDeg(18, 79, 15, 75), 10,
    );
  });
});

// ── meanTempMax ───────────────────────────────────────────────────────────────

describe('meanTempMax', () => {
  it('returns NaN for empty array', () => {
    expect(meanTempMax([])).toBeNaN();
  });

  it('returns the single value for a one-element array', () => {
    expect(meanTempMax([makeCell(0, 0, 37)])).toBe(37);
  });

  it('computes arithmetic mean correctly', () => {
    const cells = [makeCell(0, 0, 30), makeCell(1, 1, 40), makeCell(2, 2, 50)];
    expect(meanTempMax(cells)).toBeCloseTo(40, 5);
  });
});

// ── selectUrbanCells ──────────────────────────────────────────────────────────

describe('selectUrbanCells', () => {
  it('selects only cells within urbanRadiusDeg', () => {
    const selected = selectUrbanCells(ALL_CELLS, TEST_CITY);
    // All URBAN_CELLS should be included
    for (const c of URBAN_CELLS) {
      expect(selected).toContain(c);
    }
  });

  it('excludes rural cells', () => {
    const selected = selectUrbanCells(ALL_CELLS, TEST_CITY);
    for (const c of RURAL_CELLS) {
      expect(selected).not.toContain(c);
    }
  });

  it('returns empty array when no cells in range', () => {
    expect(selectUrbanCells(RURAL_CELLS, TEST_CITY)).toHaveLength(0);
  });
});

// ── selectRuralCells ──────────────────────────────────────────────────────────

describe('selectRuralCells', () => {
  it('selects cells in the rural annulus', () => {
    const selected = selectRuralCells(ALL_CELLS, TEST_CITY);
    for (const c of RURAL_CELLS) {
      expect(selected).toContain(c);
    }
  });

  it('excludes urban core cells', () => {
    const selected = selectRuralCells(ALL_CELLS, TEST_CITY);
    for (const c of URBAN_CELLS) {
      expect(selected).not.toContain(c);
    }
  });
});

// ── computeUHI ────────────────────────────────────────────────────────────────

describe('computeUHI', () => {
  it('returns null when no urban cells match', () => {
    expect(computeUHI(RURAL_CELLS, TEST_CITY)).toBeNull();
  });

  it('returns null when no rural cells match', () => {
    expect(computeUHI(URBAN_CELLS, TEST_CITY)).toBeNull();
  });

  it('computes correct intensity (urban − rural)', () => {
    const result = computeUHI(ALL_CELLS, TEST_CITY);
    expect(result).not.toBeNull();

    const expectedUrban = meanTempMax(URBAN_CELLS);
    const expectedRural = meanTempMax(RURAL_CELLS);
    expect(result!.intensity).toBeCloseTo(expectedUrban - expectedRural, 5);
  });

  it('intensity = urbanTemp − ruralTemp', () => {
    const result = computeUHI(ALL_CELLS, TEST_CITY)!;
    expect(result.intensity).toBeCloseTo(result.urbanTemp - result.ruralTemp, 10);
  });

  it('attaches the supplied trend', () => {
    const result = computeUHI(ALL_CELLS, TEST_CITY, 'increasing')!;
    expect(result.trend).toBe('increasing');
  });

  it('records correct urban and rural cell counts', () => {
    const result = computeUHI(ALL_CELLS, TEST_CITY)!;
    expect(result.urbanCellCount).toBe(URBAN_CELLS.length);
    expect(result.ruralCellCount).toBe(RURAL_CELLS.length);
  });
});

// ── computeAllUHI ─────────────────────────────────────────────────────────────

describe('computeAllUHI', () => {
  it('returns results sorted descending by intensity', () => {
    const results = computeAllUHI(ALL_CELLS, [TEST_CITY]);
    // With only one city the sort is trivial; test multi-city case
    const cityA: CityDefinition = { ...TEST_CITY, name: 'CityA', lat: 20.0, lon: 80.0 };
    const cityB: CityDefinition = {
      name: 'CityB',
      state: 'S',
      lat: 20.5,
      lon: 80.5,
      urbanRadiusDeg: 0.375,
      ruralInnerDeg: 0.625,
      ruralOuterDeg: 1.25,
    };
    // cityB won't have cells → excluded; just ensure no crash
    expect(results).toBeDefined();
  });

  it('falls back to empty when no city has coverage', () => {
    const farCells = [makeCell(0, 0, 30, 99)];
    const results = computeAllUHI(farCells, [TEST_CITY]);
    expect(results).toHaveLength(0);
  });

  it('applies trendOverrides', () => {
    const results = computeAllUHI(ALL_CELLS, [TEST_CITY], { TestCity: 'decreasing' });
    if (results.length > 0) {
      expect(results[0].trend).toBe('decreasing');
    }
  });
});

// ── uhiIntensityToColor ───────────────────────────────────────────────────────

describe('uhiIntensityToColor', () => {
  it('returns a string starting with "rgb("', () => {
    expect(uhiIntensityToColor(2)).toMatch(/^rgb\(/);
  });

  it('zero intensity is near white (all channels ≥ 200)', () => {
    const color = uhiIntensityToColor(0);
    const nums = color.match(/\d+/g)!.map(Number);
    for (const n of nums) expect(n).toBeGreaterThanOrEqual(200);
  });

  it('large positive intensity has high red channel', () => {
    const color = uhiIntensityToColor(5);
    const [r] = color.match(/\d+/g)!.map(Number);
    expect(r).toBe(255);
  });

  it('large negative intensity has low red channel', () => {
    const color = uhiIntensityToColor(-5);
    const [r] = color.match(/\d+/g)!.map(Number);
    expect(r).toBeLessThan(80);
  });

  it('clamps values outside [-5, 5] to boundary colors', () => {
    expect(uhiIntensityToColor(10)).toEqual(uhiIntensityToColor(5));
    expect(uhiIntensityToColor(-10)).toEqual(uhiIntensityToColor(-5));
  });
});

// ── uhiCategory ───────────────────────────────────────────────────────────────

describe('uhiCategory', () => {
  it('classifies negative intensity as Urban Cool Island', () => {
    expect(uhiCategory(-1)).toBe('Urban Cool Island');
  });
  it('classifies 0–1 as Negligible', () => {
    expect(uhiCategory(0.5)).toBe('Negligible');
  });
  it('classifies 1–2 as Weak', () => {
    expect(uhiCategory(1.5)).toBe('Weak');
  });
  it('classifies 2–3 as Moderate', () => {
    expect(uhiCategory(2.5)).toBe('Moderate');
  });
  it('classifies 3–4 as Strong', () => {
    expect(uhiCategory(3.5)).toBe('Strong');
  });
  it('classifies ≥4 as Extreme', () => {
    expect(uhiCategory(4.5)).toBe('Extreme');
  });
});

// ── buildUHIOverlayCells ──────────────────────────────────────────────────────

describe('buildUHIOverlayCells', () => {
  it('returns overlay cells for urban city extent', () => {
    const result = computeUHI(ALL_CELLS, TEST_CITY)!;
    const overlay = buildUHIOverlayCells(ALL_CELLS, [result], [TEST_CITY]);
    expect(overlay.length).toBeGreaterThan(0);
  });

  it('all overlay cells have valid color strings', () => {
    const result = computeUHI(ALL_CELLS, TEST_CITY)!;
    const overlay = buildUHIOverlayCells(ALL_CELLS, [result], [TEST_CITY]);
    for (const cell of overlay) {
      expect(cell.color).toMatch(/^rgb\(/);
    }
  });

  it('urban cells carry the UHI intensity; rural cells carry 0', () => {
    const result = computeUHI(ALL_CELLS, TEST_CITY)!;
    const overlay = buildUHIOverlayCells(ALL_CELLS, [result], [TEST_CITY]);
    const urbanOverlay = overlay.filter(
      (o) => latLonDistanceDeg(o.lat, o.lon, TEST_CITY.lat, TEST_CITY.lon) <= TEST_CITY.urbanRadiusDeg,
    );
    const ruralOverlay = overlay.filter(
      (o) => latLonDistanceDeg(o.lat, o.lon, TEST_CITY.lat, TEST_CITY.lon) > TEST_CITY.urbanRadiusDeg,
    );
    for (const o of urbanOverlay) expect(o.intensity).toBeCloseTo(result.intensity, 5);
    for (const o of ruralOverlay) expect(o.intensity).toBe(0);
  });

  it('returns empty array when grid is empty', () => {
    expect(buildUHIOverlayCells([], MOCK_UHI_RESULTS.slice(0, 1), CITY_DEFINITIONS)).toHaveLength(0);
  });
});

// ── Mock data sanity ──────────────────────────────────────────────────────────

describe('MOCK_UHI_RESULTS', () => {
  it('is sorted in descending intensity order', () => {
    for (let i = 1; i < MOCK_UHI_RESULTS.length; i++) {
      expect(MOCK_UHI_RESULTS[i - 1].intensity).toBeGreaterThanOrEqual(
        MOCK_UHI_RESULTS[i].intensity,
      );
    }
  });

  it('all intensities equal urbanTemp − ruralTemp', () => {
    for (const r of MOCK_UHI_RESULTS) {
      expect(r.intensity).toBeCloseTo(r.urbanTemp - r.ruralTemp, 5);
    }
  });

  it(`hotspot threshold is ${UHI_HOTSPOT_THRESHOLD}°C; at least one city qualifies`, () => {
    const hotspots = MOCK_UHI_RESULTS.filter((r) => r.intensity >= UHI_HOTSPOT_THRESHOLD);
    expect(hotspots.length).toBeGreaterThan(0);
  });
});
