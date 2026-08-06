import { useState } from 'react';
import {
  Play, RotateCcw, AlertTriangle, Info,
} from 'lucide-react';
import { runScenario } from '../api/client';
import type { ScenarioRequest, ScenarioResponse } from '../types';
import { SCENARIO_OPTIONS } from '../features/analysis/WhatIfScenarioEngine';

interface WhatIfPanelProps {
  onResult: (result: ScenarioResponse) => void;
  onReset: () => void;
}

const TARGET_SEASONS = [
  { id: 'annual', label: 'Annual' },
  { id: 'monsoon', label: 'Monsoon (JJAS)' },
  { id: 'winter', label: 'Winter (DJF)' },
  { id: 'pre_monsoon', label: 'Pre-Monsoon (MAM)' },
];

export default function WhatIfPanel({ onResult, onReset }: WhatIfPanelProps) {
  const [selectedScenario, setSelectedScenario] = useState<(typeof SCENARIO_OPTIONS)[0]>(SCENARIO_OPTIONS[0]);
  const [magnitude, setMagnitude] = useState(SCENARIO_OPTIONS[0].defaultMagnitude);
  const [targetSeason, setTargetSeason] = useState('annual');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResponse | null>(null);

  const handleScenarioChange = (option: (typeof SCENARIO_OPTIONS)[0]) => {
    setSelectedScenario(option);
    setMagnitude(option.defaultMagnitude);
    setError(null);
    setResult(null);
  };

  const handleRun = async () => {
    setIsLoading(true);
    setError(null);

    const request: ScenarioRequest = {
      scenario_type: selectedScenario.id,
      magnitude,
      target_region: 'full_india',
      target_season: targetSeason,
    };

    try {
      const res = await runScenario(request);
      setResult(res);
      onResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    onReset();
  };

  const magnitudePct = selectedScenario.formatMagnitude(magnitude);

  return (
    <div className="panel p-4 flex flex-col gap-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-foreground font-semibold text-sm tracking-wide">
          What-If Scenarios
        </h2>
        {result && (
          <button
            onClick={handleReset}
            className="btn-ghost flex items-center gap-1 text-xs"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        )}
      </div>

      {/* Scenario type selector */}
      <div className="grid grid-cols-3 gap-1.5">
        {SCENARIO_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleScenarioChange(opt)}
            className={`flex flex-col items-start gap-1 p-2 rounded-lg border transition-all text-left ${
              selectedScenario.id === opt.id
                ? 'border-vayu-blue bg-vayu-blue/20 text-foreground'
                : 'border-foreground/10 bg-foreground/5 text-foreground/60 hover:text-foreground/80 hover:border-foreground/20'
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
          <span className="text-xs text-foreground/50">{selectedScenario.magnitudeLabel}</span>
          <span className="text-sm font-bold text-vayu-accent font-mono">
            {magnitudePct}
          </span>
        </div>
        <input
          type="range"
          min={selectedScenario.magnitudeMin}
          max={selectedScenario.magnitudeMax}
          step={selectedScenario.magnitudeStep}
          value={magnitude}
          onChange={(e) => setMagnitude(Number(e.target.value))}
          className="w-full h-1.5 appearance-none bg-foreground/10 rounded-full cursor-pointer
                     [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-vayu-accent [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <div className="flex justify-between text-xs text-foreground/20">
          <span>{selectedScenario.magnitudeMin}{selectedScenario.unit}</span>
          <span>{selectedScenario.magnitudeMax}{selectedScenario.unit}</span>
        </div>
      </div>

      {/* Target season */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-foreground/50">Target Season</span>
        <div className="grid grid-cols-2 gap-1">
          {TARGET_SEASONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setTargetSeason(s.id)}
              className={`text-xs py-1.5 px-2 rounded-md border transition-colors ${
                targetSeason === s.id
                  ? 'border-vayu-blue bg-vayu-blue/20 text-foreground'
                  : 'border-foreground/10 text-foreground/40 hover:text-foreground/60'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scenario description */}
      <div className="flex gap-2 p-2.5 bg-foreground/5 rounded-lg">
        <Info size={12} className="text-vayu-blue mt-0.5 shrink-0" />
        <p className="text-xs text-foreground/50">{selectedScenario.description}</p>
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={isLoading}
        className="btn-primary flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-foreground/40 border-t-foreground rounded-full animate-spin" />
            <span>Computing…</span>
          </>
        ) : (
          <>
            <Play size={14} />
            <span>Run Scenario</span>
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="flex gap-2 p-2.5 bg-red-500/20 border border-red-500/30 rounded-lg">
          <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div className="flex flex-col gap-2 p-3 bg-vayu-blue/10 border border-vayu-blue/20 rounded-lg">
          <p className="text-xs text-foreground/70 font-medium">Scenario Results</p>
          {Object.entries(result.summary).map(([varName, stats]) => {
            if (typeof stats !== 'object' || !stats) return null;
            const s = stats as { avg_delta: number; avg_pct_change: number; affected_cells: number };
            return (
              <div key={varName} className="flex justify-between items-center">
                <span className="text-xs text-foreground/50 capitalize">
                  {varName.replace('_', ' ')}
                </span>
                <span className={`text-xs font-mono font-bold ${
                  s.avg_delta > 0 ? 'text-vayu-warm' : 'text-vayu-cool'
                }`}>
                  {s.avg_delta > 0 ? '+' : ''}{s.avg_delta.toFixed(2)}
                </span>
              </div>
            );
          })}
          <p className="text-xs text-foreground/30 mt-1">
            {result.hotspots.length} hotspot cells identified
            {result.clamped && ' · Physical bounds applied'}
          </p>
          {result.clamp_message && (
            <p className="text-xs text-yellow-400/70">{result.clamp_message}</p>
          )}
          <p className="text-xs text-foreground/20">
            Computed in {result.computation_time_s.toFixed(1)}s
          </p>
        </div>
      )}
    </div>
  );
}
