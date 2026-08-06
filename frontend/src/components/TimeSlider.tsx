import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';
import {
  format,
  addDays,
  addMonths,
  addYears,
  startOfMonth,
  endOfMonth,
  endOfYear,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  getDay,
} from 'date-fns';
import type { TimeState } from '../types';

interface TimeSliderProps {
  timeState: TimeState;
  onChange: (update: Partial<TimeState>) => void;
}

const MIN_DATE = new Date(2010, 0, 1);
const MAX_DATE = new Date(2025, 11, 31);
const YEARS = Array.from(
  { length: MAX_DATE.getFullYear() - MIN_DATE.getFullYear() + 1 },
  (_, i) => MIN_DATE.getFullYear() + i,
);

function dayIndex(date: Date, base: Date): number {
  return Math.floor((date.getTime() - base.getTime()) / 86400000);
}

function dayFromIndex(base: Date, idx: number): Date {
  return new Date(base.getTime() + idx * 86400000);
}

function clampDate(d: Date, min: Date, max: Date): Date {
  if (d < min) return min;
  if (d > max) return max;
  return d;
}

const SPEEDS = [0.5, 1, 2, 4];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function TimeSlider({ timeState, onChange }: TimeSliderProps) {
  const { selectedDate, granularity, isPlaying, playbackSpeed, rangeStart, rangeEnd } = timeState;
  const animRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(Date.now());
  const currentDateRef = useRef<Date>(selectedDate);
  const sliderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Playback/step/slider are bounded to a picked range when one is active,
  // otherwise the full 2010–2025 window — same math either way.
  const effectiveMin = rangeStart ?? MIN_DATE;
  const effectiveMax = rangeEnd ?? MAX_DATE;
  const totalDays = Math.max(1, dayIndex(effectiveMax, effectiveMin));
  const sliderValue = dayIndex(clampDate(selectedDate, effectiveMin, effectiveMax), effectiveMin);

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

    const newSlider = dayIndex(currentDateRef.current, effectiveMin) + daysToAdvance;
    if (newSlider >= totalDays) {
      onChange({ isPlaying: false, selectedDate: effectiveMax });
    } else {
      onChange({ selectedDate: dayFromIndex(effectiveMin, Math.floor(newSlider)) });
    }

    animRef.current = requestAnimationFrame(tick);
  }, [playbackSpeed, onChange, effectiveMin, effectiveMax, totalDays]);

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = Date.now();
      animRef.current = requestAnimationFrame(tick);
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isPlaying, tick]);

  // ── Step navigation (clamped to the active range, if any) ──────────────────
  const step = (direction: -1 | 1) => {
    const next =
      granularity === 'daily'
        ? addDays(selectedDate, direction)
        : granularity === 'monthly'
        ? addMonths(selectedDate, direction)
        : addYears(selectedDate, direction);
    onChange({ selectedDate: clampDate(next, effectiveMin, effectiveMax) });
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    // Debounce: only fire API call after 100ms pause in dragging
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    sliderDebounceRef.current = setTimeout(() => {
      onChange({ selectedDate: dayFromIndex(effectiveMin, val) });
    }, 100);
  };

  const dateLabel =
    granularity === 'daily'
      ? format(selectedDate, 'dd MMM yyyy')
      : granularity === 'monthly'
      ? format(selectedDate, 'MMM yyyy')
      : format(selectedDate, 'yyyy');

  const rangeLabel = rangeStart && rangeEnd
    ? granularity === 'daily'
      ? `${format(rangeStart, 'dd MMM yyyy')} → ${format(rangeEnd, 'dd MMM yyyy')}`
      : granularity === 'monthly'
      ? `${format(rangeStart, 'MMM yyyy')} → ${format(rangeEnd, 'MMM yyyy')}`
      : `${format(rangeStart, 'yyyy')} → ${format(rangeEnd, 'yyyy')}`
    : null;

  // ── Calendar popover ─────────────────────────────────────────────────────────
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'single' | 'range'>(rangeStart ? 'range' : 'single');
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [viewDate, setViewDate] = useState<Date>(selectedDate); // which month/year page is shown
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!calendarOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
        setPendingStart(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [calendarOpen]);

  const openCalendar = () => {
    setViewDate(selectedDate);
    setPendingStart(null);
    setPickerMode(rangeStart ? 'range' : 'single');
    setCalendarOpen((v) => !v);
  };

  const applySingle = (date: Date) => {
    const clamped = clampDate(date, MIN_DATE, MAX_DATE);
    onChange({ selectedDate: clamped, rangeStart: null, rangeEnd: null });
    setPendingStart(null);
    setCalendarOpen(false);
  };

  const applyRangeClick = (date: Date, normalizeEnd: (d: Date) => Date) => {
    if (!pendingStart) {
      setPendingStart(date);
      return;
    }
    let start = pendingStart;
    let end = date;
    if (end < start) [start, end] = [end, start];
    onChange({
      rangeStart: clampDate(start, MIN_DATE, MAX_DATE),
      rangeEnd: clampDate(normalizeEnd(end), MIN_DATE, MAX_DATE),
      selectedDate: clampDate(start, MIN_DATE, MAX_DATE),
    });
    setPendingStart(null);
    setHoverDate(null);
    setCalendarOpen(false);
  };

  const handleDayClick = (date: Date) => {
    if (pickerMode === 'single') applySingle(date);
    else applyRangeClick(date, (d) => d);
  };

  const handleMonthClick = (monthDate: Date) => {
    const start = startOfMonth(monthDate);
    if (pickerMode === 'single') applySingle(start);
    else applyRangeClick(start, (d) => endOfMonth(d));
  };

  const handleYearClick = (year: number) => {
    const start = new Date(year, 0, 1);
    if (pickerMode === 'single') applySingle(start);
    else applyRangeClick(start, (d) => endOfYear(d));
  };

  const clearRange = () => {
    onChange({ rangeStart: null, rangeEnd: null });
    setPendingStart(null);
  };

  const jumpToLatest = () => {
    onChange({ selectedDate: MAX_DATE, rangeStart: null, rangeEnd: null });
  };

  // Preview span while the first click of a range is pending and the user is
  // hovering a candidate second date — makes range selection legible instead
  // of a blind two-click gesture.
  const previewRange = pendingStart && hoverDate
    ? pendingStart <= hoverDate
      ? { start: pendingStart, end: hoverDate }
      : { start: hoverDate, end: pendingStart }
    : null;

  const isInCommittedRange = (d: Date) =>
    !!rangeStart && !!rangeEnd && isWithinInterval(d, { start: rangeStart, end: rangeEnd });
  const isInPreviewRange = (d: Date) =>
    !!previewRange && isWithinInterval(d, { start: previewRange.start, end: previewRange.end });

  // ── Grids ────────────────────────────────────────────────────────────────────
  const dayGrid = useMemo(() => {
    const monthStart = startOfMonth(viewDate);
    const monthEnd = endOfMonth(viewDate);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const leadingBlanks = getDay(monthStart);
    return { days, leadingBlanks };
  }, [viewDate]);

  const monthGrid = useMemo(
    () => Array.from({ length: 12 }, (_, i) => new Date(viewDate.getFullYear(), i, 1)),
    [viewDate.getFullYear()],
  );

  return (
    <div
      className="px-3 py-2 flex flex-col gap-1 select-none animate-slide-in-up rounded-xl"
      style={{
        background: 'rgba(var(--panel-bg-rgb),0.92)',
        border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-1.5">
        <div className="flex items-center gap-2 text-foreground/80">
          <Calendar size={12} />
          <span className="text-xs font-medium">Timeline</span>
          {rangeLabel && (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-vayu-blue/20 text-vayu-blue border border-vayu-blue/30">
              {rangeLabel}
              <button onClick={clearRange} title="Clear range" className="hover:text-foreground">
                <X size={10} />
              </button>
            </span>
          )}
          <button
            onClick={jumpToLatest}
            className="text-[9px] px-1.5 py-0.5 rounded bg-vayu-blue/20 text-vayu-blue border border-vayu-blue/30 hover:bg-vayu-blue/30 transition-colors"
            title="Jump to latest available date"
          >
            Latest
          </button>
        </div>
        {/* Granularity selector — also controls which grid the calendar shows */}
        <div className="flex gap-1">
          {(['daily', 'monthly', 'yearly'] as const).map((g) => (
            <button
              key={g}
              onClick={() => onChange({ granularity: g })}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                granularity === g
                  ? 'bg-vayu-blue text-foreground'
                  : 'text-foreground/40 hover:text-foreground/70'
              }`}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Current date display — click to open the calendar picker */}
      <div className="relative flex justify-center">
        <button
          onClick={openCalendar}
          className="text-base font-bold text-vayu-accent font-mono hover:opacity-80 transition-opacity px-2 rounded"
        >
          {dateLabel}
        </button>

        {calendarOpen && (
          <div
            ref={popoverRef}
            className="absolute bottom-full mb-2 z-50 w-[280px] rounded-xl p-3 flex flex-col gap-2 shadow-2xl"
            style={{
              background: 'rgba(var(--panel-bg-rgb),0.98)',
              border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
          >
            {/* Mode toggle */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {(['single', 'range'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setPickerMode(m); setPendingStart(null); }}
                    className={`text-[10px] px-2 py-0.5 rounded capitalize transition-colors ${
                      pickerMode === m
                        ? 'bg-vayu-blue text-foreground'
                        : 'text-foreground/40 hover:text-foreground/70'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button onClick={() => setCalendarOpen(false)} className="text-foreground/40 hover:text-foreground/80">
                <X size={13} />
              </button>
            </div>

            {/* Fixed height regardless of mode/pending-state so the grid below
                never reflows mid-selection — a shifting grid meant a second
                click could land on the wrong cell right after the first. */}
            <div className="h-3.5 text-[10px] text-foreground/50 text-center">
              {pickerMode === 'range' && (
                pendingStart
                  ? `Pick an end ${granularity === 'daily' ? 'date' : granularity === 'monthly' ? 'month' : 'year'}…`
                  : `Pick a start ${granularity === 'daily' ? 'date' : granularity === 'monthly' ? 'month' : 'year'}`
              )}
            </div>

            {/* Daily grid */}
            {granularity === 'daily' && (
              <>
                <div className="flex items-center justify-between">
                  <button onClick={() => setViewDate(addMonths(viewDate, -1))} className="btn-ghost p-1">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs font-medium text-foreground/80">{format(viewDate, 'MMMM yyyy')}</span>
                  <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="btn-ghost p-1">
                    <ChevronRight size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {WEEKDAY_LABELS.map((w, i) => (
                    <span key={i} className="text-[9px] text-foreground/40">{w}</span>
                  ))}
                  {Array.from({ length: dayGrid.leadingBlanks }).map((_, i) => <span key={`b${i}`} />)}
                  {dayGrid.days.map((d) => {
                    const outOfBounds = d < MIN_DATE || d > MAX_DATE;
                    const selected = pickerMode === 'single'
                      ? isSameDay(d, selectedDate)
                      : pendingStart
                        ? isSameDay(d, pendingStart)
                        : isInCommittedRange(d);
                    const inPreview = pickerMode === 'range' && isInPreviewRange(d);
                    return (
                      <button
                        key={d.toISOString()}
                        disabled={outOfBounds}
                        onClick={() => handleDayClick(d)}
                        onMouseEnter={() => setHoverDate(d)}
                        className={`text-[10px] py-1 rounded transition-colors ${
                          outOfBounds
                            ? 'text-foreground/15 cursor-not-allowed'
                            : selected
                            ? 'bg-vayu-blue text-foreground font-semibold'
                            : inPreview
                            ? 'bg-vayu-blue/25 text-foreground'
                            : 'text-foreground/70 hover:bg-foreground/10'
                        }`}
                      >
                        {format(d, 'd')}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Monthly grid */}
            {granularity === 'monthly' && (
              <>
                <div className="flex items-center justify-between">
                  <button onClick={() => setViewDate(addYears(viewDate, -1))} className="btn-ghost p-1">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs font-medium text-foreground/80">{format(viewDate, 'yyyy')}</span>
                  <button onClick={() => setViewDate(addYears(viewDate, 1))} className="btn-ghost p-1">
                    <ChevronRight size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {monthGrid.map((m) => {
                    const outOfBounds = endOfMonth(m) < MIN_DATE || startOfMonth(m) > MAX_DATE;
                    const selected = pickerMode === 'single'
                      ? isSameMonth(m, selectedDate)
                      : pendingStart
                        ? isSameMonth(m, pendingStart)
                        : isInCommittedRange(m);
                    const inPreview = pickerMode === 'range' && isInPreviewRange(m);
                    return (
                      <button
                        key={m.toISOString()}
                        disabled={outOfBounds}
                        onClick={() => handleMonthClick(m)}
                        onMouseEnter={() => setHoverDate(m)}
                        className={`text-[10px] py-2 rounded transition-colors ${
                          outOfBounds
                            ? 'text-foreground/15 cursor-not-allowed'
                            : selected
                            ? 'bg-vayu-blue text-foreground font-semibold'
                            : inPreview
                            ? 'bg-vayu-blue/25 text-foreground'
                            : 'text-foreground/70 hover:bg-foreground/10'
                        }`}
                      >
                        {format(m, 'MMM')}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Yearly grid — small enough range (2010–2025) to show in full, no paging */}
            {granularity === 'yearly' && (
              <div className="grid grid-cols-4 gap-1">
                {YEARS.map((y) => {
                  const yearStart = new Date(y, 0, 1);
                  const selected = pickerMode === 'single'
                    ? y === selectedDate.getFullYear()
                    : pendingStart
                      ? y === pendingStart.getFullYear()
                      : isInCommittedRange(yearStart);
                  const inPreview = pickerMode === 'range' && isInPreviewRange(yearStart);
                  return (
                    <button
                      key={y}
                      onClick={() => handleYearClick(y)}
                      onMouseEnter={() => setHoverDate(yearStart)}
                      className={`text-[10px] py-2 rounded transition-colors ${
                        selected
                          ? 'bg-vayu-blue text-foreground font-semibold'
                          : inPreview
                          ? 'bg-vayu-blue/25 text-foreground'
                          : 'text-foreground/70 hover:bg-foreground/10'
                      }`}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Slider — bounded to the active range when one is set */}
      <div className="relative">
        {/* Visible track line (CSS pseudo-elements unreliable with appearance-none) */}
        <div className="absolute top-1/2 left-0 right-0 h-[5px] -translate-y-1/2 rounded-full pointer-events-none"
          style={{ background: 'linear-gradient(90deg, rgba(14,165,233,0.3), rgba(14,165,233,0.15))', marginTop: -8 }}
        />
        <input
          type="range"
          min={0}
          max={totalDays}
          value={sliderValue}
          onChange={handleSliderChange}
          className="relative w-full h-4 appearance-none bg-transparent cursor-pointer z-10
                     [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-vayu-blue [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(14,165,233,0.6)]
                     [&::-webkit-slider-runnable-track]:h-[5px] [&::-webkit-slider-runnable-track]:rounded-full
                     [&::-webkit-slider-runnable-track]:bg-foreground/20
                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-vayu-blue
                     [&::-moz-range-thumb]:border-0
                     [&::-moz-range-track]:h-[5px] [&::-moz-range-track]:rounded-full
                     [&::-moz-range-track]:bg-foreground/20"
        />
        {/* Range labels — reflect the active bounds, not always 2010–2025.
            A short bounded range (e.g. a 12-day pick) would otherwise show
            the same year four times, so the label precision scales with
            how much time the bounds actually span. */}
        <div className="flex justify-between text-[10px] text-foreground/30 mt-0.5">
          {(() => {
            const boundsFormat = totalDays <= 60 ? 'dd MMM' : totalDays <= 730 ? 'MMM yyyy' : 'yyyy';
            return [0, 0.33, 0.66, 1].map((frac) => (
              <span key={frac}>
                {format(dayFromIndex(effectiveMin, Math.floor(totalDays * frac)), boundsFormat)}
              </span>
            ));
          })()}
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
                  ? 'bg-foreground/20 text-foreground'
                  : 'text-foreground/40 hover:text-foreground/60'
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
