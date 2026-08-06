/**
 * PrecipitationType — Precipitation type classification and visualization.
 *
 * Exports pure functions for classifying precipitation type (testable), plus
 * a React component rendering:
 *  1. Distinct symbols/colors per precipitation type on the overlay data
 *  2. Snow line altitude contour (the predicted 0°C isotherm elevation)
 *  3. Accumulated snowfall predictions for grid cells above the snow line
 *
 * Classification rules (standard meteorological thresholds):
 *  - Rain          : surface temp ≥ 2°C
 *  - Sleet         : 0°C ≤ surface temp < 2°C  (mixed phase)
 *  - Freezing Rain : surface temp < 0°C, dew point > -1°C  (liquid above, frozen below)
 *  - Snow          : surface temp < 0°C, dew point ≤ -1°C
 *
 * Validates: Requirements 54.1, 54.2, 54.3, 54.4
 */

import React, { useMemo, useState } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** The four precipitation phase types (Requirement 54.1) */
export type PrecipitationPhase = 'rain' | 'sleet' | 'freezing_rain' | 'snow' | 'none';

/** Classification result for a single grid cell */
export interface PrecipTypeResult {
  lat: number;
  lon: number;
  node_idx: number;
  phase: PrecipitationPhase;
  /** Surface temperature used for classification (°C) */
  surfaceTemp: number;
  /** Dew point temperature used for classification (°C) */
  dewPoint: number;
  /** Predicted rainfall (mm) — used to compute snowfall water-equivalent */
  rainfall: number;
  /**
   * Snowfall water-equivalent (mm).  Non-zero only when phase is 'snow'
   * and the cell is above the snow line altitude.
   * Requirement 54.4: accumulated snowfall predictions above snow line.
   */
  snowfallEquivalent: number;
  /** Whether this cell is above the snow line altitude */
  aboveSnowLine: boolean;
}

/** Visual descriptor for one precipitation type (Requirement 54.2) */
export interface PrecipTypeStyle {
  phase: PrecipitationPhase;
  label: string;
  symbol: string;      // Unicode symbol rendered on globe overlay
  color: string;       // CSS hex/rgb
  borderColor: string; // For badges/outlines
}

/** Snow line contour result (Requirement 54.3) */
export interface SnowLineContour {
  /** Estimated mean altitude of the 0°C isotherm (metres) */
  altitudeM: number;
  /** Grid cells that straddle the snow line (surface temp near 0°C) */
  contourCells: Array<{ lat: number; lon: number }>;
  /** Timestamp at which the contour was computed */
  computedAt: string;
}

/** Props for the PrecipitationType React component */
export interface PrecipitationTypeProps {
  /** Grid cells with temperature and rainfall data */
  gridCells?: GridCell[];
  /**
   * Per-cell dew point temperatures keyed by node_idx.
   * When not provided, dew point is estimated from temp_min.
   */
  dewPointMap?: Map<number, number>;
  /**
   * Per-cell altitude in metres keyed by node_idx.
   * Required for snow line computation.  Falls back to lat-based heuristic.
   */
  altitudeMap?: Map<number, number>;
  /** Whether the panel is enabled */
  enabled?: boolean;
  /** Callback when snow line contour is computed */
  onSnowLineComputed?: (contour: SnowLineContour) => void;
  /** Callback when user selects a precipitation type */
  onTypeSelect?: (phase: PrecipitationPhase | null, cells: PrecipTypeResult[]) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Surface temperature thresholds for precipitation phase classification.
 * Based on standard WMO / NWS meteorological guidelines (Requirement 54.1).
 */
export const RAIN_THRESHOLD_C = 2.0;       // ≥ 2°C → rain
export const SLEET_LOWER_C   = 0.0;        // [0, 2°C) → sleet
export const FREEZING_DEW_THRESHOLD_C = -1.0; // dew point > -1°C → freezing rain vs snow

/**
 * Minimum rainfall (mm) to classify precipitation type.
 * Cells with rainfall below this are classified as 'none'.
 */
export const MIN_RAINFALL_MM = 0.1;

/**
 * Snow-to-liquid ratio: 1 mm liquid ≈ 10 mm snow depth (standard 10:1 ratio).
 * Used to estimate snowfall accumulation from rainfall water-equivalent.
 */
export const SNOW_TO_LIQUID_RATIO = 10;

/**
 * Temperature lapse rate used to estimate altitude of the 0°C isotherm.
 * Standard environmental lapse rate ≈ 6.5°C per 1000m.
 */
export const LAPSE_RATE_C_PER_M = 6.5 / 1000;

/**
 * Visual styles for each precipitation type (Requirement 54.2).
 */
export const PRECIP_TYPE_STYLES: Record<PrecipitationPhase, PrecipTypeStyle> = {
  rain:          { phase: 'rain',          label: 'Rain',          symbol: '🌧', color: '#3b82f6', borderColor: '#60a5fa' },
  sleet:         { phase: 'sleet',         label: 'Sleet',         symbol: '🌨', color: '#a78bfa', borderColor: '#c4b5fd' },
  freezing_rain: { phase: 'freezing_rain', label: 'Freezing Rain', symbol: '🧊', color: '#06b6d4', borderColor: '#67e8f9' },
  snow:          { phase: 'snow',          label: 'Snow',          symbol: '❄️', color: '#e0f2fe', borderColor: '#bae6fd' },
  none:          { phase: 'none',          label: 'No Precip',     symbol: '○',  color: 'rgba(var(--fg-rgb),var(--fg-a12))', borderColor: 'rgba(var(--fg-rgb),var(--fg-a2))' },
};

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Estimate dew point from temperature minimum.
 *
 * When no explicit dew point is supplied, temp_min is a reasonable proxy
 * since dew point ≈ minimum daily temperature in saturated conditions.
 */
export function estimateDewPoint(tempMin: number): number {
  return tempMin - 2.0; // small offset to account for incomplete saturation
}

/**
 * Classify the precipitation phase for a single grid cell.
 *
 * Rules (Requirement 54.1):
 *  - No precip    : rainfall < MIN_RAINFALL_MM
 *  - Rain         : surfaceTemp ≥ RAIN_THRESHOLD_C
 *  - Sleet        : SLEET_LOWER_C ≤ surfaceTemp < RAIN_THRESHOLD_C
 *  - Freezing Rain: surfaceTemp < SLEET_LOWER_C AND dewPoint > FREEZING_DEW_THRESHOLD_C
 *  - Snow         : surfaceTemp < SLEET_LOWER_C AND dewPoint ≤ FREEZING_DEW_THRESHOLD_C
 */
export function classifyPrecipitationType(
  rainfall: number,
  surfaceTemp: number,
  dewPoint: number,
): PrecipitationPhase {
  if (rainfall < MIN_RAINFALL_MM) return 'none';
  if (surfaceTemp >= RAIN_THRESHOLD_C) return 'rain';
  if (surfaceTemp >= SLEET_LOWER_C) return 'sleet';
  // surfaceTemp < 0
  if (dewPoint > FREEZING_DEW_THRESHOLD_C) return 'freezing_rain';
  return 'snow';
}

/**
 * Determine whether a cell is above the snow line altitude.
 *
 * When an explicit altitude is provided, compares directly.
 * Otherwise falls back to a latitude-based heuristic: cells north of 30°N
 * (Himalayan foothills) are conservatively treated as potentially high-altitude.
 *
 * Requirement 54.3: snow line altitude contour at 0°C isotherm elevation.
 */
export function isCellAboveSnowLine(
  cellAltitudeM: number | undefined,
  snowLineAltitudeM: number,
  lat: number,
): boolean {
  if (cellAltitudeM !== undefined) {
    return cellAltitudeM >= snowLineAltitudeM;
  }
  // Heuristic: cells in the Himalayan belt (lat > 30°N) may be above snow line
  return lat > 30;
}

/**
 * Estimate the altitude of the 0°C isotherm (snow line) from a surface
 * temperature observation.
 *
 * snowLineAlt = altitudeOfStation + (surfaceTemp / LAPSE_RATE_C_PER_M)
 *
 * When stationAltitude is unknown, we use 0m (sea level) as a conservative
 * lower bound. This gives:  snowLineAlt ≈ T / 0.0065 metres above the station.
 *
 * Requirement 54.3: display snow line altitude contour.
 */
export function estimateSnowLineAltitude(
  surfaceTempC: number,
  stationAltitudeM: number = 0,
): number {
  if (surfaceTempC <= 0) return stationAltitudeM; // station is at/above snow line
  return stationAltitudeM + surfaceTempC / LAPSE_RATE_C_PER_M;
}

/**
 * Compute the snowfall water-equivalent (mm) for a cell above the snow line.
 *
 * Applies the standard 10:1 snow-to-liquid ratio.
 * Returns 0 for cells not above the snow line or not classified as snow.
 *
 * Requirement 54.4: accumulated snowfall predictions above snow line.
 */
export function computeSnowfallEquivalent(
  rainfall: number,
  phase: PrecipitationPhase,
  aboveSnowLine: boolean,
): number {
  if (phase !== 'snow' || !aboveSnowLine) return 0;
  return rainfall * SNOW_TO_LIQUID_RATIO;
}

/**
 * Classify all grid cells and compute snowfall accumulation.
 *
 * This is the main batch processing function that ties together:
 *  - Phase classification per cell (Requirement 54.1)
 *  - Snow line altitude estimation (Requirement 54.3)
 *  - Snowfall accumulation for above-snow-line cells (Requirement 54.4)
 */
export function classifyAllCells(
  gridCells: GridCell[],
  dewPointMap: Map<number, number> = new Map(),
  altitudeMap: Map<number, number> = new Map(),
): PrecipTypeResult[] {
  // Derive a representative snow line altitude from all precipitating cells
  const snowLineAltitude = computeSnowLineFromGrid(gridCells, altitudeMap);

  return gridCells.map((cell) => {
    const dewPoint = dewPointMap.has(cell.node_idx)
      ? dewPointMap.get(cell.node_idx)!
      : estimateDewPoint(cell.temp_min);

    const surfaceTemp = cell.temp_max; // daily max is the critical value for phase
    const phase = classifyPrecipitationType(cell.rainfall, surfaceTemp, dewPoint);

    const cellAlt = altitudeMap.get(cell.node_idx);
    const aboveSnowLine = isCellAboveSnowLine(cellAlt, snowLineAltitude, cell.lat);
    const snowfallEquivalent = computeSnowfallEquivalent(cell.rainfall, phase, aboveSnowLine);

    return {
      lat: cell.lat,
      lon: cell.lon,
      node_idx: cell.node_idx,
      phase,
      surfaceTemp,
      dewPoint,
      rainfall: cell.rainfall,
      snowfallEquivalent,
      aboveSnowLine,
    };
  });
}

/**
 * Compute a representative snow line altitude from the grid.
 *
 * Uses the mean surface temperature of cells near the freezing point
 * and a lapse-rate calculation to estimate the 0°C isotherm height.
 *
 * Requirement 54.3: snow line altitude contour.
 */
export function computeSnowLineFromGrid(
  gridCells: GridCell[],
  altitudeMap: Map<number, number> = new Map(),
): number {
  if (gridCells.length === 0) return 3000; // default 3000m for India

  const precipitatingCells = gridCells.filter((c) => c.rainfall >= MIN_RAINFALL_MM);
  if (precipitatingCells.length === 0) return 3000;

  // Use the mean temp_max and station altitude to estimate snow line
  const meanTemp = precipitatingCells.reduce((s, c) => s + c.temp_max, 0) / precipitatingCells.length;
  const meanAlt = precipitatingCells.length > 0
    ? precipitatingCells.reduce((s, c) => s + (altitudeMap.get(c.node_idx) ?? 0), 0) / precipitatingCells.length
    : 0;

  return Math.max(0, estimateSnowLineAltitude(meanTemp, meanAlt));
}

/**
 * Build a SnowLineContour object identifying grid cells at the snow line boundary.
 *
 * Cells within ±0.5°C of 0°C surface temperature form the contour line.
 * Requirement 54.3.
 */
export function buildSnowLineContour(
  gridCells: GridCell[],
  altitudeMap: Map<number, number> = new Map(),
  now: Date = new Date(),
): SnowLineContour {
  const altitudeM = computeSnowLineFromGrid(gridCells, altitudeMap);

  const contourCells = gridCells
    .filter((c) => c.rainfall >= MIN_RAINFALL_MM && Math.abs(c.temp_max) <= 0.5)
    .map((c) => ({ lat: c.lat, lon: c.lon }));

  return { altitudeM, contourCells, computedAt: now.toISOString() };
}

/**
 * Summarize precipitation type counts and total snowfall above snow line.
 * Requirement 54.4: aggregate snowfall predictions.
 */
export function summarizePrecipTypes(results: PrecipTypeResult[]): {
  counts: Record<PrecipitationPhase, number>;
  totalSnowfallMm: number;
  aboveSnowLineCells: number;
} {
  const counts: Record<PrecipitationPhase, number> = {
    rain: 0, sleet: 0, freezing_rain: 0, snow: 0, none: 0,
  };
  let totalSnowfallMm = 0;
  let aboveSnowLineCells = 0;

  for (const r of results) {
    counts[r.phase]++;
    totalSnowfallMm += r.snowfallEquivalent;
    if (r.aboveSnowLine) aboveSnowLineCells++;
  }

  return { counts, totalSnowfallMm, aboveSnowLineCells };
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

/**
 * Mock precipitation type results for demo / fallback when grid data lacks
 * sufficient coverage of cold/high-altitude regions.
 */
export const MOCK_PRECIP_RESULTS: PrecipTypeResult[] = [
  { lat: 34.0, lon: 77.5,  node_idx: 1001, phase: 'snow',          surfaceTemp: -4.2, dewPoint: -6.1, rainfall: 12.0, snowfallEquivalent: 120, aboveSnowLine: true  },
  { lat: 32.5, lon: 76.0,  node_idx: 1002, phase: 'snow',          surfaceTemp: -1.8, dewPoint: -3.5, rainfall: 8.5,  snowfallEquivalent: 85,  aboveSnowLine: true  },
  { lat: 31.0, lon: 77.0,  node_idx: 1003, phase: 'sleet',         surfaceTemp: 0.8,  dewPoint: -0.5, rainfall: 5.2,  snowfallEquivalent: 0,   aboveSnowLine: false },
  { lat: 30.5, lon: 78.5,  node_idx: 1004, phase: 'freezing_rain', surfaceTemp: -0.5, dewPoint: 0.2,  rainfall: 3.8,  snowfallEquivalent: 0,   aboveSnowLine: false },
  { lat: 28.6, lon: 77.2,  node_idx: 1005, phase: 'rain',          surfaceTemp: 12.5, dewPoint: 8.0,  rainfall: 22.0, snowfallEquivalent: 0,   aboveSnowLine: false },
  { lat: 19.1, lon: 72.9,  node_idx: 1006, phase: 'rain',          surfaceTemp: 28.3, dewPoint: 22.0, rainfall: 45.5, snowfallEquivalent: 0,   aboveSnowLine: false },
  { lat: 13.1, lon: 80.3,  node_idx: 1007, phase: 'rain',          surfaceTemp: 30.1, dewPoint: 24.5, rainfall: 31.2, snowfallEquivalent: 0,   aboveSnowLine: false },
  { lat: 22.6, lon: 88.4,  node_idx: 1008, phase: 'rain',          surfaceTemp: 26.8, dewPoint: 20.1, rainfall: 18.7, snowfallEquivalent: 0,   aboveSnowLine: false },
  { lat: 26.9, lon: 75.8,  node_idx: 1009, phase: 'none',          surfaceTemp: 24.5, dewPoint: 10.0, rainfall: 0.0,  snowfallEquivalent: 0,   aboveSnowLine: false },
  { lat: 33.5, lon: 74.8,  node_idx: 1010, phase: 'snow',          surfaceTemp: -2.1, dewPoint: -4.0, rainfall: 9.0,  snowfallEquivalent: 90,  aboveSnowLine: true  },
];

export const MOCK_SNOW_LINE: SnowLineContour = {
  altitudeM: 2800,
  contourCells: [
    { lat: 31.0, lon: 77.0 },
    { lat: 31.25, lon: 76.75 },
    { lat: 31.5, lon: 77.25 },
  ],
  computedAt: new Date().toISOString(),
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Legend chip for a precipitation type */
const PrecipLegendChip: React.FC<{
  style: PrecipTypeStyle;
  count: number;
  isSelected: boolean;
  onClick: () => void;
}> = ({ style, count, isSelected, onClick }) => (
  <button
    onClick={onClick}
    aria-pressed={isSelected}
    aria-label={`${style.label}: ${count} cells`}
    title={`${style.label} — ${count} cells`}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: isSelected ? `${style.color}28` : 'rgba(var(--fg-rgb),var(--fg-a05))',
      border: `1px solid ${isSelected ? style.borderColor : 'rgba(var(--fg-rgb),var(--fg-a1))'}`,
      borderRadius: '8px',
      padding: '5px 10px',
      cursor: 'pointer',
      transition: 'all 150ms ease',
      color: isSelected ? style.color : 'rgba(var(--fg-rgb),var(--fg-a7))',
      fontSize: '12px',
      fontWeight: isSelected ? 600 : 400,
      flexShrink: 0,
    }}
  >
    <span style={{ fontSize: '16px' }}>{style.symbol}</span>
    <span>{style.label}</span>
    <span
      style={{
        background: isSelected ? style.color : 'rgba(var(--fg-rgb),var(--fg-a15))',
        color: isSelected ? '#000' : 'rgba(var(--fg-rgb),var(--fg-a7))',
        borderRadius: '10px',
        padding: '0 6px',
        fontSize: '10px',
        fontWeight: 700,
      }}
    >
      {count}
    </span>
  </button>
);

/** Snow line altitude display */
const SnowLineCard: React.FC<{ contour: SnowLineContour }> = ({ contour }) => (
  <div
    style={{
      background: 'rgba(186,230,253,0.07)',
      border: '1px solid rgba(186,230,253,0.25)',
      borderRadius: '8px',
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '12px',
    }}
  >
    <span style={{ fontSize: '22px' }} aria-hidden="true">🏔️</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#bae6fd' }}>
        Snow Line (0°C Isotherm)
      </div>
      <div style={{ fontSize: '12px', color: 'rgba(var(--fg-rgb),var(--fg-a6))', marginTop: '2px' }}>
        Estimated altitude: <span style={{ color: '#e0f2fe', fontWeight: 600 }}>
          {Math.round(contour.altitudeM).toLocaleString()} m
        </span>
        {' '}·{' '}
        {contour.contourCells.length} boundary cells
      </div>
    </div>
    <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', textAlign: 'right' }}>
      {new Date(contour.computedAt).toLocaleTimeString()}
    </div>
  </div>
);

/** A single precipitation cell row */
const PrecipCellRow: React.FC<{ result: PrecipTypeResult; rank: number }> = ({ result, rank }) => {
  const typeStyle = PRECIP_TYPE_STYLES[result.phase];
  return (
    <tr
      style={{
        background: rank % 2 === 0 ? 'rgba(var(--fg-rgb),var(--fg-a05))' : 'transparent',
        fontSize: '12px',
      }}
    >
      <td style={{ padding: '4px 8px', textAlign: 'center', color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontSize: '11px' }}>
        {rank}
      </td>
      <td style={{ padding: '4px 8px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            background: `${typeStyle.color}18`,
            border: `1px solid ${typeStyle.borderColor}`,
            borderRadius: '5px',
            padding: '1px 7px',
            color: typeStyle.color,
            fontWeight: 600,
            fontSize: '11px',
          }}
        >
          {typeStyle.symbol} {typeStyle.label}
        </span>
      </td>
      <td style={{ padding: '4px 8px', color: 'rgba(var(--fg-rgb),var(--fg-a7))', textAlign: 'center' }}>
        {result.lat.toFixed(2)}°N, {result.lon.toFixed(2)}°E
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'center', color: '#93c5fd' }}>
        {result.surfaceTemp.toFixed(1)}°C
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'center', color: '#60a5fa' }}>
        {result.rainfall.toFixed(1)} mm
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'center' }}>
        {result.snowfallEquivalent > 0
          ? <span style={{ color: '#e0f2fe', fontWeight: 600 }}>{result.snowfallEquivalent.toFixed(0)} mm</span>
          : <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a2))' }}>—</span>
        }
      </td>
    </tr>
  );
};

/** Snowfall accumulation summary panel */
const SnowfallSummary: React.FC<{
  totalSnowfallMm: number;
  aboveSnowLineCells: number;
  snowCellCount: number;
}> = ({ totalSnowfallMm, aboveSnowLineCells, snowCellCount }) => {
  if (snowCellCount === 0) return null;
  return (
    <div
      style={{
        background: 'rgba(224,242,254,0.06)',
        border: '1px solid rgba(186,230,253,0.2)',
        borderRadius: '8px',
        padding: '10px 14px',
        marginTop: '10px',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        textAlign: 'center',
      }}
    >
      {[
        { label: 'Snow cells',           value: String(snowCellCount),                     color: '#e0f2fe' },
        { label: 'Above snow line',       value: String(aboveSnowLineCells),                color: '#bae6fd' },
        { label: 'Total snowfall equiv.', value: `${Math.round(totalSnowfallMm)} mm`,       color: '#7dd3fc' },
      ].map(({ label, value, color }) => (
        <div key={label}>
          <div style={{ fontSize: '18px', fontWeight: 700, color }}>{value}</div>
          <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginTop: '2px' }}>{label}</div>
        </div>
      ))}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * PrecipitationType — Precipitation Type Classification Panel.
 *
 * Validates: Requirements 54.1, 54.2, 54.3, 54.4
 */
export const PrecipitationType: React.FC<PrecipitationTypeProps> = ({
  gridCells,
  dewPointMap = new Map(),
  altitudeMap = new Map(),
  enabled = true,
  onSnowLineComputed,
  onTypeSelect,
}) => {
  const [selectedPhase, setSelectedPhase] = useState<PrecipitationPhase | null>(null);

  // Classify all cells, fall back to mock data when insufficient input
  const results = useMemo<PrecipTypeResult[]>(() => {
    if (!enabled) return [];
    if (!gridCells || gridCells.length === 0) return MOCK_PRECIP_RESULTS;
    return classifyAllCells(gridCells, dewPointMap, altitudeMap);
  }, [gridCells, dewPointMap, altitudeMap, enabled]);

  // Build snow line contour
  const snowLineContour = useMemo<SnowLineContour>(() => {
    if (!gridCells || gridCells.length === 0) return MOCK_SNOW_LINE;
    const contour = buildSnowLineContour(gridCells, altitudeMap);
    onSnowLineComputed?.(contour);
    return contour;
  }, [gridCells, altitudeMap, onSnowLineComputed]);

  const summary = useMemo(() => summarizePrecipTypes(results), [results]);

  // Filter displayed cells by selected phase
  const displayedResults = useMemo(
    () => selectedPhase ? results.filter((r) => r.phase === selectedPhase) : results.filter((r) => r.phase !== 'none'),
    [results, selectedPhase],
  );

  const handlePhaseSelect = (phase: PrecipitationPhase) => {
    const next = phase === selectedPhase ? null : phase;
    setSelectedPhase(next);
    const filtered = next ? results.filter((r) => r.phase === next) : results;
    onTypeSelect?.(next, filtered);
  };

  if (!enabled) return null;

  const activePhases: PrecipitationPhase[] = ['snow', 'freezing_rain', 'sleet', 'rain'];
  const hasPrecip = activePhases.some((p) => summary.counts[p] > 0);

  return (
    <div
      className="precipitation-type"
      data-testid="precipitation-type"
      role="region"
      aria-label="Precipitation Type Classification"
    >
      {/* ── Alert Banner when freezing precipitation present ── */}
      {(summary.counts.freezing_rain > 0 || summary.counts.snow > 0) && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: 'rgba(6,182,212,0.12)',
            border: '1px solid #06b6d4',
            borderRadius: '8px',
            padding: '8px 14px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'precip-banner-pulse 2.5s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: '18px' }} aria-hidden="true">❄️</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#67e8f9' }}>
            Winter precipitation detected —{' '}
            {summary.counts.snow > 0 && `${summary.counts.snow} snow cell${summary.counts.snow !== 1 ? 's' : ''}`}
            {summary.counts.snow > 0 && summary.counts.freezing_rain > 0 && ', '}
            {summary.counts.freezing_rain > 0 && `${summary.counts.freezing_rain} freezing rain cell${summary.counts.freezing_rain !== 1 ? 's' : ''}`}
          </span>
        </div>
      )}

      {/* ── Snow Line Contour (Requirement 54.3) ── */}
      <SnowLineCard contour={snowLineContour} />

      {/* ── Main Panel ── */}
      <GlassPanel padding="md" className="precip-type-panel">
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 600,
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            margin: '0 0 12px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          🌧 Precipitation Type Classification
          <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 400, color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            {results.filter((r) => r.phase !== 'none').length} active cells
          </span>
        </h3>

        {/* ── Phase Filter Chips (Requirement 54.2) ── */}
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}
          role="group"
          aria-label="Filter by precipitation type"
        >
          {activePhases.map((phase) => (
            <PrecipLegendChip
              key={phase}
              style={PRECIP_TYPE_STYLES[phase]}
              count={summary.counts[phase]}
              isSelected={selectedPhase === phase}
              onClick={() => handlePhaseSelect(phase)}
            />
          ))}
        </div>

        {/* ── Cell Table ── */}
        {hasPrecip ? (
          <div style={{ overflowY: 'auto', maxHeight: '300px' }}>
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}
              aria-label="Precipitation type cells"
            >
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(var(--panel-bg-rgb),0.95)', zIndex: 1 }}>
                <tr>
                  {['#', 'Type', 'Location', 'Temp', 'Rain', 'Snowfall'].map((col, i) => (
                    <th
                      key={col}
                      scope="col"
                      style={{
                        padding: '5px 8px',
                        textAlign: i < 2 || i === 2 ? 'center' : 'center',
                        fontSize: '10px',
                        fontWeight: 600,
                        color: 'rgba(var(--fg-rgb),var(--fg-a4))',
                        borderBottom: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedResults.slice(0, 50).map((result, idx) => (
                  <PrecipCellRow key={result.node_idx} result={result} rank={idx + 1} />
                ))}
              </tbody>
            </table>
            {displayedResults.length > 50 && (
              <div style={{ textAlign: 'center', padding: '8px', fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
                Showing 50 of {displayedResults.length} cells
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: '24px',
              color: 'rgba(var(--fg-rgb),var(--fg-a3))',
              fontSize: '13px',
            }}
          >
            No precipitation detected in the active region
          </div>
        )}

        {/* ── Snowfall Summary (Requirement 54.4) ── */}
        <SnowfallSummary
          totalSnowfallMm={summary.totalSnowfallMm}
          aboveSnowLineCells={summary.aboveSnowLineCells}
          snowCellCount={summary.counts.snow}
        />
      </GlassPanel>

      {/* ── Animations ── */}
      <style>{`
        @keyframes precip-banner-pulse {
          0%, 100% { box-shadow: 0 0 6px rgba(6,182,212,0.2); }
          50%       { box-shadow: 0 0 16px rgba(6,182,212,0.55); }
        }
        @keyframes snow-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
      `}</style>
    </div>
  );
};

export default PrecipitationType;
