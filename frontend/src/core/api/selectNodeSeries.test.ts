import { describe, expect, it } from 'vitest';

import { selectNodeSeries } from './selectNodeSeries';
import type { GridCell } from '../../types';

function cell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    node_idx: 7,
    lat: 15.25,
    lon: 74.5,
    rainfall: 10,
    temp_max: 32,
    temp_min: 22,
    rainfall_uncertainty: 0,
    temp_max_uncertainty: 0,
    temp_min_uncertainty: 0,
    ...overrides,
  } as GridCell;
}

/** Seven lead days, each a small grid, with the target node's rainfall = lead day. */
function sevenDayGrid(): GridCell[][] {
  return Array.from({ length: 7 }, (_, i) => [
    cell({ node_idx: 6, rainfall: 999, lat: 15.0, lon: 74.0 }),
    cell({ node_idx: 7, rainfall: i + 1 }),
    cell({ node_idx: 8, rainfall: 888, lat: 15.5, lon: 75.0 }),
  ]);
}

describe('selectNodeSeries', () => {
  it('follows one node across all lead days in order', () => {
    const { cells, isPartial } = selectNodeSeries(sevenDayGrid(), cell({ node_idx: 7 }));

    expect(cells).toHaveLength(7);
    expect(cells.map((c) => c.rainfall)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(isPartial).toBe(false);
  });

  it('truncates at the first missing lead day rather than shifting later days forward', () => {
    // Lead day 4 (index 3) failed to fetch, so useForecastSeries gives [].
    const days = sevenDayGrid();
    days[3] = [];

    const { cells, isPartial } = selectNodeSeries(days, cell({ node_idx: 7 }));

    // Critical: T+5..T+7 must NOT be pulled forward into the T+4 slot, because
    // the chart labels positions by index. Three points, correctly T+1..T+3.
    expect(cells.map((c) => c.rainfall)).toEqual([1, 2, 3]);
    expect(isPartial).toBe(true);
  });

  it('reports partial when the very first lead day is missing', () => {
    const days = sevenDayGrid();
    days[0] = [];

    const { cells, isPartial } = selectNodeSeries(days, cell({ node_idx: 7 }));

    expect(cells).toEqual([]);
    expect(isPartial).toBe(true);
  });

  it('matches by node_idx even when coordinates differ slightly between responses', () => {
    const days = Array.from({ length: 3 }, (_, i) => [
      cell({ node_idx: 7, rainfall: i + 1, lat: 15.2500001, lon: 74.4999998 }),
    ]);

    const { cells } = selectNodeSeries(days, cell({ node_idx: 7, lat: 15.25, lon: 74.5 }));

    expect(cells.map((c) => c.rainfall)).toEqual([1, 2, 3]);
  });

  it('falls back to coordinate matching when node_idx is absent', () => {
    const days = Array.from({ length: 2 }, (_, i) => [
      cell({ node_idx: undefined as unknown as number, rainfall: i + 1, lat: 15.26, lon: 74.51 }),
      cell({ node_idx: undefined as unknown as number, rainfall: 500, lat: 20.0, lon: 80.0 }),
    ]);

    const { cells } = selectNodeSeries(
      days,
      cell({ node_idx: undefined as unknown as number, lat: 15.25, lon: 74.5 }),
    );

    expect(cells.map((c) => c.rainfall)).toEqual([1, 2]);
  });

  it('does not match a different node that is far away', () => {
    const days = [[cell({ node_idx: 99, lat: 28.0, lon: 88.0, rainfall: 42 })]];

    const { cells, isPartial } = selectNodeSeries(days, cell({ node_idx: 7, lat: 15.25, lon: 74.5 }));

    expect(cells).toEqual([]);
    expect(isPartial).toBe(true);
  });

  it('returns an empty, non-partial series when there is no data at all', () => {
    expect(selectNodeSeries(undefined, cell())).toEqual({ cells: [], isPartial: false });
    expect(selectNodeSeries([], cell())).toEqual({ cells: [], isPartial: false });
    expect(selectNodeSeries(sevenDayGrid(), undefined)).toEqual({ cells: [], isPartial: false });
  });
});
