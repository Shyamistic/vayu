/**
 * Cross-Section Atmospheric Profile Tool
 *
 * Provides transect sampling functionality for drawing polylines on the globe
 * and computing interpolated climate variable values along the path.
 *
 * Uses inverse-distance weighting (IDW) interpolation from nearby grid cells
 * to produce smooth cross-section profiles.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4
 */

import type { GridCell, VariableId } from '../../../types';

/** A single sample point along the transect */
export interface TransectPoint {
  /** Distance along the transect from start (km) */
  distance: number;
  /** Latitude of the sample point */
  lat: number;
  /** Longitude of the sample point */
  lon: number;
  /** Interpolated variable value at this point */
  value: number;
  /** Terrain elevation at this point (meters, placeholder based on nearby data) */
  elevation: number;
}

/** Start/end coordinate for a transect */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Minimum number of interpolation points along any transect */
const MIN_SAMPLE_POINTS = 50;

/**
 * Compute the great-circle distance between two points using the Haversine formula.
 *
 * @param a - First coordinate
 * @param b - Second coordinate
 * @returns Distance in kilometers
 */
export function haversineDistance(a: LatLon, b: LatLon): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinHalfDLat = Math.sin(dLat / 2);
  const sinHalfDLon = Math.sin(dLon / 2);
  const h =
    sinHalfDLat * sinHalfDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfDLon * sinHalfDLon;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Interpolate a climate variable value at a given lat/lon using
 * inverse-distance weighting (IDW) from nearby grid cells.
 *
 * Uses the k nearest cells (up to 4) within a search radius of 0.5°.
 * Falls back to nearest-neighbor if fewer than 2 cells are within range.
 *
 * @param lat - Target latitude
 * @param lon - Target longitude
 * @param gridCells - Available grid cells
 * @param variable - Which variable to interpolate
 * @param power - IDW power parameter (default 2 for inverse-square weighting)
 * @returns Interpolated value
 */
export function interpolateValue(
  lat: number,
  lon: number,
  gridCells: GridCell[],
  variable: VariableId,
  power: number = 2
): number {
  if (gridCells.length === 0) return 0;

  const searchRadius = 0.5; // degrees
  const maxNeighbors = 4;

  // Find cells within search radius, sorted by distance
  const nearby: { cell: GridCell; dist: number }[] = [];

  for (const cell of gridCells) {
    const dLat = cell.lat - lat;
    const dLon = cell.lon - lon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);

    if (dist <= searchRadius) {
      nearby.push({ cell, dist });
    }
  }

  // Sort by distance and keep top k
  nearby.sort((a, b) => a.dist - b.dist);
  const candidates = nearby.slice(0, maxNeighbors);

  // If no cells nearby, use the absolute nearest cell
  if (candidates.length === 0) {
    let nearest: GridCell = gridCells[0];
    let minDist = Infinity;
    for (const cell of gridCells) {
      const dLat = cell.lat - lat;
      const dLon = cell.lon - lon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dist < minDist) {
        minDist = dist;
        nearest = cell;
      }
    }
    return nearest[variable];
  }

  // Exact match — distance is effectively zero
  if (candidates[0].dist < 1e-10) {
    return candidates[0].cell[variable];
  }

  // Inverse-distance weighting
  let weightSum = 0;
  let valueSum = 0;

  for (const { cell, dist } of candidates) {
    const weight = 1 / Math.pow(dist, power);
    weightSum += weight;
    valueSum += weight * cell[variable];
  }

  return valueSum / weightSum;
}

/**
 * Estimate terrain elevation at a point using a simple latitude-based model.
 *
 * This is a placeholder that approximates Indian subcontinent elevation patterns.
 * In production, this would be replaced with actual DEM data or Cesium terrain queries.
 *
 * The model assigns rough elevation based on:
 * - Higher latitudes (>30°N): Himalayan foothills (500–2000m)
 * - Western Ghats longitude band (73–76°E, 8–20°N): 200–800m
 * - Indo-Gangetic plain (25–30°N, 77–88°E): 50–200m
 * - Coastal areas: 0–50m
 * - Default: 100–300m
 *
 * @param lat - Latitude in degrees
 * @param lon - Longitude in degrees
 * @returns Estimated elevation in meters
 */
export function estimateElevation(lat: number, lon: number): number {
  // Himalayan foothills
  if (lat > 30) {
    return 500 + (lat - 30) * 150;
  }

  // Western Ghats
  if (lon >= 73 && lon <= 76 && lat >= 8 && lat <= 20) {
    return 200 + Math.sin(((lat - 8) / 12) * Math.PI) * 600;
  }

  // Indo-Gangetic Plain
  if (lat >= 25 && lat <= 30 && lon >= 77 && lon <= 88) {
    return 50 + (30 - lat) * 30;
  }

  // Coastal regions (within 1° of coast approximation)
  if (lon < 72 || lon > 90 || lat < 8) {
    return 10 + Math.random() * 40;
  }

  // Default: gentle terrain
  return 100 + Math.abs(Math.sin(lat * 0.5) * Math.cos(lon * 0.3)) * 200;
}

/**
 * Sample interpolated points along a transect between start and end coordinates.
 *
 * Produces at least 50 evenly-distributed sample points along the great-circle
 * path between start and end. Each point includes the interpolated variable
 * value (via IDW) and an estimated terrain elevation.
 *
 * @param start - Starting coordinate {lat, lon}
 * @param end - Ending coordinate {lat, lon}
 * @param gridCells - Available grid cells for interpolation
 * @param variable - Climate variable to sample
 * @param numPoints - Number of sample points (minimum 50, default 50)
 * @returns Array of TransectPoint with distance, lat, lon, value, elevation
 */
export function sampleTransect(
  start: LatLon,
  end: LatLon,
  gridCells: GridCell[],
  variable: VariableId,
  numPoints?: number
): TransectPoint[] {
  // Ensure at least MIN_SAMPLE_POINTS
  const n = Math.max(numPoints ?? MIN_SAMPLE_POINTS, MIN_SAMPLE_POINTS);

  const totalDistance = haversineDistance(start, end);
  const points: TransectPoint[] = [];

  for (let i = 0; i < n; i++) {
    // Fraction along the transect [0, 1]
    const t = n === 1 ? 0 : i / (n - 1);

    // Linear interpolation of lat/lon (adequate for short distances)
    const lat = start.lat + t * (end.lat - start.lat);
    const lon = start.lon + t * (end.lon - start.lon);

    // Distance along transect
    const distance = t * totalDistance;

    // Interpolate climate variable value
    const value = interpolateValue(lat, lon, gridCells, variable);

    // Estimate terrain elevation
    const elevation = estimateElevation(lat, lon);

    points.push({ distance, lat, lon, value, elevation });
  }

  return points;
}
