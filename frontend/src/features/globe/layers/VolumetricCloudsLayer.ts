/**
 * VolumetricCloudsLayer — 3D cloud rendering using billboard sprites.
 *
 * Renders cloud formations on the globe using CesiumJS BillboardCollection.
 * Cloud opacity is proportional to inferred cloud cover from humidity data
 * (>70% humidity suggests cloud presence). Clouds are positioned at
 * approximate altitudes (2000–8000m) and animate drift based on wind data.
 *
 * Requirements: 59.1, 59.2, 59.4
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';
import type { GridCell } from '../../../types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Minimum humidity percentage to infer cloud presence */
const CLOUD_HUMIDITY_THRESHOLD = 70;

/** Cloud altitude range in meters */
const CLOUD_ALTITUDE_MIN = 2000;
const CLOUD_ALTITUDE_MAX = 8000;

/** Maximum number of cloud billboards to render (performance budget) */
const MAX_CLOUD_BILLBOARDS = 200;

/** Default wind speed (m/s) when no wind data is available */
const DEFAULT_WIND_SPEED = 5.0;

/** Default wind direction in degrees (westerly — common at cloud altitude) */
const DEFAULT_WIND_DIRECTION = 270;

/** Cloud billboard pixel size (width × height) */
const CLOUD_BILLBOARD_WIDTH = 64;
const CLOUD_BILLBOARD_HEIGHT = 36;

/** Animation update interval in milliseconds */
const ANIMATION_INTERVAL_MS = 100;

/** Drift scale factor — converts m/s wind to degrees/tick displacement */
const DRIFT_SCALE = 0.00001;

// ── Cloud Sprite Generation ──────────────────────────────────────────────────

/**
 * Generate a white translucent cloud sprite as a data URI canvas image.
 * Produces a soft, elliptical cloud shape suitable for billboard rendering.
 */
export function generateCloudSprite(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Draw a soft elliptical cloud shape using radial gradient
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = width / 2.2;
  const radiusY = height / 2.2;

  // Main cloud body — soft white ellipse
  const gradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, Math.max(radiusX, radiusY)
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.7)');
  gradient.addColorStop(0.7, 'rgba(240, 240, 255, 0.4)');
  gradient.addColorStop(1, 'rgba(220, 220, 240, 0.0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Add a secondary lobe for visual variety
  const lobeCenterX = centerX + radiusX * 0.3;
  const lobeCenterY = centerY - radiusY * 0.2;
  const lobeGradient = ctx.createRadialGradient(
    lobeCenterX, lobeCenterY, 0,
    lobeCenterX, lobeCenterY, radiusX * 0.5
  );
  lobeGradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
  lobeGradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = lobeGradient;
  ctx.beginPath();
  ctx.ellipse(lobeCenterX, lobeCenterY, radiusX * 0.5, radiusY * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

// ── Cloud Cover Inference ────────────────────────────────────────────────────

/**
 * Infer cloud cover percentage from a grid cell's data.
 * Uses humidity (derived from temp and rainfall) as a proxy.
 *
 * Heuristic: Higher rainfall and lower temperature spread suggest higher humidity.
 * - Rainfall > 20mm → heavy cloud cover (~90%)
 * - Rainfall > 5mm → moderate cloud cover (~60%)
 * - Low temp spread (max-min < 5°C) → overcast (~70%)
 * - Otherwise, use temperature-based proxy
 *
 * Returns value in [0, 100].
 */
export function inferCloudCover(cell: GridCell): number {
  const tempSpread = cell.temp_max - cell.temp_min;

  // Heavy rainfall strongly implies clouds
  if (cell.rainfall > 20) {
    return Math.min(95, 70 + cell.rainfall * 0.5);
  }

  // Moderate rainfall
  if (cell.rainfall > 5) {
    return Math.min(80, 50 + cell.rainfall * 2);
  }

  // Low temp spread (diurnal range < 5°C) suggests overcast conditions
  if (tempSpread < 5 && cell.rainfall > 0) {
    return 70;
  }

  // Light rainfall with normal spread
  if (cell.rainfall > 0) {
    return Math.min(60, 30 + cell.rainfall * 5);
  }

  // No rainfall — infer from temperature spread
  // Large diurnal range = clear skies, small range = possible clouds
  if (tempSpread < 8) {
    return Math.max(0, 40 - tempSpread * 4);
  }

  return 0;
}

/**
 * Determine cloud altitude based on inferred cloud type.
 * Higher cloud cover and higher rainfall suggest lower clouds (nimbostratus).
 * Light cloud cover suggests higher altitude (cirrus/altocumulus).
 */
export function computeCloudAltitude(cloudCoverPct: number, rainfall: number): number {
  // Heavy rain → low clouds (2000–4000m)
  if (rainfall > 10) {
    return CLOUD_ALTITUDE_MIN + Math.random() * 2000;
  }

  // Moderate cover → mid-level (4000–6000m)
  if (cloudCoverPct > 50) {
    return 4000 + Math.random() * 2000;
  }

  // Light cover → high altitude (6000–8000m)
  return 6000 + Math.random() * (CLOUD_ALTITUDE_MAX - 6000);
}

// ── Cloud Billboard Data ─────────────────────────────────────────────────────

interface CloudBillboard {
  /** Current longitude in degrees */
  lon: number;
  /** Latitude in degrees */
  lat: number;
  /** Altitude in meters */
  altitude: number;
  /** Opacity (0–1) proportional to cloud cover */
  opacity: number;
  /** Billboard scale factor */
  scale: number;
  /** Wind-based drift velocity in degrees/tick (longitude component) */
  driftLon: number;
  /** Wind-based drift velocity in degrees/tick (latitude component) */
  driftLat: number;
}

// ── VolumetricCloudsLayer Class ──────────────────────────────────────────────

/**
 * VolumetricCloudsLayer renders 3D cloud formations using CesiumJS BillboardCollection.
 * Implements LayerPlugin interface for integration with the globe layer system.
 */
export class VolumetricCloudsLayer implements LayerPlugin {
  public readonly id = 'volumetric-clouds';
  public readonly priority = 45; // Above terrain, below UI overlays

  private viewer: Cesium.Viewer | null = null;
  private billboardCollection: Cesium.BillboardCollection | null = null;
  private cloudSprite: HTMLCanvasElement | null = null;
  private cloudData: CloudBillboard[] = [];
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private lastGridHash = '';

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;

    // Pre-generate the cloud sprite texture
    this.cloudSprite = generateCloudSprite(CLOUD_BILLBOARD_WIDTH, CLOUD_BILLBOARD_HEIGHT);

    // Create billboard collection
    this.billboardCollection = new Cesium.BillboardCollection({
      scene: viewer.scene,
    });
    viewer.scene.primitives.add(this.billboardCollection);

    // Start drift animation loop
    this.startAnimation();
  }

  update(state: LayerState): void {
    if (!this.viewer || !this.billboardCollection || !this.cloudSprite) return;

    const { gridCells } = state;

    // Skip redundant updates if grid data hasn't changed
    const gridHash = this.computeGridHash(gridCells);
    if (gridHash === this.lastGridHash) return;
    this.lastGridHash = gridHash;

    // Clear existing billboards
    this.billboardCollection.removeAll();
    this.cloudData = [];

    // Filter cells that likely have clouds
    const cloudCells = gridCells
      .map(cell => ({
        cell,
        cloudCover: inferCloudCover(cell),
      }))
      .filter(({ cloudCover }) => cloudCover >= CLOUD_HUMIDITY_THRESHOLD)
      .sort((a, b) => b.cloudCover - a.cloudCover)
      .slice(0, MAX_CLOUD_BILLBOARDS);

    // Create billboards for each cloud cell
    for (const { cell, cloudCover } of cloudCells) {
      const altitude = computeCloudAltitude(cloudCover, cell.rainfall);
      const opacity = cloudCover / 100; // Normalize to 0–1
      const scale = 1.0 + (cloudCover / 100) * 1.5; // Heavier clouds are larger

      // Compute drift from wind data (using defaults since GridCell lacks wind)
      const windSpeedMs = DEFAULT_WIND_SPEED;
      const windDirRad = (DEFAULT_WIND_DIRECTION * Math.PI) / 180;
      const driftLon = Math.cos(windDirRad) * windSpeedMs * DRIFT_SCALE;
      const driftLat = Math.sin(windDirRad) * windSpeedMs * DRIFT_SCALE;

      const cloudBillboard: CloudBillboard = {
        lon: cell.lon,
        lat: cell.lat,
        altitude,
        opacity,
        scale,
        driftLon,
        driftLat,
      };

      this.cloudData.push(cloudBillboard);

      this.billboardCollection.add({
        position: Cesium.Cartesian3.fromDegrees(cell.lon, cell.lat, altitude),
        image: this.cloudSprite,
        scale,
        color: new Cesium.Color(1.0, 1.0, 1.0, opacity),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 5.0e6, 0.4),
      });
    }
  }

  destroy(): void {
    this.stopAnimation();

    if (this.viewer && this.billboardCollection) {
      this.viewer.scene.primitives.remove(this.billboardCollection);
      this.billboardCollection = null;
    }

    this.cloudData = [];
    this.cloudSprite = null;
    this.viewer = null;
    this.lastGridHash = '';
  }

  // ── Animation ──────────────────────────────────────────────────────────────

  /**
   * Start the cloud drift animation loop.
   * Updates billboard positions based on wind direction and speed.
   */
  private startAnimation(): void {
    this.animationTimer = setInterval(() => {
      this.animateDrift();
    }, ANIMATION_INTERVAL_MS);
  }

  /**
   * Stop the animation loop.
   */
  private stopAnimation(): void {
    if (this.animationTimer !== null) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  /**
   * Advance each cloud billboard position by its drift velocity.
   * Wraps longitude around [-180, 180] for continuous drift.
   */
  private animateDrift(): void {
    if (!this.billboardCollection || this.cloudData.length === 0) return;

    for (let i = 0; i < this.cloudData.length; i++) {
      const cloud = this.cloudData[i];

      // Update position with drift
      cloud.lon += cloud.driftLon;
      cloud.lat += cloud.driftLat;

      // Wrap longitude
      if (cloud.lon > 180) cloud.lon -= 360;
      if (cloud.lon < -180) cloud.lon += 360;

      // Clamp latitude
      cloud.lat = Math.max(-90, Math.min(90, cloud.lat));

      // Update billboard position
      const billboard = this.billboardCollection.get(i);
      if (billboard) {
        billboard.position = Cesium.Cartesian3.fromDegrees(
          cloud.lon,
          cloud.lat,
          cloud.altitude
        );
      }
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Compute a simple hash of grid cell data for change detection.
   */
  private computeGridHash(gridCells: GridCell[]): string {
    if (gridCells.length === 0) return '';
    // Use a subset of data for fast hash comparison
    const sample = gridCells.slice(0, 5);
    return sample
      .map(c => `${c.lat},${c.lon},${c.rainfall},${c.temp_max}`)
      .join('|');
  }
}
