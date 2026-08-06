/**
 * HistoricalReplay — Historical Extreme Weather Event Replay.
 *
 * Exports pure functions for skill score computation (testable), plus a
 * React component providing:
 *  1. Pre-loaded library of 5+ extreme weather events (cyclones, floods,
 *     heat waves, droughts, storm surges)
 *  2. Split-view display showing observed data vs model predictions
 *  3. Event-specific skill scores: Hit Rate, False Alarm Rate (FAR), CSI
 *  4. Timeline slider to animate event progression day by day
 *
 * Validates: Requirements 37.1, 37.2, 37.3, 37.4
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { GlassPanel } from '../../design-system';
import type { GridCell } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Category of extreme weather event */
export type EventCategory = 'cyclone' | 'flood' | 'heatwave' | 'drought' | 'storm_surge';

/** A single time-step snapshot within an historical event */
export interface EventSnapshot {
  /** Day offset from event start (0-indexed) */
  day: number;
  /** ISO date string for this snapshot */
  date: string;
  /** Observed grid cells for this day */
  observed: GridCell[];
  /** Model-predicted grid cells for this day */
  predicted: GridCell[];
}

/** Full historical extreme event record (Requirement 37.1) */
export interface HistoricalEvent {
  id: string;
  name: string;
  category: EventCategory;
  /** Brief description shown in the event card */
  description: string;
  /** ISO start date of the event */
  startDate: string;
  /** ISO end date of the event */
  endDate: string;
  /** Geographic centre of the event for globe fly-to */
  centreLat: number;
  centreLon: number;
  /** Duration in days */
  durationDays: number;
  /** Day-by-day snapshots */
  snapshots: EventSnapshot[];
  /** Peak statistic (e.g. "max rainfall 320 mm/day") */
  peakStat: string;
  /** Region label */
  region: string;
}

/** Contingency table counts for binary event verification */
export interface ContingencyTable {
  /** Hits: predicted yes, observed yes */
  hits: number;
  /** Misses: predicted no, observed yes */
  misses: number;
  /** False alarms: predicted yes, observed no */
  falseAlarms: number;
  /** Correct negatives: predicted no, observed no */
  correctNegatives: number;
}

/** Skill scores derived from a contingency table (Requirement 37.3) */
export interface SkillScores {
  /** Probability of Detection = hits / (hits + misses) */
  hitRate: number;
  /** False Alarm Ratio = falseAlarms / (hits + falseAlarms) */
  far: number;
  /** Critical Success Index = hits / (hits + misses + falseAlarms) */
  csi: number;
  /** Gilbert Skill Score (Equitable Threat Score) */
  gss: number;
}

// ── Pure Skill-Score Functions (exported for testing) ─────────────────────────

/**
 * Build a binary contingency table from two sets of grid cells.
 *
 * A cell is "event" (threshold exceeded) when the variable value ≥ `threshold`.
 * Cells are matched by lat/lon proximity within `snapDeg` degrees.
 *
 * Requirement 37.3: compute hit rate, FAR, CSI.
 */
export function buildContingencyTable(
  observed: GridCell[],
  predicted: GridCell[],
  variable: keyof Pick<GridCell, 'rainfall' | 'temp_max' | 'temp_min'>,
  threshold: number,
  snapDeg = 0.25,
): ContingencyTable {
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  let correctNegatives = 0;

  // Index predicted cells by rounded lat/lon key for O(1) lookup
  const predMap = new Map<string, GridCell>();
  for (const p of predicted) {
    const key = `${Math.round(p.lat / snapDeg)}:${Math.round(p.lon / snapDeg)}`;
    predMap.set(key, p);
  }

  for (const obs of observed) {
    const key = `${Math.round(obs.lat / snapDeg)}:${Math.round(obs.lon / snapDeg)}`;
    const pred = predMap.get(key);
    const obsEvent = obs[variable] >= threshold;
    const predEvent = pred !== undefined && pred[variable] >= threshold;

    if (obsEvent && predEvent) hits++;
    else if (obsEvent && !predEvent) misses++;
    else if (!obsEvent && predEvent) falseAlarms++;
    else correctNegatives++;
  }

  return { hits, misses, falseAlarms, correctNegatives };
}

/**
 * Compute Hit Rate (Probability of Detection).
 * HR = hits / (hits + misses)
 * Returns NaN when (hits + misses) === 0 (no observed events).
 *
 * Requirement 37.3
 */
export function computeHitRate(ct: ContingencyTable): number {
  const denom = ct.hits + ct.misses;
  return denom === 0 ? NaN : ct.hits / denom;
}

/**
 * Compute False Alarm Ratio.
 * FAR = falseAlarms / (hits + falseAlarms)
 * Returns NaN when (hits + falseAlarms) === 0 (no predicted events).
 *
 * Requirement 37.3
 */
export function computeFAR(ct: ContingencyTable): number {
  const denom = ct.hits + ct.falseAlarms;
  return denom === 0 ? NaN : ct.falseAlarms / denom;
}

/**
 * Compute Critical Success Index (Threat Score).
 * CSI = hits / (hits + misses + falseAlarms)
 * Returns NaN when all three are 0.
 *
 * Requirement 37.3
 */
export function computeCSI(ct: ContingencyTable): number {
  const denom = ct.hits + ct.misses + ct.falseAlarms;
  return denom === 0 ? NaN : ct.hits / denom;
}

/**
 * Compute Gilbert Skill Score (Equitable Threat Score).
 * GSS = (hits - hits_random) / (hits + misses + falseAlarms - hits_random)
 * where hits_random = (hits + misses)(hits + falseAlarms) / total
 *
 * Requirement 37.3 (additional skill context)
 */
export function computeGSS(ct: ContingencyTable): number {
  const total = ct.hits + ct.misses + ct.falseAlarms + ct.correctNegatives;
  if (total === 0) return NaN;
  const hitsRandom =
    ((ct.hits + ct.misses) * (ct.hits + ct.falseAlarms)) / total;
  const denom = ct.hits + ct.misses + ct.falseAlarms - hitsRandom;
  return denom === 0 ? NaN : (ct.hits - hitsRandom) / denom;
}

/**
 * Compute all four skill scores from a contingency table.
 *
 * Requirement 37.3
 */
export function computeSkillScores(ct: ContingencyTable): SkillScores {
  return {
    hitRate: computeHitRate(ct),
    far: computeFAR(ct),
    csi: computeCSI(ct),
    gss: computeGSS(ct),
  };
}

// ── Helper: generate synthetic grid cells for mock events ────────────────────

/** Generate a small grid of synthetic cells centred at (lat0, lon0). */
function syntheticGrid(
  lat0: number,
  lon0: number,
  rows = 5,
  cols = 5,
  rainfallBase = 0,
  tempMaxBase = 35,
  tempMinBase = 24,
  seed = 1,
): GridCell[] {
  const cells: GridCell[] = [];
  let rng = seed;
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff;
    return (rng >>> 0) / 0xffffffff;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = +(lat0 + (r - Math.floor(rows / 2)) * 0.25).toFixed(2);
      const lon = +(lon0 + (c - Math.floor(cols / 2)) * 0.25).toFixed(2);
      cells.push({
        lat,
        lon,
        node_idx: r * cols + c,
        rainfall: +(rainfallBase + rand() * 80).toFixed(1),
        temp_max: +(tempMaxBase + (rand() - 0.5) * 4).toFixed(1),
        temp_min: +(tempMinBase + (rand() - 0.5) * 3).toFixed(1),
        rainfall_uncertainty: +(rand() * 10).toFixed(1),
        temp_max_uncertainty: +(rand() * 1.5).toFixed(2),
        temp_min_uncertainty: +(rand() * 1).toFixed(2),
      });
    }
  }
  return cells;
}

/** Build N snapshots for a mock event starting at startDate. */
function buildSnapshots(
  startDate: string,
  days: number,
  centreLat: number,
  centreLon: number,
  rainfallPeak: number,
  tempMaxBase: number,
): EventSnapshot[] {
  const snapshots: EventSnapshot[] = [];
  const start = new Date(startDate);
  for (let d = 0; d < days; d++) {
    const date = new Date(start);
    date.setDate(start.getDate() + d);
    const iso = date.toISOString().slice(0, 10);
    const factor = Math.sin((d / (days - 1)) * Math.PI); // bell curve intensity
    const rainBase = rainfallPeak * factor;
    snapshots.push({
      day: d,
      date: iso,
      observed: syntheticGrid(centreLat, centreLon, 5, 5, rainBase * 0.95, tempMaxBase, 24, d * 7 + 1),
      predicted: syntheticGrid(centreLat, centreLon, 5, 5, rainBase, tempMaxBase, 24, d * 7 + 13),
    });
  }
  return snapshots;
}

// ── Pre-loaded Extreme Events Library (Requirement 37.1) ─────────────────────

/**
 * Library of 6 pre-loaded historical extreme weather events covering India.
 * Each event has observed data and model predictions for split-view replay.
 *
 * Requirement 37.1: library of extreme events (cyclones, floods, heat waves,
 * droughts).
 */
export const HISTORICAL_EVENTS: HistoricalEvent[] = [
  {
    id: 'cyclone-biparjoy-2023',
    name: 'Cyclone Biparjoy',
    category: 'cyclone',
    description:
      'Very Severe Cyclonic Storm that made landfall near Jakhau Port, Gujarat on 15 June 2023 with 115 km/h winds.',
    startDate: '2023-06-08',
    endDate: '2023-06-18',
    centreLat: 23.1,
    centreLon: 68.5,
    durationDays: 11,
    snapshots: buildSnapshots('2023-06-08', 11, 23.1, 68.5, 220, 38),
    peakStat: '115 km/h winds, 220 mm peak rainfall',
    region: 'Gujarat / Arabian Sea',
  },
  {
    id: 'kerala-floods-2018',
    name: 'Kerala Floods 2018',
    category: 'flood',
    description:
      'Worst floods in Kerala in nearly a century. Over 480 people lost their lives and 1.5 million were displaced.',
    startDate: '2018-08-08',
    endDate: '2018-08-20',
    centreLat: 10.5,
    centreLon: 76.2,
    durationDays: 13,
    snapshots: buildSnapshots('2018-08-08', 13, 10.5, 76.2, 320, 32),
    peakStat: '320 mm/day max rainfall; 5.4 crore affected',
    region: 'Kerala / Western Ghats',
  },
  {
    id: 'heatwave-rajasthan-2022',
    name: 'Rajasthan Heat Wave 2022',
    category: 'heatwave',
    description:
      'Record-breaking heat wave over Northwest India with Barmer recording 50.8°C on 28 May 2022.',
    startDate: '2022-05-22',
    endDate: '2022-05-30',
    centreLat: 26.0,
    centreLon: 71.5,
    durationDays: 9,
    snapshots: buildSnapshots('2022-05-22', 9, 26.0, 71.5, 5, 48),
    peakStat: '50.8°C max temperature (Barmer)',
    region: 'Rajasthan / Northwest India',
  },
  {
    id: 'drought-vidarbha-2019',
    name: 'Vidarbha Drought 2019',
    category: 'drought',
    description:
      'Severe drought across Vidarbha and Marathwada, Maharashtra with June–September 2019 rainfall deficit of 35–50%.',
    startDate: '2019-06-01',
    endDate: '2019-09-30',
    centreLat: 20.5,
    centreLon: 78.5,
    durationDays: 10,
    snapshots: buildSnapshots('2019-06-01', 10, 20.5, 78.5, 12, 42),
    peakStat: '50% rainfall deficit; SPI-3 of −2.1',
    region: 'Vidarbha / Marathwada, Maharashtra',
  },
  {
    id: 'cyclone-amphan-2020',
    name: 'Super Cyclone Amphan',
    category: 'cyclone',
    description:
      'Super Cyclonic Storm Amphan made landfall near Sagar Island, West Bengal on 20 May 2020 — the strongest cyclone in the Bay of Bengal since 1999.',
    startDate: '2020-05-16',
    endDate: '2020-05-22',
    centreLat: 22.0,
    centreLon: 88.5,
    durationDays: 7,
    snapshots: buildSnapshots('2020-05-16', 7, 22.0, 88.5, 280, 34),
    peakStat: '185 km/h winds; ₹1 lakh crore damage',
    region: 'West Bengal / Bay of Bengal',
  },
  {
    id: 'assam-floods-2022',
    name: 'Assam Floods 2022',
    category: 'flood',
    description:
      'Pre-monsoon and monsoon floods in Assam submerged 5,500+ villages across 32 districts affecting over 5.4 million people.',
    startDate: '2022-06-14',
    endDate: '2022-06-26',
    centreLat: 26.2,
    centreLon: 92.8,
    durationDays: 13,
    snapshots: buildSnapshots('2022-06-14', 13, 26.2, 92.8, 300, 30),
    peakStat: '300 mm/day, 5.4 million affected',
    region: 'Assam / Northeast India',
  },
];

// ── Constants ─────────────────────────────────────────────────────────────────

/** Variable and threshold used for contingency-table scoring per category */
export const EVENT_SCORING_CONFIG: Record<
  EventCategory,
  { variable: keyof Pick<GridCell, 'rainfall' | 'temp_max' | 'temp_min'>; threshold: number }
> = {
  cyclone:     { variable: 'rainfall',  threshold: 64.5 },  // Heavy rain IMD classification
  flood:       { variable: 'rainfall',  threshold: 64.5 },
  heatwave:    { variable: 'temp_max',  threshold: 40.0 },
  drought:     { variable: 'rainfall',  threshold: 2.5  },  // Below "light rain"
  storm_surge: { variable: 'rainfall',  threshold: 115.6 }, // Very heavy rain
};

/** Category visual config */
export const CATEGORY_CONFIG: Record<
  EventCategory,
  { icon: string; color: string; label: string }
> = {
  cyclone:     { icon: '🌀', color: '#818cf8', label: 'Cyclone' },
  flood:       { icon: '🌊', color: '#38bdf8', label: 'Flood' },
  heatwave:    { icon: '🌡️',  color: '#fb923c', label: 'Heat Wave' },
  drought:     { icon: '🏜️',  color: '#ca8a04', label: 'Drought' },
  storm_surge: { icon: '⛈️',  color: '#a78bfa', label: 'Storm Surge' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Format a skill score number for display */
function fmtScore(v: number): string {
  if (isNaN(v)) return 'N/A';
  return (v * 100).toFixed(1) + '%';
}

/** Color for a skill score where higher is better (or lower for FAR) */
function scoreColor(v: number, invert = false): string {
  if (isNaN(v)) return 'rgba(var(--fg-rgb),var(--fg-a3))';
  const good = invert ? v < 0.3 : v > 0.6;
  const ok   = invert ? v < 0.5 : v > 0.35;
  if (good) return '#4ade80';
  if (ok)   return '#facc15';
  return '#f87171';
}

const SkillScoreBar: React.FC<{
  label: string;
  value: number;
  invert?: boolean;
  tooltip: string;
}> = ({ label, value, invert = false, tooltip }) => {
  const color = scoreColor(value, invert);
  const pct = isNaN(value) ? 0 : Math.min(100, Math.abs(value) * 100);
  return (
    <div
      title={tooltip}
      style={{ marginBottom: '8px' }}
      aria-label={`${label}: ${fmtScore(value)}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '11px' }}>
        <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a7))' }}>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{fmtScore(value)}</span>
      </div>
      <div style={{ height: '4px', background: 'rgba(var(--fg-rgb),var(--fg-a08))', borderRadius: '2px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: '2px',
            transition: 'width 400ms ease',
          }}
        />
      </div>
    </div>
  );
};

/** Small grid cell heat-map view for split-view panel */
const GridMiniMap: React.FC<{
  cells: GridCell[];
  variable: keyof Pick<GridCell, 'rainfall' | 'temp_max' | 'temp_min'>;
  label: string;
  accentColor: string;
}> = ({ cells, variable, label, accentColor }) => {
  if (cells.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '16px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', fontSize: '11px' }}>
        No data
      </div>
    );
  }

  const values = cells.map((c) => c[variable] as number);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Normalize lat/lon to a small grid display
  const lats = [...new Set(cells.map((c) => c.lat))].sort((a, b) => b - a);
  const lons = [...new Set(cells.map((c) => c.lon))].sort((a, b) => a - b);
  const cellMap = new Map(cells.map((c) => [`${c.lat}:${c.lon}`, c]));

  const cellSizePx = Math.max(8, Math.floor(100 / Math.max(lons.length, lats.length, 1)));

  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: accentColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ display: 'inline-block', lineHeight: 0 }}>
        {lats.map((lat) => (
          <div key={lat} style={{ display: 'flex' }}>
            {lons.map((lon) => {
              const cell = cellMap.get(`${lat}:${lon}`);
              const val = cell ? (cell[variable] as number) : 0;
              const t = (val - minVal) / range;
              const r = Math.round(t * 255);
              const b = Math.round((1 - t) * 180);
              const bg = variable === 'rainfall'
                ? `rgb(${Math.round((1 - t) * 10)},${Math.round(t * 120 + 80)},${Math.round(t * 255)})`
                : `rgb(${Math.round(t * 255)},${Math.round((1 - t) * 100 + 50)},${b})`;
              return (
                <div
                  key={lon}
                  title={`${lat}°N ${lon}°E: ${val.toFixed(1)}`}
                  style={{
                    width: cellSizePx,
                    height: cellSizePx,
                    background: cell ? bg : 'rgba(var(--fg-rgb),var(--fg-a05))',
                    border: '1px solid rgba(0,0,0,0.2)',
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', marginTop: '3px' }}>
        <span>{minVal.toFixed(1)}</span>
        <span>{variable === 'rainfall' ? 'mm/day' : '°C'}</span>
        <span>{maxVal.toFixed(1)}</span>
      </div>
    </div>
  );
};

/** Event library card */
const EventCard: React.FC<{
  event: HistoricalEvent;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ event, isSelected, onSelect }) => {
  const cfg = CATEGORY_CONFIG[event.category];
  return (
    <button
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-label={`Select event: ${event.name}`}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: isSelected ? `${cfg.color}18` : 'rgba(var(--fg-rgb),var(--fg-a05))',
        border: `1px solid ${isSelected ? cfg.color : 'rgba(var(--fg-rgb),var(--fg-a08))'}`,
        borderRadius: '8px',
        padding: '8px 10px',
        cursor: 'pointer',
        marginBottom: '6px',
        transition: 'all 150ms ease',
      }}
      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--fg-rgb),var(--fg-a05))'; }}
      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--fg-rgb),var(--fg-a05))'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        <span style={{ fontSize: '15px' }} aria-hidden="true">{cfg.icon}</span>
        <span style={{ color: 'rgba(var(--fg-rgb),var(--fg-a75))', fontWeight: 600, fontSize: '12px', flex: 1 }}>
          {event.name}
        </span>
        <span
          style={{
            fontSize: '9px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: cfg.color,
            background: `${cfg.color}20`,
            border: `1px solid ${cfg.color}40`,
            borderRadius: '3px',
            padding: '1px 5px',
          }}
        >
          {cfg.label}
        </span>
      </div>
      <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '2px' }}>
        {event.startDate} → {event.endDate} · {event.durationDays}d · {event.region}
      </div>
      <div style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a6))' }}>{event.peakStat}</div>
    </button>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface HistoricalReplayProps {
  /** Whether the panel is rendered */
  enabled?: boolean;
  /** Injected custom events (for testing / extension) */
  events?: HistoricalEvent[];
  /**
   * Fired when a snapshot changes so the host globe can update its view.
   * Requirement 37.2: load observed + predicted in split-view.
   */
  onSnapshotChange?: (event: HistoricalEvent, snapshot: EventSnapshot) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * HistoricalReplay — Historical Extreme Weather Event Replay panel.
 *
 * Validates: Requirements 37.1, 37.2, 37.3, 37.4
 */
export const HistoricalReplay: React.FC<HistoricalReplayProps> = ({
  enabled = true,
  events = HISTORICAL_EVENTS,
  onSnapshotChange,
}) => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [currentDay, setCurrentDay] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1); // seconds per day
  const [displayVariable, setDisplayVariable] = useState<
    keyof Pick<GridCell, 'rainfall' | 'temp_max' | 'temp_min'>
  >('rainfall');
  const [filterCategory, setFilterCategory] = useState<EventCategory | 'all'>('all');
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const filteredEvents = useMemo(
    () => (filterCategory === 'all' ? events : events.filter((e) => e.category === filterCategory)),
    [events, filterCategory],
  );

  const currentSnapshot = useMemo(
    () => selectedEvent?.snapshots[currentDay] ?? null,
    [selectedEvent, currentDay],
  );

  // Skill scores for the current snapshot
  const skillScores = useMemo<SkillScores | null>(() => {
    if (!currentSnapshot || !selectedEvent) return null;
    const cfg = EVENT_SCORING_CONFIG[selectedEvent.category];
    const ct = buildContingencyTable(
      currentSnapshot.observed,
      currentSnapshot.predicted,
      cfg.variable,
      cfg.threshold,
    );
    return computeSkillScores(ct);
  }, [currentSnapshot, selectedEvent]);

  // Aggregate skill scores over ALL days of selected event
  const aggregateSkillScores = useMemo<SkillScores | null>(() => {
    if (!selectedEvent) return null;
    const cfg = EVENT_SCORING_CONFIG[selectedEvent.category];
    let aggHits = 0, aggMisses = 0, aggFA = 0, aggCN = 0;
    for (const snap of selectedEvent.snapshots) {
      const ct = buildContingencyTable(snap.observed, snap.predicted, cfg.variable, cfg.threshold);
      aggHits += ct.hits;
      aggMisses += ct.misses;
      aggFA += ct.falseAlarms;
      aggCN += ct.correctNegatives;
    }
    return computeSkillScores({ hits: aggHits, misses: aggMisses, falseAlarms: aggFA, correctNegatives: aggCN });
  }, [selectedEvent]);

  // Notify host on snapshot change (Requirement 37.2)
  useEffect(() => {
    if (selectedEvent && currentSnapshot && onSnapshotChange) {
      onSnapshotChange(selectedEvent, currentSnapshot);
    }
  }, [selectedEvent, currentSnapshot, onSnapshotChange]);

  // Playback engine (Requirement 37.4)
  const stopPlayback = useCallback(() => {
    if (playIntervalRef.current !== null) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (!selectedEvent) return;
    setIsPlaying(true);
    playIntervalRef.current = setInterval(() => {
      setCurrentDay((prev) => {
        const next = prev + 1;
        if (next >= selectedEvent.durationDays) {
          stopPlayback();
          return prev;
        }
        return next;
      });
    }, playSpeed * 1000);
  }, [selectedEvent, playSpeed, stopPlayback]);

  // Clean up on unmount or event change
  useEffect(() => {
    return () => stopPlayback();
  }, [stopPlayback]);

  const handleEventSelect = useCallback(
    (id: string) => {
      stopPlayback();
      setSelectedEventId((prev) => (prev === id ? null : id));
      setCurrentDay(0);
    },
    [stopPlayback],
  );

  if (!enabled) return null;

  const cfg = selectedEvent ? CATEGORY_CONFIG[selectedEvent.category] : null;

  return (
    <div
      className="historical-replay"
      data-testid="historical-replay"
      role="region"
      aria-label="Historical Event Replay"
    >
      {/* ── Category filter bar ── */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        {(['all', 'cyclone', 'flood', 'heatwave', 'drought'] as const).map((cat) => {
          const catCfg = cat !== 'all' ? CATEGORY_CONFIG[cat] : null;
          const isActive = filterCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              aria-pressed={isActive}
              style={{
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '3px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                border: `1px solid ${isActive ? (catCfg?.color ?? '#60a5fa') : 'rgba(var(--fg-rgb),var(--fg-a15))'}`,
                background: isActive ? `${catCfg?.color ?? '#60a5fa'}20` : 'transparent',
                color: isActive ? (catCfg?.color ?? '#60a5fa') : 'rgba(var(--fg-rgb),var(--fg-a4))',
                transition: 'all 150ms ease',
              }}
            >
              {catCfg ? `${catCfg.icon} ${catCfg.label}` : '⚡ All'}
            </button>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))', alignSelf: 'center' }}>
          {filteredEvents.length} events
        </span>
      </div>

      {/* ── Event library ── */}
      <GlassPanel padding="sm" className="event-library">
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'rgba(var(--fg-rgb),var(--fg-a4))',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '8px',
          }}
        >
          📚 Extreme Events Library
        </div>
        <div style={{ maxHeight: '220px', overflowY: 'auto', paddingRight: '2px' }}>
          {filteredEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSelected={selectedEventId === event.id}
              onSelect={() => handleEventSelect(event.id)}
            />
          ))}
        </div>
      </GlassPanel>

      {/* ── Replay panel (shown when an event is selected) ── */}
      {selectedEvent && cfg && (
        <div style={{ marginTop: '10px' }}>

          {/* ── Timeline slider (Requirement 37.4) ── */}
          <GlassPanel padding="sm" className="timeline-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px' }} aria-hidden="true">{cfg.icon}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(var(--fg-rgb),var(--fg-a75))', flex: 1 }}>
                {selectedEvent.name}
              </span>
              <span style={{ fontSize: '10px', color: cfg.color }}>
                Day {currentDay + 1} / {selectedEvent.durationDays}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'rgba(var(--fg-rgb),var(--fg-a4))', marginBottom: '6px' }}>
              {currentSnapshot?.date}
            </div>

            {/* Slider */}
            <input
              type="range"
              min={0}
              max={selectedEvent.durationDays - 1}
              value={currentDay}
              onChange={(e) => {
                stopPlayback();
                setCurrentDay(Number(e.target.value));
              }}
              aria-label="Timeline day slider"
              aria-valuemin={0}
              aria-valuemax={selectedEvent.durationDays - 1}
              aria-valuenow={currentDay}
              aria-valuetext={`Day ${currentDay + 1}: ${currentSnapshot?.date ?? ''}`}
              style={{ width: '100%', accentColor: cfg.color, cursor: 'pointer', marginBottom: '8px' }}
            />

            {/* Day tick labels */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'rgba(var(--fg-rgb),var(--fg-a2))', marginBottom: '8px' }}>
              {selectedEvent.snapshots.map((s) => (
                <span
                  key={s.day}
                  style={{ color: s.day === currentDay ? cfg.color : undefined, fontWeight: s.day === currentDay ? 700 : 400 }}
                >
                  {s.day + 1}
                </span>
              ))}
            </div>

            {/* Playback controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={() => { stopPlayback(); setCurrentDay(0); }}
                aria-label="Reset to day 1"
                title="Reset"
                style={{ background: 'none', border: '1px solid rgba(var(--fg-rgb),var(--fg-a2))', borderRadius: '4px', cursor: 'pointer', color: 'rgba(var(--fg-rgb),var(--fg-a6))', padding: '3px 7px', fontSize: '12px' }}
              >
                ⏮
              </button>
              <button
                onClick={() => { stopPlayback(); setCurrentDay((d) => Math.max(0, d - 1)); }}
                aria-label="Previous day"
                title="Previous"
                style={{ background: 'none', border: '1px solid rgba(var(--fg-rgb),var(--fg-a2))', borderRadius: '4px', cursor: 'pointer', color: 'rgba(var(--fg-rgb),var(--fg-a6))', padding: '3px 7px', fontSize: '12px' }}
              >
                ◀
              </button>
              <button
                onClick={() => (isPlaying ? stopPlayback() : startPlayback())}
                aria-label={isPlaying ? 'Pause playback' : 'Play animation'}
                aria-pressed={isPlaying}
                style={{
                  background: isPlaying ? `${cfg.color}30` : 'rgba(var(--fg-rgb),var(--fg-a08))',
                  border: `1px solid ${isPlaying ? cfg.color : 'rgba(var(--fg-rgb),var(--fg-a2))'}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: isPlaying ? cfg.color : 'rgba(var(--fg-rgb),var(--fg-a75))',
                  padding: '3px 10px',
                  fontSize: '13px',
                  transition: 'all 150ms ease',
                }}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button
                onClick={() => { stopPlayback(); setCurrentDay((d) => Math.min(selectedEvent.durationDays - 1, d + 1)); }}
                aria-label="Next day"
                title="Next"
                style={{ background: 'none', border: '1px solid rgba(var(--fg-rgb),var(--fg-a2))', borderRadius: '4px', cursor: 'pointer', color: 'rgba(var(--fg-rgb),var(--fg-a6))', padding: '3px 7px', fontSize: '12px' }}
              >
                ▶
              </button>

              {/* Speed selector */}
              <select
                value={playSpeed}
                onChange={(e) => { stopPlayback(); setPlaySpeed(Number(e.target.value)); }}
                aria-label="Playback speed"
                style={{
                  marginLeft: 'auto',
                  background: 'rgba(var(--fg-rgb),var(--fg-a05))',
                  border: '1px solid rgba(var(--fg-rgb),var(--fg-a15))',
                  borderRadius: '4px',
                  color: 'rgba(var(--fg-rgb),var(--fg-a6))',
                  fontSize: '10px',
                  padding: '2px 4px',
                  cursor: 'pointer',
                }}
              >
                <option value={2}>0.5×</option>
                <option value={1}>1×</option>
                <option value={0.5}>2×</option>
                <option value={0.25}>4×</option>
              </select>

              {/* Variable selector */}
              <select
                value={displayVariable}
                onChange={(e) => setDisplayVariable(e.target.value as typeof displayVariable)}
                aria-label="Display variable"
                style={{
                  background: 'rgba(var(--fg-rgb),var(--fg-a05))',
                  border: '1px solid rgba(var(--fg-rgb),var(--fg-a15))',
                  borderRadius: '4px',
                  color: 'rgba(var(--fg-rgb),var(--fg-a6))',
                  fontSize: '10px',
                  padding: '2px 4px',
                  cursor: 'pointer',
                }}
              >
                <option value="rainfall">Rain</option>
                <option value="temp_max">T-max</option>
                <option value="temp_min">T-min</option>
              </select>
            </div>
          </GlassPanel>

          {/* ── Split-view (Requirement 37.2) ── */}
          {currentSnapshot && (
            <div style={{ marginTop: '8px' }}>
            <GlassPanel padding="sm" className="split-view-panel">
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'rgba(var(--fg-rgb),var(--fg-a4))',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: '8px',
                }}
              >
                Split View — {currentSnapshot.date}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <GridMiniMap
                    cells={currentSnapshot.observed}
                    variable={displayVariable}
                    label="Observed"
                    accentColor="#4ade80"
                  />
                </div>
                <div>
                  <GridMiniMap
                    cells={currentSnapshot.predicted}
                    variable={displayVariable}
                    label="VAYU Predicted"
                    accentColor={cfg.color}
                  />
                </div>
              </div>
            </GlassPanel>
            </div>
          )}

          {/* ── Skill Scores (Requirement 37.3) ── */}
          {skillScores && (
            <div style={{ marginTop: '8px' }}>
            <GlassPanel padding="sm" className="skill-scores-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'rgba(var(--fg-rgb),var(--fg-a4))',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  📊 Skill Scores — Day {currentDay + 1}
                </div>
                <div
                  title="Aggregate scores across all event days"
                  style={{ fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}
                >
                  {aggregateSkillScores
                    ? `Aggregate CSI: ${fmtScore(aggregateSkillScores.csi)}`
                    : null}
                </div>
              </div>
              <SkillScoreBar
                label="Hit Rate (POD)"
                value={skillScores.hitRate}
                tooltip="Probability of Detection = hits / (hits + misses). Higher is better."
              />
              <SkillScoreBar
                label="False Alarm Ratio (FAR)"
                value={skillScores.far}
                invert
                tooltip="FAR = false alarms / (hits + false alarms). Lower is better."
              />
              <SkillScoreBar
                label="Critical Success Index (CSI)"
                value={skillScores.csi}
                tooltip="CSI = hits / (hits + misses + false alarms). Higher is better."
              />
              <SkillScoreBar
                label="Gilbert Skill Score (GSS)"
                value={skillScores.gss}
                tooltip="Equitable Threat Score accounting for random chance. Higher is better."
              />
              <div style={{ marginTop: '8px', fontSize: '10px', color: 'rgba(var(--fg-rgb),var(--fg-a3))' }}>
                Threshold: {EVENT_SCORING_CONFIG[selectedEvent.category].threshold}{' '}
                {EVENT_SCORING_CONFIG[selectedEvent.category].variable === 'rainfall' ? 'mm/day' : '°C'}
              </div>
            </GlassPanel>
            </div>
          )}
        </div>
      )}

      {/* Placeholder when no event selected */}
      {!selectedEvent && (
        <div
          style={{
            marginTop: '10px',
            textAlign: 'center',
            padding: '24px 16px',
            color: 'rgba(var(--fg-rgb),var(--fg-a2))',
            fontSize: '12px',
            border: '1px dashed rgba(var(--fg-rgb),var(--fg-a1))',
            borderRadius: '8px',
          }}
        >
          Select an event above to load observed data,<br />
          model predictions and skill scores
        </div>
      )}

      {/* Animations */}
      <style>{`
        .historical-replay button:focus-visible {
          outline: 2px solid #60a5fa;
          outline-offset: 2px;
        }
        .event-library::-webkit-scrollbar { width: 4px; }
        .event-library::-webkit-scrollbar-track { background: transparent; }
        .event-library::-webkit-scrollbar-thumb { background: rgba(var(--fg-rgb),var(--fg-a1)); border-radius: 2px; }
      `}</style>
    </div>
  );
};

export default HistoricalReplay;
