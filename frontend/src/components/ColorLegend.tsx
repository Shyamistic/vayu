/**
 * ColorLegend — gradient colorbar showing the heatmap scale for the active variable.
 * Rainfall uses the exact `IMD_RAIN_STOPS` colours/positions from colorScales.ts
 * (via `rainfallToT`) so the legend can never drift from what's rendered on the globe.
 */
import type { VariableId } from '../types';
import { IMD_RAIN_STOPS, IMD_RAIN_THRESHOLDS_MM, TEMP_MAX_STOPS, TEMP_MIN_STOPS } from '../utils/colorScales';

interface ColorLegendProps {
  variable: VariableId;
  /** Skip the outer panel box (background/border/blur) — for embedding
   *  inside another panel (e.g. VariableDataPanel's LEGEND section) that
   *  already provides its own container. */
  bare?: boolean;
}

/** A tick label positioned at `pct`% along the gradient bar (not necessarily evenly spaced). */
interface Tick {
  label: string;
  pct: number;
}

interface LegendConfig {
  label: string;
  unit: string;
  gradient: string;
  ticks: Tick[];
}

function gradientFromStops(stops: [number, [number, number, number]][]): string {
  return `linear-gradient(to right, ${stops
    .map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`)
    .join(', ')})`;
}

const RAINFALL_GRADIENT = gradientFromStops(IMD_RAIN_STOPS);
const TEMP_MAX_GRADIENT = gradientFromStops(TEMP_MAX_STOPS);
const TEMP_MIN_GRADIENT = gradientFromStops(TEMP_MIN_STOPS);

// Skip the "trace" (1mm) and top "exceptional" (250mm) helper stops — they're
// interpolation aids, not IMD's own published category boundaries.
const RAINFALL_TICKS: Tick[] = IMD_RAIN_THRESHOLDS_MM
  .filter((s) => s.mm === 0 || s.mm === 2.5 || s.mm === 15.6 || s.mm === 64.5 || s.mm === 115.6 || s.mm === 204.5)
  .map((s) => ({ label: s.mm % 1 === 0 ? String(s.mm) : s.mm.toFixed(1), pct: s.t * 100 }));

function evenTicks(min: number, max: number, values: number[]): Tick[] {
  return values.map((v) => ({ label: String(v), pct: ((v - min) / (max - min)) * 100 }));
}

const CONFIG: Record<VariableId, LegendConfig> = {
  rainfall: {
    label: 'Rainfall',
    unit: 'mm/day (IMD categories)',
    gradient: RAINFALL_GRADIENT,
    ticks: RAINFALL_TICKS,
  },
  temp_max: {
    label: 'Max Temp',
    unit: '°C',
    // yellow → orange → red — from TEMP_MAX_STOPS, same source the map's
    // `sunset` colormap renders from, so the two can never drift apart.
    gradient: TEMP_MAX_GRADIENT,
    ticks: evenTicks(20, 45, [20, 25, 30, 35, 40, 45]),
  },
  temp_min: {
    label: 'Min Temp',
    unit: '°C',
    // blue → purple → red — from TEMP_MIN_STOPS, same source the map's
    // `ocean_violet` colormap renders from.
    gradient: TEMP_MIN_GRADIENT,
    ticks: evenTicks(10, 35, [10, 15, 20, 25, 30, 35]),
  },
};

export default function ColorLegend({ variable, bare }: ColorLegendProps) {
  const cfg = CONFIG[variable];

  return (
    <div
      className={bare ? 'flex flex-col gap-2.5 min-w-[180px]' : 'px-2 py-1.5 flex flex-col gap-2.5 min-w-[180px] rounded-xl'}
      style={
        bare
          ? undefined
          : {
              background: 'rgba(var(--panel-bg-rgb),0.92)',
              border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }
      }
    >
      {/* Title */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground/80 font-medium">{cfg.label}</span>
        <span className="text-xs text-foreground/60">{cfg.unit}</span>
      </div>

      {/* Gradient bar */}
      <div
        className="h-2.5 rounded-sm w-full"
        style={{ background: cfg.gradient, boxShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
      />

      {/* Tick labels — positioned at their true value along the bar, since
          IMD rainfall categories are not evenly spaced in mm/day. */}
      <div className="relative h-3">
        {cfg.ticks.map((tick) => (
          <span
            key={tick.label}
            className={`absolute top-0 text-[10px] text-foreground/60 font-mono ${
              tick.pct <= 0 ? '' : tick.pct >= 100 ? '-translate-x-full' : '-translate-x-1/2'
            }`}
            style={{ left: `${tick.pct}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
