import { useQuery } from '@tanstack/react-query';
import type { MetricsResponse, VariableId } from '../../types';
import { fetchMetrics } from '../../api/client';

export interface UseMetricsParams {
  /** Climate variable: rainfall, temp_max, or temp_min */
  variable: VariableId;
  /** Region identifier (default: 'pilot') */
  region?: string;
  /** Whether to use denormalized physical-unit metrics */
  denormalized?: boolean;
  /** Source model for comparison */
  sourceModel?: 'vayu' | 'persistence' | 'climatology' | 'random_forest' | 'xgboost';
  /** Lead time granularity */
  leadTime?: 'aggregate' | 't1' | 't3' | 't7';
}

/**
 * Hook wrapping GET /api/verification-scores (mapped to /api/metrics).
 *
 * Returns model performance metrics (R², RMSE, MAE, skill score).
 *
 * Validates: Requirements 17.1
 */
export function useMetrics(params: UseMetricsParams) {
  const {
    variable,
    region = 'pilot',
    denormalized,
    sourceModel,
    leadTime,
  } = params;

  return useQuery<MetricsResponse>({
    queryKey: ['metrics', variable, region, denormalized, sourceModel, leadTime],
    queryFn: () =>
      fetchMetrics(variable, region, {
        denormalized,
        sourceModel,
        leadTime,
      }),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}
