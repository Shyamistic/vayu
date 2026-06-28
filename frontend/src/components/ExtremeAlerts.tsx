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
    { level: 'extreme' as const, min: 42, label: 'EXTREME HEAT ALERT' },
    { level: 'very-heavy' as const, min: 40, label: 'Severe Heat Wave' },
    { level: 'warning' as const, min: 37, label: 'Heat Wave Warning' },  // IMD threshold for coastal/hilly areas
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
  const alerts: Alert[] = [];
  const seen = new Set<string>();

  for (const cell of gridCells) {
    const val = cell[variable] as number;

    for (const thresh of thresholds) {
      const triggered =
        (thresh as { isBelow?: boolean }).isBelow ? val < thresh.min : val >= thresh.min;
      if (!triggered) continue;

      const key = `${thresh.level}-${cell.lat.toFixed(1)}-${cell.lon.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      alerts.push({
        id: key,
        severity: thresh.level,
        variable,
        value: val,
        lat: cell.lat,
        lon: cell.lon,
        message: `${thresh.label}: ${val.toFixed(1)}${variable === 'rainfall' ? ' mm/day' : '°C'} at ${cell.lat.toFixed(2)}°N ${cell.lon.toFixed(2)}°E`,
      });
      break; // only most severe threshold per cell
    }
  }

  return alerts.slice(0, 5); // cap at 5 alerts
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
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[1002] flex flex-col gap-1.5 w-[480px] max-w-[96vw] animate-slide-in-up pointer-events-auto">
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
