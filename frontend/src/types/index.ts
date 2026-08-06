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
   * - `real_data_regions`: regions with a normalized_*.nc present. A region absent
   *   here is served from synthetic grids and must not be presented as a forecast.
   */
  cache_backend?: string;
  persistence_connected?: boolean;
  real_data_regions?: string[];
}

// ── UI state types ─────────────────────────────────────────────────────────────

export type VariableId = 'rainfall' | 'temp_max' | 'temp_min';

export type RegionId =
  | 'western_ghats'
  | 'north_east_india'
  | 'indo_gangetic_plain'
  | 'central_india'
  | 'pilot';

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
