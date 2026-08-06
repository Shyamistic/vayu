import { useMutation, useQuery } from '@tanstack/react-query';
import type { ScenarioRequest, ScenarioResponse } from '../../types';
import { runScenario } from '../../api/client';
import { queryClient } from './queryClient';

/**
 * Mutation hook wrapping POST /api/scenario.
 *
 * Usage:
 *   const { mutate, data, isPending } = useScenarioMutation();
 *   mutate({ scenario_type: 'temperature_offset', magnitude: 2.0 });
 *
 * Validates: Requirements 1.1, 1.5
 */
export function useScenarioMutation() {
  return useMutation<ScenarioResponse, Error, ScenarioRequest>({
    mutationFn: (request: ScenarioRequest) => runScenario(request),
    onSuccess: (data, variables) => {
      // Cache the result so subsequent reads with same params are instant
      queryClient.setQueryData(
        ['scenario', variables.scenario_type, variables.magnitude, variables.target_region],
        data,
      );
    },
  });
}

/**
 * Query hook for fetching a previously-run scenario result from cache.
 * Useful for re-displaying a scenario without re-running the simulation.
 */
export function useScenarioResult(params: {
  scenario_type: string;
  magnitude: number;
  target_region?: string;
} | null) {
  return useQuery<ScenarioResponse>({
    queryKey: params
      ? ['scenario', params.scenario_type, params.magnitude, params.target_region ?? 'full_india']
      : ['scenario', 'none'],
    queryFn: () =>
      runScenario({
        scenario_type: params!.scenario_type as ScenarioRequest['scenario_type'],
        magnitude: params!.magnitude,
        target_region: params?.target_region ?? 'full_india',
      }),
    enabled: !!params,
    staleTime: 10 * 60 * 1000, // 10 minutes — scenarios are computationally expensive
    gcTime: 30 * 60 * 1000,
  });
}
