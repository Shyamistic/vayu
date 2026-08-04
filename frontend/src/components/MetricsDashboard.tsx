import { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { fetchMetrics } from '../api/client';
import type { MetricsResponse, VariableId } from '../types';

interface MetricsDashboardProps {
  selectedVariable: VariableId;
  onVariableChange?: (v: VariableId) => void;
}

const VARIABLES: { id: VariableId; label: string; color: string }[] = [
  { id: 'rainfall', label: 'Rainfall', color: '#3b82f6' },
  { id: 'temp_max', label: 'Max Temp', color: '#ef4444' },
  { id: 'temp_min', label: 'Min Temp', color: '#8b5cf6' },
];

// Performance target thresholds (from requirements)
const R2_TARGETS: Record<VariableId, number> = {
  rainfall: 0.70,
  temp_max: 0.85,
  temp_min: 0.85,
};

function MetricGauge({ value, target, label }: { value: number; target: number; label: string }) {
  const pct = Math.min(Math.max(value * 100, 0), 100);
  const passes = value >= target;

  return (
    <div className="metric-card">
      <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${passes ? 'bg-green-400' : 'bg-yellow-400'}`}
          style={{ width: `${pct}%` }}
        />
        {/* Target marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/40"
          style={{ left: `${target * 100}%` }}
        />
      </div>
      <div className="flex justify-between items-end mt-1">
        <span className="metric-label">{label}</span>
        <span className={`metric-value text-lg ${passes ? 'text-green-400' : 'text-yellow-400'}`}>
          {value.toFixed(3)}
        </span>
      </div>
      <div className="text-xs text-white/25">
        Target: ≥{(target * 100).toFixed(0)}%
        {passes ? ' ✓' : ` (gap: ${((target - value) * 100).toFixed(1)}%)` }
      </div>
    </div>
  );
}

export default function MetricsDashboard({
  selectedVariable,
  onVariableChange,
}: MetricsDashboardProps) {
  const [metrics, setMetrics] = useState<Record<VariableId, MetricsResponse | null>>({
    rainfall: null, temp_max: null, temp_min: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all(
      VARIABLES.map(({ id }) =>
        fetchMetrics(id).then((m) => [id, m] as [VariableId, MetricsResponse]),
      ),
    )
      .then((results) => {
        const m = Object.fromEntries(results) as Record<VariableId, MetricsResponse>;
        setMetrics(m);
      })
      .finally(() => setLoading(false));
  }, []);

  const current = metrics[selectedVariable];

  // Mock time series for predicted vs observed (would come from API in production)
  const mockDates = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(2024, 8, 1); // Sep 2024
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const rng = (seed: number) => {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return s / 0x100000000 + 0.5; };
  };
  const rand = rng(42);
  const observed = mockDates.map(() => (selectedVariable === 'rainfall' ? rand() * 20 : 25 + rand() * 15));
  const predicted = observed.map((v) => v + (rand() - 0.5) * 3);

  return (
    <div className="panel p-4 flex flex-col gap-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-sm">Model Performance</h2>
        <span className="text-xs text-white/30">2024-2025 test set</span>
      </div>

      {/* Variable selector */}
      <div className="flex gap-1">
        {VARIABLES.map(({ id, label, color }) => (
          <button
            key={id}
            onClick={() => onVariableChange?.(id)}
            className={`flex-1 text-xs py-1.5 rounded-md border transition-colors ${
              selectedVariable === id
                ? 'border-transparent text-white font-medium'
                : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
            style={selectedVariable === id ? { backgroundColor: `${color}33`, borderColor: color } : {}}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-24">
          <div className="w-5 h-5 border-2 border-vayu-blue border-t-transparent rounded-full animate-spin" />
        </div>
      ) : current ? (
        <>
          {/* R² gauge */}
          <MetricGauge
            value={current.r2_score}
            target={R2_TARGETS[selectedVariable]}
            label="R² Score"
          />

          {/* RMSE + MAE cards */}
          <div className="grid grid-cols-2 gap-2">
            <div className="metric-card">
              <span className="metric-label">RMSE</span>
              <span className="metric-value">{current.rmse.toFixed(2)}</span>
              <span className="text-xs text-white/25">
                {selectedVariable === 'rainfall' ? 'mm/day' : '°C'}
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-label">MAE</span>
              <span className="metric-value">{current.mae.toFixed(2)}</span>
              <span className="text-xs text-white/25">
                {selectedVariable === 'rainfall' ? 'mm/day' : '°C'}
              </span>
            </div>
          </div>

          {/* Skill score */}
          <div className="metric-card">
            <span className="metric-label">Skill Score vs Climatology</span>
            <div className="flex items-end gap-2">
              <span className="metric-value text-green-400">
                {(current.skill_score * 100).toFixed(0)}%
              </span>
              <span className="text-xs text-white/30 mb-1">better than baseline</span>
            </div>
          </div>
        </>
      ) : null}

      {/* Time series chart */}
      <div className="rounded-lg overflow-hidden">
        <p className="text-xs text-white/50 mb-1 px-1">Predicted vs Observed (90-day sample)</p>
        <Plot
          data={[
            {
              x: mockDates,
              y: observed,
              type: 'scatter',
              mode: 'lines',
              name: 'Observed',
              line: { color: 'rgba(255,255,255,0.4)', width: 1 },
            },
            {
              x: mockDates,
              y: predicted,
              type: 'scatter',
              mode: 'lines',
              name: 'Predicted',
              line: {
                color: VARIABLES.find((v) => v.id === selectedVariable)?.color || '#3b82f6',
                width: 2,
              },
            },
          ]}
          layout={{
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'rgba(255,255,255,0.03)',
            font: { color: 'rgba(255,255,255,0.5)', size: 10 },
            margin: { l: 30, r: 10, t: 10, b: 30 },
            xaxis: {
              gridcolor: 'rgba(255,255,255,0.05)',
              tickfont: { size: 9 },
            },
            yaxis: {
              gridcolor: 'rgba(255,255,255,0.05)',
              tickfont: { size: 9 },
            },
            legend: { x: 0.5, y: 1.1, orientation: 'h', font: { size: 9 } },
            height: 150,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
          useResizeHandler
        />
      </div>

      {/* Eval period */}
      {current && (
        <p className="text-xs text-white/25 text-center">
          Evaluation period: {current.eval_period} · Region: {current.region}
        </p>
      )}
    </div>
  );
}
