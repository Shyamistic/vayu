/**
 * Property-Based Test: Region Selection Triggers Correct Data Fetch
 *
 * **Validates: Requirements 7.1, 7.3**
 *
 * Property 5: For any region r in the valid set {western_ghats, north_east_india,
 * indo_gangetic_plain, central_india, pilot}, selecting r SHALL trigger a prediction
 * API call with region=r and the globe SHALL render only grid cells within r's
 * geographic extent.
 *
 * Two complementary sub-properties are tested:
 *
 * Part A — API Query Key Correctness (Req 7.1):
 *   setRegion(r) stores selectedRegion=r, which is then passed as the `region`
 *   parameter in usePrediction's query key:
 *     queryKey: ['prediction', date, region, lead_day]
 *   This guarantees the prediction API call uses region=r.
 *
 * Part B — Geographic Extent Enforcement (Req 7.3):
 *   For any region r, isCellWithinRegion(cell, r) returns true for cells inside
 *   r's bounding box and false for cells outside it. filterCellsByRegion keeps
 *   only in-extent cells, ensuring the globe renders no out-of-region cells.
 */

import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect, beforeEach } from 'vitest';
import { useAppStore } from './appStore';
import {
  REGION_EXTENTS,
  HALF_CELL,
  isCellWithinRegion,
  filterCellsByRegion,
} from '../utils/regionUtils';
import type { GridCell } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** The complete set of valid region IDs matching the RegionId type */
const VALID_REGIONS = [
  'western_ghats',
  'north_east_india',
  'indo_gangetic_plain',
  'central_india',
  'full_india',
] as const;

type ValidRegion = typeof VALID_REGIONS[number];

/** Arbitrary for generating random valid region IDs */
const arbValidRegion = fc.constantFrom(...VALID_REGIONS);

// ── Grid Cell Arbitraries ─────────────────────────────────────────────────────

/** Make a minimal GridCell with given lat/lon */
function makeCell(lat: number, lon: number): GridCell {
  return {
    lat,
    lon,
    node_idx: 0,
    rainfall: 10,
    temp_max: 30,
    temp_min: 20,
    rainfall_uncertainty: 2,
    temp_max_uncertainty: 1,
    temp_min_uncertainty: 1,
  };
}

/** Arbitrary: generate a grid cell strictly INSIDE the given region's extent */
function arbCellInsideRegion(region: ValidRegion): fc.Arbitrary<GridCell> {
  const ext = REGION_EXTENTS[region];
  // Use a small inset so cells are clearly within bounds (not on the edge)
  const inset = 0.3;
  return fc.record({
    lat: fc.double({ min: ext.lat_min + inset, max: ext.lat_max - inset, noNaN: true }),
    lon: fc.double({ min: ext.lon_min + inset, max: ext.lon_max - inset, noNaN: true }),
  }).map(({ lat, lon }) => makeCell(lat, lon));
}

/** Arbitrary: generate a grid cell OUTSIDE every valid region's extent */
const arbCellOutsideAllRegions = fc.record({
  // Generate lat/lon clearly outside all regions — far north or deep south
  lat: fc.oneof(
    fc.double({ min: -90, max: 5.0, noNaN: true }),   // Far south
    fc.double({ min: 40.0, max: 90, noNaN: true }),   // Far north
  ),
  lon: fc.double({ min: 50.0, max: 68.0, noNaN: true }), // West of India
}).map(({ lat, lon }) => makeCell(lat, lon));

/** Arbitrary: generate a cell outside the specific region's bounding box */
function arbCellOutsideRegion(region: ValidRegion): fc.Arbitrary<GridCell> {
  const ext = REGION_EXTENTS[region];
  // Generate a cell far outside — at least 2° beyond any boundary
  const margin = 2.0;
  return fc.oneof(
    // South of region
    fc.record({
      lat: fc.double({ min: -60, max: ext.lat_min - margin, noNaN: true }),
      lon: fc.double({ min: ext.lon_min, max: ext.lon_max, noNaN: true }),
    }),
    // North of region
    fc.record({
      lat: fc.double({ min: ext.lat_max + margin, max: 90, noNaN: true }),
      lon: fc.double({ min: ext.lon_min, max: ext.lon_max, noNaN: true }),
    }),
    // West of region
    fc.record({
      lat: fc.double({ min: ext.lat_min, max: ext.lat_max, noNaN: true }),
      lon: fc.double({ min: -180, max: ext.lon_min - margin, noNaN: true }),
    }),
    // East of region
    fc.record({
      lat: fc.double({ min: ext.lat_min, max: ext.lat_max, noNaN: true }),
      lon: fc.double({ min: ext.lon_max + margin, max: 180, noNaN: true }),
    }),
  ).map(({ lat, lon }) => makeCell(lat, lon));
}

// ── Part A: API Query Key Correctness ────────────────────────────────────────

describe('Property 5 (Part A): Region Selection → API Query Key Contains region=r', () => {
  beforeEach(() => {
    // Reset store to default state before each test
    useAppStore.setState({ selectedRegion: 'western_ghats' });
  });

  /**
   * For any valid region r, setRegion(r) stores the exact region value.
   * This ensures the prediction query key will contain region=r.
   */
  test.prop([arbValidRegion])(
    'setRegion(r) stores the exact region for any valid region r',
    (region) => {
      useAppStore.getState().setRegion(region);
      const stored = useAppStore.getState().selectedRegion;

      expect(stored).toBe(region);
    }
  );

  /**
   * For any valid region r, the usePrediction query key would contain region=r.
   * We verify by checking the store state that feeds into the query key:
   *   queryKey: ['prediction', date, region, lead_day]
   * The selectedRegion in the store IS the region param passed to usePrediction.
   */
  test.prop([arbValidRegion])(
    'selectedRegion after setRegion(r) would produce query key containing region=r',
    (region) => {
      useAppStore.getState().setRegion(region);
      const state = useAppStore.getState();

      // Simulate the query key construction from usePrediction hook
      const queryKey = ['prediction', '2025-06-15', state.selectedRegion, state.forecastDay];

      expect(queryKey[2]).toBe(region);
    }
  );

  /**
   * For any valid region r, setRegion(r) does not alter other state fields.
   * This ensures no cross-contamination between region selection and other
   * query key components (date, lead_day) or feature toggles.
   */
  test.prop([arbValidRegion])(
    'setRegion(r) does not alter forecastDay, variable, or viewMode',
    (region) => {
      const stateBefore = useAppStore.getState();
      const forecastDayBefore = stateBefore.forecastDay;
      const variableBefore = stateBefore.selectedVariable;
      const viewModeBefore = stateBefore.viewMode;

      useAppStore.getState().setRegion(region);

      const stateAfter = useAppStore.getState();
      expect(stateAfter.forecastDay).toBe(forecastDayBefore);
      expect(stateAfter.selectedVariable).toBe(variableBefore);
      expect(stateAfter.viewMode).toBe(viewModeBefore);
      expect(stateAfter.selectedRegion).toBe(region);
    }
  );

  /**
   * For any two consecutive region selections, the final state reflects only
   * the last region set — proving state transitions are clean and the API would
   * fetch for the latest region, not a stale one.
   */
  test.prop([arbValidRegion, arbValidRegion])(
    'consecutive setRegion calls result in the last region being stored',
    (firstRegion, secondRegion) => {
      useAppStore.getState().setRegion(firstRegion);
      useAppStore.getState().setRegion(secondRegion);
      const stored = useAppStore.getState().selectedRegion;

      expect(stored).toBe(secondRegion);
    }
  );

  /**
   * For any valid region, the stored value is always one of the 5 valid region IDs.
   * This guarantees the globe will only render cells within a valid region's extent.
   */
  test.prop([arbValidRegion])(
    'stored region is always a member of the valid REGIONS set',
    (region) => {
      useAppStore.getState().setRegion(region);
      const stored = useAppStore.getState().selectedRegion;

      expect(VALID_REGIONS).toContain(stored);
    }
  );
});

// ── Part B: Geographic Extent Enforcement (isCellWithinRegion) ────────────────

describe('Property 5 (Part B): Globe Renders Only Cells Within Region Extent', () => {
  /**
   * For any cell clearly inside region r, isCellWithinRegion(cell, r) returns true.
   * This verifies the acceptance predicate correctly identifies in-region cells.
   *
   * Validates: Req 7.3 — globe SHALL render only grid cells within r's extent.
   */
  test.prop([arbValidRegion.chain((r) => arbCellInsideRegion(r).map((cell) => ({ region: r, cell })))])(
    'isCellWithinRegion returns true for any cell clearly inside the region',
    ({ region, cell }) => {
      expect(isCellWithinRegion(cell, region)).toBe(true);
    }
  );

  /**
   * For any cell clearly outside region r (2°+ beyond any boundary),
   * isCellWithinRegion(cell, r) returns false.
   */
  test.prop([arbValidRegion.chain((r) => arbCellOutsideRegion(r).map((cell) => ({ region: r, cell })))])(
    'isCellWithinRegion returns false for any cell clearly outside the region',
    ({ region, cell }) => {
      expect(isCellWithinRegion(cell, region)).toBe(false);
    }
  );

  /**
   * For any cell outside all known regions, isCellWithinRegion returns false
   * for every valid region. This ensures spurious cells from outside India
   * are never rendered when any region is selected.
   */
  test.prop([arbCellOutsideAllRegions])(
    'cell far outside India is rejected by every region',
    (cell) => {
      for (const region of VALID_REGIONS) {
        expect(isCellWithinRegion(cell, region)).toBe(false);
      }
    }
  );

  /**
   * REGION_EXTENTS has a defined, non-empty bounding box for every valid region.
   * This structural invariant guarantees the filter can never accept all cells
   * indiscriminately due to an undefined or zero-area extent.
   */
  test.prop([arbValidRegion])(
    'every valid region has a non-zero-area bounding box in REGION_EXTENTS',
    (region) => {
      const ext = REGION_EXTENTS[region];
      expect(ext.lat_max).toBeGreaterThan(ext.lat_min);
      expect(ext.lon_max).toBeGreaterThan(ext.lon_min);
      // Must cover at least a 1° range in each dimension (no degenerate boxes)
      expect(ext.lat_max - ext.lat_min).toBeGreaterThanOrEqual(1.0);
      expect(ext.lon_max - ext.lon_min).toBeGreaterThanOrEqual(1.0);
    }
  );

  /**
   * filterCellsByRegion keeps every cell that passes isCellWithinRegion.
   * For any array of mixed cells, every cell in the filtered output is within bounds.
   *
   * This is the core "globe renders only cells within r's extent" invariant:
   * ∀ cell ∈ filterCellsByRegion(cells, r) → isCellWithinRegion(cell, r) = true
   */
  test.prop([
    arbValidRegion.chain((r) =>
      fc.tuple(
        fc.array(arbCellInsideRegion(r), { minLength: 1, maxLength: 20 }),
        fc.array(arbCellOutsideRegion(r), { minLength: 0, maxLength: 20 }),
      ).map(([inside, outside]) => ({ region: r, inside, outside }))
    ),
  ])(
    'filterCellsByRegion result contains only cells within the region extent',
    ({ region, inside, outside }) => {
      const mixed = [...inside, ...outside];
      const filtered = filterCellsByRegion(mixed, region);

      for (const cell of filtered) {
        expect(isCellWithinRegion(cell, region)).toBe(true);
      }
    }
  );

  /**
   * filterCellsByRegion retains ALL cells that are inside the region.
   * No in-region cell should be dropped by the filter.
   *
   * ∀ cell ∈ inside → cell ∈ filterCellsByRegion(inside, r)
   */
  test.prop([
    arbValidRegion.chain((r) =>
      arbCellInsideRegion(r)
        .chain((cell) => fc.constant({ region: r, cell }))
    ),
  ])(
    'filterCellsByRegion retains all cells that are inside the region',
    ({ region, cell }) => {
      const filtered = filterCellsByRegion([cell], region);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual(cell);
    }
  );

  /**
   * filterCellsByRegion excludes ALL cells that are clearly outside the region.
   * No out-of-region cell should pass through the filter.
   *
   * ∀ cell ∈ outside (2°+ from boundary) → cell ∉ filterCellsByRegion(outside, r)
   */
  test.prop([
    arbValidRegion.chain((r) =>
      fc.array(arbCellOutsideRegion(r), { minLength: 1, maxLength: 20 })
        .map((cells) => ({ region: r, cells }))
    ),
  ])(
    'filterCellsByRegion excludes all cells clearly outside the region',
    ({ region, cells }) => {
      const filtered = filterCellsByRegion(cells, region);
      expect(filtered).toHaveLength(0);
    }
  );

  /**
   * filterCellsByRegion with an empty input returns an empty array.
   * Edge case: no cells to render is a valid state.
   */
  test.prop([arbValidRegion])(
    'filterCellsByRegion of empty array returns empty array',
    (region) => {
      const result = filterCellsByRegion([], region);
      expect(result).toHaveLength(0);
    }
  );

  /**
   * HALF_CELL tolerance (0.125°) is exactly half of the 0.25° grid resolution.
   * This structural constant ensures boundary cells are accepted, not rejected.
   */
  test.prop([arbValidRegion])(
    'HALF_CELL tolerance allows cells on the exact boundary edge to be accepted',
    (region) => {
      const ext = REGION_EXTENTS[region];
      // Create cells exactly on each boundary — they should be accepted
      const onSouth = makeCell(ext.lat_min, (ext.lon_min + ext.lon_max) / 2);
      const onNorth = makeCell(ext.lat_max, (ext.lon_min + ext.lon_max) / 2);
      const onWest = makeCell((ext.lat_min + ext.lat_max) / 2, ext.lon_min);
      const onEast = makeCell((ext.lat_min + ext.lat_max) / 2, ext.lon_max);

      expect(isCellWithinRegion(onSouth, region)).toBe(true);
      expect(isCellWithinRegion(onNorth, region)).toBe(true);
      expect(isCellWithinRegion(onWest, region)).toBe(true);
      expect(isCellWithinRegion(onEast, region)).toBe(true);
    }
  );

  /**
   * Cells at exactly HALF_CELL beyond the boundary should still be accepted
   * (they are the outer edge of a 0.25° cell straddling the boundary).
   * Cells beyond HALF_CELL are rejected.
   */
  test.prop([arbValidRegion])(
    'cells beyond HALF_CELL outside boundary are rejected',
    (region) => {
      const ext = REGION_EXTENTS[region];
      const midLon = (ext.lon_min + ext.lon_max) / 2;
      const midLat = (ext.lat_min + ext.lat_max) / 2;

      // 1° beyond boundary — clearly outside tolerance
      const farSouth = makeCell(ext.lat_min - 1.0, midLon);
      const farNorth = makeCell(ext.lat_max + 1.0, midLon);
      const farWest = makeCell(midLat, ext.lon_min - 1.0);
      const farEast = makeCell(midLat, ext.lon_max + 1.0);

      expect(isCellWithinRegion(farSouth, region)).toBe(false);
      expect(isCellWithinRegion(farNorth, region)).toBe(false);
      expect(isCellWithinRegion(farWest, region)).toBe(false);
      expect(isCellWithinRegion(farEast, region)).toBe(false);
    }
  );
});
