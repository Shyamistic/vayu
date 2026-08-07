/**
 * Tests for the ERA5 independent-validation panel.
 *
 * The contract this panel has to keep is narrower than the other analysis
 * panels: it exists to say whether our data is right, so it must never render a
 * number it did not get from the endpoint, and it must refuse loudly when the
 * bundle was not denormalized (in which case the statistics are z-score noise
 * that would still print as plausible-looking small biases).
 *
 * Fixtures deliberately use a rainfall case where the daily correlation is weak
 * and the monthly one is strong, because that is the real signature of the
 * 0830–0830 IST rain-day convention and the panel is supposed to say so rather
 * than report the daily r as a failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import type { Era5AgreementStats, Era5ComparisonResponse } from '../../types';

vi.mock('../../api/client', () => ({
  fetchEra5Comparison: vi.fn(),
}));

// The chart pulls in Plotly, which is irrelevant here and slow to mount.
vi.mock('./Era5ValidationChart', () => ({
  default: ({ labels }: { labels: string[] }) => (
    <div data-testid="era5-chart">{labels.length} points</div>
  ),
}));

import { fetchEra5Comparison } from '../../api/client';
import Era5ValidationPanel from './Era5ValidationPanel';

const mockFetch = vi.mocked(fetchEra5Comparison);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function statsFixture(overrides: Partial<Era5AgreementStats> = {}): Era5AgreementStats {
  return {
    n: 122,
    observed_mean: 8.42,
    reference_mean: 7.98,
    bias: -0.44,
    mae: 3.61,
    rmse: 6.12,
    pearson_r: 0.61,
    pearson_p: 1.2e-13,
    r_squared: 0.372,
    ...overrides,
  };
}

function fixture(overrides: Partial<Era5ComparisonResponse> = {}): Era5ComparisonResponse {
  return {
    region: 'western_ghats',
    variable: 'rainfall',
    unit: 'mm/day',
    start_date: '2024-06-01',
    end_date: '2024-09-30',
    requested_lat: 12.5,
    requested_lon: 75.5,
    our_grid_cell: {
      cell_lat: 12.375,
      cell_lon: 75.625,
      flat_index: 431,
      distance_from_request_km: 19.4,
      denormalized: true,
      availability_masked: true,
      unit: 'mm/day',
      n_days: 122,
    },
    daily_stats: statsFixture({
      observed_total: 1027.2,
      reference_total: 973.6,
      total_ratio: 0.948,
    }),
    daily: {
      dates: ['2024-06-01', '2024-06-02', '2024-06-03'],
      observed: [12.1, 8.4, null],
      reference: [11.2, 9.9, 4.4],
    },
    monthly: {
      aggregation: 'sum',
      // Summed mm/day is mm — the panel must not reuse the daily unit here.
      unit: 'mm',
      labels: ['2024-06', '2024-07', '2024-08', '2024-09'],
      observed: [301.2, 402.8, 221.4, 101.8],
      reference: [288.4, 391.1, 214.7, 79.4],
      paired_days: [30, 31, 31, 30],
      stats: statsFixture({
        n: 4,
        observed_mean: 256.8,
        reference_mean: 243.4,
        bias: -13.4,
        mae: 13.4,
        rmse: 15.2,
        pearson_r: 0.94,
        pearson_p: 0.06,
        r_squared: 0.884,
      }),
    },
    reference_point: { lat: 12.5, lon: 75.5, label: 'Mysuru-Coorg corridor' },
    caveats: [
      'ERA5 is an independent reanalysis (ECMWF), not one of our inputs for this variable.',
      'Day-boundary mismatch: IMD 0830-0830 IST vs archive 0000-2400.',
    ],
    provenance: { independent: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Rendering the measured result ─────────────────────────────────────────────

describe('Era5ValidationPanel', () => {
  it('renders the monthly figures as the headline for rainfall', async () => {
    mockFetch.mockResolvedValue(fixture());
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // For rainfall the monthly stats lead, because the daily correlation is
    // depressed by the day-boundary convention rather than by a data fault.
    expect(await screen.findByText(/Bias \(monthly\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Correlation \(monthly\)/i)).toBeInTheDocument();
    expect(screen.getByText('−13.400')).toBeInTheDocument();   // monthly bias
  });

  it('explains a weak daily r against a strong monthly r', async () => {
    mockFetch.mockResolvedValue(fixture());
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    expect(
      await screen.findByText(/0830–0830 IST/i),
    ).toBeInTheDocument();
  });

  it('shows the accumulation totals and their ratio for rainfall', async () => {
    mockFetch.mockResolvedValue(fixture());
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    expect(await screen.findByText('1027.2')).toBeInTheDocument();
    expect(screen.getByText('973.6')).toBeInTheDocument();
    expect(screen.getByText('0.948')).toBeInTheDocument();
  });

  it('omits the accumulation block for temperature', async () => {
    mockFetch.mockResolvedValue(
      fixture({
        variable: 'tmax',
        unit: 'degC',
        daily_stats: statsFixture({ bias: 0.42, observed_mean: 29.8, reference_mean: 30.22 }),
        monthly: {
          aggregation: 'mean',
          unit: 'degC',
          labels: ['2024-06', '2024-07'],
          observed: [29.4, 28.8],
          reference: [29.9, 29.1],
          paired_days: [30, 31],
          stats: statsFixture({ n: 2, bias: 0.4 }),
        },
      }),
    );
    render(<Era5ValidationPanel region="western_ghats" variable="tmax" autoLoad />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByText(/Total ratio/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/Monthly means/i)).toBeInTheDocument();
  });

  it('labels monthly rainfall aggregates in mm, not mm/day', async () => {
    mockFetch.mockResolvedValue(fixture());
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // The monthly card is a total: reusing the daily mm/day label here would
    // understate a −13.4 mm monthly bias by a factor of thirty.
    const monthlyCard = screen.getByText(/Monthly totals/i).closest('div');
    expect(monthlyCard).not.toBeNull();
    expect(monthlyCard!.textContent).toContain('−13.400 mm');
    expect(monthlyCard!.textContent).not.toContain('mm/day');
  });

  it('reports the cell actually sampled and its offset', async () => {
    mockFetch.mockResolvedValue(fixture());
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    // The spatial-support mismatch has to be visible: ours is a cell average,
    // ERA5 is a point sample.
    expect(await screen.findByText('12.375 N, 75.625 E')).toBeInTheDocument();
    expect(screen.getByText('19.4 km')).toBeInTheDocument();
  });

  it('renders caveats from the server rather than hardcoded copy', async () => {
    mockFetch.mockResolvedValue(
      fixture({ caveats: ['A very specific server-authored caveat.'] }),
    );
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    expect(await screen.findByText('A very specific server-authored caveat.')).toBeInTheDocument();
  });

  // ── Refusals ───────────────────────────────────────────────────────────────

  it('warns that statistics are meaningless when denormalization failed', async () => {
    mockFetch.mockResolvedValue(
      fixture({
        our_grid_cell: { ...fixture().our_grid_cell, denormalized: false },
      }),
    );
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    expect(
      await screen.findByText(/still in\s+z-score units/i),
    ).toBeInTheDocument();
  });

  it('shows no numbers at all when the endpoint fails', async () => {
    mockFetch.mockRejectedValue(new Error('ERA5 archive unreachable'));
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    expect(await screen.findByText(/ERA5 archive unreachable/i)).toBeInTheDocument();
    // No substituted comparison: the stat labels must be absent entirely.
    expect(screen.queryByText(/Correlation \(/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/RMSE \(/i)).not.toBeInTheDocument();
  });

  it('states that nothing is substituted on failure', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    expect(await screen.findByText(/nothing is substituted/i)).toBeInTheDocument();
  });

  it('renders em dashes rather than zeros for null statistics', async () => {
    mockFetch.mockResolvedValue(
      fixture({
        daily_stats: statsFixture({
          pearson_r: null,
          pearson_p: null,
          r_squared: null,
          rmse: null,
        }),
        monthly: { ...fixture().monthly, stats: null },
      }),
    );
    render(<Era5ValidationPanel region="western_ghats" autoLoad />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // Monthly stats absent -> the daily set becomes the headline.
    expect(await screen.findByText(/Bias \(daily\)/i)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Not enough complete months in this window/i),
    ).toBeInTheDocument();
  });

  it('does not call the endpoint until asked when autoLoad is off', () => {
    mockFetch.mockResolvedValue(fixture());
    render(<Era5ValidationPanel region="western_ghats" />);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Run ERA5 comparison/i })).toBeInTheDocument();
  });

  it('requests the region and variable it was given', async () => {
    mockFetch.mockResolvedValue(fixture({ variable: 'tmin' }));
    render(<Era5ValidationPanel region="north_east_india" variable="tmin" autoLoad />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'north_east_india', variable: 'tmin' }),
      ),
    );
  });
});
