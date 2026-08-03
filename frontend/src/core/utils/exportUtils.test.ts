/**
 * Unit tests for exportUtils.ts
 *
 * Covers: CSV generation, CSV parsing, round-trip, GeoTIFF metadata, bounds computation.
 * Requirements: 28.1, 28.2, 28.4, 28.5
 */

import { describe, it, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  generateCsv,
  parseCsv,
  csvRowToLine,
  gridCellToCsvRow,
  computeGeoBounds,
  buildGeoTiffMetadata,
  CSV_COLUMNS,
} from './exportUtils';
import type { GridCell } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(
  lat: number,
  lon: number,
  rainfall = 10,
  temp_max = 35,
  temp_min = 20
): GridCell {
  return {
    lat,
    lon,
    node_idx: 0,
    rainfall,
    temp_max,
    temp_min,
    rainfall_uncertainty: 0.5,
    temp_max_uncertainty: 0.3,
    temp_min_uncertainty: 0.2,
  };
}

// ── CSV_COLUMNS ───────────────────────────────────────────────────────────────

describe('CSV_COLUMNS', () => {
  it('includes all required columns from Requirement 28.2', () => {
    const required = ['lat', 'lon', 'date', 'rainfall', 'temp_max', 'temp_min'];
    for (const col of required) {
      expect(CSV_COLUMNS).toContain(col);
    }
  });

  it('includes uncertainty columns', () => {
    expect(CSV_COLUMNS).toContain('rainfall_uncertainty');
    expect(CSV_COLUMNS).toContain('temp_max_uncertainty');
    expect(CSV_COLUMNS).toContain('temp_min_uncertainty');
  });
});

// ── gridCellToCsvRow ──────────────────────────────────────────────────────────

describe('gridCellToCsvRow', () => {
  it('maps all fields correctly', () => {
    const cell = makeCell(20.0, 75.0, 55.5, 38.2, 24.1);
    const row = gridCellToCsvRow(cell, '2025-07-15');
    expect(row.lat).toBe(20.0);
    expect(row.lon).toBe(75.0);
    expect(row.date).toBe('2025-07-15');
    expect(row.rainfall).toBe(55.5);
    expect(row.temp_max).toBe(38.2);
    expect(row.temp_min).toBe(24.1);
    expect(row.rainfall_uncertainty).toBe(0.5);
  });
});

// ── csvRowToLine ──────────────────────────────────────────────────────────────

describe('csvRowToLine', () => {
  it('produces comma-separated values in correct order', () => {
    const cell = makeCell(20.0, 75.0, 55.5, 38.25, 24.1);
    const row = gridCellToCsvRow(cell, '2025-07-15');
    const line = csvRowToLine(row, 4);
    const parts = line.split(',');
    expect(parts[0]).toBe('20');
    expect(parts[1]).toBe('75');
    expect(parts[2]).toBe('2025-07-15');
    expect(parts[3]).toBe('55.5');
    expect(parts[4]).toBe('38.25');
    expect(parts[5]).toBe('24.1');
  });

  it('quotes date field containing no special chars (no quoting needed)', () => {
    const cell = makeCell(10, 70);
    const row = gridCellToCsvRow(cell, '2025-01-01');
    const line = csvRowToLine(row, 4);
    // Date should appear unquoted since it has no commas or quotes
    expect(line).toContain('2025-01-01');
  });

  it('rounds to specified precision', () => {
    const cell = makeCell(20.123456789, 75.987654321, 10.111111);
    const row = gridCellToCsvRow(cell, '2025-07-15');
    const line = csvRowToLine(row, 2);
    expect(line.startsWith('20.12,75.99,')).toBe(true);
  });
});

// ── generateCsv ───────────────────────────────────────────────────────────────

describe('generateCsv', () => {
  it('produces correct header row', () => {
    const csv = generateCsv([], { date: '2025-07-15' });
    const firstLine = csv.split('\r\n')[0];
    expect(firstLine).toBe(CSV_COLUMNS.join(','));
  });

  it('produces one data row per cell', () => {
    const cells = [makeCell(20, 75), makeCell(21, 76)];
    const csv = generateCsv(cells, { date: '2025-07-15' });
    const lines = csv.split('\r\n').filter(l => l.length > 0);
    // header + 2 data rows
    expect(lines).toHaveLength(3);
  });

  it('handles empty cell array (header only)', () => {
    const csv = generateCsv([], { date: '2025-07-15' });
    const lines = csv.split('\r\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
  });

  it('uses CRLF line endings (RFC 4180)', () => {
    const cells = [makeCell(20, 75)];
    const csv = generateCsv(cells, { date: '2025-07-15' });
    expect(csv).toContain('\r\n');
  });

  it('embeds the provided date in each row', () => {
    const cells = [makeCell(20, 75), makeCell(21, 76)];
    const csv = generateCsv(cells, { date: '2025-12-25' });
    const lines = csv.split('\r\n').slice(1).filter(l => l.length > 0);
    for (const line of lines) {
      expect(line).toContain('2025-12-25');
    }
  });
});

// ── parseCsv ──────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('returns empty array for empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('returns empty array for header-only CSV', () => {
    const csv = CSV_COLUMNS.join(',');
    expect(parseCsv(csv)).toEqual([]);
  });

  it('parses a single data row correctly', () => {
    const csv = [
      CSV_COLUMNS.join(','),
      '20,75,2025-07-15,55.5,38.25,24.1,0.5,0.3,0.2',
    ].join('\r\n');

    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(20, 5);
    expect(rows[0].lon).toBeCloseTo(75, 5);
    expect(rows[0].date).toBe('2025-07-15');
    expect(rows[0].rainfall).toBeCloseTo(55.5, 5);
    expect(rows[0].temp_max).toBeCloseTo(38.25, 5);
    expect(rows[0].temp_min).toBeCloseTo(24.1, 5);
    expect(rows[0].rainfall_uncertainty).toBeCloseTo(0.5, 5);
  });

  it('parses multiple rows', () => {
    const cells = [makeCell(20, 75, 10, 35, 22), makeCell(21, 76, 20, 36, 23)];
    const csv = generateCsv(cells, { date: '2025-07-15' });
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
  });
});

// ── Round-trip: generateCsv → parseCsv ───────────────────────────────────────

describe('CSV round-trip', () => {
  it('preserves lat and lon to 4 decimal places', () => {
    const cells = [makeCell(20.1234, 75.5678)];
    const csv = generateCsv(cells, { date: '2025-07-15', precision: 4 });
    const rows = parseCsv(csv);
    expect(rows[0].lat).toBeCloseTo(20.1234, 4);
    expect(rows[0].lon).toBeCloseTo(75.5678, 4);
  });

  it('preserves rainfall, temp_max, temp_min to 4 decimal places', () => {
    const cells = [makeCell(20, 75, 123.4567, 40.1234, 18.9876)];
    const csv = generateCsv(cells, { date: '2025-07-15', precision: 4 });
    const rows = parseCsv(csv);
    expect(rows[0].rainfall).toBeCloseTo(123.4567, 4);
    expect(rows[0].temp_max).toBeCloseTo(40.1234, 4);
    expect(rows[0].temp_min).toBeCloseTo(18.9876, 4);
  });

  it('preserves date string exactly', () => {
    const cells = [makeCell(20, 75)];
    const date = '2025-06-15';
    const csv = generateCsv(cells, { date });
    const rows = parseCsv(csv);
    expect(rows[0].date).toBe(date);
  });

  it('round-trips a large set of cells without data loss', () => {
    const cells: GridCell[] = [];
    for (let lat = 10; lat <= 25; lat += 0.25) {
      for (let lon = 70; lon <= 85; lon += 0.25) {
        cells.push(makeCell(lat, lon, lat * 2, lon - 30, lat - 5));
      }
    }
    const csv = generateCsv(cells, { date: '2025-07-15', precision: 4 });
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(cells.length);
    for (let i = 0; i < cells.length; i++) {
      expect(rows[i].lat).toBeCloseTo(cells[i].lat, 4);
      expect(rows[i].lon).toBeCloseTo(cells[i].lon, 4);
      expect(rows[i].rainfall).toBeCloseTo(cells[i].rainfall, 4);
      expect(rows[i].temp_max).toBeCloseTo(cells[i].temp_max, 4);
      expect(rows[i].temp_min).toBeCloseTo(cells[i].temp_min, 4);
    }
  });
});

// ── computeGeoBounds ──────────────────────────────────────────────────────────

describe('computeGeoBounds', () => {
  it('returns zero bounds for empty array', () => {
    const bounds = computeGeoBounds([]);
    expect(bounds).toEqual({ west: 0, east: 0, south: 0, north: 0 });
  });

  it('extends bounds by half-cell (0.125°) from cell centres', () => {
    const cells = [makeCell(20, 75)];
    const bounds = computeGeoBounds(cells);
    expect(bounds.west).toBeCloseTo(74.875, 5);
    expect(bounds.east).toBeCloseTo(75.125, 5);
    expect(bounds.south).toBeCloseTo(19.875, 5);
    expect(bounds.north).toBeCloseTo(20.125, 5);
  });

  it('computes correct bounds for multiple cells', () => {
    const cells = [
      makeCell(10, 70),
      makeCell(10, 75),
      makeCell(25, 70),
      makeCell(25, 85),
    ];
    const bounds = computeGeoBounds(cells);
    expect(bounds.west).toBeCloseTo(69.875, 5);
    expect(bounds.east).toBeCloseTo(85.125, 5);
    expect(bounds.south).toBeCloseTo(9.875, 5);
    expect(bounds.north).toBeCloseTo(25.125, 5);
  });
});

// ── buildGeoTiffMetadata ──────────────────────────────────────────────────────

describe('buildGeoTiffMetadata', () => {
  it('uses EPSG:4326 CRS', () => {
    const cells = [makeCell(20, 75)];
    const meta = buildGeoTiffMetadata(cells, 'rainfall');
    expect(meta.crs).toBe('EPSG:4326');
  });

  it('computes correct grid dimensions', () => {
    const cells: GridCell[] = [];
    for (let lat = 10; lat <= 12; lat++) {
      for (let lon = 70; lon <= 72; lon++) {
        cells.push(makeCell(lat, lon));
      }
    }
    const meta = buildGeoTiffMetadata(cells, 'rainfall');
    expect(meta.width).toBe(3);  // 70, 71, 72
    expect(meta.height).toBe(3); // 10, 11, 12
  });

  it('records the variable name', () => {
    const cells = [makeCell(20, 75)];
    const meta = buildGeoTiffMetadata(cells, 'temp_max');
    expect(meta.variable).toBe('temp_max');
  });

  it('includes a generatedAt ISO timestamp', () => {
    const cells = [makeCell(20, 75)];
    const meta = buildGeoTiffMetadata(cells, 'rainfall');
    expect(() => new Date(meta.generatedAt)).not.toThrow();
    expect(new Date(meta.generatedAt).getTime()).not.toBeNaN();
  });

  it('pixelWidth and pixelHeight are positive', () => {
    const cells: GridCell[] = [];
    for (let lat = 10; lat <= 15; lat++) {
      for (let lon = 70; lon <= 75; lon++) {
        cells.push(makeCell(lat, lon));
      }
    }
    const meta = buildGeoTiffMetadata(cells, 'rainfall');
    expect(meta.pixelWidth).toBeGreaterThan(0);
    expect(meta.pixelHeight).toBeGreaterThan(0);
  });
});

// ── Property 16: CSV Export Data Preservation (Round-Trip) ───────────────────
// Validates: Requirements 28.2

/**
 * Arbitraries for generating valid GridCell objects.
 *
 * - lat: valid latitude degrees (-90 to 90), constrained to India-ish range for realism
 * - lon: valid longitude degrees (-180 to 180), constrained to India-ish range
 * - rainfall: non-negative millimetres (0 to 500)
 * - temp_max: realistic max temperature (-20 to 60 °C)
 * - temp_min: realistic min temperature (-30 to 50 °C)
 * - uncertainties: non-negative values
 *
 * Values use float() with noNaN and noDefaultInfinity to stay within finite IEEE-754 range,
 * and are constrained to 2 decimal place precision on input so that rounding at precision=2
 * produces an exact round-trip.
 */
const gridCellArb: fc.Arbitrary<GridCell> = fc.record({
  lat: fc.float({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
  lon: fc.float({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
  node_idx: fc.nat({ max: 10000 }),
  rainfall: fc.float({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
  temp_max: fc.float({ min: -20, max: 60, noNaN: true, noDefaultInfinity: true }),
  temp_min: fc.float({ min: -30, max: 50, noNaN: true, noDefaultInfinity: true }),
  rainfall_uncertainty: fc.float({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  temp_max_uncertainty: fc.float({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
  temp_min_uncertainty: fc.float({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
});

/** Check that two numbers are equal within 2 decimal places (tolerance = 0.005). */
function withinTwoDecimalPlaces(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 0.005;
}

describe('Property 16: CSV Export Data Preservation (Round-Trip)', () => {
  /**
   * **Validates: Requirements 28.2**
   *
   * For any array of GridCell objects, exporting to CSV and parsing back SHALL preserve
   * lat, lon, rainfall, temp_max, temp_min within floating-point precision of 2 decimal places.
   *
   * The round-trip uses precision=2 so the exported values are rounded to 2 d.p.; the parsed
   * values must match the rounded originals within the tolerance of 2 d.p. (±0.005).
   */
  test.prop([fc.array(gridCellArb, { minLength: 0, maxLength: 50 })])(
    'export→parse round-trip preserves lat, lon, rainfall, temp_max, temp_min within 2 decimal places',
    (cells) => {
      const date = '2025-07-15';
      const precision = 2;

      const csv = generateCsv(cells, { date, precision });
      const rows = parseCsv(csv);

      // Must recover the same number of rows
      if (rows.length !== cells.length) return false;

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const row = rows[i];

        // Each numeric field must be preserved within 2 decimal places
        if (!withinTwoDecimalPlaces(row.lat, cell.lat)) return false;
        if (!withinTwoDecimalPlaces(row.lon, cell.lon)) return false;
        if (!withinTwoDecimalPlaces(row.rainfall, cell.rainfall)) return false;
        if (!withinTwoDecimalPlaces(row.temp_max, cell.temp_max)) return false;
        if (!withinTwoDecimalPlaces(row.temp_min, cell.temp_min)) return false;
      }

      return true;
    }
  );

  /**
   * **Validates: Requirements 28.2**
   *
   * The round-trip count invariant: the number of parsed rows must always equal
   * the number of input cells, regardless of cell values.
   */
  test.prop([fc.array(gridCellArb, { minLength: 1, maxLength: 50 })])(
    'parsed row count equals input cell count for any non-empty GridCell array',
    (cells) => {
      const csv = generateCsv(cells, { date: '2025-07-15', precision: 2 });
      const rows = parseCsv(csv);
      return rows.length === cells.length;
    }
  );

  /**
   * **Validates: Requirements 28.2**
   *
   * Date string is always preserved exactly through the round-trip,
   * independent of the numeric cell values.
   */
  test.prop([
    fc.array(gridCellArb, { minLength: 1, maxLength: 20 }),
    // Generate valid YYYY-MM-DD date strings directly to avoid invalid Date objects
    fc.integer({ min: 2020, max: 2030 }).chain(year =>
      fc.integer({ min: 1, max: 12 }).chain(month =>
        fc.integer({ min: 1, max: 28 }).map(day => {
          const mm = String(month).padStart(2, '0');
          const dd = String(day).padStart(2, '0');
          return `${year}-${mm}-${dd}`;
        })
      )
    ),
  ])(
    'date string is preserved exactly through round-trip',
    (cells, date) => {
      const csv = generateCsv(cells, { date, precision: 2 });
      const rows = parseCsv(csv);
      return rows.every(row => row.date === date);
    }
  );
});
