/**
 * Tests for the What-If diagnostics panels: the before/after heatmap comparison
 * and the residual error analytics.
 *
 * The maths is asserted directly against hand-computed values, and the rendered
 * output is asserted on DOM text and ARIA rather than pixels — jsdom has no 2D
 * canvas context, so anything that depended on drawn pixels would be testing
 * nothing at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { RegressionFit, SensitivityPoint, WhatIfResponse } from '../../types';
import WhatIfHeatmapCompare, {
  cellCounts,
  computeDivergingDomain,
  computeSharedDomain,
  domainT,
  extractCellGrid,
  gridBounds,
  halfStep,
} from './WhatIfHeatmapCompare';
import WhatIfErrorAnalytics, {
  histogramBins,
  normalQuantile,
  qqPoints,
  residualMetrics,
  spatialUncertaintySummary,
} from './WhatIfErrorAnalytics';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The real Indo-Gangetic Plain JJAS tmax→rainfall fit. */
function makeFit(overrides: Partial<RegressionFit> = {}): RegressionFit {
  return {
    slope: -0.4884,
    intercept: 4.4657,
    r_squared: 0.4318,
    p_value: 9.45e-7,
    std_err: 0.0854,
    ci95_low: -0.6606,
    ci95_high: -0.3161,
    n: 10,
    predictor: 'tmax',
    response: 'rainfall',
    predictor_unit: '°C',
    response_unit: 'mm/day',
    slope_unit: 'mm/day per °C',
    predictor_climatology: 33.53,
    response_climatology: 4.466,
    slope_percent_per_unit: -10.94,
    significant: true,
    ...overrides,
  };
}

/**
 * Ten seasons on the fitted line. The residuals are a fixed list that sums to
 * zero with a lag-1 autocorrelation of about −0.34 — enough structure to be
 * realistic, deliberately under the ±0.40 serial-dependence flag so the
 * "unflagged" path is exercised too.
 */
const RESIDUALS_10 = [0.3, -0.1, 0.25, 0.18, -0.35, 0.12, -0.22, 0.28, -0.15, -0.31];

function makeScatter(): SensitivityPoint[] {
  const n = RESIDUALS_10.length;
  return Array.from({ length: n }, (_, i) => {
    const anomaly = i - (n - 1) / 2;
    const fitted = 4.4657 - 0.4884 * anomaly;
    const residual = RESIDUALS_10[i];
    return {
      year: 1981 + i,
      predictor_value: 33.53 + anomaly,
      predictor_anomaly: anomaly,
      response_value: fitted + residual,
      fitted_value: fitted,
      residual,
      valid_days: 122,
    };
  });
}

/** 2 lats x 3 lons = 6 cells, one of which is ocean (null everywhere). */
const LATS = [26, 26.25];
const LONS = [77, 77.25, 77.5];
const CELL_BASELINE = [4.9, 5.1, 5.3, 4.6, null, 4.2];
const CELL_SCENARIO = [3.9, 4.1, 4.3, 3.6, null, 3.2];
const CELL_DELTA = [-1, -1, -1, -1, null, -1];

function makeResult(overrides: Partial<WhatIfResponse> = {}): WhatIfResponse {
  return {
    region: 'indo_gangetic_plain',
    season: 'jjas',
    season_label: 'Monsoon JJAS (Jun-Sep)',
    delta_predictor: 2,
    fit: makeFit(),
    regional: {
      baseline: 4.466,
      scenario: 3.489,
      delta: -0.977,
      delta_percent: -21.87,
      delta_ci95_low: -1.3213,
      delta_ci95_high: -0.6321,
      unit: 'mm/day',
    },
    integral: {
      baseline_volume_km3: 582.8,
      delta_volume_km3: -127.46,
      area_km2: 1069710,
      definition: 'area integral',
    },
    epochs: [
      {
        id: 'current', label: 'Current (2011-2025)', year_start: 2011, year_end: 2025,
        value: 4.4748, uncertainty: 0.2211, uncertainty_kind: 'observed_sem',
        observed: true, delta_vs_current: 0,
      },
    ],
    distribution: {
      cells_wetter: 0, cells_drier: 5, cells_significant: 4,
      cells_total: 5, clamped_cells: 0,
    },
    hotspots: [],
    caveats: ['The slope is an observed co-variability relationship.'],
    provenance: { dataset: 'normalized_1981-2025.nc' },
    scatter: makeScatter(),
    excluded_years: [],
    computation_time_s: 0.008,
    lats: LATS,
    lons: LONS,
    cell_baseline: CELL_BASELINE,
    cell_scenario: CELL_SCENARIO,
    cell_delta: CELL_DELTA,
    cell_delta_percent: [-20.4, -19.6, -18.9, -21.7, null, -23.8],
    cell_delta_uncertainty: [0.3, 0.5, 1.4, 0.35, null, 0.4],
    cell_significant: [true, true, false, true, false, true],
    ...overrides,
  };
}

/**
 * Four residuals chosen so every metric is checkable by hand:
 *   RMSE   = sqrt((1 + 1 + 4 + 4) / 4) = sqrt(2.5)
 *   MAE    = (1 + 1 + 2 + 2) / 4       = 1.5
 *   max    = 2, in 2003
 *   sigma  = sqrt(10 / 3)              (mean is exactly 0)
 *   lag-1  = -7 / 10                   = -0.7
 */
const HAND_RESIDUALS = [1, -1, 2, -2];
const HAND_YEARS = [2001, 2002, 2003, 2004];

function handScatter(): SensitivityPoint[] {
  return HAND_RESIDUALS.map((residual, i) => ({
    year: HAND_YEARS[i],
    predictor_value: 33 + i,
    predictor_anomaly: i - 1.5,
    response_value: 5 + residual,
    fitted_value: 5,
    residual,
    valid_days: 122,
  }));
}

// jsdom has no network. A never-settling fetch keeps the outline effect from
// updating state after a test ends; the one test that cares about the failure
// path stubs a rejection instead.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Pure grid helpers ─────────────────────────────────────────────────────────

describe('grid geometry', () => {
  it('derives half the grid step from the coordinate spacing', () => {
    expect(halfStep([26, 26.25, 26.5])).toBeCloseTo(0.125, 10);
    expect(halfStep([26, 27])).toBeCloseTo(0.5, 10);
  });

  it('falls back to half the 0.25 degree product grid for a single coordinate', () => {
    expect(halfStep([26])).toBeCloseTo(0.125, 10);
  });

  it('expands centres to cell edges', () => {
    expect(gridBounds(LATS, LONS)).toEqual({
      west: 76.875,
      east: 77.625,
      south: 25.875,
      north: 26.375,
    });
  });

  it('accepts a descending latitude axis without flipping the bounds', () => {
    expect(gridBounds([26.25, 26], LONS).south).toBeCloseTo(25.875, 10);
    expect(gridBounds([26.25, 26], LONS).north).toBeCloseTo(26.375, 10);
  });
});

describe('extractCellGrid', () => {
  it('accepts a consistent grid', () => {
    const out = extractCellGrid(makeResult());
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.grid.nLat).toBe(2);
      expect(out.grid.nLon).toBe(3);
      expect(out.grid.significant).toHaveLength(6);
    }
  });

  it('refuses a response with no coordinates instead of guessing dimensions', () => {
    const out = extractCellGrid(makeResult({ lats: undefined, lons: undefined }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('no grid coordinates');
  });

  it('refuses a response with coordinates but no cell fields', () => {
    const out = extractCellGrid(
      makeResult({ cell_baseline: undefined, cell_scenario: undefined }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('no per-cell baseline and scenario');
  });

  it('refuses a length mismatch and names the offending array', () => {
    const out = extractCellGrid(makeResult({ cell_baseline: [1, 2, 3] }));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toContain('cell_baseline (3)');
      expect(out.message).toContain('2 × 3 = 6');
    }
  });
});

describe('computeSharedDomain', () => {
  it('spans every supplied array, not just the first', () => {
    expect(computeSharedDomain(CELL_BASELINE, CELL_SCENARIO)).toEqual({ min: 3.2, max: 5.3 });
  });

  it('differs from either array alone, which is the point of sharing', () => {
    const baselineOnly = computeSharedDomain(CELL_BASELINE);
    const shared = computeSharedDomain(CELL_BASELINE, CELL_SCENARIO);
    expect(baselineOnly).toEqual({ min: 4.2, max: 5.3 });
    expect(shared).not.toEqual(baselineOnly);
  });

  it('ignores nulls and non-finite values', () => {
    expect(computeSharedDomain([null, Number.NaN, 2, undefined, 6])).toEqual({ min: 2, max: 6 });
  });

  it('returns null when nothing is finite so callers cannot draw an empty ramp', () => {
    expect(computeSharedDomain([null, null], undefined)).toBeNull();
    expect(computeSharedDomain()).toBeNull();
  });

  it('pads a flat field rather than producing a zero-width domain', () => {
    expect(computeSharedDomain([4, 4, 4])).toEqual({ min: 3.5, max: 4.5 });
  });
});

describe('computeDivergingDomain', () => {
  it('is symmetric about zero so the neutral colour is exactly zero', () => {
    expect(computeDivergingDomain([-4.1, 0.5, null, 1.2])).toEqual({ min: -4.1, max: 4.1 });
    expect(domainT(0, { min: -4.1, max: 4.1 })).toBeCloseTo(0.5, 12);
  });

  it('gives an all-zero field a unit range instead of dividing by zero', () => {
    expect(computeDivergingDomain([0, 0])).toEqual({ min: -1, max: 1 });
  });

  it('returns null for an absent or wholly empty field', () => {
    expect(computeDivergingDomain(undefined)).toBeNull();
    expect(computeDivergingDomain([null, Number.NaN])).toBeNull();
  });
});

describe('cellCounts', () => {
  it('counts sign and significance only over cells with observations', () => {
    expect(
      cellCounts([-1, -1, 1, 0, null], [true, false, true, false, true]),
    ).toEqual({ valid: 4, drier: 2, wetter: 1, neutral: 1, significant: 2 });
  });

  it('reports nothing rather than zeros when the field is absent', () => {
    expect(cellCounts(undefined, undefined).valid).toBe(0);
  });
});

// ── WhatIfHeatmapCompare rendering ────────────────────────────────────────────

describe('WhatIfHeatmapCompare', () => {
  it('renders the three rasters from the fixture', () => {
    const { container } = render(<WhatIfHeatmapCompare result={makeResult()} />);
    expect(screen.getByRole('heading', { name: /before \/ after maps/i })).toBeInTheDocument();
    expect(container.querySelectorAll('canvas')).toHaveLength(3);
    expect(screen.getByLabelText(/^Baseline rainfall map/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Projected rainfall map/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Change in rainfall per cell/)).toBeInTheDocument();
  });

  it('states a clear message and draws nothing when the cell arrays are absent', () => {
    const { container } = render(
      <WhatIfHeatmapCompare
        result={makeResult({
          lats: undefined,
          lons: undefined,
          cell_baseline: undefined,
          cell_scenario: undefined,
          cell_delta: undefined,
        })}
      />,
    );
    expect(screen.getByTestId('heatmap-unavailable')).toHaveTextContent(
      /no grid coordinates, so there is nothing to map/i,
    );
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('also refuses to draw when the arrays do not match the coordinates', () => {
    const { container } = render(
      <WhatIfHeatmapCompare result={makeResult({ cell_scenario: [1, 2] })} />,
    );
    expect(screen.getByTestId('heatmap-unavailable')).toHaveTextContent(/cell_scenario \(2\)/);
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('reports one shared min/max for baseline and scenario', () => {
    render(<WhatIfHeatmapCompare result={makeResult()} />);
    const legend = screen.getByTestId('shared-domain-legend');
    // 3.20 is the scenario minimum and 5.30 the baseline maximum: a single
    // domain spanning both arrays, not one scale per map.
    expect(legend).toHaveAttribute('data-domain', 'shared domain 3.20 to 5.30 mm/day');
    expect(legend).toHaveTextContent('3.20 mm/day');
    expect(legend).toHaveTextContent('5.30 mm/day');
    expect(legend).toHaveTextContent(/One domain across both maps/i);
  });

  it('quotes the same domain in both raster labels', () => {
    render(<WhatIfHeatmapCompare result={makeResult()} />);
    const baseline = screen.getByLabelText(/^Baseline rainfall map/);
    const scenario = screen.getByLabelText(/^Projected rainfall map/);
    expect(baseline.getAttribute('aria-label')).toContain('from 3.20 to 5.30 mm/day');
    expect(scenario.getAttribute('aria-label')).toContain('from 3.20 to 5.30 mm/day');
  });

  it('summarises the regional change with its interval and the cell counts', () => {
    render(<WhatIfHeatmapCompare result={makeResult()} />);
    const summary = screen.getByTestId('regional-summary');
    const text = (summary.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('4.47 mm/day');
    expect(text).toContain('3.49 mm/day');
    expect(text).toContain('\u22120.98 mm/day'); // signed with a true minus sign
    expect(text).toContain('[-1.32, -0.63]');
    // Five of the six cells carry a delta; four of those are locally significant
    // and none are wetter.
    expect(text).toContain('Cells mapped: 5');
    expect(text).toContain('Drier (\u2212): 5');
    expect(text).toContain('Wetter (+): 0');
    expect(text).toContain('Locally significant: 4');
  });

  it('renders nulls in the summary as em dashes rather than zeros', () => {
    const result = makeResult();
    result.regional = {
      ...result.regional,
      delta: null,
      delta_ci95_low: null,
      delta_ci95_high: null,
    };
    render(<WhatIfHeatmapCompare result={result} />);
    const summary = screen.getByTestId('regional-summary');
    expect(summary.textContent).toContain('—');
    expect(summary.textContent).not.toContain('0.00 mm/day');
  });

  it('says so when the coastline mask cannot be loaded instead of implying it applied', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<WhatIfHeatmapCompare result={makeResult()} />);
    expect(
      await screen.findByText(/coastline mask could not be loaded/i),
    ).toBeInTheDocument();
  });
});

// ── Pure error maths ──────────────────────────────────────────────────────────

describe('residualMetrics', () => {
  const m = residualMetrics(handScatter());

  it('computes RMSE as the root mean square residual', () => {
    expect(m.rmse).toBeCloseTo(1.5811388300841898, 12); // sqrt(2.5)
  });

  it('computes MAE as the mean absolute residual', () => {
    expect(m.mae).toBeCloseTo(1.5, 12);
  });

  it('reports the largest absolute residual with the year it happened', () => {
    expect(m.maxAbs).toBeCloseTo(2, 12);
    expect(m.maxAbsYear).toBe(2003);
  });

  it('computes the residual sigma with an n-1 denominator', () => {
    expect(m.sigma).toBeCloseTo(1.8257418583505538, 12); // sqrt(10/3)
  });

  it('computes lag-1 autocorrelation of the year-ordered series', () => {
    expect(m.lag1).toBeCloseTo(-0.7, 12);
  });

  it('orders by year before the lag-1 term, so input order cannot change it', () => {
    const shuffled = [handScatter()[2], handScatter()[0], handScatter()[3], handScatter()[1]];
    expect(residualMetrics(shuffled).lag1).toBeCloseTo(-0.7, 12);
    expect(residualMetrics(shuffled).years).toEqual(HAND_YEARS);
  });

  it('drops seasons with no residual instead of scoring them as zero error', () => {
    const withGap = [...handScatter(), {
      year: 2005, predictor_value: null, predictor_anomaly: null,
      response_value: null, fitted_value: null, residual: null, valid_days: 3,
    } satisfies SensitivityPoint];
    const out = residualMetrics(withGap);
    expect(out.n).toBe(4);
    expect(out.rmse).toBeCloseTo(1.5811388300841898, 12);
  });

  it('leaves sigma and lag-1 null when there is not enough series to compute them', () => {
    const single = residualMetrics([handScatter()[0]]);
    expect(single.n).toBe(1);
    expect(single.rmse).toBeCloseTo(1, 12);
    expect(single.sigma).toBeNull();
    expect(single.lag1).toBeNull();
  });

  it('returns all-null metrics for an empty scatter', () => {
    const empty = residualMetrics([]);
    expect(empty).toMatchObject({ n: 0, rmse: null, mae: null, sigma: null, lag1: null });
  });
});

describe('normalQuantile', () => {
  it('is zero at the median', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 12);
  });

  it('matches the standard normal critical values', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963985, 6);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959963985, 6);
    expect(normalQuantile(0.95)).toBeCloseTo(1.644853627, 6);
  });

  it('is accurate in the tails, where the plotting positions land', () => {
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232306, 6);
    expect(normalQuantile(0.999)).toBeCloseTo(3.090232306, 6);
  });

  it('is antisymmetric and monotonic', () => {
    for (const p of [0.01, 0.1, 0.3, 0.45]) {
      expect(normalQuantile(p)).toBeCloseTo(-normalQuantile(1 - p), 8);
    }
    expect(normalQuantile(0.2)).toBeLessThan(normalQuantile(0.8));
  });

  it('clamps rather than returning an infinity at the boundaries', () => {
    expect(Number.isFinite(normalQuantile(0))).toBe(true);
    expect(Number.isFinite(normalQuantile(1))).toBe(true);
    expect(Number.isNaN(normalQuantile(Number.NaN))).toBe(true);
  });
});

describe('qqPoints', () => {
  it('produces one pair per residual', () => {
    expect(qqPoints(HAND_RESIDUALS)).toHaveLength(4);
    expect(qqPoints(makeScatter().map((p) => p.residual as number))).toHaveLength(10);
  });

  it('sorts the sample ascending', () => {
    const samples = qqPoints(HAND_RESIDUALS).map((p) => p.sample);
    expect(samples).toEqual([-2, -1, 1, 2]);
  });

  it('uses the Blom plotting position (i - 0.375) / (n + 0.25)', () => {
    const pts = qqPoints(HAND_RESIDUALS);
    expect(pts[0].theoretical).toBeCloseTo(normalQuantile((1 - 0.375) / (4 + 0.25)), 12);
    expect(pts[3].theoretical).toBeCloseTo(normalQuantile((4 - 0.375) / (4 + 0.25)), 12);
  });

  it('is symmetric for a symmetric sample', () => {
    const pts = qqPoints(HAND_RESIDUALS);
    expect(pts[0].theoretical).toBeCloseTo(-pts[3].theoretical, 12);
  });
});

describe('histogramBins', () => {
  it('bins every value exactly once, including the maximum', () => {
    const bins = histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(bins).toHaveLength(5);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(10);
  });

  it('collapses a flat sample to one bin instead of dividing by zero', () => {
    expect(histogramBins([2, 2, 2])).toEqual([{ start: 1.5, end: 2.5, count: 3 }]);
  });

  it('returns no bins for an empty sample', () => {
    expect(histogramBins([])).toEqual([]);
  });
});

describe('spatialUncertaintySummary', () => {
  it('summarises median, max, and the share of cells with a resolved sign', () => {
    const out = spatialUncertaintySummary([-1, -2, null, -0.1], [0.3, 0.5, 0.2, 0.5]);
    expect(out.n).toBe(3);
    expect(out.median).toBeCloseTo(0.5, 12);
    expect(out.max).toBeCloseTo(0.5, 12);
    expect(out.resolvedFraction).toBeCloseTo(2 / 3, 12);
  });

  it('averages the two middle values for an even count', () => {
    const out = spatialUncertaintySummary([1, 1, 1, 1], [0.1, 0.2, 0.4, 0.5]);
    expect(out.median).toBeCloseTo(0.3, 12);
  });

  it('reports nothing when either array is absent', () => {
    expect(spatialUncertaintySummary(undefined, [0.1])).toEqual({
      n: 0, median: null, max: null, resolvedFraction: null,
    });
  });
});

// ── WhatIfErrorAnalytics rendering ────────────────────────────────────────────

describe('WhatIfErrorAnalytics', () => {
  it('renders the four diagnostics from the fixture', () => {
    render(<WhatIfErrorAnalytics result={makeResult()} />);
    expect(screen.getByRole('heading', { name: /error analytics/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /residuals vs fitted/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /residual distribution/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /normal q-q/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /residual vs year/i })).toBeInTheDocument();
  });

  it('gives every plot a role of img and a title', () => {
    const { container } = render(<WhatIfErrorAnalytics result={makeResult()} />);
    const svgs = container.querySelectorAll('svg[role="img"]');
    expect(svgs).toHaveLength(4);
    svgs.forEach((svg) => {
      expect(svg.querySelector('title')?.textContent?.length).toBeGreaterThan(0);
      expect(svg.getAttribute('aria-label')?.length).toBeGreaterThan(0);
    });
  });

  it('names heteroscedasticity and curvature as what the first plot checks', () => {
    render(<WhatIfErrorAnalytics result={makeResult()} />);
    expect(screen.getByText(/heteroscedasticity and curvature check/i)).toBeInTheDocument();
  });

  it('plots one Q-Q point per residual', () => {
    const { container } = render(<WhatIfErrorAnalytics result={makeResult()} />);
    expect(container.querySelectorAll('.qq-point')).toHaveLength(10);
  });

  it('plots one Q-Q point per residual for a four-season fixture too', () => {
    const { container } = render(
      <WhatIfErrorAnalytics result={makeResult({ scatter: handScatter() })} />,
    );
    expect(container.querySelectorAll('.qq-point')).toHaveLength(4);
    expect(container.querySelectorAll('.resid-point')).toHaveLength(4);
    expect(container.querySelectorAll('.year-point')).toHaveLength(4);
  });

  it('shows the hand-computed error metrics', () => {
    render(<WhatIfErrorAnalytics result={makeResult({ scatter: handScatter() })} />);
    expect(screen.getByTestId('metric-rmse')).toHaveTextContent('1.581');
    expect(screen.getByTestId('metric-mae')).toHaveTextContent('1.500');
    expect(screen.getByTestId('metric-maxabs')).toHaveTextContent('2.000');
    expect(screen.getByTestId('metric-maxabs')).toHaveTextContent('in 2003');
    expect(screen.getByTestId('metric-sigma')).toHaveTextContent('1.826');
    expect(screen.getByTestId('metric-lag1').textContent).toContain('\u22120.700');
  });

  it('flags serial dependence above the threshold as optimistic standard errors', () => {
    render(<WhatIfErrorAnalytics result={makeResult({ scatter: handScatter() })} />);
    expect(screen.getByText(/Consecutive seasons are not independent/i)).toBeInTheDocument();
  });

  it('does not flag serial dependence when the residuals are not correlated', () => {
    render(<WhatIfErrorAnalytics result={makeResult()} />);
    expect(screen.queryByText(/Consecutive seasons are not independent/i)).toBeNull();
  });

  it('renders unavailable metrics as em dashes rather than zeros', () => {
    render(
      <WhatIfErrorAnalytics result={makeResult({ scatter: [handScatter()[0]] })} />,
    );
    expect(screen.getByTestId('metric-sigma')).toHaveTextContent('—');
    expect(screen.getByTestId('metric-lag1')).toHaveTextContent('—');
    expect(screen.getByTestId('metric-maxabs')).toHaveTextContent('in 2001');
  });

  it('summarises per-cell uncertainty and how often the sign is resolved', () => {
    render(<WhatIfErrorAnalytics result={makeResult()} />);
    // Uncertainties 0.3, 0.5, 1.4, 0.35, 0.4 against |delta| = 1 everywhere:
    // four of five cells resolve the sign.
    expect(screen.getByTestId('resolved-fraction')).toHaveTextContent('80.0%');
  });

  it('says there is nothing to diagnose rather than drawing empty axes', () => {
    const { container } = render(<WhatIfErrorAnalytics result={makeResult({ scatter: [] })} />);
    expect(screen.getByTestId('error-analytics-empty')).toBeInTheDocument();
    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(0);
  });
});
