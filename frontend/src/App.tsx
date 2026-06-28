import { Component, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CloudRain, Thermometer, Activity,
  BarChart2, Database, Layers,
  SplitSquareHorizontal, Mountain, Leaf, Wind,
  Radio, Waves, Download, BarChart,
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import CesiumGlobe from './components/CesiumGlobe';
import TimeSlider from './components/TimeSlider';
import WhatIfPanel from './components/WhatIfPanel';
import MetricsDashboard from './components/MetricsDashboard';
import ModelComparisonPanel from './components/ModelComparisonPanel';
import RegionSelector from './components/RegionSelector';
import DataProvenancePanel from './components/DataProvenancePanel';
import ColorLegend from './components/ColorLegend';
import LayerControlPanel from './components/LayerControlPanel';
import type { EarthLayer, TourCameraStep } from './components/CesiumGlobe';

import ExtremeAlerts from './components/ExtremeAlerts';
import CellInfoCard from './components/CellInfoCard';
import ForecastAnimation from './components/ForecastAnimation';
import TrendSparklines from './components/TrendSparklines';
import GuidedTour, { TOUR_STEPS } from './components/GuidedTour';
import AgriculturePanel from './components/AgriculturePanel';
import MonsoonTracker from './components/MonsoonTracker';
import ColormapSelector from './components/ColormapSelector';
import AQIPanel from './components/AQIPanel';
import CyclonePanel from './components/CyclonePanel';
import DroughtSPIPanel from './components/DroughtSPIPanel';
import FloodRiskPanel from './components/FloodRiskPanel';
import NWPComparisonPanel from './components/NWPComparisonPanel';
import ExportTools from './components/ExportTools';
import IoTSensorPanel from './components/IoTSensorPanel';
import type { ColormapId } from './utils/colorScales';
import { fetchPrediction, fetchHealth } from './api/client';
import type {
  AppState, GridCell, HealthResponse, RegionId, ScenarioResponse,
  TimeState, VariableId, ViewMode,
} from './types';

// ── Globe Error Boundary ──────────────────────────────────────────────────────

class GlobeErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error('[VAYU] CesiumGlobe crashed:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-vayu-dark">
          <div className="text-center">
            <div className="text-4xl mb-3">🌏</div>
            <div className="text-white/60 text-sm">3D Globe unavailable</div>
            <div className="text-white/30 text-xs mt-1">{this.state.error?.message}</div>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-4 px-4 py-2 rounded bg-vayu-blue/30 text-vayu-blue text-xs border border-vayu-blue/40 hover:bg-vayu-blue/50"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  forecastDay: 1,
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
  { id: 'scenario',   label: 'What-If', icon: <Layers size={14} /> },
  { id: 'metrics',    label: 'Metrics', icon: <BarChart2 size={14} /> },
  { id: 'historical', label: 'History', icon: <Database size={14} /> },
  { id: 'agriculture', label: 'Crops', icon: <Leaf size={14} /> },
  { id: 'environment', label: 'Env',   icon: <Wind size={14} /> },
];

// ── App component ─────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [activeLayer, setActiveLayer] = useState<EarthLayer>('satellite');
  // GIBS satellite data has a ~2-day publishing delay — use 2 days ago to avoid HTTP 400s
  const [gibsDate, setGibsDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return d.toISOString().split('T')[0];
  });

  // ── New feature state ─────────────────────────────────────────────────────
  const [terrainExaggeration, setTerrainExaggeration] = useState(1);
  const [selectedCell, setSelectedCell] = useState<{ cell: GridCell; x: number; y: number } | null>(null);
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState<TourCameraStep | null>(null);
  const [colormap, setColormap] = useState<ColormapId | undefined>(undefined);
  const [show3D, setShow3D] = useState(false);

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
    if (state.viewMode !== 'prediction' && state.viewMode !== 'historical' && state.viewMode !== 'agriculture' && state.viewMode !== 'environment') return;

    const dateStr = format(state.timeState.selectedDate, 'yyyy-MM-dd');
    update({ isLoading: true, error: null });

    fetchPrediction(dateStr, state.selectedRegion, state.forecastDay)
      .then((pred) => update({ activePrediction: pred, isLoading: false }))
      .catch((err) => update({ error: err.message, isLoading: false }));
  }, [state.timeState.selectedDate, state.viewMode, state.selectedRegion, state.forecastDay]);

  // ── Scenario handler ─────────────────────────────────────────────────────────
  const handleScenarioResult = useCallback((result: ScenarioResponse) => {
    update({ activeScenario: result, showSplitScreen: true, viewMode: 'scenario' });
  }, [update]);

  const handleScenarioReset = useCallback(() => {
    update({ activeScenario: null, showSplitScreen: false });
  }, [update]);

  // ── Keyboard shortcuts (Feature 28) ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't fire when focused in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case '1': case '2': case '3': case '4': case '5': case '6': case '7':
          update({ forecastDay: parseInt(e.key, 10) });
          break;
        case 'r': case 'R':
          update({ selectedVariable: 'rainfall' });
          break;
        case 't': case 'T':
          update({ selectedVariable: 'temp_max' });
          break;
        case 'm': case 'M':
          update({ selectedVariable: 'temp_min' });
          break;
        case ' ':
          e.preventDefault();
          update((s) => ({ timeState: { ...s.timeState, isPlaying: !s.timeState.isPlaying } }));
          break;
        case 'ArrowLeft':
          update((s) => ({ timeState: { ...s.timeState, selectedDate: addDays(s.timeState.selectedDate, -1) } }));
          break;
        case 'ArrowRight':
          update((s) => ({ timeState: { ...s.timeState, selectedDate: addDays(s.timeState.selectedDate, 1) } }));
          break;
        case 'l': case 'L':
          // Toggle layer panel: cycle through main layers
          setActiveLayer((l) => {
            const layers: EarthLayer[] = ['satellite', 'modis', 'precipitation', 'cloud', 'sst'];
            const idx = layers.indexOf(l);
            return layers[(idx + 1) % layers.length];
          });
          break;
        case 'Escape':
          setSelectedCell(null);
          setShowTour(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update]);

  // ── Tour step handler ────────────────────────────────────────────────────────
  const handleTourStep = useCallback((step: (typeof TOUR_STEPS)[0] | null) => {
    if (!step) { setTourStep(null); return; }
    setTourStep({ lat: step.lat, lon: step.lon, altitude: step.altitude, pitch: step.pitch, duration: step.duration });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  const gridCells: GridCell[] = state.activePrediction?.grid_cells ?? [];
  const meanRainfall = gridCells.length > 0
    ? gridCells.reduce((a, c) => a + c.rainfall, 0) / gridCells.length
    : 0;

  return (
    <div className="w-full h-screen bg-vayu-dark font-sans">

      {/* ── Globe (z-0, behind everything) ── */}
      <div className="fixed inset-0 z-0">
        <GlobeErrorBoundary>
          <CesiumGlobe
            gridCells={gridCells}
            variable={state.selectedVariable}
            region={state.selectedRegion}
            scenarioData={state.showSplitScreen ? state.activeScenario : null}
            showSplitScreen={state.showSplitScreen}
            activeLayer={activeLayer}
            gibsDate={gibsDate}
            terrainExaggeration={terrainExaggeration}
            tourStep={tourStep}
            onCellClick={(cell, x, y) => setSelectedCell({ cell, x, y })}
            colormap={colormap}
            show3D={show3D}
            selectedDate={state.timeState.selectedDate}
          />
        </GlobeErrorBoundary>
      </div>

      {/* ── Extreme event alerts (Feature 21) ── */}
      <ExtremeAlerts gridCells={gridCells} variable={state.selectedVariable} />

      {/* ── Top bar (z-[1000]) ── */}
      <header className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between px-4 py-2 animate-fade-in"
        style={{ background: 'rgba(6,10,22,0.92)', borderBottom: '1px solid rgba(255,255,255,0.08)', transform: 'translateZ(0)' }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-vayu-blue to-cyan-300 flex items-center justify-center text-xs font-bold text-white">V</div>
          <span className="text-white font-bold text-sm tracking-wide">VAYU</span>
          <span className="text-white/40 text-xs">Climate Digital Twin</span>
        </div>

        <RegionSelector
          selected={state.selectedRegion}
          onChange={(r: RegionId) => update({ selectedRegion: r })}
        />

        <div className="flex gap-0.5 px-1 py-1 rounded-lg" style={{ background: 'rgba(6,10,22,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {VIEW_TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => update({ viewMode: id })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                state.viewMode === id ? 'bg-vayu-blue text-white font-medium' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(6,10,22,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {health ? (
            <>
              <span className="text-xs text-green-400">● {health.device.toUpperCase()}</span>
              <span className="text-xs text-white/30">v{health.model_version}</span>
            </>
          ) : (
            <span className="text-xs text-red-400">● Offline</span>
          )}
          {/* Tour button */}
          <GuidedTour
            onTourStep={handleTourStep}
            isActive={showTour}
            onToggle={() => setShowTour((t) => !t)}
          />
        </div>
      </header>

      {/* ── Variable selector left (z-[1000]) ── */}
      <div className="fixed left-4 top-1/2 z-[1000] flex flex-col gap-2 animate-slide-in-left" style={{ transform: 'translateY(-50%) translateZ(0)' }}>
        {VARIABLE_TABS.map(({ id, label, icon, color }) => (
          <button
            key={id}
            onClick={() => update({ selectedVariable: id })}
            className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg text-xs transition-all active:scale-95"
            style={{
              background: 'rgba(6,10,22,0.92)',
              border: state.selectedVariable === id ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.08)',
              color: state.selectedVariable === id ? '#fff' : 'rgba(255,255,255,0.4)',
              boxShadow: state.selectedVariable === id ? `0 0 12px ${color}40` : 'none',
              transform: 'translateZ(0)',
            }}
          >
            <span style={{ color: state.selectedVariable === id ? color : undefined }}>{icon}</span>
            <span className="font-medium">{label}</span>
          </button>
        ))}
        {state.activeScenario && (
          <button
            onClick={() => update((s) => ({ showSplitScreen: !s.showSplitScreen }))}
            className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg text-xs mt-2 transition-all"
            style={{
              background: 'rgba(6,10,22,0.92)',
              border: state.showSplitScreen ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.08)',
              color: state.showSplitScreen ? '#22d3ee' : 'rgba(255,255,255,0.4)',
            }}
          >
            <SplitSquareHorizontal size={14} /><span>Split</span>
          </button>
        )}

        {/* Terrain Exaggeration (Feature 5) */}
        <div
          className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg mt-2 select-none"
          style={{
            background: 'rgba(6,10,22,0.92)',
            border: terrainExaggeration > 1 ? '1px solid #f97316' : '1px solid rgba(255,255,255,0.08)',
            boxShadow: terrainExaggeration > 1 ? '0 0 10px rgba(249,115,22,0.25)' : 'none',
          }}
          title="Orographic Enhancement View"
        >
          <Mountain size={14} style={{ color: terrainExaggeration > 1 ? '#f97316' : 'rgba(255,255,255,0.4)' }} />
          <span className="text-[9px] text-white/40">Terrain</span>
          <input
            type="range"
            min={1}
            max={5}
            step={0.5}
            value={terrainExaggeration}
            onChange={(e) => setTerrainExaggeration(parseFloat(e.target.value))}
            className="w-10 h-0.5 appearance-none cursor-pointer"
            style={{ accentColor: '#f97316' }}
          />
          <span className="text-[9px] font-mono" style={{ color: terrainExaggeration > 1 ? '#f97316' : 'rgba(255,255,255,0.3)' }}>
            {terrainExaggeration}×
          </span>
        </div>

        {/* 3D Rainfall Toggle (Feature 1) */}
        {state.selectedVariable === 'rainfall' && (
          <button
            onClick={() => setShow3D((v) => !v)}
            className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg mt-1 transition-all"
            style={{
              background: 'rgba(6,10,22,0.92)',
              border: show3D ? '1px solid #f97316' : '1px solid rgba(255,255,255,0.08)',
              color: show3D ? '#f97316' : 'rgba(255,255,255,0.4)',
              boxShadow: show3D ? '0 0 10px rgba(249,115,22,0.3)' : 'none',
            }}
            title="3D Extruded Rainfall Columns"
          >
            <span className="text-sm">⬛</span>
            <span className="text-[9px] font-medium">3D</span>
          </button>
        )}
      </div>

      {/* ── Right panel (z-[1000]) ── */}
      <div className="fixed right-3 top-14 bottom-24 z-[1000] overflow-y-auto scrollbar-none flex flex-col gap-3 animate-slide-in-right" style={{ width: 265, transform: 'translateZ(0)' }}>
        <div className="panel-tight p-3">
          <LayerControlPanel activeLayer={activeLayer} onLayerChange={setActiveLayer} gibsDate={gibsDate} onDateChange={setGibsDate} />
        </div>
        {state.viewMode === 'scenario' && (
          <WhatIfPanel onResult={handleScenarioResult} onReset={handleScenarioReset} />
        )}
        {state.viewMode === 'metrics' && (
          <div className="flex flex-col gap-3">
            <MetricsDashboard selectedVariable={state.selectedVariable} onVariableChange={(v) => update({ selectedVariable: v })} />
            <NWPComparisonPanel variable={state.selectedVariable} region={state.selectedRegion} />
            <ModelComparisonPanel variable={state.selectedVariable} region={state.selectedRegion} />
          </div>
        )}
        {state.viewMode === 'historical' && <DataProvenancePanel />}
        {state.viewMode === 'prediction' && (
          <div className="flex flex-col gap-3">
            <PredictionSummaryPanel gridCells={gridCells} variable={state.selectedVariable} isLoading={state.isLoading} date={state.timeState.selectedDate} />
            <TrendSparklines gridCells={gridCells} variable={state.selectedVariable} dateLabel={format(state.timeState.selectedDate, 'dd MMM')} />
            <ColormapSelector
              variable={state.selectedVariable}
              selected={colormap ?? (state.selectedVariable === 'rainfall' ? 'imd_rain' : state.selectedVariable === 'temp_max' ? 'earth_temp' : 'blues')}
              onChange={setColormap}
            />
            <MonsoonTracker selectedDate={state.timeState.selectedDate} meanRainfall={meanRainfall} />
            <FloodRiskPanel gridCells={gridCells} forecastDay={state.forecastDay ?? 1} />
            <DroughtSPIPanel gridCells={gridCells} selectedDate={state.timeState.selectedDate} />
            <ExportTools gridCells={gridCells} variable={state.selectedVariable} selectedDate={state.timeState.selectedDate} region={state.selectedRegion} />
          </div>
        )}
        {state.viewMode === 'agriculture' && (
          <div className="flex flex-col gap-3">
            <AgriculturePanel gridCells={gridCells} />
            <CyclonePanel />
          </div>
        )}
        {state.viewMode === 'environment' && (
          <div className="flex flex-col gap-3">
            <AQIPanel />
            <IoTSensorPanel />
          </div>
        )}
      </div>

      {/* ── Time slider bottom (z-[1000]) ── */}
      <div className="fixed bottom-3 left-20 right-[280px] z-[1000] flex flex-col gap-2" style={{ transform: 'translateZ(0)' }}>
        {state.viewMode === 'prediction' && (
          <div className="flex items-center gap-3 flex-wrap">
            <ForecastAnimation
              currentDay={state.forecastDay ?? 1}
              onDayChange={(d) => update({ forecastDay: d })}
            />
            <ColorLegend variable={state.selectedVariable} />
          </div>
        )}
        <TimeSlider timeState={state.timeState} onChange={(patch) => update((s) => ({ timeState: { ...s.timeState, ...patch } }))} />
      </div>

      {/* ── Cell info card (Feature 25) ── */}
      {selectedCell && (
        <CellInfoCard
          cell={selectedCell.cell}
          variable={state.selectedVariable}
          onClose={() => setSelectedCell(null)}
          style={{
            top: Math.min(selectedCell.y + 12, window.innerHeight - 420),
            left: Math.min(selectedCell.x + 12, window.innerWidth - 240),
          }}
        />
      )}

      {/* ── Guided Tour overlay (Feature 29) ── */}
      {showTour && (
        <GuidedTour
          onTourStep={handleTourStep}
          isActive={showTour}
          onToggle={() => setShowTour(false)}
        />
      )}

      {/* ── Toasts ── */}
      {state.error && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[1001] panel-tight px-4 py-2 text-sm text-red-300 border border-red-500/30 animate-slide-in-up">⚠ {state.error}</div>
      )}
      {state.isLoading && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[1001] panel-tight px-4 py-2 flex items-center gap-2 text-xs text-white/60">
          <div className="w-3 h-3 border border-vayu-blue border-t-transparent rounded-full animate-spin" />
          Loading prediction…
        </div>
      )}
      {state.showSplitScreen && state.activeScenario && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[1000] flex gap-4">
          <div className="panel-tight px-3 py-1 text-xs text-white/60">← Baseline</div>
          <div className="panel-tight px-3 py-1 text-xs text-vayu-accent">Δ {state.activeScenario.scenario_type.replace('_', ' ')} +{state.activeScenario.magnitude}</div>
          <div className="panel-tight px-3 py-1 text-xs text-white/60">Scenario →</div>
        </div>
      )}

      {/* ── Keyboard shortcut hint (dismisses after 8s) ── */}
      <KeyboardHint />
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
      <div className="panel p-4 w-full flex items-center justify-center h-32">
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
    <div className="panel p-4 w-full flex flex-col gap-3">
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
            <span className="text-lg font-bold text-vayu-accent font-mono tabular-nums">
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
        T+1 to T+7 day forecast · Click a cell for details
      </p>
    </div>
  );
}

// ── Keyboard shortcut hint ────────────────────────────────────────────────────

function KeyboardHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-36 left-1/2 -translate-x-1/2 z-[999] panel-tight px-4 py-2 flex items-center gap-3 animate-fade-in pointer-events-none"
      style={{ opacity: 0.7 }}
    >
      <span className="text-[10px] text-white/40">Shortcuts:</span>
      {[
        ['1-7', 'Forecast day'],
        ['R/T/M', 'Variable'],
        ['Space', 'Play/Pause'],
        ['←/→', 'Step date'],
        ['Esc', 'Close'],
      ].map(([key, desc]) => (
        <span key={key} className="flex items-center gap-1 text-[10px] text-white/30">
          <kbd className="px-1 py-0.5 rounded text-[9px] font-mono" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>{key}</kbd>
          <span>{desc}</span>
        </span>
      ))}
    </div>
  );
}
