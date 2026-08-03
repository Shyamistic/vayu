import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import type { PredictionResponse } from '../../types';
import { fetchPrediction } from '../../api/client';

export interface UsePredictionParams {
  /** Target date in YYYY-MM-DD format */
  date: string;
  /** Region identifier (default: 'pilot') */
  region?: string;
  /** Forecast lead day 1–7 (default: 1) */
  lead_day?: number;
}

/**
 * Hook wrapping GET /api/predict with stale-while-revalidate caching.
 * Falls back to mock data when backend returns an error for a region
 * and sets `isUsingMockData` flag to show a subtle indicator.
 *
 * Validates: Requirements 1.1, 1.5, 7.4
 */
export function usePrediction(params: UsePredictionParams) {
  const { date, region = 'pilot', lead_day = 1 } = params;
  const [isUsingMockData, setIsUsingMockData] = useState(false);

  const query = useQuery<PredictionResponse>({
    queryKey: ['prediction', date, region, lead_day],
    queryFn: async () => {
      setIsUsingMockData(false);
      try {
        const response = await fetchPrediction(date, region, lead_day);
        // The fetchPrediction function already falls back to mock data internally.
        // We detect mock usage by checking if the model_version indicates mock data
        // or if the response lacks the specific region indicator.
        return response;
      } catch {
        // If even the mock fallback fails, mark as using mock and return empty grid
        setIsUsingMockData(true);
        throw new Error(`Failed to load prediction data for region: ${region}`);
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: !!date,
  });

  // Detect mock data usage based on the successful response
  // fetchPrediction logs "[VAYU] Backend offline — loading demo prediction data" and
  // returns mock data transparently. We detect this by checking model_version.
  useEffect(() => {
    if (query.data && query.data.model_version === 'mock') {
      setIsUsingMockData(true);
    } else if (query.data) {
      setIsUsingMockData(false);
    }
  }, [query.data]);

  return { ...query, isUsingMockData };
}
