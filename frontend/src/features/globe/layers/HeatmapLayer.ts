/**
 * HeatmapLayer — Terrain-clamped climate heatmap rendering using GroundPrimitive.
 *
 * Renders gridded climate data (0.25° cells) as color-coded rectangles clamped to
 * the CesiumJS globe terrain surface. Falls back to SingleTileImageryProvider when
 * GroundPrimitive rendering exceeds 500ms.
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 32.1, 32.2
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';
import type { GridCell, VariableId } from '../../../types';
import { COLOR_SCALES } from '../../../utils/colorScales';
import type { ColormapId } from '../../../utils/colorScales';

// ── Variable normalization ranges ────────────────────────────────────────────
const VARIABLE_CONFIG: Record<VariableId, { min: number; max: number }> = {
  rainfall: { min: 0, max: 50 },
  temp_max: { min: 20, max: 45 },
  temp_min: { min: 10, max: 30 },
};

// ── Constants ────────────────────────────────────────────────────────────────
const GRID_CELL_SIZE_DEG = 0.25;
const HALF_CELL = GRID_CELL_SIZE_DEG / 2; // 0.125°
const RENDER_TIMEOUT_MS = 500;
const FALLBACK_CANVAS_SIZE = 1024;

/**
 * Compute a Cesium.Color from a grid cell value using the active colormap.
 */
function computeCellColor(
  value: number,
  variable: VariableId,
  colormapId: ColormapId,
  opacity: number
): Cesium.Color {
  const cfg = VARIABLE_CONFIG[variable];
  const t = Math.max(0, Math.min(1, (value - cfg.min) / (cfg.max - cfg.min)));

  // For rainfall: transparent when near zero (dry)
  if (variable === 'rainfall' && t < 0.04) {
    return new Cesium.Color(1, 1, 1, 0);
  }

  const colorFn = COLOR_SCALES[colormapId] ?? COLOR_SCALES['imd_rain'];
  const [r, g, b] = colorFn(t);
  return new Cesium.Color(r / 255, g / 255, b / 255, opacity);
}

/**
 * HeatmapLayer implements the LayerPlugin interface for terrain-clamped
 * climate heatmap rendering using Cesium GroundPrimitive.
 */
export class HeatmapLayer implements LayerPlugin {
  public readonly id = 'heatmap';
  public readonly priority = 10; // Renders early (beneath boundaries, labels, etc.)

  private viewer: Cesium.Viewer | null = null;
  private groundPrimitive: Cesium.GroundPrimitive | null = null;
  private fallbackImageryLayer: Cesium.ImageryLayer | null = null;
  private useFallback = false;
  private lastRenderTime = 0;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
  }

  update(state: LayerState): void {
    if (!this.viewer) return;

    const { gridCells, variable, colormap, terrainExaggeration, heatmapOpacity } = state;

    // Only render when grid cells are available
    if (!gridCells || gridCells.length === 0) {
      this.clearPrimitives();
      return;
    }

    // Apply terrain exaggeration (1×–5×)
    this.applyTerrainExaggeration(terrainExaggeration);

    // Choose rendering path
    if (this.useFallback) {
      this.renderFallback(gridCells, variable, colormap, heatmapOpacity);
    } else {
      this.renderGroundPrimitive(gridCells, variable, colormap, heatmapOpacity);
    }
  }

  destroy(): void {
    this.clearPrimitives();
    this.viewer = null;
  }

  // ── GroundPrimitive Rendering ──────────────────────────────────────────────

  private renderGroundPrimitive(
    gridCells: GridCell[],
    variable: VariableId,
    colormapId: ColormapId,
    opacity: number
  ): void {
    if (!this.viewer) return;

    const startTime = performance.now();

    // Remove existing primitive
    this.removeGroundPrimitive();

    // Build geometry instances for each grid cell
    const instances: Cesium.GeometryInstance[] = [];

    for (const cell of gridCells) {
      const value = cell[variable] as number;
      if (value === undefined || value === null) continue;

      const color = computeCellColor(value, variable, colormapId, opacity);
      // Skip fully transparent cells
      if (color.alpha === 0) continue;

      const rectangle = Cesium.Rectangle.fromDegrees(
        cell.lon - HALF_CELL,
        cell.lat - HALF_CELL,
        cell.lon + HALF_CELL,
        cell.lat + HALF_CELL
      );

      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.RectangleGeometry({ rectangle }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
          },
        })
      );
    }

    if (instances.length === 0) return;

    // Create GroundPrimitive (terrain-clamped)
    this.groundPrimitive = new Cesium.GroundPrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({
        flat: true,
        translucent: opacity < 1.0,
      }),
      asynchronous: true,
    });

    this.viewer.scene.primitives.add(this.groundPrimitive);

    // Track render time — switch to fallback if it exceeds threshold
    const elapsed = performance.now() - startTime;
    this.lastRenderTime = elapsed;

    if (elapsed > RENDER_TIMEOUT_MS) {
      console.warn(
        `[HeatmapLayer] GroundPrimitive creation took ${elapsed.toFixed(0)}ms (>${RENDER_TIMEOUT_MS}ms). Switching to imagery fallback.`
      );
      this.useFallback = true;
      this.removeGroundPrimitive();
      this.renderFallback(gridCells, variable, colormapId, opacity);
    }
  }

  // ── SingleTileImageryProvider Fallback ─────────────────────────────────────

  private renderFallback(
    gridCells: GridCell[],
    variable: VariableId,
    colormapId: ColormapId,
    opacity: number
  ): void {
    if (!this.viewer) return;

    this.removeFallbackImagery();

    // Compute bounding rectangle from grid cells
    const bounds = this.computeBounds(gridCells);
    if (!bounds) return;

    // Render heatmap to an offscreen canvas
    const canvas = this.renderToCanvas(gridCells, variable, colormapId, opacity, bounds);
    if (!canvas) return;

    // Create imagery layer from canvas
    const imageryProvider = new Cesium.SingleTileImageryProvider({
      url: canvas.toDataURL('image/png'),
      rectangle: Cesium.Rectangle.fromDegrees(
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north
      ),
    });

    this.fallbackImageryLayer = this.viewer.imageryLayers.addImageryProvider(imageryProvider);
    this.fallbackImageryLayer.alpha = opacity;
  }

  /**
   * Render grid cells onto an offscreen canvas for the fallback path.
   */
  private renderToCanvas(
    gridCells: GridCell[],
    variable: VariableId,
    colormapId: ColormapId,
    opacity: number,
    bounds: { west: number; south: number; east: number; north: number }
  ): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas');
    canvas.width = FALLBACK_CANVAS_SIZE;
    canvas.height = FALLBACK_CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Clear to transparent
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lonRange = bounds.east - bounds.west;
    const latRange = bounds.north - bounds.south;

    if (lonRange <= 0 || latRange <= 0) return null;

    const colorFn = COLOR_SCALES[colormapId] ?? COLOR_SCALES['imd_rain'];
    const cfg = VARIABLE_CONFIG[variable];

    for (const cell of gridCells) {
      const value = cell[variable] as number;
      if (value === undefined || value === null) continue;

      const t = Math.max(0, Math.min(1, (value - cfg.min) / (cfg.max - cfg.min)));

      // Skip transparent cells
      if (variable === 'rainfall' && t < 0.04) continue;

      const [r, g, b] = colorFn(t);

      // Map cell to canvas coordinates
      const x = ((cell.lon - HALF_CELL - bounds.west) / lonRange) * canvas.width;
      const y = ((bounds.north - (cell.lat + HALF_CELL)) / latRange) * canvas.height;
      const w = (GRID_CELL_SIZE_DEG / lonRange) * canvas.width;
      const h = (GRID_CELL_SIZE_DEG / latRange) * canvas.height;

      ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
      ctx.fillRect(x, y, w, h);
    }

    return canvas;
  }

  // ── Terrain Exaggeration ───────────────────────────────────────────────────

  /**
   * Apply terrain exaggeration factor (1×–5×).
   * The vertical offset of terrain-clamped primitives scales proportionally.
   * GroundPrimitive automatically follows the exaggerated terrain surface.
   */
  private applyTerrainExaggeration(factor: number): void {
    if (!this.viewer) return;

    // Clamp to valid range
    const clamped = Math.max(1, Math.min(5, factor));

    // Cesium 1.118+ uses scene.verticalExaggeration;
    // older versions use globe.terrainExaggeration.
    try {
      (this.viewer.scene as unknown as { verticalExaggeration: number }).verticalExaggeration = clamped;
    } catch {
      // Fallback for older Cesium versions
      try {
        (this.viewer.scene.globe as unknown as { terrainExaggeration: number }).terrainExaggeration = clamped;
      } catch { /* noop */ }
    }

    // GroundPrimitive clamps to the exaggerated surface natively,
    // so no additional offset computation is needed.
  }

  // ── Cleanup Helpers ────────────────────────────────────────────────────────

  private clearPrimitives(): void {
    this.removeGroundPrimitive();
    this.removeFallbackImagery();
  }

  private removeGroundPrimitive(): void {
    if (this.groundPrimitive && this.viewer) {
      try {
        this.viewer.scene.primitives.remove(this.groundPrimitive);
      } catch {
        // Primitive may already be removed
      }
      this.groundPrimitive = null;
    }
  }

  private removeFallbackImagery(): void {
    if (this.fallbackImageryLayer && this.viewer) {
      try {
        this.viewer.imageryLayers.remove(this.fallbackImageryLayer, true);
      } catch {
        // Layer may already be removed
      }
      this.fallbackImageryLayer = null;
    }
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  private computeBounds(gridCells: GridCell[]): {
    west: number;
    south: number;
    east: number;
    north: number;
  } | null {
    if (gridCells.length === 0) return null;

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

    for (const cell of gridCells) {
      west = Math.min(west, cell.lon - HALF_CELL);
      south = Math.min(south, cell.lat - HALF_CELL);
      east = Math.max(east, cell.lon + HALF_CELL);
      north = Math.max(north, cell.lat + HALF_CELL);
    }

    return { west, south, east, north };
  }

  // ── Public Accessors ───────────────────────────────────────────────────────

  /** Returns the last GroundPrimitive render time in ms (for diagnostics). */
  get renderTime(): number {
    return this.lastRenderTime;
  }

  /** Whether the layer has switched to the imagery fallback path. */
  get isFallbackActive(): boolean {
    return this.useFallback;
  }

  /** Reset to GroundPrimitive rendering (e.g., after performance improves). */
  resetToGroundPrimitive(): void {
    this.useFallback = false;
  }
}
