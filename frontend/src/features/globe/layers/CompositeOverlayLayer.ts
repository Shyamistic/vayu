/**
 * CompositeOverlayLayer — Multi-variable composite overlay rendering.
 *
 * Renders up to 3 climate variables simultaneously using distinct visual
 * channels so each variable remains distinguishable while alpha-blended
 * over the globe:
 *
 *   Channel 0 — color_fill  : GroundPrimitive coloured by variable value
 *   Channel 1 — contours    : Polyline isolines (delegates to ContourLayer logic)
 *   Channel 2 — arrows      : Wind-style vector arrows at grid points
 *
 * Bivariate mode encodes two variables in a single 2D colour matrix: the
 * hue is determined by mixing the two per-variable colour scales, producing
 * a unique tint at each (x, y) combination visible in BivariateColorLegend.
 *
 * Requirements: 39.1, 39.2, 39.3, 39.4
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';
import type { GridCell, VariableId } from '../../../types';
import type { ColormapId, RGB } from '../../../utils/colorScales';
import { COLOR_SCALES } from '../../../utils/colorScales';
import { generateContours } from '../../../core/utils/contourGenerator';

// ── Local overlay entry (mirrors store type without circular dep) ──────────────

export interface CompositeEntry {
  slotId: number;
  variable: VariableId;
  channel: 'color_fill' | 'contours' | 'arrows';
  opacity: number;
  zOrder: number;
  visible: boolean;
  colormap: ColormapId;
}

export interface BivariateRenderConfig {
  variableX: VariableId;
  variableY: VariableId;
  colormapX: ColormapId;
  colormapY: ColormapId;
}

// ── Normalisation ranges for each variable ─────────────────────────────────────

const VAR_RANGES: Record<VariableId, { min: number; max: number }> = {
  rainfall: { min: 0, max: 50 },
  temp_max: { min: 20, max: 45 },
  temp_min: { min: 10, max: 30 },
};

/** Normalise a raw value to [0, 1] for the given variable */
function normalise(value: number, variable: VariableId): number {
  const { min, max } = VAR_RANGES[variable];
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/** Read a grid cell's value for a given variable */
function getVariableValue(cell: GridCell, variable: VariableId): number {
  switch (variable) {
    case 'temp_max': return cell.temp_max;
    case 'temp_min': return cell.temp_min;
    default:         return cell.rainfall;
  }
}

// ── Colour blending helpers ────────────────────────────────────────────────────

/** Blend two [r,g,b] colours with equal weight */
function blendRGB(a: RGB, b: RGB): RGB {
  return [
    Math.round((a[0] + b[0]) / 2),
    Math.round((a[1] + b[1]) / 2),
    Math.round((a[2] + b[2]) / 2),
  ];
}

/**
 * Compute the bivariate blended colour for a cell given two variable/colormap
 * pairs. Blends the two colormaps proportional to each variable's normalised
 * value to create a unique tint for each (x, y) position in the 2D matrix.
 */
function bivariateColor(
  cell: GridCell,
  variableX: VariableId,
  variableY: VariableId,
  colormapX: ColormapId,
  colormapY: ColormapId,
): RGB {
  const tx = normalise(getVariableValue(cell, variableX), variableX);
  const ty = normalise(getVariableValue(cell, variableY), variableY);

  const colorX = COLOR_SCALES[colormapX](tx);
  const colorY = COLOR_SCALES[colormapY](ty);

  return blendRGB(colorX, colorY);
}

// ── Arrow geometry helper ──────────────────────────────────────────────────────

const ARROW_SIZE_DEG = 0.2;

/** Build a simple arrow polyline from an origin cell toward a bearing (0° = N). */
function makeArrowPositions(
  lat: number,
  lon: number,
  bearingDeg: number,
  lengthDeg: number,
): Cesium.Cartesian3[] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dlat = Math.cos(rad) * lengthDeg;
  const dlon = Math.sin(rad) * lengthDeg;

  const tail = Cesium.Cartesian3.fromDegrees(lon, lat, 100);
  const head = Cesium.Cartesian3.fromDegrees(lon + dlon, lat + dlat, 100);

  // Arrowhead: two short lines ±30° from reversed bearing
  const backRad = rad + Math.PI;
  const leftRad  = backRad - Math.PI / 6;
  const rightRad = backRad + Math.PI / 6;
  const barb = lengthDeg * 0.35;

  const headLeft  = Cesium.Cartesian3.fromDegrees(
    lon + dlon + Math.sin(leftRad)  * barb,
    lat + dlat + Math.cos(leftRad)  * barb,
    100,
  );
  const headRight = Cesium.Cartesian3.fromDegrees(
    lon + dlon + Math.sin(rightRad) * barb,
    lat + dlat + Math.cos(rightRad) * barb,
    100,
  );

  return [tail, head, headLeft, head, headRight];
}

// ── CompositeOverlayLayer ──────────────────────────────────────────────────────

export class CompositeOverlayLayer implements LayerPlugin {
  public readonly id = 'composite_overlay';
  public readonly priority = 15; // Between heatmap (10) and boundaries (30)

  private viewer: Cesium.Viewer | null = null;

  /** Active overlay entries injected externally (from store) */
  private overlays: CompositeEntry[] = [];

  /** Whether bivariate mode is active */
  private bivariate = false;
  private bivariateConfig: BivariateRenderConfig = {
    variableX: 'rainfall',
    variableY: 'temp_max',
    colormapX: 'blues',
    colormapY: 'reds',
  };

  // Cesium primitives/collections per slot
  private groundPrimitives: Map<number, Cesium.GroundPrimitive> = new Map();
  private polylineCollections: Map<number, Cesium.PolylineCollection> = new Map();
  private arrowCollections: Map<number, Cesium.PolylineCollection> = new Map();
  private bivariateGround: Cesium.GroundPrimitive | null = null;

  // ── Public configuration API ─────────────────────────────────────────────

  /**
   * Push fresh overlay configuration from the store before each render cycle.
   * Called by the component that bridges the store to the Cesium layer.
   */
  setOverlays(overlays: CompositeEntry[]): void {
    this.overlays = overlays;
  }

  setBivariate(active: boolean, config?: BivariateRenderConfig): void {
    this.bivariate = active;
    if (config) this.bivariateConfig = config;
  }

  // ── LayerPlugin lifecycle ────────────────────────────────────────────────

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
  }

  update(state: LayerState): void {
    if (!this.viewer || !state.gridCells || state.gridCells.length === 0) return;

    this.clearAll();

    if (this.bivariate) {
      this.renderBivariate(state.gridCells);
      return;
    }

    // Sort by zOrder so Cesium adds lower-zOrder primitives first (behind)
    const sorted = [...this.overlays].sort((a, b) => a.zOrder - b.zOrder);

    for (const entry of sorted) {
      if (!entry.visible) continue;

      switch (entry.channel) {
        case 'color_fill':
          this.renderColorFill(entry, state.gridCells);
          break;
        case 'contours':
          this.renderContourOverlay(entry, state.gridCells);
          break;
        case 'arrows':
          this.renderArrows(entry, state.gridCells);
          break;
      }
    }
  }

  destroy(): void {
    this.clearAll();
    this.viewer = null;
  }

  // ── Color fill channel ───────────────────────────────────────────────────

  /**
   * Render a GroundPrimitive heatmap for the color_fill channel with per-entry
   * opacity (alpha blending, Req 39.2).
   */
  private renderColorFill(entry: CompositeEntry, cells: GridCell[]): void {
    if (!this.viewer) return;

    const colorScale = COLOR_SCALES[entry.colormap] ?? COLOR_SCALES['imd_rain'];
    const alpha = Math.max(0, Math.min(1, entry.opacity));

    const instances = cells.map((cell) => {
      const t = normalise(getVariableValue(cell, entry.variable), entry.variable);
      const [r, g, b] = colorScale(t);

      return new Cesium.GeometryInstance({
        geometry: new Cesium.RectangleGeometry({
          rectangle: Cesium.Rectangle.fromDegrees(
            cell.lon - 0.125,
            cell.lat - 0.125,
            cell.lon + 0.125,
            cell.lat + 0.125,
          ),
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            new Cesium.Color(r / 255, g / 255, b / 255, alpha),
          ),
        },
      });
    });

    if (instances.length === 0) return;

    const prim = new Cesium.GroundPrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true }),
      releaseGeometryInstances: true,
      allowPicking: false,
    });

    this.viewer.scene.primitives.add(prim);
    this.groundPrimitives.set(entry.slotId, prim);
  }

  // ── Contour channel ──────────────────────────────────────────────────────

  /**
   * Render contour isolines for the contours channel.
   * Reuses the shared contourGenerator to avoid code duplication.
   */
  private renderContourOverlay(entry: CompositeEntry, cells: GridCell[]): void {
    if (!this.viewer) return;

    const INTERVALS: Record<VariableId, number[]> = {
      rainfall: [5, 10, 25, 50],
      temp_max: [25, 30, 35, 40],
      temp_min: [10, 15, 20, 25],
    };

    const results = generateContours(cells, entry.variable, INTERVALS[entry.variable]);
    if (results.length === 0) return;

    const colorScale = COLOR_SCALES[entry.colormap] ?? COLOR_SCALES['imd_rain'];
    const alpha = Math.max(0, Math.min(1, entry.opacity));
    const collection = new Cesium.PolylineCollection();

    const range = VAR_RANGES[entry.variable];

    for (const result of results) {
      const t = Math.max(0, Math.min(1, (result.level - range.min) / (range.max - range.min)));
      const [r, g, b] = colorScale(t);
      const color = new Cesium.Color(r / 255, g / 255, b / 255, alpha);

      for (const segment of result.segments) {
        if (segment.length < 2) continue;
        const positions = segment.map((pt) =>
          Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 60),
        );
        collection.add({
          positions,
          width: 1.5,
          material: Cesium.Material.fromType('Color', { color }),
        });
      }
    }

    this.viewer.scene.primitives.add(collection);
    this.polylineCollections.set(entry.slotId, collection);
  }

  // ── Arrow channel ────────────────────────────────────────────────────────

  /**
   * Render directional arrows at each grid point for the arrows channel.
   * Arrow bearing is derived from the variable value mapped to 0–360°,
   * giving a visual indicator of intensity and a direction-like display.
   * For real wind data this should be replaced with actual u/v vectors;
   * here we produce a compact indicator suitable for a third variable.
   */
  private renderArrows(entry: CompositeEntry, cells: GridCell[]): void {
    if (!this.viewer) return;

    const alpha = Math.max(0, Math.min(1, entry.opacity));
    const colorScale = COLOR_SCALES[entry.colormap] ?? COLOR_SCALES['viridis'];
    const collection = new Cesium.PolylineCollection();

    // Sub-sample to avoid overloading the scene (show 1 in 4 cells)
    const stride = 2;

    for (let i = 0; i < cells.length; i += stride) {
      const cell = cells[i];
      const raw = getVariableValue(cell, entry.variable);
      const t   = normalise(raw, entry.variable);
      const [r, g, b] = colorScale(t);
      const color = new Cesium.Color(r / 255, g / 255, b / 255, alpha);

      // Map normalised value to arrow bearing (0° = N, 360° = N)
      const bearing = t * 360;
      const length  = ARROW_SIZE_DEG * (0.5 + t * 0.5); // scale length by intensity

      const positions = makeArrowPositions(cell.lat, cell.lon, bearing, length);

      collection.add({
        positions,
        width: 1.5,
        material: Cesium.Material.fromType('Color', { color }),
      });
    }

    this.viewer.scene.primitives.add(collection);
    this.arrowCollections.set(entry.slotId, collection);
  }

  // ── Bivariate rendering ──────────────────────────────────────────────────

  /**
   * Render a bivariate heatmap blending two colormap-derived colours per cell
   * (Req 39.4).  Each cell gets a unique tint from the 2D colour matrix.
   */
  private renderBivariate(cells: GridCell[]): void {
    if (!this.viewer) return;

    const { variableX, variableY, colormapX, colormapY } = this.bivariateConfig;

    const instances = cells.map((cell) => {
      const [r, g, b] = bivariateColor(cell, variableX, variableY, colormapX, colormapY);

      return new Cesium.GeometryInstance({
        geometry: new Cesium.RectangleGeometry({
          rectangle: Cesium.Rectangle.fromDegrees(
            cell.lon - 0.125,
            cell.lat - 0.125,
            cell.lon + 0.125,
            cell.lat + 0.125,
          ),
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            new Cesium.Color(r / 255, g / 255, b / 255, 0.85),
          ),
        },
      });
    });

    if (instances.length === 0) return;

    this.bivariateGround = new Cesium.GroundPrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true }),
      releaseGeometryInstances: true,
      allowPicking: false,
    });

    this.viewer.scene.primitives.add(this.bivariateGround);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  private clearAll(): void {
    if (!this.viewer) return;

    for (const prim of this.groundPrimitives.values()) {
      try { this.viewer.scene.primitives.remove(prim); } catch { /* stale */ }
    }
    this.groundPrimitives.clear();

    for (const col of this.polylineCollections.values()) {
      try { this.viewer.scene.primitives.remove(col); } catch { /* stale */ }
    }
    this.polylineCollections.clear();

    for (const col of this.arrowCollections.values()) {
      try { this.viewer.scene.primitives.remove(col); } catch { /* stale */ }
    }
    this.arrowCollections.clear();

    if (this.bivariateGround) {
      try { this.viewer.scene.primitives.remove(this.bivariateGround); } catch { /* stale */ }
      this.bivariateGround = null;
    }
  }

  // ── Introspection ────────────────────────────────────────────────────────

  /** Number of currently active overlay entries */
  get activeCount(): number {
    return this.overlays.filter((o) => o.visible).length;
  }

  /** Whether bivariate mode is active */
  get isBivariate(): boolean {
    return this.bivariate;
  }
}

// ── Exported helpers ──────────────────────────────────────────────────────────

export { normalise, getVariableValue, blendRGB, bivariateColor, VAR_RANGES };
