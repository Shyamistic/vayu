/**
 * Contour Generation using Marching Squares Algorithm
 *
 * Pure computation module (no Cesium dependency) that generates contour line
 * segments from a 2D grid of climate values. Used by ContourLayer to render
 * isolines and filled contours on the globe.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

import type { GridCell, VariableId } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────────

/** A geographic point on a contour line */
export interface ContourPoint {
  lat: number;
  lon: number;
}

/** A single line segment of a contour */
export type ContourSegment = [ContourPoint, ContourPoint];

/** Result for a single contour level */
export interface ContourResult {
  level: number;
  segments: ContourSegment[];
}

/** Intermediate 2D grid representation */
export interface ValueGrid {
  grid: number[][];
  lats: number[];
  lons: number[];
}

// ── Marching Squares Segment Lookup Table ────────────────────────────────────
// Each case maps to edge pairs. Edges are numbered:
//   top=0, right=1, bottom=2, left=3
// Each entry is an array of pairs [edgeA, edgeB] representing line segments.

type EdgePair = [number, number];

const SEGMENT_TABLE: EdgePair[][] = [
  /* case  0 */ [],
  /* case  1 */ [[3, 2]],
  /* case  2 */ [[2, 1]],
  /* case  3 */ [[3, 1]],
  /* case  4 */ [[1, 0]],
  /* case  5 */ [[3, 0], [1, 2]], // Saddle point — ambiguous, use average
  /* case  6 */ [[2, 0]],
  /* case  7 */ [[3, 0]],
  /* case  8 */ [[0, 3]],
  /* case  9 */ [[0, 2]],
  /* case 10 */ [[0, 1], [2, 3]], // Saddle point — ambiguous, use average
  /* case 11 */ [[0, 1]],
  /* case 12 */ [[1, 3]],
  /* case 13 */ [[1, 2]],
  /* case 14 */ [[2, 3]],
  /* case 15 */ [],
];

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Build a 2D value grid from a flat array of GridCells.
 *
 * Sorts cells by latitude (descending — north to south) and longitude (ascending),
 * then arranges values into a 2D matrix with corresponding lat/lon axes.
 */
export function buildValueGrid(gridCells: GridCell[], variable: VariableId): ValueGrid {
  if (gridCells.length === 0) {
    return { grid: [], lats: [], lons: [] };
  }

  // Extract unique sorted latitudes and longitudes
  const latSet = new Set<number>();
  const lonSet = new Set<number>();

  for (const cell of gridCells) {
    latSet.add(cell.lat);
    lonSet.add(cell.lon);
  }

  // Sort lats descending (north first), lons ascending (west first)
  const lats = Array.from(latSet).sort((a, b) => b - a);
  const lons = Array.from(lonSet).sort((a, b) => a - b);

  // Build lookup map for quick cell access
  const cellMap = new Map<string, number>();
  for (const cell of gridCells) {
    const key = `${cell.lat},${cell.lon}`;
    cellMap.set(key, cell[variable]);
  }

  // Populate 2D grid
  const grid: number[][] = [];
  for (const lat of lats) {
    const row: number[] = [];
    for (const lon of lons) {
      const key = `${lat},${lon}`;
      row.push(cellMap.get(key) ?? 0);
    }
    grid.push(row);
  }

  return { grid, lats, lons };
}

/**
 * Classify a 2×2 cell by comparing corner values to threshold.
 * Returns a 4-bit case index (0–15).
 *
 * Corner layout (matching marching squares convention):
 *   TL(bit3) --- TR(bit2)
 *     |            |
 *   BL(bit0) --- BR(bit1)
 *
 * Where TL = grid[row][col], TR = grid[row][col+1],
 *       BL = grid[row+1][col], BR = grid[row+1][col+1]
 */
function classifyCell(
  grid: number[][],
  row: number,
  col: number,
  threshold: number
): number {
  let caseIndex = 0;
  if (grid[row + 1][col] >= threshold) caseIndex |= 1;     // BL
  if (grid[row + 1][col + 1] >= threshold) caseIndex |= 2; // BR
  if (grid[row][col + 1] >= threshold) caseIndex |= 4;     // TR
  if (grid[row][col] >= threshold) caseIndex |= 8;         // TL
  return caseIndex;
}

/**
 * Linear interpolation between two values to find where threshold crosses.
 * Returns fraction t in [0, 1] representing position between v1 and v2.
 */
function interpolate(v1: number, v2: number, threshold: number): number {
  if (Math.abs(v2 - v1) < 1e-10) return 0.5;
  return (threshold - v1) / (v2 - v1);
}

/**
 * Get the geographic coordinate for an edge crossing in a cell.
 *
 * Edges:
 *   0 = top (between TL and TR)
 *   1 = right (between TR and BR)
 *   2 = bottom (between BL and BR)
 *   3 = left (between TL and BL)
 */
function getEdgePoint(
  grid: number[][],
  lats: number[],
  lons: number[],
  row: number,
  col: number,
  edge: number,
  threshold: number
): ContourPoint {
  const tl = grid[row][col];
  const tr = grid[row][col + 1];
  const bl = grid[row + 1][col];
  const br = grid[row + 1][col + 1];

  const latTop = lats[row];
  const latBottom = lats[row + 1];
  const lonLeft = lons[col];
  const lonRight = lons[col + 1];

  switch (edge) {
    case 0: { // Top edge: between TL and TR
      const t = interpolate(tl, tr, threshold);
      return { lat: latTop, lon: lonLeft + t * (lonRight - lonLeft) };
    }
    case 1: { // Right edge: between TR and BR
      const t = interpolate(tr, br, threshold);
      return { lat: latTop + t * (latBottom - latTop), lon: lonRight };
    }
    case 2: { // Bottom edge: between BL and BR
      const t = interpolate(bl, br, threshold);
      return { lat: latBottom, lon: lonLeft + t * (lonRight - lonLeft) };
    }
    case 3: { // Left edge: between TL and BL
      const t = interpolate(tl, bl, threshold);
      return { lat: latTop + t * (latBottom - latTop), lon: lonLeft };
    }
    default:
      return { lat: latTop, lon: lonLeft };
  }
}

/**
 * Marching Squares algorithm implementation.
 *
 * For a given 2D grid and threshold value, identifies all contour line segments
 * by iterating over each 2×2 cell, classifying it into one of 16 cases, and
 * interpolating edge crossings.
 *
 * @param grid - 2D array of values (rows × cols)
 * @param lats - Latitude values for each row (north to south)
 * @param lons - Longitude values for each column (west to east)
 * @param threshold - The iso-value to contour
 * @returns Array of line segments as [pointA, pointB] pairs
 */
export function marchingSquares(
  grid: number[][],
  lats: number[],
  lons: number[],
  threshold: number
): ContourSegment[] {
  const segments: ContourSegment[] = [];

  if (grid.length < 2 || grid[0].length < 2) {
    return segments;
  }

  const rows = grid.length;
  const cols = grid[0].length;

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const caseIndex = classifyCell(grid, row, col, threshold);

      // Cases 0 and 15: all corners on same side — no contour
      if (caseIndex === 0 || caseIndex === 15) continue;

      // Look up segment edge pairs for this case
      const edgePairs = SEGMENT_TABLE[caseIndex];

      for (const [edgeA, edgeB] of edgePairs) {
        const pointA = getEdgePoint(grid, lats, lons, row, col, edgeA, threshold);
        const pointB = getEdgePoint(grid, lats, lons, row, col, edgeB, threshold);
        segments.push([pointA, pointB]);
      }
    }
  }

  return segments;
}

/**
 * Generate contours for multiple levels from grid cell data.
 *
 * Orchestrates contour generation: builds the value grid once, then runs
 * marching squares for each requested contour level.
 *
 * @param gridCells - Flat array of GridCell prediction data
 * @param variable - Which climate variable to contour (rainfall, temp_max, temp_min)
 * @param levels - Array of threshold values to generate contours for
 * @returns Array of ContourResult objects, one per level
 */
export function generateContours(
  gridCells: GridCell[],
  variable: VariableId,
  levels: number[]
): ContourResult[] {
  if (gridCells.length === 0 || levels.length === 0) {
    return [];
  }

  const { grid, lats, lons } = buildValueGrid(gridCells, variable);

  if (grid.length < 2 || grid[0].length < 2) {
    return [];
  }

  return levels.map(level => ({
    level,
    segments: marchingSquares(grid, lats, lons, level),
  }));
}
