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
  | 'sst_anomaly'
  | 'urbanization_change'
  | 'deforestation_impact';

export interface ScenarioRequest {
  scenario_type: ScenarioTypeId;
  magnitude: number;
  target_region?: string;
  target_season?: string;
}

/**
 * A single scenario in a chained compound scenario.
 */
export interface ChainedScenario {
  id: string; // unique ID for this step
  scenario_type: ScenarioTypeId;
  magnitude: number;
  label?: string; // optional user-defined label
}

/**
 * Request for running multiple chained scenarios (compound effects).
 * The backend runs them sequentially, each using the previous output as its baseline.
 */
export interface CompoundScenarioRequest {
  scenarios: ChainedScenario[];
  target_region?: string;
  target_season?: string;
}

/**
 * Extended ScenarioResponse that carries the anomaly delta arrays
 * needed for rendering anomaly maps.
 */
export interface ScenarioResponseWithAnomaly extends ScenarioResponse {
  anomaly_map: Record<string, number[]>; // same as delta; alias for clarity
  grid_lats: number[];
  grid_lons: number[];
}

// ── Empirical sensitivity (dR/dT) ─────────────────────────────────────────────

export type PredictorId = 'tmax' | 'tmin' | 'sst' | 'lst';
export type SeasonId = 'annual' | 'jjas' | 'mam' | 'on' | 'djf';

/** OLS diagnostics for a response-on-driver fit over the observed record. */
export interface RegressionFit {
  slope: number | null;
  intercept: number | null;
  r_squared: number | null;
  p_value: number | null;
  std_err: number | null;
  ci95_low: number | null;
  ci95_high: number | null;
  n: number;
  predictor: string;
  response: string;
  predictor_unit: string;
  response_unit: string;
  slope_unit: string;
  predictor_climatology: number | null;
  response_climatology: number | null;
  slope_percent_per_unit: number | null;
  significant: boolean;
}

/** One year in the regression scatter. */
export interface SensitivityPoint {
  year: number;
  predictor_value: number | null;
  predictor_anomaly: number | null;
  response_value: number | null;
  fitted_value: number | null;
  residual: number | null;
  valid_days: number;
}

export interface SensitivityResponse {
  region: string;
  season: SeasonId | string;
  season_label: string;
  fit: RegressionFit;
  points: SensitivityPoint[];
  excluded_years: number[];
  provenance: Record<string, unknown>;
  lats?: number[];
  lons?: number[];
  cell_slope?: (number | null)[];
  cell_std_err?: (number | null)[];
  cell_r_squared?: (number | null)[];
  cell_p_value?: (number | null)[];
  cell_baseline?: (number | null)[];
}

/** Past/current/future bar in the before-after timeline. */
export interface EpochSummary {
  id: 'past' | 'current' | 'future' | string;
  label: string;
  year_start: number | null;
  year_end: number | null;
  value: number | null;
  uncertainty: number | null;
  uncertainty_kind: 'observed_sem' | 'regression_ci' | 'none';
  /** True for measured epochs, false for the projected one. */
  observed: boolean;
  delta_vs_current: number | null;
}

export interface WhatIfHotspot {
  node_idx: number;
  lat: number;
  lon: number;
  delta_value: number | null;
  delta_percent: number | null;
  significant: boolean;
  percentile_rank: number;
  selection_basis: string;
}

export interface WhatIfRequest {
  region: string;
  predictor: PredictorId;
  response?: string;
  delta: number;
  season: SeasonId;
  window_start?: string;
  window_end?: string;
  start_year?: number;
  end_year?: number;
  past_start_year?: number;
  past_end_year?: number;
  current_start_year?: number;
  current_end_year?: number;
  include_cells?: boolean;
}

export interface WhatIfResponse {
  region: string;
  season: string;
  season_label: string;
  delta_predictor: number | null;
  fit: RegressionFit;
  regional: {
    baseline: number | null;
    scenario: number | null;
    delta: number | null;
    delta_percent: number | null;
    delta_ci95_low: number | null;
    delta_ci95_high: number | null;
    unit: string;
  };
  integral: {
    baseline_volume_km3: number | null;
    delta_volume_km3: number | null;
    area_km2: number | null;
    definition: string;
  };
  epochs: EpochSummary[];
  distribution: {
    cells_wetter: number;
    cells_drier: number;
    cells_significant: number;
    cells_total: number;
    clamped_cells: number;
  };
  hotspots: WhatIfHotspot[];
  /** Plain-language limits of the result, surfaced in the UI rather than buried. */
  caveats: string[];
  provenance: Record<string, unknown>;
  scatter: SensitivityPoint[];
  excluded_years: number[];
  computation_time_s: number;
  lats?: number[];
  lons?: number[];
  cell_baseline?: (number | null)[];
  cell_scenario?: (number | null)[];
  cell_delta?: (number | null)[];
  cell_delta_percent?: (number | null)[];
  cell_delta_uncertainty?: (number | null)[];
  cell_significant?: boolean[];
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

// ── IoT sensor types ─────────────────────────────────────────────────────────

export type IoTStationStatus = 'online' | 'low_battery' | 'offline';

export interface SensorReading {
  temperature_c: number | null;
  humidity_pct: number | null;
  pressure_hpa: number | null;
  light_lux: number | null;
  soil_moisture_pct: number | null;
  rain_detected: boolean | null;
  wind_speed_ms: number | null;
  wind_gust_ms: number | null;
  water_level_cm: number | null;
}

export interface PowerStatus {
  battery_v: number | null;
  solar_v: number | null;
  charging_ma: number | null;
}

export interface IoTStation {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  description?: string | null;
  last_seen: string | null;
  status: IoTStationStatus;
  sensors: SensorReading | null;
  power: PowerStatus | null;
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
  /**
   * Degradation reporting. Optional because older backend deployments do not
   * send these fields; treat `undefined` as "unknown", never as "fine".
   *
   * - `cache_backend`: 'redis' | 'in-process' | 'none'
   * - `persistence_connected`: false on the lean profile, which runs no PostgreSQL
   * - `real_data_regions`: regions with a normalized_*.nc present, i.e. backed by
   *   a real trained model checkpoint rather than mock/synthetic data. A region
   *   absent here must not be presented as a forecast.
   */
  cache_backend?: string;
  persistence_connected?: boolean;
  real_data_regions?: RegionId[];
}

// ── UI state types ─────────────────────────────────────────────────────────────

export type VariableId = 'rainfall' | 'temp_max' | 'temp_min';

export type RegionId =
  | 'western_ghats'
  | 'north_east_india'
  | 'indo_gangetic_plain'
  | 'central_india'
  | 'full_india';

export type ViewMode =
  | 'prediction' | 'historical' | 'scenario' | 'metrics'
  | 'agriculture' | 'environment' | 'case-study'
  // Categories added when the previously unmounted `features/` panels were wired
  // in. See features/FeaturePanels.tsx.
  | 'analysis' | 'sectors' | 'model-lab' | 'collaborate';

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
  forecastDay: number;         // 1–7: which T+N day to display on the globe
  timeState: TimeState;
  showUncertainty: boolean;
  showSplitScreen: boolean;
  activeScenario: ScenarioResponse | null;
  activePrediction: PredictionResponse | null;
  isLoading: boolean;
  error: string | null;
}
