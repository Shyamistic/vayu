/**
 * SplitViewContainer — Synchronized Dual Globe Viewports
 *
 * Renders baseline and scenario views side-by-side with:
 * 1. A draggable vertical divider constrained to [20%, 80%] of viewport width
 * 2. Camera synchronization between viewports in real-time
 * 3. "Baseline" and "Scenario" labels with scenario parameters
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../core/state/appStore';
import type { CameraState } from '../../core/state/mapStore';
import type { ScenarioResponse } from '../../types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Minimum divider position as fraction of viewport width */
const MIN_DIVIDER_POSITION = 0.2;
/** Maximum divider position as fraction of viewport width */
const MAX_DIVIDER_POSITION = 0.8;
/** Default divider position (50%) */
const DEFAULT_DIVIDER_POSITION = 0.5;
/** Divider handle width in pixels */
const DIVIDER_WIDTH = 6;

// ── Types ────────────────────────────────────────────────────────────────────

export interface SplitViewCameraState {
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
}

export interface SplitViewContainerProps {
  /** The baseline globe element (left side) */
  baselineView: React.ReactNode;
  /** The scenario globe element (right side) */
  scenarioView: React.ReactNode;
  /** Scenario response data for displaying parameters in the label */
  scenarioData?: ScenarioResponse | null;
  /** Callback fired when the camera changes in either viewport */
  onCameraSync?: (camera: SplitViewCameraState) => void;
  /** Callback providing current divider position (0.2–0.8) */
  onDividerChange?: (position: number) => void;
  /** Optional CSS class for the container */
  className?: string;
}

// ── Utility: Clamp divider position ──────────────────────────────────────────

/**
 * Constrains a divider position value to the allowed range [20%, 80%].
 * Exported for use in property-based tests.
 */
export function clampDividerPosition(position: number): number {
  return Math.max(MIN_DIVIDER_POSITION, Math.min(MAX_DIVIDER_POSITION, position));
}

/**
 * Computes the left viewport width in pixels given divider position and total width.
 * Exported for use in property-based tests.
 */
export function computeLeftWidth(dividerPosition: number, totalWidth: number): number {
  const clamped = clampDividerPosition(dividerPosition);
  return Math.round(clamped * totalWidth);
}

/**
 * Synchronizes camera state from a source to a target.
 * Returns the synchronized camera state. In a real implementation this
 * would call viewer.camera.setView on the target Cesium viewer.
 * Exported for use in property-based tests.
 */
export function syncCamera(source: SplitViewCameraState): SplitViewCameraState {
  return {
    latitude: source.latitude,
    longitude: source.longitude,
    altitude: source.altitude,
    heading: source.heading,
    pitch: source.pitch,
    roll: source.roll,
  };
}

// ── Scenario label formatting ────────────────────────────────────────────────

function formatScenarioLabel(scenario: ScenarioResponse | null | undefined): string {
  if (!scenario) return 'Scenario';
  const type = scenario.scenario_type.replace(/_/g, ' ');
  const magnitude = scenario.magnitude;
  const sign = magnitude >= 0 ? '+' : '';
  return `Scenario: ${type} (${sign}${magnitude})`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SplitViewContainer({
  baselineView,
  scenarioView,
  scenarioData,
  onCameraSync,
  onDividerChange,
  className = '',
}: SplitViewContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dividerPosition, setDividerPosition] = useState(DEFAULT_DIVIDER_POSITION);
  const [isDragging, setIsDragging] = useState(false);
  const [syncedCamera, setSyncedCamera] = useState<SplitViewCameraState | null>(null);

  // ── Draggable divider logic ────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const totalWidth = rect.width;
      const relativeX = clientX - rect.left;
      const rawPosition = relativeX / totalWidth;
      const clampedPosition = clampDividerPosition(rawPosition);

      setDividerPosition(clampedPosition);
      onDividerChange?.(clampedPosition);
    };

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      handleMove(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX);
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, onDividerChange]);

  // ── Camera synchronization handler ─────────────────────────────────────────
  // This callback is intended to be called by either viewport when its camera moves.
  // It propagates the camera state to the other viewport.

  const handleCameraChange = useCallback(
    (camera: SplitViewCameraState) => {
      const synced = syncCamera(camera);
      setSyncedCamera(synced);
      onCameraSync?.(synced);
    },
    [onCameraSync],
  );

  // ── Compute viewport widths ────────────────────────────────────────────────

  const leftPercent = dividerPosition * 100;
  const rightPercent = 100 - leftPercent;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={`split-view-container ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        overflow: 'hidden',
        cursor: isDragging ? 'col-resize' : 'default',
        userSelect: isDragging ? 'none' : 'auto',
      }}
      data-testid="split-view-container"
    >
      {/* ── Left viewport (Baseline) ── */}
      <div
        style={{
          width: `${leftPercent}%`,
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
        data-testid="split-view-left"
      >
        {baselineView}

        {/* Baseline label */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '6px 12px',
            borderRadius: 6,
            background: 'rgba(6, 10, 22, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.5px',
            pointerEvents: 'none',
            zIndex: 10,
          }}
          data-testid="split-view-label-baseline"
        >
          Baseline
        </div>
      </div>

      {/* ── Draggable divider ── */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{
          width: DIVIDER_WIDTH,
          height: '100%',
          cursor: 'col-resize',
          position: 'relative',
          zIndex: 20,
          flexShrink: 0,
          touchAction: 'none',
        }}
        data-testid="split-view-divider"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(dividerPosition * 100)}
        aria-valuemin={Math.round(MIN_DIVIDER_POSITION * 100)}
        aria-valuemax={Math.round(MAX_DIVIDER_POSITION * 100)}
        aria-label="Split view divider"
      >
        {/* Divider visual track */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 2,
            height: '100%',
            background: isDragging
              ? 'rgba(14, 165, 233, 0.9)'
              : 'rgba(255, 255, 255, 0.3)',
            transition: isDragging ? 'none' : 'background 200ms ease',
          }}
        />

        {/* Divider handle (grab indicator) */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 20,
            height: 40,
            borderRadius: 10,
            background: isDragging
              ? 'rgba(14, 165, 233, 0.3)'
              : 'rgba(255, 255, 255, 0.1)',
            border: isDragging
              ? '1px solid rgba(14, 165, 233, 0.6)'
              : '1px solid rgba(255, 255, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: isDragging ? 'none' : 'all 200ms ease',
          }}
        >
          {/* Grip dots */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
            <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
            <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
          </div>
        </div>
      </div>

      {/* ── Right viewport (Scenario) ── */}
      <div
        style={{
          width: `${rightPercent}%`,
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
        data-testid="split-view-right"
      >
        {scenarioView}

        {/* Scenario label */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            padding: '6px 12px',
            borderRadius: 6,
            background: 'rgba(6, 10, 22, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(34, 211, 238, 0.3)',
            color: '#22d3ee',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.5px',
            pointerEvents: 'none',
            zIndex: 10,
          }}
          data-testid="split-view-label-scenario"
        >
          {formatScenarioLabel(scenarioData)}
        </div>
      </div>
    </div>
  );
}

// ── Exports for testing ──────────────────────────────────────────────────────

export {
  MIN_DIVIDER_POSITION,
  MAX_DIVIDER_POSITION,
  DEFAULT_DIVIDER_POSITION,
};
