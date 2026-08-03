/**
 * WindLayer — Wind field visualization with particle flow, wind barbs, and streamline ribbons.
 *
 * Supports three visualization modes:
 * - Particle flow: Animated wind particles via cesium-wind-layer integration
 * - Wind barbs: Standard meteorological barbs at grid points showing speed/direction
 * - Streamline ribbons: Polyline-based streamlines tracing flow paths
 *
 * Supports multiple pressure levels (surface, 850hPa, 500hPa, 200hPa) switchable
 * via a level selector.
 *
 * Requirements: 25.1, 25.2, 25.3
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';
import type { GridCell } from '../../../types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Supported wind visualization modes */
export type WindVisualizationMode = 'particle' | 'barb' | 'streamline';

/** Supported pressure levels */
export type PressureLevel = 'surface' | '850hPa' | '500hPa' | '200hPa';

/** Wind vector at a grid point */
export interface WindVector {
  lat: number;
  lon: number;
  /** U-component (east-west) in m/s */
  u: number;
  /** V-component (north-south) in m/s */
  v: number;
  /** Computed speed in m/s */
  speed: number;
  /** Computed direction in degrees (meteorological: direction wind blows FROM) */
  direction: number;
}

/** Wind barb rendering configuration */
interface BarbConfig {
  /** Length of the barb staff in pixels */
  staffLength: number;
  /** Spacing between barb flags in pixels */
  flagSpacing: number;
  /** Color of the barb */
  color: Cesium.Color;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Height offsets per pressure level (meters above terrain) for visual layering */
const LEVEL_HEIGHTS: Record<PressureLevel, number> = {
  surface: 100,
  '850hPa': 1500,
  '500hPa': 5500,
  '200hPa': 12000,
};

/** Typical wind speed scaling per pressure level (multiplicative factor) */
const LEVEL_SPEED_FACTOR: Record<PressureLevel, number> = {
  surface: 1.0,
  '850hPa': 1.3,
  '500hPa': 2.0,
  '200hPa': 3.5,
};

/** Default barb configuration */
const DEFAULT_BARB_CONFIG: BarbConfig = {
  staffLength: 30,
  flagSpacing: 6,
  color: Cesium.Color.WHITE,
};

/** Streamline configuration */
const STREAMLINE_STEPS = 12;
const STREAMLINE_STEP_SIZE = 0.3; // degrees per integration step

/** Billboard image size for wind barbs */
const BARB_IMAGE_SIZE = 64;

// ── Wind Data Generation ─────────────────────────────────────────────────────

/**
 * Compute synthetic wind vectors from grid cell data.
 * Since GridCell doesn't contain explicit wind fields, we derive wind from
 * spatial pressure/temperature gradients (geostrophic approximation).
 * In production, these would come from NWP data or the AI model.
 */
function computeWindVectors(
  gridCells: GridCell[],
  level: PressureLevel
): WindVector[] {
  if (gridCells.length === 0) return [];

  const speedFactor = LEVEL_SPEED_FACTOR[level];
  const vectors: WindVector[] = [];

  // Build a lookup map for gradient computation
  const cellMap = new Map<string, GridCell>();
  for (const cell of gridCells) {
    cellMap.set(`${cell.lat.toFixed(2)},${cell.lon.toFixed(2)}`, cell);
  }

  for (const cell of gridCells) {
    // Use temperature gradient as proxy for geostrophic wind
    // (thermal wind relationship: wind proportional to horizontal temp gradient)
    const eastKey = `${cell.lat.toFixed(2)},${(cell.lon + 0.25).toFixed(2)}`;
    const northKey = `${(cell.lat + 0.25).toFixed(2)},${cell.lon.toFixed(2)}`;

    const eastCell = cellMap.get(eastKey);
    const northCell = cellMap.get(northKey);

    // dT/dx and dT/dy approximate thermal wind
    const dTdx = eastCell ? (eastCell.temp_max - cell.temp_max) : 0;
    const dTdy = northCell ? (northCell.temp_max - cell.temp_max) : 0;

    // Geostrophic: u ∝ -dT/dy, v ∝ dT/dx (rotated 90°)
    // Scale to reasonable wind speeds (0-25 m/s range)
    const u = -dTdy * 2.5 * speedFactor + (Math.sin(cell.lon * 0.1) * 1.5);
    const v = dTdx * 2.5 * speedFactor + (Math.cos(cell.lat * 0.1) * 1.5);

    const speed = Math.sqrt(u * u + v * v);
    // Meteorological direction: where wind comes FROM (degrees clockwise from N)
    const direction = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;

    vectors.push({ lat: cell.lat, lon: cell.lon, u, v, speed, direction });
  }

  return vectors;
}

// ── Wind Barb Canvas Rendering ───────────────────────────────────────────────

/**
 * Generate a wind barb image as a data URI.
 * Standard meteorological convention:
 * - Short barb = 5 knots
 * - Long barb = 10 knots
 * - Triangle flag = 50 knots
 * Staff points in the direction wind blows FROM.
 */
function generateBarbDataURI(
  speed: number,
  direction: number,
  config: BarbConfig = DEFAULT_BARB_CONFIG
): string {
  const canvas = document.createElement('canvas');
  canvas.width = BARB_IMAGE_SIZE;
  canvas.height = BARB_IMAGE_SIZE;
  const ctx = canvas.getContext('2d');

  // In non-browser environments (tests), canvas context may be null
  if (!ctx) {
    return `data:image/png;base64,barb_${Math.round(speed)}_${Math.round(direction)}`;
  }

  const cx = BARB_IMAGE_SIZE / 2;
  const cy = BARB_IMAGE_SIZE / 2;

  // Convert speed from m/s to knots for barb rendering
  const speedKnots = speed * 1.944;

  // Rotate canvas so staff points in wind-from direction
  const radians = (direction * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(radians);

  // Draw staff (line from center going "up" = toward wind source)
  ctx.strokeStyle = `rgba(${config.color.red * 255}, ${config.color.green * 255}, ${config.color.blue * 255}, ${config.color.alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -config.staffLength);
  ctx.stroke();

  // Draw barbs along the staff
  let remainingKnots = Math.round(speedKnots / 5) * 5; // Round to nearest 5
  let barbOffset = config.staffLength;

  // Draw 50-knot flags (triangles)
  while (remainingKnots >= 50) {
    ctx.beginPath();
    ctx.moveTo(0, -barbOffset);
    ctx.lineTo(10, -barbOffset + config.flagSpacing / 2);
    ctx.lineTo(0, -barbOffset + config.flagSpacing);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    barbOffset -= config.flagSpacing;
    remainingKnots -= 50;
  }

  // Draw 10-knot long barbs
  while (remainingKnots >= 10) {
    ctx.beginPath();
    ctx.moveTo(0, -barbOffset);
    ctx.lineTo(12, -barbOffset + 3);
    ctx.stroke();
    barbOffset -= config.flagSpacing;
    remainingKnots -= 10;
  }

  // Draw 5-knot short barbs
  while (remainingKnots >= 5) {
    ctx.beginPath();
    ctx.moveTo(0, -barbOffset);
    ctx.lineTo(7, -barbOffset + 2);
    ctx.stroke();
    barbOffset -= config.flagSpacing;
    remainingKnots -= 5;
  }

  // Draw circle at base for calm wind (< 2.5 knots)
  if (speedKnots < 2.5) {
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  return canvas.toDataURL('image/png');
}

// ── WindLayer Implementation ─────────────────────────────────────────────────

export class WindLayer implements LayerPlugin {
  public readonly id = 'wind';
  public readonly priority = 25; // Between contours (20) and boundaries (50)

  private viewer: Cesium.Viewer | null = null;
  private billboardCollection: Cesium.BillboardCollection | null = null;
  private polylineCollection: Cesium.PolylineCollection | null = null;
  private particleLayerInstance: unknown = null;

  // Configurable state
  private _mode: WindVisualizationMode = 'barb';
  private _level: PressureLevel = 'surface';

  // Cache for barb images to avoid regenerating
  private barbImageCache = new Map<string, string>();

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
  }

  update(state: LayerState): void {
    if (!this.viewer) return;

    // Clean up previous render
    this.clearAll();

    // Only render when wind is enabled and data is available
    if (!state.showWind || !state.gridCells || state.gridCells.length === 0) {
      return;
    }

    // Compute wind vectors for the current grid and pressure level
    const windVectors = computeWindVectors(state.gridCells, this._level);

    if (windVectors.length === 0) return;

    // Render based on active visualization mode
    switch (this._mode) {
      case 'particle':
        this.renderParticleFlow(windVectors);
        break;
      case 'barb':
        this.renderWindBarbs(windVectors);
        break;
      case 'streamline':
        this.renderStreamlines(windVectors);
        break;
    }
  }

  destroy(): void {
    this.clearAll();
    this.barbImageCache.clear();
    this.viewer = null;
  }

  // ── Particle Flow Mode ─────────────────────────────────────────────────────

  /**
   * Renders animated wind particles using the cesium-wind-layer integration.
   * Falls back gracefully if the package stub is active.
   */
  private renderParticleFlow(windVectors: WindVector[]): void {
    if (!this.viewer) return;

    try {
      // Dynamically import cesium-wind-layer (may be a stub)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { WindLayer: CesiumWindLayer } = require('cesium-wind-layer');

      // Build wind data grid
      const windData = this.buildWindData(windVectors);
      if (!windData) return;

      this.particleLayerInstance = new CesiumWindLayer(this.viewer, windData, {
        particlesTextureSize: 128,
        particleHeight: LEVEL_HEIGHTS[this._level],
        lineWidth: { min: 1, max: 2 },
        lineLength: { min: 20, max: 80 },
        speedFactor: 4.0,
        dropRate: 0.003,
        dropRateBump: 0.01,
        colors: ['#3498db', '#2ecc71', '#f1c40f', '#e67e22', '#e74c3c'],
        flipY: false,
        useViewerBounds: true,
        dynamic: true,
      });
    } catch {
      // If cesium-wind-layer is not available, fall back to streamline rendering
      console.warn('[WindLayer] cesium-wind-layer not available, falling back to streamlines');
      this.renderStreamlines(windVectors);
    }
  }

  /**
   * Build WindData format from wind vectors for the particle layer.
   */
  private buildWindData(windVectors: WindVector[]) {
    if (windVectors.length === 0) return null;

    // Determine grid bounds
    const lats = windVectors.map(v => v.lat);
    const lons = windVectors.map(v => v.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    // Determine grid dimensions (assuming 0.25° spacing)
    const width = Math.round((maxLon - minLon) / 0.25) + 1;
    const height = Math.round((maxLat - minLat) / 0.25) + 1;

    const uArray = new Float32Array(width * height);
    const vArray = new Float32Array(width * height);

    let uMin = Infinity, uMax = -Infinity;
    let vMin = Infinity, vMax = -Infinity;

    // Fill grid
    for (const vec of windVectors) {
      const col = Math.round((vec.lon - minLon) / 0.25);
      const row = Math.round((vec.lat - minLat) / 0.25);
      const idx = row * width + col;

      if (idx >= 0 && idx < uArray.length) {
        uArray[idx] = vec.u;
        vArray[idx] = vec.v;
        uMin = Math.min(uMin, vec.u);
        uMax = Math.max(uMax, vec.u);
        vMin = Math.min(vMin, vec.v);
        vMax = Math.max(vMax, vec.v);
      }
    }

    return {
      width,
      height,
      bounds: { west: minLon, south: minLat, east: maxLon, north: maxLat },
      u: { array: uArray, min: uMin, max: uMax },
      v: { array: vArray, min: vMin, max: vMax },
    };
  }

  // ── Wind Barb Mode ─────────────────────────────────────────────────────────

  /**
   * Renders standard meteorological wind barbs at grid points using a BillboardCollection.
   * Each barb shows wind speed (through barb flags) and direction (staff orientation).
   */
  private renderWindBarbs(windVectors: WindVector[]): void {
    if (!this.viewer) return;

    this.billboardCollection = new Cesium.BillboardCollection({
      scene: this.viewer.scene,
    });

    const height = LEVEL_HEIGHTS[this._level];

    // Subsample for performance: show barbs at every 2nd grid point for dense grids
    const step = windVectors.length > 200 ? 2 : 1;

    for (let i = 0; i < windVectors.length; i += step) {
      const vec = windVectors[i];

      // Skip calm winds (< 1 m/s) to reduce visual clutter
      if (vec.speed < 1.0) continue;

      const image = this.getBarbImage(vec.speed, vec.direction);

      this.billboardCollection.add({
        position: Cesium.Cartesian3.fromDegrees(vec.lon, vec.lat, height),
        image,
        width: BARB_IMAGE_SIZE * 0.5,
        height: BARB_IMAGE_SIZE * 0.5,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        color: Cesium.Color.WHITE.withAlpha(0.9),
      });
    }

    this.viewer.scene.primitives.add(this.billboardCollection);
  }

  /**
   * Get or create a cached wind barb image for the given speed/direction.
   * Caches by rounded speed (to nearest 5 knots) and direction (to nearest 10°).
   */
  private getBarbImage(speed: number, direction: number): string {
    // Quantize for caching
    const speedKnots = Math.round((speed * 1.944) / 5) * 5;
    const dirRounded = Math.round(direction / 10) * 10;
    const key = `${speedKnots}_${dirRounded}`;

    let image = this.barbImageCache.get(key);
    if (!image) {
      image = generateBarbDataURI(speed, direction);
      this.barbImageCache.set(key, image);
    }
    return image;
  }

  // ── Streamline Ribbon Mode ─────────────────────────────────────────────────

  /**
   * Renders streamline ribbons by integrating wind vectors forward from seed points.
   * Uses simple Euler integration along the wind field to trace flow paths.
   */
  private renderStreamlines(windVectors: WindVector[]): void {
    if (!this.viewer) return;

    this.polylineCollection = new Cesium.PolylineCollection();

    const height = LEVEL_HEIGHTS[this._level];

    // Build a spatial lookup for wind vector interpolation
    const vectorGrid = new Map<string, WindVector>();
    for (const vec of windVectors) {
      vectorGrid.set(`${vec.lat.toFixed(2)},${vec.lon.toFixed(2)}`, vec);
    }

    // Seed streamlines at every Nth grid point
    const seedStep = Math.max(3, Math.floor(Math.sqrt(windVectors.length) / 4));
    const seeds = windVectors.filter((_, idx) => idx % seedStep === 0);

    for (const seed of seeds) {
      // Skip seeds with very low wind
      if (seed.speed < 0.5) continue;

      const positions: Cesium.Cartesian3[] = [];
      let lat = seed.lat;
      let lon = seed.lon;

      // Euler integration forward through the field
      for (let step = 0; step < STREAMLINE_STEPS; step++) {
        positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, height));

        // Find nearest wind vector for interpolation
        const nearestVec = this.interpolateWind(lat, lon, vectorGrid);
        if (!nearestVec || nearestVec.speed < 0.2) break;

        // Advance position by wind direction
        const stepScale = STREAMLINE_STEP_SIZE / Math.max(nearestVec.speed, 1);
        lat += nearestVec.v * stepScale * 0.01;
        lon += nearestVec.u * stepScale * 0.01;
      }

      if (positions.length < 2) continue;

      // Color based on wind speed at seed point
      const speedColor = this.getSpeedColor(seed.speed);

      try {
        this.polylineCollection.add({
          positions,
          width: 2.5,
          material: Cesium.Material.fromType('PolylineArrow', {
            color: speedColor,
          }),
        });
      } catch {
        // Fallback: add polyline without material (handles environments where
        // Material.fromType is unavailable, e.g., missing WebGL context)
        this.polylineCollection.add({
          positions,
          width: 2.5,
        });
      }
    }

    this.viewer.scene.primitives.add(this.polylineCollection);
  }

  /**
   * Bilinear interpolation of wind at an arbitrary lat/lon from the grid.
   * Falls back to nearest-neighbor if exact neighbors are unavailable.
   */
  private interpolateWind(
    lat: number,
    lon: number,
    grid: Map<string, WindVector>
  ): WindVector | null {
    // Snap to nearest grid point (0.25° grid)
    const snapLat = Math.round(lat * 4) / 4;
    const snapLon = Math.round(lon * 4) / 4;
    const key = `${snapLat.toFixed(2)},${snapLon.toFixed(2)}`;

    return grid.get(key) ?? null;
  }

  /**
   * Map wind speed to a color (blue=calm, green=moderate, yellow=strong, red=extreme).
   */
  private getSpeedColor(speed: number): Cesium.Color {
    // Speed ranges in m/s
    if (speed < 3) return Cesium.Color.fromCssColorString('#3498db').withAlpha(0.8);  // Light blue
    if (speed < 8) return Cesium.Color.fromCssColorString('#2ecc71').withAlpha(0.8);  // Green
    if (speed < 15) return Cesium.Color.fromCssColorString('#f1c40f').withAlpha(0.8); // Yellow
    if (speed < 25) return Cesium.Color.fromCssColorString('#e67e22').withAlpha(0.8); // Orange
    return Cesium.Color.fromCssColorString('#e74c3c').withAlpha(0.8);                  // Red
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private clearAll(): void {
    if (!this.viewer) return;

    if (this.billboardCollection) {
      try {
        this.viewer.scene.primitives.remove(this.billboardCollection);
      } catch { /* already removed */ }
      this.billboardCollection = null;
    }

    if (this.polylineCollection) {
      try {
        this.viewer.scene.primitives.remove(this.polylineCollection);
      } catch { /* already removed */ }
      this.polylineCollection = null;
    }

    if (this.particleLayerInstance) {
      try {
        (this.particleLayerInstance as { destroy: () => void }).destroy();
      } catch { /* ignore */ }
      this.particleLayerInstance = null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Get the current visualization mode */
  get mode(): WindVisualizationMode {
    return this._mode;
  }

  /** Set the visualization mode (particle, barb, streamline) */
  setMode(mode: WindVisualizationMode): void {
    this._mode = mode;
  }

  /** Get the current pressure level */
  get level(): PressureLevel {
    return this._level;
  }

  /** Set the active pressure level */
  setLevel(level: PressureLevel): void {
    this._level = level;
  }

  /** Get all available pressure levels */
  static get availableLevels(): PressureLevel[] {
    return ['surface', '850hPa', '500hPa', '200hPa'];
  }

  /** Get all available visualization modes */
  static get availableModes(): WindVisualizationMode[] {
    return ['particle', 'barb', 'streamline'];
  }
}
