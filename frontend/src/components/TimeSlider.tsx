import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, addDays, addMonths, addYears } from 'date-fns';
import type { TimeState } from '../types';

interface TimeSliderProps {
  timeState: TimeState;
  onChange: (update: Partial<TimeState>) => void;
}

const MIN_DATE = new Date(1951, 0, 1);
const MAX_DATE = new Date(2025, 11, 31);
const TOTAL_DAYS = Math.floor(
  (MAX_DATE.getTime() - MIN_DATE.getTime()) / 86400000,
);

function dateToSliderValue(date: Date): number {
  return Math.floor((date.getTime() - MIN_DATE.getTime()) / 86400000);
}

function sliderValueToDate(val: number): Date {
  return new Date(MIN_DATE.getTime() + val * 86400000);
}

const SPEEDS = [0.5, 1, 2, 4];

export default function TimeSlider({ timeState, onChange }: TimeSliderProps) {
  const { selectedDate, granularity, isPlaying, playbackSpeed } = timeState;
  const animRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(Date.now());
  const currentDateRef = useRef<Date>(selectedDate);

  const sliderValue = dateToSliderValue(selectedDate);

  useEffect(() => {
    currentDateRef.current = selectedDate;
  }, [selectedDate]);

  // ── Playback animation ──────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastTickRef.current;
    lastTickRef.current = now;

    // At default speed (1×): advance 1 year per 2000ms
    // = 365 days / 2000ms * elapsed_ms * speed
    const daysPerMs = (365.25 * playbackSpeed) / 2000;
    const daysToAdvance = daysPerMs * elapsed;

    const newSlider = dateToSliderValue(currentDateRef.current) + daysToAdvance;
    if (newSlider >= TOTAL_DAYS) {
      onChange({ isPlaying: false });
    } else {
      onChange({ selectedDate: sliderValueToDate(Math.floor(newSlider)) });
    }

    animRef.current = requestAnimationFrame(tick);
  }, [playbackSpeed, onChange]);

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = Date.now();
      animRef.current = requestAnimationFrame(tick);
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isPlaying, tick]);

  // ── Step navigation ─────────────────────────────────────────────────────────
  const step = (direction: -1 | 1) => {
    onChange({
      selectedDate:
        granularity === 'daily'
          ? addDays(selectedDate, direction)
          : granularity === 'monthly'
          ? addMonths(selectedDate, direction)
          : addYears(selectedDate, direction),
    });
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ selectedDate: sliderValueToDate(Number(e.target.value)) });
  };

  const dateLabel =
    granularity === 'daily'
      ? format(selectedDate, 'dd MMM yyyy')
      : granularity === 'monthly'
      ? format(selectedDate, 'MMM yyyy')
      : format(selectedDate, 'yyyy');

  return (
    <div className="panel px-4 py-3 flex flex-col gap-3 select-none">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-white/80">
          <Calendar size={14} />
          <span className="text-sm font-medium">Timeline</span>
        </div>
        {/* Granularity selector */}
        <div className="flex gap-1">
          {(['daily', 'monthly', 'yearly'] as const).map((g) => (
            <button
              key={g}
              onClick={() => onChange({ granularity: g })}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                granularity === g
                  ? 'bg-vayu-blue text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Current date display */}
      <div className="text-center">
        <span className="text-2xl font-bold text-vayu-accent font-mono">
          {dateLabel}
        </span>
      </div>

      {/* Slider */}
      <div className="relative">
        <input
          type="range"
          min={0}
          max={TOTAL_DAYS}
          value={sliderValue}
          onChange={handleSliderChange}
          className="w-full h-1.5 appearance-none bg-white/10 rounded-full cursor-pointer
                     [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-vayu-blue [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-vayu-blue
                     [&::-moz-range-thumb]:border-0"
        />
        {/* Range labels */}
        <div className="flex justify-between text-xs text-white/30 mt-1">
          <span>1951</span>
          <span>1975</span>
          <span>2000</span>
          <span>2025</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => step(-1)} className="btn-ghost p-1.5">
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => onChange({ isPlaying: !isPlaying })}
            className="btn-primary px-3 py-1.5 flex items-center gap-1.5"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            <span className="text-sm">{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button onClick={() => step(1)} className="btn-ghost p-1.5">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Playback speed */}
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => onChange({ playbackSpeed: s })}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                playbackSpeed === s
                  ? 'bg-white/20 text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
