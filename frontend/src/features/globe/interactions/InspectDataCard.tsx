/**
 * InspectDataCard — Displays detailed climate data for a selected grid cell.
 *
 * Shows:
 * - Grid cell location (lat/lon)
 * - All climate variables (rainfall, temp_max, temp_min) with uncertainty values
 * - 7-day sparkline (placeholder visualization)
 *
 * Uses the GlassPanel design system component for consistent styling.
 *
 * Validates: Requirements 3.1, 3.3
 */

import React from 'react';
import { GlassPanel } from '../../../design-system/GlassPanel';
import type { GridCell } from '../../../types';

export interface InspectDataCardProps {
  /** The selected grid cell to display */
  cell: GridCell;
  /** Optional 7-day forecast data for sparkline (array of 7 values per variable) */
  forecast7Day?: {
    rainfall: number[];
    temp_max: number[];
    temp_min: number[];
  };
  /** Callback to close/dismiss the card */
  onClose?: () => void;
}

/**
 * Minimal SVG sparkline component for 7-day trend visualization.
 */
const Sparkline: React.FC<{ values: number[]; color: string; label: string }> = ({
  values,
  color,
  label,
}) => {
  if (values.length === 0) return null;

  const width = 120;
  const height = 28;
  const padding = 2;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = padding + (i / (values.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((v - min) / range) * (height - 2 * padding);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '10px', color: 'var(--color-text-secondary, #94a3b8)', minWidth: '50px' }}>
        {label}
      </span>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ overflow: 'visible' }}
        aria-label={`7-day sparkline for ${label}`}
        role="img"
      >
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

/**
 * InspectDataCard — Renders a floating data card showing per-cell climate details.
 */
export const InspectDataCard: React.FC<InspectDataCardProps> = ({
  cell,
  forecast7Day,
  onClose,
}) => {
  const variables = [
    {
      label: 'Rainfall',
      value: cell.rainfall,
      uncertainty: cell.rainfall_uncertainty,
      unit: 'mm',
      color: '#06b6d4',
    },
    {
      label: 'Temp Max',
      value: cell.temp_max,
      uncertainty: cell.temp_max_uncertainty,
      unit: '°C',
      color: '#f97316',
    },
    {
      label: 'Temp Min',
      value: cell.temp_min,
      uncertainty: cell.temp_min_uncertainty,
      unit: '°C',
      color: '#8b5cf6',
    },
  ];

  // Generate mock 7-day data if not provided
  const sparkData = forecast7Day ?? {
    rainfall: Array.from({ length: 7 }, () => cell.rainfall * (0.7 + Math.random() * 0.6)),
    temp_max: Array.from({ length: 7 }, () => cell.temp_max + (Math.random() - 0.5) * 4),
    temp_min: Array.from({ length: 7 }, () => cell.temp_min + (Math.random() - 0.5) * 3),
  };

  return (
    <GlassPanel className="inspect-data-card" padding="md">
      <div style={{ minWidth: '240px', maxWidth: '320px' }}>
        {/* Header with coordinates and close button */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--color-text-primary, #f1f5f9)',
                letterSpacing: '0.02em',
              }}
            >
              Grid Cell
            </div>
            <div
              style={{
                fontSize: '10px',
                color: 'var(--color-text-secondary, #94a3b8)',
                marginTop: '2px',
              }}
            >
              {cell.lat.toFixed(2)}°N, {cell.lon.toFixed(2)}°E
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close inspect card"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-secondary, #94a3b8)',
                cursor: 'pointer',
                fontSize: '16px',
                lineHeight: 1,
                padding: '4px',
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Climate variables */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {variables.map((v) => (
            <div
              key={v.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                padding: '6px 8px',
                borderRadius: '6px',
                background: 'rgba(var(--fg-rgb),var(--fg-a05))',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  color: v.color,
                  fontWeight: 500,
                }}
              >
                {v.label}
              </span>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--color-text-primary, #f1f5f9)',
                  }}
                >
                  {v.value.toFixed(1)} {v.unit}
                </span>
                <span
                  style={{
                    fontSize: '9px',
                    color: 'var(--color-text-secondary, #94a3b8)',
                    marginLeft: '4px',
                  }}
                >
                  ±{v.uncertainty.toFixed(1)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 7-day sparkline section */}
        <div style={{ marginTop: '12px', borderTop: '1px solid rgba(var(--fg-rgb),var(--fg-a05))', paddingTop: '10px' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 500,
              color: 'var(--color-text-secondary, #94a3b8)',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            7-Day Forecast
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Sparkline values={sparkData.rainfall} color="#06b6d4" label="Rain" />
            <Sparkline values={sparkData.temp_max} color="#f97316" label="T.Max" />
            <Sparkline values={sparkData.temp_min} color="#8b5cf6" label="T.Min" />
          </div>
        </div>
      </div>
    </GlassPanel>
  );
};

export default InspectDataCard;
