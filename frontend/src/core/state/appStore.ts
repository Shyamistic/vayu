import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type {
  ViewMode,
  VariableId,
  RegionId,
  TimeState,
  ScenarioResponse,
  PredictionResponse,
} from '../../types';

// ── Feature toggle keys ──────────────────────────────────────────────────────

export type FeatureToggleKey =
  | 'showUncertainty'
  | 'showSplitScreen'
  | 'show3D'
  | 'showWind'
  | 'showContours'
  | 'showBoundaries'
  | 'inspectMode';

// ── AppStore interface ───────────────────────────────────────────────────────

export interface AppStore {
  // View state
  viewMode: ViewMode;
  selectedVariable: VariableId;
  selectedRegion: RegionId;
  forecastDay: number;
  timeState: TimeState;

  // Feature toggles
  showUncertainty: boolean;
  showSplitScreen: boolean;
  show3D: boolean;
  showWind: boolean;
  showContours: boolean;
  showBoundaries: boolean;
  inspectMode: boolean;

  // Active data
  activeScenario: ScenarioResponse | null;
  activePrediction: PredictionResponse | null;

  // Connection status (Req 30.1)
  connectionStatus: 'connected' | 'reconnecting' | 'offline';
  lastUpdated: Date | null;

  // Loading/error
  isLoading: boolean;
  error: string | null;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setVariable: (v: VariableId) => void;
  setRegion: (r: RegionId) => void;
  setForecastDay: (day: number) => void;
  setTimeState: (patch: Partial<TimeState>) => void;
  toggleFeature: (feature: FeatureToggleKey) => void;
  setActiveScenario: (scenario: ScenarioResponse | null) => void;
  setActivePrediction: (prediction: PredictionResponse | null) => void;
  setConnectionStatus: (status: 'connected' | 'reconnecting' | 'offline') => void;
  setLastUpdated: (date: Date | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

// ── Initial time state ───────────────────────────────────────────────────────

const INITIAL_TIME_STATE: TimeState = {
  selectedDate: new Date(2025, 5, 15), // 15 June 2025
  granularity: 'daily',
  isPlaying: false,
  playbackSpeed: 1,
  rangeStart: null,
  rangeEnd: null,
};

// ── Store creation ───────────────────────────────────────────────────────────

export const useAppStore = create<AppStore>()(
  devtools(
    subscribeWithSelector((set) => ({
      // View state defaults
      viewMode: 'prediction',
      selectedVariable: 'rainfall',
      selectedRegion: 'western_ghats',
      forecastDay: 1,
      timeState: INITIAL_TIME_STATE,

      // Feature toggle defaults
      showUncertainty: false,
      showSplitScreen: false,
      show3D: false,
      showWind: false,
      showContours: false,
      showBoundaries: false,
      inspectMode: false,

      // Active data defaults
      activeScenario: null,
      activePrediction: null,

      // Connection defaults
      connectionStatus: 'connected',
      lastUpdated: null,

      // Loading/error defaults
      isLoading: false,
      error: null,

      // Actions
      setViewMode: (mode) => set({ viewMode: mode }, false, 'setViewMode'),
      setVariable: (v) => set({ selectedVariable: v }, false, 'setVariable'),
      setRegion: (r) => set({ selectedRegion: r }, false, 'setRegion'),
      setForecastDay: (day) =>
        set({ forecastDay: Math.max(1, Math.min(7, day)) }, false, 'setForecastDay'),
      setTimeState: (patch) =>
        set(
          (state) => ({ timeState: { ...state.timeState, ...patch } }),
          false,
          'setTimeState',
        ),
      toggleFeature: (feature) =>
        set(
          (state) => ({ [feature]: !state[feature] }),
          false,
          `toggleFeature/${feature}`,
        ),
      setActiveScenario: (scenario) =>
        set({ activeScenario: scenario }, false, 'setActiveScenario'),
      setActivePrediction: (prediction) =>
        set({ activePrediction: prediction }, false, 'setActivePrediction'),
      setConnectionStatus: (status) =>
        set({ connectionStatus: status }, false, 'setConnectionStatus'),
      setLastUpdated: (date) => set({ lastUpdated: date }, false, 'setLastUpdated'),
      setLoading: (loading) => set({ isLoading: loading }, false, 'setLoading'),
      setError: (error) => set({ error }, false, 'setError'),
    })),
    { name: 'AppStore' },
  ),
);
