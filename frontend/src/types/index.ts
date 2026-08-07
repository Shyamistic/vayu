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

// ── Historical climatology (GET /api/climatology) ─────────────────────────────

/** One year's observed mean over the calendar window. */
export interface ClimatologyYear {
  year: number;
  value: number | null;
  anomaly: number | null;
  anomaly_percent: number | null;
  valid_days: number;
}

export interface ClimatologyResponse {
  region: string;
  variable: string;
  season: SeasonId | string;
  season_label: string;
  unit: string;
  summary: {
    mean: number | null;
    std: number | null;
    sem: number | null;
    ci95_low: number | null;
    ci95_high: number | null;
    median: number | null;
    min_value: number | null;
    min_year: number | null;
    max_value: number | null;
    max_year: number | null;
    n_years: number;
    year_first: number;
    year_last: number;
  };
  trend: {
    per_decade: number | null;
    unit: string;
    p_value: number | null;
    r_squared: number | null;
    significant: boolean;
  };
  integral: {
    volume_km3: number | null;
    area_km2: number | null;
    definition: string;
  };
  per_year: ClimatologyYear[];
  excluded_years: number[];
  provenance: Record<string, unknown>;
  lats?: (number | null)[];
  lons?: (number | null)[];
  cell_mean?: (number | null)[];
}

// ── Conditional distribution (GET /api/distribution) ──────────────────────────

/** A conditional density of the response at one predictor value. */
export interface DensityCurve {
  id: 'baseline' | 'scenario' | string;
  label: string;
  predictor_value: number | null;
  predictor_anomaly: number | null;
  mean: number | null;
  sigma: number | null;
  ci95_low: number | null;
  ci95_high: number | null;
  values: (number | null)[];
  density: (number | null)[];
}

/** P(R > threshold | predictor), with the tolerance-induced range. */
export interface ExceedanceProbability {
  threshold: number | null;
  threshold_tolerance: number | null;
  predictor_tolerance: number | null;
  baseline_probability: number | null;
  scenario_probability: number | null;
  probability_low: number | null;
  probability_high: number | null;
  probability_change: number | null;
  observed_frequency: number | null;
  observed_exceedances: number;
  observed_years: number;
  definition: string;
}

export interface DistributionResponse {
  region: string;
  season: SeasonId | string;
  season_label: string;
  predictor: string;
  response: string;
  predictor_unit: string;
  response_unit: string;
  delta_predictor: number | null;
  residual_sigma: number | null;
  curves: DensityCurve[];
  /** Observed values, so the Gaussian assumption can be inspected not trusted. */
  empirical: {
    histogram_edges: (number | null)[];
    histogram_counts: number[];
    values: (number | null)[];
    n: number;
  };
  exceedance: ExceedanceProbability | null;
  caveats: string[];
  provenance: Record<string, unknown>;
}

// ── Dual-baseline split (GET /api/baseline-comparison) ─────────────────────────

/** One half of the record, fitted independently. */
export interface BaselineEpochFit {
  id: 'older' | 'newer' | string;
  label: string;
  year_start: number;
  year_end: number;
  fit: RegressionFit;
  response_mean: number | null;
  predictor_mean: number | null;
  n_years: number;
}

export interface BaselineComparisonResponse {
  region: string;
  season: SeasonId | string;
  season_label: string;
  predictor: string;
  response: string;
  split_year: number;
  older: BaselineEpochFit;
  newer: BaselineEpochFit;
  difference: {
    slope_delta: number | null;
    slope_delta_se: number | null;
    slope_delta_ci95_low: number | null;
    slope_delta_ci95_high: number | null;
    slope_delta_p_value: number | null;
    slope_changed_significantly: boolean;
    slope_unit: string;
    response_mean_delta: number | null;
    response_mean_delta_percent: number | null;
    predictor_mean_delta: number | null;
    definition: string;
  };
  caveats: string[];
  provenance: Record<string, unknown>;
  lats?: (number | null)[];
  lons?: (number | null)[];
  cell_slope_delta?: (number | null)[];
}

// ── ERA5 independent validation (GET /api/era5-comparison) ────────────────────

/** Paired-sample agreement between our bundle and the reference. */
export interface Era5AgreementStats {
  n: number;
  observed_mean: number | null;
  reference_mean: number | null;
  /** Signed reference − observed: positive means ERA5 reads higher than ours. */
  bias: number | null;
  mae: number | null;
  rmse: number | null;
  pearson_r: number | null;
  pearson_p: number | null;
  r_squared: number | null;
  /** Rainfall only — two datasets can track day to day and still differ on totals. */
  observed_total?: number | null;
  reference_total?: number | null;
  total_ratio?: number | null;
}

export interface Era5ComparisonResponse {
  region: string;
  variable: 'rainfall' | 'tmax' | 'tmin' | string;
  unit: string;
  start_date: string;
  end_date: string;
  requested_lat: number | null;
  requested_lon: number | null;
  /** The cell we actually read, so the spatial-support mismatch is visible. */
  our_grid_cell: {
    cell_lat: number | null;
    cell_lon: number | null;
    flat_index: number;
    distance_from_request_km: number | null;
    denormalized: boolean;
    availability_masked: boolean;
    unit: string;
    n_days: number;
  };
  daily_stats: Era5AgreementStats;
  daily?: {
    dates: string[];
    observed: (number | null)[];
    reference: (number | null)[];
  };
  /**
   * Monthly aggregates. For rainfall these are the cleaner comparison: IMD's
   * rain-day is 0830–0830 IST while the archive aggregates 0000–2400, and that
   * offset moves rain between adjacent days without moving a monthly total.
   */
  monthly: {
    aggregation: 'sum' | 'mean' | string;
    /**
     * Unit of the monthly aggregate, which differs from the daily unit whenever
     * the series accumulates: a month of mm/day summed is mm.
     */
    unit: string;
    labels: string[];
    observed: (number | null)[];
    reference: (number | null)[];
    paired_days: number[];
    stats: Era5AgreementStats | null;
  };
  reference_point?: { lat: number | null; lon: number | null; label: string };
  caveats: string[];
  provenance: Record<string, unknown>;
}

// ── 30-day-in / 7-day-out summary (GET /api/forecast-summary) ─────────────────

export interface ForecastSummaryDay {
  lead_day: number;
  rainfall_mm: number | null;
  temp_max_c: number | null;
  temp_min_c: number | null;
  temp_mean_c: number | null;
  n_cells: number;
}

export interface ForecastSummaryResponse {
  region: string;
  anchor_date: string;
  season: SeasonId | string;
  season_label: string;
  input_window_days: number;
  forecast_days: number;
  per_day: ForecastSummaryDay[];
  aggregate: {
    rainfall_total_mm: number | null;
    rainfall_mean_mm_per_day: number | null;
    temp_max_mean_c: number | null;
    temp_min_mean_c: number | null;
    temp_mean_c: number | null;
    diurnal_range_c: number | null;
  };
  anomaly_vs_climatology: {
    delta_rainfall_mm_per_day: number | null;
    delta_rainfall_total_mm: number | null;
    delta_tmax_c: number | null;
    delta_tmin_c: number | null;
    delta_tmean_c: number | null;
    climatology: Record<string, { mean: number; unit: string; n_years: number } | null>;
    climatology_tmean_c: number | null;
  };
  provenance: Record<string, unknown>;
  computation_time_s: number;
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
  /** When both set, playback/step/slider are bounded to [rangeStart, rangeEnd]
   *  instead of the full 2010–2025 window. Null means "no range selected". */
  rangeStart: Date | null;
  rangeEnd: Date | null;
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
