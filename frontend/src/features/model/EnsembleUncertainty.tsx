/**
 * EnsembleUncertainty — Ensemble Prediction Uncertainty Visualization.
 *
 * Exports pure functions for CV computation and confidence score (testable),
 * plus a React component that provides:
 *  1. Translucent halo data per grid cell (radius = prediction spread)  [Req 15.1]
 *  2. Spaghetti plots of individual model run predictions                [Req 15.2]
 *  3. Hatched-pattern overlay for high-uncertainty cells (CV > 0.5)     [Req 15.3]
 *  4. Overall Confidence Score (0–100%) derived from ensemble agreement  [Req 15.4]
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, VariableId } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single ensemble member's prediction for one grid cell. */
export interface EnsembleMemberValue {
  memberId: string;
  value: number;
}

/** Per-cell ensemble statistics derived from multiple model runs. */
export interface CellEnsembleStats {
  lat: number;
  lon: number;
  /** Ensemble mean (same as the grid cell prediction value). */
  mean: number;
  /** Standard deviation across ensemble members. */
  stdDev: number;
  /** Coefficient of variation = stdDev / |mean|; Infinity when mean ≈ 0. */
  cv: number;
  /** Whether this cell is high-uncertainty (CV > HIGH_UNCERTAINTY_CV_THRESHOLD). */
  highUncertainty: boolean;
  /** Halo radius in degrees (= stdDev, clamped to [0.1, 1.5]). */
  haloRadiusDeg: number;
  /** Individual member values used for spaghetti plots. */
  members: EnsembleMemberValue[];
}

/** Data required to render a halo overlay on the globe. */
export interface HaloCell {
  lat: number;
  lon: number;
  /** Opacity of the halo (0–1). */
  opacity: number;
  /** Halo radius in degrees. */
  radiusDeg: number;
  /** Whether a hatched pattern should be applied. */
  hatched: boolean;
}

/** A single time-series point for a spaghetti plot. */
export interface SpaghettiPoint {
  day: number;
  value: number;
}

/** One member's full 7-day trend line. */
export interface SpaghettiLine {
  memberId: string;
  /** Color for this member's line. */
  color: string;
  points: SpaghettiPoint[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** CV threshold above which a cell is considered high-uncertainty (Req 15.3). */
export const HIGH_UNCERTAINTY_CV_THRESHOLD = 0.5;

/** Halo radius range in degrees (Req 15.1). */
export const HALO_RADIUS_MIN_DEG = 0.1;
export const HALO_RADIUS_MAX_DEG = 1.5;

/**
 * Palette for individual spaghetti plot member lines.
 * Cycles through 8 distinguishable colors suitable on a dark background.
 */
export const SPAGHETTI_MEMBER_COLORS: string[] = [
  '#60a5fa', // blue-400
  '#34d399', // emerald-400
  '#f472b6', // pink-400
  '#fbbf24', // amber-400
  '#a78bfa', // violet-400
  '#fb923c', // orange-400
  '#22d3ee', // cyan-400
  '#4ade80', // green-400
];

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Compute the arithmetic mean of a numeric array.
 * Returns 0 for an empty array.
 */
export function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute the sample standard deviation of a numeric array.
 * Returns 0 when the array has fewer than 2 elements.
 */
export function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = computeMean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Compute the Coefficient of Variation (CV = stdDev / |mean|).
 *
 * Returns Infinity when mean is 0 and stdDev > 0.
 * Returns 0 when both mean and stdDev are 0.
 *
 * Used by Req 15.3 to detect high-uncertainty cells.
 */
export function computeCV(mean: number, stdDev: number): number {
  if (mean === 0 && stdDev === 0) return 0;
  if (mean === 0) return Infinity;
  return stdDev / Math.abs(mean);
}

/**
 * Clamp a number to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Derive ensemble statistics for a single grid cell from multiple member values.
 *
 * Req 15.1: haloRadiusDeg = clamp(stdDev, HALO_RADIUS_MIN_DEG, HALO_RADIUS_MAX_DEG).
 * Req 15.3: highUncertainty when CV > HIGH_UNCERTAINTY_CV_THRESHOLD.
 */
export function computeCellEnsembleStats(
  lat: number,
  lon: number,
  members: EnsembleMemberValue[],
): CellEnsembleStats {
  const values = members.map((m) => m.value);
  const mean = computeMean(values);
  const stdDev = computeStdDev(values);
  const cv = computeCV(mean, stdDev);
  const highUncertainty = isFinite(cv)
    ? cv > HIGH_UNCERTAINTY_CV_THRESHOLD
    : stdDev > 0; // treat Inf CV (zero mean) as high uncertainty when there's any spread

  return {
    lat,
    lon,
    mean,
    stdDev,
    cv,
    highUncertainty,
    haloRadiusDeg: clamp(stdDev, HALO_RADIUS_MIN_DEG, HALO_RADIUS_MAX_DEG),
    members,
  };
}

/**
 * Compute the overall Confidence Score (0–100%) for the forecast.
 *
 * Derived from ensemble agreement:
 *   agreement = 1 − mean(CV across all cells, capped at 1)
 *   confidence = round(agreement × 100)
 *
 * Req 15.4: Returns an integer in [0, 100].
 */
export function computeConfidenceScore(stats: CellEnsembleStats[]): number {
  if (stats.length === 0) return 100;

  const finiteCV = stats
    .map((s) => (isFinite(s.cv) ? s.cv : 1))
    .map((cv) => clamp(cv, 0, 1));

  const meanCV = computeMean(finiteCV);
  const agreement = 1 - meanCV;
  return Math.round(clamp(agreement, 0, 1) * 100);
}

/**
 * Build halo overlay cells from ensemble stats.
 * Consumers (e.g. CesiumGlobe) render translucent circles at each lat/lon
 * with the given radiusDeg and opacity.
 *
 * Req 15.1: halo radius = prediction spread (stdDev in grid units).
 * Req 15.3: hatched = true for high-uncertainty cells.
 */
export function buildHaloCells(stats: CellEnsembleStats[]): HaloCell[] {
  return stats.map((s) => ({
    lat: s.lat,
    lon: s.lon,
    opacity: clamp(s.cv * 0.6, 0.1, 0.7),
    radiusDeg: s.haloRadiusDeg,
    hatched: s.highUncertainty,
  }));
}

/**
 * Build spaghetti lines for a selected grid cell.
 * Each ensemble member gets a distinct color and a full 7-day trend array.
 *
 * `memberDayValues[memberId][day]` = predicted value for that member on that day
 * (day is 1-indexed, 1–7).
 *
 * Req 15.2: display individual model run predictions as overlapping lines.
 */
export function buildSpaghettiLines(
  memberDayValues: Record<string, number[]>,
): SpaghettiLine[] {
  return Object.entries(memberDayValues).map(([memberId, values], idx) => ({
    memberId,
    color: SPAGHETTI_MEMBER_COLORS[idx % SPAGHETTI_MEMBER_COLORS.length],
    points: values.map((value, i) => ({ day: i + 1, value })),
  }));
}

/**
 * Synthesize mock ensemble members from a grid cell's uncertainty fields.
 *
 * Used as a fallback when real multi-member data is unavailable.
 * Generates N_MOCK_MEMBERS members sampled around the cell mean ± uncertainty.
 *
 * Req 15.2 — needed so the spaghetti plot always has lines to show.
 */
export const N_MOCK_MEMBERS = 8;

export function synthesizeMockMembers(
  cell: GridCell,
  variable: VariableId,
  seed?: number,
): EnsembleMemberValue[] {
  const mean = cell[variable] as number;
  const uncertainty =
    variable === 'rainfall'
      ? cell.rainfall_uncertainty
      : variable === 'temp_max'
      ? cell.temp_max_uncertainty
      : cell.temp_min_uncertainty;

  // Simple deterministic pseudo-random based on seed (lat+lon hash)
  const baseSeed = seed ?? Math.round(cell.lat * 1000 + cell.lon * 1000);
  return Array.from({ length: N_MOCK_MEMBERS }, (_, i) => {
    // LCG-style deterministic jitter
    const jitter = ((baseSeed * (i + 1) * 1664525 + 1013904223) % 2147483648) / 2147483648;
    const delta = (jitter - 0.5) * 2 * uncertainty;
    return { memberId: `m${i + 1}`, value: mean + delta };
  });
}

/**
 * Synthesize mock 7-day trends for each ensemble member for a given cell.
 * Returns `Record<memberId, values[7]>`.
 *
 * Req 15.2 — fallback spaghetti data when no multi-member API is available.
 */
export function synthesizeMockMemberDayValues(
  cell: GridCell,
  variable: VariableId,
): Record<string, number[]> {
  const baseMembers = synthesizeMockMembers(cell, variable);
  const result: Record<string, number[]> = {};
  for (const member of baseMembers) {
    const seed = Math.round(cell.lat * 100 + cell.lon * 100 + parseFloat(member.memberId.slice(1)));
    result[member.memberId] = Array.from({ length: 7 }, (_, day) => {
      const jitter = ((seed * (day + 7) * 22695477 + 1) % 2147483648) / 2147483648;
      return member.value * (0.85 + jitter * 0.3);
    });
  }
  return result;
}

// ── Mock / Demo Data ──────────────────────────────────────────────────────────

/** Demo ensemble stats for display when no real grid data is provided. */
export function buildMockEnsembleStats(): CellEnsembleStats[] {
  const mockGrid: Array<{ lat: number; lon: number; mean: number; spread: number }> = [
    { lat: 20.0, lon: 75.0, mean: 25, spread: 4 },
    { lat: 20.25, lon: 75.25, mean: 10, spread: 8 },
    { lat: 20.5, lon: 75.5, mean: 45, spread: 3 },
    { lat: 20.75, lon: 75.75, mean: 5,  spread: 4 },
    { lat: 21.0, lon: 76.0, mean: 60, spread: 35 },  // high uncertainty
    { lat: 21.25, lon: 76.25, mean: 15, spread: 2 },
    { lat: 21.5, lon: 76.5, mean: 0.5, spread: 0.6 }, // high uncertainty (CV > 0.5)
    { lat: 21.75, lon: 76.75, mean: 80, spread: 6 },
  ];

  return mockGrid.map((g) => {
    const members: EnsembleMemberValue[] = Array.from(
      { length: N_MOCK_MEMBERS },
      (_, i) => ({ memberId: `m${i + 1}`, value: g.mean + (i - N_MOCK_MEMBERS / 2) * (g.spread / N_MOCK_MEMBERS) }),
    );
    return computeCellEnsembleStats(g.lat, g.lon, members);
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Confidence Score badge with color-coded ring */
const ConfidenceBadge: React.FC<{ score: number }> = ({ score }) => {
  const color =
    score >= 75 ? '#34d399' : // green
    score >= 50 ? '#fbbf24' : // amber
    '#f87171';               // red

  return (
    <div
      aria-label={`Overall Confidence Score: ${score}%`}
      title="Ensemble agreement — higher means models agree more"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '72px',
        height: '72px',
        borderRadius: '50%',
        border: `3px solid ${color}`,
        background: `${color}18`,
        boxShadow: `0 0 12px ${color}44`,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: '20px', fontWeight: 700, color, lineHeight: 1 }}>
        {score}%
      </span>
      <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginTop: '2px', textAlign: 'center', lineHeight: 1.2 }}>
        Conf.
      </span>
    </div>
  );
};

/** Legend row for the uncertainty scale */
const UncertaintyLegend: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-sm, 8px)',
      fontSize: '11px',
      color: 'rgba(255,255,255,0.5)',
      marginBottom: 'var(--space-md, 12px)',
    }}
  >
    <span>Low spread</span>
    <div
      aria-hidden="true"
      style={{
        flex: 1,
        height: '8px',
        borderRadius: '4px',
        background: 'linear-gradient(to right, rgba(96,165,250,0.15), rgba(96,165,250,0.8))',
      }}
    />
    <span>High spread</span>
    <span
      style={{
        marginLeft: '8px',
        padding: '1px 6px',
        border: '1px dashed rgba(255,255,255,0.4)',
        borderRadius: '3px',
        fontSize: '10px',
        color: 'rgba(255,255,255,0.4)',
      }}
    >
      ▨ CV&gt;0.5
    </span>
  </div>
);

/** Single row in the cell stats table */
const CellStatsRow: React.FC<{
  stats: CellEnsembleStats;
  rank: number;
  isSelected: boolean;
  variable: VariableId;
  onSelect: () => void;
}> = ({ stats, rank, isSelected, variable, onSelect }) => {
  const unit = variable === 'rainfall' ? 'mm' : '°C';
  const cvDisplay = isFinite(stats.cv) ? stats.cv.toFixed(2) : '∞';
  const hatchStyle = stats.highUncertainty
    ? { background: 'repeating-linear-gradient(45deg, rgba(251,191,36,0.15), rgba(251,191,36,0.15) 3px, transparent 3px, transparent 8px)' }
    : {};

  return (
    <tr
      onClick={onSelect}
      aria-selected={isSelected}
      style={{
        cursor: 'pointer',
        background: isSelected ? 'rgba(96,165,250,0.12)' : 'transparent',
        borderLeft: isSelected ? '3px solid #60a5fa' : '3px solid transparent',
        transition: 'background 150ms ease',
        ...hatchStyle,
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.06)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = isSelected ? 'rgba(96,165,250,0.12)' : 'transparent')}
    >
      <td style={{ padding: '4px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>
        {rank}
      </td>
      <td style={{ padding: '4px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.8)' }}>
        {stats.lat.toFixed(2)}°N, {stats.lon.toFixed(2)}°E
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '11px', color: '#60a5fa' }}>
        {stats.mean.toFixed(1)} {unit}
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '11px', color: 'rgba(255,255,255,0.55)' }}>
        ±{stats.stdDev.toFixed(1)}
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '11px' }}>
        <span
          style={{
            color: stats.highUncertainty ? '#fbbf24' : 'rgba(255,255,255,0.45)',
            fontWeight: stats.highUncertainty ? 700 : 400,
          }}
          title={stats.highUncertainty ? 'High uncertainty — hatched overlay applied' : undefined}
        >
          {cvDisplay}
          {stats.highUncertainty && ' ▨'}
        </span>
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>
        {stats.haloRadiusDeg.toFixed(2)}°
      </td>
    </tr>
  );
};

/**
 * Inline SVG spaghetti plot for the selected cell's 7-day forecast.
 * Each ensemble member renders as an overlapping polyline.
 *
 * Req 15.2: ensemble spaghetti plots showing individual model run predictions.
 */
const SpaghettiPlot: React.FC<{
  lines: SpaghettiLine[];
  variable: VariableId;
}> = ({ lines, variable }) => {
  const WIDTH = 260;
  const HEIGHT = 80;
  const PAD_L = 28;
  const PAD_R = 8;
  const PAD_T = 6;
  const PAD_B = 18;
  const plotW = WIDTH - PAD_L - PAD_R;
  const plotH = HEIGHT - PAD_T - PAD_B;
  const unit = variable === 'rainfall' ? 'mm' : '°C';

  const allValues = lines.flatMap((l) => l.points.map((p) => p.value));
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const valRange = maxVal - minVal || 1;

  const toX = (day: number) => PAD_L + ((day - 1) / 6) * plotW;
  const toY = (val: number) => PAD_T + (1 - (val - minVal) / valRange) * plotH;

  const meanPoints = Array.from({ length: 7 }, (_, i) => {
    const day = i + 1;
    const vals = lines.map((l) => l.points.find((p) => p.day === day)?.value ?? 0);
    return { day, value: computeMean(vals) };
  });

  const meanPath = meanPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.day).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      aria-label="Ensemble spaghetti plot — 7-day forecast spread"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Y-axis labels */}
      <text x={PAD_L - 3} y={PAD_T + 4} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.35)">
        {maxVal.toFixed(0)}{unit}
      </text>
      <text x={PAD_L - 3} y={PAD_T + plotH + 4} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.35)">
        {minVal.toFixed(0)}{unit}
      </text>

      {/* X-axis day labels */}
      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
        <text key={d} x={toX(d)} y={HEIGHT - 3} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.3)">
          D{d}
        </text>
      ))}

      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((frac) => (
        <line
          key={frac}
          x1={PAD_L} y1={PAD_T + frac * plotH}
          x2={PAD_L + plotW} y2={PAD_T + frac * plotH}
          stroke="rgba(255,255,255,0.08)" strokeWidth={1}
        />
      ))}

      {/* Ensemble member lines */}
      {lines.map((line) => {
        const d = line.points
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.day).toFixed(1)},${toY(p.value).toFixed(1)}`)
          .join(' ');
        return (
          <path
            key={line.memberId}
            d={d}
            fill="none"
            stroke={line.color}
            strokeWidth={1}
            strokeOpacity={0.55}
            aria-label={`Member ${line.memberId}`}
          />
        );
      })}

      {/* Ensemble mean line */}
      <path
        d={meanPath}
        fill="none"
        stroke="#fff"
        strokeWidth={1.5}
        strokeOpacity={0.85}
        strokeDasharray="4 2"
        aria-label="Ensemble mean"
      />
    </svg>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface EnsembleUncertaintyProps {
  /** Grid cells; when omitted or empty, demo data is used. */
  gridCells?: GridCell[];
  /** Whether the panel is active. */
  enabled?: boolean;
  /** Which variable to show uncertainty for. */
  variable?: VariableId;
  /**
   * Pre-computed multi-member day values per cell key (`${lat},${lon}`).
   * Keys: cell identifier → memberId → 7-element value array.
   * When absent, values are synthesized from the cell's uncertainty fields.
   */
  memberDayValues?: Record<string, Record<string, number[]>>;
  /**
   * Called when halo/hatched overlay data changes.
   * Consumers (e.g. CesiumGlobe) use this to update the globe overlay.
   */
  onHaloCellsChange?: (cells: HaloCell[]) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * EnsembleUncertainty — Ensemble Prediction Uncertainty Visualization.
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4
 */
export const EnsembleUncertainty: React.FC<EnsembleUncertaintyProps> = ({
  gridCells,
  enabled = true,
  variable = 'rainfall',
  memberDayValues = {},
  onHaloCellsChange,
}) => {
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);

  // ── Compute ensemble stats ───────────────────────────────────────────────────
  const ensembleStats = useMemo<CellEnsembleStats[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return buildMockEnsembleStats();

    return gridCells.map((cell) => {
      const key = `${cell.lat},${cell.lon}`;
      const existingMembers = memberDayValues[key];
      // Build per-cell member values for stats
      const memberValues: EnsembleMemberValue[] = existingMembers
        ? Object.entries(existingMembers).map(([id, vals]) => ({
            memberId: id,
            value: computeMean(vals),
          }))
        : synthesizeMockMembers(cell, variable);

      return computeCellEnsembleStats(cell.lat, cell.lon, memberValues);
    });
  }, [gridCells, enabled, variable, memberDayValues]);

  // ── Sort by CV descending (highest uncertainty first) ────────────────────────
  const sortedStats = useMemo(
    () => [...ensembleStats].sort((a, b) => {
      const cvA = isFinite(a.cv) ? a.cv : 1e9;
      const cvB = isFinite(b.cv) ? b.cv : 1e9;
      return cvB - cvA;
    }),
    [ensembleStats],
  );

  // ── Confidence score ─────────────────────────────────────────────────────────
  const confidenceScore = useMemo(
    () => computeConfidenceScore(ensembleStats),
    [ensembleStats],
  );

  // ── High-uncertainty cell count ──────────────────────────────────────────────
  const highUncertaintyCount = useMemo(
    () => ensembleStats.filter((s) => s.highUncertainty).length,
    [ensembleStats],
  );

  // ── Halo cells (notify parent) ───────────────────────────────────────────────
  const haloCells = useMemo(() => buildHaloCells(ensembleStats), [ensembleStats]);
  React.useEffect(() => {
    onHaloCellsChange?.(haloCells);
  }, [haloCells, onHaloCellsChange]);

  // ── Spaghetti data for selected cell ─────────────────────────────────────────
  const spaghettiLines = useMemo<SpaghettiLine[]>(() => {
    if (!selectedCellKey) return [];
    const selectedStats = ensembleStats.find(
      (s) => `${s.lat},${s.lon}` === selectedCellKey,
    );
    if (!selectedStats) return [];

    const existingDayValues = memberDayValues[selectedCellKey];
    const dayValues =
      existingDayValues ??
      (() => {
        const cell = gridCells?.find(
          (c) => `${c.lat},${c.lon}` === selectedCellKey,
        );
        if (!cell) return {};
        return synthesizeMockMemberDayValues(cell, variable);
      })();

    return buildSpaghettiLines(dayValues);
  }, [selectedCellKey, ensembleStats, memberDayValues, gridCells, variable]);

  const selectedStats = useMemo(
    () => ensembleStats.find((s) => `${s.lat},${s.lon}` === selectedCellKey) ?? null,
    [ensembleStats, selectedCellKey],
  );

  if (!enabled) return null;

  const unit = variable === 'rainfall' ? 'mm' : '°C';
  const varLabel =
    variable === 'rainfall' ? 'Rainfall' : variable === 'temp_max' ? 'Temp Max' : 'Temp Min';

  return (
    <div
      className="ensemble-uncertainty"
      data-testid="ensemble-uncertainty"
      role="region"
      aria-label="Ensemble Uncertainty Visualization"
    >
      {/* ── High-uncertainty banner ── */}
      {highUncertaintyCount > 0 && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: 'rgba(251,191,36,0.1)',
            border: '1px solid #fbbf24',
            borderRadius: 'var(--radius-md, 8px)',
            padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
            marginBottom: 'var(--space-md, 12px)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'eu-banner-pulse 2.5s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: '16px' }} aria-hidden="true">⚠️</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#fde68a' }}>
            {highUncertaintyCount} high-uncertainty cell{highUncertaintyCount > 1 ? 's' : ''} (CV &gt; 0.5) — hatched overlay active
          </span>
        </div>
      )}

      {/* ── Main glass panel ── */}
      <GlassPanel padding="md" className="eu-panel">

        {/* Header with confidence badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: 'var(--space-md, 12px)' }}>
          <div style={{ flex: 1 }}>
            <h3
              style={{
                fontSize: 'var(--font-heading-sm, 18px)',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.95)',
                margin: '0 0 4px 0',
              }}
            >
              🔮 Ensemble Uncertainty
            </h3>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
              {varLabel} · {ensembleStats.length} cells · {N_MOCK_MEMBERS} members
            </p>
          </div>
          {/* Req 15.4: overall Confidence Score */}
          <ConfidenceBadge score={confidenceScore} />
        </div>

        {/* Uncertainty legend */}
        <UncertaintyLegend />

        {/* Cell stats table */}
        <div style={{ overflowY: 'auto', maxHeight: '260px', marginBottom: 'var(--space-md, 12px)' }}>
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
            aria-label="Cell ensemble statistics sorted by CV descending"
          >
            <thead style={{ position: 'sticky', top: 0, background: 'rgba(6,10,22,0.95)', zIndex: 1 }}>
              <tr>
                {['#', 'Location', `Mean (${unit})`, `±StdDev`, 'CV', 'Halo°'].map((label, i) => (
                  <th
                    key={label}
                    scope="col"
                    style={{
                      padding: '5px 8px',
                      textAlign: i <= 1 ? 'left' : 'right',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.45)',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedStats.map((stats, idx) => {
                const key = `${stats.lat},${stats.lon}`;
                return (
                  <CellStatsRow
                    key={key}
                    stats={stats}
                    rank={idx + 1}
                    isSelected={selectedCellKey === key}
                    variable={variable}
                    onSelect={() => setSelectedCellKey(selectedCellKey === key ? null : key)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Spaghetti plot for selected cell — Req 15.2 */}
        {selectedStats && spaghettiLines.length > 0 && (
          <div
            style={{
              background: 'rgba(96,165,250,0.06)',
              border: '1px solid rgba(96,165,250,0.2)',
              borderRadius: 'var(--radius-md, 8px)',
              padding: '10px 12px',
            }}
          >
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontWeight: 600, marginBottom: '8px' }}>
              📈 Spaghetti Plot — {selectedStats.lat.toFixed(2)}°N, {selectedStats.lon.toFixed(2)}°E
              <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: 'rgba(255,255,255,0.35)' }}>
                7-day ensemble spread
              </span>
            </div>
            <SpaghettiPlot lines={spaghettiLines} variable={variable} />
            <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                CV: <strong style={{ color: selectedStats.highUncertainty ? '#fbbf24' : 'rgba(255,255,255,0.7)' }}>
                  {isFinite(selectedStats.cv) ? selectedStats.cv.toFixed(2) : '∞'}
                </strong>
              </span>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                Spread: <strong style={{ color: '#60a5fa' }}>±{selectedStats.stdDev.toFixed(1)} {unit}</strong>
              </span>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                Halo: <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{selectedStats.haloRadiusDeg.toFixed(2)}°</strong>
              </span>
              {selectedStats.highUncertainty && (
                <span style={{ fontSize: '10px', color: '#fbbf24', fontWeight: 600 }}>
                  ▨ Hatched (high-uncertainty)
                </span>
              )}
            </div>
          </div>
        )}

        {!selectedCellKey && (
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', margin: '6px 0 0' }}>
            Select a cell to view its spaghetti plot
          </p>
        )}
      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes eu-banner-pulse {
          0%, 100% { box-shadow: 0 0 4px rgba(251,191,36,0.2); }
          50%       { box-shadow: 0 0 14px rgba(251,191,36,0.55); }
        }
      `}</style>
    </div>
  );
};

export default EnsembleUncertainty;
