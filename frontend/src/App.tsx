import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CloudRain, Thermometer, Activity,
  BarChart2, Database, Layers, BookOpen,
  SplitSquareHorizontal, Mountain, Leaf, Wind,
  Radio, Waves, Download, BarChart, Menu, X, Search, Eye, Map, Moon,
  Plus, Minus,
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import CesiumGlobe from './components/AsyncCesiumGlobe';
import TimeSlider from './components/TimeSlider';
import WhatIfPanel from './components/WhatIfPanel';
import MetricsDashboard from './components/AsyncMetricsDashboard';
import ModelComparisonPanel from './components/ModelComparisonPanel';
import RegionSelector from './components/RegionSelector';
import DataProvenancePanel from './components/DataProvenancePanel';
import ColorLegend from './components/ColorLegend';
import LayerControlPanel from './components/LayerControlPanel';
import LanguageToggle from './components/LanguageToggle';
import type { CesiumGlobeHandle, EarthLayer, TourCameraStep, WindAnimationStyle } from './components/CesiumGlobe';

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
import SivasagarFloodCaseStudy from './features/case-studies/SivasagarFloodCaseStudy';
import IndiaClimateStats from './components/IndiaClimateStats';
import SatelliteDataCard from './components/SatelliteDataCard';
import ClimateRiskScore from './components/ClimateRiskScore';
import IMDAlertBanner from './components/IMDAlertBanner';
import ModelInfoCard from './components/ModelInfoCard';
import { CinematicIntro } from './design-system/CinematicIntro';
import { TabPanelModal } from './design-system/TabPanelModal';
import OfflineModeBadge from './features/platform/OfflineModeBadge';
import HistoricalFloodValidation from './features/model/HistoricalFloodValidation';
import FeaturePanels from './features/FeaturePanels';
import type { FeatureCategory } from './features/FeaturePanels';
import type { ColormapId } from './utils/colorScales';
import { fetchPrediction, fetchHealth } from './api/client';
import { getTimelineSwipeDirection } from './features/platform/mobileGestures';
import { getGlobeViewportInsets } from './features/globe/viewportSafeArea';
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
  selectedDate: new Date(2025, 5, 15), // 15 June 2025 — most recent monsoon season in dataset
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
  { id: 'case-study', label: 'Cases', icon: <BookOpen size={14} /> },
  { id: 'agriculture', label: 'Crops', icon: <Leaf size={14} /> },
  { id: 'environment', label: 'Env',   icon: <Wind size={14} /> },
  { id: 'analysis',    label: 'Analysis', icon: <Mountain size={14} /> },
  { id: 'sectors',     label: 'Sectors', icon: <Waves size={14} /> },
  { id: 'model-lab',   label: 'Model', icon: <BarChart size={14} /> },
  { id: 'collaborate', label: 'Collab', icon: <Radio size={14} /> },
];

/** View modes rendered by features/FeaturePanels.tsx. */
const FEATURE_CATEGORIES: ViewMode[] = ['analysis', 'sectors', 'model-lab', 'collaborate'];

/** View modes that need `activePrediction` loaded. */
const PREDICTION_VIEW_MODES: ViewMode[] = [
  'prediction', 'historical', 'agriculture', 'environment', ...FEATURE_CATEGORIES,
];

// ── App component ─────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [activeLayer, setActiveLayer] = useState<EarthLayer>('satellite');
  // GIBS satellite data has a ~7-day publishing delay — use 10 days ago for guaranteed availability
  const [gibsDate, setGibsDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split('T')[0];
  });

  // ── New feature state ─────────────────────────────────────────────────────
  const [terrainExaggeration, setTerrainExaggeration] = useState(1);
  const [selectedCell, setSelectedCell] = useState<{ cell: GridCell; x: number; y: number } | null>(null);
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState<TourCameraStep | null>(null);
  const [colormap, setColormap] = useState<ColormapId | undefined>(undefined);
  const [show3D, setShow3D] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Focus mode: click empty globe background to hide all chrome; click again
  // (or press Esc, or Cesium's LEFT_CLICK on empty sky) to restore it.
  const [focusMode, setFocusMode] = useState(false);
  const [showWind, setShowWind] = useState(false);
  const [windStyle, setWindStyle] = useState<WindAnimationStyle>('normal');
  const [showTerminator, setShowTerminator] = useState(false);
  const [mapMode, setMapMode] = useState<'3d' | '2d'>('3d');
  // One-time auto-rotate + auto-play-forecast hero moment, right after the
  // cinematic intro. Turns itself off on completion or the first real user
  // interaction with the globe (see CesiumGlobe's heroMode effect).
  const [heroPlaying, setHeroPlaying] = useState(true);
  const [regionFlyTrigger, setRegionFlyTrigger] = useState(0);
  const [inspectMode, setInspectMode] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );
  const [chromeHeights, setChromeHeights] = useState({ header: 56, timeline: 160, mobileDrawer: 0 });
  const globeRef = useRef<CesiumGlobeHandle>(null);
  const headerRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineSwipeStartRef = useRef<{ x: number; y: number } | null>(null);

  // Cesium frames camera flights within its canvas. Measure persistent chrome
  // and shrink that canvas to the unobstructed visual viewport so the globe is
  // centered between header and timeline rather than behind either control.
  useLayoutEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const measure = () => {
      const next = {
        header: Math.ceil(headerRef.current?.getBoundingClientRect().height ?? 56),
        timeline: Math.ceil(timelineRef.current?.getBoundingClientRect().height ?? 160),
        mobileDrawer: !media.matches && drawerOpen
          ? Math.ceil(rightPanelRef.current?.getBoundingClientRect().height ?? 0)
          : 0,
      };
      setChromeHeights((current) =>
        current.header === next.header && current.timeline === next.timeline && current.mobileDrawer === next.mobileDrawer
          ? current
          : next,
      );
    };
    const updateViewportKind = () => {
      setIsDesktopViewport(media.matches);
      measure();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (headerRef.current) observer?.observe(headerRef.current);
    if (timelineRef.current) observer?.observe(timelineRef.current);
    if (rightPanelRef.current) observer?.observe(rightPanelRef.current);
    updateViewportKind();
    window.addEventListener('resize', measure);
    media.addEventListener('change', updateViewportKind);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      media.removeEventListener('change', updateViewportKind);
    };
  }, [drawerOpen]);

  const update = useCallback((patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    setState((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  }, []);

  const handleLayerChange = useCallback((layer: EarthLayer) => {
    setActiveLayer((current) => current === layer ? 'satellite' : layer);
  }, []);

  // ── Scroll right panel to top on viewMode change ─────────────────────────────
  useEffect(() => {
    if (rightPanelRef.current) {
      rightPanelRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [state.viewMode]);

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
    // The feature categories are all driven by grid_cells, so they must trigger the
    // same load. Omitting them renders every panel with an empty cell array, which
    // silently falls through to their internal mock constants.
    if (!PREDICTION_VIEW_MODES.includes(state.viewMode)) return;

    const dateStr = format(state.timeState.selectedDate, 'yyyy-MM-dd');
    update({ isLoading: true, error: null });

    fetchPrediction(dateStr, state.selectedRegion, state.forecastDay)
      .then((pred) => update({ activePrediction: pred, isLoading: false }))
      .catch((err) => update({ error: err.message, isLoading: false }));
  }, [state.timeState.selectedDate, state.viewMode, state.selectedRegion, state.forecastDay]);

  // ── Scenario handler ─────────────────────────────────────────────────────────
  const handleScenarioResult = useCallback((result: ScenarioResponse) => {
    update({ activeScenario: result, showSplitScreen: true });
  }, [update]);

  const handleScenarioReset = useCallback(() => {
    update({ activeScenario: null, showSplitScreen: false });
  }, [update]);

  // ── Keyboard shortcuts (Feature 28) ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't fire when focused in an input or slider
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

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
          setFocusMode(false);
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

  const handleTimelineTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (event.touches.length === 1 && touch) {
      timelineSwipeStartRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, []);

  const handleTimelineTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const start = timelineSwipeStartRef.current;
    const touch = event.changedTouches[0];
    timelineSwipeStartRef.current = null;
    if (!start || !touch) return;

    const direction = getTimelineSwipeDirection(start.x, touch.clientX, start.y, touch.clientY);
    if (direction) {
      update((current) => ({
        timeState: { ...current.timeState, selectedDate: addDays(current.timeState.selectedDate, direction) },
      }));
    }
  }, [update]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const gridCells: GridCell[] = state.activePrediction?.grid_cells ?? [];
  const meanRainfall = gridCells.length > 0
    ? gridCells.reduce((a, c) => a + c.rainfall, 0) / gridCells.length
    : 0;
  const globeViewport = getGlobeViewportInsets({
    headerHeight: chromeHeights.header,
    bottomChromeHeight: chromeHeights.timeline,
    mobileDrawerHeight: chromeHeights.mobileDrawer,
    drawerOpen,
    isDesktop: isDesktopViewport,
    focusMode,
  });
  const globeViewportKey = `${globeViewport.top}:${globeViewport.bottom}:${globeViewport.right}`;

  return (
    <div className="w-full h-screen bg-vayu-dark font-sans">

      {/* ── Cinematic intro sequence (Req 5.3) ── */}
      <CinematicIntro />

      {/* ── Globe: canvas is constrained to the visual safe area, never behind persistent chrome. ── */}
      <div
        className="fixed z-0 transition-[top,right,bottom] duration-300"
        style={{
          top: globeViewport.top,
          right: globeViewport.right,
          bottom: globeViewport.bottom,
          left: 0,
        }}
        data-testid="globe-viewport"
      >
        <GlobeErrorBoundary>
          <CesiumGlobe
            ref={globeRef}
            gridCells={showHeatmap && (state.viewMode === 'prediction' || state.viewMode === 'scenario') ? gridCells : []}
            variable={state.selectedVariable}
            region={state.selectedRegion}
            scenarioData={state.showSplitScreen ? state.activeScenario : null}
            showSplitScreen={state.showSplitScreen}
            activeLayer={activeLayer}
            gibsDate={gibsDate}
            terrainExaggeration={terrainExaggeration}
            tourStep={tourStep}
            onCellClick={inspectMode ? (cell, x, y) => setSelectedCell({ cell, x, y }) : undefined}
            onLongPress={(cell, x, y) => setSelectedCell({ cell, x, y })}
            onBackgroundClick={() => setFocusMode((f) => !f)}
            colormap={colormap}
            show3D={show3D}
            selectedDate={state.timeState.selectedDate}
            showWind={showWind}
            windStyle={windStyle}
            showTerminator={showTerminator}
            mapMode={mapMode}
            heroMode={heroPlaying}
            onHeroDayChange={(d) => update({ forecastDay: d })}
            onHeroComplete={() => setHeroPlaying(false)}
            regionFlyTrigger={regionFlyTrigger}
            viewportKey={globeViewportKey}
          />
        </GlobeErrorBoundary>

        {/* ── Zoom controls — work in both 3D and 2D map mode ── */}
        <div className="absolute top-4 right-4 z-10 flex flex-col rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => globeRef.current?.zoomIn()}
            className="flex items-center justify-center w-8 h-8 transition-colors hover:bg-white/10"
            style={{ background: 'rgba(6,10,22,0.92)', color: 'rgba(255,255,255,0.7)' }}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus size={15} />
          </button>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
          <button
            onClick={() => globeRef.current?.zoomOut()}
            className="flex items-center justify-center w-8 h-8 transition-colors hover:bg-white/10"
            style={{ background: 'rgba(6,10,22,0.92)', color: 'rgba(255,255,255,0.7)' }}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus size={15} />
          </button>
        </div>
      </div>

      {/* ── Extreme event alerts (Feature 21) ── */}
      <ExtremeAlerts gridCells={gridCells} variable={state.selectedVariable} />

      {/* ── Top header bar (z-[1000], floating overlay — Req 29.2) ── */}
      <header
        ref={headerRef}
        className={`fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between px-3 md:px-4 py-2 md:py-3 animate-fade-in transition-opacity duration-300 ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ background: 'rgba(6,10,22,0.92)', borderBottom: '1px solid rgba(255,255,255,0.08)', transform: 'translateZ(0)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-vayu-blue to-cyan-300 flex items-center justify-center text-xs font-bold text-white">☁</div>
          <span className="text-white font-bold text-sm tracking-wide">MAUSAM</span>
          <OfflineModeBadge />
          <span className="text-white/40 text-xs hidden sm:block">Climate Digital Twin</span>
          <span className="text-white/20 text-[10px] hidden md:block">ISRO BAH 2026</span>
        </div>

        <div className="hidden md:block">
          <RegionSelector
            selected={state.selectedRegion}
            onChange={(r: RegionId) => { update({ selectedRegion: r }); setRegionFlyTrigger(n => n + 1); }}
            realDataRegions={health?.real_data_regions}
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(6,10,22,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {health ? (
              <>
                <span className="text-xs text-green-400">● {health.device.toUpperCase()}</span>
                <span className="text-xs text-white/30">v{health.model_version}</span>
              </>
            ) : (
              <span className="text-xs text-red-400">● Offline</span>
            )}
            <div title={drawerOpen ? "Close menu to start tour" : "Start guided tour"}>
              <GuidedTour
                onTourStep={handleTourStep}
                isActive={showTour && !drawerOpen}
                onToggle={() => {
                  if (drawerOpen) return;
                  setShowTour((t) => !t);
                }}
              />
            </div>
          </div>

          {/* Language toggle */}
          <div className="hidden md:block"><LanguageToggle /></div>

          {/* Hamburger button */}
          <button
            onClick={() => setDrawerOpen((d) => !d)}
            className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
            style={{
              background: drawerOpen ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.05)',
              border: drawerOpen ? '1px solid rgba(14,165,233,0.5)' : '1px solid rgba(255,255,255,0.1)',
              color: drawerOpen ? '#0ea5e9' : 'rgba(255,255,255,0.6)',
            }}
            title="Toggle panels"
          >
            {drawerOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </header>

      {/* ── Variable selector left toolbar (z-[1000], floating — Req 29.2) ── */}
      <div className={`fixed left-3 z-[1000] hidden md:flex flex-col gap-1.5 animate-slide-in-left transition-opacity duration-300 ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ top: 72, bottom: 64, justifyContent: 'flex-start', transform: 'translateZ(0)', overflowY: 'auto' }}>
        {VARIABLE_TABS.map(({ id, label, icon, color }) => {
          const isActive = state.selectedVariable === id && showHeatmap;
          return (
          <button
            key={id}
            onClick={() => {
              if (state.selectedVariable === id) {
                // Same variable: toggle heatmap visibility
                setShowHeatmap(prev => !prev);
              } else {
                // Different variable: switch and ensure heatmap is visible
                update({ selectedVariable: id });
                setShowHeatmap(true);
              }
              // Clear scenario overlay when user explicitly picks a variable
              if (state.activeScenario) {
                update({ showSplitScreen: false });
              }
            }}
            title={label}
            className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg text-xs transition-all active:scale-95"
            style={{
              background: 'rgba(6,10,22,0.92)',
              border: isActive ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.08)',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
              boxShadow: isActive ? `0 0 12px ${color}40` : 'none',
              transform: 'translateZ(0)',
            }}
          >
            <span style={{ color: isActive ? color : undefined }}>{icon}</span>
            <span className="font-medium">{label}</span>
          </button>
          );
        })}
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

        {/* 2D / 3D map mode toggle */}
        <button
          onClick={() => setMapMode((m) => (m === '3d' ? '2d' : '3d'))}
          className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg mt-1 transition-all"
          style={{
            background: 'rgba(6,10,22,0.92)',
            border: mapMode === '2d' ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.08)',
            color: mapMode === '2d' ? '#22d3ee' : 'rgba(255,255,255,0.4)',
            boxShadow: mapMode === '2d' ? '0 0 10px rgba(34,211,238,0.3)' : 'none',
          }}
          title={mapMode === '3d' ? 'Switch to 2D map (India)' : 'Switch to 3D globe'}
        >
          <Map size={14} />
          <span className="text-[9px] font-medium">{mapMode === '3d' ? '2D' : '3D Globe'}</span>
        </button>

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

        {/* Wind particle toggle — the GPU wind renderer doesn't draw anything
            in Cesium's 2D orthographic mode, so the control is disabled there
            rather than presenting a switch that silently does nothing. */}
        <button
          onClick={() => mapMode === '3d' && setShowWind((v) => !v)}
          disabled={mapMode === '2d'}
          className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg mt-1 transition-all"
          style={{
            background: 'rgba(6,10,22,0.92)',
            border: showWind && mapMode === '3d' ? '1px solid #0ea5e9' : '1px solid rgba(255,255,255,0.08)',
            color: mapMode === '2d' ? 'rgba(255,255,255,0.15)' : showWind ? '#0ea5e9' : 'rgba(255,255,255,0.3)',
            boxShadow: showWind && mapMode === '3d' ? '0 0 8px rgba(14,165,233,0.25)' : 'none',
            cursor: mapMode === '2d' ? 'not-allowed' : 'pointer',
          }}
          title={mapMode === '2d' ? 'Wind particles are only available in 3D mode' : 'Toggle wind particles'}
        >
          <Wind size={14} />
          <span className="text-[9px] font-medium">Wind</span>
        </button>

        {/* Wind animation style preset — only meaningful while wind is on and visible */}
        {showWind && mapMode === '3d' && (
          <select
            value={windStyle}
            onChange={(e) => setWindStyle(e.target.value as WindAnimationStyle)}
            title="Wind animation style"
            className="mt-1 text-[9px] font-medium rounded-md px-1.5 py-1 outline-none cursor-pointer"
            style={{
              background: 'rgba(6,10,22,0.92)',
              border: '1px solid rgba(14,165,233,0.3)',
              color: '#0ea5e9',
            }}
          >
            <option value="normal">Normal</option>
            <option value="soft">Soft</option>
            <option value="dark">Dark</option>
            <option value="fast">Fast-motion</option>
          </select>
        )}

        {/* Day/night terminator toggle */}
        <button
          onClick={() => setShowTerminator((v) => !v)}
          className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg mt-1 transition-all"
          style={{
            background: 'rgba(6,10,22,0.92)',
            border: showTerminator ? '1px solid #818cf8' : '1px solid rgba(255,255,255,0.08)',
            color: showTerminator ? '#818cf8' : 'rgba(255,255,255,0.3)',
            boxShadow: showTerminator ? '0 0 8px rgba(129,140,248,0.25)' : 'none',
          }}
          title="Toggle day/night terminator"
        >
          <Moon size={14} />
          <span className="text-[9px] font-medium">Terminator</span>
        </button>

        {/* Inspect mode toggle */}
        <button
          onClick={() => setInspectMode((v) => !v)}
          className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg mt-1 transition-all"
          style={{
            background: 'rgba(6,10,22,0.92)',
            border: inspectMode ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.08)',
            color: inspectMode ? '#a855f7' : 'rgba(255,255,255,0.3)',
            boxShadow: inspectMode ? '0 0 8px rgba(168,85,247,0.25)' : 'none',
          }}
          title="Inspect cell data (click globe)"
        >
          <Search size={14} />
          <span className="text-[9px] font-medium">Inspect</span>
        </button>
      </div>

      {/* ── Mobile floating controls — intentionally limited to data, inspect, and menu ── */}
      <div className={`fixed left-3 top-[68px] z-[1000] flex flex-col gap-2 md:hidden transition-opacity duration-300 ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} data-testid="mobile-floating-controls">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full border text-cyan-200 shadow-lg"
          style={{ background: 'rgba(6,10,22,0.9)', borderColor: 'rgba(34,211,238,0.45)' }}
          aria-label="Open climate data sheet"
          title="Data sheet"
        >
          <Layers size={18} />
        </button>
        <button
          type="button"
          onClick={() => setInspectMode((enabled) => !enabled)}
          className="flex h-10 w-10 items-center justify-center rounded-full border shadow-lg"
          style={{ background: 'rgba(6,10,22,0.9)', borderColor: inspectMode ? '#a855f7' : 'rgba(255,255,255,0.2)', color: inspectMode ? '#d8b4fe' : 'rgba(255,255,255,0.75)' }}
          aria-pressed={inspectMode}
          aria-label="Toggle inspect mode; long press any location to inspect"
          title="Inspect; long press on the globe"
        >
          <Search size={18} />
        </button>
        <button
          type="button"
          onClick={() => setDrawerOpen((open) => !open)}
          className="flex h-10 w-10 items-center justify-center rounded-full border text-white/80 shadow-lg"
          style={{ background: 'rgba(6,10,22,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}
          aria-expanded={drawerOpen}
          aria-label="Toggle climate data sheet"
          title="Menu"
        >
          {drawerOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Right Drawer (z-[1000], 300ms ease-out slide, no layout shift — Req 29.2, 29.4, 29.5) ── */}
      {/* Desktop: slides from right. Tablet: narrower. Mobile: bottom sheet */}
      <div
        ref={rightPanelRef}
        className="fixed z-[1000] overflow-y-auto scrollbar-none flex flex-col gap-3 p-3 will-change-transform
          right-0 bottom-0 md:top-[56px]
          w-full md:w-[380px]
          h-[30dvh] max-h-[30dvh] md:h-auto md:max-h-none
          rounded-t-2xl md:rounded-t-none"
        style={{
          background: 'rgba(6,10,22,0.96)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          transform: drawerOpen && !focusMode
            ? 'translateX(0) translateY(0)'
            : 'translateX(0) translateY(100%)',
          transition: 'transform 300ms ease-out, visibility 0ms',
          visibility: drawerOpen && !focusMode ? 'visible' : 'hidden',
          transitionDelay: drawerOpen && !focusMode ? '0ms' : '0ms, 300ms',
        }}
        aria-hidden={!drawerOpen || focusMode}
        data-drawer-state={drawerOpen && !focusMode ? 'open' : 'closed'}
      >
        {/* Desktop right-side slide override (overrides translateY for md+) */}
        <style>{`
          @media (min-width: 768px) {
            [data-drawer-state="closed"] {
              transform: translateX(100%) translateY(0) !important;
            }
            [data-drawer-state="open"] {
              transform: translateX(0) translateY(0) !important;
            }
          }
        `}</style>
          {/* View mode navigation */}
          <div className="panel-tight p-2">
            <div className="grid grid-cols-3 gap-1">
              {VIEW_TABS.map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => update({ viewMode: id })}
                  className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] transition-colors ${
                    state.viewMode === id ? 'bg-vayu-blue text-white font-medium' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  {icon}<span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ISRO Data Sources */}
          <div className="panel-tight p-3">
            <div className="text-[10px] text-white/50 font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Database size={11} /> Data Sources
            </div>
            <div className="flex flex-col gap-1">
              {[
                'IMD Gridded Rainfall (0.25°, 2010–2025)',
                'IMD Temperature (1.0°, 2010–2025)',
                'NCEP/NCAR 850 hPa Wind & Humidity',
                'CHIRPS Satellite Rainfall Validation',
                'GEBCO Elevation & Bathymetry',
                'NASA GIBS Earth Observation Layers',
              ].map((ds) => (
                <div key={ds} className="text-[10px] text-white/40 flex items-center gap-1.5">
                  <span className="text-green-400 text-[9px]">✓</span>{ds}
                </div>
              ))}
            </div>
          </div>

          {/* Layer Control */}
          <div className="panel-tight p-3">
            <LayerControlPanel activeLayer={activeLayer} onLayerChange={handleLayerChange} gibsDate={gibsDate} onDateChange={setGibsDate} />
          </div>

          {/* Predict stays inline in the drawer; every other tab (What-If and
              everything after it) opens as a pop-up instead — see TabPanelModal
              below. */}
          {state.viewMode === 'prediction' && (
            <div className="flex flex-col gap-3">
              <IndiaClimateStats gridCells={gridCells} selectedDate={state.timeState.selectedDate} />
              <IMDAlertBanner gridCells={gridCells} />
              <ClimateRiskScore gridCells={gridCells} variable={state.selectedVariable} />
              <PredictionSummaryPanel gridCells={gridCells} variable={state.selectedVariable} isLoading={state.isLoading} date={state.timeState.selectedDate} region={state.selectedRegion} />
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
        </div>

        <TabPanelModal
          open={state.viewMode !== 'prediction'}
          title={VIEW_TABS.find((t) => t.id === state.viewMode)?.label ?? ''}
          icon={VIEW_TABS.find((t) => t.id === state.viewMode)?.icon}
          onClose={() => update({ viewMode: 'prediction' })}
        >
          {state.viewMode === 'scenario' && (
            <WhatIfPanel onResult={handleScenarioResult} onReset={handleScenarioReset} />
          )}
          {state.viewMode === 'metrics' && (
            <div className="flex flex-col gap-3">
              {/* Model Architecture card */}
              <ModelInfoCard />
              <SatelliteDataCard />
              <MetricsDashboard selectedVariable={state.selectedVariable} onVariableChange={(v) => update({ selectedVariable: v })} />
              <NWPComparisonPanel variable={state.selectedVariable} region={state.selectedRegion} />
              <ModelComparisonPanel variable={state.selectedVariable} region={state.selectedRegion} />
            </div>
          )}
          {state.viewMode === 'historical' && (
            <div className="flex flex-col gap-3">
              <DataProvenancePanel />
              <HistoricalFloodValidation />
            </div>
          )}
          {state.viewMode === 'case-study' && <SivasagarFloodCaseStudy />}
          {state.viewMode === 'agriculture' && (
            <div className="flex flex-col gap-3">
              <AgriculturePanel gridCells={gridCells} />
              <CyclonePanel />
            </div>
          )}
          {FEATURE_CATEGORIES.includes(state.viewMode) && (
            <FeaturePanels
              category={state.viewMode as FeatureCategory}
              gridCells={gridCells}
              region={state.selectedRegion}
              variable={state.selectedVariable}
              forecastDate={format(state.timeState.selectedDate, 'yyyy-MM-dd')}
              forecastDay={state.forecastDay}
            />
          )}
          {state.viewMode === 'environment' && (
            <div className="flex flex-col gap-3">
              <AQIPanel />
              <IoTSensorPanel />
            </div>
          )}
        </TabPanelModal>

      {/* ── Time slider bottom (z-[1000], responsive — Req 29.4) ──
          left offset reserves space for the fixed left toolbar (72px wide +
          12px gap) on desktop so the forecast/legend row never overlaps it;
          on mobile the toolbar is hidden so no offset is needed. ── */}
      <div
        ref={timelineRef}
        className={`fixed z-[1000] flex flex-col gap-1 transition-all duration-300 left-4 md:left-[84px] ${drawerOpen && !focusMode ? 'md:right-[392px]' : 'right-4'} ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{
          transform: 'translateZ(0)',
          paddingBottom: 8,
          // On mobile the drawer is a bottom sheet (30dvh) rather than a
          // right-side panel, so the timeline must lift above it instead of
          // sitting underneath at bottom-0 — otherwise the two overlap.
          bottom: !isDesktopViewport && drawerOpen && !focusMode ? '30dvh' : 0,
        }}
        onTouchStart={handleTimelineTouchStart}
        onTouchEnd={handleTimelineTouchEnd}
        aria-label="Timeline; swipe left or right to change day"
      >
        {state.viewMode === 'prediction' && (
          <div className="flex items-center gap-2 flex-wrap">
            <ForecastAnimation
              currentDay={state.forecastDay ?? 1}
              onDayChange={(d) => update({ forecastDay: d })}
            />
            <ColorLegend variable={state.selectedVariable} />
          </div>
        )}
        <TimeSlider timeState={state.timeState} onChange={(patch) => update((s) => ({ timeState: { ...s.timeState, ...patch } }))} />
      </div>

      {/* ── Focus mode restore affordance — Google-Earth-style "just the globe" ── */}
      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          className="fixed top-3 right-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white/70 hover:text-white transition-all animate-fade-in"
          style={{ background: 'rgba(6,10,22,0.7)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}
          title="Show panels (Esc)"
        >
          <Eye size={14} /> Show panels
        </button>
      )}

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
      {showTour && !drawerOpen && (
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
      {/* ── Simulated data indicator (Req 7.4) ── */}
      {!state.isLoading && !state.error && state.activePrediction?.model_version === 'mock' && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[1001] panel-tight px-3 py-1.5 text-xs text-amber-300/80 border border-amber-500/20 animate-slide-in-up flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 animate-pulse" />
          Simulated data — backend unavailable for this region
        </div>
      )}
      {state.isLoading && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[1001] panel-tight px-4 py-2 flex items-center gap-2 text-xs text-white/60">
          <div className="w-3 h-3 border border-vayu-blue border-t-transparent rounded-full animate-spin" />
          Loading prediction…
        </div>
      )}
      {state.showSplitScreen && state.activeScenario && (
        <div className="fixed top-[64px] left-1/2 -translate-x-1/2 z-[999] flex gap-3">
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
  region,
}: {
  gridCells: GridCell[];
  variable: VariableId;
  isLoading: boolean;
  date: Date;
  region: RegionId;
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
        {gridCells.length} grid cells · {region === 'full_india' ? '0.5°' : '0.25°'} resolution
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
      className="fixed z-[999] panel-tight px-4 py-2 flex items-center gap-3 animate-fade-in pointer-events-none"
      style={{ opacity: 0.7, bottom: 170, left: '38%' }}
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
