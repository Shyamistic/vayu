/**
 * AgriculturePanel — Feature 33
 * Crop-specific advisories based on predicted weather conditions.
 * Shows crop icons, stress conditions and actionable recommendations.
 */
import { Leaf, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import type { GridCell } from '../types';

interface AgriculturePanelProps {
  gridCells: GridCell[];
}

interface CropStatus {
  name: string;
  emoji: string;
  status: 'optimal' | 'warning' | 'stress' | 'ok';
  message: string;
  detail: string;
}

function getCropStatuses(gridCells: GridCell[]): CropStatus[] {
  if (gridCells.length === 0) {
    return [];
  }

  const n = gridCells.length;
  const meanRain = gridCells.reduce((a, c) => a + c.rainfall, 0) / n;
  const meanTmax = gridCells.reduce((a, c) => a + c.temp_max, 0) / n;
  const meanTmin = gridCells.reduce((a, c) => a + c.temp_min, 0) / n;

  const crops: CropStatus[] = [
    (() => {
      // Rice needs > 5 mm/day during kharif season
      if (meanRain > 20) return {
        name: 'Rice', emoji: '🌾',
        status: 'optimal' as const,
        message: 'Optimal conditions',
        detail: `Rain ${meanRain.toFixed(1)} mm/day — good for transplanting & growth`,
      };
      if (meanRain > 5) return {
        name: 'Rice', emoji: '🌾',
        status: 'ok' as const,
        message: 'Adequate moisture',
        detail: `Rain ${meanRain.toFixed(1)} mm/day — supplement irrigation if needed`,
      };
      return {
        name: 'Rice', emoji: '🌾',
        status: 'warning' as const,
        message: 'Irrigation required',
        detail: `Rain ${meanRain.toFixed(1)} mm/day — below critical 5 mm/day threshold`,
      };
    })(),

    (() => {
      // Wheat: frost risk when Tmin < 4°C, heat stress when Tmax > 35°C
      if (meanTmin < 4) return {
        name: 'Wheat', emoji: '🌿',
        status: 'stress' as const,
        message: 'Frost risk',
        detail: `Tmin ${meanTmin.toFixed(1)}°C — below 4°C frost threshold, protect crops`,
      };
      if (meanTmax > 35) return {
        name: 'Wheat', emoji: '🌿',
        status: 'warning' as const,
        message: 'Heat stress',
        detail: `Tmax ${meanTmax.toFixed(1)}°C — high temperature impacts grain filling`,
      };
      return {
        name: 'Wheat', emoji: '🌿',
        status: 'optimal' as const,
        message: 'Favorable conditions',
        detail: `Tmin ${meanTmin.toFixed(1)}°C / Tmax ${meanTmax.toFixed(1)}°C — within ideal range`,
      };
    })(),

    (() => {
      // Cotton: stress when Tmax > 40°C
      if (meanTmax > 40) return {
        name: 'Cotton', emoji: '☁️',
        status: 'stress' as const,
        message: 'Severe heat stress',
        detail: `Tmax ${meanTmax.toFixed(1)}°C — exceeds 40°C boll development threshold`,
      };
      if (meanTmax > 36) return {
        name: 'Cotton', emoji: '☁️',
        status: 'warning' as const,
        message: 'Moderate stress',
        detail: `Tmax ${meanTmax.toFixed(1)}°C — monitor boll drop risk`,
      };
      return {
        name: 'Cotton', emoji: '☁️',
        status: 'ok' as const,
        message: 'Acceptable range',
        detail: `Tmax ${meanTmax.toFixed(1)}°C — within cotton tolerance`,
      };
    })(),

    (() => {
      // Sugarcane: needs > 1500mm annual, prefers 20-35°C
      if (meanRain > 15 && meanTmax < 38) return {
        name: 'Sugarcane', emoji: '🎋',
        status: 'optimal' as const,
        message: 'Good growing conditions',
        detail: `Rain ${meanRain.toFixed(1)} mm/day, Tmax ${meanTmax.toFixed(1)}°C — favorable`,
      };
      if (meanRain < 3) return {
        name: 'Sugarcane', emoji: '🎋',
        status: 'warning' as const,
        message: 'Low moisture deficit',
        detail: `Rain ${meanRain.toFixed(1)} mm/day — high water demand crop needs irrigation`,
      };
      return {
        name: 'Sugarcane', emoji: '🎋',
        status: 'ok' as const,
        message: 'Moderate conditions',
        detail: `Rain ${meanRain.toFixed(1)} mm/day, Tmax ${meanTmax.toFixed(1)}°C`,
      };
    })(),

    (() => {
      // Soybean: 25-30°C optimal, needs 450-700mm
      if (meanTmax > 38) return {
        name: 'Soybean', emoji: '🫘',
        status: 'stress' as const,
        message: 'High temperature stress',
        detail: `Tmax ${meanTmax.toFixed(1)}°C — above 38°C causes pod abortion`,
      };
      if (meanRain >= 5 && meanTmax <= 35) return {
        name: 'Soybean', emoji: '🫘',
        status: 'optimal' as const,
        message: 'Ideal conditions',
        detail: `${meanRain.toFixed(1)} mm/day rain, ${meanTmax.toFixed(1)}°C max — optimal pod fill`,
      };
      return {
        name: 'Soybean', emoji: '🫘',
        status: 'ok' as const,
        message: 'Acceptable',
        detail: `Monitor for moisture stress if rain continues < 3 mm/day`,
      };
    })(),
  ];

  return crops;
}

const STATUS_STYLES = {
  optimal:  { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)',   text: '#86efac', dot: '#22c55e' },
  ok:       { bg: 'rgba(14,165,233,0.10)', border: 'rgba(14,165,233,0.25)', text: '#7dd3fc', dot: '#0ea5e9' },
  warning:  { bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.3)',   text: '#fde047', dot: '#eab308' },
  stress:   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.35)',  text: '#fca5a5', dot: '#ef4444' },
};

function StatusIcon({ status }: { status: CropStatus['status'] }) {
  if (status === 'optimal' || status === 'ok') return <CheckCircle size={12} />;
  if (status === 'warning') return <AlertTriangle size={12} />;
  return <Info size={12} />;
}

export default function AgriculturePanel({ gridCells }: AgriculturePanelProps) {
  const crops = getCropStatuses(gridCells);

  return (
    <div className="panel p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Leaf size={14} className="text-green-400" />
        <span className="text-sm font-semibold text-white/85">Crop Advisory</span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-mono ml-auto"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#86efac', border: '1px solid rgba(34,197,94,0.2)' }}
        >
          AI-generated
        </span>
      </div>

      {crops.length === 0 ? (
        <div className="text-xs text-white/30 text-center py-4">
          Run a prediction to see crop advisories
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {crops.map((crop) => {
            const s = STATUS_STYLES[crop.status];
            return (
              <div
                key={crop.name}
                className="rounded-lg px-3 py-2.5 flex flex-col gap-1 transition-all"
                style={{ background: s.bg, border: `1px solid ${s.border}` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{crop.emoji}</span>
                    <span className="text-xs font-semibold text-white/85">{crop.name}</span>
                  </div>
                  <div className="flex items-center gap-1" style={{ color: s.dot }}>
                    <StatusIcon status={crop.status} />
                    <span className="text-[10px] font-medium" style={{ color: s.text }}>
                      {crop.message}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.38)' }}>
                  {crop.detail}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[9px] text-white/20 text-center">
        Based on T+1 forecast · IMD crop thresholds
      </p>
    </div>
  );
}
