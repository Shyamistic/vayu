/**
 * ResolutionGridLayer — Visual Grid Overlay showing 0.25° cell boundaries.
 *
 * Renders the native 0.25° grid cell boundaries as polylines clamped to
 * the globe terrain surface, giving the user a clear visual reference for
 * the model's spatial resolution.
 *
 * When downscaling mode is active, also renders the finer 0.05° grid
 * at reduced opacity to show the downscaled cell structure.
 *
 * Validates: Requirements 84.1, 84.2
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';
import type { RegionId } from '../../../types';
import { REGION_EXTENTS } from '../../../core/utils/regionUtils';

// ── Constants ─────────────────────────────────────────────────────────────────

const NATIVE_GRID_DEG = 0.25;
const DOWNSCALED_GRID_DEG = 0.05;

/** Appearance of the coarse (native) 0.25° grid lines */
const NATIVE_GRID_COLOR = new Cesium.Color(0.2, 0.8, 1.0, 0.35); // cyan, translucent
const NATIVE_GRID_WIDTH = 1.0;

/** Appearance of the fine (downscaled) 0.05° grid lines */
const DOWNSCALED_GRID_COLOR = new Cesium.Color(0.4, 1.0, 0.6, 0.18); // green, more translucent
const DOWNSCALED_GRID_WIDTH = 0.5;

/** Maximum number of grid lines to render (performance guard) */
const MAX_LINES = 800;

/** Whether to show the coarse grid by default */
const SHOW_COARSE_GRID = true;

// ── State extension ───────────────────────────────────────────────────────────

/** Extra state that ResolutionGridLayer reads (not in base LayerState) */
declare module '../types' {
  interface LayerState {
    /** Whether the resolution grid overlay is visible */
    showResolutionGrid?: boolean;
    /** Whether statistical downscaling is active */
    downscalingActive?: boolean;
  }
}

// ── Layer Implementation ──────────────────────────────────────────────────────

/**
 * ResolutionGridLayer renders 0.25° (and optionally 0.05°) grid lines
 * on the globe to help users understand the spatial resolution of VAYU predictions.
 */
export class ResolutionGridLayer implements LayerPlugin {
  public readonly id = 'resolution_grid';
  public readonly priority = 60; // Render above heatmap, below labels

  private viewer: Cesium.Viewer | null = null;
  private nativeGridCollection: Cesium.PolylineCollection | null = null;
  private downscaledGridCollection: Cesium.PolylineCollection | null = null;
  private lastRegion: RegionId | null = null;
  private lastDownscalingActive: boolean | null = null;
  private lastShowGrid: boolean | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
  }

  update(state: LayerState): void {
    if (!this.viewer) return;

    const showGrid = state.showResolutionGrid ?? false;
    const downscalingActive = state.downscalingActive ?? false;

    // Clear if grid is hidden
    if (!showGrid) {
      this.clearCollections();
      this.lastShowGrid = false;
      return;
    }

    // Re-render if region, mode, or visibility changed
    const needsRebuild =
      this.lastRegion !== state.region ||
      this.lastDownscalingActive !== downscalingActive ||
      this.lastShowGrid !== showGrid;

    if (!needsRebuild) return;

    this.clearCollections();

    const extent = REGION_EXTENTS[state.region];

    if (SHOW_COARSE_GRID) {
      this.nativeGridCollection = this.buildGridLines(
        extent,
        NATIVE_GRID_DEG,
        NATIVE_GRID_COLOR,
        NATIVE_GRID_WIDTH
      );
      if (this.nativeGridCollection) {
        this.viewer.scene.primitives.add(this.nativeGridCollection);
      }
    }

    if (downscalingActive) {
      this.downscaledGridCollection = this.buildGridLines(
        extent,
        DOWNSCALED_GRID_DEG,
        DOWNSCALED_GRID_COLOR,
        DOWNSCALED_GRID_WIDTH
      );
      if (this.downscaledGridCollection) {
        this.viewer.scene.primitives.add(this.downscaledGridCollection);
      }
    }

    this.lastRegion = state.region;
    this.lastDownscalingActive = downscalingActive;
    this.lastShowGrid = showGrid;
  }

  destroy(): void {
    this.clearCollections();
    this.viewer = null;
  }

  // ── Grid Line Building ────────────────────────────────────────────────────

  /**
   * Build a PolylineCollection covering the region extent with grid lines
   * at the given cell size.
   */
  private buildGridLines(
    extent: { lat_min: number; lat_max: number; lon_min: number; lon_max: number },
    cellDeg: number,
    color: Cesium.Color,
    width: number
  ): Cesium.PolylineCollection | null {
    if (!this.viewer) return null;

    // Snap extent to grid boundaries
    const lonMin = Math.floor(extent.lon_min / cellDeg) * cellDeg;
    const lonMax = Math.ceil(extent.lon_max / cellDeg) * cellDeg;
    const latMin = Math.floor(extent.lat_min / cellDeg) * cellDeg;
    const latMax = Math.ceil(extent.lat_max / cellDeg) * cellDeg;

    // Count lines — guard against too many
    const numLonLines = Math.round((lonMax - lonMin) / cellDeg) + 1;
    const numLatLines = Math.round((latMax - latMin) / cellDeg) + 1;
    const totalLines = numLonLines + numLatLines;

    if (totalLines > MAX_LINES) {
      // Skip to avoid performance issues (too fine a grid at broad extent)
      return null;
    }

    const collection = new Cesium.PolylineCollection();
    const material = Cesium.Material.fromType('Color', { color });

    // Longitude lines (vertical in map view)
    for (let lon = lonMin; lon <= lonMax + 0.001; lon = +(lon + cellDeg).toFixed(6)) {
      const positions: Cesium.Cartesian3[] = [];
      for (let lat = latMin; lat <= latMax + 0.001; lat = +(lat + cellDeg / 4).toFixed(6)) {
        positions.push(Cesium.Cartesian3.fromDegrees(lon, lat));
      }
      if (positions.length >= 2) {
        collection.add({
          positions,
          width,
          material,
        });
      }
    }

    // Latitude lines (horizontal in map view)
    for (let lat = latMin; lat <= latMax + 0.001; lat = +(lat + cellDeg).toFixed(6)) {
      const positions: Cesium.Cartesian3[] = [];
      for (let lon = lonMin; lon <= lonMax + 0.001; lon = +(lon + cellDeg / 4).toFixed(6)) {
        positions.push(Cesium.Cartesian3.fromDegrees(lon, lat));
      }
      if (positions.length >= 2) {
        collection.add({
          positions,
          width,
          material,
        });
      }
    }

    return collection;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private clearCollections(): void {
    if (this.nativeGridCollection && this.viewer) {
      try { this.viewer.scene.primitives.remove(this.nativeGridCollection); } catch { /* noop */ }
      this.nativeGridCollection = null;
    }
    if (this.downscaledGridCollection && this.viewer) {
      try { this.viewer.scene.primitives.remove(this.downscaledGridCollection); } catch { /* noop */ }
      this.downscaledGridCollection = null;
    }
  }
}
