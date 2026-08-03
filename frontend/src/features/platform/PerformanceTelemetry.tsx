/**
 * PerformanceTelemetry — Developer overlay for real-time performance metrics.
 *
 * Toggled via Ctrl+Shift+P keyboard shortcut.
 * Floats in the top-right corner with dark glass-morphism styling.
 *
 * Displays:
 *  - Real-time FPS counter with colour-coded health indicator
 *  - JS heap memory usage (used / limit in MB)
 *  - Active API call latency with sparkline chart (last 60 samples)
 *  - CesiumJS render statistics (draw calls, triangles, texture memory)
 *  - Low-FPS warning banner when sustained drops detected
 *
 * Validates: Requirements 46.1, 46.2, 46.3, 46.4
 */

import React, { useCallback, useRef } from 'react';
import { useKeyboardShortcuts } from '../../core/hooks/useKeyboardShortcuts';
import {
  usePerformanceTelemetry,
  type PerformanceTelemetry as TelemetryData,
} from '../../core/hooks/usePerformanceTelemetry';

// ── Utility helpers ───────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fpsColor(fps: number): string {
  if (fps >= 55) return '#4ade80'; // green
  if (fps >= 30) return '#fbbf24'; // amber
  return '#f87171';               // red
}

function latencyColor(ms: number): string {
  if (ms < 200) return '#4ade80';
  if (ms < 1000) return '#fbbf24';
  return '#f87171';
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

interface SparklineProps {
  samples: number[];
  width?: number;
  height?: number;
  color?: string;
}

const Sparkline: React.FC<SparklineProps> = ({
  samples,
  width = 120,
  height = 28,
  color = '#60a5fa',
}) => {
  if (samples.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeOpacity={0.3} strokeWidth="1" />
      </svg>
    );
  }

  const max = Math.max(...samples);
  const min = Math.min(...samples);
  const range = max - min || 1;

  const points = samples.map((v, i) => {
    const x = (i / (samples.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = points.join(' ');

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ overflow: 'visible' }}>
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.85}
      />
    </svg>
  );
};

// ── Metric row ────────────────────────────────────────────────────────────────

const MetricRow: React.FC<{
  label: string;
  value: string;
  valueColor?: string;
  children?: React.ReactNode;
}> = ({ label, value, valueColor = 'rgba(255,255,255,0.85)', children }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '3px 0',
    }}
  >
    <span
      style={{
        color: 'rgba(255,255,255,0.45)',
        fontSize: '11px',
        fontFamily: 'monospace',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {children}
      <span
        style={{
          color: valueColor,
          fontSize: '12px',
          fontFamily: 'monospace',
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        {value}
      </span>
    </span>
  </div>
);

// ── Section divider ───────────────────────────────────────────────────────────

const Divider: React.FC = () => (
  <div
    style={{
      borderTop: '1px solid rgba(255,255,255,0.07)',
      margin: '6px 0',
    }}
    aria-hidden="true"
  />
);

// ── Main component ────────────────────────────────────────────────────────────

export interface PerformanceTelemetryProps {
  /** If provided, called when auto-quality-reduction is triggered by low FPS */
  onLowFps?: () => void;
}

/**
 * PerformanceTelemetry
 *
 * Floating developer overlay toggled via Ctrl+Shift+P.
 * Renders in the top-right corner with glass-morphism styling.
 *
 * Validates: Requirements 46.1, 46.2, 46.3, 46.4
 */
const PerformanceTelemetry: React.FC<PerformanceTelemetryProps> = ({ onLowFps }) => {
  // Visibility state — kept in a ref to avoid re-renders on shortcut press
  const [isVisible, setIsVisible] = React.useState(false);

  const toggle = useCallback(() => setIsVisible((v) => !v), []);

  // Register Ctrl+Shift+P shortcut (Req 46.1)
  useKeyboardShortcuts(
    [
      {
        key: 'Ctrl+Shift+P',
        description: 'Toggle Performance Telemetry overlay',
        category: 'Platform',
        action: toggle,
        allowInInputs: false,
      },
    ],
    true,
  );

  // Collect metrics only while visible to conserve resources
  const telemetry: TelemetryData = usePerformanceTelemetry({
    enabled: isVisible,
    onLowFps,
  });

  if (!isVisible) return null;

  const { fps, memory, apiLatencySamples, apiLatencyMs, cesiumStats, lowFpsDetected } =
    telemetry;

  const heapUsedMB = memory ? memory.usedJSHeapSize / 1048576 : null;
  const heapLimitMB = memory ? memory.jsHeapSizeLimit / 1048576 : null;

  return (
    <div
      role="region"
      aria-label="Performance Telemetry Overlay"
      data-testid="perf-telemetry"
      style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 8500,
        width: '220px',
        userSelect: 'none',
        // Glass-morphism (design system pattern, Req 5.2)
        background: 'rgba(4, 8, 18, 0.90)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.10)',
        borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        padding: '10px 12px',
        fontFamily: 'monospace, "Courier New", Courier',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <span
          style={{
            color: 'rgba(96,165,250,0.9)',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          ⚡ Perf Monitor
        </span>
        <button
          aria-label="Close performance telemetry overlay"
          onClick={toggle}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.35)',
            cursor: 'pointer',
            fontSize: '13px',
            padding: '0 2px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Low-FPS warning (Req 46.3) ──────────────────────────────────── */}
      {lowFpsDetected && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: 'rgba(248,113,113,0.15)',
            border: '1px solid rgba(248,113,113,0.35)',
            borderRadius: '6px',
            color: '#fca5a5',
            fontSize: '10px',
            padding: '4px 7px',
            marginBottom: '8px',
            textAlign: 'center',
            letterSpacing: '0.04em',
          }}
        >
          ⚠ Low FPS — reducing quality
        </div>
      )}

      {/* ── FPS (Req 46.1) ──────────────────────────────────────────────── */}
      <MetricRow
        label="FPS"
        value={fps > 0 ? `${fps}` : '—'}
        valueColor={fps > 0 ? fpsColor(fps) : 'rgba(255,255,255,0.3)'}
      >
        {/* Mini FPS bar */}
        <div
          aria-hidden="true"
          style={{
            width: '40px',
            height: '6px',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '3px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, (fps / 60) * 100)}%`,
              height: '100%',
              background: fpsColor(fps),
              borderRadius: '3px',
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      </MetricRow>

      <Divider />

      {/* ── Memory (Req 46.1) ───────────────────────────────────────────── */}
      {memory ? (
        <>
          <MetricRow
            label="JS Heap"
            value={
              heapUsedMB !== null && heapLimitMB !== null
                ? `${heapUsedMB.toFixed(0)} / ${heapLimitMB.toFixed(0)} MB`
                : '—'
            }
            valueColor={
              heapUsedMB !== null && heapLimitMB !== null && heapLimitMB > 0
                ? heapUsedMB / heapLimitMB > 0.8
                  ? '#f87171'
                  : heapUsedMB / heapLimitMB > 0.6
                  ? '#fbbf24'
                  : '#4ade80'
                : 'rgba(255,255,255,0.3)'
            }
          />
          <MetricRow
            label="Total Heap"
            value={
              memory.totalJSHeapSize > 0
                ? formatBytes(memory.totalJSHeapSize)
                : '—'
            }
          />
        </>
      ) : (
        <MetricRow label="Heap" value="N/A" valueColor="rgba(255,255,255,0.3)" />
      )}

      <Divider />

      {/* ── API Latency sparkline (Req 46.2) ────────────────────────────── */}
      <div style={{ marginBottom: '2px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '4px',
          }}
        >
          <span
            style={{
              color: 'rgba(255,255,255,0.45)',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            API Latency
          </span>
          <span
            style={{
              color:
                apiLatencyMs !== null
                  ? latencyColor(apiLatencyMs)
                  : 'rgba(255,255,255,0.3)',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {apiLatencyMs !== null ? `${apiLatencyMs.toFixed(0)} ms` : '—'}
          </span>
        </div>
        <Sparkline
          samples={apiLatencySamples}
          width={196}
          height={28}
          color={apiLatencyMs !== null ? latencyColor(apiLatencyMs) : '#60a5fa'}
        />
      </div>

      <Divider />

      {/* ── CesiumJS render stats (Req 46.4) ────────────────────────────── */}
      <div
        style={{
          color: 'rgba(255,255,255,0.35)',
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: '4px',
        }}
      >
        WebGL / CesiumJS
      </div>
      {cesiumStats ? (
        <>
          <MetricRow
            label="Draw Calls"
            value={`${cesiumStats.drawCalls}`}
          />
          <MetricRow
            label="Triangles"
            value={
              cesiumStats.triangles >= 1000000
                ? `${(cesiumStats.triangles / 1000000).toFixed(1)}M`
                : cesiumStats.triangles >= 1000
                ? `${(cesiumStats.triangles / 1000).toFixed(0)}K`
                : `${cesiumStats.triangles}`
            }
          />
          <MetricRow
            label="Tex Mem"
            value={
              cesiumStats.textureMemoryMB > 0
                ? `${cesiumStats.textureMemoryMB} MB`
                : '—'
            }
          />
        </>
      ) : (
        <div
          style={{
            color: 'rgba(255,255,255,0.25)',
            fontSize: '11px',
            textAlign: 'center',
            padding: '4px 0',
          }}
        >
          No Cesium viewer attached
        </div>
      )}

      {/* ── Footer hint ─────────────────────────────────────────────────── */}
      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.05)',
          marginTop: '8px',
          paddingTop: '6px',
          textAlign: 'center',
          color: 'rgba(255,255,255,0.2)',
          fontSize: '10px',
        }}
      >
        Ctrl+Shift+P to toggle
      </div>
    </div>
  );
};

export default PerformanceTelemetry;
