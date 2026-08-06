/**
 * Fetch all 7 forecast lead days at once.
 *
 * App.tsx only ever holds ONE lead day (`activePrediction`), but several feature
 * panels need the whole T+1..T+7 sequence — ReportGenerator (`forecastDaysCells`),
 * WaterResources (`dailyCells`), EnergyPanel (`forecastGrids`), WatershedAnalysis
 * (`forecastDayCells`). Without this they fall back to their internal mock
 * constants, which is precisely what must not happen silently.
 *
 * Requests run in parallel and are cached by react-query, so switching panels does
 * not refetch. A partial failure is surfaced rather than silently padded: a missing
 * lead day yields an empty array for that day and `isPartial` becomes true.
 */
import { useQuery } from '@tanstack/react-query';

import { fetchPrediction } from '../../api/client';
import type { GridCell, RegionId } from '../../types';

/** Lead days the backend supports (`/api/predict?lead_day=1..7`). */
export const FORECAST_LEAD_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface ForecastSeries {
  /** Index 0 = lead day 1 ... index 6 = lead day 7. Empty array = that day failed. */
  daysCells: GridCell[][];
  /** Same data keyed by lead day, for panels that want a Map. */
  byLeadDay: Map<number, GridCell[]>;
  /** True when at least one lead day could not be fetched. */
  isPartial: boolean;
  /** True when every lead day is empty — callers should not render numbers. */
  isEmpty: boolean;
  /** 'mock' when the client served bundled demo data for any day. */
  containsMock: boolean;
}

async function fetchForecastSeries(date: string, region: RegionId): Promise<ForecastSeries> {
  const settled = await Promise.allSettled(
    FORECAST_LEAD_DAYS.map((day) => fetchPrediction(date, region, day)),
  );

  const daysCells: GridCell[][] = [];
  const byLeadDay = new Map<number, GridCell[]>();
  let isPartial = false;
  let containsMock = false;

  settled.forEach((outcome, i) => {
    const leadDay = FORECAST_LEAD_DAYS[i];
    if (outcome.status === 'fulfilled') {
      const cells = outcome.value.grid_cells ?? [];
      daysCells.push(cells);
      byLeadDay.set(leadDay, cells);
      // api/client marks its offline fallback by setting model_version to 'mock'.
      if (outcome.value.model_version === 'mock') containsMock = true;
    } else {
      daysCells.push([]);
      byLeadDay.set(leadDay, []);
      isPartial = true;
    }
  });

  return {
    daysCells,
    byLeadDay,
    isPartial,
    isEmpty: daysCells.every((d) => d.length === 0),
    containsMock,
  };
}

export interface UseForecastSeriesParams {
  /** 'yyyy-MM-dd'. */
  date: string;
  region: RegionId;
  enabled?: boolean;
}

export function useForecastSeries({ date, region, enabled = true }: UseForecastSeriesParams) {
  return useQuery<ForecastSeries>({
    queryKey: ['forecast-series', date, region],
    queryFn: () => fetchForecastSeries(date, region),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: enabled && Boolean(date && region),
  });
}
