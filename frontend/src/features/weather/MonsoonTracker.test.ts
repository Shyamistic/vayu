/**
 * Unit tests for MonsoonTracker pure functions.
 *
 * Covers:
 *  - daysDifference
 *  - classifyMonsoonIndex
 *  - computeMonsoonIndex (Req 18.4)
 *  - buildIsochroneBands (Req 18.1, 18.3)
 *  - isochroneColor
 */

import { describe, it, expect } from 'vitest';
import {
  daysDifference,
  toNormalizedDate,
  classifyMonsoonIndex,
  computeMonsoonIndex,
  buildIsochroneBands,
  isochroneColor,
  ISOCHRONE_COLORS,
  ISMR_NORMAL_MM_PER_DAY,
  IMD_NORMAL_ONSET_BY_LAT,
} from './MonsoonTracker';
import type { GridCell } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(lat: number, lon: number, rainfall: number): GridCell {
  return {
    lat,
    lon,
    node_idx: 0,
    rainfall,
    temp_max: 30,
    temp_min: 22,
    rainfall_uncertainty: 0,
    temp_max_uncertainty: 0,
    temp_min_uncertainty: 0,
  };
}

/** Cells uniformly spread across the ISMR core zone */
function makeCoreZoneCells(rainfallPerCell: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let lat = 10; lat <= 26; lat += 2) {
    for (let lon = 70; lon <= 96; lon += 2) {
      cells.push(makeCell(lat, lon, rainfallPerCell));
    }
  }
  return cells;
}

// ── toNormalizedDate ──────────────────────────────────────────────────────────

describe('toNormalizedDate', () => {
  it('parses June 1 correctly', () => {
    const d = toNormalizedDate('2000-06-01');
    expect(d.getMonth()).toBe(5);   // 0-indexed
    expect(d.getDate()).toBe(1);
  });

  it('normalises to the given year', () => {
    const d = toNormalizedDate('2000-07-15', 2025);
    expect(d.getFullYear()).toBe(2025);
  });
});

// ── daysDifference ─────────────────────────────────────────────────────────────

describe('daysDifference', () => {
  it('returns 0 for the same date', () => {
    expect(daysDifference('2000-06-01', '2000-06-01')).toBe(0);
  });

  it('returns positive when a is after b', () => {
    expect(daysDifference('2000-06-15', '2000-06-01')).toBe(14);
  });

  it('returns negative when a is before b', () => {
    expect(daysDifference('2000-06-01', '2000-06-10')).toBe(-9);
  });

  it('handles month boundary correctly', () => {
    expect(daysDifference('2000-07-01', '2000-06-30')).toBe(1);
  });
});

// ── classifyMonsoonIndex ───────────────────────────────────────────────────────

describe('classifyMonsoonIndex', () => {
  it('classifies deficient when index < 0.80', () => {
    expect(classifyMonsoonIndex(0.75)).toBe('deficient');
    expect(classifyMonsoonIndex(0.0)).toBe('deficient');
  });

  it('classifies below_normal when 0.80 ≤ index < 0.90', () => {
    expect(classifyMonsoonIndex(0.80)).toBe('below_normal');
    expect(classifyMonsoonIndex(0.85)).toBe('below_normal');
  });

  it('classifies normal when 0.90 ≤ index ≤ 1.10', () => {
    expect(classifyMonsoonIndex(0.90)).toBe('normal');
    expect(classifyMonsoonIndex(1.00)).toBe('normal');
    expect(classifyMonsoonIndex(1.10)).toBe('normal');
  });

  it('classifies above_normal when 1.10 < index ≤ 1.20', () => {
    expect(classifyMonsoonIndex(1.15)).toBe('above_normal');
    expect(classifyMonsoonIndex(1.20)).toBe('above_normal');
  });

  it('classifies excess when index > 1.20', () => {
    expect(classifyMonsoonIndex(1.21)).toBe('excess');
    expect(classifyMonsoonIndex(2.00)).toBe('excess');
  });
});

// ── computeMonsoonIndex ────────────────────────────────────────────────────────

describe('computeMonsoonIndex', () => {
  it('returns null for empty grid', () => {
    expect(computeMonsoonIndex([])).toBeNull();
  });

  it('returns null when no cells are in the core zone', () => {
    // Cells outside [8-28°N, 68-97°E]
    const outsideCells = [makeCell(35, 77, 5)];
    expect(computeMonsoonIndex(outsideCells)).toBeNull();
  });

  it('computes index = rainfall / normal for core zone cells', () => {
    const cells = makeCoreZoneCells(ISMR_NORMAL_MM_PER_DAY);
    const result = computeMonsoonIndex(cells)!;
    expect(result).not.toBeNull();
    expect(result.value).toBeCloseTo(1.0, 5);
    expect(result.category).toBe('normal');
  });

  it('classifies excess for double-normal rainfall', () => {
    const cells = makeCoreZoneCells(ISMR_NORMAL_MM_PER_DAY * 2);
    const result = computeMonsoonIndex(cells)!;
    expect(result.value).toBeCloseTo(2.0, 5);
    expect(result.category).toBe('excess');
  });

  it('classifies deficient for very low rainfall', () => {
    const cells = makeCoreZoneCells(ISMR_NORMAL_MM_PER_DAY * 0.5);
    const result = computeMonsoonIndex(cells)!;
    expect(result.value).toBeCloseTo(0.5, 5);
    expect(result.category).toBe('deficient');
  });

  it('index value is rainfall / normalMmPerDay', () => {
    const cells = makeCoreZoneCells(8.0);
    const result = computeMonsoonIndex(cells, 8.0)!;
    expect(result.value).toBeCloseTo(1.0, 5);
  });
});

// ── buildIsochroneBands ────────────────────────────────────────────────────────

describe('buildIsochroneBands', () => {
  it('returns one band per IMD normal onset zone', () => {
    const bands = buildIsochroneBands([]);
    expect(bands.length).toBe(IMD_NORMAL_ONSET_BY_LAT.length);
  });

  it('each band has a lat matching the zone definition', () => {
    const bands = buildIsochroneBands([]);
    bands.forEach((band, i) => {
      expect(band.lat).toBe(IMD_NORMAL_ONSET_BY_LAT[i].lat);
    });
  });

  it('uses normal onset date when no cells are available (daysAheadOfNormal = 0)', () => {
    const bands = buildIsochroneBands([]);
    // With no data, rainfall defaults to ISMR_NORMAL_MM_PER_DAY → no shift.
    // Use == 0 to treat +0 and -0 as equal (IEEE 754 artifact).
    bands.forEach((band) => {
      expect(band.daysAheadOfNormal == 0).toBe(true);
    });
  });

  it('shifts onset earlier (positive daysAheadOfNormal) with above-normal rainfall', () => {
    // Rainfall above normal should move onset earlier → positive daysAheadOfNormal
    const cells: GridCell[] = IMD_NORMAL_ONSET_BY_LAT.map((z) =>
      makeCell(z.lat, 77, ISMR_NORMAL_MM_PER_DAY * 3), // 3× normal = very wet
    );
    const bands = buildIsochroneBands(cells);
    bands.forEach((band) => {
      expect(band.daysAheadOfNormal).toBeGreaterThan(0);
    });
  });

  it('shifts onset later (negative daysAheadOfNormal) with below-normal rainfall', () => {
    // Very dry conditions → delayed onset
    const cells: GridCell[] = IMD_NORMAL_ONSET_BY_LAT.map((z) =>
      makeCell(z.lat, 77, 0), // 0 rainfall = drought
    );
    const bands = buildIsochroneBands(cells);
    bands.forEach((band) => {
      expect(band.daysAheadOfNormal).toBeLessThan(0);
    });
  });

  it('all bands have a valid hex/rgb color', () => {
    const bands = buildIsochroneBands([]);
    bands.forEach((band) => {
      expect(band.color).toMatch(/^#[0-9a-fA-F]{6}$|^rgb\(/);
    });
  });

  it('predicted and normal onset dates are valid ISO date strings', () => {
    const bands = buildIsochroneBands([]);
    const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
    bands.forEach((band) => {
      expect(band.predictedOnsetDate).toMatch(isoPattern);
      expect(band.normalOnsetDate).toMatch(isoPattern);
    });
  });
});

// ── isochroneColor ────────────────────────────────────────────────────────────

describe('isochroneColor', () => {
  it('returns the first color for index 0', () => {
    expect(isochroneColor(0)).toBe(ISOCHRONE_COLORS[0]);
  });

  it('clamps to last color for out-of-range index', () => {
    expect(isochroneColor(999)).toBe(ISOCHRONE_COLORS[ISOCHRONE_COLORS.length - 1]);
  });

  it('maps each valid index to a distinct color', () => {
    const colors = ISOCHRONE_COLORS.map((_, i) => isochroneColor(i));
    const unique = new Set(colors);
    expect(unique.size).toBe(ISOCHRONE_COLORS.length);
  });
});
