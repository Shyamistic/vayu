import { describe, it, expect, beforeEach } from 'vitest';
import { useDataStore } from './dataStore';
import type { PredictionResponse, ScenarioResponse, GridCell } from '../../types';

const mockPrediction: PredictionResponse = {
  request_date: '2025-06-15',
  lead_times: [1, 2, 3],
  grid_cells: [
    { lat: 10.0, lon: 76.0, node_idx: 0, rainfall: 25.5, temp_max: 32.1, temp_min: 24.3, rainfall_uncertainty: 3.0, temp_max_uncertainty: 1.2, temp_min_uncertainty: 0.8 },
  ],
  model_version: '1.0.0',
  input_data_timestamp: '2025-06-15T00:00:00Z',
  cached: false,
};

const mockScenario: ScenarioResponse = {
  scenario_type: 'temperature_offset',
  magnitude: 2.0,
  baseline: { temp_max: [32] },
  scenario: { temp_max: [34] },
  delta: { temp_max: [2] },
  hotspots: [],
  summary: {},
  clamped: false,
  computation_time_s: 0.5,
};

describe('dataStore', () => {
  beforeEach(() => {
    useDataStore.setState({
      predictionCache: new Map(),
      scenarioCache: new Map(),
      currentGridCells: [],
      health: null,
    });
  });

  it('should initialize with empty caches', () => {
    const state = useDataStore.getState();
    expect(state.predictionCache.size).toBe(0);
    expect(state.scenarioCache.size).toBe(0);
    expect(state.currentGridCells).toHaveLength(0);
    expect(state.health).toBeNull();
  });

  it('cachePrediction should store and retrieve predictions', () => {
    const key = '2025-06-15_western_ghats_1';
    useDataStore.getState().cachePrediction(key, mockPrediction);

    const entry = useDataStore.getState().getCachedPrediction(key);
    expect(entry).toBeDefined();
    expect(entry!.data.request_date).toBe('2025-06-15');
    expect(entry!.fetchedAt).toBeInstanceOf(Date);
  });

  it('cachePrediction should evict oldest when at capacity', () => {
    const store = useDataStore.getState();
    // Fill cache to capacity (50)
    for (let i = 0; i < 50; i++) {
      store.cachePrediction(`key_${i}`, mockPrediction);
    }
    expect(useDataStore.getState().predictionCache.size).toBe(50);

    // Adding one more should evict the oldest
    store.cachePrediction('key_new', mockPrediction);
    expect(useDataStore.getState().predictionCache.size).toBe(50);
    expect(useDataStore.getState().getCachedPrediction('key_0')).toBeUndefined();
    expect(useDataStore.getState().getCachedPrediction('key_new')).toBeDefined();
  });

  it('cacheScenario should store and retrieve scenarios', () => {
    const key = 'temperature_offset_2_western_ghats';
    useDataStore.getState().cacheScenario(key, mockScenario);

    const entry = useDataStore.getState().getCachedScenario(key);
    expect(entry).toBeDefined();
    expect(entry!.data.scenario_type).toBe('temperature_offset');
  });

  it('setCurrentGridCells should update current grid cells', () => {
    const cells: GridCell[] = [
      { lat: 10.0, lon: 76.0, node_idx: 0, rainfall: 25.5, temp_max: 32.1, temp_min: 24.3, rainfall_uncertainty: 3.0, temp_max_uncertainty: 1.2, temp_min_uncertainty: 0.8 },
    ];
    useDataStore.getState().setCurrentGridCells(cells);
    expect(useDataStore.getState().currentGridCells).toHaveLength(1);
    expect(useDataStore.getState().currentGridCells[0].rainfall).toBe(25.5);
  });

  it('clearCache should empty all caches', () => {
    useDataStore.getState().cachePrediction('key1', mockPrediction);
    useDataStore.getState().cacheScenario('key2', mockScenario);
    useDataStore.getState().setCurrentGridCells(mockPrediction.grid_cells);

    useDataStore.getState().clearCache();
    expect(useDataStore.getState().predictionCache.size).toBe(0);
    expect(useDataStore.getState().scenarioCache.size).toBe(0);
    expect(useDataStore.getState().currentGridCells).toHaveLength(0);
  });
});
