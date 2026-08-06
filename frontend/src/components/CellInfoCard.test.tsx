import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CellInfoCard from './CellInfoCard';
import type { GridCell } from '../types';

function cell(overrides: Partial<GridCell> = {}): GridCell {
  return {
    node_idx: 7,
    lat: 15.25,
    lon: 74.5,
    rainfall: 12.4,
    temp_max: 31.8,
    temp_min: 22.1,
    rainfall_uncertainty: 0,
    temp_max_uncertainty: 0,
    temp_min_uncertainty: 0,
    ...overrides,
  } as GridCell;
}

function series(values: number[]): GridCell[] {
  return values.map((rainfall, i) => cell({ rainfall, node_idx: 7 + i * 0 }));
}

describe('CellInfoCard forecast trend provenance', () => {
  it('reports the trend as unavailable instead of drawing invented values', () => {
    render(<CellInfoCard cell={cell()} variable="rainfall" onClose={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Forecast trend unavailable');
    // The sparkline canvas must not be rendered at all — an empty chart is
    // honest, a synthesised one is not.
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('distinguishes loading from unavailable', () => {
    render(
      <CellInfoCard cell={cell()} variable="rainfall" forecastPending onClose={vi.fn()} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('renders the sparkline with one label per real lead day', () => {
    render(
      <CellInfoCard
        cell={cell()}
        variable="rainfall"
        forecastCells={series([1, 2, 3, 4, 5, 6, 7])}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('7-day forecast trend')).toBeInTheDocument();
    expect(screen.getByText('T+1')).toBeInTheDocument();
    expect(screen.getByText('T+7')).toBeInTheDocument();
    expect(document.querySelector('canvas')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('labels a truncated series by its true length and flags it partial', () => {
    render(
      <CellInfoCard
        cell={cell()}
        variable="rainfall"
        forecastCells={series([1, 2, 3])}
        onClose={vi.fn()}
      />,
    );

    // Must not claim 7 days, and must not label the last point T+7.
    expect(screen.getByText('3-day forecast trend')).toBeInTheDocument();
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByText('T+3')).toBeInTheDocument();
    expect(screen.queryByText('T+4')).toBeNull();
    expect(screen.queryByText('T+7')).toBeNull();
  });

  it('marks the trend as demo data when the client served bundled fallbacks', () => {
    render(
      <CellInfoCard
        cell={cell()}
        variable="rainfall"
        forecastCells={series([1, 2, 3, 4, 5, 6, 7])}
        forecastIsMock
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('demo data')).toBeInTheDocument();
    // 'partial' is about missing leads, 'demo data' about provenance — a full
    // mock series is complete, so only the provenance flag should show.
    expect(screen.queryByText('partial')).toBeNull();
  });

  it('is deterministic across renders — no random values anywhere', () => {
    const props = {
      cell: cell(),
      variable: 'rainfall' as const,
      onClose: vi.fn(),
    };
    const first = render(<CellInfoCard {...props} />);
    const firstHtml = first.container.innerHTML;
    first.unmount();

    const second = render(<CellInfoCard {...props} />);
    expect(second.container.innerHTML).toBe(firstHtml);
  });
});
