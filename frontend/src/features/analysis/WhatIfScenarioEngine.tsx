/**
 * WhatIfScenarioEngine — DestinE-inspired What-If scenario panel.
 *
 * Supports 6 scenario types, anomaly map visualization, and compound
 * scenario chaining.  Requirement 83.1–83.5
 */
import { useState, useCallback, useId } from 'react';
import {
  Thermometer, Droplets, Wind, Waves, Building2, Trees,
  Play, RotateCcw, Plus, Trash2, AlertTriangle, Info,
  ChevronDown, ChevronUp, Layers,
} from 'lucide-react';
import { runScenario } from '../../api/client';
import type { ScenarioRequest, ScenarioResponse, ScenarioTypeId, ChainedScenario } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioOption {
  id: ScenarioTypeId;
  label: string;
  icon: React.ReactNode;
  description: string;
  magnitudeLabel: string;
  magnitudeMin: number;
  magnitudeMax: number;
  magnitudeStep: number;
  defaultMagnitude: number;
  unit: string;
  formatMagnitude: (v: number) => string;
}

export interface ScenarioResult extends ScenarioResponse {
  scenarioLabel: string;
  timestamp: number;
}

export interface WhatIfScenarioEngineProps {
  onResult: (result: ScenarioResponse, gridLats?: number[], gridLons?: number[]) => void;
  onReset: () => void;
  /** Baseline grid cell lats/lons used to reconstruct the anomaly map */
  gridLats?: number[];
  gridLons?: number[];
}

// ── Scenario definitions ─────────────────────────────────────────────────────

export const SCENARIO_OPTIONS: ScenarioOption[] = [
  {
    id: 'temperature_offset',
    label: 'Temperature Rise',
    icon: <Thermometer size={16} />,
    description: 'Uniform temperature change across the region. Positive = warming, negative = cooling.',
    magnitudeLabel: 'Temperature offset',
    magnitudeMin: -3,
    magnitudeMax: 4,
    magnitudeStep: 0.5,
    defaultMagnitude: 2.0,
    unit: '°C',
    formatMagnitude: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°C`,
  },
  {
    id: 'rainfall_scaling',
    label: 'Rainfall Change',
    icon: <Droplets size={16} />,
    description: 'Scale rainfall by a factor (1.5 = +50% wetter, 0.5 = −50% drier).',
    magnitudeLabel: 'Scale factor',
    magnitudeMin: 0.4,
    magnitudeMax: 2.0,
    magnitudeStep: 0.1,
    defaultMagnitude: 0.8,
    unit: '×',
    formatMagnitude: (v) => `${((v - 1) * 100).toFixed(0)}%`,
  },
  {
    id: 'monsoon_delay',
    label: 'Monsoon Delay',
    icon: <Wind size={16} />,
    description: 'Shift monsoon onset date by N days. Positive = later arrival.',
    magnitudeLabel: 'Delay (days)',
    magnitudeMin: -21,
    magnitudeMax: 21,
    magnitudeStep: 7,
    defaultMagnitude: 14,
    unit: ' days',
    formatMagnitude: (v) => `${v > 0 ? '+' : ''}${v} days`,
  },
  {
    id: 'sst_anomaly',
    label: 'El Niño (SST)',
    icon: <Waves size={16} />,
    description: 'Arabian Sea sea-surface temperature anomaly affecting monsoon via Walker circulation.',
    magnitudeLabel: 'SST anomaly',
    magnitudeMin: -3,
    magnitudeMax: 3,
    magnitudeStep: 0.5,
    defaultMagnitude: 1.5,
    unit: '°C',
    formatMagnitude: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°C`,
  },
  {
    id: 'urbanization_change',
    label: 'Urbanization',
    icon: <Building2 size={16} />,
    description: 'Increase/decrease in urban cover. Raises temperatures (urban heat island) and alters rainfall.',
    magnitudeLabel: 'Urban cover change',
    magnitudeMin: -1.0,
    magnitudeMax: 1.0,
    magnitudeStep: 0.1,
    defaultMagnitude: 0.5,
    unit: '',
    formatMagnitude: (v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`,
  },
  {
    id: 'deforestation_impact',
    label: 'Deforestation',
    icon: <Trees size={16} />,
    description: 'Forest cover loss (positive) or gain via afforestation (negative). Affects moisture recycling.',
    magnitudeLabel: 'Forest cover change',
    magnitudeMin: -1.0,
    magnitudeMax: 1.0,
    magnitudeStep: 0.1,
    defaultMagnitude: 0.3,
    unit: '',
    formatMagnitude: (v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`,
  },
];

const TARGET_SEASONS = [
  { id: 'annual', label: 'Annual' },
  { id: 'monsoon', label: 'Monsoon (JJAS)' },
  { id: 'winter', label: 'Winter (DJF)' },
  { id: 'pre_monsoon', label: 'Pre-Monsoon (MAM)' },
];

// ── AnomalyBar: small inline delta indicator ─────────────────────────────────

function AnomalyBar({ delta, maxDelta }: { delta: number; maxDelta: number }) {
  const pct = Math.abs(maxDelta) < 1e-9 ? 0 : Math.min(100, (Math.abs(delta) / Math.abs(maxDelta)) * 100);
  const positive = delta >= 0;
  return (
    <div className="flex items-center gap-1 w-full">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${positive ? 'bg-orange-400' : 'bg-blue-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono w-16 text-right ${positive ? 'text-orange-400' : 'text-blue-400'}`}>
        {delta > 0 ? '+' : ''}{delta.toFixed(2)}
      </span>
    </div>
  );
}

// ── ChainStep: a single step in the compound scenario chain ─────────────────

function ChainStep({
  step,
  index,
  onRemove,
  onUpdate,
}: {
  step: ChainedScenario;
  index: number;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<ChainedScenario>) => void;
}) {
  const opt = SCENARIO_OPTIONS.find((o) => o.id === step.scenario_type)!;
  return (
    <div className="flex items-center gap-2 p-2 bg-white/5 rounded-lg border border-white/10">
      <span className="text-xs text-white/30 font-mono w-4 shrink-0">{index + 1}</span>
      <span className="text-xs text-vayu-accent shrink-0">{opt.icon}</span>
      <span className="text-xs text-white/70 flex-1 truncate">{opt.label}</span>
      <span className="text-xs font-mono text-white/50">{opt.formatMagnitude(step.magnitude)}</span>
      <button
        onClick={() => onRemove(step.id)}
        className="text-red-400/60 hover:text-red-400 transition-colors"
        aria-label="Remove scenario step"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ── AnomalyMapSummary: mini per-variable anomaly visualization ───────────────

function AnomalyMapSummary({ results }: { results: ScenarioResult[] }) {
  if (results.length === 0) return null;

  // For chained scenarios, compound deltas by accumulation
  const variables = ['rainfall', 'temp_max', 'temp_min'] as const;

  // Aggregate: sum deltas across all chained results
  const aggregatedDelta: Record<string, number[]> = { rainfall: [], temp_max: [], temp_min: [] };
  for (const variable of variables) {
    const deltas = results.map((r) => r.delta[variable] ?? []);
    if (deltas.length === 0 || deltas[0].length === 0) continue;
    const len = deltas[0].length;
    aggregatedDelta[variable] = Array.from({ length: len }, (_, i) =>
      deltas.reduce((sum, d) => sum + (d[i] ?? 0), 0)
    );
  }

  const summaryRows = variables.map((variable) => {
    const deltas = aggregatedDelta[variable];
    if (!deltas || deltas.length === 0) return null;
    const avgDelta = deltas.reduce((s, v) => s + v, 0) / deltas.length;
    const maxAbsDelta = Math.max(...deltas.map(Math.abs));
    const affectedCells = deltas.filter((d) => Math.abs(d) > 0.05 * maxAbsDelta).length;
    return { variable, avgDelta, maxAbsDelta, affectedCells };
  }).filter(Boolean);

  const labels: Record<string, string> = {
    rainfall: 'Rainfall (Δ mm/d)',
    temp_max: 'Temp Max (Δ °C)',
    temp_min: 'Temp Min (Δ °C)',
  };

  return (
    <div className="flex flex-col gap-2 p-3 bg-vayu-blue/10 border border-vayu-blue/20 rounded-lg">
      <div className="flex items-center gap-1.5 mb-1">
        <Layers size={12} className="text-vayu-blue" />
        <p className="text-xs text-white/70 font-medium">Anomaly Map (Δ from Baseline)</p>
        {results.length > 1 && (
          <span className="ml-auto text-xs text-white/30">{results.length} scenarios chained</span>
        )}
      </div>
      {summaryRows.map((row) => {
        if (!row) return null;
        return (
          <div key={row.variable} className="flex flex-col gap-0.5">
            <div className="flex justify-between text-xs text-white/40">
              <span>{labels[row.variable]}</span>
              <span className="text-white/25">{row.affectedCells} cells affected</span>
            </div>
            <AnomalyBar delta={row.avgDelta} maxDelta={row.maxAbsDelta || 1} />
          </div>
        );
      })}
      {results[results.length - 1]?.clamp_message && (
        <p className="text-xs text-yellow-400/70 mt-1">
          {results[results.length - 1].clamp_message}
        </p>
      )}
      <p className="text-xs text-white/20">
        Computed in {results.reduce((s, r) => s + r.computation_time_s, 0).toFixed(1)}s
        {results.length > 1 ? ` (${results.length}× chained)` : ''}
      </p>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function WhatIfScenarioEngine({
  onResult,
  onReset,
  gridLats,
  gridLons,
}: WhatIfScenarioEngineProps) {
  const uid = useId();

  // ── Single-scenario mode state ─────────────────────────────────────────────
  const [selectedScenario, setSelectedScenario] = useState<ScenarioOption>(SCENARIO_OPTIONS[0]);
  const [magnitude, setMagnitude] = useState(SCENARIO_OPTIONS[0].defaultMagnitude);
  const [targetSeason, setTargetSeason] = useState('annual');

  // ── Chain mode state ───────────────────────────────────────────────────────
  const [chainMode, setChainMode] = useState(false);
  const [chainedSteps, setChainedSteps] = useState<ChainedScenario[]>([]);
  const [showChainBuilder, setShowChainBuilder] = useState(false);

  // ── Result state ───────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScenarioResult[]>([]);

  // ── Handlers: single mode ──────────────────────────────────────────────────
  const handleScenarioChange = useCallback((opt: ScenarioOption) => {
    setSelectedScenario(opt);
    setMagnitude(opt.defaultMagnitude);
    setError(null);
  }, []);

  const handleAddToChain = useCallback(() => {
    const newStep: ChainedScenario = {
      id: `${uid}-${Date.now()}`,
      scenario_type: selectedScenario.id,
      magnitude,
      label: `${selectedScenario.label} ${selectedScenario.formatMagnitude(magnitude)}`,
    };
    setChainedSteps((prev) => [...prev, newStep]);
    setShowChainBuilder(true);
  }, [selectedScenario, magnitude, uid]);

  const handleRemoveChainStep = useCallback((id: string) => {
    setChainedSteps((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleUpdateChainStep = useCallback((id: string, updates: Partial<ChainedScenario>) => {
    setChainedSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

  // ── Run single or chained scenarios ───────────────────────────────────────
  const handleRun = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const startTime = Date.now();

    const stepsToRun: ScenarioRequest[] = chainMode && chainedSteps.length > 0
      ? chainedSteps.map((s) => ({
          scenario_type: s.scenario_type,
          magnitude: s.magnitude,
          target_region: 'full_india',
          target_season: targetSeason,
        }))
      : [{
          scenario_type: selectedScenario.id,
          magnitude,
          target_region: 'full_india',
          target_season: targetSeason,
        }];

    try {
      const newResults: ScenarioResult[] = [];
      for (const req of stepsToRun) {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 4.8) {
          // Safety: bail out to stay under 5s SLA (req 83.5)
          console.warn('[WhatIfScenarioEngine] 5s SLA approaching — stopping chain early');
          break;
        }
        const opt = SCENARIO_OPTIONS.find((o) => o.id === req.scenario_type)!;
        const res = await runScenario(req);
        newResults.push({
          ...res,
          scenarioLabel: `${opt.label} ${opt.formatMagnitude(req.magnitude)}`,
          timestamp: Date.now(),
        });
      }
      setResults(newResults);
      // Emit the last result (or only result for single mode) to the parent
      if (newResults.length > 0) {
        onResult(newResults[newResults.length - 1], gridLats, gridLons);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setIsLoading(false);
    }
  }, [
    chainMode, chainedSteps, selectedScenario, magnitude, targetSeason, onResult, gridLats, gridLons,
  ]);

  const handleReset = useCallback(() => {
    setResults([]);
    setError(null);
    setChainedSteps([]);
    onReset();
  }, [onReset]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="panel p-4 flex flex-col gap-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-sm tracking-wide flex items-center gap-1.5">
          <Layers size={14} className="text-vayu-blue" />
          What-If Scenarios
        </h2>
        <div className="flex items-center gap-2">
          {results.length > 0 && (
            <button onClick={handleReset} className="btn-ghost flex items-center gap-1 text-xs">
              <RotateCcw size={12} /> Reset
            </button>
          )}
          <button
            onClick={() => setChainMode((v) => !v)}
            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
              chainMode
                ? 'border-vayu-blue bg-vayu-blue/20 text-white'
                : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
            title="Enable compound scenario chaining"
          >
            Chain
          </button>
        </div>
      </div>

      {/* Scenario type grid (3×2) */}
      <div className="grid grid-cols-3 gap-1.5">
        {SCENARIO_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleScenarioChange(opt)}
            className={`flex flex-col items-start gap-1 p-2 rounded-lg border transition-all text-left ${
              selectedScenario.id === opt.id
                ? 'border-vayu-blue bg-vayu-blue/20 text-white'
                : 'border-white/10 bg-white/5 text-white/60 hover:text-white/80 hover:border-white/20'
            }`}
            title={opt.description}
          >
            <div className={selectedScenario.id === opt.id ? 'text-vayu-accent' : ''}>{opt.icon}</div>
            <span className="text-xs font-medium leading-tight">{opt.label}</span>
          </button>
        ))}
      </div>

      {/* Magnitude slider */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-xs text-white/50">{selectedScenario.magnitudeLabel}</span>
          <span className="text-sm font-bold text-vayu-accent font-mono">
            {selectedScenario.formatMagnitude(magnitude)}
          </span>
        </div>
        <input
          type="range"
          id={`${uid}-magnitude`}
          min={selectedScenario.magnitudeMin}
          max={selectedScenario.magnitudeMax}
          step={selectedScenario.magnitudeStep}
          value={magnitude}
          onChange={(e) => setMagnitude(Number(e.target.value))}
          className="w-full h-1.5 appearance-none bg-white/10 rounded-full cursor-pointer
                     [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-vayu-accent [&::-webkit-slider-thumb]:cursor-pointer"
          aria-label={`${selectedScenario.magnitudeLabel}: ${selectedScenario.formatMagnitude(magnitude)}`}
        />
        <div className="flex justify-between text-xs text-white/20">
          <span>{selectedScenario.formatMagnitude(selectedScenario.magnitudeMin)}</span>
          <span>{selectedScenario.formatMagnitude(selectedScenario.magnitudeMax)}</span>
        </div>
      </div>

      {/* Target season */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-white/50">Target Season</span>
        <div className="grid grid-cols-2 gap-1">
          {TARGET_SEASONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setTargetSeason(s.id)}
              className={`text-xs py-1.5 px-2 rounded-md border transition-colors ${
                targetSeason === s.id
                  ? 'border-vayu-blue bg-vayu-blue/20 text-white'
                  : 'border-white/10 text-white/40 hover:text-white/60'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div className="flex gap-2 p-2.5 bg-white/5 rounded-lg">
        <Info size={12} className="text-vayu-blue mt-0.5 shrink-0" />
        <p className="text-xs text-white/50">{selectedScenario.description}</p>
      </div>

      {/* Chain builder — shown when chain mode is on */}
      {chainMode && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowChainBuilder((v) => !v)}
            className="flex items-center justify-between text-xs text-white/50 hover:text-white/70"
          >
            <span className="font-medium text-white/70 flex items-center gap-1">
              <Layers size={12} />
              Compound Chain ({chainedSteps.length} step{chainedSteps.length !== 1 ? 's' : ''})
            </span>
            {showChainBuilder ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showChainBuilder && (
            <div className="flex flex-col gap-1.5">
              {chainedSteps.length === 0 ? (
                <p className="text-xs text-white/25 italic">
                  Configure a scenario above then click "+ Add to Chain" to build compound effects.
                </p>
              ) : (
                chainedSteps.map((step, idx) => (
                  <ChainStep
                    key={step.id}
                    step={step}
                    index={idx}
                    onRemove={handleRemoveChainStep}
                    onUpdate={handleUpdateChainStep}
                  />
                ))
              )}
              <button
                onClick={handleAddToChain}
                className="flex items-center justify-center gap-1 text-xs py-1.5 px-3 rounded-md
                           border border-dashed border-vayu-blue/40 text-vayu-blue/70
                           hover:border-vayu-blue hover:text-vayu-blue transition-colors"
              >
                <Plus size={12} />
                Add current to chain
              </button>
            </div>
          )}
        </div>
      )}

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={isLoading || (chainMode && chainedSteps.length === 0)}
        className="btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
        aria-busy={isLoading}
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            <span>Computing…</span>
          </>
        ) : (
          <>
            <Play size={14} />
            <span>
              {chainMode && chainedSteps.length > 0
                ? `Run ${chainedSteps.length} Chained Scenario${chainedSteps.length > 1 ? 's' : ''}`
                : 'Run Scenario'}
            </span>
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="flex gap-2 p-2.5 bg-red-500/20 border border-red-500/30 rounded-lg" role="alert">
          <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Anomaly map summary */}
      {results.length > 0 && <AnomalyMapSummary results={results} />}
    </div>
  );
}
