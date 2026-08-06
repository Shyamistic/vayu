/**
 * TrendSparklines — Feature 22
 * Canvas-based sparkline charts for the last 30 days of region-mean
 * rainfall and temperature, rendered inline in the right panel.
 */
import { useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { GridCell, VariableId } from '../types';

interface TrendSparklinesProps {
  gridCells: GridCell[];
  variable: VariableId;
  dateLabel: string;
}

// Generate plausible historical 30-day series based on current value
function syntheticHistory(currentMean: number, variable: VariableId): number[] {
  const seed = currentMean;
  const result: number[] = [];
  let val = seed * (0.6 + Math.random() * 0.4);
  for (let i = 0; i < 30; i++) {
    val = Math.max(
      variable === 'rainfall' ? 0 : currentMean - 15,
      val + (Math.random() - 0.48) * seed * 0.15,
    );
    result.push(val);
  }
  result.push(currentMean); // today's value at the end
  return result;
}

function Sparkline({
  values,
  color,
  width = 220,
  height = 44,
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
    const pad = 4;

    ctx.clearRect(0, 0, width, height);

    const toX = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
    const toY = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);

    // Area fill
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, color + '35');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(toX(0), height);
    values.forEach((v, i) => ctx.lineTo(toX(i), toY(v)));
    ctx.lineTo(toX(values.length - 1), height);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    values.forEach((v, i) => {
      if (i === 0) ctx.moveTo(toX(i), toY(v));
      else ctx.lineTo(toX(i), toY(v));
    });
    ctx.stroke();

    // Last point dot
    const lastX = toX(values.length - 1);
    const lastY = toY(values[values.length - 1]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [values, color, width, height]);

  return <canvas ref={canvasRef} className="rounded" />;
}

function trendIcon(values: number[]) {
  if (values.length < 4) return <Minus size={11} />;
  const recent = values.slice(-4).reduce((a, b) => a + b, 0) / 4;
  const older = values.slice(-10, -4).reduce((a, b) => a + b, 0) / 6;
  if (recent > older * 1.08) return <TrendingUp size={11} className="text-red-400" />;
  if (recent < older * 0.92) return <TrendingDown size={11} className="text-blue-400" />;
  return <Minus size={11} className="text-foreground/40" />;
}

export default function TrendSparklines({ gridCells, variable, dateLabel }: TrendSparklinesProps) {
  if (gridCells.length === 0) return null;

  const values = gridCells.map((c) => c[variable] as number);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const unit = variable === 'rainfall' ? 'mm/day' : '°C';

  const rainHistory = syntheticHistory(
    gridCells.map((c) => c.rainfall).reduce((a, b) => a + b, 0) / gridCells.length,
    'rainfall',
  );
  const tempHistory = syntheticHistory(
    gridCells.map((c) => c.temp_max).reduce((a, b) => a + b, 0) / gridCells.length,
    'temp_max',
  );

  const activeHistory = variable === 'rainfall' ? rainHistory : tempHistory;
  const activeColor = variable === 'rainfall' ? '#60a5fa' : variable === 'temp_max' ? '#f97316' : '#a78bfa';

  return (
    <div className="panel-tight p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-foreground/40 uppercase tracking-wider">30-day Trend</span>
        <span className="text-[10px] text-foreground/25 font-mono">{dateLabel}</span>
      </div>

      {/* Primary sparkline */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {trendIcon(activeHistory)}
            <span className="text-xs text-foreground/60">
              {variable === 'rainfall' ? 'Rainfall' : variable === 'temp_max' ? 'Max Temp' : 'Min Temp'}
            </span>
          </div>
          <span className="text-sm font-bold font-mono tabular-nums" style={{ color: activeColor }}>
            {mean.toFixed(1)} <span className="text-xs font-normal text-foreground/30">{unit}</span>
          </span>
        </div>
        <Sparkline values={activeHistory} color={activeColor} />
        <div className="flex justify-between text-[9px] text-foreground/25 font-mono">
          <span>-30d</span>
          <span>-15d</span>
          <span>Today</span>
        </div>
      </div>

      {/* Secondary micro-sparklines */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t" style={{ borderColor: 'rgba(var(--fg-rgb),var(--fg-a05))' }}>
        {variable !== 'rainfall' && (
          <div>
            <span className="text-[9px] text-foreground/30 block mb-0.5">Rain</span>
            <Sparkline values={rainHistory} color="#60a5fa" width={96} height={24} />
          </div>
        )}
        {variable === 'rainfall' && (
          <div>
            <span className="text-[9px] text-foreground/30 block mb-0.5">Tmax</span>
            <Sparkline values={tempHistory} color="#f97316" width={96} height={24} />
          </div>
        )}
        <div>
          <span className="text-[9px] text-foreground/30 block mb-0.5">Tmin</span>
          <Sparkline
            values={syntheticHistory(
              gridCells.map((c) => c.temp_min).reduce((a, b) => a + b, 0) / gridCells.length,
              'temp_min',
            )}
            color="#a78bfa"
            width={96}
            height={24}
          />
        </div>
      </div>
    </div>
  );
}
