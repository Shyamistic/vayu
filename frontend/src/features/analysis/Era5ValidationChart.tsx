/**
 * Charts for the ERA5 independent-validation panel.
 *
 * Two views, deliberately paired:
 *
 * 1. **Paired time series.** Our bundle and ERA5 on the same axis over the same
 *    days. This is where a systematic offset or a unit error is obvious — a
 *    denormalization bug does not look like noise, it looks like one line
 *    sitting a constant distance from the other.
 * 2. **Scatter against the 1:1 line.** The reference line is 1:1, *not* a fitted
 *    regression, because the question is "do these agree", not "are they
 *    correlated". Two series can correlate at r = 0.99 and still be 40 % apart;
 *    only distance from 1:1 shows that. A least-squares line is drawn as well,
 *    dashed, so a proportional bias (wrong slope) can be told apart from an
 *    additive one (line parallel to 1:1 but offset).
 *
 * Loaded lazily by the panel so Plotly stays out of the initial bundle.
 */

import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import type { Layout, PlotData } from 'plotly.js';

// Same theme-aware convention as WhatIfRegressionChart: hardcoded white axes
// disappear against the light theme's white panels.
const AXIS_COLOR = 'rgba(var(--fg-rgb),var(--fg-a6))';
const GRID_COLOR = 'rgba(var(--fg-rgb),var(--fg-a08))';
const OURS_COLOR = '#38bdf8';
const ERA5_COLOR = '#f59e0b';
const IDENTITY_COLOR = 'rgba(var(--fg-rgb),var(--fg-a4))';

const BASE_LAYOUT: Partial<Layout> = {
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { color: AXIS_COLOR, size: 11, family: 'Inter, system-ui, sans-serif' },
  hovermode: 'closest',
};

const CONFIG = { displayModeBar: false, responsive: true } as const;

export interface Era5ValidationChartProps {
  /** X labels — dates for the daily view, `YYYY-MM` for the monthly view. */
  labels: string[];
  observed: (number | null)[];
  reference: (number | null)[];
  unit: string;
  /** Axis wording; the monthly rainfall view is a total, the daily one a rate. */
  valueLabel: string;
  /** Rendered as bars for monthly totals, lines for daily series. */
  mode?: 'lines' | 'bars';
  height?: number;
}

/** Pairs where both sides are finite. Everything below operates on these only. */
function usablePairs(
  labels: string[],
  observed: (number | null)[],
  reference: (number | null)[],
): { labels: string[]; o: number[]; r: number[] } {
  const outL: string[] = [];
  const outO: number[] = [];
  const outR: number[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    const o = observed[i];
    const r = reference[i];
    if (o === null || r === null || !Number.isFinite(o) || !Number.isFinite(r)) continue;
    outL.push(labels[i]);
    outO.push(o as number);
    outR.push(r as number);
  }
  return { labels: outL, o: outO, r: outR };
}

/** Ordinary least squares, returned only when x actually varies. */
function leastSquares(x: number[], y: number[]): { slope: number; intercept: number } | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - mx;
    sxx += dx * dx;
    sxy += dx * (y[i] - my);
  }
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export default function Era5ValidationChart({
  labels,
  observed,
  reference,
  unit,
  valueLabel,
  mode = 'lines',
  height = 260,
}: Era5ValidationChartProps) {
  const pairs = useMemo(
    () => usablePairs(labels, observed, reference),
    [labels, observed, reference],
  );

  const seriesFigure = useMemo(() => {
    const shared = mode === 'bars' ? { type: 'bar' as const } : {
      type: 'scatter' as const,
      mode: 'lines' as const,
    };
    const traces: Partial<PlotData>[] = [
      {
        ...shared,
        x: pairs.labels,
        y: pairs.o,
        name: 'Ours (IMD bundle)',
        ...(mode === 'bars'
          ? { marker: { color: OURS_COLOR } }
          : { line: { color: OURS_COLOR, width: 1.8 } }),
        hovertemplate: `%{x}<br>Ours: %{y:.2f} ${unit}<extra></extra>`,
      } as Partial<PlotData>,
      {
        ...shared,
        x: pairs.labels,
        y: pairs.r,
        name: 'ERA5 (ECMWF)',
        ...(mode === 'bars'
          ? { marker: { color: ERA5_COLOR } }
          : { line: { color: ERA5_COLOR, width: 1.8 } }),
        hovertemplate: `%{x}<br>ERA5: %{y:.2f} ${unit}<extra></extra>`,
      } as Partial<PlotData>,
    ];

    const layout: Partial<Layout> = {
      ...BASE_LAYOUT,
      height,
      margin: { l: 56, r: 14, t: 26, b: 44 },
      showlegend: true,
      legend: { orientation: 'h', y: 1.16, x: 0, font: { size: 10 } },
      barmode: 'group',
      bargap: 0.25,
      xaxis: { gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 9 } },
      yaxis: {
        title: { text: `${valueLabel} (${unit})`, font: { size: 11 } },
        gridcolor: GRID_COLOR,
        tickfont: { size: 10 },
      },
    };
    return { traces, layout };
  }, [pairs, mode, unit, valueLabel, height]);

  const scatterFigure = useMemo(() => {
    const all = [...pairs.o, ...pairs.r];
    const lo = all.length ? Math.min(...all) : 0;
    const hi = all.length ? Math.max(...all) : 1;
    const pad = (hi - lo) * 0.06 || 0.5;
    const axLo = lo - pad;
    const axHi = hi + pad;

    const traces: Partial<PlotData>[] = [
      // 1:1 first so points sit above it.
      {
        x: [axLo, axHi],
        y: [axLo, axHi],
        type: 'scatter',
        mode: 'lines',
        name: 'perfect agreement (1:1)',
        line: { color: IDENTITY_COLOR, width: 1.5, dash: 'dot' },
        hoverinfo: 'skip',
      } as Partial<PlotData>,
      {
        x: pairs.o,
        y: pairs.r,
        customdata: pairs.labels,
        type: 'scatter',
        mode: 'markers',
        name: 'paired values',
        marker: {
          size: 6,
          color: 'rgba(56,189,248,0.6)',
          line: { color: AXIS_COLOR, width: 0.5 },
        },
        hovertemplate:
          '%{customdata}<br>' +
          `Ours: %{x:.2f} ${unit}<br>ERA5: %{y:.2f} ${unit}<extra></extra>`,
      } as Partial<PlotData>,
    ];

    const ls = leastSquares(pairs.o, pairs.r);
    if (ls) {
      traces.push({
        x: [axLo, axHi],
        y: [ls.intercept + ls.slope * axLo, ls.intercept + ls.slope * axHi],
        type: 'scatter',
        mode: 'lines',
        name: `least squares (slope ${ls.slope.toFixed(2)})`,
        line: { color: ERA5_COLOR, width: 1.5, dash: 'dash' },
        hoverinfo: 'skip',
      } as Partial<PlotData>);
    }

    const layout: Partial<Layout> = {
      ...BASE_LAYOUT,
      height,
      margin: { l: 56, r: 14, t: 26, b: 44 },
      showlegend: true,
      legend: { orientation: 'h', y: 1.16, x: 0, font: { size: 10 } },
      xaxis: {
        title: { text: `Ours (${unit})`, font: { size: 11 } },
        gridcolor: GRID_COLOR,
        tickfont: { size: 10 },
        range: [axLo, axHi],
      },
      yaxis: {
        title: { text: `ERA5 (${unit})`, font: { size: 11 } },
        gridcolor: GRID_COLOR,
        tickfont: { size: 10 },
        range: [axLo, axHi],
        // Locks the aspect so "distance from 1:1" is read correctly; on a
        // stretched axis a 30 % bias can look like a tight fit.
        scaleanchor: 'x',
        scaleratio: 1,
      },
    };
    return { traces, layout };
  }, [pairs, unit, height]);

  if (pairs.labels.length < 2) {
    return (
      <p className="text-sm text-foreground/50 py-6 text-center">
        Fewer than two paired points — nothing to plot.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <figure className="flex flex-col gap-1 m-0">
        <Plot
          data={seriesFigure.traces as PlotData[]}
          layout={seriesFigure.layout}
          config={CONFIG}
          style={{ width: '100%' }}
          useResizeHandler
        />
        <figcaption className="text-xs text-foreground/40 px-1">
          Same days, both datasets. A constant gap between the lines is a bias; lines that
          cross constantly are timing or sampling noise.
        </figcaption>
      </figure>
      <figure className="flex flex-col gap-1 m-0">
        <Plot
          data={scatterFigure.traces as PlotData[]}
          layout={scatterFigure.layout}
          config={CONFIG}
          style={{ width: '100%' }}
          useResizeHandler
        />
        <figcaption className="text-xs text-foreground/40 px-1">
          The dotted line is 1:1, not a fit. Points above it mean ERA5 reads higher than
          ours. The dashed fit separates a proportional bias (tilted) from an additive one
          (parallel but offset).
        </figcaption>
      </figure>
    </div>
  );
}
