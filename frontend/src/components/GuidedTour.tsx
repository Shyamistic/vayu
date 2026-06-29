/**
 * GuidedTour — Feature 29
 * Scripted camera tour demonstrating VAYU's key features for hackathon judges.
 * Uses a custom event to communicate with CesiumGlobe.
 */
import { useState, useEffect, useCallback } from 'react';
import { Play, ChevronRight, X, Globe } from 'lucide-react';

export interface TourStep {
  id: number;
  title: string;
  description: string;
  lat: number;
  lon: number;
  altitude: number;
  pitch: number; // degrees, negative = look down
  duration: number; // camera fly duration in seconds
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 1,
    title: 'Welcome to VAYU',
    description: 'India\'s first AI-powered Climate Digital Twin. A 6.6M parameter spatio-temporal transformer trained on 70+ years of IMD gridded data, delivering 7-day rainfall and temperature forecasts at 0.25° resolution across the subcontinent.',
    lat: 20.5, lon: 78.9, altitude: 6_500_000, pitch: -90, duration: 3.0,
  },
  {
    id: 2,
    title: 'Western Ghats: India\'s Rain Factory',
    description: 'The Western Ghats intercept moisture-laden southwest monsoon winds, triggering intense orographic rainfall along the windward slopes. Some stations here record over 6,000 mm annually — among the highest on Earth. VAYU\'s graph-attention encoder captures this topographic forcing.',
    lat: 14.0, lon: 75.0, altitude: 900_000, pitch: -45, duration: 3.5,
  },
  {
    id: 3,
    title: 'Monsoon Dynamics',
    description: 'As monsoon winds hit the coast, the model resolves windward vs. leeward rainfall gradients. Coastal Mangalore receives 300+ cm/year while Bellary on the lee side gets under 50 cm. VAYU uses GEBCO bathymetry and SRTM elevation to encode these terrain interactions.',
    lat: 13.5, lon: 75.5, altitude: 500_000, pitch: -40, duration: 3.0,
  },
  {
    id: 4,
    title: 'Real-Time Predictions',
    description: 'Zooming into the Mumbai–Pune corridor: VAYU generates T+1 to T+7 day forecasts with calibrated uncertainty bounds. Each 28 km × 28 km grid cell shows predicted intensity, enabling city-level flood alerts and water resource planning.',
    lat: 18.9, lon: 73.5, altitude: 350_000, pitch: -50, duration: 3.0,
  },
  {
    id: 5,
    title: 'Climate Risk Assessment',
    description: 'India\'s southern tip and coastal Tamil Nadu face cyclonic rainfall and drought cycles. The system computes Standardized Precipitation Index (SPI) and flood-risk scores, helping disaster management authorities plan evacuations and relief logistics.',
    lat: 9.5, lon: 78.5, altitude: 800_000, pitch: -55, duration: 3.0,
  },
  {
    id: 6,
    title: 'What-If Scenarios',
    description: 'The scenario engine simulates El Niño/La Niña teleconnections, +1.5°C to +4°C SST anomalies, and monsoon onset delays. Decision-makers can stress-test infrastructure and agriculture against future climate states before they unfold.',
    lat: 18.0, lon: 76.0, altitude: 2_500_000, pitch: -65, duration: 3.0,
  },
  {
    id: 7,
    title: 'Agricultural Impact',
    description: 'Central Karnataka — India\'s millet and sugarcane belt — depends critically on monsoon timing. VAYU\'s crop advisory module correlates predicted rainfall with phenological stages, issuing sowing/harvest window recommendations to farming communities.',
    lat: 15.3, lon: 76.4, altitude: 600_000, pitch: -45, duration: 3.0,
  },
  {
    id: 8,
    title: 'Data Sources & Integration',
    description: 'VAYU fuses IMD 0.25° gridded rainfall (1951–2024), NCEP/NCAR reanalysis winds, CHIRPS satellite precipitation, GEBCO ocean bathymetry, and live Open-Meteo feeds into a unified graph structure. The result: a living digital twin of India\'s climate system.',
    lat: 22.0, lon: 80.0, altitude: 5_000_000, pitch: -80, duration: 3.5,
  },
];

interface GuidedTourProps {
  onTourStep: (step: TourStep | null) => void;
  isActive: boolean;
  onToggle: () => void;
}

export default function GuidedTour({ onTourStep, isActive, onToggle }: GuidedTourProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(false);

  const goToStep = useCallback(
    (idx: number) => {
      if (idx >= TOUR_STEPS.length) {
        onTourStep(null);
        setAutoAdvance(false);
        setCurrentStepIdx(0);
        onToggle();
        return;
      }
      setCurrentStepIdx(idx);
      onTourStep(TOUR_STEPS[idx]);
    },
    [onTourStep, onToggle],
  );

  useEffect(() => {
    if (!isActive) {
      onTourStep(null);
      setCurrentStepIdx(0);
      setAutoAdvance(false);
    } else {
      goToStep(0);
    }
  }, [isActive]);

  useEffect(() => {
    if (!autoAdvance || !isActive) return;
    const step = TOUR_STEPS[currentStepIdx];
    if (!step) return;
    const delay = step.duration * 1000 + 3000; // fly duration + reading time
    const timer = setTimeout(() => goToStep(currentStepIdx + 1), delay);
    return () => clearTimeout(timer);
  }, [autoAdvance, currentStepIdx, isActive, goToStep]);

  if (!isActive) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.7)',
        }}
        title="Guided Demo Tour"
      >
        <Globe size={13} />
        <span>Tour</span>
      </button>
    );
  }

  const step = TOUR_STEPS[currentStepIdx];

  return (
    <div
      className="fixed bottom-[180px] right-4 z-[1004] w-[360px] max-w-[40vw] animate-slide-in-right"
      style={{
        background: 'rgba(6,10,22,0.97)',
        border: '1px solid rgba(14,165,233,0.35)',
        borderRadius: 14,
        boxShadow: '0 12px 48px rgba(0,0,0,0.7), 0 0 32px rgba(14,165,233,0.12)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-vayu-accent" />
          <span className="text-xs text-white/60 font-medium">Guided Tour</span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-mono"
            style={{ background: 'rgba(14,165,233,0.15)', color: '#38bdf8' }}
          >
            {currentStepIdx + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <button onClick={onToggle} className="text-white/30 hover:text-white/70 transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Step progress dots */}
      <div className="flex items-center gap-1.5 px-4 pt-3">
        {TOUR_STEPS.map((_, i) => (
          <button
            key={i}
            onClick={() => goToStep(i)}
            className="transition-all rounded-full"
            style={{
              width: i === currentStepIdx ? 20 : 6,
              height: 6,
              background: i === currentStepIdx
                ? '#0ea5e9'
                : i < currentStepIdx
                ? 'rgba(14,165,233,0.4)'
                : 'rgba(255,255,255,0.12)',
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="px-4 py-4">
        <h3 className="text-sm font-semibold text-white/90 mb-2">{step.title}</h3>
        <p className="text-xs text-white/50 leading-relaxed">{step.description}</p>
      </div>

      {/* Controls */}
      <div
        className="flex items-center justify-between px-4 pb-4 gap-3"
      >
        <button
          onClick={() => setAutoAdvance((a) => !a)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-all"
          style={{
            background: autoAdvance ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.05)',
            border: autoAdvance ? '1px solid rgba(14,165,233,0.4)' : '1px solid rgba(255,255,255,0.1)',
            color: autoAdvance ? '#38bdf8' : 'rgba(255,255,255,0.5)',
          }}
        >
          <Play size={10} />
          {autoAdvance ? 'Auto' : 'Manual'}
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => goToStep(currentStepIdx - 1)}
            disabled={currentStepIdx === 0}
            className="px-3 py-1.5 rounded-lg text-xs transition-all disabled:opacity-30"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            Back
          </button>
          <button
            onClick={() => goToStep(currentStepIdx + 1)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: 'rgba(14,165,233,0.25)',
              border: '1px solid rgba(14,165,233,0.5)',
              color: '#38bdf8',
              boxShadow: '0 0 12px rgba(14,165,233,0.2)',
            }}
          >
            {currentStepIdx < TOUR_STEPS.length - 1 ? (
              <>Next <ChevronRight size={12} /></>
            ) : (
              'Finish Tour'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
