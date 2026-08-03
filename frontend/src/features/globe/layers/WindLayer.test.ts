import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LayerState } from '../types';
import type { GridCell } from '../../../types';

// Mock Cesium to avoid WebGL/ImageBitmap issues in jsdom
vi.mock('cesium', () => {
  const mockCartesian3 = { x: 0, y: 0, z: 0 };

  class MockBillboardCollection {
    add = vi.fn();
    removeAll = vi.fn();
    length = 0;
    constructor(_opts?: unknown) {}
  }

  class MockPolylineCollection {
    add = vi.fn();
    removeAll = vi.fn();
    length = 0;
    constructor(_opts?: unknown) {}
  }

  return {
    Cartesian3: {
      fromDegrees: vi.fn(() => mockCartesian3),
    },
    Cartesian2: class {
      constructor(public x = 0, public y = 0) {}
    },
    Color: {
      WHITE: { red: 1, green: 1, blue: 1, alpha: 1, withAlpha: vi.fn().mockReturnValue({ red: 1, green: 1, blue: 1, alpha: 0.9 }) },
      fromCssColorString: vi.fn(() => ({
        withAlpha: vi.fn().mockReturnValue({ red: 0.5, green: 0.5, blue: 0.5, alpha: 0.8 }),
      })),
    },
    BillboardCollection: MockBillboardCollection,
    PolylineCollection: MockPolylineCollection,
    Material: {
      fromType: vi.fn(() => ({})),
    },
    HorizontalOrigin: { CENTER: 0 },
    VerticalOrigin: { CENTER: 0 },
  };
});

// Import after mock
import { WindLayer } from './WindLayer';
import type { WindVisualizationMode, PressureLevel } from './WindLayer';

// ── Mock Helpers ─────────────────────────────────────────────────────────────

function createMockViewer() {
  return {
    scene: {
      primitives: {
        add: vi.fn(),
        remove: vi.fn().mockReturnValue(true),
      },
    },
  };
}

function createMockGridCells(count: number = 9): GridCell[] {
  const cells: GridCell[] = [];
  const gridSize = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      if (cells.length >= count) break;
      cells.push({
        lat: 20 + i * 0.25,
        lon: 75 + j * 0.25,
        node_idx: cells.length,
        rainfall: 10 + Math.random() * 30,
        temp_max: 30 + i * 2 + j * 1.5,
        temp_min: 22 + i * 1.5 + j,
        rainfall_uncertainty: 5,
        temp_max_uncertainty: 1.5,
        temp_min_uncertainty: 1.0,
      });
    }
  }
  return cells;
}

function createMockLayerState(overrides: Partial<LayerState> = {}): LayerState {
  return {
    gridCells: createMockGridCells(),
    variable: 'rainfall',
    region: 'western_ghats',
    forecastDay: 1,
    terrainExaggeration: 1,
    colormap: 'imd_rain',
    show3D: false,
    showWind: true,
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

// ── WindLayer Tests ──────────────────────────────────────────────────────────

describe('WindLayer — LayerPlugin interface', () => {
  let layer: WindLayer;
  let mockViewer: ReturnType<typeof createMockViewer>;

  beforeEach(() => {
    layer = new WindLayer();
    mockViewer = createMockViewer();
  });

  it('has correct id and priority', () => {
    expect(layer.id).toBe('wind');
    expect(layer.priority).toBe(25);
  });

  it('init stores the viewer reference without throwing', () => {
    expect(() => {
      layer.init(mockViewer as unknown as import('cesium').Viewer);
    }).not.toThrow();
  });

  it('update does nothing when viewer is not initialized', () => {
    const state = createMockLayerState();
    expect(() => layer.update(state)).not.toThrow();
  });

  it('update does nothing when showWind is false', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({ showWind: false });

    layer.update(state);

    expect(mockViewer.scene.primitives.add).not.toHaveBeenCalled();
  });

  it('update does nothing when gridCells is empty', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({ gridCells: [] });

    layer.update(state);

    expect(mockViewer.scene.primitives.add).not.toHaveBeenCalled();
  });

  it('update renders wind barbs when mode is barb and showWind is true', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    layer.setMode('barb');
    const state = createMockLayerState({ showWind: true });

    layer.update(state);

    // Should add a BillboardCollection primitive
    expect(mockViewer.scene.primitives.add).toHaveBeenCalled();
  });

  it('update renders streamlines when mode is streamline', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    layer.setMode('streamline');
    const state = createMockLayerState({ showWind: true });

    layer.update(state);

    // Should add a PolylineCollection primitive
    expect(mockViewer.scene.primitives.add).toHaveBeenCalled();
  });

  it('update clears previous primitives before re-rendering', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    layer.setMode('barb');
    const state = createMockLayerState({ showWind: true });

    layer.update(state);
    layer.update(state);

    // Remove should be called on second update to clear previous billboards
    expect(mockViewer.scene.primitives.remove).toHaveBeenCalled();
  });

  it('destroy removes all primitives', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    layer.setMode('barb');
    const state = createMockLayerState({ showWind: true });

    layer.update(state);
    layer.destroy();

    expect(mockViewer.scene.primitives.remove).toHaveBeenCalled();
  });

  it('destroy does not throw when called without prior init', () => {
    expect(() => layer.destroy()).not.toThrow();
  });
});

describe('WindLayer — Mode and Level Control', () => {
  let layer: WindLayer;

  beforeEach(() => {
    layer = new WindLayer();
  });

  it('defaults to barb mode', () => {
    expect(layer.mode).toBe('barb');
  });

  it('defaults to surface level', () => {
    expect(layer.level).toBe('surface');
  });

  it('setMode changes the visualization mode', () => {
    layer.setMode('streamline');
    expect(layer.mode).toBe('streamline');

    layer.setMode('particle');
    expect(layer.mode).toBe('particle');

    layer.setMode('barb');
    expect(layer.mode).toBe('barb');
  });

  it('setLevel changes the pressure level', () => {
    layer.setLevel('850hPa');
    expect(layer.level).toBe('850hPa');

    layer.setLevel('500hPa');
    expect(layer.level).toBe('500hPa');

    layer.setLevel('200hPa');
    expect(layer.level).toBe('200hPa');

    layer.setLevel('surface');
    expect(layer.level).toBe('surface');
  });

  it('availableLevels returns all four pressure levels', () => {
    const levels = WindLayer.availableLevels;
    expect(levels).toEqual(['surface', '850hPa', '500hPa', '200hPa']);
  });

  it('availableModes returns all three visualization modes', () => {
    const modes = WindLayer.availableModes;
    expect(modes).toEqual(['particle', 'barb', 'streamline']);
  });
});

describe('WindLayer — Rendering behavior with different levels', () => {
  let layer: WindLayer;
  let mockViewer: ReturnType<typeof createMockViewer>;

  beforeEach(() => {
    layer = new WindLayer();
    mockViewer = createMockViewer();
    layer.init(mockViewer as unknown as import('cesium').Viewer);
  });

  it('renders at surface level (default)', () => {
    layer.setLevel('surface');
    const state = createMockLayerState({ showWind: true });

    layer.update(state);

    expect(mockViewer.scene.primitives.add).toHaveBeenCalled();
  });

  it('renders at 850hPa level', () => {
    layer.setLevel('850hPa');
    const state = createMockLayerState({ showWind: true });

    layer.update(state);

    expect(mockViewer.scene.primitives.add).toHaveBeenCalled();
  });

  it('renders at 500hPa level', () => {
    layer.setLevel('500hPa');
    const state = createMockLayerState({ showWind: true });

    layer.update(state);

    expect(mockViewer.scene.primitives.add).toHaveBeenCalled();
  });

  it('renders at 200hPa level', () => {
    layer.setLevel('200hPa');
    const state = createMockLayerState({ showWind: true });

    layer.update(state);

    expect(mockViewer.scene.primitives.add).toHaveBeenCalled();
  });
});
