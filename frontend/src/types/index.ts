/**
 * VAYU TypeScript type definitions.
 *
 * Matches the Pydantic response models from backend/main.py.
 */

// ── Prediction types ─────────────────────────────────────────────────────────

export interface GridCell {
  lat: number;
  lon: number;
  node_idx: number;
  rainfall: number;
  temp_max: number;
  temp_min: number;
  rainfall_uncertainty: number;
  temp_max_uncertainty: number;
  temp_min_uncertainty: number;
}

export interface PredictionResponse {
  request_date: string;
  lead_times: number[];
  grid_cells: GridCell[];
  model_version: string;
  input_data_timestamp: string;
  cached: boolean;
}

// ── Scenario types ────────────────────────────────────────────────────────────

export type ScenarioTypeId =
  | 'temperature_offset'
  | 'rainfall_scaling'
  | 'monsoon_delay'
  | 'sst_anomaly';

export interface ScenarioRequest {
  scenario_type: ScenarioTypeId;
  magnitude: number;
  target_region?: string;
  target_season?: string;
}

export interface Hotspot {
  node_idx: number;
  delta_value: number;
  percentile_rank: number;
}

export interface ScenarioVariableSummary {
  avg_delta: number;
  max_delta: number;
  avg_pct_change: number;
  affected_cells: number;
}

export interface ScenarioResponse {
  scenario_type: ScenarioTypeId;
  magnitude: number;
  baseline: Record<string, number[]>;
  scenario: Record<string, number[]>;
  delta: Record<string, number[]>;
  hotspots: Hotspot[];
  summary: Record<string, ScenarioVariableSummary>;
  clamped: boolean;
  clamp_message?: string;
  computation_time_s: number;
}

// ── Metrics types ─────────────────────────────────────────────────────────────

export interface MetricsResponse {
  variable: string;
  region: string;
  eval_period: string;
  r2_score: number;
  rmse: number;
  mae: number;
  skill_score: number;
  source_model?: string;
  lead_time?: string;
  denormalized?: boolean;
}

// ── Historical types ──────────────────────────────────────────────────────────

export interface HistoricalRecord {
  date: string;
  lat: number;
  lon: number;
  variable: string;
  value: number;
}

// ── Health types ──────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  model_loaded: boolean;
  model_version: string;
  last_prediction_timestamp: string | null;
  uptime_seconds: number;
  device: string;
}

// ── UI state types ─────────────────────────────────────────────────────────────

export type VariableId = 'rainfall' | 'temp_max' | 'temp_min';

export type RegionId =
  | 'western_ghats'
  | 'north_east_india'
  | 'indo_gangetic_plain'
  | 'central_india'
  | 'pilot';

export type ViewMode = 'prediction' | 'historical' | 'scenario' | 'metrics';

export interface TimeState {
  selectedDate: Date;
  granularity: 'daily' | 'monthly' | 'yearly';
  isPlaying: boolean;
  playbackSpeed: number; // 0.5x to 4x
}

export interface AppState {
  viewMode: ViewMode;
  selectedVariable: VariableId;
  selectedRegion: RegionId;
  timeState: TimeState;
  showUncertainty: boolean;
  showSplitScreen: boolean;
  activeScenario: ScenarioResponse | null;
  activePrediction: PredictionResponse | null;
  isLoading: boolean;
  error: string | null;
}
