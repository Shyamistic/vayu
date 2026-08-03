import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  PredictionResponse,
  ScenarioResponse,
  GridCell,
  HealthResponse,
} from '../../types';

// ── Cache entry types ────────────────────────────────────────────────────────

export interface PredictionCacheEntry {
  key: string; // `${date}_${region}_${forecastDay}`
  data: PredictionResponse;
  fetchedAt: Date;
}

export interface ScenarioCacheEntry {
  key: string; // `${scenarioType}_${magnitude}_${region}`
  data: ScenarioResponse;
  computedAt: Date;
}

// ── DataStore interface ──────────────────────────────────────────────────────

export interface DataStore {
  // Prediction cache
  predictionCache: Map<string, PredictionCacheEntry>;
  currentGridCells: GridCell[];

  // Scenario cache
  scenarioCache: Map<string, ScenarioCacheEntry>;

  // Health status from backend
  health: HealthResponse | null;

  // Actions
  cachePrediction: (key: string, data: PredictionResponse) => void;
  getCachedPrediction: (key: string) => PredictionCacheEntry | undefined;
  setCurrentGridCells: (cells: GridCell[]) => void;
  cacheScenario: (key: string, data: ScenarioResponse) => void;
  getCachedScenario: (key: string) => ScenarioCacheEntry | undefined;
  setHealth: (health: HealthResponse | null) => void;
  clearCache: () => void;
}

// ── Max cache size ───────────────────────────────────────────────────────────

const MAX_PREDICTION_CACHE = 50;
const MAX_SCENARIO_CACHE = 20;

// ── Store creation ───────────────────────────────────────────────────────────

export const useDataStore = create<DataStore>()(
  devtools(
    (set, get) => ({
      // Defaults
      predictionCache: new Map(),
      currentGridCells: [],
      scenarioCache: new Map(),
      health: null,

      // Actions
      cachePrediction: (key, data) =>
        set(
          (state) => {
            const cache = new Map(state.predictionCache);
            // Evict oldest entry if at capacity
            if (cache.size >= MAX_PREDICTION_CACHE) {
              const oldestKey = cache.keys().next().value;
              if (oldestKey !== undefined) {
                cache.delete(oldestKey);
              }
            }
            cache.set(key, { key, data, fetchedAt: new Date() });
            return { predictionCache: cache };
          },
          false,
          'cachePrediction',
        ),

      getCachedPrediction: (key) => {
        return get().predictionCache.get(key);
      },

      setCurrentGridCells: (cells) =>
        set({ currentGridCells: cells }, false, 'setCurrentGridCells'),

      cacheScenario: (key, data) =>
        set(
          (state) => {
            const cache = new Map(state.scenarioCache);
            // Evict oldest entry if at capacity
            if (cache.size >= MAX_SCENARIO_CACHE) {
              const oldestKey = cache.keys().next().value;
              if (oldestKey !== undefined) {
                cache.delete(oldestKey);
              }
            }
            cache.set(key, { key, data, computedAt: new Date() });
            return { scenarioCache: cache };
          },
          false,
          'cacheScenario',
        ),

      getCachedScenario: (key) => {
        return get().scenarioCache.get(key);
      },

      setHealth: (health) => set({ health }, false, 'setHealth'),

      clearCache: () =>
        set(
          {
            predictionCache: new Map(),
            scenarioCache: new Map(),
            currentGridCells: [],
          },
          false,
          'clearCache',
        ),
    }),
    { name: 'DataStore' },
  ),
);
