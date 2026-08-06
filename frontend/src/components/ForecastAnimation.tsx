/**
 * ForecastAnimation — Feature 19
 * Auto-plays through T+1 to T+7 forecast days with animated transitions.
 * Shows a mini 7-day timeline with day labels and speed control.
 */
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack } from 'lucide-react';

interface ForecastAnimationProps {
  currentDay: number;
  onDayChange: (day: number) => void;
}

const SPEEDS = [
  { label: '1s', ms: 1000 },
  { label: '2s', ms: 2000 },
  { label: '3s', ms: 3000 },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ForecastAnimation({ currentDay, onDayChange }: ForecastAnimationProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentDayRef = useRef(currentDay);

  // Keep ref in sync so the interval always reads the latest value
  useEffect(() => { currentDayRef.current = currentDay; }, [currentDay]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isPlaying) return;

    timerRef.current = setInterval(() => {
      const next = currentDayRef.current + 1;
      if (next > 7) {
        setIsPlaying(false);
        onDayChange(1);
      } else {
        onDayChange(next);
      }
    }, SPEEDS[speedIdx].ms);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, speedIdx, onDayChange]);

  const toggle = () => {
    if (currentDay >= 7 && !isPlaying) onDayChange(1);
    setIsPlaying((p) => !p);
  };

  return (
    <div
      className="px-2 py-1.5 flex flex-col gap-1.5 animate-slide-in-up rounded-xl"
      style={{
        minWidth: 180,
        background: 'rgba(var(--panel-bg-rgb),0.92)',
        border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Day timeline */}
      <div className="flex gap-1">
        {Array.from({ length: 7 }, (_, i) => i + 1).map((day) => (
          <button
            key={day}
            onClick={() => { onDayChange(day); setIsPlaying(false); }}
            className="flex-1 flex flex-col items-center py-1 rounded-md transition-all duration-200"
            style={{
              background: currentDay === day
                ? 'rgba(14,165,233,0.25)'
                : 'rgba(var(--fg-rgb),var(--fg-a05))',
              border: currentDay === day
                ? '1px solid rgba(14,165,233,0.5)'
                : '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
              boxShadow: currentDay === day ? '0 0 8px rgba(14,165,233,0.3)' : 'none',
            }}
          >
            <span className="text-[9px] text-foreground/40">{DAY_LABELS[day - 1]}</span>
            <span
              className="text-xs font-bold font-mono"
              style={{ color: currentDay === day ? '#38bdf8' : 'rgba(var(--fg-rgb),var(--fg-a6))' }}
            >
              T+{day}
            </span>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { onDayChange(1); setIsPlaying(false); }}
          className="p-1.5 rounded text-foreground/40 hover:text-foreground/80 hover:bg-foreground/5 transition-all"
        >
          <SkipBack size={12} />
        </button>
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all"
          style={{
            background: isPlaying ? 'rgba(14,165,233,0.25)' : 'rgba(var(--fg-rgb),var(--fg-a08))',
            border: isPlaying ? '1px solid rgba(14,165,233,0.4)' : '1px solid rgba(var(--fg-rgb),var(--fg-a1))',
            color: isPlaying ? '#38bdf8' : 'rgba(var(--fg-rgb),var(--fg-a7))',
          }}
        >
          {isPlaying ? <Pause size={11} /> : <Play size={11} />}
          {isPlaying ? 'Pause' : 'Animate'}
        </button>

        {/* Speed */}
        <div className="flex gap-0.5 ml-auto">
          {SPEEDS.map((s, i) => (
            <button
              key={i}
              onClick={() => setSpeedIdx(i)}
              className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: speedIdx === i ? 'rgba(14,165,233,0.2)' : 'transparent',
                color: speedIdx === i ? '#38bdf8' : 'rgba(var(--fg-rgb),var(--fg-a3))',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 rounded-full bg-foreground/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${((currentDay - 1) / 6) * 100}%`,
            background: 'linear-gradient(90deg, #0ea5e9, #22d3ee)',
          }}
        />
      </div>
    </div>
  );
}
