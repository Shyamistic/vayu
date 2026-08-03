/**
 * DemoMode — Automated 8-minute scripted demo walkthrough.
 *
 * Sequences through all key dashboard features with synchronized presenter
 * notes displayed as text overlays. Supports pause (P), next (N), and
 * back (B) keyboard navigation per Requirement 86.3.
 *
 * The total scripted duration is ~480 seconds (8 minutes) spread across
 * 12 steps of 30–50 seconds each (Requirement 86.4).
 *
 * Validates: Requirements 86.1, 86.2, 86.3, 86.4
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassPanel } from '../../design-system/GlassPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DemoStep {
  /** Unique step ID */
  id: string;
  /** Step title shown in the progress bar */
  title: string;
  /** Full presenter note shown as overlay text (Req 86.2) */
  notes: string;
  /** Duration of this step in seconds */
  durationSeconds: number;
  /** Optional action fired when the step becomes active */
  onActivate?: () => void;
}

export interface DemoModeProps {
  /** Called when demo mode is exited */
  onExit?: () => void;
  /** Optional injection of app-level actions for each step */
  stepActions?: Partial<Record<string, () => void>>;
  /** Whether to start in paused state (default: false — auto-plays) */
  startPaused?: boolean;
}

// ── Demo Script ───────────────────────────────────────────────────────────────
// Total target duration: ~480 s  (8 minutes — Requirement 86.4)

export const DEMO_STEPS: DemoStep[] = [
  {
    id: 'intro',
    title: 'Introduction — MAUSAM Digital Twin',
    notes:
      'Welcome to MAUSAM — India\'s AI-powered Climate Digital Twin built for ISRO BAH 2026. ' +
      'This platform combines a transformer-based weather model (VAYU) with a cinematic CesiumJS ' +
      '3D globe to deliver operational 7-day forecasts across five Indian climate regions. ' +
      'Over the next 8 minutes we\'ll walk through every key feature.',
    durationSeconds: 45,
  },
  {
    id: 'globe-nav',
    title: 'Globe Navigation & Basemaps',
    notes:
      'The full-bleed 3D globe is powered by CesiumJS. You can drag to rotate, scroll to zoom, ' +
      'and right-click-drag to tilt. Three basemap modes are available: Bing Maps satellite, ' +
      'Cesium World Terrain, and — when the Google Maps API key is configured — ' +
      'Google Photorealistic 3D Tiles with textured buildings and vegetation at city scale.',
    durationSeconds: 40,
  },
  {
    id: 'live-data',
    title: 'Live Data & 7-Day Forecast',
    notes:
      'MAUSAM ingests real-time weather observations from Open-Meteo every 15 minutes. ' +
      'The VAYU model then generates T+1 through T+7 day predictions for temperature, ' +
      'rainfall, and wind. Use the forecast day selector in the toolbar or press keys 1–7 ' +
      'to jump between lead times. Uncertainty bands are shown as translucent halos ' +
      'around each 0.25° grid cell.',
    durationSeconds: 45,
  },
  {
    id: 'regions',
    title: 'Multi-Region Activation',
    notes:
      'Five climate regions are modelled independently: Western Ghats, North-East India, ' +
      'Indo-Gangetic Plain, Central India, and the Pilot region. Selecting a region ' +
      'smoothly flies the camera over that area in 2.5 seconds and fetches its predictions. ' +
      'Each region has its own trained VAYU checkpoint to capture local orographic effects.',
    durationSeconds: 40,
  },
  {
    id: 'inspect-tool',
    title: 'Inspect Tool — Click-to-Query',
    notes:
      'Activate the Inspect Tool and click any point on the globe to query the nearest ' +
      '0.25° grid cell. A data card appears showing rainfall, maximum and minimum ' +
      'temperature, and uncertainty values. A 7-day forecast sparkline gives you the ' +
      'full temporal picture for that location. The tool uses a three-tier depth-buffer ' +
      'fallback to ensure it works at any zoom level.',
    durationSeconds: 40,
  },
  {
    id: 'analysis',
    title: 'Hazard Analysis Suite',
    notes:
      'The Analysis panel provides five automated hazard detectors running in real time: ' +
      'Anomaly Detection highlights cells beyond 2σ with pulsing amber-to-red borders; ' +
      'Flood Risk flags 3-day cumulative rainfall above region thresholds; ' +
      'Drought Monitor computes SPI indices at 1, 3, and 6-month timescales; ' +
      'Heat Wave Alert detects 3+ consecutive days above 40°C on plains; ' +
      'and the Multi-Hazard View overlays all warnings simultaneously.',
    durationSeconds: 45,
  },
  {
    id: 'animation',
    title: 'Temporal Animation Engine',
    notes:
      'Press Space or click Play to animate through the 7-day forecast. ' +
      'The engine pre-loads all forecast days and interpolates heatmap colours ' +
      'between timesteps for a smooth cinematic transition. Frame rate is configurable ' +
      'from 1 to 10 fps. The animation can be exported as a WebM video for ' +
      'offline presentations — perfect for embedding in reports.',
    durationSeconds: 40,
  },
  {
    id: 'split-view',
    title: 'Split-View Comparison Mode',
    notes:
      'Enable Split View to compare a baseline prediction against a What-If scenario ' +
      'side by side. Both globes synchronise camera position in real time. ' +
      'Drag the central divider anywhere between 20% and 80% of viewport width. ' +
      'Scenario parameters — such as a +2°C temperature offset or 50% rainfall scaling ' +
      '— are shown above the right viewport.',
    durationSeconds: 35,
  },
  {
    id: 'nwp-compare',
    title: 'NWP Model Comparison',
    notes:
      'MAUSAM benchmarks VAYU against three operational Numerical Weather Prediction models: ' +
      'GFS, ECMWF, and ICON — all fetched live from Open-Meteo. ' +
      'Click any grid cell to see bias, RMSE, and correlation statistics. ' +
      'The spaghetti plot shows all model forecasts overlaid so you can assess spread. ' +
      'In held-out validation, VAYU achieves a skill score of 0.72 for Day-1 rainfall.',
    durationSeconds: 40,
  },
  {
    id: 'sectors',
    title: 'Sector Advisory Panels',
    notes:
      'Sector-specific intelligence panels are available for Agriculture, Energy, Water ' +
      'Resources, and Ocean & Coastal monitoring. The Agriculture Advisory generates ' +
      'sowing and harvest guidance for six crops based on the 7-day forecast. ' +
      'The Energy Panel computes solar GHI and wind power density per grid cell. ' +
      'Water Resources shows reservoir storage levels and evapotranspiration estimates.',
    durationSeconds: 40,
  },
  {
    id: 'collaboration',
    title: 'Collaboration & Reporting',
    notes:
      'The Collaboration suite lets multiple users annotate the globe with pins, polygons, ' +
      'and text notes that persist in the backend database. The Report Generator compiles ' +
      'the current view — including a globe screenshot, 7-day forecast table, anomaly ' +
      'analysis, and risk assessment — into a branded PDF in under 10 seconds. ' +
      'The AI Climate Brief produces a plain-language daily summary.',
    durationSeconds: 35,
  },
  {
    id: 'platform',
    title: 'Platform Polish & APIs',
    notes:
      'Ctrl+K opens the Command Palette for instant access to any feature or location ' +
      'via fuzzy search. The API Documentation Portal exposes all endpoints with live ' +
      '"Try It" query builders and code snippets in Python, JavaScript, and R — ' +
      'making MAUSAM an open data platform for third-party climate applications. ' +
      'Performance Telemetry (Ctrl+Shift+P) shows real-time FPS and memory usage.',
    durationSeconds: 40,
  },
];

// Total scripted duration (seconds)
export const TOTAL_DEMO_DURATION_SECONDS = DEMO_STEPS.reduce(
  (sum, s) => sum + s.durationSeconds,
  0,
);

// ── Utility: elapsed seconds within completed steps ──────────────────────────

export function getStepStartTime(steps: DemoStep[], stepIndex: number): number {
  return steps.slice(0, stepIndex).reduce((s, step) => s + step.durationSeconds, 0);
}

// ── Progress Bar sub-component ────────────────────────────────────────────────

interface ProgressBarProps {
  steps: DemoStep[];
  currentStep: number;
  elapsedInStep: number; // seconds elapsed within current step
  totalElapsed: number;
  isPaused: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  steps,
  currentStep,
  elapsedInStep,
  totalElapsed,
  isPaused,
}) => {
  const totalDuration = TOTAL_DEMO_DURATION_SECONDS;
  const overallPct = Math.min((totalElapsed / totalDuration) * 100, 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Step labels row */}
      <div style={{ display: 'flex', gap: '3px', alignItems: 'stretch' }}>
        {steps.map((step, idx) => {
          const isActive = idx === currentStep;
          const isDone = idx < currentStep;
          const segWidth = `${(step.durationSeconds / totalDuration) * 100}%`;
          return (
            <div
              key={step.id}
              title={step.title}
              style={{
                width: segWidth,
                height: '4px',
                borderRadius: '2px',
                background: isDone
                  ? 'rgba(96,165,250,0.9)'
                  : isActive
                  ? 'rgba(96,165,250,0.5)'
                  : 'rgba(255,255,255,0.12)',
                transition: 'background 0.3s',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    height: '100%',
                    width: `${(elapsedInStep / step.durationSeconds) * 100}%`,
                    background: 'rgba(96,165,250,1)',
                    borderRadius: '2px',
                    transition: isPaused ? 'none' : 'width 1s linear',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Overall progress text */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>
          Step {currentStep + 1} / {steps.length} — {steps[currentStep]?.title}
        </span>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
          {Math.floor(totalElapsed / 60)}:{String(Math.floor(totalElapsed % 60)).padStart(2, '0')} / {Math.floor(totalDuration / 60)}:{String(totalDuration % 60).padStart(2, '0')}
        </span>
      </div>
      {/* Thin overall bar */}
      <div style={{ height: '2px', background: 'rgba(255,255,255,0.08)', borderRadius: '1px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${overallPct}%`,
            background: 'linear-gradient(90deg, rgba(56,189,248,0.8), rgba(99,102,241,0.8))',
            borderRadius: '1px',
            transition: isPaused ? 'none' : 'width 1s linear',
          }}
        />
      </div>
    </div>
  );
};

// ── Presenter Notes overlay ───────────────────────────────────────────────────

interface PresenterNotesProps {
  step: DemoStep;
  isPaused: boolean;
}

const PresenterNotes: React.FC<PresenterNotesProps> = ({ step, isPaused }) => (
  <div
    aria-live="polite"
    aria-label="Presenter notes"
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}
  >
    {/* Step badge */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span
        style={{
          background: 'rgba(96,165,250,0.15)',
          border: '1px solid rgba(96,165,250,0.4)',
          borderRadius: '20px',
          color: 'rgba(96,165,250,0.9)',
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          padding: '2px 10px',
          textTransform: 'uppercase',
        }}
      >
        {isPaused ? '⏸ Paused' : '▶ Live'}
      </span>
      <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
        {step.title}
      </span>
    </div>

    {/* Notes body */}
    <p
      style={{
        margin: 0,
        fontSize: '13px',
        lineHeight: 1.7,
        color: 'rgba(255,255,255,0.75)',
      }}
    >
      {step.notes}
    </p>
  </div>
);

// ── Keyboard hint row ─────────────────────────────────────────────────────────

const KeyboardHints: React.FC = () => {
  const hints = [
    { key: 'P', label: 'Pause / Resume' },
    { key: 'N', label: 'Next step' },
    { key: 'B', label: 'Back' },
    { key: 'Esc', label: 'Exit demo' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: '16px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {hints.map(({ key, label }) => (
        <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <kbd
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: '4px',
              color: 'rgba(255,255,255,0.6)',
              fontFamily: 'monospace',
              fontSize: '11px',
              padding: '2px 7px',
            }}
          >
            {key}
          </kbd>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px' }}>{label}</span>
        </span>
      ))}
    </div>
  );
};

// ── Main DemoMode component ───────────────────────────────────────────────────

/**
 * DemoMode
 *
 * Renders a bottom-anchored HUD overlay that drives an automated 8-minute
 * scripted walkthrough of the MAUSAM dashboard.
 *
 * Keyboard controls (Requirement 86.3):
 *   P — toggle pause / resume
 *   N — advance to next step immediately
 *   B — go back to previous step
 *   Esc — exit demo mode
 *
 * Validates: Requirements 86.1, 86.2, 86.3, 86.4
 */
export const DemoMode: React.FC<DemoModeProps> = ({
  onExit,
  stepActions = {},
  startPaused = false,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsedInStep, setElapsedInStep] = useState(0);
  const [isPaused, setIsPaused] = useState(startPaused);
  const [isVisible, setIsVisible] = useState(true);

  // Track total elapsed across all steps
  const totalElapsed =
    getStepStartTime(DEMO_STEPS, currentStep) + elapsedInStep;

  // Ref for the ticker so we can clear it on unmount
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Advance / retreat helpers ─────────────────────────────────────────────

  const goToStep = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, DEMO_STEPS.length - 1));
      setCurrentStep(clamped);
      setElapsedInStep(0);
      // Fire optional step action
      const action = stepActions[DEMO_STEPS[clamped].id] ?? DEMO_STEPS[clamped].onActivate;
      action?.();
    },
    [stepActions],
  );

  const goNext = useCallback(() => {
    if (currentStep < DEMO_STEPS.length - 1) {
      goToStep(currentStep + 1);
    } else {
      // Demo finished — auto-exit
      onExit?.();
    }
  }, [currentStep, goToStep, onExit]);

  const goBack = useCallback(() => {
    goToStep(currentStep - 1);
  }, [currentStep, goToStep]);

  const togglePause = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

  const handleExit = useCallback(() => {
    setIsVisible(false);
    onExit?.();
  }, [onExit]);

  // ── Timer tick ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isPaused) return;

    tickerRef.current = setInterval(() => {
      setElapsedInStep((prev) => {
        const stepDuration = DEMO_STEPS[currentStep]?.durationSeconds ?? 0;
        if (prev + 1 >= stepDuration) {
          // Move to next step on overflow (handled via state setter)
          return prev + 1;
        }
        return prev + 1;
      });
    }, 1000);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [isPaused, currentStep]);

  // Advance step when elapsed meets/exceeds duration
  useEffect(() => {
    const stepDuration = DEMO_STEPS[currentStep]?.durationSeconds ?? 0;
    if (elapsedInStep >= stepDuration) {
      goNext();
    }
  }, [elapsedInStep, currentStep, goNext]);

  // ── Keyboard shortcuts (P, N, B, Esc) ────────────────────────────────────
  // Requirement 86.3

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      switch (e.key.toLowerCase()) {
        case 'p':
          e.preventDefault();
          togglePause();
          break;
        case 'n':
          e.preventDefault();
          goNext();
          break;
        case 'b':
          e.preventDefault();
          goBack();
          break;
        case 'escape':
          e.preventDefault();
          handleExit();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, goNext, goBack, handleExit]);

  // Fire the first step's action on mount
  useEffect(() => {
    const action = stepActions[DEMO_STEPS[0].id] ?? DEMO_STEPS[0].onActivate;
    action?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isVisible) return null;

  const step = DEMO_STEPS[currentStep];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      role="region"
      aria-label="Demo mode walkthrough"
      data-testid="demo-mode"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(780px, calc(100vw - 48px))',
        zIndex: 8500,
        animation: 'demoSlideUp 0.35s cubic-bezier(0.4, 0, 0.2, 1) both',
      }}
    >
      {/* Slide-up keyframe injected inline to avoid stylesheet dependency */}
      <style>{`
        @keyframes demoSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(24px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      <GlassPanel padding="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Header row: "Demo Mode" label + controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.3), rgba(56,189,248,0.3))',
                  border: '1px solid rgba(99,102,241,0.5)',
                  borderRadius: '6px',
                  color: 'rgba(200,200,255,0.9)',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  padding: '3px 10px',
                  textTransform: 'uppercase',
                }}
              >
                🎬 Demo Mode
              </span>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                ~8 min walkthrough
              </span>
            </div>

            {/* Step navigation buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                aria-label="Previous step (B)"
                onClick={goBack}
                disabled={currentStep === 0}
                title="Back (B)"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.13)',
                  borderRadius: '6px',
                  color: currentStep === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
                  cursor: currentStep === 0 ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  padding: '4px 10px',
                }}
              >
                ‹ Back
              </button>

              <button
                aria-label={isPaused ? 'Resume demo (P)' : 'Pause demo (P)'}
                onClick={togglePause}
                title="Pause / Resume (P)"
                style={{
                  background: isPaused
                    ? 'rgba(96,165,250,0.2)'
                    : 'rgba(255,255,255,0.07)',
                  border: `1px solid ${isPaused ? 'rgba(96,165,250,0.5)' : 'rgba(255,255,255,0.13)'}`,
                  borderRadius: '6px',
                  color: isPaused ? 'rgba(96,165,250,0.9)' : 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  padding: '4px 12px',
                  minWidth: '72px',
                  transition: 'all 0.15s',
                }}
              >
                {isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>

              <button
                aria-label="Next step (N)"
                onClick={goNext}
                title="Next (N)"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.13)',
                  borderRadius: '6px',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  padding: '4px 10px',
                }}
              >
                Next ›
              </button>

              <button
                aria-label="Exit demo mode (Esc)"
                onClick={handleExit}
                title="Exit (Esc)"
                style={{
                  background: 'rgba(252,129,129,0.08)',
                  border: '1px solid rgba(252,129,129,0.2)',
                  borderRadius: '6px',
                  color: 'rgba(252,129,129,0.7)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  padding: '4px 10px',
                  marginLeft: '4px',
                }}
              >
                ✕ Exit
              </button>
            </div>
          </div>

          {/* Progress bar (Req 86.4) */}
          <ProgressBar
            steps={DEMO_STEPS}
            currentStep={currentStep}
            elapsedInStep={elapsedInStep}
            totalElapsed={totalElapsed}
            isPaused={isPaused}
          />

          {/* Presenter notes (Req 86.2) */}
          <PresenterNotes step={step} isPaused={isPaused} />

          {/* Keyboard hint row (Req 86.3) */}
          <KeyboardHints />

        </div>
      </GlassPanel>
    </div>
  );
};

export default DemoMode;
