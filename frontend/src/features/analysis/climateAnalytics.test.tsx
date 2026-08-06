/**
 * Tests for the three observation-only analysis panels.
 *
 * The point of these panels is that every number on screen traces to the API, so
 * the tests check both halves of that contract: the real value is rendered when
 * the endpoint answers, and *no* number is rendered when it fails. Nulls must
 * surface as em dashes rather than zeros, and a non-significant epoch difference
 * must be described in negative language rather than as a change.
 *
 * Fixtures use the measured Indo-Gangetic Plain figures (mean 4.466 mm/day,
 * older slope −0.3986, newer −0.5422, difference p = 0.399) so a wrong wiring
 * shows up as a wrong, recognisable number.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import type {
  BaselineComparisonResponse,
  ClimatologyResponse,
  DistributionResponse,
  RegressionFit,
} from '../../types';

vi.mock('../../api/client', () => ({
  fetchClimatology: vi.fn(),
  fetchDistribution: vi.fn(),
  fetchBaselineComparison: vi.fn(),
}));

import { fetchBaselineComparison, fetchClimatology, fetchDistribution } from '../../api/client';
import BaselineSplitPanel from './BaselineSplitPanel';
import ClimatologyPanel from './ClimatologyPanel';
import DistributionPanel from './DistributionPanel';

const mockClimatology = vi.mocked(fetchClimatology);
const mockDistribution = vi.mocked(fetchDistribution);
const mockBaseline = vi.mocked(fetchBaselineComparison);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function climatologyFixture(overrides: Partial<ClimatologyResponse> = {}): ClimatologyResponse {
  return {
    region: 'indo_gangetic_plain',
    variable: 'rainfall',
    season: 'jjas',
    season_label: 'Monsoon (Jun–Sep)',
    unit: 'mm/day',
    summary: {
      mean: 4.466,
      std: 0.612,
      sem: 0.091,
      ci95_low: 4.282,
      ci95_high: 4.65,
      median: 4.401,
      min_value: 3.214,
      min_year: 2009,
      max_value: 5.802,
      max_year: 1988,
      n_years: 45,
      year_first: 1981,
      year_last: 2025,
    },
    trend: {
      per_decade: -0.117,
      unit: 'mm/day per decade',
      p_value: 0.184,
      r_squared: 0.041,
      significant: false,
    },
    integral: {
      volume_km3: 412.7,
      area_km2: 750_000,
      definition: 'Seasonal depth integrated over cells with observations',
    },
    per_year: [
      { year: 1981, value: 4.51, anomaly: 0.044, anomaly_percent: 1.0, valid_days: 122 },
      { year: 1982, value: 3.98, anomaly: -0.486, anomaly_percent: -10.9, valid_days: 122 },
      { year: 1983, value: 5.12, anomaly: 0.654, anomaly_percent: 14.6, valid_days: 121 },
    ],
    excluded_years: [1997],
    provenance: { dataset: 'IMD gridded 0.25°', coverage_floor_days: 100 },
    ...overrides,
  };
}

function fitFixture(overrides: Partial<RegressionFit> = {}): RegressionFit {
  return {
    slope: -0.3986,
    intercept: 4.466,
    r_squared: 0.212,
    p_value: 0.021,
    std_err: 0.164,
    ci95_low: -0.731,
    ci95_high: -0.066,
    n: 23,
    predictor: 'tmax',
    response: 'rainfall',
    predictor_unit: '°C',
    response_unit: 'mm/day',
    slope_unit: 'mm/day per °C',
    predictor_climatology: 33.1,
    response_climatology: 4.466,
    slope_percent_per_unit: -8.9,
    significant: true,
    ...overrides,
  };
}

function distributionFixture(
  overrides: Partial<DistributionResponse> = {},
): DistributionResponse {
  return {
    region: 'indo_gangetic_plain',
    season: 'jjas',
    season_label: 'Monsoon (Jun–Sep)',
    predictor: 'tmax',
    response: 'rainfall',
    predictor_unit: '°C',
    response_unit: 'mm/day',
    delta_predictor: 2,
    residual_sigma: 0.541,
    curves: [
      {
        id: 'baseline',
        label: 'Observed baseline',
        predictor_value: 33.1,
        predictor_anomaly: 0,
        mean: 4.466,
        sigma: 0.541,
        ci95_low: 3.406,
        ci95_high: 5.526,
        values: [3.0, 4.0, 4.466, 5.0, 6.0],
        density: [0.05, 0.52, 0.737, 0.48, 0.04],
      },
      {
        id: 'scenario',
        label: 'Scenario +2.00 °C',
        predictor_value: 35.1,
        predictor_anomaly: 2,
        mean: 3.669,
        sigma: 0.598,
        ci95_low: 2.497,
        ci95_high: 4.841,
        values: [2.0, 3.0, 3.669, 4.5, 5.5],
        density: [0.06, 0.5, 0.667, 0.42, 0.03],
      },
    ],
    empirical: {
      histogram_edges: [3.0, 3.75, 4.5, 5.25, 6.0],
      histogram_counts: [6, 17, 15, 7],
      values: [3.2, 4.1, 4.4, 5.3],
      n: 45,
    },
    exceedance: {
      threshold: 5,
      threshold_tolerance: 0.25,
      predictor_tolerance: 0.5,
      baseline_probability: 0.156,
      scenario_probability: 0.014,
      probability_low: 0.009,
      probability_high: 0.023,
      probability_change: -0.142,
      observed_frequency: 0.133,
      observed_exceedances: 6,
      observed_years: 45,
      definition: 'Gaussian tail beyond the threshold, conditioned on the predictor value',
    },
    caveats: [
      'The density assumes Gaussian residuals; the observed histogram is the check on that.',
      'A +2 °C shift lies beyond the observed predictor range, so the scenario curve is an extrapolation.',
    ],
    provenance: { dataset: 'IMD gridded 0.25°' },
    ...overrides,
  };
}

function baselineFixture(
  overrides: Partial<BaselineComparisonResponse> = {},
): BaselineComparisonResponse {
  return {
    region: 'indo_gangetic_plain',
    season: 'jjas',
    season_label: 'Monsoon (Jun–Sep)',
    predictor: 'tmax',
    response: 'rainfall',
    split_year: 2003,
    older: {
      id: 'older',
      label: 'Older baseline',
      year_start: 1981,
      year_end: 2002,
      fit: fitFixture({ slope: -0.3986, n: 22 }),
      response_mean: 4.612,
      predictor_mean: 32.8,
      n_years: 22,
    },
    newer: {
      id: 'newer',
      label: 'Newer baseline',
      year_start: 2003,
      year_end: 2025,
      fit: fitFixture({ slope: -0.5422, n: 23, p_value: 0.008 }),
      response_mean: 4.327,
      predictor_mean: 33.4,
      n_years: 23,
    },
    difference: {
      slope_delta: -0.1436,
      slope_delta_se: 0.169,
      slope_delta_ci95_low: -0.485,
      slope_delta_ci95_high: 0.198,
      slope_delta_p_value: 0.399,
      slope_changed_significantly: false,
      slope_unit: 'mm/day per °C',
      response_mean_delta: -0.285,
      response_mean_delta_percent: -6.2,
      predictor_mean_delta: 0.6,
      definition: 'Two independent OLS fits either side of the split year',
    },
    caveats: [
      'Each half has roughly 22 seasons, so both slopes carry wide intervals.',
      'The split year is a convention, not a detected changepoint.',
    ],
    provenance: { dataset: 'IMD gridded 0.25°' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── ClimatologyPanel ──────────────────────────────────────────────────────────

describe('ClimatologyPanel', () => {
  it('renders the observed mean from the API response', async () => {
    mockClimatology.mockResolvedValue(climatologyFixture());

    render(<ClimatologyPanel region="indo_gangetic_plain" season="jjas" autoLoad />);

    expect(await screen.findByText('4.466')).toBeInTheDocument();
    expect(screen.getByText(/4\.282, 4\.650/)).toBeInTheDocument();
    expect(screen.getByText(/interannual spread/i)).toBeInTheDocument();
    expect(screen.getByText('2009')).toBeInTheDocument();
    expect(screen.getByText('1988')).toBeInTheDocument();
  });

  it('states a non-significant trend is not a finding', async () => {
    mockClimatology.mockResolvedValue(climatologyFixture());

    render(<ClimatologyPanel region="indo_gangetic_plain" season="jjas" autoLoad />);

    expect(await screen.findByText(/Not significant/i)).toBeInTheDocument();
    expect(screen.getByText(/does not demonstrate a trend/i)).toBeInTheDocument();
  });

  it('notes excluded years fell below the coverage floor', async () => {
    mockClimatology.mockResolvedValue(climatologyFixture());

    render(<ClimatologyPanel region="indo_gangetic_plain" season="jjas" autoLoad />);

    expect(
      await screen.findByText(/fell below the valid-day coverage floor/i),
    ).toBeInTheDocument();
    expect(screen.getByText('1997')).toBeInTheDocument();
  });

  it('omits the volume row when the integral is null', async () => {
    mockClimatology.mockResolvedValue(
      climatologyFixture({
        variable: 'tmax',
        unit: '°C',
        integral: { volume_km3: null, area_km2: null, definition: '' },
      }),
    );

    render(
      <ClimatologyPanel region="indo_gangetic_plain" season="jjas" variable="tmax" autoLoad />,
    );

    await screen.findByText('4.466');
    expect(screen.queryByText(/Water volume/i)).not.toBeInTheDocument();
  });

  it('renders nulls as em dashes rather than zeros', async () => {
    mockClimatology.mockResolvedValue(
      climatologyFixture({
        summary: {
          ...climatologyFixture().summary,
          mean: null,
          std: null,
          median: null,
          sem: null,
          ci95_low: null,
          ci95_high: null,
          min_value: null,
          min_year: null,
          max_value: null,
          max_year: null,
        },
        trend: { per_decade: null, unit: '', p_value: null, r_squared: null, significant: false },
        integral: { volume_km3: null, area_km2: null, definition: '' },
      }),
    );

    render(<ClimatologyPanel region="indo_gangetic_plain" season="jjas" autoLoad />);

    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('0.000')).not.toBeInTheDocument();
  });

  it('shows the failure without substituting an offline estimate', async () => {
    mockClimatology.mockRejectedValue(new Error('Climatology endpoint returned 503'));

    render(<ClimatologyPanel region="indo_gangetic_plain" season="jjas" autoLoad />);

    expect(await screen.findByText(/Climatology endpoint returned 503/)).toBeInTheDocument();
    expect(screen.getByText(/no offline estimate is shown/i)).toBeInTheDocument();
    expect(screen.queryByText('4.466')).not.toBeInTheDocument();
    expect(screen.queryByText(/interannual spread/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mean 4\.47/)).not.toBeInTheDocument();
  });
});

// ── DistributionPanel ─────────────────────────────────────────────────────────

describe('DistributionPanel', () => {
  it('renders both curve means and the exceedance probabilities', async () => {
    mockDistribution.mockResolvedValue(distributionFixture());

    render(
      <DistributionPanel
        region="indo_gangetic_plain"
        predictor="tmax"
        season="jjas"
        delta={2}
        autoLoad
      />,
    );

    expect((await screen.findAllByText(/4\.466/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3\.669/).length).toBeGreaterThan(0);
    expect(screen.getByText('15.6%')).toBeInTheDocument();
    expect(screen.getByText('1.4%')).toBeInTheDocument();
    expect(screen.getByText('−14.2%')).toBeInTheDocument();
    expect(screen.getByText('0.9% – 2.3%')).toBeInTheDocument();
    expect(screen.getByText('6/45')).toBeInTheDocument();
  });

  it('draws an accessible density chart with a descriptive title', async () => {
    mockDistribution.mockResolvedValue(distributionFixture());

    render(
      <DistributionPanel
        region="indo_gangetic_plain"
        predictor="tmax"
        season="jjas"
        delta={2}
        autoLoad
      />,
    );

    const chart = await screen.findByRole('img', { name: /conditional probability density/i });
    expect(chart.tagName.toLowerCase()).toBe('svg');
    expect(chart.querySelector('title')?.textContent).toMatch(/observed histogram of 45 seasons/i);
    expect(chart.querySelectorAll('rect').length).toBe(4);
  });

  it('flags a wider scenario sigma as extrapolation leverage', async () => {
    mockDistribution.mockResolvedValue(distributionFixture());

    render(
      <DistributionPanel
        region="indo_gangetic_plain"
        predictor="tmax"
        season="jjas"
        delta={2}
        autoLoad
      />,
    );

    expect(await screen.findByText(/leverage/i)).toBeInTheDocument();
    expect(screen.getByText(/Residual σ/i)).toBeInTheDocument();
  });

  it('renders every caveat in full', async () => {
    const fixture = distributionFixture();
    mockDistribution.mockResolvedValue(fixture);

    render(
      <DistributionPanel
        region="indo_gangetic_plain"
        predictor="tmax"
        season="jjas"
        delta={2}
        autoLoad
      />,
    );

    for (const caveat of fixture.caveats) {
      expect(await screen.findByText(caveat)).toBeInTheDocument();
    }
  });

  it('renders nulls as em dashes rather than zeros', async () => {
    const base = distributionFixture();
    mockDistribution.mockResolvedValue(
      distributionFixture({
        residual_sigma: null,
        curves: base.curves.map((c) => ({ ...c, sigma: null })),
        exceedance: base.exceedance
          ? {
              ...base.exceedance,
              baseline_probability: null,
              scenario_probability: null,
              probability_change: null,
              probability_low: null,
              probability_high: null,
              observed_frequency: null,
            }
          : null,
      }),
    );

    render(
      <DistributionPanel
        region="indo_gangetic_plain"
        predictor="tmax"
        season="jjas"
        delta={2}
        autoLoad
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('— – —')).toBeInTheDocument();
  });

  it('shows the failure without substituting an offline estimate', async () => {
    mockDistribution.mockRejectedValue(new Error('Distribution endpoint returned 503'));

    render(
      <DistributionPanel
        region="indo_gangetic_plain"
        predictor="tmax"
        season="jjas"
        delta={2}
        autoLoad
      />,
    );

    expect(await screen.findByText(/Distribution endpoint returned 503/)).toBeInTheDocument();
    expect(screen.getByText(/no offline estimate is shown/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(/15\.6%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Residual σ/i)).not.toBeInTheDocument();
  });
});

// ── BaselineSplitPanel ────────────────────────────────────────────────────────

describe('BaselineSplitPanel', () => {
  it('renders both epoch slopes and the difference test', async () => {
    mockBaseline.mockResolvedValue(baselineFixture());

    render(
      <BaselineSplitPanel region="indo_gangetic_plain" predictor="tmax" season="jjas" autoLoad />,
    );

    expect(await screen.findByText('-0.3986')).toBeInTheDocument();
    expect(screen.getByText('-0.5422')).toBeInTheDocument();
    expect(screen.getByText('p = 0.399')).toBeInTheDocument();
    expect(screen.getByText('1981–2002')).toBeInTheDocument();
    expect(screen.getByText('2003–2025')).toBeInTheDocument();
    expect(screen.getByText('n = 22')).toBeInTheDocument();
    expect(screen.getByText('n = 23')).toBeInTheDocument();
  });

  it('uses negative language when the slope difference is not significant', async () => {
    mockBaseline.mockResolvedValue(baselineFixture());

    render(
      <BaselineSplitPanel region="indo_gangetic_plain" predictor="tmax" season="jjas" autoLoad />,
    );

    expect(await screen.findByText(/Not a demonstrated change/i)).toBeInTheDocument();
    expect(
      screen.getByText(/The record does not demonstrate a change in slope/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Slope changed/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/significantly different slopes/i),
    ).not.toBeInTheDocument();
  });

  it('states the change plainly when the difference is significant', async () => {
    const fixture = baselineFixture();
    mockBaseline.mockResolvedValue(
      baselineFixture({
        difference: {
          ...fixture.difference,
          slope_delta_p_value: 0.012,
          slope_delta_ci95_low: -0.29,
          slope_delta_ci95_high: -0.04,
          slope_changed_significantly: true,
        },
      }),
    );

    render(
      <BaselineSplitPanel region="indo_gangetic_plain" predictor="tmax" season="jjas" autoLoad />,
    );

    expect(await screen.findByText(/Slope changed/i)).toBeInTheDocument();
    expect(screen.getByText(/significantly different slopes/i)).toBeInTheDocument();
  });

  it('renders the mean shift rows and all caveats', async () => {
    const fixture = baselineFixture();
    mockBaseline.mockResolvedValue(fixture);

    render(
      <BaselineSplitPanel region="indo_gangetic_plain" predictor="tmax" season="jjas" autoLoad />,
    );

    expect(await screen.findByText('−0.285')).toBeInTheDocument();
    expect(screen.getByText('−6.2%')).toBeInTheDocument();
    expect(screen.getByText('+0.600')).toBeInTheDocument();
    for (const caveat of fixture.caveats) {
      expect(screen.getByText(caveat)).toBeInTheDocument();
    }
  });

  it('renders nulls as em dashes rather than zeros', async () => {
    const fixture = baselineFixture();
    mockBaseline.mockResolvedValue(
      baselineFixture({
        difference: {
          ...fixture.difference,
          slope_delta: null,
          slope_delta_se: null,
          slope_delta_ci95_low: null,
          slope_delta_ci95_high: null,
          slope_delta_p_value: null,
          response_mean_delta: null,
          response_mean_delta_percent: null,
          predictor_mean_delta: null,
        },
        older: { ...fixture.older, fit: fitFixture({ slope: null }), response_mean: null },
      }),
    );

    render(
      <BaselineSplitPanel region="indo_gangetic_plain" predictor="tmax" season="jjas" autoLoad />,
    );

    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('—%')).toBeInTheDocument();
  });

  it('shows the failure without substituting an offline estimate', async () => {
    mockBaseline.mockRejectedValue(new Error('Baseline comparison endpoint returned 503'));

    render(
      <BaselineSplitPanel region="indo_gangetic_plain" predictor="tmax" season="jjas" autoLoad />,
    );

    expect(
      await screen.findByText(/Baseline comparison endpoint returned 503/),
    ).toBeInTheDocument();
    expect(screen.getByText(/no offline estimate is shown/i)).toBeInTheDocument();
    expect(screen.queryByText('-0.3986')).not.toBeInTheDocument();
    expect(screen.queryByText('-0.5422')).not.toBeInTheDocument();
    expect(screen.queryByText(/p = /)).not.toBeInTheDocument();
  });
});
