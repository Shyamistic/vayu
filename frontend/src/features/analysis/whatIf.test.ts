/**
 * Tests for the What-If studio's pure formatting, derivation, and export logic.
 *
 * Focused on the rules a reviewer would question: how weak fits are graded, how
 * the confidence band is shaped, and whether an export file is self-describing
 * and free of fabricated values.
 */

import { describe, expect, it } from 'vitest';

import type { RegressionFit, SensitivityPoint, WhatIfResponse } from '../../types';
import {
  buildRegressionLine,
  compareToClausiusClapeyron,
  confidenceLevel,
  describeBeforeAfter,
  describeSensitivity,
  distributionShares,
  fmt,
  fmtCI,
  fmtPValue,
  fmtSigned,
  fmtVolume,
  orderEpochs,
  predictorById,
  regionLabel,
} from './whatIfFormat';
import {
  buildWhatIfExport,
  buildWhatIfReportHtml,
  whatIfFilename,
  whatIfToCsv,
  whatIfToJson,
  WHATIF_CSV_COLUMNS,
  type WhatIfExportMeta,
} from './whatIfExport';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFit(overrides: Partial<RegressionFit> = {}): RegressionFit {
  return {
    slope: -0.4884,
    intercept: 4.4657,
    r_squared: 0.4318,
    p_value: 9.45e-7,
    std_err: 0.0854,
    ci95_low: -0.6606,
    ci95_high: -0.3161,
    n: 45,
    predictor: 'tmax',
    response: 'rainfall',
    predictor_unit: '°C',
    response_unit: 'mm/day',
    slope_unit: 'mm/day per °C',
    predictor_climatology: 33.53,
    response_climatology: 4.4657,
    slope_percent_per_unit: -10.94,
    significant: true,
    ...overrides,
  };
}

function makePoints(n = 10): SensitivityPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const anomaly = i - (n - 1) / 2;
    const fitted = 4.4657 - 0.4884 * anomaly;
    const observed = fitted + (i % 3 === 0 ? 0.3 : -0.2);
    return {
      year: 1981 + i,
      predictor_value: 33.53 + anomaly,
      predictor_anomaly: anomaly,
      response_value: observed,
      fitted_value: fitted,
      residual: observed - fitted,
      valid_days: 122,
    };
  });
}

function makeResult(overrides: Partial<WhatIfResponse> = {}): WhatIfResponse {
  return {
    region: 'indo_gangetic_plain',
    season: 'jjas',
    season_label: 'Monsoon JJAS (Jun-Sep)',
    delta_predictor: 2,
    fit: makeFit(),
    regional: {
      baseline: 4.4657,
      scenario: 3.489,
      delta: -0.9767,
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
        id: 'future', label: 'Projected at +2 °C', year_start: null, year_end: null,
        value: 3.498, uncertainty: 0.3446, uncertainty_kind: 'regression_ci',
        observed: false, delta_vs_current: -0.9767,
      },
      {
        id: 'past', label: 'Past (1981-1995)', year_start: 1981, year_end: 1995,
        value: 4.5225, uncertainty: 0.2044, uncertainty_kind: 'observed_sem',
        observed: true, delta_vs_current: 0.0477,
      },
      {
        id: 'current', label: 'Current (2011-2025)', year_start: 2011, year_end: 2025,
        value: 4.4748, uncertainty: 0.2211, uncertainty_kind: 'observed_sem',
        observed: true, delta_vs_current: 0,
      },
    ],
    distribution: {
      cells_wetter: 98, cells_drier: 1448, cells_significant: 712,
      cells_total: 1546, clamped_cells: 0,
    },
    hotspots: [
      {
        node_idx: 1904, lat: 30.5, lon: 77.5, delta_value: -4.1076,
        delta_percent: -54.01, significant: true, percentile_rank: 100,
        selection_basis: 'significant cells (p<0.05)',
      },
    ],
    caveats: ['The slope is an observed co-variability relationship.'],
    provenance: { dataset: 'normalized_1981-2025.nc' },
    scatter: makePoints(),
    excluded_years: [1981],
    computation_time_s: 0.007,
    lats: [29, 29.25],
    lons: [77, 77.25, 77.5],
    cell_baseline: [5, 6, 7, 8, null, 9],
    cell_scenario: [4, 5, 6, 7, null, 8],
    cell_delta: [-1, -1, -1, -1, null, -1],
    cell_delta_percent: [-20, -16.7, -14.3, -12.5, null, -11.1],
    cell_delta_uncertainty: [0.3, 0.3, 0.3, 0.3, null, 0.3],
    cell_significant: [true, true, false, true, false, true],
    ...overrides,
  };
}

const META: WhatIfExportMeta = {
  region: 'indo_gangetic_plain',
  predictor: 'tmax',
  season: 'jjas',
  delta: 2,
  startYear: 1981,
  endYear: 2025,
  generatedAt: '2026-08-06T00:00:00.000Z',
};

// ── Number formatting ─────────────────────────────────────────────────────────

describe('number formatting', () => {
  it('renders nulls and non-finite values as an em dash instead of NaN', () => {
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    expect(fmt(Number.NaN)).toBe('—');
    expect(fmt(Number.POSITIVE_INFINITY)).toBe('—');
    expect(fmtSigned(null)).toBe('—');
    expect(fmtVolume(null)).toBe('—');
  });

  it('formats to the requested precision', () => {
    expect(fmt(4.46571, 2)).toBe('4.47');
    expect(fmt(4.46571, 4)).toBe('4.4657');
  });

  it('always shows the direction of a signed value', () => {
    expect(fmtSigned(1.5)).toBe('+1.50');
    expect(fmtSigned(-1.5)).toBe('−1.50');
    expect(fmtSigned(0)).toBe('0.00');
  });

  it('reports very small p-values as an upper bound, never as zero', () => {
    expect(fmtPValue(9.45e-7)).toBe('p < 0.0001');
    expect(fmtPValue(0.0005)).toBe('p < 0.001');
    expect(fmtPValue(0.023)).toBe('p = 0.023');
    expect(fmtPValue(null)).toBe('—');
  });

  it('renders confidence intervals as a bracketed pair', () => {
    expect(fmtCI(-0.66, -0.32, 2)).toBe('[-0.66, -0.32]');
    expect(fmtCI(null, -0.32)).toBe('—');
  });

  it('switches volume units below one cubic kilometre', () => {
    expect(fmtVolume(-127.46)).toBe('−127.5 km³');
    expect(fmtVolume(0.25)).toBe('+250.0 million m³');
  });
});

// ── Confidence grading ────────────────────────────────────────────────────────

describe('confidenceLevel', () => {
  it('requires significance before any grade is awarded', () => {
    expect(confidenceLevel(makeFit({ p_value: 0.2, r_squared: 0.8 }))).toBe('none');
  });

  it('grades on explained variance once significant', () => {
    expect(confidenceLevel(makeFit({ p_value: 0.01, r_squared: 0.45 }))).toBe('strong');
    expect(confidenceLevel(makeFit({ p_value: 0.01, r_squared: 0.25 }))).toBe('moderate');
    expect(confidenceLevel(makeFit({ p_value: 0.01, r_squared: 0.05 }))).toBe('weak');
  });

  it('does not call a significant-but-low-r² fit strong', () => {
    // The real Western Ghats SST fit: p=0.048 yet r²=0.09.
    expect(confidenceLevel(makeFit({ p_value: 0.048, r_squared: 0.09 }))).toBe('weak');
  });

  it('treats a missing p-value as ungraded', () => {
    expect(confidenceLevel(makeFit({ p_value: null }))).toBe('none');
  });
});

// ── Interpretation copy ───────────────────────────────────────────────────────

describe('interpretation copy', () => {
  it('states the direction of the sensitivity in words', () => {
    const text = describeSensitivity(makeFit(), 'indo_gangetic_plain');
    expect(text).toContain('less');
    expect(text).toContain('Indo-Gangetic Plain');
    expect(text).toContain('0.488');
  });

  it('says "more" for a positive slope', () => {
    const text = describeSensitivity(makeFit({ slope: 0.3, slope_percent_per_unit: 6 }), 'central_india');
    expect(text).toContain('more');
  });

  it('reports gracefully when no slope could be fitted', () => {
    expect(describeSensitivity(makeFit({ slope: null }), 'central_india')).toContain(
      'No usable sensitivity',
    );
  });

  it('flags that a negative slope contradicts Clausius-Clapeyron', () => {
    const note = compareToClausiusClapeyron(makeFit());
    expect(note).toContain('opposite sign');
    expect(note).toContain('+7');
  });

  it('does not claim a contradiction for a positive slope', () => {
    const note = compareToClausiusClapeyron(makeFit({ slope_percent_per_unit: 5 }));
    expect(note).not.toContain('opposite sign');
  });

  it('skips the comparison for non-rainfall responses', () => {
    expect(compareToClausiusClapeyron(makeFit({ response: 'tmin' }))).toBeNull();
  });

  it('describes before/after with both absolute and percentage change', () => {
    const text = describeBeforeAfter(makeResult());
    expect(text).toContain('falls');
    expect(text).toContain('4.47');
    expect(text).toContain('3.49');
    expect(text).toContain('−21.9%');
  });

  it('handles a missing projection without inventing numbers', () => {
    const result = makeResult();
    result.regional = { ...result.regional, baseline: null };
    expect(describeBeforeAfter(result)).toContain('unavailable');
  });
});

// ── Regression line and band ──────────────────────────────────────────────────

describe('buildRegressionLine', () => {
  it('follows the fitted slope and intercept', () => {
    const fit = makeFit();
    const line = buildRegressionLine(makePoints(), fit)!;
    expect(line).not.toBeNull();
    line.x.forEach((x, i) => {
      expect(line.y[i]).toBeCloseTo(fit.intercept! + fit.slope! * x, 8);
    });
  });

  it('brackets the fit between the band edges', () => {
    const line = buildRegressionLine(makePoints(), makeFit())!;
    line.y.forEach((y, i) => {
      expect(line.lower[i]).toBeLessThanOrEqual(y + 1e-9);
      expect(line.upper[i]).toBeGreaterThanOrEqual(y - 1e-9);
    });
  });

  it('widens the band away from mean conditions', () => {
    const line = buildRegressionLine(makePoints(21), makeFit())!;
    const width = (i: number) => line.upper[i] - line.lower[i];
    const mid = Math.floor(line.x.length / 2);
    expect(width(0)).toBeGreaterThan(width(mid));
    expect(width(line.x.length - 1)).toBeGreaterThan(width(mid));
  });

  it('spans the observed predictor range exactly', () => {
    const points = makePoints(12);
    const anomalies = points.map((p) => p.predictor_anomaly!);
    const line = buildRegressionLine(points, makeFit())!;
    expect(line.x[0]).toBeCloseTo(Math.min(...anomalies), 8);
    expect(line.x[line.x.length - 1]).toBeCloseTo(Math.max(...anomalies), 8);
  });

  it('returns null when there is nothing to fit', () => {
    expect(buildRegressionLine([], makeFit())).toBeNull();
    expect(buildRegressionLine(makePoints(), makeFit({ slope: null }))).toBeNull();
  });

  it('returns null when every point shares one predictor value', () => {
    const flat = makePoints(5).map((p) => ({ ...p, predictor_anomaly: 0 }));
    expect(buildRegressionLine(flat, makeFit())).toBeNull();
  });
});

// ── Derived aggregates ────────────────────────────────────────────────────────

describe('derived aggregates', () => {
  it('orders epochs past, current, then future regardless of input order', () => {
    expect(orderEpochs(makeResult().epochs).map((e) => e.id)).toEqual([
      'past', 'current', 'future',
    ]);
  });

  it('produces distribution shares that sum to 100', () => {
    const s = distributionShares(makeResult());
    expect(s.drierPct + s.wetterPct + s.neutralPct).toBeCloseTo(100, 6);
    expect(s.drierPct).toBeGreaterThan(s.wetterPct);
  });

  it('treats an empty grid as fully neutral rather than dividing by zero', () => {
    const result = makeResult();
    result.distribution = { ...result.distribution, cells_total: 0 };
    expect(distributionShares(result)).toEqual({
      drierPct: 0, wetterPct: 0, neutralPct: 100,
    });
  });

  it('exposes readable region and predictor labels', () => {
    expect(regionLabel('indo_gangetic_plain')).toBe('Indo-Gangetic Plain');
    expect(regionLabel('mystery_region')).toBe('mystery region');
    expect(predictorById('sst').unit).toBe('°C');
  });
});

// ── Export ────────────────────────────────────────────────────────────────────

describe('buildWhatIfExport', () => {
  it('records what was regressed, over which years, and how strongly', () => {
    const payload = buildWhatIfExport(makeResult(), META) as Record<string, any>;
    expect(payload.meta.region).toBe('indo_gangetic_plain');
    expect(payload.meta.driver).toMatchObject({ id: 'tmax', applied_change: 2, unit: '°C' });
    expect(payload.meta.year_range).toEqual({ start: 1981, end: 2025 });
    expect(payload.sensitivity.slope).toBeCloseTo(-0.4884, 4);
    expect(payload.method.description).toContain('Ordinary least squares');
    expect(payload.interpretation.confidence).toBe('strong');
  });

  it('carries the caveats through so a downloaded file states its own limits', () => {
    const payload = buildWhatIfExport(makeResult(), META) as Record<string, any>;
    expect(payload.interpretation.caveats).toHaveLength(1);
    expect(payload.interpretation.clausius_clapeyron_comparison).toContain('opposite sign');
  });

  it('records the calendar window when a custom range was used', () => {
    const payload = buildWhatIfExport(makeResult(), {
      ...META, windowStart: '07-01', windowEnd: '08-15',
    }) as Record<string, any>;
    expect(payload.meta.calendar_window).toEqual({ start: '07-01', end: '08-15' });
  });

  it('reports a null window when a named season was used', () => {
    const payload = buildWhatIfExport(makeResult(), META) as Record<string, any>;
    expect(payload.meta.calendar_window).toBeNull();
  });

  it('documents the grid ordering alongside the grid', () => {
    const payload = buildWhatIfExport(makeResult(), META) as Record<string, any>;
    expect(payload.grid.ordering).toContain('row-major');
    expect(payload.grid.cell_delta).toHaveLength(6);
  });

  it('omits the grid block when no cells were requested', () => {
    const result = makeResult();
    delete result.lats;
    delete result.lons;
    const payload = buildWhatIfExport(result, META) as Record<string, any>;
    expect(payload.grid).toBeNull();
  });

  it('serializes to valid JSON', () => {
    const json = whatIfToJson(makeResult(), META);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toContain('NaN');
  });
});

describe('whatIfToCsv', () => {
  it('emits one row per cell that has observations', () => {
    const rows = whatIfToCsv(makeResult()).split('\n');
    expect(rows[0]).toBe(WHATIF_CSV_COLUMNS.join(','));
    // Six cells, one of which is null (ocean) and must be skipped.
    expect(rows).toHaveLength(6);
  });

  it('reconstructs coordinates from row-major ordering', () => {
    const rows = whatIfToCsv(makeResult()).split('\n');
    // idx 0 -> lat[0], lon[0]; idx 3 -> lat[1], lon[0]
    expect(rows[1]).toContain('29.0000,77.0000');
    expect(rows[4]).toContain('29.2500,77.0000');
  });

  it('returns just the header when the response carried no grid', () => {
    const result = makeResult();
    delete result.cell_delta;
    expect(whatIfToCsv(result)).toBe(WHATIF_CSV_COLUMNS.join(','));
  });
});

describe('buildWhatIfReportHtml', () => {
  const html = buildWhatIfReportHtml(makeResult(), META);

  it('is a complete standalone document', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
  });

  it('leads with the region, season, and driver', () => {
    expect(html).toContain('Indo-Gangetic Plain');
    expect(html).toContain('Monsoon JJAS');
    expect(html).toContain('Max temperature');
  });

  it('reports the full regression diagnostic set', () => {
    expect(html).toContain('r² = 0.432');
    expect(html).toContain('p &lt; 0.0001');
    expect(html).toContain('n = 45 seasons');
    expect(html).toContain('Standard error');
    expect(html).toContain('95% confidence interval');
  });

  it('names the excluded years rather than hiding them', () => {
    expect(html).toContain('Excluded years: 1981');
  });

  it('distinguishes observed epochs from the projected one', () => {
    expect(html).toContain('Observed');
    expect(html).toContain('Projected');
    expect(html).toContain('not a forecast');
  });

  it('includes the caveats section', () => {
    expect(html).toContain('Limits of this result');
    expect(html).toContain('co-variability');
  });

  it('escapes markup so injected strings cannot break the document', () => {
    const evil = makeResult({ caveats: ['<script>alert(1)</script>'] });
    const out = buildWhatIfReportHtml(evil, META);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('whatIfFilename', () => {
  it('encodes the run parameters and the date', () => {
    expect(whatIfFilename(META, 'json')).toBe(
      'vayu_whatif_indo_gangetic_plain_jjas_tmax_p200_2026-08-06.json',
    );
  });

  it('marks a negative driver change distinctly from a positive one', () => {
    const neg = whatIfFilename({ ...META, delta: -2 }, 'csv');
    expect(neg).toContain('_m200_');
    expect(neg.endsWith('.csv')).toBe(true);
  });
});
