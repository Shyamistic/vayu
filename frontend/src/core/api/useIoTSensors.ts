import { useQuery } from '@tanstack/react-query';
import type { IoTStation } from '../../types';

export interface StationsResponse {
  stations: IoTStation[];
  total: number;
  timestamp: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

async function fetchStations(): Promise<StationsResponse> {
  const response = await fetch(`${API_BASE}/api/stations`);
  if (!response.ok) throw new Error(`Failed to fetch stations: ${response.status}`);

  const payload: IoTStation[] | StationsResponse = await response.json();
  if (Array.isArray(payload)) {
    return {
      stations: payload,
      total: payload.length,
      timestamp: new Date().toISOString(),
    };
  }
  return payload;
}

/**
 * Fetches the latest AWS IoT station telemetry and refreshes it every 30 seconds.
 *
 * Validates: Requirements 27.1, 27.2, 27.4
 */
export function useIoTSensors(params?: { enabled?: boolean }) {
  return useQuery<StationsResponse>({
    queryKey: ['stations'],
    queryFn: fetchStations,
    staleTime: 25_000,
    refetchInterval: 30_000,
    gcTime: 30 * 60 * 1000,
    enabled: params?.enabled ?? true,
  });
}
