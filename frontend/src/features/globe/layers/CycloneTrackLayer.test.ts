import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CycloneTrackLayer } from './CycloneTrackLayer';
import type { LayerState } from '../types';

// ── CycloneTrackLayer Class Tests ────────────────────────────────────────────

describe('CycloneTrackLayer — LayerPlugin interface', () => {
  let layer: CycloneTrackLayer;
  let mockViewer: {
    entities: {
      add: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    layer = new CycloneTrackLayer();
    mockViewer = {
      entities: {
        add: vi.fn().mockImplementation((opts) => opts),
        remove: vi.fn(),
      },
    };
  });

  it('has correct id and priority', () => {
    expect(layer.id).toBe('cyclone-track');
    expect(layer.priority).toBe(55);
  });

  it('init stores the viewer reference', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState();
    expect(() => layer.update(state)).not.toThrow();
  });

  it('update creates entities for track, cone, position, and metadata', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({
      selectedDate: new Date('2024-10-02T12:00:00Z'),
    });

    layer.update(state);

    // Should create:
    // - 12 track segment polylines (13 points - 1 = 12 segments)
    // - 13 track point markers
    // - 1 cone-of-uncertainty polygon
    // - 1 animated position billboard
    // - 1 metadata label
    // Total: 28 entities
    expect(mockViewer.entities.add).toHaveBeenCalledTimes(28);
  });

  it('update skips redundant redraws for same date', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const date = new Date('2024-10-02T12:00:00Z');
    const state = createMockLayerState({ selectedDate: date });

    layer.update(state);
    const firstCallCount = mockViewer.entities.add.mock.calls.length;

    layer.update(state); // Same date — should skip

    // No additional entities added
    expect(mockViewer.entities.add).toHaveBeenCalledTimes(firstCallCount);
  });

  it('update re-renders when date changes', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);

    const state1 = createMockLayerState({
      selectedDate: new Date('2024-10-02T00:00:00Z'),
    });
    const state2 = createMockLayerState({
      selectedDate: new Date('2024-10-03T00:00:00Z'),
    });

    layer.update(state1);
    const firstCallCount = mockViewer.entities.add.mock.calls.length;

    layer.update(state2);

    // Should have added new entities (after clearing previous ones)
    expect(mockViewer.entities.add.mock.calls.length).toBeGreaterThan(firstCallCount);
    // Should have removed previous entities
    expect(mockViewer.entities.remove).toHaveBeenCalled();
  });

  it('destroy removes all entities and clears state', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({
      selectedDate: new Date('2024-10-02T12:00:00Z'),
    });

    layer.update(state);
    layer.destroy();

    // Should remove all created entities
    expect(mockViewer.entities.remove).toHaveBeenCalled();
  });

  it('does nothing when viewer is not initialized', () => {
    const state = createMockLayerState();
    expect(() => layer.update(state)).not.toThrow();
    expect(() => layer.destroy()).not.toThrow();
  });

  it('interpolates position correctly for time between track points', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);

    // Set time midway between track points (halfway through Oct 2 at 06:00-12:00)
    const state = createMockLayerState({
      selectedDate: new Date('2024-10-02T09:00:00Z'),
    });

    layer.update(state);

    // The billboard entity should have been created (indicates position was interpolated)
    const billboardCalls = mockViewer.entities.add.mock.calls.filter(
      (call) => call[0]?.billboard !== undefined
    );
    expect(billboardCalls.length).toBe(1);
  });

  it('handles date before track start gracefully', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({
      selectedDate: new Date('2024-09-30T00:00:00Z'), // Before track starts
    });

    expect(() => layer.update(state)).not.toThrow();
    // Should still create entities — uses first track position
    expect(mockViewer.entities.add).toHaveBeenCalled();
  });

  it('handles date after track end gracefully', () => {
    layer.init(mockViewer as unknown as import('cesium').Viewer);
    const state = createMockLayerState({
      selectedDate: new Date('2024-10-10T00:00:00Z'), // After track ends
    });

    expect(() => layer.update(state)).not.toThrow();
    // Should still create entities — uses last track position
    expect(mockViewer.entities.add).toHaveBeenCalled();
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
    selectedDate: new Date('2024-10-02T12:00:00Z'),
    heatmapOpacity: 0.78,
    ...overrides,
  };
}
