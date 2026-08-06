/**
 * ResolutionDisplay — Km-Scale Resolution Display and Downscaling Panel.
 *
 * Implements Requirements 84.1–84.4:
 *  84.1 Displays current prediction resolution (0.25° ≈ 28km) prominently.
 *  84.2 Statistical downscaling mode (0.25° → 0.05°, elevation-aware).
 *  84.3 "Downscaled (not native resolution)" label when downscaling is active.
 *  84.4 Resolution comparison panel vs IMD, GFS, ECMWF, DestinE.
 *
 * Exports:
 *  - Pure functions for downscaling state management (testable)
 *  - ResolutionDisplay React component (UI panel)
 *  - ResolutionBadge sub-component (small inline badge)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell, VariableId } from '../../types';
import {
  downscaleGrid,
  MODEL_RESOLUTION_COMPARISON,
  MAUSAM_DOWNSCALED,
  NATIVE_RESOLUTION_KM,
  DOWNSCALED_RESOLUTION_KM,
  NATIVE_RESOLUTION_DEG,
  DOWNSCALED_RESOLUTION_DEG,
  type DownscaledCell,
  type ModelResolutionInfo,
} from '../../core/utils/downscaling';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ResolutionState {
  /** Whether the coarse 0.25° grid overlay is shown on the globe */
  showGrid: boolean;
  /** Whether statistical downscaling is active */
  downscalingActive: boolean;
  /** The variable being downscaled */
  selectedVariable: VariableId;
}

export interface ResolutionDisplayProps {
  /** Whether this panel is enabled/visible */
  enabled?: boolean;
  /** Current coarse grid cells from the model */
  gridCells?: GridCell[];
  /** Currently selected variable */
  selectedVariable?: VariableId;
  /** Callback when downscaling state changes */
  onStateChange?: (state: ResolutionState) => void;
  /** Callback providing downscaled cells for globe rendering */
  onDownscaledCells?: (cells: DownscaledCell[]) => void;
  /** Whether to show the resolution comparison panel */
  showComparison?: boolean;
}

// ── Resolution Display Label ──────────────────────────────────────────────────

interface ResolutionLabelProps {
  downscalingActive: boolean;
  style?: React.CSSProperties;
}

/**
 * ResolutionLabel — Prominent resolution indicator.
 *
 * Shows the current resolution (native or downscaled) with a
 * "Downscaled (not native resolution)" warning when applicable.
 * Validates: Requirements 84.1, 84.3
 */
export const ResolutionLabel: React.FC<ResolutionLabelProps> = ({
  downscalingActive,
  style,
}) => {
  const resKm = downscalingActive ? DOWNSCALED_RESOLUTION_KM : NATIVE_RESOLUTION_KM;
  const resDeg = downscalingActive ? DOWNSCALED_RESOLUTION_DEG : NATIVE_RESOLUTION_DEG;
  const color = downscalingActive ? '#10b981' : '#22d3ee';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={
        downscalingActive
          ? `Downscaled resolution: ${resDeg}° approximately ${resKm} km — not native resolution`
          : `Current resolution: ${resDeg}° approximately ${resKm} km`
      }
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '2px',
        ...style,
      }}
    >
      {/* Main resolution display */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '6px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-family-mono)',
            fontSize: 'var(--font-heading-sm, 18px)',
            fontWeight: 700,
            color,
            letterSpacing: '-0.02em',
          }}
        >
          {resDeg}°
        </span>
        <span
          style={{
            fontSize: 'var(--font-body, 14px)',
            fontWeight: 600,
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
          }}
        >
          ≈ {resKm} km
        </span>
      </div>

      {/* Downscaled warning label — Req 84.3 */}
      {downscalingActive && (
        <span
          role="note"
          style={{
            fontSize: 'var(--font-caption, 10px)',
            fontWeight: 600,
            color: '#f59e0b',
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: 'var(--radius-sm, 4px)',
            padding: '1px 6px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          ⚠ Downscaled (not native resolution)
        </span>
      )}
    </div>
  );
};

// ── Compact Resolution Badge ──────────────────────────────────────────────────

interface ResolutionBadgeProps {
  downscalingActive: boolean;
  onClick?: () => void;
}

/**
 * ResolutionBadge — Compact inline badge for headers/toolbars.
 *
 * Displays "0.25°/28km" (or "0.05°/6km ↓") and is clickable to open
 * the full resolution panel.  Validates: Requirement 84.1
 */
export const ResolutionBadge: React.FC<ResolutionBadgeProps> = ({
  downscalingActive,
  onClick,
}) => {
  const resKm = downscalingActive ? DOWNSCALED_RESOLUTION_KM : NATIVE_RESOLUTION_KM;
  const resDeg = downscalingActive ? DOWNSCALED_RESOLUTION_DEG : NATIVE_RESOLUTION_DEG;
  const color = downscalingActive ? '#10b981' : '#22d3ee';

  return (
    <button
      onClick={onClick}
      aria-label={`Model resolution: ${resDeg}° (${resKm} km)${downscalingActive ? ' — downscaled' : ''}. Click to open resolution panel.`}
      title="Click to open resolution display panel"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        background: `${color}15`,
        border: `1px solid ${color}50`,
        borderRadius: 'var(--radius-full, 9999px)',
        padding: '3px 10px',
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'var(--font-family-mono)',
        fontSize: 'var(--font-small, 12px)',
        fontWeight: 600,
        color,
        transition: 'background 200ms ease, border-color 200ms ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = `${color}25`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = `${color}15`;
      }}
    >
      <span aria-hidden="true">⊞</span>
      {resDeg}° / {resKm}km
      {downscalingActive && <span aria-hidden="true" style={{ fontSize: '10px' }}>↓</span>}
    </button>
  );
};

// ── Resolution Comparison Panel ───────────────────────────────────────────────

interface ComparisonPanelProps {
  downscalingActive: boolean;
}

/**
 * ComparisonPanel — Side-by-side resolution comparison bar chart.
 * Validates: Requirement 84.4
 */
const ComparisonPanel: React.FC<ComparisonPanelProps> = ({ downscalingActive }) => {
  const models: ModelResolutionInfo[] = useMemo(() => {
    const base = [...MODEL_RESOLUTION_COMPARISON];
    if (downscalingActive) {
      // Insert the downscaled resolution after MAUSAM native
      base.splice(1, 0, MAUSAM_DOWNSCALED);
    }
    return base;
  }, [downscalingActive]);

  // Normalize bar widths: best (smallest km) = 100%, MAUSAM native proportional
  const maxKm = Math.max(...models.map((m) => m.resolutionKm));

  return (
    <div
      role="region"
      aria-label="Resolution comparison across climate models"
      style={{ marginTop: 'var(--space-md, 12px)' }}
    >
      <h4
        style={{
          fontSize: 'var(--font-small, 12px)',
          fontWeight: 600,
          color: 'rgba(var(--fg-rgb),var(--fg-a6))',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          margin: '0 0 var(--space-sm, 8px) 0',
        }}
      >
        Resolution Comparison
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {models.map((model) => {
          const barWidth = (model.resolutionKm / maxKm) * 100;
          const isDownscaled = model === MAUSAM_DOWNSCALED;
          const isNative = model.isCurrentModel;

          return (
            <div
              key={model.name}
              role="listitem"
              aria-label={`${model.name}: ${model.resolutionKm} km resolution`}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              {/* Model label */}
              <span
                style={{
                  width: '68px',
                  fontSize: 'var(--font-caption, 10px)',
                  fontWeight: isNative || isDownscaled ? 700 : 500,
                  color: model.color,
                  flexShrink: 0,
                  textAlign: 'right',
                }}
              >
                {model.label}
              </span>

              {/* Bar */}
              <div
                style={{
                  flex: 1,
                  height: isNative || isDownscaled ? '10px' : '7px',
                  background: 'rgba(var(--fg-rgb),var(--fg-a08))',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: `${barWidth}%`,
                    height: '100%',
                    background: isDownscaled
                      ? `repeating-linear-gradient(45deg, ${model.color}60, ${model.color}60 3px, ${model.color}25 3px, ${model.color}25 6px)`
                      : model.color,
                    borderRadius: '4px',
                    transition: 'width 500ms var(--ease-standard)',
                    opacity: isNative || isDownscaled ? 1 : 0.7,
                  }}
                />
              </div>

              {/* Resolution value */}
              <span
                style={{
                  width: '48px',
                  fontSize: 'var(--font-caption, 10px)',
                  fontWeight: isNative || isDownscaled ? 700 : 400,
                  color: isNative || isDownscaled ? model.color : 'rgba(var(--fg-rgb),var(--fg-a4))',
                  fontFamily: 'var(--font-family-mono)',
                  flexShrink: 0,
                }}
              >
                {model.resolutionKm} km
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend note */}
      <p
        style={{
          marginTop: 'var(--space-sm, 8px)',
          fontSize: 'var(--font-caption, 10px)',
          color: 'rgba(var(--fg-rgb),var(--fg-a3))',
          lineHeight: 1.5,
        }}
      >
        Shorter bar = finer resolution. Downscaled (↓) uses statistical interpolation,
        not native model resolution.
      </p>
    </div>
  );
};

// ── Downscaling Statistics ────────────────────────────────────────────────────

interface DownscalingStatsProps {
  coarseCellCount: number;
  fineCellCount: number;
  elevationCorrectedCount: number;
  isComputing: boolean;
}

const DownscalingStats: React.FC<DownscalingStatsProps> = ({
  coarseCellCount,
  fineCellCount,
  elevationCorrectedCount,
  isComputing,
}) => {
  if (isComputing) {
    return (
      <div
        aria-busy="true"
        aria-label="Computing downscaled grid"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: 'var(--space-sm, 8px)',
          background: 'rgba(16, 185, 129, 0.08)',
          borderRadius: 'var(--radius-md, 8px)',
          marginTop: 'var(--space-sm, 8px)',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: '12px',
            height: '12px',
            border: '2px solid #10b981',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
          aria-hidden="true"
        />
        <span style={{ fontSize: 'var(--font-small, 12px)', color: '#10b981' }}>
          Computing downscaled grid…
        </span>
      </div>
    );
  }

  if (fineCellCount === 0) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '8px',
        padding: 'var(--space-sm, 8px)',
        background: 'rgba(16, 185, 129, 0.08)',
        border: '1px solid rgba(16, 185, 129, 0.25)',
        borderRadius: 'var(--radius-md, 8px)',
        marginTop: 'var(--space-sm, 8px)',
      }}
    >
      {[
        { label: 'Input cells', value: coarseCellCount, color: '#22d3ee' },
        { label: 'Output cells', value: fineCellCount, color: '#10b981' },
        { label: 'Elev. corrected', value: elevationCorrectedCount, color: '#f59e0b' },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 'var(--font-heading-sm, 18px)',
              fontWeight: 700,
              color,
              fontFamily: 'var(--font-family-mono)',
            }}
          >
            {value.toLocaleString()}
          </div>
          <div style={{ fontSize: 'var(--font-caption, 10px)', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}>
            {label}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Main ResolutionDisplay Component ─────────────────────────────────────────

/**
 * ResolutionDisplay — Main panel for km-scale resolution display and
 * statistical downscaling mode.
 *
 * Validates: Requirements 84.1, 84.2, 84.3, 84.4
 */
export const ResolutionDisplay: React.FC<ResolutionDisplayProps> = ({
  enabled = true,
  gridCells = [],
  selectedVariable = 'rainfall',
  onStateChange,
  onDownscaledCells,
  showComparison = true,
}) => {
  const [showGrid, setShowGrid] = useState(false);
  const [downscalingActive, setDownscalingActive] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const [downscaledCells, setDownscaledCells] = useState<DownscaledCell[]>([]);
  const [showDetails, setShowDetails] = useState(false);

  // Notify parent of state changes
  const emitState = useCallback(
    (newShowGrid: boolean, newDownscaling: boolean) => {
      onStateChange?.({
        showGrid: newShowGrid,
        downscalingActive: newDownscaling,
        selectedVariable,
      });
    },
    [onStateChange, selectedVariable]
  );

  const handleToggleGrid = useCallback(() => {
    const next = !showGrid;
    setShowGrid(next);
    emitState(next, downscalingActive);
  }, [showGrid, downscalingActive, emitState]);

  const handleToggleDownscaling = useCallback(() => {
    const next = !downscalingActive;
    setDownscalingActive(next);
    emitState(showGrid, next);

    if (next && gridCells.length > 0) {
      setIsComputing(true);
      // Run downscaling asynchronously to avoid blocking UI
      setTimeout(() => {
        try {
          const cells = downscaleGrid(gridCells, true);
          setDownscaledCells(cells);
          onDownscaledCells?.(cells);
        } catch (err) {
          console.error('[ResolutionDisplay] Downscaling failed:', err);
          setDownscaledCells([]);
        } finally {
          setIsComputing(false);
        }
      }, 50);
    } else if (!next) {
      setDownscaledCells([]);
      onDownscaledCells?.([]);
    }
  }, [downscalingActive, showGrid, gridCells, onDownscaledCells, emitState]);

  const elevationCorrectedCount = useMemo(
    () => downscaledCells.filter((c) => c.elevationCorrected).length,
    [downscaledCells]
  );

  if (!enabled) return null;

  return (
    <div
      className="resolution-display"
      data-testid="resolution-display"
      role="region"
      aria-label="Km-scale resolution display and downscaling panel"
    >
      <GlassPanel padding="md">
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-md, 12px)',
          }}
        >
          <h3
            style={{
              fontSize: 'var(--font-heading-sm, 18px)',
              fontWeight: 600,
              color: 'rgba(var(--fg-rgb),var(--fg-a75))',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span aria-hidden="true">⊞</span>
            Spatial Resolution
          </h3>
          <button
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            aria-label={showDetails ? 'Collapse resolution details' : 'Expand resolution details'}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(var(--fg-rgb),var(--fg-a4))',
              cursor: 'pointer',
              fontSize: 'var(--font-small, 12px)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm, 4px)',
            }}
          >
            {showDetails ? '▲ Less' : '▼ More'}
          </button>
        </div>

        {/* ── Current Resolution Badge — Req 84.1 ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-md, 12px)',
          }}
        >
          <ResolutionLabel downscalingActive={downscalingActive} />

          {/* Resolution tier indicators */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '3px',
            }}
          >
            <span
              style={{
                fontSize: 'var(--font-caption, 10px)',
                color: downscalingActive ? 'rgba(var(--fg-rgb),var(--fg-a3))' : '#22d3ee',
                fontWeight: downscalingActive ? 400 : 600,
                textDecoration: downscalingActive ? 'line-through' : 'none',
              }}
            >
              Native: 0.25° / 28 km
            </span>
            {downscalingActive && (
              <span
                style={{
                  fontSize: 'var(--font-caption, 10px)',
                  color: '#10b981',
                  fontWeight: 600,
                }}
              >
                Downscaled: 0.05° / 6 km
              </span>
            )}
          </div>
        </div>

        {/* ── Controls ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Grid overlay toggle — Req 84.1 */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              padding: '8px 10px',
              background: showGrid ? 'rgba(34, 211, 238, 0.08)' : 'rgba(var(--fg-rgb),var(--fg-a05))',
              border: `1px solid ${showGrid ? 'rgba(34,211,238,0.3)' : 'rgba(var(--fg-rgb),var(--fg-a08))'}`,
              borderRadius: 'var(--radius-md, 8px)',
              transition: 'background 200ms ease, border-color 200ms ease',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 'var(--font-body, 14px)',
                  fontWeight: 500,
                  color: showGrid ? '#22d3ee' : 'rgba(var(--fg-rgb),var(--fg-a75))',
                }}
              >
                Show Grid Overlay
              </div>
              <div
                style={{
                  fontSize: 'var(--font-caption, 10px)',
                  color: 'rgba(var(--fg-rgb),var(--fg-a4))',
                  marginTop: '2px',
                }}
              >
                Display 0.25° cell boundaries on globe
              </div>
            </div>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={handleToggleGrid}
              aria-label="Toggle grid overlay on globe showing 0.25 degree cell boundaries"
              style={{
                width: '18px',
                height: '18px',
                cursor: 'pointer',
                accentColor: '#22d3ee',
              }}
            />
          </label>

          {/* Downscaling toggle — Req 84.2 */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              padding: '8px 10px',
              background: downscalingActive
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(var(--fg-rgb),var(--fg-a05))',
              border: `1px solid ${downscalingActive ? 'rgba(16,185,129,0.3)' : 'rgba(var(--fg-rgb),var(--fg-a08))'}`,
              borderRadius: 'var(--radius-md, 8px)',
              transition: 'background 200ms ease, border-color 200ms ease',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 'var(--font-body, 14px)',
                  fontWeight: 500,
                  color: downscalingActive ? '#10b981' : 'rgba(var(--fg-rgb),var(--fg-a75))',
                }}
              >
                Statistical Downscaling
              </div>
              <div
                style={{
                  fontSize: 'var(--font-caption, 10px)',
                  color: 'rgba(var(--fg-rgb),var(--fg-a4))',
                  marginTop: '2px',
                }}
              >
                0.25° → 0.05° with elevation-aware interpolation
              </div>
            </div>
            <input
              type="checkbox"
              checked={downscalingActive}
              onChange={handleToggleDownscaling}
              aria-label="Toggle statistical downscaling from 0.25 degrees to 0.05 degrees with elevation correction"
              style={{
                width: '18px',
                height: '18px',
                cursor: 'pointer',
                accentColor: '#10b981',
              }}
            />
          </label>
        </div>

        {/* ── Downscaling stats ── */}
        {(downscalingActive || isComputing) && (
          <DownscalingStats
            coarseCellCount={gridCells.length}
            fineCellCount={downscaledCells.length}
            elevationCorrectedCount={elevationCorrectedCount}
            isComputing={isComputing}
          />
        )}

        {/* ── Expanded details ── */}
        {showDetails && (
          <div
            style={{
              marginTop: 'var(--space-md, 12px)',
              padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
              background: 'rgba(var(--fg-rgb),var(--fg-a05))',
              borderRadius: 'var(--radius-md, 8px)',
              fontSize: 'var(--font-small, 12px)',
              color: 'rgba(var(--fg-rgb),var(--fg-a6))',
              lineHeight: 1.6,
            }}
          >
            <p style={{ margin: '0 0 6px' }}>
              <strong style={{ color: 'rgba(var(--fg-rgb),var(--fg-a75))' }}>Native resolution:</strong> The
              VAYU model produces predictions at 0.25° ({NATIVE_RESOLUTION_KM} km) — the IMD gridded
              rainfall dataset resolution.
            </p>
            {downscalingActive && (
              <p style={{ margin: '0 0 6px' }}>
                <strong style={{ color: '#f59e0b' }}>⚠ Downscaled:</strong> The 0.05°
                ({DOWNSCALED_RESOLUTION_KM} km) grid is computed via bilinear interpolation with
                elevation-aware orographic correction. It is <em>not</em> native model output.
              </p>
            )}
            <p style={{ margin: 0 }}>
              Orographic correction applies a lapse rate of −6.5°C/1000m for temperature and
              ≈+0.02%/m elevation gain for rainfall to capture terrain-induced variability.
            </p>
          </div>
        )}

        {/* ── Resolution Comparison Panel — Req 84.4 ── */}
        {showComparison && <ComparisonPanel downscalingActive={downscalingActive} />}
      </GlassPanel>

      {/* Animations */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default ResolutionDisplay;
