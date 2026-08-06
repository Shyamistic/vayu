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
  /**
   * This same grid node across consecutive forecast lead days, index 0 = T+1.
   * Supplied by App.tsx from `useForecastSeries`. When absent or shorter than 2
   * entries the trend is reported as unavailable — it is never synthesised.
   */
  forecastCells?: GridCell[];
  /** True while the T+1..T+7 series is still in flight. */
  forecastPending?: boolean;
  /** True when the client served bundled demo data for any lead day. */
  forecastIsMock?: boolean;
  onClose: () => void;
  style?: React.CSSProperties;
  /** Optional prediction run metadata — model version, freshness, cache status. */
  modelVersion?: string;
  inputDataTimestamp?: string;
  cached?: boolean;
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
  forecastPending = false,
  forecastIsMock = false,
  onClose,
  style,
  modelVersion,
  inputDataTimestamp,
  cached,
}: CellInfoCardProps) {
  // Trend values come ONLY from real per-lead predictions.
  //
  // This previously fell back to `base + (Math.random() - 0.5) * base * 0.4`
  // whenever `forecastCells` was absent — which was always, because App.tsx
  // never passed the prop. A smooth invented curve rendered directly above a
  // "live" badge and a model version reads as a real forecast, so the fallback
  // was actively misleading rather than merely decorative. There is deliberately
  // no synthetic path now: if the series is missing, the card says so.
  const sparkValues: number[] = (forecastCells ?? [])
    .map((c) => c[variable] as number)
    .filter((v) => Number.isFinite(v));
  const hasTrend = sparkValues.length >= 2;
  // Lead-day labels are derived from the data length, not hardcoded to 7, so a
  // truncated series cannot mislabel T+3 as T+7.
  const leadLabels = sparkValues.map((_, i) => `T+${i + 1}`);

  const uncertainty = cell[`${variable}_uncertainty` as keyof GridCell] as number ?? 0;

  return (
    <div
      className="fixed z-[1003] w-56 rounded-xl backdrop-blur-xl border animate-slide-in-up pointer-events-auto"
      style={{
        background: 'rgba(var(--panel-bg-rgb),0.96)',
        border: '1px solid rgba(14,165,233,0.3)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 16px rgba(14,165,233,0.12)',
        ...style,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b"
        style={{ borderColor: 'rgba(var(--fg-rgb),var(--fg-a08))' }}
      >
        <div className="flex items-center gap-1.5">
          <MapPin size={12} className="text-vayu-accent" />
          <span className="text-xs font-mono text-foreground/80">
            {cell.lat.toFixed(3)}°N {cell.lon.toFixed(3)}°E
          </span>
        </div>
        <button onClick={onClose} className="text-foreground/40 hover:text-foreground/80 transition-colors">
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
            <span className="text-[11px] text-foreground/50">
              {variable === 'rainfall' ? 'Rainfall' : variable === 'temp_max' ? 'Max Temp' : 'Min Temp'}
            </span>
          </div>
          <span className="text-base font-bold font-mono tabular-nums" style={{ color: variable === 'rainfall' ? '#60a5fa' : '#f97316' }}>
            {(cell[variable] as number).toFixed(1)}
            <span className="text-xs font-normal text-foreground/40 ml-0.5">
              {variable === 'rainfall' ? 'mm' : '°C'}
            </span>
          </span>
        </div>

        {/* Uncertainty */}
        {uncertainty > 0 && (
          <div
            className="flex items-center justify-between px-2 py-1 rounded-md"
            style={{ background: 'rgba(var(--fg-rgb),var(--fg-a05))' }}
          >
            <span className="text-[10px] text-foreground/40">± Uncertainty</span>
            <span className="text-[10px] font-mono text-yellow-300/70 tabular-nums">
              {uncertainty.toFixed(2)} {variable === 'rainfall' ? 'mm' : '°C'}
            </span>
          </div>
        )}

        {/* All three vars, each with its own uncertainty (all already on `cell`,
            previously only the selected variable's uncertainty was surfaced) */}
        <div className="grid grid-cols-3 gap-1">
          {([
            { key: 'rainfall', uncertaintyKey: 'rainfall_uncertainty', label: 'Rain', unit: 'mm', color: '#60a5fa' },
            { key: 'temp_max', uncertaintyKey: 'temp_max_uncertainty', label: 'Tmax', unit: '°C', color: '#f97316' },
            { key: 'temp_min', uncertaintyKey: 'temp_min_uncertainty', label: 'Tmin', unit: '°C', color: '#a78bfa' },
          ] as const).map(({ key, uncertaintyKey, label, unit, color }) => (
            <div
              key={key}
              className="flex flex-col items-center py-1.5 rounded-lg"
              style={{
                background: variable === key ? `${color}18` : 'rgba(var(--fg-rgb),var(--fg-a05))',
                border: variable === key ? `1px solid ${color}40` : '1px solid rgba(var(--fg-rgb),var(--fg-a05))',
              }}
            >
              <span className="text-[9px] text-foreground/40">{label}</span>
              <span className="text-xs font-bold font-mono tabular-nums" style={{ color }}>
                {(cell[key] as number).toFixed(1)}
              </span>
              <span className="text-[9px] text-foreground/25">{unit}</span>
              {cell[uncertaintyKey] > 0 && (
                <span className="text-[8px] font-mono text-yellow-300/60 mt-0.5">
                  ±{cell[uncertaintyKey].toFixed(1)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Forecast trend — real per-lead model output only, never synthesised. */}
        <div>
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp size={10} className="text-foreground/30" />
            <span className="text-[9px] text-foreground/30 uppercase tracking-wider">
              {hasTrend ? `${sparkValues.length}-day forecast trend` : 'Forecast trend'}
            </span>
            {hasTrend && forecastIsMock && (
              <span className="text-[8px] font-mono text-amber-300/70 uppercase tracking-wide">
                demo data
              </span>
            )}
            {hasTrend && !forecastIsMock && sparkValues.length < 7 && (
              <span className="text-[8px] font-mono text-amber-300/60 uppercase tracking-wide">
                partial
              </span>
            )}
          </div>
          {hasTrend ? (
            <>
              <MiniSparkline
                values={sparkValues}
                color={variable === 'rainfall' ? '#60a5fa' : variable === 'temp_max' ? '#f97316' : '#a78bfa'}
                width={200}
                height={36}
              />
              <div className="flex justify-between text-[9px] text-foreground/25 mt-0.5 font-mono">
                {leadLabels.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
            </>
          ) : (
            <div
              role="status"
              className="text-[9px] text-foreground/25 font-mono py-2 text-center rounded-md"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              {forecastPending ? 'Loading T+1…T+7…' : 'Forecast trend unavailable'}
            </div>
          )}
        </div>

        {/* Node index */}
        <div className="text-[9px] text-foreground/20 text-center font-mono">
          Node #{cell.node_idx} · 0.25° grid
        </div>

        {/* Prediction run metadata — model version, cache/live status, data
            freshness. Already available on activePrediction in App.tsx but
            wasn't previously passed down to this card. */}
        {(modelVersion || inputDataTimestamp || cached !== undefined) && (
          <div
            className="flex items-center justify-between px-2 py-1 rounded-md text-[8px] font-mono"
            style={{ background: 'rgba(var(--fg-rgb),var(--fg-a05))' }}
          >
            <span className="text-foreground/25">
              {modelVersion ? `VAYU v${modelVersion}` : ''}
            </span>
            <span className="flex items-center gap-1">
              {cached !== undefined && (
                <span className={cached ? 'text-foreground/30' : 'text-emerald-400/70'}>
                  {cached ? 'cached' : 'live'}
                </span>
              )}
              {inputDataTimestamp && (
                <span className="text-foreground/25" title={inputDataTimestamp}>
                  {new Date(inputDataTimestamp).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
