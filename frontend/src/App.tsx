import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CloudRain, Thermometer, Activity,
  BarChart2, Database, Layers, BookOpen,
  SplitSquareHorizontal, Mountain, Leaf, Wind,
  Radio, Waves, Download, BarChart, X, Search, Eye, Map, Moon, Sun,
  Plus, Minus, Box,
  Cloud, Zap, FileText, Sparkles, ChevronDown,
  ChevronsLeft, ChevronsRight, Ruler, Upload, Globe2, Info,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { format, addDays } from 'date-fns';
import CesiumGlobe from './components/AsyncCesiumGlobe';
import TimeSlider from './components/TimeSlider';
import WhatIfStudio from './features/analysis/WhatIfStudio';
import MetricsDashboard from './components/AsyncMetricsDashboard';
import ModelComparisonPanel from './components/ModelComparisonPanel';
import RegionSelector from './components/RegionSelector';
import DataProvenancePanel from './components/DataProvenancePanel';
import VariableDataPanel from './components/VariableDataPanel';
import LayerControlPanel, { LAYER_OPTIONS } from './components/LayerControlPanel';
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
import { useForecastSeries } from './core/api/useForecastSeries';
import { selectNodeSeries } from './core/api/selectNodeSeries';
import { fetchPrediction, fetchHealth } from './api/client';
import { getTimelineSwipeDirection } from './features/platform/mobileGestures';
import { getGlobeViewportInsets } from './features/globe/viewportSafeArea';
import type {
  AppState, GridCell, HealthResponse, RegionId, ScenarioResponse,
  TimeState, VariableId, ViewMode, WhatIfResponse,
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
            <div className="text-foreground/60 text-sm">3D Globe unavailable</div>
            <div className="text-foreground/30 text-xs mt-1">{this.state.error?.message}</div>
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
  rangeStart: null,
  rangeEnd: null,
};

const INITIAL_STATE: AppState = {
  viewMode: 'prediction',
  selectedVariable: 'rainfall',
  selectedRegion: 'full_india',
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

/**
 * Header workspace nav (redesign phase 1) — groups the 11 existing
 * VIEW_TABS into workspaces from the redesign brief. Nothing new is
 * invented: Reports and Vayu Studio both currently point at the
 * 'collaborate' tab (which houses ReportGenerator/Annotations and
 * AIClimateBrief/NLQueryInterface together — see features/FeaturePanels.tsx),
 * split via `collaborateFocus` so each shows distinct content.
 */
const WORKSPACE_NAV: {
  id: 'forecast' | 'analysis' | 'scenarios' | 'reports' | 'ai-studio';
  label: string;
  icon: LucideIcon;
  isActive: (viewMode: ViewMode) => boolean;
}[] = [
  { id: 'forecast', label: 'Forecast', icon: Cloud, isActive: (v) => v === 'prediction' },
  { id: 'analysis', label: 'Analysis', icon: BarChart2, isActive: (v) =>
      (['analysis', 'sectors', 'environment', 'agriculture', 'case-study', 'metrics', 'model-lab', 'historical'] as ViewMode[]).includes(v) },
  { id: 'scenarios', label: 'Scenarios', icon: Zap, isActive: (v) => v === 'scenario' },
  { id: 'reports', label: 'Reports', icon: FileText, isActive: (v) => v === 'collaborate' },
  // Shares 'collaborate' with Reports for now (see comment above) — only
  // one of the pair shows as active so they don't both light up together.
  { id: 'ai-studio', label: 'Vayu Studio', icon: Sparkles, isActive: () => false },
];

/** "Analysis" dropdown contents — the 8 original view tabs that don't have
 *  their own dedicated header button (Forecast/Scenarios/Reports/Vayu Studio
 *  cover the rest). Before this existed, these 7 (everything but 'analysis'
 *  itself) had no click path from the header at all — real, working screens
 *  with no button left that navigated to them. */
const ANALYSIS_SUBMENU: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'analysis', label: 'Analysis', icon: <Mountain size={14} /> },
  { id: 'sectors', label: 'Sectors', icon: <Waves size={14} /> },
  { id: 'environment', label: 'Environment', icon: <Wind size={14} /> },
  { id: 'agriculture', label: 'Crops', icon: <Leaf size={14} /> },
  { id: 'case-study', label: 'Case Study', icon: <BookOpen size={14} /> },
  { id: 'metrics', label: 'Metrics', icon: <BarChart2 size={14} /> },
  { id: 'model-lab', label: 'Model', icon: <BarChart size={14} /> },
  { id: 'historical', label: 'History', icon: <Database size={14} /> },
];

/** View modes rendered by features/FeaturePanels.tsx. */
const FEATURE_CATEGORIES: ViewMode[] = ['analysis', 'sectors', 'model-lab', 'collaborate'];

/** View modes that need `activePrediction` loaded. */
const PREDICTION_VIEW_MODES: ViewMode[] = [
  'prediction', 'historical', 'agriculture', 'environment', ...FEATURE_CATEGORIES,
];

// ── Left sidebar (redesign phase 2) ─────────────────────────────────────────
// Row-style buttons (icon left, label right, matching the reference) that
// collapse to icon-only when the rail is collapsed — reused by every simple
// toggle item in the sidebar so all ~11 buttons share one visual language.

/** Custom hover tooltip for the collapsed (icon-only) rail. Native `title`
 *  attributes have a long, inconsistent browser delay and don't match the
 *  app's visual language — this shows immediately, styled like the rest of
 *  the UI, so a collapsed icon (e.g. "2D Map") is actually identifiable
 *  without expanding the sidebar. No-ops (renders nothing extra) when the
 *  sidebar is expanded, since the label is already visible inline there. */
function SidebarTooltipWrap({ collapsed, label, children }: { collapsed: boolean; label: string; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {collapsed && hovered && (
        <div
          className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 px-2.5 py-1.5 rounded-md text-[12px] font-medium whitespace-nowrap pointer-events-none"
          style={{
            background: 'rgba(var(--panel-bg-rgb),0.98)',
            border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
            color: 'rgba(var(--fg-rgb),var(--fg-a75))',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function SidebarButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
  accent = '#0ea5e9',
  title,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  accent?: string;
  title?: string;
  collapsed: boolean;
}) {
  return (
    <SidebarTooltipWrap collapsed={collapsed} label={title ?? label}>
      <button
        onClick={onClick}
        disabled={disabled}
        title={title ?? label}
        className={`flex items-center rounded-lg transition-all ${collapsed ? 'justify-center px-2.5 py-2.5' : 'gap-3 px-3 py-2.5 w-full'}`}
        style={{
          background: 'rgba(var(--panel-bg-rgb),0.92)',
          border: active ? `1px solid ${accent}` : '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
          // --fg-a5 doesn't exist in tokens.css (tiers jump a4 -> a6) — using
          // it here silently produced an invalid `color` declaration, which
          // is why inactive labels (e.g. "Forecast" once you'd navigated
          // away from it) were unreadable specifically in light mode.
          color: disabled ? 'rgba(var(--fg-rgb),var(--fg-a15))' : active ? accent : 'rgba(var(--fg-rgb),var(--fg-a4))',
          boxShadow: active ? `0 0 8px ${accent}40` : 'none',
          cursor: disabled ? 'not-allowed' : onClick ? 'pointer' : 'default',
        }}
      >
        <Icon size={16} className="shrink-0" />
        {!collapsed && <span className="text-[13px] font-medium truncate">{label}</span>}
      </button>
    </SidebarTooltipWrap>
  );
}

/** Section heading — collapses to a thin divider so grouping is still
 *  legible (not just a wall of icons) when the rail is collapsed. The
 *  sidebar rail itself has no background (each row draws its own panel
 *  chip against the always-dark 3D-globe backdrop), so this needs its own
 *  chip too — otherwise light-theme text (near-black) renders invisibly
 *  against that dark backdrop instead of against a themed panel. */
function SidebarSectionLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  if (collapsed) {
    return <div className="h-px my-1.5 mx-1" style={{ background: 'rgba(var(--fg-rgb),var(--fg-a08))' }} />;
  }
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 mt-2 mb-0.5 first:mt-0 rounded-md"
      style={{ background: 'rgba(var(--panel-bg-rgb),0.92)', color: 'rgba(var(--fg-rgb),var(--fg-a4))' }}
    >
      {children}
    </div>
  );
}

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
  // Left sidebar — collapsed to an icon-only rail by default and expands on
  // hover (mouse enter/leave on the rail container below), which keeps the
  // globe viewport clear until the user actually reaches for it. The chevron
  // button pins it open (or unpins back to hover-only) for anyone who wants
  // it to stay expanded, or who's on a touch device without hover.
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const sidebarCollapsed = !sidebarPinned && !sidebarHovered;
  const [selectedCell, setSelectedCell] = useState<{ cell: GridCell; x: number; y: number } | null>(null);
  // Light/dark theme — persisted, defaults to 'light'. Still overridable by
  // a saved preference (localStorage) for anyone who already picked 'dark'.
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('vayu-theme') as 'dark' | 'light' | null) ?? 'light'
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('vayu-theme', theme);
  }, [theme]);

  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState<TourCameraStep | null>(null);
  const [colormap, setColormap] = useState<ColormapId | undefined>(undefined);
  // Heatmap layer opacity/pulse-animation — surfaced in VariableDataPanel's
  // VISUALIZATION section, wired straight to CesiumGlobe's imagery layer alpha.
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.78);
  const [heatmapAnimated, setHeatmapAnimated] = useState(true);
  const [variablePanelOpen, setVariablePanelOpen] = useState(true);
  const [variablePanelCollapsed, setVariablePanelCollapsed] = useState(false);
  // The Predict analytics stack (India Climate Summary, Risk Index, Flood/
  // Drought panels, Export, etc.) is real content but a lot of it — hidden
  // by default in the analytics panel, opened on demand via its info-icon
  // toggle rather than shown upfront every time Predict is active.
  const [predictDetailsOpen, setPredictDetailsOpen] = useState(false);
  // The analytics panel itself (Data Sources, Layer Control, Predict
  // details) is now closed by default too — a small floating icon opens it
  // rather than it taking up screen space unasked.
  const [analyticsPanelOpen, setAnalyticsPanelOpen] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  // Which half of the shared 'collaborate' view mode to show — the header's
  // Vayu Studio and Reports buttons both land there (no distinct view modes
  // exist for them), so this is how they end up showing different content
  // instead of being indistinguishable duplicates of each other.
  const [collaborateFocus, setCollaborateFocus] = useState<'ai' | 'reports' | undefined>(undefined);
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
  const analysisMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!analysisMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (analysisMenuRef.current && !analysisMenuRef.current.contains(e.target as Node)) setAnalysisMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [analysisMenuOpen]);
  // Focus mode: click empty globe background to hide all chrome; click again
  // (or press Esc, or Cesium's LEFT_CLICK on empty sky) to restore it.
  const [focusMode, setFocusMode] = useState(false);
  const [showWind, setShowWind] = useState(false);
  const [windStyle, setWindStyle] = useState<WindAnimationStyle>('normal');
  const [showTerminator, setShowTerminator] = useState(false);
  // IoT sensor station pins — hidden by default, opt-in via the toolbar
  // rather than shown automatically whenever the globe is in 3D mode.
  const [showIoT, setShowIoT] = useState(false);
  const [mapMode, setMapMode] = useState<'3d' | '2d'>('3d');
  // Wind, Inspect, and IoT are disabled in 2D (see their button comments
  // below) — force them off on switching to 2D so a state left on from 3D
  // doesn't linger as a control that looks enabled but silently does nothing.
  useEffect(() => {
    if (mapMode === '2d') {
      setShowWind(false);
      setInspectMode(false);
      setShowIoT(false);
    }
  }, [mapMode]);
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
  const analyticsPanelRef = useRef<HTMLDivElement>(null);
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
        mobileDrawer: !media.matches && analyticsPanelOpen
          ? Math.ceil(analyticsPanelRef.current?.getBoundingClientRect().height ?? 0)
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
    if (analyticsPanelRef.current) observer?.observe(analyticsPanelRef.current);
    updateViewportKind();
    window.addEventListener('resize', measure);
    media.addEventListener('change', updateViewportKind);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      media.removeEventListener('change', updateViewportKind);
    };
  }, [analyticsPanelOpen]);

  const update = useCallback((patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    setState((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  }, []);

  const handleLayerChange = useCallback((layer: EarthLayer) => {
    setActiveLayer((current) => current === layer ? 'satellite' : layer);
  }, []);

  // ── Header workspace nav click (see WORKSPACE_NAV) ────────────────────────
  const handleWorkspaceNavClick = useCallback((id: (typeof WORKSPACE_NAV)[number]['id'], viewModeOverride?: ViewMode) => {
    const viewModeFor: Partial<Record<typeof id, ViewMode>> = {
      forecast: 'prediction',
      analysis: 'analysis',
      scenarios: 'scenario',
      reports: 'collaborate',
      'ai-studio': 'collaborate',
    };
    const nextViewMode = viewModeOverride ?? viewModeFor[id];
    if (nextViewMode) update({ viewMode: nextViewMode });
    setCollaborateFocus(id === 'ai-studio' ? 'ai' : id === 'reports' ? 'reports' : undefined);
  }, [update]);

  // ── Scroll right panel to top on viewMode change ─────────────────────────────
  useEffect(() => {
    if (analyticsPanelRef.current) {
      analyticsPanelRef.current.scrollTo({ top: 0, behavior: 'smooth' });
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

  // ── Scenario handlers ────────────────────────────────────────────────────────
  const handleScenarioReset = useCallback(() => {
    update({ activeScenario: null, showSplitScreen: false });
  }, [update]);

  /**
   * Feed a What-If Studio projection into the split-screen globe.
   *
   * The globe already consumes the ScenarioResponse shape, so the empirical
   * before/after field is adapted onto it rather than duplicating the rendering
   * path. Nulls become NaN: the sensitivity grid is land-only, and a missing
   * ocean cell must not render as a real zero-change value.
   */
  const handleWhatIfResult = useCallback((res: WhatIfResponse) => {
    const toNumbers = (arr: (number | null)[] | undefined) =>
      (arr ?? []).map((v) => (v === null ? NaN : v));

    const adapted: ScenarioResponse = {
      scenario_type: 'temperature_offset',
      magnitude: res.delta_predictor ?? 0,
      baseline: { rainfall: toNumbers(res.cell_baseline) },
      scenario: { rainfall: toNumbers(res.cell_scenario) },
      delta: { rainfall: toNumbers(res.cell_delta) },
      hotspots: res.hotspots.map((h) => ({
        node_idx: h.node_idx,
        delta_value: h.delta_value ?? 0,
        percentile_rank: h.percentile_rank,
      })),
      summary: {
        rainfall: {
          avg_delta: res.regional.delta ?? 0,
          max_delta: Math.max(0, ...res.hotspots.map((h) => Math.abs(h.delta_value ?? 0))),
          avg_pct_change: res.regional.delta_percent ?? 0,
          affected_cells: res.distribution.cells_drier + res.distribution.cells_wetter,
        },
      },
      clamped: res.distribution.clamped_cells > 0,
      clamp_message: res.caveats[0],
      computation_time_s: res.computation_time_s,
    };
    update({ activeScenario: adapted, showSplitScreen: true });
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

  // ── Forecast series for the cell inspector ───────────────────────────────────
  // `activePrediction` holds a single lead day, so the cell card had no real
  // T+1..T+7 data and was inventing its sparkline. This fetches the whole series
  // — but only once a cell is actually selected, so the 7 parallel requests are
  // not paid for on load. The query key matches the one FeaturePanels uses, so
  // react-query serves both from one cache entry.
  const forecastSeriesQuery = useForecastSeries({
    date: format(state.timeState.selectedDate, 'yyyy-MM-dd'),
    region: state.selectedRegion,
    enabled: selectedCell !== null,
  });
  const selectedCellSeries = useMemo(
    () => selectNodeSeries(forecastSeriesQuery.data?.daysCells, selectedCell?.cell),
    [forecastSeriesQuery.data, selectedCell],
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  const gridCells: GridCell[] = state.activePrediction?.grid_cells ?? [];
  const meanRainfall = gridCells.length > 0
    ? gridCells.reduce((a, c) => a + c.rainfall, 0) / gridCells.length
    : 0;
  const globeViewport = getGlobeViewportInsets({
    headerHeight: chromeHeights.header,
    bottomChromeHeight: chromeHeights.timeline,
    mobileDrawerHeight: chromeHeights.mobileDrawer,
    drawerOpen: analyticsPanelOpen,
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
            showIoT={showIoT}
            mapMode={mapMode}
            heroMode={heroPlaying}
            onHeroDayChange={(d) => update({ forecastDay: d })}
            onHeroComplete={() => setHeroPlaying(false)}
            regionFlyTrigger={regionFlyTrigger}
            viewportKey={globeViewportKey}
            heatmapOpacity={heatmapOpacity}
            heatmapAnimated={heatmapAnimated}
          />
        </GlobeErrorBoundary>

        {/* ── Zoom controls — work in both 3D and 2D map mode. Bottom-right
            (not top-right) so they never sit under the variable data/legend
            panel, which now floats top-right whenever a forecast variable
            is active. The globe-viewport box's own bottom edge already
            reserves clearance above the timeline (see viewportSafeArea.ts),
            so bottom-4 here doesn't need any extra offset math. ── */}
        <div className="absolute bottom-4 right-4 z-10 flex flex-col rounded-lg overflow-hidden" style={{ border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))' }}>
          <button
            onClick={() => globeRef.current?.zoomIn()}
            className="flex items-center justify-center w-8 h-8 transition-colors hover:bg-foreground/10"
            style={{ background: 'rgba(var(--panel-bg-rgb),0.92)', color: 'rgba(var(--fg-rgb),var(--fg-a7))' }}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus size={15} />
          </button>
          <div style={{ height: 1, background: 'rgba(var(--fg-rgb),var(--fg-a08))' }} />
          <button
            onClick={() => globeRef.current?.zoomOut()}
            className="flex items-center justify-center w-8 h-8 transition-colors hover:bg-foreground/10"
            style={{ background: 'rgba(var(--panel-bg-rgb),0.92)', color: 'rgba(var(--fg-rgb),var(--fg-a7))' }}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus size={15} />
          </button>
        </div>
      </div>

      {/* ── Extreme event alerts (Feature 21) ── */}
      <ExtremeAlerts gridCells={gridCells} variable={state.selectedVariable} />

      {/* ── Top header bar — floating glass card (Ventusky/SpaceX-inspired
          redesign, phase 1). Sits inside a transparent, padded <header> so
          the ResizeObserver in the layout-measurement effect above still
          captures the *total* reserved height (top margin + card), keeping
          the globe/left-toolbar viewport math correct without touching
          viewportSafeArea.ts. ── */}
      <header
        ref={headerRef}
        // z-[1100] — one layer above the left sidebar rail (z-[1000]) so the
        // region dropdown (nested inside the header's own stacking context)
        // isn't painted underneath it; equal z-index + later DOM order was
        // letting the sidebar win the tie and clip the open dropdown.
        className={`fixed top-0 left-0 right-0 z-[1100] px-3 md:px-4 pt-2 md:pt-2.5 pb-0 animate-fade-in transition-opacity duration-300 ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ transform: 'translateZ(0)' }}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 md:px-5 py-2 md:py-2.5 rounded-[20px]"
          style={{
            background: 'rgba(var(--panel-bg-rgb),0.9)',
            border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
            boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {/* Logo block */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-vayu-blue to-cyan-300 flex items-center justify-center text-foreground shrink-0">
              <Cloud size={18} strokeWidth={2.5} />
            </div>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-foreground font-bold text-[17px] tracking-wide">MAUSAM</span>
              <span className="text-foreground/45 text-[12px]">
                Climate Digital Twin <span className="text-foreground/30">· ISRO BAH 2026</span>
              </span>
            </div>
            <OfflineModeBadge />
          </div>

          {/* Workspace navigation — groups the app's existing view tabs into
              the six workspaces from the redesign brief (see WORKSPACE_NAV).
              "Analysis" is a dropdown (see ANALYSIS_SUBMENU) since it's the
              catch-all for every original tab that doesn't have its own
              dedicated button — without it those screens have no click path
              from the header at all. Vayu Studio/Reports use collaborateFocus
              (not isActive's viewMode-only signature) to tell which of the
              two currently-identical-viewMode buttons is "on". */}
          <nav className="hidden lg:flex items-center gap-1">
            {WORKSPACE_NAV.map(({ id, label, icon: Icon, isActive }) => {
              const active =
                id === 'ai-studio' ? state.viewMode === 'collaborate' && collaborateFocus === 'ai' :
                id === 'reports' ? state.viewMode === 'collaborate' && collaborateFocus === 'reports' :
                isActive(state.viewMode);

              if (id === 'analysis') {
                return (
                  <div key={id} ref={analysisMenuRef} className="relative">
                    <button
                      onClick={() => setAnalysisMenuOpen((v) => !v)}
                      className="relative flex items-center gap-1.5 px-3 py-2 text-[15px] font-medium whitespace-nowrap transition-colors"
                      style={{ color: active ? '#0ea5e9' : 'rgba(var(--fg-rgb),var(--fg-a4))' }}
                    >
                      <Icon size={16} />
                      {label}
                      <ChevronDown size={13} className={`transition-transform ${analysisMenuOpen ? 'rotate-180' : ''}`} />
                      {active && (
                        <span className="absolute left-3 right-3 -bottom-[13px] h-[2px] rounded-full" style={{ background: '#0ea5e9' }} />
                      )}
                    </button>
                    {analysisMenuOpen && (
                      <div
                        className="absolute top-full mt-2 left-0 z-50 min-w-[180px] rounded-xl p-1 flex flex-col gap-0.5 shadow-2xl"
                        style={{
                          background: 'rgba(var(--panel-bg-rgb),0.98)',
                          border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
                          backdropFilter: 'blur(16px)',
                          WebkitBackdropFilter: 'blur(16px)',
                        }}
                      >
                        {ANALYSIS_SUBMENU.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => { handleWorkspaceNavClick('analysis', item.id); setAnalysisMenuOpen(false); }}
                            className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                              state.viewMode === item.id ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-foreground/70 hover:bg-foreground/10 hover:text-foreground/90'
                            }`}
                          >
                            {item.icon}
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <button
                  key={id}
                  onClick={() => handleWorkspaceNavClick(id)}
                  className="relative flex items-center gap-1.5 px-3 py-2 text-[15px] font-medium whitespace-nowrap transition-colors"
                  style={{ color: active ? '#0ea5e9' : 'rgba(var(--fg-rgb),var(--fg-a4))' }}
                >
                  <Icon size={16} />
                  {label}
                  {active && (
                    <span
                      className="absolute left-3 right-3 -bottom-[13px] h-[2px] rounded-full"
                      style={{ background: '#0ea5e9' }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Status + settings cluster */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(var(--panel-bg-rgb),0.6)', border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))' }}>
              {health ? (
                <>
                  <span className="text-xs text-green-400">● {health.device.toUpperCase()}</span>
                  <span className="text-xs text-foreground/30">v{health.model_version}</span>
                </>
              ) : (
                <span className="text-xs text-red-400">● Offline</span>
              )}
            </div>

            <div className="hidden md:block" title="Start guided tour">
              <GuidedTour
                onTourStep={handleTourStep}
                isActive={showTour}
                onToggle={() => setShowTour((t) => !t)}
              />
            </div>

            {/* Settings — currently the closest real control we have is
                language; repurposed rather than adding a dead button. */}
            <div className="hidden md:block" title="Language & settings">
              <LanguageToggle />
            </div>

            {/* Light/dark theme toggle */}
            <button
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
              style={{
                background: 'rgba(var(--fg-rgb),var(--fg-a05))',
                border: '1px solid rgba(var(--fg-rgb),var(--fg-a1))',
                color: 'rgba(var(--fg-rgb),var(--fg-a7))',
              }}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* User avatar — decorative for now; no auth system exists yet */}
            <div
              className="hidden md:flex items-center gap-1 pl-1 pr-1.5 py-1 rounded-full cursor-default"
              style={{ background: 'rgba(var(--fg-rgb),var(--fg-a05))', border: '1px solid rgba(var(--fg-rgb),var(--fg-a1))' }}
              title="Guest user"
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-foreground"
                style={{ background: 'rgba(14,165,233,0.35)' }}
              >
                G
              </span>
              <ChevronDown size={13} className="text-foreground/40" />
            </div>

          </div>
        </div>

        {/* Region selector — floats just below the header card rather than
            living inside it (matches the reference layout). Now a compact
            dropdown (its own panel-tight trigger) instead of a row of pill
            buttons, so no outer panel wrapper is needed anymore. */}
        <div className="hidden md:inline-flex mt-1.5 items-center gap-2">
          <RegionSelector
            selected={state.selectedRegion}
            onChange={(r: RegionId) => { update({ selectedRegion: r }); setRegionFlyTrigger(n => n + 1); }}
            realDataRegions={health?.real_data_regions}
          />
          {/* Active base-layer badge — moved here from the globe's bottom-right
              corner, which is now reserved for the zoom controls alone. */}
          {activeLayer !== 'vayu' && (() => {
            const layer = LAYER_OPTIONS.find((o) => o.id === activeLayer);
            if (!layer) return null;
            return (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                style={{ background: 'rgba(var(--panel-bg-rgb),0.9)', border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', color: layer.color }}
              >
                {layer.icon}
                {layer.label}
              </div>
            );
          })()}
        </div>
      </header>

      {/* ── Left sidebar (redesign phase 2) — collapsible rail grouped into
          FORECAST / VISUALIZATION / TOOLS per the reference mockups. Every
          item below is a real, pre-existing feature (VARIABLE_TABS, Split
          View, Terrain, map mode, Columns, Wind, Terminator, IoT, Inspect)
          just regrouped and restyled to icon-left/label-right rows — nothing
          removed. "Measure" isn't an implemented feature yet, so it's shown
          disabled with an honest tooltip (same pattern as Wind/Inspect/IoT
          in 2D mode) rather than either faking it or dropping it from the
          reference layout. "Export" opens the drawer, where ExportTools
          already lives. ── */}
      <div
        className={`fixed left-3 z-[1000] hidden md:flex flex-col gap-1 animate-slide-in-left transition-all duration-200 ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{
          top: chromeHeights.header + 12,
          bottom: chromeHeights.timeline + 12,
          width: sidebarCollapsed ? 56 : 208,
          justifyContent: 'flex-start',
          transform: 'translateZ(0)',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        {/* Pin/unpin toggle — hover already expands the rail, this just
            keeps it expanded when the pointer leaves (or gives touch
            devices, which have no hover, a way to open it at all). */}
        <SidebarTooltipWrap collapsed={sidebarCollapsed} label={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar open'}>
          <button
            onClick={() => setSidebarPinned((v) => !v)}
            title={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar open'}
            className={`flex items-center rounded-lg mb-1 transition-all ${sidebarCollapsed ? 'justify-center px-2.5 py-2' : 'gap-2 px-3 py-2 w-full'}`}
            style={{
              background: sidebarPinned ? 'rgba(14,165,233,0.15)' : 'rgba(var(--panel-bg-rgb),0.92)',
              border: sidebarPinned ? '1px solid rgba(14,165,233,0.4)' : '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
              color: sidebarPinned ? '#38bdf8' : 'rgba(var(--fg-rgb),var(--fg-a4))',
            }}
          >
            {sidebarPinned ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
            {!sidebarCollapsed && <span className="text-[11px] font-medium">{sidebarPinned ? 'Pinned' : 'Pin open'}</span>}
          </button>
        </SidebarTooltipWrap>

        <SidebarSectionLabel collapsed={sidebarCollapsed}>Forecast</SidebarSectionLabel>
        {VARIABLE_TABS.map(({ id, label, icon, color }) => {
          const isActive = state.selectedVariable === id && showHeatmap;
          return (
            <SidebarTooltipWrap key={id} collapsed={sidebarCollapsed} label={label}>
              <button
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
                  // Re-surface the data/legend panel if the user closed it earlier.
                  setVariablePanelOpen(true);
                }}
                title={label}
                className={`flex items-center rounded-lg text-xs transition-all active:scale-95 ${sidebarCollapsed ? 'justify-center px-2.5 py-2.5' : 'gap-3 px-3 py-2.5 w-full'}`}
                style={{
                  background: 'rgba(var(--panel-bg-rgb),0.92)',
                  border: isActive ? `1px solid ${color}` : '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
                  color: isActive ? 'rgb(var(--fg-rgb))' : 'rgba(var(--fg-rgb),var(--fg-a4))',
                  boxShadow: isActive ? `0 0 12px ${color}40` : 'none',
                  transform: 'translateZ(0)',
                }}
              >
                <span className="shrink-0" style={{ color: isActive ? color : undefined }}>{icon}</span>
                {!sidebarCollapsed && <span className="font-medium text-[13px]">{label}</span>}
              </button>
            </SidebarTooltipWrap>
          );
        })}

        <SidebarSectionLabel collapsed={sidebarCollapsed}>Visualization</SidebarSectionLabel>

        <SidebarButton
          icon={Map}
          label="2D Map"
          active={mapMode === '2d'}
          onClick={() => setMapMode('2d')}
          accent="#22d3ee"
          collapsed={sidebarCollapsed}
        />
        <SidebarButton
          icon={Globe2}
          label="3D Globe"
          active={mapMode === '3d'}
          onClick={() => setMapMode('3d')}
          accent="#22d3ee"
          collapsed={sidebarCollapsed}
        />

        {/* Terrain exaggeration — keeps its slider, restyled to the row layout */}
        <SidebarTooltipWrap collapsed={sidebarCollapsed} label={`Terrain — ${terrainExaggeration}× exaggeration`}>
          <div
            className={`flex items-center rounded-lg select-none ${sidebarCollapsed ? 'justify-center px-2.5 py-2.5' : 'gap-2 px-3 py-2.5 w-full'}`}
            style={{
              background: 'rgba(var(--panel-bg-rgb),0.92)',
              border: terrainExaggeration > 1 ? '1px solid #f97316' : '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
              boxShadow: terrainExaggeration > 1 ? '0 0 10px rgba(249,115,22,0.25)' : 'none',
            }}
            title="Orographic Enhancement View"
          >
            <Mountain size={16} className="shrink-0" style={{ color: terrainExaggeration > 1 ? '#f97316' : 'rgba(var(--fg-rgb),var(--fg-a4))' }} />
            {!sidebarCollapsed && (
              <>
                <span className="text-[13px] font-medium text-foreground/45 flex-1">Terrain</span>
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
                <span className="text-[10px] font-mono w-7 text-right" style={{ color: terrainExaggeration > 1 ? '#f97316' : 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
                  {terrainExaggeration}×
                </span>
              </>
            )}
          </div>
        </SidebarTooltipWrap>

        {state.activeScenario && (
          <SidebarButton
            icon={SplitSquareHorizontal}
            label="Split View"
            active={state.showSplitScreen}
            onClick={() => update((s) => ({ showSplitScreen: !s.showSplitScreen }))}
            accent="#22d3ee"
            collapsed={sidebarCollapsed}
          />
        )}

        {/* 3D data-column overlay — extrudes the grid heights by value
            (Rainfall, Tmax, or Tmin). Labeled "Columns" rather than "3D" so
            it reads as distinct from the 2D Map/3D Globe projection toggle
            above, which also involves the word "3D". */}
        <SidebarButton
          icon={Box}
          label="Columns"
          active={show3D}
          onClick={() => setShow3D((v) => !v)}
          accent="#f97316"
          title="Toggle 3D extruded data columns"
          collapsed={sidebarCollapsed}
        />

        {/* Wind particle toggle — disabled in 2D. cesium-wind-layer's GPU
            particle system has multiple layered bugs in its 2D/Columbus View
            path (a coordinate-projection bug and a missing depth-test guard,
            both patched in patches/cesium-wind-layer+*.patch) and even with
            both fixed, particles still don't visibly render in 2D — confirmed
            via live inspection that the layer, its primitives, and scene
            state are all otherwise healthy, so there's a further unresolved
            issue inside the library. Rather than expose a control that
            silently does nothing, disable it in 2D until wind is wired to a
            2D-appropriate renderer (e.g. the entity/billboard-based
            barb/streamline WindLayer in features/globe/layers/WindLayer.ts,
            which isn't a GPU compute primitive and shouldn't hit this class
            of bug). */}
        <SidebarButton
          icon={Wind}
          label="Wind"
          active={showWind && mapMode === '3d'}
          disabled={mapMode === '2d'}
          onClick={() => setShowWind((v) => !v)}
          accent="#0ea5e9"
          title={mapMode === '2d' ? 'Wind particles are only available in 3D mode' : 'Toggle wind particles'}
          collapsed={sidebarCollapsed}
        />

        {/* Wind animation style preset — only meaningful while wind is on and visible */}
        {showWind && mapMode === '3d' && !sidebarCollapsed && (
          <select
            value={windStyle}
            onChange={(e) => setWindStyle(e.target.value as WindAnimationStyle)}
            title="Wind animation style"
            className="text-[11px] font-medium rounded-md px-2 py-1.5 outline-none cursor-pointer ml-1"
            style={{
              background: 'rgba(var(--panel-bg-rgb),0.92)',
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
        <SidebarButton
          icon={Moon}
          label="Terminator"
          active={showTerminator}
          onClick={() => setShowTerminator((v) => !v)}
          accent="#818cf8"
          collapsed={sidebarCollapsed}
        />

        {/* IoT sensor station pins — opt-in, hidden by default (see showIoT
            state comment above); grouped with Wind/Inspect since it's also
            3D-only. */}
        <SidebarButton
          icon={Radio}
          label="IoT"
          active={showIoT && mapMode === '3d'}
          disabled={mapMode === '2d'}
          onClick={() => setShowIoT((v) => !v)}
          accent="#22c55e"
          title={mapMode === '2d' ? 'IoT stations are only available in 3D mode' : 'Toggle IoT sensor station pins'}
          collapsed={sidebarCollapsed}
        />

        <SidebarSectionLabel collapsed={sidebarCollapsed}>Tools</SidebarSectionLabel>

        {/* Inspect mode toggle — disabled in 2D alongside Wind (see comment
            above); grouping known-broken 2D features together rather than
            leaving them silently non-functional. */}
        <SidebarButton
          icon={Search}
          label="Inspect"
          active={inspectMode && mapMode === '3d'}
          disabled={mapMode === '2d'}
          onClick={() => setInspectMode((v) => !v)}
          accent="#a855f7"
          title={mapMode === '2d' ? 'Inspect is only available in 3D mode' : 'Inspect cell data (click globe)'}
          collapsed={sidebarCollapsed}
        />

        {/* Not an implemented feature — shown per the reference layout but
            disabled with an honest tooltip rather than faked or dropped. */}
        <SidebarButton
          icon={Ruler}
          label="Measure"
          disabled
          title="Measure tool — coming soon"
          collapsed={sidebarCollapsed}
        />

        {/* Export tools live in the analytics panel's (collapsed-by-default)
            Predict details section — this switches to Predict and expands
            that section so Export is actually visible, not just reachable. */}
        <SidebarButton
          icon={Upload}
          label="Export"
          onClick={() => { update({ viewMode: 'prediction' }); setPredictDetailsOpen(true); }}
          title="Open export tools"
          collapsed={sidebarCollapsed}
        />
      </div>

      {/* ── Mobile floating controls — the menu/drawer toggle is gone (the
          analytics panel is always visible now, as a bottom sheet on
          mobile); Inspect is the only thing left that needs a floating
          control here. ── */}
      <div className={`fixed left-3 top-[68px] z-[1000] flex flex-col gap-2 md:hidden transition-opacity duration-300 ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} data-testid="mobile-floating-controls">
        <button
          type="button"
          onClick={() => setInspectMode((enabled) => !enabled)}
          className="flex h-10 w-10 items-center justify-center rounded-full border shadow-lg"
          style={{ background: 'rgba(var(--panel-bg-rgb),0.9)', borderColor: inspectMode ? '#a855f7' : 'rgba(var(--fg-rgb),var(--fg-a2))', color: inspectMode ? '#d8b4fe' : 'rgba(var(--fg-rgb),var(--fg-a75))' }}
          aria-pressed={inspectMode}
          aria-label="Toggle inspect mode; long press any location to inspect"
          title="Inspect; long press on the globe"
        >
          <Search size={18} />
        </button>
      </div>

      {/* ── Variable data/legend panel (redesign) — DATA / VISUALIZATION / LEGEND
          card for the active forecast variable, matching the reference mockup.
          The analytics panel is now a floating left panel rather than a
          right-side drawer, so there's no more overlap to avoid here. ── */}
      {state.viewMode === 'prediction' && variablePanelOpen && !focusMode && (
        <div
          className="fixed z-[1000] hidden md:block animate-fade-in"
          style={{ top: chromeHeights.header + 12, right: 12 }}
        >
          <VariableDataPanel
            variable={state.selectedVariable}
            onVariableChange={(v) => { update({ selectedVariable: v }); setShowHeatmap(true); }}
            colormap={colormap}
            defaultColormap={state.selectedVariable === 'rainfall' ? 'imd_rain' : state.selectedVariable === 'temp_max' ? 'sunset' : 'ocean_violet'}
            onColormapChange={setColormap}
            opacity={heatmapOpacity}
            onOpacityChange={setHeatmapOpacity}
            animated={heatmapAnimated}
            onAnimatedChange={setHeatmapAnimated}
            collapsed={variablePanelCollapsed}
            onToggleCollapsed={() => setVariablePanelCollapsed((v) => !v)}
            onClose={() => setVariablePanelOpen(false)}
          />
        </div>
      )}

      {/* ── Analytics panel (formerly the hamburger-menu drawer) — closed by
          default now, opened via the small floating icon below rather than
          taking up screen space unasked. Desktop: a floating translucent
          column on the left, past the sidebar rail, same visual language as
          the sidebar/variable-data panel (doesn't reserve canvas width —
          see viewportSafeArea.ts). Mobile: a bottom sheet, which *does*
          reserve canvas height when open, since floating something this
          dense over a small touch screen would cover too much of the
          interactive globe. The view-mode nav grid that used to live at the
          top of this panel is gone — Forecast/Analysis▾/Scenarios/Reports/
          Vayu Studio in the header now cover the exact same 11 destinations. ── */}
      {!analyticsPanelOpen && !focusMode && (
        <button
          onClick={() => setAnalyticsPanelOpen(true)}
          title="Data sources & layers"
          className="fixed z-[900] flex items-center justify-center w-11 h-11 rounded-full transition-colors hover:bg-foreground/10"
          style={{
            left: 80,
            top: isDesktopViewport ? chromeHeights.header + 12 : undefined,
            bottom: isDesktopViewport ? undefined : 84,
            background: 'rgba(var(--panel-bg-rgb),0.92)',
            border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
            color: 'rgba(var(--fg-rgb),var(--fg-a7))',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          <Info size={18} />
        </button>
      )}
      {analyticsPanelOpen && (
      <div
        ref={analyticsPanelRef}
        // z-[900] — one layer below the left sidebar rail (z-[1000]): on
        // desktop this panel starts right where the sidebar's *collapsed*
        // width ends, so when the sidebar expands on hover it briefly
        // overlaps this panel's left edge. It must lose that overlap (not
        // clip the sidebar's now-visible labels), hence the lower z-index.
        className={`fixed z-[900] overflow-y-auto scrollbar-none flex flex-col gap-3 p-3 transition-opacity duration-300
          left-0 right-0 bottom-0 w-full h-[30dvh] max-h-[30dvh] rounded-t-2xl
          md:left-[80px] md:right-auto md:bottom-auto md:w-[460px] md:h-auto md:max-h-none md:rounded-2xl
          ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{
          background: 'rgba(var(--panel-bg-rgb),0.92)',
          border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          top: isDesktopViewport ? chromeHeights.header + 12 : undefined,
          bottom: isDesktopViewport ? chromeHeights.timeline + 12 : 0,
        }}
      >
          {/* Panel header — close returns to the floating icon */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground/60 uppercase tracking-wide">Data & Layers</span>
            <button onClick={() => setAnalyticsPanelOpen(false)} title="Close" className="text-foreground/40 hover:text-foreground/70">
              <X size={16} />
            </button>
          </div>

          {/* ISRO Data Sources */}
          <div className="panel-tight p-3">
            <div className="text-[10px] text-foreground/50 font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5">
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
                <div key={ds} className="text-[10px] text-foreground/40 flex items-center gap-1.5">
                  <span className="text-green-400 text-[9px]">✓</span>{ds}
                </div>
              ))}
            </div>
          </div>

          {/* Layer Control */}
          <div className="panel-tight p-3">
            <LayerControlPanel activeLayer={activeLayer} onLayerChange={handleLayerChange} gibsDate={gibsDate} onDateChange={setGibsDate} />
          </div>

          {/* Predict stays inline in the analytics panel; every other tab
              (What-If and everything after it) opens as a pop-up instead —
              see TabPanelModal below. Collapsed by default — India Climate
              Summary through Export is a lot of content to show upfront
              every time Predict is active, so it's opt-in via this toggle. */}
          {state.viewMode === 'prediction' && (
            <div className="panel-tight p-3">
              <button
                onClick={() => setPredictDetailsOpen((v) => !v)}
                className="flex items-center gap-2 text-xs font-medium text-foreground/70 hover:text-foreground/90 transition-colors w-full"
              >
                <Info size={14} />
                {predictDetailsOpen ? 'Hide' : 'Show'} Predict details
                <ChevronDown size={13} className={`ml-auto transition-transform ${predictDetailsOpen ? 'rotate-180' : ''}`} />
              </button>
              {predictDetailsOpen && (
                <div className="flex flex-col gap-3 mt-3">
                  <IndiaClimateStats gridCells={gridCells} selectedDate={state.timeState.selectedDate} />
                  <IMDAlertBanner gridCells={gridCells} />
                  <ClimateRiskScore gridCells={gridCells} variable={state.selectedVariable} />
                  <PredictionSummaryPanel gridCells={gridCells} variable={state.selectedVariable} isLoading={state.isLoading} date={state.timeState.selectedDate} region={state.selectedRegion} />
                  <TrendSparklines gridCells={gridCells} variable={state.selectedVariable} dateLabel={format(state.timeState.selectedDate, 'dd MMM')} />
                  <ColormapSelector
                    variable={state.selectedVariable}
                    selected={colormap ?? (state.selectedVariable === 'rainfall' ? 'imd_rain' : state.selectedVariable === 'temp_max' ? 'sunset' : 'ocean_violet')}
                    onChange={setColormap}
                  />
                  <MonsoonTracker selectedDate={state.timeState.selectedDate} meanRainfall={meanRainfall} />
                  <FloodRiskPanel gridCells={gridCells} forecastDay={state.forecastDay ?? 1} />
                  <DroughtSPIPanel gridCells={gridCells} selectedDate={state.timeState.selectedDate} />
                  <ExportTools gridCells={gridCells} variable={state.selectedVariable} selectedDate={state.timeState.selectedDate} region={state.selectedRegion} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

        <TabPanelModal
          open={state.viewMode !== 'prediction'}
          title={
            state.viewMode === 'collaborate'
              ? (collaborateFocus === 'ai' ? 'Vayu Studio' : collaborateFocus === 'reports' ? 'Reports' : 'Collab')
              : VIEW_TABS.find((t) => t.id === state.viewMode)?.label ?? ''
          }
          icon={VIEW_TABS.find((t) => t.id === state.viewMode)?.icon}
          onClose={() => update({ viewMode: 'prediction' })}
        >
          {state.viewMode === 'scenario' && (
            <WhatIfStudio
              initialRegion={state.selectedRegion}
              // Coverage is a runtime fact, so the studio's region control is
              // driven by what the backend actually has bundles for rather than
              // by a hardcoded list that can go stale.
              availableRegions={health?.real_data_regions}
              onResult={handleWhatIfResult}
              onReset={handleScenarioReset}
            />
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
              collaborateFocus={state.viewMode === 'collaborate' ? collaborateFocus : undefined}
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
        className={`fixed z-[1000] flex flex-col gap-1 transition-all duration-300 left-4 md:left-[84px] right-4 ${focusMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{
          transform: 'translateZ(0)',
          paddingBottom: 8,
          // On mobile the drawer is a bottom sheet (30dvh) rather than a
          // right-side panel, so the timeline must lift above it instead of
          // sitting underneath at bottom-0 — otherwise the two overlap.
          bottom: !isDesktopViewport && analyticsPanelOpen && !focusMode ? '30dvh' : 0,
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
          </div>
        )}
        <TimeSlider timeState={state.timeState} onChange={(patch) => update((s) => ({ timeState: { ...s.timeState, ...patch } }))} />
      </div>

      {/* ── Focus mode restore affordance — Google-Earth-style "just the globe" ── */}
      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          className="fixed top-3 right-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/70 hover:text-foreground transition-all animate-fade-in"
          style={{ background: 'rgba(var(--panel-bg-rgb),0.7)', border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))', backdropFilter: 'blur(8px)' }}
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
          forecastCells={selectedCellSeries.cells}
          forecastPending={forecastSeriesQuery.isPending || forecastSeriesQuery.isFetching}
          forecastIsMock={forecastSeriesQuery.data?.containsMock ?? false}
          modelVersion={state.activePrediction?.model_version}
          inputDataTimestamp={state.activePrediction?.input_data_timestamp}
          cached={state.activePrediction?.cached}
          onClose={() => setSelectedCell(null)}
          style={{
            top: Math.min(selectedCell.y + 12, window.innerHeight - 460),
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
      {/* ── Simulated data indicator (Req 7.4) ── */}
      {!state.isLoading && !state.error && state.activePrediction?.model_version === 'mock' && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[1001] panel-tight px-3 py-1.5 text-xs text-amber-300/80 border border-amber-500/20 animate-slide-in-up flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 animate-pulse" />
          Simulated data — backend unavailable for this region
        </div>
      )}
      {state.isLoading && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[1001] panel-tight px-4 py-2 flex items-center gap-2 text-xs text-foreground/60">
          <div className="w-3 h-3 border border-vayu-blue border-t-transparent rounded-full animate-spin" />
          Loading prediction…
        </div>
      )}
      {state.showSplitScreen && state.activeScenario && (
        <div className="fixed top-[64px] left-1/2 -translate-x-1/2 z-[999] flex gap-3">
          <div className="panel-tight px-3 py-1 text-xs text-foreground/60">← Baseline</div>
          <div className="panel-tight px-3 py-1 text-xs text-vayu-accent">Δ {state.activeScenario.scenario_type.replace('_', ' ')} +{state.activeScenario.magnitude}</div>
          <div className="panel-tight px-3 py-1 text-xs text-foreground/60">Scenario →</div>
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
        <h3 className="text-foreground/80 font-medium text-sm">
          {variable === 'rainfall' ? 'Rainfall' : variable === 'temp_max' ? 'Max Temperature' : 'Min Temperature'}
        </h3>
        <span className="text-xs text-foreground/30">{format(date, 'dd MMM yyyy')}</span>
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
            <span className="text-xs text-foreground/25">{unit}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-foreground/30 text-center">
        {gridCells.length} grid cells · {region === 'full_india' ? '0.5°' : '0.25°'} resolution
      </p>
      <p className="text-xs text-foreground/20 text-center">
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
      <span className="text-[10px] text-foreground/40">Shortcuts:</span>
      {[
        ['1-7', 'Forecast day'],
        ['R/T/M', 'Variable'],
        ['Space', 'Play/Pause'],
        ['←/→', 'Step date'],
        ['Esc', 'Close'],
      ].map(([key, desc]) => (
        <span key={key} className="flex items-center gap-1 text-[10px] text-foreground/30">
          <kbd className="px-1 py-0.5 rounded text-[9px] font-mono" style={{ background: 'rgba(var(--fg-rgb),var(--fg-a08))', border: '1px solid rgba(var(--fg-rgb),var(--fg-a15))' }}>{key}</kbd>
          <span>{desc}</span>
        </span>
      ))}
    </div>
  );
}
