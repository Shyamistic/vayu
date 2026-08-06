/**
 * AnomalyDetection — σ-based anomaly detection and extreme event highlighting.
 *
 * Exports pure functions for classification and sorting (testable),
 * plus a React component for rendering anomaly overlays, notification banners,
 * and the Extreme Event Summary panel.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4
 */

import React, { useMemo } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, VariableId } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Severity tiers derived from σ-based classification */
export type AnomalySeverity = 'none' | 'warning' | 'severe' | 'extreme';

/** Result of anomaly detection for a single grid cell */
export interface AnomalyResult {
  cell: GridCell;
  severity: AnomalySeverity;
  /** Absolute departure from the mean in original units */
  departure: number;
  /** Number of standard deviations from mean */
  sigmaValue: number;
  /** The variable that triggered the anomaly */
  variable: VariableId;
}

/** Climatological statistics for anomaly detection */
export interface Climatology {
  mean: number;
  stdDev: number;
}

// ── Severity Color Map ───────────────────────────────────────────────────────

export const SEVERITY_COLORS: Record<AnomalySeverity, string> = {
  none: 'transparent',
  warning: '#f59e0b',   // amber
  severe: '#f97316',    // orange
  extreme: '#ef4444',   // red
};

/** Numeric score for severity ordering (higher = more severe) */
export const SEVERITY_SCORE: Record<AnomalySeverity, number> = {
  none: 0,
  warning: 1,
  severe: 2,
  extreme: 3,
};

// ── Pure Functions (exported for testing) ────────────────────────────────────

/**
 * Classify a value's anomaly severity based on σ-thresholds.
 *
 * - 'none'    if |value - mean| < 1.5σ
 * - 'warning' if 1.5σ ≤ |value - mean| < 2σ
 * - 'severe'  if 2σ ≤ |value - mean| < 3σ
 * - 'extreme' if |value - mean| ≥ 3σ
 *
 * Edge case: if stdDev ≤ 0, returns 'none' (no meaningful deviation possible).
 */
export function classifyAnomaly(
  value: number,
  mean: number,
  stdDev: number,
): AnomalySeverity {
  if (stdDev <= 0) return 'none';

  const sigmas = Math.abs(value - mean) / stdDev;
  // Preserve inclusive threshold semantics after the unavoidable rounding in
  // `(mean ± n * stdDev) - mean` used by real measurements and callers.
  //
  // The tolerance must scale with the CANCELLATION in `value - mean`, not with
  // `sigmas`. When |mean| >> stdDev the subtraction loses absolute precision of
  // order ulp(max(|mean|,|value|)); dividing by stdDev turns that into the error
  // in `sigmas`. Scaling by `sigmas` alone under-sizes the tolerance and lets a
  // value constructed as exactly mean + 3σ classify as 'severe':
  //   mean=-16.317285250627148, stdDev=0.10576175020904838 -> sigmas
  //   2.9999999999999956, needing ~1.7e-14 of slack where sigmas-scaling gives
  //   only ~1.07e-14.
  const cancellationScale = Math.max(1, Math.abs(mean), Math.abs(value));
  const thresholdTolerance = (Number.EPSILON * cancellationScale * 16) / stdDev;

  if (sigmas + thresholdTolerance >= 3) return 'extreme';
  if (sigmas + thresholdTolerance >= 2) return 'severe';
  if (sigmas + thresholdTolerance >= 1.5) return 'warning';
  return 'none';
}

/**
 * Detect anomalies across all grid cells given climatological statistics.
 *
 * Returns only cells classified as anomalous (severity !== 'none').
 */
export function detectAnomalies(
  gridCells: GridCell[],
  climatology: Climatology,
  variable: VariableId = 'rainfall',
): AnomalyResult[] {
  const { mean, stdDev } = climatology;
  const results: AnomalyResult[] = [];

  for (const cell of gridCells) {
    const value = cell[variable];
    const severity = classifyAnomaly(value, mean, stdDev);

    if (severity !== 'none') {
      const departure = Math.abs(value - mean);
      const sigmaValue = stdDev > 0 ? departure / stdDev : 0;

      results.push({
        cell,
        severity,
        departure,
        sigmaValue,
        variable,
      });
    }
  }

  return results;
}

/**
 * Sort anomaly results by severity in descending order.
 * Ties in severity are broken by sigmaValue (higher first).
 */
export function sortBySeverity(anomalies: AnomalyResult[]): AnomalyResult[] {
  return [...anomalies].sort((a, b) => {
    const scoreDiff = SEVERITY_SCORE[b.severity] - SEVERITY_SCORE[a.severity];
    if (scoreDiff !== 0) return scoreDiff;
    return b.sigmaValue - a.sigmaValue;
  });
}

// ── React Component ──────────────────────────────────────────────────────────

export interface AnomalyDetectionProps {
  gridCells: GridCell[];
  climatology: Climatology;
  variable?: VariableId;
  /** Whether anomaly detection mode is enabled */
  enabled?: boolean;
}

/**
 * AnomalyDetection panel component.
 *
 * Renders:
 * 1. Notification banner for extreme events
 * 2. Extreme Event Summary panel sorted by severity (descending)
 * 3. Anomaly overlay data for grid cell pulsing animations
 */
export const AnomalyDetection: React.FC<AnomalyDetectionProps> = ({
  gridCells,
  climatology,
  variable = 'rainfall',
  enabled = true,
}) => {
  const anomalies = useMemo(() => {
    if (!enabled) return [];
    return detectAnomalies(gridCells, climatology, variable);
  }, [gridCells, climatology, variable, enabled]);

  const sortedAnomalies = useMemo(() => sortBySeverity(anomalies), [anomalies]);

  const extremeEvents = useMemo(
    () => sortedAnomalies.filter((a) => a.severity === 'extreme'),
    [sortedAnomalies],
  );

  if (!enabled || anomalies.length === 0) return null;

  return (
    <div className="anomaly-detection">
      {/* ── Notification Banner for Extreme Events ── */}
      {extremeEvents.length > 0 && (
        <div
          className="anomaly-notification-banner"
          role="alert"
          aria-live="assertive"
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: `1px solid ${SEVERITY_COLORS.extreme}`,
            borderRadius: 'var(--radius-md, 8px)',
            padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
            marginBottom: 'var(--space-md, 12px)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm, 8px)',
            animation: 'anomaly-pulse-border 2s ease-in-out infinite',
          }}
        >
          <span
            style={{
              fontSize: 'var(--font-body-lg, 16px)',
              color: SEVERITY_COLORS.extreme,
              fontWeight: 'var(--font-weight-semibold, 600)',
            }}
          >
            ⚠ {extremeEvents.length} Extreme Anomal{extremeEvents.length === 1 ? 'y' : 'ies'} Detected
          </span>
          <span
            style={{
              fontSize: 'var(--font-small, 12px)',
              color: 'rgba(255,255,255,0.7)',
              marginLeft: 'auto',
            }}
          >
            {variable} exceeds 3σ from normal
          </span>
        </div>
      )}

      {/* ── Extreme Event Summary Panel ── */}
      <GlassPanel padding="md" className="anomaly-summary-panel">
        <h3
          style={{
            fontSize: 'var(--font-heading-sm, 18px)',
            fontWeight: 'var(--font-weight-semibold, 600)',
            color: 'rgba(255,255,255,0.95)',
            margin: '0 0 var(--space-md, 12px) 0',
          }}
        >
          Extreme Event Summary
        </h3>

        <div
          className="anomaly-list"
          style={{
            maxHeight: '320px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm, 8px)',
          }}
        >
          {sortedAnomalies.map((anomaly, idx) => (
            <AnomalyCard key={`${anomaly.cell.node_idx}-${idx}`} anomaly={anomaly} />
          ))}
        </div>

        {sortedAnomalies.length === 0 && (
          <p
            style={{
              fontSize: 'var(--font-body, 14px)',
              color: 'rgba(255,255,255,0.5)',
              textAlign: 'center',
              margin: 'var(--space-lg, 16px) 0',
            }}
          >
            No anomalies detected for current data.
          </p>
        )}
      </GlassPanel>

      {/* ── CSS Keyframes for pulsing border animations ── */}
      <style>{`
        @keyframes anomaly-pulse-border {
          0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(239, 68, 68, 0.3); }
          50% { opacity: 0.85; box-shadow: 0 0 12px rgba(239, 68, 68, 0.6); }
        }
        @keyframes anomaly-pulse-warning {
          0%, 100% { box-shadow: 0 0 4px rgba(245, 158, 11, 0.3); }
          50% { box-shadow: 0 0 10px rgba(245, 158, 11, 0.6); }
        }
        @keyframes anomaly-pulse-severe {
          0%, 100% { box-shadow: 0 0 4px rgba(249, 115, 22, 0.3); }
          50% { box-shadow: 0 0 10px rgba(249, 115, 22, 0.6); }
        }
        @keyframes anomaly-pulse-extreme {
          0%, 100% { box-shadow: 0 0 6px rgba(239, 68, 68, 0.4); }
          50% { box-shadow: 0 0 16px rgba(239, 68, 68, 0.8); }
        }
        .anomaly-card-warning { animation: anomaly-pulse-warning 2s ease-in-out infinite; }
        .anomaly-card-severe  { animation: anomaly-pulse-severe 2s ease-in-out infinite; }
        .anomaly-card-extreme { animation: anomaly-pulse-extreme 1.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

// ── Anomaly Card Sub-Component ───────────────────────────────────────────────

interface AnomalyCardProps {
  anomaly: AnomalyResult;
}

const VARIABLE_LABELS: Record<VariableId, string> = {
  rainfall: 'Rainfall',
  temp_max: 'Max Temp',
  temp_min: 'Min Temp',
};

const VARIABLE_UNITS: Record<VariableId, string> = {
  rainfall: 'mm',
  temp_max: '°C',
  temp_min: '°C',
};

const AnomalyCard: React.FC<AnomalyCardProps> = ({ anomaly }) => {
  const { cell, severity, departure, sigmaValue, variable } = anomaly;
  const color = SEVERITY_COLORS[severity];
  const value = cell[variable];

  return (
    <div
      className={`anomaly-card-${severity}`}
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-sm, 6px)',
        padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        gap: 'var(--space-sm, 8px)',
      }}
    >
      {/* Severity indicator dot */}
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />

      {/* Location and details */}
      <div>
        <div
          style={{
            fontSize: 'var(--font-body, 14px)',
            color: 'rgba(255,255,255,0.9)',
            fontWeight: 'var(--font-weight-medium, 500)',
          }}
        >
          ({cell.lat.toFixed(2)}°, {cell.lon.toFixed(2)}°)
        </div>
        <div
          style={{
            fontSize: 'var(--font-small, 12px)',
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          {VARIABLE_LABELS[variable]}: {value.toFixed(1)} {VARIABLE_UNITS[variable]} — +{departure.toFixed(1)} from normal
        </div>
      </div>

      {/* Sigma badge */}
      <span
        style={{
          fontSize: 'var(--font-small, 12px)',
          fontWeight: 'var(--font-weight-semibold, 600)',
          color,
          background: `${color}20`,
          padding: '2px 6px',
          borderRadius: 'var(--radius-sm, 6px)',
          whiteSpace: 'nowrap',
        }}
      >
        {sigmaValue.toFixed(1)}σ
      </span>
    </div>
  );
};

export default AnomalyDetection;
