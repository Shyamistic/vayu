import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  rainfallToDBZ,
  getRadarColor,
  computeSweepAlpha,
  NWS_RADAR_COLOR_TABLE,
  RadarSimLayer,
} from './RadarSimLayer';
import type { LayerState } from '../types';

// ── rainfallToDBZ Tests ──────────────────────────────────────────────────────

describe('rainfallToDBZ', () => {
  it('returns 0 for zero rainfall', () => {
    expect(rainfallToDBZ(0)).toBe(0);
  });

  it('returns 0 for negative rainfall', () => {
    expect(rainfallToDBZ(-5)).toBe(0);
  });

  it('computes correct dBZ for 1 mm/hr (Z=200, dBZ≈23)', () => {
    // Z = 200 * 1^1.6 = 200
    // dBZ = 10 * log10(200) ≈ 23.01
    const result = rainfallToDBZ(1);
    expect(result).toBeCloseTo(23.01, 1);
  });

  it('computes correct dBZ for 10 mm/hr', () => {
    // Z = 200 * 10^1.6 = 200 * 39.81 = 7962
    // dBZ = 10 * log10(7962) ≈ 39.01
    const result = rainfallToDBZ(10);
    expect(result).toBeCloseTo(39.01, 0);
  });

  it('computes correct dBZ for 50 mm/hr (heavy rain)', () => {
    // Z = 200 * 50^1.6 ≈ 200 * 524.1 ≈ 104,826
    // dBZ = 10 * log10(104826) ≈ 50.2
    const result = rainfallToDBZ(50);
    expect(result).toBeCloseTo(50.19, 0);
  });

  it('clamps to 75 for extremely high rainfall', () => {
    // Very high values should be clamped
    const result = rainfallToDBZ(1000);
    expect(result).toBeLessThanOrEqual(75);
  });

  it('returns value within [0, 75] for any positive rainfall', () => {
    const testRates = [0.1, 0.5, 1, 5, 10, 25, 50, 100, 200, 500];
    for (const rate of testRates) {
      const dbz = rainfallToDBZ(rate);
      expect(dbz).toBeGreaterThanOrEqual(0);
      expect(dbz).toBeLessThanOrEqual(75);
    }
  });
});

// ── getRadarColor Tests ──────────────────────────────────────────────────────

describe('getRadarColor', () => {
  it('returns null for dBZ below minimum threshold (5)', () => {
    expect(getRadarColor(0)).toBeNull();
    expect(getRadarColor(3)).toBeNull();
    expect(getRadarColor(4.9)).toBeNull();
  });

  it('returns cyan for 5 dBZ (light drizzle)', () => {
    const color = getRadarColor(5);
    expect(color).toEqual([4, 233, 231]);
  });

  it('returns green for 20 dBZ (moderate)', () => {
    const color = getRadarColor(20);
    expect(color).toEqual([2, 253, 2]);
  });

  it('returns red for 50 dBZ (intense)', () => {
    const color = getRadarColor(50);
    expect(color).toEqual([253, 0, 0]);
  });

  it('returns magenta for 65+ dBZ (extreme)', () => {
    const color = getRadarColor(65);
    expect(color).toEqual([248, 0, 253]);
  });

  it('returns purple for 70+ dBZ', () => {
    const color = getRadarColor(70);
    expect(color).toEqual([152, 84, 198]);
  });

  it('returns a valid color array for all dBZ values above threshold', () => {
    for (let dbz = 5; dbz <= 75; dbz += 5) {
      const color = getRadarColor(dbz);
      expect(color).not.toBeNull();
      expect(color).toHaveLength(3);
      expect(color![0]).toBeGreaterThanOrEqual(0);
      expect(color![0]).toBeLessThanOrEqual(255);
      expect(color![1]).toBeGreaterThanOrEqual(0);
      expect(color![1]).toBeLessThanOrEqual(255);
      expect(color![2]).toBeGreaterThanOrEqual(0);
      expect(color![2]).toBeLessThanOrEqual(255);
    }
  });
});

// ── NWS_RADAR_COLOR_TABLE Tests ──────────────────────────────────────────────

describe('NWS_RADAR_COLOR_TABLE', () => {
  it('has entries sorted by ascending minDBZ', () => {
    for (let i = 1; i < NWS_RADAR_COLOR_TABLE.length; i++) {
      expect(NWS_RADAR_COLOR_TABLE[i].minDBZ).toBeGreaterThan(
        NWS_RADAR_COLOR_TABLE[i - 1].minDBZ
      );
    }
  });

  it('covers range from 5 to 70 dBZ', () => {
    expect(NWS_RADAR_COLOR_TABLE[0].minDBZ).toBe(5);
    expect(NWS_RADAR_COLOR_TABLE[NWS_RADAR_COLOR_TABLE.length - 1].minDBZ).toBe(70);
  });

  it('has 14 color entries', () => {
    expect(NWS_RADAR_COLOR_TABLE).toHaveLength(14);
  });
});

// ── computeSweepAlpha Tests ──────────────────────────────────────────────────

describe('computeSweepAlpha', () => {
  it('returns value between 0.4 and 1.0', () => {
    const angles = [0, 45, 90, 135, 180, 225, 270, 315, 360];
    for (const angle of angles) {
      const alpha = computeSweepAlpha(80, 20, 78, 18, angle);
      expect(alpha).toBeGreaterThanOrEqual(0.4);
      expect(alpha).toBeLessThanOrEqual(1.0);
    }
  });

  it('returns high alpha for cells just swept', () => {
    // Cell at angle ~0 from center, sweep at ~0 degrees
    const alpha = computeSweepAlpha(80, 18, 78, 18, 0);
    expect(alpha).toBeGreaterThan(0.8);
  });

  it('returns lower alpha for cells far from sweep line', () => {
    // Cell at angle ~0 from center, sweep far away at 300 degrees
    const alpha = computeSweepAlpha(80, 18, 78, 18, 300);
    expect(alpha).toBeLessThan(0.7);
  });
});

// ── RadarSimLayer Class Tests ────────────────────────────────────────────────

describe('RadarSimLayer — LayerPlugin interface', () => {
  let layer: RadarSimLayer;
  let mockViewer: {
    imageryLayers: {
      addImageryProvider: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    layer = new RadarSimLayer();
    mockViewer = {
      imageryLayers: {
        addImageryProvider: vi.fn().mockReturnValue({ alpha: 1.0 }),
        remove: vi.fn(),
      },
    };

    // Mock requestAnimationFrame
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      // Don't actually call the callback to prevent infinite loops in tests
      return 1;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    layer.destroy();
    vi.restoreAllMocks();
  });

  it('has correct id and priority', () => {
    expect(layer.id).toBe('radar-sim');
    expect(layer.priority).toBe(12);
  });

  it('init stores the viewer reference without error', () => {
    expect(() => {
      layer.init(mockViewer as unknown as import('cesium').Viewer);
    }).not.toThrow();
  });

  it('update does nothing when viewer is not initialized', () => {
    const state = createMockLayerState();
    expect(() => layer.update(state)).not.toThrow();
  });

  it('update clears layer when gridCells is empty', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({ gridCells: [] });
    layer.update(state);
    // Should not add imagery when no data
    expect(mockViewer.imageryLayers.addImageryProvider).not.toHaveBeenCalled();
  });

  it('update clears layer when variable is not rainfall', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({
      variable: 'temp_max',
      gridCells: [
        { lat: 20, lon: 78, node_idx: 0, rainfall: 10, temp_max: 35, temp_min: 25, rainfall_uncertainty: 1, temp_max_uncertainty: 1, temp_min_uncertainty: 1 },
      ],
    });
    layer.update(state);
    expect(mockViewer.imageryLayers.addImageryProvider).not.toHaveBeenCalled();
  });

  it('destroy does not throw when viewer is null', () => {
    expect(() => layer.destroy()).not.toThrow();
  });

  it('destroy cleans up after initialization', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({
      gridCells: [
        { lat: 20, lon: 78, node_idx: 0, rainfall: 10, temp_max: 35, temp_min: 25, rainfall_uncertainty: 1, temp_max_uncertainty: 1, temp_min_uncertainty: 1 },
      ],
    });
    layer.update(state);
    expect(() => layer.destroy()).not.toThrow();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockLayerState(overrides: Partial<LayerState> = {}): LayerState {
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
    heatmapOpacity: 0.78,
    ...overrides,
  };
}
