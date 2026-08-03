/**
 * Inspect Tool — Three-tier picking strategy for identifying grid cells on the globe.
 *
 * Implements a robust fallback chain:
 *   Tier 1: scene.pickPosition (most accurate, requires depth buffer)
 *   Tier 2: globe.pick (works without depth buffer)
 *   Tier 3: camera.pickEllipsoid (always works, least accurate)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import * as Cesium from 'cesium';
import type { GridCell } from '../../../types';

/**
 * Pick a grid cell from the globe given a screen-space click position.
 *
 * Uses a three-tier picking strategy with progressive fallbacks:
 * 1. scene.pickPosition — depth-buffer based (most accurate)
 * 2. globe.pick — ray-globe intersection (works without depth buffer)
 * 3. camera.pickEllipsoid — ellipsoid intersection (always works, least accurate)
 *
 * @param viewer - The Cesium Viewer instance
 * @param screenPosition - The screen-space click coordinates
 * @param gridCells - Array of available grid cells for the active region
 * @returns The nearest GridCell within tolerance, or null if none found
 */
export function pickGridCell(
  viewer: Cesium.Viewer,
  screenPosition: Cesium.Cartesian2,
  gridCells: GridCell[]
): GridCell | null {
  let cartesian: Cesium.Cartesian3 | undefined;

  // Tier 1: Scene depth-buffer pick (most accurate but requires depth buffer)
  try {
    const picked = viewer.scene.pickPosition(screenPosition);
    if (picked && Cesium.defined(picked)) {
      cartesian = picked;
    }
  } catch {
    // depth buffer unavailable — fall through to Tier 2
  }

  // Tier 2: Globe surface pick (works without depth buffer)
  if (!cartesian) {
    const ray = viewer.camera.getPickRay(screenPosition);
    if (ray) {
      const globePick = viewer.scene.globe.pick(ray, viewer.scene);
      if (globePick && Cesium.defined(globePick)) {
        cartesian = globePick;
      }
    }
  }

  // Tier 3: Ellipsoid pick (always works, least accurate)
  if (!cartesian) {
    const ellipsoidPick = viewer.camera.pickEllipsoid(
      screenPosition,
      viewer.scene.globe.ellipsoid
    );
    if (ellipsoidPick && Cesium.defined(ellipsoidPick)) {
      cartesian = ellipsoidPick;
    }
  }

  // If no pick method succeeded, return null
  if (!cartesian) return null;

  // Convert Cartesian3 to geographic coordinates
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  const clickLat = Cesium.Math.toDegrees(cartographic.latitude);
  const clickLon = Cesium.Math.toDegrees(cartographic.longitude);

  // Snap to nearest 0.25° grid cell within tolerance
  return findNearestCell(clickLat, clickLon, gridCells, 0.25);
}

/**
 * Find the nearest grid cell to a given lat/lon position.
 *
 * Snaps to the nearest 0.25° grid cell center within the specified tolerance.
 * Uses Euclidean distance in degree-space (sufficient for short distances
 * within a single grid cell resolution).
 *
 * @param lat - Click latitude in degrees
 * @param lon - Click longitude in degrees
 * @param gridCells - Array of available grid cells
 * @param tolerance - Maximum allowed distance in degrees (default 0.25°)
 * @returns The nearest GridCell within tolerance, or null if none found
 */
export function findNearestCell(
  lat: number,
  lon: number,
  gridCells: GridCell[],
  tolerance: number = 0.25
): GridCell | null {
  if (gridCells.length === 0) return null;

  let nearest: GridCell | null = null;
  let minDistance = Infinity;

  for (const cell of gridCells) {
    const dLat = cell.lat - lat;
    const dLon = cell.lon - lon;
    const distance = Math.sqrt(dLat * dLat + dLon * dLon);

    if (distance < minDistance) {
      minDistance = distance;
      nearest = cell;
    }
  }

  // Only return if within tolerance
  if (minDistance > tolerance) return null;

  return nearest;
}
