/**
 * RadarSimLayer — Simulated Weather Radar Reflectivity Layer
 *
 * Converts rainfall prediction rates (mm/hr) into simulated radar reflectivity
 * (dBZ) using the standard Z-R relationship, then renders with NWS-style radar
 * color table and an animated sweeping refresh effect.
 *
 * Requirements: 38.1, 38.2, 38.3
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';
import type { GridCell } from '../../../types';

// ── Constants ────────────────────────────────────────────────────────────────
const GRID_CELL_SIZE_DEG = 0.25;
const HALF_CELL = GRID_CELL_SIZE_DEG / 2;
const CANVAS_SIZE = 1024;

/** Sweep animation period in milliseconds (one full rotation) */
const SWEEP_PERIOD_MS = 6000;

/** Minimum dBZ threshold to render (below this is considered no precipitation) */
const MIN_RENDER_DBZ = 5;

// ── Z-R Relationship ─────────────────────────────────────────────────────────

/**
 * Convert rainfall rate (mm/hr) to radar reflectivity (dBZ).
 *
 * Uses the standard Marshall-Palmer Z-R relationship:
 *   Z = 200 × R^1.6
 *   dBZ = 10 × log10(Z) = 10 × log10(200 × R^1.6)
 *
 * Result is clamped to [0, 75].
 *
 * @param rainfallRate - Rainfall rate in mm/hr
 * @returns Reflectivity in dBZ, clamped to [0, 75]
 */
export function rainfallToDBZ(rainfallRate: number): number {
  if (rainfallRate <= 0) return 0;

  const z = 200 * Math.pow(rainfallRate, 1.6);
  const dbz = 10 * Math.log10(z);

  return Math.max(0, Math.min(75, dbz));
}

// ── NWS Radar Color Table ────────────────────────────────────────────────────

/**
 * NWS (National Weather Service) standard radar reflectivity color table.
 * Each entry: [minDBZ, [R, G, B]] — colors for specific dBZ thresholds.
 *
 * Scale ranges from light precipitation (5 dBZ) to extreme (65+ dBZ).
 */
export const NWS_RADAR_COLOR_TABLE: Array<{ minDBZ: number; color: [number, number, number] }> = [
  { minDBZ: 5,  color: [4, 233, 231] },     // Light drizzle — cyan
  { minDBZ: 10, color: [1, 159, 244] },      // Light rain — blue
  { minDBZ: 15, color: [3, 0, 244] },        // Light rain — dark blue
  { minDBZ: 20, color: [2, 253, 2] },        // Moderate — light green
  { minDBZ: 25, color: [1, 197, 1] },        // Moderate — green
  { minDBZ: 30, color: [0, 142, 0] },        // Moderate — dark green
  { minDBZ: 35, color: [253, 248, 2] },      // Heavy — yellow
  { minDBZ: 40, color: [229, 188, 0] },      // Heavy — dark yellow
  { minDBZ: 45, color: [253, 149, 0] },      // Very heavy — orange
  { minDBZ: 50, color: [253, 0, 0] },        // Intense — red
  { minDBZ: 55, color: [212, 0, 0] },        // Intense — dark red
  { minDBZ: 60, color: [188, 0, 0] },        // Extreme — maroon
  { minDBZ: 65, color: [248, 0, 253] },      // Extreme — magenta
  { minDBZ: 70, color: [152, 84, 198] },     // Extreme — purple
];

/**
 * Look up the NWS color for a given dBZ value.
 *
 * @param dbz - Reflectivity in dBZ
 * @returns RGB tuple [r, g, b] with values 0–255, or null if below threshold
 */
export function getRadarColor(dbz: number): [number, number, number] | null {
  if (dbz < MIN_RENDER_DBZ) return null;

  let matched: [number, number, number] = NWS_RADAR_COLOR_TABLE[0].color;

  for (const entry of NWS_RADAR_COLOR_TABLE) {
    if (dbz >= entry.minDBZ) {
      matched = entry.color;
    } else {
      break;
    }
  }

  return matched;
}

// ── Sweep Animation Utility ──────────────────────────────────────────────────

/**
 * Compute the sweep alpha modifier for a grid cell based on its angular position
 * relative to the current sweep angle. Cells recently "swept" are brighter;
 * cells about to be swept are dimmer — mimicking a radar scan pattern.
 *
 * @param cellLon - Longitude of the cell (degrees)
 * @param cellLat - Latitude of the cell (degrees)
 * @param centerLon - Center longitude of the radar sweep (degrees)
 * @param centerLat - Center latitude of the radar sweep (degrees)
 * @param sweepAngleDeg - Current sweep angle in degrees (0–360)
 * @returns Alpha multiplier between 0.4 and 1.0
 */
export function computeSweepAlpha(
  cellLon: number,
  cellLat: number,
  centerLon: number,
  centerLat: number,
  sweepAngleDeg: number
): number {
  // Compute angle from center to cell
  const dx = cellLon - centerLon;
  const dy = cellLat - centerLat;
  let cellAngle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (cellAngle < 0) cellAngle += 360;

  // Angular difference between sweep and cell (how recently the cell was swept)
  let diff = sweepAngleDeg - cellAngle;
  if (diff < 0) diff += 360;

  // Cells just swept (diff near 0) are brightest; cells about to be swept (diff near 360) are dimmer
  // Use a decay curve: alpha = 0.4 + 0.6 * exp(-diff / 120)
  const alpha = 0.4 + 0.6 * Math.exp(-diff / 120);
  return Math.max(0.4, Math.min(1.0, alpha));
}

// ── RadarSimLayer ────────────────────────────────────────────────────────────

/**
 * RadarSimLayer renders predicted rainfall as simulated weather radar
 * reflectivity with NWS color table and animated sweep effect.
 */
export class RadarSimLayer implements LayerPlugin {
  public readonly id = 'radar-sim';
  public readonly priority = 12; // Just above heatmap

  private viewer: Cesium.Viewer | null = null;
  private imageryLayer: Cesium.ImageryLayer | null = null;
  private animationFrameId: number | null = null;
  private sweepStartTime: number = 0;
  private lastState: LayerState | null = null;
  private isAnimating = false;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
    this.sweepStartTime = performance.now();
  }

  update(state: LayerState): void {
    if (!this.viewer) return;

    const { gridCells } = state;

    // Only render when variable is rainfall and grid cells exist
    if (!gridCells || gridCells.length === 0 || state.variable !== 'rainfall') {
      this.clearLayer();
      this.stopAnimation();
      return;
    }

    this.lastState = state;

    // Start sweep animation if not already running
    if (!this.isAnimating) {
      this.startAnimation();
    }

    // Render the current frame
    this.renderFrame();
  }

  destroy(): void {
    this.stopAnimation();
    this.clearLayer();
    this.viewer = null;
    this.lastState = null;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private renderFrame(): void {
    if (!this.viewer || !this.lastState) return;

    const { gridCells } = this.lastState;
    if (!gridCells || gridCells.length === 0) return;

    // Compute current sweep angle
    const elapsed = performance.now() - this.sweepStartTime;
    const sweepAngleDeg = (elapsed / SWEEP_PERIOD_MS) * 360 % 360;

    // Compute bounds
    const bounds = this.computeBounds(gridCells);
    if (!bounds) return;

    // Compute center of the data for sweep origin
    const centerLon = (bounds.west + bounds.east) / 2;
    const centerLat = (bounds.south + bounds.north) / 2;

    // Render to canvas
    const canvas = this.renderRadarCanvas(gridCells, bounds, centerLon, centerLat, sweepAngleDeg);
    if (!canvas) return;

    // Remove previous imagery
    this.removeImageryLayer();

    // Create new imagery layer
    const imageryProvider = new Cesium.SingleTileImageryProvider({
      url: canvas.toDataURL('image/png'),
      rectangle: Cesium.Rectangle.fromDegrees(
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north
      ),
    });

    this.imageryLayer = this.viewer.imageryLayers.addImageryProvider(imageryProvider);
    this.imageryLayer.alpha = 0.85;
  }

  private renderRadarCanvas(
    gridCells: GridCell[],
    bounds: { west: number; south: number; east: number; north: number },
    centerLon: number,
    centerLat: number,
    sweepAngleDeg: number
  ): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lonRange = bounds.east - bounds.west;
    const latRange = bounds.north - bounds.south;
    if (lonRange <= 0 || latRange <= 0) return null;

    for (const cell of gridCells) {
      const rainfallRate = cell.rainfall;
      if (rainfallRate === undefined || rainfallRate === null || rainfallRate <= 0) continue;

      // Convert rainfall to dBZ
      const dbz = rainfallToDBZ(rainfallRate);
      if (dbz < MIN_RENDER_DBZ) continue;

      // Get NWS color
      const color = getRadarColor(dbz);
      if (!color) continue;

      // Compute sweep alpha for animation
      const sweepAlpha = computeSweepAlpha(
        cell.lon, cell.lat, centerLon, centerLat, sweepAngleDeg
      );

      // Map cell to canvas coordinates
      const x = ((cell.lon - HALF_CELL - bounds.west) / lonRange) * canvas.width;
      const y = ((bounds.north - (cell.lat + HALF_CELL)) / latRange) * canvas.height;
      const w = (GRID_CELL_SIZE_DEG / lonRange) * canvas.width;
      const h = (GRID_CELL_SIZE_DEG / latRange) * canvas.height;

      const [r, g, b] = color;
      ctx.fillStyle = `rgba(${r},${g},${b},${sweepAlpha})`;
      ctx.fillRect(x, y, w, h);
    }

    // Draw sweep line for visual effect
    this.drawSweepLine(ctx, centerLon, centerLat, bounds, sweepAngleDeg, lonRange, latRange);

    return canvas;
  }

  /**
   * Draw a faint radial sweep line from center outward at the current angle.
   */
  private drawSweepLine(
    ctx: CanvasRenderingContext2D,
    centerLon: number,
    centerLat: number,
    bounds: { west: number; south: number; east: number; north: number },
    sweepAngleDeg: number,
    lonRange: number,
    latRange: number
  ): void {
    const cx = ((centerLon - bounds.west) / lonRange) * CANVAS_SIZE;
    const cy = ((bounds.north - centerLat) / latRange) * CANVAS_SIZE;

    const angleRad = sweepAngleDeg * (Math.PI / 180);
    const radius = CANVAS_SIZE * 0.7;

    const endX = cx + radius * Math.cos(angleRad);
    const endY = cy - radius * Math.sin(angleRad);

    // Create gradient along the sweep line
    const gradient = ctx.createLinearGradient(cx, cy, endX, endY);
    gradient.addColorStop(0, 'rgba(0, 255, 100, 0.6)');
    gradient.addColorStop(1, 'rgba(0, 255, 100, 0.0)');

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ── Animation ──────────────────────────────────────────────────────────────

  private startAnimation(): void {
    if (this.isAnimating) return;
    this.isAnimating = true;
    this.sweepStartTime = performance.now();
    this.animationLoop();
  }

  private animationLoop(): void {
    if (!this.isAnimating || !this.viewer) return;

    this.renderFrame();

    this.animationFrameId = requestAnimationFrame(() => this.animationLoop());
  }

  private stopAnimation(): void {
    this.isAnimating = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private clearLayer(): void {
    this.removeImageryLayer();
  }

  private removeImageryLayer(): void {
    if (this.imageryLayer && this.viewer) {
      try {
        this.viewer.imageryLayers.remove(this.imageryLayer, true);
      } catch {
        // Layer may already be removed
      }
      this.imageryLayer = null;
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
}
