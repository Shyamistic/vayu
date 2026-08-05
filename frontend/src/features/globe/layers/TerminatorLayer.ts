/**
 * TerminatorLayer — Day/Night terminator line and sun position math.
 *
 * Computes solar position from the selected date/time and renders a
 * polyline along the terminator boundary (great circle separating
 * day/night). Nightside darkening itself is handled separately by
 * CesiumGlobe via the globe's own native per-pixel lighting
 * (scene.globe.enableLighting + clock.currentTime) — rendering an entire
 * hemisphere as a single Cesium polygon isn't reliable, since its
 * triangulation targets regional shapes, not planet-scale interior fills.
 *
 * Synchronizes with timeline changes via the selectedDate in LayerState.
 *
 * Requirements: 33.1, 33.2, 33.3, 33.4
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Number of points to approximate the terminator circle */
const TERMINATOR_POINTS = 72;

/** Terminator line color — a subtle cyan/blue glow */
const TERMINATOR_LINE_COLOR = new Cesium.Color(0.4, 0.8, 1.0, 0.9);

/** Terminator line width in pixels */
const TERMINATOR_LINE_WIDTH = 2.0;

/** Height offset for the terminator line to float slightly above terrain */
const TERMINATOR_HEIGHT_OFFSET = 1000; // meters

// ── Solar Position Utilities ─────────────────────────────────────────────────
// Exported for unit testing

/**
 * Compute the day of year (1-based) from a Date.
 */
export function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Compute the solar declination angle in radians for a given day of year.
 * Uses a simplified formula based on the Earth's axial tilt (23.44°).
 */
export function solarDeclination(doy: number): number {
  // Approximate solar declination using sinusoidal model
  // Declination ≈ 23.44° × sin(360/365 × (doy - 81))
  const axialTilt = 23.44 * (Math.PI / 180); // radians
  return axialTilt * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
}

/**
 * Compute the sub-solar point longitude from the date/time.
 * The sub-solar point moves westward at 15°/hour.
 */
export function subSolarLongitude(date: Date): number {
  // UTC hours as fractional
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;

  // Solar noon is at 12:00 UTC at 0° longitude
  // Each hour away from noon = 15° offset
  let lon = (12 - utcHours) * 15;

  // Normalize to [-180, 180]
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;

  return lon;
}

/**
 * Compute the sub-solar point (latitude, longitude) for a given date.
 * - Latitude = solar declination
 * - Longitude = based on time of day
 */
export function computeSubSolarPoint(date: Date): { lat: number; lon: number } {
  const doy = dayOfYear(date);
  const declination = solarDeclination(doy);
  const lat = declination * (180 / Math.PI); // Convert radians to degrees
  const lon = subSolarLongitude(date);
  return { lat, lon };
}

/**
 * Generate terminator circle points as an array of [lon, lat] pairs.
 * The terminator is the great circle orthogonal to the sub-solar point direction.
 *
 * Algorithm: The terminator lies on the great circle 90° away from the sub-solar point.
 * We compute points by rotating around the sun-direction axis.
 */
export function computeTerminatorPoints(
  subSolarLat: number,
  subSolarLon: number,
  numPoints: number
): Array<{ lat: number; lon: number }> {
  const points: Array<{ lat: number; lon: number }> = [];

  // Convert sub-solar point to radians
  const latRad = subSolarLat * (Math.PI / 180);
  const lonRad = subSolarLon * (Math.PI / 180);

  // Sub-solar point as unit vector in ECEF
  const sunX = Math.cos(latRad) * Math.cos(lonRad);
  const sunY = Math.cos(latRad) * Math.sin(lonRad);
  const sunZ = Math.sin(latRad);

  // We need two orthogonal vectors to the sun direction to sweep the terminator
  // Use cross product with Z-axis (or Y-axis if sun is near pole)
  let orthX: number, orthY: number, orthZ: number;

  if (Math.abs(sunZ) < 0.99) {
    // Cross with Z-axis [0, 0, 1]
    orthX = -sunY;
    orthY = sunX;
    orthZ = 0;
  } else {
    // Sun near pole — cross with Y-axis [0, 1, 0]
    orthX = sunZ;
    orthY = 0;
    orthZ = -sunX;
  }

  // Normalize orth vector
  const orthLen = Math.sqrt(orthX * orthX + orthY * orthY + orthZ * orthZ);
  orthX /= orthLen;
  orthY /= orthLen;
  orthZ /= orthLen;

  // Second orthogonal vector via cross product: sun × orth
  const orth2X = sunY * orthZ - sunZ * orthY;
  const orth2Y = sunZ * orthX - sunX * orthZ;
  const orth2Z = sunX * orthY - sunY * orthX;

  // Sweep around the sun direction at 90° angular distance
  for (let i = 0; i < numPoints; i++) {
    const angle = (2 * Math.PI * i) / numPoints;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Point on the terminator (90° from sun direction)
    const px = orthX * cosA + orth2X * sinA;
    const py = orthY * cosA + orth2Y * sinA;
    const pz = orthZ * cosA + orth2Z * sinA;

    // Convert ECEF unit vector back to lat/lon
    const lat = Math.asin(pz) * (180 / Math.PI);
    const lon = Math.atan2(py, px) * (180 / Math.PI);

    points.push({ lat, lon });
  }

  return points;
}

/**
 * Generate the nightside polygon positions.
 * The nightside is the hemisphere opposite the sub-solar point, bounded by
 * the terminator circle.
 *
 * `computeTerminatorPoints` already emits points in a consistent angular
 * sweep order around the sun-orthogonal axis (angle = 2π·i/numPoints), so
 * they trace a valid, non-self-intersecting polygon boundary as-is. An
 * earlier version re-sorted them by `atan2(latDelta, lonDelta)` relative to
 * the anti-solar point — not a valid spherical angle (it mixes a latitude
 * delta and a longitude delta as if they were Cartesian y/x) — which could
 * produce a self-intersecting ("bowtie") polygon depending on where the
 * anti-solar point fell. That was the actual source of the "degenerate
 * geometry" that originally forced this layer to be disabled; the fix is to
 * not re-sort at all.
 */
export function computeNightsidePositions(
  terminatorPoints: Array<{ lat: number; lon: number }>
): Cesium.Cartesian3[] {
  return terminatorPoints.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
}

// ── TerminatorLayer Class ────────────────────────────────────────────────────

/**
 * TerminatorLayer implements the LayerPlugin interface for rendering
 * the day/night terminator line and nightside darkening on the globe.
 */
export class TerminatorLayer implements LayerPlugin {
  public readonly id = 'terminator';
  public readonly priority = 50; // Renders above terrain but below UI overlays

  private viewer: Cesium.Viewer | null = null;
  private terminatorEntity: Cesium.Entity | null = null;
  private lastDateMs = 0; // Track last update to avoid redundant redraws

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
  }

  update(state: LayerState): void {
    if (!this.viewer) return;

    const { selectedDate } = state;

    // Skip update if date hasn't changed (within 1-second tolerance)
    const dateMs = selectedDate.getTime();
    if (Math.abs(dateMs - this.lastDateMs) < 1000) return;
    this.lastDateMs = dateMs;

    // Clear previous entities
    this.clearEntities();

    // Compute solar position
    const subSolar = computeSubSolarPoint(selectedDate);

    // Generate terminator circle (72-point polygon orthogonal to sub-solar point)
    const terminatorPoints = computeTerminatorPoints(
      subSolar.lat,
      subSolar.lon,
      TERMINATOR_POINTS
    );

    // Render terminator line only. Nightside darkening is handled by
    // CesiumGlobe via the globe's own native per-pixel lighting
    // (scene.globe.enableLighting + clock.currentTime) rather than a
    // polygon fill here — rendering an entire hemisphere as a single
    // Cesium polygon isn't reliable (its triangulation targets regional
    // shapes, not planet-scale interior fills — it visibly picked the
    // wrong/degenerate region and blacked out nearly the whole view).
    // computeNightsidePositions/renderNightsideOverlay are kept as tested
    // pure math but are no longer called from the live render path.
    this.renderTerminatorLine(terminatorPoints);
  }

  destroy(): void {
    this.clearEntities();
    this.viewer = null;
    this.lastDateMs = 0;
  }

  /**
   * Remove rendered entities without releasing the viewer reference — used
   * to hide the layer (e.g. a UI toggle) without a full destroy/re-init cycle.
   */
  clear(): void {
    this.clearEntities();
    this.lastDateMs = 0;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  /**
   * Render the terminator boundary line as a polyline clamped to globe terrain.
   */
  private renderTerminatorLine(
    terminatorPoints: Array<{ lat: number; lon: number }>
  ): void {
    if (!this.viewer) return;

    // Build positions array (close the loop by repeating the first point)
    const positions: Cesium.Cartesian3[] = terminatorPoints.map((p) =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, TERMINATOR_HEIGHT_OFFSET)
    );
    // Close the polyline loop
    if (positions.length > 0) {
      positions.push(positions[0]);
    }

    this.terminatorEntity = this.viewer.entities.add({
      polyline: {
        positions,
        width: TERMINATOR_LINE_WIDTH,
        material: new Cesium.ColorMaterialProperty(TERMINATOR_LINE_COLOR),
        clampToGround: true,
      },
    });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private clearEntities(): void {
    if (!this.viewer) return;

    if (this.terminatorEntity) {
      this.viewer.entities.remove(this.terminatorEntity);
      this.terminatorEntity = null;
    }
  }
}
