import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Google3DTilesLayer,
  clampHeatmapOpacity,
  HEATMAP_OPACITY_MIN,
  HEATMAP_OPACITY_MAX,
} from './Google3DTilesLayer';
import type { LayerState } from '../types';

// ── Mock Cesium ──────────────────────────────────────────────────────────────

const mockTileset = {
  show: true,
  tileFailed: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
};

vi.mock('cesium', () => ({
  Cesium3DTileset: {
    fromUrl: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockViewer() {
  return {
    scene: {
      primitives: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    },
  } as unknown as import('cesium').Viewer;
}

function createMockState(overrides: Partial<LayerState> = {}): LayerState {
  return {
    gridCells: [],
    variable: 'rainfall',
    region: 'western_ghats',
    forecastDay: 1,
    terrainExaggeration: 1,
    colormap: 'imd_rain',
    show3D: false,
    showWind: false,
    showContours: false,
    showBoundaries: false,
    showUncertainty: false,
    scenarioData: null,
    gibsDate: '2025-06-01',
    selectedDate: new Date(2025, 5, 15),
    heatmapOpacity: 0.6,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Google3DTilesLayer', () => {
  let layer: Google3DTilesLayer;
  let viewer: ReturnType<typeof createMockViewer>;

  beforeEach(() => {
    layer = new Google3DTilesLayer();
    viewer = createMockViewer();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('init', () => {
    it('should have correct id and priority', () => {
      expect(layer.id).toBe('google-3d-tiles');
      expect(layer.priority).toBe(5);
    });

    it('should log warning and be unavailable when API key is missing', async () => {
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await layer.init(viewer as unknown as import('cesium').Viewer);

      expect(layer.isAvailable).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('VITE_GOOGLE_MAPS_API_KEY not set'),
      );

      warnSpy.mockRestore();
    });

    it('should load tileset when API key is available', async () => {
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-api-key-123');

      const { Cesium3DTileset } = await import('cesium');
      (Cesium3DTileset.fromUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockTileset,
      );

      await layer.init(viewer as unknown as import('cesium').Viewer);

      expect(Cesium3DTileset.fromUrl).toHaveBeenCalledWith(
        'https://tile.googleapis.com/v1/3dtiles/root.json?key=test-api-key-123',
        expect.objectContaining({
          cacheBytes: 512 * 1024 * 1024,
          maximumScreenSpaceError: 8,
          skipLevelOfDetail: true,
          preferLeaves: true,
        }),
      );
      expect(viewer.scene.primitives.add).toHaveBeenCalledWith(mockTileset);
      expect(mockTileset.show).toBe(false); // Initially hidden
      expect(layer.isAvailable).toBe(true);
    });

    it('should handle tileset load failure gracefully', async () => {
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'bad-key');

      const { Cesium3DTileset } = await import('cesium');
      (Cesium3DTileset.fromUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error'),
      );

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await layer.init(viewer as unknown as import('cesium').Viewer);

      expect(layer.isAvailable).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load tileset'),
        expect.any(Error),
      );

      errorSpy.mockRestore();
    });
  });

  describe('update', () => {
    it('should show tileset when update is called', async () => {
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');

      const { Cesium3DTileset } = await import('cesium');
      (Cesium3DTileset.fromUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockTileset,
      );

      await layer.init(viewer as unknown as import('cesium').Viewer);
      mockTileset.show = false;

      layer.update(createMockState());

      expect(mockTileset.show).toBe(true);
    });

    it('should be a no-op when tileset is not loaded', () => {
      // No init called — tileset is null
      expect(() => layer.update(createMockState())).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should remove tileset from viewer scene', async () => {
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');

      const { Cesium3DTileset } = await import('cesium');
      (Cesium3DTileset.fromUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockTileset,
      );

      await layer.init(viewer as unknown as import('cesium').Viewer);
      layer.destroy();

      expect(mockTileset.tileFailed.removeEventListener).toHaveBeenCalled();
      expect(viewer.scene.primitives.remove).toHaveBeenCalledWith(mockTileset);
    });

    it('should be safe to call destroy without init', () => {
      expect(() => layer.destroy()).not.toThrow();
    });
  });

  describe('setVisible', () => {
    it('should toggle tileset visibility', async () => {
      vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');

      const { Cesium3DTileset } = await import('cesium');
      (Cesium3DTileset.fromUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockTileset,
      );

      await layer.init(viewer as unknown as import('cesium').Viewer);

      layer.setVisible(false);
      expect(mockTileset.show).toBe(false);

      layer.setVisible(true);
      expect(mockTileset.show).toBe(true);
    });
  });
});

// ── clampHeatmapOpacity tests ────────────────────────────────────────────────

describe('clampHeatmapOpacity', () => {
  it('should return value unchanged when within [0.3, 0.9]', () => {
    expect(clampHeatmapOpacity(0.5)).toBe(0.5);
    expect(clampHeatmapOpacity(0.3)).toBe(0.3);
    expect(clampHeatmapOpacity(0.9)).toBe(0.9);
  });

  it('should clamp values below 0.3 to 0.3', () => {
    expect(clampHeatmapOpacity(0)).toBe(0.3);
    expect(clampHeatmapOpacity(0.1)).toBe(0.3);
    expect(clampHeatmapOpacity(-1)).toBe(0.3);
  });

  it('should clamp values above 0.9 to 0.9', () => {
    expect(clampHeatmapOpacity(1.0)).toBe(0.9);
    expect(clampHeatmapOpacity(0.95)).toBe(0.9);
    expect(clampHeatmapOpacity(5)).toBe(0.9);
  });

  it('should export correct min/max constants', () => {
    expect(HEATMAP_OPACITY_MIN).toBe(0.3);
    expect(HEATMAP_OPACITY_MAX).toBe(0.9);
  });
});
