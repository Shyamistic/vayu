/**
 * downscaling.ts — Statistical Downscaling Utilities
 *
 * Implements elevation-aware statistical downscaling from 0.25° to 0.05°
 * grid resolution for the km-scale resolution display feature.
 *
 * Algorithm:
 *  1. Build a bilinear interpolation mesh from the coarse 0.25° grid.
 *  2. Apply an orographic correction factor derived from the elevation delta
 *     between the coarse grid mean elevation and the fine-grid cell elevation.
 *  3. The orographic lapse rate for temperature is ~6.5 °C / 1000 m.
 *     For rainfall, orographic enhancement factor scales with elevation.
 *
 * Validates: Requirements 84.1, 84.2, 84.3
 */

import type { GridCell, VariableId } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Native model resolution in degrees */
export const NATIVE_RESOLUTION_DEG = 0.25;

/** Downscaled resolution in degrees */
export const DOWNSCALED_RESOLUTION_DEG = 0.05;

/** Ratio of fine cells per coarse dimension */
export const DOWNSCALE_FACTOR = NATIVE_RESOLUTION_DEG / DOWNSCALED_RESOLUTION_DEG; // 5

/** Approximate km per degree at India's latitude (~20°N) */
export const KM_PER_DEG = 111.0;

/** Native resolution in km (0.25° ≈ 27.75 km ≈ 28 km) */
export const NATIVE_RESOLUTION_KM = Math.round(NATIVE_RESOLUTION_DEG * KM_PER_DEG);

/** Downscaled resolution in km (0.05° ≈ 5.55 km ≈ 6 km) */
export const DOWNSCALED_RESOLUTION_KM = Math.round(DOWNSCALED_RESOLUTION_DEG * KM_PER_DEG);

/**
 * Environmental lapse rate: temperature decreases ~6.5°C per 1000 m elevation gain.
 * Used for temperature downscaling correction.
 * Units: °C / metre
 */
const TEMPERATURE_LAPSE_RATE = 0.0065;

/**
 * Orographic rainfall enhancement scale.
 * Rainfall increases roughly 10% per 500 m elevation gain in India's Western Ghats.
 * Units: fraction / metre
 */
const RAINFALL_OROGRAPHIC_SCALE = 0.0002;

// ── Types ─────────────────────────────────────────────────────────────────────

/** A downscaled grid cell with fine resolution */
export interface DownscaledCell {
  lat: number;
  lon: number;
  /** Interpolated rainfall (mm) */
  rainfall: number;
  /** Interpolated max temperature (°C) */
  temp_max: number;
  /** Interpolated min temperature (°C) */
  temp_min: number;
  /** Synthetic elevation estimate (m) based on bilinear position */
  elevation: number;
  /** Whether any elevation correction was applied */
  elevationCorrected: boolean;
  /** Which coarse cell this was downscaled from */
  sourceCell: { lat: number; lon: number };
}

/** Elevation data for a grid point (simplified DEM) */
export interface ElevationPoint {
  lat: number;
  lon: number;
  /** Elevation in metres above sea level */
  elevationM: number;
}

// ── Bilinear Interpolation ─────────────────────────────────────────────────────

/**
 * Bilinear interpolation between four surrounding coarse grid cells.
 *
 * Given a fine grid point (lat, lon) within a coarse cell quad, compute
 * the weighted average of the four corner cell values.
 *
 * @param lat   Target latitude
 * @param lon   Target longitude
 * @param cells Coarse grid cells (sorted by lat/lon)
 * @param variable  Variable to interpolate
 * @returns Interpolated value or null if insufficient surrounding cells
 */
export function bilinearInterpolate(
  lat: number,
  lon: number,
  cells: GridCell[],
  variable: VariableId
): number | null {
  // Build a quick lookup map
  const cellMap = new Map<string, GridCell>();
  for (const cell of cells) {
    // Snap to nearest 0.25° grid
    const snapLat = Math.round(cell.lat / NATIVE_RESOLUTION_DEG) * NATIVE_RESOLUTION_DEG;
    const snapLon = Math.round(cell.lon / NATIVE_RESOLUTION_DEG) * NATIVE_RESOLUTION_DEG;
    cellMap.set(key(snapLat, snapLon), cell);
  }

  // Find the four surrounding coarse grid corners
  const floorLat = Math.floor(lat / NATIVE_RESOLUTION_DEG) * NATIVE_RESOLUTION_DEG;
  const ceilLat  = floorLat + NATIVE_RESOLUTION_DEG;
  const floorLon = Math.floor(lon / NATIVE_RESOLUTION_DEG) * NATIVE_RESOLUTION_DEG;
  const ceilLon  = floorLon + NATIVE_RESOLUTION_DEG;

  const q11 = cellMap.get(key(floorLat, floorLon));
  const q12 = cellMap.get(key(ceilLat,  floorLon));
  const q21 = cellMap.get(key(floorLat, ceilLon));
  const q22 = cellMap.get(key(ceilLat,  ceilLon));

  // Weights in x (lon) and y (lat) direction
  const dLon = ceilLon - floorLon;
  const dLat = ceilLat - floorLat;

  if (dLon === 0 || dLat === 0) return null;

  const tx = (lon - floorLon) / dLon; // [0, 1] along longitude
  const ty = (lat - floorLat) / dLat; // [0, 1] along latitude

  // If any corner is missing, fall back to available corners
  if (q11 && q12 && q21 && q22) {
    // Full bilinear interpolation
    const val =
      (1 - tx) * (1 - ty) * (q11[variable] as number) +
      tx       * (1 - ty) * (q21[variable] as number) +
      (1 - tx) * ty       * (q12[variable] as number) +
      tx       * ty       * (q22[variable] as number);
    return Math.max(0, val); // Ensure non-negative
  }

  // Fall back: use any available cells weighted by proximity
  const available: Array<{ cell: GridCell; w: number }> = [];
  if (q11) available.push({ cell: q11, w: (1 - tx) * (1 - ty) });
  if (q21) available.push({ cell: q21, w: tx * (1 - ty) });
  if (q12) available.push({ cell: q12, w: (1 - tx) * ty });
  if (q22) available.push({ cell: q22, w: tx * ty });

  if (available.length === 0) return null;

  const sumW = available.reduce((s, a) => s + a.w, 0);
  if (sumW === 0) return null;

  const val = available.reduce(
    (s, a) => s + (a.cell[variable] as number) * a.w,
    0
  ) / sumW;

  return Math.max(0, val);
}

/** Build a cell-map key from lat/lon rounded to 3 decimal places */
function key(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

// ── Synthetic elevation estimation ────────────────────────────────────────────

/**
 * Estimate a synthetic elevation for a fine-grid point based on its position
 * within the coarse cell.  This uses a simplified cosine model that is
 * calibrated roughly against India's major terrain features.
 *
 * In production this would be replaced by a proper 90m SRTM DEM lookup.
 * The synthetic model produces elevation corrections that are realistic
 * enough to demonstrate the algorithm's effect.
 *
 * Returns elevation in metres.
 */
export function estimateSyntheticElevation(lat: number, lon: number): number {
  // Western Ghats: lon ~73–77, lat ~8–22
  const wghatsElevation =
    lon >= 72.5 && lon <= 77.5 && lat >= 7.5 && lat <= 21.5
      ? 600 + 500 * Math.sin(((lon - 72.5) / 5) * Math.PI)
      : 0;

  // Himalayas: lat ~28–38, lon ~72–100
  const himalayaElevation =
    lat >= 27 && lat <= 38 && lon >= 72 && lon <= 100
      ? 1500 * Math.max(0, (lat - 27) / 11)
      : 0;

  // Deccan plateau base elevation ~400–700m
  const deccanElevation =
    lat >= 14 && lat <= 24 && lon >= 74 && lon <= 82 ? 400 : 0;

  // Indo-Gangetic Plain is mostly flat ~100m
  const igpElevation =
    lat >= 23 && lat <= 31 && lon >= 74 && lon <= 90 ? 100 : 0;

  return Math.max(
    0,
    wghatsElevation + himalayaElevation + deccanElevation + igpElevation
  );
}

// ── Orographic Correction ─────────────────────────────────────────────────────

/**
 * Apply elevation-aware orographic correction to an interpolated value.
 *
 * For temperature: lapse rate correction (higher = colder).
 * For rainfall: orographic enhancement (higher = more rainfall on windward side).
 *
 * @param value           Bilinearly interpolated value
 * @param variable        Climate variable being corrected
 * @param elevationM      Fine-grid cell elevation (m)
 * @param coarseElevationM Coarse-grid source cell mean elevation (m)
 * @returns Corrected value
 */
export function applyOrographicCorrection(
  value: number,
  variable: VariableId,
  elevationM: number,
  coarseElevationM: number
): number {
  const deltaElevation = elevationM - coarseElevationM;

  switch (variable) {
    case 'temp_max':
    case 'temp_min': {
      // Temperature lapse rate correction: -6.5°C per 1000m
      const correction = -deltaElevation * TEMPERATURE_LAPSE_RATE;
      return value + correction;
    }
    case 'rainfall': {
      // Orographic enhancement: +0.02% per metre elevation gain (windward side)
      // Ensure non-negative
      const factor = 1 + deltaElevation * RAINFALL_OROGRAPHIC_SCALE;
      return Math.max(0, value * Math.max(0.5, factor));
    }
    default:
      return value;
  }
}

// ── Main Downscaling Function ─────────────────────────────────────────────────

/**
 * Downscale a coarse 0.25° grid to a fine 0.05° grid using bilinear
 * interpolation with optional elevation-aware orographic correction.
 *
 * Each coarse cell is subdivided into a 5×5 grid of fine cells.
 * The center of each fine cell is the interpolation target.
 *
 * @param coarseCells       Input grid cells at 0.25° resolution
 * @param applyElevation    Whether to apply elevation-aware correction (default: true)
 * @returns Array of downscaled cells at 0.05° resolution
 */
export function downscaleGrid(
  coarseCells: GridCell[],
  applyElevation = true
): DownscaledCell[] {
  if (coarseCells.length === 0) return [];

  const results: DownscaledCell[] = [];
  const STEP = DOWNSCALED_RESOLUTION_DEG;
  const HALF_FINE = STEP / 2;

  // For each coarse cell, generate a 5×5 sub-grid
  for (const coarseCell of coarseCells) {
    const coarseElevation = estimateSyntheticElevation(coarseCell.lat, coarseCell.lon);

    // Sub-divide: go from the SW corner of the coarse cell
    const startLat = coarseCell.lat - NATIVE_RESOLUTION_DEG / 2 + HALF_FINE;
    const startLon = coarseCell.lon - NATIVE_RESOLUTION_DEG / 2 + HALF_FINE;

    for (let row = 0; row < DOWNSCALE_FACTOR; row++) {
      for (let col = 0; col < DOWNSCALE_FACTOR; col++) {
        const fineLat = +(startLat + row * STEP).toFixed(4);
        const fineLon = +(startLon + col * STEP).toFixed(4);

        // Interpolate each variable
        const variables: VariableId[] = ['rainfall', 'temp_max', 'temp_min'];
        const interpolated: Record<string, number> = {};
        let anyNull = false;

        for (const v of variables) {
          const val = bilinearInterpolate(fineLat, fineLon, coarseCells, v);
          if (val === null) {
            // Fall back to coarse cell value
            interpolated[v] = coarseCell[v] as number;
          } else {
            interpolated[v] = val;
          }
        }

        if (anyNull) {
          // Skip cells where we couldn't interpolate at all (edge of domain)
        }

        // Apply elevation correction
        const fineElevation = estimateSyntheticElevation(fineLat, fineLon);
        let elevationCorrected = false;

        if (applyElevation && Math.abs(fineElevation - coarseElevation) > 50) {
          elevationCorrected = true;
          for (const v of variables) {
            interpolated[v] = applyOrographicCorrection(
              interpolated[v],
              v as VariableId,
              fineElevation,
              coarseElevation
            );
          }
        }

        results.push({
          lat: fineLat,
          lon: fineLon,
          rainfall: Math.max(0, +interpolated['rainfall'].toFixed(3)),
          temp_max: +interpolated['temp_max'].toFixed(3),
          temp_min: +interpolated['temp_min'].toFixed(3),
          elevation: fineElevation,
          elevationCorrected,
          sourceCell: { lat: coarseCell.lat, lon: coarseCell.lon },
        });
      }
    }
  }

  return results;
}

// ── Resolution model comparison data ─────────────────────────────────────────

/** Describes a weather/climate model's spatial resolution */
export interface ModelResolutionInfo {
  /** Model/system name */
  name: string;
  /** Short label for the system */
  label: string;
  /** Resolution in km */
  resolutionKm: number;
  /** Resolution in degrees */
  resolutionDeg: number;
  /** Brief description */
  description: string;
  /** Color for chart display */
  color: string;
  /** Is this the current model (MAUSAM/VAYU)? */
  isCurrentModel?: boolean;
}

/**
 * Resolution comparison data for major NWP/climate systems.
 * Validates: Requirement 84.4
 */
export const MODEL_RESOLUTION_COMPARISON: ModelResolutionInfo[] = [
  {
    name: 'MAUSAM (VAYU)',
    label: 'MAUSAM',
    resolutionKm: 28,
    resolutionDeg: 0.25,
    description: 'AI-based deep learning model (this platform)',
    color: '#22d3ee',
    isCurrentModel: true,
  },
  {
    name: 'IMD Gridded',
    label: 'IMD',
    resolutionKm: 25,
    resolutionDeg: 0.25,
    description: 'India Meteorological Department operational analysis',
    color: '#60a5fa',
  },
  {
    name: 'GFS (NCEP)',
    label: 'GFS',
    resolutionKm: 25,
    resolutionDeg: 0.25,
    description: 'Global Forecast System — NCEP/NWS operational NWP',
    color: '#a78bfa',
  },
  {
    name: 'ECMWF IFS',
    label: 'ECMWF',
    resolutionKm: 9,
    resolutionDeg: 0.1,
    description: 'European Centre for Medium-range Weather Forecasts',
    color: '#f97316',
  },
  {
    name: 'DestinE (ESA)',
    label: 'DestinE',
    resolutionKm: 5,
    resolutionDeg: 0.05,
    description: 'Destination Earth — next-gen EU km-scale digital twin',
    color: '#fbbf24',
  },
];

/** Resolution of MAUSAM native grid (0.25° ≈ 28 km) */
export const MAUSAM_NATIVE: ModelResolutionInfo = MODEL_RESOLUTION_COMPARISON[0];

/** Resolution of MAUSAM downscaled grid (0.05° ≈ 6 km) */
export const MAUSAM_DOWNSCALED: ModelResolutionInfo = {
  name: 'MAUSAM Downscaled',
  label: 'MAUSAM↓',
  resolutionKm: DOWNSCALED_RESOLUTION_KM,
  resolutionDeg: DOWNSCALED_RESOLUTION_DEG,
  description: 'Statistical downscaling with elevation correction (not native)',
  color: '#10b981',
};
