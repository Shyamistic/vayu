/**
 * DroughtMonitor — SPI-based drought monitoring with choropleth overlay,
 * drought advisories, and trend sparklines.
 *
 * Exports pure functions for SPI computation and drought classification (testable),
 * plus a React component rendering the drought monitoring panel.
 *
 * Validates: Requirements 21.1, 21.2, 21.3, 21.4
 */

import React, { useMemo } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────────

/** SPI timescale in months */
export type SPITimescale = 1 | 3 | 6;

/** Standard drought classification categories */
export type DroughtCategory =
  | 'extreme_drought'    // SPI < -2.0
  | 'severe_drought'     // -2.0 to -1.5
  | 'moderate_drought'   // -1.5 to -1.0
  | 'near_normal'        // -1.0 to 1.0
  | 'moderately_wet'     // 1.0 to 1.5
  | 'severely_wet'       // 1.5 to 2.0
  | 'extremely_wet';     // > 2.0

/** SPI result for a single grid cell */
export interface SPIResult {
  cell: GridCell;
  spi: number;
  category: DroughtCategory;
  timescale: SPITimescale;
}

/** Drought advisory generated when SPI < -1.5 */
export interface DroughtAdvisory {
  cell: GridCell;
  spi: number;
  category: DroughtCategory;
  timescale: SPITimescale;
  message: string;
}

/** Sparkline data for a single grid cell / region over the past 6 months */
export interface DroughtSparkline {
  regionKey: string;
  spiValues: number[];   // SPI values for the past 6 months (oldest first)
  labels: string[];      // Month labels e.g. ["Jan", "Feb", ...]
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Standard choropleth colors for drought classification (Req 21.2) */
export const DROUGHT_COLORS: Record<DroughtCategory, string> = {
  extreme_drought:  '#7f0000', // dark red
  severe_drought:   '#d73027', // red
  moderate_drought: '#fc8d59', // orange-red
  near_normal:      '#fee090', // pale yellow
  moderately_wet:   '#91bfdb', // light blue
  severely_wet:     '#4575b4', // blue
  extremely_wet:    '#023858', // dark blue
};

/** Human-readable labels for each drought category */
export const DROUGHT_LABELS: Record<DroughtCategory, string> = {
  extreme_drought:  'Extreme Drought',
  severe_drought:   'Severe Drought',
  moderate_drought: 'Moderate Drought',
  near_normal:      'Near Normal',
  moderately_wet:   'Moderately Wet',
  severely_wet:     'Severely Wet',
  extremely_wet:    'Extremely Wet',
};

/** Ordered categories for legend rendering (dry to wet) */
export const DROUGHT_CATEGORIES_ORDERED: DroughtCategory[] = [
  'extreme_drought',
  'severe_drought',
  'moderate_drought',
  'near_normal',
  'moderately_wet',
  'severely_wet',
  'extremely_wet',
];

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Classify an SPI value into a standard drought category.
 *
 * Standard WMO classification:
 * - Extreme Drought:  SPI < -2.0
 * - Severe Drought:   -2.0 ≤ SPI < -1.5
 * - Moderate Drought: -1.5 ≤ SPI < -1.0
 * - Near Normal:      -1.0 ≤ SPI ≤ 1.0
 * - Moderately Wet:    1.0 < SPI ≤ 1.5
 * - Severely Wet:      1.5 < SPI ≤ 2.0
 * - Extremely Wet:     SPI > 2.0
 */
export function classifyDrought(spi: number): DroughtCategory {
  if (spi < -2.0) return 'extreme_drought';
  if (spi < -1.5) return 'severe_drought';
  if (spi < -1.0) return 'moderate_drought';
  if (spi <= 1.0) return 'near_normal';
  if (spi <= 1.5) return 'moderately_wet';
  if (spi <= 2.0) return 'severely_wet';
  return 'extremely_wet';
}

/**
 * Compute the Standardized Precipitation Index (SPI) for a rainfall time series.
 *
 * SPI is computed by:
 * 1. Fitting a gamma distribution to the historical precipitation series.
 * 2. Transforming fitted CDF probabilities to standard normal quantiles.
 *
 * This implementation uses method-of-moments to estimate gamma parameters
 * and a rational approximation (Abramowitz & Stegun) to compute the normal quantile.
 *
 * @param rainfallSeries - Array of monthly rainfall values (≥ timescale length).
 *   For SPI-N, you should pass accumulated N-month totals for the window of interest.
 * @returns SPI value (z-score), or 0 if the series is too short or has zero variance.
 */
export function computeSPI(rainfallSeries: number[]): number {
  if (rainfallSeries.length < 2) return 0;

  // Separate zero and non-zero values for mixed distribution
  const nonZero = rainfallSeries.filter((v) => v > 0);
  if (nonZero.length === 0) return -3.09; // extreme dry (p ≈ 0.001)

  const q = (rainfallSeries.length - nonZero.length) / rainfallSeries.length;
  const currentValue = rainfallSeries[rainfallSeries.length - 1];

  // If current value is zero, map to the probability mass for zeros
  if (currentValue <= 0) {
    const p = q / 2; // Use midpoint of zero-probability mass
    return normalQuantile(Math.max(p, 0.001));
  }

  // Method-of-moments gamma parameter estimation on non-zero values
  const n = nonZero.length;
  const mean = nonZero.reduce((s, v) => s + v, 0) / n;
  const variance = nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1 || 1);

  if (variance <= 0 || mean <= 0) return 0;

  // Gamma shape (α) and scale (β) parameters
  const alpha = (mean * mean) / variance;
  const beta = variance / mean;

  // Regularized incomplete gamma function P(α, x/β) gives CDF
  const gammaCDF = regularizedGammaP(alpha, currentValue / beta);

  // Mixed distribution CDF: H(x) = q + (1 - q) * G(x)
  const H = q + (1 - q) * gammaCDF;

  // Clamp to avoid infinities in the normal quantile transform
  const clamped = Math.max(0.001, Math.min(0.999, H));
  return normalQuantile(clamped);
}

/**
 * Compute N-month accumulated rainfall windows from a monthly series.
 * Returns the rolling N-month sums, aligned so index i = sum of months [i-N+1 .. i].
 */
export function accumulateRainfall(monthly: number[], timescale: SPITimescale): number[] {
  if (monthly.length < timescale) return [];
  const accumulated: number[] = [];
  for (let i = timescale - 1; i < monthly.length; i++) {
    let sum = 0;
    for (let j = i - timescale + 1; j <= i; j++) sum += monthly[j];
    accumulated.push(sum);
  }
  return accumulated;
}

/**
 * Compute SPI for all grid cells given their historical rainfall series.
 *
 * @param gridCells        - Current grid cells (used for lat/lon metadata).
 * @param rainfallHistory  - Map from node_idx → monthly rainfall array (mm).
 * @param timescale        - SPI timescale (1, 3, or 6 months).
 * @returns Array of SPIResult for each cell.
 */
export function computeSPIForGrid(
  gridCells: GridCell[],
  rainfallHistory: Map<number, number[]>,
  timescale: SPITimescale,
): SPIResult[] {
  return gridCells.map((cell) => {
    const monthly = rainfallHistory.get(cell.node_idx) ?? [];
    const accumulated = accumulateRainfall(monthly, timescale);
    const spi = accumulated.length >= 2 ? computeSPI(accumulated) : 0;
    const category = classifyDrought(spi);
    return { cell, spi, category, timescale };
  });
}

/**
 * Generate drought advisories for cells where SPI < -1.5 (Req 21.3).
 *
 * Advisory is raised for both 'severe_drought' (SPI < -1.5) and
 * 'extreme_drought' (SPI < -2.0) categories.
 */
export function generateDroughtAdvisories(
  spiResults: SPIResult[],
): DroughtAdvisory[] {
  return spiResults
    .filter((r) => r.spi < -1.5)
    .map((r) => {
      const label = DROUGHT_LABELS[r.category];
      const message =
        r.spi < -2.0
          ? `EXTREME DROUGHT WARNING: SPI-${r.timescale} = ${r.spi.toFixed(2)} at (${r.cell.lat.toFixed(2)}°, ${r.cell.lon.toFixed(2)}°). Immediate water management intervention required.`
          : `Severe Drought Advisory: SPI-${r.timescale} = ${r.spi.toFixed(2)} at (${r.cell.lat.toFixed(2)}°, ${r.cell.lon.toFixed(2)}°). ${label} conditions detected.`;
      return {
        cell: r.cell,
        spi: r.spi,
        category: r.category,
        timescale: r.timescale,
        message,
      };
    });
}

/**
 * Build drought trend sparkline data for each unique region key (grid cell).
 *
 * @param gridCells       - Current grid cells.
 * @param rainfallHistory - Map from node_idx → monthly rainfall array.
 * @param timescale       - SPI timescale.
 * @param monthLabels     - Labels for the 6 most recent months (oldest first).
 */
export function buildSparklines(
  gridCells: GridCell[],
  rainfallHistory: Map<number, number[]>,
  timescale: SPITimescale,
  monthLabels: string[],
): DroughtSparkline[] {
  return gridCells.map((cell) => {
    const monthly = rainfallHistory.get(cell.node_idx) ?? [];
    const accumulated = accumulateRainfall(monthly, timescale);
    // Take the last 6 SPI values for the sparkline trend
    const spiHistory: number[] = [];
    for (let i = 0; i < accumulated.length; i++) {
      const slice = accumulated.slice(0, i + 1);
      spiHistory.push(slice.length >= 2 ? computeSPI(slice) : 0);
    }
    const last6 = spiHistory.slice(-6);
    return {
      regionKey: `${cell.lat.toFixed(2)}_${cell.lon.toFixed(2)}`,
      spiValues: last6,
      labels: monthLabels.slice(-last6.length),
    };
  });
}

// ── Math Helpers ─────────────────────────────────────────────────────────────

/**
 * Regularized lower incomplete gamma function P(a, x) via series expansion.
 * Accurate for a > 0, x ≥ 0.
 */
export function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= a + 50) return 1; // Asymptotic: practically 1

  // Series expansion: P(a,x) = e^{-x} * x^a / Γ(a) * Σ x^n / (a*(a+1)*..*(a+n))
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n <= 200; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < 1e-10 * Math.abs(sum)) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * sum);
}

/**
 * Log-gamma function using Lanczos approximation (g=7, n=9).
 */
export function logGamma(z: number): number {
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const g = 7;
  const x = z - 1;
  let t = x + g + 0.5;
  let ser = c[0];
  for (let i = 1; i < c.length; i++) ser += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(ser);
}

/**
 * Rational approximation for the standard normal quantile (inverse CDF).
 * Based on Peter J. Acklam's algorithm (max error 1.15e-9).
 */
export function normalQuantile(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02,
              -2.759285104469687e+02, 1.383577518672690e+02,
              -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02,
              -1.556989798598866e+02, 6.680131188771972e+01,
              -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
              -2.400758277161838e+00, -2.549732539343734e+00,
               4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01,
              2.445134137142996e+00, 3.754408661907416e+00];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p <= 0) return -8;
  if (p >= 1) return 8;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }

  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }

  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// ── React Component ──────────────────────────────────────────────────────────

export interface DroughtMonitorProps {
  /** Current grid cells (for lat/lon metadata) */
  gridCells: GridCell[];
  /**
   * Historical monthly rainfall per node_idx.
   * Map<node_idx, number[]> where array is ordered oldest→newest, one entry per month.
   */
  rainfallHistory: Map<number, number[]>;
  /** Active SPI timescale */
  timescale?: SPITimescale;
  /** Whether the drought monitor panel is enabled */
  enabled?: boolean;
  /** Month labels for sparklines (last 6, oldest first) */
  monthLabels?: string[];
}

/**
 * DroughtMonitor panel component.
 *
 * Renders:
 * 1. SPI choropleth color legend (Extreme Drought → Extremely Wet)
 * 2. Per-cell SPI results with classification color coding
 * 3. Drought advisories when SPI < -1.5
 * 4. Drought trend sparklines showing SPI evolution over past 6 months
 */
export const DroughtMonitor: React.FC<DroughtMonitorProps> = ({
  gridCells,
  rainfallHistory,
  timescale = 3,
  enabled = true,
  monthLabels = ['M-5', 'M-4', 'M-3', 'M-2', 'M-1', 'M'],
}) => {
  const spiResults = useMemo(
    () => (enabled ? computeSPIForGrid(gridCells, rainfallHistory, timescale) : []),
    [gridCells, rainfallHistory, timescale, enabled],
  );

  const advisories = useMemo(
    () => generateDroughtAdvisories(spiResults),
    [spiResults],
  );

  const sparklines = useMemo(
    () =>
      enabled
        ? buildSparklines(gridCells, rainfallHistory, timescale, monthLabels)
        : [],
    [gridCells, rainfallHistory, timescale, monthLabels, enabled],
  );

  if (!enabled) return null;

  const droughtCells = spiResults.filter(
    (r) => r.category !== 'near_normal',
  );

  return (
    <div className="drought-monitor" aria-label="Drought Monitor Panel">
      {/* ── Drought Advisory Banners ── */}
      {advisories.length > 0 && (
        <div
          className="drought-advisories"
          role="alert"
          aria-live="assertive"
          style={{ marginBottom: 'var(--space-md, 12px)' }}
        >
          {advisories.map((adv, i) => (
            <div
              key={`adv-${adv.cell.node_idx}-${i}`}
              style={{
                background: adv.spi < -2.0
                  ? 'rgba(127, 0, 0, 0.2)'
                  : 'rgba(215, 48, 39, 0.15)',
                border: `1px solid ${DROUGHT_COLORS[adv.category]}`,
                borderRadius: 'var(--radius-md, 8px)',
                padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
                marginBottom: 'var(--space-sm, 8px)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-sm, 8px)',
                animation: 'drought-pulse 2.5s ease-in-out infinite',
              }}
            >
              <span
                style={{
                  fontSize: 'var(--font-body-lg, 16px)',
                  flexShrink: 0,
                  marginTop: '1px',
                }}
              >
                {adv.spi < -2.0 ? '🔴' : '🟠'}
              </span>
              <span
                style={{
                  fontSize: 'var(--font-small, 12px)',
                  color: 'rgba(var(--fg-rgb),var(--fg-a75))',
                  lineHeight: 1.5,
                }}
              >
                {adv.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Main Panel ── */}
      <GlassPanel padding="lg" className="drought-monitor-panel">
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-md, 12px)',
          }}
        >
          <h3
            style={{
              fontSize: 'var(--font-heading-sm, 18px)',
              fontWeight: 'var(--font-weight-semibold, 600)',
              color: 'rgba(var(--fg-rgb),var(--fg-a75))',
              margin: 0,
            }}
          >
            Drought Monitor — SPI-{timescale}
          </h3>
          <span
            style={{
              fontSize: 'var(--font-small, 12px)',
              color: 'rgba(var(--fg-rgb),var(--fg-a4))',
              background: 'rgba(var(--fg-rgb),var(--fg-a05))',
              borderRadius: 'var(--radius-full, 9999px)',
              padding: '2px 8px',
            }}
          >
            {droughtCells.length} cells active
          </span>
        </div>

        {/* ── SPI Choropleth Legend ── */}
        <div
          style={{ marginBottom: 'var(--space-md, 12px)' }}
          aria-label="SPI classification legend"
        >
          <div
            style={{
              fontSize: 'var(--font-small, 12px)',
              color: 'rgba(var(--fg-rgb),var(--fg-a6))',
              marginBottom: 'var(--space-xs, 4px)',
            }}
          >
            SPI Classification
          </div>
          <div style={{ display: 'flex', gap: '2px', borderRadius: 'var(--radius-sm, 6px)', overflow: 'hidden' }}>
            {DROUGHT_CATEGORIES_ORDERED.map((cat) => (
              <div
                key={cat}
                title={DROUGHT_LABELS[cat]}
                style={{
                  flex: 1,
                  height: '10px',
                  background: DROUGHT_COLORS[cat],
                }}
              />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--font-caption, 10px)',
              color: 'rgba(var(--fg-rgb),var(--fg-a4))',
              marginTop: '2px',
            }}
          >
            <span>Extreme Drought &lt;-2.0</span>
            <span>Near Normal</span>
            <span>&gt;2.0 Extremely Wet</span>
          </div>
        </div>

        {/* ── SPI Results Grid ── */}
        {spiResults.length === 0 ? (
          <p
            style={{
              fontSize: 'var(--font-body, 14px)',
              color: 'rgba(var(--fg-rgb),var(--fg-a4))',
              textAlign: 'center',
              margin: 'var(--space-lg, 16px) 0',
            }}
          >
            No SPI data available. Provide rainfall history to compute indices.
          </p>
        ) : (
          <div
            style={{
              maxHeight: '240px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-xs, 4px)',
              marginBottom: 'var(--space-md, 12px)',
            }}
          >
            {spiResults
              .filter((r) => r.category !== 'near_normal')
              .sort((a, b) => a.spi - b.spi) // driest first
              .map((result, idx) => (
                <SPICell key={`${result.cell.node_idx}-${idx}`} result={result} />
              ))}
          </div>
        )}

        {/* ── Drought Trend Sparklines ── */}
        {sparklines.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 'var(--font-small, 12px)',
                color: 'rgba(var(--fg-rgb),var(--fg-a6))',
                marginBottom: 'var(--space-sm, 8px)',
                fontWeight: 'var(--font-weight-medium, 500)',
              }}
            >
              SPI Trend (past 6 months)
            </div>
            <div
              style={{
                maxHeight: '200px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-sm, 8px)',
              }}
            >
              {sparklines
                .filter((s) => s.spiValues.some((v) => v < -1.0))
                .slice(0, 5)
                .map((sparkline) => (
                  <SparklineRow key={sparkline.regionKey} sparkline={sparkline} />
                ))}
            </div>
          </div>
        )}
      </GlassPanel>

      {/* ── CSS Keyframes ── */}
      <style>{`
        @keyframes drought-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
};

// ── Sub-Components ──────────────────────────────────────────────────────────

interface SPICellProps {
  result: SPIResult;
}

const SPICell: React.FC<SPICellProps> = ({ result }) => {
  const { cell, spi, category } = result;
  const color = DROUGHT_COLORS[category];
  const label = DROUGHT_LABELS[category];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '10px 1fr auto auto',
        alignItems: 'center',
        gap: 'var(--space-sm, 8px)',
        background: 'rgba(var(--fg-rgb),var(--fg-a05))',
        border: `1px solid ${color}30`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius-sm, 6px)',
        padding: '4px 8px',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      <div>
        <div
          style={{
            fontSize: 'var(--font-body, 14px)',
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
          }}
        >
          ({cell.lat.toFixed(2)}°, {cell.lon.toFixed(2)}°)
        </div>
        <div
          style={{
            fontSize: 'var(--font-caption, 10px)',
            color: 'rgba(var(--fg-rgb),var(--fg-a4))',
          }}
        >
          {label}
        </div>
      </div>
      <span
        style={{
          fontSize: 'var(--font-small, 12px)',
          fontWeight: 'var(--font-weight-semibold, 600)',
          color,
          minWidth: '48px',
          textAlign: 'right',
        }}
      >
        {spi.toFixed(2)}
      </span>
    </div>
  );
};

interface SparklineRowProps {
  sparkline: DroughtSparkline;
}

/**
 * SVG mini sparkline showing SPI trend over the past 6 months.
 * Values are mapped onto a 120×32 canvas with a zero-line.
 */
const SparklineRow: React.FC<SparklineRowProps> = ({ sparkline }) => {
  const { regionKey, spiValues } = sparkline;
  const W = 120;
  const H = 32;
  const PAD = 2;

  if (spiValues.length < 2) return null;

  const minVal = Math.min(-2.5, ...spiValues);
  const maxVal = Math.max(2.5, ...spiValues);
  const range = maxVal - minVal || 1;

  const toX = (i: number) => PAD + (i / (spiValues.length - 1)) * (W - PAD * 2);
  const toY = (v: number) => PAD + ((maxVal - v) / range) * (H - PAD * 2);

  const pts = spiValues.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const zeroY = toY(0).toFixed(1);
  const latestSPI = spiValues[spiValues.length - 1];
  const latestColor = DROUGHT_COLORS[classifyDrought(latestSPI)];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm, 8px)',
        padding: '4px 6px',
        background: 'rgba(var(--fg-rgb),var(--fg-a05))',
        borderRadius: 'var(--radius-sm, 6px)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--font-caption, 10px)',
          color: 'rgba(var(--fg-rgb),var(--fg-a4))',
          minWidth: '80px',
          lineHeight: 1.3,
        }}
      >
        {regionKey.replace('_', '\n')}
      </div>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        aria-label={`SPI trend for ${regionKey}`}
        style={{ flex: 1 }}
      >
        {/* Zero line */}
        <line
          x1={PAD}
          y1={zeroY}
          x2={W - PAD}
          y2={zeroY}
          stroke="rgba(var(--fg-rgb),var(--fg-a2))"
          strokeWidth="1"
          strokeDasharray="2,2"
        />
        {/* -1.5 advisory threshold */}
        <line
          x1={PAD}
          y1={toY(-1.5).toFixed(1)}
          x2={W - PAD}
          y2={toY(-1.5).toFixed(1)}
          stroke="rgba(215,48,39,0.4)"
          strokeWidth="1"
          strokeDasharray="3,2"
        />
        {/* Sparkline */}
        <polyline
          points={pts}
          fill="none"
          stroke={latestColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Latest value dot */}
        <circle
          cx={toX(spiValues.length - 1).toFixed(1)}
          cy={toY(latestSPI).toFixed(1)}
          r="3"
          fill={latestColor}
        />
      </svg>
      <span
        style={{
          fontSize: 'var(--font-caption, 10px)',
          fontWeight: 'var(--font-weight-semibold, 600)',
          color: latestColor,
          minWidth: '36px',
          textAlign: 'right',
        }}
      >
        {latestSPI.toFixed(1)}
      </span>
    </div>
  );
};

export default DroughtMonitor;
