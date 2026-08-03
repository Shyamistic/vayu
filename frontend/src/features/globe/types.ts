/**
 * Globe Layer Plugin Architecture — Type Definitions
 *
 * Defines the LayerPlugin interface and LayerState used by the plugin-based
 * CesiumGlobe shell to manage rendering layers via a registry pattern.
 */

import type * as Cesium from 'cesium';
import type {
  GridCell,
  VariableId,
  RegionId,
  ScenarioResponse,
} from '../../types';
import type { ColormapId } from '../../utils/colorScales';

// ── LayerState ───────────────────────────────────────────────────────────────
// All the state a layer might need for rendering updates.
// Layers pick what they need from this aggregate state object.

export interface LayerState {
  /** Current grid cells loaded for the active region/forecast day */
  gridCells: GridCell[];
  /** Active climate variable being displayed */
  variable: VariableId;
  /** Active region */
  region: RegionId;
  /** Forecast lead day (1–7) */
  forecastDay: number;
  /** Terrain exaggeration factor (1–5) */
  terrainExaggeration: number;
  /** Active colormap for heatmap rendering */
  colormap: ColormapId;
  /** Whether to show 3D extruded columns */
  show3D: boolean;
  /** Whether wind layer is enabled */
  showWind: boolean;
  /** Whether contour lines are enabled */
  showContours: boolean;
  /** Whether boundary layer is enabled */
  showBoundaries: boolean;
  /** Whether uncertainty visualization is enabled */
  showUncertainty: boolean;
  /** Scenario comparison data (for split-view or overlay) */
  scenarioData: ScenarioResponse | null;
  /** GIBS imagery date string 'YYYY-MM-DD' */
  gibsDate: string;
  /** Selected date for time-aware layers (terminator, etc.) */
  selectedDate: Date;
  /** Heatmap opacity (0.3–0.9 when photorealistic tiles active) */
  heatmapOpacity: number;
}

// ── LayerPlugin Interface ────────────────────────────────────────────────────
// Each rendering concern (heatmap, contours, boundaries, wind, etc.)
// is encapsulated in a plugin implementing this interface.

export interface LayerPlugin {
  /** Unique identifier for the layer (e.g., 'heatmap', 'boundary', 'wind') */
  id: string;

  /** Render priority — lower values render first (back-to-front ordering) */
  priority: number;

  /**
   * Initialize the layer with the Cesium viewer instance.
   * Called once when the layer is registered and the viewer is ready.
   * May be async for layers that need to load external resources.
   */
  init(viewer: Cesium.Viewer): void | Promise<void>;

  /**
   * Update the layer's visual state in response to app state changes.
   * Called whenever relevant state (gridCells, variable, region, etc.) changes.
   */
  update(state: LayerState): void;

  /**
   * Clean up all Cesium primitives, entities, and event handlers.
   * Called when the layer is unregistered or the globe is unmounted.
   */
  destroy(): void;
}

// ── Layer Configuration ──────────────────────────────────────────────────────
// Used to declaratively describe which layers to load.

export interface LayerConfig {
  /** Plugin ID to match against the registry */
  id: string;
  /** Whether the layer is currently enabled */
  enabled: boolean;
  /** Optional layer-specific options */
  options?: Record<string, unknown>;
}
