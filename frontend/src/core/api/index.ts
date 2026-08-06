export { queryClient } from './queryClient';
export { usePrediction } from './usePrediction';
// `useScenarioMutation` / `useScenarioResult` are deliberately NOT re-exported.
// They wrap POST /api/scenario, which runs the model over a synthetic
// `torch.randn` base graph and falls back to fixed literature coefficients — it
// is not an observation-driven result. The empirical replacement is
// `runWhatIf` / `fetchSensitivity` in api/client.ts, surfaced by
// features/analysis/WhatIfStudio.tsx. Dropping the barrel export keeps the
// synthetic path from being wired into a new component by autocomplete.
export { useMetrics } from './useMetrics';
export { useIoTSensors } from './useIoTSensors';
export { useNWPComparison } from './useNWPComparison';

export type { UsePredictionParams } from './usePrediction';
export type { UseMetricsParams } from './useMetrics';
export type { IoTStation as Station } from '../../types';
export type { StationsResponse } from './useIoTSensors';
export type { NWPComparisonResponse, NWPForecastDay, NWPModelData, UseNWPComparisonParams } from './useNWPComparison';
