import { useQuery } from '@tanstack/react-query';

export interface NWPForecastDay {
  date: string;
  precipitation_sum: number;
  temperature_2m_max: number;
  temperature_2m_min: number;
  cape?: number;
  wind_speed_10m_max?: number;
}

export interface NWPModelData {
  model: string;
  daily: NWPForecastDay[];
}

export interface NWPComparisonResponse {
  ecmwf: {
    daily: NWPForecastDay[];
  };
  models?: Record<string, NWPModelData>;
  source: string;
  free: boolean;
  note?: string;
}

export interface UseNWPComparisonParams {
  /** Latitude (default: Western Ghats centre 12.5) */
  lat?: number;
  /** Longitude (default: 75.5) */
  lon?: number;
  /** Number of forecast days (1–16, default: 7) */
  forecast_days?: number;
  /** Which NWP models to fetch: 'ecmwf' or 'all' */
  models?: 'ecmwf' | 'all';
}

const API_BASE = import.meta.env.VITE_API_URL || '';

async function fetchNWPComparison(params: UseNWPComparisonParams): Promise<NWPComparisonResponse> {
  const q = new URLSearchParams();
  if (params.lat !== undefined) q.set('lat', String(params.lat));
  if (params.lon !== undefined) q.set('lon', String(params.lon));
  if (params.forecast_days !== undefined) q.set('forecast_days', String(params.forecast_days));
  if (params.models) q.set('models', params.models);

  const res = await fetch(`${API_BASE}/api/nwp-comparison?${q}`);

  // Fall back to nwp-baseline if nwp-comparison doesn't exist
  if (res.status === 404) {
    const fallbackRes = await fetch(`${API_BASE}/api/nwp-baseline?${q}`);
    if (!fallbackRes.ok) {
      throw new Error(`Failed to fetch NWP comparison: ${fallbackRes.status}`);
    }
    return fallbackRes.json();
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch NWP comparison: ${res.status}`);
  }
  return res.json();
}

/**
 * Hook wrapping GET /api/nwp-comparison for NWP model comparison data.
 *
 * Fetches forecast data from ECMWF IFS and optionally GFS, ICON, GEM
 * via the Open-Meteo free tier for comparison against VAYU predictions.
 *
 * Validates: Requirements 61.1
 */
export function useNWPComparison(params?: UseNWPComparisonParams & { enabled?: boolean }) {
  const { enabled = true, ...queryParams } = params ?? {};
  const { lat = 12.5, lon = 75.5, forecast_days = 7, models = 'all' } = queryParams;

  return useQuery<NWPComparisonResponse>({
    queryKey: ['nwp-comparison', lat, lon, forecast_days, models],
    queryFn: () => fetchNWPComparison({ lat, lon, forecast_days, models }),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled,
  });
}
