/**
 * HeatWaveAlert — Heat wave detection, Heat Index computation, and alert system.
 *
 * Exports pure functions for heat wave detection and Heat Index calculation
 * (testable), plus a React component rendering the Heat Wave Bulletin,
 * "Feels Like" temperatures, and heat-distortion animation effects.
 *
 * Validates: Requirements 24.1, 24.2, 24.3, 24.4
 */

import React, { useMemo } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Threshold for heat wave classification.
 * Plains stations: 40°C, hill stations: 30°C (Requirement 24.1)
 */
export const HEAT_WAVE_THRESHOLD_PLAINS = 40;
export const HEAT_WAVE_THRESHOLD_HILLS = 30;

/**
 * Minimum consecutive days of high temperature to qualify as a heat wave.
 * Requirement 24.1: 3+ consecutive days.
 */
export const HEAT_WAVE_MIN_DAYS = 3;

/**
 * Elevation threshold (metres above sea level) above which a location
 * is considered a "hill station" for purposes of the lower threshold.
 * In the absence of DEM data we fall back to a lat-based heuristic:
 * cells north of 30°N in the western Himalayan belt are treated as hills.
 * Consumers of these pure functions may supply their own classification via
 * the `isHillStation` parameter.
 */
export const HILL_STATION_ELEVATION_THRESHOLD_M = 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

/** A sequence of daily temperature readings for one grid cell */
export interface DailyTempRecord {
  /** Cell identity */
  lat: number;
  lon: number;
  node_idx: number;
  /** Daily max temperatures in °C, ordered from day 1 to day N */
  tempMaxSeries: number[];
  /** Daily humidity values in % (0–100), same length as tempMaxSeries */
  humiditySeries: number[];
  /**
   * Whether this cell should be classified as a hill station.
   * When undefined the function falls back to latitude heuristic (lat > 30°).
   */
  isHillStation?: boolean;
}

/** Result of heat wave detection for one grid cell */
export interface HeatWaveResult {
  lat: number;
  lon: number;
  node_idx: number;
  /** Whether a heat wave is currently active */
  isHeatWave: boolean;
  /**
   * Number of consecutive days (up to present) exceeding the threshold.
   * Zero when no heat wave.
   */
  consecutiveDays: number;
  /** Peak temperature in the series (°C) */
  peakTemp: number;
  /** Heat Index ("Feels Like") for the last day in the series (°C) */
  heatIndex: number;
  /** Whether hill-station threshold was applied */
  isHillStation: boolean;
  /** Applicable threshold used (°C) */
  threshold: number;
}

/** Aggregated bulletin data */
export interface HeatWaveBulletin {
  affectedCells: HeatWaveResult[];
  generatedAt: string; // ISO-8601
  peakTemperature: number;
  maxDuration: number; // days
  recommendations: string[];
}

// ── Rothfusz Heat Index Regression (NWS formula) ─────────────────────────────

/**
 * Compute the Heat Index (°C) given dry-bulb temperature (°C) and
 * relative humidity (%).
 *
 * Uses the NWS / Rothfusz regression equation, which is valid for
 * T ≥ 27°C and RH ≥ 40%.  For cooler/drier conditions the formula
 * still returns a value; callers may interpret it as "feels like" temp.
 *
 * Reference: Steadman (1979), Rothfusz (1990 NWS Technical Attachment SR 90-23)
 */
export function computeHeatIndex(tempC: number, humidity: number): number {
  // Convert to Fahrenheit for the Rothfusz regression
  const T = tempC * 9 / 5 + 32;
  const R = humidity;

  const HI =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    6.83783e-3 * T * T -
    5.481717e-2 * R * R +
    1.22874e-3 * T * T * R +
    8.5282e-4 * T * R * R -
    1.99e-6 * T * T * R * R;

  // Convert back to Celsius
  return (HI - 32) * 5 / 9;
}

// ── Pure Detection Logic ──────────────────────────────────────────────────────

/**
 * Determine whether a location should use the hill-station threshold.
 *
 * Falls back to a simple latitude heuristic (lat > 30°N) when no explicit
 * classification is provided, because the Himalayan foothills begin ~30°N
 * and hill stations are predominantly in that belt.
 */
export function resolveIsHillStation(
  lat: number,
  isHillStation?: boolean,
): boolean {
  if (isHillStation !== undefined) return isHillStation;
  return lat > 30;
}

/**
 * Count the number of consecutive days (from the END of the series) that
 * exceed `threshold`.  Counting stops as soon as a day falls at or below
 * the threshold.
 */
export function countConsecutiveDaysAboveThreshold(
  tempMaxSeries: number[],
  threshold: number,
): number {
  let count = 0;
  for (let i = tempMaxSeries.length - 1; i >= 0; i--) {
    if (tempMaxSeries[i] > threshold) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Detect heat wave status for a single grid cell.
 *
 * A heat wave is classified when temp_max exceeds the applicable threshold
 * for ≥ HEAT_WAVE_MIN_DAYS consecutive days ending at the last day in the
 * series (Requirement 24.1).
 */
export function detectHeatWave(record: DailyTempRecord): HeatWaveResult {
  const hillStation = resolveIsHillStation(record.lat, record.isHillStation);
  const threshold = hillStation
    ? HEAT_WAVE_THRESHOLD_HILLS
    : HEAT_WAVE_THRESHOLD_PLAINS;

  const consecutiveDays = countConsecutiveDaysAboveThreshold(
    record.tempMaxSeries,
    threshold,
  );

  const peakTemp = record.tempMaxSeries.length > 0
    ? Math.max(...record.tempMaxSeries)
    : 0;

  // Compute Heat Index for the last (most recent) day
  const lastIdx = record.tempMaxSeries.length - 1;
  const lastTemp = lastIdx >= 0 ? record.tempMaxSeries[lastIdx] : 0;
  const lastHumidity = lastIdx >= 0 ? (record.humiditySeries[lastIdx] ?? 50) : 50;
  const heatIndex = computeHeatIndex(lastTemp, lastHumidity);

  return {
    lat: record.lat,
    lon: record.lon,
    node_idx: record.node_idx,
    isHeatWave: consecutiveDays >= HEAT_WAVE_MIN_DAYS,
    consecutiveDays,
    peakTemp,
    heatIndex,
    isHillStation: hillStation,
    threshold,
  };
}

/**
 * Run heat wave detection across all records and return only those
 * that are actively in a heat wave.
 */
export function detectHeatWaves(
  records: DailyTempRecord[],
): HeatWaveResult[] {
  return records.map(detectHeatWave).filter((r) => r.isHeatWave);
}

// ── Heat Index for GridCell ────────────────────────────────────────────────────

/**
 * Derive the Heat Index for a single GridCell.
 * Since GridCell doesn't carry humidity, callers must supply it separately.
 *
 * Exported so the globe layer can annotate each cell with "Feels Like" data.
 */
export function getCellHeatIndex(cell: GridCell, humidity: number): number {
  return computeHeatIndex(cell.temp_max, humidity);
}

// ── Bulletin Generation ───────────────────────────────────────────────────────

const PUBLIC_HEALTH_RECOMMENDATIONS: string[] = [
  'Avoid outdoor exposure between 12:00 and 16:00 hrs.',
  'Stay hydrated — drink at least 3 litres of water daily.',
  'Wear light, loose-fitting, and light-coloured clothing.',
  'Seek shade or air-conditioned spaces during peak heat.',
  'Check on elderly neighbours, children, and outdoor workers.',
  'Activate heat action plans in affected districts.',
  'Keep livestock and animals cool and adequately watered.',
];

/**
 * Generate a Heat Wave Bulletin from active heat wave results.
 * Requirement 24.4: affected districts, peak temps, duration, recommendations.
 */
export function generateHeatWaveBulletin(
  activeHeatWaves: HeatWaveResult[],
  now: Date = new Date(),
): HeatWaveBulletin {
  const peakTemperature = activeHeatWaves.length > 0
    ? Math.max(...activeHeatWaves.map((r) => r.peakTemp))
    : 0;
  const maxDuration = activeHeatWaves.length > 0
    ? Math.max(...activeHeatWaves.map((r) => r.consecutiveDays))
    : 0;

  // Scale recommendations based on severity
  const recs = peakTemperature >= 45
    ? PUBLIC_HEALTH_RECOMMENDATIONS
    : PUBLIC_HEALTH_RECOMMENDATIONS.slice(0, 5);

  return {
    affectedCells: [...activeHeatWaves],
    generatedAt: now.toISOString(),
    peakTemperature,
    maxDuration,
    recommendations: recs,
  };
}

// ── React Component ───────────────────────────────────────────────────────────

export interface HeatWaveAlertProps {
  /** Multi-day temperature records — one per grid cell */
  records: DailyTempRecord[];
  /** Per-cell humidity values keyed by node_idx (used for "Feels Like") */
  humidityMap?: Map<number, number>;
  /** Whether the panel is enabled */
  enabled?: boolean;
}

/**
 * HeatWaveAlert panel component.
 *
 * Renders:
 * 1. Alert banner when heat waves are detected (Req 24.1)
 * 2. Heat-distortion shimmer animation on affected areas (Req 24.2)
 * 3. "Feels Like" (Heat Index) temperature per cell (Req 24.3)
 * 4. Heat Wave Bulletin with affected cells, peak temps, duration,
 *    and public health recommendations (Req 24.4)
 */
export const HeatWaveAlert: React.FC<HeatWaveAlertProps> = ({
  records,
  humidityMap,
  enabled = true,
}) => {
  const activeHeatWaves = useMemo(() => {
    if (!enabled || records.length === 0) return [];
    return detectHeatWaves(records);
  }, [records, enabled]);

  const bulletin = useMemo(
    () => generateHeatWaveBulletin(activeHeatWaves),
    [activeHeatWaves],
  );

  if (!enabled || activeHeatWaves.length === 0) return null;

  return (
    <div className="heat-wave-alert" data-testid="heat-wave-alert">
      {/* ── Alert Banner ── */}
      <div
        className="heat-wave-banner"
        role="alert"
        aria-live="assertive"
        style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid #ef4444',
          borderRadius: 'var(--radius-md, 8px)',
          padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
          marginBottom: 'var(--space-md, 12px)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm, 8px)',
          animation: 'heat-wave-banner-pulse 2s ease-in-out infinite',
        }}
      >
        <span style={{ fontSize: '20px' }} aria-hidden="true">🌡️</span>
        <span
          style={{
            fontSize: 'var(--font-body-lg, 16px)',
            fontWeight: 'var(--font-weight-semibold, 600)',
            color: '#ef4444',
          }}
        >
          HEAT WAVE ALERT — {activeHeatWaves.length} area{activeHeatWaves.length > 1 ? 's' : ''} affected
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 'var(--font-small, 12px)',
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          Peak: {bulletin.peakTemperature.toFixed(1)}°C · {bulletin.maxDuration} days
        </span>
      </div>

      {/* ── Bulletin Panel ── */}
      <GlassPanel padding="md" className="heat-wave-bulletin">
        <h3
          style={{
            fontSize: 'var(--font-heading-sm, 18px)',
            fontWeight: 'var(--font-weight-semibold, 600)',
            color: 'rgba(255,255,255,0.95)',
            margin: '0 0 var(--space-md, 12px) 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          🔥 Heat Wave Bulletin
          <span
            style={{
              fontSize: 'var(--font-small, 12px)',
              fontWeight: 400,
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            Generated {new Date(bulletin.generatedAt).toLocaleTimeString()}
          </span>
        </h3>

        {/* Affected cells list */}
        <div
          style={{
            maxHeight: '260px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm, 8px)',
            marginBottom: 'var(--space-md, 12px)',
          }}
        >
          {activeHeatWaves.map((result) => {
            const humidity = humidityMap?.get(result.node_idx) ?? 50;
            return (
              <HeatWaveCell
                key={result.node_idx}
                result={result}
                humidity={humidity}
              />
            );
          })}
        </div>

        {/* Recommendations */}
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            paddingTop: 'var(--space-md, 12px)',
          }}
        >
          <h4
            style={{
              fontSize: 'var(--font-body, 14px)',
              fontWeight: 'var(--font-weight-semibold, 600)',
              color: '#f97316',
              margin: '0 0 var(--space-sm, 8px) 0',
            }}
          >
            Public Health Recommendations
          </h4>
          <ul
            style={{
              margin: 0,
              paddingLeft: 'var(--space-lg, 16px)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {bulletin.recommendations.map((rec, idx) => (
              <li
                key={idx}
                style={{
                  fontSize: 'var(--font-small, 12px)',
                  color: 'rgba(255,255,255,0.75)',
                  lineHeight: 1.5,
                }}
              >
                {rec}
              </li>
            ))}
          </ul>
        </div>
      </GlassPanel>

      {/* ── CSS: Heat-distortion shimmer animation (Req 24.2) ── */}
      <style>{`
        @keyframes heat-distortion {
          0%   { filter: blur(0px)   brightness(1.0); opacity: 0.85; }
          25%  { filter: blur(0.8px) brightness(1.08); opacity: 0.92; }
          50%  { filter: blur(1.2px) brightness(1.14); opacity: 1.0; }
          75%  { filter: blur(0.8px) brightness(1.08); opacity: 0.92; }
          100% { filter: blur(0px)   brightness(1.0); opacity: 0.85; }
        }
        @keyframes heat-wave-banner-pulse {
          0%, 100% { box-shadow: 0 0 6px rgba(239, 68, 68, 0.3); }
          50%       { box-shadow: 0 0 18px rgba(239, 68, 68, 0.7); }
        }
        @keyframes heat-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        .heat-wave-cell-distortion {
          animation: heat-distortion 3s ease-in-out infinite;
        }
        .heat-wave-shimmer-badge {
          background: linear-gradient(
            90deg,
            rgba(239,68,68,0.6) 25%,
            rgba(251,146,60,0.9) 50%,
            rgba(239,68,68,0.6) 75%
          );
          background-size: 200% auto;
          animation: heat-shimmer 2s linear infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>
    </div>
  );
};

// ── HeatWaveCell Sub-Component ────────────────────────────────────────────────

interface HeatWaveCellProps {
  result: HeatWaveResult;
  humidity: number;
}

const HeatWaveCell: React.FC<HeatWaveCellProps> = ({ result, humidity }) => {
  const feelsLike = computeHeatIndex(result.peakTemp, humidity);
  const stationType = result.isHillStation ? 'Hill' : 'Plains';

  return (
    <div
      className="heat-wave-cell-distortion"
      data-testid={`heat-wave-cell-${result.node_idx}`}
      style={{
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.5)',
        borderRadius: 'var(--radius-sm, 6px)',
        padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'start',
        gap: 'var(--space-sm, 8px)',
      }}
    >
      {/* Left: location and stats */}
      <div>
        <div
          style={{
            fontSize: 'var(--font-body, 14px)',
            fontWeight: 'var(--font-weight-medium, 500)',
            color: 'rgba(255,255,255,0.9)',
            marginBottom: '2px',
          }}
        >
          ({result.lat.toFixed(2)}°N, {result.lon.toFixed(2)}°E)
          <span
            style={{
              marginLeft: '6px',
              fontSize: 'var(--font-small, 11px)',
              color: 'rgba(255,255,255,0.4)',
              fontWeight: 400,
            }}
          >
            {stationType} station · {result.threshold}°C threshold
          </span>
        </div>
        <div
          style={{
            fontSize: 'var(--font-small, 12px)',
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          Peak: {result.peakTemp.toFixed(1)}°C ·&nbsp;
          <span
            className="heat-wave-shimmer-badge"
            aria-label={`Feels like ${feelsLike.toFixed(1)} degrees Celsius`}
          >
            Feels Like {feelsLike.toFixed(1)}°C
          </span>
          &nbsp;· {result.consecutiveDays} consecutive day{result.consecutiveDays !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Right: duration badge */}
      <span
        style={{
          fontSize: 'var(--font-small, 12px)',
          fontWeight: 'var(--font-weight-semibold, 600)',
          color: '#ef4444',
          background: 'rgba(239, 68, 68, 0.15)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm, 6px)',
          whiteSpace: 'nowrap',
        }}
      >
        Day {result.consecutiveDays}
      </span>
    </div>
  );
};

export default HeatWaveAlert;
