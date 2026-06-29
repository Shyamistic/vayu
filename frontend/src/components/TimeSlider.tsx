import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, addDays, addMonths, addYears } from 'date-fns';
import type { TimeState } from '../types';

interface TimeSliderProps {
  timeState: TimeState;
  onChange: (update: Partial<TimeState>) => void;
}

const MIN_DATE = new Date(2010, 0, 1);
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
  const sliderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const val = Number(e.target.value);
    // Debounce: only fire API call after 100ms pause in dragging
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    sliderDebounceRef.current = setTimeout(() => {
      onChange({ selectedDate: sliderValueToDate(val) });
    }, 100);
  };

  const dateLabel =
    granularity === 'daily'
      ? format(selectedDate, 'dd MMM yyyy')
      : granularity === 'monthly'
      ? format(selectedDate, 'MMM yyyy')
      : format(selectedDate, 'yyyy');

  return (
    <div className="panel px-3 py-1.5 flex flex-col gap-1 select-none animate-slide-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-white/80">
          <Calendar size={12} />
          <span className="text-xs font-medium">Timeline</span>
          <button
            onClick={() => onChange({ selectedDate: MAX_DATE })}
            className="text-[9px] px-1.5 py-0.5 rounded bg-vayu-blue/20 text-vayu-blue border border-vayu-blue/30 hover:bg-vayu-blue/30 transition-colors"
            title="Jump to latest available date"
          >
            Latest
          </button>
        </div>
        {/* Granularity selector */}
        <div className="flex gap-1">
          {(['daily', 'monthly', 'yearly'] as const).map((g) => (
            <button
              key={g}
              onClick={() => onChange({ granularity: g })}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
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
        <span className="text-base font-bold text-vayu-accent font-mono">
          {dateLabel}
        </span>
      </div>

      {/* Slider */}
      <div className="relative">
        {/* Visible track line (CSS pseudo-elements unreliable with appearance-none) */}
        <div className="absolute top-1/2 left-0 right-0 h-[5px] -translate-y-1/2 rounded-full pointer-events-none"
          style={{ background: 'linear-gradient(90deg, rgba(14,165,233,0.3), rgba(14,165,233,0.15))', marginTop: -8 }}
        />
        <input
          type="range"
          min={0}
          max={TOTAL_DAYS}
          value={sliderValue}
          onChange={handleSliderChange}
          className="relative w-full h-4 appearance-none bg-transparent cursor-pointer z-10
                     [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-vayu-blue [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(14,165,233,0.6)]
                     [&::-webkit-slider-runnable-track]:h-[5px] [&::-webkit-slider-runnable-track]:rounded-full
                     [&::-webkit-slider-runnable-track]:bg-white/20
                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-vayu-blue
                     [&::-moz-range-thumb]:border-0
                     [&::-moz-range-track]:h-[5px] [&::-moz-range-track]:rounded-full
                     [&::-moz-range-track]:bg-white/20"
        />
        {/* Range labels */}
        <div className="flex justify-between text-[10px] text-white/30 mt-0.5">
          <span>2010</span>
          <span>2015</span>
          <span>2020</span>
          <span>2025</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button onClick={() => step(-1)} className="btn-ghost p-1">
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => onChange({ isPlaying: !isPlaying })}
            className="btn-primary px-2.5 py-1 flex items-center gap-1"
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            <span className="text-xs">{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button onClick={() => step(1)} className="btn-ghost p-1">
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Playback speed */}
        <div className="flex items-center gap-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => onChange({ playbackSpeed: s })}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
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
