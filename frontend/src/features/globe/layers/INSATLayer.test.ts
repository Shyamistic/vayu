import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INSATLayer } from './INSATLayer';
import type { INSATChannel, INSATAnimationConfig } from './INSATLayer';
import type { LayerState } from '../types';

// ── Mock Cesium ──────────────────────────────────────────────────────────────

const mockImageryLayer = { name: 'mock-imagery-layer' };

const mockImageryLayers = {
  addImageryProvider: vi.fn(() => mockImageryLayer),
  remove: vi.fn(),
};

vi.mock('cesium', () => {
  class MockWebMapTileServiceImageryProvider {
    constructor(public options: Record<string, unknown>) {}
  }
  class MockGeographicTilingScheme {}
  class MockCredit {
    constructor(public text: string) {}
  }
  return {
    WebMapTileServiceImageryProvider: MockWebMapTileServiceImageryProvider,
    GeographicTilingScheme: MockGeographicTilingScheme,
    Rectangle: {
      fromDegrees: vi.fn(() => ({})),
    },
    Credit: MockCredit,
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockViewer() {
  return {
    imageryLayers: mockImageryLayers,
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
    gibsDate: '2025-06-15',
    selectedDate: new Date(2025, 5, 15),
    heatmapOpacity: 0.6,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('INSATLayer', () => {
  let layer: INSATLayer;
  let viewer: ReturnType<typeof createMockViewer>;

  beforeEach(() => {
    layer = new INSATLayer();
    viewer = createMockViewer();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    layer.destroy();
    vi.useRealTimers();
  });

  describe('init', () => {
    it('should have correct id and priority', () => {
      expect(layer.id).toBe('insat-imagery');
      expect(layer.priority).toBe(15);
    });

    it('should store viewer reference on init', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      // After init, update should work without errors
      expect(() => layer.update(createMockState())).not.toThrow();
    });
  });

  describe('update', () => {
    it('should load imagery when update is called', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.update(createMockState({ gibsDate: '2025-07-01' }));

      // Should add imagery provider (GIBS fallback since INSAT unavailable)
      expect(mockImageryLayers.addImageryProvider).toHaveBeenCalled();
    });

    it('should use GIBS fallback since INSAT is not available', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.update(createMockState());

      expect(layer.isUsingFallback()).toBe(true);
    });

    it('should be a no-op when viewer is null', () => {
      // No init called
      expect(() => layer.update(createMockState())).not.toThrow();
    });

    it('should remove previous imagery layer before adding new one', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.update(createMockState({ gibsDate: '2025-06-01' }));
      layer.update(createMockState({ gibsDate: '2025-06-02' }));

      // First call adds, second call should remove old + add new
      expect(mockImageryLayers.remove).toHaveBeenCalledWith(mockImageryLayer, true);
    });
  });

  describe('channel selection', () => {
    it('should default to COLOR channel', () => {
      expect(layer.getChannel()).toBe('COLOR');
    });

    it('should allow setting channel to VIS, IR, WV, COLOR', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);

      const channels: INSATChannel[] = ['VIS', 'IR', 'WV', 'COLOR'];
      for (const ch of channels) {
        layer.setChannel(ch);
        expect(layer.getChannel()).toBe(ch);
      }
    });

    it('should reload imagery when channel changes', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.update(createMockState());

      vi.clearAllMocks();
      layer.setChannel('IR');

      expect(mockImageryLayers.addImageryProvider).toHaveBeenCalled();
    });
  });

  describe('animation', () => {
    it('should start animation with default config', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation();

      expect(layer.isPlaying()).toBe(true);
      expect(layer.getTotalFrames()).toBeGreaterThan(0);
      expect(layer.getCurrentFrameIndex()).toBe(0);
    });

    it('should respect custom fps (clamped 1-10)', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation({ fps: 15 }); // Should be clamped to 10

      expect(layer.isPlaying()).toBe(true);
    });

    it('should advance frames on interval tick', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation({ fps: 2, hoursBack: 6 });

      const initialIndex = layer.getCurrentFrameIndex();

      // Advance one frame (500ms for 2 fps)
      vi.advanceTimersByTime(500);

      expect(layer.getCurrentFrameIndex()).toBe(initialIndex + 1);
    });

    it('should loop when reaching end of frames', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation({ fps: 10, hoursBack: 1, loop: true });

      const totalFrames = layer.getTotalFrames();

      // Advance past all frames
      vi.advanceTimersByTime((totalFrames + 1) * 100);

      // Should have looped back
      expect(layer.getCurrentFrameIndex()).toBeLessThan(totalFrames);
      expect(layer.isPlaying()).toBe(true);
    });

    it('should stop when reaching end without loop', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation({ fps: 10, hoursBack: 1, loop: false });

      const totalFrames = layer.getTotalFrames();

      // Advance past all frames
      vi.advanceTimersByTime((totalFrames + 1) * 100);

      expect(layer.isPlaying()).toBe(false);
    });

    it('should stop animation on stopAnimation()', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation();

      expect(layer.isPlaying()).toBe(true);
      layer.stopAnimation();
      expect(layer.isPlaying()).toBe(false);
    });

    it('should generate correct number of frames for 6-hour window', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation({ hoursBack: 6 });

      // 6 hours / 30 min interval = 12 frames + 1 (current) = 13
      expect(layer.getTotalFrames()).toBe(13);
    });

    it('should update fps dynamically', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation({ fps: 2 });

      expect(layer.isPlaying()).toBe(true);
      layer.setAnimationFps(5);
      expect(layer.isPlaying()).toBe(true);
    });

    it('should rebuild animation frames when channel changes during playback', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation({ fps: 4 });

      expect(layer.isPlaying()).toBe(true);
      layer.setChannel('WV');

      // Animation should restart with new channel
      expect(layer.isPlaying()).toBe(true);
    });
  });

  describe('acquisition timestamp', () => {
    it('should return null before any imagery is loaded', () => {
      expect(layer.getAcquisitionTimestamp()).toBeNull();
    });

    it('should return a timestamp after imagery is loaded', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.update(createMockState({ gibsDate: '2025-06-15' }));

      const timestamp = layer.getAcquisitionTimestamp();
      expect(timestamp).toBeInstanceOf(Date);
    });

    it('should update timestamp during animation', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation({ fps: 2, hoursBack: 2 });

      vi.advanceTimersByTime(500); // Advance one frame

      const timestamp = layer.getAcquisitionTimestamp();
      expect(timestamp).toBeInstanceOf(Date);
    });
  });

  describe('fallback behavior', () => {
    it('should indicate fallback is active (INSAT unavailable)', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.update(createMockState());

      expect(layer.isUsingFallback()).toBe(true);
    });

    it('should log info when using GIBS fallback', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.update(createMockState());

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('NASA GIBS VIIRS/MODIS as fallback'),
      );
      infoSpy.mockRestore();
    });
  });

  describe('destroy', () => {
    it('should stop animation and remove imagery on destroy', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.startAnimation();
      layer.update(createMockState());

      layer.destroy();

      expect(layer.isPlaying()).toBe(false);
      expect(layer.getAcquisitionTimestamp()).toBeNull();
      expect(mockImageryLayers.remove).toHaveBeenCalled();
    });

    it('should be safe to call destroy without init', () => {
      expect(() => layer.destroy()).not.toThrow();
    });

    it('should be safe to call destroy multiple times', () => {
      layer.init(viewer as unknown as import('cesium').Viewer);
      layer.update(createMockState());
      layer.destroy();
      expect(() => layer.destroy()).not.toThrow();
    });
  });
});
