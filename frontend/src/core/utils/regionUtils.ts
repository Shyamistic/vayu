/**
 * Region Utility — Geographic extent definitions and cell filtering.
 *
 * Mirrors the backend REGION_BOUNDS from ai_engine/regions.py so that the
 * frontend can verify that rendered grid cells fall within the selected
 * region's geographic extent (Req 7.1, 7.3).
 *
 * The backend already filters cells by region on the server side. These
 * utilities allow the frontend to validate that assumption and to test
 * the filtering contract independently.
 */

import type { GridCell, RegionId } from '../../types';

// ── Region geographic extents ─────────────────────────────────────────────────
// Mirrors ai_engine/regions.py REGION_BOUNDS exactly.

export interface RegionExtent {
  /** Southern latitude boundary (inclusive) */
  lat_min: number;
  /** Northern latitude boundary (inclusive) */
  lat_max: number;
  /** Western longitude boundary (inclusive) */
  lon_min: number;
  /** Eastern longitude boundary (inclusive) */
  lon_max: number;
}

export const REGION_EXTENTS: Record<RegionId, RegionExtent> = {
  pilot: { lat_min: 8.0, lat_max: 20.0, lon_min: 72.0, lon_max: 78.0 },
  western_ghats: { lat_min: 7.5, lat_max: 21.5, lon_min: 72.0, lon_max: 77.5 },
  north_east_india: { lat_min: 22.0, lat_max: 29.5, lon_min: 88.0, lon_max: 97.5 },
  indo_gangetic_plain: { lat_min: 23.0, lat_max: 31.5, lon_min: 74.0, lon_max: 89.5 },
  central_india: { lat_min: 17.0, lat_max: 25.5, lon_min: 74.0, lon_max: 84.5 },
};

/**
 * Returns true if the given grid cell's center falls within the specified
 * region's geographic bounding box (inclusive bounds).
 *
 * A small tolerance (HALF_CELL = 0.125°) is added to account for cells
 * on the exact boundary edge.
 */
export const HALF_CELL = 0.125; // 0.25° / 2

export function isCellWithinRegion(cell: GridCell, region: RegionId): boolean {
  const extent = REGION_EXTENTS[region];
  return (
    cell.lat >= extent.lat_min - HALF_CELL &&
    cell.lat <= extent.lat_max + HALF_CELL &&
    cell.lon >= extent.lon_min - HALF_CELL &&
    cell.lon <= extent.lon_max + HALF_CELL
  );
}

/**
 * Filters an array of grid cells to only those within the given region's extent.
 * This mirrors the backend's region_mask() function from ai_engine/regions.py.
 *
 * In normal operation the backend already filters by region, so this is used
 * for validation and testing, not for primary rendering logic.
 */
export function filterCellsByRegion(cells: GridCell[], region: RegionId): GridCell[] {
  return cells.filter((cell) => isCellWithinRegion(cell, region));
}

/**
 * Returns the geographic extent for the given region.
 */
export function getRegionExtent(region: RegionId): RegionExtent {
  return REGION_EXTENTS[region];
}

/**
 * Generates a grid cell at the center of the given region's extent.
 * Useful for test fixtures and initial camera positioning.
 */
export function getRegionCenter(region: RegionId): { lat: number; lon: number } {
  const ext = REGION_EXTENTS[region];
  return {
    lat: (ext.lat_min + ext.lat_max) / 2,
    lon: (ext.lon_min + ext.lon_max) / 2,
  };
}
