/**
 * FloodRiskPanel — Feature 9
 * Flood risk assessment based on cumulative predicted rainfall thresholds.
 * Identifies high-risk grid cells and shows affected regions.
 * Uses IMD flash flood guidance thresholds.
 */
import { Waves, AlertTriangle, CheckCircle } from 'lucide-react';
import type { GridCell } from '../types';

interface FloodRiskPanelProps {
  gridCells: GridCell[];
  forecastDay: number;
}

interface FloodRiskZone {
  lat: number;
  lon: number;
  rainfall: number;
  riskLevel: 'extreme' | 'high' | 'moderate';
}

// IMD Flash Flood Guidance thresholds (mm/day)
const THRESHOLDS = {
  extreme:  150,  // IMD "extremely heavy" ≥ 150mm
  high:     115,  // "very heavy" ≥ 115mm
  moderate:  64,  // "heavy" ≥ 64.5mm
};

const RISK_STYLES = {
  extreme:  { color: '#dc2626', bg: 'rgba(220,38,38,0.12)',  label: 'Extreme Risk',  icon: '🔴' },
  high:     { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'High Risk',     icon: '🟠' },
  moderate: { color: '#eab308', bg: 'rgba(234,179,8,0.10)',  label: 'Moderate Risk', icon: '🟡' },
};

export default function FloodRiskPanel({ gridCells, forecastDay }: FloodRiskPanelProps) {
  if (gridCells.length === 0) {
    return (
      <div className="panel-tight p-3 text-xs text-foreground/30 text-center py-5">
        No prediction data available
      </div>
    );
  }

  // Identify risk zones
  const zones: FloodRiskZone[] = [];
  for (const cell of gridCells) {
    // Scale rainfall by forecast day (longer lead = more accumulation)
    const accum = cell.rainfall * Math.min(forecastDay, 3);
    let riskLevel: FloodRiskZone['riskLevel'] | null = null;
    if (accum >= THRESHOLDS.extreme) riskLevel = 'extreme';
    else if (accum >= THRESHOLDS.high) riskLevel = 'high';
    else if (accum >= THRESHOLDS.moderate) riskLevel = 'moderate';
    if (riskLevel) zones.push({ lat: cell.lat, lon: cell.lon, rainfall: accum, riskLevel });
  }

  // Aggregate by risk level
  const byLevel = {
    extreme:  zones.filter((z) => z.riskLevel === 'extreme'),
    high:     zones.filter((z) => z.riskLevel === 'high'),
    moderate: zones.filter((z) => z.riskLevel === 'moderate'),
  };

  const totalAtRisk = zones.length;
  const pctAtRisk = ((totalAtRisk / gridCells.length) * 100).toFixed(1);
  const maxRainfall = zones.length > 0 ? Math.max(...zones.map((z) => z.rainfall)) : 0;

  const hasRisk = totalAtRisk > 0;

  return (
    <div className="panel-tight p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Waves size={13} className="text-blue-400" />
          <span className="text-xs font-semibold text-foreground/80">Flood Risk Assessment</span>
        </div>
        <span className="text-[9px] font-mono text-foreground/30">T+{forecastDay}d accum</span>
      </div>

      {!hasRisk ? (
        <div className="flex items-center gap-2 py-2 px-2 rounded-lg" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)' }}>
          <CheckCircle size={13} className="text-green-400" />
          <span className="text-[11px] text-green-300/80">No significant flood risk detected</span>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center rounded-lg p-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}>
              <AlertTriangle size={11} className="text-red-400 mb-0.5" />
              <span className="text-lg font-bold font-mono tabular-nums text-red-300">{totalAtRisk}</span>
              <span className="text-[9px] text-foreground/35">cells at risk</span>
            </div>
            <div className="flex flex-col items-center rounded-lg p-2" style={{ background: 'rgba(var(--fg-rgb),var(--fg-a05))', border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))' }}>
              <span className="text-[9px] text-foreground/40 mb-0.5">Area affected</span>
              <span className="text-lg font-bold font-mono tabular-nums text-orange-300">{pctAtRisk}%</span>
              <span className="text-[9px] text-foreground/35">of region</span>
            </div>
          </div>

          {/* Risk level breakdown */}
          {(Object.keys(byLevel) as (keyof typeof byLevel)[]).map((level) => {
            const cells = byLevel[level];
            if (cells.length === 0) return null;
            const style = RISK_STYLES[level];
            return (
              <div
                key={level}
                className="flex items-center justify-between px-2.5 py-2 rounded-lg"
                style={{ background: style.bg, border: `1px solid ${style.color}35` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{style.icon}</span>
                  <div>
                    <div className="text-[10px] font-medium" style={{ color: style.color }}>
                      {style.label}
                    </div>
                    <div className="text-[9px] text-foreground/30">
                      ≥ {THRESHOLDS[level]} mm · {cells.length} cells
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold font-mono tabular-nums" style={{ color: style.color }}>
                    {Math.max(...cells.map((c) => c.rainfall)).toFixed(0)} mm
                  </div>
                  <div className="text-[9px] text-foreground/30">peak</div>
                </div>
              </div>
            );
          })}

          {/* Max rainfall */}
          <div className="text-center text-[9px] text-foreground/30">
            Peak accumulated: <span className="font-mono text-red-300">{maxRainfall.toFixed(1)} mm</span> over {Math.min(forecastDay, 3)} days
          </div>
        </>
      )}

      <p className="text-[9px] text-foreground/20 text-center">
        IMD Flash Flood Guidance thresholds · {forecastDay}-day lead time
      </p>
    </div>
  );
}
