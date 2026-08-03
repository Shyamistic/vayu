import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  inferCloudCover,
  computeCloudAltitude,
  generateCloudSprite,
  VolumetricCloudsLayer,
} from './VolumetricCloudsLayer';
import type { LayerState } from '../types';
import type { GridCell } from '../../../types';

// ── Cloud Cover Inference Tests ──────────────────────────────────────────────

describe('VolumetricCloudsLayer — inferCloudCover', () => {
  it('returns 0 for clear conditions (no rain, large temp spread)', () => {
    const cell: GridCell = {
      lat: 20, lon: 75, node_idx: 0,
      rainfall: 0, temp_max: 38, temp_min: 22,
      rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    };
    expect(inferCloudCover(cell)).toBe(0);
  });

  it('returns high cloud cover for heavy rainfall (>20mm)', () => {
    const cell: GridCell = {
      lat: 20, lon: 75, node_idx: 0,
      rainfall: 50, temp_max: 30, temp_min: 25,
      rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    };
    const cover = inferCloudCover(cell);
    expect(cover).toBeGreaterThanOrEqual(70);
    expect(cover).toBeLessThanOrEqual(100);
  });

  it('returns moderate cloud cover for moderate rainfall (5-20mm)', () => {
    const cell: GridCell = {
      lat: 20, lon: 75, node_idx: 0,
      rainfall: 10, temp_max: 30, temp_min: 25,
      rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    };
    const cover = inferCloudCover(cell);
    expect(cover).toBeGreaterThanOrEqual(50);
    expect(cover).toBeLessThanOrEqual(80);
  });

  it('returns overcast (70%) for low temp spread with light rain', () => {
    const cell: GridCell = {
      lat: 20, lon: 75, node_idx: 0,
      rainfall: 2, temp_max: 28, temp_min: 25, // spread = 3°C
      rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    };
    expect(inferCloudCover(cell)).toBe(70);
  });

  it('always returns value in [0, 100] range', () => {
    // Test extreme values
    const extremeCells: GridCell[] = [
      { lat: 0, lon: 0, node_idx: 0, rainfall: 200, temp_max: 50, temp_min: 50, rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0 },
      { lat: 0, lon: 0, node_idx: 0, rainfall: 0, temp_max: -10, temp_min: -20, rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0 },
      { lat: 0, lon: 0, node_idx: 0, rainfall: 3, temp_max: 35, temp_min: 20, rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0 },
    ];

    for (const cell of extremeCells) {
      const cover = inferCloudCover(cell);
      expect(cover).toBeGreaterThanOrEqual(0);
      expect(cover).toBeLessThanOrEqual(100);
    }
  });

  it('opacity is proportional to cloud cover percentage', () => {
    // Heavier rain → higher cloud cover → higher opacity
    const lightRain: GridCell = {
      lat: 20, lon: 75, node_idx: 0,
      rainfall: 6, temp_max: 30, temp_min: 25,
      rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    };
    const heavyRain: GridCell = {
      lat: 20, lon: 75, node_idx: 0,
      rainfall: 40, temp_max: 30, temp_min: 25,
      rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    };
    expect(inferCloudCover(heavyRain)).toBeGreaterThan(inferCloudCover(lightRain));
  });
});

// ── Cloud Altitude Tests ─────────────────────────────────────────────────────

describe('VolumetricCloudsLayer — computeCloudAltitude', () => {
  it('returns altitude in valid range [2000, 8000] meters', () => {
    for (let i = 0; i < 50; i++) {
      const alt = computeCloudAltitude(80, 15);
      expect(alt).toBeGreaterThanOrEqual(2000);
      expect(alt).toBeLessThanOrEqual(8000);
    }
  });

  it('heavy rainfall produces lower altitude clouds (2000-4000m)', () => {
    for (let i = 0; i < 20; i++) {
      const alt = computeCloudAltitude(90, 25);
      expect(alt).toBeGreaterThanOrEqual(2000);
      expect(alt).toBeLessThanOrEqual(4000);
    }
  });

  it('moderate cover produces mid-level clouds (4000-6000m)', () => {
    for (let i = 0; i < 20; i++) {
      const alt = computeCloudAltitude(60, 3);
      expect(alt).toBeGreaterThanOrEqual(4000);
      expect(alt).toBeLessThanOrEqual(6000);
    }
  });

  it('light cover produces high altitude clouds (6000-8000m)', () => {
    for (let i = 0; i < 20; i++) {
      const alt = computeCloudAltitude(30, 0);
      expect(alt).toBeGreaterThanOrEqual(6000);
      expect(alt).toBeLessThanOrEqual(8000);
    }
  });
});

// ── VolumetricCloudsLayer Class Tests ────────────────────────────────────────

describe('VolumetricCloudsLayer — LayerPlugin interface', () => {
  let layer: VolumetricCloudsLayer;
  let mockBillboardCollection: {
    add: ReturnType<typeof vi.fn>;
    removeAll: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    length: number;
  };
  let mockViewer: {
    scene: {
      primitives: {
        add: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
      };
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    layer = new VolumetricCloudsLayer();

    mockBillboardCollection = {
      add: vi.fn(),
      removeAll: vi.fn(),
      get: vi.fn().mockReturnValue({ position: null }),
      length: 0,
    };

    mockViewer = {
      scene: {
        primitives: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      },
    };

    // Mock Cesium BillboardCollection constructor
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue({
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          createRadialGradient: vi.fn().mockReturnValue({
            addColorStop: vi.fn(),
          }),
          fillStyle: '',
          beginPath: vi.fn(),
          ellipse: vi.fn(),
          fill: vi.fn(),
        }),
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    layer.destroy();
  });

  it('has correct id and priority', () => {
    expect(layer.id).toBe('volumetric-clouds');
    expect(layer.priority).toBe(45);
  });

  it('does nothing when viewer is not initialized', () => {
    const state = createMockLayerState();
    expect(() => layer.update(state)).not.toThrow();
    expect(() => layer.destroy()).not.toThrow();
  });
});

// ── Cloud Cover to Opacity Proportionality Tests ─────────────────────────────

describe('VolumetricCloudsLayer — Opacity proportional to cloud cover (Req 59.2)', () => {
  it('0% cloud cover yields 0 opacity (clear sky)', () => {
    const clearCell: GridCell = {
      lat: 20, lon: 75, node_idx: 0,
      rainfall: 0, temp_max: 40, temp_min: 22, // large spread, no rain = clear
      rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    };
    const cover = inferCloudCover(clearCell);
    const opacity = cover / 100;
    expect(opacity).toBe(0);
  });

  it('100% cloud cover yields opacity close to 1.0 (overcast)', () => {
    const overcastCell: GridCell = {
      lat: 20, lon: 75, node_idx: 0,
      rainfall: 100, temp_max: 25, temp_min: 23,
      rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
    };
    const cover = inferCloudCover(overcastCell);
    const opacity = cover / 100;
    expect(opacity).toBeGreaterThanOrEqual(0.9);
    expect(opacity).toBeLessThanOrEqual(1.0);
  });

  it('opacity increases monotonically with increasing rainfall', () => {
    const rainfallLevels = [0, 2, 6, 15, 30, 60];
    const opacities = rainfallLevels.map(r => {
      const cell: GridCell = {
        lat: 20, lon: 75, node_idx: 0,
        rainfall: r, temp_max: 30, temp_min: 25,
        rainfall_uncertainty: 0, temp_max_uncertainty: 0, temp_min_uncertainty: 0,
      };
      return inferCloudCover(cell) / 100;
    });

    // Each opacity should be >= previous
    for (let i = 1; i < opacities.length; i++) {
      expect(opacities[i]).toBeGreaterThanOrEqual(opacities[i - 1]);
    }
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
