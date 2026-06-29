/**
 * IndiaClimateStats — Compact live statistics card showing India-wide climate
 * stats derived from VAYU model predictions.
 * 
 * Displays monsoon rainfall deficit/surplus vs IMD LPA, nationwide mean
 * temperature anomaly, active severe weather alerts, and monsoon coverage %.
 */
import { useMemo } from 'react';
import { CloudRain, Thermometer, AlertTriangle, MapPin } from 'lucide-react';
import type { GridCell } from '../types';

interface IndiaClimateStatsProps {
  gridCells: GridCell[];
  selectedDate: Date;
}

// IMD Long Period Average rainfall (mm) by month (June=5 index)
const LPA_MONTHLY_MM: Record<number, number> = {
  5: 87,   // June
  6: 167,  // July
  7: 167,  // August
  8: 120,  // September
};

// IMD normal monsoon onset dates (day-of-year) by latitude band
const MONSOON_ONSET_NORMALS: { latMin: number; latMax: number; onsetDOY: number }[] = [
  { latMin: 8, latMax: 12, onsetDOY: 152 },   // Kerala — Jun 1
  { latMin: 12, latMax: 16, onsetDOY: 160 },  // Karnataka — Jun 9
  { latMin: 16, latMax: 20, onsetDOY: 168 },  // Maharashtra — Jun 17
  { latMin: 20, latMax: 24, onsetDOY: 176 },  // Gujarat/MP — Jun 25
  { latMin: 24, latMax: 28, onsetDOY: 182 },  // Rajasthan — Jul 1
  { latMin: 28, latMax: 36, onsetDOY: 196 },  // NW India — Jul 15
];

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function IndiaClimateStats({ gridCells, selectedDate }: IndiaClimateStatsProps) {
  const stats = useMemo(() => {
    if (gridCells.length === 0) {
      return { rainfallDeficit: 0, tempAnomaly: 0, alertCount: 0, monsoonCoverage: 0 };
    }

    // Rainfall deficit/surplus vs LPA
    const month = selectedDate.getMonth();
    const lpa = LPA_MONTHLY_MM[month] ?? 87;
    const meanRainfall = gridCells.reduce((s, c) => s + c.rainfall, 0) / gridCells.length;
    const rainfallDeficit = ((meanRainfall - lpa) / lpa) * 100;

    // Temperature anomaly (vs 30°C climatological mean for India in monsoon)
    const climatologicalMean = 30.5;
    const meanTmax = gridCells.reduce((s, c) => s + c.temp_max, 0) / gridCells.length;
    const tempAnomaly = meanTmax - climatologicalMean;

    // Active severe alerts (IMD thresholds)
    const alertCount = gridCells.filter(
      (c) => c.rainfall >= 64.5 || c.temp_max >= 43
    ).length;

    // Monsoon coverage — fraction of cells where monsoon should have arrived by now
    const doy = getDayOfYear(selectedDate);
    const totalZoneCells = gridCells.length;
    let coveredCells = 0;
    for (const cell of gridCells) {
      const zone = MONSOON_ONSET_NORMALS.find(
        (z) => cell.lat >= z.latMin && cell.lat < z.latMax
      );
      if (zone && doy >= zone.onsetDOY && cell.rainfall >= 2.5) {
        coveredCells++;
      }
    }
    const monsoonCoverage = totalZoneCells > 0 ? (coveredCells / totalZoneCells) * 100 : 0;

    return { rainfallDeficit, tempAnomaly, alertCount, monsoonCoverage };
  }, [gridCells, selectedDate]);

  const deficitColor = stats.rainfallDeficit >= 0 ? '#22d3ee' : '#f87171';
  const deficitLabel = stats.rainfallDeficit >= 0 ? 'Surplus' : 'Deficit';

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-1.5 h-1.5 rounded-full bg-[#22d3ee] animate-pulse" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">
          India Climate Summary
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Rainfall Deficit/Surplus */}
        <div className="flex items-start gap-2">
          <CloudRain size={14} className="text-[#0ea5e9] mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-wide">Monsoon Rainfall</p>
            <p className="text-sm font-bold font-mono" style={{ color: deficitColor }}>
              {stats.rainfallDeficit >= 0 ? '+' : ''}{stats.rainfallDeficit.toFixed(1)}%
            </p>
            <p className="text-[9px] text-white/40">{deficitLabel} vs IMD LPA</p>
          </div>
        </div>

        {/* Temperature Anomaly */}
        <div className="flex items-start gap-2">
          <Thermometer size={14} className="text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-wide">Temp Anomaly</p>
            <p className="text-sm font-bold font-mono" style={{ color: stats.tempAnomaly > 1 ? '#fb923c' : '#22d3ee' }}>
              {stats.tempAnomaly >= 0 ? '+' : ''}{stats.tempAnomaly.toFixed(2)}°C
            </p>
            <p className="text-[9px] text-white/40">vs 30.5°C climatology</p>
          </div>
        </div>

        {/* Severe Weather Alerts */}
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-wide">Severe Alerts</p>
            <p className="text-sm font-bold font-mono text-amber-300">
              {stats.alertCount}
            </p>
            <p className="text-[9px] text-white/40">cells exceeding thresholds</p>
          </div>
        </div>

        {/* Monsoon Coverage */}
        <div className="flex items-start gap-2">
          <MapPin size={14} className="text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-wide">Monsoon Coverage</p>
            <p className="text-sm font-bold font-mono text-emerald-300">
              {stats.monsoonCoverage.toFixed(0)}%
            </p>
            <p className="text-[9px] text-white/40">based on IMD onset normals</p>
          </div>
        </div>
      </div>

      {/* Mini progress bar for monsoon coverage */}
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(stats.monsoonCoverage, 100)}%`,
            background: 'linear-gradient(90deg, #0ea5e9, #22d3ee)',
          }}
        />
      </div>
    </div>
  );
}
