import { useCallback, useEffect, useState } from 'react';
import {
  CloudRain, Thermometer, Activity,
  Map, BarChart2, Database, Layers,
  Wifi, WifiOff, SplitSquareHorizontal,
} from 'lucide-react';
import { format } from 'date-fns';
import CesiumGlobe from './components/CesiumGlobe';
import TimeSlider from './components/TimeSlider';
import WhatIfPanel from './components/WhatIfPanel';
import MetricsDashboard from './components/MetricsDashboard';
import ModelComparisonPanel from './components/ModelComparisonPanel';
import RegionSelector from './components/RegionSelector';
import DataProvenancePanel from './components/DataProvenancePanel';
import { fetchPrediction, fetchHealth } from './api/client';
import type {
  AppState, GridCell, HealthResponse, RegionId, ScenarioResponse,
  TimeState, VariableId, ViewMode,
} from './types';

// ── Initial state ──────────────────────────────────────────────────────────────

const INITIAL_TIME_STATE: TimeState = {
  selectedDate: new Date(2024, 5, 1), // 1 June 2024 — active monsoon season
  granularity: 'daily',
  isPlaying: false,
  playbackSpeed: 1,
};

const INITIAL_STATE: AppState = {
  viewMode: 'prediction',
  selectedVariable: 'rainfall',
  selectedRegion: 'western_ghats',
  timeState: INITIAL_TIME_STATE,
  showUncertainty: false,
  showSplitScreen: false,
  activeScenario: null,
  activePrediction: null,
  isLoading: false,
  error: null,
};

// ── Variable tab definitions ──────────────────────────────────────────────────

const VARIABLE_TABS: { id: VariableId; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'rainfall', label: 'Rainfall', icon: <CloudRain size={14} />, color: '#3b82f6' },
  { id: 'temp_max', label: 'Tmax', icon: <Thermometer size={14} />, color: '#ef4444' },
  { id: 'temp_min', label: 'Tmin', icon: <Thermometer size={14} />, color: '#8b5cf6' },
];

const VIEW_TABS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'prediction', label: 'Predict', icon: <Activity size={14} /> },
  { id: 'scenario', label: 'What-If', icon: <Layers size={14} /> },
  { id: 'metrics', label: 'Metrics', icon: <BarChart2 size={14} /> },
  { id: 'historical', label: 'History', icon: <Database size={14} /> },
];

// ── App component ─────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const update = useCallback((patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    setState((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  }, []);

  // ── Health check ────────────────────────────────────────────────────────────
  useEffect(() => {
    const checkHealth = () =>
      fetchHealth()
        .then(setHealth)
        .catch(() => setHealth(null));
    checkHealth();
    const iv = setInterval(checkHealth, 30_000);
    return () => clearInterval(iv);
  }, []);

  // ── Load prediction when date/variable changes ──────────────────────────────
  useEffect(() => {
    if (state.viewMode !== 'prediction' && state.viewMode !== 'historical') return;

    const dateStr = format(state.timeState.selectedDate, 'yyyy-MM-dd');
    update({ isLoading: true, error: null });

    fetchPrediction(dateStr, state.selectedRegion)
      .then((pred) => update({ activePrediction: pred, isLoading: false }))
      .catch((err) => update({ error: err.message, isLoading: false }));
  }, [state.timeState.selectedDate, state.viewMode, state.selectedRegion]);

  // ── Scenario handler ─────────────────────────────────────────────────────────
  const handleScenarioResult = useCallback((result: ScenarioResponse) => {
    update({ activeScenario: result, showSplitScreen: true, viewMode: 'scenario' });
  }, [update]);

  const handleScenarioReset = useCallback(() => {
    update({ activeScenario: null, showSplitScreen: false });
  }, [update]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const gridCells: GridCell[] = state.activePrediction?.grid_cells ?? [];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-vayu-dark font-sans">

      {/* ── Full-screen 3D globe ── */}
      <div className="absolute inset-0">
        <CesiumGlobe
          gridCells={gridCells}
          variable={state.selectedVariable}
          region={state.selectedRegion}
          scenarioData={state.showSplitScreen ? state.activeScenario : null}
          showSplitScreen={state.showSplitScreen}
        />
      </div>

      {/* ── Top bar ── */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3">
        {/* Brand */}
        <div className="panel-tight px-4 py-2 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-vayu-blue to-cyan-300 flex items-center justify-center text-xs font-bold text-white">
            V
          </div>
          <div>
            <span className="text-white font-bold text-sm tracking-wide">VAYU</span>
            <span className="text-white/40 text-xs ml-2">Climate Digital Twin</span>
          </div>
        </div>

        {/* Region selector */}
        <RegionSelector
          selected={state.selectedRegion}
          onChange={(r: RegionId) => update({ selectedRegion: r })}
        />

        {/* View mode tabs */}
        <div className="panel-tight px-1 py-1 flex gap-0.5">
          {VIEW_TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => update({ viewMode: id })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                state.viewMode === id
                  ? 'bg-vayu-blue text-white font-medium'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* System status */}
        <div className="panel-tight px-3 py-2 flex items-center gap-3">
          {health ? (
            <>
              <div className="flex items-center gap-1.5">
                <Wifi size={12} className="text-green-400" />
                <span className="text-xs text-white/60">{health.device.toUpperCase()}</span>
              </div>
              <div className="h-3 w-px bg-white/10" />
              <span className="text-xs text-white/40">v{health.model_version}</span>
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <WifiOff size={12} className="text-red-400" />
              <span className="text-xs text-white/40">Offline</span>
            </div>
          )}
        </div>
      </header>

      {/* ── Variable selector (left side) ── */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2">
        {VARIABLE_TABS.map(({ id, label, icon, color }) => (
          <button
            key={id}
            onClick={() => update({ selectedVariable: id })}
            className={`panel-tight flex flex-col items-center gap-1 px-3 py-2.5 transition-all ${
              state.selectedVariable === id
                ? 'border-opacity-100 text-white'
                : 'text-white/40 hover:text-white/70'
            }`}
            style={
              state.selectedVariable === id
                ? { borderColor: color, boxShadow: `0 0 12px ${color}40` }
                : {}
            }
          >
            <span style={{ color: state.selectedVariable === id ? color : undefined }}>
              {icon}
            </span>
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}

        {/* Split screen toggle */}
        {state.activeScenario && (
          <button
            onClick={() => update((s) => ({ showSplitScreen: !s.showSplitScreen }))}
            className={`panel-tight flex flex-col items-center gap-1 px-3 py-2.5 transition-all mt-2 ${
              state.showSplitScreen ? 'border-vayu-accent text-vayu-accent' : 'text-white/40'
            }`}
          >
            <SplitSquareHorizontal size={14} />
            <span className="text-xs">Split</span>
          </button>
        )}
      </div>

      {/* ── Right panel (context-dependent) ── */}
      <div className="absolute right-4 top-20 bottom-28 z-20 overflow-y-auto scrollbar-none">
        {state.viewMode === 'scenario' && (
          <WhatIfPanel
            onResult={handleScenarioResult}
            onReset={handleScenarioReset}
          />
        )}
        {state.viewMode === 'metrics' && (
          <div className="flex flex-col gap-3">
            <MetricsDashboard
              selectedVariable={state.selectedVariable}
              onVariableChange={(v) => update({ selectedVariable: v })}
            />
            <ModelComparisonPanel
              variable={state.selectedVariable}
              region={state.selectedRegion}
            />
          </div>
        )}
        {state.viewMode === 'historical' && (
          <DataProvenancePanel />
        )}
        {state.viewMode === 'prediction' && (
          <PredictionSummaryPanel
            gridCells={gridCells}
            variable={state.selectedVariable}
            isLoading={state.isLoading}
            date={state.timeState.selectedDate}
          />
        )}
      </div>

      {/* ── Time slider (bottom) ── */}
      <div className="absolute bottom-4 left-24 right-4 z-20">
        <TimeSlider
          timeState={state.timeState}
          onChange={(patch) =>
            update((s) => ({ timeState: { ...s.timeState, ...patch } }))
          }
        />
      </div>

      {/* ── Error toast ── */}
      {state.error && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-30 panel-tight px-4 py-2 text-sm text-red-300 border border-red-500/30">
          ⚠ {state.error}
        </div>
      )}

      {/* ── Loading indicator ── */}
      {state.isLoading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 panel-tight px-4 py-2 flex items-center gap-2 text-xs text-white/60">
          <div className="w-3 h-3 border border-vayu-blue border-t-transparent rounded-full animate-spin" />
          Loading prediction…
        </div>
      )}

      {/* ── Scenario split-screen label ── */}
      {state.showSplitScreen && state.activeScenario && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex gap-4">
          <div className="panel-tight px-3 py-1 text-xs text-white/60">← Baseline</div>
          <div className="panel-tight px-3 py-1 text-xs text-vayu-accent">
            Δ {state.activeScenario.scenario_type.replace('_', ' ')} +{state.activeScenario.magnitude}
          </div>
          <div className="panel-tight px-3 py-1 text-xs text-white/60">Scenario →</div>
        </div>
      )}
    </div>
  );
}

// ── Prediction summary panel (inline) ────────────────────────────────────────

function PredictionSummaryPanel({
  gridCells,
  variable,
  isLoading,
  date,
}: {
  gridCells: GridCell[];
  variable: VariableId;
  isLoading: boolean;
  date: Date;
}) {
  if (isLoading) {
    return (
      <div className="panel p-4 w-64 flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-vayu-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (gridCells.length === 0) return null;

  const values = gridCells.map((c) => c[variable] as number);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const unit = variable === 'rainfall' ? 'mm/day' : '°C';

  return (
    <div className="panel p-4 w-64 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <h3 className="text-white/80 font-medium text-sm">
          {variable === 'rainfall' ? 'Rainfall' : variable === 'temp_max' ? 'Max Temperature' : 'Min Temperature'}
        </h3>
        <span className="text-xs text-white/30">{format(date, 'dd MMM yyyy')}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Mean', val: mean },
          { label: 'Max', val: max },
          { label: 'Min', val: min },
        ].map(({ label, val }) => (
          <div key={label} className="metric-card text-center">
            <span className="metric-label text-center block">{label}</span>
            <span className="text-lg font-bold text-vayu-accent font-mono">
              {val.toFixed(1)}
            </span>
            <span className="text-xs text-white/25">{unit}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-white/30 text-center">
        {gridCells.length} grid cells · 0.25° resolution
      </p>
      <p className="text-xs text-white/20 text-center">
        T+1 to T+7 day forecast
      </p>
    </div>
  );
}
