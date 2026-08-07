/**
 * Error visualisation and fit diagnostics for a What-If run.
 *
 * The regression panel shows what the fit predicts. This one shows how wrong it
 * is, which is the part that decides whether the projection means anything:
 *
 *   - Residuals vs fitted exposes heteroscedasticity and curvature. A fan or a
 *     bend here says the single slope quoted upstream is not a fair summary.
 *   - The residual histogram and the normal Q-Q plot test the Gaussian
 *     assumption that every confidence interval and p-value in this studio
 *     rests on, including the distribution panel's percentile shifts.
 *   - Residual vs year exposes drift the fit does not capture — a trend in the
 *     residuals means the predictor is not the only thing that changed.
 *   - Lag-1 autocorrelation matters because OLS standard errors assume
 *     independent seasons. Serially correlated residuals make every interval
 *     narrower than it should be, so it is flagged rather than buried.
 *
 * All four plots are hand-drawn SVG. They are scatter and bar plots over at
 * most a few dozen points; a charting engine would add a megabyte to the bundle
 * and put the axis scaling somewhere a reviewer cannot read it.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Activity } from 'lucide-react';

import type { SensitivityPoint, WhatIfResponse } from '../../types';
import { fmt, fmtSigned, regionLabel } from './whatIfFormat';

export interface WhatIfErrorAnalyticsProps {
  result: WhatIfResponse;
}

// ── Pure maths (unit-tested directly) ─────────────────────────────────────────

/**
 * Inverse standard normal CDF via the Beasley-Springer-Moro / Acklam rational
 * approximation.
 *
 * This is Peter Acklam's algorithm: a central rational polynomial in
 * (p − 0.5)² for the body, and a rational polynomial in sqrt(−2·ln p) for the
 * two tails, with a relative error under 1.15e-9 across (0, 1). That is far
 * tighter than the pixel grid the Q-Q plot draws on, so the reference line and
 * the plotted quantiles are honest about where the residuals depart from
 * normality.
 *
 * `p` is clamped just inside (0, 1): the plotting positions used below never
 * reach 0 or 1, but clamping keeps a caller from getting an infinity.
 */
export function normalQuantile(p: number): number {
  if (!Number.isFinite(p)) return Number.NaN;
  const clamped = Math.min(1 - 1e-12, Math.max(1e-12, p));

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;

  if (clamped < pLow) {
    const q = Math.sqrt(-2 * Math.log(clamped));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (clamped <= 1 - pLow) {
    const q = clamped - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - clamped));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

export interface ResidualMetrics {
  /** Number of usable residuals. */
  n: number;
  residuals: number[];
  years: number[];
  rmse: number | null;
  mae: number | null;
  maxAbs: number | null;
  maxAbsYear: number | null;
  /** Sample standard deviation of the residuals, n − 1 denominator. */
  sigma: number | null;
  /** Lag-1 autocorrelation of the year-ordered residuals. */
  lag1: number | null;
}

/**
 * Error metrics over the year-ordered residual series.
 *
 * Points whose residual or year is missing are dropped rather than treated as
 * zero error — a season the fit could not use is not a season it predicted
 * perfectly. Ordering by year matters for the lag-1 term: the API's scatter is
 * not guaranteed sorted, and autocorrelation of a shuffled series is noise.
 */
export function residualMetrics(points: readonly SensitivityPoint[]): ResidualMetrics {
  const usable = points
    .filter(
      (p): p is SensitivityPoint & { residual: number } =>
        p.residual !== null && Number.isFinite(p.residual) && Number.isFinite(p.year),
    )
    .slice()
    .sort((x, y) => x.year - y.year);

  const residuals = usable.map((p) => p.residual);
  const years = usable.map((p) => p.year);
  const n = residuals.length;

  if (n === 0) {
    return {
      n: 0, residuals, years,
      rmse: null, mae: null, maxAbs: null, maxAbsYear: null, sigma: null, lag1: null,
    };
  }

  let sumSq = 0;
  let sumAbs = 0;
  let maxAbs = -Infinity;
  let maxAbsYear = years[0];
  residuals.forEach((r, i) => {
    sumSq += r * r;
    sumAbs += Math.abs(r);
    if (Math.abs(r) > maxAbs) {
      maxAbs = Math.abs(r);
      maxAbsYear = years[i];
    }
  });

  const mean = residuals.reduce((acc, r) => acc + r, 0) / n;
  const sumCentredSq = residuals.reduce((acc, r) => acc + (r - mean) ** 2, 0);
  const sigma = n >= 2 ? Math.sqrt(sumCentredSq / (n - 1)) : null;

  // Standard lag-1 autocorrelation of a mean-centred series. Needs at least two
  // consecutive pairs to be anything other than ±1 by construction.
  let lag1: number | null = null;
  if (n >= 3 && sumCentredSq > 0) {
    let cross = 0;
    for (let i = 1; i < n; i += 1) {
      cross += (residuals[i] - mean) * (residuals[i - 1] - mean);
    }
    lag1 = cross / sumCentredSq;
  }

  return {
    n,
    residuals,
    years,
    rmse: Math.sqrt(sumSq / n),
    mae: sumAbs / n,
    maxAbs,
    maxAbsYear,
    sigma,
    lag1,
  };
}

export interface QQPoint {
  /** Theoretical standard-normal quantile at this rank's plotting position. */
  theoretical: number;
  /** Observed residual at this rank, ascending. */
  sample: number;
}

/**
 * Q-Q pairs using the Blom / Filliben plotting position (i − 0.375)/(n + 0.25).
 *
 * Blom's positions are close to unbiased for the expected order statistics of a
 * normal sample, which matters at n ≈ 45: the naive i/n places the largest
 * residual at p = 1 (infinite quantile) and i/(n+1) noticeably compresses the
 * tails, both of which make a fine sample look non-normal or vice versa.
 */
export function qqPoints(residuals: readonly number[]): QQPoint[] {
  const sorted = residuals.filter((r) => Number.isFinite(r)).slice().sort((a, b) => a - b);
  const n = sorted.length;
  return sorted.map((sample, idx) => ({
    theoretical: normalQuantile((idx + 1 - 0.375) / (n + 0.25)),
    sample,
  }));
}

export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

/**
 * Equal-width bins over the value range.
 *
 * A degenerate range (every residual identical, or a single residual) collapses
 * to one unit-wide bin rather than dividing by zero.
 */
export function histogramBins(values: readonly number[], binCount = 9): HistogramBin[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0 || binCount < 1) return [];

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (!(max - min > 0)) {
    return [{ start: min - 0.5, end: max + 0.5, count: finite.length }];
  }

  const width = (max - min) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    start: min + i * width,
    end: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of finite) {
    // Last bin is closed on the right so the maximum is counted, not dropped.
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    bins[idx].count += 1;
  }
  return bins;
}

export interface SpatialUncertainty {
  /** Cells with both a delta and an uncertainty. */
  n: number;
  median: number | null;
  max: number | null;
  /** Share of cells where |delta| exceeds that cell's own uncertainty. */
  resolvedFraction: number | null;
}

/**
 * Per-cell uncertainty summary.
 *
 * `resolvedFraction` is the fraction of cells where the change is larger than
 * its own error bar — that is, where the *sign* of the local response is
 * actually established. It is the honest counterweight to a map that looks
 * uniformly red.
 */
export function spatialUncertaintySummary(
  delta: readonly (number | null | undefined)[] | undefined | null,
  uncertainty: readonly (number | null | undefined)[] | undefined | null,
): SpatialUncertainty {
  if (!delta || !uncertainty) return { n: 0, median: null, max: null, resolvedFraction: null };

  const sigmas: number[] = [];
  let resolved = 0;
  const len = Math.min(delta.length, uncertainty.length);
  for (let i = 0; i < len; i += 1) {
    const d = delta[i];
    const u = uncertainty[i];
    if (d === null || d === undefined || !Number.isFinite(d)) continue;
    if (u === null || u === undefined || !Number.isFinite(u)) continue;
    sigmas.push(u);
    if (Math.abs(d) > u) resolved += 1;
  }
  const n = sigmas.length;
  if (n === 0) return { n: 0, median: null, max: null, resolvedFraction: null };

  const sorted = sigmas.slice().sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  return { n, median, max: sorted[n - 1], resolvedFraction: resolved / n };
}

/** Serial dependence above this makes OLS standard errors optimistic. */
export const LAG1_FLAG_THRESHOLD = 0.4;

// ── Plot geometry ─────────────────────────────────────────────────────────────

const PLOT_W = 320;
const PLOT_H = 180;
const PAD = { left: 40, right: 10, top: 12, bottom: 26 };

function scaleFactory(dMin: number, dMax: number, rMin: number, rMax: number) {
  const span = dMax - dMin;
  return (v: number): number =>
    span > 0 ? rMin + ((v - dMin) / span) * (rMax - rMin) : (rMin + rMax) / 2;
}

/** Symmetric ±max|v| domain so a zero line sits exactly mid-axis. */
function symmetricRange(values: readonly number[]): [number, number] {
  const m = values.reduce((acc, v) => Math.max(acc, Math.abs(v)), 0);
  const pad = m > 0 ? m * 1.15 : 1;
  return [-pad, pad];
}

function paddedRange(values: readonly number[]): [number, number] {
  if (values.length === 0) return [-1, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!(max - min > 0)) return [min - 1, max + 1];
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WhatIfErrorAnalytics({ result }: WhatIfErrorAnalyticsProps) {
  const metrics = residualMetrics(result.scatter);
  const unit = result.fit.response_unit || result.regional.unit;
  const spatial = spatialUncertaintySummary(result.cell_delta, result.cell_delta_uncertainty);
  const serial = metrics.lag1 !== null && Math.abs(metrics.lag1) > LAG1_FLAG_THRESHOLD;

  return (
    <section aria-labelledby="whatif-error-heading" className="panel p-4 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2
          id="whatif-error-heading"
          className="text-foreground font-semibold text-base tracking-wide flex items-center gap-2"
        >
          <Activity size={16} className="text-amber-400" />
          Error analytics
        </h2>
        <p className="text-xs text-foreground/50 leading-snug">
          {regionLabel(result.region)} &middot; {result.season_label} &middot; how far the fitted
          sensitivity misses each observed season, and whether those misses look random.
        </p>
      </header>

      {metrics.n === 0 ? (
        <p className="text-xs text-foreground/60" data-testid="error-analytics-empty">
          This response carries no residuals, so no error diagnostics can be shown. Nothing is
          filled in with zero.
        </p>
      ) : (
        <>
          {/* ── Metrics row ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat
              testId="metric-rmse"
              label="Residual RMSE"
              value={fmt(metrics.rmse, 3)}
              unit={unit}
              note={`root mean square over ${metrics.n} seasons`}
            />
            <Stat
              testId="metric-mae"
              label="Residual MAE"
              value={fmt(metrics.mae, 3)}
              unit={unit}
              note="mean absolute miss"
            />
            <Stat
              testId="metric-maxabs"
              label="Worst season"
              value={fmt(metrics.maxAbs, 3)}
              unit={unit}
              note={metrics.maxAbsYear === null ? 'year —' : `in ${metrics.maxAbsYear}`}
            />
            <Stat
              testId="metric-sigma"
              label="Residual σ"
              value={fmt(metrics.sigma, 3)}
              unit={unit}
              note="spread the fit leaves behind"
            />
            <Stat
              testId="metric-lag1"
              label="Lag-1 autocorr."
              value={fmtSigned(metrics.lag1, 3)}
              unit=""
              note={serial ? 'above ±0.40 — see note' : 'no serial dependence flagged'}
              tone={serial ? 'warn' : undefined}
            />
          </div>

          {serial && (
            <div className="flex gap-2 p-2.5 caveat-box">
              <AlertTriangle size={13} className="caveat-icon mt-0.5 shrink-0" />
              <p className="text-xs caveat-text leading-relaxed">
                Lag-1 autocorrelation is {fmtSigned(metrics.lag1, 3)}, beyond ±
                {LAG1_FLAG_THRESHOLD.toFixed(2)}. Consecutive seasons are not independent, which is
                the assumption behind the ordinary least squares standard error, p-value, and every
                confidence interval quoted for this fit. Read those intervals as narrower than the
                truth.
              </p>
            </div>
          )}

          {/* ── Plots ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ResidualsVsFitted points={result.scatter} unit={unit} />
            <ResidualHistogram residuals={metrics.residuals} unit={unit} />
            <NormalQQ residuals={metrics.residuals} unit={unit} />
            <ResidualVsYear
              residuals={metrics.residuals}
              years={metrics.years}
              unit={unit}
            />
          </div>

          <p className="text-[10px] text-foreground/35 leading-snug">
            Filled markers are positive residuals (the season was wetter than the fit predicted),
            open markers negative, and every plot carries its zero or reference line — colour alone
            never carries the sign.
          </p>

          {/* ── Spatial uncertainty ────────────────────────────────────── */}
          {spatial.n > 0 && (
            <div className="rounded-lg bg-foreground/[0.04] border border-foreground/12 p-3 flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-foreground/45">
                Per-cell uncertainty ({spatial.n} cells)
              </span>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-foreground/70">
                <span>
                  median ±{' '}
                  <span className="font-mono text-foreground/90">{fmt(spatial.median, 3)}</span>{' '}
                  {unit}
                </span>
                <span>
                  max ±{' '}
                  <span className="font-mono text-foreground/90">{fmt(spatial.max, 3)}</span> {unit}
                </span>
                <span data-testid="resolved-fraction">
                  sign resolved in{' '}
                  <span className="font-mono text-foreground/90">
                    {spatial.resolvedFraction === null
                      ? '—'
                      : `${(100 * spatial.resolvedFraction).toFixed(1)}%`}
                  </span>{' '}
                  of cells
                </span>
              </div>
              <p className="text-[10px] text-foreground/35 leading-snug">
                &ldquo;Sign resolved&rdquo; means the cell&apos;s change is larger than its own
                uncertainty. In the rest, the map shows a direction the data does not establish.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Plot 1: residuals vs fitted ───────────────────────────────────────────────

function ResidualsVsFitted({
  points,
  unit,
}: {
  points: readonly SensitivityPoint[];
  unit: string;
}) {
  const pairs = points
    .filter(
      (p): p is SensitivityPoint & { fitted_value: number; residual: number } =>
        p.fitted_value !== null &&
        p.residual !== null &&
        Number.isFinite(p.fitted_value) &&
        Number.isFinite(p.residual),
    )
    .map((p) => ({ x: p.fitted_value, y: p.residual, year: p.year }));

  if (pairs.length === 0) {
    return (
      <PlotCard
        title="Residuals vs fitted"
        caption="Needs both a fitted value and a residual per season."
      >
        <p className="text-xs text-foreground/55">
          No season carries both a fitted value and a residual, so this check cannot be drawn.
        </p>
      </PlotCard>
    );
  }

  const [xMin, xMax] = paddedRange(pairs.map((p) => p.x));
  const [yMin, yMax] = symmetricRange(pairs.map((p) => p.y));
  const sx = scaleFactory(xMin, xMax, PAD.left, PLOT_W - PAD.right);
  const sy = scaleFactory(yMin, yMax, PLOT_H - PAD.bottom, PAD.top);
  const zeroY = sy(0);

  return (
    <PlotCard
      title="Residuals vs fitted"
      caption={
        'The standard heteroscedasticity and curvature check: a fan shape means the error grows ' +
        'with the prediction, a bend means one straight slope is the wrong model.'
      }
    >
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        role="img"
        aria-label={
          `Residual against fitted value for ${pairs.length} seasons, with a zero reference line. ` +
          `Residuals span ${fmt(Math.min(...pairs.map((p) => p.y)), 2)} to ` +
          `${fmt(Math.max(...pairs.map((p) => p.y)), 2)} ${unit}.`
        }
        className="w-full h-auto"
      >
        <title>Residuals versus fitted values with a zero reference line</title>
        <Axes />
        <line
          x1={PAD.left}
          x2={PLOT_W - PAD.right}
          y1={zeroY}
          y2={zeroY}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeDasharray="4 3"
        />
        <text x={PLOT_W - PAD.right} y={zeroY - 3} textAnchor="end" fontSize={8} fill="currentColor" fillOpacity={0.5}>
          zero error
        </text>
        {pairs.map((p) => (
          <Marker
            key={p.year}
            cx={sx(p.x)}
            cy={sy(p.y)}
            positive={p.y >= 0}
            className="resid-point"
          />
        ))}
        <AxisLabels
          xLabel={`fitted ${unit}`}
          yLabel={`residual ${unit}`}
          xLow={fmt(xMin, 1)}
          xHigh={fmt(xMax, 1)}
          yLow={fmtSigned(yMin, 1)}
          yHigh={fmtSigned(yMax, 1)}
        />
      </svg>
    </PlotCard>
  );
}

// ── Plot 2: residual histogram ────────────────────────────────────────────────

function ResidualHistogram({ residuals, unit }: { residuals: number[]; unit: string }) {
  const bins = histogramBins(residuals, 9);
  const maxCount = bins.reduce((acc, b) => Math.max(acc, b.count), 0);
  const xMin = bins.length > 0 ? bins[0].start : -1;
  const xMax = bins.length > 0 ? bins[bins.length - 1].end : 1;
  const sx = scaleFactory(xMin, xMax, PAD.left, PLOT_W - PAD.right);
  const sy = scaleFactory(0, Math.max(1, maxCount), PLOT_H - PAD.bottom, PAD.top);

  return (
    <PlotCard
      title="Residual distribution"
      caption={
        'Counts per equal-width bin. A single symmetric hump supports the Gaussian error model; ' +
        'two humps or a long one-sided tail do not.'
      }
    >
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        role="img"
        aria-label={
          `Histogram of ${residuals.length} residuals in ${bins.length} bins spanning ` +
          `${fmt(xMin, 2)} to ${fmt(xMax, 2)} ${unit}; the tallest bin holds ${maxCount} seasons.`
        }
        className="w-full h-auto"
      >
        <title>Histogram of regression residuals with a count axis</title>
        <Axes />
        {/* Count gridlines, labelled, so the y axis is readable as counts. */}
        {[0, Math.ceil(maxCount / 2), maxCount].map((c, i) => (
          <g key={`${c}-${i}`}>
            <line
              x1={PAD.left}
              x2={PLOT_W - PAD.right}
              y1={sy(c)}
              y2={sy(c)}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <text x={PAD.left - 5} y={sy(c) + 3} textAnchor="end" fontSize={8} fill="currentColor" fillOpacity={0.5}>
              {c}
            </text>
          </g>
        ))}
        {bins.map((b) => {
          const left = sx(b.start);
          const right = sx(b.end);
          const top = sy(b.count);
          return (
            <rect
              key={`${b.start}`}
              className="hist-bar"
              x={left + 0.5}
              y={top}
              width={Math.max(1, right - left - 1)}
              height={Math.max(0, PLOT_H - PAD.bottom - top)}
              fill="currentColor"
              fillOpacity={0.35}
              stroke="currentColor"
              strokeOpacity={0.45}
            />
          );
        })}
        <AxisLabels
          xLabel={`residual ${unit}`}
          yLabel="count"
          xLow={fmtSigned(xMin, 1)}
          xHigh={fmtSigned(xMax, 1)}
        />
      </svg>
    </PlotCard>
  );
}

// ── Plot 3: normal Q-Q ────────────────────────────────────────────────────────

function NormalQQ({ residuals, unit }: { residuals: number[]; unit: string }) {
  const qq = qqPoints(residuals);
  // A shared range for both axes: the reference line is y = x only if the two
  // axes are drawn on the same scale, so the residuals are standardised.
  const sigma = residualSigma(residuals);
  const centre = mean(residuals);
  const standardised =
    sigma !== null && sigma > 0
      ? qq.map((p) => ({ theoretical: p.theoretical, sample: (p.sample - centre) / sigma }))
      : // A single residual, or a perfectly flat set, has no scale to
        // standardise by. Plot it on the reference line rather than inventing a σ.
        qq.map((p) => ({ theoretical: p.theoretical, sample: p.theoretical }));

  const all = standardised.flatMap((p) => [p.theoretical, p.sample]);
  const [lo, hi] = symmetricRange(all);
  const sx = scaleFactory(lo, hi, PAD.left, PLOT_W - PAD.right);
  const sy = scaleFactory(lo, hi, PLOT_H - PAD.bottom, PAD.top);

  return (
    <PlotCard
      title="Normal Q-Q"
      caption={
        'Standardised residuals against theoretical normal quantiles at the Blom plotting ' +
        'position (i − 0.375)/(n + 0.25), inverted with the Acklam rational approximation. ' +
        'Points on the y = x line support the Gaussian assumption every interval in this studio ' +
        'depends on; systematic curvature at the ends undermines it.'
      }
    >
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        role="img"
        aria-label={
          `Normal quantile-quantile plot of ${qq.length} standardised residuals against ` +
          `theoretical normal quantiles, with the y equals x reference line. Residual σ is ` +
          `${fmt(sigma, 3)} ${unit}.`
        }
        className="w-full h-auto"
      >
        <title>Normal Q-Q plot of residuals with a y equals x reference line</title>
        <Axes />
        <line
          x1={sx(lo)}
          y1={sy(lo)}
          x2={sx(hi)}
          y2={sy(hi)}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeDasharray="4 3"
        />
        <text
          x={PLOT_W - PAD.right}
          y={PAD.top + 9}
          textAnchor="end"
          fontSize={8} fill="currentColor" fillOpacity={0.5}
        >
          y = x
        </text>
        {standardised.map((p, i) => (
          <Marker
            key={`qq-${i}`}
            cx={sx(p.theoretical)}
            cy={sy(p.sample)}
            positive={p.sample >= 0}
            className="qq-point"
          />
        ))}
        <AxisLabels
          xLabel="theoretical quantile (σ)"
          yLabel="observed (σ)"
          xLow={fmtSigned(lo, 1)}
          xHigh={fmtSigned(hi, 1)}
        />
      </svg>
    </PlotCard>
  );
}

// ── Plot 4: residual vs year ──────────────────────────────────────────────────

function ResidualVsYear({
  residuals,
  years,
  unit,
}: {
  residuals: number[];
  years: number[];
  unit: string;
}) {
  const [yMin, yMax] = symmetricRange(residuals);
  const xMin = years.length > 0 ? Math.min(...years) : 0;
  const xMax = years.length > 0 ? Math.max(...years) : 1;
  const sx = scaleFactory(xMin, xMax, PAD.left, PLOT_W - PAD.right);
  const sy = scaleFactory(yMin, yMax, PLOT_H - PAD.bottom, PAD.top);
  const zeroY = sy(0);

  const path = residuals.map((r, i) => `${sx(years[i]).toFixed(2)},${sy(r).toFixed(2)}`).join(' ');

  return (
    <PlotCard
      title="Residual vs year"
      caption={
        'Drift the fit does not capture. A run of same-sign residuals means something other than ' +
        'the chosen driver moved over the record, and the single slope absorbs it silently.'
      }
    >
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        role="img"
        aria-label={
          `Residual by year from ${xMin} to ${xMax} for ${residuals.length} seasons in ${unit}, ` +
          'with a zero reference line.'
        }
        className="w-full h-auto"
      >
        <title>Residual against year with a zero reference line</title>
        <Axes />
        <line
          x1={PAD.left}
          x2={PLOT_W - PAD.right}
          y1={zeroY}
          y2={zeroY}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeDasharray="4 3"
        />
        {residuals.length > 1 && (
          <polyline
            points={path}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.28}
            strokeWidth={1}
          />
        )}
        {residuals.map((r, i) => (
          <Marker
            key={`yr-${years[i]}`}
            cx={sx(years[i])}
            cy={sy(r)}
            positive={r >= 0}
            className="year-point"
          />
        ))}
        <AxisLabels
          xLabel="year"
          yLabel={`residual ${unit}`}
          xLow={String(xMin)}
          xHigh={String(xMax)}
          yLow={fmtSigned(yMin, 1)}
          yHigh={fmtSigned(yMax, 1)}
        />
      </svg>
    </PlotCard>
  );
}

// ── Shared SVG pieces ─────────────────────────────────────────────────────────

function Axes() {
  return (
    <g stroke="currentColor" strokeOpacity={0.3}>
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PLOT_H - PAD.bottom} />
      <line
        x1={PAD.left}
        y1={PLOT_H - PAD.bottom}
        x2={PLOT_W - PAD.right}
        y2={PLOT_H - PAD.bottom}
      />
    </g>
  );
}

/**
 * Filled for a positive value, open for a negative one.
 *
 * Shape carries the sign so the plots remain readable in greyscale and to a
 * reader who cannot distinguish the fill colours.
 */
function Marker({
  cx,
  cy,
  positive,
  className,
}: {
  cx: number;
  cy: number;
  positive: boolean;
  className: string;
}) {
  return (
    <circle
      className={className}
      cx={cx}
      cy={cy}
      r={2.8}
      fill={positive ? 'currentColor' : 'none'}
      fillOpacity={positive ? 0.55 : 0}
      stroke="currentColor"
      strokeOpacity={0.75}
      strokeWidth={1}
    />
  );
}

function AxisLabels({
  xLabel,
  yLabel,
  xLow,
  xHigh,
  yLow,
  yHigh,
}: {
  xLabel: string;
  yLabel: string;
  xLow?: string;
  xHigh?: string;
  yLow?: string;
  yHigh?: string;
}) {
  return (
    <g fontSize={8} fill="currentColor" fillOpacity={0.5}>
      {xLow && (
        <text x={PAD.left} y={PLOT_H - PAD.bottom + 12} textAnchor="start">
          {xLow}
        </text>
      )}
      {xHigh && (
        <text x={PLOT_W - PAD.right} y={PLOT_H - PAD.bottom + 12} textAnchor="end">
          {xHigh}
        </text>
      )}
      <text x={(PAD.left + PLOT_W - PAD.right) / 2} y={PLOT_H - 4} textAnchor="middle">
        {xLabel}
      </text>
      {yHigh && (
        <text x={PAD.left - 5} y={PAD.top + 8} textAnchor="end">
          {yHigh}
        </text>
      )}
      {yLow && (
        <text x={PAD.left - 5} y={PLOT_H - PAD.bottom - 1} textAnchor="end">
          {yLow}
        </text>
      )}
      <text x={9} y={PAD.top + 4} textAnchor="start">
        {yLabel}
      </text>
    </g>
  );
}

function PlotCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-1.5 rounded-lg bg-foreground/[0.04] border border-foreground/12 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
        {title}
      </h3>
      <div className="text-foreground/70">{children}</div>
      <figcaption className="text-[10px] text-foreground/45 leading-snug">{caption}</figcaption>
    </figure>
  );
}

function Stat({
  label,
  value,
  unit,
  note,
  tone,
  testId,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
  tone?: 'warn';
  testId: string;
}) {
  return (
    <div
      className="rounded-lg bg-foreground/[0.04] border border-foreground/12 p-2 flex flex-col gap-0.5"
      data-testid={testId}
    >
      <span className="text-[10px] uppercase tracking-wider text-foreground/45">{label}</span>
      <span
        className={`text-sm font-bold font-mono leading-tight ${
          tone === 'warn' ? 'text-amber-400' : 'text-foreground'
        }`}
      >
        {value}
        {unit && <span className="text-[10px] text-foreground/45 font-normal ml-1">{unit}</span>}
      </span>
      <span className="text-[10px] text-foreground/35 leading-tight">{note}</span>
    </div>
  );
}

// ── Local numeric helpers ─────────────────────────────────────────────────────

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function residualSigma(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  const ss = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}
