/**
 * Pure formatting and derivation helpers for the What-If studio.
 *
 * Kept separate from the components so the numeric presentation rules — which
 * are the part a reviewer will scrutinise — are unit-testable without mounting
 * Plotly or the React tree.
 */

import type {
  EpochSummary,
  PredictorId,
  RegressionFit,
  SeasonId,
  SensitivityPoint,
  WhatIfResponse,
} from '../../types';

// ── Option catalogues ─────────────────────────────────────────────────────────

export interface PredictorOption {
  id: PredictorId;
  label: string;
  /** Short driver name used in sentences, e.g. "max temperature". */
  noun: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultDelta: number;
  description: string;
}

/** Drivers available for regression. Ranges bracket plausible 21st-century change. */
export const PREDICTORS: PredictorOption[] = [
  {
    id: 'tmax',
    label: 'Max temperature',
    noun: 'daytime maximum temperature',
    unit: '°C',
    min: -2,
    max: 4,
    step: 0.25,
    defaultDelta: 2,
    description:
      'Regional mean daily maximum temperature from the IMD gridded record. The primary ∂R/∂T driver.',
  },
  {
    id: 'tmin',
    label: 'Min temperature',
    noun: 'night-time minimum temperature',
    unit: '°C',
    min: -2,
    max: 4,
    step: 0.25,
    defaultDelta: 2,
    description:
      'Regional mean daily minimum temperature. Warms faster than tmax in most of India.',
  },
  {
    id: 'sst',
    label: 'Sea-surface temp',
    noun: 'sea-surface temperature',
    unit: '°C',
    min: -2,
    max: 3,
    step: 0.25,
    defaultDelta: 1,
    description:
      'NOAA OISST sea-surface temperature, the El Niño / Indian Ocean driver of monsoon strength.',
  },
  {
    id: 'lst',
    label: 'Land-surface temp',
    noun: 'land-surface temperature',
    unit: '°C',
    min: -2,
    max: 4,
    step: 0.25,
    defaultDelta: 2,
    description:
      'Satellite land-surface temperature — the skin temperature that drives surface heat flux.',
  },
];

export interface SeasonOption {
  id: SeasonId;
  label: string;
  short: string;
}

export const SEASONS: SeasonOption[] = [
  { id: 'jjas', label: 'Monsoon (Jun–Sep)', short: 'JJAS' },
  { id: 'annual', label: 'Full year', short: 'Annual' },
  { id: 'mam', label: 'Pre-monsoon (Mar–May)', short: 'MAM' },
  { id: 'on', label: 'Post-monsoon (Oct–Nov)', short: 'ON' },
  { id: 'djf', label: 'Winter (Dec–Feb)', short: 'DJF' },
];

export const REGION_LABELS: Record<string, string> = {
  western_ghats: 'Western Ghats',
  north_east_india: 'North-East India',
  indo_gangetic_plain: 'Indo-Gangetic Plain',
  central_india: 'Central India',
  full_india: 'All India',
};

export function predictorById(id: PredictorId): PredictorOption {
  return PREDICTORS.find((p) => p.id === id) ?? PREDICTORS[0];
}

export function regionLabel(region: string): string {
  return REGION_LABELS[region] ?? region.replace(/_/g, ' ');
}

// ── Number formatting ─────────────────────────────────────────────────────────

/** Format a possibly-null number, showing an em dash when data is absent. */
export function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

/** Format with an explicit sign, so a delta always reads as a change. */
export function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}`;
}

/**
 * Render a p-value the way a journal would: very small values as an upper
 * bound rather than as `0.000`, which reads as "exactly zero".
 */
export function fmtPValue(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  if (p < 0.0001) return 'p < 0.0001';
  if (p < 0.001) return 'p < 0.001';
  return `p = ${p.toFixed(3)}`;
}

export function fmtCI(
  low: number | null | undefined,
  high: number | null | undefined,
  digits = 3,
): string {
  if (low === null || low === undefined || high === null || high === undefined) return '—';
  if (!Number.isFinite(low) || !Number.isFinite(high)) return '—';
  return `[${low.toFixed(digits)}, ${high.toFixed(digits)}]`;
}

/** Compact volume rendering: km³ for large numbers, million m³ below 1 km³. */
export function fmtVolume(km3: number | null | undefined): string {
  if (km3 === null || km3 === undefined || !Number.isFinite(km3)) return '—';
  const abs = Math.abs(km3);
  if (abs >= 1) return `${fmtSigned(km3, 1)} km³`;
  return `${fmtSigned(km3 * 1000, 1)} million m³`;
}

// ── Interpretation ────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'strong' | 'moderate' | 'weak' | 'none';

/**
 * Grade a fit from its significance and explained variance.
 *
 * Both matter and they can disagree: a fit can clear p<0.05 on 45 years while
 * explaining under a tenth of the variance, which is a real but nearly useless
 * relationship. Grading on the pair stops the UI from calling that "strong".
 */
export function confidenceLevel(fit: RegressionFit): ConfidenceLevel {
  const { p_value: p, r_squared: r2 } = fit;
  if (p === null || !Number.isFinite(p)) return 'none';
  if (p >= 0.05) return 'none';
  if (r2 !== null && r2 >= 0.4) return 'strong';
  if (r2 !== null && r2 >= 0.2) return 'moderate';
  return 'weak';
}

export const CONFIDENCE_COPY: Record<ConfidenceLevel, { label: string; detail: string }> = {
  strong: {
    label: 'Strong relationship',
    detail: 'Significant and explains a large share of year-to-year variation.',
  },
  moderate: {
    label: 'Moderate relationship',
    detail: 'Significant, but much of the year-to-year variation is unexplained.',
  },
  weak: {
    label: 'Weak relationship',
    detail: 'Statistically detectable yet explains little variance — indicative only.',
  },
  none: {
    label: 'Not significant',
    detail: 'The record does not support a reliable slope. Treat any projection as illustrative.',
  },
};

/** One-sentence plain-language reading of the sensitivity. */
export function describeSensitivity(fit: RegressionFit, region: string): string {
  const slope = fit.slope;
  if (slope === null || !Number.isFinite(slope)) {
    return `No usable sensitivity could be fitted for ${regionLabel(region)}.`;
  }
  const direction = slope < 0 ? 'less' : 'more';
  const pct = fit.slope_percent_per_unit;
  const pctText =
    pct !== null && Number.isFinite(pct) ? ` (${fmtSigned(pct, 1)}% of the seasonal mean)` : '';
  return (
    `Each +1 ${fit.predictor_unit} of ${predictorNoun(fit.predictor)} coincides with ` +
    `${Math.abs(slope).toFixed(3)} ${fit.response_unit} ${direction} ${fit.response}` +
    `${pctText} across ${regionLabel(region)}.`
  );
}

function predictorNoun(predictor: string): string {
  const match = PREDICTORS.find((p) => p.id === predictor || predictor.includes(p.id));
  return match?.noun ?? predictor;
}

/**
 * Compare the fitted percentage sensitivity against the Clausius-Clapeyron
 * expectation of roughly +7 %/°C for atmospheric moisture capacity.
 *
 * Worth surfacing because the observed Indian monsoon slope is *negative*: hot
 * seasons are dry seasons. Any UI that silently applied +7 %/°C — as the earlier
 * scenario fallback did — had the sign of the response backwards.
 */
export function compareToClausiusClapeyron(fit: RegressionFit): string | null {
  const pct = fit.slope_percent_per_unit;
  if (pct === null || !Number.isFinite(pct)) return null;
  if (fit.response !== 'rainfall') return null;
  if (pct < 0) {
    return (
      `Thermodynamics alone (Clausius-Clapeyron) would predict about +7 %/°C more rainfall. ` +
      `The observed slope is ${fmtSigned(pct, 1)} %/°C — the opposite sign, because hot monsoon ` +
      `seasons over India are dry ones: reduced cloud cover raises temperature while rainfall falls.`
    );
  }
  return (
    `Thermodynamics alone (Clausius-Clapeyron) predicts about +7 %/°C. ` +
    `The observed slope is ${fmtSigned(pct, 1)} %/°C.`
  );
}

// ── Derived series for charts ─────────────────────────────────────────────────

export interface RegressionLine {
  x: number[];
  y: number[];
  upper: number[];
  lower: number[];
}

/**
 * Build the fitted line and its 95 % confidence band across the observed
 * predictor range.
 *
 * The band is the confidence interval of the *mean response*, which widens away
 * from the predictor mean:
 *   se(x) = se_slope * sqrt(Sxx/n + (x - x̄)²)
 * A constant-width band would understate uncertainty at the extremes, which is
 * exactly where a what-if slider spends its time.
 */
export function buildRegressionLine(
  points: SensitivityPoint[],
  fit: RegressionFit,
  steps = 48,
): RegressionLine | null {
  const xs = points
    .map((p) => p.predictor_anomaly)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (xs.length < 2 || fit.slope === null || fit.intercept === null) return null;

  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (!(max > min)) return null;

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((acc, v) => acc + (v - meanX) ** 2, 0);
  const se = fit.std_err ?? 0;
  // t is folded into the reported CI already; recover it so the band matches the
  // interval quoted in the stat strip instead of assuming 1.96.
  const tCrit =
    fit.ci95_high !== null && fit.ci95_low !== null && se > 0
      ? (fit.ci95_high - fit.ci95_low) / (2 * se)
      : 1.96;

  const x: number[] = [];
  const y: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const xv = min + ((max - min) * i) / steps;
    const yv = fit.intercept + fit.slope * xv;
    const half = se > 0 ? tCrit * se * Math.sqrt(sxx / n + (xv - meanX) ** 2) : 0;
    x.push(xv);
    y.push(yv);
    upper.push(yv + half);
    lower.push(yv - half);
  }
  return { x, y, upper, lower };
}

/** Order epochs past → current → future regardless of server ordering. */
export function orderEpochs(epochs: EpochSummary[]): EpochSummary[] {
  const rank: Record<string, number> = { past: 0, current: 1, future: 2 };
  return [...epochs].sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9));
}

/**
 * Share of cells that dried, wetted, or lacked a signal, as percentages that
 * sum to 100 so a stacked bar renders correctly.
 */
export function distributionShares(result: WhatIfResponse): {
  drierPct: number;
  wetterPct: number;
  neutralPct: number;
} {
  const { cells_drier: drier, cells_wetter: wetter, cells_total: total } = result.distribution;
  if (!total) return { drierPct: 0, wetterPct: 0, neutralPct: 100 };
  const drierPct = (100 * drier) / total;
  const wetterPct = (100 * wetter) / total;
  return {
    drierPct,
    wetterPct,
    neutralPct: Math.max(0, 100 - drierPct - wetterPct),
  };
}

/** Headline sentence for the before/after card. */
export function describeBeforeAfter(result: WhatIfResponse): string {
  const { baseline, scenario, delta, delta_percent: pct, unit } = result.regional;
  if (baseline === null || scenario === null || delta === null) {
    return 'Projection unavailable for this configuration.';
  }
  const verb = delta < 0 ? 'falls' : delta > 0 ? 'rises' : 'holds';
  const pctText = pct !== null && Number.isFinite(pct) ? ` (${fmtSigned(pct, 1)}%)` : '';
  return (
    `Seasonal mean ${result.fit.response} ${verb} from ${baseline.toFixed(2)} to ` +
    `${scenario.toFixed(2)} ${unit}${pctText} under a ` +
    `${fmtSigned(result.delta_predictor, 2)} ${result.fit.predictor_unit} change.`
  );
}
