/**
 * CrossSectionChart — Vertical profile chart for cross-section atmospheric analysis.
 *
 * Renders a pure SVG chart displaying:
 * - Terrain elevation as a filled area at the bottom
 * - Selected climate variable as a line plotted above the terrain
 * - Hover interaction that reports the lat/lon of the hovered point
 *
 * Uses the GlassPanel design system for consistent styling.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { GlassPanel } from '../../../design-system';
import type { TransectPoint } from './crossSectionTool';
import type { VariableId } from '../../../types';

export interface CrossSectionChartProps {
  /** Array of sampled transect points to visualize */
  points: TransectPoint[];
  /** The climate variable being displayed */
  variable: VariableId;
  /** Callback fired when the user hovers over a point; receives lat/lon for globe highlighting */
  onHover?: (point: { lat: number; lon: number } | null) => void;
  /** Optional chart width in pixels (default 600) */
  width?: number;
  /** Optional chart height in pixels (default 300) */
  height?: number;
  /** Optional CSS class name */
  className?: string;
}

/** Variable display labels and color configuration */
const VARIABLE_CONFIG: Record<VariableId, { label: string; unit: string; color: string }> = {
  rainfall: { label: 'Rainfall', unit: 'mm', color: '#22d3ee' },
  temp_max: { label: 'Max Temperature', unit: '°C', color: '#f97316' },
  temp_min: { label: 'Min Temperature', unit: '°C', color: '#818cf8' },
};

/** Chart padding (px) */
const PADDING = { top: 24, right: 20, bottom: 40, left: 50 };

/**
 * CrossSectionChart — SVG-based vertical profile chart.
 *
 * Displays terrain as a filled brown area at the bottom and the climate
 * variable as a colored line above it. Supports hover interaction to
 * highlight the corresponding globe position.
 */
export const CrossSectionChart: React.FC<CrossSectionChartProps> = ({
  points,
  variable,
  onHover,
  width = 600,
  height = 300,
  className = '',
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const config = VARIABLE_CONFIG[variable];

  // Compute chart dimensions
  const chartWidth = width - PADDING.left - PADDING.right;
  const chartHeight = height - PADDING.top - PADDING.bottom;

  // Compute scales from data
  const scales = useMemo(() => {
    if (points.length === 0) {
      return { xMax: 1, elevMax: 100, valMin: 0, valMax: 1 };
    }

    const xMax = Math.max(...points.map((p) => p.distance), 0.001);
    const elevMax = Math.max(...points.map((p) => p.elevation), 1);
    const values = points.map((p) => p.value);
    const valMin = Math.min(...values);
    const valMax = Math.max(...values, valMin + 0.001);

    return { xMax, elevMax, valMin, valMax };
  }, [points]);

  // Scale functions
  const scaleX = useCallback(
    (distance: number) => (distance / scales.xMax) * chartWidth,
    [scales.xMax, chartWidth]
  );

  // Elevation uses the lower portion of the chart (bottom 30%)
  const elevationHeight = chartHeight * 0.3;
  const variableHeight = chartHeight * 0.7;

  const scaleElevation = useCallback(
    (elev: number) => elevationHeight - (elev / scales.elevMax) * elevationHeight,
    [scales.elevMax, elevationHeight]
  );

  const scaleValue = useCallback(
    (val: number) =>
      variableHeight - ((val - scales.valMin) / (scales.valMax - scales.valMin)) * variableHeight,
    [scales.valMin, scales.valMax, variableHeight]
  );

  // Build SVG paths
  const terrainPath = useMemo(() => {
    if (points.length === 0) return '';

    const pathParts: string[] = [];
    // Start at bottom-left
    pathParts.push(`M 0 ${elevationHeight}`);

    // Draw terrain profile
    for (const point of points) {
      const x = scaleX(point.distance);
      const y = scaleElevation(point.elevation);
      pathParts.push(`L ${x} ${y}`);
    }

    // Close at bottom-right
    pathParts.push(`L ${chartWidth} ${elevationHeight}`);
    pathParts.push('Z');

    return pathParts.join(' ');
  }, [points, scaleX, scaleElevation, chartWidth, elevationHeight]);

  const variablePath = useMemo(() => {
    if (points.length === 0) return '';

    const pathParts: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const x = scaleX(points[i].distance);
      const y = scaleValue(points[i].value);
      pathParts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
    }

    return pathParts.join(' ');
  }, [points, scaleX, scaleValue]);

  // Handle mouse interaction
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || points.length === 0) return;

      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - PADDING.left;

      // Find the closest point index
      const fraction = Math.max(0, Math.min(1, mouseX / chartWidth));
      const index = Math.round(fraction * (points.length - 1));
      const clampedIndex = Math.max(0, Math.min(points.length - 1, index));

      setHoverIndex(clampedIndex);
      onHover?.({ lat: points[clampedIndex].lat, lon: points[clampedIndex].lon });
    },
    [points, chartWidth, onHover]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
    onHover?.(null);
  }, [onHover]);

  // Generate X-axis tick labels (distance in km)
  const xTicks = useMemo(() => {
    const numTicks = 5;
    const ticks: { value: number; label: string }[] = [];
    for (let i = 0; i <= numTicks; i++) {
      const value = (i / numTicks) * scales.xMax;
      ticks.push({ value, label: `${value.toFixed(0)} km` });
    }
    return ticks;
  }, [scales.xMax]);

  // Generate Y-axis tick labels (variable values)
  const yTicks = useMemo(() => {
    const numTicks = 4;
    const ticks: { value: number; label: string }[] = [];
    for (let i = 0; i <= numTicks; i++) {
      const val = scales.valMin + (i / numTicks) * (scales.valMax - scales.valMin);
      ticks.push({ value: val, label: `${val.toFixed(1)}` });
    }
    return ticks;
  }, [scales.valMin, scales.valMax]);

  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null;

  if (points.length === 0) {
    return (
      <GlassPanel className={className} padding="md">
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', margin: 0 }}>
          Draw a transect on the globe to see the cross-section profile.
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={`cross-section-chart ${className}`} padding="sm">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
          padding: '0 4px',
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: '13px', fontWeight: 600 }}>
          Cross-Section Profile
        </span>
        <span style={{ color: config.color, fontSize: '12px', fontWeight: 500 }}>
          {config.label} ({config.unit})
        </span>
      </div>

      {/* SVG Chart */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        role="img"
        aria-label={`Cross-section profile showing ${config.label} along transect`}
      >
        <g transform={`translate(${PADDING.left}, ${PADDING.top})`}>
          {/* Terrain elevation filled area (bottom section) */}
          <g transform={`translate(0, ${variableHeight})`}>
            <path
              d={terrainPath}
              fill="rgba(139, 90, 43, 0.6)"
              stroke="rgba(139, 90, 43, 0.9)"
              strokeWidth={1}
            />
            {/* Terrain label */}
            <text
              x={chartWidth - 4}
              y={elevationHeight - 4}
              fill="rgba(255,255,255,0.4)"
              fontSize={10}
              textAnchor="end"
            >
              Terrain
            </text>
          </g>

          {/* Variable line (upper section) */}
          <path d={variablePath} fill="none" stroke={config.color} strokeWidth={2} />

          {/* X-Axis */}
          <line
            x1={0}
            y1={chartHeight}
            x2={chartWidth}
            y2={chartHeight}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1}
          />
          {xTicks.map((tick) => (
            <g key={tick.value} transform={`translate(${scaleX(tick.value)}, ${chartHeight})`}>
              <line y1={0} y2={5} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
              <text
                y={16}
                fill="rgba(255,255,255,0.5)"
                fontSize={10}
                textAnchor="middle"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Y-Axis for variable */}
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={variableHeight}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1}
          />
          {yTicks.map((tick) => (
            <g key={tick.value} transform={`translate(0, ${scaleValue(tick.value)})`}>
              <line x1={-4} x2={0} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
              <text
                x={-8}
                fill="rgba(255,255,255,0.5)"
                fontSize={10}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* X-axis label */}
          <text
            x={chartWidth / 2}
            y={chartHeight + 32}
            fill="rgba(255,255,255,0.5)"
            fontSize={11}
            textAnchor="middle"
          >
            Distance along transect
          </text>

          {/* Hover indicator */}
          {hoveredPoint && hoverIndex !== null && (
            <g>
              {/* Vertical line */}
              <line
                x1={scaleX(hoveredPoint.distance)}
                y1={0}
                x2={scaleX(hoveredPoint.distance)}
                y2={chartHeight}
                stroke="rgba(255,255,255,0.4)"
                strokeWidth={1}
                strokeDasharray="4 2"
              />
              {/* Point on variable line */}
              <circle
                cx={scaleX(hoveredPoint.distance)}
                cy={scaleValue(hoveredPoint.value)}
                r={4}
                fill={config.color}
                stroke="white"
                strokeWidth={1.5}
              />
              {/* Tooltip */}
              <g
                transform={`translate(${Math.min(scaleX(hoveredPoint.distance) + 8, chartWidth - 100)}, 8)`}
              >
                <rect
                  x={0}
                  y={0}
                  width={95}
                  height={48}
                  rx={4}
                  fill="rgba(6, 10, 22, 0.9)"
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth={0.5}
                />
                <text x={6} y={14} fill="rgba(255,255,255,0.8)" fontSize={10}>
                  {hoveredPoint.value.toFixed(1)} {config.unit}
                </text>
                <text x={6} y={28} fill="rgba(255,255,255,0.5)" fontSize={9}>
                  {hoveredPoint.lat.toFixed(3)}°, {hoveredPoint.lon.toFixed(3)}°
                </text>
                <text x={6} y={42} fill="rgba(255,255,255,0.5)" fontSize={9}>
                  Elev: {hoveredPoint.elevation.toFixed(0)}m
                </text>
              </g>
            </g>
          )}
        </g>
      </svg>
    </GlassPanel>
  );
};

export default CrossSectionChart;
