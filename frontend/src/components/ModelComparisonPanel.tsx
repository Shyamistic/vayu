import { useEffect, useState } from 'react';
import { fetchMetrics } from '../api/client';
import type { MetricsResponse, VariableId } from '../types';
import type { RegionId } from '../types';

interface Props {
  variable: VariableId;
  region: RegionId;
}

const MODELS = [
  { id: 'vayu', label: 'VAYU (GNN+Transformer)', color: '#3b82f6' },
  { id: 'persistence', label: 'Persistence', color: '#94a3b8' },
  { id: 'climatology', label: 'Climatology', color: '#64748b' },
  { id: 'random_forest', label: 'Random Forest', color: '#22c55e' },
] as const;

type ModelId = (typeof MODELS)[number]['id'];

function Bar({
  value,
  max,
  color,
  label,
  unit,
}: {
  value: number | undefined;
  max: number;
  color: string;
  label: string;
  unit: string;
}) {
  if (value === undefined) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/30 w-32 truncate">{label}</span>
        <span className="text-xs text-white/20">—</span>
      </div>
    );
  }
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/50 w-32 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs text-white/60 w-16 text-right tabular-nums">
        {value.toFixed(3)} {unit}
      </span>
    </div>
  );
}

export default function ModelComparisonPanel({ variable, region }: Props) {
  const [data, setData] = useState<Record<ModelId, MetricsResponse | null>>({
    vayu: null,
    persistence: null,
    climatology: null,
    random_forest: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all(
      MODELS.map(({ id }) =>
        fetchMetrics(variable, region, { sourceModel: id, denormalized: true })
          .then((m) => [id, m] as [ModelId, MetricsResponse])
          .catch(() => [id, null] as [ModelId, null]),
      ),
    )
      .then((results) => {
        setData(Object.fromEntries(results) as Record<ModelId, MetricsResponse | null>);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [variable, region]);

  const varLabel = variable === 'rainfall' ? 'mm/day' : '°C';
  const maxRmse = variable === 'rainfall' ? 20 : 10;

  return (
    <div className="panel p-4 flex flex-col gap-3 w-full">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-sm">Model Comparison</h2>
        <span className="text-xs text-white/30 uppercase tracking-wide">{region.replace(/_/g, ' ')}</span>
      </div>

      {loading && (
        <div className="text-xs text-white/30 text-center py-4">Loading metrics…</div>
      )}
      {error && (
        <div className="text-xs text-red-400 text-center py-2">{error}</div>
      )}

      {!loading && !error && (
        <>
          {/* RMSE comparison */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-white/30 uppercase tracking-wider">RMSE ↓ lower is better</span>
            {MODELS.map(({ id, label, color }) => (
              <Bar
                key={id}
                label={label}
                value={data[id]?.rmse}
                max={maxRmse}
                color={color}
                unit={varLabel}
              />
            ))}
          </div>

          <div className="border-t border-white/10" />

          {/* R² comparison */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-white/30 uppercase tracking-wider">R² ↑ higher is better</span>
            {MODELS.map(({ id, label, color }) => (
              <Bar
                key={id}
                label={label}
                value={data[id]?.r2_score !== undefined ? data[id]?.r2_score : undefined}
                max={1}
                color={color}
                unit=""
              />
            ))}
          </div>

          <div className="border-t border-white/10" />

          {/* Skill vs persistence */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-white/30 uppercase tracking-wider">VAYU Skill vs Persistence</span>
            <span
              className={`text-2xl font-bold tabular-nums ${
                (data.vayu?.skill_score ?? 0) > 0 ? 'text-green-400' : 'text-yellow-400'
              }`}
            >
              {data.vayu?.skill_score !== undefined
                ? `${(data.vayu.skill_score * 100).toFixed(1)}%`
                : '—'}
            </span>
            <span className="text-xs text-white/25">
              {(data.vayu?.skill_score ?? 0) > 0
                ? 'VAYU outperforms persistence baseline'
                : 'Below persistence baseline — more training needed'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
