/**
 * BivariateColorLegend — 2D colour matrix legend for bivariate maps.
 *
 * Renders an n×n grid of swatches where:
 *   - X axis encodes variableX (left = low, right = high)
 *   - Y axis encodes variableY (bottom = low, top = high)
 *
 * Each swatch is the blended colour produced by blending the two colormaps
 * at the respective (tx, ty) positions, exactly matching what the
 * CompositeOverlayLayer renders on the globe.
 *
 * Requirements: 39.4
 */

import React, { useMemo } from 'react';
import type { ColormapId } from '../../../utils/colorScales';
import { COLOR_SCALES } from '../../../utils/colorScales';
import type { VariableId } from '../../../types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BivariateColorLegendProps {
  /** Variable for the X axis */
  variableX: VariableId;
  /** Variable for the Y axis */
  variableY: VariableId;
  /** Colormap applied along X axis */
  colormapX: ColormapId;
  /** Colormap applied along Y axis */
  colormapY: ColormapId;
  /** Grid resolution (n×n swatches). Defaults to 4. */
  matrixSize?: number;
  /** Width/height of the entire legend in pixels. Defaults to 120. */
  size?: number;
  /** Optional additional className */
  className?: string;
}

// ── Variable labels ────────────────────────────────────────────────────────────

const VAR_LABELS: Record<VariableId, { label: string; unit: string }> = {
  rainfall: { label: 'Rainfall', unit: 'mm' },
  temp_max: { label: 'Max Temp', unit: '°C' },
  temp_min: { label: 'Min Temp', unit: '°C' },
};

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders the 2D colour matrix legend for bivariate maps.
 *
 * Validates: Requirements 39.4
 */
export const BivariateColorLegend: React.FC<BivariateColorLegendProps> = ({
  variableX,
  variableY,
  colormapX,
  colormapY,
  matrixSize = 4,
  size = 120,
  className = '',
}) => {
  const scaleX = COLOR_SCALES[colormapX] ?? COLOR_SCALES['blues'];
  const scaleY = COLOR_SCALES[colormapY] ?? COLOR_SCALES['reds'];

  const n = Math.max(2, Math.min(8, matrixSize));
  const swatchSize = Math.floor(size / n);

  // Pre-compute the n×n swatch colours (row 0 = bottom/low-Y, row n-1 = top/high-Y)
  const swatches = useMemo(() => {
    const matrix: string[][] = [];
    for (let row = 0; row < n; row++) {
      const ty = row / (n - 1); // Y increases upward → row 0 is bottom
      const rowCells: string[] = [];
      for (let col = 0; col < n; col++) {
        const tx = col / (n - 1);
        const [rx, gx, bx] = scaleX(tx);
        const [ry, gy, by] = scaleY(ty);
        const r = Math.round((rx + ry) / 2);
        const g = Math.round((gx + gy) / 2);
        const b = Math.round((bx + by) / 2);
        rowCells.push(`rgb(${r},${g},${b})`);
      }
      matrix.push(rowCells);
    }
    return matrix;
  }, [scaleX, scaleY, n]);

  const labelX = VAR_LABELS[variableX];
  const labelY = VAR_LABELS[variableY];

  const containerSize = swatchSize * n;

  return (
    <div
      className={`bivariate-legend ${className}`}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        fontSize: 10,
        fontFamily: 'Inter, sans-serif',
        color: 'rgba(var(--fg-rgb),var(--fg-a75))',
      }}
      aria-label={`Bivariate colour legend: X axis ${labelX.label}, Y axis ${labelY.label}`}
      role="img"
    >
      {/* Y-axis label (rotated, left side) */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        {/* Rotated Y label */}
        <div
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 9,
            color: 'rgba(var(--fg-rgb),var(--fg-a6))',
            whiteSpace: 'nowrap',
          }}
          aria-hidden="true"
        >
          {labelY.label} ({labelY.unit}) →
        </div>

        {/* Matrix grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${n}, ${swatchSize}px)`,
            gridTemplateRows: `repeat(${n}, ${swatchSize}px)`,
            width: containerSize,
            height: containerSize,
            border: '1px solid rgba(var(--fg-rgb),var(--fg-a15))',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          {/* Render rows from top (high-Y) to bottom (low-Y) */}
          {[...Array(n)].map((_, rowIdx) => {
            const rowData = swatches[n - 1 - rowIdx]; // flip so row 0 = top = high-Y
            return rowData.map((color, colIdx) => (
              <div
                key={`${rowIdx}-${colIdx}`}
                style={{
                  backgroundColor: color,
                  width: swatchSize,
                  height: swatchSize,
                }}
                aria-hidden="true"
              />
            ));
          })}
        </div>
      </div>

      {/* X-axis label */}
      <div
        style={{
          paddingLeft: 14,
          fontSize: 9,
          color: 'rgba(var(--fg-rgb),var(--fg-a6))',
          whiteSpace: 'nowrap',
        }}
        aria-hidden="true"
      >
        {labelX.label} ({labelX.unit}) →
      </div>

      {/* Corner descriptors */}
      <div
        style={{
          paddingLeft: 14,
          fontSize: 9,
          color: 'rgba(var(--fg-rgb),var(--fg-a4))',
          lineHeight: 1.3,
        }}
        aria-hidden="true"
      >
        Low {labelX.label} + Low {labelY.label} → bottom-left
        <br />
        High both → top-right
      </div>
    </div>
  );
};

export default BivariateColorLegend;
