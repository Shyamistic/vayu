/**
 * Regression scatter for the What-If studio: one point per season, the fitted
 * ∂R/∂T line, its 95 % confidence band, and a residual strip.
 *
 * The band and the residuals are the point of this chart. A slope shown as a
 * bare number invites more confidence than most of these fits deserve; seeing
 * the spread around the line makes an r² of 0.22 legible at a glance.
 *
 * Loaded lazily by the studio so Plotly stays out of the initial bundle.
 */

import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import type { Layout, PlotData } from 'plotly.js';

import type { RegressionFit, SensitivityPoint } from '../../types';
import { buildRegressionLine } from './whatIfFormat';

export interface WhatIfRegressionChartProps {
  points: SensitivityPoint[];
  fit: RegressionFit;
  /** Driver change currently on the slider, marked on the x axis. */
  appliedDelta?: number;
  height?: number;
}

const AXIS_COLOR = 'rgba(255,255,255,0.45)';
const GRID_COLOR = 'rgba(255,255,255,0.08)';
const FIT_COLOR = '#f59e0b';
const BAND_COLOR = 'rgba(245,158,11,0.16)';

const BASE_LAYOUT: Partial<Layout> = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { color: AXIS_COLOR, size: 11, family: 'Inter, system-ui, sans-serif' },
  showlegend: false,
  hovermode: 'closest',
};

export default function WhatIfRegressionChart({
  points,
  fit,
  appliedDelta,
  height = 300,
}: WhatIfRegressionChartProps) {
  const line = useMemo(() => buildRegressionLine(points, fit), [points, fit]);

  const usable = useMemo(
    () =>
      points.filter(
        (p) =>
          p.predictor_anomaly !== null &&
          p.response_value !== null &&
          Number.isFinite(p.predictor_anomaly) &&
          Number.isFinite(p.response_value),
      ),
    [points],
  );

  const { scatterTraces, scatterLayout } = useMemo(() => {
    const traces: Partial<PlotData>[] = [];

    if (line) {
      // Band drawn first so the markers and fit line sit on top of it. Plotly
      // builds a filled band from an upper trace plus a lower trace with
      // fill:'tonexty'.
      traces.push({
        x: line.x,
        y: line.upper,
        type: 'scatter',
        mode: 'lines',
        line: { width: 0, color: 'rgba(0,0,0,0)' },
        hoverinfo: 'skip',
      } as Partial<PlotData>);
      traces.push({
        x: line.x,
        y: line.lower,
        type: 'scatter',
        mode: 'lines',
        line: { width: 0, color: 'rgba(0,0,0,0)' },
        fill: 'tonexty',
        fillcolor: BAND_COLOR,
        hoverinfo: 'skip',
      } as Partial<PlotData>);
      traces.push({
        x: line.x,
        y: line.y,
        type: 'scatter',
        mode: 'lines',
        line: { color: FIT_COLOR, width: 2.5 },
        hovertemplate: `Fit: %{y:.2f} ${fit.response_unit}<extra></extra>`,
      } as Partial<PlotData>);
    }

    traces.push({
      x: usable.map((p) => p.predictor_anomaly as number),
      y: usable.map((p) => p.response_value as number),
      customdata: usable.map((p) => [p.year, p.predictor_value ?? 0, p.residual ?? 0]),
      type: 'scatter',
      mode: 'markers',
      marker: {
        size: 8,
        // Colour by year so any drift over the record is visible, not just the
        // cloud shape.
        color: usable.map((p) => p.year),
        colorscale: 'Viridis',
        line: { color: 'rgba(255,255,255,0.5)', width: 1 },
        showscale: false,
      },
      hovertemplate:
        '<b>%{customdata[0]}</b><br>' +
        `Driver: %{customdata[1]:.2f} ${fit.predictor_unit} ` +
        `(anomaly %{x:+.2f})<br>` +
        `Observed: %{y:.2f} ${fit.response_unit}<br>` +
        `Residual: %{customdata[2]:+.2f}<extra></extra>`,
    } as Partial<PlotData>);

    const layout: Partial<Layout> = {
      ...BASE_LAYOUT,
      height,
      margin: { l: 56, r: 14, t: 10, b: 44 },
      xaxis: {
        title: {
          text: `${fit.predictor} anomaly (${fit.predictor_unit})`,
          font: { size: 11 },
        },
        zeroline: true,
        zerolinecolor: 'rgba(255,255,255,0.22)',
        gridcolor: GRID_COLOR,
        tickfont: { size: 10 },
      },
      yaxis: {
        title: {
          text: `${fit.response} (${fit.response_unit})`,
          font: { size: 11 },
        },
        gridcolor: GRID_COLOR,
        tickfont: { size: 10 },
      },
      shapes:
        appliedDelta !== undefined && Number.isFinite(appliedDelta) && appliedDelta !== 0
          ? [
              {
                type: 'line' as const,
                x0: appliedDelta,
                x1: appliedDelta,
                yref: 'paper' as const,
                y0: 0,
                y1: 1,
                line: { color: '#38bdf8', width: 1.5, dash: 'dash' as const },
              },
            ]
          : [],
      annotations:
        appliedDelta !== undefined && Number.isFinite(appliedDelta) && appliedDelta !== 0
          ? [
              {
                x: appliedDelta,
                yref: 'paper' as const,
                y: 1,
                text: `scenario ${appliedDelta > 0 ? '+' : '−'}${Math.abs(appliedDelta)}`,
                showarrow: false,
                font: { color: '#38bdf8', size: 10 },
                xanchor: (appliedDelta > 0 ? 'right' : 'left') as 'right' | 'left',
                yanchor: 'bottom' as const,
              },
            ]
          : [],
    };

    return { scatterTraces: traces, scatterLayout: layout };
  }, [line, usable, fit, appliedDelta, height]);

  const { residualTraces, residualLayout } = useMemo(() => {
    const traces: Partial<PlotData>[] = [
      {
        x: usable.map((p) => p.year),
        y: usable.map((p) => p.residual ?? 0),
        type: 'bar',
        marker: {
          color: usable.map((p) =>
            (p.residual ?? 0) >= 0 ? 'rgba(56,189,248,0.75)' : 'rgba(248,113,113,0.75)',
          ),
        },
        hovertemplate: `%{x}: %{y:+.2f} ${fit.response_unit}<extra>residual</extra>`,
      } as Partial<PlotData>,
    ];

    const layout: Partial<Layout> = {
      ...BASE_LAYOUT,
      height: 110,
      margin: { l: 56, r: 14, t: 6, b: 30 },
      xaxis: { gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 9 }, dtick: 5 },
      yaxis: {
        title: { text: 'residual', font: { size: 10 } },
        gridcolor: GRID_COLOR,
        zeroline: true,
        zerolinecolor: 'rgba(255,255,255,0.28)',
        tickfont: { size: 9 },
      },
      bargap: 0.25,
    };
    return { residualTraces: traces, residualLayout: layout };
  }, [usable, fit]);

  if (usable.length < 2) {
    return (
      <p className="text-sm text-white/50 py-6 text-center">
        Not enough complete seasons to plot a regression.
      </p>
    );
  }

  const config = { displayModeBar: false, responsive: true } as const;

  return (
    <div className="flex flex-col gap-1">
      <Plot
        data={scatterTraces as PlotData[]}
        layout={scatterLayout}
        config={config}
        style={{ width: '100%' }}
        useResizeHandler
      />
      <Plot
        data={residualTraces as PlotData[]}
        layout={residualLayout}
        config={config}
        style={{ width: '100%' }}
        useResizeHandler
      />
      <p className="text-xs text-white/40 px-1">
        Each dot is one {fit.response === 'rainfall' ? 'season' : 'period'}, coloured by year.
        The band is the 95 % confidence interval of the fitted mean — it widens away from
        average conditions. Bars below show how far each year sat from the line.
      </p>
    </div>
  );
}
