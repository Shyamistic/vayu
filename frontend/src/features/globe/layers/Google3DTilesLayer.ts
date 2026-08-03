/**
 * Google Photorealistic 3D Tiles Layer
 *
 * Loads Google's Photorealistic 3D Tiles via the Maps Platform Tiles API,
 * providing satellite-quality textured 3D basemaps with buildings and vegetation.
 *
 * Configuration:
 * - maximumMemoryUsage: 512 MB browser cache limit
 * - maximumScreenSpaceError: 8 (balance quality vs performance)
 * - skipLevelOfDetail: true (faster initial load)
 * - preferLeaves: true (show detail quickly)
 *
 * Fallback: When the API key is missing or quota is exceeded, the layer
 * operates as a graceful no-op — the viewer continues with Cesium World Terrain.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_3D_TILES_URL_TEMPLATE =
  'https://tile.googleapis.com/v1/3dtiles/root.json?key=';

/** Maximum GPU memory budget for tile cache (MB) */
const MAX_MEMORY_USAGE = 512;

/** Screen-space error threshold — lower = higher quality, higher GPU cost */
const MAX_SCREEN_SPACE_ERROR = 8;

/** Opacity bounds for the heatmap overlay above photorealistic terrain */
const MIN_OPACITY = 0.3;
const MAX_OPACITY = 0.9;

// ── Google3DTilesLayer ───────────────────────────────────────────────────────

export class Google3DTilesLayer implements LayerPlugin {
  readonly id = 'google-3d-tiles';
  readonly priority = 5; // Renders early as a base layer

  private tileset: Cesium.Cesium3DTileset | null = null;
  private viewer: Cesium.Viewer | null = null;
  private isActive = false;
  private apiKeyAvailable = false;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async init(viewer: Cesium.Viewer): Promise<void> {
    this.viewer = viewer;

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

    if (!apiKey) {
      console.warn(
        '[Google3DTilesLayer] VITE_GOOGLE_MAPS_API_KEY not set — ' +
          'falling back to Cesium World Terrain.',
      );
      this.apiKeyAvailable = false;
      return;
    }

    this.apiKeyAvailable = true;

    try {
      const url = `${GOOGLE_3D_TILES_URL_TEMPLATE}${apiKey}`;

      this.tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
        // 512 MB cache budget in bytes (Req 4.4)
        cacheBytes: MAX_MEMORY_USAGE * 1024 * 1024,
        maximumScreenSpaceError: MAX_SCREEN_SPACE_ERROR,
        skipLevelOfDetail: true,
        preferLeaves: true,
      });

      // Initially hidden — visibility controlled via update()
      this.tileset.show = false;

      viewer.scene.primitives.add(this.tileset);

      // Listen for tile load failures (quota exceeded, network error)
      this.tileset.tileFailed.addEventListener(this.handleTileFailure);
    } catch (error) {
      console.error(
        '[Google3DTilesLayer] Failed to load tileset — ' +
          'falling back to Cesium World Terrain.',
        error,
      );
      this.tileset = null;
      this.apiKeyAvailable = false;
    }
  }

  update(state: LayerState): void {
    if (!this.tileset) return;

    // Show/hide based on whether 'photorealistic' is the active layer
    // The activeLayer is communicated via heatmapOpacity being set (when
    // photorealistic tiles are active). The layer visibility is determined
    // by checking if the layer system has enabled this layer.
    // Since LayerState doesn't have an explicit "activeLayer" field,
    // we infer activation from heatmapOpacity being within the valid range
    // (the design specifies 0.3–0.9 only when photorealistic tiles are active).
    // However, the more robust approach is: always show the tileset when this
    // layer's update is called — the LayerRegistry only dispatches to enabled layers.
    // We simply keep it visible and let the registry handle enable/disable.

    // Always show when update is called (layer is registered = layer is active)
    this.tileset.show = true;
    this.isActive = true;
  }

  destroy(): void {
    if (this.tileset && this.viewer) {
      this.tileset.tileFailed.removeEventListener(this.handleTileFailure);
      this.viewer.scene.primitives.remove(this.tileset);
      this.tileset = null;
    }

    this.viewer = null;
    this.isActive = false;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Returns whether the Google 3D Tiles API key is available and the tileset
   * loaded successfully. When false, the layer is a no-op and the globe
   * continues with its default terrain provider (Cesium World Terrain).
   */
  get isAvailable(): boolean {
    return this.apiKeyAvailable && this.tileset !== null;
  }

  /**
   * Programmatically show or hide the tileset.
   */
  setVisible(visible: boolean): void {
    if (this.tileset) {
      this.tileset.show = visible;
      this.isActive = visible;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Handles tile load failures (e.g., HTTP 429 quota exceeded, 403 forbidden).
   * Logs a warning and gracefully degrades — the tileset remains in the scene
   * but failed tiles are skipped, showing through to the underlying terrain.
   */
  private handleTileFailure = (event: { url: string; message: string }): void => {
    const msg = event.message || '';
    const url = event.url || '';

    if (msg.includes('429') || msg.includes('quota')) {
      console.warn(
        '[Google3DTilesLayer] API quota exceeded — some tiles may not load. ' +
          'Falling back to Cesium World Terrain for affected areas.',
      );
    } else if (msg.includes('403') || msg.includes('forbidden')) {
      console.warn(
        '[Google3DTilesLayer] API key unauthorized (403) — ' +
          'verify VITE_GOOGLE_MAPS_API_KEY is valid.',
      );
    } else {
      console.warn(
        `[Google3DTilesLayer] Tile load failed: ${msg} (${url})`,
      );
    }
  };
}

// ── Heatmap Opacity Utility ──────────────────────────────────────────────────

/**
 * Clamps a heatmap opacity value to the allowed range [0.3, 0.9] when
 * photorealistic 3D tiles are active.
 *
 * This utility is used by the heatmap layer or UI slider to enforce the
 * opacity constraint specified in Requirement 4.3.
 */
export function clampHeatmapOpacity(value: number): number {
  return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, value));
}

/**
 * Constants exported for use in UI slider configuration.
 */
export const HEATMAP_OPACITY_MIN = MIN_OPACITY;
export const HEATMAP_OPACITY_MAX = MAX_OPACITY;
