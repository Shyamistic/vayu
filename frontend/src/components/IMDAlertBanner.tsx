/**
 * IMDAlertBanner — IMD-style weather warning banner.
 * Shows alert levels (Green/Yellow/Orange/Red) based on IMD thresholds:
 *   Rain > 64.5mm → Orange, > 204.4mm → Red
 *   Tmax > 45°C → Red, > 40°C → Orange
 * Compact horizontal banner format.
 */
import { useMemo } from 'react';
import { AlertTriangle, Shield, CloudRain, Thermometer } from 'lucide-react';
import type { GridCell } from '../types';

interface IMDAlertBannerProps {
  gridCells: GridCell[];
}

type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

interface IMDAlert {
  level: AlertLevel;
  type: 'rainfall' | 'heat';
  message: string;
  cellCount: number;
}

const LEVEL_CONFIG: Record<AlertLevel, { bg: string; border: string; text: string; label: string }> = {
  green:  { bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.3)',  text: '#4ade80', label: 'Green' },
  yellow: { bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.35)', text: '#fde047', label: 'Yellow' },
  orange: { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.4)', text: '#fb923c', label: 'Orange' },
  red:    { bg: 'rgba(239,68,68,0.14)',  border: 'rgba(239,68,68,0.5)',  text: '#fca5a5', label: 'Red' },
};

function computeAlerts(gridCells: GridCell[]): IMDAlert[] {
  if (gridCells.length === 0) {
    return [{ level: 'green', type: 'rainfall', message: 'No active warnings', cellCount: 0 }];
  }

  const alerts: IMDAlert[] = [];

  // Rainfall alerts
  const redRainCells = gridCells.filter((c) => c.rainfall >= 204.4);
  const orangeRainCells = gridCells.filter((c) => c.rainfall >= 64.5 && c.rainfall < 204.4);
  const yellowRainCells = gridCells.filter((c) => c.rainfall >= 35.5 && c.rainfall < 64.5);

  if (redRainCells.length > 0) {
    alerts.push({
      level: 'red',
      type: 'rainfall',
      message: `Extremely heavy rainfall (≥204.4 mm)`,
      cellCount: redRainCells.length,
    });
  } else if (orangeRainCells.length > 0) {
    alerts.push({
      level: 'orange',
      type: 'rainfall',
      message: `Heavy to very heavy rainfall (≥64.5 mm)`,
      cellCount: orangeRainCells.length,
    });
  } else if (yellowRainCells.length > 0) {
    alerts.push({
      level: 'yellow',
      type: 'rainfall',
      message: `Moderate rainfall (≥35.5 mm)`,
      cellCount: yellowRainCells.length,
    });
  }

  // Heat alerts
  const redHeatCells = gridCells.filter((c) => c.temp_max >= 45);
  const orangeHeatCells = gridCells.filter((c) => c.temp_max >= 40 && c.temp_max < 45);

  if (redHeatCells.length > 0) {
    alerts.push({
      level: 'red',
      type: 'heat',
      message: `Extreme heat (≥45°C)`,
      cellCount: redHeatCells.length,
    });
  } else if (orangeHeatCells.length > 0) {
    alerts.push({
      level: 'orange',
      type: 'heat',
      message: `Heat wave conditions (≥40°C)`,
      cellCount: orangeHeatCells.length,
    });
  }

  // Default to green if no warnings
  if (alerts.length === 0) {
    alerts.push({ level: 'green', type: 'rainfall', message: 'No active warnings — conditions normal', cellCount: 0 });
  }

  return alerts;
}

export default function IMDAlertBanner({ gridCells }: IMDAlertBannerProps) {
  const alerts = useMemo(() => computeAlerts(gridCells), [gridCells]);
  const maxLevel = alerts.reduce<AlertLevel>((max, a) => {
    const order: AlertLevel[] = ['green', 'yellow', 'orange', 'red'];
    return order.indexOf(a.level) > order.indexOf(max) ? a.level : max;
  }, 'green');

  const cfg = LEVEL_CONFIG[maxLevel];

  return (
    <div
      className="panel px-4 py-3"
      style={{ borderColor: cfg.border }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Shield size={13} style={{ color: cfg.text }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
          IMD Warning Level
        </span>
        <span
          className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
        >
          {cfg.label}
        </span>
      </div>

      {/* Alert items */}
      <div className="space-y-1.5">
        {alerts.map((alert, i) => {
          const alertCfg = LEVEL_CONFIG[alert.level];
          return (
            <div
              key={i}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: alertCfg.bg }}
            >
              {alert.type === 'rainfall' ? (
                <CloudRain size={12} style={{ color: alertCfg.text }} />
              ) : (
                <Thermometer size={12} style={{ color: alertCfg.text }} />
              )}
              <span className="text-[11px] font-medium flex-1" style={{ color: alertCfg.text }}>
                {alert.message}
              </span>
              {alert.cellCount > 0 && (
                <span className="text-[9px] font-mono text-white/40">
                  {alert.cellCount} cells
                </span>
              )}
              <AlertTriangle size={10} style={{ color: alertCfg.text }} className="opacity-60" />
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <p className="text-[8px] text-white/25 mt-2 text-right">
        Thresholds: IMD SOP Revision 2024 • VAYU model prediction
      </p>
    </div>
  );
}
