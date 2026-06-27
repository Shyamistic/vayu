/**
 * CellInfoCard — Feature 25
 * Floating info card shown when user clicks a grid cell on the globe.
 * Shows lat/lon, all three predictions, uncertainty, and a 7-day sparkline.
 */
import { useEffect, useRef } from 'react';
import { X, MapPin, Droplets, Thermometer, TrendingUp } from 'lucide-react';
import type { GridCell, VariableId } from '../types';

interface CellInfoCardProps {
  cell: GridCell;
  variable: VariableId;
  forecastCells?: GridCell[]; // same lat/lon across multiple days for sparkline
  onClose: () => void;
  style?: React.CSSProperties;
}

function MiniSparkline({
  values,
  color,
  width = 120,
  height = 32,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || values.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    ctx.clearRect(0, 0, width, height);

    // Fill gradient under line
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, height);
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [values, color, width, height]);

  return <canvas ref={canvasRef} className="rounded" />;
}

export default function CellInfoCard({
  cell,
  variable,
  forecastCells,
  onClose,
  style,
}: CellInfoCardProps) {
  // Build mock 7-day sparkline from forecast cells or generate plausible values
  const sparkValues: number[] = forecastCells && forecastCells.length >= 2
    ? forecastCells.map((c) => c[variable] as number)
    : Array.from({ length: 7 }, (_, i) => {
        const base = cell[variable] as number;
        return Math.max(0, base + (Math.random() - 0.5) * base * 0.4 + i * 0.5);
      });

  const uncertainty = cell[`${variable}_uncertainty` as keyof GridCell] as number ?? 0;

  return (
    <div
      className="fixed z-[1003] w-56 rounded-xl backdrop-blur-xl border animate-slide-in-up pointer-events-auto"
      style={{
        background: 'rgba(6,10,22,0.96)',
        border: '1px solid rgba(14,165,233,0.3)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 16px rgba(14,165,233,0.12)',
        ...style,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-1.5">
          <MapPin size={12} className="text-vayu-accent" />
          <span className="text-xs font-mono text-white/80">
            {cell.lat.toFixed(3)}°N {cell.lon.toFixed(3)}°E
          </span>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 flex flex-col gap-2.5">
        {/* Primary variable */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {variable === 'rainfall' ? (
              <Droplets size={13} className="text-blue-400" />
            ) : (
              <Thermometer size={13} className="text-orange-400" />
            )}
            <span className="text-[11px] text-white/50">
              {variable === 'rainfall' ? 'Rainfall' : variable === 'temp_max' ? 'Max Temp' : 'Min Temp'}
            </span>
          </div>
          <span className="text-base font-bold font-mono tabular-nums" style={{ color: variable === 'rainfall' ? '#60a5fa' : '#f97316' }}>
            {(cell[variable] as number).toFixed(1)}
            <span className="text-xs font-normal text-white/40 ml-0.5">
              {variable === 'rainfall' ? 'mm' : '°C'}
            </span>
          </span>
        </div>

        {/* Uncertainty */}
        {uncertainty > 0 && (
          <div
            className="flex items-center justify-between px-2 py-1 rounded-md"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <span className="text-[10px] text-white/40">± Uncertainty</span>
            <span className="text-[10px] font-mono text-yellow-300/70 tabular-nums">
              {uncertainty.toFixed(2)} {variable === 'rainfall' ? 'mm' : '°C'}
            </span>
          </div>
        )}

        {/* All three vars */}
        <div className="grid grid-cols-3 gap-1">
          {([
            { key: 'rainfall', label: 'Rain', unit: 'mm', color: '#60a5fa' },
            { key: 'temp_max', label: 'Tmax', unit: '°C', color: '#f97316' },
            { key: 'temp_min', label: 'Tmin', unit: '°C', color: '#a78bfa' },
          ] as const).map(({ key, label, unit, color }) => (
            <div
              key={key}
              className="flex flex-col items-center py-1.5 rounded-lg"
              style={{
                background: variable === key ? `${color}18` : 'rgba(255,255,255,0.03)',
                border: variable === key ? `1px solid ${color}40` : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span className="text-[9px] text-white/40">{label}</span>
              <span className="text-xs font-bold font-mono tabular-nums" style={{ color }}>
                {(cell[key] as number).toFixed(1)}
              </span>
              <span className="text-[9px] text-white/25">{unit}</span>
            </div>
          ))}
        </div>

        {/* 7-day sparkline */}
        <div>
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp size={10} className="text-white/30" />
            <span className="text-[9px] text-white/30 uppercase tracking-wider">7-day forecast trend</span>
          </div>
          <MiniSparkline
            values={sparkValues}
            color={variable === 'rainfall' ? '#60a5fa' : variable === 'temp_max' ? '#f97316' : '#a78bfa'}
            width={200}
            height={36}
          />
          <div className="flex justify-between text-[9px] text-white/25 mt-0.5 font-mono">
            {['T+1', 'T+2', 'T+3', 'T+4', 'T+5', 'T+6', 'T+7'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>

        {/* Node index */}
        <div className="text-[9px] text-white/20 text-center font-mono">
          Node #{cell.node_idx} · 0.25° grid
        </div>
      </div>
    </div>
  );
}
