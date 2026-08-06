/**
 * Conditional distribution panel — P(R = x | T = t) for the observed baseline and
 * a shifted predictor.
 *
 * Two Gaussian curves are only as good as the assumption behind them, so the
 * observed histogram is drawn behind them on the same density scale: a reader can
 * see for themselves whether the record looks normal before trusting the
 * exceedance probability. Everything is server-computed; there is no offline
 * fallback, because an invented probability reads exactly like a measured one.
 *
 * The chart is hand-drawn SVG rather than a plotting library, matching the
 * hand-drawn approach in WhatIfBeforeAfter.tsx.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Info, RefreshCw, Sigma } from 'lucide-react';

import { fetchDistribution } from '../../api/client';
import type { DensityCurve, DistributionResponse, PredictorId, SeasonId } from '../../types';
import { fmt, fmtSigned, predictorById, regionLabel, SEASONS } from './whatIfFormat';

export interface DistributionPanelProps {
  region: string;
  predictor: PredictorId;
  season: SeasonId;
  /** Predictor shift the scenario curve is conditioned on. */
  delta: number;
  threshold?: number;
  thresholdTolerance?: number;
  predictorTolerance?: number;
  autoLoad?: boolean;
}

// ── Chart geometry (viewBox units) ────────────────────────────────────────────

const W = 640;
const H = 260;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 30;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

/** Per-curve palette. Sign words accompany the colour everywhere it is used. */
const CURVE_STYLE: Record<string, { stroke: string; fill: string; swatch: string; text: string }> = {
  baseline: {
    stroke: 'stroke-sky-400',
    fill: 'fill-sky-400/15',
    swatch: 'bg-sky-400',
    text: 'text-sky-300',
  },
  scenario: {
    stroke: 'stroke-amber-400',
    fill: 'fill-amber-400/15',
    swatch: 'bg-amber-400',
    text: 'text-amber-300',
  },
};

function styleFor(id: string) {
  return CURVE_STYLE[id] ?? {
    stroke: 'stroke-foreground/50',
    fill: 'fill-foreground/10',
    swatch: 'bg-foreground/50',
    text: 'text-foreground/70',
  };
}

function seasonLabel(season: SeasonId): string {
  return SEASONS.find((s) => s.id === season)?.label ?? season;
}

function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(digits)}%`;
}

function fmtPctSigned(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  return `${fmtSigned(p * 100, digits)}%`;
}

export default function DistributionPanel({
  region,
  predictor,
  season,
  delta,
  threshold,
  thresholdTolerance,
  predictorTolerance,
  autoLoad = false,
}: DistributionPanelProps) {
  const [data, setData] = useState<DistributionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchDistribution({
        region,
        predictor,
        season,
        delta,
        threshold,
        thresholdTolerance,
        predictorTolerance,
      });
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — no offline estimate is shown because these probabilities come from the observed record.`
          : 'Distribution unavailable — no offline estimate is shown because these probabilities come from the observed record.',
      );
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [region, predictor, season, delta, threshold, thresholdTolerance, predictorTolerance]);

  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  const driver = predictorById(predictor);

  return (
    <section aria-labelledby="distribution-heading" className="panel p-4 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="distribution-heading"
            className="text-foreground font-semibold text-base tracking-wide flex items-center gap-2"
          >
            <Sigma size={16} className="text-amber-400" />
            P(rainfall = x | {driver.label} = t)
          </h2>
          <p className="text-xs text-foreground/50 leading-snug">
            {regionLabel(region)} &middot; {data?.season_label ?? seasonLabel(season)} &middot;
            conditional density at the observed baseline and at{' '}
            <span className="font-mono">{fmtSigned(delta, 2)} {driver.unit}</span>.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={isLoading}
          aria-label={data ? 'Refresh conditional distribution' : 'Load conditional distribution'}
          className="btn-ghost flex items-center gap-1.5 text-xs shrink-0"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : undefined} />
          {isLoading ? 'Loading…' : data ? 'Refresh' : 'Load'}
        </button>
      </header>

      {error && (
        <div className="flex gap-2 p-3 bg-red-500/15 border border-red-500/30 rounded-lg">
          <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-200 leading-snug">{error}</p>
        </div>
      )}

      {!data && !error && !isLoading && (
        <p className="text-xs text-foreground/40">
          Load the observed record to see both conditional densities, the observed histogram behind
          them, and the exceedance probability.
        </p>
      )}

      {data && <DistributionBody data={data} />}
    </section>
  );
}

// ── Result body ───────────────────────────────────────────────────────────────

function DistributionBody({ data }: { data: DistributionResponse }) {
  const { curves, empirical, exceedance, caveats } = data;
  const baseline: DensityCurve | undefined =
    curves.find((c) => c.id === 'baseline') ?? curves[0];
  const scenario: DensityCurve | undefined =
    curves.find((c) => c.id === 'scenario') ?? curves[1];

  const baseSigma = baseline?.sigma ?? null;
  const scenSigma = scenario?.sigma ?? null;
  const leverage =
    baseSigma !== null &&
    scenSigma !== null &&
    Number.isFinite(baseSigma) &&
    Number.isFinite(scenSigma) &&
    scenSigma > baseSigma;

  return (
    <div className="flex flex-col gap-4">
      <DensityChart data={data} />

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {curves.map((c) => {
          const s = styleFor(c.id);
          return (
            <span key={c.id} className="flex items-center gap-1.5 text-foreground/70">
              <span className={`inline-block w-3 h-1.5 rounded-sm ${s.swatch}`} aria-hidden="true" />
              {c.label}
              <span className="font-mono text-foreground/85">
                μ {fmt(c.mean, 3)} {data.response_unit}
              </span>
              <span className="font-mono text-foreground/50">σ {fmt(c.sigma, 3)}</span>
            </span>
          );
        })}
        <span className="flex items-center gap-1.5 text-foreground/55">
          <span
            className="inline-block w-3 h-2.5 rounded-sm bg-foreground/20 border border-foreground/25"
            aria-hidden="true"
          />
          observed histogram (n = {empirical.n})
        </span>
        <span className="flex items-center gap-1.5 text-foreground/55">
          <span className="inline-block w-3 border-t border-dashed border-foreground/60" aria-hidden="true" />
          curve mean
        </span>
      </div>

      {/* ── Spread diagnostics ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat
          label="Residual σ"
          value={fmt(data.residual_sigma, 3)}
          unit={data.response_unit}
          note="unexplained year-to-year scatter about the fit"
        />
        <Stat
          label={`σ · ${baseline?.label ?? 'baseline'}`}
          value={fmt(baseSigma, 3)}
          unit={data.response_unit}
          note="width of the baseline density"
        />
        <Stat
          label={`σ · ${scenario?.label ?? 'scenario'}`}
          value={fmt(scenSigma, 3)}
          unit={data.response_unit}
          note="width of the shifted density"
          tone={leverage ? 'warn' : undefined}
        />
      </div>

      {leverage && (
        <div className="flex gap-2 p-2.5 bg-amber-500/[0.07] border border-amber-500/25 rounded-lg">
          <Info size={13} className="text-amber-300/90 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-100/85 leading-relaxed">
            The scenario density is wider than the baseline (σ {fmt(scenSigma, 3)} vs{' '}
            {fmt(baseSigma, 3)} {data.response_unit}). That extra width is leverage
            from extrapolating the fit beyond the predictor values actually observed, not a measured
            increase in variability.
          </p>
        </div>
      )}

      {/* ── Exceedance ─────────────────────────────────────────────────────── */}
      {exceedance !== null && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-foreground/12 bg-foreground/[0.04] p-3"
          aria-labelledby="distribution-exceedance-heading"
        >
          <h3
            id="distribution-exceedance-heading"
            className="text-sm font-semibold text-foreground/90 tracking-wide uppercase"
          >
            P(rainfall &gt; threshold)
          </h3>
          <p className="text-xs text-foreground/60">
            Threshold{' '}
            <span className="font-mono text-foreground/90">
              {fmt(exceedance.threshold, 3)} {data.response_unit}
            </span>
            {exceedance.threshold_tolerance !== null &&
              Number.isFinite(exceedance.threshold_tolerance) && (
                <> ± {fmt(exceedance.threshold_tolerance, 3)}</>
              )}
            {exceedance.predictor_tolerance !== null &&
              Number.isFinite(exceedance.predictor_tolerance) && (
                <>
                  {' '}
                  · predictor tolerance ± {fmt(exceedance.predictor_tolerance, 2)}{' '}
                  {data.predictor_unit}
                </>
              )}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat
              label="Baseline"
              value={fmtPct(exceedance.baseline_probability)}
              unit=""
              note="at the observed predictor value"
            />
            <Stat
              label="Scenario"
              value={fmtPct(exceedance.scenario_probability)}
              unit=""
              note={`at ${fmtSigned(data.delta_predictor, 2)} ${data.predictor_unit}`}
            />
            <Stat
              label="Change"
              value={fmtPctSigned(exceedance.probability_change)}
              unit=""
              note={
                (exceedance.probability_change ?? 0) < 0
                  ? 'less likely (↓)'
                  : (exceedance.probability_change ?? 0) > 0
                    ? 'more likely (↑)'
                    : 'no change'
              }
              tone={
                exceedance.probability_change === null
                  ? undefined
                  : exceedance.probability_change < 0
                    ? 'warn'
                    : 'cool'
              }
            />
            <Stat
              label="Tolerance band"
              value={`${fmtPct(exceedance.probability_low)} – ${fmtPct(exceedance.probability_high)}`}
              unit=""
              note="scenario probability across the tolerance range"
            />
          </div>

          <p className="text-xs text-foreground/60 leading-relaxed">
            Observed frequency over the record:{' '}
            <span className="font-mono text-foreground/90">
              {fmtPct(exceedance.observed_frequency)}
            </span>{' '}
            (
            <span className="font-mono">
              {exceedance.observed_exceedances}/{exceedance.observed_years}
            </span>{' '}
            seasons exceeded it). Compare that with the baseline probability above: a large gap means
            the Gaussian fit, not the record, is doing the work.
          </p>
          {exceedance.definition && (
            <p className="text-[10px] text-foreground/35 leading-snug">{exceedance.definition}</p>
          )}
        </div>
      )}

      {/* ── Caveats, in full ───────────────────────────────────────────────── */}
      {caveats.length > 0 && (
        <div
          aria-labelledby="distribution-caveat-heading"
          className="flex flex-col gap-2 p-3 bg-amber-500/[0.07] border border-amber-500/25 rounded-lg"
        >
          <h3
            id="distribution-caveat-heading"
            className="text-xs font-semibold text-amber-200 tracking-wide uppercase flex items-center gap-1.5"
          >
            <AlertTriangle size={13} />
            What this distribution cannot tell you
          </h3>
          <ul className="flex flex-col gap-1.5 list-disc pl-4">
            {caveats.map((c) => (
              <li key={c} className="text-xs text-amber-100/85 leading-relaxed">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── SVG chart ─────────────────────────────────────────────────────────────────

interface Bin {
  x0: number;
  x1: number;
  density: number;
}

/** Pull the finite (value, density) pairs out of a curve, dropping nulls. */
function curvePoints(curve: DensityCurve): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = Math.min(curve.values.length, curve.density.length);
  for (let i = 0; i < n; i += 1) {
    const x = curve.values[i];
    const y = curve.density[i];
    if (x === null || y === null) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * Convert the observed counts into a probability density so the bars and the
 * fitted curves share one y-axis: count / (n · bin width).
 */
function histogramBins(edges: (number | null)[], counts: number[], n: number): Bin[] {
  const bins: Bin[] = [];
  if (n <= 0) return bins;
  for (let i = 0; i < counts.length; i += 1) {
    const x0 = edges[i];
    const x1 = edges[i + 1];
    if (x0 === null || x1 === null) continue;
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
    const width = x1 - x0;
    if (!(width > 0)) continue;
    bins.push({ x0, x1, density: counts[i] / (n * width) });
  }
  return bins;
}

function DensityChart({ data }: { data: DistributionResponse }) {
  const series = data.curves.map((c) => ({ curve: c, points: curvePoints(c) }));
  const bins = histogramBins(
    data.empirical.histogram_edges,
    data.empirical.histogram_counts,
    data.empirical.n,
  );

  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of series) {
    for (const p of s.points) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  for (const b of bins) {
    xs.push(b.x0, b.x1);
    ys.push(b.density);
  }

  if (xs.length === 0 || ys.length === 0) {
    return (
      <p className="text-xs text-foreground/45">
        No density values were returned for this configuration, so no curve is drawn.
      </p>
    );
  }

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax || 1;

  const sx = (x: number): number => PAD_L + (PLOT_W * (x - xMin)) / xSpan;
  const sy = (y: number): number => PAD_T + PLOT_H - (PLOT_H * y) / ySpan;

  const linePath = (points: { x: number; y: number }[]): string =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ');

  const areaPath = (points: { x: number; y: number }[]): string => {
    if (points.length === 0) return '';
    const base = (PAD_T + PLOT_H).toFixed(2);
    return (
      `M${sx(points[0].x).toFixed(2)},${base} ` +
      points.map((p) => `L${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ') +
      ` L${sx(points[points.length - 1].x).toFixed(2)},${base} Z`
    );
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => xMin + f * xSpan);

  const describedMeans = data.curves
    .map((c) => `${c.label} mean ${fmt(c.mean, 3)} ${data.response_unit}`)
    .join('; ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-labelledby="distribution-chart-title"
      preserveAspectRatio="none"
    >
      <title id="distribution-chart-title">
        {`Conditional probability density of ${data.response} in ${data.response_unit} for ` +
          `${data.curves.length} predictor values, drawn over the observed histogram of ` +
          `${data.empirical.n} seasons. ${describedMeans}.`}
      </title>

      {/* Observed histogram, behind the curves */}
      {bins.map((b) => {
        const x = sx(b.x0);
        const w = Math.max(1, sx(b.x1) - sx(b.x0) - 1);
        const y = sy(b.density);
        return (
          <rect
            key={`${b.x0}-${b.x1}`}
            x={x}
            y={y}
            width={w}
            height={Math.max(0, PAD_T + PLOT_H - y)}
            className="fill-foreground/15 stroke-foreground/20"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Density curves: filled area then stroke */}
      {series.map(({ curve, points }) => {
        const s = styleFor(curve.id);
        if (points.length < 2) return null;
        return (
          <g key={curve.id}>
            <path d={areaPath(points)} className={s.fill} />
            <path d={linePath(points)} fill="none" className={s.stroke} strokeWidth={1.75} />
          </g>
        );
      })}

      {/* Vertical dashed line at each curve mean */}
      {data.curves.map((curve) => {
        const m = curve.mean;
        if (m === null || !Number.isFinite(m)) return null;
        const s = styleFor(curve.id);
        return (
          <line
            key={`mean-${curve.id}`}
            x1={sx(m)}
            x2={sx(m)}
            y1={PAD_T}
            y2={PAD_T + PLOT_H}
            className={s.stroke}
            strokeWidth={1.25}
            strokeDasharray="4 3"
          />
        );
      })}

      {/* Axes */}
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={PAD_T + PLOT_H}
        y2={PAD_T + PLOT_H}
        className="stroke-foreground/25"
        strokeWidth={1}
      />
      {ticks.map((t) => (
        <text
          key={t}
          x={sx(t)}
          y={H - 10}
          textAnchor="middle"
          className="fill-foreground/45"
          fontSize={9}
          fontFamily="monospace"
        >
          {t.toFixed(1)}
        </text>
      ))}
      <text
        x={W - PAD_R}
        y={H - 1}
        textAnchor="end"
        className="fill-foreground/35"
        fontSize={9}
      >
        {data.response} ({data.response_unit})
      </text>
      <text
        x={6}
        y={PAD_T + 8}
        className="fill-foreground/40"
        fontSize={9}
        fontFamily="monospace"
      >
        density
      </text>
    </svg>
  );
}

// ── Small presentational pieces ───────────────────────────────────────────────

function Stat({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
  tone?: 'warn' | 'cool';
}) {
  const color =
    tone === 'warn' ? 'text-amber-300' : tone === 'cool' ? 'text-sky-300' : 'text-foreground';
  return (
    <div className="rounded-lg bg-foreground/[0.04] border border-foreground/12 p-2 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-foreground/45">{label}</span>
      <span className={`text-sm font-bold font-mono leading-tight ${color}`}>
        {value}
        {unit && <span className="text-[10px] text-foreground/45 font-normal ml-1">{unit}</span>}
      </span>
      <span className="text-[10px] text-foreground/35 leading-tight">{note}</span>
    </div>
  );
}
