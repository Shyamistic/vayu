/**
 * ColorLegend — gradient colorbar showing the heatmap scale for the active variable.
 * Matches the colormaps in CesiumGlobe.tsx valueToColor() exactly.
 */
import type { VariableId } from '../types';

interface ColorLegendProps {
  variable: VariableId;
}

const CONFIG: Record<VariableId, {
  label: string;
  unit: string;
  min: number;
  max: number;
  gradient: string;
  ticks: number[];
}> = {
  rainfall: {
    label: 'Rainfall',
    unit: 'mm/day',
    min: 0,
    max: 50,
    // white → light blue → deep blue  (matches CesiumGlobe rgba)
    gradient: 'linear-gradient(to right, rgb(255,255,255), rgb(153,204,255), rgb(51,51,255))',
    ticks: [0, 10, 20, 30, 40, 50],
  },
  temp_max: {
    label: 'Max Temp',
    unit: '°C',
    min: 20,
    max: 45,
    // yellow → orange → red
    gradient: 'linear-gradient(to right, rgb(255,255,102), rgb(255,128,26), rgb(255,0,26))',
    ticks: [20, 25, 30, 35, 40, 45],
  },
  temp_min: {
    label: 'Min Temp',
    unit: '°C',
    min: 10,
    max: 35,
    // blue → purple → red
    gradient: 'linear-gradient(to right, rgb(26,26,255), rgb(128,26,204), rgb(204,26,26))',
    ticks: [10, 15, 20, 25, 30, 35],
  },
};

export default function ColorLegend({ variable }: ColorLegendProps) {
  const cfg = CONFIG[variable];

  return (
    <div className="panel-tight px-3 py-2 flex flex-col gap-1 min-w-[180px]">
      {/* Title */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/60 font-medium">{cfg.label}</span>
        <span className="text-xs text-white/40">{cfg.unit}</span>
      </div>

      {/* Gradient bar */}
      <div
        className="h-2.5 rounded-sm w-full"
        style={{ background: cfg.gradient }}
      />

      {/* Tick labels */}
      <div className="flex justify-between">
        {cfg.ticks.map((tick) => (
          <span key={tick} className="text-[10px] text-white/40 font-mono">
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}
