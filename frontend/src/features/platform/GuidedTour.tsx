/**
 * GuidedTour — Sequential onboarding tour for the MAUSAM Climate Digital Twin.
 *
 * - 8+ tour stops covering all major features
 * - Spotlight overlay with spotlight cutout over the target element
 * - Explanatory tooltip with step counter and navigation (Back, Next, Skip)
 * - Auto-starts on first visit via localStorage detection
 * - Restart option available at any time
 *
 * Validates: Requirements 31.1, 31.2, 31.3, 31.4
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassPanel } from '../../design-system/GlassPanel';
import { useUIStore } from '../../core/state/uiStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOUR_COMPLETED_KEY = 'mausam_tour_completed_v1';
const TOUR_TOTAL_STEPS = 8;

// ─── Tour stop definitions ────────────────────────────────────────────────────

export interface TourStop {
  /** CSS selector (or null for center-screen overlay with no spotlight) */
  targetSelector: string | null;
  /** Heading shown in the tooltip */
  title: string;
  /** Body text shown in the tooltip */
  description: string;
  /** Preferred tooltip placement relative to the spotlight */
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Optional icon (emoji or short text) decorating the tooltip header */
  icon: string;
}

const TOUR_STOPS: TourStop[] = [
  {
    targetSelector: null,
    title: 'Welcome to MAUSAM',
    description:
      'MAUSAM is a cinematic AI-powered climate digital twin for India. This short tour will walk you through the key features. You can skip or restart it at any time.',
    placement: 'center',
    icon: '🌏',
  },
  {
    targetSelector: '[data-tour="globe"]',
    title: 'Interactive Globe Navigation',
    description:
      'Drag to rotate, scroll to zoom, and right-click-drag to tilt the globe. Double-click any location to fly there. Use the Region Selector to instantly jump to a predefined climate zone.',
    placement: 'right',
    icon: '🌐',
  },
  {
    targetSelector: '[data-tour="variable-selector"]',
    title: 'Climate Variables',
    description:
      'Switch between Rainfall, Max Temperature, Min Temperature, and more. The globe heatmap updates instantly with the correct colour scale and legend.',
    placement: 'right',
    icon: '🌡️',
  },
  {
    targetSelector: '[data-tour="animation-controls"]',
    title: 'Temporal Animation',
    description:
      'Press Play to animate through the 7-day AI forecast. Adjust playback speed (1–10 fps) and watch how weather systems evolve. The progress bar shows the current timestep.',
    placement: 'top',
    icon: '▶️',
  },
  {
    targetSelector: '[data-tour="scenario-panel"]',
    title: 'What-If Scenarios',
    description:
      'Perturb temperature (+1°C–+5°C) or rainfall (−50%–+100%) to explore climate sensitivity. The split-view mode lets you compare the baseline against your scenario side-by-side.',
    placement: 'left',
    icon: '⚗️',
  },
  {
    targetSelector: '[data-tour="inspect-tool"]',
    title: 'Inspect Tool',
    description:
      'Click the crosshair icon then click any grid cell on the globe to get a detailed data card — all climate variables, uncertainty bounds, and a 7-day sparkline for that exact location.',
    placement: 'right',
    icon: '🔍',
  },
  {
    targetSelector: '[data-tour="export-tools"]',
    title: 'Export and Share',
    description:
      'Download the current view as a high-resolution PNG, export grid data as CSV or GeoTIFF, record the animation as WebM video, or copy a shareable URL that encodes the exact view state.',
    placement: 'left',
    icon: '📤',
  },
  {
    targetSelector: '[data-tour="layer-panel"]',
    title: 'Layer Controls',
    description:
      'Toggle contour lines, wind particles, INSAT satellite imagery, volumetric clouds, cyclone tracks, and more. Each layer can be individually configured via the panel on the right.',
    placement: 'left',
    icon: '🗂️',
  },
  {
    targetSelector: '[data-tour="analysis-panel"]',
    title: 'Analysis Suite',
    description:
      'Open the Analysis drawer to access Anomaly Detection, Flood Risk, Drought Monitoring, Heat Wave Alerts, Air Quality, and the composite Climate Risk Score dashboard.',
    placement: 'left',
    icon: '📊',
  },
];

// ─── Spotlight geometry helper ────────────────────────────────────────────────

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 12; // px around the target element

function getElementRect(selector: string): SpotlightRect | null {
  try {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top - PADDING,
      left: rect.left - PADDING,
      width: rect.width + PADDING * 2,
      height: rect.height + PADDING * 2,
    };
  } catch {
    return null;
  }
}

// ─── Tooltip positioning ──────────────────────────────────────────────────────

interface TooltipPosition {
  top?: number | string;
  bottom?: number | string;
  left?: number | string;
  right?: number | string;
  transform?: string;
}

function computeTooltipPosition(
  spotlight: SpotlightRect | null,
  placement: TourStop['placement'],
  tooltipWidth: number,
): TooltipPosition {
  if (!spotlight || placement === 'center') {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const gap = 16; // px between spotlight and tooltip

  switch (placement) {
    case 'right':
      return {
        top: spotlight.top + spotlight.height / 2,
        left: spotlight.left + spotlight.width + gap,
        transform: 'translateY(-50%)',
      };
    case 'left':
      return {
        top: spotlight.top + spotlight.height / 2,
        left: spotlight.left - tooltipWidth - gap,
        transform: 'translateY(-50%)',
      };
    case 'bottom':
      return {
        top: spotlight.top + spotlight.height + gap,
        left: spotlight.left + spotlight.width / 2,
        transform: 'translateX(-50%)',
      };
    case 'top':
    default:
      return {
        top: spotlight.top - gap,
        left: spotlight.left + spotlight.width / 2,
        transform: 'translate(-50%, -100%)',
      };
  }
}

// ─── SVG Spotlight Overlay ────────────────────────────────────────────────────

interface SpotlightOverlayProps {
  rect: SpotlightRect | null;
  onClick: () => void;
}

const SpotlightOverlay: React.FC<SpotlightOverlayProps> = ({ rect, onClick }) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!rect) {
    // Full dim overlay for center-placement stops
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.72)',
          zIndex: 9000,
          cursor: 'default',
        }}
        onClick={onClick}
        aria-hidden="true"
      />
    );
  }

  // SVG with a rectangular "hole" cut out over the target element
  const { top, left, width, height } = rect;
  const r = 8; // border-radius of the cutout

  const clipPath = `M0,0 H${vw} V${vh} H0 Z
    M${left + r},${top}
    H${left + width - r}
    Q${left + width},${top} ${left + width},${top + r}
    V${top + height - r}
    Q${left + width},${top + height} ${left + width - r},${top + height}
    H${left + r}
    Q${left},${top + height} ${left},${top + height - r}
    V${top + r}
    Q${left},${top} ${left + r},${top}
    Z`;

  return (
    <svg
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9000,
        cursor: 'default',
        pointerEvents: 'none',
      }}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={clipPath} fill="rgba(0,0,0,0.72)" fillRule="evenodd" />
      {/* Highlight border around cutout */}
      <rect
        x={left}
        y={top}
        width={width}
        height={height}
        rx={r}
        ry={r}
        fill="none"
        stroke="rgba(56, 189, 248, 0.8)"
        strokeWidth="2"
        style={{ filter: 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.6))' }}
      />
    </svg>
  );
};

// ─── Progress Dots ────────────────────────────────────────────────────────────

const ProgressDots: React.FC<{ total: number; current: number }> = ({ total, current }) => (
  <div
    style={{
      display: 'flex',
      gap: '6px',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '12px 0 0',
    }}
    role="tablist"
    aria-label="Tour progress"
  >
    {Array.from({ length: total }, (_, i) => (
      <div
        key={i}
        role="tab"
        aria-selected={i === current}
        aria-label={`Step ${i + 1}`}
        style={{
          width: i === current ? 20 : 8,
          height: 8,
          borderRadius: 4,
          background:
            i === current
              ? 'rgba(56, 189, 248, 1)'
              : i < current
                ? 'rgba(56, 189, 248, 0.45)'
                : 'rgba(255, 255, 255, 0.18)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    ))}
  </div>
);

// ─── Tooltip Card ─────────────────────────────────────────────────────────────

interface TourTooltipProps {
  stop: TourStop;
  stepIndex: number;
  totalSteps: number;
  position: TooltipPosition;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  isFirst: boolean;
  isLast: boolean;
  tooltipRef: React.Ref<HTMLDivElement>;
}

const TourTooltip: React.FC<TourTooltipProps> = ({
  stop,
  stepIndex,
  totalSteps,
  position,
  onBack,
  onNext,
  onSkip,
  isFirst,
  isLast,
  tooltipRef,
}) => {
  const buttonBase: React.CSSProperties = {
    padding: '8px 18px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return (
    <div
      ref={tooltipRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Tour step ${stepIndex + 1}: ${stop.title}`}
      style={{
        position: 'fixed',
        zIndex: 9100,
        width: 320,
        maxWidth: 'calc(100vw - 32px)',
        ...position,
        animation: 'tourTooltipIn 0.22s cubic-bezier(0.4, 0, 0.2, 1) both',
      }}
    >
      <GlassPanel padding="lg">
        {/* Step counter */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'rgba(56, 189, 248, 0.9)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Step {stepIndex + 1} of {totalSteps}
          </span>
          <button
            onClick={onSkip}
            aria-label="Skip guided tour"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.4)',
              fontSize: '18px',
              lineHeight: 1,
              padding: '0 2px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.85)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)')
            }
          >
            ✕
          </button>
        </div>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '8px',
          }}
        >
          <span style={{ fontSize: '22px', lineHeight: 1 }} aria-hidden="true">
            {stop.icon}
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.95)',
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.3,
            }}
          >
            {stop.title}
          </h3>
        </div>

        {/* Description */}
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            lineHeight: 1.6,
            color: 'rgba(255, 255, 255, 0.72)',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {stop.description}
        </p>

        {/* Progress dots */}
        <ProgressDots total={totalSteps} current={stepIndex} />

        {/* Navigation buttons */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginTop: '14px',
            justifyContent: 'flex-end',
          }}
        >
          {!isFirst && (
            <button
              onClick={onBack}
              aria-label="Previous tour step"
              style={{
                ...buttonBase,
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'rgba(255, 255, 255, 0.75)',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(255,255,255,0.14)')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(255,255,255,0.08)')
              }
            >
              ← Back
            </button>
          )}

          <button
            onClick={onSkip}
            aria-label="Skip tour"
            style={{
              ...buttonBase,
              background: 'transparent',
              color: 'rgba(255,255,255,0.4)',
              padding: '8px 10px',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)')
            }
          >
            {isLast ? 'Close' : 'Skip'}
          </button>

          <button
            onClick={onNext}
            aria-label={isLast ? 'Finish tour' : 'Next tour step'}
            style={{
              ...buttonBase,
              background: 'rgba(56, 189, 248, 0.9)',
              color: '#000',
              marginLeft: 'auto',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                'rgba(56, 189, 248, 1)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                'rgba(56, 189, 248, 0.9)')
            }
          >
            {isLast ? 'Finish 🎉' : 'Next →'}
          </button>
        </div>
      </GlassPanel>
    </div>
  );
};

// ─── Main GuidedTour component ────────────────────────────────────────────────

export interface GuidedTourProps {
  /** Override the default stops list (useful for testing) */
  stops?: TourStop[];
}

export const GuidedTour: React.FC<GuidedTourProps> = ({ stops = TOUR_STOPS }) => {
  const { showTour, tourStepIndex, setShowTour, setTourStepIndex } = useUIStore();

  const totalSteps = stops.length;
  const currentStop = stops[tourStepIndex] ?? stops[0];

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({
    top: '50%',
    left: '50%',
    transform: 'translate(-50%,-50%)',
  });

  // ── Auto-start on first visit ──────────────────────────────────────────────
  useEffect(() => {
    const completed = localStorage.getItem(TOUR_COMPLETED_KEY);
    if (!completed) {
      setTourStepIndex(0);
      setShowTour(true);
    }
  }, [setShowTour, setTourStepIndex]);

  // ── Recompute spotlight + tooltip positions on step change ─────────────────
  const recalcPositions = useCallback(() => {
    if (!showTour) return;

    const stop = stops[tourStepIndex];
    if (!stop) return;

    const rect = stop.targetSelector ? getElementRect(stop.targetSelector) : null;
    setSpotlightRect(rect);

    // Measure tooltip width from DOM if available
    const tooltipWidth = tooltipRef.current?.offsetWidth ?? 320;
    setTooltipPos(computeTooltipPosition(rect, stop.placement, tooltipWidth));
  }, [showTour, stops, tourStepIndex]);

  useEffect(() => {
    recalcPositions();
    window.addEventListener('resize', recalcPositions);
    return () => window.removeEventListener('resize', recalcPositions);
  }, [recalcPositions]);

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!showTour) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip();
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
      if (e.key === 'ArrowLeft') handleBack();
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTour, tourStepIndex]);

  // ── Navigation handlers ────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (tourStepIndex >= totalSteps - 1) {
      handleFinish();
    } else {
      setTourStepIndex(tourStepIndex + 1);
    }
  }, [tourStepIndex, totalSteps, setTourStepIndex]); // eslint-disable-line

  const handleBack = useCallback(() => {
    if (tourStepIndex > 0) {
      setTourStepIndex(tourStepIndex - 1);
    }
  }, [tourStepIndex, setTourStepIndex]);

  const handleSkip = useCallback(() => {
    localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    setShowTour(false);
  }, [setShowTour]);

  const handleFinish = useCallback(() => {
    localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    setShowTour(false);
  }, [setShowTour]);

  if (!showTour) return null;

  const isFirst = tourStepIndex === 0;
  const isLast = tourStepIndex === totalSteps - 1;

  return (
    <>
      {/* Keyframe animation injected once */}
      <style>{`
        @keyframes tourTooltipIn {
          from { opacity: 0; transform: ${tooltipPos.transform ?? ''} scale(0.94); }
          to   { opacity: 1; transform: ${tooltipPos.transform ?? ''}; }
        }
        @keyframes tourSpotlightPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }
      `}</style>

      {/* Dark overlay with spotlight cutout */}
      <SpotlightOverlay rect={spotlightRect} onClick={() => { /* click-outside = no skip */ }} />

      {/* Tooltip */}
      <TourTooltip
        stop={currentStop}
        stepIndex={tourStepIndex}
        totalSteps={totalSteps}
        position={tooltipPos}
        onBack={handleBack}
        onNext={handleNext}
        onSkip={handleSkip}
        isFirst={isFirst}
        isLast={isLast}
        tooltipRef={tooltipRef}
      />
    </>
  );
};

// ─── Restart Tour button (used in Settings / Help menu) ──────────────────────

export const RestartTourButton: React.FC<{ className?: string }> = ({ className }) => {
  const { setShowTour, setTourStepIndex } = useUIStore();

  const handleRestart = () => {
    localStorage.removeItem(TOUR_COMPLETED_KEY);
    setTourStepIndex(0);
    setShowTour(true);
  };

  return (
    <button
      onClick={handleRestart}
      className={className}
      aria-label="Restart guided tour"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 14px',
        borderRadius: '8px',
        background: 'rgba(56, 189, 248, 0.12)',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        color: 'rgba(56, 189, 248, 0.9)',
        fontSize: '13px',
        fontWeight: 600,
        fontFamily: 'Inter, sans-serif',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(56, 189, 248, 0.22)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(56, 189, 248, 0.55)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(56, 189, 248, 0.12)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(56, 189, 248, 0.3)';
      }}
    >
      <span aria-hidden="true">🗺️</span>
      Take the Tour
    </button>
  );
};

export default GuidedTour;
