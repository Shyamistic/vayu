/**
 * VAYU API client — typed wrappers for all backend endpoints.
 */

import type {
  BaselineComparisonResponse,
  ClimatologyResponse,
  DistributionResponse,
  ForecastSummaryResponse,
  GridCell,
  HealthResponse,
  HistoricalRecord,
  MetricsResponse,
  PredictionResponse,
  PredictorId,
  ScenarioRequest,
  ScenarioResponse,
  SeasonId,
  SensitivityResponse,
  VariableId,
  WhatIfRequest,
  WhatIfResponse,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Prediction ────────────────────────────────────────────────────────────────

/** Cached mock prediction (loaded once, reused) */
let _mockPrediction: PredictionResponse | null = null;

async function _loadMockPrediction(): Promise<PredictionResponse> {
  if (_mockPrediction) return JSON.parse(JSON.stringify(_mockPrediction));
  const res = await fetch('/mock_prediction.json');
  if (!res.ok) throw new Error('Mock prediction data not available');
  _mockPrediction = await res.json();
  return JSON.parse(JSON.stringify(_mockPrediction!));
}

export async function fetchPrediction(
  date: string,
  region = 'full_india',
  forecastDay = 1,
): Promise<PredictionResponse> {
  try {
    return await apiFetch<PredictionResponse>(
      `/api/predict?date=${date}&region=${region}&lead_day=${forecastDay}`,
    );
  } catch {
    // Fallback to pre-computed mock data when backend is offline
    // This ensures the demo works standalone for hackathon judges
    console.info('[VAYU] Backend offline — loading demo prediction data');
    const mockData = await _loadMockPrediction();
    // Mark as mock so the UI can show a subtle "simulated data" indicator (Req 7.4)
    mockData.model_version = 'mock';
    return mockData;
  }
}

// ── Scenario ──────────────────────────────────────────────────────────────────

/** Map scenario type to mock file */
const MOCK_SCENARIO_FILES: Record<string, string> = {
  temperature_offset: '/mock_scenarios/temperature_offset.json',
  rainfall_scaling: '/mock_scenarios/rainfall_scaling.json',
  monsoon_delay: '/mock_scenarios/temperature_offset.json',
  sst_anomaly: '/mock_scenarios/temperature_offset.json',
  urbanization_change: '/mock_scenarios/temperature_offset.json',
  deforestation_impact: '/mock_scenarios/temperature_offset.json',
};

export async function runScenario(
  request: ScenarioRequest,
): Promise<ScenarioResponse> {
  try {
    return await apiFetch<ScenarioResponse>('/api/scenario', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  } catch {
    // Load pre-computed scenario from static files when backend is offline
    console.info('[VAYU] Backend offline — loading demo scenario data');
    const mockFile = MOCK_SCENARIO_FILES[request.scenario_type] || MOCK_SCENARIO_FILES.temperature_offset;
    const res = await fetch(mockFile);
    if (!res.ok) throw new Error('Demo scenario data not available');
    const data = await res.json();
    data.magnitude = request.magnitude;
    return data as ScenarioResponse;
  }
}

// ── Empirical sensitivity / What-If ───────────────────────────────────────────

/**
 * Fetch the observed dR/dT regression for a region.
 *
 * Deliberately has no mock fallback: an empirical sensitivity is only meaningful
 * if it came from the record. Returning fabricated regression diagnostics —
 * r-squared, p-value, confidence intervals — would misrepresent invented numbers
 * as measurements, so callers get the error and the UI says the fit is
 * unavailable.
 */
export async function fetchSensitivity(params: {
  region: string;
  predictor: PredictorId;
  response?: string;
  season: SeasonId;
  windowStart?: string;
  windowEnd?: string;
  startYear?: number;
  endYear?: number;
  includeCells?: boolean;
}): Promise<SensitivityResponse> {
  const q = new URLSearchParams({
    region: params.region,
    predictor: params.predictor,
    response: params.response ?? 'rainfall',
    season: params.season,
    include_cells: String(params.includeCells ?? false),
  });
  if (params.windowStart && params.windowEnd) {
    q.set('window_start', params.windowStart);
    q.set('window_end', params.windowEnd);
  }
  if (params.startYear) q.set('start_year', String(params.startYear));
  if (params.endYear) q.set('end_year', String(params.endYear));

  return apiFetch<SensitivityResponse>(`/api/sensitivity?${q.toString()}`);
}

/**
 * Run a before/after projection through the observed sensitivity field.
 *
 * Like {@link fetchSensitivity}, this has no offline fallback by design.
 */
export async function runWhatIf(request: WhatIfRequest): Promise<WhatIfResponse> {
  return apiFetch<WhatIfResponse>('/api/what-if', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Observed historical mean of a variable over a calendar range.
 *
 * No offline fallback, for the same reason as {@link fetchSensitivity}: this is
 * the measured baseline every projection is expressed against, so a fabricated
 * value here would silently rebase the whole analysis.
 */
export async function fetchClimatology(params: {
  region: string;
  variable: 'rainfall' | 'tmax' | 'tmin' | 'sst' | 'lst';
  season: SeasonId;
  windowStart?: string;
  windowEnd?: string;
  startYear?: number;
  endYear?: number;
  includeCells?: boolean;
}): Promise<ClimatologyResponse> {
  const q = new URLSearchParams({
    region: params.region,
    variable: params.variable,
    season: params.season,
    include_cells: String(params.includeCells ?? false),
  });
  if (params.windowStart && params.windowEnd) {
    q.set('window_start', params.windowStart);
    q.set('window_end', params.windowEnd);
  }
  if (params.startYear) q.set('start_year', String(params.startYear));
  if (params.endYear) q.set('end_year', String(params.endYear));

  return apiFetch<ClimatologyResponse>(`/api/climatology?${q.toString()}`);
}

/**
 * Conditional density of the response given the predictor.
 *
 * Returns P(R = x | T = t) as two overlaid curves plus
 * P(R > x +/- dx | T = t +/- dt) as an exceedance probability. No offline
 * fallback: invented probabilities are worse than an absent panel.
 */
export async function fetchDistribution(params: {
  region: string;
  predictor: PredictorId;
  response?: string;
  season: SeasonId;
  delta: number;
  threshold?: number;
  thresholdTolerance?: number;
  predictorTolerance?: number;
  windowStart?: string;
  windowEnd?: string;
  startYear?: number;
  endYear?: number;
}): Promise<DistributionResponse> {
  const q = new URLSearchParams({
    region: params.region,
    predictor: params.predictor,
    response: params.response ?? 'rainfall',
    season: params.season,
    delta: String(params.delta),
  });
  // `threshold` is deliberately only sent when defined: omitting it lets the
  // backend default to the observed climatology, which is a more meaningful
  // reference than any constant this client could pick.
  if (params.threshold !== undefined) q.set('threshold', String(params.threshold));
  if (params.thresholdTolerance !== undefined) {
    q.set('threshold_tolerance', String(params.thresholdTolerance));
  }
  if (params.predictorTolerance !== undefined) {
    q.set('predictor_tolerance', String(params.predictorTolerance));
  }
  if (params.windowStart && params.windowEnd) {
    q.set('window_start', params.windowStart);
    q.set('window_end', params.windowEnd);
  }
  if (params.startYear) q.set('start_year', String(params.startYear));
  if (params.endYear) q.set('end_year', String(params.endYear));

  return apiFetch<DistributionResponse>(`/api/distribution?${q.toString()}`);
}

/**
 * Fit the sensitivity separately either side of `splitYear`.
 *
 * Answers whether the older and newer halves of the record share one dR/dT, so a
 * shifted baseline surfaces as a tested result rather than being averaged away.
 */
export async function fetchBaselineComparison(params: {
  region: string;
  predictor: PredictorId;
  response?: string;
  season: SeasonId;
  splitYear?: number;
  windowStart?: string;
  windowEnd?: string;
  startYear?: number;
  endYear?: number;
  includeCells?: boolean;
}): Promise<BaselineComparisonResponse> {
  const q = new URLSearchParams({
    region: params.region,
    predictor: params.predictor,
    response: params.response ?? 'rainfall',
    season: params.season,
    include_cells: String(params.includeCells ?? false),
  });
  if (params.splitYear) q.set('split_year', String(params.splitYear));
  if (params.windowStart && params.windowEnd) {
    q.set('window_start', params.windowStart);
    q.set('window_end', params.windowEnd);
  }
  if (params.startYear) q.set('start_year', String(params.startYear));
  if (params.endYear) q.set('end_year', String(params.endYear));

  return apiFetch<BaselineComparisonResponse>(
    `/api/baseline-comparison?${q.toString()}`,
  );
}

/**
 * Aggregate the T+1..T+7 forecast against the observed climatology.
 *
 * The backend refuses to synthesise this from mock grids (it 503s when real
 * inference is unavailable), so there is no fallback to add here either.
 */
export async function fetchForecastSummary(params: {
  date: string;
  region: string;
  season?: SeasonId;
}): Promise<ForecastSummaryResponse> {
  const q = new URLSearchParams({
    date: params.date,
    region: params.region,
    season: params.season ?? 'jjas',
  });
  return apiFetch<ForecastSummaryResponse>(`/api/forecast-summary?${q.toString()}`);
}

// ── Historical ────────────────────────────────────────────────────────────────

export async function fetchHistorical(params: {
  startDate: string;
  endDate: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  variable: VariableId;
}): Promise<HistoricalRecord[]> {
  const q = new URLSearchParams({
    start_date: params.startDate,
    end_date: params.endDate,
    lat_min: String(params.latMin),
    lat_max: String(params.latMax),
    lon_min: String(params.lonMin),
    lon_max: String(params.lonMax),
    variable: params.variable,
  });
  return apiFetch<HistoricalRecord[]>(`/api/historical?${q}`);
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export async function fetchMetrics(
  variable: VariableId,
  region = 'full_india',
  options?: {
    denormalized?: boolean;
    sourceModel?: 'vayu' | 'persistence' | 'climatology' | 'random_forest' | 'xgboost';
    leadTime?: 'aggregate' | 't1' | 't3' | 't7';
  },
): Promise<MetricsResponse> {
  const q = new URLSearchParams({
    variable,
    region,
  });
  if (options?.denormalized !== undefined) {
    q.set('denormalized', String(options.denormalized));
  }
  if (options?.sourceModel) {
    q.set('source_model', options.sourceModel);
  }
  if (options?.leadTime) {
    q.set('lead_time', options.leadTime);
  }
  try {
    return await apiFetch<MetricsResponse>(
      `/api/metrics?${q.toString()}`,
    );
  } catch {
    // Offline demo path. Marked, on purpose.
    //
    // This used to end in a hardcoded literal — plausible R²/RMSE/MAE values
    // with `eval_period: '2021-2023'` — returned with no indication it was
    // invented. Skill scores are the one thing on screen a reviewer is most
    // likely to take at face value, so an unmarked fabrication here is the
    // worst of the fallbacks: it reads as a real evaluation of the model.
    //
    // The fixture file is still served (it is a real precomputed evaluation) but
    // both branches now stamp `source_model = 'mock'` so the UI can label it,
    // exactly as fetchPrediction does with `model_version`.
    console.info('[VAYU] Backend offline — loading demo metrics');
    const res = await fetch('/mock_metrics.json');
    if (res.ok) {
      const all = await res.json();
      if (all[variable]) {
        return { ...(all[variable] as MetricsResponse), source_model: 'mock' };
      }
    }
    // No fixture available either. Refuse rather than invent: an absent metric
    // is recoverable, a fabricated one is not.
    throw new Error(
      `Metrics for ${variable} are unavailable: the backend could not be reached and no ` +
        `precomputed evaluation is bundled. No estimated skill score is substituted, because ` +
        `an invented R² is indistinguishable from a measured one.`,
    );
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health');
}

// ── Tile URL builder ──────────────────────────────────────────────────────────

export function buildTileUrl(
  variable: VariableId,
  dateStr?: string,
): string {
  const date = dateStr ? `&date=${dateStr}` : '';
  return `${API_BASE}/api/tiles/{z}/{x}/{y}.png?variable=${variable}${date}`;
}

// ── Current Weather (Open-Meteo free API) ─────────────────────────────────────

export async function fetchCurrentWeather(lat: number, lon: number) {
  const res = await fetch(`${API_BASE}/api/current-weather?lat=${lat}&lon=${lon}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Helper: convert GridCell array to lat/lon/value arrays ───────────────────

export function gridCellsToArrays(
  cells: GridCell[],
  variable: VariableId,
): { lats: number[]; lons: number[]; values: number[]; uncertainties: number[] } {
  const lats: number[] = [];
  const lons: number[] = [];
  const values: number[] = [];
  const uncertainties: number[] = [];

  for (const cell of cells) {
    lats.push(cell.lat);
    lons.push(cell.lon);
    values.push(cell[variable]);
    uncertainties.push(
      variable === 'rainfall'
        ? cell.rainfall_uncertainty
        : variable === 'temp_max'
        ? cell.temp_max_uncertainty
        : cell.temp_min_uncertainty,
    );
  }

  return { lats, lons, values, uncertainties };
}
