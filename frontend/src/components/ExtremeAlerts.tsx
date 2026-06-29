/**
 * ExtremeAlerts — Feature 21
 * Flashing alert banner when any grid cell exceeds IMD "extremely heavy"
 * rainfall threshold (≥ 150 mm/day) or dangerous temperature (≥ 45°C).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, X, Zap } from 'lucide-react';
import type { GridCell, VariableId } from '../types';

interface Alert {
  id: string;
  severity: 'extreme' | 'very-heavy' | 'warning';
  variable: VariableId;
  value: number;
  lat: number;
  lon: number;
  message: string;
}

interface ExtremeAlertsProps {
  gridCells: GridCell[];
  variable: VariableId;
}

const THRESHOLDS = {
  rainfall: [
    { level: 'extreme' as const, min: 150, label: 'EXTREMELY HEAVY RAINFALL' },
    { level: 'very-heavy' as const, min: 115, label: 'Very Heavy Rainfall' },
    { level: 'warning' as const, min: 64.5, label: 'Heavy Rainfall Warning' },
  ],
  temp_max: [
    { level: 'extreme' as const, min: 45, label: 'EXTREME HEAT ALERT' },
    { level: 'very-heavy' as const, min: 43, label: 'Severe Heat Wave' },
    { level: 'warning' as const, min: 41, label: 'Heat Wave Warning' },
  ],
  temp_min: [
    { level: 'extreme' as const, min: 4, label: 'SEVERE COLD WAVE', isBelow: true },
    { level: 'very-heavy' as const, min: 7, label: 'Cold Wave Alert', isBelow: true },
    { level: 'warning' as const, min: 10, label: 'Frost Risk', isBelow: true },
  ],
};

function buildAlerts(gridCells: GridCell[], variable: VariableId): Alert[] {
  if (gridCells.length === 0) return [];

  const thresholds = THRESHOLDS[variable];
  // Count cells per severity level and show ONE summary alert per level
  const alerts: Alert[] = [];

  for (const thresh of thresholds) {
    const triggeredCells = gridCells.filter((cell) => {
      const val = cell[variable] as number;
      return (thresh as { isBelow?: boolean }).isBelow ? val < thresh.min : val >= thresh.min;
    });

    if (triggeredCells.length === 0) continue;

    // Find the most extreme cell for display
    const extremeCell = triggeredCells.reduce((best, cell) => {
      const bestVal = best[variable] as number;
      const cellVal = cell[variable] as number;
      return (thresh as { isBelow?: boolean }).isBelow
        ? (cellVal < bestVal ? cell : best)
        : (cellVal > bestVal ? cell : best);
    });
    const extremeVal = extremeCell[variable] as number;
    const unit = variable === 'rainfall' ? 'mm/day' : '°C';

    alerts.push({
      id: `${thresh.level}-summary`,
      severity: thresh.level,
      variable,
      value: extremeVal,
      lat: extremeCell.lat,
      lon: extremeCell.lon,
      message: `${thresh.label}: ${triggeredCells.length} cell${triggeredCells.length > 1 ? 's' : ''} (max ${extremeVal.toFixed(1)}${unit})`,
    });
    break; // Only show the most severe level
  }

  return alerts.slice(0, 2); // max 2 alerts (one per category if both rain + heat)
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  extreme:    { bg: 'rgba(220,38,38,0.18)',  border: 'rgba(220,38,38,0.6)',  text: '#fca5a5', icon: '#ef4444' },
  'very-heavy': { bg: 'rgba(234,88,12,0.15)',  border: 'rgba(234,88,12,0.5)',  text: '#fdba74', icon: '#f97316' },
  warning:    { bg: 'rgba(234,179,8,0.12)',  border: 'rgba(234,179,8,0.4)',  text: '#fde047', icon: '#eab308' },
};

export default function ExtremeAlerts({ gridCells, variable }: ExtremeAlertsProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const newAlerts = buildAlerts(gridCells, variable).filter((a) => {
      // Suppress false cold wave alerts when temp is actually warm
      if (a.variable === 'temp_min' && a.value > 15) return false;
      return true;
    }).filter((a) => !dismissed.has(a.id));
    setAlerts(newAlerts);
    if (newAlerts.some((a) => a.severity === 'extreme')) {
      // Flash effect for extreme alerts
      const iv = setInterval(() => setFlash((f) => !f), 800);
      setTimeout(() => clearInterval(iv), 6000);
      return () => clearInterval(iv);
    }
  }, [gridCells, variable, dismissed]);

  const dismiss = (id: string) => {
    setDismissed((d) => new Set([...d, id]));
    setAlerts((a) => a.filter((al) => al.id !== id));
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-[80px] left-1/2 -translate-x-1/2 z-[998] flex flex-col gap-1.5 w-[420px] max-w-[80vw] pointer-events-auto">
      {alerts.map((alert) => {
        const style = SEVERITY_STYLES[alert.severity];
        const isExtreme = alert.severity === 'extreme';
        return (
          <div
            key={alert.id}
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl backdrop-blur-xl"
            style={{
              background: style.bg,
              border: `1px solid ${style.border}`,
              opacity: isExtreme && flash ? 0.75 : 1,
              transition: 'opacity 0.3s',
              boxShadow: isExtreme ? `0 0 16px ${style.icon}40` : 'none',
            }}
          >
            <span style={{ color: style.icon }} className="shrink-0">
              {isExtreme ? <Zap size={16} className="animate-pulse" /> : <AlertTriangle size={15} />}
            </span>
            <span className="text-xs font-medium flex-1 font-mono" style={{ color: style.text }}>
              {alert.message}
            </span>
            <button
              onClick={() => dismiss(alert.id)}
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: style.text }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
