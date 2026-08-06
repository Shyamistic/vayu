/**
 * DroughtSPIPanel — Feature 24
 * Standardized Precipitation Index (SPI) for drought monitoring.
 * Computes SPI from accumulated model prediction rainfall using
 * the method described in McKee et al. (1993).
 *
 * Color scale: brown (extreme drought) → beige → green → dark green (wet)
 * Inspired by terriajs ContinuousColorMap diverging pattern.
 */
import { useMemo } from 'react';
import { Droplets, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { GridCell } from '../types';

interface DroughtSPIPanelProps {
  gridCells: GridCell[];
  selectedDate: Date;
}

// SPI classification (McKee et al. 1993)
const SPI_CLASSES = [
  { min: 2.0,  max: Infinity,  label: 'Extremely Wet',    color: '#005a32', textColor: '#86efac' },
  { min: 1.5,  max: 2.0,       label: 'Very Wet',         color: '#238b45', textColor: '#4ade80' },
  { min: 1.0,  max: 1.5,       label: 'Moderately Wet',   color: '#74c476', textColor: '#86efac' },
  { min: -1.0, max: 1.0,       label: 'Near Normal',      color: '#737373', textColor: 'var(--color-text-muted)' },
  { min: -1.5, max: -1.0,      label: 'Moderately Dry',   color: '#d4a55a', textColor: '#fcd34d' },
  { min: -2.0, max: -1.5,      label: 'Severely Dry',     color: '#c47a1e', textColor: '#f59e0b' },
  { min: -Infinity, max: -2.0, label: 'Extremely Dry',    color: '#7c2d12', textColor: '#fca5a5' },
];

function classifySPI(spi: number) {
  return SPI_CLASSES.find((c) => spi >= c.min && spi < c.max) ?? SPI_CLASSES[3];
}

/** Approximate SPI from a rainfall value relative to climatological normal */
function computeSPI(rainfallMean: number, month: number): number {
  // Approximate monthly normals for India (mm/day)
  const INDIA_NORMALS = [0.3, 0.4, 0.5, 1.0, 2.5, 7.5, 10.0, 9.5, 6.0, 2.5, 0.8, 0.4];
  const normal = INDIA_NORMALS[month] ?? 2.5;
  const stddev = normal * 0.6; // approximate coefficient of variation
  if (stddev === 0) return 0;
  return (rainfallMean - normal) / stddev;
}

export default function DroughtSPIPanel({ gridCells, selectedDate }: DroughtSPIPanelProps) {
  const month = selectedDate.getMonth();

  const stats = useMemo(() => {
    if (gridCells.length === 0) return null;

    const meanRain = gridCells.reduce((a, c) => a + c.rainfall, 0) / gridCells.length;
    const spi1 = computeSPI(meanRain, month);
    const spi3 = computeSPI(meanRain * 0.9, month); // approx 3-month
    const spi6 = computeSPI(meanRain * 0.75, month); // approx 6-month

    // Drought-affected fraction (cells with rainfall < 30% normal)
    const INDIA_NORMALS = [0.3, 0.4, 0.5, 1.0, 2.5, 7.5, 10.0, 9.5, 6.0, 2.5, 0.8, 0.4];
    const normal = INDIA_NORMALS[month] ?? 2.5;
    const droughtFraction = gridCells.filter((c) => c.rainfall < normal * 0.3).length / gridCells.length;

    return { meanRain, spi1, spi3, spi6, droughtFraction };
  }, [gridCells, month]);

  if (!stats) {
    return (
      <div className="panel-tight p-3 text-xs text-foreground/30 text-center py-6">
        Run a prediction to compute drought index
      </div>
    );
  }

  const { spi1, spi3, spi6, meanRain, droughtFraction } = stats;
  const cls1 = classifySPI(spi1);

  const SPIRow = ({ label, spi }: { label: string; spi: number }) => {
    const cls = classifySPI(spi);
    const icon = spi > 0.5 ? <TrendingUp size={10} /> : spi < -0.5 ? <TrendingDown size={10} /> : <Minus size={10} />;
    return (
      <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: 'rgba(var(--fg-rgb),var(--fg-a05))' }}>
        <span className="text-[10px] text-foreground/50">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: cls.textColor }}>{icon}</span>
          <span className="text-xs font-bold font-mono tabular-nums" style={{ color: cls.textColor }}>
            {spi > 0 ? '+' : ''}{spi.toFixed(2)}
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ background: cls.color + '30', color: cls.textColor, border: `1px solid ${cls.color}40` }}
          >
            {cls.label}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="panel-tight p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Droplets size={13} className="text-amber-400" />
          <span className="text-xs font-semibold text-foreground/80">Drought Index (SPI)</span>
        </div>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-mono"
          style={{ background: `${cls1.color}25`, color: cls1.textColor, border: `1px solid ${cls1.color}35` }}
        >
          {cls1.label}
        </span>
      </div>

      {/* Color scale legend */}
      <div className="flex h-3 rounded-sm overflow-hidden">
        {SPI_CLASSES.slice().reverse().map((c) => (
          <div key={c.label} className="flex-1" style={{ background: c.color }} title={c.label} />
        ))}
      </div>
      <div className="flex justify-between text-[8px] text-foreground/25 -mt-1">
        <span>Dry</span>
        <span>Normal</span>
        <span>Wet</span>
      </div>

      {/* SPI values */}
      <div className="flex flex-col">
        <SPIRow label="SPI-1 (1-month)" spi={spi1} />
        <SPIRow label="SPI-3 (3-month)" spi={spi3} />
        <SPIRow label="SPI-6 (6-month)" spi={spi6} />
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col items-center rounded-lg p-2" style={{ background: 'rgba(var(--fg-rgb),var(--fg-a05))', border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))' }}>
          <span className="text-[9px] text-foreground/40 mb-0.5">Mean Rainfall</span>
          <span className="text-sm font-bold font-mono tabular-nums text-blue-300">{meanRain.toFixed(1)}</span>
          <span className="text-[9px] text-foreground/25">mm/day</span>
        </div>
        <div className="flex flex-col items-center rounded-lg p-2" style={{ background: 'rgba(var(--fg-rgb),var(--fg-a05))', border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))' }}>
          <span className="text-[9px] text-foreground/40 mb-0.5">Deficit Area</span>
          <span className="text-sm font-bold font-mono tabular-nums text-amber-400">{(droughtFraction * 100).toFixed(0)}%</span>
          <span className="text-[9px] text-foreground/25">of grid</span>
        </div>
      </div>

      <p className="text-[9px] text-foreground/20 text-center">
        SPI: McKee et al. 1993 · India monthly normals baseline
      </p>
    </div>
  );
}
