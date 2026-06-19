/**
 * VAYU API client — typed wrappers for all backend endpoints.
 */

import type {
  GridCell,
  HealthResponse,
  HistoricalRecord,
  MetricsResponse,
  PredictionResponse,
  ScenarioRequest,
  ScenarioResponse,
  VariableId,
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

export async function fetchPrediction(
  date: string,
  region = 'pilot',
): Promise<PredictionResponse> {
  return apiFetch<PredictionResponse>(
    `/api/predict?date=${date}&region=${region}`,
  );
}

// ── Scenario ──────────────────────────────────────────────────────────────────

export async function runScenario(
  request: ScenarioRequest,
): Promise<ScenarioResponse> {
  return apiFetch<ScenarioResponse>('/api/scenario', {
    method: 'POST',
    body: JSON.stringify(request),
  });
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
  region = 'pilot',
): Promise<MetricsResponse> {
  return apiFetch<MetricsResponse>(
    `/api/metrics?variable=${variable}&region=${region}`,
  );
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
