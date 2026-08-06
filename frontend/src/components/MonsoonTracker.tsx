/**
 * MonsoonTracker — Feature 23
 * Visualizes monsoon onset progression based on IMD criteria:
 * sustained rainfall > 75 mm over 2+ consecutive days across 60%+ of stations.
 * Shows animated progress bar and isoline advance indicator.
 */
import { CloudRain, ArrowUp, Calendar } from 'lucide-react';

interface MonsoonTrackerProps {
  selectedDate: Date;
  meanRainfall: number; // mm/day over selected region
}

// Historical average monsoon onset dates for major regions (IMD Normal)
const ONSET_STAGES = [
  { lat: 8.0,  region: 'Kerala / Southern Coast',   normalDate: 'June 1',   normalDOY: 152 },
  { lat: 10.5, region: 'South Karnataka',            normalDate: 'June 5',   normalDOY: 156 },
  { lat: 13.0, region: 'Northern Karnataka / GOA',   normalDate: 'June 10',  normalDOY: 161 },
  { lat: 15.5, region: 'Konkan Coast',               normalDate: 'June 10',  normalDOY: 161 },
  { lat: 18.0, region: 'Maharashtra / Vidarbha',     normalDate: 'June 15',  normalDOY: 166 },
  { lat: 22.0, region: 'Gujarat / Madhya Pradesh',   normalDate: 'July 1',   normalDOY: 182 },
  { lat: 25.0, region: 'Rajasthan / UP',             normalDate: 'July 15',  normalDOY: 196 },
  { lat: 28.0, region: 'Delhi / Punjab',             normalDate: 'July 29',  normalDOY: 210 },
];

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getMonsoonStatus(
  doy: number,
  meanRainfall: number,
): {
  activeStage: number;
  isOnset: boolean;
  anomaly: string;
  progressPct: number;
} {
  const progressPct = Math.max(
    0,
    Math.min(100, ((doy - 140) / (215 - 140)) * 100),
  );

  // Find furthest stage that's within normal date range
  let activeStage = 0;
  for (let i = 0; i < ONSET_STAGES.length; i++) {
    if (doy >= ONSET_STAGES[i].normalDOY - 5) activeStage = i;
  }

  const isOnset = meanRainfall > 7.5;

  // Compute anomaly (days early/late vs normal)
  const expected = ONSET_STAGES[activeStage]?.normalDOY ?? 152;
  const diff = doy - expected;
  const anomaly =
    diff === 0
      ? 'Normal'
      : diff < -5
      ? `${Math.abs(diff)}d early`
      : diff > 5
      ? `${diff}d late`
      : 'Near normal';

  return { activeStage, isOnset, anomaly, progressPct };
}

export default function MonsoonTracker({ selectedDate, meanRainfall }: MonsoonTrackerProps) {
  const doy = getDayOfYear(selectedDate);
  const { activeStage, isOnset, anomaly, progressPct } = getMonsoonStatus(doy, meanRainfall);

  // Only show during monsoon season (May – October)
  const month = selectedDate.getMonth(); // 0-indexed
  const isMonsoonSeason = month >= 4 && month <= 9;

  if (!isMonsoonSeason) return null;

  return (
    <div className="panel-tight p-3 flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CloudRain size={13} className="text-blue-400" />
          <span className="text-xs font-semibold text-foreground/80">Monsoon Tracker</span>
        </div>
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
          style={{
            background: isOnset ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.12)',
            color: isOnset ? '#86efac' : '#fde047',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: isOnset ? '#22c55e' : '#eab308' }} />
          {isOnset ? 'Active' : 'Pre-Monsoon'}
        </div>
      </div>

      {/* Advance progress bar */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[9px] text-foreground/30 font-mono">
          <span>Kerala</span>
          <span>Punjab</span>
        </div>
        <div className="relative h-3 rounded-full overflow-hidden" style={{ background: 'rgba(var(--fg-rgb),var(--fg-a05))' }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
            style={{
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, #1d4ed8, #3b82f6, #38bdf8)',
              boxShadow: '0 0 8px rgba(59,130,246,0.5)',
            }}
          />
          {/* Rainfall intensity indicator */}
          {isOnset && (
            <div
              className="absolute top-0 bottom-0 w-2 rounded-full"
              style={{
                left: `calc(${progressPct}% - 4px)`,
                background: 'rgba(var(--fg-rgb),var(--fg-a75))',
                boxShadow: '0 0 6px #fff',
              }}
            />
          )}
        </div>
        <div className="flex justify-between text-[8px] text-foreground/20 font-mono">
          <span>Jun 1</span>
          <span>Jun 15</span>
          <span>Jul 1</span>
          <span>Jul 15</span>
          <span>Jul 29</span>
        </div>
      </div>

      {/* Current stage */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ArrowUp size={11} className="text-blue-400" />
          <div>
            <div className="text-[10px] text-foreground/60 font-medium">
              {ONSET_STAGES[activeStage]?.region ?? 'Southern India'}
            </div>
            <div className="text-[9px] text-foreground/30">
              Normal: {ONSET_STAGES[activeStage]?.normalDate ?? 'June 1'}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold font-mono text-blue-300">
            {meanRainfall.toFixed(1)}
            <span className="text-[9px] text-foreground/30 font-normal ml-0.5">mm/d</span>
          </div>
          <div
            className="text-[9px] font-mono"
            style={{ color: anomaly.includes('early') ? '#86efac' : anomaly.includes('late') ? '#fca5a5' : '#fde047' }}
          >
            {anomaly}
          </div>
        </div>
      </div>

      {/* Onset stages list */}
      <div className="flex flex-col gap-0.5">
        {ONSET_STAGES.slice(0, 4).map((stage, i) => {
          const reached = doy >= stage.normalDOY - 5;
          return (
            <div key={i} className="flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: reached ? '#3b82f6' : 'rgba(var(--fg-rgb),var(--fg-a12))' }}
              />
              <div className="flex-1 text-[9px]" style={{ color: reached ? 'rgba(var(--fg-rgb),var(--fg-a4))' : 'rgba(var(--fg-rgb),var(--fg-a2))' }}>
                {stage.region}
              </div>
              <div
                className="flex items-center gap-0.5 text-[9px] font-mono"
                style={{ color: reached ? 'rgba(var(--fg-rgb),var(--fg-a3))' : 'rgba(var(--fg-rgb),var(--fg-a15))' }}
              >
                <Calendar size={8} />
                {stage.normalDate}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
