/**
 * ClimateRiskScore — Composite climate risk index card (0–100 scale).
 * Computes risk from rainfall extremes, heat wave threshold, and drought index.
 * Displays a circular SVG gauge with top 3 contributing risk factors.
 */
import { useMemo } from 'react';
import { ShieldAlert, TrendingUp, Droplets, Flame, Wind } from 'lucide-react';
import type { GridCell, VariableId } from '../types';

interface ClimateRiskScoreProps {
  gridCells: GridCell[];
  variable: VariableId;
}

interface RiskFactor {
  name: string;
  score: number;
  icon: typeof Droplets;
  color: string;
}

function computeRiskScore(gridCells: GridCell[], variable: VariableId) {
  if (gridCells.length === 0) {
    return { composite: 0, factors: [] as RiskFactor[] };
  }

  const n = gridCells.length;

  // Factor 1: Rainfall extreme risk (fraction of cells above 64.5mm heavy rain threshold)
  const heavyRainCells = gridCells.filter((c) => c.rainfall >= 64.5).length;
  const extremeRainCells = gridCells.filter((c) => c.rainfall >= 115).length;
  const rainfallRisk = Math.min(100, (heavyRainCells / n) * 200 + (extremeRainCells / n) * 300);

  // Factor 2: Heat wave risk (fraction of cells above 40°C, critical above 45°C)
  const heatCells = gridCells.filter((c) => c.temp_max >= 40).length;
  const extremeHeatCells = gridCells.filter((c) => c.temp_max >= 45).length;
  const heatRisk = Math.min(100, (heatCells / n) * 250 + (extremeHeatCells / n) * 400);

  // Factor 3: Drought risk (inverse — low rainfall + high temp)
  const dryHotCells = gridCells.filter((c) => c.rainfall < 2.5 && c.temp_max > 38).length;
  const droughtRisk = Math.min(100, (dryHotCells / n) * 300);

  // Factor 4: Uncertainty risk (high model uncertainty suggests unstable conditions)
  const avgUncertainty =
    gridCells.reduce(
      (s, c) =>
        s + (variable === 'rainfall' ? c.rainfall_uncertainty : c.temp_max_uncertainty),
      0
    ) / n;
  const maxReasonableUncertainty = variable === 'rainfall' ? 50 : 5;
  const uncertaintyRisk = Math.min(100, (avgUncertainty / maxReasonableUncertainty) * 100);

  // Weighted composite
  const weights = { rainfall: 0.35, heat: 0.30, drought: 0.20, uncertainty: 0.15 };
  const composite = Math.min(
    100,
    rainfallRisk * weights.rainfall +
      heatRisk * weights.heat +
      droughtRisk * weights.drought +
      uncertaintyRisk * weights.uncertainty
  );

  const factors: RiskFactor[] = [
    { name: 'Flood/Extreme Rain', score: rainfallRisk, icon: Droplets, color: '#0ea5e9' },
    { name: 'Heat Wave', score: heatRisk, icon: Flame, color: '#f97316' },
    { name: 'Drought Index', score: droughtRisk, icon: Wind, color: '#a78bfa' },
    { name: 'Model Uncertainty', score: uncertaintyRisk, icon: TrendingUp, color: '#fbbf24' },
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return { composite: Math.round(composite), factors };
}

function getRiskColor(score: number): string {
  if (score < 30) return '#22c55e';
  if (score < 60) return '#f59e0b';
  return '#ef4444';
}

function getRiskLabel(score: number): string {
  if (score < 20) return 'Low';
  if (score < 40) return 'Moderate';
  if (score < 60) return 'Elevated';
  if (score < 80) return 'High';
  return 'Critical';
}

export default function ClimateRiskScore({ gridCells, variable }: ClimateRiskScoreProps) {
  const { composite, factors } = useMemo(
    () => computeRiskScore(gridCells, variable),
    [gridCells, variable]
  );

  const color = getRiskColor(composite);
  const label = getRiskLabel(composite);

  // SVG circular gauge params
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const progress = (composite / 100) * circumference;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert size={14} className="text-[#0ea5e9]" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">
          Climate Risk Index
        </h3>
      </div>

      <div className="flex items-center gap-4">
        {/* Circular gauge */}
        <div className="relative shrink-0">
          <svg width="88" height="88" className="-rotate-90">
            {/* Background ring */}
            <circle
              cx="44" cy="44" r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="6"
            />
            {/* Progress ring */}
            <circle
              cx="44" cy="44" r={radius}
              fill="none"
              stroke={color}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - progress}
              style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.4s ease' }}
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold font-mono" style={{ color }}>
              {composite}
            </span>
            <span className="text-[9px] text-white/50">/100</span>
          </div>
        </div>

        {/* Risk factors */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${color}20`, color }}
            >
              {label}
            </span>
          </div>

          {factors.map((factor) => {
            const FactorIcon = factor.icon;
            return (
              <div key={factor.name} className="flex items-center gap-2">
                <FactorIcon size={11} style={{ color: factor.color }} className="shrink-0" />
                <span className="text-[10px] text-white/60 flex-1 truncate">{factor.name}</span>
                <span className="text-[10px] font-mono font-medium" style={{ color: factor.color }}>
                  {factor.score.toFixed(0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden flex">
        <div className="h-full bg-green-500/60 transition-all" style={{ width: '30%' }} />
        <div className="h-full bg-amber-500/60 transition-all" style={{ width: '30%' }} />
        <div className="h-full bg-red-500/60 transition-all" style={{ width: '40%' }} />
      </div>
      <div className="flex justify-between text-[8px] text-white/30 px-0.5">
        <span>Low</span>
        <span>Moderate</span>
        <span>High</span>
        <span>Critical</span>
      </div>
    </div>
  );
}
