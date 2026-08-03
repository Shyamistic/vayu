import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LayerRegistry } from './LayerRegistry';
import type { LayerPlugin, LayerState } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockPlugin(id: string, priority: number): LayerPlugin {
  return {
    id,
    priority,
    init: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
  };
}

function createMockViewer() {
  // Minimal mock of Cesium.Viewer for testing registry lifecycle
  return {} as unknown as import('cesium').Viewer;
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
    heatmapOpacity: 0.78,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LayerRegistry', () => {
  let registry: LayerRegistry;

  beforeEach(() => {
    registry = new LayerRegistry();
  });

  describe('register/unregister', () => {
    it('registers a plugin and reports correct size', async () => {
      const plugin = createMockPlugin('heatmap', 10);
      await registry.register(plugin);

      expect(registry.has('heatmap')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('replaces an existing plugin with same id', async () => {
      const plugin1 = createMockPlugin('heatmap', 10);
      const plugin2 = createMockPlugin('heatmap', 20);

      await registry.register(plugin1);
      await registry.register(plugin2);

      expect(registry.size).toBe(1);
      expect(registry.get('heatmap')?.priority).toBe(20);
      expect(plugin1.destroy).toHaveBeenCalled();
    });

    it('unregisters a plugin and calls destroy', async () => {
      const plugin = createMockPlugin('wind', 30);
      await registry.register(plugin);
      await registry.unregister('wind');

      expect(registry.has('wind')).toBe(false);
      expect(registry.size).toBe(0);
      expect(plugin.destroy).toHaveBeenCalled();
    });

    it('unregister on unknown id does nothing', async () => {
      await registry.unregister('nonexistent'); // should not throw
      expect(registry.size).toBe(0);
    });
  });

  describe('getAll — priority ordering', () => {
    it('returns layers sorted by priority ascending', async () => {
      const p1 = createMockPlugin('boundary', 50);
      const p2 = createMockPlugin('heatmap', 10);
      const p3 = createMockPlugin('wind', 30);

      await registry.register(p1);
      await registry.register(p2);
      await registry.register(p3);

      const all = registry.getAll();
      expect(all.map((l) => l.id)).toEqual(['heatmap', 'wind', 'boundary']);
    });
  });

  describe('initAll', () => {
    it('calls init on all registered plugins with the viewer', async () => {
      const viewer = createMockViewer();
      const p1 = createMockPlugin('heatmap', 10);
      const p2 = createMockPlugin('contour', 20);

      await registry.register(p1);
      await registry.register(p2);
      await registry.initAll(viewer);

      expect(p1.init).toHaveBeenCalledWith(viewer);
      expect(p2.init).toHaveBeenCalledWith(viewer);
    });

    it('does not re-init already initialized layers', async () => {
      const viewer = createMockViewer();
      const plugin = createMockPlugin('heatmap', 10);

      await registry.register(plugin);
      await registry.initAll(viewer);
      await registry.initAll(viewer); // second call

      expect(plugin.init).toHaveBeenCalledTimes(1);
    });

    it('initializes late-registered plugins immediately when viewer is ready', async () => {
      const viewer = createMockViewer();
      await registry.initAll(viewer);

      const latePlugin = createMockPlugin('late', 99);
      await registry.register(latePlugin);

      expect(latePlugin.init).toHaveBeenCalledWith(viewer);
    });
  });

  describe('updateAll', () => {
    it('dispatches state to all initialized layers', async () => {
      const viewer = createMockViewer();
      const p1 = createMockPlugin('heatmap', 10);
      const p2 = createMockPlugin('wind', 20);

      await registry.register(p1);
      await registry.register(p2);
      await registry.initAll(viewer);

      const state = createMockState({ forecastDay: 3 });
      registry.updateAll(state);

      expect(p1.update).toHaveBeenCalledWith(state);
      expect(p2.update).toHaveBeenCalledWith(state);
    });

    it('skips uninitialized layers', async () => {
      const plugin = createMockPlugin('uninit', 10);
      await registry.register(plugin);

      // No initAll called — plugin should not get update
      registry.updateAll(createMockState());
      expect(plugin.update).not.toHaveBeenCalled();
    });
  });

  describe('destroyAll', () => {
    it('destroys all layers and clears the registry', async () => {
      const viewer = createMockViewer();
      const p1 = createMockPlugin('heatmap', 10);
      const p2 = createMockPlugin('wind', 20);

      await registry.register(p1);
      await registry.register(p2);
      await registry.initAll(viewer);

      registry.destroyAll();

      expect(p1.destroy).toHaveBeenCalled();
      expect(p2.destroy).toHaveBeenCalled();
      expect(registry.size).toBe(0);
    });
  });
});
